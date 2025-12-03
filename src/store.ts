import { create } from 'zustand'
import type { ParsedCSV, Selections } from './types'

interface ORAState {
  dataset: ParsedCSV | null
  setDataset: (d: ParsedCSV | null) => void
  selections: Selections
  setSelections: (s: Partial<Selections>) => void
}

const initialSelections: Selections = {
  groups: [],
  segments: [],
  comparisonMode: false, // Default to Filter mode
  groupLabels: {},
  segmentColumnLabels: {},
  sortOrder: 'descending',
  productGroups: [],
  productOrder: [],
  statSigFilter: 'all',
  hideAsterisks: true, // Default to true in filter mode
  chartColors: ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7'],
  optionLabels: {},
  questionLabels: {},
  questionSegments: []
}

export const useORAStore = create<ORAState>((set) => ({
  dataset: null,
  setDataset: (d) => {
    console.log('Setting dataset in store:', d)
    // Reset selections when setting a new dataset to clear previous test data
    set({ dataset: d, selections: { ...initialSelections } })
  },
  selections: initialSelections,
  setSelections: (s) => set((state) => ({
    selections: { ...state.selections, ...s }
  }))
}))
