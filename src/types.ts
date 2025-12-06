export type QuestionType = 'single' | 'multi' | 'ranking'

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

export interface SegmentDef {
  column: string  // e.g., "Audience Type"
  value: string   // e.g., "CRM"
}

// Multi-filter comparison: each ComparisonSet is a group of filters with AND logic
// Multiple ComparisonSets are compared side-by-side
export interface ComparisonSet {
  id: string           // Unique identifier
  label: string        // Display label (e.g., "Men + CRM")
  filters: SegmentDef[] // Filters combined with AND logic
  color?: string       // Optional custom color for this set
}

export interface Selections {
  segmentColumn?: string
  groups: string[]
  segments?: SegmentDef[]  // New: supports multiple columns
  comparisonMode?: boolean // true = Compare mode (segments shown side-by-side), false = Filter mode (segments treated as one group)
  multiFilterCompareMode?: boolean // true = Multi-filter comparison mode (compare sets of combined filters)
  comparisonSets?: ComparisonSet[] // Sets of filters to compare (each set has AND logic, sets compared side-by-side)
  groupLabels?: Record<string, string> // Map of group key to custom label
  segmentColumnLabels?: Record<string, string> // Map of segment column name to custom label
  productColumn?: string
  productGroups: string[]
  productOrder?: string[] // Custom order for products in heatmaps (drag-and-drop from sidebar)
  question?: string // qid
  sortOrder: SortOrder
  statSigFilter: StatSigFilter
  showAsterisks?: boolean
  showContainer?: boolean
  showSegment?: boolean
  showQuestionType?: boolean
  chartColors?: string[]
  optionLabels?: Record<string, Record<string, string>> // Map of qid -> option -> custom label
  questionLabels?: Record<string, string> // Map of qid -> custom question title
  questionSegments?: string[] // Array of qids selected for segmentation
}
