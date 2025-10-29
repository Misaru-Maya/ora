import React, { useEffect, useMemo, useState } from 'react'
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

function autoDefaultGroups(rows: any[], segCol?: string, maxDefaults = 2): string[] {
  if (!segCol) return []
  if (segCol === 'Overall') return ['Overall']
  const vals = Array.from(new Set(rows.map(r => String(r[segCol]))))
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
    return [...values].sort((a, b) => parseAgeToken(a) - parseAgeToken(b))
  }
  return values
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

// Filter out zipcode and free text questions
function shouldIncludeQuestion(question: QuestionDef): boolean {
  const labelLower = question.label.toLowerCase()

  // Filter out zipcode questions
  if (labelLower.includes('zip') || labelLower.includes('postal')) {
    return false
  }

  // Filter out ranking questions (check for both "(ranking)" token and "rank" at start of label)
  if (labelLower.includes('(ranking)') || labelLower.startsWith('rank ')) {
    return false
  }

  // Always include multi, single, and scale questions even if their labels contain tokens
  const labelHasTypeToken = ['(multi)', '(single)', '(scale)'].some(token => labelLower.includes(token))
  if (labelHasTypeToken) return true

  // Treat questions containing "(text)" in the label or column headers as free-text, exclude them
  if (labelLower.includes('(text)')) {
    return false
  }

  const columnHasTextToken = question.columns.some(col => col.header.toLowerCase().includes('(text)') || col.optionLabel.toLowerCase().includes('(text)'))
  if (columnHasTextToken) {
    return false
  }

  if (question.singleSourceColumn) {
    const singleLower = question.singleSourceColumn.toLowerCase()
    if (singleLower.includes('(text)')) return false
    if (['(multi)', '(single)', '(scale)'].some(token => singleLower.includes(token))) return true
  }

  return true
}

