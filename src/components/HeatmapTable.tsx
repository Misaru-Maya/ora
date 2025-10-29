import React, { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SeriesDataPoint, GroupSeriesMeta, customRound } from '../dataCalculations'

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

import { ParsedCSV } from '../types'

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

export const HeatmapTable: React.FC<HeatmapTableProps> = ({ data, groups, questionLabel, sentiment, questionId, dataset, productColumn, hideAsterisks = false, optionLabels = {}, onSaveOptionLabel, onSaveQuestionLabel }) => {
  const [editingOption, setEditingOption] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')

  console.log('🔥 HeatmapTable Received:', {
    dataLength: data.length,
    groupsLength: groups.length,
    groups: groups.map(g => ({ key: g.key, label: g.label })),
    sampleData: data[0],
    questionLabel,
    sentiment,
    datasetRows: dataset.rows.length,
    productColumn
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
      console.warn('⚠️ No sentiment column found')
      return null
    }

    console.log('📊 Found sentiment column:', sentimentColumn)

    // Calculate sentiment score for each product
    return (productKey: string) => {
      // Find the product label from groups
      const productGroup = groups.find(g => g.key === productKey)
      if (!productGroup) return 0

      const productLabel = productGroup.label

      // Filter rows for this product
      const productRows = dataset.rows.filter(row => row[productColumn] === productLabel)

      if (productRows.length === 0) {
        console.warn(`⚠️ No rows found for product: ${productLabel}`)
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
        console.warn(`⚠️ No valid ratings for product: ${productLabel}`)
        return 0
      }

      const advocatePercent = (advocates / validResponses) * 100
      const detractorPercent = (detractors / validResponses) * 100
      const sentimentScore = (advocatePercent - detractorPercent + 100) / 2

      console.log(`📊 Product: ${productLabel}, Advocates: ${advocates}/${validResponses} (${advocatePercent.toFixed(1)}%), Detractors: ${detractors}/${validResponses} (${detractorPercent.toFixed(1)}%), Score: ${sentimentScore.toFixed(1)}`)

      return sentimentScore
    }
  }, [dataset, productColumn, groups])

  // Calculate default product selection based on sentiment (top/bottom 50%)
  const defaultProductSelection = useMemo(() => {
    if (!calculateSentimentScore) {
      return groups.map(g => g.key)
    }

    // If fewer than 8 products, show all products by default
    if (groups.length < 8) {
      return groups.map(g => g.key)
    }

    // Sort all groups by sentiment score
    const sortedByScore = [...groups].sort((a, b) => {
      const scoreA = calculateSentimentScore(a.key)
      const scoreB = calculateSentimentScore(b.key)
      return scoreB - scoreA  // Descending order
    })

    // Calculate 50% cutoff
    const halfCount = Math.ceil(sortedByScore.length / 2)

    if (sentiment === 'positive') {
      // For positive questions: select top 50% (highest scores)
      return sortedByScore.slice(0, halfCount).map(g => g.key)
    } else {
      // For negative questions: select bottom 50% (lowest scores)
      return sortedByScore.slice(-halfCount).map(g => g.key)
    }
  }, [groups, calculateSentimentScore, sentiment])

  // State for filtering
  const [selectedProducts, setSelectedProducts] = useState<string[]>(defaultProductSelection)
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>(data.map(d => d.option))
  const [showProductFilter, setShowProductFilter] = useState(false)
  const [showAttributeFilter, setShowAttributeFilter] = useState(false)

  // Update selected products when default selection changes (e.g., on data reload)
  useEffect(() => {
    setSelectedProducts(defaultProductSelection)
  }, [defaultProductSelection])

  // State for column reordering
  const [customColumnOrder, setCustomColumnOrder] = useState<string[] | null>(null)
  const [draggedProductIndex, setDraggedProductIndex] = useState<number | null>(null)
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

  // Drag handlers for product filter
  const handleProductDragStart = (index: number) => {
    setDraggedProductIndex(index)
  }

  const handleProductDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedProductIndex === null || draggedProductIndex === index) return

    const currentOrder = customColumnOrder || allGroupsSorted.map(g => g.key)
    const newOrder = [...currentOrder]
    const [draggedItem] = newOrder.splice(draggedProductIndex, 1)
    newOrder.splice(index, 0, draggedItem)

    setCustomColumnOrder(newOrder)
    setDraggedProductIndex(index)
  }

  const handleProductDragEnd = () => {
    setDraggedProductIndex(null)
  }

  // Drag handlers for attribute filter
  const [customAttributeOrder, setCustomAttributeOrder] = useState<string[] | null>(null)

  const handleAttributeDragStart = (index: number) => {
    setDraggedAttributeIndex(index)
  }

  const handleAttributeDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedAttributeIndex === null || draggedAttributeIndex === index) return

    const currentOrder = customAttributeOrder || data.map(d => d.option)
    const newOrder = [...currentOrder]
    const [draggedItem] = newOrder.splice(draggedAttributeIndex, 1)
    newOrder.splice(index, 0, draggedItem)

    setCustomAttributeOrder(newOrder)
    setDraggedAttributeIndex(index)
  }

  const handleAttributeDragEnd = () => {
    setDraggedAttributeIndex(null)
  }

  // Filter data and strip asterisks if needed
  const filteredGroups = groups.filter(g => selectedProducts.includes(g.key))
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

  // Apply custom order if exists, otherwise use default sorted order
  const sortedGroups = useMemo(() => {
    if (customColumnOrder) {
      // Filter to only include columns that exist in defaultSortedGroups
      const validOrder = customColumnOrder
        .map(key => defaultSortedGroups.find(g => g.key === key))
        .filter((g): g is GroupSeriesMeta => g !== undefined)

      // Add any new columns that aren't in customColumnOrder
      const keysInCustomOrder = new Set(customColumnOrder)
      const newColumns = defaultSortedGroups.filter(g => !keysInCustomOrder.has(g.key))

      return [...validOrder, ...newColumns]
    }
    return defaultSortedGroups
  }, [customColumnOrder, defaultSortedGroups])

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

  console.log('🔥 HeatmapTable Rendering:', {
    sortedGroupsLength: sortedGroups.length,
    sortedDataLength: sortedData.length,
    sortedGroups: sortedGroups.map(g => g.key),
    sortedDataSample: sortedData[0]
  })

  // Early return if no data
  if (sortedData.length === 0 || sortedGroups.length === 0) {
    return (
      <div className="w-full py-10 text-center text-xs text-brand-gray/60">
        No data available for heatmap.
      </div>
    )
  }

  // Create filter buttons JSX
  const filterButtons = (
    <div className="flex items-center gap-2">
      <div className="relative heatmap-dropdown-container">
          <button
            onClick={() => {
              setShowProductFilter(!showProductFilter)
              setShowAttributeFilter(false)
            }}
            className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
            style={{ height: '30px', width: '30px', backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}
            title="Filter Products"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M7 12h10" />
              <path d="M10 18h4" />
            </svg>
          </button>
          {showProductFilter && (
            <div className="absolute left-0 top-10 z-50 w-[20rem] shadow-xl" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}>
              <div className="px-4 py-3" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                <div className="mb-2 flex justify-end gap-4 border-b pb-2" style={{ borderColor: '#80BDFF' }}>
                  <button
                    className="text-xs text-brand-green underline hover:text-brand-green/80"
                    style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none' }}
                    onClick={() => setSelectedProducts(defaultProductSelection)}
                    title={`Reset to ${sentiment === 'positive' ? 'top' : 'bottom'} 50%`}
                  >
                    Default (50%)
                  </button>
                  <button
                    className="text-xs text-brand-green underline hover:text-brand-green/80"
                    style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none' }}
                    onClick={() => setSelectedProducts(groups.map(g => g.key))}
                  >
                    Select all
                  </button>
                  <button
                    className="text-xs text-brand-gray underline hover:text-brand-gray/80"
                    style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none' }}
                    onClick={() => setSelectedProducts([])}
                  >
                    Clear
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto" style={{ backgroundColor: '#EEF2F6' }}>
                  {allGroupsSorted.map((group, index) => (
                    <label
                      key={group.key}
                      draggable
                      onDragStart={() => handleProductDragStart(index)}
                      onDragOver={(e) => handleProductDragOver(e, index)}
                      onDragEnd={handleProductDragEnd}
                      className={`flex items-center py-2 cursor-move hover:bg-gray-100 ${
                        draggedProductIndex === index ? 'opacity-50 bg-gray-100' : ''
                      }`}
                      style={{ backgroundColor: draggedProductIndex === index ? '#e5e7eb' : '#EEF2F6', gap: '4px' }}
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
                        checked={selectedProducts.includes(group.key)}
                        onChange={() => {
                          if (selectedProducts.includes(group.key)) {
                            setSelectedProducts(selectedProducts.filter(k => k !== group.key))
                          } else {
                            setSelectedProducts([...selectedProducts, group.key])
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green"
                      />
                      <span className="text-sm">{group.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="relative heatmap-dropdown-container">
          <button
            onClick={() => {
              setShowAttributeFilter(!showAttributeFilter)
              setShowProductFilter(false)
            }}
            className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
            style={{ height: '30px', width: '30px', backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}
            title="Filter Attributes"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M7 12h10" />
              <path d="M10 18h4" />
            </svg>
          </button>
          {showAttributeFilter && (
            <div className="absolute left-0 top-10 z-50 w-[20rem] shadow-xl" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}>
              <div className="px-4 py-3" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                <div className="mb-2 flex justify-end gap-4 border-b pb-2" style={{ borderColor: '#80BDFF' }}>
                  <button
                    className="text-xs text-brand-green underline hover:text-brand-green/80"
                    style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none' }}
                    onClick={() => setSelectedAttributes(data.map(d => d.option))}
                  >
                    Select all
                  </button>
                  <button
                    className="text-xs text-brand-gray underline hover:text-brand-gray/80"
                    style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none' }}
                    onClick={() => setSelectedAttributes([])}
                  >
                    Clear
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto" style={{ backgroundColor: '#EEF2F6' }}>
                  {data.map((item, index) => (
                    <label
                      key={item.option}
                      draggable
                      onDragStart={() => handleAttributeDragStart(index)}
                      onDragOver={(e) => handleAttributeDragOver(e, index)}
                      onDragEnd={handleAttributeDragEnd}
                      className={`flex items-center py-2 cursor-move hover:bg-gray-100 ${
                        draggedAttributeIndex === index ? 'opacity-50 bg-gray-100' : ''
                      }`}
                      style={{ backgroundColor: draggedAttributeIndex === index ? '#e5e7eb' : '#EEF2F6', gap: '4px' }}
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
                        checked={selectedAttributes.includes(item.option)}
                        onChange={() => {
                          if (selectedAttributes.includes(item.option)) {
                            setSelectedAttributes(selectedAttributes.filter(o => o !== item.option))
                          } else {
                            setSelectedAttributes([...selectedAttributes, item.option])
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green"
                      />
                      <span className="text-sm">{item.optionDisplay}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
    </div>
  )

  // Calculate optimal width for first column based on longest text
  const maxTextLength = Math.max(...sortedData.map(row => row.optionDisplay.length))
  // Estimate width: roughly 8px per character, with min 150px and max 250px
  const firstColumnWidth = Math.min(Math.max(maxTextLength * 8, 150), 250)

  // Get portal target element
  const filterPortalTarget = portalReady && questionId ? document.getElementById(`heatmap-filters-${questionId}`) : null

  return (
    <>
      {filterPortalTarget && createPortal(filterButtons, filterPortalTarget)}
    <div className="w-full" style={{ paddingLeft: '20px', paddingRight: '20px', paddingBottom: '10px' }}>
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
              {sortedGroups.map(group => (
                <th key={group.key} style={{
                  backgroundColor: '#FFFFFF',
                  padding: '8px 12px',
                  textAlign: 'center',
                  fontSize: '14px',
                  fontWeight: 600,
                  verticalAlign: 'middle'
                }}>
                  {stripQuotes(group.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map(row => {
              const isEditing = editingOption === row.option
              const hasAsterisk = row.optionDisplay.endsWith('*')
              const displayWithoutAsterisk = hasAsterisk ? row.optionDisplay.slice(0, -1) : row.optionDisplay

              const handleSave = () => {
                if (editInput.trim() && onSaveOptionLabel) {
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
                  if (onSaveOptionLabel && !isEditing) {
                    setEditingOption(row.option)
                    setEditInput(displayWithoutAsterisk)
                  }
                }}
                onMouseEnter={(e) => {
                  if (onSaveOptionLabel && !isEditing) {
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
                {sortedGroups.map(group => {
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
}
