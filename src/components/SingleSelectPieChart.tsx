import React, { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { SeriesDataPoint, GroupSeriesMeta } from '../dataCalculations'

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
}

export const SingleSelectPieChart: React.FC<SingleSelectPieChartProps> = ({
  data,
  group,
  questionLabel,
  legendOrientation = 'horizontal',
  colors = PIE_COLORS,
  optionLabels: _optionLabels = {},
  onSaveOptionLabel,
  onSaveQuestionLabel
}) => {
  const [editingOption, setEditingOption] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [editingQuestionLabel, setEditingQuestionLabel] = useState(false)
  const [questionLabelInput, setQuestionLabelInput] = useState('')

  console.log('SingleSelectPieChart received:', {
    dataLength: data.length,
    groupKey: group.key,
    groupLabel: group.label,
    sampleData: data[0]
  })

  const pieData = data
    .map(item => {
      const value = Number(item[group.key] ?? 0)
      console.log('Mapping item:', {
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

  console.log('Pie data after filtering:', pieData)

  if (!pieData.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-brand-gray/60">
        No data available for pie chart.
      </div>
    )
  }

  console.log('About to render pie chart with pieData:', pieData)

  // Custom label formatter to show rounded values with % sign
  // Using dark gray color for better readability (same as legend text)
  const renderLabel = (entry: any) => {
    return (
      <text
        x={entry.x}
        y={entry.y}
        fill="#1f2833"
        textAnchor={entry.x > entry.cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize="14"
        fontWeight="600"
      >
        {`${Math.round(entry.value)}%`}
      </text>
    )
  }

  // Reverse the pie data for rendering to match clockwise legend order
  const reversedPieData = [...pieData].reverse()

  const legendContent = (
    <div className="flex flex-col items-start gap-3 text-xs font-semibold text-brand-gray" style={{ paddingBottom: '10px' }}>
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
                  lineHeight: '1.4'
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
    <div className="w-full flex justify-center">
      <div style={{ maxWidth: '800px', width: '100%' }}>
        {questionLabel && (
          <div className="mx-auto text-center" style={{ marginTop: '15px', marginBottom: '20px' }}>
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
            <p className="text-xs text-brand-gray/60">Segment: {group.label}</p>
          </div>
        )}
        <div className={`flex justify-center ${legendOrientation === 'horizontal' ? 'flex-row items-center' : 'flex-col items-center gap-4'}`} style={{ gap: legendOrientation === 'horizontal' ? '30px' : undefined }}>
          <div style={{ width: '280px', height: '280px', flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
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
                  labelLine={true}
                  startAngle={90}
                  endAngle={450}
                >
                  {reversedPieData.map((_entry, index) => {
                    const colorIndex = pieData.length - 1 - index
                    return (
                      <Cell key={`cell-${index}`} fill={colors[colorIndex % colors.length]} />
                    )
                  })}
                </Pie>
                <Tooltip
                  formatter={(value: number) => `${Math.round(value)}%`}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {legendContent}
        </div>
      </div>
    </div>
  )
}
