import React, { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { SeriesDataPoint, GroupSeriesMeta, customRound } from '../dataCalculations'

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
}

export const SingleSelectPieChart: React.FC<SingleSelectPieChartProps> = ({
  data,
  group,
  questionLabel,
  legendOrientation = 'horizontal',
  colors = PIE_COLORS
}) => {

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
    <div className="flex flex-col items-start gap-3 text-xs font-semibold text-brand-gray" style={{ paddingBottom: '40px' }}>
      {pieData.map((entry, index) => (
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
          <span style={{ padding: '0 6px' }}>{entry.name}</span>
        </span>
      ))}
    </div>
  )

  return (
    <div className="w-full">
      {questionLabel && (
        <div className="mx-auto text-center" style={{ marginTop: '15px', marginBottom: '20px' }}>
          <h3 className="text-sm font-semibold text-brand-gray">{questionLabel}</h3>
          <p className="text-xs text-brand-gray/60">Segment: {group.label}</p>
        </div>
      )}
      {/* Flexbox container - layout changes based on orientation */}
      <div className={`flex justify-center ${legendOrientation === 'horizontal' ? 'flex-row items-center' : 'flex-col items-center gap-4'}`} style={{ gap: legendOrientation === 'horizontal' ? '0px' : undefined }}>
        {/* Pie Chart */}
        <div style={{ width: '320px', height: '320px', flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={reversedPieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                label={renderLabel}
                labelLine={true}
                startAngle={90}
                endAngle={450}
              >
                {reversedPieData.map((entry, index) => {
                  // Use reversed index to get the correct color matching the legend
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
        {/* Custom legend - position changes based on orientation */}
        {legendContent}
      </div>
    </div>
  )
}
