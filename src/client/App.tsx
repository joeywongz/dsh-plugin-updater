/** The "Plugin updates" page registered as a tab on the Plugins page. */

import React from 'react'
import type { Engine } from './engine'
import type { ClientContext } from './i18n'
import { BundleRow } from './BundleRow'
import { ActionButton, tableGrid } from './components'
import { usePageTranslator, useUpdaterState } from './hooks'
import type { Category, UpdaterRow } from './types'
import { formatTime } from './utils'
import { currentLanguage } from './i18n'

interface UpdaterPageProps {
  ctx: ClientContext
  engine: Engine | null
  [key: string]: unknown
}

const GROUP_ORDER: Category[] = ['external', 'builtin', 'experimental']
const GROUP_TITLE_KEYS: Record<Category, string> = {
  external: 'groupExternal',
  builtin: 'groupBuiltin',
  experimental: 'groupExperimental',
}
const GROUP_HINT_KEYS: Record<Category, string> = {
  external: 'groupExternalHint',
  builtin: 'groupBuiltinHint',
  experimental: 'groupExperimentalHint',
}

function GroupTable(props: {
  rows: UpdaterRow[]
  busy: boolean
  engine: Engine | null
  t: (key: string) => string
  menuFor: string | null
  confirmRemove: string | null
  onToggleMenu: (name: string) => void
  onRequestRemove: (name: string) => void
  onConfirmRemove: () => void
  onCancelRemove: () => void
}) {
  const { rows, busy, engine, t } = props
  return (
    <div className="mt-2 overflow-x-auto rounded-[10px] border border-dsw-border bg-dsw-surface">
      <div className={`${tableGrid} border-b border-dsw-border px-3 pb-2 text-[11px] text-dsw-muted`}>
        <span>{t('columnPlugin')}</span>
        <span>{t('columnCurrent')}</span>
        <span>{t('columnLatest')}</span>
        <span>{t('columnStatus')}</span>
        <span className="text-right">{t('columnAction')}</span>
      </div>
      {rows.map((row) => (
        <BundleRow
          key={row.name}
          row={row}
          busy={busy}
          engine={engine}
          t={t}
          menuOpen={props.menuFor === row.name}
          onToggleMenu={() => props.onToggleMenu(row.name)}
          confirmPending={props.confirmRemove === row.name}
          onRequestRemove={() => props.onRequestRemove(row.name)}
          onConfirmRemove={props.onConfirmRemove}
          onCancelRemove={props.onCancelRemove}
        />
      ))}
    </div>
  )
}

export function UpdaterPage({ ctx, engine }: UpdaterPageProps) {
  const t = usePageTranslator(ctx)
  const state = useUpdaterState()
  const [menuFor, setMenuFor] = React.useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null)
  const language = currentLanguage(ctx)

  React.useEffect(() => {
    if (!menuFor) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuFor(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuFor])

  const rows = state.rows
  const updatable = rows.filter((row) => row.status === 'update')
  const busy = Boolean(state.busy)
  const checking = state.phase === 'checking'
  const groups = GROUP_ORDER.map((category) => ({
    category,
    rows: rows.filter((row) => row.category === category),
  })).filter((group) => group.rows.length)

  const progress = state.progress
  const progressLine =
    busy || progress ? (
      <div className="mt-3 text-xs text-dsw-muted">
        {progress
          ? `${t('upgrading')} ${Math.min(progress.done + 1, progress.total)}/${progress.total}${
              progress.name ? ' · ' + progress.name : ''
            }`
          : t('upgradingAll')}
      </div>
    ) : state.message ? (
      <div className={`mt-3 text-xs ${state.message === 'partial' ? 'text-dsw-error' : 'text-dsw-success'}`}>
        {t(state.message === 'partial' ? 'partialMessage' : 'doneMessage')}
      </div>
    ) : null

  let body: React.ReactNode = null
  if (!state.serviceReady && state.phase !== 'error') {
    body = <div className="py-8 text-[13px] text-dsw-muted">{t('connecting')}</div>
  } else if (state.phase === 'error') {
    body = (
      <div className="py-6 text-[13px] text-dsw-error">
        <div>{state.error === 'serviceUnavailable' ? t('serviceUnavailable') : state.error || t('readFailed')}</div>
        <div className="mt-3">
          <ActionButton variant="secondary" onClick={() => engine?.boot()}>
            {t('retry')}
          </ActionButton>
        </div>
      </div>
    )
  } else if (!rows.length) {
    body = <div className="py-8 text-[13px] text-dsw-muted">{checking ? t('checking') : t('empty')}</div>
  } else {
    body = (
      <div className="mt-1.5">
        {groups.map((group) => (
          <section key={group.category} className="mt-[18px]">
            <div className="flex flex-wrap items-center gap-2.5 px-0.5 pb-2">
              <span className="text-[13px] font-semibold text-dsw-text">{t(GROUP_TITLE_KEYS[group.category])}</span>
              <span className="text-[11px] text-dsw-muted">· {group.rows.length}</span>
              <span className="text-[11px] text-dsw-muted">{t(GROUP_HINT_KEYS[group.category])}</span>
              {group.category === 'external' ? (
                <div className="ml-auto flex gap-2">
                  <ActionButton
                    variant="primary"
                    disabled={busy || !updatable.length}
                    onClick={() => engine?.upgradeAll()}
                  >
                    {t('upgradeAll')}
                  </ActionButton>
                </div>
              ) : null}
            </div>
            <GroupTable
              rows={group.rows}
              busy={busy}
              engine={engine}
              t={t}
              menuFor={menuFor}
              confirmRemove={confirmRemove}
              onToggleMenu={(name) => setMenuFor((current) => (current === name ? null : name))}
              onRequestRemove={(name) => {
                setMenuFor(null)
                setConfirmRemove(name)
              }}
              onConfirmRemove={() => setConfirmRemove(null)}
              onCancelRemove={() => setConfirmRemove(null)}
            />
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-[1040px] px-6 pb-8 pt-5 text-dsw-text">
      <div className="mb-[18px] flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[18px] font-semibold leading-[26px] text-dsw-text">{t('title')}</div>
          <div className="mt-1 text-xs leading-[18px] text-dsw-muted">{t('subtitle')}</div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-dsw-muted">
            <span>
              {rows.length} {t('pluginsWord')} · {updatable.length} {t('updatesWord')}
            </span>
            <span>
              {t('lastChecked')}: {state.checkedAt ? formatTime(state.checkedAt, language) : t('never')}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <ActionButton variant="secondary" disabled={busy || checking} onClick={() => engine?.checkAll()}>
            {t('checkNow')}
          </ActionButton>
        </div>
      </div>
      {progressLine}
      {body}
    </div>
  )
}
