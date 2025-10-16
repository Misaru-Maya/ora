import React, { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { SeriesDataPoint, GroupSeriesMeta, customRound } from '../dataCalculations'

// Color palettes (ordered from darkest to lightest)
const GREEN_PALETTE = {
  s40: { bg: '#3A8518', text: '#FFFFFF' }, // Darkest green for largest values
  s30: { bg: '#5A8C40', text: '#FFFFFF' },
  s20: { bg: '#6FA84D', text: '#111' },
  s10: { bg: '#82BC62', text: '#111' },
  t10: { bg: '#A5CF8E', text: '#111' },
  t20: { bg: '#C8E2BA', text: '#111' },
  t40: { bg: '#DAEBD1', text: '#111' },
  t60: { bg: '#F5FFF5', text: '#111' },
  t80: { bg: '#FFFFFF', text: '#111' }, // Lightest green/white for smallest values
}

const YELLOW_PALETTE = {
  s40: { bg: '#D4BA33', text: '#111' }, // Darkest yellow for largest values
  s30: { bg: '#C5B845', text: '#111' },
  s20: { bg: '#D8C857', text: '#111' },
  s10: { bg: '#ECD560', text: '#111' },
  t10: { bg: '#F1E088', text: '#111' },
  t20: { bg: '#F5EAAF', text: '#111' },
  t40: { bg: '#FAF5D7', text: '#111' },
  t60: { bg: '#FFFEF5', text: '#111' },
  t80: { bg: '#FFFFFF', text: '#111' }, // Lightest yellow/white for smallest values
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
}

// Get color based on value and sentiment
const getColor = (value: number, sentiment: 'positive' | 'negative', minVal: number, maxVal: number) => {
  const palette = sentiment === 'positive' ? GREEN_PALETTE : YELLOW_PALETTE

  // Normalize value to 0-100 range based on min/max
  const range = maxVal - minVal
  const normalized = range > 0 ? ((value - minVal) / range) * 100 : 50

  // Map to palette buckets (larger values = darker colors, smaller values = lighter colors)
  // Order from large to small: s40, s30, s20, s10/t10, t20, t40, t60, t80
  if (normalized >= 87.5) return palette.s40  // Largest values - darkest
  if (normalized >= 75) return palette.s30
  if (normalized >= 62.5) return palette.s20
  if (normalized >= 50) return palette.s10
  if (normalized >= 37.5) return palette.t10
  if (normalized >= 25) return palette.t20
  if (normalized >= 12.5) return palette.t40
  if (normalized >= 0) return palette.t60
  return palette.t80  // Smallest values - lightest
}

export const HeatmapTable: React.FC<HeatmapTableProps> = ({ data, groups, questionLabel, sentiment, questionId, dataset, productColumn }) => {
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
  const [showColumnReorder, setShowColumnReorder] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

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
        setShowColumnReorder(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Filter data
  const filteredGroups = groups.filter(g => selectedProducts.includes(g.key))
  const filteredData = data.filter(d => selectedAttributes.includes(d.option))

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
              setShowColumnReorder(false)
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
                  {allGroupsSorted.map(group => (
                    <label key={group.key} className="flex items-center py-2 cursor-pointer hover:bg-gray-100" style={{ backgroundColor: '#EEF2F6', gap: '2px' }}>
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
              setShowColumnReorder(false)
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
                  {data.map(item => (
                    <label key={item.option} className="flex items-center py-2 cursor-pointer hover:bg-gray-100" style={{ backgroundColor: '#EEF2F6', gap: '2px' }}>
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

        <div className="relative heatmap-dropdown-container">
          <button
            onClick={() => {
              setShowColumnReorder(!showColumnReorder)
              setShowProductFilter(false)
              setShowAttributeFilter(false)
            }}
            className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
            style={{ height: '30px', width: '30px', backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}
            title="Reorder Columns"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" />
              <path d="M8 3H3v5" />
              <path d="M21 8l-7-5-7 5" />
              <path d="M3 16l7 5 7-5" />
              <path d="M16 21h5v-5" />
              <path d="M8 21H3v-5" />
            </svg>
          </button>
          {showColumnReorder && (
            <div className="absolute left-0 top-10 z-50 w-[20rem] shadow-xl" style={{ backgroundColor: '#EEF2F6', border: '1px solid #EEF2F6', borderRadius: '3px' }}>
              <div className="px-4 py-3" style={{ backgroundColor: '#EEF2F6', borderRadius: '3px' }}>
                <div className="mb-2 flex justify-between items-center border-b pb-2" style={{ borderColor: '#80BDFF' }}>
                  <span className="text-xs font-semibold text-brand-gray">Reorder Columns</span>
                  <button
                    className="text-xs text-brand-green underline hover:text-brand-green/80"
                    style={{ paddingLeft: '2px', paddingRight: '2px', border: 'none', background: 'none', textDecoration: 'underline' }}
                    onClick={() => setCustomColumnOrder(null)}
                  >
                    Reset to default
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto" style={{ backgroundColor: '#EEF2F6' }}>
                  {sortedGroups.map((group, index) => {
                    const isDragging = draggedIndex === index
                    return (
                      <div
                        key={group.key}
                        draggable
                        onDragStart={() => setDraggedIndex(index)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          if (draggedIndex !== null && draggedIndex !== index) {
                            const newOrder = [...sortedGroups]
                            const draggedItem = newOrder[draggedIndex]
                            newOrder.splice(draggedIndex, 1)
                            newOrder.splice(index, 0, draggedItem)
                            setCustomColumnOrder(newOrder.map(g => g.key))
                            setDraggedIndex(index)
                          }
                        }}
                        onDragEnd={() => setDraggedIndex(null)}
                        className={`flex items-center gap-2 py-2 px-2 cursor-move ${
                          isDragging ? 'opacity-50' : 'hover:bg-gray-100'
                        }`}
                        style={{ backgroundColor: isDragging ? '#f3f4f6' : '#EEF2F6' }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="3" y1="12" x2="21" y2="12"></line>
                          <line x1="3" y1="6" x2="21" y2="6"></line>
                          <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                        <span className="text-sm flex-1">{group.label}</span>
                        <span className="text-xs text-gray-500">{index + 1}</span>
                      </div>
                    )
                  })}
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
    <div className="w-full" style={{ minHeight: '400px', paddingLeft: '50px', paddingRight: '50px', paddingBottom: '50px' }}>
      {questionLabel && (
        <div className="text-center" style={{ marginTop: '15px', marginBottom: '10px' }}>
          <h3 className="text-sm font-semibold text-brand-gray">{questionLabel}</h3>
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
                  {group.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map(row => (
              <tr key={row.option}>
                <td style={{
                  backgroundColor: '#FFFFFF',
                  padding: '8px 12px',
                  fontSize: '14px',
                  fontWeight: 600,
                  width: `${firstColumnWidth}px`,
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  verticalAlign: 'middle'
                }}>
                  {row.optionDisplay}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </>
  )
}
