/** All plugin operations: version checks, upgrades, enable/disable, removal, title refresh. */

import type { BundleInfo, MarketEntry, MarketVersion } from '../shared/types'
import type { ClientContext } from './i18n'
import { currentLanguage, lookup, pageDicts, pickLocalized } from './i18n'
import type { CommandsRemote, MarketIndexSource, PluginManagerRemote, PluginMarketRemote } from './services'
import { findRow, getUpdaterState, patchRow, patchUpdaterState } from './store'
import type { Category, UpdaterRow, VersionInfo } from './types'
import {
  changeFailureText,
  compareVersions,
  errorText,
  httpUrl,
  isNpmSource,
  isPublicRegistry,
  mapLimit,
  maxStableVersion,
  npmPackageUrl,
  packumentUrl,
  repositoryDeepLink,
  repositoryUrl,
  sleep,
  sourceUrl,
  uniqueList,
} from './utils'

export const SELF = 'dsh-plugin-updater'

/** Remote namespaces this engine consumes; they may mount after the engine exists. */
export interface EngineServices {
  market: PluginMarketRemote | null
  commands: CommandsRemote | null
}

export interface EngineDeps {
  ctx: ClientContext
  manager: PluginManagerRemote
  services: EngineServices
}

export interface Engine {
  boot(): Promise<void>
  checkAll(): Promise<void>
  upgradeOne(name: string, targetVersion?: string): Promise<void>
  upgradeAll(): Promise<void>
  setEnabled(name: string, value: boolean): Promise<void>
  toggleOne(name: string): Promise<void>
  removeOne(name: string): Promise<void>
  refreshTitle(sessionId: string): Promise<void>
}

interface ResolvedVersions {
  latest: string | null
  versions: VersionInfo[]
  from: 'npm' | 'market'
  registry: string | null
  /** Set when the market index already knows the plugin's page. */
  officialUrl: string | null
}

interface RegistryManifest {
  document: Record<string, unknown>
  base: string
}

interface ManifestLookup {
  manifest: RegistryManifest | null
  /** The registry answered 404/gone for every base: this package has no page. */
  missing: boolean
}

/** Three groups for the page. */
export function classifyBundle(bundle: BundleInfo): Category {
  if (bundle.availability !== 'installation') return 'external'
  const name = String(bundle.name || '')
  if (bundle.optional === true || /experimental/i.test(name)) return 'experimental'
  return 'builtin'
}