export default function App() {
  const { dataset, selections, setSelections } = useORAStore()
  const [chartOrientation, setChartOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(288)
  const [isResizing, setIsResizing] = useState(false)
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [expandedSegmentGroups, setExpandedSegmentGroups] = useState<Set<string>>(new Set())
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['segmentation', 'statSig', 'products', 'display'])
  )
  const [expandedDisplayGroups, setExpandedDisplayGroups] = useState<Set<string>>(
    new Set(['chartType', 'sort', 'color'])
  )

  const questions = useMemo(() => {
    if (!dataset) return []
    return [...dataset.questions]
      .filter(shouldIncludeQuestion)
  }, [dataset])

  const filteredQuestions = questions
  const statSigFilter = selections.statSigFilter || 'all'

  const rowsRaw = dataset?.rows || []
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
    return Array.from(new Set(rowsRaw.map(row => normalizeProductValue(row[selections.productColumn!]))))
      .filter(v => v && v !== 'null' && v !== 'undefined')
      .sort()
  }, [dataset, rowsRaw, selections.productColumn])

  const useAllProducts = !selections.productColumn || selections.productGroups.length === 0 || selections.productGroups.length === productValues.length
  const rows = useAllProducts
    ? rowsRaw
    : rowsRaw.filter(row => selections.productGroups.includes(normalizeProductValue(row[selections.productColumn!])) )

  const filteredDataset = useMemo(() => {
    if (!dataset) return null
    return { ...dataset, rows }
  }, [dataset, rows])

  const [segmentValueOrder, setSegmentValueOrder] = useState<Record<string, string[]>>({})
  const [draggedSegmentIndex, setDraggedSegmentIndex] = useState<number | null>(null)

  const segmentValues = useMemo(() => {
    if (!selections.segmentColumn) return []
    if (selections.segmentColumn === 'Overall') return ['Overall']
    const values = Array.from(new Set(rows.map(r => String(r[selections.segmentColumn!]))))
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

    const result = buildSeries({
      dataset: filteredDataset,
      question: currentQuestion,
      ...(hasSegments
        ? { segments: selections.segments }
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
  }, [filteredDataset, currentQuestion, selections.segmentColumn, selections.segments, orderedGroups, selections.sortOrder, selections.groupLabels])

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
      setSelections({ segments: [...currentSegments, { column, value }] })
    }
  }

  const isSegmentSelected = (column: string, value: string) => {
    return (selections.segments || []).some(
      s => s.column === column && s.value === value
    )
  }

  const handleSelectAllInColumn = (column: string, values: string[]) => {
    const currentSegments = selections.segments || []
    // Remove existing segments from this column
    const otherSegments = currentSegments.filter(s => s.column !== column)
    // Add all values from this column
    const newSegments = [...otherSegments, ...values.map(value => ({ column, value }))]
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
    setEditingLabel(null)
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
              Open text, ranking, and demographic questions are excluded.<br />
              Other, not specified, none of the above, and skip are deselected by default.
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
            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'
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
                <h3 className="text-base font-semibold text-brand-gray break-words" style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                  {cleanFileName(summary.fileName)}
                </h3>
              </div>
              <div className="flex flex-col gap-[10px]">
                <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
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
                  {expandedSections.has('segmentation') && (
                    <div className="pl-[10px]">
                  <div className="max-h-96 space-y-5 overflow-y-auto rounded-lg bg-white px-2 py-2">
                    {/* Overall option with Clear all button */}
                    <div className="space-y-1 pl-[10px]">
                      <div className="flex items-center justify-between gap-2" style={{ paddingBottom: '10px' }}>
                      <label
                        className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer flex-1"
                        style={{ gap: '4px' }}
                      >
                          <input
                            type="checkbox"
                            className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0"
                            checked={isSegmentSelected('Overall', 'Overall')}
                            onChange={() => toggleSegment('Overall', 'Overall')}
                          />
                          {editingLabel === 'Overall' ? (
                            <textarea
                              value={labelInput}
                              onChange={(e) => setLabelInput(e.target.value)}
                              onBlur={() => handleSaveLabel('Overall', labelInput)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault()
                                  handleSaveLabel('Overall', labelInput)
                                }
                                if (e.key === 'Escape') setEditingLabel(null)
                              }}
                              autoFocus
                              className="flex-1 text-base border-2 border-brand-green rounded px-2 py-1 focus:outline-none font-semibold"
                              onClick={(e) => e.stopPropagation()}
                              style={{ minHeight: '60px', resize: 'vertical', lineHeight: '1.4' }}
                            />
                          ) : (
                            <span
                              className="flex-1 font-semibold hover:text-brand-green transition"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingLabel('Overall')
                                setLabelInput(getGroupDisplayLabel('Overall'))
                              }}
                            >
                              {getGroupDisplayLabel('Overall')}
                            </span>
                          )}
                        </label>
                        <button
                          className="transition hover:bg-brand-pale-gray text-xs text-brand-gray/70"
                          style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none', textDecoration: 'underline', fontFamily: 'Space Grotesk, sans-serif', cursor: 'pointer', whiteSpace: 'nowrap' }}
                          onClick={() => setSelections({ segments: [] })}
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                    {/* All segment columns */}
                    {segmentColumns.filter(col => col !== 'Overall').map(column => {
                      const rawValues = Array.from(new Set(rows.map(r => String(r[column]))))
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
                              className="flex items-center gap-1 cursor-pointer hover:text-brand-green transition flex-1"
                              onClick={() => toggleSegmentGroup(column)}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="flex-shrink-0 transition-transform"
                                style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                              >
                                <path d="M9 18l6-6-6-6" />
                              </svg>
                              <h5 className="text-2xl font-semibold text-brand-gray">{column}</h5>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-brand-gray/70">
                              <button
                                className="transition hover:bg-brand-pale-gray cursor-pointer"
                                style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none', textDecoration: 'underline', fontFamily: 'Space Grotesk, sans-serif' }}
                                onClick={() => handleSelectAllInColumn(column, values)}
                              >
                                All
                              </button>
                              <button
                                className="transition hover:bg-brand-pale-gray cursor-pointer"
                                style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none', textDecoration: 'underline', fontFamily: 'Space Grotesk, sans-serif' }}
                                onClick={() => handleClearColumn(column)}
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="pl-[10px] space-y-1">
                            {values.map(value => (
                              <label
                                key={value}
                                className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer"
                                style={{ gap: '4px' }}
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0"
                                  checked={isSegmentSelected(column, value)}
                                  onChange={() => toggleSegment(column, value)}
                                />
                                {editingLabel === value ? (
                                  <textarea
                                    value={labelInput}
                                    onChange={(e) => setLabelInput(e.target.value)}
                                    onBlur={() => handleSaveLabel(value, labelInput)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault()
                                        handleSaveLabel(value, labelInput)
                                      }
                                      if (e.key === 'Escape') setEditingLabel(null)
                                    }}
                                    autoFocus
                                    className="flex-1 text-base border-2 border-brand-green rounded px-2 py-1 focus:outline-none"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ minHeight: '60px', resize: 'vertical', lineHeight: '1.4' }}
                                  />
                                ) : (
                                  <span
                                    className="flex-1 hover:text-brand-green transition"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEditingLabel(value)
                                      setLabelInput(getGroupDisplayLabel(value))
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
                  </div>
                  )}
                </section>

                <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
                  <div
                    className="flex items-center gap-1 cursor-pointer hover:text-brand-green transition"
                    onClick={() => toggleSection('statSig')}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="flex-shrink-0 transition-transform"
                      style={{ transform: expandedSections.has('statSig') ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Stat Sig</h4>
                  </div>
                  {expandedSections.has('statSig') && (
                  <div className="pl-[10px] space-y-2">
                  <div className="space-y-1">
                    <label className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer" style={{ gap: '4px' }}>
                      <input
                        type="radio"
                        name="statSigFilter"
                        value="all"
                        className="border-brand-light-gray text-brand-green focus:ring-brand-green"
                        checked={statSigFilter === 'all'}
                        onChange={(e) => setSelections({ statSigFilter: 'all' })}
                      />
                      <span>All Results</span>
                    </label>
                    <label
                      className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer"
                      style={{
                        gap: '4px',
                        opacity: (selections.segments && selections.segments.length < 2) || (!selections.segments && selections.groups.length < 2) ? 0.5 : 1,
                        pointerEvents: (selections.segments && selections.segments.length < 2) || (!selections.segments && selections.groups.length < 2) ? 'none' : 'auto'
                      }}
                    >
                      <input
                        type="radio"
                        name="statSigFilter"
                        value="statSigOnly"
                        className="border-brand-light-gray text-brand-green focus:ring-brand-green"
                        checked={statSigFilter === 'statSigOnly'}
                        onChange={(e) => setSelections({ statSigFilter: 'statSigOnly' })}
                        disabled={(selections.segments && selections.segments.length < 2) || (!selections.segments && selections.groups.length < 2)}
                      />
                      <span>Stat Sig Only</span>
                    </label>
                  </div>
                  <label className="flex items-center cursor-pointer" style={{ gap: '4px' }}>
                    <input
                      type="checkbox"
                      className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green"
                      checked={selections.hideAsterisks || false}
                      onChange={(e) => setSelections({ hideAsterisks: e.target.checked })}
                    />
                    <span className="text-base font-semibold text-gray-700">Remove asterisks</span>
                  </label>
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
                    <div className="flex items-center gap-3 text-xs text-brand-gray/70">
                      <button
                        className="transition hover:bg-brand-pale-gray"
                        style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none', textDecoration: 'underline', fontFamily: 'Space Grotesk, sans-serif' }}
                        onClick={handleSelectAllProducts}
                      >
                        Select all
                      </button>
                      <button
                        className="transition hover:bg-brand-pale-gray"
                        style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none', textDecoration: 'underline', fontFamily: 'Space Grotesk, sans-serif' }}
                        onClick={handleClearProducts}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-white px-2 py-2">
                      {productValues.map(value => (
                        <label key={value} className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer" style={{ gap: '4px' }}>
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
                  <div className="space-y-2" style={{ paddingBottom: '5px' }}>
                    <div
                      className="flex items-center gap-1 cursor-pointer hover:text-brand-green transition"
                      onClick={() => toggleDisplayGroup('chartType')}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="flex-shrink-0 transition-transform"
                        style={{ transform: expandedDisplayGroups.has('chartType') ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      <h5 className="text-2xl font-semibold text-brand-gray">Chart Type</h5>
                    </div>
                    {expandedDisplayGroups.has('chartType') && (
                    <div className="pl-[10px] space-y-1">
                      <label className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer" style={{ gap: '4px' }}>
                        <input
                          type="radio"
                          name="chartOrientation"
                          value="horizontal"
                          className="border-brand-light-gray text-brand-green focus:ring-brand-green"
                          checked={chartOrientation === 'horizontal'}
                          onChange={(e) => setChartOrientation('horizontal')}
                        />
                        <span>Horizontal</span>
                      </label>
                      <label className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer" style={{ gap: '4px' }}>
                        <input
                          type="radio"
                          name="chartOrientation"
                          value="vertical"
                          className="border-brand-light-gray text-brand-green focus:ring-brand-green"
                          checked={chartOrientation === 'vertical'}
                          onChange={(e) => setChartOrientation('vertical')}
                        />
                        <span>Vertical</span>
                      </label>
                    </div>
                    )}
                  </div>
                  <div className="space-y-2" style={{ paddingBottom: '5px' }}>
                    <div
                      className="flex items-center gap-1 cursor-pointer hover:text-brand-green transition"
                      onClick={() => toggleDisplayGroup('sort')}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="flex-shrink-0 transition-transform"
                        style={{ transform: expandedDisplayGroups.has('sort') ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      <h5 className="text-2xl font-semibold text-brand-gray">Sort</h5>
                    </div>
                    {expandedDisplayGroups.has('sort') && (
                    <div className="pl-[10px] space-y-1">
                      <label className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer" style={{ gap: '4px' }}>
                        <input
                          type="radio"
                          name="sortOrder"
                          value="descending"
                          className="border-brand-light-gray text-brand-green focus:ring-brand-green"
                          checked={selections.sortOrder === 'descending'}
                          onChange={(e) => setSelections({ sortOrder: 'descending' })}
                        />
                        <span>Descending</span>
                      </label>
                      <label className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer" style={{ gap: '4px' }}>
                        <input
                          type="radio"
                          name="sortOrder"
                          value="ascending"
                          className="border-brand-light-gray text-brand-green focus:ring-brand-green"
                          checked={selections.sortOrder === 'ascending'}
                          onChange={(e) => setSelections({ sortOrder: 'ascending' })}
                        />
                        <span>Ascending</span>
                      </label>
                      <label className="flex items-center text-base text-brand-gray rounded px-2 py-1 transition-colors hover:bg-gray-50 cursor-pointer" style={{ gap: '4px' }}>
                        <input
                          type="radio"
                          name="sortOrder"
                          value="default"
                          className="border-brand-light-gray text-brand-green focus:ring-brand-green"
                          checked={selections.sortOrder === 'default'}
                          onChange={(e) => setSelections({ sortOrder: 'default' })}
                        />
                        <span>Original</span>
                      </label>
                    </div>
                    )}
                  </div>
                  <div className="space-y-2" style={{ paddingBottom: '5px' }}>
                    <div
                      className="flex items-center gap-1 cursor-pointer hover:text-brand-green transition"
                      onClick={() => toggleDisplayGroup('color')}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="flex-shrink-0 transition-transform"
                        style={{ transform: expandedDisplayGroups.has('color') ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      <h5 className="text-2xl font-semibold text-brand-gray">Color</h5>
                    </div>
                    {expandedDisplayGroups.has('color') && (
                    <div className="pl-[10px]">
                    <div className="flex flex-col" style={{ gap: '12px' }}>
                      {(selections.chartColors || ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088']).slice(0, 6).map((color, index) => (
                        <div key={index} className="flex items-center" style={{ gap: '8px' }}>
                          <div
                            style={{
                              backgroundColor: color,
                              width: '32px',
                              height: '32px',
                              minWidth: '32px',
                              minHeight: '32px',
                              borderRadius: '3px',
                              border: '2px solid #e5e7eb',
                            }}
                          />
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
                          <label className="cursor-pointer flex items-center justify-center" style={{ width: '28px', height: '28px' }}>
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
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
                              <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
                              <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
                            </svg>
                          </label>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <button
                        onClick={() => setSelections({ chartColors: ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7'] })}
                        className="text-xs text-brand-green underline hover:text-brand-green/80 transition"
                        style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none' }}
                      >
                        Reset to default
                      </button>
                    </div>
                    </div>
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
          <div className="p-8">
            <div className="rounded-2xl bg-white p-6 shadow-sm min-h-[460px]">
              {dataset ? (
                filteredDataset && ((selections.segments && selections.segments.length > 0) || (selections.segmentColumn && orderedGroups.length > 0)) ? (
                  <ChartGallery
                    questions={filteredQuestions}
                    dataset={filteredDataset!}
                    segmentColumn={selections.segmentColumn}
                    groups={orderedGroups}
                    segments={selections.segments}
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
