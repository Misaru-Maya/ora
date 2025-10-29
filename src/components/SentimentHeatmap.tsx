import React, { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ParsedCSV } from '../types'

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

// Utility function to determine text color based on background luminance
function getContrastTextColor(hexColor: string): string {
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear
  return luminance > 0.5 ? '#111111' : '#FFFFFF'
}

// Green palette for Advocates (darkest to lightest)
const GREEN_PALETTE = {
  s40: '#3A8518',
  s30: '#5A8C40',
  s20: '#6FA84D',
  s10: '#82BC62',
  t10: '#A5CF8E',
  t20: '#C8E2BA',
  t40: '#DAEBD1',
  t60: '#F5FFF5',
  t80: '#FFFFFF',
}

// Yellow palette for Detractors (darkest to lightest)
const YELLOW_PALETTE = {
  s40: '#D4BA33',
  s30: '#C5B845',
  s20: '#D8C857',
  s10: '#ECD560',
  t10: '#F1E088',
  t20: '#F5EAAF',
  t40: '#FAF5D7',
  t60: '#FFFEF5',
  t80: '#FFFFFF',
}

interface SentimentHeatmapProps {
  dataset: ParsedCSV
  productColumn: string
  questionLabel?: string
  questionId?: string
  hideAsterisks?: boolean
  onSaveQuestionLabel?: (newLabel: string) => void
}

interface ProductSentiment {
  productName: string
  advocatePercent: number
  detractorPercent: number
  totalResponses: number
}

// Get color based on value within a row (advocates or detractors)
const getColor = (value: number, sentiment: 'advocate' | 'detractor', minVal: number, maxVal: number) => {
  const palette = sentiment === 'advocate' ? GREEN_PALETTE : YELLOW_PALETTE

  // Normalize value to 0-100 range based on min/max within this row
  const range = maxVal - minVal
  const normalized = range > 0 ? ((value - minVal) / range) * 100 : 50

  // Map to palette buckets (larger values = darker colors)
  let bgColor: string
  if (normalized >= 87.5) bgColor = palette.s40
  else if (normalized >= 75) bgColor = palette.s30
  else if (normalized >= 62.5) bgColor = palette.s20
  else if (normalized >= 50) bgColor = palette.s10
  else if (normalized >= 37.5) bgColor = palette.t10
  else if (normalized >= 25) bgColor = palette.t20
  else if (normalized >= 12.5) bgColor = palette.t40
  else if (normalized >= 0) bgColor = palette.t60
  else bgColor = palette.t80

  const textColor = getContrastTextColor(bgColor)
  return { bg: bgColor, text: textColor }
}

