import React, { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ParsedCSV } from '../types'
import { stripQuotes, getContrastTextColor, GREEN_PALETTE, YELLOW_PALETTE } from '../utils'

interface SentimentHeatmapProps {
  dataset: ParsedCSV
  productColumn: string
  questionLabel?: string
  questionId?: string
  showAsterisks?: boolean
  onSaveQuestionLabel?: (newLabel: string) => void
  productOrder?: string[]
  transposed?: boolean
  questionTypeBadge?: React.ReactNode
  heightOffset?: number
  showSegment?: boolean
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

export const SentimentHeatmap: React.FC<SentimentHeatmapProps> = React.memo(({
  dataset,
  productColumn,
  questionLabel,
  questionId,
  showAsterisks: _showAsterisks = true,
  onSaveQuestionLabel,
  productOrder = [],
  transposed = false,
  questionTypeBadge,
  heightOffset = 0,
  showSegment = true
}) => {
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')
  const [showProductFilter, setShowProductFilter] = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [portalReady, setPortalReady] = useState(false)

  // State for resizable attribute column
  const [attributeColumnWidth, setAttributeColumnWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartX = React.useRef<number>(0)
  const resizeStartWidth = React.useRef<number>(0)
  const FIRST_COL_DEFAULT_WIDTH = 150

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

  // Note: top50Products and bottom50Products are now derived from orderedProducts
  // (defined later) to ensure they always match the displayed dropdown order.

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

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStartX.current = e.clientX
    resizeStartWidth.current = attributeColumnWidth ?? FIRST_COL_DEFAULT_WIDTH
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

  // Calculate first column width
  const firstColumnWidth = attributeColumnWidth ?? FIRST_COL_DEFAULT_WIDTH

  // Calculate row padding based on heightOffset
  // Base padding is 8px, heightOffset adds/subtracts from vertical padding
  // heightOffset ranges from -100 to +300, we map it to padding change
  const baseRowPadding = 8
  const rowPaddingVertical = Math.max(4, baseRowPadding + Math.round(heightOffset / 20))
  const cellPadding = `${rowPaddingVertical}px 12px`

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

  // Calculate top and bottom 50% based on the DISPLAYED order in orderedProducts
  // This ensures Top 50% / Bottom 50% buttons always match the dropdown list order
  const { top50Products, bottom50Products } = useMemo(() => {
    const orderedNames = orderedProducts.map(p => p.productName)
    const midpoint = Math.ceil(orderedNames.length / 2)
    return {
      top50Products: orderedNames.slice(0, midpoint),
      bottom50Products: orderedNames.slice(midpoint)
    }
  }, [orderedProducts])

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
      <div className="w-full" style={{ paddingLeft: '2px', paddingBottom: '30px', width: '95%', margin: '0 auto' }}>
        {/* Header Row with Title (no question type badge) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '15px',
            marginBottom: '15px'
          }}
        >
          {/* Center: Title */}
          <div style={{ textAlign: 'center', maxWidth: '80%' }}>
            {questionLabel && (
              <h3
                className="text-sm font-semibold text-brand-gray"
                style={{
                  fontFamily: 'Space Grotesk, sans-serif',
                  wordWrap: 'break-word',
                  whiteSpace: 'normal',
                  lineHeight: '1.4',
                  margin: 0
                }}
              >
                {questionLabel}
              </h3>
            )}
          </div>
        </div>

        {/* No Data Message */}
        <div className="py-10 text-center text-sm text-brand-gray/60">
          No data available
        </div>
      </div>
    )
  }

  if (filteredProducts.length === 0) {
    return (
      <div className="w-full" style={{ paddingLeft: '2px', paddingBottom: '30px', width: '95%', margin: '0 auto' }}>
        {/* Header Row with Title (no question type badge) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '15px',
            marginBottom: '15px'
          }}
        >
          {/* Center: Title */}
          <div style={{ textAlign: 'center', maxWidth: '80%' }}>
            {questionLabel && (
              <h3
                className="text-sm font-semibold text-brand-gray"
                style={{
                  fontFamily: 'Space Grotesk, sans-serif',
                  wordWrap: 'break-word',
                  whiteSpace: 'normal',
                  lineHeight: '1.4',
                  margin: 0
                }}
              >
                {questionLabel}
              </h3>
            )}
          </div>
        </div>

        {/* No Data Message */}
        <div className="py-10 text-center text-sm text-brand-gray/60">
          No data available
        </div>
      </div>
    )
  }

  // Filter buttons JSX
  const filterButtons = (
      <div className="relative sentiment-heatmap-dropdown">
        <button
          onClick={() => setShowProductFilter(!showProductFilter)}
          className="flex items-center justify-center text-gray-600 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-900 active:scale-95"
          style={{
            height: '32px',
            width: '32px',
            backgroundColor: selectedProducts.length < sortedProducts.length ? 'rgba(58, 133, 24, 0.12)' : 'rgba(255, 255, 255, 0.7)',
            border: selectedProducts.length < sortedProducts.length ? '1px solid rgba(58, 133, 24, 0.25)' : '1px solid rgba(0, 0, 0, 0.08)',
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
              {orderedProducts.map((product, index) => {
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
                    <span style={{ fontSize: '11px', color: '#9ca3af', minWidth: '16px', textAlign: 'right' }}>{index + 1}</span>
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
  )

  // Get portal target element
  const filterPortalTarget = portalReady && questionId ? document.getElementById(`heatmap-filters-${questionId}`) : null

  return (
    <>
      {filterPortalTarget && sortedProducts.length >= 10 && createPortal(filterButtons, filterPortalTarget)}
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
            {questionLabel && (
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
                      setQuestionLabelInput(questionLabel)
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
                  {questionLabel}
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
            width: '100%',
            overflow: 'hidden'
          }}
        >
          {transposed ? (
            /* Transposed view: products as rows, Advocates/Detractors as columns */
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
                    minWidth: `${firstColumnWidth}px`,
                    maxWidth: `${firstColumnWidth}px`,
                    verticalAlign: 'middle',
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
                  </th>
                  <th style={{
                    backgroundColor: '#FFFFFF',
                    padding: '8px 12px',
                    textAlign: 'center',
                    fontSize: '14px',
                    fontWeight: 600,
                    verticalAlign: 'middle'
                  }}>
                    {!showSegment ? (
                      <span style={{ color: '#3A8518' }}>Advocates</span>
                    ) : (
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
                  </th>
                  <th style={{
                    backgroundColor: '#FFFFFF',
                    padding: '8px 12px',
                    textAlign: 'center',
                    fontSize: '14px',
                    fontWeight: 600,
                    verticalAlign: 'middle'
                  }}>
                    {!showSegment ? (
                      <span style={{ color: '#D4BA33' }}>Detractors</span>
                    ) : (
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
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(product => {
                  const advocateColor = getColor(product.advocatePercent, 'advocate', advocateMinMax.min, advocateMinMax.max)
                  const detractorColor = getColor(product.detractorPercent, 'detractor', detractorMinMax.min, detractorMinMax.max)
                  return (
                    <tr key={product.productName}>
                      <td style={{
                        backgroundColor: '#FFFFFF',
                        padding: cellPadding,
                        fontSize: '14px',
                        fontWeight: 600,
                        width: `${firstColumnWidth}px`,
                        minWidth: `${firstColumnWidth}px`,
                        maxWidth: `${firstColumnWidth}px`,
                        verticalAlign: 'middle',
                        textAlign: 'right',
                        position: 'relative'
                      }}>
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
                        {product.productName}
                      </td>
                      <td
                        style={{
                          backgroundColor: advocateColor.bg,
                          color: advocateColor.text,
                          padding: cellPadding,
                          textAlign: 'center',
                          fontSize: '14px',
                          fontWeight: advocateColor.text === '#FFFFFF' ? 'normal' : 600,
                          verticalAlign: 'middle'
                        }}
                      >
                        <span style={{ paddingRight: '2px' }}>{Math.round(product.advocatePercent)}%</span>
                      </td>
                      <td
                        style={{
                          backgroundColor: detractorColor.bg,
                          color: detractorColor.text,
                          padding: cellPadding,
                          textAlign: 'center',
                          fontSize: '14px',
                          fontWeight: detractorColor.text === '#FFFFFF' ? 'normal' : 600,
                          verticalAlign: 'middle'
                        }}
                      >
                        <span style={{ paddingRight: '2px' }}>{Math.round(product.detractorPercent)}%</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            /* Normal view: Advocates/Detractors as rows, products as columns */
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
                    minWidth: `${firstColumnWidth}px`,
                    maxWidth: `${firstColumnWidth}px`,
                    verticalAlign: 'middle',
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
                  </th>
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
                    padding: cellPadding,
                    fontSize: '14px',
                    fontWeight: 600,
                    width: `${firstColumnWidth}px`,
                    minWidth: `${firstColumnWidth}px`,
                    maxWidth: `${firstColumnWidth}px`,
                    verticalAlign: 'middle',
                    textAlign: 'left',
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
                    {!showSegment ? (
                      <span style={{ color: '#3A8518', fontSize: '12px', fontWeight: 600 }}>Advocates</span>
                    ) : (
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
                  </td>
                  {filteredProducts.map(product => {
                    const { bg, text } = getColor(product.advocatePercent, 'advocate', advocateMinMax.min, advocateMinMax.max)
                    return (
                      <td
                        key={product.productName}
                        style={{
                          backgroundColor: bg,
                          color: text,
                          padding: cellPadding,
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
                    padding: cellPadding,
                    fontSize: '14px',
                    fontWeight: 600,
                    width: `${firstColumnWidth}px`,
                    minWidth: `${firstColumnWidth}px`,
                    maxWidth: `${firstColumnWidth}px`,
                    verticalAlign: 'middle',
                    textAlign: 'left',
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
                    {!showSegment ? (
                      <span style={{ color: '#D4BA33', fontSize: '12px', fontWeight: 600 }}>Detractors</span>
                    ) : (
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
                  </td>
                  {filteredProducts.map(product => {
                    const { bg, text } = getColor(product.detractorPercent, 'detractor', detractorMinMax.min, detractorMinMax.max)
                    return (
                      <td
                        key={product.productName}
                        style={{
                          backgroundColor: bg,
                          color: text,
                          padding: cellPadding,
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
          )}
        </div>
      </div>
    </>
  )
})
