/** One entry of a Session's "..." menu: regenerate that Session's title. */

import React from 'react'

export interface SessionMenuProps {
  sessionId?: string
  displayTitle?: string
  useMenuOpenState?: () => [boolean, (open: boolean) => void]
  refreshTitle?: (sessionId: string) => void
  t?: (key: string) => string
  [key: string]: unknown
}

export function SessionMenu(props: SessionMenuProps) {
  const t = typeof props.t === 'function' ? props.t : (key: string) => key
  let setMenuOpen: ((open: boolean) => void) | null = null
  try {
    if (typeof props.useMenuOpenState === 'function') {
      const state = props.useMenuOpenState()
      if (Array.isArray(state) && typeof state[1] === 'function') setMenuOpen = state[1]
    }
  } catch {
    /* the menu's open state belongs to the row */
  }

  const onSelect = () => {
    try {
      if (setMenuOpen) setMenuOpen(false)
    } catch {
      /* ignore */
    }
    if (typeof props.refreshTitle === 'function' && typeof props.sessionId === 'string') {
      props.refreshTitle(props.sessionId)
    }
  }

  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2.5 py-1.5 text-left text-xs leading-[18px] text-dsw-text hover:bg-dsw-surface"
      title={t('refreshTitleHint')}
      onClick={onSelect}
    >
      {t('refreshTitle')}
    </button>
  )
}
