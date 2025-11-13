import React, { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSort, faFilter, faStar, faRotate, faChartSimple, faArrowUpShortWide, faArrowDownWideShort, faArrowUpAZ, faChartPie, faTableCellsLarge, faBars } from '@fortawesome/free-solid-svg-icons'
import { ComparisonChart } from './ComparisonChart'
import { SingleSelectPieChart } from './SingleSelectPieChart'
import { HeatmapTable } from './HeatmapTable'
import { SentimentHeatmap } from './SentimentHeatmap'
import { RankingDisplay } from './RankingDisplay'
import { BuildSeriesResult, buildSeries } from '../dataCalculations'
import { ParsedCSV, QuestionDef, SortOrder, SegmentDef } from '../types'

type CardSortOption = 'default' | 'descending' | 'ascending' | 'alphabetical'

const EXCLUDED_VALUES = ['other', 'not specified', 'none of the above', 'skip', 'no preference', 'prefer not to say']

function isExcludedValue(value: string) {
  const normalized = value.trim().toLowerCase().replace(/["']/g, '')
  return EXCLUDED_VALUES.some(ex => normalized === ex || normalized.includes(ex))
}

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
  chartColors: string[]
  optionLabels: Record<string, string>
  onSaveOptionLabel: (option: string, newLabel: string) => void
  onSaveQuestionLabel?: (newLabel: string) => void
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
        : question.type === 'ranking'
          ? 'ranking'
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
  hideAsterisks = false,
  chartColors,
  optionLabels,
  onSaveOptionLabel,
  onSaveQuestionLabel
}) => {
  const [cardSort, setCardSort] = useState<CardSortOption>(question.isLikert ? 'alphabetical' : 'default')
  const [showFilter, setShowFilter] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [showStatSigMenu, setShowStatSigMenu] = useState(false)
  const [statSigFilter, setStatSigFilter] = useState<'all' | 'statSigOnly'>(filterSignificantOnly ? 'statSigOnly' : 'all')
  const [chartOrientation, setChartOrientation] = useState<'horizontal' | 'vertical'>(orientation)
  const [pieLegendOrientation, setPieLegendOrientation] = useState<'horizontal' | 'vertical'>('horizontal')
  const [customOptionOrder, setCustomOptionOrder] = useState<string[]>([])
  const [draggedOptionIndex, setDraggedOptionIndex] = useState<number | null>(null)
  const [axesSwapped, setAxesSwapped] = useState(false)
  const chartContentRef = useRef<HTMLDivElement | null>(null)

  // Screenshot handler - captures only chart content without buttons
  const handleScreenshot = async () => {
    if (!chartContentRef.current) return
    try {
      const canvas = await html2canvas(chartContentRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
      })
      const link = document.createElement('a')
      const filename = displayLabel ? `${displayLabel}.png` : 'chart.png'
      link.download = filename
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (error) {
      console.error('Screenshot failed:', error)
    }
  }

  // Can use alternate chart types for single select with < 7 visible options (after filtering)
  const visibleOptionsCount = series.data.length
  const canUseAlternateCharts = question.type === 'single' && visibleOptionsCount < 7
  const canUsePie = canUseAlternateCharts && series.groups.length === 1
  const canUseStacked = canUseAlternateCharts && series.groups.length > 1

  // Can use heatmap for product-level questions, only when viewing "Overall" segment
  const isOverallSegment = series.groups.length === 1 && series.groups[0]?.label === 'Overall'
  const canUseHeatmap = question.level === 'row' && isOverallSegment

  // Check if this is a sentiment question
  const sentimentColumn = dataset.summary.columns.find(col =>
    col.toLowerCase().includes('(sentiment)') && col.toLowerCase().includes('would you consider buying')
  )
  const isSentimentQuestion = canUseHeatmap && sentimentColumn && (
    (question.singleSourceColumn && question.singleSourceColumn === sentimentColumn) ||
    question.label.toLowerCase().includes('would you consider buying') ||
    question.label.toLowerCase().includes('(sentiment)')
  )

  // Debug logging
  console.log('Chart Debug:', {
    qid: question.qid,
    questionType: question.type,
    groupsLength: series.groups.length,
    rawColumnsLength: question.columns.length,
    visibleOptionsCount,
    canUsePie,
    canUseStacked,
    isSentimentQuestion
  })

  // Set initial chart variant - use heatmap for sentiment questions, bar for others
  const initialChartVariant: 'bar' | 'pie' | 'stacked' | 'heatmap' = isSentimentQuestion ? 'heatmap' : 'bar'
  const [chartVariant, setChartVariant] = useState<'bar' | 'pie' | 'stacked' | 'heatmap'>(initialChartVariant)
  const [heatmapFilters, setHeatmapFilters] = useState<{ products: string[], attributes: string[] }>({ products: [], attributes: [] })
  const [showHeatmapProductFilter, setShowHeatmapProductFilter] = useState(false)
  const [showHeatmapAttributeFilter, setShowHeatmapAttributeFilter] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const filterMenuRef = useRef<HTMLDivElement | null>(null)
  const statSigMenuRef = useRef<HTMLDivElement | null>(null)
  const heatmapProductFilterRef = useRef<HTMLDivElement | null>(null)
  const heatmapAttributeFilterRef = useRef<HTMLDivElement | null>(null)
  const previousQuestionIdRef = useRef<string | null>(null)

  useEffect(() => {
    // Only reset selections when the question itself changes, not when the data changes
    const questionChanged = previousQuestionIdRef.current !== question.qid

    if (questionChanged) {
      previousQuestionIdRef.current = question.qid
      setCardSort(question.isLikert || isSentimentQuestion ? 'alphabetical' : 'default')

      // Filter out excluded values from defaults
      const allOptions = series.data.map(d => d.option).filter(option => {
        const displayValue = series.data.find(d => d.option === option)?.optionDisplay || option
        return !isExcludedValue(displayValue)
      })

      // For ranking questions, show all options by default
      // For other questions with more than 10 options, keep only the top 10 by default
      const selectedDefaults = question.type === 'ranking'
        ? allOptions
        : (allOptions.length > 10 ? allOptions.slice(0, 10) : allOptions)
      setSelectedOptions(selectedDefaults)

      // Reset custom order when question changes
      setCustomOptionOrder([])
    }
  }, [series, question.qid, question.isLikert, question.type, isSentimentQuestion])

  useEffect(() => {
    setChartOrientation(orientation)
  }, [orientation])

  useEffect(() => {
    // Set default chart variant when question changes
    if (isSentimentQuestion) {
      setChartVariant('heatmap')
    } else {
      setChartVariant('bar')
    }
  }, [question.qid, isSentimentQuestion])

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
    if (showSortMenu || showFilter || showStatSigMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showSortMenu, showFilter, showStatSigMenu])

  useEffect(() => {
    setStatSigFilter(filterSignificantOnly ? 'statSigOnly' : 'all')
  }, [filterSignificantOnly])

  // Reset custom order when sort changes
  useEffect(() => {
    setCustomOptionOrder([])
  }, [cardSort])

  const toggleOption = (option: string) => {
    setSelectedOptions(prev =>
      prev.includes(option)
        ? prev.filter(o => o !== option)
        : [...prev, option]
    )
  }

  const selectAllOptions = () => setSelectedOptions(series.data.map(d => d.option))
  const deselectAllOptions = () => setSelectedOptions([])

  const handleOptionDragStart = (index: number) => {
    setDraggedOptionIndex(index)
  }

  const handleOptionDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedOptionIndex === null || draggedOptionIndex === index) return

    const currentOrder = customOptionOrder.length > 0
      ? customOptionOrder
      : sortedOptionsForFilter.map(d => d.option)

    const newOrder = [...currentOrder]
    const [draggedItem] = newOrder.splice(draggedOptionIndex, 1)
    newOrder.splice(index, 0, draggedItem)

    setCustomOptionOrder(newOrder)
    setDraggedOptionIndex(index)
  }

  const handleOptionDragEnd = () => {
    setDraggedOptionIndex(null)
  }

  const shouldFilterByStatSig = filterSignificantOnly || statSigFilter === 'statSigOnly'

  const statSigFilteredData = useMemo(() => {
    if (!shouldFilterByStatSig) return series.data
    return series.data.filter(dataPoint =>
      dataPoint.significance && dataPoint.significance.some(sig => sig.significant)
    )
  }, [series, shouldFilterByStatSig])

  const processedData = useMemo(() => {
    // Find the "Overall" group if it exists
    const overallGroup = series.groups.find(g => g.label === 'Overall')

    const annotated = statSigFilteredData.map((d, index) => {
      // Use Overall value if available, otherwise use average across all groups
      const sortValue = overallGroup
        ? Number(d[overallGroup.key] ?? 0)
        : series.groups.length
          ? series.groups.reduce((sum, g) => sum + Number(d[g.key] ?? 0), 0) / series.groups.length
          : 0

      return {
        data: d,
        index,
        average: sortValue
      }
    })
    const filtered = annotated.filter(item => selectedOptions.includes(item.data.option))

    // Filter out options where any group has 0 or 1% values
    const filteredWithoutLowValues = filtered.filter(item => {
      // Check if any group has a value <= 1%
      const hasLowValue = series.groups.some(group => {
        const value = Number(item.data[group.key] ?? 0)
        return value <= 1
      })
      return !hasLowValue
    })

    const sorted = [...filteredWithoutLowValues]
    const isPieChart = chartVariant === 'pie' && canUsePie

    // Apply sorting only if there's no custom order
    if (customOptionOrder.length === 0) {
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
          sorted.sort((a, b) => {
            const aText = a.data.optionDisplay
            const bText = b.data.optionDisplay

            // Extract numeric values for "Less than" / "<" and "More than" / ">" patterns
            const extractNumericValue = (text: string): { value: number | null, isLessThan: boolean, isMoreThan: boolean } => {
              const lessThanMatch = text.match(/(?:less\s+than|<)\s*\$?\s*([\d,]+)/i)
              const moreThanMatch = text.match(/(?:more\s+than|>)\s*\$?\s*([\d,]+)/i)

              if (lessThanMatch) {
                const num = parseFloat(lessThanMatch[1].replace(/,/g, ''))
                return { value: num, isLessThan: true, isMoreThan: false }
              }
              if (moreThanMatch) {
                const num = parseFloat(moreThanMatch[1].replace(/,/g, ''))
                return { value: num, isLessThan: false, isMoreThan: true }
              }

              // Try to extract any number from the text for range comparison
              const numMatch = text.match(/\$?\s*([\d,]+)/)
              if (numMatch) {
                const num = parseFloat(numMatch[1].replace(/,/g, ''))
                return { value: num, isLessThan: false, isMoreThan: false }
              }

              return { value: null, isLessThan: false, isMoreThan: false }
            }

            const aParsed = extractNumericValue(aText)
            const bParsed = extractNumericValue(bText)

            // If both have numeric values, sort numerically with special handling
            if (aParsed.value !== null && bParsed.value !== null) {
              // "Less than X" comes before ranges starting with X
              if (aParsed.isLessThan && !bParsed.isLessThan && aParsed.value <= bParsed.value) {
                return -1
              }
              if (bParsed.isLessThan && !aParsed.isLessThan && bParsed.value <= aParsed.value) {
                return 1
              }

              // "More than X" comes after ranges ending with X
              if (aParsed.isMoreThan && !bParsed.isMoreThan && aParsed.value >= bParsed.value) {
                return 1
              }
              if (bParsed.isMoreThan && !aParsed.isMoreThan && bParsed.value >= aParsed.value) {
                return -1
              }

              // Otherwise sort by numeric value
              return aParsed.value - bParsed.value
            }

            // Fall back to string comparison
            return aText.localeCompare(bText)
          })
          break
        default:
          sorted.sort((a, b) => a.index - b.index)
          break
      }
    }

    // Apply custom order if it exists (overrides cardSort)
    let finalSorted = sorted
    if (customOptionOrder.length > 0) {
      const orderMap = new Map(sorted.map(item => [item.data.option, item]))
      const ordered = customOptionOrder
        .filter(option => orderMap.has(option))
        .map(option => orderMap.get(option)!)
      const remaining = sorted.filter(item => !customOptionOrder.includes(item.data.option))
      finalSorted = [...ordered, ...remaining]
    }

    return finalSorted.map(item => {
      const data = { ...item.data }
      // Strip asterisk from optionDisplay if hideAsterisks is enabled
      if (hideAsterisks && data.optionDisplay.endsWith('*')) {
        data.optionDisplay = data.optionDisplay.slice(0, -1)
      }
      return data
    })
  }, [series, selectedOptions, cardSort, statSigFilteredData, chartVariant, canUsePie, canUseStacked, hideAsterisks, customOptionOrder])

  // Sorted options for filter dropdown - respects current cardSort (but doesn't filter by selection)
  const sortedOptionsForFilter = useMemo(() => {
    // Find the "Overall" group if it exists
    const overallGroup = series.groups.find(g => g.label === 'Overall')

    const annotated = statSigFilteredData.map((d, index) => {
      // Use Overall value if available, otherwise use average across all groups
      const sortValue = overallGroup
        ? Number(d[overallGroup.key] ?? 0)
        : series.groups.length
          ? series.groups.reduce((sum, g) => sum + Number(d[g.key] ?? 0), 0) / series.groups.length
          : 0

      return {
        data: d,
        index,
        average: sortValue
      }
    })

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
        sorted.sort((a, b) => {
          const aText = a.data.optionDisplay
          const bText = b.data.optionDisplay

          // Extract numeric values for "Less than" / "<" and "More than" / ">" patterns
          const extractNumericValue = (text: string): { value: number | null, isLessThan: boolean, isMoreThan: boolean } => {
            const lessThanMatch = text.match(/(?:less\s+than|<)\s*\$?\s*([\d,]+)/i)
            const moreThanMatch = text.match(/(?:more\s+than|>)\s*\$?\s*([\d,]+)/i)

            if (lessThanMatch) {
              const num = parseFloat(lessThanMatch[1].replace(/,/g, ''))
              return { value: num, isLessThan: true, isMoreThan: false }
            }
            if (moreThanMatch) {
              const num = parseFloat(moreThanMatch[1].replace(/,/g, ''))
              return { value: num, isLessThan: false, isMoreThan: true }
            }

            // Try to extract any number from the text for range comparison
            const numMatch = text.match(/\$?\s*([\d,]+)/)
            if (numMatch) {
              const num = parseFloat(numMatch[1].replace(/,/g, ''))
              return { value: num, isLessThan: false, isMoreThan: false }
            }

            return { value: null, isLessThan: false, isMoreThan: false }
          }

          const aParsed = extractNumericValue(aText)
          const bParsed = extractNumericValue(bText)

          // If both have numeric values, sort numerically with special handling
          if (aParsed.value !== null && bParsed.value !== null) {
            // "Less than X" comes before ranges starting with X
            if (aParsed.isLessThan && !bParsed.isLessThan && aParsed.value <= bParsed.value) {
              return -1
            }
            if (bParsed.isLessThan && !aParsed.isLessThan && bParsed.value <= aParsed.value) {
              return 1
            }

            // "More than X" comes after ranges ending with X
            if (aParsed.isMoreThan && !bParsed.isMoreThan && aParsed.value >= bParsed.value) {
              return 1
            }
            if (bParsed.isMoreThan && !aParsed.isMoreThan && bParsed.value >= aParsed.value) {
              return -1
            }

            // Otherwise sort by numeric value
            return aParsed.value - bParsed.value
          }

          // Fall back to string comparison
          return aText.localeCompare(bText)
        })
        break
      default:
        sorted.sort((a, b) => a.index - b.index)
        break
    }

    const processed = sorted.map(item => {
      const data = { ...item.data }
      // Strip asterisk from optionDisplay if hideAsterisks is enabled
      if (hideAsterisks && data.optionDisplay.endsWith('*')) {
        data.optionDisplay = data.optionDisplay.slice(0, -1)
      }
      return data
    })

    // Apply custom order if it exists
    let finalOrder = processed
    if (customOptionOrder.length > 0) {
      const orderMap = new Map(processed.map(d => [d.option, d]))
      const ordered = customOptionOrder
        .filter(option => orderMap.has(option))
        .map(option => orderMap.get(option)!)
      const remaining = processed.filter(d => !customOptionOrder.includes(d.option))
      finalOrder = [...ordered, ...remaining]
    }

    // Move excluded values to the bottom
    const excludedItems = finalOrder.filter(d => isExcludedValue(d.optionDisplay))
    const nonExcludedItems = finalOrder.filter(d => !isExcludedValue(d.optionDisplay))
    return [...nonExcludedItems, ...excludedItems]
  }, [series, cardSort, statSigFilteredData, chartVariant, canUsePie, hideAsterisks, customOptionOrder])

  // Transpose data when axes are swapped
  const { transposedData, transposedGroups } = useMemo(() => {
    if (!axesSwapped || series.groups.length <= 1) {
      return { transposedData: processedData, transposedGroups: series.groups }
    }

    // Create new data structure where groups become options and options become groups
    const newData: typeof processedData = []
    const newGroups = processedData.map(item => ({
      key: item.option,
      label: item.optionDisplay || item.option
    }))

    series.groups.forEach(group => {
      const newDataPoint: any = {
        option: group.key,
        optionDisplay: group.label
      }

      processedData.forEach(item => {
        newDataPoint[item.option] = item[group.key]
      })

      newData.push(newDataPoint)
    })

    return { transposedData: newData, transposedGroups: newGroups }
  }, [axesSwapped, processedData, series.groups])

  const hasData = transposedData.length > 0
  const hasBaseData = series.data.length > 0
  const hasStatSigResults = statSigFilteredData.length > 0

  if (!hasBaseData) {
    return null
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-md transition-shadow hover:shadow-lg space-y-4">
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2" style={{ paddingLeft: '40px' }}>
          {/* Chart Orientation Toggle - for bar charts and stacked charts */}
          {chartVariant !== 'heatmap' && (chartVariant === 'bar' || chartVariant === 'stacked') && question.type !== 'ranking' && (
            <button
              onClick={() => {
                setChartOrientation(prev => prev === 'horizontal' ? 'vertical' : 'horizontal')
              }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{ height: '30px', width: '30px', backgroundColor: '#EBF3E7', border: '1px solid #EBF3E7', borderRadius: '3px' }}
              title={`Switch to ${chartOrientation === 'horizontal' ? 'vertical' : 'horizontal'} orientation`}
              aria-label="Toggle chart orientation"
              type="button"
            >
              <FontAwesomeIcon
                icon={faBars}
                style={{
                  fontSize: '16px',
                  transform: chartOrientation === 'horizontal' ? 'rotate(0deg)' : 'rotate(90deg)',
                  transition: 'transform 0.2s ease'
                }}
              />
            </button>
          )}
          {/* Swap Axes Button - for bar charts with multiple segments */}
          {chartVariant !== 'heatmap' && chartVariant === 'bar' && series.groups.length > 1 && question.type !== 'ranking' && (
            <button
              onClick={() => setAxesSwapped(prev => !prev)}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{
                height: '30px',
                width: '30px',
                backgroundColor: axesSwapped ? '#C8E2BA' : '#EEF2F6',
                border: axesSwapped ? '1px solid #3A8518' : '1px solid #EEF2F6',
                borderRadius: '3px'
              }}
              title="Swap X/Y axes"
              aria-label="Swap X and Y axes"
              type="button"
            >
              <FontAwesomeIcon icon={faRotate} style={{ fontSize: '16px' }} />
            </button>
          )}
          {/* Pie Legend Orientation Toggle - for pie charts */}
          {chartVariant !== 'heatmap' && chartVariant === 'pie' && canUsePie && (
            <button
              onClick={() => {
                setPieLegendOrientation(prev => prev === 'horizontal' ? 'vertical' : 'horizontal')
              }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{ height: '30px', width: '30px', backgroundColor: '#EBF3E7', border: '1px solid #EBF3E7', borderRadius: '3px' }}
              title={`Switch to ${pieLegendOrientation === 'horizontal' ? 'vertical' : 'horizontal'} legend`}
              aria-label="Toggle legend orientation"
              type="button"
            >
              <FontAwesomeIcon
                icon={faBars}
                style={{
                  fontSize: '16px',
                  transform: pieLegendOrientation === 'horizontal' ? 'rotate(0deg)' : 'rotate(90deg)',
                  transition: 'transform 0.2s ease'
                }}
              />
            </button>
          )}
          {/* Sort Icon Dropdown */}
          {chartVariant !== 'heatmap' && question.type !== 'ranking' && (
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowSortMenu(!showSortMenu)
                setShowFilter(false)
                setShowStatSigMenu(false)
                }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{
                height: '30px',
                width: '30px',
                backgroundColor: cardSort !== 'default' ? '#C8E2BA' : '#EBF3E7',
                border: cardSort !== 'default' ? '1px solid #3A8518' : '1px solid #EBF3E7',
                borderRadius: '3px'
              }}
              title="Sort"
            >
              <FontAwesomeIcon
                icon={
                  cardSort === 'ascending' ? faArrowUpShortWide :
                  cardSort === 'descending' ? faArrowDownWideShort :
                  cardSort === 'alphabetical' ? faArrowUpAZ :
                  faSort
                }
                style={{ fontSize: '16px' }}
              />
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
          {/* Filter Icon Dropdown - shows for all question types */}
          <div className="relative" ref={filterMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowFilter(!showFilter)
                setShowSortMenu(false)
                setShowStatSigMenu(false)
              }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{
                height: '30px',
                width: '30px',
                backgroundColor: selectedOptions.length < series.data.length ? '#C8E2BA' : '#EBF3E7',
                border: selectedOptions.length < series.data.length ? '1px solid #3A8518' : '1px solid #EBF3E7',
                borderRadius: '3px'
              }}
              title="Filter Options"
            >
              <FontAwesomeIcon icon={faFilter} style={{ fontSize: '16px' }} />
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
                    {sortedOptionsForFilter.map((option, index) => (
                      <label
                        key={option.option}
                        draggable
                        onDragStart={() => handleOptionDragStart(index)}
                        onDragOver={(e) => handleOptionDragOver(e, index)}
                        onDragEnd={handleOptionDragEnd}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className={`flex w-full items-center cursor-move px-2 py-2 text-sm font-medium transition hover:bg-gray-100 rounded ${
                          draggedOptionIndex === index ? 'opacity-50 bg-gray-100' : ''
                        }`}
                        style={{ backgroundColor: draggedOptionIndex === index ? '#e5e7eb' : '#EEF2F6', gap: '4px' }}
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
          {/* Heatmap product filter portal */}
          {chartVariant === 'heatmap' && isSentimentQuestion && (
            <div id={`heatmap-filters-${question.qid}`}></div>
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
              }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{
                height: '30px',
                width: '30px',
                backgroundColor: filterSignificantOnly || statSigFilter === 'statSigOnly' ? '#C8E2BA' : '#EBF3E7',
                border: filterSignificantOnly || statSigFilter === 'statSigOnly' ? '1px solid #3A8518' : '1px solid #EBF3E7',
                borderRadius: '3px'
              }}
              title="Statistical Significance Filter"
              aria-label="Toggle stat significance filter menu"
              type="button"
            >
              <FontAwesomeIcon icon={faStar} style={{ fontSize: '16px' }} />
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
          {(canUsePie || canUseStacked || canUseHeatmap) && question.type !== 'ranking' && (
            <>
              <div className="flex items-center gap-0.5" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}>
                <button
                  className="flex items-center justify-center transition-all duration-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300 active:scale-95 cursor-pointer"
                  style={{
                    height: '30px',
                    width: '30px',
                    backgroundColor: chartVariant === 'bar' ? '#D6E9FF' : '#EEF2F6',
                    border: chartVariant === 'bar' ? '1px solid #80BDFF' : '1px solid #EEF2F6',
                    borderRadius: '3px'
                  }}
                  onClick={() => setChartVariant('bar')}
                  title="Bar chart"
                >
                  <FontAwesomeIcon icon={faChartSimple} style={{ fontSize: '16px' }} />
                </button>
                {canUsePie && !isSentimentQuestion && (
                  <button
                    className="flex items-center justify-center transition-all duration-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300 active:scale-95 cursor-pointer"
                    style={{
                      height: '30px',
                      width: '30px',
                      backgroundColor: chartVariant === 'pie' ? '#D6E9FF' : '#EEF2F6',
                      border: chartVariant === 'pie' ? '1px solid #80BDFF' : '1px solid #EEF2F6',
                      borderRadius: '3px'
                    }}
                    onClick={() => setChartVariant('pie')}
                    title="Pie chart"
                  >
                    <FontAwesomeIcon icon={faChartPie} style={{ fontSize: '16px' }} />
                  </button>
                )}
                {canUseStacked && (
                  <button
                    className="text-base font-semibold transition-all duration-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300 active:scale-95 cursor-pointer"
                    style={{
                      height: '30px',
                      minWidth: '70px',
                      backgroundColor: chartVariant === 'stacked' ? '#D6E9FF' : '#EEF2F6',
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
                    className="flex items-center justify-center transition-all duration-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300 active:scale-95 cursor-pointer"
                    style={{
                      height: '30px',
                      width: '30px',
                      backgroundColor: chartVariant === 'heatmap' ? '#D6E9FF' : '#EEF2F6',
                      border: chartVariant === 'heatmap' ? '1px solid #80BDFF' : '1px solid #EEF2F6',
                      borderRadius: '3px'
                    }}
                    onClick={() => setChartVariant('heatmap')}
                    title="Heatmap"
                  >
                    <FontAwesomeIcon icon={faTableCellsLarge} style={{ fontSize: '16px' }} />
                  </button>
                )}
              </div>
              {/* Portal div moved to be next to filter button for sentiment questions */}
              {chartVariant === 'heatmap' && !isSentimentQuestion && (
                <div id={`heatmap-filters-${question.qid}`}></div>
              )}
            </>
          )}
        </div>
      </div>

      <div ref={chartContentRef} style={{
        display: 'inline-block',
        minWidth: '100%',
        paddingTop: '20px',
        paddingBottom: '20px'
      }}>
      <div style={{
        transform: 'scale(0.9)',
        transformOrigin: 'top center'
      }}>
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

        // Render ranking questions with RankingDisplay component
        if (question.type === 'ranking') {
          console.log('Rendering ranking display for question:', question.qid)
          return (
            <RankingDisplay
              data={processedData}
              group={series.groups[0]}
              questionLabel={displayLabel}
              onSaveQuestionLabel={onSaveQuestionLabel}
            />
          )
        }

        if (chartVariant === 'pie' && canUsePie) {
          console.log('Rendering pie chart with group:', series.groups[0])
          return (
            <SingleSelectPieChart
              data={processedData}
              group={series.groups[0]}
              questionLabel={displayLabel}
              legendOrientation={pieLegendOrientation}
              colors={chartColors}
              optionLabels={optionLabels}
              onSaveOptionLabel={onSaveOptionLabel}
              onSaveQuestionLabel={onSaveQuestionLabel}
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
              colors={chartColors}
              optionLabels={optionLabels}
              onSaveOptionLabel={onSaveOptionLabel}
              onSaveQuestionLabel={onSaveQuestionLabel}
            />
          )
        }

        if (chartVariant === 'heatmap' && canUseHeatmap) {
          console.log('Rendering heatmap')

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

          if (allProducts.length === 0) {
            console.log('❌ No products found in product column')
            return (
              <div className="py-10 text-center text-xs text-brand-gray/60">
                No products found in {productColumn}.
              </div>
            )
          }

          // Check if this is a sentiment question by checking the question's source column
          const sentimentColumn = dataset.summary.columns.find(col =>
            col.toLowerCase().includes('(sentiment)') && col.toLowerCase().includes('would you consider buying')
          )

          const isSentimentQuestion = sentimentColumn && (
            // For single-select questions, check if the source column matches
            (question.singleSourceColumn && question.singleSourceColumn === sentimentColumn) ||
            // Or check if the question label contains sentiment-related text
            question.label.toLowerCase().includes('would you consider buying') ||
            question.label.toLowerCase().includes('(sentiment)')
          )

          console.log('📊 Heatmap Debug:', {
            productColumn,
            allProductsCount: allProducts.length,
            allProducts: allProducts.slice(0, 5),
            questionQid: question.qid,
            isSentimentQuestion
          })

          // If this is the sentiment question, render the SentimentHeatmap
          if (isSentimentQuestion) {
            console.log('📊 Rendering SentimentHeatmap for sentiment question')
            return (
              <div style={{ marginBottom: '20px' }}>
                <SentimentHeatmap
                  dataset={dataset}
                  productColumn={productColumn}
                  questionLabel={displayLabel}
                  questionId={question.qid}
                  hideAsterisks={hideAsterisks}
                  onSaveQuestionLabel={onSaveQuestionLabel}
                />
              </div>
            )
          }

          // Otherwise, render the regular attribute heatmap
          const labelLower = question.label.toLowerCase()
          const sentiment = labelLower.includes('(positive)') ? 'positive' :
                          labelLower.includes('(negative)') ? 'negative' : 'positive'

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

          // Apply custom option labels to heatmap data and filter out excluded values
          heatmapSeries.data = heatmapSeries.data
            .map(dataPoint => ({
              ...dataPoint,
              optionDisplay: optionLabels[dataPoint.option] || dataPoint.optionDisplay
            }))
            .filter(dataPoint => !isExcludedValue(dataPoint.optionDisplay))

          return (
            <HeatmapTable
              data={heatmapSeries.data}
              groups={heatmapSeries.groups}
              questionLabel={displayLabel}
              sentiment={sentiment}
              questionId={question.qid}
              dataset={dataset}
              productColumn={productColumn}
              hideAsterisks={hideAsterisks}
              optionLabels={optionLabels}
              onSaveOptionLabel={onSaveOptionLabel}
              onSaveQuestionLabel={onSaveQuestionLabel}
            />
          )
        }

        return (
          <ComparisonChart
            data={transposedData}
            groups={transposedGroups}
            orientation={chartOrientation}
            questionLabel={displayLabel}
            colors={chartColors}
            optionLabels={optionLabels}
            onSaveOptionLabel={onSaveOptionLabel}
            onSaveQuestionLabel={onSaveQuestionLabel}
          />
        )
      })()}
      </div>
      </div>
    </div>
  )
}

