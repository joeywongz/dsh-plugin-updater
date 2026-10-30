/** The plugin's single Zustand store (vanilla core, React binding in hooks.ts). */

import { createStore } from 'zustand/vanilla'
import type { UpdaterRow } from './types'

export type Phase = 'idle' | 'checking' | 'ready' | 'error'

export interface Progress {
  done: number
  total: number
  name: string
}

export interface UpdaterState {
  serviceReady: boolean
  phase: Phase
  rows: UpdaterRow[]
  checkedAt: number | null
  error: string | null
  busy: boolean
  progress: Progress | null
  message: 'done' | 'partial' | null
}

const initialState: UpdaterState = {
  serviceReady: false,
  phase: 'idle',
  rows: [],
  checkedAt: null,
  error: null,
  busy: false,
  progress: null,
  message: null,
}

export const updaterStore = createStore<UpdaterState>(() => ({ ...initialState }))

export function getUpdaterState(): UpdaterState {
  return updaterStore.getState()
}

export function patchUpdaterState(patch: Partial<UpdaterState>): void {
  updaterStore.setState(patch)
}

export function patchRow(name: string, patch: Partial<UpdaterRow>): void {
  const state = updaterStore.getState()
  updaterStore.setState({
    rows: state.rows.map((row) => (row.name === name ? { ...row, ...patch } : row)),
  })
}

export function findRow(name: string): UpdaterRow | undefined {
  return updaterStore.getState().rows.find((row) => row.name === name)
}
