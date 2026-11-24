/**
 * Host half of dsh-plugin-updater.
 *
 * Two Host capabilities:
 *  - the global session command `/refresh-title`, which regenerates the
 *    receiving session's title and thereby unpins a manually renamed title
 *    (the browser half adds the session-row menu item);
 *  - the HTTP route `/dsh-plugin-updater/official-addresses`, which answers the
 *    browser half with the `homepage` / `repository` fields of every
 *    profile-installed bundle's own `package.json`. DSH's `listBundles` does not
 *    expose those fields, so this route is how locally developed (non-npm)
 *    plugins can still show an official address.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path'

export const OFFICIAL_ADDRESSES_PATH = '/dsh-plugin-updater/official-addresses'

interface CommandResult {
  kind: 'success' | 'error'
  text: string
}

interface CommandInvocation {
  agent: { id: string }
  signal?: AbortSignal
}

interface SessionLike {
  id: string
}

interface SessionTitleLike {
  refresh(session: SessionLike, signal?: AbortSignal): Promise<{ title?: string } | undefined>
}

/** The profile context DSH mounts in a profile-launched process. */
interface ProfileContextLike {
  readonly dir: string
  readonly installAnchor?: string
}

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    resource: (request: Request) => Promise<Response>
  }): () => void
}

interface HostContext {
  commands: {
    register(definition: {
      name: string
      description: string
      handler: (invocation: CommandInvocation) => Promise<CommandResult> | CommandResult
    }): () => void
  }
  sessions: {
    get(id: string): SessionLike | undefined
  }
  get(name: string): unknown
  inject?(deps: string[], callback: (scope: HostContext) => void): void
  effect(fn: () => (() => void) | void, label?: string): void
  profileContext?: ProfileContextLike
}

/** The two package.json fields that can name a plugin's official page. */
interface PackageLink {
  homepage?: string
  repository?: unknown
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function readGitConfig(gitPath: string): string | null {
  try {
    const stat = statSync(gitPath)
    if (stat.isDirectory()) return readFileSync(join(gitPath, 'config'), 'utf8')
    if (stat.isFile()) {
      // A worktree or submodule: `.git` is a file pointing at the real git dir.
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, 'utf8'))
      if (pointer) return readFileSync(resolvePath(dirname(gitPath), pointer[1].trim(), 'config'), 'utf8')
    }
  } catch {
    /* not a readable git directory */
  }
  return null
}

function gitOriginUrl(config: string): string | null {
  const section = /\[remote\s+"origin"\]\s*\n([\s\S]*?)(?=\n\[|$)/.exec(config)
  if (!section) return null
  const line = /^\s*url\s*=\s*(.+?)\s*$/m.exec(section[1])
  return line ? line[1] : null
}

/** The repository a locally developed package is checked out from, if any. */
function gitRepositoryOf(packageDir: string): unknown {
  let dir: string
  try {
    dir = realpathSync(packageDir)
  } catch {
    return undefined
  }
  let current = dir
  for (let depth = 0; depth < 12; depth += 1) {
    const gitPath = join(current, '.git')
    if (existsSync(gitPath)) {
      const url = readGitConfig(gitPath) ? gitOriginUrl(readGitConfig(gitPath) as string) : null
      if (!url) return undefined
      const directory = relative(current, dir).split(sep).join('/')
      return directory ? { type: 'git', url, directory } : { type: 'git', url }
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

function officialLinkOf(packageDir: string): PackageLink | null {
  const manifest = readJsonFile(join(packageDir, 'package.json'))
  const link: PackageLink = {}
  if (manifest) {
    if (typeof manifest.homepage === 'string' && manifest.homepage.trim()) link.homepage = manifest.homepage.trim()
    if (manifest.repository !== undefined) link.repository = manifest.repository
  }
  if (!link.homepage && !link.repository) {
    const repository = gitRepositoryOf(packageDir)
    if (repository) link.repository = repository
  }
  return link.homepage || link.repository ? link : null
}

/**
 * Read the official link metadata of every profile-installed bundle whose
 * package directory is readable. Only `homepage` / `repository` values leave
 * this function; absolute paths never reach the browser.
 */
export function readOfficialLinks(profileDir: string): Record<string, PackageLink> {
  const manifest = readJsonFile(join(profileDir, 'package.json'))
  if (!manifest) return {}
  const dependencies = manifest.dependencies
  const dsh = manifest.dsh
  const profile = dsh && typeof dsh === 'object' ? (dsh as Record<string, unknown>).profile : undefined
  const bundles = profile && typeof profile === 'object' ? (profile as Record<string, unknown>).bundles : undefined
  if (!dependencies || typeof dependencies !== 'object' || !Array.isArray(bundles)) return {}
  const links: Record<string, PackageLink> = {}
  for (const name of bundles) {
    if (typeof name !== 'string' || !name) continue
    if (!Object.prototype.hasOwnProperty.call(dependencies, name)) continue
    const link = officialLinkOf(join(profileDir, 'node_modules', name))
    if (link) links[name] = link
  }
  return links
}

function officialAddressesResponse(ctx: HostContext): Promise<Response> {
  const profile = ctx.profileContext ?? (ctx.get('profileContext') as ProfileContextLike | undefined)
  const links = profile && typeof profile.dir === 'string' ? readOfficialLinks(profile.dir) : {}
  return Promise.resolve(
    new Response(JSON.stringify({ links }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }),
  )
}

function registerOfficialAddressesRoute(ctx: HostContext): void {
  const webServer = ctx.get('webServer') as WebServerLike | undefined
  if (!webServer || typeof webServer.register !== 'function') return
  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: OFFICIAL_ADDRESSES_PATH,
        resource: () => officialAddressesResponse(ctx),
      }),
    'dsh-plugin-updater: official address route',
  )
}

function startOfficialAddressesRoute(ctx: HostContext): void {
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (scope) => registerOfficialAddressesRoute(scope))
      return
    } catch {
      /* fall through to the direct lookup below */
    }
  }
  registerOfficialAddressesRoute(ctx)
}

export const inject = ['commands', 'sessions']

export function apply(ctx: HostContext): void {
  const handle = async (invocation: CommandInvocation): Promise<CommandResult> => {
    const sessionTitle = ctx.get('sessionTitle') as SessionTitleLike | undefined
    if (!sessionTitle || typeof sessionTitle.refresh !== 'function') {
      return { kind: 'error', text: 'Session title service is not available in this app.' }
    }
    const session = ctx.sessions.get(invocation.agent.id)
    if (!session) {
      return { kind: 'error', text: 'Session is not live; open the conversation and try again.' }
    }
    try {
      const snapshot = await sessionTitle.refresh(session, invocation.signal)
      if (!snapshot || !snapshot.title) {
        return { kind: 'success', text: 'No eligible user message to generate a title from yet.' }
      }
      return { kind: 'success', text: 'Title refreshed: ' + snapshot.title }
    } catch (error) {
      return { kind: 'error', text: 'Session title refresh failed: ' + String((error as Error)?.message || error) }
    }
  }

  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'refresh-title',
        description: 'Regenerate this session title (also unpins a manually renamed title).',
        handler: handle,
      }),
    'dsh-plugin-updater: /refresh-title command',
  )

  startOfficialAddressesRoute(ctx)
}
