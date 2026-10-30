/** Small presentational primitives shared by the page and the session menu. */

import React from 'react'
import type { UpdaterRow } from './types'

const buttonBase =
  'inline-flex items-center rounded-md px-3 py-1 text-xs leading-[18px] whitespace-nowrap transition-colors'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerSolid'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'border border-transparent bg-dsw-primary font-semibold text-white hover:opacity-90',
  secondary: 'border border-dsw-strong bg-dsw-surface text-dsw-text hover:bg-dsw-overlay',
  danger: 'border border-dsw-strong bg-dsw-surface text-dsw-error hover:bg-dsw-overlay',
  dangerSolid: 'border border-transparent bg-dsw-error font-semibold text-white hover:opacity-90',
}

export function buttonClass(variant: ButtonVariant, disabled: boolean): string {
  return [buttonBase, buttonVariants[variant], disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'].join(' ')
}

interface ActionButtonProps {
  variant: ButtonVariant
  disabled?: boolean
  onClick?: () => void
  title?: string
  children?: React.ReactNode
}

export function ActionButton({ variant, disabled = false, onClick, title, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      className={buttonClass(variant, disabled)}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

interface PluginIconProps {
  name: string
  icon: string | null
}

export function PluginIcon({ name, icon }: PluginIconProps) {
  if (icon) {
    return <img src={icon} alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 rounded-[5px] object-contain" />
  }
  const letter = (name || '?').replace(/^@/, '').slice(0, 1).toUpperCase()
  return (
    <span
      aria-hidden
      className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border border-dsw-border bg-dsw-surface text-[11px] font-semibold text-dsw-muted"
    >
      {letter}
    </span>
  )
}

interface SwitchProps {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

/** A single on/off switch; the track and knob are pure CSS, the button handles a11y. */
export function Switch({ label, checked, disabled, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'inline-flex appearance-none items-center gap-1.5 whitespace-nowrap border-0 bg-transparent p-0',
        'text-[11px] leading-[18px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dsw-primary',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'relative box-border inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-transparent bg-dsw-primary' : 'border-dsw-strong bg-dsw-overlay',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none absolute left-[2px] top-[1px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[12px]' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
      <span className={checked ? 'text-dsw-text' : 'text-dsw-muted'}>{label}</span>
    </button>
  )
}

interface OfficialLinkProps {
  url: string
  label: string
}

/** A compact "official address" badge that opens the plugin's page in a new tab. */
export function OfficialLink({ url, label }: OfficialLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      aria-label={label + ': ' + url}
      className={[
        'inline-flex shrink-0 items-center gap-1 rounded border border-dsw-border bg-dsw-surface px-1.5 py-0.5',
        'text-[10px] font-normal leading-[14px] text-dsw-primary no-underline hover:bg-dsw-overlay hover:underline',
      ].join(' ')}
    >
      {label}
      <span aria-hidden>↗</span>
    </a>
  )
}

export function statusColorClass(row: UpdaterRow): string {
  if (row.status === 'update') return 'text-dsw-warn'
  if (row.status === 'latest') return 'text-dsw-success'
  if (row.status === 'error') return 'text-dsw-error'
  if (row.status === 'self' || row.status === 'skipped' || row.status === 'shipped') return 'text-dsw-idle'
  return 'text-dsw-muted'
}

export function statusLabel(t: (key: string) => string, row: UpdaterRow): string {
  switch (row.status) {
    case 'update':
      return t('statusUpdate')
    case 'latest':
      return t('statusLatest')
    case 'unknown':
      return t('statusUnknown')
    case 'self':
      return t('statusSelf')
    case 'skipped':
      return t('statusSkipped')
    case 'shipped':
      return t('statusShipped')
    case 'busy':
      return t('statusBusy')
    case 'error':
      return t('statusError')
    default:
      return t('statusChecking')
  }
}

export const tableGrid = 'grid grid-cols-[minmax(180px,1fr)_84px_100px_96px_300px] items-center gap-3'