export function createEngine(deps: EngineDeps): Engine {
  const { ctx, manager, services } = deps
  let registriesPromise: Promise<string[]> | null = null
  const failures = new Map<string, string>()
  /** Bundles from the last listing, kept for fields the row model does not carry. */
  const bundlesByName = new Map<string, BundleInfo>()
  /** Successful official URLs; a failed lookup retries on the next check. */
  const officialUrls = new Map<string, string | null>()

  const language = (): string => currentLanguage(ctx)
  const t = (key: string): string => lookup(language(), key, pageDicts)

  function setRow(name: string, patch: Partial<UpdaterRow>): void {
    patchRow(name, patch)
  }

  function rowOf(name: string): UpdaterRow | undefined {
    return findRow(name)
  }

  async function callWithRetry<T>(
    run: () => Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
    attempts: number,
  ) {
    const total = attempts || 3
    let last: { ok: true; value: T } | { ok: false; error: unknown } | null = null
    for (let attempt = 0; attempt < total; attempt += 1) {
      try {
        last = await run()
        if (last && last.ok !== false) return last
      } catch (error) {
        last = { ok: false, error }
      }
      if (attempt + 1 < total) await sleep(attempt === 0 ? 400 : 900)
    }
    return last
  }

  async function registries(): Promise<string[]> {
    if (!registriesPromise) {
      registriesPromise = (async () => {
        let list: Array<string | null | undefined> = []
        try {
          const result = await manager.registries()
          if (result && result.ok && result.value) {
            list.push(result.value.resolved, result.value.registry)
            if (Array.isArray(result.value.fallbackRegistries)) list = list.concat(result.value.fallbackRegistries)
          }
        } catch {
          /* fall through to the public defaults */
        }
        list.push('https://registry.npmjs.org/', 'https://registry.npmmirror.com/')
        return uniqueList(list)
      })()
    }
    return registriesPromise
  }

  function normalizePackument(name: string, document: Record<string, unknown>, base: string): ResolvedVersions {
    const versionsObject = (document.versions as Record<string, Record<string, unknown>>) || {}
    const versions: VersionInfo[] = Object.keys(versionsObject)
      .map((version) => {
        const meta = versionsObject[version] || {}
        const engines = meta.engines as Record<string, string> | undefined
        return {
          version,
          deprecated: Boolean(meta.deprecated),
          enginesDsh: engines ? engines.dsh : undefined,
          installSpec: name + '@' + version,
          registry: undefined,
          compatible: undefined,
        }
      })
      .sort((a, b) => compareVersions(b.version, a.version))
    const distTags = document['dist-tags'] as Record<string, string> | undefined
    const latest = (distTags && distTags.latest) || maxStableVersion(versions)
    return { latest, versions, from: 'npm', registry: base, officialUrl: null }
  }

  async function tryPackument(name: string): Promise<ResolvedVersions | null> {
    const bases = await registries()
    for (const base of bases) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), 8000) : null
      try {
        const response = await fetch(packumentUrl(base, name), {
          signal: controller ? controller.signal : undefined,
          headers: { accept: 'application/vnd.npm.install-v1+json' },
        })
        if (timer) clearTimeout(timer)
        if (!response.ok) continue
        const document = (await response.json()) as Record<string, unknown>
        const versions = document.versions as Record<string, unknown> | undefined
        if (!document || !versions || !Object.keys(versions).length) continue
        return normalizePackument(name, document, base)
      } catch {
        if (timer) clearTimeout(timer)
        continue
      }
    }
    return null
  }

  async function tryMarket(name: string): Promise<ResolvedVersions | null> {
    const market = services.market
    if (!market) return null
    let sources: MarketIndexSource[] = []
    try {
      const listed = await market.listIndexes()
      if (listed && listed.ok && Array.isArray(listed.value)) sources = listed.value
    } catch {
      return null
    }
    for (const source of sources) {
      if (!source || !source.url) continue
      try {
        const result = await market.search(source.url, {
          text: name,
          sort: { kind: 'index' },
          offset: 0,
          limit: 100,
        })
        if (!result || !result.ok || !result.value) continue
        const entry = (result.value.entries || []).find((candidate: MarketEntry) => candidate && candidate.name === name)
        if (!entry || !Array.isArray(entry.versions) || !entry.versions.length) continue
        const versions: VersionInfo[] = entry.versions
          .map((version: MarketVersion) => ({
            version: version.version,
            deprecated: false,
            enginesDsh: version.engines ? version.engines.dsh : undefined,
            installSpec: version.install ? version.install.spec : name + '@' + version.version,
            registry: version.install ? version.install.registry || undefined : undefined,
            compatible: version.compatibility ? version.compatibility.compatible : undefined,
          }))
          .sort((a, b) => compareVersions(b.version, a.version))
        const latest = entry.defaultVersion || maxStableVersion(versions)
        const marketUrl =
          httpUrl(entry.homepage) || repositoryDeepLink(entry.repository) || repositoryUrl(entry.repository)
        return { latest, versions, from: 'market', registry: null, officialUrl: marketUrl }
      } catch {
        continue
      }
    }
    return null
  }

  async function resolveVersions(name: string): Promise<ResolvedVersions | null> {
    const fromPackument = await tryPackument(name)
    if (fromPackument) return fromPackument
    return tryMarket(name)
  }

  function rememberBundles(list: BundleInfo[]): void {
    bundlesByName.clear()
    for (const bundle of list) {
      if (bundle && bundle.name) bundlesByName.set(bundle.name, bundle)
    }
  }

  /**
   * One version manifest (much smaller than a full packument) to read
   * homepage/repository. The installed version is asked for first, because a
   * stale `latest` dist-tag must not decide the link.
   */
  async function lookupVersionManifest(name: string, version: string | null): Promise<ManifestLookup> {
    const bases = await registries()
    const suffixes = version ? ['/' + encodeURIComponent(version), '/latest'] : ['/latest']
    let definitive = false
    let transient = false
    for (const base of bases) {
      for (const suffix of suffixes) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        const timer = controller ? setTimeout(() => controller.abort(), 8000) : null
        try {
          const response = await fetch(packumentUrl(base, name) + suffix, {
            signal: controller ? controller.signal : undefined,
            headers: { accept: 'application/json' },
          })
          if (timer) clearTimeout(timer)
          if (response.status === 404 || response.status === 410) {
            definitive = true
            continue
          }
          if (!response.ok) {
            transient = true
            continue
          }
          const document = (await response.json()) as Record<string, unknown>
          if (document && typeof document === 'object' && typeof document.name === 'string') {
            return { manifest: { document, base }, missing: false }
          }
          transient = true
        } catch {
          if (timer) clearTimeout(timer)
          transient = true
          continue
        }
      }
    }
    // "No page" is only trustworthy when every attempt answered 404/410.
    return { manifest: null, missing: definitive && !transient }
  }

  /** Monorepo directory → homepage → repository root → public npm page. */
  function officialFromManifest(name: string, manifest: RegistryManifest): string | null {
    const deepLink = repositoryDeepLink(manifest.document.repository)
    if (deepLink) return deepLink
    const homepage = httpUrl(manifest.document.homepage)
    if (homepage) return homepage
    const repository = repositoryUrl(manifest.document.repository)
    if (repository) return repository
    if (isPublicRegistry(manifest.base)) return npmPackageUrl(name)
    return null
  }

  /**
   * Fill in the official address for rows whose install source is not a Git
   * remote. Every bundle name is looked up on the registry, so a plugin that
   * is developed locally (`file:` / `link:`) still links to its published
   * page; unpublished names are remembered as having no page.
   */
  function officialKey(row: UpdaterRow): string {
    return row.name + '@' + (row.current || '')
  }

  function setOfficialUrlIfEmpty(name: string, url: string): void {
    const current = rowOf(name)
    if (!current || current.officialUrl) return
    setRow(name, { officialUrl: url })
  }

  async function resolveOfficialUrls(rows: UpdaterRow[]): Promise<void> {
    const pending = rows.filter((row) => !row.officialUrl)
    await mapLimit(pending, 3, async (row) => {
      const key = officialKey(row)
      if (officialUrls.has(key)) {
        const cached = officialUrls.get(key)
        if (cached) setOfficialUrlIfEmpty(row.name, cached)
        return
      }
      const bundle = bundlesByName.get(row.name)
      if (!bundle) return
      const lookup = await lookupVersionManifest(row.name, row.current)
      if (lookup.manifest) {
        const url = officialFromManifest(row.name, lookup.manifest)
        officialUrls.set(key, url)
        if (url) setOfficialUrlIfEmpty(row.name, url)
      } else if (lookup.missing) {
        officialUrls.set(key, null)
      }
    })
  }

  function toRow(bundle: BundleInfo): UpdaterRow | null {
    if (!bundle || !bundle.name || bundle.availability === 'missing') return null
    const languageId = language()
    const row: UpdaterRow = {
      name: bundle.name,
      category: classifyBundle(bundle),
      title: pickLocalized(bundle.meta && bundle.meta.title, languageId) || bundle.name,
      description: pickLocalized(bundle.meta && bundle.meta.description, languageId) || bundle.description || '',
      icon: (bundle.meta && bundle.meta.icon) || null,
      officialUrl: sourceUrl(bundle.source),
      current: bundle.version || null,
      enabled: bundle.enabled !== false,
      removable: Boolean(bundle.removable),
      locked: Boolean(bundle.readOnlyReason),
      latest: null,
      versions: [],
      from: null,
      status: 'checking',
      busy: false,
      error: null,
    }
    if (bundle.availability === 'installation') {
      row.status = 'shipped'
      return row
    }
    if (bundle.name === SELF) {
      row.status = 'self'
      return row
    }
    if (!bundle.installed || bundle.availability !== 'profile' || !bundle.removable || bundle.readOnlyReason) {
      row.status = 'skipped'
      return row
    }
    if (!bundle.version || !isNpmSource(bundle.source)) {
      row.status = 'skipped'
      return row
    }
    if (bundle.error) {
      row.status = 'error'
      row.error = String(bundle.error.code || '') + (bundle.error.diagnostic ? ': ' + bundle.error.diagnostic : '')
      return row
    }
    row.error = failures.get(bundle.name) || null
    return row
  }

  function applyVersionInfo(name: string, info: ResolvedVersions | null): void {
    const row = rowOf(name)
    if (!row) return
    if (!info) {
      setRow(name, { status: 'unknown', latest: null, versions: [], from: null })
      return
    }
    const latest = info.latest || null
    const current = row.current
    let status: UpdaterRow['status'] = 'unknown'
    if (latest && current) status = compareVersions(latest, current) > 0 ? 'update' : 'latest'
    else if (latest) status = 'update'
    const patch: Partial<UpdaterRow> = {
      latest,
      versions: info.versions || [],
      from: info.from,
      status,
      error: failures.get(name) || null,
    }
    if (info.officialUrl) patch.officialUrl = info.officialUrl
    setRow(name, patch)
  }

  async function readRows(): Promise<UpdaterRow[] | null> {
    const listed = await callWithRetry(() => manager.listBundles(), 3)
    if (!listed || listed.ok === false) {
      patchUpdaterState({ phase: 'error', error: errorText(listed), checkedAt: null })
      return null
    }
    rememberBundles(listed.value)
    return listed.value.map(toRow).filter((row): row is UpdaterRow => Boolean(row))
  }

  async function resolvePending(rows: UpdaterRow[]): Promise<void> {
    const pending = rows.filter((row) => row.status === 'checking')
    await mapLimit(pending, 4, async (row) => {
      const info = await resolveVersions(row.name)
      applyVersionInfo(row.name, info)
    })
  }

  async function checkAll(): Promise<void> {
    if (getUpdaterState().busy) return
    patchUpdaterState({ phase: 'checking', error: null, message: null })
    const rows = await readRows()
    if (!rows) return
    patchUpdaterState({ rows })
    await Promise.all([resolvePending(rows), resolveOfficialUrls(rows)])
    patchUpdaterState({ phase: 'ready', checkedAt: Date.now() })
  }

  async function boot(): Promise<void> {
    const listed = await callWithRetry(() => manager.listBundles(), 10)
    if (!listed || listed.ok === false) {
      patchUpdaterState({ phase: 'error', error: errorText(listed) })
      return
    }
    rememberBundles(listed.value)
    const rows = listed.value.map(toRow).filter((row): row is UpdaterRow => Boolean(row))
    patchUpdaterState({ rows, serviceReady: true, phase: 'checking' })
    await Promise.all([resolvePending(rows), resolveOfficialUrls(rows)])
    patchUpdaterState({ phase: 'ready', checkedAt: Date.now() })
  }

  async function upgradeTo(name: string, targetVersion: string): Promise<void> {
    const row = rowOf(name)
    if (!row || !targetVersion) return
    const previous = row.current
    const enabled = row.enabled !== false
    const targetInfo = (row.versions || []).find((item) => item.version === targetVersion) || null
    failures.delete(name)
    setRow(name, { busy: true, status: 'busy', error: null })
    let removed = false
    try {
      const removal = await manager.removeBundle(name)
      if (!removal || removal.ok === false) throw new Error(errorText(removal))
      if (removal.value && removal.value.application === 'failed') throw new Error(changeFailureText(removal.value))
      removed = true
      const spec = (targetInfo && targetInfo.installSpec) || name + '@' + targetVersion
      const options: Record<string, unknown> = { enabled, saveExact: true }
      if (targetInfo && targetInfo.registry) options.registry = targetInfo.registry
      const installation = await manager.installBundle(spec, options)
      if (!installation || installation.ok === false) throw new Error(errorText(installation))
      if (installation.value && installation.value.application === 'failed') {
        throw new Error(changeFailureText(installation.value))
      }
      const installedVersion = (installation.value && installation.value.version) || targetVersion
      setRow(name, { busy: false, current: installedVersion, status: 'latest', error: null })
    } catch (error) {
      let message = String((error as Error)?.message || error)
      if (removed && previous) {
        try {
          const rollback = await manager.installBundle(name + '@' + previous, { enabled, saveExact: true })
          const failed =
            !rollback || rollback.ok === false || (rollback.value && rollback.value.application === 'failed')
          if (failed) message += '\n' + t('rollbackFailed')
        } catch {
          message += '\n' + t('rollbackFailed')
        }
      }
      failures.set(name, message)
      setRow(name, { busy: false, status: 'error', error: message })
    }
  }

  async function upgradeOne(name: string, targetVersion?: string): Promise<void> {
    if (getUpdaterState().busy) return
    const target = targetVersion || (rowOf(name) || { latest: null }).latest
    if (!target) return
    patchUpdaterState({ busy: true, progress: { done: 0, total: 1, name }, message: null })
    await upgradeTo(name, target)
    patchUpdaterState({ busy: false, progress: null })
    await checkAll()
  }

  async function upgradeAll(): Promise<void> {
    const state = getUpdaterState()
    if (state.busy) return
    const targets = state.rows.filter((row) => row.status === 'update' && row.latest && !row.busy)
    if (!targets.length) return
    patchUpdaterState({ busy: true, message: null })
    let failed = 0
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      patchUpdaterState({ progress: { done: index, total: targets.length, name: target.name } })
      const before = failures.size
      await upgradeTo(target.name, target.latest as string)
      if (failures.size > before) failed += 1
      patchUpdaterState({ progress: { done: index + 1, total: targets.length, name: '' } })
    }
    patchUpdaterState({ busy: false, progress: null })
    await checkAll()
    patchUpdaterState({ message: failed ? 'partial' : 'done' })
  }

  /** Enable or disable one bundle's layer without touching its installation. */
  async function setEnabled(name: string, value: boolean): Promise<void> {
    if (name === SELF || getUpdaterState().busy) return
    const row = rowOf(name)
    if (!row || row.locked) return
    const next = Boolean(value)
    if (next === row.enabled) return
    patchUpdaterState({ busy: true, message: null })
    failures.delete(name)
    setRow(name, { busy: true, error: null })
    try {
      const result = await manager.setBundleEnabled(name, next)
      if (!result || result.ok === false) throw new Error(errorText(result))
      if (result.value && result.value.application === 'failed') throw new Error(changeFailureText(result.value))
      setRow(name, { enabled: next, busy: false, error: null })
    } catch (error) {
      const message = String((error as Error)?.message || error)
      failures.set(name, message)
      setRow(name, { busy: false, error: message })
    }
    patchUpdaterState({ busy: false })
    await checkAll()
  }

  async function toggleOne(name: string): Promise<void> {
    const row = rowOf(name)
    if (row) await setEnabled(name, !row.enabled)
  }

  /** Remove a profile plugin's package and selection. */
  async function removeOne(name: string): Promise<void> {
    if (name === SELF || getUpdaterState().busy) return
    const row = rowOf(name)
    if (!row || !row.removable) return
    patchUpdaterState({ busy: true, message: null })
    failures.delete(name)
    setRow(name, { busy: true, error: null })
    try {
      const result = await manager.removeBundle(name)
      if (!result || result.ok === false) throw new Error(errorText(result))
      if (result.value && result.value.application === 'failed') throw new Error(changeFailureText(result.value))
    } catch (error) {
      const message = String((error as Error)?.message || error)
      failures.set(name, message)
      setRow(name, { busy: false, error: message })
    }
    patchUpdaterState({ busy: false })
    await checkAll()
  }

  /** Ask the Host command to regenerate one session title (also unpins a rename). */
  async function refreshTitle(sessionId: string): Promise<void> {
    const commands = services.commands
    if (!commands || typeof commands.execute !== 'function') {
      console.warn('[dsh-plugin-updater] command remote unavailable; cannot refresh the title')
      return
    }
    try {
      const result = await commands.execute(sessionId, '/refresh-title', [])
      if (!result || result.ok === false) {
        console.warn('[dsh-plugin-updater] title refresh failed: ' + errorText(result))
      }
    } catch (error) {
      console.warn('[dsh-plugin-updater] title refresh failed: ' + String((error as Error)?.message || error))
    }
  }

  return {
    boot,
    checkAll,
    upgradeOne,
    upgradeAll,
    setEnabled,
    toggleOne,
    removeOne,
    refreshTitle,
  }
}
