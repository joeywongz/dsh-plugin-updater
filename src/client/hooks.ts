/** React bindings over the Zustand store and the locale service. */

import React from 'react'
import type { ClientContext } from './i18n'
import { actionDicts, currentLanguage, lookup, pageDicts } from './i18n'
import { getUpdaterState, updaterStore, type UpdaterState } from './store'

export function useUpdaterState(): UpdaterState {
  const [snapshot, setSnapshot] = React.useState<UpdaterState>(getUpdaterState)
  React.useEffect(
    () =>
      updaterStore.subscribe((state) => {
        setSnapshot(state)
      }),
    [],
  )
  return snapshot
}

function useLocaleTick(ctx: ClientContext): void {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    try {
      const dispose = ctx.locale.subscribe(() => setTick((value) => value + 1))
      return () => {
        try {
          dispose()
        } catch {
          /* ignore */
        }
      }
    } catch {
      return undefined
    }
  }, [ctx])
}

/** Page copy; re-renders when the interface language changes. */
export function usePageTranslator(ctx: ClientContext): (key: string) => string {
  useLocaleTick(ctx)
  return (key: string) => {
    try {
      return ctx.locale.bind('dshMyPluginUpdater')(key)
    } catch {
      return lookup(currentLanguage(ctx), key, pageDicts)
    }
  }
}

/** Session-menu copy; re-renders when the interface language changes. */
export function useActionTranslator(ctx: ClientContext): (key: string) => string {
  useLocaleTick(ctx)
  return (key: string) => lookup(currentLanguage(ctx), key, actionDicts)
}
