export type QuestionType = 'single' | 'multi'

export interface QuestionOptionColumn {
  header: string // column name for multi; synthetic key for single option
  optionLabel: string
  alternateHeaders?: string[] // for multi-select with case-insensitive duplicates
}

export interface QuestionDef {
  qid: string
  label: string
  type: QuestionType
  // For 'multi', columns is the set of one-hot columns (each an option).
  // For 'single', columns is the set of distinct option values synthesized from the single text column.
  columns: QuestionOptionColumn[]
  // For 'single' questions, the source column header holding the text value
  singleSourceColumn?: string
  // For 'multi' questions, optional text summary column with pipe-separated values
  textSummaryColumn?: string
  // Whether to use total base (all respondents) instead of only those who answered
  useTotalBase?: boolean
  // Heuristic: respondent-level vs row-level
  level: 'respondent' | 'row'
  // Whether this is a likert scale question
  isLikert?: boolean
}

export interface DatasetSummary {
  fileName: string
  rowCount: number
  uniqueRespondents: number
  columns: string[]
  isProductTest: boolean
  questionsDetected: number
}

export interface ParsedCSV {
  rows: Record<string, any>[]
  questions: QuestionDef[]
  segmentColumns: string[]
  summary: DatasetSummary
}

export type SortOrder = 'default' | 'descending' | 'ascending'

export type StatSigFilter = 'all' | 'statSigOnly'

export interface Selections {
  segmentColumn?: string
  groups: string[]
  productColumn?: string
  productGroups: string[]
  question?: string // qid
  sortOrder: SortOrder
  statSigFilter: StatSigFilter
  hideAsterisks?: boolean
  chartColors?: string[]
}
