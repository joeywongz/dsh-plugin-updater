/** Shapes shared by the Host half and the browser half. */

export type LocalizedText = string | { en: string; [locale: string]: string }

export interface PluginLocalizedMeta {
  title?: LocalizedText
  description?: LocalizedText
  icon?: string
  error?: string
}

export interface ManagementError {
  code?: string
  diagnostic?: string
  incompatible?: Array<{
    name?: string
    version?: string
    requirements?: Record<string, string>
  }>
}

export interface BundleRowInfo {
  rowId: string
  moduleName: string
  meta?: PluginLocalizedMeta
  entryId?: string
}

export interface BundleInfo {
  name: string
  official?: boolean
  availability?: 'profile' | 'installation' | 'missing'
  installTarget?: { spec: string; version: string }
  version?: string
  meta?: PluginLocalizedMeta
  description?: string
  enabled?: boolean
  installed?: boolean
  source?: string
  optional?: boolean
  removable?: boolean
  readOnlyReason?: 'management-required' | 'unaddressable'
  error?: ManagementError
  rows?: BundleRowInfo[]
  overrides?: string[]
}

export interface PackageResult {
  exitCode?: number
  output?: string
  truncated?: boolean
  logPath?: string
  kind?: string
  timedOut?: boolean
}

export interface ChangeResult {
  changed?: boolean
  application?: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  restartReason?: string
  stage?: 'install' | 'enable' | 'remove'
  target?: string
  enabled?: boolean
  error?: ManagementError
  warnings?: string[]
  packageResult?: PackageResult
  bundle?: string
  version?: string
  pendingBuilds?: string[]
  registries?: Array<string | null>
}

export interface PluginRegistries {
  registry: string | null
  fallbackRegistries?: string[]
  resolved?: string | null
}

/** The client Remote answers every unary call with this envelope. */
export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: unknown }

export interface MarketVersion {
  version: string
  publishTimestamp?: number
  install?: { spec: string; registry?: string | null }
  compatibility?:
    | { compatible: true }
    | { compatible: false; runtimeVersion?: string; requirements?: Record<string, string>; exempted?: boolean }
  engines?: { dsh?: string }
}

export interface MarketEntry {
  name: string
  title?: LocalizedText
  description?: LocalizedText
  homepage?: string
  repository?: { url: string; directory?: string }
  versions: MarketVersion[]
  defaultVersion?: string
}

export interface MarketSearchResult {
  url: string
  title: LocalizedText
  entries: MarketEntry[]
  total: number
  nextOffset: number | null
  fetchedAt: number
}
