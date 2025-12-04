import React, { useState, useMemo, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faShuffle } from '@fortawesome/free-solid-svg-icons'
import type { SeriesDataPoint, GroupSeriesMeta } from '../dataCalculations'

// Performance: Disable console logs in production
const isDev = process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}
const devWarn = isDev ? console.warn : () => {}

// Utility function to determine text color based on background luminance
function getContrastTextColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '')

  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  // Apply gamma correction
  const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  // Calculate relative luminance using WCAG formula
  const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear

  // Return white for dark backgrounds, black for light backgrounds
  return luminance > 0.5 ? '#111111' : '#FFFFFF'
}

// Utility function to strip quotation marks from text
function stripQuotes(text: string): string {
  if (!text) return text
  let result = text.trim()
  // Remove leading and trailing quotes (both straight and curly quotes)
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('"') && result.endsWith('"'))) {
    result = result.slice(1, -1)
  } else if (result.startsWith("'") && result.endsWith("'")) {
    result = result.slice(1, -1)
  }
  return result.trim()
}

// Color palettes (ordered from darkest to lightest)
// Note: text colors are now calculated dynamically based on luminance
const GREEN_PALETTE = {
  s40: '#3A8518', // Darkest green for largest values
  s30: '#5A8C40',
  s20: '#6FA84D',
  s10: '#82BC62',
  t10: '#A5CF8E',
  t20: '#C8E2BA',
  t40: '#DAEBD1',
  t60: '#F5FFF5',
  t80: '#FFFFFF', // Lightest green/white for smallest values
}

const YELLOW_PALETTE = {
  s40: '#D4BA33', // Darkest yellow for largest values
  s30: '#C5B845',
  s20: '#D8C857',
  s10: '#ECD560',
  t10: '#F1E088',
  t20: '#F5EAAF',
  t40: '#FAF5D7',
  t60: '#FFFEF5',
  t80: '#FFFFFF', // Lightest yellow/white for smallest values
}

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