export const SentimentHeatmap: React.FC<SentimentHeatmapProps> = ({
  dataset,
  productColumn,
  questionLabel,
  questionId,
  hideAsterisks = false,
  onSaveQuestionLabel
}) => {
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')
  const [showProductFilter, setShowProductFilter] = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [customProductOrder, setCustomProductOrder] = useState<string[] | null>(null)
  const [draggedProductIndex, setDraggedProductIndex] = useState<number | null>(null)
  const [portalReady, setPortalReady] = useState(false)

  // Find sentiment column
  const sentimentColumn = useMemo(() => {
    return dataset.summary.columns.find(col =>
      col.toLowerCase().includes('(sentiment)') && col.toLowerCase().includes('would you consider buying')
    )
  }, [dataset])

  // Calculate sentiment data for all products
  const productSentiments = useMemo((): ProductSentiment[] => {
    if (!sentimentColumn) return []

    // Get all unique products and strip quotes
    const allProducts = Array.from(
      new Set(dataset.rows.map(row => stripQuotes(String(row[productColumn] ?? ''))).filter(Boolean))
    )

    return allProducts.map(productName => {
      const productRows = dataset.rows.filter(row => stripQuotes(String(row[productColumn])) === productName)

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
          } else if (numericRating <= 3) {
            detractors++
          }
        }
      })

      const advocatePercent = validResponses > 0 ? (advocates / validResponses) * 100 : 0
      const detractorPercent = validResponses > 0 ? (detractors / validResponses) * 100 : 0

      return {
        productName,
        advocatePercent,
        detractorPercent,
        totalResponses: validResponses
      }
    })
  }, [dataset, productColumn, sentimentColumn])

  // Sort products by sentiment score (for default order)
  const sortedProducts = useMemo(() => {
    return [...productSentiments].sort((a, b) => {
      const scoreA = (a.advocatePercent - a.detractorPercent + 100) / 2
      const scoreB = (b.advocatePercent - b.detractorPercent + 100) / 2
      return scoreB - scoreA // Highest score first
    })
  }, [productSentiments])

  // Initialize selected products
  useEffect(() => {
    setSelectedProducts(sortedProducts.map(p => p.productName))
  }, [sortedProducts])

  // Check for portal target availability
  useEffect(() => {
    if (questionId) {
      const checkPortal = () => {
        const target = document.getElementById(`heatmap-filters-${questionId}`)
        if (target) {
          setPortalReady(true)
          return true
        }
        return false
      }

      if (!checkPortal()) {
        const timer = setTimeout(checkPortal, 10)
        return () => clearTimeout(timer)
      }
    }
  }, [questionId])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const isOutsideDropdowns = !target.closest('.sentiment-heatmap-dropdown')
      if (isOutsideDropdowns) {
        setShowProductFilter(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Apply custom order
  const orderedProducts = useMemo(() => {
    const baseOrder = customProductOrder || sortedProducts.map(p => p.productName)
    return baseOrder
      .map(name => sortedProducts.find(p => p.productName === name))
      .filter((p): p is ProductSentiment => p !== undefined)
  }, [customProductOrder, sortedProducts])

  // Filter selected products
  const filteredProducts = useMemo(() => {
    return orderedProducts.filter(p => selectedProducts.includes(p.productName))
  }, [orderedProducts, selectedProducts])

  // Calculate min/max for each row separately
  const advocateMinMax = useMemo(() => {
    const values = filteredProducts.map(p => p.advocatePercent)
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [filteredProducts])

  const detractorMinMax = useMemo(() => {
    const values = filteredProducts.map(p => p.detractorPercent)
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [filteredProducts])

  // Drag handlers
  const handleProductDragStart = (index: number) => {
    setDraggedProductIndex(index)
  }

  const handleProductDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedProductIndex === null || draggedProductIndex === index) return

    const currentOrder = customProductOrder || sortedProducts.map(p => p.productName)
    const newOrder = [...currentOrder]
    const [draggedItem] = newOrder.splice(draggedProductIndex, 1)
    newOrder.splice(index, 0, draggedItem)

    setCustomProductOrder(newOrder)
    setDraggedProductIndex(index)
  }

  const handleProductDragEnd = () => {
    setDraggedProductIndex(null)
  }

  if (!sentimentColumn) {
    return (
      <div className="w-full py-10 text-center text-xs text-brand-gray/60">
        No sentiment column found.
      </div>
    )
  }

  if (filteredProducts.length === 0) {
    return (
      <div className="w-full py-10 text-center text-xs text-brand-gray/60">
        No products selected.
      </div>
    )
  }

  // Filter buttons JSX
  const filterButtons = (
    <div className="flex items-center gap-2">
      <div className="relative sentiment-heatmap-dropdown">
        <button
          onClick={() => setShowProductFilter(!showProductFilter)}
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
                  onClick={() => setSelectedProducts(sortedProducts.map(p => p.productName))}
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
                {sortedProducts.map((product, index) => (
                  <label
                    key={product.productName}
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
                      checked={selectedProducts.includes(product.productName)}
                      onChange={() => {
                        if (selectedProducts.includes(product.productName)) {
                          setSelectedProducts(selectedProducts.filter(p => p !== product.productName))
                        } else {
                          setSelectedProducts([...selectedProducts, product.productName])
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-brand-green focus:ring-brand-green"
                    />
                    <span className="text-sm">{product.productName}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )

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
                  width: '150px',
                  verticalAlign: 'middle'
                }}></th>
                {filteredProducts.map(product => (
                  <th key={product.productName} style={{
                    backgroundColor: '#FFFFFF',
                    padding: '8px 12px',
                    textAlign: 'center',
                    fontSize: '14px',
                    fontWeight: 600,
                    verticalAlign: 'middle'
                  }}>
                    {product.productName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Advocate Row */}
              <tr>
                <td style={{
                  backgroundColor: '#FFFFFF',
                  padding: '8px 12px',
                  fontSize: '14px',
                  fontWeight: 600,
                  width: '150px',
                  verticalAlign: 'middle',
                  textAlign: 'right'
                }}>
                  Advocates
                </td>
                {filteredProducts.map(product => {
                  const { bg, text } = getColor(product.advocatePercent, 'advocate', advocateMinMax.min, advocateMinMax.max)
                  return (
                    <td
                      key={product.productName}
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
                      <span style={{ paddingRight: '2px' }}>{Math.round(product.advocatePercent)}%</span>
                    </td>
                  )
                })}
              </tr>
              {/* Detractor Row */}
              <tr>
                <td style={{
                  backgroundColor: '#FFFFFF',
                  padding: '8px 12px',
                  fontSize: '14px',
                  fontWeight: 600,
                  width: '150px',
                  verticalAlign: 'middle',
                  textAlign: 'right'
                }}>
                  Detractors
                </td>
                {filteredProducts.map(product => {
                  const { bg, text } = getColor(product.detractorPercent, 'detractor', detractorMinMax.min, detractorMinMax.max)
                  return (
                    <td
                      key={product.productName}
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
                      <span style={{ paddingRight: '2px' }}>{Math.round(product.detractorPercent)}%</span>
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
