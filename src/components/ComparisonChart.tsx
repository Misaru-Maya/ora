import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  LabelList,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { LabelProps } from 'recharts'
import { customRound } from '../dataCalculations'
import type { GroupSeriesMeta, SeriesDataPoint } from '../dataCalculations'
import { getContrastTextColor } from '../utils'

const GROUP_COLORS = [
  '#3A8518', // green (1st segment)
  '#CED6DE', // light gray (2nd segment)
  '#E7CB38', // yellow (3rd segment)
  '#A5CF8E', // light green
  '#717F90', // gray
  '#F1E088', // light yellow
  '#DAEBD1', // pale green
  '#FAF5D7', // pale yellow
]

const LABEL_FONT_SIZE = 16
const LABEL_FONT_SIZE_MIN = 12
const LABEL_FONT_SIZE_MAX = 18
const HORIZONTAL_BAR_SIZE = Math.round(Math.max(LABEL_FONT_SIZE + 10, 36) * 0.95)
const VERTICAL_BAR_SIZE = Math.max(LABEL_FONT_SIZE + 10, 36)
const AXIS_LINE_STYLE = { stroke: '#000', strokeWidth: 1 }
const TICK_LINE_STYLE = { stroke: '#000', strokeWidth: 1 }

// Calculate dynamic font size based on bar dimensions
// For horizontal bars: scale based on bar height (thinner bars = smaller text)
// For vertical bars: scale based on bar width (narrower bars = smaller text)
const getDynamicFontSize = (dimension: number, isStacked: boolean = false): number => {
  // For stacked charts, use the segment dimension
  // For regular charts, use bar dimension
  const minDimension = isStacked ? 30 : 24
  const maxDimension = isStacked ? 80 : 50

  if (dimension <= minDimension) return LABEL_FONT_SIZE_MIN
  if (dimension >= maxDimension) return LABEL_FONT_SIZE_MAX

  // Linear interpolation between min and max font size
  const ratio = (dimension - minDimension) / (maxDimension - minDimension)
  return Math.round(LABEL_FONT_SIZE_MIN + ratio * (LABEL_FONT_SIZE_MAX - LABEL_FONT_SIZE_MIN))
}

const parseCoordinate = (value: string | number | undefined) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

// Value label renderer for horizontal charts: position to the right of bars
const HorizontalValueLabel: React.FC<LabelProps> = ({ x, y, width, height, value }) => {
  const originX = parseCoordinate(x)
  const originY = parseCoordinate(y)
  const barWidth = parseCoordinate(width)
  const barHeight = parseCoordinate(height)
  const numericValue = typeof value === 'number' ? value : Number(value)
  const fontSize = getDynamicFontSize(barHeight)
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return (
      <text
        x={originX + 4}
        y={originY + barHeight / 2}
        dy={3}
        fontSize={fontSize}
        fill="#111"
      >
        0%
      </text>
    )
  }
  const text = `${customRound(numericValue)}%`
  // Position to the right of the bar
  return (
    <text
      x={originX + barWidth + 6}
      y={originY + barHeight / 2}
      dy={3}
      fontSize={fontSize}
      fontWeight="600"
      fill="#111"
    >
      {text}
    </text>
  )
}

// Value label renderer for vertical charts: position on top of bars
const VerticalValueLabel: React.FC<LabelProps> = ({ x, y, width, value }) => {
  const originX = parseCoordinate(x)
  const originY = parseCoordinate(y)
  const barWidth = parseCoordinate(width)
  const numericValue = typeof value === 'number' ? value : Number(value)
  const fontSize = getDynamicFontSize(barWidth)
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return null
  }
  const text = `${customRound(numericValue)}%`
  return (
    <text
      x={originX + barWidth / 2}
      y={originY - 4}
      textAnchor="middle"
      fontSize={fontSize}
      fontWeight="600"
      fill="#111"
    >
      {text}
    </text>
  )
}

// Value label renderer for stacked horizontal bars: position in center of each segment
const StackedHorizontalValueLabel: React.FC<LabelProps & { fill?: string }> = ({ x, y, width, height, value, fill }) => {
  const originX = parseCoordinate(x)
  const originY = parseCoordinate(y)
  const barWidth = parseCoordinate(width)
  const barHeight = parseCoordinate(height)
  const numericValue = typeof value === 'number' ? value : Number(value)

  // Don't show labels for 0 or invalid values
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return null
  }

  const text = `${Math.round(numericValue)}%`
  const isSmall = numericValue < 3
  // For stacked horizontal, use bar width (segment width) for font size scaling
  const fontSize = getDynamicFontSize(barWidth, true)

  // For small values shown outside, always use black
  // For values shown inside, calculate optimal contrast color based on background
  const textColor = isSmall ? '#111' : getContrastTextColor(fill || '#FFFFFF')

  if (isSmall) {
    // Position small values above the segment
    return (
      <text
        x={originX + barWidth / 2}
        y={originY - 4}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="600"
        fill={textColor}
      >
        {text}
      </text>
    )
  }

  return (
    <text
      x={originX + barWidth / 2}
      y={originY + barHeight / 2}
      dy={3}
      textAnchor="middle"
      fontSize={fontSize}
      fontWeight="600"
      fill={textColor}
    >
      {text}
    </text>
  )
}

// Value label renderer for stacked vertical bars: position in center of each segment
const StackedVerticalValueLabel: React.FC<LabelProps & { fill?: string }> = ({ x, y, width, height, value, fill }) => {
  const originX = parseCoordinate(x)
  const originY = parseCoordinate(y)
  const barWidth = parseCoordinate(width)
  const barHeight = parseCoordinate(height)
  const numericValue = typeof value === 'number' ? value : Number(value)

  // Don't show labels for 0 or invalid values
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return null
  }

  const text = `${Math.round(numericValue)}%`
  const isSmall = numericValue < 3
  // For stacked vertical, use bar height (segment height) for font size scaling
  const fontSize = getDynamicFontSize(barHeight, true)

  // For small values shown outside, always use black
  // For values shown inside, calculate optimal contrast color based on background
  const textColor = isSmall ? '#111' : getContrastTextColor(fill || '#FFFFFF')

  if (isSmall) {
    // Position small values outside (above the segment)
    return (
      <text
        x={originX + barWidth / 2}
        y={originY - 4}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="600"
        fill={textColor}
      >
        {text}
      </text>
    )
  }

  return (
    <text
      x={originX + barWidth / 2}
      y={originY + barHeight / 2}
      dy={3}
      textAnchor="middle"
      fontSize={fontSize}
      fontWeight="600"
      fill={textColor}
    >
      {text}
    </text>
  )
}

