import React from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { SeriesDataPoint, GroupSeriesMeta } from '../dataCalculations'

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
}

export const SingleSelectPieChart: React.FC<SingleSelectPieChartProps> = ({ data, group, questionLabel }) => {
  const pieData = data
    .map(item => ({
      name: item.optionDisplay,
      value: Number(item[group.key] ?? 0)
    }))
    .filter(item => Number.isFinite(item.value) && item.value > 0)

  if (!pieData.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-brand-gray/60">
        No data available for pie chart.
      </div>
    )
  }

  return (
    <div className="w-full">
      {questionLabel && (
        <div className="mx-auto pb-4 text-center">
          <h3 className="text-sm font-semibold text-brand-gray">{questionLabel}</h3>
          <p className="text-xs text-brand-gray/60">Segment: {group.label}</p>
        </div>
      )}
      <div className="h-64">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius="40%"
              outerRadius="70%"
              paddingAngle={2}
            >
              {pieData.map((entry, index) => (
                <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => `${value.toFixed(1)}%`}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
