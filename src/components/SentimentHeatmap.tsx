import React, { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faShuffle } from '@fortawesome/free-solid-svg-icons'
import type { ParsedCSV } from '../types'

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
  productOrder?: string[]
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
  hideAsterisks: _hideAsterisks = false,
  onSaveQuestionLabel,
  productOrder = []
}) => {
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')
  const [showProductFilter, setShowProductFilter] = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [portalReady, setPortalReady] = useState(false)

  // Find sentiment column
  const sentimentColumn = useMemo(() => {
    return dataset.summary.columns.find(col =>
      col.toLowerCase().includes('(sentiment)')
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
        let numericRating: number

        if (typeof rating === 'number') {
          numericRating = rating
        } else {
          // Extract numeric value from strings like "4 - Probably" or "5"
          const stringRating = String(rating).trim()
          const match = stringRating.match(/^(\d+)/)
          numericRating = match ? Number(match[1]) : Number(stringRating)
        }

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

  // Calculate top and bottom 50% based on sidebar product order
  // If productOrder exists, use it; otherwise use default sorted order
  // IMPORTANT: Top and bottom 50% must NOT overlap
  const { top50Products, bottom50Products } = useMemo(() => {
    let orderedNames: string[]
    if (productOrder.length > 0) {
      // Use sidebar order, filter to only products that exist in our data
      const existingNames = new Set(sortedProducts.map(p => p.productName))
      orderedNames = productOrder.filter(name => existingNames.has(name))
      // Add any products not in productOrder at the end
      const namesInOrder = new Set(orderedNames)
      const remaining = sortedProducts.filter(p => !namesInOrder.has(p.productName)).map(p => p.productName)
      orderedNames = [...orderedNames, ...remaining]
    } else {
      orderedNames = sortedProducts.map(p => p.productName)
    }

    // Split into non-overlapping halves
    // For odd counts, top 50% gets the extra item
    const midpoint = Math.ceil(orderedNames.length / 2)
    return {
      top50Products: orderedNames.slice(0, midpoint),
      bottom50Products: orderedNames.slice(midpoint) // Start from midpoint, no overlap
    }
  }, [sortedProducts, productOrder])

  // Initialize selected products - show all by default
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

  // Apply global product order from sidebar
  const orderedProducts = useMemo(() => {
    if (productOrder.length > 0) {
      // Use global order, appending any products not in the order
      const orderedFromGlobal = productOrder
        .map(name => sortedProducts.find(p => p.productName === name))
        .filter((p): p is ProductSentiment => p !== undefined)
      const namesInOrder = new Set(productOrder)
      const remaining = sortedProducts.filter(p => !namesInOrder.has(p.productName))
      return [...orderedFromGlobal, ...remaining]
    }
    return sortedProducts
  }, [productOrder, sortedProducts])

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
          style={{
            height: '30px',
            width: '30px',
            backgroundColor: selectedProducts.length < sortedProducts.length ? '#C8E2BA' : '#EEF2F6',
            border: selectedProducts.length < sortedProducts.length ? '1px solid #3A8518' : '1px solid #EEF2F6',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
          title="Filter Products"
        >
          <FontAwesomeIcon icon={faShuffle} style={{ fontSize: '16px' }} />
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
                    const allTop50Selected = top50Products.every(name => selectedProducts.includes(name))
                    return (
                      <button
                        onClick={() => {
                          if (allTop50Selected) {
                            setSelectedProducts(selectedProducts.filter(name => !top50Products.includes(name)))
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
                    const allBottom50Selected = bottom50Products.every(name => selectedProducts.includes(name))
                    return (
                      <button
                        onClick={() => {
                          if (allBottom50Selected) {
                            setSelectedProducts(selectedProducts.filter(name => !bottom50Products.includes(name)))
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
              {orderedProducts.map((product) => {
                const isChecked = selectedProducts.includes(product.productName)
                return (
                  <label
                    key={product.productName}
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
                          setSelectedProducts(selectedProducts.filter(p => p !== product.productName))
                        } else {
                          setSelectedProducts([...selectedProducts, product.productName])
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
                    <span style={{ fontSize: '13px', color: '#374151' }}>{product.productName}</span>
                  </label>
                )
              })}
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