interface ChartGalleryProps {
  questions: QuestionDef[]
  dataset: ParsedCSV
  segmentColumn?: string
  groups?: string[]
  segments?: SegmentDef[]
  groupLabels?: Record<string, string>
  orientation: 'horizontal' | 'vertical'
  sortOrder: SortOrder
  selectedQuestionId?: string
  filterSignificantOnly?: boolean
  hideAsterisks?: boolean
  chartColors?: string[]
  optionLabels?: Record<string, Record<string, string>>
  onSaveOptionLabel?: (qid: string, option: string, newLabel: string) => void
  questionLabels?: Record<string, string>
  onSaveQuestionLabel?: (qid: string, newLabel: string) => void
}

export const ChartGallery: React.FC<ChartGalleryProps> = ({
  questions,
  dataset,
  segmentColumn,
  groups,
  segments,
  groupLabels = {},
  orientation,
  sortOrder,
  selectedQuestionId: _selectedQuestionId,
  filterSignificantOnly = false,
  hideAsterisks = false,
  chartColors = ['#3A8518', '#CED6DE', '#E7CB38', '#A5CF8E', '#717F90', '#F1E088', '#DAEBD1', '#FAF5D7'],
  optionLabels = {},
  onSaveOptionLabel,
  questionLabels = {},
  onSaveQuestionLabel
}) => {
  const renderableEntries = useMemo(() => {
    const hasSegments = segments && segments.length > 0
    const hasOldStyle = segmentColumn && groups && groups.length > 0

    if (!hasSegments && !hasOldStyle) return []

    return questions
      .map(question => {
        const series = buildSeries({
          dataset,
          question,
          ...(hasSegments
            ? { segments }
            : { segmentColumn, groups }
          ),
          sortOrder
        })

        // Apply custom labels to series groups
        series.groups = series.groups.map(group => ({
          ...group,
          label: groupLabels[group.key] || group.label
        }))

        // Apply custom labels to series data options
        const questionOptionLabels = optionLabels[question.qid] || {}
        series.data = series.data.map(dataPoint => ({
          ...dataPoint,
          optionDisplay: questionOptionLabels[dataPoint.option] || dataPoint.optionDisplay
        }))

        return { question, series }
      })
      .filter(entry => entry.series.data.length > 0)
  }, [dataset, questions, segmentColumn, groups, segments, sortOrder, groupLabels, optionLabels])

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
                displayLabel={questionLabels[question.qid] || formatQuestionTitle(question)}
                filterSignificantOnly={filterSignificantOnly}
                dataset={dataset}
                segmentColumn={segmentColumn}
                sortOrder={sortOrder}
                hideAsterisks={hideAsterisks}
                chartColors={chartColors}
                optionLabels={optionLabels[question.qid] || {}}
                onSaveOptionLabel={(option, newLabel) => onSaveOptionLabel?.(question.qid, option, newLabel)}
                onSaveQuestionLabel={(newLabel) => onSaveQuestionLabel?.(question.qid, newLabel)}
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
