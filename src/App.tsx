import React, { useEffect, useMemo, useState, useRef } from 'react'
import { CSVUpload } from './components/CSVUpload'
import { useORAStore } from './store'
import { QuestionDef, SortOrder } from './types'
import { buildSeries } from './dataCalculations'
import { ChartGallery } from './components/ChartGallery'

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

  // For Gender, exclude "Prefer not to say" from defaults
  const filteredVals = segCol === 'Gender'
    ? vals.filter(v => v.toLowerCase() !== 'prefer not to say')
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

// Filter for segmentation dropdown: exclude ranking and sentiment questions
function shouldIncludeInSegmentation(question: QuestionDef, rows: any[]): boolean {
  // Exclude ranking questions
  if (question.type === 'ranking') {
    return false
  }

  // Exclude sentiment/Likert questions
  if (question.isLikert) {
    return false
  }

  return true
}

// Filter out zipcode and free text questions
function shouldIncludeQuestion(question: QuestionDef): boolean {
  const labelLower = question.label.toLowerCase()

  // Filter out zipcode questions
  if (labelLower.includes('zip') || labelLower.includes('postal')) {
    console.log(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): zipcode`)
    return false
  }

  // Always include multi, single, scale, and ranking questions even if their labels contain tokens
  const labelHasTypeToken = ['(multi)', '(single)', '(scale)', '(ranking)'].some(token => labelLower.includes(token))
  if (labelHasTypeToken) {
    console.log(`[FILTER] ✅ Including ${question.qid} (${question.type}): type token in label`)
    return true
  }

  // Treat questions containing "(text)" in the label or column headers as free-text, exclude them
  if (labelLower.includes('(text)')) {
    console.log(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): text in label`)
    return false
  }

  const columnHasTextToken = question.columns.some(col => col.header.toLowerCase().includes('(text)') || col.optionLabel.toLowerCase().includes('(text)'))
  if (columnHasTextToken) {
    console.log(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): text in column`)
    return false
  }

  if (question.singleSourceColumn) {
    const singleLower = question.singleSourceColumn.toLowerCase()
    if (singleLower.includes('(text)')) {
      console.log(`[FILTER] ❌ Excluding ${question.qid} (${question.type}): text in source column`)
      return false
    }
    if (['(multi)', '(single)', '(scale)', '(ranking)'].some(token => singleLower.includes(token))) {
      console.log(`[FILTER] ✅ Including ${question.qid} (${question.type}): type token in source`)
      return true
    }
  }

  console.log(`[FILTER] ✅ Including ${question.qid} (${question.type}): passed all checks`)
  return true
}

export default function App() {
  const { dataset, selections, setSelections } = useORAStore()
  const [chartOrientation, setChartOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(288)
  const [isResizing, setIsResizing] = useState(false)
  const [editingSegment, setEditingSegment] = useState<string | null>(null)
  const [segmentInput, setSegmentInput] = useState('')
  const segmentInputRef = useRef<HTMLInputElement>(null)
  const [expandedSegmentGroups, setExpandedSegmentGroups] = useState<Set<string>>(new Set())
  const [questionDropdownOpen, setQuestionDropdownOpen] = useState(false)
  const [questionSearchTerm, setQuestionSearchTerm] = useState('')
  const [expandedQuestionSegments, setExpandedQuestionSegments] = useState<Set<string>>(new Set())

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
    return [...dataset.questions]
      .filter(q => shouldIncludeInSegmentation(q, rowsRaw))
  }, [dataset, rowsRaw])

  // Filter segmentation questions based on search term (search in both question label and answer options)
  const filteredSegmentationQuestions = useMemo(() => {
    if (!questionSearchTerm.trim()) return segmentationQuestions
    const searchLower = questionSearchTerm.toLowerCase()
    return segmentationQuestions.filter(q => {
      // Search in question label
      if (q.label.toLowerCase().includes(searchLower)) return true
      // Search in answer options
      return q.columns.some(col => col.optionLabel.toLowerCase().includes(searchLower))
    })
  }, [segmentationQuestions, questionSearchTerm])

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
    let filtered = rowsRaw

    // Apply product filter
    if (!useAllProducts) {
      filtered = filtered.filter(row =>
        selections.productGroups.includes(normalizeProductValue(row[selections.productColumn!]))
      )
    }

    // Apply segment filters with AND logic between categories, OR logic within categories
    // Only apply filtering in Filter mode (comparisonMode = false)
    const isFilterMode = !(selections.comparisonMode ?? true)
    if (isFilterMode && selections.segments && selections.segments.length > 0) {
      // Filter out "Overall" segments as they don't apply filtering
      const actualSegments = selections.segments.filter(seg => seg.value !== 'Overall')

      if (actualSegments.length > 0) {
        // Group segments by column (category)
        const segmentsByColumn = actualSegments.reduce((acc, segment) => {
          if (!acc[segment.column]) {
            acc[segment.column] = []
          }
          acc[segment.column].push(segment.value)
          return acc
        }, {} as Record<string, string[]>)

        filtered = filtered.filter(row => {
          // Row must match at least one value from each category (AND between categories, OR within)
          return Object.entries(segmentsByColumn).every(([column, values]) => {
            const rowValue = stripQuotesFromValue(String(row[column]))
            // Match if row value equals ANY of the selected values in this category (OR logic)
            return values.some(value => rowValue === stripQuotesFromValue(value))
          })
        })
      }
    }

    return filtered
  }, [useAllProducts, rowsRaw, selections.productGroups, selections.productColumn, selections.segments, selections.comparisonMode])

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

    // Filter rows by selected segments using the SAME logic as dataCalculations.ts
    const selectedSegments = selections.segments || []
    let filteredRows = rows

    if (selectedSegments.length > 0) {
      // Filter to only include rows that match at least one selected segment
      filteredRows = rows.filter(row => {
        return selectedSegments.some(segment => {
          if (segment.column === 'Overall') return true
          return stripQuotes(String(row[segment.column])) === stripQuotes(segment.value)
        })
      })
    }

    const uniqueRespondents = uniq(
      filteredRows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean)
    )
    return uniqueRespondents.length
  }, [dataset, rows, selections.segments])

  // Create stable reference for segments to avoid unnecessary recalculations
  const segmentsKey = useMemo(() =>
    JSON.stringify(selections.segments || []),
    [selections.segments]
  )

  const { data, groups } = useMemo(() => {
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

  const toggleGroup = (value: string) => {
    const current = new Set(selections.groups)
    if (current.has(value)) {
      current.delete(value)
    } else {
      current.add(value)
    }
    setSelections({ groups: Array.from(current) })
  }

  const toggleSegment = (column: string, value: string) => {
    const currentSegments = selections.segments || []
    const existingIndex = currentSegments.findIndex(
      s => s.column === column && s.value === value
    )
    const isFilterMode = !(selections.comparisonMode ?? true)

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
  }

  const isSegmentSelected = (column: string, value: string) => {
    return (selections.segments || []).some(
      s => s.column === column && s.value === value
    )
  }

  const handleSelectAllInColumn = (column: string, values: string[]) => {
    const currentSegments = selections.segments || []
    const isFilterMode = !(selections.comparisonMode ?? true)

    // Remove existing segments from this column
    const otherSegments = currentSegments.filter(s => s.column !== column)
    // Add all values from this column
    let newSegments = [...otherSegments, ...values.map(value => ({ column, value }))]

    // In Filter mode only: remove Overall when selecting other segments
    if (isFilterMode) {
      newSegments = newSegments.filter(s => s.value !== 'Overall')
    }

    setSelections({ segments: newSegments })
  }

  const handleClearColumn = (column: string) => {
    const currentSegments = selections.segments || []
    // Remove all segments from this column
    const newSegments = currentSegments.filter(s => s.column !== column)

    // If removing brings us below 2 segments and stat sig is on, turn it off
    if (newSegments.length < 2 && selections.statSigFilter === 'statSigOnly') {
      setSelections({ segments: newSegments, statSigFilter: 'all' })
    } else {
      setSelections({ segments: newSegments })
    }
  }

  const toggleSegmentGroup = (column: string) => {
    const newExpanded = new Set(expandedSegmentGroups)
    if (newExpanded.has(column)) {
      newExpanded.delete(column)
    } else {
      newExpanded.add(column)
    }
    setExpandedSegmentGroups(newExpanded)
  }

  const toggleQuestionForSegmentation = (qid: string) => {
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

  const toggleQuestionSegmentGroup = (qid: string) => {
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

  const toggleDisplayGroup = (groupName: string) => {
    const newExpanded = new Set(expandedDisplayGroups)
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName)
    } else {
      newExpanded.add(groupName)
    }
    setExpandedDisplayGroups(newExpanded)
  }

  const handleSegmentDragStart = (index: number) => {
    setDraggedSegmentIndex(index)
  }

  const handleSegmentDragOver = (e: React.DragEvent, index: number) => {
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

  const handleSegmentDragEnd = () => {
    setDraggedSegmentIndex(null)
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

  const handleSegmentColumnChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSegment = event.target.value
    const defaults = autoDefaultGroups(rowsRaw, nextSegment)

    // If switching to "Overall" and stat sig is currently "statSigOnly", change to "all"
    if (nextSegment === 'Overall' && selections.statSigFilter === 'statSigOnly') {
      setSelections({ segmentColumn: nextSegment, groups: defaults, statSigFilter: 'all' })
    } else {
      setSelections({ segmentColumn: nextSegment, groups: defaults })
    }
  }

  const handleSelectAllSegments = () => {
    const allValues = selections.segmentColumn === 'Overall'
      ? ['Overall']
      : [...(selections.segmentColumn !== 'Overall' ? ['Overall'] : []), ...segmentValues]
    setSelections({ groups: allValues })
  }
  const handleClearSegments = () => setSelections({ groups: [] })

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
    setSelections({
      questionLabels: {
        ...selections.questionLabels,
        [qid]: newLabel.trim()
      }
    })
  }

  const handleSaveSegmentColumnLabel = (column: string, newLabel: string) => {
    if (!newLabel.trim()) return
    setSelections({
      segmentColumnLabels: {
        ...selections.segmentColumnLabels,
        [column]: newLabel.trim()
      }
    })
    setEditingSegment(null)
  }

  const getSegmentColumnDisplayLabel = (column: string) => {
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
      <div className="min-h-screen bg-white">
        <header className="sticky top-0 z-50 border-b border-gray-200 bg-white">
          <div className="mx-auto flex w-full max-w-[960px] flex-col items-center gap-3 px-6 py-6">
            <div className="w-full max-w-[500px]">
              <CSVUpload variant="landing" />
            </div>
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white" style={{ margin: 0, padding: 0 }}>
      {/* Fixed Header */}
      <header
        className="fixed top-0 left-0 right-0 z-50 border-b border-gray-200"
        style={{
          backgroundColor: '#FFFFFF',
          width: '100vw',
          height: '72px',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div className="flex w-full items-center justify-center gap-4 px-4">
          <div className="w-[480px] flex-shrink-0 flex justify-start" style={{ paddingLeft: '30px' }}>
            <div style={{ width: '240px' }}>
              <CSVUpload />
            </div>
          </div>
          <div className="flex-1 flex justify-center">
            <h2 className="text-center text-lg font-semibold text-brand-gray">
              ✨ORA✨
            </h2>
          </div>
          <div className="w-[480px] flex-shrink-0" style={{ paddingRight: '30px' }}>
            <p className="text-gray-400" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'right' }}>
              Open text and demographic questions are excluded.
            </p>
          </div>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="flex" style={{ height: '100vh' }}>
        {/* Sidebar toggle button - fixed position, always visible */}
        <button
          onClick={() => setSidebarVisible(!sidebarVisible)}
          className="flex flex-shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          style={{
            position: 'fixed',
            left: '16px',
            top: '88px',
            zIndex: 50,
            height: '45px',
            width: '45px',
            backgroundColor: sidebarVisible ? '#FAFCFE' : '#FFFFFF',
            border: '1px solid #e5e7eb',
            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
            cursor: 'pointer'
          }}
          title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
          aria-label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="29"
            height="29"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
            {sidebarVisible ? (
              <path d="m14 9-3 3 3 3" />
            ) : (
              <path d="m6 9 3 3-3 3" />
            )}
          </svg>
        </button>

        {/* Fixed Left Sidebar Panel */}
        {sidebarVisible && (
          <>
            <aside
              className="overflow-y-auto border-r border-gray-200"
              style={{
                width: `${sidebarWidth}px`,
                minWidth: `${sidebarWidth}px`,
                height: 'calc(100vh - 72px)',
                position: 'fixed',
                left: 0,
                top: '72px',
                backgroundColor: '#FAFCFE',
                paddingTop: '16px',
                paddingBottom: '24px',
                paddingLeft: '16px',
                paddingRight: '16px'
              }}
            >
          {summary && (
            <>
              <div className="flex items-start gap-2" style={{ marginBottom: '25px', paddingLeft: '62px' }}>
                <h3 className="font-semibold text-brand-gray break-words" style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: '12px' }}>
                  {cleanFileName(summary.fileName)}
                </h3>
              </div>

              {/* Filter Summary */}
              <div className="rounded-lg bg-white px-4 py-3 shadow-sm" style={{ fontSize: '13px', marginBottom: '20px', width: '100%', overflow: 'hidden' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  {/* Respondent Count */}
                  <div className="text-brand-gray" style={{ fontSize: '12px' }}>
                    {filteredRespondentCount} of {summary.uniqueRespondents} respondents
                  </div>

                  {/* Active Filters */}
                  {(() => {
                    const activeFilters: Array<{type: 'segment' | 'product', column?: string, value: string, label: string}> = []

                    // Add segment filters (including Overall)
                    const selectedSegments = selections.segments || []
                    selectedSegments.forEach(segment => {
                      activeFilters.push({
                        type: 'segment',
                        column: segment.column,
                        value: segment.value,
                        label: getGroupDisplayLabel(segment.value)
                      })
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

                    // Check if only "Overall" is selected (no other filters)
                    const onlyOverall = activeFilters.length === 1 &&
                                       activeFilters[0].type === 'segment' &&
                                       activeFilters[0].value === 'Overall'

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', width: '100%' }}>
                          {activeFilters.map((filter, idx) => (
                            <div
                              key={idx}
                              className="filter-chip"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 8px',
                                backgroundColor: '#f3f4f6',
                                borderRadius: '4px',
                                fontSize: '12px',
                                color: '#374151',
                                maxWidth: '100%',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#EBF3E7'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#f3f4f6'
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filter.label}</span>
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
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                        {!onlyOverall && (
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button
                              onClick={() => {
                                setSelections({ segments: [{ column: 'Overall', value: 'Overall' }], productGroups: [] })
                              }}
                              style={{
                                padding: '5.7px 12px',
                                backgroundColor: 'white',
                                border: '1px solid #3A8518',
                                borderRadius: '34px',
                                color: '#3A8518',
                                fontSize: '12px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                fontFamily: 'Space Grotesk, sans-serif'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f0fdf4'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                            >
                              Clear All
                            </button>

                            {/* Filter/Compare Mode Toggle */}
                            <div className="flex items-center" style={{ gap: '2px' }}>
                              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '44px', height: '22px' }}>
                                <input
                                  type="checkbox"
                                  checked={selections.comparisonMode ?? true}
                                  onChange={(e) => {
                                    e.stopPropagation()
                                    setSelections({ comparisonMode: !selections.comparisonMode })
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
                                    backgroundColor: selections.comparisonMode ? '#3A8518' : '#CCC',
                                    transition: '0.4s',
                                    borderRadius: '34px'
                                  }}
                                >
                                  <span
                                    style={{
                                      position: 'absolute',
                                      content: '""',
                                      height: '16.5px',
                                      width: '16.5px',
                                      left: selections.comparisonMode ? '24.5px' : '2.75px',
                                      top: '2.75px',
                                      backgroundColor: 'white',
                                      transition: '0.4s',
                                      borderRadius: '50%'
                                    }}
                                  />
                                </span>
                              </label>
                              <span
                                className="font-medium"
                                style={{
                                  color: selections.comparisonMode ? '#3A8518' : '#9CA3AF',
                                  fontSize: '12.6px'
                                }}
                              >
                                {' '}Compare
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>

              <div className="flex flex-col gap-[10px]">
                <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div
                      className="flex items-center gap-1 cursor-pointer hover:text-brand-green transition"
                      onClick={() => toggleSection('segmentation')}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="flex-shrink-0 transition-transform"
                        style={{ transform: expandedSections.has('segmentation') ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Segmentation</h4>
                    </div>
                  </div>
                  {expandedSections.has('segmentation') && (
                    <div className="pl-[10px]">
                  <div className="max-h-96 space-y-5 overflow-y-auto rounded-lg bg-white px-2 py-2">
                    {/* Overall option with Clear all button */}
                    <div className="space-y-1 pl-[10px]" style={{ paddingBottom: '10px', paddingTop: '4px' }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center" style={{ gap: '5px' }}>
                          <input
                            type="checkbox"
                            className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0 cursor-pointer"
                            checked={isSegmentSelected('Overall', 'Overall')}
                            onChange={() => toggleSegment('Overall', 'Overall')}
                          />
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
                                e.currentTarget.style.color = ''
                              }}
                              style={{
                                fontSize: '12px',
                                fontFamily: 'Space Grotesk, sans-serif',
                                fontWeight: '600',
                                cursor: 'pointer'
                              }}
                            >
                              {getGroupDisplayLabel('Overall')}
                            </span>
                          )}
                        </div>
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
                      .map((column, index) => {
                      const rawValues = Array.from(new Set(rowsRaw.map(r => stripQuotesFromValue(String(r[column])))))
                        .filter(v => {
                          if (!v || v === 'null' || v === 'undefined') return false

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
                        <div key={column} className="space-y-2" style={{ paddingBottom: '5px' }}>
                          <div className="flex items-center justify-between">
                            <div
                              className="flex items-center gap-1 cursor-pointer transition flex-1 group"
                              onClick={() => toggleSegmentGroup(column)}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="flex-shrink-0 transition-transform group-hover:text-brand-green"
                                style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                              >
                                <path d="M9 18l6-6-6-6" />
                              </svg>
                              <h5 className="font-semibold text-brand-gray group-hover:text-brand-green transition-colors" style={{ fontSize: '12px', fontFamily: 'Space Grotesk, sans-serif' }}>{column}</h5>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="pl-[10px]">
                            {/* Select all checkbox */}
                            <div className="flex items-center mb-2" style={{ gap: '5px' }}>
                              <input
                                type="checkbox"
                                className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0 cursor-pointer"
                                checked={(() => {
                                  // Check if all values in this column are selected
                                  const selectedInColumn = (selections.segments || []).filter(s => s.column === column)
                                  return selectedInColumn.length === values.length
                                })()}
                                onChange={() => {
                                  const selectedInColumn = (selections.segments || []).filter(s => s.column === column)
                                  if (selectedInColumn.length === values.length) {
                                    // Deselect all - go back to Overall
                                    handleClearColumn(column)
                                  } else {
                                    // Select all
                                    handleSelectAllInColumn(column, values)
                                  }
                                }}
                              />
                              <label className="text-brand-gray cursor-pointer" style={{ fontSize: '12px', fontFamily: 'Space Grotesk, sans-serif' }}>
                                Select all
                              </label>
                            </div>
                            {values.map(value => (
                              <div key={value} className="flex items-center" style={{ gap: '5px' }}>
                                <input
                                  type="checkbox"
                                  className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0 cursor-pointer"
                                  checked={isSegmentSelected(column, value)}
                                  onChange={() => toggleSegment(column, value)}
                                />
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
                                      setEditingSegment(value)
                                      setSegmentInput(getGroupDisplayLabel(value))
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = '#3A8518'
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = ''
                                    }}
                                    style={{
                                      fontSize: '12px',
                                      fontFamily: 'Space Grotesk, sans-serif',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    {getGroupDisplayLabel(value)}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                    {/* Consumer Questions Segmentation */}
                    <div style={{ paddingTop: '14px', marginTop: '1px' }}>
                      <div
                        className="group"
                        style={{
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          paddingBottom: '6px',
                          borderBottom: '1px solid #E5E7EB'
                        }}
                        onClick={() => {
                          const isExpanded = expandedSections.has('consumerQuestions')
                          setExpandedSections(prev => {
                            const next = new Set(prev)
                            if (isExpanded) {
                              next.delete('consumerQuestions')
                            } else {
                              next.add('consumerQuestions')
                            }
                            return next
                          })
                        }}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          style={{
                            transform: expandedSections.has('consumerQuestions') ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease'
                          }}
                        >
                          <path d="M4.5 2L8.5 6L4.5 10" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <h5 className="font-semibold text-brand-gray group-hover:text-brand-green transition-colors" style={{ fontSize: '12px', fontFamily: 'Space Grotesk, sans-serif' }}>
                          Consumer Questions
                        </h5>
                      </div>

                      {expandedSections.has('consumerQuestions') && (
                        <div style={{ marginTop: '8px' }}>
                          {/* Questions Dropdown */}
                          <div style={{ position: 'relative', marginBottom: '8px', flexShrink: 0 }}>
                            <div
                              onClick={() => setQuestionDropdownOpen(!questionDropdownOpen)}
                              style={{
                                padding: '6px 8px',
                                border: '1px solid #E5E7EB',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                backgroundColor: 'white',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                              }}
                            >
                              <span>Select Questions</span>
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 12 12"
                                fill="none"
                                style={{
                                  transform: questionDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.2s ease'
                                }}
                              >
                                <path d="M2 4L6 8L10 4" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </div>

                            {questionDropdownOpen && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  right: 0,
                                  marginTop: '2px',
                                  backgroundColor: 'white',
                                  border: '1px solid #E5E7EB',
                                  borderRadius: '4px',
                                  zIndex: 1000,
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                  display: 'flex',
                                  flexDirection: 'column'
                                }}
                              >
                                {/* Search Input */}
                                <div style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                                  <input
                                    type="text"
                                    placeholder="Search questions or answers..."
                                    value={questionSearchTerm}
                                    onChange={(e) => setQuestionSearchTerm(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      width: '100%',
                                      padding: '4px 8px',
                                      fontSize: '11px',
                                      border: '1px solid #E5E7EB',
                                      borderRadius: '4px',
                                      outline: 'none'
                                    }}
                                    onFocus={(e) => {
                                      e.target.style.borderColor = '#3A8518'
                                    }}
                                    onBlur={(e) => {
                                      e.target.style.borderColor = '#E5E7EB'
                                    }}
                                  />
                                </div>

                                {/* Questions List */}
                                <div style={{ maxHeight: '800px', overflowY: 'auto' }}>
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
                    <div style={{ paddingTop: '14px', marginTop: '1px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div className="flex items-center" style={{ gap: '2px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '36px', height: '18px' }}>
                          <input
                            type="checkbox"
                            checked={statSigFilter === 'statSigOnly'}
                            onChange={(e) => {
                              e.stopPropagation()
                              const isDisabled = (selections.segments && selections.segments.length < 2) || (!selections.segments && selections.groups.length < 2)
                              if (!isDisabled) {
                                const newStatSigFilter = statSigFilter === 'all' ? 'statSigOnly' : 'all'
                                // If turning off Stat Sig Only, also turn off Remove Asterisks
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
                              backgroundColor: statSigFilter === 'statSigOnly' ? '#3A8518' : '#CCC',
                              transition: '0.4s',
                              borderRadius: '34px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '13.5px',
                                width: '13.5px',
                                left: statSigFilter === 'statSigOnly' ? '20.25px' : '2.25px',
                                top: '2.25px',
                                backgroundColor: 'white',
                                transition: '0.4s',
                                borderRadius: '50%'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          className="font-medium"
                          style={{
                            color: statSigFilter === 'statSigOnly' ? '#3A8518' : '#9CA3AF',
                            fontSize: '12.6px'
                          }}
                        >
                          {' '}Stat Sig Only
                        </span>
                      </div>
                      <div className="flex items-center" style={{ gap: '2px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '36px', height: '18px' }}>
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
                              backgroundColor: selections.hideAsterisks ? '#3A8518' : '#CCC',
                              transition: '0.4s',
                              borderRadius: '34px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '13.5px',
                                width: '13.5px',
                                left: selections.hideAsterisks ? '20.25px' : '2.25px',
                                top: '2.25px',
                                backgroundColor: 'white',
                                transition: '0.4s',
                                borderRadius: '50%'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          className="font-medium"
                          style={{
                            color: selections.hideAsterisks ? '#3A8518' : '#9CA3AF',
                            fontSize: '12.6px'
                          }}
                        >
                          {' '}Remove Asterisks
                        </span>
                      </div>
                    </div>
                  )}
                  </div>
                  )}
                </section>

                {productColumn && productValues.length > 0 && (
                  <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
                    <div
                      className="flex items-center gap-1 cursor-pointer hover:text-brand-green transition"
                      onClick={() => toggleSection('products')}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="flex-shrink-0 transition-transform"
                        style={{ transform: expandedSections.has('products') ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Products</h4>
                    </div>
                    {expandedSections.has('products') && (
                    <div className="pl-[10px]">
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-white px-2 py-2">
                      {/* Select all checkbox */}
                      <div className="flex items-center mb-2" style={{ gap: '4px', paddingTop: '4px' }}>
                        <input
                          type="checkbox"
                          className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0 cursor-pointer"
                          checked={selections.productGroups.length === productValues.length}
                          onChange={() => {
                            if (selections.productGroups.length === productValues.length) {
                              handleClearProducts()
                            } else {
                              handleSelectAllProducts()
                            }
                          }}
                        />
                        <label className="text-brand-gray cursor-pointer" style={{ fontSize: '12px', fontFamily: 'Space Grotesk, sans-serif' }}>
                          Select all
                        </label>
                      </div>
                      {productValues.map(value => (
                        <label key={value} className="flex items-center text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer" style={{ gap: '4px', fontSize: '12px' }}>
                          <input
                            type="checkbox"
                            className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0"
                            checked={selections.productGroups.includes(value)}
                            onChange={() => toggleProductGroup(value)}
                          />
                          <span>{value}</span>
                        </label>
                      ))}
                      {productValues.length === 0 && (
                        <div className="text-xs text-brand-gray/60">No product values detected.</div>
                      )}
                    </div>
                    </div>
                    )}
                  </section>
                )}

                <section className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
                  <div
                    className="flex items-center gap-1 cursor-pointer hover:text-brand-green transition"
                    onClick={() => toggleSection('display')}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="flex-shrink-0 transition-transform"
                      style={{ transform: expandedSections.has('display') ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Display</h4>
                  </div>
                  {expandedSections.has('display') && (
                  <div className="pl-[10px] space-y-5">
                    <div style={{ marginBottom: '10px', paddingTop: '4px' }}>
                      <div className="flex items-center" style={{ gap: '2px' }}>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '36px', height: '18px' }}>
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
                                return JSON.stringify(currentColors) === JSON.stringify(defaultColors) ? '#3A8518' : '#CCC'
                              })(),
                              transition: '0.4s',
                              borderRadius: '34px'
                            }}
                          >
                            <span
                              style={{
                                position: 'absolute',
                                content: '""',
                                height: '13.5px',
                                width: '13.5px',
                                left: (() => {
                                  const defaultColors = ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']
                                  const currentColors = selections.chartColors || defaultColors
                                  return JSON.stringify(currentColors) === JSON.stringify(defaultColors) ? '20.25px' : '2.25px'
                                })(),
                                top: '2.25px',
                                backgroundColor: 'white',
                                transition: '0.4s',
                                borderRadius: '50%'
                              }}
                            />
                          </span>
                        </label>
                        <span
                          className="font-medium"
                          style={{
                            color: (() => {
                              const defaultColors = ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']
                              const currentColors = selections.chartColors || defaultColors
                              return JSON.stringify(currentColors) === JSON.stringify(defaultColors) ? '#3A8518' : '#9CA3AF'
                            })(),
                            fontSize: '12.6px'
                          }}
                        >
                          {' '}Default colors
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col" style={{ gap: '12px' }}>
                      {(selections.chartColors || ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088']).slice(0, 6).map((color, index) => (
                        <div key={index} className="flex items-center" style={{ gap: '8px' }}>
                          <label className="cursor-pointer">
                            <div
                              style={{
                                backgroundColor: color,
                                width: '32px',
                                height: '32px',
                                minWidth: '32px',
                                minHeight: '32px',
                                borderRadius: '3px',
                                border: '2px solid #e5e7eb',
                                cursor: 'pointer'
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
                            className="text-xs border border-gray-300 rounded px-2 py-1.5"
                            style={{
                              width: '90px',
                              fontSize: '12px',
                              fontFamily: 'monospace',
                              textAlign: 'center'
                            }}
                            placeholder="#000000"
                          />
                        </div>
                      ))}
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
          className="overflow-y-auto"
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
          <div className="pt-8 pr-8 pb-8 pl-24">
            <div className="rounded-2xl bg-white p-6 shadow-sm min-h-[460px]">
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
                    chartColors={selections.chartColors || ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7']}
                    optionLabels={selections.optionLabels || {}}
                    onSaveOptionLabel={handleSaveOptionLabel}
                    questionLabels={selections.questionLabels || {}}
                    onSaveQuestionLabel={handleSaveQuestionLabel}
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
    </div>
  )
}
