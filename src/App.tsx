import React, { useEffect, useMemo, useState, useRef, useTransition, useCallback } from 'react'
import { CSVUpload, type CSVUploadHandle } from './components/CSVUpload'
import { useORAStore } from './store'
import type { QuestionDef } from './types'
import { buildSeries } from './dataCalculations'
import { ChartGallery } from './components/ChartGallery'
import { RegressionAnalysisPanel } from './components/RegressionAnalysisPanel'

// Performance: Disable console logs in production
const isDev = process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}

const EXCLUDED_VALUES = ['other', 'not specified', 'none of the above', 'skip']

function isExcludedValue(value: string) {
  const normalized = value.trim().toLowerCase().replace(/["']/g, '')
  return EXCLUDED_VALUES.some(ex => normalized === ex || normalized.includes(ex))
}

function stripQuotesFromValue(value: string): string {
  let result = value.trim()
  // Strip leading and trailing quotes (both single and double)
  if ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1)
  }
  return result
}

function autoDefaultGroups(rows: any[], segCol?: string, maxDefaults = 2): string[] {
  if (!segCol) return []
  if (segCol === 'Overall') return ['Overall']
  const vals = Array.from(new Set(rows.map(r => stripQuotesFromValue(String(r[segCol])))))
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
  // Remove "-[timestamp].csv" pattern at the end of file names
  return fileName.replace(/-\d+\.csv$/, '.csv')
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

// Filter out zipcode and free text questions
function shouldIncludeQuestion(question: QuestionDef): boolean {
  const labelLower = question.label.toLowerCase()

  // Filter out zipcode questions
  if (labelLower.includes('zip') || labelLower.includes('postal')) {
    devLog(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): zipcode`)
    return false
  }

  // Always include multi, single, scale, and ranking questions even if their labels contain tokens
  const labelHasTypeToken = ['(multi)', '(single)', '(scale)', '(ranking)'].some(token => labelLower.includes(token))
  if (labelHasTypeToken) {
    devLog(`[FILTER] ✅ Including ${question.qid} (${question.type}): type token in label`)
    return true
  }

  // Treat questions containing "(text)" in the label or column headers as free-text, exclude them
  if (labelLower.includes('(text)')) {
    devLog(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): text in label`)
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
  const [sidebarWidth, setSidebarWidth] = useState(288)
  const [isResizing, setIsResizing] = useState(false)
  const [editingSegment, setEditingSegment] = useState<string | null>(null)
  const [segmentInput, setSegmentInput] = useState('')
  const segmentInputRef = useRef<HTMLInputElement>(null)
  const questionDropdownRef = useRef<HTMLDivElement>(null)
  const csvUploadRef = useRef<CSVUploadHandle>(null)
  const [expandedSegmentGroups, setExpandedSegmentGroups] = useState<Set<string>>(new Set())
  const [questionDropdownOpen, setQuestionDropdownOpen] = useState(false)
  const [questionSearchTerm, setQuestionSearchTerm] = useState('')
  const [expandedQuestionSegments, setExpandedQuestionSegments] = useState<Set<string>>(new Set())
  const [showRegressionPanel, setShowRegressionPanel] = useState(false)

  // Performance: Use transition for non-urgent updates to keep UI responsive
  const [isPending, startTransition] = useTransition()

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
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['segmentation'])
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
                const rowValue = stripQuotesFromValue(String(row[consumerQuestion.singleSourceColumn]))
                return values.some(value => stripQuotesFromValue(value) === rowValue)
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
              const rowValue = stripQuotesFromValue(String(row[column]))
              // Match if row value equals ANY of the selected values in this category (OR logic)
              return values.some(value => rowValue === stripQuotesFromValue(value))
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
    const values = Array.from(new Set(rows.map(r => stripQuotesFromValue(String(r[selections.segmentColumn!])))))
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

    // In Compare mode: rows doesn't have segment filtering, so count includes all compared segments
    // In Filter mode: rows has segment filtering applied, so just count those rows
    // But we still need to apply segment filtering here for Compare mode to show union of selected segments
    let filteredRows = rows
    const selectedSegments = selections.segments || []

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

      // Filter rows where they match at least one value from EACH column group (AND across columns, OR within column)
      filteredRows = rows.filter(row => {
        // If Overall is selected alone, include all rows
        const hasOverall = selectedSegments.some(seg => seg.column === 'Overall')
        if (hasOverall && segmentsByColumn.size === 0) return true

        // If no segments (only Overall), include all rows
        if (segmentsByColumn.size === 0) return true

        // Check if row matches criteria for each column group
        return Array.from(segmentsByColumn.entries()).every(([column, values]) => {
          // Check if this column is a consumer question
          const consumerQuestion = dataset.questions.find(q => q.qid === column)

          if (consumerQuestion) {
            // Consumer question - use appropriate filtering logic
            if (consumerQuestion.type === 'single' && consumerQuestion.singleSourceColumn) {
              // Single-select: check if row's value matches any of the selected values
              const rowValue = stripQuotes(String(row[consumerQuestion.singleSourceColumn]))
              return values.some(value => stripQuotes(value) === rowValue)
            } else if (consumerQuestion.type === 'multi') {
              // Multi-select: check if any of the selected options' columns are truthy
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
            // Regular segment column: check if row's value matches any of the selected values
            const rowValue = stripQuotes(String(row[column]))
            return values.some(value => stripQuotes(value) === rowValue)
          }
        })
      })

      devLog('[RESPONDENT COUNT] Filtered rows:', filteredRows.length, 'out of', rows.length)
    }

    const uniqueRespondents = uniq(
      filteredRows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean)
    )
    devLog('[RESPONDENT COUNT] Unique respondents:', uniqueRespondents.length)
    return uniqueRespondents.length
  }, [dataset, rows, selections.segments])

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

        // If selecting Overall, remove all other segments
        if (value === 'Overall') {
          setSelections({ segments: [{ column: 'Overall', value: 'Overall' }] })
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

  const handleSaveQuestionLabel = (qid: string, newLabel: string) => {
    if (!newLabel.trim()) return
    console.log('Saving question label:', { qid, newLabel: newLabel.trim(), currentLabels: selections.questionLabels })
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

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = e.clientX
      if (newWidth >= 200 && newWidth <= 600) {
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
          className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6"
          style={{ paddingTop: '60px', paddingBottom: '60px' }}
        >
          {/* Hero Section */}
          <div className="text-center" style={{ marginBottom: '48px' }}>
            <h1
              style={{
                fontSize: '56px',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #3A8518 0%, #166534 50%, #14532d 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                marginBottom: '16px',
                letterSpacing: '-1px',
                fontFamily: 'Space Grotesk, sans-serif'
              }}
            >
              ORA
            </h1>
            <p
              style={{
                fontSize: '20px',
                color: '#4B5563',
                fontWeight: 400,
                maxWidth: '500px',
                lineHeight: 1.6,
                fontFamily: 'Space Grotesk, sans-serif'
              }}
            >
              Transform survey data into actionable insights with beautiful visualizations
            </p>
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

          {/* Feature highlights */}
          <div
            style={{
              display: 'flex',
              gap: '24px',
              marginTop: '64px',
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}
          >
            {/* Smart Charts */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                padding: '24px 28px',
                textAlign: 'center',
                minWidth: '180px'
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="12" width="4" height="9" rx="1" fill="#3A8518" />
                  <rect x="10" y="8" width="4" height="13" rx="1" fill="#A5CF8E" />
                  <rect x="17" y="4" width="4" height="17" rx="1" fill="#E7CB38" />
                </svg>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                Smart Charts
              </div>
              <div style={{ fontSize: '12px', color: '#6B7280' }}>
                Auto-generated visualizations
              </div>
            </div>

            {/* Statistical Analysis */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                padding: '24px 28px',
                textAlign: 'center',
                minWidth: '180px'
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="9" stroke="#DC2626" strokeWidth="2" fill="white" />
                  <circle cx="12" cy="12" r="6" stroke="#DC2626" strokeWidth="2" fill="white" />
                  <circle cx="12" cy="12" r="3" fill="#DC2626" />
                  <path d="M12 3V1" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" />
                  <path d="M20 8L22 6" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="22" cy="5" r="2" fill="#22C55E" />
                </svg>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                Statistical Analysis
              </div>
              <div style={{ fontSize: '12px', color: '#6B7280' }}>
                Chi-square significance testing
              </div>
            </div>

            {/* Segment Comparison */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                padding: '24px 28px',
                textAlign: 'center',
                minWidth: '180px'
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1F2937', marginBottom: '4px' }}>
                Segment Comparison
              </div>
              <div style={{ fontSize: '12px', color: '#6B7280' }}>
                Compare groups side-by-side
              </div>
            </div>
          </div>
        </div>

        {/* CSS animation for floating orbs */}
        <style>{`
          @keyframes float {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(30px, -30px) scale(1.05); }
            66% { transform: translate(-20px, 20px) scale(0.95); }
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
            {/* Apples-to-Apples Comparison Button */}
            {dataset && (
              <button
                onClick={() => setShowRegressionPanel(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '12px 24px',
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
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                  <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                  <path d="M7 21h10" />
                  <path d="M12 3v18" />
                  <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
                </svg>
                Apples-to-Apples
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
                      <span className="font-semibold">{filteredRespondentCount.toLocaleString()}</span>
                      <span style={{ color: '#6B7280' }}> of {summary.uniqueRespondents.toLocaleString()} respondents</span>
                    </span>
                  </div>

                  {/* Active Filters */}
                  {(() => {
                    const activeFilters: Array<{type: 'segment' | 'product', column?: string, value: string, label: string}> = []

                    // Add segment filters (excluding Overall for chip display)
                    const selectedSegments = selections.segments || []
                    selectedSegments.forEach(segment => {
                      if (segment.value !== 'Overall') {
                        activeFilters.push({
                          type: 'segment',
                          column: segment.column,
                          value: segment.value,
                          label: getGroupDisplayLabel(segment.value)
                        })
                      }
                    })

                    // Add product filters
                    if (productColumn && selections.productGroups.length > 0 && selections.productGroups.length < productValues.length) {
                      selections.productGroups.forEach(product => {
                        activeFilters.push({
                          type: 'product',
                          value: product,
                          label: product
                        })
                      })
                    }

                    if (activeFilters.length === 0) return null

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
                        {/* Filter Chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', width: '100%' }}>
                          {activeFilters.map((filter, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 12px',
                                backgroundColor: '#F0FDF4',
                                borderRadius: '8px',
                                fontSize: '12px',
                                color: '#374151'
                              }}
                            >
                              <span>{filter.label}</span>
                              <button
                                onClick={() => {
                                  if (filter.type === 'segment' && filter.column) {
                                    toggleSegment(filter.column, filter.value)
                                  } else if (filter.type === 'product') {
                                    toggleProductGroup(filter.value)
                                  }
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '0',
                                  display: 'flex',
                                  alignItems: 'center',
                                  color: '#6b7280'
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Clear All + Compare Toggle Row */}
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

                          {/* Compare Toggle */}
                          <div className="flex items-center" style={{ gap: '6px' }}>
                            <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
                              <input
                                type="checkbox"
                                checked={selections.comparisonMode ?? true}
                                onChange={(e) => {
                                  e.stopPropagation()
                                  const newComparisonMode = !selections.comparisonMode
                                  // In filter mode, enable hideAsterisks by default (hide stat sig asterisks)
                                  // In compare mode, disable hideAsterisks by default (show stat sig asterisks)
                                  setSelections({
                                    comparisonMode: newComparisonMode,
                                    hideAsterisks: !newComparisonMode  // true for filter mode, false for compare mode
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
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>

              <div className="flex flex-col" style={{ gap: '10px' }}>
                <section
                  className="rounded-xl bg-white shadow-sm"
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
                        const val = stripQuotesFromValue(String(r[column]))
                        if (val) {
                          valueCounts.set(val, (valueCounts.get(val) || 0) + 1)
                        }
                      })

                      const MIN_RESPONDENTS_FOR_SEGMENT = 10
                      const rawValues = Array.from(new Set(rowsRaw.map(r => stripQuotesFromValue(String(r[column])))))
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
                                            <label
                                              htmlFor={segmentKey}
                                              style={{
                                                fontSize: '11px',
                                                cursor: 'pointer',
                                                color: '#6B7280'
                                              }}
                                            >
                                              {col.optionLabel}
                                            </label>
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
                                if (newStatSigFilter === 'all') {
                                  setSelections({ statSigFilter: newStatSigFilter, hideAsterisks: false })
                                } else {
                                  setSelections({ statSigFilter: newStatSigFilter })
                                }
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
                            checked={selections.hideAsterisks || false}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ hideAsterisks: e.target.checked })
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
                              backgroundColor: selections.hideAsterisks ? '#3A8518' : '#D1D5DB',
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
                                left: selections.hideAsterisks ? '20px' : '2px',
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
                            color: selections.hideAsterisks ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Hide Asterisks
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
                            checked={selections.hideAsterisks || false}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ hideAsterisks: e.target.checked })
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
                              backgroundColor: selections.hideAsterisks ? '#3A8518' : '#D1D5DB',
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
                                left: selections.hideAsterisks ? '20px' : '2px',
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
                            color: selections.hideAsterisks ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Hide Asterisks
                        </span>
                      </div>
                    </div>
                  )}
                  </div>
                  )}
                </section>

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
                    {/* Hide Segment Toggle */}
                    <div style={{ marginBottom: '12px' }}>
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={selections.hideSegment || false}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ hideSegment: e.target.checked })
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
                              backgroundColor: selections.hideSegment ? '#3A8518' : '#D1D5DB',
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
                                left: selections.hideSegment ? '20px' : '2px',
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
                            color: selections.hideSegment ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Hide Segment
                        </span>
                      </div>
                    </div>
                    {/* Hide Question Type Toggle */}
                    <div style={{ marginBottom: '16px' }}>
                      <div className="flex items-center" style={{ gap: '10px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px', flexShrink: 0 }}>
                          <input
                            type="checkbox"
                            checked={selections.hideQuestionType || false}
                            onChange={(e) => {
                              e.stopPropagation()
                              setSelections({ hideQuestionType: e.target.checked })
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
                              backgroundColor: selections.hideQuestionType ? '#3A8518' : '#D1D5DB',
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
                                left: selections.hideQuestionType ? '20px' : '2px',
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
                            color: selections.hideQuestionType ? '#374151' : '#6B7280',
                            fontSize: '13px',
                            fontWeight: 500
                          }}
                        >
                          Hide Question Type
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
            <div className="rounded-2xl bg-white p-3 shadow-sm min-h-[460px]">
              {dataset ? (
                filteredDataset && ((selections.segments && selections.segments.length > 0) || (selections.segmentColumn && orderedGroups.length > 0)) ? (
                  <ChartGallery
                    questions={filteredQuestions}
                    dataset={filteredDataset!}
                    segmentColumn={selections.segmentColumn}
                    groups={orderedGroups}
                    segments={selections.segments}
                    comparisonMode={selections.comparisonMode ?? true}
                    groupLabels={selections.groupLabels || {}}
                    orientation={chartOrientation}
                    sortOrder={selections.sortOrder}
                    selectedQuestionId={selections.question}
                    filterSignificantOnly={statSigFilter === 'statSigOnly'}
                    hideAsterisks={selections.hideAsterisks || false}
                    hideSegment={selections.hideSegment || false}
                    hideQuestionType={selections.hideQuestionType || false}
                    chartColors={selections.chartColors || ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']}
                    optionLabels={selections.optionLabels || {}}
                    onSaveOptionLabel={handleSaveOptionLabel}
                    questionLabels={selections.questionLabels || {}}
                    onSaveQuestionLabel={handleSaveQuestionLabel}
                    productOrder={selections.productOrder || []}
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
