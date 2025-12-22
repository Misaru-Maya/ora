import { create } from 'zustand'
import type { ParsedCSV, Selections } from './types'

// PERF: Disabled debug logging - was causing 10-20% overhead
const isDev = false // process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}

interface ORAState {
  dataset: ParsedCSV | null
  setDataset: (d: ParsedCSV | null) => void
  selections: Selections
  setSelections: (s: Partial<Selections>) => void
  // Global loading state for CSV upload and heavy operations
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
}

const initialSelections: Selections = {
  groups: [],
  segments: [],
  comparisonMode: false, // Default to Filter mode
  multiFilterCompareMode: false, // Default to regular comparison mode
  comparisonSets: [], // Empty comparison sets by default
  groupLabels: {},
  segmentColumnLabels: {},
  sortOrder: 'descending',
  productGroups: [],
  productOrder: [],
  // Product Bucketing defaults
  productBuckets: [], // Empty buckets by default
  productBucketMode: false, // Default to individual products view
  activeBucketIds: [], // All buckets active by default (empty = all)
  bucketLabels: {},
  statSigFilter: 'all',
  showAsterisks: false, // Default to false - asterisks off in filter mode, on in comparison mode
  showContainer: true, // Default to true - show container
  showSegment: true, // Default to true - show segment
  showQuestionType: true, // Default to true - show question type
  chartColors: ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7'],
  optionLabels: {},
  questionLabels: {},
  questionSegments: []
}

export const useORAStore = create<ORAState>((set) => ({
  dataset: null,
  setDataset: (d) => {
    devLog('Setting dataset in store:', d)
    // Reset selections when setting a new dataset to clear previous test data
    set({ dataset: d, selections: { ...initialSelections } })
  },
  selections: initialSelections,
  setSelections: (s) => set((state) => ({
    selections: { ...state.selections, ...s }
  })),
  // Global loading state
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading })
}))
