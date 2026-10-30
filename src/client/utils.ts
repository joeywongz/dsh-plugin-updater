/** Small pure helpers shared by the store, the engine, and the views. */

import type { ChangeResult, RemoteResult } from '../shared/types'

const reVersion = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

interface ParsedVersion {
  nums: [number, number, number]
  pre: string[]
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = reVersion.exec(String(value || ''))
  if (!match) return null
  return {
    nums: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  }
}

/** SemVer precedence, including prerelease ordering. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return String(a).localeCompare(String(b))
  for (let index = 0; index < 3; index += 1) {
    if (left.nums[index] !== right.nums[index]) return left.nums[index] < right.nums[index] ? -1 : 1
  }
  if (!left.pre.length && !right.pre.length) return 0
  if (!left.pre.length) return 1
  if (!right.pre.length) return -1
  const size = Math.max(left.pre.length, right.pre.length)
  for (let index = 0; index < size; index += 1) {
    const aPart = left.pre[index]
    const bPart = right.pre[index]
    if (aPart === undefined) return -1
    if (bPart === undefined) return 1
    const aNumeric = /^\d+$/.test(aPart)
    const bNumeric = /^\d+$/.test(bPart)
    if (aNumeric && bNumeric) {
      if (Number(aPart) !== Number(bPart)) return Number(aPart) < Number(bPart) ? -1 : 1
    } else if (aNumeric) {
      return -1
    } else if (bNumeric) {
      return 1
    } else if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1
    }
  }
  return 0
}

export function isPrerelease(version: string): boolean {
  const parsed = parseVersion(version)
  return Boolean(parsed && parsed.pre.length)
}

export function maxStableVersion(versions: ReadonlyArray<string | { version: string }>): string | null {
  const stable = versions
    .map((item) => (typeof item === 'string' ? item : item.version))
    .filter((version) => !isPrerelease(version))
  if (!stable.length) return null
  return stable.sort(compareVersions)[stable.length - 1]
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function uniqueList(list: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of list) {
    if (!item || seen.has(item)) continue
    seen.add(item)
    output.push(item)
  }
  return output
}

export async function mapLimit<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice()
  const runners: Array<Promise<void>> = []
  const size = Math.min(limit, queue.length)
  for (let index = 0; index < size; index += 1) {
    runners.push(
      (async () => {
        for (;;) {
          const item = queue.shift()
          if (item === undefined) return
          await worker(item)
        }
      })(),
    )
  }
  await Promise.all(runners)
}

/** A profile dependency saved as `name@range` (npm registry) rather than git/path/tarball. */
export function isNpmSource(source: string | undefined): boolean {
  if (typeof source !== 'string' || !source) return false
  if (/^(git\+|git:|file:|link:|https?:|\.{0,2}\/)/i.test(source)) return false
  const at = source.lastIndexOf('@')
  return at > 0 && at < source.length - 1
}

export function packumentUrl(base: string, name: string): string {
  return String(base).replace(/\/+$/, '') + '/' + String(name).replace(/\//g, '%2F')
}

/** An absolute http(s) URL, normalized, or null for anything else. */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^https?:\/\//i.test(text)) return null
  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git(?=$|[#?/])/i, '').replace(/\/+$/, '')
}

const repositoryHosts: Record<string, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
}

/**
 * Turn a package.json `repository` value (string or `{ url }`) or a Git
 * shorthand into a browsable https URL. Unknown / local shapes yield null.
 */
export function repositoryUrl(value: unknown): string | null {
  let raw = ''
  if (typeof value === 'string') raw = value.trim()
  else if (value && typeof value === 'object') {
    const url = (value as Record<string, unknown>).url
    if (typeof url === 'string') raw = url.trim()
  }
  if (!raw) return null
  // Local paths / unsupported schemes are not web addresses.
  if (/^(?:file|link|workspace|portal):/i.test(raw)) return null
  if (/^[a-z]:[\\/]/i.test(raw)) return null
  if (/^(?:\.{0,2}\/|~\/)/.test(raw)) return null

  const direct = httpUrl(raw)
  if (direct) return stripGitSuffix(direct)

  const shorthand = /^(github|gitlab|bitbucket):(.+)$/i.exec(raw)
  if (shorthand) {
    const host = repositoryHosts[shorthand[1].toLowerCase()]
    const path = stripGitSuffix(shorthand[2]).replace(/^\/+/, '')
    return host && path ? 'https://' + host + '/' + path : null
  }

  const scheme = /^(?:git\+)?(?:ssh|https?|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(raw)
  if (scheme) {
    const path = stripGitSuffix(scheme[2]).replace(/^\/+/, '')
    return path ? 'https://' + scheme[1] + '/' + path : null
  }

  const scp = /^(?:[^@/]+@)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}):(.+)$/i.exec(raw)
  if (scp) {
    const path = stripGitSuffix(scp[2]).replace(/^\/+/, '')
    return path ? 'https://' + scp[1] + '/' + path : null
  }

  return null
}

