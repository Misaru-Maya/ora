import React, { useState, useMemo, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import type { SeriesDataPoint, GroupSeriesMeta } from '../dataCalculations'
import { stripQuotes, stripSentimentPrefix, getContrastTextColor, GREEN_PALETTE, YELLOW_PALETTE } from '../utils'

// Performance: Disable console logs in production
const isDev = process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}
const devWarn = isDev ? console.warn : () => {}

import type { ParsedCSV } from '../types'

interface HeatmapTableProps {
  data: SeriesDataPoint[]
  groups: GroupSeriesMeta[]
  questionLabel?: string
  sentiment: 'positive' | 'negative'
  questionId?: string
  dataset: ParsedCSV
  productColumn: string
  hideAsterisks?: boolean
  optionLabels?: Record<string, string>
  onSaveOptionLabel?: (option: string, newLabel: string) => void
  onSaveQuestionLabel?: (newLabel: string) => void
  productOrder?: string[]
  transposed?: boolean
  questionTypeBadge?: React.ReactNode
  heightOffset?: number
  hideSegment?: boolean
  sentimentType?: 'advocates' | 'detractors' | null  // For product follow-up questions
}

// Get color based on value and sentiment
const getColor = (value: number, sentiment: 'positive' | 'negative', minVal: number, maxVal: number) => {
  const palette = sentiment === 'positive' ? GREEN_PALETTE : YELLOW_PALETTE

  // Normalize value to 0-100 range based on min/max
  const range = maxVal - minVal
  const normalized = range > 0 ? ((value - minVal) / range) * 100 : 50

  // Map to palette buckets (larger values = darker colors, smaller values = lighter colors)
  // Order from large to small: s40, s30, s20, s10/t10, t20, t40, t60, t80
  let bgColor: string
  if (normalized >= 87.5) bgColor = palette.s40  // Largest values - darkest
  else if (normalized >= 75) bgColor = palette.s30
  else if (normalized >= 62.5) bgColor = palette.s20
  else if (normalized >= 50) bgColor = palette.s10
  else if (normalized >= 37.5) bgColor = palette.t10
  else if (normalized >= 25) bgColor = palette.t20
  else if (normalized >= 12.5) bgColor = palette.t40
  else if (normalized >= 0) bgColor = palette.t60
  else bgColor = palette.t80  // Smallest values - lightest

  // Calculate optimal text color based on background luminance
  const textColor = getContrastTextColor(bgColor)

  return { bg: bgColor, text: textColor }
}

