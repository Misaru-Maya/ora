import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ComparisonChart } from './ComparisonChart'
import { SingleSelectPieChart } from './SingleSelectPieChart'
import { HeatmapTable } from './HeatmapTable'
import { BuildSeriesResult, buildSeries } from '../dataCalculations'
import { ParsedCSV, QuestionDef, SortOrder } from '../types'

type CardSortOption = 'default' | 'descending' | 'ascending' | 'alphabetical'

interface ChartCardProps {
  question: QuestionDef
  series: BuildSeriesResult
  orientation: 'horizontal' | 'vertical'
  displayLabel: string
  filterSignificantOnly?: boolean
  dataset: ParsedCSV
  segmentColumn?: string
  sortOrder: SortOrder
  hideAsterisks?: boolean
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
  filterSignificantOnly = false,
  dataset,
  segmentColumn,
  sortOrder,
  hideAsterisks = false
}) => {
  const [cardSort, setCardSort] = useState<CardSortOption>(question.isLikert ? 'alphabetical' : 'default')
  const [showFilter, setShowFilter] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showOrientationMenu, setShowOrientationMenu] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [showStatSigMenu, setShowStatSigMenu] = useState(false)
  const [statSigFilter, setStatSigFilter] = useState<'all' | 'statSigOnly'>(filterSignificantOnly ? 'statSigOnly' : 'all')
  const [chartOrientation, setChartOrientation] = useState<'horizontal' | 'vertical'>(orientation)
  const [pieLegendOrientation, setPieLegendOrientation] = useState<'horizontal' | 'vertical'>('horizontal')

  // Can use alternate chart types for single select with < 7 visible options (after filtering)
  const visibleOptionsCount = series.data.length
  const canUseAlternateCharts = question.type === 'single' && visibleOptionsCount < 7
  const canUsePie = canUseAlternateCharts && series.groups.length === 1
  const canUseStacked = canUseAlternateCharts && series.groups.length > 1

  // Can use heatmap for product-level questions, only when viewing "Overall" segment
  const isOverallSegment = series.groups.length === 1 && series.groups[0]?.label === 'Overall'
  const canUseHeatmap = question.level === 'row' && isOverallSegment

  // Debug logging
  console.log('Chart Debug:', {
    qid: question.qid,
    questionType: question.type,
    groupsLength: series.groups.length,
    rawColumnsLength: question.columns.length,
    visibleOptionsCount,
    canUsePie,
    canUseStacked
  })

  const [chartVariant, setChartVariant] = useState<'bar' | 'pie' | 'stacked' | 'heatmap'>('bar')
  const [heatmapFilters, setHeatmapFilters] = useState<{ products: string[], attributes: string[] }>({ products: [], attributes: [] })
  const [showHeatmapProductFilter, setShowHeatmapProductFilter] = useState(false)
  const [showHeatmapAttributeFilter, setShowHeatmapAttributeFilter] = useState(false)
  const orientationMenuRef = useRef<HTMLDivElement | null>(null)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const filterMenuRef = useRef<HTMLDivElement | null>(null)
  const statSigMenuRef = useRef<HTMLDivElement | null>(null)
  const heatmapProductFilterRef = useRef<HTMLDivElement | null>(null)
  const heatmapAttributeFilterRef = useRef<HTMLDivElement | null>(null)

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
    if (!canUseStacked && chartVariant === 'stacked') {
      setChartVariant('bar')
    }
    if (!canUseHeatmap && chartVariant === 'heatmap') {
      setChartVariant('bar')
    }
  }, [canUsePie, canUseStacked, canUseHeatmap, chartVariant, question.qid])

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
    const isPieChart = chartVariant === 'pie' && canUsePie

    switch (cardSort) {
      case 'descending':
        // For pie charts, reverse the sort so largest appears at top going clockwise = descending visually
        sorted.sort((a, b) => isPieChart ? a.average - b.average : b.average - a.average)
        break
      case 'ascending':
        // For pie charts, reverse the sort so smallest appears at top going clockwise = ascending visually
        sorted.sort((a, b) => isPieChart ? b.average - a.average : a.average - b.average)
        break
      case 'alphabetical':
        sorted.sort((a, b) => a.data.optionDisplay.localeCompare(b.data.optionDisplay))
        break
      default:
        sorted.sort((a, b) => a.index - b.index)
        break
    }

    return sorted.map(item => {
      const data = { ...item.data }
      // Strip asterisk from optionDisplay if hideAsterisks is enabled
      if (hideAsterisks && data.optionDisplay.endsWith('*')) {
        data.optionDisplay = data.optionDisplay.slice(0, -1)
      }
      return data
    })
  }, [series, selectedOptions, cardSort, statSigFilteredData, chartVariant, canUsePie, canUseStacked, hideAsterisks])

  // Sorted options for filter dropdown - respects current cardSort (but doesn't filter by selection)
  const sortedOptionsForFilter = useMemo(() => {
    const annotated = statSigFilteredData.map((d, index) => ({
      data: d,
      index,
      average: series.groups.length
        ? series.groups.reduce((sum, g) => sum + Number(d[g.key] ?? 0), 0) / series.groups.length
        : 0
    }))

    const sorted = [...annotated]
    const isPieChart = chartVariant === 'pie' && canUsePie

    switch (cardSort) {
      case 'descending':
        sorted.sort((a, b) => isPieChart ? a.average - b.average : b.average - a.average)
        break
      case 'ascending':
        sorted.sort((a, b) => isPieChart ? b.average - a.average : a.average - b.average)
        break
      case 'alphabetical':
        sorted.sort((a, b) => a.data.optionDisplay.localeCompare(b.data.optionDisplay))
        break
      default:
        sorted.sort((a, b) => a.index - b.index)
        break
    }

    return sorted.map(item => {
      const data = { ...item.data }
      // Strip asterisk from optionDisplay if hideAsterisks is enabled
      if (hideAsterisks && data.optionDisplay.endsWith('*')) {
        data.optionDisplay = data.optionDisplay.slice(0, -1)
      }
      return data
    })
  }, [series, cardSort, statSigFilteredData, chartVariant, canUsePie, hideAsterisks])

  const hasData = processedData.length > 0
  const hasBaseData = series.data.length > 0
  const hasStatSigResults = statSigFilteredData.length > 0

  if (!hasBaseData) {
    return null
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-md transition-shadow hover:shadow-lg space-y-4">
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2" style={{ paddingLeft: '40px' }}>
          {/* Chart Orientation Dropdown - for bar charts and stacked charts */}
          {chartVariant !== 'heatmap' && (chartVariant === 'bar' || chartVariant === 'stacked') && (
            <div className="relative" ref={orientationMenuRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowOrientationMenu(prev => !prev)
                  setShowSortMenu(false)
                  setShowFilter(false)
                  setShowStatSigMenu(false)
                }}
                className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
                style={{ height: '30px', width: '30px', backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}
                title="Chart orientation"
                aria-label="Toggle chart orientation menu"
                type="button"
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </button>
              {showOrientationMenu && (
                <div className="absolute left-0 top-10 z-10 w-56 shadow-xl" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px', opacity: 1 }}>
                  <div className="px-4 py-3" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setChartOrientation('horizontal')
                        setShowOrientationMenu(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setChartOrientation('horizontal')
                          setShowOrientationMenu(false)
                        }
                      }}
                      className="flex w-full items-center cursor-pointer px-2 py-2 text-sm transition hover:bg-gray-100 rounded"
                      style={{ backgroundColor: '#EEF2F6', gap: '2px' }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={chartOrientation === 'horizontal'}
                        className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green flex-shrink-0"
                      />
                      <span className="text-gray-900 text-sm">Horizontal</span>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setChartOrientation('vertical')
                        setShowOrientationMenu(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setChartOrientation('vertical')
                          setShowOrientationMenu(false)
                        }
                      }}
                      className="flex w-full items-center cursor-pointer px-2 py-2 text-sm transition hover:bg-gray-100 rounded"
                      style={{ backgroundColor: '#EEF2F6', gap: '2px' }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={chartOrientation === 'vertical'}
                        className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green flex-shrink-0"
                      />
                      <span className="text-gray-900 text-sm">Vertical</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Pie Legend Orientation Dropdown - for pie charts */}
          {chartVariant !== 'heatmap' && chartVariant === 'pie' && canUsePie && (
            <div className="relative" ref={orientationMenuRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowOrientationMenu(prev => !prev)
                  setShowSortMenu(false)
                  setShowFilter(false)
                  setShowStatSigMenu(false)
                }}
                className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
                style={{ height: '30px', width: '30px', backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}
                title="Legend orientation"
                aria-label="Toggle legend orientation menu"
                type="button"
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </button>
              {showOrientationMenu && (
                <div className="absolute left-0 top-10 z-10 w-56 shadow-xl" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px', opacity: 1 }}>
                  <div className="px-4 py-3" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPieLegendOrientation('horizontal')
                        setShowOrientationMenu(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setPieLegendOrientation('horizontal')
                          setShowOrientationMenu(false)
                        }
                      }}
                      className="flex w-full items-center cursor-pointer px-2 py-2 text-sm transition hover:bg-gray-100 rounded"
                      style={{ backgroundColor: '#EEF2F6', gap: '2px' }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={pieLegendOrientation === 'horizontal'}
                        className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green flex-shrink-0"
                      />
                      <span className="text-gray-900 text-sm">Horizontal</span>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPieLegendOrientation('vertical')
                        setShowOrientationMenu(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setPieLegendOrientation('vertical')
                          setShowOrientationMenu(false)
                        }
                      }}
                      className="flex w-full items-center cursor-pointer px-2 py-2 text-sm transition hover:bg-gray-100 rounded"
                      style={{ backgroundColor: '#EEF2F6', gap: '2px' }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={pieLegendOrientation === 'vertical'}
                        className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green flex-shrink-0"
                      />
                      <span className="text-gray-900 text-sm">Vertical</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Sort Icon Dropdown */}
          {chartVariant !== 'heatmap' && (
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowSortMenu(!showSortMenu)
                setShowFilter(false)
                setShowOrientationMenu(false)
                setShowStatSigMenu(false)
                }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
              style={{ height: '30px', width: '30px', backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}
              title="Sort"
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21 16-4 4-4-4" />
                <path d="M17 20V4" />
                <path d="m3 8 4-4 4 4" />
                <path d="M7 4v16" />
              </svg>
            </button>
            {showSortMenu && (
              <div className="absolute left-0 top-10 z-10 w-64 shadow-xl" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px', opacity: 1 }}>
                <div className="px-4 py-3" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                  {SORT_OPTIONS.map((option) => (
                    <div
                      key={option}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setCardSort(option)
                        setShowSortMenu(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setCardSort(option)
                          setShowSortMenu(false)
                        }
                      }}
                      className="flex w-full items-center cursor-pointer px-2 py-2 text-sm transition hover:bg-gray-100 rounded"
                      style={{ backgroundColor: '#EEF2F6', gap: '2px' }}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={cardSort === option}
                        className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green flex-shrink-0"
                      />
                      <span className="capitalize text-gray-900 text-sm">{option}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
          {/* Filter Icon Dropdown */}
          {chartVariant !== 'heatmap' && (
          <div className="relative" ref={filterMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowFilter(!showFilter)
                setShowOrientationMenu(false)
                setShowSortMenu(false)
                setShowStatSigMenu(false)
              }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
              style={{ height: '30px', width: '30px', backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}
              title="Filter Options"
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M7 12h10" />
                <path d="M10 18h4" />
              </svg>
            </button>
            {showFilter && (
              <div className="absolute left-0 top-10 z-50 w-[32rem] shadow-xl" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px', opacity: 1 }}>
                <div className="px-4 py-3" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                  <div className="mb-2 flex justify-end gap-4 border-b pb-2" style={{ borderColor: '#80BDFF' }}>
                    <button
                      className="text-xs text-brand-green underline hover:text-brand-green/80"
                      style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        selectAllOptions()
                      }}
                    >
                      Select all
                    </button>
                    <button
                      className="text-xs text-brand-gray underline hover:text-brand-gray/80"
                      style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        deselectAllOptions()
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1.5" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                    {sortedOptionsForFilter.map(option => (
                      <label
                        key={option.option}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="flex w-full items-center cursor-pointer px-2 py-2 text-sm font-medium transition hover:bg-gray-100 rounded"
                        style={{ backgroundColor: '#EEF2F6', gap: '2px' }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedOptions.includes(option.option)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation()
                            toggleOption(option.option)
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green flex-shrink-0"
                        />
                        <span className="flex-1 text-gray-900 font-normal text-sm">{option.optionDisplay}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
          {/* Stat Sig Dropdown */}
          {chartVariant !== 'heatmap' && !isOverallSegment && (
          <div className="relative" ref={statSigMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowStatSigMenu(prev => !prev)
                setShowFilter(false)
                setShowSortMenu(false)
                setShowOrientationMenu(false)
              }}
              className={`flex items-center justify-center transition-all duration-200 text-xs font-semibold shadow-sm active:scale-95 ${
                filterSignificantOnly || statSigFilter === 'statSigOnly'
                  ? 'bg-brand-green text-white hover:bg-green-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900'
              }`}
              style={{
                height: '30px',
                width: '30px',
                backgroundColor: filterSignificantOnly || statSigFilter === 'statSigOnly' ? undefined : '#EEF2F6',
                border: filterSignificantOnly || statSigFilter === 'statSigOnly' ? '1px solid #10B981' : '1px solid #EEF2F6',
                borderRadius: '3px'
              }}
              title="Statistical Significance Filter"
              aria-label="Toggle stat significance filter menu"
              type="button"
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
            {showStatSigMenu && (
              <div className="absolute right-0 top-10 z-10 w-60 shadow-xl" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px', opacity: 1 }}>
                <div className="px-4 py-3" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setStatSigFilter('all')
                      setShowStatSigMenu(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setStatSigFilter('all')
                        setShowStatSigMenu(false)
                      }
                    }}
                    className="flex w-full items-center cursor-pointer px-2 py-2 text-sm transition hover:bg-gray-100 whitespace-nowrap rounded"
                    style={{ backgroundColor: '#EEF2F6', gap: '2px' }}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={!filterSignificantOnly && statSigFilter === 'all'}
                      className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green flex-shrink-0"
                    />
                    <span className="whitespace-nowrap text-gray-900 text-sm">All Results</span>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setStatSigFilter('statSigOnly')
                      setShowStatSigMenu(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setStatSigFilter('statSigOnly')
                        setShowStatSigMenu(false)
                      }
                    }}
                    className="flex w-full items-center cursor-pointer px-2 py-2 text-sm transition hover:bg-gray-100 whitespace-nowrap rounded"
                    style={{ backgroundColor: '#EEF2F6', gap: '2px' }}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={filterSignificantOnly || statSigFilter === 'statSigOnly'}
                      className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green flex-shrink-0"
                    />
                    <span className="whitespace-nowrap text-gray-900 text-sm">Stat Sig Only</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
          {(canUsePie || canUseStacked || canUseHeatmap) && (
            <>
              <div className="flex items-center gap-0.5" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}>
                <button
                  className="text-base font-semibold transition-all duration-200 text-gray-600 hover:bg-gray-200"
                  style={{
                    height: '30px',
                    width: '30px',
                    backgroundColor: '#EEF2F6',
                    border: chartVariant === 'bar' ? '1px solid #80BDFF' : '1px solid #EEF2F6',
                    borderRadius: '3px',
                    padding: '0 2px'
                  }}
                  onClick={() => setChartVariant('bar')}
                >
                  <span style={{ padding: '0 2px' }}>Bar</span>
                </button>
                {canUsePie && (
                  <button
                    className="text-base font-semibold transition-all duration-200 text-gray-600 hover:bg-gray-200"
                    style={{
                      height: '30px',
                      width: '30px',
                      backgroundColor: '#EEF2F6',
                      border: chartVariant === 'pie' ? '1px solid #80BDFF' : '1px solid #EEF2F6',
                      borderRadius: '3px',
                      padding: '0 2px'
                    }}
                    onClick={() => setChartVariant('pie')}
                  >
                    <span style={{ padding: '0 2px' }}>Pie</span>
                  </button>
                )}
                {canUseStacked && (
                  <button
                    className="text-base font-semibold transition-all duration-200 text-gray-600 hover:bg-gray-200"
                    style={{
                      height: '30px',
                      minWidth: '70px',
                      backgroundColor: '#EEF2F6',
                      border: chartVariant === 'stacked' ? '1px solid #80BDFF' : '1px solid #EEF2F6',
                      borderRadius: '3px',
                      padding: '0 6px'
                    }}
                    onClick={() => {
                      setChartVariant('stacked')
                      setChartOrientation('horizontal')
                    }}
                  >
                    <span style={{ padding: '0 2px' }}>Stacked</span>
                  </button>
                )}
                {canUseHeatmap && (
                  <button
                    className="text-base font-semibold transition-all duration-200 text-gray-600 hover:bg-gray-200"
                    style={{
                      height: '30px',
                      width: '30px',
                      backgroundColor: '#EEF2F6',
                      border: chartVariant === 'heatmap' ? '1px solid #80BDFF' : '1px solid #EEF2F6',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onClick={() => setChartVariant('heatmap')}
                  >
                    Map
                  </button>
                )}
              </div>
              {chartVariant === 'heatmap' && (
                <div id={`heatmap-filters-${question.qid}`}></div>
              )}
            </>
          )}
        </div>
      </div>

      {(() => {
        console.log('Render Debug:', {
          qid: question.qid,
          hasData,
          chartVariant,
          canUsePie,
          willRenderPie: chartVariant === 'pie' && canUsePie,
          processedDataLength: processedData.length,
          selectedOptionsLength: selectedOptions.length
        })

        if (!hasData) {
          if (selectedOptions.length === 0) {
            return <div className="py-10 text-center text-xs text-brand-gray/60">No options selected.</div>
          } else if (shouldFilterByStatSig && !hasStatSigResults) {
            return <div className="py-10 text-center text-xs text-brand-gray/60">No stat sig results :(</div>
          } else {
            return <div className="py-10 text-center text-xs text-brand-gray/60">No data available.</div>
          }
        }

        if (chartVariant === 'pie' && canUsePie) {
          console.log('Rendering pie chart with group:', series.groups[0])
          return (
            <SingleSelectPieChart
              data={processedData}
              group={series.groups[0]}
              questionLabel={displayLabel}
              legendOrientation={pieLegendOrientation}
            />
          )
        }

        if (chartVariant === 'stacked' && canUseStacked) {
          console.log('Rendering stacked chart with orientation:', chartOrientation)

          // Transform data: swap rows and columns
          // Current: rows = answer options, columns = segments
          // Needed: rows = segments, columns = answer options
          const stackedData = series.groups.map(group => {
            const row: any = {
              optionDisplay: group.label,
              option: group.key,
              significance: [],
              groupSummaries: []
            }

            // Each answer option becomes a column in the stacked bar
            processedData.forEach(dataPoint => {
              const value = dataPoint[group.key]
              row[dataPoint.option] = typeof value === 'number' ? value : 0
            })

            return row
          })

          // Create new groups metadata for answer options
          const stackedGroups = processedData.map(dataPoint => ({
            label: dataPoint.optionDisplay,
            key: dataPoint.option
          }))

          console.log('Stacked data:', stackedData)
          console.log('Stacked groups:', stackedGroups)

          return (
            <ComparisonChart
              data={stackedData}
              groups={stackedGroups}
              orientation={chartOrientation}
              questionLabel={displayLabel}
              stacked={true}
            />
          )
        }

        if (chartVariant === 'heatmap' && canUseHeatmap) {
          console.log('Rendering heatmap')

          // Detect sentiment from question label
          const labelLower = question.label.toLowerCase()
          const sentiment = labelLower.includes('(positive)') ? 'positive' :
                          labelLower.includes('(negative)') ? 'negative' : 'positive'

          // Find the Product Title column for heatmap grouping
          // Look for "Product Title", "Product Name", "Style", etc.
          const productColumn = dataset.summary.columns.find(col => {
            const lower = col.toLowerCase()
            return (
              lower === 'product title' ||
              lower === 'product name' ||
              lower === 'style' ||
              (lower.includes('product') && lower.includes('title'))
            )
          })

          if (!productColumn) {
            console.log('❌ No product column found for heatmap')
            return (
              <div className="py-10 text-center text-xs text-brand-gray/60">
                Product column not found. Expected "Product Title" or similar column.
              </div>
            )
          }

          // Get all unique products from the dataset using the product column
          const allProducts = Array.from(
            new Set(dataset.rows.map(row => String(row[productColumn] ?? '')).filter(Boolean))
          ).sort()

          console.log('📊 Heatmap Debug:', {
            productColumn,
            allProductsCount: allProducts.length,
            allProducts: allProducts.slice(0, 5),
            questionQid: question.qid,
            sentiment
          })

          if (allProducts.length === 0) {
            console.log('❌ No products found in product column')
            return (
              <div className="py-10 text-center text-xs text-brand-gray/60">
                No products found in {productColumn}.
              </div>
            )
          }

          // Rebuild series with all products using the product column as segmentColumn
          const heatmapSeries = buildSeries({
            dataset,
            question,
            segmentColumn: productColumn,
            groups: allProducts,
            sortOrder
          })

          console.log('📊 Heatmap Series Built:', {
            dataLength: heatmapSeries.data.length,
            groupsLength: heatmapSeries.groups.length,
            groups: heatmapSeries.groups,
            sampleData: heatmapSeries.data[0]
          })

          return (
            <HeatmapTable
              data={heatmapSeries.data}
              groups={heatmapSeries.groups}
              questionLabel={displayLabel}
              sentiment={sentiment}
              questionId={question.qid}
              dataset={dataset}
              productColumn={productColumn}
            />
          )
        }

        return (
          <ComparisonChart
            data={processedData}
            groups={series.groups}
            orientation={chartOrientation}
            questionLabel={displayLabel}
          />
        )
      })()}
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
  hideAsterisks?: boolean
}

export const ChartGallery: React.FC<ChartGalleryProps> = ({
  questions,
  dataset,
  segmentColumn,
  groups,
  orientation,
  sortOrder,
  selectedQuestionId: _selectedQuestionId,
  filterSignificantOnly = false,
  hideAsterisks = false
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
                dataset={dataset}
                segmentColumn={segmentColumn}
                sortOrder={sortOrder}
                hideAsterisks={hideAsterisks}
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
