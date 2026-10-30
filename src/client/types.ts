/** Browser-side row model. */

export type Category = 'external' | 'builtin' | 'experimental'

export type RowStatus =
  | 'checking'
  | 'latest'
  | 'update'
  | 'unknown'
  | 'self'
  | 'skipped'
  | 'shipped'
  | 'busy'
  | 'error'

export interface VersionInfo {
  version: string
  deprecated?: boolean
  enginesDsh?: string
  installSpec?: string
  registry?: string
  compatible?: boolean
}

export interface UpdaterRow {
  name: string
  category: Category
  title: string
  description: string
  icon: string | null
  /** Browsable homepage / repository / npm page; null when nothing official is known. */
  officialUrl: string | null
  current: string | null
  enabled: boolean
  removable: boolean
  locked: boolean
  latest: string | null
  versions: VersionInfo[]
  from: 'npm' | 'market' | null
  status: RowStatus
  busy: boolean
  error: string | null
}
