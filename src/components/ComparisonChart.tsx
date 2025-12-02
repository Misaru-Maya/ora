import React, { useState, useRef, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import type { LabelProps } from 'recharts'
import { customRound } from '../dataCalculations'
import type { GroupSeriesMeta, SeriesDataPoint } from '../dataCalculations'

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

const LABEL_FONT_SIZE = 14
const HORIZONTAL_BAR_SIZE = Math.round(Math.max(LABEL_FONT_SIZE + 8, 32) * 0.9)
const VERTICAL_BAR_SIZE = Math.max(LABEL_FONT_SIZE + 8, 32)
const AXIS_LINE_STYLE = { stroke: '#000', strokeWidth: 1 }
const TICK_LINE_STYLE = { stroke: '#000', strokeWidth: 1 }

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
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return (
      <text
        x={originX + 4}
        y={originY + barHeight / 2}
        dy={3}
        fontSize={LABEL_FONT_SIZE}
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
      fontSize={LABEL_FONT_SIZE}
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
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return null
  }
  const text = `${customRound(numericValue)}%`
  return (
    <text
      x={originX + barWidth / 2}
      y={originY - 4}
      textAnchor="middle"
      fontSize={LABEL_FONT_SIZE}
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
        fontSize={LABEL_FONT_SIZE}
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
      fontSize={LABEL_FONT_SIZE}
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
        fontSize={LABEL_FONT_SIZE}
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
      fontSize={LABEL_FONT_SIZE}
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
  const { x, y, payload, editingOption, setEditingOption, editInput, setEditInput, onSave, data, maxWidth = 190 } = props
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

  if (isEditing) {
    return (
      <foreignObject x={x - maxWidth} y={y - 35} width={maxWidth} height={80}>
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
            lineHeight: '1.4'
          }}
        />
      </foreignObject>
    )
  }

  // Word wrapping for long labels, respecting manual line breaks
  const lineHeight = 14
  const lines: string[] = []

  // First split by newlines to preserve user's manual line breaks
  const manualLines = text.split('\n')

  manualLines.forEach((manualLine: string) => {
    const words = manualLine.split(' ')
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
  })

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
            lineHeight: '1.4'
          }}
        />
      </foreignObject>
    )
  }

  // Simple word wrapping - display text with asterisk, respecting manual line breaks
  const lines: string[] = []

  // First split by newlines to preserve user's manual line breaks
  const manualLines = text.split('\n')

  manualLines.forEach((manualLine: string) => {
    const words = manualLine.split(' ')
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
}

const CustomTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload as SeriesDataPoint
  return (
    <div
      className="rounded-md border border-brand-pale-gray bg-white text-xs text-brand-gray shadow-lg"
      style={{ backgroundColor: '#FFFFFF', opacity: 1, padding: '10px 14px' }}
    >
      <div className="mb-2 font-semibold" style={{ whiteSpace: 'pre-wrap' }}>{row.optionDisplay}</div>
      <div className="space-y-1">
        {row.groupSummaries.map(summary => (
          <div key={summary.label} className="flex justify-between gap-4">
            <span>{summary.label}</span>
            <span>{customRound(summary.percent)}% ({summary.count}/{summary.denominator})</span>
          </div>
        ))}
      </div>
      {row.significance.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="font-semibold">Significance (χ², α=0.05)</div>
          {row.significance.map(sig => (
            <div key={sig.pair.join('-')}>
              {sig.pair[0]} vs {sig.pair[1]}: {sig.significant ? 'Significant' : 'n.s.'} (χ²={sig.chiSquare.toFixed(2)})
            </div>
          ))}
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
  onSaveQuestionLabel
}) => {
  const isHorizontal = orientation === 'horizontal'
  const [editingOption, setEditingOption] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [editingLegend, setEditingLegend] = useState<string | null>(null)
  const [legendEditInput, setLegendEditInput] = useState('')
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')

  // Dynamic chart dimensions based on number of answer options
  const { chartHeight, barCategoryGap, barSize } = isHorizontal
    ? {
        // For horizontal charts: calculate height to maintain same bar size per answer option
        // Stacked charts have one bar per option, grouped charts have multiple bars per option
        chartHeight: Math.max(200, data.length * (HORIZONTAL_BAR_SIZE * (stacked ? 1 : groups.length) + 32)),
        barCategoryGap: 32,
        barSize: HORIZONTAL_BAR_SIZE,
      }
    : {
        // For vertical charts: adjust height and bar size dynamically
        // Stacked charts should have same bar width as regular charts
        chartHeight: 320,
        barCategoryGap: stacked ? 48 : 24,
        barSize: VERTICAL_BAR_SIZE,
      }

  // Calculate dynamic label widths based on chart layout
  // For vertical charts: available width per option = (estimated chart width - margins) / number of options
  // Using a multiplier to make labels wider when there's more space between bars
  const calculateMaxLabelWidth = () => {
    if (isHorizontal) {
      // For horizontal charts, scale based on number of groups (more groups = narrower bars = more space for labels)
      const baseWidth = 190
      const scaleFactor = Math.max(1, Math.min(1.8, 1 + (barCategoryGap - 20) / 40))
      return Math.floor(baseWidth * scaleFactor)
    } else {
      // For vertical charts, calculate based on available space per bar
      // Estimate: typical chart container is ~1000px wide after margins
      const estimatedChartWidth = 1000
      const totalBarsInCategory = stacked ? 1 : groups.length
      const totalBarWidth = barSize * totalBarsInCategory

      // Calculate minimum spacing needed to prevent overlap
      // Each bar category needs space for the bar(s) plus the label
      const minLabelWidth = 60 // Minimum width for readability
      const _minSpacingBetweenLabels = 10 // Minimum gap between adjacent labels

      // Calculate available width per category
      const availableWidthPerCategory = estimatedChartWidth / data.length

      // Max label width is the available space minus the bar width and spacing
      // We use 85% of the remaining space to leave some buffer
      const remainingSpaceForLabel = availableWidthPerCategory - totalBarWidth
      const calculatedWidth = remainingSpaceForLabel * 0.85

      // Ensure labels don't get too wide or too narrow
      return Math.floor(Math.max(minLabelWidth, Math.min(200, calculatedWidth)))
    }
  }

  const maxLabelWidth = calculateMaxLabelWidth()

  // Calculate dynamic height for X-axis based on maximum lines needed
  const calculateMaxLines = (text: string, maxWidth: number): number => {
    const _lineHeight = 14
    const words = text.split(' ')
    let lines = 0
    let currentLine = ''

    words.forEach((word: string) => {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      if (testLine.length * 7 > maxWidth && currentLine) {
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

  // Calculate height with extra padding for better spacing
  const xAxisHeight = !isHorizontal ? Math.max(70, 8 + maxLinesNeeded * 14 + 15) : 70

  // Always show legend when there are groups to display
  const showLegend = groups.length > 0
  const horizontalAxisWidth = Math.max(200, maxLabelWidth + 10) // Dynamic width for horizontal charts
  const legendOffset = 40
  const horizontalLegendAdjustment = 70
  const _legendPaddingLeft =
    (isHorizontal ? horizontalAxisWidth : 0) + legendOffset - (isHorizontal ? horizontalLegendAdjustment : 0)

  return (
    <div className="w-full bg-white" style={{ paddingBottom: 0 }}>
      {questionLabel && (
        <div className="text-center" style={{
          marginTop: '15px',
          marginBottom: '10px',
          marginLeft: isHorizontal ? `${horizontalAxisWidth}px` : '48px',
          marginRight: isHorizontal ? '60px' : '48px'
        }}>
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
      {showLegend && (
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
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout={isHorizontal ? "vertical" : "horizontal"}
          barCategoryGap={barCategoryGap}
          barGap={1}
          margin={isHorizontal
            ? { top: 25, right: 60, bottom: 0, left: 0 }
            : { top: 0, right: 48, bottom: 0, left: 0 }
          }
        >
          {isHorizontal ? (
            <>
              <XAxis
                type="number"
                domain={stacked ? [0, 100] : [0, 'dataMax + 10']}
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
                    maxWidth={maxLabelWidth}
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
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(206, 214, 222, 0.2)' }} />
          {groups.map((group, index) => {
            const color = colors[index % colors.length]
            return (
              <Bar
                key={group.key}
                dataKey={group.key}
                name={group.label}
                fill={color}
                radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                barSize={barSize}
                stackId={stacked ? 'stack' : undefined}
              >
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
    </div>
  )
}
