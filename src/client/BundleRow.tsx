/** One bundle row: identity, versions, status, and the row's actions. */

import React from 'react'
import { SELF, type Engine } from './engine'
import { ActionButton, OfficialLink, PluginIcon, Switch, statusColorClass, statusLabel, tableGrid } from './components'
import type { UpdaterRow, VersionInfo } from './types'
import { compareVersions, isPrerelease } from './utils'

export interface BundleRowProps {
  row: UpdaterRow
  busy: boolean
  engine: Engine | null
  t: (key: string) => string
  menuOpen: boolean
  onToggleMenu: () => void
  confirmPending: boolean
  onRequestRemove: () => void
  onConfirmRemove: () => void
  onCancelRemove: () => void
}

export function BundleRow(props: BundleRowProps) {
  const { row, busy, engine, t, menuOpen, confirmPending } = props
  const canUpgrade = row.status === 'update' && Boolean(row.latest)
  const canToggle = !row.locked && row.name !== SELF
  const canRemove = row.removable && row.name !== SELF

  const versions = (row.versions || [])
    .filter((item) => !item.deprecated)
    .filter((item) => !row.current || compareVersions(item.version, row.current) > 0)
    .filter((item) => item.compatible !== false)
  const menuItems: VersionInfo[] = versions.length
    ? versions
    : row.latest
      ? [{ version: row.latest, enginesDsh: undefined, compatible: undefined }]
      : []

  const hint = row.busy
    ? t('statusBusy')
    : row.status === 'self'
      ? t('selfHint')
      : row.locked
        ? t('lockedHint')
        : row.status === 'skipped'
          ? t('skippedHint')
          : row.status === 'unknown'
            ? t('unreachable')
            : ''

  const action = confirmPending ? (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-[11px] text-dsw-error">{t('confirmRemove')}</span>
      <ActionButton
        variant="dangerSolid"
        disabled={busy}
        onClick={() => {
          props.onCancelRemove()
          engine?.removeOne(row.name)
        }}
      >
        {t('confirmRemoveAction')}
      </ActionButton>
      <ActionButton variant="secondary" disabled={busy} onClick={props.onCancelRemove}>
        {t('cancel')}
      </ActionButton>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {canToggle ? (
        <div className="mr-0.5">
          <Switch
            label={t('toggleOn')}
            checked={row.enabled === true}
            disabled={busy}
            onChange={(checked) => engine?.setEnabled(row.name, checked)}
          />
        </div>
      ) : null}
      {canUpgrade ? (
        <ActionButton
          variant="primary"
          disabled={busy}
          onClick={props.onToggleMenu}
          title={row.latest ? `${t('upgrade')} → ${row.latest}` : t('upgrade')}
        >
          {t('upgrade')} ▾
        </ActionButton>
      ) : null}
      {canRemove ? (
        <ActionButton variant="danger" disabled={busy} onClick={props.onRequestRemove} title={t('uninstall')}>
          {t('uninstall')}
        </ActionButton>
      ) : null}
      {!canToggle && !canUpgrade && !canRemove ? (
        <span className="text-right text-[11px] text-dsw-muted">{hint}</span>
      ) : null}
    </div>
  )

  return (
    <div className="border-b border-dsw-border last:border-b-0" data-dsh-plugin-row={row.name}>
      <div className={`${tableGrid} px-3 py-2.5`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <PluginIcon name={row.name} icon={row.icon} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-medium text-dsw-text" title={row.title || row.name}>
                {row.title || row.name}
              </span>
              {row.officialUrl ? <OfficialLink url={row.officialUrl} label={t('officialLink')} /> : null}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-dsw-muted" title={row.name}>
              {row.name}
            </div>
            {row.description ? (
              <div className="mt-0.5 truncate text-[11px] text-dsw-muted" title={row.description}>
                {row.description}
              </div>
            ) : null}
          </div>
        </div>

        <div className="font-mono text-xs leading-5 text-dsw-text">{row.current || '—'}</div>

        <div className="flex items-center gap-1.5 leading-5">
          <span className={`font-mono text-xs ${canUpgrade ? 'text-dsw-warn' : 'text-dsw-text'}`}>
            {row.latest || '—'}
          </span>
          {row.status === 'checking' ? <span className="text-[10px] text-dsw-muted">…</span> : null}
        </div>

        <span className={`text-[11px] ${statusColorClass(row)}`}>{statusLabel(t, row)}</span>

        {action}
      </div>

      {menuOpen ? (
        <div className="mx-3 mb-3 rounded-lg border border-dsw-strong bg-dsw-overlay px-2.5 py-2">
          <div className="px-0.5 pb-1.5 text-[11px] text-dsw-muted">{t('chooseVersion')}</div>
          {menuItems.length ? (
            <div className="flex flex-wrap gap-1.5">
              {menuItems.slice(0, 40).map((item) => (
                <button
                  key={item.version}
                  type="button"
                  disabled={busy}
                  className={[
                    'inline-flex cursor-pointer items-center rounded-md border border-dsw-border bg-dsw-surface px-2 py-1 font-mono text-xs text-dsw-text hover:bg-dsw-overlay',
                    busy ? 'cursor-not-allowed opacity-55' : '',
                  ].join(' ')}
                  title={item.enginesDsh ? `engines.dsh ${item.enginesDsh}` : undefined}
                  onClick={() => {
                    props.onToggleMenu()
                    engine?.upgradeOne(row.name, item.version)
                  }}
                >
                  {item.version}
                  {item.version === row.latest ? (
                    <span className="ml-1.5 font-sans text-[10px] text-dsw-primary">{t('latestTag')}</span>
                  ) : null}
                  {isPrerelease(item.version) ? (
                    <span className="ml-1.5 font-sans text-[10px] text-dsw-muted">{t('prerelease')}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-dsw-muted">{t('noVersions')}</div>
          )}
        </div>
      ) : null}

      {row.error ? (
        <div className="mx-3 mb-2.5 ml-11 whitespace-pre-wrap break-words border-l-2 border-dsw-error px-2 py-1.5 text-[11px] text-dsw-error">
          {row.error}
        </div>
      ) : null}
    </div>
  )
}
