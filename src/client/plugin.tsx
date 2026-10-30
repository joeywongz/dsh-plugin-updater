/** The client plugin: locale dictionaries, styles, slots, and the Remote wiring. */

import React from 'react'
import { UpdaterPage } from './App'
import { SessionMenu } from './SessionMenu'
import { createEngine, type Engine } from './engine'
import type { ClientContext } from './i18n'
import { actionDicts, currentLanguage, lookup, NS, NS_ACTIONS, pageDicts } from './i18n'
import { remoteNamespace, type CommandsRemote, type PluginManagerRemote, type PluginMarketRemote } from './services'
import { patchUpdaterState } from './store'
import styles from './styles.css?inline'

export interface ClientPlugin {
  inject: string[]
  apply(ctx: ClientContext): void
}

export default function createPlugin(): ClientPlugin {
  return {
    inject: ['slots', 'locale'],
    apply(ctx: ClientContext) {
      let engine: Engine | null = null
      const services: { market: PluginMarketRemote | null; commands: CommandsRemote | null } = {
        market: null,
        commands: null,
      }

      // Compiled Tailwind stylesheet, injected once for this plugin's lifetime.
      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        const element = document.createElement('style')
        element.dataset.dshPlugin = 'dsh-my-plugin-updater'
        element.textContent = styles
        document.head.appendChild(element)
        return () => {
          element.remove()
        }
      }, 'dsh-my-plugin-updater: styles')

      ctx.effect(() => {
        const disposers = [
          ctx.locale.register(NS, 'en', pageDicts.en),
          ctx.locale.register(NS, 'zh', pageDicts.zh),
          ctx.locale.register(NS_ACTIONS, 'en', actionDicts.en),
          ctx.locale.register(NS_ACTIONS, 'zh', actionDicts.zh),
        ]
        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              /* ignore */
            }
          }
        }
      }, 'dsh-my-plugin-updater: dictionaries')

      const startManager = (manager: PluginManagerRemote) => {
        if (engine) return
        engine = createEngine({ ctx, manager, services })
        void engine.boot()
      }

      try {
        ctx.inject(['remote', 'remote.pluginManager'], (scoped) => {
          const manager = remoteNamespace(scoped, 'pluginManager')
          if (manager) startManager(manager as PluginManagerRemote)
        })
      } catch {
        /* fall through to the poll below */
      }
      try {
        ctx.inject(['remote', 'remote.pluginMarket'], (scoped) => {
          const market = remoteNamespace(scoped, 'pluginMarket')
          if (market) services.market = market as PluginMarketRemote
        })
      } catch {
        /* the market namespace is optional */
      }
      try {
        ctx.inject(['remote', 'remote.commands'], (scoped) => {
          const commands = remoteNamespace(scoped, 'commands')
          if (commands) services.commands = commands as CommandsRemote
        })
      } catch {
        /* the commands namespace is optional */
      }
      ctx.effect(() => {
        const timer = setTimeout(() => {
          if (engine) return
          const manager = remoteNamespace(ctx, 'pluginManager')
          if (manager) startManager(manager as PluginManagerRemote)
          else patchUpdaterState({ phase: 'error', error: 'serviceUnavailable' })
        }, 8000)
        return () => clearTimeout(timer)
      })

      try {
        ctx.slots.inject('plugins.tab', () =>
          ctx.slots.register(
            {
              name: 'plugins.tab',
              id: 'updater',
              order: 10,
              label: () => lookup(currentLanguage(ctx), 'tab', pageDicts),
            },
            (slotProps) => React.createElement(UpdaterPage, { ...slotProps, ctx, engine }),
          ),
        )
      } catch {
        /* the Plugins page is unavailable in this composition */
      }

      try {
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'updater-refresh-title',
              order: 425,
              locale: NS_ACTIONS,
              inject: () => ({
                refreshTitle: (sessionId: string) => {
                  if (engine) void engine.refreshTitle(sessionId)
                },
              }),
            },
            (slotProps) => React.createElement(SessionMenu, slotProps),
          ),
        )
      } catch {
        /* the session row menu is unavailable in this composition */
      }
    },
  }
}
