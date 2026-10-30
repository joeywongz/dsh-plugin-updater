/** Remote faces this plugin consumes, plus the way they are reached. */

import type {
  BundleInfo,
  ChangeResult,
  MarketSearchResult,
  PluginRegistries,
  RemoteResult,
} from '../shared/types'
import type { ClientContext } from './i18n'

export interface PluginManagerRemote {
  listBundles(): Promise<RemoteResult<BundleInfo[]>>
  registries(): Promise<RemoteResult<PluginRegistries>>
  installBundle(spec: string, options?: Record<string, unknown>): Promise<RemoteResult<ChangeResult>>
  removeBundle(name: string): Promise<RemoteResult<ChangeResult>>
  setBundleEnabled(name: string, enabled: boolean): Promise<RemoteResult<ChangeResult>>
}

export interface MarketIndexSource {
  url: string
  title?: unknown
  description?: unknown
  error?: string
}

export interface PluginMarketRemote {
  listIndexes(): Promise<RemoteResult<MarketIndexSource[]>>
  search(url: string, query: Record<string, unknown>): Promise<RemoteResult<MarketSearchResult>>
}

export interface CommandsRemote {
  execute(agentId: string, line: string, attachments: unknown[]): Promise<RemoteResult<unknown>>
}

/** Finds one mounted Remote namespace without assuming the Cordis internal shape. */
export function remoteNamespace(context: ClientContext, name: string): unknown {
  const record = context as unknown as Record<string, unknown>
  const remote = record.remote as Record<string, unknown> | undefined
  if (remote && remote[name]) return remote[name]
  const getter = record.get
  if (typeof getter === 'function') {
    try {
      const direct = (getter as (key: string) => unknown).call(context, 'remote.' + name)
      if (direct) return direct
    } catch {
      /* ignore */
    }
    try {
      const root = (getter as (key: string) => unknown).call(context, 'remote') as Record<string, unknown> | undefined
      if (root && root[name]) return root[name]
    } catch {
      /* ignore */
    }
  }
  return null
}