// Custom X-axis tick with text wrapping (for vertical charts)
const _CustomXAxisTick: React.FC<any & { maxWidth?: number }> = (props) => {
  const { x, y, payload, maxWidth = 100 } = props
  const text = payload.value || ''
  const lineHeight = 14

  // Simple word wrapping
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  words.forEach((word: string) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    // Rough estimate: 7 pixels per character
    if (testLine.length * 7 > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  })
  if (currentLine) lines.push(currentLine)

  return (
    <g>
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={y + 8 + i * lineHeight}
          textAnchor="middle"
          fontSize={14}
          fill="#1f2833"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

// Editable Y-axis tick for horizontal charts
const EditableYAxisTick: React.FC<any & {
  editingOption: string | null
  setEditingOption: (option: string | null) => void
  editInput: string
  setEditInput: (value: string) => void
  onSave: (option: string, newLabel: string) => void
  data: SeriesDataPoint[]
  maxWidth?: number
}> = (props) => {
  const { x, y, payload, editingOption, setEditingOption, editInput, setEditInput, onSave, data, maxWidth = 150 } = props
  const text = payload.value || ''
  const inputRef = useRef<HTMLInputElement>(null)

  // Find the original option key for this label
  const dataPoint = data.find((d: SeriesDataPoint) => d.optionDisplay === text)
  const option = dataPoint?.option || text

  // Check if text has asterisk (statistical significance marker)
  const hasAsterisk = text.endsWith('*')
  const textWithoutAsterisk = hasAsterisk ? text.slice(0, -1) : text

  const isEditing = editingOption === option

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = () => {
    if (editInput.trim()) {
      // Remove any asterisks user might have added, then add back original asterisk if needed
      const cleanedInput = editInput.trim().replace(/\*+$/, '')
      const finalLabel = hasAsterisk ? `${cleanedInput}*` : cleanedInput
      if (finalLabel !== text) {
        onSave(option, cleanedInput) // Save without asterisk, it will be added by significance calculation
      }
    }
    setEditingOption(null)
  }

  // Word wrapping for long labels, respecting manual line breaks
  const lineHeight = 14
  const lines: string[] = []
  const charWidth = 7 // Rough estimate: 7 pixels per character

  // First split by newlines to preserve user's manual line breaks
  const manualLines = text.split('\n')

  manualLines.forEach((manualLine: string) => {
    const words = manualLine.split(' ')
    let currentLine = ''

    words.forEach((word: string) => {
      const testLine = currentLine ? `${currentLine} ${word}` : word

      // Check if word itself is too long for maxWidth
      if (word.length * charWidth > maxWidth) {
        // Push current line first if there's content
        if (currentLine) {
          lines.push(currentLine)
          currentLine = ''
        }
        // Force break the long word/phrase - break at natural points like commas or opening parens
        let remaining = word
        while (remaining.length * charWidth > maxWidth) {
          // Try to find a good break point (comma, opening paren, or just mid-word)
          const targetChars = Math.floor(maxWidth / charWidth)
          let breakPoint = targetChars

          // Look for comma or paren within the target range
          for (let i = targetChars; i > targetChars / 2; i--) {
            if (remaining[i] === ',' || remaining[i] === '(' || remaining[i] === ')') {
              breakPoint = i + 1
              break
            }
          }

          lines.push(remaining.slice(0, breakPoint))
          remaining = remaining.slice(breakPoint)
        }
        if (remaining) {
          currentLine = remaining
        }
      } else if (testLine.length * charWidth > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    })
    if (currentLine) lines.push(currentLine)
  })

  // Calculate actual text width based on the longest line
  const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b, '')
  const actualTextWidth = Math.max(longestLine.length * 8 + 20, 60) // 8px per char + padding, min 60px

  if (isEditing) {
    // Keep edit box within Y-axis area (left of bars)
    // Use maxWidth to constrain - this is the Y-axis width minus padding
    const editBoxWidth = Math.min(maxWidth + 15, x - 5) // Don't exceed Y-axis area
    const editBoxX = Math.max(5, x - editBoxWidth) // Stay within left edge

    return (
      <foreignObject x={editBoxX} y={y - 35} width={editBoxWidth} height={80}>
        <textarea
          ref={inputRef as any}
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
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            fontSize: '14px',
            padding: '6px 8px',
            border: '2px solid #3A8518',
            borderRadius: '3px',
            outline: 'none',
            backgroundColor: 'white',
            boxSizing: 'border-box',
            minHeight: '36px',
            resize: 'vertical',
            fontFamily: 'inherit',
            lineHeight: '1.4',
            cursor: 'text',
            userSelect: 'text'
          }}
        />
      </foreignObject>
    )
  }

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={() => {
        setEditingOption(option)
        setEditInput(textWithoutAsterisk) // Edit without asterisk
      }}
      onMouseEnter={(e) => {
        const textElements = e.currentTarget.querySelectorAll('text')
        textElements.forEach((el) => {
          el.style.fill = '#3A8518'
        })
      }}
      onMouseLeave={(e) => {
        const textElements = e.currentTarget.querySelectorAll('text')
        textElements.forEach((el) => {
          el.style.fill = '#1f2833'
        })
      }}
    >
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={y + (i - (lines.length - 1) / 2) * lineHeight}
          textAnchor="end"
          fontSize={14}
          fill="#1f2833"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

// Editable X-axis tick for vertical charts
const EditableXAxisTick: React.FC<any & {
  editingOption: string | null
  setEditingOption: (option: string | null) => void
  editInput: string
  setEditInput: (value: string) => void
  onSave: (option: string, newLabel: string) => void
  data: SeriesDataPoint[]
  maxWidth?: number
}> = (props) => {
  const { x, y, payload, editingOption, setEditingOption, editInput, setEditInput, onSave, data, maxWidth = 100 } = props
  const text = payload.value || ''
  const lineHeight = 14
  const inputRef = useRef<HTMLInputElement>(null)

  // Find the original option key for this label
  const dataPoint = data.find((d: SeriesDataPoint) => d.optionDisplay === text)
  const option = dataPoint?.option || text

  // Check if text has asterisk (statistical significance marker)
  const hasAsterisk = text.endsWith('*')
  const textWithoutAsterisk = hasAsterisk ? text.slice(0, -1) : text

  const isEditing = editingOption === option

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = () => {
    if (editInput.trim()) {
      // Remove any asterisks user might have added, then add back original asterisk if needed
      const cleanedInput = editInput.trim().replace(/\*+$/, '')
      const finalLabel = hasAsterisk ? `${cleanedInput}*` : cleanedInput
      if (finalLabel !== text) {
        onSave(option, cleanedInput) // Save without asterisk, it will be added by significance calculation
      }
    }
    setEditingOption(null)
  }

  if (isEditing) {
    const editWidth = Math.min(maxWidth * 1.5, 250) // Wider for editing
    return (
      <foreignObject x={x - editWidth / 2} y={y} width={editWidth} height={100}>
        <textarea
          ref={inputRef as any}
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
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            fontSize: '14px',
            padding: '6px 8px',
            border: '2px solid #3A8518',
            borderRadius: '3px',
            outline: 'none',
            backgroundColor: 'white',
            textAlign: 'center',
            boxSizing: 'border-box',
            minHeight: '36px',
            resize: 'vertical',
            fontFamily: 'inherit',
            lineHeight: '1.4',
            cursor: 'text',
            userSelect: 'text'
          }}
        />
      </foreignObject>
    )
  }

  // Word wrapping with mid-word breaking for very long words
  const lines: string[] = []
  const charWidth = 8 // Conservative estimate: 8px per character

  // Helper to break a word if it's too long for maxWidth
  const breakLongWord = (word: string): string[] => {
    const maxCharsPerLine = Math.floor(maxWidth / charWidth)
    if (word.length <= maxCharsPerLine) return [word]

    const parts: string[] = []
    let remaining = word
    while (remaining.length > maxCharsPerLine) {
      // Try to find a good break point (hyphen, underscore, or just force break)
      let breakPoint = maxCharsPerLine
      for (let i = maxCharsPerLine - 1; i > maxCharsPerLine / 2; i--) {
        if (remaining[i] === '-' || remaining[i] === '_') {
          breakPoint = i + 1
          break
        }
      }
      parts.push(remaining.slice(0, breakPoint))
      remaining = remaining.slice(breakPoint)
    }
    if (remaining) parts.push(remaining)
    return parts
  }

  // First split by newlines to preserve user's manual line breaks
  const manualLines = text.split('\n')

  manualLines.forEach((manualLine: string) => {
    const words = manualLine.split(' ')
    let currentLine = ''

    words.forEach((word: string) => {
      // First check if word itself is too long and needs breaking
      const wordWidth = word.length * charWidth
      if (wordWidth > maxWidth) {
        // Push current line if exists
        if (currentLine) {
          lines.push(currentLine)
          currentLine = ''
        }
        // Break the long word and add each part
        const wordParts = breakLongWord(word)
        wordParts.forEach((part, i) => {
          if (i < wordParts.length - 1) {
            lines.push(part)
          } else {
            currentLine = part // Last part becomes current line
          }
        })
      } else {
        const testLine = currentLine ? `${currentLine} ${word}` : word
        if (testLine.length * charWidth > maxWidth && currentLine) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = testLine
        }
      }
    })
    if (currentLine) lines.push(currentLine)
  })

  return (
    <g
      onClick={() => {
        setEditingOption(option)
        setEditInput(textWithoutAsterisk) // Edit without asterisk
      }}
      style={{ cursor: 'pointer' }}
      onMouseEnter={(e) => {
        const textElements = e.currentTarget.querySelectorAll('text')
        textElements.forEach((el) => {
          el.style.fill = '#3A8518'
        })
      }}
      onMouseLeave={(e) => {
        const textElements = e.currentTarget.querySelectorAll('text')
        textElements.forEach((el) => {
          el.style.fill = '#1f2833'
        })
      }}
    >
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={y + 8 + i * lineHeight}
          textAnchor="middle"
          fontSize={14}
          fill="#1f2833"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

interface ComparisonChartProps {
  data: SeriesDataPoint[]
  groups: GroupSeriesMeta[]
  orientation?: 'horizontal' | 'vertical'
  questionLabel?: string
  stacked?: boolean
  colors?: string[]
  optionLabels?: Record<string, string>
  onSaveOptionLabel?: (option: string, newLabel: string) => void
  onSaveQuestionLabel?: (newLabel: string) => void
  questionTypeBadge?: React.ReactNode
  heightOffset?: number
  showSegment?: boolean
  sentimentType?: 'advocates' | 'detractors' | null
}

const CustomTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload as SeriesDataPoint

  // Find the highest percentage group for highlighting
  const maxPercent = Math.max(...row.groupSummaries.map(s => s.percent))

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        padding: '16px',
        minWidth: '220px',
        maxWidth: '320px'
      }}
    >
      {/* Title */}
      <div style={{
        fontSize: '14px',
        fontWeight: 600,
        color: '#374151',
        marginBottom: '12px',
        paddingBottom: '10px',
        borderBottom: '1px solid #E5E7EB',
        whiteSpace: 'pre-wrap',
        lineHeight: '1.4'
      }}>
        {row.optionDisplay}
      </div>

      {/* Group Results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {row.groupSummaries.map(summary => {
          const isHighest = summary.percent === maxPercent && row.groupSummaries.length > 1
          return (
            <div
              key={summary.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 10px',
                backgroundColor: isHighest ? '#F0FDF4' : '#F9FAFB',
                borderRadius: '8px',
                gap: '12px'
              }}
            >
              <span style={{
                fontSize: '13px',
                color: '#374151',
                fontWeight: isHighest ? 600 : 400
              }}>
                {summary.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: isHighest ? '#3A8518' : '#374151'
                }}>
                  {customRound(summary.percent)}%
                </span>
                <span style={{
                  fontSize: '11px',
                  color: '#9CA3AF'
                }}>
                  ({summary.count}/{summary.denominator})
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Statistical Significance */}
      {row.significance.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #E5E7EB' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px'
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280' }}>
              Statistical Comparison
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[...row.significance].sort((a, b) => (b.significant ? 1 : 0) - (a.significant ? 1 : 0)).map(sig => (
              <div
                key={sig.pair.join('-')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  padding: '6px 8px',
                  backgroundColor: sig.significant ? '#FEF3C7' : '#F9FAFB',
                  borderRadius: '6px'
                }}
              >
                <span style={{ color: '#374151' }}>
                  {sig.pair[0]} vs {sig.pair[1]}
                </span>
                <span style={{
                  fontWeight: 600,
                  color: sig.significant ? '#D97706' : '#9CA3AF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  {sig.significant ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                      Stat Sig
                    </>
                  ) : (
                    'Not Sig'
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const ComparisonChart: React.FC<ComparisonChartProps> = ({
  data,
  groups,
  orientation = 'horizontal',
  questionLabel,
  stacked = false,
  colors = GROUP_COLORS,
  optionLabels: _optionLabels = {},
  onSaveOptionLabel,
  onSaveQuestionLabel,
  questionTypeBadge,
  heightOffset = 0,
  showSegment = true,
  sentimentType = null
}) => {
  const isHorizontal = orientation === 'horizontal'
  const [editingOption, setEditingOption] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [editingLegend, setEditingLegend] = useState<string | null>(null)
  const [legendEditInput, setLegendEditInput] = useState('')
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')

  // Click-based tooltip state
  const [clickedData, setClickedData] = useState<SeriesDataPoint | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Dragging state for tooltip
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const chartContainerRef = useRef<HTMLDivElement>(null)

  // Title drag state
  const [titleOffset, setTitleOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDraggingTitle, setIsDraggingTitle] = useState(false)
  const titleDragStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const titleStartOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Chart drag state
  const [chartOffset, setChartOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDraggingChart, setIsDraggingChart] = useState(false)
  const chartDragStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const chartStartOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Y-axis resize state (for horizontal bar charts)
  const [yAxisWidth, setYAxisWidth] = useState<number | null>(null)
  const [isResizingYAxis, setIsResizingYAxis] = useState(false)
  const yAxisResizeStartX = useRef<number>(0)
  const yAxisResizeStartWidth = useRef<number>(0)

  // Title drag handlers
  const handleTitleMouseDown = (e: React.MouseEvent) => {
    if (editingQuestionLabel) return
    e.preventDefault()
    setIsDraggingTitle(true)
    titleDragStartPos.current = { x: e.clientX, y: e.clientY }
    titleStartOffset.current = { ...titleOffset }
  }

  useEffect(() => {
    if (!isDraggingTitle) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - titleDragStartPos.current.x
      const deltaY = e.clientY - titleDragStartPos.current.y
      setTitleOffset({
        x: titleStartOffset.current.x + deltaX,
        y: titleStartOffset.current.y + deltaY
      })
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

  // Chart drag handlers
  const handleChartMouseDown = (e: React.MouseEvent) => {
    // Only start drag if clicking directly on the chart container, not on bars
    if ((e.target as HTMLElement).closest('.recharts-bar-rectangle')) return
    e.preventDefault()
    setIsDraggingChart(true)
    chartDragStartPos.current = { x: e.clientX, y: e.clientY }
    chartStartOffset.current = { ...chartOffset }
  }

  useEffect(() => {
    if (!isDraggingChart) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - chartDragStartPos.current.x
      const deltaY = e.clientY - chartDragStartPos.current.y
      setChartOffset({
        x: chartStartOffset.current.x + deltaX,
        y: chartStartOffset.current.y + deltaY
      })
    }

    const handleMouseUp = () => {
      setIsDraggingChart(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingChart])

  // Y-axis resize handlers (for horizontal bar charts)
  const handleYAxisResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingYAxis(true)
    yAxisResizeStartX.current = e.clientX
    yAxisResizeStartWidth.current = yAxisWidth ?? 200 // default width
  }

  useEffect(() => {
    if (!isResizingYAxis) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - yAxisResizeStartX.current
      const newWidth = Math.max(100, Math.min(400, yAxisResizeStartWidth.current + delta))
      setYAxisWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizingYAxis(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingYAxis])

  // Handle bar click to show tooltip
  const handleBarClick = useCallback((dataPoint: SeriesDataPoint, event: React.MouseEvent) => {
    event.stopPropagation()

    // Position tooltip near the clicked bar
    // Use the click position but adjust to ensure it doesn't go off-screen
    const clickX = event.clientX
    const clickY = event.clientY

    // Calculate position: to the right of click if there's room, otherwise to the left
    const tooltipWidth = 300
    const tooltipHeight = 350 // Approximate max height
    const padding = 15

    let x = clickX + padding
    let y = clickY + padding

    // If tooltip would go off right edge, position to the left of click
    if (x + tooltipWidth > window.innerWidth - padding) {
      x = clickX - tooltipWidth - padding
    }

    // If tooltip would go off bottom, position above the click
    if (y + tooltipHeight > window.innerHeight - padding) {
      y = Math.max(padding, window.innerHeight - tooltipHeight - padding)
    }

    // Ensure x doesn't go negative
    if (x < padding) {
      x = padding
    }

    setTooltipPosition({ x, y })
    setClickedData(dataPoint)
  }, [])

  // Close tooltip when clicking outside (but not when dragging)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDragging) return
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setClickedData(null)
        setTooltipPosition(null)
      }
    }

    if (clickedData) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [clickedData, isDragging])

  // Handle drag start on tooltip header
  const handleDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!tooltipPosition) return

    setIsDragging(true)
    setDragOffset({
      x: event.clientX - tooltipPosition.x,
      y: event.clientY - tooltipPosition.y
    })
  }, [tooltipPosition])

  // Handle mouse move during drag
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (event: MouseEvent) => {
      setTooltipPosition({
        x: event.clientX - dragOffset.x,
        y: event.clientY - dragOffset.y
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, dragOffset])

  // Dynamic chart dimensions based on number of answer options
  // Calculate dynamic barCategoryGap: gap between answer option groups should be at least 50% of total bar cluster height
  // MINIMUM: 10px gap between different answer options (enforced)
  const MIN_CATEGORY_GAP = 10
  const calculateBarCategoryGap = (baseBarSize: number, numGroups: number, isStackedChart: boolean) => {
    if (isStackedChart) {
      // Stacked charts have single bars - gap should be at least 50% of bar height, minimum 10px
      return Math.max(MIN_CATEGORY_GAP, 24, Math.ceil(baseBarSize * 0.5))
    }
    // For grouped charts: total cluster width = numGroups * barSize (no gap between bars in same group)
    const totalClusterWidth = numGroups * baseBarSize
    // Gap between different answer options should be at least 50% of cluster width, minimum 10px
    const minGap = Math.max(MIN_CATEGORY_GAP, 24, Math.ceil(totalClusterWidth * 0.5))
    return minGap
  }

  const { chartHeight, barCategoryGap, barSize } = isHorizontal
    ? (() => {
        // For horizontal charts: calculate height and bar size dynamically
        // Rule: gap between bars should be at least 50% of bar height
        // Math: if gap = 0.5 * bar, then rowSpace = bar + gap = 1.5 * bar
        // Therefore: bar = rowSpace / 1.5, gap = rowSpace / 3
        const numBarsPerOption = stacked ? 1 : groups.length

        // Calculate base height with proper spacing
        const baseBarSize = HORIZONTAL_BAR_SIZE
        const baseGapPerBar = baseBarSize * 0.5 // 50% of bar height
        const baseRowHeight = (baseBarSize * numBarsPerOption) + baseGapPerBar
        const baseHeight = Math.max(200, data.length * baseRowHeight)
        const totalHeight = baseHeight + heightOffset

        // Calculate space per option row
        const spacePerOption = totalHeight / data.length

        // Calculate bar size to maintain 50% gap ratio
        // rowSpace = (barSize * numBars) + gap, where gap = 0.5 * barSize (for stacked) or 0.5 * cluster
        // For stacked: rowSpace = barSize + 0.5*barSize = 1.5*barSize → barSize = rowSpace/1.5
        // For grouped: rowSpace = cluster + 0.5*cluster = 1.5*cluster → cluster = rowSpace/1.5
        const clusterHeight = spacePerOption / 1.5
        const dynamicBarSize = Math.min(36, Math.max(16, clusterHeight / numBarsPerOption)) // min 16px, max 36px

        // Gap is 50% of the actual bar cluster height, minimum 10px enforced
        // For stacked charts, use larger minimum gap since bars are visually denser
        const actualClusterHeight = dynamicBarSize * numBarsPerOption
        const stackedMinGap = stacked ? Math.max(24, dynamicBarSize * 0.75) : 16 // Stacked needs 75% gap minimum
        const dynamicGap = Math.max(MIN_CATEGORY_GAP, stackedMinGap, Math.ceil(actualClusterHeight * 0.5))

        return {
          chartHeight: totalHeight,
          barCategoryGap: dynamicGap,
          barSize: dynamicBarSize,
        }
      })()
    : {
        // For vertical charts: use fixed bar size (no dynamic width changes)
        chartHeight: 320 + heightOffset,
        barCategoryGap: calculateBarCategoryGap(VERTICAL_BAR_SIZE, groups.length, stacked),
        barSize: VERTICAL_BAR_SIZE,
      }

  // Calculate dynamic label widths based on chart layout
  // For vertical charts: maximize label width while maintaining 20px gap between labels
  const calculateMaxLabelWidth = () => {
    if (isHorizontal) {
      // For horizontal charts, scale based on number of groups (more groups = narrower bars = more space for labels)
      const baseWidth = 190
      const gapValue = typeof barCategoryGap === 'number' ? barCategoryGap : 40
      const scaleFactor = Math.max(1, Math.min(1.8, 1 + (gapValue - 20) / 40))
      return Math.floor(baseWidth * scaleFactor)
    } else {
      // For vertical charts, calculate maximum label width while maintaining minimum 5px gap
      // Use conservative estimate: container is ~850px wide after margins and padding
      // (accounting for right: 48px, left: 48px, plus some buffer for chart internals)
      const estimatedChartWidth = 850 - 48 - 48 // = 754px usable for labels
      const minGapBetweenLabels = 5 // minimum 5px gap between labels (enforced)
      // Scale preferred gap based on number of options - more options need tighter spacing
      const preferredGap = data.length <= 4 ? 30 : data.length <= 6 ? 20 : 10
      const gapBetweenLabels = Math.max(minGapBetweenLabels, preferredGap)

      // Total gaps = (number of options - 1) * gap
      const totalGaps = (data.length - 1) * gapBetweenLabels

      // Available width for all labels = chart width - total gaps
      const availableWidthForLabels = estimatedChartWidth - totalGaps

      // Max width per label
      const maxWidthPerLabel = availableWidthForLabels / data.length

      // Ensure labels don't get too narrow (min 50px) or too wide (max 250px)
      return Math.floor(Math.max(50, Math.min(250, maxWidthPerLabel)))
    }
  }

  const maxLabelWidth = calculateMaxLabelWidth()

  // Calculate dynamic height for X-axis based on maximum lines needed
  const calculateMaxLines = (text: string, maxWidth: number): number => {
    const charWidth = 8 // Match the charWidth used in EditableXAxisTick
    const maxCharsPerLine = Math.floor(maxWidth / charWidth)
    const words = text.split(' ')
    let lines = 0
    let currentLine = ''

    words.forEach((word: string) => {
      // Account for long words that will be broken
      if (word.length > maxCharsPerLine) {
        if (currentLine) {
          lines++
          currentLine = ''
        }
        // Count how many lines the broken word will take
        lines += Math.ceil(word.length / maxCharsPerLine)
        return
      }

      const testLine = currentLine ? `${currentLine} ${word}` : word
      if (testLine.length * charWidth > maxWidth && currentLine) {
        lines++
        currentLine = word
      } else {
        currentLine = testLine
      }
    })
    if (currentLine) lines++
    return lines
  }

  const maxLinesNeeded = !isHorizontal
    ? Math.max(...data.map(d => calculateMaxLines(d.optionDisplay, maxLabelWidth)), 3)
    : 3 // Default for horizontal

  // Calculate height for X-axis based on number of wrapped lines needed
  const xAxisHeight = !isHorizontal
    ? Math.max(80, 12 + maxLinesNeeded * 16 + 10)
    : 70

  // Always show legend when there are groups to display
  const showLegend = groups.length > 0
  // Calculate dynamic Y-axis width based on actual label text lengths (for horizontal charts)
  const calculateDynamicAxisWidth = () => {
    if (!isHorizontal || data.length === 0) return 200

    // Find the longest label text
    const longestLabel = data.reduce((longest, d) => {
      const label = d.optionDisplay || ''
      return label.length > longest.length ? label : longest
    }, '')

    // Estimate width: ~8px per character + padding
    // Account for word wrapping - if label has multiple words, it might wrap
    const charWidth = 8
    const padding = 20
    const maxCharsPerLine = 40 // Allow longer lines for wider Y-axis

    // Calculate based on longest line after potential wrapping
    const words = longestLabel.split(' ')
    let longestLineLength = 0
    let currentLineLength = 0

    words.forEach(word => {
      if (currentLineLength + word.length + 1 > maxCharsPerLine && currentLineLength > 0) {
        longestLineLength = Math.max(longestLineLength, currentLineLength)
        currentLineLength = word.length
      } else {
        currentLineLength += (currentLineLength > 0 ? 1 : 0) + word.length
      }
    })
    longestLineLength = Math.max(longestLineLength, currentLineLength)

    const estimatedWidth = longestLineLength * charWidth + padding

    // Clamp between reasonable min (80px) and max (450px)
    // Allow wider labels for better readability of long answer options
    return Math.max(80, Math.min(450, estimatedWidth))
  }

  const defaultAxisWidth = calculateDynamicAxisWidth()
  const horizontalAxisWidth = yAxisWidth ?? defaultAxisWidth // Use resized width or default
  const legendOffset = 40
  const horizontalLegendAdjustment = 70
  const _legendPaddingLeft =
    (isHorizontal ? horizontalAxisWidth : 0) + legendOffset - (isHorizontal ? horizontalLegendAdjustment : 0)

  // Render the legend content (reusable for header row)
  const renderLegendContent = () => {
    if (!showLegend) return null

    if (stacked) {
      // Stacked chart legend
      // Note: Using marginRight instead of columnGap for better html2canvas compatibility
      return (
        <div className="flex flex-wrap items-center" style={{ justifyContent: 'flex-start' }}>
          {groups.map((group, index) => {
            const isEditing = editingLegend === group.key
            const hasAsterisk = group.label.endsWith('*')
            const labelWithoutAsterisk = hasAsterisk ? group.label.slice(0, -1) : group.label

            const handleSave = () => {
              if (legendEditInput.trim() && onSaveOptionLabel) {
                const cleanedInput = legendEditInput.trim().replace(/\*+$/, '')
                if (cleanedInput !== labelWithoutAsterisk) {
                  onSaveOptionLabel(group.key, cleanedInput)
                }
              }
              setEditingLegend(null)
            }

            return (
              <span key={group.key} className="inline-flex items-center text-xs font-semibold text-brand-gray" style={{ marginRight: '16px', marginBottom: '8px' }}>
                <span
                  className="inline-block h-3 w-6"
                  style={{
                    backgroundColor: colors[index % colors.length],
                    minWidth: '16px',
                    minHeight: '12px',
                    borderRadius: '3px',
                    marginRight: '5px'
                  }}
                />
                {isEditing ? (
                  <textarea
                    autoFocus
                    value={legendEditInput}
                    onChange={(e) => setLegendEditInput(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSave()
                      }
                      if (e.key === 'Escape') setEditingLegend(null)
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontSize: '12px',
                      padding: '2px 4px',
                      border: '2px solid #3A8518',
                      borderRadius: '3px',
                      outline: 'none',
                      backgroundColor: 'white',
                      minWidth: '80px',
                      fontWeight: 600,
                      minHeight: '24px',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      lineHeight: '1.4',
                      cursor: 'text',
                      userSelect: 'text'
                    }}
                  />
                ) : (
                  <span
                    style={{ cursor: onSaveOptionLabel ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (onSaveOptionLabel) {
                        setEditingLegend(group.key)
                        setLegendEditInput(labelWithoutAsterisk)
                      }
                    }}
                    onMouseEnter={(e) => { if (onSaveOptionLabel) e.currentTarget.style.color = '#3A8518' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '' }}
                  >
                    {group.label}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      )
    } else {
      // Regular bar chart legend
      // Note: Using marginRight instead of columnGap for better html2canvas compatibility
      return (
        <div className="flex flex-wrap items-center" style={{ justifyContent: 'flex-start' }}>
          {groups.map((group, index) => {
            const isEditing = editingLegend === group.key
            const hasAsterisk = group.label.endsWith('*')
            const labelWithoutAsterisk = hasAsterisk ? group.label.slice(0, -1) : group.label

            const handleSave = () => {
              if (legendEditInput.trim() && onSaveOptionLabel) {
                const cleanedInput = legendEditInput.trim().replace(/\*+$/, '')
                if (cleanedInput !== labelWithoutAsterisk) {
                  onSaveOptionLabel(group.key, cleanedInput)
                }
              }
              setEditingLegend(null)
            }

            return (
              <span key={group.key} className="inline-flex items-center text-xs font-semibold text-brand-gray" style={{ marginRight: '16px', marginBottom: '8px' }}>
                <span
                  className="inline-block h-3 w-6"
                  style={{
                    backgroundColor: colors[index % colors.length],
                    minWidth: '16px',
                    minHeight: '12px',
                    borderRadius: '3px',
                    marginRight: '5px'
                  }}
                />
                {isEditing ? (
                  <textarea
                    autoFocus
                    value={legendEditInput}
                    onChange={(e) => setLegendEditInput(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSave()
                      }
                      if (e.key === 'Escape') setEditingLegend(null)
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontSize: '12px',
                      padding: '2px 4px',
                      border: '2px solid #3A8518',
                      borderRadius: '3px',
                      outline: 'none',
                      backgroundColor: 'white',
                      minWidth: '80px',
                      fontWeight: 600,
                      minHeight: '24px',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      lineHeight: '1.4',
                      cursor: 'text',
                      userSelect: 'text'
                    }}
                  />
                ) : (
                  <span
                    style={{ cursor: onSaveOptionLabel ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (onSaveOptionLabel) {
                        setEditingLegend(group.key)
                        setLegendEditInput(labelWithoutAsterisk)
                      }
                    }}
                    onMouseEnter={(e) => { if (onSaveOptionLabel) e.currentTarget.style.color = '#3A8518' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '' }}
                  >
                    {group.label}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      )
    }
  }

  return (
    <div ref={chartContainerRef} className="w-full bg-white" style={{ paddingBottom: 0, position: 'relative' }}>
      {/* Header: Title on top, Legend below - both left-aligned from Y-axis */}
      <div
        onMouseDown={handleTitleMouseDown}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          marginTop: '15px',
          marginBottom: isHorizontal ? '20px' : '30px',
          // Left margin aligns with Y-axis (horizontalAxisWidth for horizontal charts)
          marginLeft: isHorizontal ? `${horizontalAxisWidth}px` : '48px',
          marginRight: '48px',
          gap: '8px',
          transform: `translate(${titleOffset.x}px, ${titleOffset.y}px)`,
          cursor: isDraggingTitle ? 'grabbing' : 'grab',
          userSelect: 'none',
          transition: isDraggingTitle ? 'none' : 'transform 0.1s ease-out',
          position: 'relative',
          zIndex: 20
        }}
      >
        {/* Title Row with Badge on the right */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', gap: '16px' }}>
          {/* Left: Title - left-aligned, can grow */}
          <div
            style={{
              flex: '1 1 auto',
              textAlign: 'left',
              minWidth: 0
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
                    textAlign: 'left',
                    resize: 'vertical',
                    minHeight: '40px',
                    lineHeight: '1.4',
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
                    cursor: onSaveQuestionLabel ? 'pointer' : 'default'
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
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
              )
            )}
          </div>

          {/* Right: Segment Card + Question Type Badge */}
          <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
            {showSegment && sentimentType === 'advocates' && (
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
            {showSegment && sentimentType === 'detractors' && (
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
        </div>
        {/* Legend below title - left-aligned */}
        <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
          {renderLegendContent()}
        </div>
      </div>

      {/* Legacy legend section - now handled in header row, keeping for stacked charts that need below-title legend */}
      {false && showLegend && (
        stacked ? (
          // Horizontal legend for stacked charts
          <div
            className="text-xs font-semibold text-brand-gray"
            style={{
              marginBottom: '15px',
              marginLeft: isHorizontal ? `${horizontalAxisWidth}px` : '48px',
              marginRight: isHorizontal ? '60px' : '48px'
            }}
          >
            <div className="flex flex-wrap items-center gap-y-2" style={{ columnGap: '24px' }}>
              {groups.map((group, index) => {
                const isEditing = editingLegend === group.key
                const hasAsterisk = group.label.endsWith('*')
                const labelWithoutAsterisk = hasAsterisk ? group.label.slice(0, -1) : group.label

                const handleSave = () => {
                  if (legendEditInput.trim() && onSaveOptionLabel) {
                    const cleanedInput = legendEditInput.trim().replace(/\*+$/, '')
                    if (cleanedInput !== labelWithoutAsterisk) {
                      onSaveOptionLabel(group.key, cleanedInput)
                    }
                  }
                  setEditingLegend(null)
                }

                return (
                <span key={group.key} className="inline-flex items-center" style={{ gap: '5px' }}>
                  <span
                    className="inline-block h-3 w-10"
                    style={{
                      backgroundColor: colors[index % colors.length],
                      minWidth: '24px',
                      minHeight: '12px',
                      borderRadius: '3px'
                    }}
                  />
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={legendEditInput}
                      onChange={(e) => setLegendEditInput(e.target.value)}
                      onBlur={handleSave}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSave()
                        }
                        if (e.key === 'Escape') setEditingLegend(null)
                      }}
                      style={{
                        fontSize: '14px',
                        padding: '4px 6px',
                        border: '2px solid #3A8518',
                        borderRadius: '3px',
                        outline: 'none',
                        backgroundColor: 'white',
                        minWidth: '150px',
                        fontWeight: 600,
                        minHeight: '36px',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        lineHeight: '1.4'
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        cursor: onSaveOptionLabel ? 'pointer' : 'default'
                      }}
                      onClick={() => {
                        if (onSaveOptionLabel) {
                          setEditingLegend(group.key)
                          setLegendEditInput(labelWithoutAsterisk)
                        }
                      }}
                      onMouseEnter={(e) => {
                        if (onSaveOptionLabel) {
                          e.currentTarget.style.color = '#3A8518'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = ''
                      }}
                    >
                      {group.label}
                    </span>
                  )}
                </span>
                )
              })}
            </div>
          </div>
        ) : (
          // Horizontal legend for regular charts
          <div
            className="text-xs font-semibold text-brand-gray"
            style={{
              marginBottom: '15px',
              marginLeft: isHorizontal ? `${horizontalAxisWidth}px` : '48px',
              marginRight: isHorizontal ? '60px' : '48px'
            }}
          >
            <div className="flex flex-wrap items-center gap-y-2" style={{ columnGap: '24px' }}>
              {groups.map((group, index) => (
                <span key={group.key} className="inline-flex items-center" style={{ gap: '5px' }}>
                  <span
                    className="inline-block h-3 w-10"
                    style={{
                      backgroundColor: colors[index % colors.length],
                      minWidth: '24px',
                      minHeight: '12px',
                      borderRadius: '3px'
                    }}
                  />
                  <span>{group.label}</span>
                </span>
              ))}
            </div>
          </div>
        )
      )}
      <div
        onMouseDown={handleChartMouseDown}
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          transform: `translate(${chartOffset.x}px, ${chartOffset.y}px)`,
          cursor: isDraggingChart ? 'grabbing' : 'grab',
          transition: isDraggingChart ? 'none' : 'transform 0.1s ease-out',
          position: 'relative',
          zIndex: 10
        }}
      >
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout={isHorizontal ? "vertical" : "horizontal"}
          barCategoryGap={barCategoryGap}
          barGap={0}
          margin={isHorizontal
            ? { top: 20, right: 20, bottom: 15, left: 0 }
            : { top: 0, right: 48, bottom: 0, left: 0 }
          }
        >
          {isHorizontal ? (
            <>
              <XAxis
                type="number"
                domain={[0, 'dataMax + 2']}
                tick={false}
                axisLine={AXIS_LINE_STYLE}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="optionDisplay"
                width={horizontalAxisWidth}
                tick={(props) => (
                  <EditableYAxisTick
                    {...props}
                    editingOption={editingOption}
                    setEditingOption={setEditingOption}
                    editInput={editInput}
                    setEditInput={setEditInput}
                    onSave={onSaveOptionLabel || (() => {})}
                    data={data}
                    maxWidth={horizontalAxisWidth - 20}
                  />
                )}
                axisLine={AXIS_LINE_STYLE}
                tickLine={TICK_LINE_STYLE}
              />
            </>
          ) : (
            <>
              <XAxis
                type="category"
                dataKey="optionDisplay"
                height={xAxisHeight}
                tick={(props) => (
                  <EditableXAxisTick
                    {...props}
                    editingOption={editingOption}
                    setEditingOption={setEditingOption}
                    editInput={editInput}
                    setEditInput={setEditInput}
                    onSave={onSaveOptionLabel || (() => {})}
                    data={data}
                    maxWidth={maxLabelWidth}
                  />
                )}
                axisLine={AXIS_LINE_STYLE}
                tickLine={false}
                interval={0}
              />
              <YAxis
                type="number"
                domain={stacked ? [0, 100] : [0, 'dataMax + 10']}
                tick={false}
                axisLine={AXIS_LINE_STYLE}
                tickLine={false}
              />
            </>
          )}
          {groups.map((group, index) => {
            const color = colors[index % colors.length]
            return (
              <Bar
                key={group.key}
                dataKey={group.key}
                name={group.label}
                fill={color}
                radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                {...(barSize !== undefined && { barSize })}
                stackId={stacked ? 'stack' : undefined}
                isAnimationActive={false}
                style={{ cursor: 'pointer' }}
                onClick={(barData: any, _index: number, event: React.MouseEvent) => {
                  if (barData && barData.payload) {
                    handleBarClick(barData.payload as SeriesDataPoint, event)
                  }
                }}
              >
                {data.map((entry, entryIndex) => (
                  <Cell key={`cell-${entryIndex}`} cursor="pointer" />
                ))}
                {stacked ? (
                  <LabelList
                    dataKey={group.key}
                    content={(props) => isHorizontal
                      ? <StackedHorizontalValueLabel {...props} fill={color} />
                      : <StackedVerticalValueLabel {...props} fill={color} />
                    }
                  />
                ) : (
                  <LabelList
                    dataKey={group.key}
                    content={isHorizontal ? <HorizontalValueLabel /> : <VerticalValueLabel />}
                  />
                )}
              </Bar>
            )
          })}
        </BarChart>
      </ResponsiveContainer>
      {/* Y-axis resize handle for horizontal bar charts */}
      {isHorizontal && (
        <div
          onMouseDown={handleYAxisResizeStart}
          style={{
            position: 'absolute',
            left: horizontalAxisWidth - 3,
            top: 25,
            bottom: 0,
            width: '6px',
            cursor: 'col-resize',
            backgroundColor: isResizingYAxis ? 'rgba(58, 133, 24, 0.3)' : 'transparent',
            transition: 'background-color 0.15s ease',
            zIndex: 20
          }}
          onMouseEnter={(e) => {
            if (!isResizingYAxis) {
              e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.15)'
            }
          }}
          onMouseLeave={(e) => {
            if (!isResizingYAxis) {
              e.currentTarget.style.backgroundColor = 'transparent'
            }
          }}
        />
      )}
      </div>

      {/* Click-based Tooltip Popup - rendered via portal to ensure it's above all content */}
      {clickedData && tooltipPosition && createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            zIndex: 99999,
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
            minWidth: '220px',
            maxWidth: '320px',
            overflow: 'hidden'
          }}
        >
          {/* Draggable Header */}
          <div
            onMouseDown={handleDragStart}
            style={{
              padding: '12px 16px',
              paddingRight: '36px',
              backgroundColor: '#F9FAFB',
              borderBottom: '1px solid #E5E7EB',
              cursor: isDragging ? 'grabbing' : 'grab',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {/* Drag handle icon */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round">
              <circle cx="9" cy="5" r="1" fill="#9CA3AF" />
              <circle cx="9" cy="12" r="1" fill="#9CA3AF" />
              <circle cx="9" cy="19" r="1" fill="#9CA3AF" />
              <circle cx="15" cy="5" r="1" fill="#9CA3AF" />
              <circle cx="15" cy="12" r="1" fill="#9CA3AF" />
              <circle cx="15" cy="19" r="1" fill="#9CA3AF" />
            </svg>
            {/* Title */}
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#374151',
              whiteSpace: 'pre-wrap',
              lineHeight: '1.4',
              flex: 1
            }}>
              {clickedData.optionDisplay}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={() => {
              setClickedData(null)
              setTooltipPosition(null)
            }}
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              color: '#9CA3AF',
              fontSize: '16px',
              lineHeight: 1
            }}
            aria-label="Close"
          >
            ×
          </button>

          {/* Card Content */}
          <div style={{ padding: '16px' }}>

          {/* Group Results */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(() => {
              const maxPercent = Math.max(...clickedData.groupSummaries.map(s => s.percent))
              return clickedData.groupSummaries.map((summary, idx) => {
                const isHighest = summary.percent === maxPercent && maxPercent > 0
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      backgroundColor: isHighest ? '#F0FDF4' : '#F9FAFB',
                      borderRadius: '8px',
                      border: isHighest ? '1px solid #BBF7D0' : '1px solid transparent'
                    }}
                  >
                    <span style={{ fontSize: '13px', color: '#374151', fontWeight: 500 }}>
                      {summary.label}
                    </span>
                    <span style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: isHighest ? '#166534' : '#374151'
                    }}>
                      {customRound(summary.percent)}% <span style={{ fontSize: '11px', fontWeight: 400, color: '#9CA3AF' }}>({summary.count}/{summary.denominator})</span>
                    </span>
                  </div>
                )
              })
            })()}
          </div>

          {/* Statistical Comparison */}
          {clickedData.significance && clickedData.significance.length > 0 && (
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #E5E7EB' }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#6B7280',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Statistical Comparison
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[...clickedData.significance].sort((a, b) => (b.significant ? 1 : 0) - (a.significant ? 1 : 0)).map((sig, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      backgroundColor: sig.significant ? '#FFFBEB' : '#F9FAFB',
                      borderRadius: '6px',
                      border: sig.significant ? '1px solid #FDE68A' : '1px solid #E5E7EB'
                    }}
                  >
                    <span style={{ fontSize: '12px', color: '#374151' }}>
                      {sig.pair[0]} vs {sig.pair[1]}
                    </span>
                    <span style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: sig.significant ? '#D97706' : '#9CA3AF',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {sig.significant ? (
                        <>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                          </svg>
                          Stat Sig
                        </>
                      ) : (
                        'Not Sig'
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