export interface RepositoryInfo {
  url: string
  directory?: string
}

/** A package.json `repository` value as `{ url, directory }`. */
export function repositoryInfo(value: unknown): RepositoryInfo | null {
  if (typeof value === 'string') {
    const url = repositoryUrl(value)
    return url ? { url } : null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const url = repositoryUrl(record.url)
    if (!url) return null
    const directory = typeof record.directory === 'string' ? record.directory.trim() : ''
    return { url, directory: directory || undefined }
  }
  return null
}

/**
 * A monorepo package's own page: for GitHub repositories with a `directory`
 * this points at that folder instead of the repository root, so two bundles
 * shipped from one monorepo do not collapse into the same readme link.
 */
export function repositoryDeepLink(value: unknown): string | null {
  const info = repositoryInfo(value)
  if (!info || !info.directory) return null
  const directory = info.directory.replace(/^\/+|\/+$/g, '')
  if (!directory) return null
  let parsed: URL
  try {
    parsed = new URL(info.url)
  } catch {
    return null
  }
  if (!/^(?:www\.)?github\.com$/i.test(parsed.hostname)) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2) return null
  const encoded = directory.split('/').map(encodeURIComponent).join('/')
  return parsed.origin + '/' + segments[0] + '/' + segments[1] + '/tree/HEAD/' + encoded
}

/** The official page of a package on the public npm registry. */
export function npmPackageUrl(name: string): string {
  return 'https://www.npmjs.com/package/' + String(name || '').trim()
}

/** Whether an npm registry base maps to the public package page. */
export function isPublicRegistry(base: string): boolean {
  return /(?:^|\.)npmjs\.org|npmmirror\.com/i.test(String(base || ''))
}

/**
 * A browsable URL taken from the bundle's install source: Git remotes become
 * their web page; package ranges, tarballs, and local `file:`/`link:` paths
 * do not count as an official address.
 */
export function sourceUrl(source: string | undefined): string | null {
  if (typeof source !== 'string') return null
  const text = source.trim()
  if (!text) return null
  if (/^(?:file|link|workspace|portal):/i.test(text)) return null
  if (/^(?:\.{0,2}\/|~\/|[a-z]:[\\/])/i.test(text)) return null
  if (/\.(?:tgz|tar\.gz)(?:$|[?#])/i.test(text)) return null
  const bare = text.replace(/^git\+/i, '')
  let resolved: string | null = null
  if (/^(?:github|gitlab|bitbucket):/i.test(bare)) resolved = repositoryUrl(bare)
  else if (/^git@[^:]+:/i.test(bare)) resolved = repositoryUrl(bare)
  else if (/^(?:git|ssh):\/\//i.test(bare)) resolved = repositoryUrl(bare)
  else if (/^https?:\/\//i.test(bare)) resolved = repositoryUrl(bare)
  // A trailing `#<ref>` selects a Git revision, not a page anchor.
  return resolved ? resolved.replace(/#.*$/, '') : null
}

export function formatTime(timestamp: number, language: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString(language || undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(timestamp).toISOString().slice(11, 16)
  }
}

export function errorText(result: RemoteResult<unknown> | null | undefined): string {
  if (!result) return 'unknown error'
  if (result.ok === false && result.error) {
    const error = result.error as { code?: string; message?: string }
    const code = error.code ? String(error.code) : ''
    const message = error.message ? String(error.message) : ''
    if (code && message) return code + ': ' + message
    return message || code || String(result.error)
  }
  return String(result)
}

/** First readable detail of a ChangeResult failure. */
export function changeFailureText(change: ChangeResult | undefined): string {
  if (!change) return 'unknown error'
  const parts: string[] = []
  if (change.error) {
    if (change.error.code) parts.push(String(change.error.code))
    if (change.error.diagnostic) parts.push(String(change.error.diagnostic))
    const incompatible = change.error.incompatible
    if (Array.isArray(incompatible) && incompatible.length) {
      const item = incompatible[0] || {}
      const requirements = item.requirements ? JSON.stringify(item.requirements) : ''
      parts.push(String(item.name || 'plugin') + ' ' + String(item.version || '') + ' ' + requirements)
    }
  }
  if (!parts.length && change.packageResult) {
    if (change.packageResult.kind) parts.push(String(change.packageResult.kind))
    const output = String(change.packageResult.output || '').trim()
    if (output) {
      const lines = output.split('\n').filter((line) => line.trim())
      parts.push(lines[lines.length - 1])
    }
  }
  if (!parts.length && change.stage) parts.push('failed at ' + String(change.stage))
  return parts.join(' · ') || 'unknown error'
}
