import { create } from 'zustand'
import { ParsedCSV, Selections } from './types'

interface ORAState {
  dataset: ParsedCSV | null
  setDataset: (d: ParsedCSV | null) => void
  selections: Selections
  setSelections: (s: Partial<Selections>) => void
}

export const useORAStore = create<ORAState>((set) => ({
  dataset: null,
  setDataset: (d) => {
    console.log('Setting dataset in store:', d)
    set({ dataset: d })
  },
  selections: { groups: [], sortOrder: 'descending', productGroups: [], statSigFilter: 'all', hideAsterisks: false },
  setSelections: (s) => set((state) => ({
    selections: { ...state.selections, ...s }
  }))
}))
