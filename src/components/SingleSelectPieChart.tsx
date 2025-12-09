import React, { useState, useRef, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import type { SeriesDataPoint, GroupSeriesMeta } from '../dataCalculations'

// Performance: Disable console logs in production
const isDev = process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}

const PIE_COLORS = [
  '#3A8518',
  '#CED6DE',
  '#E7CB38',
  '#A5CF8E',
  '#717F90',
  '#F1E088',
  '#DAEBD1',
  '#FAF5D7',
  '#9BA6B2',
  '#D4A5C2'
]

interface SingleSelectPieChartProps {
  data: SeriesDataPoint[]
  group: GroupSeriesMeta
  questionLabel?: string
  legendOrientation?: 'horizontal' | 'vertical'
  colors?: string[]
  optionLabels?: Record<string, string>
  onSaveOptionLabel?: (option: string, newLabel: string) => void
  onSaveQuestionLabel?: (newLabel: string) => void
  questionTypeBadge?: React.ReactNode
  heightOffset?: number
  showSegment?: boolean
  sentimentType?: 'advocates' | 'detractors' | null  // For product follow-up questions
}

export const SingleSelectPieChart: React.FC<SingleSelectPieChartProps> = ({
  data,
  group,
  questionLabel,
  legendOrientation = 'horizontal',
  colors = PIE_COLORS,
  optionLabels: _optionLabels = {},
  onSaveOptionLabel,
  onSaveQuestionLabel,
  questionTypeBadge,
  heightOffset = 0,
  showSegment = true,
  sentimentType = null
}) => {
  const [editingOption, setEditingOption] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')

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

  devLog('SingleSelectPieChart received:', {
    dataLength: data.length,
    groupKey: group.key,
    groupLabel: group.label,
    sampleData: data[0]
  })

  const pieData = data
    .map(item => {
      const value = Number(item[group.key] ?? 0)
      devLog('Mapping item:', {
        option: item.optionDisplay,
        groupKey: group.key,
        rawValue: item[group.key],
        convertedValue: value
      })
      return {
        name: item.optionDisplay,
        value
      }
    })
    .filter(item => Number.isFinite(item.value) && item.value > 0)

  devLog('Pie data after filtering:', pieData)

  if (!pieData.length) {
    return (
      <div className="w-full" style={{ paddingBottom: '30px' }}>
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

  devLog('About to render pie chart with pieData:', pieData)

  // Reverse the pie data for rendering to match clockwise legend order
  const reversedPieData = React.useMemo(() => [...pieData].reverse(), [pieData])

  // Label line length constant - used by both label and labelLine renderers
  const LABEL_LINE_LENGTH = 12
  // Gap between line end and text
  const TEXT_GAP = 2
  // Minimum angle difference (in degrees) to show both labels - prevents overlap
  const MIN_ANGLE_DIFF = 15

  // Pre-calculate which labels should be shown
  // Rules:
  // 1. Hide labels for values less than 2% (rounded)
  // 2. Always show labels for values 2% and above
  const labelsToShow = React.useMemo(() => {
    const shownLabels = new Set<number>()

    reversedPieData.forEach((slice, index) => {
      // Only show labels for values >= 2% (rounded)
      if (Math.round(slice.value) >= 2) {
        shownLabels.add(index)
      }
    })

    return shownLabels
  }, [reversedPieData])

  // Custom label line renderer - line color matches each slice's color
  // Only show line if label is shown
  const renderLabelLine = (props: any): React.ReactElement => {
    const RADIAN = Math.PI / 180
    const { cx, cy, midAngle, outerRadius, index } = props

    // Don't render line if label is hidden - return empty group instead of null
    if (!labelsToShow.has(index)) {
      return <g />
    }

    // Line starts at pie edge
    const startX = cx + outerRadius * Math.cos(-midAngle * RADIAN)
    const startY = cy + outerRadius * Math.sin(-midAngle * RADIAN)

    // Line ends at consistent distance from pie
    const endX = cx + (outerRadius + LABEL_LINE_LENGTH) * Math.cos(-midAngle * RADIAN)
    const endY = cy + (outerRadius + LABEL_LINE_LENGTH) * Math.sin(-midAngle * RADIAN)

    // Get the slice color - index is for reversedPieData, so calculate original color index
    const colorIndex = pieData.length - 1 - index
    const sliceColor = colors[colorIndex % colors.length]

    return (
      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={endY}
        stroke={sliceColor}
        strokeWidth={1}
      />
    )
  }

  // Custom label formatter to show rounded values with % sign
  // Position labels at end of label lines with consistent gap, no overlap
  const renderLabel = (entry: any) => {
    const RADIAN = Math.PI / 180
    const midAngle = entry.midAngle

    // Don't render label if it would overlap - check using index
    if (!labelsToShow.has(entry.index)) {
      return null
    }

    // Position at end of label line plus small gap
    const labelRadius = entry.outerRadius + LABEL_LINE_LENGTH + TEXT_GAP

    // Calculate label position
    const labelX = entry.cx + labelRadius * Math.cos(-midAngle * RADIAN)
    const labelY = entry.cy + labelRadius * Math.sin(-midAngle * RADIAN)

    // Determine text anchor based on horizontal position (left vs right of center)
    // Using cos to determine: positive cos = right side, negative cos = left side
    const cosAngle = Math.cos(-midAngle * RADIAN)
    let textAnchor: 'start' | 'middle' | 'end'

    if (cosAngle > 0.3) {
      // Right side - text extends right
      textAnchor = 'start'
    } else if (cosAngle < -0.3) {
      // Left side - text extends left
      textAnchor = 'end'
    } else {
      // Near top/bottom - center the text
      textAnchor = 'middle'
    }

    // Determine vertical baseline based on vertical position (above vs below center)
    // Using sin to determine: positive sin (in our coord system) = below, negative = above
    const sinAngle = Math.sin(-midAngle * RADIAN)
    let dominantBaseline: 'hanging' | 'central' | 'auto'

    if (sinAngle > 0.3) {
      // Below center - text hangs from anchor point
      dominantBaseline = 'hanging'
    } else if (sinAngle < -0.3) {
      // Above center - text sits above anchor point
      dominantBaseline = 'auto'
    } else {
      // Near horizontal - center vertically
      dominantBaseline = 'central'
    }

    return (
      <text
        x={labelX}
        y={labelY}
        fill="#1f2833"
        textAnchor={textAnchor}
        dominantBaseline={dominantBaseline}
        fontSize="16"
        fontWeight="600"
      >
        {`${Math.round(entry.value)}%`}
      </text>
    )
  }

  const legendContent = (
    <div className="flex flex-col items-start gap-3 text-sm font-semibold text-brand-gray" style={{ paddingBottom: '10px', whiteSpace: 'nowrap' }}>
      {pieData.map((entry, index) => {
        // Find original option key from data
        const dataPoint = data.find(d => d.optionDisplay === entry.name)
        const option = dataPoint?.option || entry.name
        const isEditing = editingOption === option

        // Check if has asterisk
        const hasAsterisk = entry.name.endsWith('*')
        const nameWithoutAsterisk = hasAsterisk ? entry.name.slice(0, -1) : entry.name

        const handleSave = () => {
          if (editInput.trim() && onSaveOptionLabel) {
            const cleanedInput = editInput.trim().replace(/\*+$/, '')
            if (cleanedInput !== nameWithoutAsterisk) {
              onSaveOptionLabel(option, cleanedInput)
            }
          }
          setEditingOption(null)
        }

        return (
          <span key={entry.name} className="inline-flex items-center gap-3">
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
                  fontSize: '14px',
                  padding: '6px 8px',
                  border: '2px solid #3A8518',
                  borderRadius: '3px',
                  outline: 'none',
                  backgroundColor: 'white',
                  minWidth: '150px',
                  minHeight: '36px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: '1.4',
                  cursor: 'text',
                  userSelect: 'text'
                }}
              />
            ) : (
              <span
                style={{
                  padding: '0 6px',
                  cursor: onSaveOptionLabel ? 'pointer' : 'default',
                  whiteSpace: 'pre-wrap'
                }}
                onClick={() => {
                  if (onSaveOptionLabel) {
                    setEditingOption(option)
                    setEditInput(nameWithoutAsterisk)
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
                {entry.name}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )

  return (
    <div style={{ display: 'inline-block' }}>
      <div style={{ width: 'fit-content' }}>
        {/* Header Row: Title centered above chart+legend */}
        <div
          onMouseDown={handleTitleMouseDown}
          style={{
            marginTop: '15px',
            marginBottom: '15px',
            paddingLeft: '16px',
            paddingRight: '16px',
            transform: `translate(${titleOffset.x}px, ${titleOffset.y}px)`,
            cursor: isDraggingTitle ? 'grabbing' : 'grab',
            userSelect: 'none',
            transition: isDraggingTitle ? 'none' : 'transform 0.1s ease-out',
            position: 'relative',
            zIndex: 20,
            textAlign: 'center'
          }}
        >
          {/* Center: Title - wraps based on chart+legend width */}
          <div
            style={{
              textAlign: 'center'
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
                    textAlign: 'center',
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
        </div>

        <div
          onMouseDown={handleChartMouseDown}
          className={`flex justify-center ${legendOrientation === 'horizontal' ? 'flex-row items-center' : 'flex-col items-center gap-4'}`}
          style={{
            gap: legendOrientation === 'horizontal' ? '24px' : undefined, // Reduced by 20% from 30px
            transform: `translate(${chartOffset.x}px, ${chartOffset.y}px)`,
            cursor: isDraggingChart ? 'grabbing' : 'grab',
            transition: isDraggingChart ? 'none' : 'transform 0.1s ease-out',
            position: 'relative',
            zIndex: 10
          }}
        >
          <div style={{ width: `${320 + heightOffset}px`, height: `${280 + heightOffset}px`, flexShrink: 0, overflow: 'visible' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 20, right: 40, bottom: 20, left: 40 }}>
                <Pie
                  data={reversedPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  label={renderLabel}
                  labelLine={renderLabelLine as any}
                  startAngle={90}
                  endAngle={450}
                  isAnimationActive={false}
                >
                  {reversedPieData.map((_entry, index) => {
                    const colorIndex = pieData.length - 1 - index
                    return (
                      <Cell key={`cell-${index}`} fill={colors[colorIndex % colors.length]} />
                    )
                  })}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Segment Label above legend - show Advocates/Detractors for product questions, otherwise show segment label */}
            {showSegment && (
              sentimentType ? (
                // Product follow-up question: show Advocates or Detractors badge with rectangular style
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    alignSelf: 'flex-start',
                    gap: '6px',
                    padding: '5px 10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.85)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    border: `1px solid ${sentimentType === 'advocates' ? 'rgba(58, 133, 24, 0.15)' : 'rgba(212, 186, 51, 0.15)'}`,
                    borderRadius: '8px',
                    boxShadow: sentimentType === 'advocates'
                      ? '0 2px 8px rgba(58, 133, 24, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.9)'
                      : '0 2px 8px rgba(180, 150, 20, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
                    fontSize: '10px',
                    fontWeight: 600,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.5px'
                  }}
                >
                  <div style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '2px',
                    backgroundColor: sentimentType === 'advocates' ? '#3A8518' : '#D4BA33'
                  }} />
                  <span style={{ color: sentimentType === 'advocates' ? '#3A8518' : '#D4BA33' }}>
                    {sentimentType === 'advocates' ? 'Advocates' : 'Detractors'}
                  </span>
                </div>
              ) : (
                // Regular question: show segment label with rectangular style (like advocate/detractor cards)
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    alignSelf: 'flex-start',
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
                  <span style={{ color: '#3A8518' }}>{group.label}</span>
                </div>
              )
            )}
            {/* Question Type Badge below segment card */}
            <div style={{ alignSelf: 'flex-start' }}>
              {questionTypeBadge}
            </div>
            {legendContent}
          </div>
        </div>
      </div>
    </div>
  )
}
