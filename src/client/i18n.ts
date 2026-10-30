/** Page and action copy plus the locale-service helpers this plugin needs. */

export interface ClientContext {
  locale: {
    getLocale(): unknown
    bind(ns: string): (key: string) => string
    register(ns: string, locale: string, dict: Record<string, string>): () => void
    subscribe(fn: () => void): () => void
  }
  slots: {
    inject(name: string, callback: () => void): void
    register(options: Record<string, unknown>, component: (props: Record<string, unknown>) => unknown): void
  }
  inject(deps: string[], callback: (scoped: ClientContext & Record<string, unknown>) => void): void
  effect(fn: () => (() => void) | void, label?: string): void
  remote?: Record<string, unknown>
  get?(key: string): unknown
}

export const NS = 'dshPluginUpdater'
export const NS_ACTIONS = 'dshPluginUpdaterActions'

export const pageDicts: Record<string, Record<string, string>> = {
  en: {
    tab: 'Updates',
    title: 'Plugin updates',
    subtitle: 'Versions are checked automatically whenever the app opens.',
    pluginsWord: 'plugins',
    updatesWord: 'updatable',
    checking: 'Checking versions…',
    checkNow: 'Check again',
    upgradeAll: 'Upgrade all',
    upgrading: 'Upgrading',
    upgradingAll: 'Upgrading all plugins…',
    columnPlugin: 'Plugin',
    columnCurrent: 'Current',
    columnLatest: 'Latest',
    columnStatus: 'Status',
    columnAction: 'Action',
    groupBuiltin: 'Built-in',
    groupExperimental: 'Experimental',
    groupExternal: 'External',
    groupBuiltinHint: 'Shipped with DSH; upgraded together with the app.',
    groupExperimentalHint: 'Experimental bundles shipped with DSH; upgraded together with the app.',
    groupExternalHint: 'Plugins installed in this profile; upgrade them here.',
    statusShipped: 'Ships with DSH',
    toggleOn: 'Enabled',
    uninstall: 'Remove',
    confirmRemove: 'Remove this plugin?',
    confirmRemoveAction: 'Remove',
    cancel: 'Cancel',
    lockedHint: 'Managed by DSH',
    latestTag: 'latest',
    statusLatest: 'Up to date',
    statusUpdate: 'Update available',
    statusUnknown: 'Version unknown',
    statusSelf: 'This plugin',
    statusSkipped: 'Not an npm install',
    statusChecking: 'Checking…',
    statusBusy: 'Working…',
    statusError: 'Failed',
    upgrade: 'Upgrade',
    chooseVersion: 'Choose a version to upgrade to',
    noVersions: 'No newer version was listed.',
    lastChecked: 'Last checked',
    never: 'never',
    empty: 'No manageable plugins were found.',
    unreachable: 'Could not read the latest version from the registry.',
    retry: 'Retry',
    rollbackFailed: 'Upgrade failed, and the previous version could not be restored.',
    selfHint: 'The updater never upgrades itself.',
    skippedHint: 'Installed from Git or a local path, so only a reinstall can change it.',
    prerelease: 'pre-release',
    doneMessage: 'Upgrade finished.',
    partialMessage: 'Finished with errors.',
    connecting: 'Connecting to the plugin manager…',
    serviceUnavailable: 'The plugin manager service is not available in this app.',
    readFailed: 'Could not read the installed plugin list.',
    officialLink: 'Official site',
  },
  zh: {
    tab: '插件更新',
    title: '插件更新',
    subtitle: '每次打开客户端都会自动检查版本。',
    pluginsWord: '个插件',
    updatesWord: '个可升级',
    checking: '正在检查版本…',
    checkNow: '重新检查',
    upgradeAll: '一键升级',
    upgrading: '正在升级',
    upgradingAll: '正在升级全部插件…',
    columnPlugin: '插件',
    columnCurrent: '当前版本',
    columnLatest: '最新版本',
    columnStatus: '状态',
    columnAction: '操作',
    groupBuiltin: '内置',
    groupExperimental: '实验箱',
    groupExternal: '外部',
    groupBuiltinHint: '随 DSH 安装包提供，升级客户端时一起更新。',
    groupExperimentalHint: 'DSH 随包提供的实验性插件，同样随客户端升级。',
    groupExternalHint: '安装在本 profile 的插件，可在这里升级。',
    statusShipped: '随客户端升级',
    toggleOn: '启用',
    uninstall: '卸载',
    confirmRemove: '确认卸载此插件？',
    confirmRemoveAction: '确认卸载',
    cancel: '取消',
    lockedHint: '由 DSH 管理',
    latestTag: '最新',
    statusLatest: '已是最新',
    statusUpdate: '有新版本',
    statusUnknown: '版本未知',
    statusSelf: '本插件',
    statusSkipped: '非 npm 安装',
    statusChecking: '检查中…',
    statusBusy: '处理中…',
    statusError: '失败',
    upgrade: '升级',
    chooseVersion: '选择要升级到的版本',
    noVersions: '没有列出更新的版本。',
    lastChecked: '上次检查',
    never: '从未',
    empty: '没有找到可管理的插件。',
    unreachable: '无法从插件源读取最新版本。',
    retry: '重试',
    rollbackFailed: '升级失败，且未能恢复原版本。',
    selfHint: '更新器不会升级自身。',
    skippedHint: '来自 Git 或本地路径，只能重新安装。',
    prerelease: '预发布',
    doneMessage: '升级完成。',
    partialMessage: '完成，但有错误。',
    connecting: '正在连接插件管理服务…',
    serviceUnavailable: '当前应用没有可用的插件管理服务。',
    readFailed: '无法读取已安装插件列表。',
    officialLink: '官方地址',
  },
}

export const actionDicts: Record<string, Record<string, string>> = {
  en: {
    refreshTitle: 'Refresh title',
    refreshTitleHint: 'Regenerate this session title; also unpins a manually renamed title.',
  },
  zh: {
    refreshTitle: '刷新标题',
    refreshTitleHint: '重新生成会话标题，并取消手动改名造成的固定。',
  },
}

export function dictionaryFor(language: string | undefined, dicts: Record<string, Record<string, string>>): Record<string, string> {
  if (language && dicts[language]) return dicts[language]
  const base = String(language || '').split('-')[0]
  if (base && dicts[base]) return dicts[base]
  return dicts.en
}

export function lookup(language: string | undefined, key: string, dicts: Record<string, Record<string, string>>): string {
  const table = dictionaryFor(language, dicts)
  return table[key] || dicts.en[key] || key
}

/** Best-effort language id from the locale service snapshot. */
export function currentLanguage(ctx: ClientContext | null): string {
  try {
    const snapshot = ctx && ctx.locale ? ctx.locale.getLocale() : undefined
    if (snapshot && typeof snapshot === 'object') {
      const record = snapshot as Record<string, unknown>
      const candidate = record.locale || record.id || record.lang || record.language
      if (typeof candidate === 'string' && candidate) return candidate
    }
  } catch {
    /* the locale service may not be mounted yet */
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  } catch {
    /* no navigator outside the page */
  }
  return 'en'
}

export function pickLocalized(value: unknown, language: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  const record = value as Record<string, unknown>
  const candidates = [language, String(language || '').split('-')[0], 'en']
  for (const candidate of candidates) {
    if (candidate && typeof record[candidate] === 'string') return record[candidate] as string
  }
  for (const key of Object.keys(record)) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  return undefined
}
