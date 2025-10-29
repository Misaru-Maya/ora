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
  selections: {
    groups: [],
    segments: [],
    groupLabels: {},
    sortOrder: 'descending',
    productGroups: [],
    statSigFilter: 'all',
    hideAsterisks: false,
    chartColors: ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7'],
    optionLabels: {}
  },
  setSelections: (s) => set((state) => ({
    selections: { ...state.selections, ...s }
  }))
}))
