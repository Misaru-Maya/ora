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

function autoDefaultGroups(rows: any[], segCol?: string, maxDefaults = 3): string[] {
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
      const match = token.match(/(\d+)/)
      if (match) return parseInt(match[1], 10)
      if (/under/i.test(token)) return -1
      if (/(\d+)\s*\+/.test(token)) {
        const plusMatch = token.match(/(\d+)\s*\+/)
        if (plusMatch) return parseInt(plusMatch[1], 10)
      }
      return Number.MAX_SAFE_INTEGER
    }
    return [...values].sort((a, b) => parseAgeToken(a) - parseAgeToken(b))
  }
  return values
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

  const { data, groups } = useMemo(() => {
    if (!filteredDataset || !currentQuestion || !selections.segmentColumn || !selections.groups.length) {
      return { data: [], groups: [] }
    }
    return buildSeries({
      dataset: filteredDataset,
      question: currentQuestion,
      segmentColumn: selections.segmentColumn,
      groups: selections.groups,
      sortOrder: selections.sortOrder
    })
  }, [filteredDataset, currentQuestion, selections])

  const [segmentValueOrder, setSegmentValueOrder] = useState<Record<string, string[]>>({})
  const [draggedSegmentIndex, setDraggedSegmentIndex] = useState<number | null>(null)

  const segmentValues = useMemo(() => {
    if (!selections.segmentColumn) return []
    if (selections.segmentColumn === 'Overall') return ['Overall']
    const values = Array.from(new Set(rows.map(r => String(r[selections.segmentColumn!]))))
      .filter(v => v && v !== 'null' && v !== 'undefined' && !isExcludedValue(v))
    const sorted = sortSegmentValues(values, selections.segmentColumn)

    // Apply custom order if exists for this segment column
    if (segmentValueOrder[selections.segmentColumn]) {
      const customOrder = segmentValueOrder[selections.segmentColumn]
      const orderedValues = customOrder.filter(v => sorted.includes(v))
      const newValues = sorted.filter(v => !customOrder.includes(v))
      return [...orderedValues, ...newValues]
    }

    return sorted
  }, [rows, selections.segmentColumn, segmentValueOrder])

  useEffect(() => {
    if (!selections.segmentColumn) return
    const available = new Set(segmentValues)
    const existing = selections.groups.filter(value => available.has(value))
    if (existing.length !== selections.groups.length) {
      setSelections({ groups: existing })
    }
    if (existing.length === 0 && segmentValues.length) {
      setSelections({ groups: autoDefaultGroups(rows, selections.segmentColumn) })
    }
  }, [segmentValues, selections.segmentColumn, selections.groups, rows, setSelections])

  // Apply custom order to selections.groups whenever the order changes
  useEffect(() => {
    if (!selections.segmentColumn || !segmentValueOrder[selections.segmentColumn]) return

    const customOrder = segmentValueOrder[selections.segmentColumn]
    const currentGroups = selections.groups

    // Reorder groups based on custom order
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

  const handleSegmentDragStart = (index: number) => {
    setDraggedSegmentIndex(index)
  }

  const handleSegmentDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedSegmentIndex === null || draggedSegmentIndex === index) return

    const newOrder = [...segmentValues]
    const [draggedItem] = newOrder.splice(draggedSegmentIndex, 1)
    newOrder.splice(index, 0, draggedItem)

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

  const handleSelectAllProducts = () => setSelections({ productGroups: [...productValues] })
  const handleClearProducts = () => setSelections({ productGroups: [] })

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
              Other, not specified, none of the above, and skip are also hidden.
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
          <aside
            className="overflow-y-auto border-r border-gray-200"
            style={{
              width: '288px',
              minWidth: '288px',
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
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Segmentation</h4>
                  <select
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-700 font-medium shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent hover:shadow-lg hover:border-gray-300 appearance-none cursor-pointer"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 0.75rem center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '1.25em 1.25em',
                      paddingRight: '2.75rem'
                    }}
                    value={selections.segmentColumn || ''}
                    onChange={handleSegmentColumnChange}
                  >
                    {segmentColumns.map(column => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-white px-3 py-2">
                    {segmentValues.map((value, index) => (
                      <label
                        key={value}
                        draggable
                        onDragStart={() => handleSegmentDragStart(index)}
                        onDragOver={(e) => handleSegmentDragOver(e, index)}
                        onDragEnd={handleSegmentDragEnd}
                        className={`flex items-center text-sm text-brand-gray cursor-move rounded px-2 py-1 transition-colors ${
                          draggedSegmentIndex === index ? 'opacity-50 bg-gray-100' : 'hover:bg-gray-50'
                        }`}
                        style={{ gap: '4px' }}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="flex-shrink-0 text-gray-400"
                        >
                          <path d="M3 8h18M3 16h18" />
                        </svg>
                        <input
                          type="checkbox"
                          className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0"
                          checked={selections.groups.includes(value)}
                          onChange={() => toggleGroup(value)}
                        />
                        <span className="flex-1">{value}</span>
                      </label>
                    ))}
                    {segmentValues.length === 0 && (
                      <div className="text-xs text-brand-gray/60">
                        No values detected for this segmentation.
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Stat Sig</h4>
                  <select
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-700 font-medium shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent hover:shadow-lg hover:border-gray-300 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md disabled:hover:border-gray-200"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                      backgroundPosition: 'right 0.75rem center',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '1.25em 1.25em',
                      paddingRight: '2.75rem'
                    }}
                    value={statSigFilter}
                    onChange={(event) =>
                      setSelections({ statSigFilter: event.target.value as 'all' | 'statSigOnly' })
                    }
                    disabled={selections.segmentColumn === 'Overall'}
                  >
                    <option value="all">All Results</option>
                    <option value="statSigOnly">Stat Sig Only</option>
                  </select>
                </section>

                <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
                  <label className="flex items-center cursor-pointer" style={{ gap: '4px' }}>
                    <input
                      type="checkbox"
                      className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green"
                      checked={selections.hideAsterisks || false}
                      onChange={(e) => setSelections({ hideAsterisks: e.target.checked })}
                    />
                    <span className="text-sm font-semibold text-gray-700">Remove asterisks</span>
                  </label>
                </section>

                {productColumn && productValues.length > 0 && (
                  <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Products</h4>
                    <div className="flex items-center gap-3 text-xs text-brand-gray/70">
                      <button
                        className="transition hover:bg-brand-pale-gray"
                        style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none', textDecoration: 'underline' }}
                        onClick={handleSelectAllProducts}
                      >
                        Select all
                      </button>
                      <button
                        className="transition hover:bg-brand-pale-gray"
                        style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none', textDecoration: 'underline' }}
                        onClick={handleClearProducts}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-white px-3 py-2">
                      {productValues.map(value => (
                        <label key={value} className="flex items-center text-sm text-brand-gray" style={{ gap: '4px' }}>
                          <input
                            type="checkbox"
                            className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green"
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
                  </section>
                )}

                <section className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
                  <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Display</h4>
                  <div className="space-y-3.5">
                    <label className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Chart Type</label>
                    <select
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-700 font-medium shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent hover:shadow-lg hover:border-gray-300 appearance-none cursor-pointer"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                        backgroundPosition: 'right 0.75rem center',
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '1.25em 1.25em',
                        paddingRight: '2.75rem'
                      }}
                      value={chartOrientation}
                      onChange={(event) =>
                        setChartOrientation(event.target.value as 'horizontal' | 'vertical')
                      }
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </div>
                  <div className="space-y-3.5">
                    <label className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Sort</label>
                    <select
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-700 font-medium shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent hover:shadow-lg hover:border-gray-300 appearance-none cursor-pointer"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                        backgroundPosition: 'right 0.75rem center',
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '1.25em 1.25em',
                        paddingRight: '2.75rem'
                      }}
                      value={selections.sortOrder}
                      onChange={(event) => setSelections({ sortOrder: event.target.value as SortOrder })}
                    >
                      <option value="descending">Descending</option>
                      <option value="ascending">Ascending</option>
                      <option value="default">Original</option>
                    </select>
                  </div>
                </section>
              </div>
            </>
          )}
          </aside>
        )}

        {/* Scrollable Main Content Panel */}
        <main
          className="overflow-y-auto"
          style={{
            position: 'fixed',
            top: '72px',
            left: sidebarVisible ? '288px' : '0',
            width: sidebarVisible ? 'calc(100vw - 288px)' : '100vw',
            height: 'calc(100vh - 72px)',
            backgroundColor: '#FFFFFF',
            transition: 'left 0.3s ease, width 0.3s ease'
          }}
        >
          <div className="p-8">
            <div className="rounded-2xl bg-white p-6 shadow-sm min-h-[460px]">
              {dataset ? (
                filteredDataset && selections.segmentColumn && selections.groups.length > 0 ? (
                  <ChartGallery
                    questions={filteredQuestions}
                    dataset={filteredDataset!}
                    segmentColumn={selections.segmentColumn}
                    groups={selections.groups}
                    orientation={chartOrientation}
                    sortOrder={selections.sortOrder}
                    selectedQuestionId={selections.question}
                    filterSignificantOnly={statSigFilter === 'statSigOnly'}
                    hideAsterisks={selections.hideAsterisks || false}
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