export const HeatmapTable: React.FC<HeatmapTableProps> = memo(({ data, groups, questionLabel, sentiment, questionId, dataset, productColumn, hideAsterisks = false, optionLabels: _optionLabels = {}, onSaveOptionLabel, onSaveQuestionLabel, productOrder = [], transposed = false, questionTypeBadge, heightOffset = 0, hideSegment = false, sentimentType = null }) => {
  const [editingOption, setEditingOption] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')

  // State for resizable attribute column
  const [attributeColumnWidth, setAttributeColumnWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartX = React.useRef<number>(0)
  const resizeStartWidth = React.useRef<number>(0)

  // State for draggable title position (free movement within white space)
  const [titleOffset, setTitleOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDraggingTitle, setIsDraggingTitle] = useState(false)
  const titleDragStart = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const titleDragStartOffset = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // State for draggable heatmap position (moves entire chart)
  const [heatmapOffset, setHeatmapOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDraggingHeatmap, setIsDraggingHeatmap] = useState(false)
  const heatmapDragStart = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const heatmapDragStartOffset = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Strip "Advocates:" or "Detractors:" prefix from display label
  const displayQuestionLabel = questionLabel ? stripSentimentPrefix(questionLabel) : questionLabel

  devLog('🔥 HeatmapTable Received:', {
    dataLength: data.length,
    groupsLength: groups.length,
    groups: groups.map(g => ({ key: g.key, label: g.label })),
    sampleData: data[0],
    questionLabel,
    sentiment,
    datasetRows: dataset.rows.length,
    productColumn,
    productOrder: productOrder,
    productOrderLength: productOrder.length
  })

  // Pre-compute all sentiment scores in a single pass for better performance
  // Sentiment Score = (% Advocates - % Detractors + 100) / 2
  // Advocates = 4s and 5s, Detractors = 1s and 2s, Neutrals = 3s
  const sentimentScores = useMemo(() => {
    // Find sentiment column (column with "(sentiment)" in header)
    const sentimentColumn = dataset.summary.columns.find(col =>
      col.toLowerCase().includes('(sentiment)') && col.toLowerCase().includes('would you consider buying')
    )

    if (!sentimentColumn) {
      devWarn('⚠️ No sentiment column found')
      return null
    }

    devLog('📊 Found sentiment column:', sentimentColumn)

    // Pre-compute scores for all products in a single pass
    const scores = new Map<string, number>()

    // Group rows by product for efficient processing
    const productRowsMap = new Map<string, typeof dataset.rows>()
    for (const row of dataset.rows) {
      const productLabel = row[productColumn]
      if (!productLabel) continue
      if (!productRowsMap.has(productLabel)) {
        productRowsMap.set(productLabel, [])
      }
      productRowsMap.get(productLabel)!.push(row)
    }

    // Calculate score for each group
    for (const group of groups) {
      const productLabel = group.label
      const productRows = productRowsMap.get(productLabel) || []

      if (productRows.length === 0) {
        devWarn(`⚠️ No rows found for product: ${productLabel}`)
        scores.set(group.key, 0)
        continue
      }

      // Count advocates (4-5 stars), detractors (1-2 stars)
      let advocates = 0
      let detractors = 0
      let validResponses = 0

      for (const row of productRows) {
        const rating = row[sentimentColumn]
        const numericRating = typeof rating === 'number' ? rating : Number(rating)

        if (Number.isFinite(numericRating)) {
          validResponses++
          if (numericRating >= 4) {
            advocates++
          } else if (numericRating <= 2) {
            detractors++
          }
          // 3s are neutrals, not counted
        }
      }

      if (validResponses === 0) {
        devWarn(`⚠️ No valid ratings for product: ${productLabel}`)
        scores.set(group.key, 0)
        continue
      }

      const advocatePercent = (advocates / validResponses) * 100
      const detractorPercent = (detractors / validResponses) * 100
      const sentimentScore = (advocatePercent - detractorPercent + 100) / 2

      devLog(`📊 Product: ${productLabel}, Advocates: ${advocates}/${validResponses} (${advocatePercent.toFixed(1)}%), Detractors: ${detractors}/${validResponses} (${detractorPercent.toFixed(1)}%), Score: ${sentimentScore.toFixed(1)}`)

      scores.set(group.key, sentimentScore)
    }

    return scores
  }, [dataset, productColumn, groups])

  // Note: top50Products, bottom50Products, and defaultProductSelection are now derived
  // from allGroupsOrdered (defined later) to ensure they always match the displayed dropdown order.

  // State for filtering - initialized empty, will be set by useEffect once defaultProductSelection is available
  const [selectedProducts, setSelectedProducts] = useState<string[]>(() => groups.map(g => g.key))
  const [selectedAttributes] = useState<string[]>(data.map(d => d.option))
  const [showProductFilter, setShowProductFilter] = useState(false)
  const [, setShowAttributeFilter] = useState(false)

  // Track if this is the initial mount or if groups/sentiment changed (not just order)
  // Note: The useEffect that uses these refs is placed after defaultProductSelection is defined
  const prevGroupsRef = React.useRef<string[]>([])
  const prevSentimentRef = React.useRef<'positive' | 'negative'>(sentiment)

  // State for attribute reordering (product order comes from global productOrder prop)
  const [draggedAttributeIndex, setDraggedAttributeIndex] = useState<number | null>(null)

  // State to track portal target availability
  const [portalReady, setPortalReady] = useState(false)

  // Check for portal target availability
  useEffect(() => {
    if (questionId) {
      // Check immediately
      const checkPortal = () => {
        const target = document.getElementById(`heatmap-filters-${questionId}`)
        if (target) {
          setPortalReady(true)
          return true
        }
        return false
      }

      if (!checkPortal()) {
        // If not found, retry after a brief delay
        const timer = setTimeout(checkPortal, 10)
        return () => clearTimeout(timer)
      }
    }
  }, [questionId])

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Check if click is outside all dropdown menus
      const isOutsideDropdowns = !target.closest('.heatmap-dropdown-container')
      if (isOutsideDropdowns) {
        setShowProductFilter(false)
        setShowAttributeFilter(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStartX.current = e.clientX
    resizeStartWidth.current = attributeColumnWidth ?? firstColumnWidthDefault
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current
      const newWidth = Math.max(100, Math.min(400, resizeStartWidth.current + delta))
      setAttributeColumnWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  // Title drag handlers - allows free movement within white space
  const handleTitleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingTitle(true)
    titleDragStart.current = { x: e.clientX, y: e.clientY }
    titleDragStartOffset.current = { x: titleOffset.x, y: titleOffset.y }
  }

  useEffect(() => {
    if (!isDraggingTitle) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - titleDragStart.current.x
      const deltaY = e.clientY - titleDragStart.current.y
      // Allow horizontal movement: -300px to +300px
      // Allow vertical movement: -200px (up) to +50px (down)
      const newOffsetX = Math.max(-300, Math.min(300, titleDragStartOffset.current.x + deltaX))
      const newOffsetY = Math.max(-200, Math.min(50, titleDragStartOffset.current.y + deltaY))
      setTitleOffset({ x: newOffsetX, y: newOffsetY })
    }

    const handleMouseUp = () => {
      setIsDraggingTitle(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingTitle])

  // Heatmap drag handlers - allows moving entire chart
  const handleHeatmapDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingHeatmap(true)
    heatmapDragStart.current = { x: e.clientX, y: e.clientY }
    heatmapDragStartOffset.current = { x: heatmapOffset.x, y: heatmapOffset.y }
  }

  useEffect(() => {
    if (!isDraggingHeatmap) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - heatmapDragStart.current.x
      const deltaY = e.clientY - heatmapDragStart.current.y
      // Allow horizontal movement: -300px to +300px
      // Allow vertical movement: -200px (up) to +200px (down)
      const newOffsetX = Math.max(-300, Math.min(300, heatmapDragStartOffset.current.x + deltaX))
      const newOffsetY = Math.max(-200, Math.min(200, heatmapDragStartOffset.current.y + deltaY))
      setHeatmapOffset({ x: newOffsetX, y: newOffsetY })
    }

    const handleMouseUp = () => {
      setIsDraggingHeatmap(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingHeatmap])

  // Drag handlers for attribute filter (product ordering is now global via sidebar)
  const [customAttributeOrder, setCustomAttributeOrder] = useState<string[] | null>(null)

  const _handleAttributeDragStart = (index: number) => {
    setDraggedAttributeIndex(index)
  }

  const _handleAttributeDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedAttributeIndex === null || draggedAttributeIndex === index) return

    const currentOrder = customAttributeOrder || data.map(d => d.option)
    const newOrder = [...currentOrder]
    const [draggedItem] = newOrder.splice(draggedAttributeIndex, 1)
    newOrder.splice(index, 0, draggedItem)

    setCustomAttributeOrder(newOrder)
    setDraggedAttributeIndex(index)
  }

  const _handleAttributeDragEnd = () => {
    setDraggedAttributeIndex(null)
  }

  // Filter data and strip asterisks if needed
  const _filteredGroups = groups.filter(g => selectedProducts.includes(g.key))
  const baseFilteredData = data.filter(d => selectedAttributes.includes(d.option)).map(d => {
    if (hideAsterisks && d.optionDisplay.endsWith('*')) {
      return { ...d, optionDisplay: d.optionDisplay.slice(0, -1) }
    }
    return d
  })

  // Apply custom attribute order if exists
  const filteredData = useMemo(() => {
    if (customAttributeOrder) {
      const orderMap = new Map(baseFilteredData.map(d => [d.option, d]))
      const ordered = customAttributeOrder
        .filter(option => orderMap.has(option))
        .map(option => orderMap.get(option)!)
      const remaining = baseFilteredData.filter(d => !customAttributeOrder.includes(d.option))
      return [...ordered, ...remaining]
    }
    return baseFilteredData
  }, [baseFilteredData, customAttributeOrder])

  // Sort ALL groups (products) by their sentiment scores (descending - highest score first)
  // This is used for the filter dropdown to show all products in sorted order
  const allGroupsSorted = useMemo(() => {
    if (!sentimentScores) {
      return groups
    }

    return [...groups].sort((a, b) => {
      const scoreA = sentimentScores.get(a.key) ?? 0
      const scoreB = sentimentScores.get(b.key) ?? 0

      // Always sort by sentiment score descending (higher is better)
      return scoreB - scoreA
    })
  }, [groups, sentimentScores])

  // Sort groups (products) by their sentiment scores (descending - highest score first)
  // This filters to only selected products
  const defaultSortedGroups = useMemo(() => {
    return allGroupsSorted.filter(g => selectedProducts.includes(g.key))
  }, [allGroupsSorted, selectedProducts])

  // Apply global product order from sidebar if exists, otherwise use default sorted order
  // Note: productOrder contains product labels (e.g., "Black 1"), not normalized keys
  const sortedGroups = useMemo(() => {
    devLog('🔄 sortedGroups calculation:', {
      productOrderLength: productOrder.length,
      productOrder: productOrder.slice(0, 5),
      defaultSortedGroupsLabels: defaultSortedGroups.map(g => g.label).slice(0, 5)
    })

    if (productOrder.length > 0) {
      // Match productOrder labels against group labels (not keys)
      const validOrder = productOrder
        .map(label => defaultSortedGroups.find(g => g.label === label))
        .filter((g): g is GroupSeriesMeta => g !== undefined)

      devLog('🔄 validOrder result:', validOrder.map(g => g.label).slice(0, 5))

      // Add any new columns that aren't in productOrder
      const labelsInProductOrder = new Set(productOrder)
      const newColumns = defaultSortedGroups.filter(g => !labelsInProductOrder.has(g.label))

      return [...validOrder, ...newColumns]
    }
    return defaultSortedGroups
  }, [productOrder, defaultSortedGroups])

  // All groups ordered by global product order (for the filter dropdown)
  // This ensures the dropdown order matches the displayed column order
  // Note: productOrder contains product labels, so we match against g.label
  const allGroupsOrdered = useMemo(() => {
    if (productOrder.length > 0) {
      const validOrder = productOrder
        .map(label => allGroupsSorted.find(g => g.label === label))
        .filter((g): g is GroupSeriesMeta => g !== undefined)

      // Add any groups not in product order at the end
      const labelsInProductOrder = new Set(productOrder)
      const remainingGroups = allGroupsSorted.filter(g => !labelsInProductOrder.has(g.label))

      return [...validOrder, ...remainingGroups]
    }
    return allGroupsSorted
  }, [productOrder, allGroupsSorted])

  // Calculate top and bottom 50% based on the DISPLAYED order in allGroupsOrdered
  // This ensures Top 50% / Bottom 50% buttons always match the dropdown list order
  const { top50Products, bottom50Products } = useMemo(() => {
    const orderedKeys = allGroupsOrdered.map(g => g.key)
    const midpoint = Math.ceil(orderedKeys.length / 2)
    return {
      top50Products: orderedKeys.slice(0, midpoint),
      bottom50Products: orderedKeys.slice(midpoint)
    }
  }, [allGroupsOrdered])

  // Default product selection based on sentiment type
  const defaultProductSelection = useMemo(() => {
    // For positive questions (advocates): show top 50%
    // For negative questions (detractors): show bottom 50%
    if (sentiment === 'positive') {
      return top50Products.length > 0 ? top50Products : allGroupsOrdered.map(g => g.key)
    } else {
      return bottom50Products.length > 0 ? bottom50Products : allGroupsOrdered.map(g => g.key)
    }
  }, [sentiment, top50Products, bottom50Products, allGroupsOrdered])

  // Only reset selected products when groups or sentiment actually change, not when order changes
  useEffect(() => {
    const currentGroupKeys = groups.map(g => g.key).sort().join(',')
    const prevGroupKeys = prevGroupsRef.current.sort().join(',')

    // Reset only if groups changed (new data) or sentiment changed, not just order
    if (currentGroupKeys !== prevGroupKeys || sentiment !== prevSentimentRef.current) {
      setSelectedProducts(defaultProductSelection)
      prevGroupsRef.current = groups.map(g => g.key)
      prevSentimentRef.current = sentiment
    }
  }, [groups, sentiment, defaultProductSelection])

  // Calculate min/max for color scaling
  const { minValue, maxValue } = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    filteredData.forEach(row => {
      sortedGroups.forEach(group => {
        const val = typeof row[group.key] === 'number' ? (row[group.key] as number) : 0
        if (val < min) min = val
        if (val > max) max = val
      })
    })
    return { minValue: min, maxValue: max }
  }, [filteredData, sortedGroups])

  // Sort rows (attributes) by value
  // Priority: Sort by "Overall" column if it exists, otherwise by average across all visible columns
  const sortedData = useMemo(() => {
    // Check if "Overall" group exists
    const overallGroup = sortedGroups.find(g => g.label === 'Overall')

    return [...filteredData].sort((a, b) => {
      let valueA: number
      let valueB: number

      if (overallGroup) {
        // Sort by Overall column
        valueA = typeof a[overallGroup.key] === 'number' ? (a[overallGroup.key] as number) : 0
        valueB = typeof b[overallGroup.key] === 'number' ? (b[overallGroup.key] as number) : 0
      } else {
        // Sort by average across all visible columns
        valueA = sortedGroups.reduce((sum, g) => sum + (typeof a[g.key] === 'number' ? (a[g.key] as number) : 0), 0) / Math.max(sortedGroups.length, 1)
        valueB = sortedGroups.reduce((sum, g) => sum + (typeof b[g.key] === 'number' ? (b[g.key] as number) : 0), 0) / Math.max(sortedGroups.length, 1)
      }

      // Always descending: show highest values first
      return valueB - valueA
    })
  }, [filteredData, sortedGroups])

  // Transpose data when transposed prop is true
  // When transposed: products become rows, attributes become columns
  const { displayData, displayGroups } = useMemo(() => {
    if (!transposed) {
      return { displayData: sortedData, displayGroups: sortedGroups }
    }

    // Create transposed data: each product becomes a row
    const transposedData = sortedGroups.map(group => {
      const row: any = {
        option: group.key,
        optionDisplay: stripQuotes(group.label)
      }
      // Each attribute becomes a column with its value for this product
      sortedData.forEach(attrRow => {
        const value = typeof attrRow[group.key] === 'number' ? attrRow[group.key] : 0
        row[attrRow.option] = value
      })
      return row
    })

    // Create transposed groups: each attribute becomes a column header
    const transposedGroups = sortedData.map(attrRow => ({
      key: attrRow.option,
      label: attrRow.optionDisplay
    }))

    return { displayData: transposedData, displayGroups: transposedGroups }
  }, [transposed, sortedData, sortedGroups])

  devLog('🔥 HeatmapTable Rendering:', {
    sortedGroupsLength: sortedGroups.length,
    sortedDataLength: sortedData.length,
    sortedGroups: sortedGroups.map(g => g.key),
    sortedDataSample: sortedData[0],
    transposed,
    displayDataLength: displayData.length,
    displayGroupsLength: displayGroups.length
  })

  // Product filter button - will be rendered via portal in ChartGallery button area
  // This is defined before the early return so it can always be rendered
  const filterButtons = (
    <div className="relative heatmap-dropdown-container">
      <button
        onClick={() => setShowProductFilter(!showProductFilter)}
        className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
        style={{
          height: '32px',
          width: '32px',
          backgroundColor: selectedProducts.length < allGroupsOrdered.length ? 'rgba(58, 133, 24, 0.12)' : 'rgba(255, 255, 255, 0.7)',
          border: selectedProducts.length < allGroupsOrdered.length ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid rgba(0, 0, 0, 0.08)',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(8px)',
          cursor: 'pointer'
        }}
        title="Filter Products"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#64748b"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      </button>
        {showProductFilter && (
          <div
            className="absolute left-0 top-10 z-50 animate-in fade-in slide-in-from-top-2 duration-200"
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 4px 24px -4px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05)',
              overflow: 'hidden',
              width: '280px'
            }}
          >
            {/* Header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Filter Products</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(() => {
                    const allTop50Selected = top50Products.every(key => selectedProducts.includes(key))
                    return (
                      <button
                        onClick={() => {
                          if (allTop50Selected) {
                            setSelectedProducts(selectedProducts.filter(key => !top50Products.includes(key)))
                          } else {
                            const newSelection = [...new Set([...selectedProducts, ...top50Products])]
                            setSelectedProducts(newSelection)
                          }
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontWeight: 500,
                          color: allTop50Selected ? '#3A8518' : '#6b7280',
                          backgroundColor: allTop50Selected ? '#f0fdf4' : '#f9fafb',
                          border: allTop50Selected ? '1px solid #bbf7d0' : '1px solid #e5e7eb',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8' }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                      >
                        Top 50%
                      </button>
                    )
                  })()}
                  {(() => {
                    const allBottom50Selected = bottom50Products.every(key => selectedProducts.includes(key))
                    return (
                      <button
                        onClick={() => {
                          if (allBottom50Selected) {
                            setSelectedProducts(selectedProducts.filter(key => !bottom50Products.includes(key)))
                          } else {
                            const newSelection = [...new Set([...selectedProducts, ...bottom50Products])]
                            setSelectedProducts(newSelection)
                          }
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontWeight: 500,
                          color: allBottom50Selected ? '#92700C' : '#6b7280',
                          backgroundColor: allBottom50Selected ? '#FAF5D7' : '#f9fafb',
                          border: allBottom50Selected ? '1px solid #ECD560' : '1px solid #e5e7eb',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8' }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                      >
                        Btm 50%
                      </button>
                    )
                  })()}
                  <button
                    onClick={() => setSelectedProducts([])}
                    style={{
                      padding: '4px 8px',
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
            {/* Products list */}
            <div className="max-h-64 overflow-y-auto" style={{ padding: '8px' }}>
              {allGroupsOrdered.map((group, index) => {
                const isChecked = selectedProducts.includes(group.key)
                return (
                  <label
                    key={group.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      backgroundColor: 'transparent'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f9fafb' }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <span style={{ fontSize: '11px', color: '#9ca3af', minWidth: '16px', textAlign: 'right' }}>{index + 1}</span>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        if (isChecked) {
                          setSelectedProducts(selectedProducts.filter(p => p !== group.key))
                        } else {
                          setSelectedProducts([...selectedProducts, group.key])
                        }
                      }}
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '4px',
                        border: '2px solid #d1d5db',
                        cursor: 'pointer',
                        accentColor: '#3A8518'
                      }}
                    />
                    <span style={{ fontSize: '13px', color: '#374151' }}>{stripQuotes(group.label)}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
    </div>
  )

  // Get portal target element
  const filterPortalTarget = portalReady && questionId ? document.getElementById(`heatmap-filters-${questionId}`) : null

  // Early return if no data - but still render the filter button via portal (only if 10+ products)
  if (sortedData.length === 0 || sortedGroups.length === 0) {
    return (
      <>
        {filterPortalTarget && allGroupsOrdered.length >= 10 && createPortal(filterButtons, filterPortalTarget)}
        <div className="w-full py-10 text-center text-xs text-brand-gray/60">
          No products selected. Use the filter button to select products.
        </div>
      </>
    )
  }

  // Calculate optimal width for first column based on longest text
  const maxTextLength = Math.max(...displayData.map(row => row.optionDisplay.length))
  // Estimate width: roughly 8px per character, with min 150px and max 250px
  const firstColumnWidthDefault = Math.min(Math.max(maxTextLength * 8, 150), 250)
  // Use state width if set, otherwise use calculated default
  const firstColumnWidth = attributeColumnWidth ?? firstColumnWidthDefault

  // Calculate row padding based on heightOffset
  // Base padding is 8px, heightOffset adds/subtracts from vertical padding
  // heightOffset ranges from -100 to +300, we map it to padding change
  const baseRowPadding = 8
  const rowPaddingVertical = Math.max(4, baseRowPadding + Math.round(heightOffset / 20))
  const cellPadding = `${rowPaddingVertical}px 12px`

  return (
    <>
      {filterPortalTarget && allGroupsOrdered.length >= 10 && createPortal(filterButtons, filterPortalTarget)}
    <div className="w-full" style={{ paddingLeft: '2px', paddingBottom: '30px', width: '95%', margin: '0 auto' }}>
      {/* Header Row - Title is draggable separately */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: '15px',
          marginBottom: '15px',
          gap: '16px'
        }}
      >
        {/* Center: Draggable Title */}
        <div
          onMouseDown={handleTitleDragStart}
          style={{
            textAlign: 'center',
            cursor: isDraggingTitle ? 'grabbing' : 'grab',
            userSelect: 'none',
            transition: isDraggingTitle ? 'none' : 'transform 0.1s ease-out',
            transform: `translate(${titleOffset.x}px, ${titleOffset.y}px)`
          }}
        >
          {displayQuestionLabel && (
            editingQuestionLabel ? (
              <textarea
                autoFocus
                value={questionLabelInput}
                onChange={(e) => setQuestionLabelInput(e.target.value)}
                onBlur={() => {
                  if (questionLabelInput.trim() && onSaveQuestionLabel) {
                    onSaveQuestionLabel(questionLabelInput.trim())
                  }
                  setEditingQuestionLabel(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (questionLabelInput.trim() && onSaveQuestionLabel) {
                      onSaveQuestionLabel(questionLabelInput.trim())
                    }
                    setEditingQuestionLabel(false)
                  }
                  if (e.key === 'Escape') setEditingQuestionLabel(false)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-semibold text-brand-gray"
                style={{
                  width: '100%',
                  fontSize: '14px',
                  padding: '4px 8px',
                  border: '2px solid #3A8518',
                  borderRadius: '4px',
                  outline: 'none',
                  backgroundColor: 'white',
                  fontFamily: 'Space Grotesk, sans-serif',
                  fontWeight: 600,
                  lineHeight: '1.4',
                  textAlign: 'center',
                  resize: 'vertical',
                  minHeight: '40px',
                  cursor: 'text',
                  userSelect: 'text'
                }}
                rows={Math.max(2, questionLabelInput.split('\n').length)}
              />
            ) : (
              <h3
                className="text-sm font-semibold text-brand-gray"
                style={{
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                  textAlign: 'center',
                  cursor: isDraggingTitle ? 'grabbing' : 'grab'
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (onSaveQuestionLabel) {
                    setEditingQuestionLabel(true)
                    setQuestionLabelInput(displayQuestionLabel)
                  }
                }}
                onMouseEnter={(e) => {
                  if (!isDraggingTitle) {
                    e.currentTarget.style.color = '#3A8518'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = ''
                }}
              >
                {displayQuestionLabel}
              </h3>
            )
          )}
        </div>
      </div>

      {/* Explicit spacer between title and heatmap - 50px fixed height */}
      <div style={{ height: '50px', flexShrink: 0 }} />

      {/* Heatmap table - draggable with adjustable row height */}
      <div
        onMouseDown={handleHeatmapDragStart}
        style={{
          cursor: isDraggingHeatmap ? 'grabbing' : 'grab',
          userSelect: 'none',
          transition: isDraggingHeatmap ? 'none' : 'transform 0.1s ease-out',
          transform: `translate(${heatmapOffset.x}px, ${heatmapOffset.y}px)`,
          // Pass heightOffset as CSS variable for row height adjustment
          ['--row-height-offset' as any]: `${heightOffset}px`,
          width: '100%',
          overflow: 'hidden'
        }}
      >
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{
                backgroundColor: 'transparent',
                padding: '8px 12px',
                textAlign: 'center',
                fontSize: '14px',
                fontWeight: 600,
                width: `${firstColumnWidth}px`,
                minWidth: `${firstColumnWidth}px`,
                maxWidth: `${firstColumnWidth}px`,
                verticalAlign: 'bottom',
                position: 'relative'
              }}>
                {/* Resize handle */}
                <div
                  onMouseDown={handleResizeStart}
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: '6px',
                    cursor: 'col-resize',
                    backgroundColor: isResizing ? 'rgba(58, 133, 24, 0.3)' : 'transparent',
                    transition: 'background-color 0.15s ease',
                    zIndex: 10
                  }}
                  onMouseEnter={(e) => {
                    if (!isResizing) {
                      e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.2)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isResizing) {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }
                  }}
                />
                {/* Advocates/Detractors indicator card + Question Type badge - right aligned with 10px margin from column edge */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', paddingBottom: '4px', paddingRight: '10px' }}>
                  {!hideSegment && sentimentType === 'advocates' && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 10px',
                        backgroundColor: 'rgba(255, 255, 255, 0.85)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        border: '1px solid rgba(58, 133, 24, 0.15)',
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(58, 133, 24, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.5px'
                      }}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: '#3A8518' }} />
                      <span style={{ color: '#3A8518' }}>Advocates</span>
                    </div>
                  )}
                  {!hideSegment && sentimentType === 'detractors' && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 10px',
                        backgroundColor: 'rgba(255, 255, 255, 0.85)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        border: '1px solid rgba(212, 186, 51, 0.15)',
                        borderRadius: '8px',
                        boxShadow: '0 2px 8px rgba(180, 150, 20, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.5px'
                      }}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: '#D4BA33' }} />
                      <span style={{ color: '#D4BA33' }}>Detractors</span>
                    </div>
                  )}
                  {questionTypeBadge}
                </div>
              </th>
              {displayGroups.map((group) => (
                <th
                  key={group.key}
                  style={{
                    backgroundColor: '#FFFFFF',
                    padding: '8px 4px',
                    textAlign: 'center',
                    fontSize: '12px',
                    fontWeight: 600,
                    verticalAlign: 'middle',
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                    whiteSpace: 'normal',
                    lineHeight: '1.2'
                  }}
                >
                  {stripQuotes(group.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayData.map(row => {
              const isEditing = editingOption === row.option
              const hasAsterisk = row.optionDisplay.endsWith('*')
              const displayWithoutAsterisk = hasAsterisk ? row.optionDisplay.slice(0, -1) : row.optionDisplay

              const handleSave = () => {
                // Only allow editing when not transposed (editing original attributes)
                if (editInput.trim() && onSaveOptionLabel && !transposed) {
                  const cleanedInput = editInput.trim().replace(/\*+$/, '')
                  if (cleanedInput !== displayWithoutAsterisk) {
                    onSaveOptionLabel(row.option, cleanedInput)
                  }
                }
                setEditingOption(null)
              }

              return (
              <tr key={row.option}>
                <td style={{
                  backgroundColor: 'transparent',
                  padding: cellPadding,
                  fontSize: '14px',
                  fontWeight: 600,
                  width: `${firstColumnWidth}px`,
                  minWidth: `${firstColumnWidth}px`,
                  maxWidth: `${firstColumnWidth}px`,
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  verticalAlign: 'middle',
                  cursor: onSaveOptionLabel ? 'pointer' : 'default',
                  whiteSpace: 'pre-wrap',
                  textAlign: 'right',
                  color: '#4A5568',
                  position: 'relative'
                }}
                onClick={() => {
                  // Only allow editing when not transposed
                  if (onSaveOptionLabel && !isEditing && !transposed) {
                    setEditingOption(row.option)
                    setEditInput(displayWithoutAsterisk)
                  }
                }}
                onMouseEnter={(e) => {
                  if (onSaveOptionLabel && !isEditing && !transposed) {
                    e.currentTarget.style.color = '#3A8518'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isEditing) {
                    e.currentTarget.style.color = '#4A5568'
                  }
                }}
                >
                  {/* Resize handle on body rows */}
                  <div
                    onMouseDown={handleResizeStart}
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: '6px',
                      cursor: 'col-resize',
                      backgroundColor: isResizing ? 'rgba(58, 133, 24, 0.3)' : 'transparent',
                      transition: 'background-color 0.15s ease',
                      zIndex: 10
                    }}
                    onMouseEnter={(e) => {
                      if (!isResizing) {
                        e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.2)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isResizing) {
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }
                    }}
                  />
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={editInput}
                      onChange={(e) => setEditInput(e.target.value)}
                      onBlur={handleSave}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSave()
                        }
                        if (e.key === 'Escape') setEditingOption(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        fontSize: '14px',
                        padding: '4px 6px',
                        border: '2px solid #3A8518',
                        borderRadius: '3px',
                        outline: 'none',
                        backgroundColor: 'white',
                        fontWeight: 600,
                        minHeight: '60px',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        lineHeight: '1.4',
                        textAlign: 'right',
                        cursor: 'text',
                        userSelect: 'text'
                      }}
                    />
                  ) : (
                    row.optionDisplay
                  )}
                </td>
                {displayGroups.map(group => {
                  const value = typeof row[group.key] === 'number' ? (row[group.key] as number) : 0
                  const { bg, text } = getColor(value, sentiment, minValue, maxValue)
                  return (
                    <td
                      key={group.key}
                      style={{
                        backgroundColor: bg,
                        color: text,
                        padding: `${rowPaddingVertical}px 4px`,
                        textAlign: 'center',
                        fontSize: '12px',
                        fontWeight: text === '#FFFFFF' ? 'normal' : 600,
                        verticalAlign: 'middle'
                      }}
                    >
                      <span>{Math.round(value)}%</span>
                    </td>
                  )
                })}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
    </>
  )
})
