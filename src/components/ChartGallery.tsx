import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ComparisonChart } from './ComparisonChart'
import { SingleSelectPieChart } from './SingleSelectPieChart'
import { BuildSeriesResult, buildSeries } from '../dataCalculations'
import { ParsedCSV, QuestionDef, SortOrder } from '../types'

type CardSortOption = 'default' | 'descending' | 'ascending' | 'alphabetical'

interface ChartCardProps {
  question: QuestionDef
  series: BuildSeriesResult
  orientation: 'horizontal' | 'vertical'
  displayLabel: string
  filterSignificantOnly?: boolean
}

const SORT_OPTIONS: CardSortOption[] = ['default', 'descending', 'ascending', 'alphabetical']

const formatQuestionTitle = (question: QuestionDef): string => {
  const base = question.label === 'When were you born?' ? 'How old are you?' : question.label
  const typeLabel = question.isLikert
    ? 'likert'
    : question.type === 'single'
      ? 'single select'
      : question.type === 'multi'
        ? 'multi select'
        : question.type
  return `${base} (${typeLabel})`
}

const ChartCard: React.FC<ChartCardProps> = ({
  question,
  series,
  orientation,
  displayLabel,
  filterSignificantOnly = false
}) => {
  const [cardSort, setCardSort] = useState<CardSortOption>(question.isLikert ? 'alphabetical' : 'default')
  const [showFilter, setShowFilter] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showOrientationMenu, setShowOrientationMenu] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [showStatSigMenu, setShowStatSigMenu] = useState(false)
  const [statSigFilter, setStatSigFilter] = useState<'all' | 'statSigOnly'>(filterSignificantOnly ? 'statSigOnly' : 'all')
  const [chartOrientation, setChartOrientation] = useState<'horizontal' | 'vertical'>(orientation)
  const canUsePie = question.type === 'single'
    && series.groups.length === 1
    && question.columns.length <= 6
    && series.groups[0]?.label === 'Overall'
  const [chartVariant, setChartVariant] = useState<'bar' | 'pie'>('bar')
  const orientationMenuRef = useRef<HTMLDivElement | null>(null)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const filterMenuRef = useRef<HTMLDivElement | null>(null)
  const statSigMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setCardSort(question.isLikert ? 'alphabetical' : 'default')
    setSelectedOptions(series.data.map(d => d.option))
  }, [series, question.isLikert])

  useEffect(() => {
    setChartOrientation(orientation)
  }, [orientation])

  useEffect(() => {
    if (!canUsePie && chartVariant === 'pie') {
      setChartVariant('bar')
    }
  }, [canUsePie, chartVariant, question.qid])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (showOrientationMenu && orientationMenuRef.current && !orientationMenuRef.current.contains(target)) {
        setShowOrientationMenu(false)
      }
      if (showSortMenu && sortMenuRef.current && !sortMenuRef.current.contains(target)) {
        setShowSortMenu(false)
      }
      if (showFilter && filterMenuRef.current && !filterMenuRef.current.contains(target)) {
        setShowFilter(false)
      }
      if (showStatSigMenu && statSigMenuRef.current && !statSigMenuRef.current.contains(target)) {
        setShowStatSigMenu(false)
      }
    }
    if (showSortMenu || showFilter || showStatSigMenu || showOrientationMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showSortMenu, showFilter, showStatSigMenu, showOrientationMenu])

  useEffect(() => {
    setStatSigFilter(filterSignificantOnly ? 'statSigOnly' : 'all')
  }, [filterSignificantOnly])

  const toggleOption = (option: string) => {
    setSelectedOptions(prev =>
      prev.includes(option)
        ? prev.filter(o => o !== option)
        : [...prev, option]
    )
  }

  const selectAllOptions = () => setSelectedOptions(series.data.map(d => d.option))
  const deselectAllOptions = () => setSelectedOptions([])

  const shouldFilterByStatSig = filterSignificantOnly || statSigFilter === 'statSigOnly'

  const statSigFilteredData = useMemo(() => {
    if (!shouldFilterByStatSig) return series.data
    return series.data.filter(dataPoint =>
      dataPoint.significance && dataPoint.significance.some(sig => sig.significant)
    )
  }, [series, shouldFilterByStatSig])

  const processedData = useMemo(() => {
    const annotated = statSigFilteredData.map((d, index) => ({
      data: d,
      index,
      average: series.groups.length
        ? series.groups.reduce((sum, g) => sum + Number(d[g.key] ?? 0), 0) / series.groups.length
        : 0
    }))
    const filtered = annotated.filter(item => selectedOptions.includes(item.data.option))

    const sorted = [...filtered]
    switch (cardSort) {
      case 'descending':
        sorted.sort((a, b) => b.average - a.average)
        break
      case 'ascending':
        sorted.sort((a, b) => a.average - b.average)
        break
      case 'alphabetical':
        sorted.sort((a, b) => a.data.optionDisplay.localeCompare(b.data.optionDisplay))
        break
      default:
        sorted.sort((a, b) => a.index - b.index)
        break
    }

    return sorted.map(item => item.data)
  }, [series, selectedOptions, cardSort, statSigFilteredData])

  const hasData = processedData.length > 0
  const hasBaseData = series.data.length > 0
  const hasStatSigResults = statSigFilteredData.length > 0

  if (!hasBaseData) {
    return null
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-md transition-shadow hover:shadow-lg space-y-4">
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          {/* Chart Orientation Dropdown */}
          {chartVariant === 'bar' && (
            <div className="relative" ref={orientationMenuRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowOrientationMenu(prev => !prev)
                  setShowSortMenu(false)
                  setShowFilter(false)
                  setShowStatSigMenu(false)
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-brand-gray transition hover:bg-brand-pale-gray"
                title="Chart orientation"
                aria-label="Toggle chart orientation menu"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="6" height="16" rx="1.5" />
                  <rect x="15" y="4" width="6" height="10" rx="1.5" />
                </svg>
              </button>
              {showOrientationMenu && (
                <div className="absolute left-0 top-10 z-10 w-40 rounded-md bg-white shadow-lg">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setChartOrientation('horizontal')
                      setShowOrientationMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-pale-gray"
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={chartOrientation === 'horizontal'}
                      className="h-4 w-4 rounded text-brand-green focus:ring-brand-green"
                    />
                    <span>Horizontal</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setChartOrientation('vertical')
                      setShowOrientationMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-pale-gray"
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={chartOrientation === 'vertical'}
                      className="h-4 w-4 rounded text-brand-green focus:ring-brand-green"
                    />
                    <span>Vertical</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Sort Icon Dropdown */}
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowSortMenu(!showSortMenu)
                setShowFilter(false)
                setShowOrientationMenu(false)
                }}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-brand-gray transition hover:bg-brand-pale-gray"
              title="Sort"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M7 12h10M11 18h2" />
              </svg>
            </button>
            {showSortMenu && (
              <div className="absolute left-0 top-10 z-10 w-48 rounded-md bg-gray-50 shadow-lg py-2">
                {SORT_OPTIONS.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setCardSort(option)
                      setShowSortMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-gray hover:bg-brand-pale-gray"
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={cardSort === option}
                      className="h-4 w-4 rounded border-brand-light-gray text-brand-green focus:ring-brand-green"
                    />
                    <span className="capitalize">{option}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Filter Icon Dropdown */}
          <div className="relative" ref={filterMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowFilter(!showFilter)
                setShowOrientationMenu(false)
                setShowSortMenu(false)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-brand-gray transition hover:bg-brand-pale-gray"
              title="Filter Options"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
            </button>
            {showFilter && (
              <div className="absolute left-0 top-10 z-10 w-[32rem] rounded-md border border-brand-light-gray bg-white shadow-lg">
                <div className="px-4 py-3">
                  <div className="mb-2 flex gap-4 border-b border-brand-light-gray pb-2">
                    <button
                      className="text-xs text-brand-green underline hover:text-brand-green/80"
                      onClick={(e) => {
                        e.stopPropagation()
                        selectAllOptions()
                      }}
                    >
                      Select all
                    </button>
                    <button
                      className="text-xs text-brand-gray underline hover:text-brand-gray/80"
                      onClick={(e) => {
                        e.stopPropagation()
                        deselectAllOptions()
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto rounded-md bg-white ring-1 ring-brand-light-gray/40">
                    {series.data.map(option => (
                      <label
                        key={option.option}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="flex w-full items-center gap-2 cursor-pointer px-3 py-2 text-xs font-medium text-brand-gray transition bg-white hover:bg-brand-pale-gray/40"
                      >
                        <input
                          type="checkbox"
                          checked={selectedOptions.includes(option.option)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation()
                            toggleOption(option.option)
                          }}
                          className="rounded border-brand-light-gray text-brand-green focus:ring-brand-green flex-shrink-0"
                        />
                        <span className="flex-1">{option.optionDisplay}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Stat Sig Dropdown */}
          <div className="relative" ref={statSigMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowStatSigMenu(prev => !prev)
                setShowFilter(false)
                setShowSortMenu(false)
                setShowOrientationMenu(false)
              }}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition text-xs font-semibold ${
                filterSignificantOnly || statSigFilter === 'statSigOnly'
                  ? 'bg-brand-green text-white'
                  : 'bg-white text-brand-gray hover:bg-brand-pale-gray'
              }`}
              title="Statistical Significance Filter"
              aria-label="Toggle stat significance filter menu"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l2.09 6.26H20.5l-5.17 3.76 1.98 6.27L12 15.77l-5.31 3.52 1.98-6.27L3.5 9.26h6.41L12 3z" />
              </svg>
            </button>
            {showStatSigMenu && (
              <div className="absolute right-0 top-10 z-10 min-w-[132px] rounded-md bg-white shadow-lg">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setStatSigFilter('all')
                    setShowStatSigMenu(false)
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-brand-pale-gray whitespace-nowrap"
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={!filterSignificantOnly && statSigFilter === 'all'}
                    className="h-4 w-4 rounded border-brand-light-gray text-brand-green focus:ring-brand-green"
                  />
                  <span className="whitespace-nowrap">All Results</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setStatSigFilter('statSigOnly')
                    setShowStatSigMenu(false)
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-brand-pale-gray whitespace-nowrap"
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={filterSignificantOnly || statSigFilter === 'statSigOnly'}
                    className="h-4 w-4 rounded border-brand-light-gray text-brand-green focus:ring-brand-green"
                  />
                  <span className="whitespace-nowrap">Stat Sig Only</span>
                </button>
              </div>
            )}
          </div>
          {canUsePie && (
            <div className="flex items-center gap-1">
              <button
                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${chartVariant === 'bar' ? 'bg-brand-green text-white shadow' : 'bg-white text-brand-gray hover:bg-brand-pale-gray'}`}
                onClick={() => setChartVariant('bar')}
              >
                Bar
              </button>
              <button
                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${chartVariant === 'pie' ? 'bg-brand-green text-white shadow' : 'bg-white text-brand-gray hover:bg-brand-pale-gray'}`}
                onClick={() => setChartVariant('pie')}
              >
                Pie
              </button>
            </div>
          )}
        </div>
      </div>

      {hasData ? (
        chartVariant === 'pie' && canUsePie ? (
          <SingleSelectPieChart
            data={processedData}
            group={series.groups[0]}
            questionLabel={displayLabel}
          />
        ) : (
          <ComparisonChart
            data={processedData}
            groups={series.groups}
            orientation={chartOrientation}
            questionLabel={displayLabel}
          />
        )
      ) : selectedOptions.length === 0 ? (
        <div className="py-10 text-center text-xs text-brand-gray/60">No options selected.</div>
      ) : shouldFilterByStatSig && !hasStatSigResults ? (
        <div className="py-10 text-center text-xs text-brand-gray/60">No stat sig results :(</div>
      ) : (
        <div className="py-10 text-center text-xs text-brand-gray/60">No data available.</div>
      )}
    </div>
  )
}

interface ChartGalleryProps {
  questions: QuestionDef[]
  dataset: ParsedCSV
  segmentColumn?: string
  groups: string[]
  orientation: 'horizontal' | 'vertical'
  sortOrder: SortOrder
  selectedQuestionId?: string
  filterSignificantOnly?: boolean
}

export const ChartGallery: React.FC<ChartGalleryProps> = ({
  questions,
  dataset,
  segmentColumn,
  groups,
  orientation,
  sortOrder,
  selectedQuestionId: _selectedQuestionId,
  filterSignificantOnly = false
}) => {
  const renderableEntries = useMemo(() => {
    if (!segmentColumn || !groups.length) return []

    return questions
      .map(question => {
        const series = buildSeries({
          dataset,
          question,
          segmentColumn,
          groups,
          sortOrder
        })
        return { question, series }
      })
      .filter(entry => entry.series.data.length > 0)
  }, [dataset, questions, segmentColumn, groups, sortOrder])

  // Create a wrapper div with ref for each chart
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {renderableEntries.map(({ question, series }) => {
          return (
            <div
              key={question.qid}
              id={`chart-${question.qid}`}
            >
              <ChartCard
                question={question}
                series={series}
                orientation={orientation}
                displayLabel={formatQuestionTitle(question)}
                filterSignificantOnly={filterSignificantOnly}
              />
            </div>
          )
        })}
      </div>
      {renderableEntries.length === 0 && (
        <div className="py-8 text-center text-brand-gray/60">
          No charts to display. Please refine your filters.
        </div>
      )}
    </div>
  )
}
