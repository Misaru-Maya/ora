import React, { useEffect, useMemo, useRef, useState, memo } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSort, faFilter, faRotate, faChartSimple, faArrowUpShortWide, faArrowDownWideShort, faArrowUpAZ, faChartPie, faTableCellsLarge, faBars, faChartBar, faCopy, faCheck } from '@fortawesome/free-solid-svg-icons'
import { ComparisonChart } from './ComparisonChart'
import { SingleSelectPieChart } from './SingleSelectPieChart'
import { HeatmapTable } from './HeatmapTable'
import { SentimentHeatmap } from './SentimentHeatmap'
import { RankingDisplay } from './RankingDisplay'
import { buildSeries, buildSeriesFromComparisonSets } from '../dataCalculations'
import type { BuildSeriesResult } from '../dataCalculations'
import type { ParsedCSV, QuestionDef, SortOrder, SegmentDef, ComparisonSet } from '../types'

// Performance: Disable console logs in production
const isDev = process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}

type CardSortOption = 'default' | 'descending' | 'ascending' | 'alphabetical'

const EXCLUDED_VALUES = ['other', 'not specified', 'none of the above', 'skip', 'no preference', 'prefer not to say']

function isExcludedValue(value: string) {
  const normalized = value.trim().toLowerCase().replace(/["']/g, '')
  return EXCLUDED_VALUES.some(ex => normalized === ex || normalized.includes(ex))
}

// Normalize product values to match App.tsx behavior
function normalizeProductValue(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value).trim()
  const unquoted = str.replace(/^"|"$/g, '')
  return unquoted || 'Unspecified'
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
  comparisonMode?: boolean
  multiFilterCompareMode?: boolean
  chartColors: string[]
  optionLabels: Record<string, string>
  onSaveOptionLabel: (option: string, newLabel: string) => void
  onSaveQuestionLabel?: (newLabel: string) => void
  productOrder?: string[]
  hideSegment?: boolean
  hideQuestionType?: boolean
}

const SORT_OPTIONS: CardSortOption[] = ['default', 'descending', 'ascending', 'alphabetical']

const formatQuestionTitle = (question: QuestionDef): string => {
  let base = question.label === 'When were you born?' ? 'How old are you?' : question.label

  // Remove (positive) and (negative) markers from question title - they are shown in segment badges instead
  base = base.replace(/\s*\(positive\)/gi, '').replace(/\s*\(negative\)/gi, '')

  return base
}

const getQuestionTypeLabel = (question: QuestionDef): string => {
  if (question.isLikert) return 'Likert'
  if (question.type === 'single') return 'Single Select'
  if (question.type === 'multi') return 'Multi Select'
  if (question.type === 'ranking') return 'Ranking'
  return question.type
}

const ChartCard: React.FC<ChartCardProps> = memo(({
  question,
  series,
  orientation,
  displayLabel,
  filterSignificantOnly = false,
  dataset,
  segmentColumn: _segmentColumn,
  sortOrder,
  hideAsterisks = false,
  comparisonMode = true,
  multiFilterCompareMode = false,
  chartColors,
  optionLabels,
  onSaveOptionLabel,
  onSaveQuestionLabel,
  productOrder = [],
  hideSegment = false,
  hideQuestionType = false
}) => {
  const [cardSort, setCardSort] = useState<CardSortOption>(question.isLikert ? 'alphabetical' : 'default')
  const [showFilter, setShowFilter] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [chartOrientation, setChartOrientation] = useState<'horizontal' | 'vertical'>(orientation)
  const [pieLegendOrientation, setPieLegendOrientation] = useState<'horizontal' | 'vertical'>('horizontal')
  const [customOptionOrder, setCustomOptionOrder] = useState<string[]>([])
  const [draggedOptionIndex, setDraggedOptionIndex] = useState<number | null>(null)
  const [axesSwapped, setAxesSwapped] = useState(false)
  const chartContentRef = useRef<HTMLDivElement | null>(null)

  // Badge drag state
  const [badgePosition, setBadgePosition] = useState<{ x: number; y: number } | null>(null)
  const [isDraggingBadge, setIsDraggingBadge] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const badgeRef = useRef<HTMLDivElement | null>(null)

  // Chart width resize state
  const [chartWidthPercent, setChartWidthPercent] = useState(100)
  const [isResizingChart, setIsResizingChart] = useState(false)
  const [resizingHandle, setResizingHandle] = useState<'left' | 'right' | null>(null)
  const chartResizeStartX = useRef<number>(0)
  const chartResizeStartWidth = useRef<number>(100)
  const chartContainerRef = useRef<HTMLDivElement | null>(null)

  // Chart height resize state
  const [chartHeightOffset, setChartHeightOffset] = useState(0)
  const [isResizingHeight, setIsResizingHeight] = useState(false)
  const heightResizeStartY = useRef<number>(0)
  const heightResizeStartOffset = useRef<number>(0)

  // Copy to clipboard state
  const [isCopying, setIsCopying] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const exportContentRef = useRef<HTMLDivElement | null>(null)

  // Screenshot handler - captures only chart content without buttons
  // Uses dynamic import to avoid loading html2canvas until actually needed
  const _handleScreenshot = async () => {
    if (!chartContentRef.current) return
    try {
      // Dynamic import - only loads html2canvas when screenshot is taken
      const html2canvas = (await import('html2canvas')).default
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

  // Copy to clipboard handler - copies chart with rounded corners and shadow
  const handleCopyToClipboard = async () => {
    if (!exportContentRef.current || isCopying) return

    setIsCopying(true)
    setCopySuccess(false)

    try {
      const html2canvas = (await import('html2canvas')).default

      // Step 1: Capture the content at 3x scale for very high resolution
      const captureScale = 3 // Higher = sharper image (2 = standard, 3 = high, 4 = very high)
      const contentCanvas = await html2canvas(exportContentRef.current, {
        backgroundColor: '#ffffff',
        scale: captureScale,
        logging: false,
        useCORS: true,
      })

      // Step 2: Create final canvas with room for shadow
      // Match ORA's CSS shadow: 0 4px 20px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)
      const borderRadius = 20 * captureScale // 20px scaled
      const padding = 15 * captureScale // Extra space for shadow spread
      const outputScale = 2 // Final output size (200% of 2x = 4x original)

      const finalWidth = (contentCanvas.width + padding * 2) * outputScale
      const finalHeight = (contentCanvas.height + padding * 2) * outputScale

      const finalCanvas = document.createElement('canvas')
      finalCanvas.width = finalWidth
      finalCanvas.height = finalHeight
      const ctx = finalCanvas.getContext('2d')

      if (ctx) {
        ctx.scale(outputScale, outputScale)

        // Draw rounded rectangle path
        const x = padding
        const y = padding
        const w = contentCanvas.width
        const h = contentCanvas.height
        const r = borderRadius

        const drawRoundedRect = () => {
          ctx.beginPath()
          ctx.moveTo(x + r, y)
          ctx.lineTo(x + w - r, y)
          ctx.quadraticCurveTo(x + w, y, x + w, y + r)
          ctx.lineTo(x + w, y + h - r)
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
          ctx.lineTo(x + r, y + h)
          ctx.quadraticCurveTo(x, y + h, x, y + h - r)
          ctx.lineTo(x, y + r)
          ctx.quadraticCurveTo(x, y, x + r, y)
          ctx.closePath()
        }

        // Step 3: Draw shadows matching app CSS exactly:
        // boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)'

        // First shadow layer: 0 4px 20px rgba(0, 0, 0, 0.08)
        ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
        ctx.shadowBlur = 20 * captureScale // 20px scaled
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 4 * captureScale // 4px scaled
        drawRoundedRect()
        ctx.fillStyle = '#ffffff'
        ctx.fill()

        // Second shadow layer: 0 2px 8px rgba(0, 0, 0, 0.04)
        ctx.shadowColor = 'rgba(0, 0, 0, 0.04)'
        ctx.shadowBlur = 8 * captureScale // 8px scaled
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 2 * captureScale // 2px scaled
        drawRoundedRect()
        ctx.fill()

        // Step 5: Reset shadow and clip to rounded rectangle
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0

        // Clip to rounded rectangle and draw content
        ctx.save()
        drawRoundedRect()
        ctx.clip()

        // Draw the captured content
        ctx.drawImage(contentCanvas, padding, padding)
        ctx.restore()
      }

      // Step 5: Copy to clipboard
      finalCanvas.toBlob(async (blob) => {
        if (blob) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ])
            setCopySuccess(true)
            setTimeout(() => setCopySuccess(false), 2000)
          } catch (clipboardError) {
            console.error('Clipboard write failed:', clipboardError)
            // Fallback: download the image
            const link = document.createElement('a')
            link.download = `${displayLabel || 'chart'}.png`
            link.href = finalCanvas.toDataURL('image/png')
            link.click()
          }
        }
        setIsCopying(false)
      }, 'image/png')
    } catch (error) {
      console.error('Copy to clipboard failed:', error)
      setIsCopying(false)
    }
  }

  // Badge drag handlers
  const handleBadgeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingBadge(true)

    const badge = badgeRef.current
    const container = chartContentRef.current
    if (badge && container) {
      const badgeRect = badge.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      // Calculate offset from mouse position to badge position
      setDragOffset({
        x: e.clientX - badgeRect.left,
        y: e.clientY - badgeRect.top
      })

      // If no position set yet, initialize from current position
      if (!badgePosition) {
        setBadgePosition({
          x: badgeRect.left - containerRect.left,
          y: badgeRect.top - containerRect.top
        })
      }
    }
  }

  useEffect(() => {
    if (!isDraggingBadge) return

    const handleMouseMove = (e: MouseEvent) => {
      const container = chartContentRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()

      // Calculate new position relative to container
      const newX = e.clientX - containerRect.left - dragOffset.x
      const newY = e.clientY - containerRect.top - dragOffset.y

      // Clamp to container bounds
      const badge = badgeRef.current
      if (badge) {
        const badgeWidth = badge.offsetWidth
        const badgeHeight = badge.offsetHeight
        const clampedX = Math.max(0, Math.min(newX, containerRect.width - badgeWidth))
        const clampedY = Math.max(0, Math.min(newY, containerRect.height - badgeHeight))

        setBadgePosition({ x: clampedX, y: clampedY })
      }
    }

    const handleMouseUp = () => {
      setIsDraggingBadge(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingBadge, dragOffset])

  // Chart width resize handlers
  const handleChartResizeStart = (handle: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingChart(true)
    setResizingHandle(handle)
    chartResizeStartX.current = e.clientX
    chartResizeStartWidth.current = chartWidthPercent
  }

  useEffect(() => {
    if (!isResizingChart || !resizingHandle) return

    let rafId: number | null = null
    let pendingWidth: number | null = null

    const handleMouseMove = (e: MouseEvent) => {
      const container = chartContainerRef.current
      if (!container) return

      const containerWidth = container.offsetWidth
      const deltaX = e.clientX - chartResizeStartX.current
      // Calculate new width percentage based on drag distance
      // Left handle: dragging left (negative deltaX) = expand, dragging right = shrink
      // Right handle: dragging right (positive deltaX) = expand, dragging left = shrink
      const deltaPercent = (deltaX / containerWidth) * 100
      const adjustedDelta = resizingHandle === 'left' ? -deltaPercent : deltaPercent
      pendingWidth = Math.max(40, Math.min(100, chartResizeStartWidth.current + adjustedDelta))

      // Throttle updates using requestAnimationFrame
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          if (pendingWidth !== null) {
            setChartWidthPercent(pendingWidth)
          }
          rafId = null
        })
      }
    }

    const handleMouseUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      // Apply final position
      if (pendingWidth !== null) {
        setChartWidthPercent(pendingWidth)
      }
      setIsResizingChart(false)
      setResizingHandle(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [isResizingChart, resizingHandle])

  // Chart height resize handlers
  const handleHeightResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingHeight(true)
    heightResizeStartY.current = e.clientY
    heightResizeStartOffset.current = chartHeightOffset
  }

  useEffect(() => {
    if (!isResizingHeight) return

    let rafId: number | null = null
    let pendingOffset: number | null = null

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - heightResizeStartY.current
      // Clamp height offset between -100 and 300
      pendingOffset = Math.max(-100, Math.min(300, heightResizeStartOffset.current + deltaY))

      // Throttle updates using requestAnimationFrame
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          if (pendingOffset !== null) {
            setChartHeightOffset(pendingOffset)
          }
          rafId = null
        })
      }
    }

    const handleMouseUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      // Apply final position
      if (pendingOffset !== null) {
        setChartHeightOffset(pendingOffset)
      }
      setIsResizingHeight(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [isResizingHeight])

  // Can use alternate chart types for single select with < 7 visible options (after filtering)
  const visibleOptionsCount = series.data.length
  const canUseAlternateCharts = question.type === 'single' && visibleOptionsCount < 7
  const canUsePie = canUseAlternateCharts && series.groups.length === 1
  const canUseStacked = canUseAlternateCharts && series.groups.length > 1

  // Cache column lookups - these are used multiple times and dataset.summary.columns doesn't change during render
  const { productColumn, sentimentColumn } = useMemo(() => {
    const columns = dataset.summary.columns
    const product = columns.find(col => {
      const lower = col.toLowerCase()
      return lower === 'product title' ||
             lower === 'product name' ||
             lower === 'style' ||
             (lower.includes('product') && (lower.includes('title') || lower.includes('name')))
    })
    const sentiment = columns.find(col =>
      col.toLowerCase().includes('(sentiment)') && col.toLowerCase().includes('would you consider buying')
    )
    return { productColumn: product, sentimentColumn: sentiment }
  }, [dataset.summary.columns])

  // Can use heatmap for product-level questions only (questions repeated for multiple products)
  const hasProductColumn = !!productColumn
  const isProductQuestion = hasProductColumn && question.level === 'row'
  const isOverallSegment = series.groups.length === 1 && series.groups[0]?.label === 'Overall'
  const isFilterMode = !comparisonMode
  const canUseHeatmap = isProductQuestion && (isOverallSegment || isFilterMode)
  const isSentimentQuestion = canUseHeatmap && sentimentColumn && (
    (question.singleSourceColumn && question.singleSourceColumn === sentimentColumn) ||
    question.label.toLowerCase().includes('would you consider buying') ||
    question.label.toLowerCase().includes('(sentiment)')
  )

  // Check if this is a product follow-up question with positive/negative
  const isProductFollowUpQuestion = canUseHeatmap &&
    (question.label.toLowerCase().includes('(positive)') ||
     question.label.toLowerCase().includes('(negative)'))

  // Determine sentiment type - show Advocates/Detractors whenever positive/negative appears in the label
  // This works independently of whether heatmap is available
  const hasPositiveNegative = question.label.toLowerCase().includes('(positive)') ||
    question.label.toLowerCase().includes('(negative)')
  const sentimentType: 'advocates' | 'detractors' | null = hasPositiveNegative
    ? (question.label.toLowerCase().includes('(positive)') ? 'advocates' : 'detractors')
    : null

  // Debug logging
  devLog('Chart Debug:', {
    qid: question.qid,
    questionType: question.type,
    groupsLength: series.groups.length,
    rawColumnsLength: question.columns.length,
    visibleOptionsCount,
    canUsePie,
    canUseStacked,
    canUseHeatmap,
    isProductQuestion,
    hasProductColumn,
    isOverallSegment,
    isFilterMode,
    isSentimentQuestion,
    isProductFollowUpQuestion
  })

  // Set initial chart variant priority:
  // 1. Multi-filter comparison mode: vertical bar chart (never heatmap)
  // 2. Sentiment questions in compare mode: vertical bar chart (alphabetical sort set elsewhere)
  // 3. Heatmap for sentiment questions and product follow-up questions in filter mode
  // 4. Pie chart when available (single select with one segment)
  // 5. Stacked chart when available (single select with multiple segments)
  // 6. Bar chart as fallback
  const isSentimentInCompareMode = isSentimentQuestion && comparisonMode
  const initialChartVariant: 'bar' | 'pie' | 'stacked' | 'heatmap' =
    multiFilterCompareMode ? 'bar' :
    isSentimentInCompareMode ? 'bar' :
    (isSentimentQuestion || isProductFollowUpQuestion) ? 'heatmap' :
    canUsePie ? 'pie' :
    canUseStacked ? 'stacked' : 'bar'
  const [chartVariant, setChartVariant] = useState<'bar' | 'pie' | 'stacked' | 'heatmap'>(initialChartVariant)
  const [heatmapTransposed, setHeatmapTransposed] = useState(false)
  const [_heatmapFilters, _setHeatmapFilters] = useState<{ products: string[], attributes: string[] }>({ products: [], attributes: [] })
  const [_showHeatmapProductFilter, _setShowHeatmapProductFilter] = useState(false)
  const [_showHeatmapAttributeFilter, _setShowHeatmapAttributeFilter] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const filterMenuRef = useRef<HTMLDivElement | null>(null)
  const _heatmapProductFilterRef = useRef<HTMLDivElement | null>(null)
  const _heatmapAttributeFilterRef = useRef<HTMLDivElement | null>(null)
  const previousQuestionIdRef = useRef<string | null>(null)

  // Check if any option contains a number (for numeric sorting like "1 pair", "2 pairs", etc.)
  const hasNumericOptions = series.data.some(d => /\d/.test(d.optionDisplay))

  useEffect(() => {
    // Only reset selections when the question itself changes, not when the data changes
    const questionChanged = previousQuestionIdRef.current !== question.qid

    if (questionChanged) {
      previousQuestionIdRef.current = question.qid
      // Default to alphabetical sort for: Likert, sentiment, product follow-up, or options with numbers
      setCardSort(question.isLikert || isSentimentQuestion || isProductFollowUpQuestion || hasNumericOptions ? 'alphabetical' : 'default')

      // For sentiment questions in compare mode, default to vertical orientation
      if (isSentimentQuestion && comparisonMode) {
        setChartOrientation('vertical')
      }

      // Filter out excluded values from defaults
      const allOptions = series.data.map(d => d.option).filter(option => {
        const displayValue = series.data.find(d => d.option === option)?.optionDisplay || option
        return !isExcludedValue(displayValue)
      })

      // For ranking questions, show all options by default
      // For other questions, select only the top 8 options by default (marked with __isTop8)
      // Users can manually select other options from the filter dropdown
      let selectedDefaults: string[]
      if (question.type === 'ranking') {
        selectedDefaults = allOptions
      } else {
        // Use __isTop8 flag to determine default selection
        const top8Options = series.data
          .filter((d: any) => d.__isTop8 && !isExcludedValue(d.optionDisplay || d.option))
          .map(d => d.option)
        selectedDefaults = top8Options.length > 0 ? top8Options : allOptions.slice(0, 8)
      }
      setSelectedOptions(selectedDefaults)

      // Reset custom order when question changes
      setCustomOptionOrder([])
    }
  }, [series, question.qid, question.isLikert, question.type, isSentimentQuestion, isProductFollowUpQuestion, comparisonMode, hasNumericOptions])

  useEffect(() => {
    setChartOrientation(orientation)
  }, [orientation])

  // Track the last question ID to detect question changes for setting defaults
  const chartDefaultsSetForQidRef = useRef<string | null>(null)

  useEffect(() => {
    // Set defaults when question changes
    const questionChanged = chartDefaultsSetForQidRef.current !== question.qid

    if (questionChanged) {
      chartDefaultsSetForQidRef.current = question.qid

      // Set default chart variant
      // Priority: heatmap for sentiment/product follow-up > pie when available > stacked when available > bar
      if (isSentimentQuestion || isProductFollowUpQuestion) {
        setChartVariant('heatmap')
      } else if (canUsePie) {
        setChartVariant('pie')
      } else if (canUseStacked) {
        setChartVariant('stacked')
        setChartOrientation('horizontal') // Stacked charts default to horizontal
      } else {
        setChartVariant('bar')
      }
    }
  }, [question.qid, isSentimentQuestion, isProductFollowUpQuestion, canUsePie, canUseStacked])

  useEffect(() => {
    // Fallback to bar if current variant is no longer available
    if (!canUsePie && chartVariant === 'pie') {
      setChartVariant('bar')
    }
    if (!canUseStacked && chartVariant === 'stacked') {
      setChartVariant('bar')
    }
    if (!canUseHeatmap && chartVariant === 'heatmap') {
      setChartVariant('bar')
    }
    // Note: We do NOT auto-upgrade from bar to pie/stacked here
    // because users should be able to manually select bar chart
  }, [canUsePie, canUseStacked, canUseHeatmap, chartVariant])

  // Track previous comparison mode to detect mode changes
  const prevComparisonModeRef = useRef<boolean | undefined>(comparisonMode)

  useEffect(() => {
    // When switching from Compare mode to Filter mode, reset chart variants
    const wasCompareMode = prevComparisonModeRef.current
    const isNowFilterMode = !comparisonMode

    if (wasCompareMode && isNowFilterMode) {
      // Priority: heatmap when available > stacked > pie
      if (canUseHeatmap) {
        // Heatmap available: always use heatmap as default in Filter mode
        setChartVariant('heatmap')
      } else if (canUseStacked) {
        // Stacked available: use horizontal stacked
        setChartVariant('stacked')
        setChartOrientation('horizontal')
      } else if (canUsePie) {
        // Pie available: use pie
        setChartVariant('pie')
      }
      // Otherwise keep current variant
    }

    prevComparisonModeRef.current = comparisonMode
  }, [comparisonMode, canUseHeatmap, canUsePie, canUseStacked])

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
    }
    if (showSortMenu || showFilter) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showSortMenu, showFilter])

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

  const shouldFilterByStatSig = filterSignificantOnly

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
    <div className="rounded-2xl bg-white p-5 shadow-md transition-shadow hover:shadow-lg space-y-4" style={{ paddingRight: '30px' }}>
      <div className="flex items-center gap-2 pb-2" style={{ width: '95%', margin: '0 auto', marginBottom: '20px' }}>
        <div className="flex items-center gap-2">
          {/* 1. Filter Icon Button */}
          <div className="relative" ref={filterMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowFilter(!showFilter)
                setShowSortMenu(false)
              }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{
                height: '32px',
                width: '32px',
                backgroundColor: selectedOptions.length < series.data.length ? 'rgba(58, 133, 24, 0.12)' : 'rgba(255, 255, 255, 0.7)',
                border: selectedOptions.length < series.data.length ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(8px)'
              }}
              title="Filter Options"
            >
              <FontAwesomeIcon icon={faFilter} style={{ fontSize: '13px', color: selectedOptions.length < series.data.length ? '#3A8518' : '#64748b' }} />
            </button>
            {showFilter && (
              <div
                className="absolute left-0 top-10 z-50 w-[22rem] animate-in fade-in slide-in-from-top-2 duration-200"
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  boxShadow: '0 4px 24px -4px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05)',
                  overflow: 'hidden'
                }}
              >
                {/* Header */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Filter Attributes</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          selectAllOptions()
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: 500,
                          color: '#3A8518',
                          backgroundColor: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#dcfce7' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f0fdf4' }}
                      >
                        Select All
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deselectAllOptions()
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: 500,
                          color: '#6b7280',
                          backgroundColor: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f9fafb' }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
                {/* Options list */}
                <div className="max-h-64 overflow-y-auto" style={{ padding: '8px' }}>
                  {sortedOptionsForFilter.map((option, index) => (
                    <label
                      key={option.option}
                      draggable
                      onDragStart={() => handleOptionDragStart(index)}
                      onDragOver={(e) => handleOptionDragOver(e, index)}
                      onDragEnd={handleOptionDragEnd}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="group"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        cursor: 'grab',
                        transition: 'all 0.15s ease',
                        backgroundColor: draggedOptionIndex === index ? '#f3f4f6' : 'transparent',
                        opacity: draggedOptionIndex === index ? 0.5 : 1
                      }}
                      onMouseEnter={(e) => { if (draggedOptionIndex !== index) e.currentTarget.style.backgroundColor = '#f9fafb' }}
                      onMouseLeave={(e) => { if (draggedOptionIndex !== index) e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#9ca3af"
                        strokeWidth="2"
                        style={{ flexShrink: 0, opacity: 0.6 }}
                      >
                        <circle cx="9" cy="6" r="1.5" fill="#9ca3af" />
                        <circle cx="15" cy="6" r="1.5" fill="#9ca3af" />
                        <circle cx="9" cy="12" r="1.5" fill="#9ca3af" />
                        <circle cx="15" cy="12" r="1.5" fill="#9ca3af" />
                        <circle cx="9" cy="18" r="1.5" fill="#9ca3af" />
                        <circle cx="15" cy="18" r="1.5" fill="#9ca3af" />
                      </svg>
                      <input
                        type="checkbox"
                        checked={selectedOptions.includes(option.option)}
                        onChange={(_e) => toggleOption(option.option)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '4px',
                          border: '2px solid #d1d5db',
                          cursor: 'pointer',
                          accentColor: '#3A8518'
                        }}
                      />
                      <span style={{ fontSize: '13px', color: '#374151', flex: 1 }}>{option.optionDisplay}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* 2. Heatmap product filter portal */}
          {chartVariant === 'heatmap' && (
            <div id={`heatmap-filters-${question.qid}`}></div>
          )}
          {/* 3. Sort Icon Dropdown */}
          {chartVariant !== 'heatmap' && question.type !== 'ranking' && (
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowSortMenu(!showSortMenu)
                setShowFilter(false)
                }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{
                height: '32px',
                width: '32px',
                backgroundColor: cardSort !== 'default' ? 'rgba(58, 133, 24, 0.12)' : 'rgba(255, 255, 255, 0.7)',
                border: cardSort !== 'default' ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(8px)'
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
                style={{ fontSize: '13px', color: cardSort !== 'default' ? '#3A8518' : '#64748b' }}
              />
            </button>
            {showSortMenu && (
              <div
                className="absolute left-0 top-10 z-10 animate-in fade-in slide-in-from-top-2 duration-200"
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  boxShadow: '0 4px 24px -4px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05)',
                  overflow: 'hidden',
                  minWidth: '160px'
                }}
              >
                {/* Header */}
                <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Sort By</span>
                </div>
                {/* Options */}
                <div style={{ padding: '6px' }}>
                  {SORT_OPTIONS.map((option) => {
                    const isSelected = cardSort === option
                    const icons: Record<string, typeof faSort> = {
                      default: faSort,
                      descending: faArrowDownWideShort,
                      ascending: faArrowUpShortWide,
                      alphabetical: faArrowUpAZ
                    }
                    return (
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
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          backgroundColor: isSelected ? '#f0fdf4' : 'transparent'
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#f9fafb' }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = isSelected ? '#f0fdf4' : 'transparent' }}
                      >
                        <FontAwesomeIcon
                          icon={icons[option] || faSort}
                          style={{
                            fontSize: '14px',
                            color: isSelected ? '#3A8518' : '#9ca3af',
                            width: '16px'
                          }}
                        />
                        <span style={{
                          fontSize: '13px',
                          fontWeight: isSelected ? 500 : 400,
                          color: isSelected ? '#3A8518' : '#374151',
                          textTransform: 'capitalize',
                          flex: 1
                        }}>
                          {option}
                        </span>
                        {isSelected && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A8518" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          )}
          {/* 4. Chart Orientation Toggle - for bar charts, stacked charts, and heatmaps */}
          {((chartVariant === 'bar' || chartVariant === 'stacked') && question.type !== 'ranking') || chartVariant === 'heatmap' ? (
            <button
              onClick={() => {
                if (chartVariant === 'heatmap') {
                  setHeatmapTransposed(prev => !prev)
                } else {
                  setChartOrientation(prev => prev === 'horizontal' ? 'vertical' : 'horizontal')
                }
              }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{
                height: '32px',
                width: '32px',
                backgroundColor: (chartVariant === 'heatmap' && heatmapTransposed) ? 'rgba(58, 133, 24, 0.12)' : 'rgba(255, 255, 255, 0.7)',
                border: (chartVariant === 'heatmap' && heatmapTransposed) ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(8px)'
              }}
              title={chartVariant === 'heatmap' ? 'Swap rows and columns' : `Switch to ${chartOrientation === 'horizontal' ? 'vertical' : 'horizontal'} orientation`}
              aria-label={chartVariant === 'heatmap' ? 'Swap rows and columns' : 'Toggle chart orientation'}
              type="button"
            >
              <FontAwesomeIcon
                icon={faBars}
                style={{
                  fontSize: '14px',
                  color: (chartVariant === 'heatmap' && heatmapTransposed) ? '#3A8518' : '#64748b',
                  transform: chartVariant === 'heatmap'
                    ? (heatmapTransposed ? 'rotate(90deg)' : 'rotate(0deg)')
                    : (chartOrientation === 'horizontal' ? 'rotate(0deg)' : 'rotate(90deg)'),
                  transition: 'transform 0.2s ease'
                }}
              />
            </button>
          ) : null}
          {/* Pie Legend Orientation Toggle - for pie charts */}
          {chartVariant !== 'heatmap' && chartVariant === 'pie' && canUsePie && (
            <button
              onClick={() => {
                setPieLegendOrientation(prev => prev === 'horizontal' ? 'vertical' : 'horizontal')
              }}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{ height: '32px', width: '32px', backgroundColor: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(0, 0, 0, 0.08)', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(8px)' }}
              title={`Switch to ${pieLegendOrientation === 'horizontal' ? 'vertical' : 'horizontal'} legend`}
              aria-label="Toggle legend orientation"
              type="button"
            >
              <FontAwesomeIcon
                icon={faBars}
                style={{
                  fontSize: '14px',
                  color: '#64748b',
                  transform: pieLegendOrientation === 'horizontal' ? 'rotate(0deg)' : 'rotate(90deg)',
                  transition: 'transform 0.2s ease'
                }}
              />
            </button>
          )}
          {/* 5. Swap Axes Button */}
          {chartVariant !== 'heatmap' && (chartVariant === 'bar' || chartVariant === 'stacked') && series.groups.length > 1 && question.type !== 'ranking' && (
            <button
              onClick={() => setAxesSwapped(prev => !prev)}
              className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
              style={{
                height: '32px',
                width: '32px',
                backgroundColor: axesSwapped ? 'rgba(58, 133, 24, 0.12)' : 'rgba(255, 255, 255, 0.7)',
                border: axesSwapped ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(8px)'
              }}
              title="Swap X/Y axes"
              aria-label="Swap X and Y axes"
              type="button"
            >
              <FontAwesomeIcon icon={faRotate} style={{ fontSize: '13px', color: axesSwapped ? '#3A8518' : '#64748b' }} />
            </button>
          )}
          {/* 6. Chart type selection */}
          {(canUsePie || canUseStacked || canUseHeatmap) && question.type !== 'ranking' && (
            <>
              {/* Divider before chart type controls */}
              <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(0, 0, 0, 0.1)', margin: '0 6px' }} />
              <div className="flex items-center gap-1" style={{ backgroundColor: 'rgba(255, 255, 255, 0.5)', border: '1px solid rgba(0, 0, 0, 0.06)', borderRadius: '10px', padding: '3px', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(8px)' }}>
                <button
                  className="flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer"
                  style={{
                    height: '28px',
                    width: '28px',
                    backgroundColor: chartVariant === 'bar' ? 'rgba(58, 133, 24, 0.12)' : 'transparent',
                    border: chartVariant === 'bar' ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid transparent',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                  onClick={() => setChartVariant('bar')}
                  title="Bar chart"
                >
                  <FontAwesomeIcon icon={faChartSimple} style={{ fontSize: '13px', color: chartVariant === 'bar' ? '#3A8518' : '#64748b' }} />
                </button>
                {canUsePie && (
                  <button
                    className="flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer"
                    style={{
                      height: '28px',
                      width: '28px',
                      backgroundColor: chartVariant === 'pie' ? 'rgba(58, 133, 24, 0.12)' : 'transparent',
                      border: chartVariant === 'pie' ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid transparent',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    onClick={() => setChartVariant('pie')}
                    title="Pie chart"
                  >
                    <FontAwesomeIcon icon={faChartPie} style={{ fontSize: '13px', color: chartVariant === 'pie' ? '#3A8518' : '#64748b' }} />
                  </button>
                )}
                {canUseStacked && (
                  <button
                    className="flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer"
                    style={{
                      height: '28px',
                      width: '28px',
                      backgroundColor: chartVariant === 'stacked' ? 'rgba(58, 133, 24, 0.12)' : 'transparent',
                      border: chartVariant === 'stacked' ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid transparent',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      setChartVariant('stacked')
                      setChartOrientation('horizontal') // Stacked charts always default to horizontal
                    }}
                    title="Stacked chart"
                  >
                    <FontAwesomeIcon icon={faChartBar} style={{ fontSize: '13px', color: chartVariant === 'stacked' ? '#3A8518' : '#64748b' }} />
                  </button>
                )}
                {canUseHeatmap && (isSentimentQuestion || isProductFollowUpQuestion) && (
                  <button
                    className="flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer"
                    style={{
                      height: '28px',
                      width: '28px',
                      backgroundColor: chartVariant === 'heatmap' ? 'rgba(58, 133, 24, 0.12)' : 'transparent',
                      border: chartVariant === 'heatmap' ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid transparent',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    onClick={() => setChartVariant('heatmap')}
                    title="Heatmap"
                  >
                    <FontAwesomeIcon icon={faTableCellsLarge} style={{ fontSize: '13px', color: chartVariant === 'heatmap' ? '#3A8518' : '#64748b' }} />
                  </button>
                )}
              </div>
            </>
          )}
          {/* Divider before copy button */}
          <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(0, 0, 0, 0.1)', margin: '0 6px' }} />
          {/* Copy to Clipboard Button */}
          <button
            onClick={handleCopyToClipboard}
            disabled={isCopying}
            className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95 cursor-pointer"
            style={{
              height: '32px',
              width: '32px',
              backgroundColor: copySuccess ? 'rgba(58, 133, 24, 0.12)' : 'rgba(255, 255, 255, 0.7)',
              border: copySuccess ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid rgba(0, 0, 0, 0.08)',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
              backdropFilter: 'blur(8px)',
              opacity: isCopying ? 0.7 : 1,
              cursor: isCopying ? 'wait' : 'pointer'
            }}
            title={copySuccess ? 'Copied!' : 'Copy chart to clipboard'}
          >
            <FontAwesomeIcon
              icon={copySuccess ? faCheck : faCopy}
              style={{
                fontSize: '13px',
                color: copySuccess ? '#3A8518' : '#64748b',
                transition: 'color 0.2s ease'
              }}
            />
          </button>
        </div>
      </div>

      {/* Create question type badge element to pass to chart components */}
      {(() => {
        const questionTypeBadge = hideQuestionType ? null : (
          <div
            ref={badgeRef}
            onMouseDown={handleBadgeMouseDown}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5.25px 10.5px',
              backgroundColor: isDraggingBadge ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: isDraggingBadge ? '1px solid rgba(58, 133, 24, 0.3)' : '1px solid rgba(0, 0, 0, 0.06)',
              borderRadius: '17px',
              boxShadow: isDraggingBadge
                ? '0 4px 16px rgba(58, 133, 24, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.9)'
                : '0 2px 8px rgba(58, 133, 24, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
              fontSize: '10.5px',
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
              whiteSpace: 'nowrap' as const,
              cursor: isDraggingBadge ? 'grabbing' : 'grab',
              userSelect: 'none' as const,
              transition: isDraggingBadge ? 'none' : 'box-shadow 0.2s ease, border-color 0.2s ease'
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                // All green dots with different intensities for different question types
                backgroundColor: question.isLikert ? '#2D6912' : // Darkest green for Likert
                  question.type === 'single' ? '#3A8518' : // Standard green for Single
                  question.type === 'multi' ? '#6AAD47' : // Lighter green for Multi
                  question.type === 'ranking' ? '#8BC474' : '#64748b' // Lightest green for Ranking
              }}
            />
            {getQuestionTypeLabel(question)}
          </div>
        )

        return (
      <div ref={chartContainerRef} style={{
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        width: '100%',
        paddingTop: '0px',
        paddingBottom: '30px',
        position: 'relative',
        minHeight: `${300 + chartHeightOffset}px`,
        transition: isResizingHeight ? 'none' : 'min-height 0.1s ease-out'
      }}>
      {/* Right resize handle */}
      <div
        onMouseDown={handleChartResizeStart('right')}
        style={{
          position: 'absolute',
          left: `calc(${chartWidthPercent}% + 20px)`,
          top: '50%',
          transform: 'translateY(-50%)',
          height: '80px',
          width: '20px',
          cursor: 'ew-resize',
          backgroundColor: isResizingChart && resizingHandle === 'right' ? 'rgba(58, 133, 24, 0.3)' : 'transparent',
          transition: 'background-color 0.15s ease',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px'
        }}
        onMouseEnter={(e) => {
          if (!isResizingChart) {
            e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.2)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizingChart || resizingHandle !== 'right') {
            e.currentTarget.style.backgroundColor = 'transparent'
          }
        }}
      >
        <div style={{
          width: '3px',
          height: '40px',
          backgroundColor: isResizingChart && resizingHandle === 'right' ? '#3A8518' : '#CED6DE',
          borderRadius: '2px',
          transition: 'background-color 0.15s ease'
        }} />
      </div>
      <div ref={chartContentRef} style={{
        width: `${chartWidthPercent}%`,
        transition: isResizingChart ? 'none' : 'width 0.1s ease-out'
      }}>
        {/* Export wrapper with rounded corners and shadow for clipboard copy */}
        <div
          ref={exportContentRef}
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
            padding: '12px 5px 20px 0px',
            margin: '8px auto',
            width: 'fit-content',
            minWidth: chartVariant === 'pie' ? '60%' : '90%' // Pie charts are 30% narrower
          }}
        >
      {(() => {
        devLog('Render Debug:', {
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
          devLog('Rendering ranking display for question:', question.qid)
          return (
            <RankingDisplay
              data={processedData}
              group={series.groups[0]}
              questionLabel={displayLabel}
              onSaveQuestionLabel={onSaveQuestionLabel}
              questionTypeBadge={questionTypeBadge}
              hideSegment={hideSegment}
            />
          )
        }

        if (chartVariant === 'pie' && canUsePie) {
          devLog('Rendering pie chart with group:', series.groups[0])
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
              questionTypeBadge={questionTypeBadge}
              heightOffset={chartHeightOffset}
              hideSegment={hideSegment}
              sentimentType={sentimentType}
            />
          )
        }

        if (chartVariant === 'stacked' && canUseStacked) {
          devLog('Rendering stacked chart with orientation:', chartOrientation, 'axesSwapped:', axesSwapped)

          // Use transposed data if axes are swapped
          const dataToUse = axesSwapped ? transposedData : processedData
          const groupsToUse = axesSwapped ? transposedGroups : series.groups

          // Transform data: swap rows and columns
          // Current: rows = answer options, columns = segments
          // Needed: rows = segments, columns = answer options
          const stackedData = groupsToUse.map(group => {
            const row: any = {
              optionDisplay: group.label,
              option: group.key,
              significance: [],
              groupSummaries: []
            }

            // Each answer option becomes a column in the stacked bar
            dataToUse.forEach(dataPoint => {
              const value = dataPoint[group.key]
              row[dataPoint.option] = typeof value === 'number' ? value : 0
            })

            return row
          })

          // Create new groups metadata for answer options
          const stackedGroups = dataToUse.map(dataPoint => ({
            label: dataPoint.optionDisplay,
            key: dataPoint.option
          }))

          devLog('Stacked data:', stackedData)
          devLog('Stacked groups:', stackedGroups)

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
              questionTypeBadge={questionTypeBadge}
              heightOffset={chartHeightOffset}
            />
          )
        }

        if (chartVariant === 'heatmap' && canUseHeatmap) {
          devLog('Rendering heatmap')

          // productColumn and sentimentColumn are already cached via useMemo above
          if (!productColumn) {
            devLog('❌ No product column found for heatmap')
            return (
              <div className="py-10 text-center text-xs text-brand-gray/60">
                Product column not found. Expected "Product Title" or similar column.
              </div>
            )
          }

          // Get all unique products from the dataset using the product column (normalized to match sidebar)
          const allProducts = Array.from(
            new Set(dataset.rows.map(row => normalizeProductValue(row[productColumn])).filter(v => v && v !== 'Unspecified'))
          ).sort()

          if (allProducts.length === 0) {
            devLog('❌ No products found in product column')
            return (
              <div className="py-10 text-center text-xs text-brand-gray/60">
                No products found in {productColumn}.
              </div>
            )
          }

          devLog('📊 Heatmap Debug:', {
            productColumn,
            allProductsCount: allProducts.length,
            allProducts: allProducts.slice(0, 5),
            questionQid: question.qid,
            isSentimentQuestion
          })

          // If this is the sentiment question, render the SentimentHeatmap
          if (isSentimentQuestion) {
            devLog('📊 Rendering SentimentHeatmap for sentiment question')
            return (
              <div style={{ marginBottom: '20px' }}>
                <SentimentHeatmap
                  dataset={dataset}
                  productColumn={productColumn}
                  questionLabel={displayLabel}
                  questionId={question.qid}
                  hideAsterisks={hideAsterisks}
                  onSaveQuestionLabel={onSaveQuestionLabel}
                  productOrder={productOrder}
                  transposed={heatmapTransposed}
                  questionTypeBadge={questionTypeBadge}
                  heightOffset={chartHeightOffset}
                  hideSegment={hideSegment}
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

          devLog('📊 Heatmap Series Built:', {
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
              productOrder={productOrder}
              transposed={heatmapTransposed}
              questionTypeBadge={questionTypeBadge}
              heightOffset={chartHeightOffset}
              hideSegment={hideSegment}
              sentimentType={sentimentType}
            />
          )
        }

        // For product follow-up questions, we need to recalculate the data
        // by averaging per-product percentages instead of using the aggregated "Overall"
        if (isProductFollowUpQuestion && productColumn) {
          devLog('📊 Product follow-up bar chart: recalculating with averaged per-product data')

          // Get all unique products from the dataset
          const allProducts = Array.from(
            new Set(dataset.rows.map(row => normalizeProductValue(row[productColumn])).filter(v => v && v !== 'Unspecified'))
          ).sort()

          if (allProducts.length > 0) {
            // Build series with products as segments
            const productSeries = buildSeries({
              dataset,
              question,
              segmentColumn: productColumn,
              groups: allProducts,
              sortOrder
            })

            // Average the percentages across all products for each option
            const averagedData = productSeries.data.map(dataPoint => {
              // Get all product values and calculate the average
              const productValues = productSeries.groups.map(g => Number(dataPoint[g.key] || 0))
              const avgValue = productValues.length > 0
                ? productValues.reduce((sum, val) => sum + val, 0) / productValues.length
                : 0

              // Create new data point with averaged "Overall" value
              const newDataPoint: any = {
                ...dataPoint,
                overall: avgValue, // Store the averaged percentage
                optionDisplay: optionLabels[dataPoint.option] || dataPoint.optionDisplay,
                groupSummaries: [{
                  label: 'Overall',
                  count: 0, // Not meaningful for averages
                  denominator: 0,
                  percent: avgValue
                }]
              }

              return newDataPoint
            }).filter(d => !isExcludedValue(d.optionDisplay))

            const averagedGroups = [{ key: 'overall', label: 'Overall' }]

            return (
              <ComparisonChart
                data={averagedData}
                groups={averagedGroups}
                orientation={chartOrientation}
                questionLabel={displayLabel}
                colors={chartColors}
                optionLabels={optionLabels}
                onSaveOptionLabel={onSaveOptionLabel}
                onSaveQuestionLabel={onSaveQuestionLabel}
                questionTypeBadge={questionTypeBadge}
                heightOffset={chartHeightOffset}
                hideSegment={hideSegment}
                sentimentType={sentimentType}
              />
            )
          }
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
            questionTypeBadge={questionTypeBadge}
            heightOffset={chartHeightOffset}
            hideSegment={hideSegment}
            sentimentType={sentimentType}
          />
        )
      })()}
        </div>{/* Close export wrapper */}
      </div>{/* Close chartContentRef */}
      {/* Height resize handle below the chart */}
      <div
        onMouseDown={handleHeightResizeStart}
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: 0,
          width: '80px',
          height: '20px',
          cursor: 'ns-resize',
          backgroundColor: isResizingHeight ? 'rgba(58, 133, 24, 0.3)' : 'transparent',
          transition: 'background-color 0.15s ease',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px'
        }}
        onMouseEnter={(e) => {
          if (!isResizingHeight) {
            e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.2)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizingHeight) {
            e.currentTarget.style.backgroundColor = 'transparent'
          }
        }}
      >
        <div style={{
          width: '40px',
          height: '3px',
          backgroundColor: isResizingHeight ? '#3A8518' : '#CED6DE',
          borderRadius: '2px',
          transition: 'background-color 0.15s ease'
        }} />
      </div>
      </div>
        )
      })()}
    </div>
  )
})

interface ChartGalleryProps {
  questions: QuestionDef[]
  dataset: ParsedCSV
  segmentColumn?: string
  groups?: string[]
  segments?: SegmentDef[]
  comparisonMode?: boolean
  multiFilterCompareMode?: boolean
  comparisonSets?: ComparisonSet[]
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
  productOrder?: string[]
  hideSegment?: boolean
  hideQuestionType?: boolean
}

export const ChartGallery: React.FC<ChartGalleryProps> = ({
  questions,
  dataset,
  segmentColumn,
  groups,
  segments,
  comparisonMode = true,
  multiFilterCompareMode = false,
  comparisonSets = [],
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
  onSaveQuestionLabel,
  productOrder = [],
  hideSegment = false,
  hideQuestionType = false
}) => {
  const renderableEntries = useMemo(() => {
    // Check if we have valid comparison sets for multi-filter mode
    const validComparisonSets = comparisonSets.filter(s => s.filters.length > 0)
    const useMultiFilterMode = multiFilterCompareMode && validComparisonSets.length >= 2

    // If using multi-filter comparison mode
    if (useMultiFilterMode) {
      return questions
        .map(question => {
          const series = buildSeriesFromComparisonSets({
            dataset,
            question,
            comparisonSets: validComparisonSets,
            sortOrder
          })

          // Apply custom labels to series data options
          const questionOptionLabels = optionLabels[question.qid] || {}
          series.data = series.data.map(dataPoint => ({
            ...dataPoint,
            optionDisplay: questionOptionLabels[dataPoint.option] || dataPoint.optionDisplay
          }))

          return { question, series }
        })
        .filter(entry => entry.series.data.length > 0)
    }

    // Standard mode (segments-based)
    const hasSegments = segments && segments.length > 0
    const hasOldStyle = segmentColumn && groups && groups.length > 0

    if (!hasSegments && !hasOldStyle) return []

    // When segments are selected in filter mode (not comparison), the dataset is already filtered
    // So we pass "Overall" segment to buildSeries to show the filtered data as a single bar
    // We then customize the label to show the combined filter text
    // In comparison mode, pass all segments to show them side-by-side
    const actualSegments = segments?.filter(seg => seg.value !== 'Overall') || []
    const useFilterMode = !comparisonMode && actualSegments.length >= 1

    return questions
      .map(question => {
        const series = buildSeries({
          dataset,
          question,
          ...(hasSegments
            ? (useFilterMode ? { segments: [{ column: 'Overall', value: 'Overall' }] } : { segments })
            : { segmentColumn, groups }
          ),
          sortOrder
        })

        // Apply custom labels to series groups
        series.groups = series.groups.map(group => ({
          ...group,
          label: groupLabels[group.key] || group.label
        }))

        // In filter mode with multiple segments, create a combined label showing all filters
        if (useFilterMode && series.groups.length > 0) {
          const filterLabels = actualSegments.map(seg => {
            const customLabel = groupLabels[seg.value]
            return customLabel || seg.value
          })
          series.groups = series.groups.map(group => ({
            ...group,
            label: filterLabels.join(', ')
          }))
        }

        // Apply custom labels to series data options
        const questionOptionLabels = optionLabels[question.qid] || {}
        series.data = series.data.map(dataPoint => ({
          ...dataPoint,
          optionDisplay: questionOptionLabels[dataPoint.option] || dataPoint.optionDisplay
        }))

        return { question, series }
      })
      .filter(entry => entry.series.data.length > 0)
  }, [dataset, questions, segmentColumn, groups, segments, sortOrder, groupLabels, optionLabels, comparisonMode, multiFilterCompareMode, comparisonSets])

  // Create a wrapper div with ref for each chart
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" style={{ paddingTop: '20px', paddingBottom: '30px' }}>
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
                comparisonMode={comparisonMode}
                multiFilterCompareMode={multiFilterCompareMode}
                chartColors={chartColors}
                optionLabels={optionLabels[question.qid] || {}}
                onSaveOptionLabel={(option, newLabel) => onSaveOptionLabel?.(question.qid, option, newLabel)}
                onSaveQuestionLabel={(newLabel) => onSaveQuestionLabel?.(question.qid, newLabel)}
                productOrder={productOrder}
                hideSegment={hideSegment}
                hideQuestionType={hideQuestionType}
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
