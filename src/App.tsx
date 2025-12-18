import React, { useEffect, useMemo, useState, useRef, useTransition, useCallback } from 'react'
import { CSVUpload, type CSVUploadHandle } from './components/CSVUpload'
import { useORAStore } from './store'
import type { QuestionDef, ComparisonSet, SegmentDef, ProductBucket } from './types'
import { buildSeries, buildSeriesFromComparisonSets, buildSeriesFromProductBuckets } from './dataCalculations'
import { ChartGallery } from './components/ChartGallery'
import { RegressionAnalysisPanel } from './components/RegressionAnalysisPanel'
import { stripQuotes, isExcludedValue } from './utils'

// Performance: Disable console logs in production
const isDev = process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}

// Stable references for default props to prevent unnecessary re-renders
const EMPTY_OBJECT: Record<string, string> = {}
const EMPTY_NESTED_OBJECT: Record<string, Record<string, string>> = {}
const EMPTY_ARRAY: string[] = []
const DEFAULT_CHART_COLORS = ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']

function autoDefaultGroups(rows: any[], segCol?: string, maxDefaults = 2): string[] {
  if (!segCol) return []
  if (segCol === 'Overall') return ['Overall']
  const vals = Array.from(new Set(rows.map(r => stripQuotes(String(r[segCol])))))
    .filter(v => v && v !== 'null' && v !== 'undefined' && !isExcludedValue(v))

  // For Gender, exclude "Prefer not to say" and "Other" from defaults
  const filteredVals = segCol === 'Gender'
    ? vals.filter(v => v.toLowerCase() !== 'prefer not to say' && v.toLowerCase() !== 'other')
    : vals

  const orderedVals = sortSegmentValues(filteredVals, segCol)

  if (!orderedVals.length) return []

  const priorityPairs = [['Panel', 'CRM'], ['CRM', 'Panel']]
  for (const [first, second] of priorityPairs) {
    if (orderedVals.includes(first) && orderedVals.includes(second)) {
      return [first, second, ...orderedVals.filter(v => v !== first && v !== second)].slice(0, maxDefaults)
    }
  }

  return orderedVals.slice(0, maxDefaults)
}

function sortSegmentValues(values: string[], column?: string) {
  if (!column) return values

  // Sort function that always puts N/A at the bottom
  const sortWithNALast = (a: string, b: string, compareFunc?: (a: string, b: string) => number) => {
    const aIsNA = a.toLowerCase() === 'n/a'
    const bIsNA = b.toLowerCase() === 'n/a'

    // If both are N/A, they're equal
    if (aIsNA && bIsNA) return 0
    // If only a is N/A, it goes to the end (return positive)
    if (aIsNA) return 1
    // If only b is N/A, it goes to the end (return negative)
    if (bIsNA) return -1

    // Neither is N/A, use the provided compare function or alphabetical
    if (compareFunc) return compareFunc(a, b)
    return a.localeCompare(b)
  }

  if (column.toLowerCase() === 'age') {
    const parseAgeToken = (token: string) => {
      // Handle "under" prefix
      if (/under/i.test(token)) return -1

      // Handle "<" prefix (e.g., "<25") - should sort before the number
      if (/^<\s*(\d+)/.test(token)) {
        const match = token.match(/^<\s*(\d+)/)
        if (match) return parseInt(match[1], 10) - 0.5 // Subtract 0.5 to sort before the number
      }

      // Handle ">" or ">=" prefix
      if (/^>=?\s*(\d+)/.test(token)) {
        const match = token.match(/^>=?\s*(\d+)/)
        if (match) return parseInt(match[1], 10) + 1000 // Add large number to sort at end
      }

      // Handle "+" suffix (e.g., "65+")
      if (/(\d+)\s*\+/.test(token)) {
        const plusMatch = token.match(/(\d+)\s*\+/)
        if (plusMatch) return parseInt(plusMatch[1], 10) + 1000
      }

      // Handle regular numbers (including ranges like "25-34")
      const match = token.match(/(\d+)/)
      if (match) return parseInt(match[1], 10)

      return Number.MAX_SAFE_INTEGER
    }
    return [...values].sort((a, b) => sortWithNALast(a, b, (x, y) => parseAgeToken(x) - parseAgeToken(y)))
  }

  // For non-age columns, just sort alphabetically with N/A at the end
  return [...values].sort((a, b) => sortWithNALast(a, b))
}

// Generate the same key format as buildSeries in dataCalculations.ts
function getGroupKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

function cleanFileName(fileName: string): string {
  // Remove "All_data_-_" prefix and "-[timestamp].csv" pattern at the end of file names
  return fileName
    .replace(/^All_data_-_/i, '')
    .replace(/-\d+\.csv$/, '.csv')
}

function normalizeProductValue(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value).trim()
  const unquoted = str.replace(/^"|"$/g, '')
  return unquoted || 'Unspecified'
}

function autoDefaultProducts(rows: any[], column: string): string[] {
  const values = Array.from(new Set(rows.map(row => normalizeProductValue(row[column]))))
    .filter(v => v && v !== 'null' && v !== 'undefined')

  return values
}

// Filter for segmentation dropdown: exclude ranking questions only
function shouldIncludeInSegmentation(question: QuestionDef, _rows: any[]): boolean {
  // Exclude ranking questions
  if (question.type === 'ranking') {
    return false
  }

  // Include Likert/sentiment questions
  return true
}

// Filter out zipcode questions, include all other question types including text
function shouldIncludeQuestion(question: QuestionDef): boolean {
  const labelLower = question.label.toLowerCase()

  // Filter out zipcode questions
  if (labelLower.includes('zip') || labelLower.includes('postal')) {
    devLog(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): zipcode`)
    return false
  }

  // Include text questions for word cloud display
  if (question.type === 'text') {
    devLog(`[FILTER] ✅ Including ${question.qid} (${question.type}): text question for word cloud`)
    return true
  }

  // Always include multi, single, scale, and ranking questions even if their labels contain tokens
  const labelHasTypeToken = ['(multi)', '(single)', '(scale)', '(ranking)'].some(token => labelLower.includes(token))
  if (labelHasTypeToken) {
    devLog(`[FILTER] ✅ Including ${question.qid} (${question.type}): type token in label`)
    return true
  }

  // For non-text questions, check for text markers and exclude if found
  // (This handles edge cases where single/multi questions have text in labels)
  if (labelLower.includes('(text)')) {
    devLog(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): text marker in label but not text type`)
    return false
  }

  const columnHasTextToken = question.columns.some(col => col.header.toLowerCase().includes('(text)') || col.optionLabel.toLowerCase().includes('(text)'))
  if (columnHasTextToken) {
    devLog(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): text in column`)
    return false
  }

  if (question.singleSourceColumn) {
    const singleLower = question.singleSourceColumn.toLowerCase()
    if (singleLower.includes('(text)')) {
      devLog(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): text in source column`)
      return false
    }
    if (['(multi)', '(single)', '(scale)', '(ranking)'].some(token => singleLower.includes(token))) {
      devLog(`[FILTER] ✅ Including ${question.qid} (${question.type}): type token in source`)
      return true
    }
  }

  devLog(`[FILTER] ✅ Including ${question.qid} (${question.type}): passed all checks`)
  return true
}

