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
  const orderedVals = sortSegmentValues(vals, segCol)

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

  const questions = useMemo(() => {
    if (!dataset) return []
    return [...dataset.questions]
      .filter(shouldIncludeQuestion)
  }, [dataset])

  const filteredQuestions = questions
  const statSigFilter = selections.statSigFilter || 'all'

  useEffect(() => {
    if (selections.statSigFilter !== 'all') {
      setSelections({ statSigFilter: 'all' })
    }
  }, [selections.statSigFilter, setSelections])

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

  const segmentValues = useMemo(() => {
    if (!selections.segmentColumn) return []
    if (selections.segmentColumn === 'Overall') return ['Overall']
    const values = Array.from(new Set(rows.map(r => String(r[selections.segmentColumn!]))))
      .filter(v => v && v !== 'null' && v !== 'undefined' && !isExcludedValue(v))
    return sortSegmentValues(values, selections.segmentColumn)
  }, [rows, selections.segmentColumn])

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
    setSelections({ segmentColumn: nextSegment, groups: defaults })
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
          <div className="w-[240px] flex-shrink-0" style={{ paddingLeft: '30px' }}>
            <CSVUpload />
          </div>
          <div className="flex-1 flex justify-center">
            <h2 className="text-center text-lg font-semibold text-brand-gray">
              ORA, your OR analyst :)
            </h2>
          </div>
          <div className="w-[240px] flex-shrink-0" style={{ paddingRight: '30px' }}></div>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="flex" style={{ height: '100vh' }}>
        {/* Fixed Left Sidebar Panel */}
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
              <h3
                className="text-base font-semibold text-brand-gray"
                style={{ marginBottom: '25px' }}
              >
                {summary.fileName}
              </h3>
              <div className="flex flex-col gap-[10px]">
                <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
                  <h4 className="text-base font-semibold text-brand-gray">Segmentation</h4>
                  <select
                    className="w-full rounded-lg bg-white px-3 py-2 text-sm text-brand-gray focus:outline-none focus:ring-2 focus:ring-brand-pale-green"
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
                    {segmentValues.map(value => (
                      <label key={value} className="flex items-center gap-2 text-sm text-brand-gray">
                        <input
                          type="checkbox"
                          className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green"
                          checked={selections.groups.includes(value)}
                          onChange={() => toggleGroup(value)}
                        />
                        <span>{value}</span>
                      </label>
                    ))}
                    {segmentValues.length === 0 && (
                      <div className="text-xs text-brand-gray/60">
                        No values detected for this segmentation.
                      </div>
                    )}
                  </div>
                </section>

                {productColumn && productValues.length > 0 && (
                  <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
                    <h4 className="text-base font-semibold text-brand-gray">Products</h4>
                    <div className="flex items-center gap-3 text-xs text-brand-gray/70">
                      <button
                        className="rounded-md px-2 py-1 transition hover:bg-brand-pale-gray"
                        onClick={handleSelectAllProducts}
                      >
                        Select all
                      </button>
                      <button
                        className="rounded-md px-2 py-1 transition hover:bg-brand-pale-gray"
                        onClick={handleClearProducts}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-white px-3 py-2">
                      {productValues.map(value => (
                        <label key={value} className="flex items-center gap-2 text-sm text-brand-gray">
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

                <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
                  <h4 className="text-base font-semibold text-brand-gray">Display</h4>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold tracking-wide text-brand-gray/60">Chart Type</p>
                    <select
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm text-brand-gray focus:outline-none focus:ring-2 focus:ring-brand-pale-green"
                      value={chartOrientation}
                      onChange={(event) =>
                        setChartOrientation(event.target.value as 'horizontal' | 'vertical')
                      }
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold tracking-wide text-brand-gray/60">Sort</p>
                    <select
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm text-brand-gray focus:outline-none focus:ring-2 focus:ring-brand-pale-green"
                      value={selections.sortOrder}
                      onChange={(event) => setSelections({ sortOrder: event.target.value as SortOrder })}
                    >
                      <option value="descending">Descending</option>
                      <option value="ascending">Ascending</option>
                      <option value="default">Original</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold tracking-wide text-brand-gray/60">Stat Sig</p>
                    <select
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm text-brand-gray focus:outline-none focus:ring-2 focus:ring-brand-pale-green"
                      value={statSigFilter}
                      onChange={(event) =>
                        setSelections({ statSigFilter: event.target.value as 'all' | 'statSigOnly' })
                      }
                    >
                      <option value="all">All Results</option>
                      <option value="statSigOnly">Stat Sig Only</option>
                    </select>
                  </div>
                </section>
              </div>
            </>
          )}
        </aside>

        {/* Scrollable Main Content Panel */}
        <main
          className="overflow-y-auto"
          style={{
            position: 'fixed',
            top: '72px',
            left: '288px',
            width: 'calc(100vw - 288px)',
            height: 'calc(100vh - 72px)',
            backgroundColor: '#FFFFFF'
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