export const HeatmapTable: React.FC<HeatmapTableProps> = memo(({ data, groups, questionLabel, sentiment, questionId, dataset, productColumn, hideAsterisks = false, optionLabels: _optionLabels = {}, onSaveOptionLabel, onSaveQuestionLabel, productOrder = [], transposed = false }) => {
  const [editingOption, setEditingOption] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')

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

  // Calculate sentiment score for a product using star ratings
  // Sentiment Score = (% Advocates - % Detractors + 100) / 2
  // Advocates = 4s and 5s, Detractors = 1s and 2s, Neutrals = 3s
  const calculateSentimentScore = useMemo(() => {
    // Find sentiment column (column with "(sentiment)" in header)
    const sentimentColumn = dataset.summary.columns.find(col =>
      col.toLowerCase().includes('(sentiment)') && col.toLowerCase().includes('would you consider buying')
    )

    if (!sentimentColumn) {
      devWarn('⚠️ No sentiment column found')
      return null
    }

    devLog('📊 Found sentiment column:', sentimentColumn)

    // Calculate sentiment score for each product
    return (productKey: string) => {
      // Find the product label from groups
      const productGroup = groups.find(g => g.key === productKey)
      if (!productGroup) return 0

      const productLabel = productGroup.label

      // Filter rows for this product
      const productRows = dataset.rows.filter(row => row[productColumn] === productLabel)

      if (productRows.length === 0) {
        devWarn(`⚠️ No rows found for product: ${productLabel}`)
        return 0
      }

      // Count advocates (4-5 stars), detractors (1-2 stars)
      let advocates = 0
      let detractors = 0
      let validResponses = 0

      productRows.forEach(row => {
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
      })

      if (validResponses === 0) {
        devWarn(`⚠️ No valid ratings for product: ${productLabel}`)
        return 0
      }

      const advocatePercent = (advocates / validResponses) * 100
      const detractorPercent = (detractors / validResponses) * 100
      const sentimentScore = (advocatePercent - detractorPercent + 100) / 2

      devLog(`📊 Product: ${productLabel}, Advocates: ${advocates}/${validResponses} (${advocatePercent.toFixed(1)}%), Detractors: ${detractors}/${validResponses} (${detractorPercent.toFixed(1)}%), Score: ${sentimentScore.toFixed(1)}`)

      return sentimentScore
    }
  }, [dataset, productColumn, groups])

  // Default: show all products
  const defaultProductSelection = useMemo(() => {
    return groups.map(g => g.key)
  }, [groups])

  // Calculate top and bottom 50% based on sidebar product order
  // If productOrder exists, use it; otherwise use default group order
  // IMPORTANT: Top and bottom 50% must NOT overlap
  const { top50Products, bottom50Products } = useMemo(() => {
    // Use productOrder if available, converting labels to keys
    let orderedKeys: string[]
    if (productOrder.length > 0) {
      // Convert product labels from sidebar order to keys
      orderedKeys = productOrder
        .map(label => groups.find(g => g.label === label)?.key)
        .filter((key): key is string => key !== undefined)
      // Add any groups not in productOrder at the end
      const keysInOrder = new Set(orderedKeys)
      const remaining = groups.filter(g => !keysInOrder.has(g.key)).map(g => g.key)
      orderedKeys = [...orderedKeys, ...remaining]
    } else {
      // Use default group order
      orderedKeys = groups.map(g => g.key)
    }

    // Split into non-overlapping halves
    // For odd counts, top 50% gets the extra item
    const midpoint = Math.ceil(orderedKeys.length / 2)

    return {
      top50Products: orderedKeys.slice(0, midpoint),
      bottom50Products: orderedKeys.slice(midpoint) // Start from midpoint, no overlap
    }
  }, [groups, productOrder])

  // State for filtering
  const [selectedProducts, setSelectedProducts] = useState<string[]>(defaultProductSelection)
  const [selectedAttributes] = useState<string[]>(data.map(d => d.option))
  const [showProductFilter, setShowProductFilter] = useState(false)
  const [, setShowAttributeFilter] = useState(false)

  // Update selected products when default selection changes (e.g., on data reload)
  useEffect(() => {
    setSelectedProducts(defaultProductSelection)
  }, [defaultProductSelection])

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
    if (!calculateSentimentScore) {
      return groups
    }

    return [...groups].sort((a, b) => {
      const scoreA = calculateSentimentScore(a.key)
      const scoreB = calculateSentimentScore(b.key)

      // Always sort by sentiment score descending (higher is better)
      return scoreB - scoreA
    })
  }, [groups, calculateSentimentScore])

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
        <FontAwesomeIcon icon={faShuffle} style={{ fontSize: '13px', color: selectedProducts.length < allGroupsOrdered.length ? '#3A8518' : '#64748b' }} />
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
                          color: allBottom50Selected ? '#3A8518' : '#6b7280',
                          backgroundColor: allBottom50Selected ? '#f0fdf4' : '#f9fafb',
                          border: allBottom50Selected ? '1px solid #bbf7d0' : '1px solid #e5e7eb',
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
              {allGroupsOrdered.map((group) => {
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

  // Early return if no data - but still render the filter button via portal
  if (sortedData.length === 0 || sortedGroups.length === 0) {
    return (
      <>
        {filterPortalTarget && createPortal(filterButtons, filterPortalTarget)}
        <div className="w-full py-10 text-center text-xs text-brand-gray/60">
          No products selected. Use the filter button to select products.
        </div>
      </>
    )
  }

  // Calculate optimal width for first column based on longest text
  const maxTextLength = Math.max(...displayData.map(row => row.optionDisplay.length))
  // Estimate width: roughly 8px per character, with min 150px and max 250px
  const firstColumnWidth = Math.min(Math.max(maxTextLength * 8, 150), 250)

  return (
    <>
      {filterPortalTarget && createPortal(filterButtons, filterPortalTarget)}
    <div className="w-full" style={{ paddingLeft: '2px', paddingRight: '20px', paddingBottom: '10px' }}>
      {questionLabel && (
        <div className="text-center" style={{ marginTop: '15px', marginBottom: '10px' }}>
          {editingQuestionLabel ? (
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
              className="text-sm font-semibold text-brand-gray"
              style={{
                width: '100%',
                fontSize: '16px',
                padding: '6px 8px',
                border: '2px solid #3A8518',
                borderRadius: '3px',
                outline: 'none',
                backgroundColor: 'white',
                minHeight: '60px',
                resize: 'vertical',
                fontFamily: 'Space Grotesk, sans-serif',
                fontWeight: 600,
                lineHeight: '1.4',
                textAlign: 'center'
              }}
            />
          ) : (
            <h3
              className="text-sm font-semibold text-brand-gray"
              style={{
                cursor: onSaveQuestionLabel ? 'pointer' : 'default',
                whiteSpace: 'pre-wrap'
              }}
              onClick={() => {
                if (onSaveQuestionLabel) {
                  setEditingQuestionLabel(true)
                  setQuestionLabelInput(questionLabel)
                }
              }}
              onMouseEnter={(e) => {
                if (onSaveQuestionLabel) {
                  e.currentTarget.style.color = '#3A8518'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = ''
              }}
            >
              {questionLabel}
            </h3>
          )}
        </div>
      )}

      {/* Heatmap table */}
      <div className="overflow-x-auto">
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{
                backgroundColor: '#FFFFFF',
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: '14px',
                fontWeight: 600,
                width: `${firstColumnWidth}px`,
                verticalAlign: 'middle'
              }}></th>
              {displayGroups.map((group) => (
                <th
                  key={group.key}
                  style={{
                    backgroundColor: '#FFFFFF',
                    padding: '8px 12px',
                    textAlign: 'center',
                    fontSize: '14px',
                    fontWeight: 600,
                    verticalAlign: 'middle'
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
                  backgroundColor: '#FFFFFF',
                  padding: '8px 12px',
                  fontSize: '14px',
                  fontWeight: 600,
                  width: `${firstColumnWidth}px`,
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  verticalAlign: 'middle',
                  cursor: onSaveOptionLabel ? 'pointer' : 'default',
                  whiteSpace: 'pre-wrap',
                  textAlign: 'right',
                  color: '#4A5568'
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
                        textAlign: 'right'
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
                        padding: '8px 12px',
                        textAlign: 'center',
                        fontSize: '14px',
                        fontWeight: text === '#FFFFFF' ? 'normal' : 600,
                        verticalAlign: 'middle'
                      }}
                    >
                      <span style={{ paddingRight: '2px' }}>{Math.round(value)}%</span>
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