export default function App() {
  const { dataset, selections, setSelections } = useORAStore()
  const [chartOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(250, Math.min(window.innerWidth * 0.20, 500)))
  const [isResizing, setIsResizing] = useState(false)
  const [editingSegment, setEditingSegment] = useState<string | null>(null)
  const [segmentInput, setSegmentInput] = useState('')
  const segmentInputRef = useRef<HTMLInputElement>(null)
  // Consumer question option editing state
  const [editingConsumerOption, setEditingConsumerOption] = useState<{ qid: string, option: string } | null>(null)
  const [consumerOptionInput, setConsumerOptionInput] = useState('')
  const consumerOptionInputRef = useRef<HTMLTextAreaElement>(null)
  const questionDropdownRef = useRef<HTMLDivElement>(null)
  const csvUploadRef = useRef<CSVUploadHandle>(null)
  const [expandedSegmentGroups, setExpandedSegmentGroups] = useState<Set<string>>(new Set())
  const [questionDropdownOpen, setQuestionDropdownOpen] = useState(false)
  const [questionSearchTerm, setQuestionSearchTerm] = useState('')
  const [expandedQuestionSegments, setExpandedQuestionSegments] = useState<Set<string>>(new Set())
  const [showRegressionPanel, setShowRegressionPanel] = useState(false)

  // Multi-filter comparison state
  const [editingComparisonSetId, setEditingComparisonSetId] = useState<string | null>(null)
  const [comparisonSetLabelInput, setComparisonSetLabelInput] = useState('')
  const [addingFiltersToSetId, setAddingFiltersToSetId] = useState<string | null>(null)
  const [consumerQuestionDropdownOpen, setConsumerQuestionDropdownOpen] = useState<Record<string, boolean>>({})
  const [consumerQuestionSearch, setConsumerQuestionSearch] = useState<Record<string, string>>({})
  const [selectedConsumerQuestions, setSelectedConsumerQuestions] = useState<Record<string, Set<string>>>({})

  // Product Bucketing state
  const [editingBucketId, setEditingBucketId] = useState<string | null>(null)
  const [bucketLabelInput, setBucketLabelInput] = useState('')
  const [addingProductsToBucketId, setAddingProductsToBucketId] = useState<string | null>(null)

  // Performance: Use transition for non-urgent updates to keep UI responsive
  const [isPending, startTransition] = useTransition()

  // PDF export state
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null)
  const chartGalleryRef = useRef<HTMLDivElement>(null)

  // Chip drag-and-drop state
  const [draggedChipInfo, setDraggedChipInfo] = useState<{ index: number, type: 'segment' | 'product' } | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ index: number, position: 'before' | 'after' } | null>(null)

  // Debug: log when regression panel state changes
  useEffect(() => {
    devLog('[REGRESSION] showRegressionPanel changed to:', showRegressionPanel, 'dataset exists:', !!dataset, 'questions count:', dataset?.questions?.length)
  }, [showRegressionPanel, dataset])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (questionDropdownRef.current && !questionDropdownRef.current.contains(event.target as Node)) {
        setQuestionDropdownOpen(false)
      }
    }

    if (questionDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [questionDropdownOpen])

  useEffect(() => {
    if (editingSegment && segmentInputRef.current) {
      segmentInputRef.current.focus()
      segmentInputRef.current.select()
    }
  }, [editingSegment])

  useEffect(() => {
    if (editingConsumerOption && consumerOptionInputRef.current) {
      consumerOptionInputRef.current.focus()
      consumerOptionInputRef.current.select()
    }
  }, [editingConsumerOption])

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['display'])
  )
  const [expandedDisplayGroups, setExpandedDisplayGroups] = useState<Set<string>>(
    new Set(['color'])
  )

  const rowsRaw = dataset?.rows || []

  const questions = useMemo(() => {
    if (!dataset) return []
    return [...dataset.questions]
      .filter(shouldIncludeQuestion)
  }, [dataset])

  // Questions available for segmentation dropdown
  const segmentationQuestions = useMemo(() => {
    if (!dataset) return []
    const filtered = [...dataset.questions]
      .filter(q => shouldIncludeInSegmentation(q, rowsRaw))
    devLog(`[SEGMENTATION] Total questions: ${dataset.questions.length}, Filtered for segmentation: ${filtered.length}`)
    filtered.forEach(q => {
      devLog(`[SEGMENTATION] ✅ ${q.qid}: ${q.label} (type: ${q.type}, isLikert: ${q.isLikert})`)
    })
    dataset.questions.filter(q => !shouldIncludeInSegmentation(q, rowsRaw)).forEach(q => {
      devLog(`[SEGMENTATION] ❌ Excluded ${q.qid}: ${q.label} (type: ${q.type}, isLikert: ${q.isLikert})`)
    })
    return filtered
  }, [dataset, rowsRaw])

  // Filter segmentation questions based on search term (search in both question label and answer options)
  // Using inline computation to ensure reactivity
  const filteredSegmentationQuestions = (() => {
    if (!questionSearchTerm.trim()) return segmentationQuestions
    const searchLower = questionSearchTerm.toLowerCase()
    return segmentationQuestions.filter(q => {
      // Search in question label
      if (q.label.toLowerCase().includes(searchLower)) return true
      // Search in answer options
      return q.columns.some(col => col.optionLabel.toLowerCase().includes(searchLower))
    })
  })()

  const filteredQuestions = questions
  const statSigFilter = selections.statSigFilter || 'all'
  const segmentColumns = dataset?.segmentColumns || []
  const summary = dataset?.summary
  const productColumn = useMemo(() => {
    if (!dataset) return undefined
    const columns = dataset.summary.columns
    return columns.find(c => c.toLowerCase() === 'product title')
  }, [dataset])

  useEffect(() => {
    if (!dataset) return

    if (!selections.segmentColumn && segmentColumns.length) {
      const defaultSeg = segmentColumns[0]
      const defaultGroups = autoDefaultGroups(rowsRaw, defaultSeg)
      setSelections({ segmentColumn: defaultSeg, groups: defaultGroups })
    }

    // Initialize segments with Overall by default if no segments are selected
    if (!selections.segments || selections.segments.length === 0) {
      setSelections({ segments: [{ column: 'Overall', value: 'Overall' }] })
    }

    if (productColumn && !selections.productColumn) {
      const defaultProducts = autoDefaultProducts(rowsRaw, productColumn)
      setSelections({ productColumn, productGroups: defaultProducts })
    }

    if (!productColumn && selections.productColumn) {
      setSelections({ productColumn: undefined, productGroups: [] })
    }

    if (!selections.question && questions.length) {
      setSelections({ question: questions[0].qid })
    }
  }, [
    dataset,
    productColumn,
    questions,
    rowsRaw,
    segmentColumns,
    selections.productColumn,
    selections.question,
    selections.segmentColumn,
    selections.segments,
    setSelections,
  ])

  useEffect(() => {
    if (chartOrientation === 'vertical') {
      setSelections({ sortOrder: 'descending' })
    }
  }, [chartOrientation, setSelections])

  const currentQuestion: QuestionDef | undefined = useMemo(
    () => questions.find(q => q.qid === selections.question),
    [questions, selections.question]
  )

  const productValues = useMemo(() => {
    if (!dataset || !selections.productColumn) return []

    const uniqueProducts = Array.from(new Set(rowsRaw.map(row => normalizeProductValue(row[selections.productColumn!]))))
      .filter(v => v && v !== 'null' && v !== 'undefined')

    // Find sentiment column (column with "(sentiment)" in header and "would you consider buying")
    const sentimentColumn = dataset.summary.columns.find(col =>
      col.toLowerCase().includes('(sentiment)') && col.toLowerCase().includes('would you consider buying')
    )

    if (!sentimentColumn) {
      // If no sentiment column, fall back to alphabetical sort
      return uniqueProducts.sort()
    }

    // Calculate sentiment score for each product
    const calculateProductScore = (productLabel: string): number => {
      const productRows = rowsRaw.filter(row => normalizeProductValue(row[selections.productColumn!]) === productLabel)

      if (productRows.length === 0) return 0

      let advocates = 0
      let detractors = 0
      let validResponses = 0

      productRows.forEach(row => {
        const rating = row[sentimentColumn]
        const numericRating = typeof rating === 'number' ? rating : Number(rating)

        if (Number.isFinite(numericRating)) {
          validResponses++
          if (numericRating >= 4) advocates++
          else if (numericRating <= 2) detractors++
        }
      })

      if (validResponses === 0) return 0

      const advocatePercent = (advocates / validResponses) * 100
      const detractorPercent = (detractors / validResponses) * 100
      return (advocatePercent - detractorPercent + 100) / 2
    }

    // Sort by sentiment score descending (highest score first)
    return uniqueProducts.sort((a, b) => {
      const scoreA = calculateProductScore(a)
      const scoreB = calculateProductScore(b)
      return scoreB - scoreA
    })
  }, [dataset, rowsRaw, selections.productColumn])

  const useAllProducts = !selections.productColumn || selections.productGroups.length === 0 || selections.productGroups.length === productValues.length

  const rows = useMemo(() => {
    devLog('[ROWS CALC] Starting rows calculation, rowsRaw.length:', rowsRaw.length)
    let filtered = rowsRaw

    // Apply product filter
    if (!useAllProducts) {
      filtered = filtered.filter(row =>
        selections.productGroups.includes(normalizeProductValue(row[selections.productColumn!]))
      )
      devLog('[ROWS CALC] After product filter:', filtered.length)
    }

    // Apply segment filters with AND logic between categories, OR logic within categories
    // Only apply filtering in Filter mode (comparisonMode = false)
    const isFilterMode = !(selections.comparisonMode ?? true)
    devLog('[ROWS CALC] isFilterMode:', isFilterMode, 'segments:', selections.segments)
    if (isFilterMode && selections.segments && selections.segments.length > 0) {
      // Filter out "Overall" segments as they don't apply filtering
      const actualSegments = selections.segments.filter(seg => seg.value !== 'Overall')

      if (actualSegments.length > 0) {
        devLog('[ROWS CALC] Applying segment filter, actualSegments:', actualSegments)
        // Group segments by column (category)
        const segmentsByColumn = actualSegments.reduce((acc, segment) => {
          if (!acc[segment.column]) {
            acc[segment.column] = []
          }
          acc[segment.column].push(segment.value)
          return acc
        }, {} as Record<string, string[]>)

        devLog('[ROWS CALC] segmentsByColumn:', segmentsByColumn)

        let matchedRows = 0
        let totalChecked = 0
        filtered = filtered.filter(row => {
          totalChecked++
          // Row must match at least one value from each category (AND between categories, OR within)
          const matches = Object.entries(segmentsByColumn).every(([column, values]) => {
            // Check if this column is a consumer question
            const consumerQuestion = dataset?.questions.find(q => q.qid === column)

            if (consumerQuestion) {
              if (totalChecked === 1) {
                devLog('[ROWS CALC] First row - Consumer question:', consumerQuestion.qid, 'type:', consumerQuestion.type, 'values:', values)
              }
              // Consumer question - use appropriate filtering logic
              if (consumerQuestion.type === 'single' && consumerQuestion.singleSourceColumn) {
                // Single-select: check if row's value matches any of the selected values
                const rowValue = stripQuotes(String(row[consumerQuestion.singleSourceColumn]))
                return values.some(value => stripQuotes(value) === rowValue)
              } else if (consumerQuestion.type === 'multi') {
                // Multi-select: check if any of the selected options' columns are truthy
                const result = values.some(value => {
                  const optionColumn = consumerQuestion.columns.find(col => col.optionLabel === value)
                  if (totalChecked === 1) {
                    devLog('[ROWS CALC] First row - Looking for option:', value, 'optionColumn:', optionColumn)
                  }
                  if (optionColumn) {
                    const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
                    if (totalChecked === 1) {
                      devLog('[ROWS CALC] First row - Headers to check:', headersToCheck)
                      headersToCheck.forEach(h => {
                        devLog('[ROWS CALC] First row - Header', h, '=', row[h])
                      })
                      // Show actual column names in row that might match
                      const rowKeys = Object.keys(row).filter(k => k.toLowerCase().includes('lululemon'))
                      devLog('[ROWS CALC] First row - Actual columns containing "lululemon":', rowKeys)
                      rowKeys.forEach(k => {
                        devLog('[ROWS CALC] First row - Actual column', k, '=', row[k])
                      })
                    }
                    return headersToCheck.some(header => {
                      const val = row[header]
                      return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
                    })
                  }
                  return false
                })
                return result
              }
              return false
            } else {
              // Regular segment column
              const rowValue = stripQuotes(String(row[column]))
              // Match if row value equals ANY of the selected values in this category (OR logic)
              return values.some(value => rowValue === stripQuotes(value))
            }
          })
          if (matches) matchedRows++
          return matches
        })
        devLog('[ROWS CALC] Matched', matchedRows, 'out of', totalChecked, 'rows')
        devLog('[ROWS CALC] After segment filter:', filtered.length)
      }
    }

    devLog('[ROWS CALC] Final filtered.length:', filtered.length)
    return filtered
  }, [useAllProducts, rowsRaw, selections.productGroups, selections.productColumn, selections.segments, selections.comparisonMode, dataset])

  const filteredDataset = useMemo(() => {
    if (!dataset) return null
    return { ...dataset, rows }
  }, [dataset, rows])

  const [segmentValueOrder, setSegmentValueOrder] = useState<Record<string, string[]>>({})
  const [draggedSegmentIndex, setDraggedSegmentIndex] = useState<number | null>(null)

  const segmentValues = useMemo(() => {
    if (!selections.segmentColumn) return []
    if (selections.segmentColumn === 'Overall') return ['Overall']
    const values = Array.from(new Set(rows.map(r => stripQuotes(String(r[selections.segmentColumn!])))))
      .filter(v => v && v !== 'null' && v !== 'undefined')
    const sorted = sortSegmentValues(values, selections.segmentColumn)

    // Apply custom order if exists for this segment column
    if (segmentValueOrder[selections.segmentColumn]) {
      const customOrder = segmentValueOrder[selections.segmentColumn]
      // Filter out 'Overall' from customOrder when applying to segmentValues (it's shown separately)
      const orderedValues = customOrder.filter(v => v !== 'Overall' && sorted.includes(v))
      const newValues = sorted.filter(v => !customOrder.includes(v))
      return [...orderedValues, ...newValues]
    }

    return sorted
  }, [rows, selections.segmentColumn, segmentValueOrder])

  // Compute ordered groups based on sidebar display order, not click order
  const orderedGroups = useMemo(() => {
    if (!selections.segmentColumn || !selections.groups.length) return []

    // Build full sidebar order: Overall (if not Overall segment) + segmentValues
    const sidebarOrder = selections.segmentColumn === 'Overall'
      ? ['Overall']
      : ['Overall', ...segmentValues]

    // Filter to only include selected groups, maintaining sidebar order
    return sidebarOrder.filter(value => selections.groups.includes(value))
  }, [selections.segmentColumn, selections.groups, segmentValues])

  // Memoize filtered respondent count for performance
  const filteredRespondentCount = useMemo(() => {
    if (!dataset || !rows) return 0

    const respIdCol = dataset.summary.columns.find(
      c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
    ) || dataset.summary.columns[0]

    // stripQuotes function matching dataCalculations.ts
    const stripQuotes = (value: string): string => {
      if (!value) return value
      let result = value.trim()
      if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('"') && result.endsWith('"'))) {
        result = result.slice(1, -1)
      } else if (result.startsWith("'") && result.endsWith("'")) {
        result = result.slice(1, -1)
      }
      return result.replace(/""/g, '"').trim()
    }

    const uniq = <T,>(arr: T[]): T[] => Array.from(new Set(arr))

    // In Compare mode: show total respondents when Overall is selected, or union of segments
    // In Filter mode: apply intersection filtering (AND across columns, OR within column)
    const isCompareMode = selections.comparisonMode ?? false
    let filteredRows = rows
    const selectedSegments = selections.segments || []
    const hasOverall = selectedSegments.some(seg => seg.column === 'Overall')

    // In Compare mode with Overall selected, show total respondents
    if (isCompareMode && hasOverall) {
      devLog('[RESPONDENT COUNT] Compare mode with Overall - showing total respondents')
      const uniqueRespondents = uniq(
        rows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean)
      )
      return uniqueRespondents.length
    }

    if (selectedSegments.length > 0) {
      devLog('[RESPONDENT COUNT] Selected segments:', selectedSegments)

      // Group segments by column for proper OR logic within same question
      const segmentsByColumn = new Map<string, string[]>()
      selectedSegments.forEach(seg => {
        if (seg.column === 'Overall') return // Skip Overall for grouping
        const values = segmentsByColumn.get(seg.column) || []
        values.push(seg.value)
        segmentsByColumn.set(seg.column, values)
      })

      devLog('[RESPONDENT COUNT] Segments by column:', Array.from(segmentsByColumn.entries()))

      // In Compare mode without Overall: show union of all selected segments
      // In Filter mode: show intersection (AND across columns, OR within column)
      if (isCompareMode) {
        // Union: include rows that match ANY segment
        filteredRows = rows.filter(row => {
          return Array.from(segmentsByColumn.entries()).some(([column, values]) => {
            const consumerQuestion = dataset.questions.find(q => q.qid === column)

            if (consumerQuestion) {
              if (consumerQuestion.type === 'single' && consumerQuestion.singleSourceColumn) {
                const rowValue = stripQuotes(String(row[consumerQuestion.singleSourceColumn]))
                return values.some(value => stripQuotes(value) === rowValue)
              } else if (consumerQuestion.type === 'multi') {
                return values.some(value => {
                  const optionColumn = consumerQuestion.columns.find(col => col.optionLabel === value)
                  if (optionColumn) {
                    const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
                    return headersToCheck.some(header => {
                      const val = row[header]
                      return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
                    })
                  }
                  return false
                })
              }
              return false
            } else {
              const rowValue = stripQuotes(String(row[column]))
              return values.some(value => stripQuotes(value) === rowValue)
            }
          })
        })
      } else {
        // Filter mode: intersection (AND across columns, OR within column)
        filteredRows = rows.filter(row => {
          // If Overall is selected alone, include all rows
          if (hasOverall && segmentsByColumn.size === 0) return true

          // If no segments (only Overall), include all rows
          if (segmentsByColumn.size === 0) return true

          // Check if row matches criteria for each column group
          return Array.from(segmentsByColumn.entries()).every(([column, values]) => {
            const consumerQuestion = dataset.questions.find(q => q.qid === column)

            if (consumerQuestion) {
              if (consumerQuestion.type === 'single' && consumerQuestion.singleSourceColumn) {
                const rowValue = stripQuotes(String(row[consumerQuestion.singleSourceColumn]))
                return values.some(value => stripQuotes(value) === rowValue)
              } else if (consumerQuestion.type === 'multi') {
                return values.some(value => {
                  const optionColumn = consumerQuestion.columns.find(col => col.optionLabel === value)
                  if (optionColumn) {
                    const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
                    return headersToCheck.some(header => {
                      const val = row[header]
                      return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
                    })
                  }
                  return false
                })
              }
              return false
            } else {
              const rowValue = stripQuotes(String(row[column]))
              return values.some(value => stripQuotes(value) === rowValue)
            }
          })
        })
      }

      devLog('[RESPONDENT COUNT] Filtered rows:', filteredRows.length, 'out of', rows.length)
    }

    const uniqueRespondents = uniq(
      filteredRows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean)
    )
    devLog('[RESPONDENT COUNT] Unique respondents:', uniqueRespondents.length)
    return uniqueRespondents.length
  }, [dataset, rows, selections.segments, selections.comparisonMode])

  // Memoize respondent counts for each comparison set
  const comparisonSetRespondentCounts = useMemo(() => {
    const compSets = selections.comparisonSets || []
    if (!dataset || !rows || compSets.length === 0) return {}

    const respIdCol = dataset.summary.columns.find(
      c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
    ) || dataset.summary.columns[0]

    const stripQuotes = (value: string): string => {
      if (!value) return value
      let result = value.trim()
      if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('"') && result.endsWith('"'))) {
        result = result.slice(1, -1)
      } else if (result.startsWith("'") && result.endsWith("'")) {
        result = result.slice(1, -1)
      }
      return result.replace(/""/g, '"').trim()
    }

    const uniq = <T,>(arr: T[]): T[] => Array.from(new Set(arr))

    const counts: Record<string, number> = {}

    for (const compSet of compSets) {
      if (compSet.filters.length === 0) {
        counts[compSet.id] = 0
        continue
      }

      // Group filters by column for AND logic across columns, OR within same column
      const filtersByColumn = new Map<string, string[]>()
      compSet.filters.forEach(filter => {
        const values = filtersByColumn.get(filter.column) || []
        values.push(filter.value)
        filtersByColumn.set(filter.column, values)
      })

      // Filter rows that match ALL column groups (AND across columns, OR within each column)
      const matchingRows = rows.filter(row => {
        return Array.from(filtersByColumn.entries()).every(([column, values]) => {
          // Check if this column is a consumer question
          const consumerQuestion = dataset.questions.find(q => q.qid === column)

          if (consumerQuestion) {
            if (consumerQuestion.type === 'single' && consumerQuestion.singleSourceColumn) {
              const rowValue = stripQuotes(String(row[consumerQuestion.singleSourceColumn]))
              return values.some(value => stripQuotes(value) === rowValue)
            } else if (consumerQuestion.type === 'multi') {
              return values.some(value => {
                const optionColumn = consumerQuestion.columns.find(col => col.optionLabel === value)
                if (optionColumn) {
                  const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
                  return headersToCheck.some(header => {
                    const val = row[header]
                    return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
                  })
                }
                return false
              })
            }
            return false
          } else {
            const rowValue = stripQuotes(String(row[column]))
            return values.some(value => stripQuotes(value) === rowValue)
          }
        })
      })

      const uniqueRespondents = uniq(
        matchingRows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean)
      )
      counts[compSet.id] = uniqueRespondents.length
    }

    return counts
  }, [dataset, rows, selections.comparisonSets])

  // Memoize segment columns filter data to avoid recomputing on every render
  const segmentFilterData = useMemo(() => {
    if (!rowsRaw || !segmentColumns) return {}

    const MIN_RESPONDENTS_FOR_SEGMENT = 10
    const result: Record<string, string[]> = {}

    const sortedCols = segmentColumns
      .filter(col => col !== 'Overall')
      .sort((a, b) => {
        if (a.toLowerCase().includes('product preference')) return -1
        if (b.toLowerCase().includes('product preference')) return 1
        if (a.toLowerCase() === 'country') return -1
        if (b.toLowerCase() === 'country') return 1
        return 0
      })

    for (const column of sortedCols) {
      const valueCounts = new Map<string, number>()
      for (const r of rowsRaw) {
        const val = stripQuotes(String(r[column]))
        if (val) {
          valueCounts.set(val, (valueCounts.get(val) || 0) + 1)
        }
      }

      const rawValues = Array.from(new Set(rowsRaw.map(r => stripQuotes(String(r[column])))))
        .filter(v => {
          if (!v || v === 'null' || v === 'undefined') return false
          const count = valueCounts.get(v) || 0
          if (count < MIN_RESPONDENTS_FOR_SEGMENT) return false
          const normalized = v.replace(/\s+/g, ' ').trim().toLowerCase()
          if (normalized.includes('overall')) return false
          if (normalized === 'not specified' || normalized === 'prefer not to say') return false
          return true
        })

      const values = sortSegmentValues(rawValues, column)
      if (values.length > 1) {
        result[column] = values
      }
    }

    return result
  }, [rowsRaw, segmentColumns])

  // Memoize available consumer questions for multi-filter comparison
  const availableConsumerQuestions = useMemo(() => {
    if (!dataset) return []
    return dataset.questions.filter(q => (q.type === 'single' || q.type === 'multi') && q.columns.length > 1)
  }, [dataset])

  // Create stable reference for segments to avoid unnecessary recalculations
  const segmentsKey = useMemo(() =>
    JSON.stringify(selections.segments || []),
    [selections.segments]
  )

  const { data: _data, groups: _groups } = useMemo(() => {
    if (!filteredDataset || !currentQuestion) {
      return { data: [], groups: [] }
    }

    // Use new segments API if available, otherwise fall back to old API
    const hasSegments = selections.segments && selections.segments.length > 0
    const hasOldStyle = selections.segmentColumn && orderedGroups.length > 0

    if (!hasSegments && !hasOldStyle) {
      return { data: [], groups: [] }
    }

    // In Filter mode (comparisonMode = false), when multiple segments are selected,
    // the dataset is already filtered, so we pass "Overall" to buildSeries to show the filtered data
    // In Compare mode (comparisonMode = true), pass all segments to show them side-by-side
    const isFilterMode = !(selections.comparisonMode ?? true)
    const actualSegments = selections.segments?.filter(seg => seg.value !== 'Overall') || []
    const useOverall = isFilterMode && actualSegments.length >= 1

    const result = buildSeries({
      dataset: filteredDataset,
      question: currentQuestion,
      ...(hasSegments
        ? { segments: useOverall ? [{ column: 'Overall', value: 'Overall' }] : selections.segments }
        : { segmentColumn: selections.segmentColumn, groups: orderedGroups }
      ),
      sortOrder: selections.sortOrder
    })

    // Apply custom labels to groups
    if (selections.groupLabels) {
      result.groups = result.groups.map(group => ({
        ...group,
        label: selections.groupLabels?.[group.key] || group.label
      }))
    }

    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredDataset, currentQuestion, selections.segmentColumn, segmentsKey, orderedGroups, selections.sortOrder, selections.groupLabels, selections.comparisonMode])

  useEffect(() => {
    if (!selections.segmentColumn) return
    const available = new Set(segmentValues)
    // Preserve "Overall" in the groups even if it's not in segmentValues
    const existing = selections.groups.filter(value => value === 'Overall' || available.has(value))
    if (existing.length !== selections.groups.length) {
      setSelections({ groups: existing })
    }
    // Only reset to defaults if no groups are selected and there are no "Overall" selections
    if (existing.length === 0 && segmentValues.length) {
      setSelections({ groups: autoDefaultGroups(rows, selections.segmentColumn) })
    }
  }, [segmentValues, selections.segmentColumn, selections.groups, rows, setSelections])

  // Apply custom order to selections.groups whenever the order changes
  useEffect(() => {
    if (!selections.segmentColumn || !segmentValueOrder[selections.segmentColumn]) return

    const customOrder = segmentValueOrder[selections.segmentColumn]
    const currentGroups = selections.groups

    // Reorder groups based on custom order (includes Overall if present)
    const orderedGroups = customOrder.filter(value => currentGroups.includes(value))
    const newGroups = currentGroups.filter(value => !customOrder.includes(value))
    const reorderedGroups = [...orderedGroups, ...newGroups]

    // Only update if the order actually changed
    if (JSON.stringify(reorderedGroups) !== JSON.stringify(currentGroups)) {
      setSelections({ groups: reorderedGroups })
    }
  }, [segmentValueOrder, selections.segmentColumn, selections.groups, setSelections])

  useEffect(() => {
    if (!selections.productColumn) return
    const available = new Set(productValues)
    const existing = selections.productGroups.filter(value => available.has(value))
    if (existing.length !== selections.productGroups.length) {
      setSelections({ productGroups: existing })
    }
    if (existing.length === 0 && productValues.length && selections.productGroups.length !== 0) {
      setSelections({ productGroups: autoDefaultProducts(rowsRaw, selections.productColumn) })
    }
  }, [productValues, rowsRaw, selections.productColumn, selections.productGroups, setSelections])

  const _toggleGroup = (value: string) => {
    const current = new Set(selections.groups)
    if (current.has(value)) {
      current.delete(value)
    } else {
      current.add(value)
    }
    setSelections({ groups: Array.from(current) })
  }

  const toggleSegment = useCallback((column: string, value: string) => {
    const currentSegments = selections.segments || []
    const existingIndex = currentSegments.findIndex(
      s => s.column === column && s.value === value
    )
    const isFilterMode = !(selections.comparisonMode ?? true)

    // Use startTransition for heavy filter updates to keep UI responsive
    startTransition(() => {
      if (existingIndex >= 0) {
        // Remove segment
        const newSegments = [...currentSegments]
        newSegments.splice(existingIndex, 1)

        // If removing brings us below 2 segments and stat sig is on, turn it off
        if (newSegments.length < 2 && selections.statSigFilter === 'statSigOnly') {
          setSelections({ segments: newSegments, statSigFilter: 'all' })
        } else {
          setSelections({ segments: newSegments })
        }
      } else {
        // Add segment
        let newSegments = [...currentSegments, { column, value }]

        if (value === 'Overall') {
          if (isFilterMode) {
            // In Filter mode: selecting Overall resets all other segments
            setSelections({ segments: [{ column: 'Overall', value: 'Overall' }] })
          } else {
            // In Compare mode: add Overall alongside other segments
            setSelections({ segments: newSegments })
          }
        } else if (isFilterMode) {
          // In Filter mode only: remove Overall when selecting other segments
          newSegments = newSegments.filter(s => s.value !== 'Overall')
          setSelections({ segments: newSegments })
        } else {
          // In Compare mode: keep Overall, allow multiple selections
          setSelections({ segments: newSegments })
        }
      }
    })
  }, [selections.segments, selections.comparisonMode, selections.statSigFilter, setSelections, startTransition])

  const isSegmentSelected = (column: string, value: string) => {
    return (selections.segments || []).some(
      s => s.column === column && s.value === value
    )
  }

  const handleSelectAllInColumn = useCallback((column: string, values: string[]) => {
    const currentSegments = selections.segments || []
    const isFilterMode = !(selections.comparisonMode ?? true)

    startTransition(() => {
      // Remove existing segments from this column
      const otherSegments = currentSegments.filter(s => s.column !== column)
      // Add all values from this column
      let newSegments = [...otherSegments, ...values.map(value => ({ column, value }))]

      // In Filter mode only: remove Overall when selecting other segments
      if (isFilterMode) {
        newSegments = newSegments.filter(s => s.value !== 'Overall')
      }

      setSelections({ segments: newSegments })
    })
  }, [selections.segments, selections.comparisonMode, setSelections, startTransition])

  const handleClearColumn = useCallback((column: string) => {
    const currentSegments = selections.segments || []
    // Remove all segments from this column
    const newSegments = currentSegments.filter(s => s.column !== column)

    startTransition(() => {
      // If removing brings us below 2 segments and stat sig is on, turn it off
      if (newSegments.length < 2 && selections.statSigFilter === 'statSigOnly') {
        setSelections({ segments: newSegments, statSigFilter: 'all' })
      } else {
        setSelections({ segments: newSegments })
      }
    })
  }, [selections.segments, selections.statSigFilter, setSelections, startTransition])

  // Multi-filter comparison set management functions
  const generateSetId = () => `set_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  const addComparisonSet = useCallback(() => {
    const currentSets = selections.comparisonSets || []
    const newSetNumber = currentSets.length + 1
    const newSet: ComparisonSet = {
      id: generateSetId(),
      label: `Set ${newSetNumber}`,
      filters: []
    }
    setSelections({
      comparisonSets: [...currentSets, newSet],
      multiFilterCompareMode: true
    })
    setAddingFiltersToSetId(newSet.id)
  }, [selections.comparisonSets, setSelections])

  const removeComparisonSet = useCallback((setId: string) => {
    const currentSets = selections.comparisonSets || []
    const newSets = currentSets.filter(s => s.id !== setId)
    setSelections({
      comparisonSets: newSets,
      multiFilterCompareMode: newSets.length > 0
    })
    if (addingFiltersToSetId === setId) {
      setAddingFiltersToSetId(null)
    }
  }, [selections.comparisonSets, addingFiltersToSetId, setSelections])

  const updateComparisonSetLabel = useCallback((setId: string, newLabel: string) => {
    const currentSets = selections.comparisonSets || []
    const newSets = currentSets.map(s =>
      s.id === setId ? { ...s, label: newLabel } : s
    )
    setSelections({ comparisonSets: newSets })
  }, [selections.comparisonSets, setSelections])

  const generateSetLabel = useCallback((filters: SegmentDef[]): string => {
    if (filters.length === 0) return 'Empty'
    return filters.map(f => f.value).join(' + ')
  }, [])

  const addFilterToComparisonSet = useCallback((setId: string, filter: SegmentDef) => {
    // Use startTransition for non-urgent state updates to keep UI responsive
    startTransition(() => {
      let currentSets = selections.comparisonSets || []

      // If the set doesn't exist yet (e.g., default_set_1), create it
      const setExists = currentSets.some(s => s.id === setId)
      if (!setExists) {
        const newSet: ComparisonSet = {
          id: setId,
          label: 'Set 1',
          filters: []
        }
        currentSets = [newSet]
        // Keep the card open when creating a new set from default
        setAddingFiltersToSetId(setId)
      }

      const newSets = currentSets.map(s => {
        if (s.id !== setId) return s
        // Check if filter already exists
        const exists = s.filters.some(f => f.column === filter.column && f.value === filter.value)
        if (exists) return s
        const newFilters = [...s.filters, filter]
        // Auto-generate label
        return { ...s, filters: newFilters, label: generateSetLabel(newFilters) }
      })

      // Check if we now have 2+ valid comparison sets - if so, reset sidebar segments to Overall
      const validSetsCount = newSets.filter(s => s.filters.length > 0).length
      if (validSetsCount >= 2) {
        setSelections({
          comparisonSets: newSets,
          multiFilterCompareMode: true,
          segments: [{ column: 'Overall', value: 'Overall' }]
        })
      } else {
        setSelections({ comparisonSets: newSets })
      }
    })
  }, [selections.comparisonSets, setSelections, generateSetLabel, startTransition])

  const removeFilterFromComparisonSet = useCallback((setId: string, filter: SegmentDef) => {
    // Use startTransition for non-urgent state updates to keep UI responsive
    startTransition(() => {
      const currentSets = selections.comparisonSets || []
      // If the set doesn't exist, nothing to remove
      if (!currentSets.some(s => s.id === setId)) return

      const newSets = currentSets.map(s => {
        if (s.id !== setId) return s
        const newFilters = s.filters.filter(f => !(f.column === filter.column && f.value === filter.value))
        // Auto-generate label
        return { ...s, filters: newFilters, label: generateSetLabel(newFilters) }
      })
      setSelections({ comparisonSets: newSets })
    })
  }, [selections.comparisonSets, setSelections, generateSetLabel, startTransition])

  // Product Bucketing management functions
  const generateBucketId = () => `bucket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  const addProductBucket = useCallback(() => {
    const currentBuckets = selections.productBuckets || []
    const newBucketNumber = currentBuckets.length + 1
    const newBucket: ProductBucket = {
      id: generateBucketId(),
      label: `Bucket ${newBucketNumber}`,
      products: []
    }
    setSelections({
      productBuckets: [...currentBuckets, newBucket]
    })
    setAddingProductsToBucketId(newBucket.id)
  }, [selections.productBuckets, setSelections])

  const removeProductBucket = useCallback((bucketId: string) => {
    const currentBuckets = selections.productBuckets || []
    const newBuckets = currentBuckets.filter(b => b.id !== bucketId)
    setSelections({
      productBuckets: newBuckets,
      productBucketMode: newBuckets.length >= 2 ? selections.productBucketMode : false
    })
    if (addingProductsToBucketId === bucketId) {
      setAddingProductsToBucketId(null)
    }
  }, [selections.productBuckets, selections.productBucketMode, addingProductsToBucketId, setSelections])

  const updateProductBucketLabel = useCallback((bucketId: string, newLabel: string) => {
    let currentBuckets = selections.productBuckets || []

    // If the bucket doesn't exist yet (e.g., default_bucket_1), create it first
    const bucketExists = currentBuckets.some(b => b.id === bucketId)
    if (!bucketExists) {
      const newBucket: ProductBucket = {
        id: bucketId,
        label: newLabel,
        products: []
      }
      currentBuckets = [newBucket]
    }

    const newBuckets = currentBuckets.map(b =>
      b.id === bucketId ? { ...b, label: newLabel } : b
    )
    setSelections({ productBuckets: newBuckets })
  }, [selections.productBuckets, setSelections])

  const addProductToBucket = useCallback((bucketId: string, product: string) => {
    // Always ensure the bucket is marked as being edited BEFORE the transition
    // This prevents the selection from closing when the first product is added
    setAddingProductsToBucketId(bucketId)

    startTransition(() => {
      let currentBuckets = selections.productBuckets || []

      // If the bucket doesn't exist yet (e.g., default_bucket_1), create it
      const bucketExists = currentBuckets.some(b => b.id === bucketId)
      if (!bucketExists) {
        const newBucket: ProductBucket = {
          id: bucketId,
          label: 'Bucket 1',
          products: []
        }
        currentBuckets = [newBucket]
      }

      const newBuckets = currentBuckets.map(b => {
        if (b.id !== bucketId) return b
        // Check if product already exists in bucket
        if (b.products.includes(product)) return b
        const newProducts = [...b.products, product]
        // Keep the existing label - don't auto-generate from products
        return { ...b, products: newProducts }
      })

      setSelections({ productBuckets: newBuckets })
    })
  }, [selections.productBuckets, setSelections, startTransition])

  const removeProductFromBucket = useCallback((bucketId: string, product: string) => {
    startTransition(() => {
      const currentBuckets = selections.productBuckets || []
      if (!currentBuckets.some(b => b.id === bucketId)) return

      const newBuckets = currentBuckets.map(b => {
        if (b.id !== bucketId) return b
        const newProducts = b.products.filter(p => p !== product)
        // Keep the existing label - don't auto-generate from products
        return { ...b, products: newProducts }
      })
      setSelections({ productBuckets: newBuckets })
    })
  }, [selections.productBuckets, setSelections, startTransition])

  const toggleProductBucketMode = useCallback((enabled: boolean) => {
    setSelections({ productBucketMode: enabled })
  }, [setSelections])

  const toggleSegmentGroup = (column: string) => {
    const newExpanded = new Set(expandedSegmentGroups)
    if (newExpanded.has(column)) {
      newExpanded.delete(column)
    } else {
      newExpanded.add(column)
    }
    setExpandedSegmentGroups(newExpanded)
  }

  const _toggleQuestionForSegmentation = (qid: string) => {
    const currentQuestionSegments = selections.questionSegments || []
    const isSelected = currentQuestionSegments.includes(qid)

    if (isSelected) {
      // Remove question from segmentation
      const newQuestionSegments = currentQuestionSegments.filter(q => q !== qid)
      // Also remove any segments from this question
      const question = dataset?.questions.find(q => q.qid === qid)
      if (question) {
        const questionColumnHeaders = question.columns.map(c => c.header)
        const newSegments = (selections.segments || []).filter(s => !questionColumnHeaders.includes(s.column))
        setSelections({ questionSegments: newQuestionSegments, segments: newSegments })
      } else {
        setSelections({ questionSegments: newQuestionSegments })
      }
    } else {
      // Add question to segmentation
      setSelections({ questionSegments: [...currentQuestionSegments, qid] })
    }
  }

  const _toggleQuestionSegmentGroup = (qid: string) => {
    const newExpanded = new Set(expandedQuestionSegments)
    if (newExpanded.has(qid)) {
      newExpanded.delete(qid)
    } else {
      newExpanded.add(qid)
    }
    setExpandedQuestionSegments(newExpanded)
  }

  const toggleSection = (sectionName: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(sectionName)) {
      newExpanded.delete(sectionName)
    } else {
      newExpanded.add(sectionName)
    }
    setExpandedSections(newExpanded)
  }

  const _toggleDisplayGroup = (groupName: string) => {
    const newExpanded = new Set(expandedDisplayGroups)
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName)
    } else {
      newExpanded.add(groupName)
    }
    setExpandedDisplayGroups(newExpanded)
  }

  const _handleSegmentDragStart = (index: number) => {
    setDraggedSegmentIndex(index)
  }

  const _handleSegmentDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedSegmentIndex === null || draggedSegmentIndex === index) return

    // Create combined list with Overall at index -1 (position 0) and regular values after
    const allValues = ['Overall', ...segmentValues]
    const draggedIdx = draggedSegmentIndex === -1 ? 0 : draggedSegmentIndex + 1
    const targetIdx = index === -1 ? 0 : index + 1

    const newOrder = [...allValues]
    const [draggedItem] = newOrder.splice(draggedIdx, 1)
    newOrder.splice(targetIdx, 0, draggedItem)

    if (selections.segmentColumn) {
      setSegmentValueOrder(prev => ({
        ...prev,
        [selections.segmentColumn!]: newOrder
      }))
    }

    setDraggedSegmentIndex(index)
  }

  const _handleSegmentDragEnd = () => {
    setDraggedSegmentIndex(null)
  }

  // Product drag-and-drop reordering
  const [draggedProductIndex, setDraggedProductIndex] = useState<number | null>(null)

  // Compute ordered product list: use productOrder if set, otherwise productValues
  const orderedProductValues = useMemo(() => {
    const order = selections.productOrder || []
    if (order.length === 0) return productValues

    // Use custom order, then append any new products not in the order
    const orderSet = new Set(order)
    const ordered = order.filter(p => productValues.includes(p))
    const remaining = productValues.filter(p => !orderSet.has(p))
    return [...ordered, ...remaining]
  }, [productValues, selections.productOrder])

  const handleProductDragStart = (index: number) => {
    setDraggedProductIndex(index)
  }

  const handleProductDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedProductIndex === null || draggedProductIndex === index) return

    const currentOrder = [...orderedProductValues]
    const [draggedItem] = currentOrder.splice(draggedProductIndex, 1)
    currentOrder.splice(index, 0, draggedItem)

    setSelections({ productOrder: currentOrder })
    setDraggedProductIndex(index)
  }

  const handleProductDragEnd = () => {
    setDraggedProductIndex(null)
  }

  const toggleProductGroup = (value: string) => {
    const current = new Set(selections.productGroups)
    if (current.has(value)) {
      current.delete(value)
    } else {
      current.add(value)
    }
    setSelections({ productGroups: Array.from(current) })
  }

  const _handleSegmentColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSegment = event.target.value
    const defaults = autoDefaultGroups(rowsRaw, nextSegment)

    // If switching to "Overall" and stat sig is currently "statSigOnly", change to "all"
    if (nextSegment === 'Overall' && selections.statSigFilter === 'statSigOnly') {
      setSelections({ segmentColumn: nextSegment, groups: defaults, statSigFilter: 'all' })
    } else {
      setSelections({ segmentColumn: nextSegment, groups: defaults })
    }
  }

  const _handleSelectAllSegments = () => {
    const allValues = selections.segmentColumn === 'Overall'
      ? ['Overall']
      : [...(selections.segmentColumn !== 'Overall' ? ['Overall'] : []), ...segmentValues]
    setSelections({ groups: allValues })
  }
  const _handleClearSegments = () => setSelections({ groups: [] })

  const getGroupDisplayLabel = (groupValue: string) => {
    const key = getGroupKey(groupValue)
    return selections.groupLabels?.[key] || groupValue
  }

  const handleSaveLabel = (groupValue: string, newLabel: string) => {
    if (!newLabel.trim()) return
    const key = getGroupKey(groupValue)
    setSelections({
      groupLabels: {
        ...selections.groupLabels,
        [key]: newLabel.trim()
      }
    })
  }

  const handleSaveSegmentLabel = () => {
    if (editingSegment && segmentInput.trim()) {
      handleSaveLabel(editingSegment, segmentInput.trim())
    }
    setEditingSegment(null)
  }

  const handleSaveOptionLabel = (qid: string, option: string, newLabel: string) => {
    if (!newLabel.trim()) return
    const currentOptionLabels = selections.optionLabels || {}
    const questionOptionLabels = currentOptionLabels[qid] || {}
    setSelections({
      optionLabels: {
        ...currentOptionLabels,
        [qid]: {
          ...questionOptionLabels,
          [option]: newLabel.trim()
        }
      }
    })
  }

  const getOptionDisplayLabel = (qid: string, option: string) => {
    return selections.optionLabels?.[qid]?.[option] || option
  }

  const handleSaveConsumerOptionLabel = () => {
    if (editingConsumerOption && consumerOptionInput.trim()) {
      handleSaveOptionLabel(editingConsumerOption.qid, editingConsumerOption.option, consumerOptionInput.trim())
    }
    setEditingConsumerOption(null)
  }

  const handleSaveQuestionLabel = (qid: string, newLabel: string) => {
    if (!newLabel.trim()) return
    devLog('Saving question label:', { qid, newLabel: newLabel.trim(), currentLabels: selections.questionLabels })
    setSelections({
      questionLabels: {
        ...selections.questionLabels,
        [qid]: newLabel.trim()
      }
    })
  }

  const _handleSaveSegmentColumnLabel = (column: string, newLabel: string) => {
    if (!newLabel.trim()) return
    setSelections({
      segmentColumnLabels: {
        ...selections.segmentColumnLabels,
        [column]: newLabel.trim()
      }
    })
    setEditingSegment(null)
  }

  const _getSegmentColumnDisplayLabel = (column: string) => {
    return selections.segmentColumnLabels?.[column] || column
  }

  const handleSelectAllProducts = () => setSelections({ productGroups: [...productValues] })
  const handleClearProducts = () => setSelections({ productGroups: [] })

  // Markdown export handler - exports data in AI-readable format for ChatGPT/NotebookLM
  // Captures the exact view state including sorting, filtering, and product averages
  const handleExportMarkdown = () => {
    if (!dataset) return

    const lines: string[] = []
    const fileName = summary?.fileName || 'survey-data'
    const cleanName = fileName.replace(/\.[^/.]+$/, '') // Remove file extension

    // Header
    lines.push(`# ${cleanName} - Survey Results`)
    lines.push('')
    lines.push(`**Unique Respondents:** ${summary?.uniqueRespondents || 0}`)
    lines.push(`**Questions Analyzed:** ${filteredQuestions.length}`)
    lines.push('')

    // Current view settings
    lines.push('## Current View Settings')
    lines.push('')
    if (selections.segments && selections.segments.length > 0) {
      const segmentLabels = selections.segments.map(s => {
        if (s.value === 'Overall') return 'Overall'
        return selections.groupLabels?.[s.value] || s.value
      })
      lines.push(`**Segment Filter:** ${segmentLabels.join(', ')}`)
    }
    if (selections.productColumn && selections.productGroups.length > 0) {
      lines.push(`**Products:** ${selections.productGroups.length} selected`)
    }
    lines.push(`**Sort Order:** ${selections.sortOrder}`)
    lines.push('')
    lines.push('---')
    lines.push('')

    // Helper: Check if question is a product follow-up (has positive/negative in label)
    const isProductFollowUp = (q: QuestionDef) => {
      const label = q.label.toLowerCase()
      return (label.includes('(positive)') || label.includes('(negative)')) && productColumn
    }

    // Helper: Calculate per-product averages for product follow-up questions
    const calculateProductAverages = (question: QuestionDef) => {
      if (!productColumn) return null

      // Get all unique products
      const allProducts = Array.from(
        new Set(dataset.rows.map(row => normalizeProductValue(row[productColumn])).filter(v => v && v !== 'Unspecified'))
      ).sort()

      if (allProducts.length === 0) return null

      // Get all options
      const allOptions = question.columns.map(col => col.optionLabel).filter(Boolean)

      // Check if this is a product follow-up question
      const isPositiveFollowUp = question.label.toLowerCase().includes('(positive)')
      const isNegativeFollowUp = question.label.toLowerCase().includes('(negative)')

      // Find sentiment column for product follow-up questions
      const sentimentCol = dataset.summary.columns.find(col =>
        col.toLowerCase().includes('(sentiment)') ||
        col.toLowerCase().includes('would you consider buying')
      )

      // Calculate per-product percentages, then average
      const optionAverages: Record<string, { total: number; count: number }> = {}
      allOptions.forEach(opt => {
        optionAverages[opt] = { total: 0, count: 0 }
      })

      for (const product of allProducts) {
        // Filter rows for this product
        const productRows = dataset.rows.filter(row => normalizeProductValue(row[productColumn]) === product)
        if (productRows.length === 0) continue

        // For product follow-up questions, use sentiment to determine denominator (who was shown the question)
        let shownRowCount = productRows.length
        if ((isPositiveFollowUp || isNegativeFollowUp) && sentimentCol) {
          shownRowCount = productRows.filter(row => {
            const sentiment = row[sentimentCol]
            const sentimentNum = typeof sentiment === 'number' ? sentiment : parseInt(String(sentiment))
            if (isNaN(sentimentNum)) return false
            if (isPositiveFollowUp) return sentimentNum === 4 || sentimentNum === 5
            if (isNegativeFollowUp) return sentimentNum >= 1 && sentimentNum <= 3
            return false
          }).length
        } else if (question.type === 'multi') {
          // Fallback for non-follow-up multi-select: count rows where any option is selected
          const allQuestionHeaders = question.columns.flatMap(col =>
            [col.header, ...(col.alternateHeaders || [])]
          )
          shownRowCount = productRows.filter(row => {
            return allQuestionHeaders.some(header => {
              const val = row[header]
              return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
            })
          }).length
        }
        if (shownRowCount === 0) continue

        // Calculate percentage for each option for this product
        for (const option of allOptions) {
          const optionColumn = question.columns.find(col => col.optionLabel === option)
          if (!optionColumn) continue

          let count = 0
          for (const row of productRows) {
            if (question.type === 'single' && question.singleSourceColumn) {
              const val = stripQuotes(String(row[question.singleSourceColumn] || '').trim())
              if (val === option) count++
            } else if (question.type === 'multi') {
              const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
              const hasOption = headersToCheck.some(header => {
                const val = row[header]
                return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
              })
              if (hasOption) count++
            }
          }

          const percent = (count / shownRowCount) * 100
          optionAverages[option].total += percent
          optionAverages[option].count++
        }
      }

      // Calculate final averages
      const result: Array<{ option: string; percent: number }> = []
      for (const option of allOptions) {
        const avg = optionAverages[option]
        if (avg.count > 0) {
          result.push({ option, percent: avg.total / avg.count })
        }
      }

      // Sort by percentage descending (or by sort order)
      if (selections.sortOrder === 'descending') {
        result.sort((a, b) => b.percent - a.percent)
      } else if (selections.sortOrder === 'ascending') {
        result.sort((a, b) => a.percent - b.percent)
      }

      return result
    }

    // Stop words and meaningless responses to filter (same as WordCloudCanvas)
    const MEANINGLESS_WORDS = new Set([
      'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
      'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
      'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
      'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are',
      'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
      'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until',
      'while', 'of', 'at', 'by', 'for', 'with', 'through', 'during', 'before', 'after',
      'above', 'below', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
      'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will',
      'just', 'don', 'should', 'now', 've', 'll', 're',
      'seem', 'think', 'really', 'much', "don't", 'would', "won't", "can't", 'could',
      'know', 'like', 'make', 'made', "isn't", 'isn', 'about', 'around', 'way', 'doesn', 'overall', 'wouldn', 'couldn',
      'dont', 'little', 'less', 'skip', 'nothing', 'none', 'meant',
      // Meaningless adjectives
      'good', 'bad', 'nice', 'great', 'stuff', 'okay', 'ok', 'fine',
      'cool', 'awesome', 'amazing', 'horrible', 'terrible', 'awful',
      'decent', 'solid', 'pretty', 'many', 'yes', 'no', 'na', 'n/a',
      'thing', 'things', 'something', 'everything', 'anything',
      'lot', 'lots', 'kind', 'kinda', 'sorta', 'bit',
      'definitely', 'absolutely', 'totally', 'basically', 'honestly',
      'perfect', 'excellent', 'wonderful', 'fantastic', 'best', 'worst',
      'specified'
    ])

    // Check if a response is meaningful (not just stop words or too short)
    const isMeaningfulResponse = (response: string): boolean => {
      const trimmed = response.trim().toLowerCase()
      // Filter out very short responses
      if (trimmed.length < 3) return false
      // Filter out responses that are just numbers
      if (/^\d+$/.test(trimmed)) return false
      // Filter out responses that are just a single meaningless word
      if (MEANINGLESS_WORDS.has(trimmed)) return false
      // Filter out common non-responses (including any variation of "not specified")
      if (['n/a', 'na', 'none', '-', '.', '...', 'skip', 'unspecified'].includes(trimmed)) return false
      // Always remove any response containing "not specified" or similar patterns
      if (trimmed.includes('not specified') || trimmed.includes('notspecified')) return false
      // Only include responses with more than 7 words
      const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length
      if (wordCount <= 7) return false
      return true
    }

    // Helper: Calculate word frequencies for text questions
    const calculateWordFrequencies = (responses: string[]) => {
      const stopWords = MEANINGLESS_WORDS

      const wordCounts: Record<string, number> = {}
      for (const response of responses) {
        const words = response.toLowerCase()
          .replace(/[^a-z\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2 && !stopWords.has(w))

        for (const word of words) {
          wordCounts[word] = (wordCounts[word] || 0) + 1
        }
      }

      return Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30) // Top 30 words
    }

    // Process each question
    for (const question of filteredQuestions) {
      const customLabel = selections.questionLabels?.[question.qid]
      const displayLabel = customLabel || question.label

      // Clean the label (remove Example: text and type markers)
      let cleanLabel = displayLabel
      const exampleIndex = cleanLabel.toLowerCase().indexOf('example:')
      if (exampleIndex !== -1) {
        cleanLabel = cleanLabel.substring(0, exampleIndex).trim()
      }
      cleanLabel = cleanLabel.replace(/\s*\((single|multi|text|ranking|positive|negative)\)\s*/gi, '').trim()

      // Determine sentiment for product follow-up questions
      const labelLower = question.label.toLowerCase()
      const sentiment = labelLower.includes('(positive)') ? 'Advocates' :
                       labelLower.includes('(negative)') ? 'Detractors' : null

      lines.push(`## ${cleanLabel}`)
      lines.push('')
      if (sentiment) {
        lines.push(`**Respondent Group:** ${sentiment}`)
      }
      lines.push(`*Question Type: ${question.type}*`)
      lines.push('')

      // Handle text/free-text questions with word frequencies and all unique responses
      if (question.type === 'text') {
        lines.push(`**Unique Values:** ${question.uniqueValueCount || 0}`)
        lines.push('')

        if (question.rawTextResponses && question.rawTextResponses.length > 0) {
          // Word frequency table
          const wordFreqs = calculateWordFrequencies(question.rawTextResponses)
          if (wordFreqs.length > 0) {
            lines.push('**Top Words:**')
            lines.push('')
            lines.push('| Word | Frequency |')
            lines.push('| --- | --- |')
            wordFreqs.forEach(([word, count]) => {
              lines.push(`| ${word} | ${count} |`)
            })
            lines.push('')
          }

          // Get all unique responses with their counts (filter out meaningless responses)
          // Use lowercase key to consolidate case-insensitive duplicates
          const responseCounts: Record<string, { display: string; count: number }> = {}
          for (const response of question.rawTextResponses) {
            const trimmed = response.trim()
            if (trimmed && isMeaningfulResponse(trimmed)) {
              const key = trimmed.toLowerCase()
              if (responseCounts[key]) {
                responseCounts[key].count += 1
              } else {
                responseCounts[key] = { display: trimmed, count: 1 }
              }
            }
          }

          // Sort by frequency descending
          const uniqueResponses = Object.values(responseCounts)
            .sort((a, b) => b.count - a.count)

          lines.push('**All Unique Responses:**')
          lines.push('')
          lines.push('| Response | Count |')
          lines.push('| --- | --- |')
          uniqueResponses.forEach(({ display, count }) => {
            // Escape pipe characters in responses for markdown table
            const escapedResponse = display.replace(/\|/g, '\\|')
            lines.push(`| ${escapedResponse} | ${count} |`)
          })
        }
        lines.push('')
        lines.push('---')
        lines.push('')
        continue
      }

      // Handle product follow-up questions - show per-product data (heatmap style)
      if (isProductFollowUp(question) && productColumn) {
        // Get selected products or all products
        const selectedProducts = selections.productGroups.length > 0
          ? selections.productGroups
          : Array.from(new Set(dataset.rows.map(row => normalizeProductValue(row[productColumn])).filter(v => v && v !== 'Unspecified'))).sort()

        if (selectedProducts.length > 0) {
          // Get all options
          const allOptions = question.columns.map(col => col.optionLabel).filter(Boolean)

          // Calculate per-product percentages
          const productData: Record<string, Record<string, number>> = {}
          const optionAverages: Record<string, { total: number; count: number }> = {}
          allOptions.forEach(opt => {
            optionAverages[opt] = { total: 0, count: 0 }
          })

          for (const product of selectedProducts) {
            productData[product] = {}
            const productRows = dataset.rows.filter(row => normalizeProductValue(row[productColumn]) === product)
            if (productRows.length === 0) continue

            for (const option of allOptions) {
              const optionColumn = question.columns.find(col => col.optionLabel === option)
              if (!optionColumn) continue

              let count = 0
              for (const row of productRows) {
                if (question.type === 'single' && question.singleSourceColumn) {
                  const val = stripQuotes(String(row[question.singleSourceColumn] || '').trim())
                  if (val === option) count++
                } else if (question.type === 'multi') {
                  const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
                  const hasOption = headersToCheck.some(header => {
                    const val = row[header]
                    return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
                  })
                  if (hasOption) count++
                }
              }

              const percent = (count / productRows.length) * 100
              productData[product][option] = percent
              optionAverages[option].total += percent
              optionAverages[option].count++
            }
          }

          // Create heatmap-style table with products as columns
          lines.push(`*Data: Per-product breakdown (${selectedProducts.length} products)*`)
          lines.push('')

          // Header row with product names
          const headers = ['Option', ...selectedProducts, 'Average']
          lines.push(`| ${headers.join(' | ')} |`)
          lines.push(`| ${headers.map(() => '---').join(' | ')} |`)

          // Data rows for each option
          for (const option of allOptions) {
            const optionLabel = selections.optionLabels?.[question.qid]?.[option] || option
            const row = [optionLabel]

            for (const product of selectedProducts) {
              const percent = productData[product]?.[option]
              row.push(percent !== undefined ? `${Math.round(percent)}%` : '-')
            }

            // Add average
            const avg = optionAverages[option]
            const avgPercent = avg.count > 0 ? avg.total / avg.count : 0
            row.push(`${Math.round(avgPercent)}%`)

            lines.push(`| ${row.join(' | ')} |`)
          }

          lines.push('')
          lines.push('---')
          lines.push('')
          continue
        }
      }

      // Build series data for regular questions
      try {
        const seriesResult = buildSeries({
          dataset,
          question,
          segmentColumn: selections.segmentColumn,
          groups: selections.groups.length > 0 ? selections.groups : undefined,
          segments: selections.segments,
          sortOrder: selections.sortOrder,
          groupLabels: selections.groupLabels
        })

        if (seriesResult.data.length > 0) {
          // Create table header
          const groups = seriesResult.groups
          const headers = ['Option', ...groups.map(g => g.label)]
          lines.push(`| ${headers.join(' | ')} |`)
          lines.push(`| ${headers.map(() => '---').join(' | ')} |`)

          // Collect significant differences for notes
          const significantNotes: string[] = []

          // Add data rows
          for (const dataPoint of seriesResult.data) {
            const optionLabel = selections.optionLabels?.[question.qid]?.[dataPoint.option] || dataPoint.optionDisplay

            // Check if this option has statistically significant differences
            const hasSignificance = dataPoint.significance && dataPoint.significance.some(sig => sig.significant)
            const displayLabel = hasSignificance ? `${optionLabel}*` : optionLabel
            const row = [displayLabel]

            for (const group of groups) {
              const value = dataPoint[group.key]
              if (typeof value === 'number') {
                row.push(`${Math.round(value)}%`)
              } else {
                row.push('-')
              }
            }
            lines.push(`| ${row.join(' | ')} |`)

            // Collect significant pair details
            if (dataPoint.significance) {
              for (const sig of dataPoint.significance) {
                if (sig.significant) {
                  const [group1, group2] = sig.pair
                  const label1 = selections.groupLabels?.[group1] || group1
                  const label2 = selections.groupLabels?.[group2] || group2
                  significantNotes.push(`"${optionLabel}": ${label1} vs ${label2} (χ²=${sig.chiSquare.toFixed(2)})`)
                }
              }
            }
          }

          // Add significance note if any
          if (significantNotes.length > 0) {
            lines.push('')
            lines.push('**Statistically Significant Differences (p<0.05):**')
            significantNotes.forEach(note => {
              lines.push(`- ${note}`)
            })
          }
        }
      } catch (e) {
        lines.push('*Data not available for this question*')
      }

      lines.push('')
      lines.push('---')
      lines.push('')
    }

    // Add footer
    lines.push('')
    lines.push('*Generated by ORA - Survey Research Analytics*')

    // Create and download file with same naming convention as PDF
    const baseFileName = summary?.fileName
      ? cleanFileName(summary.fileName).replace(/\.csv$/i, '')
      : 'ora_data'

    const segmentPart = selections.segments && selections.segments.length > 0
      ? selections.segments.map(s => {
          if (s.value === 'Overall') return 'Overall'
          return selections.groupLabels?.[s.value] || s.value
        }).join('_')
      : selections.segmentColumn || 'Overall'

    const isCompareMode = selections.comparisonMode || selections.multiFilterCompareMode
    const modePart = isCompareMode ? 'Compare' : 'Filter'

    const exportFileName = `${baseFileName}_${segmentPart}_${modePart}.md`
      .replace(/\s+/g, '_')

    const content = lines.join('\n')
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // PDF export handler - exports charts as multi-page PDF with batched charts per page
  // Groups multiple charts per page for faster export while staying within canvas limits
  const handleExportPdf = async () => {
    if (!chartGalleryRef.current || isExportingPdf) return

    setIsExportingPdf(true)
    setExportProgress(null)

    try {
      const [html2canvas, { default: jsPDF }] = await Promise.all([
        import('html2canvas').then(m => m.default),
        import('jspdf')
      ])

      // Query all chart elements - each chart has id="chart-{qid}"
      const chartElements = Array.from(
        chartGalleryRef.current.querySelectorAll('[id^="chart-"]')
      ) as HTMLElement[]

      if (chartElements.length === 0) {
        console.warn('No charts found to export')
        return
      }

      // Use 4x scale for high quality PDF export
      const captureScale = 4
      const margin = 30
      // Max height per page batch (at 4x scale = 14000px canvas, under 16384 limit)
      const MAX_PAGE_HEIGHT = 3500
      const CHART_GAP = 24 // Gap between charts on same page

      // Group charts into batches based on height
      const batches: HTMLElement[][] = []
      let currentBatch: HTMLElement[] = []
      let currentBatchHeight = 0

      for (const chartEl of chartElements) {
        const chartHeight = chartEl.offsetHeight

        // If adding this chart would exceed max height, start a new batch
        if (currentBatchHeight + chartHeight + (currentBatch.length > 0 ? CHART_GAP : 0) > MAX_PAGE_HEIGHT && currentBatch.length > 0) {
          batches.push(currentBatch)
          currentBatch = [chartEl]
          currentBatchHeight = chartHeight
        } else {
          currentBatch.push(chartEl)
          currentBatchHeight += chartHeight + (currentBatch.length > 1 ? CHART_GAP : 0)
        }
      }
      if (currentBatch.length > 0) {
        batches.push(currentBatch)
      }

      setExportProgress({ current: 0, total: batches.length })

      // Helper function to clean up cloned elements before capture
      const cleanupClonedElement = (clonedDoc: Document, clonedElement: HTMLElement) => {
        const clonedRect = clonedElement.getBoundingClientRect()
        const allChildren = clonedElement.querySelectorAll('*')

        allChildren.forEach((child) => {
          const htmlEl = child as HTMLElement
          const computedStyle = clonedDoc.defaultView?.getComputedStyle(htmlEl)
          if (!computedStyle) return

          const rect = htmlEl.getBoundingClientRect()

          // Hide resize handles (positioned absolutely with resize cursor)
          if (computedStyle.position === 'absolute' &&
              (computedStyle.cursor === 'ew-resize' || computedStyle.cursor === 'ns-resize')) {
            htmlEl.style.display = 'none'
          }

          // Fix elements with negative margins that cause left overflow
          const marginLeft = parseFloat(computedStyle.marginLeft)
          if (marginLeft < 0) {
            htmlEl.style.marginLeft = '0px'
          }

          // Hide any elements that extend beyond the right edge
          if (rect.right > clonedRect.right + 5) {
            if (rect.width < 50 && computedStyle.position === 'absolute') {
              htmlEl.style.display = 'none'
            }
          }
        })
      }

      // Capture each batch
      const canvases: HTMLCanvasElement[] = []
      const captureWidth = chartElements[0]?.clientWidth || 900

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex]
        setExportProgress({ current: batchIndex + 1, total: batches.length })

        // Create a temporary container for this batch
        const tempContainer = document.createElement('div')
        tempContainer.style.cssText = `
          position: absolute;
          left: -9999px;
          top: 0;
          width: ${captureWidth}px;
          background: white;
          display: flex;
          flex-direction: column;
          gap: ${CHART_GAP}px;
          padding: 0;
        `
        document.body.appendChild(tempContainer)

        // Clone charts into temp container
        for (const chartEl of batch) {
          const clone = chartEl.cloneNode(true) as HTMLElement
          clone.style.margin = '0'
          tempContainer.appendChild(clone)
        }

        // Allow DOM to render
        await new Promise(resolve => setTimeout(resolve, 50))

        const batchHeight = tempContainer.scrollHeight

        // Capture the batch
        const canvas = await html2canvas(tempContainer, {
          backgroundColor: '#ffffff',
          scale: captureScale,
          logging: false,
          useCORS: true,
          width: captureWidth,
          height: batchHeight,
          onclone: cleanupClonedElement
        })

        canvases.push(canvas)

        // Clean up temp container
        document.body.removeChild(tempContainer)
      }

      // Create PDF
      const firstCanvas = canvases[0]
      const firstImgWidth = firstCanvas.width / captureScale
      const firstImgHeight = firstCanvas.height / captureScale

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [firstImgWidth + margin * 2, firstImgHeight + margin * 2],
        compress: true
      })

      // Add each batch as a page
      for (let i = 0; i < canvases.length; i++) {
        const canvas = canvases[i]
        const imgData = canvas.toDataURL('image/jpeg', 0.92)
        const imgWidth = canvas.width / captureScale
        const imgHeight = canvas.height / captureScale
        const pageWidth = imgWidth + margin * 2
        const pageHeight = imgHeight + margin * 2

        if (i > 0) {
          pdf.addPage([pageWidth, pageHeight])
        }

        pdf.addImage(imgData, 'JPEG', margin, margin, imgWidth, imgHeight, undefined, 'FAST')
      }

      // Generate filename
      const baseFileName = summary?.fileName
        ? cleanFileName(summary.fileName).replace(/\.csv$/i, '')
        : 'ora_charts'

      const segmentPart = selections.segments && selections.segments.length > 0
        ? selections.segments.map(s => s.value).join('_')
        : selections.segmentColumn || 'Overall'

      const isCompareMode = selections.comparisonMode || selections.multiFilterCompareMode
      const modePart = isCompareMode ? 'Compare' : 'Filter'

      const fileName = `${baseFileName}_${segmentPart}_${modePart}.pdf`
        .replace(/\s+/g, '_')

      pdf.save(fileName)
    } catch (error) {
      console.error('PDF export failed:', error)
    } finally {
      setIsExportingPdf(false)
      setExportProgress(null)
    }
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = e.clientX
      const maxWidth = Math.min(window.innerWidth * 0.5, 800)
      if (newWidth >= 200 && newWidth <= maxWidth) {
        setSidebarWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  if (!dataset) {
    return (
      <div
        className="min-h-screen"
        style={{
          background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 25%, #f0f9ff 50%, #faf5ff 75%, #fdf2f8 100%)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Animated gradient orbs for glassmorphic effect */}
        <div
          style={{
            position: 'absolute',
            top: '-20%',
            left: '-10%',
            width: '50vw',
            height: '50vw',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(58, 133, 24, 0.15) 0%, transparent 70%)',
            filter: 'blur(60px)',
            animation: 'float 20s ease-in-out infinite'
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-30%',
            right: '-15%',
            width: '60vw',
            height: '60vw',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(231, 203, 56, 0.12) 0%, transparent 70%)',
            filter: 'blur(80px)',
            animation: 'float 25s ease-in-out infinite reverse'
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '40%',
            right: '20%',
            width: '30vw',
            height: '30vw',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(165, 207, 142, 0.2) 0%, transparent 70%)',
            filter: 'blur(50px)',
            animation: 'float 15s ease-in-out infinite'
          }}
        />

        {/* Main content */}
        <div
          className="relative z-10 flex min-h-screen flex-col items-center px-6"
          style={{ paddingTop: '12vh', paddingBottom: '60px' }}
        >
          {/* Hero Section */}
          <div className="text-center" style={{ marginBottom: '24px' }}>
            <h1
              style={{
                fontSize: '56px',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #3A8518 0%, #166534 50%, #14532d 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                marginBottom: '20px',
                letterSpacing: '-1px',
                fontFamily: 'Space Grotesk, sans-serif'
              }}
            >
              ORA
            </h1>

            {/* Feature Pills container with NEW! badge */}
            <div
              style={{
                position: 'relative',
                padding: '16px',
                border: '1px solid rgba(251, 191, 36, 0.5)',
                borderRadius: '12px',
                background: 'rgba(254, 243, 199, 0.15)',
                maxWidth: '720px',
                margin: '0 auto'
              }}
            >
              {/* NEW! badge at corner of container */}
              <span className="new-badge-pulse" style={{
                position: 'absolute',
                top: '-10px',
                left: '-10px',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 700,
                color: '#92400e',
                border: '1px solid rgba(251, 191, 36, 0.4)',
                zIndex: 10
              }}>
                NEW!
              </span>

              {/* Grid of feature pills */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '10px'
                }}
              >
              {/* Feature pill 1 - Word cloud generator */}
              <div className="feature-pill-wrapper pill-1">
                <div className="feature-pill">
                  <svg className="pill-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <text x="2" y="10" fontSize="6" fontWeight="bold" fill="#3A8518">Word</text>
                    <text x="8" y="16" fontSize="5" fontWeight="bold" fill="#A5CF8E">cloud</text>
                    <text x="3" y="21" fontSize="4" fill="#E7CB38">text</text>
                    <text x="13" y="20" fontSize="3" fill="#717F90">data</text>
                  </svg>
                  <span className="pill-label">Word cloud generator</span>
                </div>
                <div className="pill-card">
                  <div className="pill-card-content">
                    <div className="pill-card-tagline">Visualize free-text responses ☁️</div>
                    <div className="pill-card-location">Auto-generated from text questions</div>
                  </div>
                </div>
              </div>

              {/* Feature pill 2 - Markdown export for AI */}
              <div className="feature-pill-wrapper pill-2">
                <div className="feature-pill">
                  <svg className="pill-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#DAEBD1" stroke="#3A8518" strokeWidth="1.5"/>
                    <polyline points="14 2 14 8 20 8" fill="none" stroke="#3A8518" strokeWidth="1.5"/>
                    <line x1="16" y1="13" x2="8" y2="13" stroke="#3A8518" strokeWidth="1.5"/>
                    <line x1="16" y1="17" x2="8" y2="17" stroke="#3A8518" strokeWidth="1.5"/>
                    <polyline points="10 9 9 9 8 9" stroke="#3A8518" strokeWidth="1.5"/>
                  </svg>
                  <span className="pill-label">Markdown export for AI</span>
                </div>
                <div className="pill-card">
                  <div className="pill-card-content">
                    <div className="pill-card-tagline">Export for ChatGPT & NotebookLM 🤖</div>
                    <div className="pill-card-location">AI-readable markdown format</div>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>

          {/* Glassmorphic Upload Card - entire card is clickable */}
          <div
            onClick={() => csvUploadRef.current?.openFileBrowser()}
            style={{
              background: 'rgba(255, 255, 255, 0.7)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderRadius: '24px',
              border: '1px solid rgba(255, 255, 255, 0.8)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.5) inset',
              padding: '48px',
              width: '100%',
              maxWidth: '520px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'transform 0.15s ease-out, box-shadow 0.15s ease-out'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)'
              e.currentTarget.style.boxShadow = '0 30px 60px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.5) inset'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.5) inset'
            }}
          >
            <CSVUpload ref={csvUploadRef} variant="landing" />
          </div>

          {/* Last updated and feedback CTA */}
          <div style={{
            marginTop: '24px',
            textAlign: 'center',
            fontFamily: 'Space Grotesk, sans-serif'
          }}>
            <p style={{
              fontSize: '13px',
              color: '#6B7280',
              marginBottom: '8px'
            }}>
              Last updated on December 16, 2025
            </p>
            <p style={{
              fontSize: '13px',
              color: '#4B5563'
            }}>
              💡 Feature requests or bugs? Reach out to <span style={{ fontWeight: 600, color: '#3A8518' }}>Misaki</span> at <span style={{ fontWeight: 600, color: '#3A8518' }}>#ops-chat</span>
            </p>
          </div>
        </div>

        {/* CSS animation for floating orbs and feature pills with expandable cards */}
        <style>{`
          @keyframes float {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(30px, -30px) scale(1.05); }
            66% { transform: translate(-20px, 20px) scale(0.95); }
          }

          @keyframes popIn {
            0% {
              opacity: 0;
              transform: scale(0.8) translateY(10px);
            }
            60% {
              transform: scale(1.05) translateY(-2px);
            }
            100% {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }

          @keyframes sparkle-wiggle {
            0%, 100% { transform: rotate(-2deg); }
            50% { transform: rotate(2deg); }
          }

          @keyframes icon-bounce {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.15); }
          }

          @keyframes new-badge-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
          }

          .whats-new-sparkle {
            animation: popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards, sparkle-wiggle 3s ease-in-out infinite 0.5s;
            opacity: 0;
          }

          .new-badge-pulse {
            animation: popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards, new-badge-bounce 2s ease-in-out infinite 0.5s;
            opacity: 0;
          }

          /* Feature pill wrapper - contains pill and expandable card */
          .feature-pill-wrapper {
            position: relative;
            animation: popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            opacity: 0;
            z-index: 1;
          }

          .feature-pill-wrapper:hover {
            z-index: 1000;
          }

          .pill-1 { animation-delay: 0.1s; }
          .pill-2 { animation-delay: 0.18s; }
          .pill-3 { animation-delay: 0.26s; }
          .pill-4 { animation-delay: 0.34s; }

          /* The pill itself */
          .feature-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 100px;
            font-size: 13px;
            font-weight: 500;
            color: #374151;
            border: 1px solid rgba(0, 0, 0, 0.08);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            position: relative;
            z-index: 2;
          }

          .pill-icon {
            flex-shrink: 0;
            transition: transform 0.3s ease;
          }

          .pill-label {
            white-space: nowrap;
          }

          /* The expandable card */
          .pill-card {
            position: absolute;
            top: calc(100% + 8px);
            left: 50%;
            transform: translateX(-50%) translateY(-8px) scale(0.95);
            opacity: 0;
            visibility: hidden;
            background: white;
            border-radius: 16px;
            padding: 0;
            width: 280px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            z-index: 100;
            overflow: hidden;
          }

          .pill-card::before {
            content: '';
            position: absolute;
            top: -6px;
            left: 50%;
            transform: translateX(-50%) rotate(45deg);
            width: 12px;
            height: 12px;
            background: white;
            box-shadow: -2px -2px 4px rgba(0, 0, 0, 0.04);
            border-radius: 2px;
          }

          .pill-card-content {
            padding: 14px 16px;
            background: linear-gradient(135deg, rgba(58, 133, 24, 0.03) 0%, rgba(255, 255, 255, 0) 100%);
          }

          .pill-card-tagline {
            font-size: 14px;
            font-weight: 600;
            color: #1F2937;
            margin-bottom: 4px;
          }

          .pill-card-location {
            font-size: 12px;
            color: #6B7280;
          }

          /* Hover states */
          .feature-pill-wrapper:hover .feature-pill {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
            border-color: rgba(58, 133, 24, 0.3);
            background: white;
          }

          .feature-pill-wrapper:hover .pill-icon {
            animation: icon-bounce 0.5s ease-in-out;
          }

          .feature-pill-wrapper:hover .pill-card {
            opacity: 1;
            visibility: visible;
            transform: translateX(-50%) translateY(0) scale(1);
          }

          /* Keep card visible when hovering over it */
          .pill-card:hover {
            opacity: 1;
            visibility: visible;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white" style={{ margin: 0, padding: 0 }}>
      {/* Fixed Header - Glassmorphic Design */}
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          backgroundColor: 'rgba(248, 250, 252, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          width: '100vw',
          height: '72px',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid rgba(229, 231, 235, 0.8)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)'
        }}
      >
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center" style={{ gap: '20px', paddingLeft: '24px' }}>
            <div style={{ flexShrink: 0 }}>
              <CSVUpload />
            </div>
            {/* Export Markdown Button - for AI tools (ChatGPT, NotebookLM) */}
            {dataset && (
              <button
                onClick={handleExportMarkdown}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '12px 24px',
                  width: '145px',
                  backgroundColor: '#FFFFFF',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#3A8518',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: 'Space Grotesk, sans-serif',
                  transition: 'all 0.15s ease-out',
                  boxShadow: '0 0 0 1px rgba(58,133,24,0.3), 0 2px 8px -2px rgba(58,133,24,0.15)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#F0FDF4'
                  e.currentTarget.style.boxShadow = '0 0 0 1px rgba(58,133,24,0.5), 0 4px 12px -2px rgba(58,133,24,0.25)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#FFFFFF'
                  e.currentTarget.style.boxShadow = '0 0 0 1px rgba(58,133,24,0.3), 0 2px 8px -2px rgba(58,133,24,0.15)'
                }}
                title="Export data for AI tools (ChatGPT, NotebookLM)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Export for AI
              </button>
            )}
            {/* NotebookLM Button */}
            {dataset && (
              <button
                onClick={() => window.open('https://notebooklm.google.com/', '_blank', 'noopener,noreferrer')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '12px 24px',
                  width: '145px',
                  backgroundColor: '#FFFFFF',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#3A8518',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: 'Space Grotesk, sans-serif',
                  transition: 'all 0.15s ease-out',
                  boxShadow: '0 0 0 1px rgba(58,133,24,0.3), 0 2px 8px -2px rgba(58,133,24,0.15)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#F0FDF4'
                  e.currentTarget.style.boxShadow = '0 0 0 1px rgba(58,133,24,0.5), 0 4px 12px -2px rgba(58,133,24,0.25)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#FFFFFF'
                  e.currentTarget.style.boxShadow = '0 0 0 1px rgba(58,133,24,0.3), 0 2px 8px -2px rgba(58,133,24,0.15)'
                }}
                title="Open NotebookLM"
              >
                NotebookLM
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            )}
            {/* Insight Finder Button */}
            {dataset && (
              <button
                onClick={() => window.open('https://chatgpt.com/g/g-693dce2d9fac8191bfab3d9dd6ea35f8-insight-generator', '_blank', 'noopener,noreferrer')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '12px 24px',
                  width: '145px',
                  backgroundColor: '#FFFFFF',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#3A8518',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: 'Space Grotesk, sans-serif',
                  transition: 'all 0.15s ease-out',
                  boxShadow: '0 0 0 1px rgba(58,133,24,0.3), 0 2px 8px -2px rgba(58,133,24,0.15)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#F0FDF4'
                  e.currentTarget.style.boxShadow = '0 0 0 1px rgba(58,133,24,0.5), 0 4px 12px -2px rgba(58,133,24,0.25)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#FFFFFF'
                  e.currentTarget.style.boxShadow = '0 0 0 1px rgba(58,133,24,0.3), 0 2px 8px -2px rgba(58,133,24,0.15)'
                }}
                title="Open Insight Finder in ChatGPT"
              >
                Insight Finder
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex items-center" style={{ paddingRight: '24px', gap: '16px' }}>
            {summary && (
              <span
                className="font-medium"
                style={{
                  color: '#374151',
                  fontSize: '14px',
                  whiteSpace: 'nowrap'
                }}
              >
                {cleanFileName(summary.fileName)}
              </span>
            )}
            <div
              className="flex items-center gap-1"
              style={{
                padding: '6px 12px',
                backgroundColor: 'transparent',
                borderRadius: '8px'
              }}
            >
              <span style={{ fontSize: '16px' }}>✨</span>
              <span
                className="font-bold"
                style={{
                  color: '#3A8518',
                  fontSize: '20px',
                  letterSpacing: '1px'
                }}
              >
                ORA
              </span>
              <span style={{ fontSize: '16px' }}>✨</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="flex" style={{ height: '100vh' }}>
        {/* Sidebar toggle button - only visible when sidebar is hidden */}
        {!sidebarVisible && (
          <button
            onClick={() => setSidebarVisible(true)}
            className="flex items-center justify-center transition-all"
            style={{
              position: 'fixed',
              left: '16px',
              top: '88px',
              zIndex: 50,
              height: '36px',
              width: '36px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
              cursor: 'pointer',
              color: '#6B7280'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#F9FAFB'
              e.currentTarget.style.borderColor = '#D1D5DB'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#FFFFFF'
              e.currentTarget.style.borderColor = '#E5E7EB'
            }}
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
              <path d="m14 9 3 3-3 3" />
            </svg>
          </button>
        )}

        {/* Fixed Left Sidebar Panel */}
        {sidebarVisible && (
          <>
            <aside
              className="overflow-y-auto"
              style={{
                width: `${sidebarWidth}px`,
                minWidth: `${sidebarWidth}px`,
                height: 'calc(100vh - 72px)',
                position: 'fixed',
                left: 0,
                top: '72px',
                backgroundColor: '#f8fafc',
                paddingTop: '20px',
                paddingBottom: '24px',
                paddingLeft: '16px',
                paddingRight: '16px',
                borderRight: '1px solid #e5e7eb'
              }}
            >
              {/* Hide sidebar button - upper right corner */}
              <button
                onClick={() => setSidebarVisible(false)}
                className="flex items-center justify-center transition-all"
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '12px',
                  height: '28px',
                  width: '28px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  zIndex: 10,
                  color: '#9CA3AF'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#F3F4F6'
                  e.currentTarget.style.color = '#6B7280'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#FFFFFF'
                  e.currentTarget.style.color = '#9CA3AF'
                }}
                title="Hide sidebar"
                aria-label="Hide sidebar"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
          {summary && (
            <>
              {/* Filter Summary Card */}
              <div
                className="shadow-sm"
                style={{
                  marginBottom: '10px',
                  width: '100%',
                  overflow: 'hidden',
                  padding: '16px 18px',
                  borderRadius: '12px',
                  backgroundColor: 'white'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
                  {/* Respondent Count Header */}
                  <div>
                    <span className="text-sm" style={{ color: '#374151' }}>
                      <span className="font-bold" style={{ color: selections.multiFilterCompareMode && selections.comparisonSets && selections.comparisonSets.length > 0 ? '#3A8518' : 'inherit' }}>
                        {(() => {
                          // In multi-filter comparison mode, show sum of all comparison set respondents
                          if (selections.multiFilterCompareMode && selections.comparisonSets && selections.comparisonSets.length > 0) {
                            const sum = Object.values(comparisonSetRespondentCounts).reduce((acc, count) => acc + count, 0)
                            return sum.toLocaleString()
                          }
                          return filteredRespondentCount.toLocaleString()
                        })()}
                      </span>
                      <span style={{ color: '#6B7280' }}> of {summary.uniqueRespondents.toLocaleString()} respondents</span>
                    </span>
                  </div>

                  {/* Active Filters */}
                  {(() => {
                    const activeFilters: Array<{type: 'segment' | 'product', column?: string, value: string, label: string, originalIndex: number}> = []

                    // Add segment filters
                    // In Compare mode: show Overall chip alongside other segments
                    // In Filter mode: exclude Overall from chip display (it's the default state)
                    const isCompareMode = selections.comparisonMode ?? false
                    const selectedSegments = selections.segments || []
                    // Use segments in their actual order (selections.segments order)
                    // This matches the order used in charts for consistency
                    selectedSegments.forEach((segment, index) => {
                      // Show Overall chip only in Compare mode when other segments are also selected
                      const hasOtherSegments = selectedSegments.some(s => s.value !== 'Overall')
                      if (segment.value === 'Overall' && (!isCompareMode || !hasOtherSegments)) {
                        return // Skip Overall in Filter mode or when it's the only segment
                      }
                      // Check if this is a consumer question segment (column is a qid)
                      const isConsumerQuestion = dataset?.questions.some(q => q.qid === segment.column)
                      const label = isConsumerQuestion
                        ? getOptionDisplayLabel(segment.column, segment.value)
                        : getGroupDisplayLabel(segment.value)
                      activeFilters.push({
                        type: 'segment',
                        column: segment.column,
                        value: segment.value,
                        label,
                        originalIndex: index
                      })
                    })

                    // Add product filters
                    if (productColumn && selections.productGroups.length > 0 && selections.productGroups.length < productValues.length) {
                      selections.productGroups.forEach((product, index) => {
                        activeFilters.push({
                          type: 'product',
                          value: product,
                          label: product,
                          originalIndex: index
                        })
                      })
                    }

                    // Check if we have 2+ segments selected (for showing Compare toggle)
                    const segmentCount = selectedSegments.filter(s => s.value !== 'Overall').length
                    const showCompareToggle = segmentCount >= 2

                    if (activeFilters.length === 0) return null

                    // Drag and drop handlers for reordering segments
                    const handleChipDragStart = (e: React.DragEvent, index: number, filterType: 'segment' | 'product') => {
                      e.dataTransfer.setData('text/plain', JSON.stringify({ index, filterType }))
                      e.dataTransfer.effectAllowed = 'move'
                      // Set custom drag image for cleaner preview
                      const target = e.currentTarget as HTMLElement
                      e.dataTransfer.setDragImage(target, target.offsetWidth / 2, target.offsetHeight / 2)
                      // Use requestAnimationFrame to ensure drag image is captured before state change
                      requestAnimationFrame(() => {
                        setDraggedChipInfo({ index, type: filterType })
                      })
                    }

                    const handleChipDragEnd = () => {
                      setDraggedChipInfo(null)
                      setDropIndicator(null)
                    }

                    const handleChipDragOver = (e: React.DragEvent, index: number, filterType: 'segment' | 'product') => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'

                      // Only show indicator if same type and different index
                      if (draggedChipInfo && draggedChipInfo.type === filterType && draggedChipInfo.index !== index) {
                        // Determine if dropping before or after based on mouse position
                        const rect = e.currentTarget.getBoundingClientRect()
                        const midpoint = rect.left + rect.width / 2
                        const position = e.clientX < midpoint ? 'before' : 'after'

                        // Only update if changed (prevents excessive re-renders)
                        if (!dropIndicator || dropIndicator.index !== index || dropIndicator.position !== position) {
                          setDropIndicator({ index, position })
                        }
                      }
                    }

                    const handleChipDragLeave = (e: React.DragEvent) => {
                      // Only clear if leaving the chip entirely (not entering a child)
                      const relatedTarget = e.relatedTarget as Node
                      if (!e.currentTarget.contains(relatedTarget)) {
                        setDropIndicator(null)
                      }
                    }

                    const handleChipDrop = (e: React.DragEvent, dropIndex: number, dropFilterType: 'segment' | 'product') => {
                      e.preventDefault()

                      if (!draggedChipInfo || !dropIndicator) {
                        setDraggedChipInfo(null)
                        setDropIndicator(null)
                        return
                      }

                      const dragIndex = draggedChipInfo.index
                      const dragFilterType = draggedChipInfo.type

                      // Only allow reordering within same type
                      if (dragFilterType !== dropFilterType || dragIndex === dropIndex) {
                        setDraggedChipInfo(null)
                        setDropIndicator(null)
                        return
                      }

                      if (dropFilterType === 'segment') {
                        // Reorder segments - find actual indices in selections.segments
                        const currentSegments = [...(selections.segments || [])]
                        const segmentFilters = activeFilters.filter(f => f.type === 'segment')

                        // Get the segment values being dragged and dropped
                        const dragSegment = segmentFilters[dragIndex]
                        const dropSegment = segmentFilters[dropIndex]

                        if (dragSegment && dropSegment) {
                          // Find actual indices in selections.segments (not sortedSegments)
                          const dragActualIndex = currentSegments.findIndex(
                            s => s.column === dragSegment.column && s.value === dragSegment.value
                          )
                          const dropActualIndex = currentSegments.findIndex(
                            s => s.column === dropSegment.column && s.value === dropSegment.value
                          )

                          if (dragActualIndex !== -1 && dropActualIndex !== -1) {
                            const [removed] = currentSegments.splice(dragActualIndex, 1)
                            // Calculate insert position based on before/after indicator
                            // After removing, indices shift if drag was before drop
                            const adjustedDropIndex = dragActualIndex < dropActualIndex
                              ? dropActualIndex - 1
                              : dropActualIndex
                            let insertIndex = adjustedDropIndex
                            if (dropIndicator.position === 'after') {
                              insertIndex = adjustedDropIndex + 1
                            }
                            currentSegments.splice(Math.max(0, insertIndex), 0, removed)
                            setSelections({ segments: currentSegments })
                          }
                        }
                      } else if (dropFilterType === 'product') {
                        // Reorder product groups
                        const currentProducts = [...selections.productGroups]
                        const [removed] = currentProducts.splice(dragIndex, 1)
                        let insertIndex = dropIndex
                        if (dragIndex < dropIndex) {
                          insertIndex = dropIndicator.position === 'before' ? dropIndex - 1 : dropIndex
                        } else {
                          insertIndex = dropIndicator.position === 'before' ? dropIndex : dropIndex + 1
                        }
                        currentProducts.splice(Math.max(0, insertIndex), 0, removed)
                        setSelections({ productGroups: currentProducts })
                      }

                      setDraggedChipInfo(null)
                      setDropIndicator(null)
                    }

                    // Split filters by type for drag-drop grouping
                    const segmentFilters = activeFilters.filter(f => f.type === 'segment')
                    const productFilters = activeFilters.filter(f => f.type === 'product')

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
                        {/* Filter Chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', width: '100%' }}>
                          {/* Segment chips - draggable */}
                          {segmentFilters.map((filter, idx) => {
                            const isDragging = draggedChipInfo?.type === 'segment' && draggedChipInfo?.index === idx
                            const showIndicatorBefore = dropIndicator?.index === idx && dropIndicator?.position === 'before' && draggedChipInfo?.type === 'segment'
                            const showIndicatorAfter = dropIndicator?.index === idx && dropIndicator?.position === 'after' && draggedChipInfo?.type === 'segment'
                            return (
                              <div
                                key={`segment-${filter.value}`}
                                style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
                              >
                                {/* Drop indicator line - before */}
                                <div style={{
                                  width: '2px',
                                  height: '18px',
                                  backgroundColor: '#3A8518',
                                  borderRadius: '1px',
                                  marginRight: showIndicatorBefore ? '4px' : '0',
                                  opacity: showIndicatorBefore ? 1 : 0,
                                  transform: showIndicatorBefore ? 'scaleY(1)' : 'scaleY(0)',
                                  transition: 'all 0.08s ease-out',
                                  boxShadow: showIndicatorBefore ? '0 0 6px rgba(58, 133, 24, 0.5)' : 'none'
                                }} />
                                <div
                                  draggable={true}
                                  onDragStart={(e) => handleChipDragStart(e, idx, 'segment')}
                                  onDragEnd={handleChipDragEnd}
                                  onDragOver={(e) => handleChipDragOver(e, idx, 'segment')}
                                  onDragLeave={handleChipDragLeave}
                                  onDrop={(e) => handleChipDrop(e, idx, 'segment')}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    backgroundColor: 'white',
                                    borderRadius: '8px',
                                    fontSize: '11px',
                                    color: '#374151',
                                    cursor: isDragging ? 'grabbing' : 'grab',
                                    userSelect: 'none',
                                    opacity: isDragging ? 0.4 : 1,
                                    transform: isDragging ? 'scale(1.02) translateY(-2px)' : 'scale(1) translateY(0)',
                                    boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.08)',
                                    transition: 'transform 0.08s ease-out, box-shadow 0.08s ease-out, opacity 0.08s ease-out, background-color 0.15s ease',
                                    willChange: 'transform, opacity',
                                    border: '1px solid #E5E7EB'
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isDragging && !draggedChipInfo) {
                                      e.currentTarget.style.backgroundColor = '#E8F5E9'
                                      e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.1)'
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isDragging) {
                                      e.currentTarget.style.backgroundColor = 'white'
                                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'
                                    }
                                  }}
                                >
                                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                                    <circle cx="9" cy="5" r="2" fill="#9CA3AF" />
                                    <circle cx="15" cy="5" r="2" fill="#9CA3AF" />
                                    <circle cx="9" cy="12" r="2" fill="#9CA3AF" />
                                    <circle cx="15" cy="12" r="2" fill="#9CA3AF" />
                                    <circle cx="9" cy="19" r="2" fill="#9CA3AF" />
                                    <circle cx="15" cy="19" r="2" fill="#9CA3AF" />
                                  </svg>
                                  <span style={{ fontWeight: 500 }}>{filter.label}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (filter.column) {
                                        toggleSegment(filter.column, filter.value)
                                      }
                                    }}
                                    draggable={false}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: '2px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      color: '#9CA3AF',
                                      borderRadius: '4px',
                                      transition: 'color 0.1s ease, background 0.1s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = '#EF4444'
                                      e.currentTarget.style.background = '#FEE2E2'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = '#9CA3AF'
                                      e.currentTarget.style.background = 'none'
                                    }}
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                                {/* Drop indicator line - after */}
                                <div style={{
                                  width: '2px',
                                  height: '18px',
                                  backgroundColor: '#3A8518',
                                  borderRadius: '1px',
                                  marginLeft: showIndicatorAfter ? '4px' : '0',
                                  opacity: showIndicatorAfter ? 1 : 0,
                                  transform: showIndicatorAfter ? 'scaleY(1)' : 'scaleY(0)',
                                  transition: 'all 0.08s ease-out',
                                  boxShadow: showIndicatorAfter ? '0 0 6px rgba(58, 133, 24, 0.5)' : 'none'
                                }} />
                              </div>
                            )
                          })}
                          {/* Product chips - draggable */}
                          {productFilters.map((filter, idx) => {
                            const isDragging = draggedChipInfo?.type === 'product' && draggedChipInfo?.index === idx
                            const showIndicatorBefore = dropIndicator?.index === idx && dropIndicator?.position === 'before' && draggedChipInfo?.type === 'product'
                            const showIndicatorAfter = dropIndicator?.index === idx && dropIndicator?.position === 'after' && draggedChipInfo?.type === 'product'
                            return (
                              <div
                                key={`product-${filter.value}`}
                                style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
                              >
                                {/* Drop indicator line - before */}
                                <div style={{
                                  width: '2px',
                                  height: '18px',
                                  backgroundColor: '#3A8518',
                                  borderRadius: '1px',
                                  marginRight: showIndicatorBefore ? '4px' : '0',
                                  opacity: showIndicatorBefore ? 1 : 0,
                                  transform: showIndicatorBefore ? 'scaleY(1)' : 'scaleY(0)',
                                  transition: 'all 0.08s ease-out',
                                  boxShadow: showIndicatorBefore ? '0 0 6px rgba(58, 133, 24, 0.5)' : 'none'
                                }} />
                                <div
                                  draggable={true}
                                  onDragStart={(e) => handleChipDragStart(e, idx, 'product')}
                                  onDragEnd={handleChipDragEnd}
                                  onDragOver={(e) => handleChipDragOver(e, idx, 'product')}
                                  onDragLeave={handleChipDragLeave}
                                  onDrop={(e) => handleChipDrop(e, idx, 'product')}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    backgroundColor: 'white',
                                    borderRadius: '8px',
                                    fontSize: '11px',
                                    color: '#374151',
                                    cursor: isDragging ? 'grabbing' : 'grab',
                                    userSelect: 'none',
                                    opacity: isDragging ? 0.4 : 1,
                                    transform: isDragging ? 'scale(1.02) translateY(-2px)' : 'scale(1) translateY(0)',
                                    boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.08)',
                                    transition: 'transform 0.08s ease-out, box-shadow 0.08s ease-out, opacity 0.08s ease-out, background-color 0.15s ease',
                                    willChange: 'transform, opacity',
                                    border: '1px solid #E5E7EB'
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isDragging && !draggedChipInfo) {
                                      e.currentTarget.style.backgroundColor = '#E8F5E9'
                                      e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.1)'
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isDragging) {
                                      e.currentTarget.style.backgroundColor = 'white'
                                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'
                                    }
                                  }}
                                >
                                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                                    <circle cx="9" cy="5" r="2" fill="#9CA3AF" />
                                    <circle cx="15" cy="5" r="2" fill="#9CA3AF" />
                                    <circle cx="9" cy="12" r="2" fill="#9CA3AF" />
                                    <circle cx="15" cy="12" r="2" fill="#9CA3AF" />
                                    <circle cx="9" cy="19" r="2" fill="#9CA3AF" />
                                    <circle cx="15" cy="19" r="2" fill="#9CA3AF" />
                                  </svg>
                                  <span style={{ fontWeight: 500 }}>{filter.label}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleProductGroup(filter.value)
                                    }}
                                    draggable={false}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: '2px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      color: '#9CA3AF',
                                      borderRadius: '4px',
                                      transition: 'color 0.1s ease, background 0.1s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = '#EF4444'
                                      e.currentTarget.style.background = '#FEE2E2'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = '#9CA3AF'
                                      e.currentTarget.style.background = 'none'
                                    }}
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                                {/* Drop indicator line - after */}
                                <div style={{
                                  width: '2px',
                                  height: '18px',
                                  backgroundColor: '#3A8518',
                                  borderRadius: '1px',
                                  marginLeft: showIndicatorAfter ? '4px' : '0',
                                  opacity: showIndicatorAfter ? 1 : 0,
                                  transform: showIndicatorAfter ? 'scaleY(1)' : 'scaleY(0)',
                                  transition: 'all 0.08s ease-out',
                                  boxShadow: showIndicatorAfter ? '0 0 6px rgba(58, 133, 24, 0.5)' : 'none'
                                }} />
                              </div>
                            )
                          })}
                        </div>

                        {/* Clear All + Compare Toggle Row - Show Compare toggle when 2+ segments selected */}
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <button
                            onClick={() => {
                              setSelections({ segments: [{ column: 'Overall', value: 'Overall' }], productGroups: [] })
                            }}
                            style={{
                              padding: '6px 14px',
                              backgroundColor: '#F9FAFB',
                              border: 'none',
                              borderRadius: '8px',
                              color: '#374151',
                              fontSize: '12px',
                              fontWeight: '500',
                              cursor: 'pointer',
                              fontFamily: 'Space Grotesk, sans-serif'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F3F4F6'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#F9FAFB'}
                          >
                            Clear All
                          </button>

                          {/* Compare Toggle - Show when 2+ segments selected */}
                          {showCompareToggle && (
                            <div className="flex items-center" style={{ gap: '6px' }}>
                              <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
                                <input
                                  type="checkbox"
                                  checked={selections.comparisonMode ?? false}
                                  onChange={(e) => {
                                    e.stopPropagation()
                                    const newComparisonMode = !selections.comparisonMode
                                    setSelections({
                                      comparisonMode: newComparisonMode,
                                      showAsterisks: newComparisonMode,
                                      // Clear multi-filter comparison when switching to Filter mode
                                      ...(newComparisonMode ? {} : { multiFilterCompareMode: false, comparisonSets: [] })
                                    })
                                  }}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span
                                  style={{
                                    position: 'absolute',
                                    cursor: 'pointer',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    backgroundColor: selections.comparisonMode ? '#3A8518' : '#D1D5DB',
                                    transition: '0.3s',
                                    borderRadius: '11px'
                                  }}
                                >
                                  <span
                                    style={{
                                      position: 'absolute',
                                      height: '18px',
                                      width: '18px',
                                      left: selections.comparisonMode ? '20px' : '2px',
                                      top: '2px',
                                      backgroundColor: 'white',
                                      transition: '0.3s',
                                      borderRadius: '50%',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                    }}
                                  />
                                </span>
                              </label>
                              <span
                                style={{
                                  color: '#374151',
                                  fontSize: '12px',
                                  fontWeight: '500'
                                }}
                              >
                                Compare
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Segmentation Section */}
                <section
                  className="rounded-xl bg-white shadow-sm"
                  style={{ marginBottom: '10px' }}
                >
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => toggleSection('segmentation')}
                    style={{
                      padding: '14px 16px',
                      backgroundColor: 'white',
                      borderRadius: '12px',
                      transition: 'background-color 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#E8F5E9'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'white'
                    }}
                  >
                    <div className="flex items-center" style={{ gap: '10px' }}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#3A8518"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#374151', letterSpacing: '0.025em' }}>Segmentation</h4>
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#9CA3AF"
                      strokeWidth="2"
                      className="flex-shrink-0 transition-transform"
                      style={{ transform: expandedSections.has('segmentation') ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                  {expandedSections.has('segmentation') && (
                    <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '0 0 12px 12px' }}>
                  <div className="max-h-96 space-y-4 overflow-y-auto">
                    {/* Overall option with Clear all button */}
                    <div style={{ paddingBottom: '12px' }}>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center cursor-pointer" style={{ gap: '10px' }}>
                          <div
                            onClick={(e) => {
                              e.preventDefault()
                              toggleSegment('Overall', 'Overall')
                            }}
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              border: isSegmentSelected('Overall', 'Overall') ? '2px solid #3A8518' : '2px solid #D1D5DB',
                              backgroundColor: isSegmentSelected('Overall', 'Overall') ? '#3A8518' : 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease',
                              flexShrink: 0,
                              cursor: 'pointer'
                            }}
                          >
                            {isSegmentSelected('Overall', 'Overall') && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          {editingSegment === 'Overall' ? (
                            <textarea
                              ref={segmentInputRef as any}
                              value={segmentInput}
                              onChange={(e) => setSegmentInput(e.target.value)}
                              onBlur={handleSaveSegmentLabel}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  e.preventDefault()
                                  handleSaveSegmentLabel()
                                  e.currentTarget.blur()
                                }
                              }}
                              style={{
                                fontSize: '12px',
                                fontFamily: 'Space Grotesk, sans-serif',
                                fontWeight: '600',
                                padding: '2px 4px',
                                border: '1px solid #3A8518',
                                borderRadius: '3px',
                                outline: 'none',
                                resize: 'none',
                                lineHeight: '1.2',
                                height: '22px',
                                overflow: 'hidden',
                                width: '100px'
                              }}
                            />
                          ) : (
                            <span
                              onClick={() => {
                                setEditingSegment('Overall')
                                setSegmentInput(getGroupDisplayLabel('Overall'))
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#3A8518'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = '#374151'
                              }}
                              style={{
                                fontSize: '13px',
                                fontFamily: 'Space Grotesk, sans-serif',
                                fontWeight: '600',
                                cursor: 'pointer',
                                color: '#374151'
                              }}
                            >
                              {getGroupDisplayLabel('Overall')}
                            </span>
                          )}
                        </label>
                      </div>
                    </div>

                    {/* All segment columns */}
                    {segmentColumns
                      .filter(col => col !== 'Overall')
                      .sort((a, b) => {
                        // Put Product Preference first, then Country, then others
                        if (a.toLowerCase().includes('product preference')) return -1
                        if (b.toLowerCase().includes('product preference')) return 1
                        if (a.toLowerCase() === 'country') return -1
                        if (b.toLowerCase() === 'country') return 1
                        return 0
                      })
                      .map((column, _index) => {
                      // Count respondents for each value in this segment column
                      const valueCounts = new Map<string, number>()
                      rowsRaw.forEach(r => {
                        const val = stripQuotes(String(r[column]))
                        if (val) {
                          valueCounts.set(val, (valueCounts.get(val) || 0) + 1)
                        }
                      })

                      const MIN_RESPONDENTS_FOR_SEGMENT = 10
                      const rawValues = Array.from(new Set(rowsRaw.map(r => stripQuotes(String(r[column])))))
                        .filter(v => {
                          if (!v || v === 'null' || v === 'undefined') return false

                          // Filter out values with fewer than minimum respondents
                          const count = valueCounts.get(v) || 0
                          if (count < MIN_RESPONDENTS_FOR_SEGMENT) return false

                          // Check original value first (case-insensitive)
                          const original = String(v).trim()
                          if (original.toLowerCase() === 'overall') return false

                          // More aggressive normalization to handle any whitespace or special characters
                          const normalized = v.replace(/\s+/g, ' ').trim().toLowerCase()

                          // Remove any value that contains "overall" in any form
                          if (normalized.includes('overall')) return false
                          if (normalized === 'not specified' || normalized === 'prefer not to say') return false
                          return true
                        })

                      const values = sortSegmentValues(rawValues, column)

                      // Hide segment groups with only one option
                      if (values.length <= 1) return null

                      const isExpanded = expandedSegmentGroups.has(column)

                      return (
                        <div key={column} style={{ paddingBottom: '4px' }}>
                          <div
                            className="flex items-center justify-between cursor-pointer"
                            onClick={() => toggleSegmentGroup(column)}
                            style={{
                              padding: '8px 12px',
                              backgroundColor: isExpanded ? '#F0FDF4' : '#F9FAFB',
                              borderRadius: '8px',
                              marginBottom: isExpanded ? '8px' : '0',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#E8F5E9'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = isExpanded ? '#F0FDF4' : '#F9FAFB'
                            }}
                          >
                            <h5 style={{ fontSize: '12px', fontWeight: 600, color: '#374151', fontFamily: 'Space Grotesk, sans-serif' }}>{column}</h5>
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#6B7280"
                              strokeWidth="2"
                              className="flex-shrink-0 transition-transform"
                              style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                            >
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          </div>
                          {isExpanded && (
                            <div style={{ paddingLeft: '12px' }}>
                            {/* Select all checkbox */}
                            <label className="flex items-center cursor-pointer" style={{ gap: '10px', marginBottom: '10px' }}>
                              <div
                                onClick={(e) => {
                                  e.preventDefault()
                                  const selectedInColumn = (selections.segments || []).filter(s => s.column === column)
                                  if (selectedInColumn.length === values.length) {
                                    handleClearColumn(column)
                                  } else {
                                    handleSelectAllInColumn(column, values)
                                  }
                                }}
                                style={{
                                  width: '18px',
                                  height: '18px',
                                  borderRadius: '4px',
                                  border: (() => {
                                    const selectedInColumn = (selections.segments || []).filter(s => s.column === column)
                                    return selectedInColumn.length === values.length ? '2px solid #3A8518' : '2px solid #D1D5DB'
                                  })(),
                                  backgroundColor: (() => {
                                    const selectedInColumn = (selections.segments || []).filter(s => s.column === column)
                                    return selectedInColumn.length === values.length ? '#3A8518' : 'white'
                                  })(),
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  transition: 'all 0.15s ease',
                                  flexShrink: 0,
                                  cursor: 'pointer'
                                }}
                              >
                                {(() => {
                                  const selectedInColumn = (selections.segments || []).filter(s => s.column === column)
                                  return selectedInColumn.length === values.length && (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )
                                })()}
                              </div>
                              <span style={{ fontSize: '12px', color: '#6B7280', fontFamily: 'Space Grotesk, sans-serif' }}>
                                Select all
                              </span>
                            </label>
                            {values.map(value => (
                              <label key={value} className="flex items-center cursor-pointer" style={{ gap: '10px', marginBottom: '6px' }}>
                                <div
                                  onClick={(e) => {
                                    e.preventDefault()
                                    toggleSegment(column, value)
                                  }}
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    border: isSegmentSelected(column, value) ? '2px solid #3A8518' : '2px solid #D1D5DB',
                                    backgroundColor: isSegmentSelected(column, value) ? '#3A8518' : 'white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s ease',
                                    flexShrink: 0,
                                    cursor: 'pointer'
                                  }}
                                >
                                  {isSegmentSelected(column, value) && (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                </div>
                                {editingSegment === value ? (
                                  <textarea
                                    ref={segmentInputRef as any}
                                    value={segmentInput}
                                    onChange={(e) => setSegmentInput(e.target.value)}
                                    onBlur={handleSaveSegmentLabel}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === 'Escape') {
                                        e.preventDefault()
                                        handleSaveSegmentLabel()
                                        e.currentTarget.blur()
                                      }
                                    }}
                                    style={{
                                      fontSize: '12px',
                                      fontFamily: 'Space Grotesk, sans-serif',
                                      padding: '4px 8px',
                                      border: '1px solid #3A8518',
                                      borderRadius: '4px',
                                      outline: 'none',
                                      resize: 'none',
                                      lineHeight: '1.2',
                                      height: '26px',
                                      overflow: 'hidden',
                                      width: '120px'
                                    }}
                                  />
                                ) : (
                                  <span
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      setEditingSegment(value)
                                      setSegmentInput(getGroupDisplayLabel(value))
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = '#3A8518'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = '#374151'
                                    }}
                                    style={{
                                      fontSize: '12px',
                                      fontFamily: 'Space Grotesk, sans-serif',
                                      cursor: 'pointer',
                                      color: '#374151'
                                    }}
                                  >
                                    {getGroupDisplayLabel(value)}
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                    {/* Consumer Questions Segmentation */}
                    <div style={{ paddingTop: '8px' }}>
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => {
                          const isExpanded = expandedSections.has('consumerQuestions')
                          setExpandedSections(prev => {
                            const next = new Set(prev)
                            if (isExpanded) {
                              next.delete('consumerQuestions')
                              setQuestionDropdownOpen(false)
                            } else {
                              next.add('consumerQuestions')
                              setQuestionDropdownOpen(true)
                            }
                            return next
                          })
                        }}
                        style={{
                          padding: '8px 12px',
                          backgroundColor: expandedSections.has('consumerQuestions') ? '#F0FDF4' : '#F9FAFB',
                          borderRadius: '8px',
                          marginBottom: expandedSections.has('consumerQuestions') ? '8px' : '0',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#E8F5E9'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = expandedSections.has('consumerQuestions') ? '#F0FDF4' : '#F9FAFB'
                        }}
                      >
                        <h5 style={{ fontSize: '12px', fontWeight: 600, color: '#374151', fontFamily: 'Space Grotesk, sans-serif' }}>
                          Consumer Questions
                        </h5>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#6B7280"
                          strokeWidth="2"
                          className="flex-shrink-0 transition-transform"
                          style={{ transform: expandedSections.has('consumerQuestions') ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </div>

                      {expandedSections.has('consumerQuestions') && (
                        <div style={{ paddingLeft: '12px' }}>
                          {/* Questions Dropdown */}
                          <div ref={questionDropdownRef} style={{ position: 'relative', marginBottom: '12px', flexShrink: 0 }}>
                            <div
                              onClick={() => setQuestionDropdownOpen(!questionDropdownOpen)}
                              style={{
                                padding: '10px 14px',
                                border: '1px solid #E5E7EB',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                backgroundColor: 'white',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                color: '#374151',
                                transition: 'all 0.15s ease',
                                boxShadow: questionDropdownOpen ? '0 0 0 2px rgba(58, 133, 24, 0.2)' : 'none'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#3A8518'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = '#E5E7EB'
                              }}
                            >
                              <span style={{ fontWeight: 500 }}>Select Questions</span>
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#6B7280"
                                strokeWidth="2"
                                style={{
                                  transform: questionDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.2s ease'
                                }}
                              >
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                            </div>

                            {questionDropdownOpen && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  right: 0,
                                  marginTop: '4px',
                                  backgroundColor: 'white',
                                  border: '1px solid #E5E7EB',
                                  borderRadius: '8px',
                                  zIndex: 1000,
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  overflow: 'hidden'
                                }}
                              >
                                {/* Search Input */}
                                <div style={{ padding: '10px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
                                  <input
                                    type="text"
                                    placeholder="Search questions or answers..."
                                    value={questionSearchTerm}
                                    onChange={(e) => {
                                      e.stopPropagation()
                                      setQuestionSearchTerm(e.target.value)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      width: '100%',
                                      padding: '8px 12px',
                                      fontSize: '12px',
                                      border: '1px solid #E5E7EB',
                                      borderRadius: '6px',
                                      outline: 'none',
                                      transition: 'border-color 0.15s ease'
                                    }}
                                    onFocus={(e) => {
                                      e.target.style.borderColor = '#3A8518'
                                      e.target.style.boxShadow = '0 0 0 2px rgba(58, 133, 24, 0.1)'
                                    }}
                                    onBlur={(e) => {
                                      e.target.style.borderColor = '#E5E7EB'
                                      e.target.style.boxShadow = 'none'
                                    }}
                                  />
                                </div>

                                {/* Questions List */}
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                {filteredSegmentationQuestions.length === 0 ? (
                                  <div style={{ padding: '12px 8px', fontSize: '11px', color: '#6B7280', textAlign: 'center' }}>
                                    No questions found
                                  </div>
                                ) : (
                                  filteredSegmentationQuestions.map((q) => (
                                  <label
                                    key={q.qid}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      padding: '6px 8px',
                                      fontSize: '11px',
                                      cursor: 'pointer',
                                      gap: '6px'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = '#F3F4F6'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = 'white'
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={(selections.questionSegments || []).includes(q.qid)}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        const current = selections.questionSegments || []
                                        const isRemoving = current.includes(q.qid)
                                        const newQuestionSegments = isRemoving
                                          ? current.filter(id => id !== q.qid)
                                          : [...current, q.qid]
                                        setSelections({ questionSegments: newQuestionSegments })

                                        // Auto-expand newly selected questions
                                        if (!isRemoving) {
                                          setExpandedQuestionSegments(prev => {
                                            const next = new Set(prev)
                                            next.add(q.qid)
                                            return next
                                          })
                                        } else {
                                          // Remove from expanded when deselected
                                          setExpandedQuestionSegments(prev => {
                                            const next = new Set(prev)
                                            next.delete(q.qid)
                                            return next
                                          })
                                        }
                                      }}
                                      style={{ cursor: 'pointer' }}
                                    />
                                    <span>{q.label}</span>
                                  </label>
                                )))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Answer Options for Selected Questions */}
                          {(selections.questionSegments || []).length > 0 && (
                            <div style={{ maxHeight: '600px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {(selections.questionSegments || []).map((qid) => {
                                const question = dataset?.questions.find(q => q.qid === qid)
                                if (!question) return null

                                const isExpanded = expandedQuestionSegments.has(qid)

                                return (
                                  <div key={qid} style={{ paddingBottom: '8px', borderBottom: '1px solid #F3F4F6' }}>
                                    <div
                                      onClick={() => {
                                        setExpandedQuestionSegments(prev => {
                                          const next = new Set(prev)
                                          if (isExpanded) {
                                            next.delete(qid)
                                          } else {
                                            next.add(qid)
                                          }
                                          return next
                                        })
                                      }}
                                      style={{
                                        fontSize: '11px',
                                        fontWeight: '600',
                                        marginBottom: isExpanded ? '6px' : '0',
                                        color: '#374151',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                      }}
                                    >
                                      <svg
                                        width="10"
                                        height="10"
                                        viewBox="0 0 12 12"
                                        fill="none"
                                        style={{
                                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                          transition: 'transform 0.2s ease',
                                          flexShrink: 0
                                        }}
                                      >
                                        <path d="M4.5 2L8.5 6L4.5 10" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                      </svg>
                                      {question.label}
                                    </div>
                                    {isExpanded && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      {question.columns.map((col) => {
                                        const segmentKey = `${qid}::${col.optionLabel}`
                                        const isSelected = (selections.segments || []).some(
                                          s => s.column === qid && s.value === col.optionLabel
                                        )

                                        const isEditing = editingConsumerOption?.qid === qid && editingConsumerOption?.option === col.optionLabel
                                        const displayLabel = getOptionDisplayLabel(qid, col.optionLabel)

                                        return (
                                          <div key={segmentKey} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <input
                                              type="checkbox"
                                              id={segmentKey}
                                              checked={isSelected}
                                              onChange={(e) => {
                                                e.stopPropagation()
                                                const current = selections.segments || []
                                                const newSegments = isSelected
                                                  ? current.filter(s => !(s.column === qid && s.value === col.optionLabel))
                                                  : [...current, { column: qid, value: col.optionLabel }]
                                                setSelections({ segments: newSegments })
                                              }}
                                              style={{ cursor: 'pointer' }}
                                            />
                                            {isEditing ? (
                                              <textarea
                                                ref={consumerOptionInputRef}
                                                value={consumerOptionInput}
                                                onChange={(e) => setConsumerOptionInput(e.target.value)}
                                                onBlur={handleSaveConsumerOptionLabel}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter' || e.key === 'Escape') {
                                                    e.preventDefault()
                                                    handleSaveConsumerOptionLabel()
                                                    e.currentTarget.blur()
                                                  }
                                                }}
                                                style={{
                                                  fontSize: '11px',
                                                  fontFamily: 'Space Grotesk, sans-serif',
                                                  padding: '2px 6px',
                                                  border: '1px solid #3A8518',
                                                  borderRadius: '4px',
                                                  outline: 'none',
                                                  resize: 'none',
                                                  lineHeight: '1.2',
                                                  height: '22px',
                                                  overflow: 'hidden',
                                                  width: '120px'
                                                }}
                                              />
                                            ) : (
                                              <span
                                                onClick={(e) => {
                                                  e.preventDefault()
                                                  e.stopPropagation()
                                                  setEditingConsumerOption({ qid, option: col.optionLabel })
                                                  setConsumerOptionInput(displayLabel)
                                                }}
                                                onMouseEnter={(e) => {
                                                  e.currentTarget.style.color = '#3A8518'
                                                }}
                                                onMouseLeave={(e) => {
                                                  e.currentTarget.style.color = '#6B7280'
                                                }}
                                                style={{
                                                  fontSize: '11px',
                                                  cursor: 'pointer',
                                                  color: '#6B7280'
                                                }}
                                              >
                                                {displayLabel}
                                              </span>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  {selections.comparisonMode && (
                    <div style={{ paddingTop: '16px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid #E5E7EB' }}>
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={statSigFilter === 'statSigOnly'}
                            onChange={(e) => {
                              e.stopPropagation()
                              const isDisabled = (selections.segments && selections.segments.length < 2) || (!selections.segments && selections.groups.length < 2)
                              if (!isDisabled) {
                                const newStatSigFilter = statSigFilter === 'all' ? 'statSigOnly' : 'all'
                                setSelections({ statSigFilter: newStatSigFilter })
                              }
                            }}
                            disabled={(selections.segments && selections.segments.length < 2) || (!selections.segments && selections.groups.length < 2)}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span
                            className="slider round"
                            style={{
                              position: 'absolute',
                              cursor: (selections.segments && selections.segments.length < 2) || (!selections.segments && selections.groups.length < 2) ? 'not-allowed' : 'pointer',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: statSigFilter === 'statSigOnly' ? '#3A8518' : '#D1D5DB',
                              transition: '0.3s',
                              borderRadius: '11px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '18px',
                                width: '18px',
                                left: statSigFilter === 'statSigOnly' ? '20px' : '2px',
                                top: '2px',
                                backgroundColor: 'white',
                                transition: '0.3s',
                                borderRadius: '50%',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          style={{
                            color: statSigFilter === 'statSigOnly' ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Stat Sig Only
                        </span>
                      </div>
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={selections.showAsterisks ?? true}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ showAsterisks: e.target.checked })
                            }}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span
                            className="slider round"
                            style={{
                              position: 'absolute',
                              cursor: 'pointer',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: selections.showAsterisks ? '#3A8518' : '#D1D5DB',
                              transition: '0.3s',
                              borderRadius: '11px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '18px',
                                width: '18px',
                                left: selections.showAsterisks ? '20px' : '2px',
                                top: '2px',
                                backgroundColor: 'white',
                                transition: '0.3s',
                                borderRadius: '50%',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          style={{
                            color: selections.showAsterisks ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Stat Sig Asterisks
                        </span>
                      </div>
                    </div>
                  )}
                  {!selections.comparisonMode && (
                    <div style={{ paddingTop: '16px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid #E5E7EB' }}>
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={selections.showAsterisks ?? true}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ showAsterisks: e.target.checked })
                            }}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span
                            className="slider round"
                            style={{
                              position: 'absolute',
                              cursor: 'pointer',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: selections.showAsterisks ? '#3A8518' : '#D1D5DB',
                              transition: '0.3s',
                              borderRadius: '11px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '18px',
                                width: '18px',
                                left: selections.showAsterisks ? '20px' : '2px',
                                top: '2px',
                                backgroundColor: 'white',
                                transition: '0.3s',
                                borderRadius: '50%',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          style={{
                            color: selections.showAsterisks ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Stat Sig Asterisks
                        </span>
                      </div>
                    </div>
                  )}
                  </div>
                  )}
                </section>

              {/* Segment Buckets Section - Always visible */}
              <div
                className="shadow-sm"
                style={{
                  marginBottom: '10px',
                  width: '100%',
                  overflow: 'hidden',
                  borderRadius: '12px',
                  backgroundColor: 'white'
                }}
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => toggleSection('multiFilterComparison')}
                  style={{
                    padding: '14px 16px',
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#FEF3C7'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'white'
                  }}
                >
                  <div className="flex items-center" style={{ gap: '10px' }}>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#3A8518"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                    <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#374151', letterSpacing: '0.025em' }}>Segment Buckets</h4>
                    {/* Status indicator */}
                    {(() => {
                      const validSets = (selections.comparisonSets || []).filter(s => s.filters.length > 0)
                      if (validSets.length >= 2) {
                        return (
                          <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#E8F5E0', color: '#3A8518', borderRadius: '4px', fontWeight: 500 }}>
                            Active
                          </span>
                        )
                      } else if (validSets.length === 1) {
                        return (
                          <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#FEF3C7', color: '#92400E', borderRadius: '4px', fontWeight: 500 }}>
                            Need 1 more
                          </span>
                        )
                      }
                      return null
                    })()}
                  </div>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#3A8518"
                    strokeWidth="2"
                    className="flex-shrink-0 transition-transform"
                    style={{ transform: expandedSections.has('multiFilterComparison') ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
                {expandedSections.has('multiFilterComparison') && (
                  <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '0 0 12px 12px' }}>
                    {/* Comparison Sets List - Always show at least one set */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {(() => {
                        // Ensure there's always at least one set displayed
                        const currentSets = selections.comparisonSets || []
                        const displaySets = currentSets.length > 0 ? currentSets : [{
                          id: 'default_set_1',
                          label: 'Set 1',
                          filters: []
                        }]
                        // If showing the default set and no addingFiltersToSetId, auto-open it
                        const effectiveAddingId = currentSets.length === 0 ? 'default_set_1' : addingFiltersToSetId

                        return displaySets.map((compSet, idx) => {
                        const isEditing = effectiveAddingId === compSet.id || (currentSets.length === 0 && idx === 0)
                        return (
                        <div
                          key={compSet.id}
                          onClick={(e) => {
                            // Only activate editing if clicking on the card itself, not on buttons
                            if ((e.target as HTMLElement).closest('button')) return
                            if (!isEditing) {
                              setAddingFiltersToSetId(compSet.id)
                            }
                          }}
                          style={{
                            padding: '12px',
                            backgroundColor: isEditing ? '#FFFBEB' : '#F9FAFB',
                            borderRadius: '8px',
                            border: isEditing ? '2px solid #E7CB38' : '1px solid #E5E7EB',
                            cursor: isEditing ? 'default' : 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {/* Set Header */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {editingComparisonSetId === compSet.id ? (
                                <input
                                  type="text"
                                  value={comparisonSetLabelInput}
                                  onChange={(e) => setComparisonSetLabelInput(e.target.value)}
                                  onBlur={() => {
                                    if (comparisonSetLabelInput.trim()) {
                                      updateComparisonSetLabel(compSet.id, comparisonSetLabelInput.trim())
                                    }
                                    setEditingComparisonSetId(null)
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      if (comparisonSetLabelInput.trim()) {
                                        updateComparisonSetLabel(compSet.id, comparisonSetLabelInput.trim())
                                      }
                                      setEditingComparisonSetId(null)
                                    } else if (e.key === 'Escape') {
                                      setEditingComparisonSetId(null)
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  autoFocus
                                  style={{
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    color: '#374151',
                                    border: '1px solid #D1D5DB',
                                    borderRadius: '4px',
                                    padding: '2px 6px',
                                    width: '120px'
                                  }}
                                />
                              ) : (
                                <span
                                  style={{ fontSize: '13px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingComparisonSetId(compSet.id)
                                    setComparisonSetLabelInput(compSet.label)
                                  }}
                                  title="Click to edit label"
                                >
                                  {compSet.label}
                                </span>
                              )}
                              {/* Respondent count badge */}
                              {compSet.filters.length > 0 && (
                                <span style={{ fontSize: '10px', padding: '1px 5px', backgroundColor: '#E8F5E0', color: '#3A8518', borderRadius: '10px' }}>
                                  {comparisonSetRespondentCounts[compSet.id] ?? 0}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {/* Remove set button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeComparisonSet(compSet.id)
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = '#DC2626'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color = '#9CA3AF'
                                }}
                                style={{
                                  padding: '4px',
                                  backgroundColor: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: '#9CA3AF',
                                  transition: 'color 0.15s ease'
                                }}
                                title="Remove set"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                              {/* Done editing button - only show when editing */}
                              {isEditing && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setAddingFiltersToSetId(null)
                                  }}
                                  style={{
                                    padding: '4px',
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#3A8518'
                                  }}
                                  title="Done editing"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Filters in this set */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {compSet.filters.length === 0 ? (
                              <span style={{ fontSize: '11px', color: '#9CA3AF', fontStyle: 'italic' }}>
                                {isEditing ? 'Select filters below' : 'Click to add filters'}
                              </span>
                            ) : (
                              compSet.filters.map((filter) => (
                                <div
                                  key={`${filter.column}-${filter.value}`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    backgroundColor: '#E8F5E0',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    color: '#3A8518'
                                  }}
                                >
                                  <span>{filter.value}</span>
                                  {isEditing && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      removeFilterFromComparisonSet(compSet.id, filter)
                                    }}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: '0',
                                      display: 'flex',
                                      color: '#3A8518'
                                    }}
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>

                          {/* Filter selection panel when editing */}
                          {isEditing && (
                            <div style={{ marginTop: '12px', padding: '10px', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                              <div style={{ marginBottom: '8px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151' }}>Select filters:</span>
                              </div>
                              <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                                {/* Segment columns - using memoized data */}
                                {Object.entries(segmentFilterData).map(([column, values]) => (
                                  <div key={column} style={{ marginBottom: '8px' }}>
                                    <div style={{ fontSize: '11px', fontWeight: 500, color: '#6B7280', marginBottom: '4px' }}>{column}</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                      {values.map(value => {
                                        const isInSet = compSet.filters.some(f => f.column === column && f.value === value)
                                        return (
                                          <button
                                            key={value}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              if (isInSet) {
                                                removeFilterFromComparisonSet(compSet.id, { column, value })
                                              } else {
                                                addFilterToComparisonSet(compSet.id, { column, value })
                                              }
                                            }}
                                            style={{
                                              padding: '3px 8px',
                                              fontSize: '11px',
                                              backgroundColor: isInSet ? '#3A8518' : '#F3F4F6',
                                              color: isInSet ? 'white' : '#374151',
                                              border: 'none',
                                              borderRadius: '4px',
                                              cursor: 'pointer'
                                            }}
                                          >
                                            {value}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ))}

                                {/* Consumer Questions section */}
                                {availableConsumerQuestions.length > 0 && (() => {
                                  const searchTerm = consumerQuestionSearch[compSet.id] || ''
                                  const searchLower = searchTerm.trim().toLowerCase()
                                  const filteredQuestions = searchLower
                                    ? availableConsumerQuestions.filter(q =>
                                        q.label.toLowerCase().includes(searchLower) ||
                                        q.columns.some(col => col.optionLabel.toLowerCase().includes(searchLower))
                                      )
                                    : availableConsumerQuestions
                                  const isDropdownOpen = consumerQuestionDropdownOpen[compSet.id] || false
                                  const selectedQids = selectedConsumerQuestions[compSet.id] || new Set<string>()
                                  const selectedQuestionsList = availableConsumerQuestions.filter(q => selectedQids.has(q.qid))

                                  return (
                                    <>
                                      <div style={{
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        color: '#9CA3AF',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px',
                                        marginTop: '12px',
                                        marginBottom: '8px',
                                        paddingTop: '8px',
                                        borderTop: '1px solid #E5E7EB'
                                      }}>
                                        Consumer Questions
                                      </div>

                                      {/* Question Dropdown */}
                                      <div id={`consumer-questions-${compSet.id}`} style={{ position: 'relative', marginBottom: '8px' }}>
                                        <div
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            const willOpen = !isDropdownOpen
                                            setConsumerQuestionDropdownOpen(prev => ({ ...prev, [compSet.id]: willOpen }))
                                            // Auto-scroll to show the dropdown when opening
                                            if (willOpen) {
                                              setTimeout(() => {
                                                const element = document.getElementById(`consumer-questions-${compSet.id}`)
                                                element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                              }, 50)
                                            }
                                          }}
                                          style={{
                                            padding: '8px 12px',
                                            border: '1px solid #E5E7EB',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '11px',
                                            backgroundColor: 'white',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            color: '#374151',
                                            transition: 'border-color 0.15s ease',
                                            boxShadow: isDropdownOpen ? '0 0 0 2px rgba(58, 133, 24, 0.2)' : 'none'
                                          }}
                                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3A8518' }}
                                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E5E7EB' }}
                                        >
                                          <span style={{ fontWeight: 500 }}>
                                            {selectedQids.size > 0 ? `${selectedQids.size} question${selectedQids.size > 1 ? 's' : ''} selected` : 'Select questions...'}
                                          </span>
                                          <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="#6B7280"
                                            strokeWidth="2"
                                            style={{
                                              transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                              transition: 'transform 0.2s ease',
                                              flexShrink: 0
                                            }}
                                          >
                                            <path d="M6 9l6 6 6-6" />
                                          </svg>
                                        </div>

                                        {isDropdownOpen && (
                                          <div
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                              position: 'absolute',
                                              top: '100%',
                                              left: 0,
                                              right: 0,
                                              marginTop: '4px',
                                              backgroundColor: 'white',
                                              border: '1px solid #E5E7EB',
                                              borderRadius: '6px',
                                              zIndex: 1000,
                                              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                              overflow: 'hidden'
                                            }}
                                          >
                                            {/* Search Input */}
                                            <div style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
                                              <input
                                                type="text"
                                                placeholder="Search questions..."
                                                value={searchTerm}
                                                onChange={(e) => {
                                                  setConsumerQuestionSearch(prev => ({ ...prev, [compSet.id]: e.target.value }))
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                style={{
                                                  width: '100%',
                                                  padding: '6px 10px',
                                                  fontSize: '11px',
                                                  border: '1px solid #E5E7EB',
                                                  borderRadius: '4px',
                                                  outline: 'none'
                                                }}
                                                onFocus={(e) => {
                                                  e.target.style.borderColor = '#3A8518'
                                                  e.target.style.boxShadow = '0 0 0 2px rgba(58, 133, 24, 0.1)'
                                                }}
                                                onBlur={(e) => {
                                                  e.target.style.borderColor = '#E5E7EB'
                                                  e.target.style.boxShadow = 'none'
                                                }}
                                              />
                                            </div>

                                            {/* Questions List with Checkboxes */}
                                            <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                                              {filteredQuestions.length === 0 ? (
                                                <div style={{ padding: '10px', fontSize: '11px', color: '#6B7280', textAlign: 'center' }}>
                                                  No questions found
                                                </div>
                                              ) : (
                                                filteredQuestions.map(q => {
                                                  const isSelected = selectedQids.has(q.qid)
                                                  return (
                                                    <label
                                                      key={q.qid}
                                                      style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        padding: '8px 10px',
                                                        fontSize: '11px',
                                                        cursor: 'pointer',
                                                        gap: '8px',
                                                        backgroundColor: isSelected ? '#F0FDF4' : 'white'
                                                      }}
                                                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#F9FAFB' }}
                                                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = isSelected ? '#F0FDF4' : 'white' }}
                                                    >
                                                      <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => {
                                                          setSelectedConsumerQuestions(prev => {
                                                            const currentSet = prev[compSet.id] || new Set<string>()
                                                            const newSet = new Set(currentSet)
                                                            if (newSet.has(q.qid)) {
                                                              newSet.delete(q.qid)
                                                            } else {
                                                              newSet.add(q.qid)
                                                            }
                                                            return { ...prev, [compSet.id]: newSet }
                                                          })
                                                        }}
                                                        style={{ cursor: 'pointer', accentColor: '#3A8518' }}
                                                      />
                                                      <span style={{ color: '#374151' }}>{q.label}</span>
                                                    </label>
                                                  )
                                                })
                                              )}
                                            </div>

                                            {/* Done Button */}
                                            <div style={{ padding: '8px', borderTop: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
                                              <button
                                                onClick={() => setConsumerQuestionDropdownOpen(prev => ({ ...prev, [compSet.id]: false }))}
                                                style={{
                                                  width: '100%',
                                                  padding: '6px 12px',
                                                  fontSize: '11px',
                                                  fontWeight: 500,
                                                  backgroundColor: '#3A8518',
                                                  color: 'white',
                                                  border: 'none',
                                                  borderRadius: '4px',
                                                  cursor: 'pointer'
                                                }}
                                              >
                                                Done
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {/* Answer Options for Selected Questions */}
                                      {selectedQuestionsList.map(question => (
                                        <div key={question.qid} style={{ marginBottom: '20px' }}>
                                          <div style={{
                                            fontSize: '11px',
                                            fontWeight: 500,
                                            color: '#374151',
                                            marginBottom: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px'
                                          }}>
                                            <span>{question.label}</span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                setSelectedConsumerQuestions(prev => {
                                                  const currentSet = prev[compSet.id] || new Set<string>()
                                                  const newSet = new Set(currentSet)
                                                  newSet.delete(question.qid)
                                                  return { ...prev, [compSet.id]: newSet }
                                                })
                                              }}
                                              style={{
                                                padding: '0 4px',
                                                fontSize: '10px',
                                                color: '#9CA3AF',
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                lineHeight: 1
                                              }}
                                              title="Remove question"
                                            >
                                              ✕
                                            </button>
                                          </div>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {question.columns.map(col => {
                                              const value = col.optionLabel
                                              const isInSet = compSet.filters.some(f => f.column === question.qid && f.value === value)
                                              return (
                                                <button
                                                  key={value}
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    if (isInSet) {
                                                      removeFilterFromComparisonSet(compSet.id, { column: question.qid, value })
                                                    } else {
                                                      addFilterToComparisonSet(compSet.id, { column: question.qid, value })
                                                    }
                                                  }}
                                                  style={{
                                                    padding: '3px 8px',
                                                    fontSize: '11px',
                                                    backgroundColor: isInSet ? '#3A8518' : '#F3F4F6',
                                                    color: isInSet ? 'white' : '#374151',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer'
                                                  }}
                                                >
                                                  {value}
                                                </button>
                                              )
                                            })}
                                          </div>
                                        </div>
                                      ))}
                                    </>
                                  )
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      )})
                      })()}

                      {/* Add New Set Button */}
                      <button
                        onClick={addComparisonSet}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '10px',
                          backgroundColor: '#F9FAFB',
                          border: '2px dashed #D1D5DB',
                          borderRadius: '8px',
                          color: '#6B7280',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#F3F4F6'
                          e.currentTarget.style.borderColor = '#9CA3AF'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#F9FAFB'
                          e.currentTarget.style.borderColor = '#D1D5DB'
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        Add Comparison Set
                      </button>

                      {/* Clear all button */}
                      {(selections.comparisonSets || []).length > 0 && (
                        <button
                          onClick={() => {
                            setSelections({ comparisonSets: [], multiFilterCompareMode: false })
                            // Also clear consumer question selections
                            setSelectedConsumerQuestions({})
                            setConsumerQuestionDropdownOpen({})
                            setConsumerQuestionSearch({})
                          }}
                          style={{
                            padding: '6px 10px',
                            fontSize: '11px',
                            backgroundColor: '#FEF2F2',
                            border: 'none',
                            borderRadius: '6px',
                            color: '#DC2626',
                            cursor: 'pointer',
                            fontWeight: 500,
                            marginTop: '4px'
                          }}
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col" style={{ gap: '10px' }}>
                {productColumn && productValues.length > 0 && (
                  <section
                    className="rounded-xl bg-white shadow-sm"
                  >
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => toggleSection('products')}
                      style={{
                        padding: '14px 16px',
                        backgroundColor: 'white',
                        borderRadius: '12px',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#E8F5E9'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white'
                      }}
                    >
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#3A8518"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <path d="M16 10a4 4 0 0 1-8 0" />
                        </svg>
                        <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#374151', letterSpacing: '0.025em' }}>Products</h4>
                      </div>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#9CA3AF"
                        strokeWidth="2"
                        className="flex-shrink-0 transition-transform"
                        style={{ transform: expandedSections.has('products') ? 'rotate(180deg)' : 'rotate(0deg)' }}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                    {expandedSections.has('products') && (
                    <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '0 0 12px 12px' }}>
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {/* Select all checkbox */}
                      <label className="flex items-center cursor-pointer" style={{ gap: '10px', marginBottom: '8px' }}>
                        <div
                          onClick={(e) => {
                            e.preventDefault()
                            if (selections.productGroups.length === productValues.length) {
                              handleClearProducts()
                            } else {
                              handleSelectAllProducts()
                            }
                          }}
                          style={{
                            width: '18px',
                            height: '18px',
                            borderRadius: '4px',
                            border: selections.productGroups.length === productValues.length ? '2px solid #3A8518' : '2px solid #D1D5DB',
                            backgroundColor: selections.productGroups.length === productValues.length ? '#3A8518' : 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s ease',
                            flexShrink: 0,
                            cursor: 'pointer'
                          }}
                        >
                          {selections.productGroups.length === productValues.length && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <span style={{ fontSize: '12px', color: '#6B7280', fontFamily: 'Space Grotesk, sans-serif' }}>
                          Select all
                        </span>
                      </label>
                      {orderedProductValues.map((value, index) => (
                        <label
                          key={value}
                          draggable
                          onDragStart={() => handleProductDragStart(index)}
                          onDragOver={(e) => handleProductDragOver(e, index)}
                          onDragEnd={handleProductDragEnd}
                          className="flex items-center cursor-move"
                          style={{
                            gap: '8px',
                            marginBottom: '4px',
                            padding: '4px 0',
                            backgroundColor: draggedProductIndex === index ? '#f3f4f6' : 'transparent',
                            borderRadius: '4px',
                            opacity: draggedProductIndex === index ? 0.5 : 1
                          }}
                        >
                          {/* Row number */}
                          <span style={{ fontSize: '11px', color: '#9ca3af', minWidth: '16px', textAlign: 'right' }}>{index + 1}</span>
                          {/* Drag handle */}
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#9CA3AF"
                            strokeWidth="2"
                            style={{ flexShrink: 0 }}
                          >
                            <path d="M3 8h18M3 16h18" />
                          </svg>
                          <div
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              toggleProductGroup(value)
                            }}
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '4px',
                              border: selections.productGroups.includes(value) ? '2px solid #3A8518' : '2px solid #D1D5DB',
                              backgroundColor: selections.productGroups.includes(value) ? '#3A8518' : 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.15s ease',
                              flexShrink: 0,
                              cursor: 'pointer'
                            }}
                          >
                            {selections.productGroups.includes(value) && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <span style={{ fontSize: '12px', color: '#374151', fontFamily: 'Space Grotesk, sans-serif' }}>{value}</span>
                        </label>
                      ))}
                      {productValues.length === 0 && (
                        <div style={{ fontSize: '12px', color: '#9CA3AF' }}>No product values detected.</div>
                      )}
                    </div>
                    </div>
                    )}
                  </section>
                )}

                {/* Product Buckets Section - Only show when products exist */}
                {productColumn && productValues.length > 0 && (
                  <section
                    className="rounded-xl bg-white shadow-sm"
                  >
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => toggleSection('productBuckets')}
                      style={{
                        padding: '14px 16px',
                        backgroundColor: 'white',
                        borderRadius: '12px',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#FEF3C7'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white'
                      }}
                    >
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#3A8518"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="3" width="7" height="18" rx="1" />
                          <rect x="14" y="3" width="7" height="18" rx="1" />
                          <line x1="5" y1="8" x2="8" y2="8" />
                          <line x1="5" y1="12" x2="8" y2="12" />
                          <line x1="5" y1="16" x2="8" y2="16" />
                          <line x1="16" y1="8" x2="19" y2="8" />
                          <line x1="16" y1="12" x2="19" y2="12" />
                        </svg>
                        <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#374151', letterSpacing: '0.025em' }}>Product Buckets</h4>
                        {/* Status indicator */}
                        {(() => {
                          const validBuckets = (selections.productBuckets || []).filter(b => b.products.length > 0)
                          if (validBuckets.length >= 2 && selections.productBucketMode) {
                            return (
                              <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#E8F5E0', color: '#3A8518', borderRadius: '4px', fontWeight: 500 }}>
                                Active
                              </span>
                            )
                          } else if (validBuckets.length === 1) {
                            return (
                              <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#FEF3C7', color: '#92400E', borderRadius: '4px', fontWeight: 500 }}>
                                Need 1 more
                              </span>
                            )
                          }
                          return null
                        })()}
                      </div>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#3A8518"
                        strokeWidth="2"
                        className="flex-shrink-0 transition-transform"
                        style={{ transform: expandedSections.has('productBuckets') ? 'rotate(180deg)' : 'rotate(0deg)' }}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                    {expandedSections.has('productBuckets') && (
                      <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '0 0 12px 12px' }}>
                        {/* Bucket Mode Toggle - Show when 2+ valid buckets */}
                        {(() => {
                          const validBuckets = (selections.productBuckets || []).filter(b => b.products.length > 0)
                          if (validBuckets.length >= 2) {
                            return (
                              <div style={{ marginBottom: '12px', padding: '10px', backgroundColor: '#F0FDF4', borderRadius: '8px' }}>
                                <div className="flex items-center justify-between">
                                  <span style={{ fontSize: '12px', fontWeight: 500, color: '#374151' }}>View by Buckets</span>
                                  <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
                                    <input
                                      type="checkbox"
                                      checked={selections.productBucketMode ?? false}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        toggleProductBucketMode(e.target.checked)
                                      }}
                                      style={{ opacity: 0, width: 0, height: 0 }}
                                    />
                                    <span
                                      style={{
                                        position: 'absolute',
                                        cursor: 'pointer',
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        bottom: 0,
                                        backgroundColor: selections.productBucketMode ? '#3A8518' : '#D1D5DB',
                                        transition: '0.3s',
                                        borderRadius: '11px'
                                      }}
                                    >
                                      <span
                                        style={{
                                          position: 'absolute',
                                          height: '18px',
                                          width: '18px',
                                          left: selections.productBucketMode ? '20px' : '2px',
                                          top: '2px',
                                          backgroundColor: 'white',
                                          transition: '0.3s',
                                          borderRadius: '50%',
                                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                        }}
                                      />
                                    </span>
                                  </label>
                                </div>
                              </div>
                            )
                          }
                          return null
                        })()}

                        {/* Buckets List */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {(() => {
                            const currentBuckets = selections.productBuckets || []
                            const displayBuckets = currentBuckets.length > 0 ? currentBuckets : [{
                              id: 'default_bucket_1',
                              label: 'Bucket 1',
                              products: []
                            }]
                            const effectiveAddingId = currentBuckets.length === 0 ? 'default_bucket_1' : addingProductsToBucketId

                            return displayBuckets.map((bucket, idx) => {
                              const isEditing = effectiveAddingId === bucket.id || (currentBuckets.length === 0 && idx === 0)
                              return (
                                <div
                                  key={bucket.id}
                                  onClick={(e) => {
                                    if ((e.target as HTMLElement).closest('button')) return
                                    if (!isEditing) {
                                      setAddingProductsToBucketId(bucket.id)
                                    }
                                  }}
                                  style={{
                                    padding: '12px',
                                    backgroundColor: isEditing ? '#FFFBEB' : '#F9FAFB',
                                    borderRadius: '8px',
                                    border: isEditing ? '2px solid #E7CB38' : '1px solid #E5E7EB',
                                    cursor: isEditing ? 'default' : 'pointer',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  {/* Bucket Header */}
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {editingBucketId === bucket.id ? (
                                        <input
                                          type="text"
                                          value={bucketLabelInput}
                                          onChange={(e) => setBucketLabelInput(e.target.value)}
                                          onBlur={() => {
                                            if (bucketLabelInput.trim()) {
                                              updateProductBucketLabel(bucket.id, bucketLabelInput.trim())
                                            }
                                            setEditingBucketId(null)
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              if (bucketLabelInput.trim()) {
                                                updateProductBucketLabel(bucket.id, bucketLabelInput.trim())
                                              }
                                              setEditingBucketId(null)
                                            } else if (e.key === 'Escape') {
                                              setEditingBucketId(null)
                                            }
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          autoFocus
                                          style={{
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#374151',
                                            border: '1px solid #D1D5DB',
                                            borderRadius: '4px',
                                            padding: '2px 6px',
                                            width: '120px'
                                          }}
                                        />
                                      ) : (
                                        <span
                                          style={{ fontSize: '13px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setEditingBucketId(bucket.id)
                                            setBucketLabelInput(bucket.label)
                                          }}
                                          title="Click to edit label"
                                        >
                                          {bucket.label}
                                        </span>
                                      )}
                                      {/* Product count badge */}
                                      {bucket.products.length > 0 && (
                                        <span style={{ fontSize: '10px', padding: '1px 5px', backgroundColor: '#E8F5E0', color: '#3A8518', borderRadius: '10px' }}>
                                          {bucket.products.length}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      {/* Remove bucket button */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          removeProductBucket(bucket.id)
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.color = '#DC2626'
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.color = '#9CA3AF'
                                        }}
                                        style={{
                                          padding: '4px',
                                          backgroundColor: 'transparent',
                                          border: 'none',
                                          cursor: 'pointer',
                                          color: '#9CA3AF',
                                          transition: 'color 0.15s ease'
                                        }}
                                        title="Remove bucket"
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <path d="M18 6L6 18M6 6l12 12" />
                                        </svg>
                                      </button>
                                      {/* Done editing button */}
                                      {isEditing && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setAddingProductsToBucketId(null)
                                          }}
                                          style={{
                                            padding: '4px',
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: '#3A8518'
                                          }}
                                          title="Done editing"
                                        >
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M20 6L9 17l-5-5" />
                                          </svg>
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Products in this bucket */}
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {bucket.products.length === 0 ? (
                                      <span style={{ fontSize: '11px', color: '#9CA3AF', fontStyle: 'italic' }}>
                                        {isEditing ? 'Select products below' : 'Click to add products'}
                                      </span>
                                    ) : (
                                      bucket.products.map((product) => (
                                        <div
                                          key={product}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            padding: '4px 8px',
                                            backgroundColor: '#E8F5E0',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            color: '#3A8518'
                                          }}
                                        >
                                          <span>{product}</span>
                                          {isEditing && (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                removeProductFromBucket(bucket.id, product)
                                              }}
                                              style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '0',
                                                display: 'flex',
                                                color: '#3A8518'
                                              }}
                                            >
                                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                <path d="M18 6L6 18M6 6l12 12" />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      ))
                                    )}
                                  </div>

                                  {/* Product selection panel when editing */}
                                  {isEditing && (
                                    <div style={{ marginTop: '12px', padding: '10px', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                                      <div style={{ marginBottom: '8px' }}>
                                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151' }}>Select products:</span>
                                      </div>
                                      <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {productValues.map(product => {
                                          const isInBucket = bucket.products.includes(product)
                                          return (
                                            <button
                                              key={product}
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                if (isInBucket) {
                                                  removeProductFromBucket(bucket.id, product)
                                                } else {
                                                  addProductToBucket(bucket.id, product)
                                                }
                                              }}
                                              style={{
                                                padding: '4px 10px',
                                                fontSize: '11px',
                                                backgroundColor: isInBucket ? '#3A8518' : '#F3F4F6',
                                                color: isInBucket ? 'white' : '#374151',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease'
                                              }}
                                              onMouseEnter={(e) => {
                                                if (!isInBucket) {
                                                  e.currentTarget.style.backgroundColor = '#E5E7EB'
                                                }
                                              }}
                                              onMouseLeave={(e) => {
                                                if (!isInBucket) {
                                                  e.currentTarget.style.backgroundColor = '#F3F4F6'
                                                }
                                              }}
                                            >
                                              {product}
                                            </button>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })
                          })()}

                          {/* Add New Bucket Button */}
                          <button
                            onClick={addProductBucket}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              padding: '10px',
                              backgroundColor: '#F9FAFB',
                              border: '2px dashed #D1D5DB',
                              borderRadius: '8px',
                              color: '#6B7280',
                              fontSize: '13px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#F3F4F6'
                              e.currentTarget.style.borderColor = '#9CA3AF'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#F9FAFB'
                              e.currentTarget.style.borderColor = '#D1D5DB'
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            Add Bucket
                          </button>

                          {/* Clear all button */}
                          {(selections.productBuckets || []).length > 0 && (
                            <button
                              onClick={() => {
                                setSelections({ productBuckets: [], productBucketMode: false })
                                setAddingProductsToBucketId(null)
                              }}
                              style={{
                                padding: '6px 10px',
                                fontSize: '11px',
                                backgroundColor: '#FEF2F2',
                                border: 'none',
                                borderRadius: '6px',
                                color: '#DC2626',
                                cursor: 'pointer',
                                fontWeight: 500,
                                marginTop: '4px'
                              }}
                            >
                              Clear All Buckets
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                <section
                  className="rounded-xl bg-white shadow-sm"
                >
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => toggleSection('display')}
                    style={{
                      padding: '14px 16px',
                      backgroundColor: 'white',
                      borderRadius: '12px',
                      transition: 'background-color 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#E8F5E9'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'white'
                    }}
                  >
                    <div className="flex items-center" style={{ gap: '10px' }}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#3A8518"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="13.5" cy="6.5" r="2.5" />
                        <circle cx="6" cy="12" r="2.5" />
                        <circle cx="18" cy="12" r="2.5" />
                        <circle cx="8.5" cy="18.5" r="2.5" />
                        <circle cx="15.5" cy="18.5" r="2.5" />
                      </svg>
                      <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#374151', letterSpacing: '0.025em' }}>Display</h4>
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#9CA3AF"
                      strokeWidth="2"
                      className="flex-shrink-0 transition-transform"
                      style={{ transform: expandedSections.has('display') ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                  {expandedSections.has('display') && (
                  <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '0 0 12px 12px' }}>
                    {/* Container Toggle */}
                    <div style={{ marginBottom: '12px' }}>
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={selections.showContainer ?? true}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ showContainer: e.target.checked })
                            }}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span
                            className="slider round"
                            style={{
                              position: 'absolute',
                              cursor: 'pointer',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: selections.showContainer ? '#3A8518' : '#D1D5DB',
                              transition: '0.3s',
                              borderRadius: '11px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '18px',
                                width: '18px',
                                left: selections.showContainer ? '20px' : '2px',
                                top: '2px',
                                backgroundColor: 'white',
                                transition: '0.3s',
                                borderRadius: '50%',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          style={{
                            color: selections.showContainer ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Container
                        </span>
                      </div>
                    </div>
                    {/* Segment Toggle */}
                    <div style={{ marginBottom: '12px' }}>
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={selections.showSegment ?? true}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ showSegment: e.target.checked })
                            }}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span
                            className="slider round"
                            style={{
                              position: 'absolute',
                              cursor: 'pointer',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: selections.showSegment ? '#3A8518' : '#D1D5DB',
                              transition: '0.3s',
                              borderRadius: '11px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '18px',
                                width: '18px',
                                left: selections.showSegment ? '20px' : '2px',
                                top: '2px',
                                backgroundColor: 'white',
                                transition: '0.3s',
                                borderRadius: '50%',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          style={{
                            color: selections.showSegment ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Segment
                        </span>
                      </div>
                    </div>
                    {/* Question Type Toggle */}
                    <div style={{ marginBottom: '16px' }}>
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={selections.showQuestionType ?? true}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ showQuestionType: e.target.checked })
                            }}
                            style={{ opacity: 0, width: 0, height: 0 }}
                          />
                          <span
                            className="slider round"
                            style={{
                              position: 'absolute',
                              cursor: 'pointer',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: selections.showQuestionType ? '#3A8518' : '#D1D5DB',
                              transition: '0.3s',
                              borderRadius: '11px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '18px',
                                width: '18px',
                                left: selections.showQuestionType ? '20px' : '2px',
                                top: '2px',
                                backgroundColor: 'white',
                                transition: '0.3s',
                                borderRadius: '50%',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          style={{
                            color: selections.showQuestionType ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Question Type
                        </span>
                      </div>
                    </div>
                    {/* Colors Collapsible Section */}
                    <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '12px' }}>
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => {
                          const newExpanded = new Set(expandedDisplayGroups)
                          if (newExpanded.has('colors')) {
                            newExpanded.delete('colors')
                          } else {
                            newExpanded.add('colors')
                          }
                          setExpandedDisplayGroups(newExpanded)
                        }}
                        style={{
                          padding: '8px 0',
                          marginBottom: expandedDisplayGroups.has('colors') ? '12px' : '0'
                        }}
                      >
                        <div className="flex items-center" style={{ gap: '8px' }}>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#3A8518"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <circle cx="12" cy="12" r="6" />
                            <circle cx="12" cy="12" r="2" />
                          </svg>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Chart Colors</span>
                        </div>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#9CA3AF"
                          strokeWidth="2"
                          className="flex-shrink-0 transition-transform"
                          style={{ transform: expandedDisplayGroups.has('colors') ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </div>
                      {expandedDisplayGroups.has('colors') && (
                        <>
                          {/* Default Toggle */}
                          <div style={{ marginBottom: '12px' }}>
                            <div className="flex items-center" style={{ gap: '10px' }}>
                              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={(() => {
                                    const defaultColors = ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']
                                    const currentColors = selections.chartColors || defaultColors
                                    return JSON.stringify(currentColors) === JSON.stringify(defaultColors)
                                  })()}
                                  onChange={(e) => {
                                    e.stopPropagation()
                                    if (e.target.checked) {
                                      setSelections({ chartColors: ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7'] })
                                    }
                                  }}
                                  style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span
                                  className="slider round"
                                  style={{
                                    position: 'absolute',
                                    cursor: 'pointer',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    backgroundColor: (() => {
                                      const defaultColors = ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']
                                      const currentColors = selections.chartColors || defaultColors
                                      return JSON.stringify(currentColors) === JSON.stringify(defaultColors) ? '#3A8518' : '#D1D5DB'
                                    })(),
                                    transition: '0.3s',
                                    borderRadius: '11px'
                                  }}
                                >
                                  <span
                                    style={{
                                      position: 'absolute',
                                      content: '""',
                                      height: '18px',
                                      width: '18px',
                                      left: (() => {
                                        const defaultColors = ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']
                                        const currentColors = selections.chartColors || defaultColors
                                        return JSON.stringify(currentColors) === JSON.stringify(defaultColors) ? '20px' : '2px'
                                      })(),
                                      top: '2px',
                                      backgroundColor: 'white',
                                      transition: '0.3s',
                                      borderRadius: '50%',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                    }}
                                  />
                                </span>
                              </label>
                              <span
                                style={{
                                  color: (() => {
                                    const defaultColors = ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']
                                    const currentColors = selections.chartColors || defaultColors
                                    return JSON.stringify(currentColors) === JSON.stringify(defaultColors) ? '#374151' : '#6B7280'
                                  })(),
                                  fontSize: '13px',
                                  fontWeight: 500
                                }}
                              >
                                Default
                              </span>
                            </div>
                          </div>
                          {/* Color Pickers */}
                          <div className="flex flex-col" style={{ gap: '10px' }}>
                            {(selections.chartColors || ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088']).slice(0, 6).map((color, index) => (
                              <div key={index} className="flex items-center" style={{ gap: '10px' }}>
                                <label className="cursor-pointer">
                                  <div
                                    style={{
                                      backgroundColor: color,
                                      width: '36px',
                                      height: '36px',
                                      minWidth: '36px',
                                      minHeight: '36px',
                                      borderRadius: '8px',
                                      border: '1px solid #E5E7EB',
                                      cursor: 'pointer',
                                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}
                                  />
                                  <input
                                    type="color"
                                    value={color}
                                    onChange={(e) => {
                                      const newColors = [...(selections.chartColors || ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7'])]
                                      newColors[index] = e.target.value.toUpperCase()
                                      setSelections({ chartColors: newColors })
                                    }}
                                    style={{
                                      opacity: 0,
                                      position: 'absolute',
                                      pointerEvents: 'none',
                                      width: 0,
                                      height: 0
                                    }}
                                  />
                                </label>
                                <input
                                  type="text"
                                  value={color.toUpperCase()}
                                  onChange={(e) => {
                                    const value = e.target.value.trim()
                                    // Auto-add # if not present
                                    const hexValue = value.startsWith('#') ? value : `#${value}`
                                    // Validate hex code
                                    if (/^#[0-9A-Fa-f]{6}$/.test(hexValue)) {
                                      const newColors = [...(selections.chartColors || ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7'])]
                                      newColors[index] = hexValue.toUpperCase()
                                      setSelections({ chartColors: newColors })
                                    }
                                  }}
                                  style={{
                                    width: '90px',
                                    fontSize: '12px',
                                    fontFamily: 'monospace',
                                    textAlign: 'center',
                                    padding: '8px 10px',
                                    border: '1px solid #E5E7EB',
                                    borderRadius: '8px',
                                    outline: 'none',
                                    transition: 'border-color 0.15s ease'
                                  }}
                                  onFocus={(e) => {
                                    e.target.style.borderColor = '#3A8518'
                                  }}
                                  onBlur={(e) => {
                                    e.target.style.borderColor = '#E5E7EB'
                                  }}
                                  placeholder="#000000"
                                />
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  )}
                </section>

                {/* Apples-to-Apples Button - Bottom of sidebar */}
                <div style={{ padding: '16px', marginTop: '8px' }}>
                  <button
                    onClick={() => setShowRegressionPanel(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      width: '100%',
                      padding: '12px 16px',
                      backgroundColor: '#FFFFFF',
                      border: '1px solid rgba(58, 133, 24, 0.25)',
                      borderRadius: '10px',
                      color: '#3A8518',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontFamily: 'Space Grotesk, sans-serif',
                      transition: 'all 0.15s ease-out',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.1)'
                      e.currentTarget.style.borderColor = 'rgba(58, 133, 24, 0.4)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#FFFFFF'
                      e.currentTarget.style.borderColor = 'rgba(58, 133, 24, 0.25)'
                    }}
                    title="Run apples-to-apples comparison controlling for demographics"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                      <path d="m14 8 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                      <path d="M7 21h10" />
                      <path d="M12 3v18" />
                      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
                    </svg>
                    Apples-to-Apples
                  </button>
                </div>

              </div>
            </>
          )}
            </aside>
            {/* Resize Handle */}
            <div
              onMouseDown={handleResizeMouseDown}
              style={{
                position: 'fixed',
                left: `${sidebarWidth}px`,
                top: '72px',
                width: '4px',
                height: 'calc(100vh - 72px)',
                cursor: 'col-resize',
                backgroundColor: 'transparent',
                zIndex: 51,
                transition: isResizing ? 'none' : 'left 0.3s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#80BDFF'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            />
          </>
        )}

        {/* Scrollable Main Content Panel */}
        <main
          className="overflow-y-auto overflow-x-hidden"
          style={{
            position: 'fixed',
            top: '72px',
            left: sidebarVisible ? `${sidebarWidth}px` : '0',
            width: sidebarVisible ? `calc(100vw - ${sidebarWidth}px)` : '100vw',
            height: 'calc(100vh - 72px)',
            backgroundColor: '#FFFFFF',
            transition: 'left 0.3s ease, width 0.3s ease'
          }}
        >
          <div className="pt-4 pb-4" style={{ paddingLeft: '40px', paddingRight: '40px' }}>
            <div ref={chartGalleryRef} className="rounded-2xl bg-white p-3 shadow-sm min-h-[460px]">
              {dataset ? (
                filteredDataset && ((selections.segments && selections.segments.length > 0) || (selections.segmentColumn && orderedGroups.length > 0)) ? (
                  <ChartGallery
                    questions={filteredQuestions}
                    dataset={filteredDataset!}
                    segmentColumn={selections.segmentColumn}
                    groups={orderedGroups}
                    segments={selections.segments}
                    comparisonMode={selections.comparisonMode ?? true}
                    multiFilterCompareMode={selections.multiFilterCompareMode || false}
                    comparisonSets={selections.comparisonSets || []}
                    groupLabels={selections.groupLabels || EMPTY_OBJECT}
                    orientation={chartOrientation}
                    sortOrder={selections.sortOrder}
                    selectedQuestionId={selections.question}
                    filterSignificantOnly={statSigFilter === 'statSigOnly'}
                    showAsterisks={selections.showAsterisks ?? true}
                    showContainer={selections.showContainer ?? true}
                    showSegment={selections.showSegment ?? true}
                    showQuestionType={selections.showQuestionType ?? true}
                    chartColors={selections.chartColors || DEFAULT_CHART_COLORS}
                    optionLabels={selections.optionLabels || EMPTY_NESTED_OBJECT}
                    onSaveOptionLabel={handleSaveOptionLabel}
                    questionLabels={selections.questionLabels || EMPTY_OBJECT}
                    onSaveQuestionLabel={handleSaveQuestionLabel}
                    productOrder={selections.productOrder?.length ? selections.productOrder : orderedProductValues}
                    productBuckets={selections.productBuckets || []}
                    productBucketMode={selections.productBucketMode || false}
                    productColumn={productColumn}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-brand-gray/60">
                    Select at least one segment group to render charts.
                  </div>
                )
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-brand-gray/60">
                  Upload a CSV to explore your results.
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Regression Analysis Panel */}
      {showRegressionPanel && dataset && dataset.questions.length > 0 && (
        <RegressionAnalysisPanel
          dataset={dataset}
          questions={dataset.questions}
          currentSegments={selections.segments || []}
          onClose={() => setShowRegressionPanel(false)}
        />
      )}
    </div>
  )
}
