import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LabelList,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts'
import type { LabelProps } from 'recharts'
import { GroupSeriesMeta, SeriesDataPoint, customRound } from '../dataCalculations'

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
const HORIZONTAL_BAR_SIZE = Math.max(LABEL_FONT_SIZE + 8, 32)
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
const CustomXAxisTick: React.FC<any> = (props) => {
  const { x, y, payload } = props
  const text = payload.value || ''
  const maxWidth = 100
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

interface ComparisonChartProps {
  data: SeriesDataPoint[]
  groups: GroupSeriesMeta[]
  orientation?: 'horizontal' | 'vertical'
  questionLabel?: string
  stacked?: boolean
  colors?: string[]
}

const CustomTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload as SeriesDataPoint
  return (
    <div
      className="rounded-md border border-brand-pale-gray bg-white text-xs text-brand-gray shadow-lg"
      style={{ backgroundColor: '#FFFFFF', opacity: 1, padding: '10px 14px' }}
    >
      <div className="mb-2 font-semibold">{row.optionDisplay}</div>
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

export const ComparisonChart: React.FC<ComparisonChartProps> = ({ data, groups, orientation = 'horizontal', questionLabel, stacked = false, colors = GROUP_COLORS }) => {
  const isHorizontal = orientation === 'horizontal'

  // Dynamic chart dimensions based on number of answer options
  const { chartHeight, barCategoryGap, barSize } = isHorizontal
    ? {
        chartHeight: Math.max(320, data.length * (HORIZONTAL_BAR_SIZE + 32)),
        barCategoryGap: 32,
        barSize: HORIZONTAL_BAR_SIZE,
      }
    : {
        chartHeight: 400,
        barCategoryGap: 24,
        barSize: VERTICAL_BAR_SIZE,
      }

  const showLegend = groups.length > 1 || (groups.length === 1 && groups[0]?.label === 'Overall')
  const horizontalAxisWidth = 200
  const legendOffset = 40
  const horizontalLegendAdjustment = 70
  const legendPaddingLeft =
    (isHorizontal ? horizontalAxisWidth : 0) + legendOffset - (isHorizontal ? horizontalLegendAdjustment : 0)

  return (
    <div className="w-full bg-white" style={{ paddingBottom: showLegend ? 12 : 0 }}>
      {questionLabel && (
        <div className="text-center" style={{
          marginTop: '15px',
          marginBottom: '10px',
          marginLeft: isHorizontal ? `${horizontalAxisWidth}px` : '48px',
          marginRight: isHorizontal ? '60px' : '48px'
        }}>
          <h3 className="text-sm font-semibold text-brand-gray">{questionLabel}</h3>
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
        ) : (
          // Vertical legend for regular charts
          <div
            className="flex flex-col items-start gap-3 text-xs font-semibold text-brand-gray"
            style={{ paddingLeft: legendPaddingLeft, marginBottom: '10px' }}
          >
            {groups.map((group, index) => (
              <span key={group.key} className="inline-flex items-center gap-3">
                <span
                  className="inline-block h-3 w-10"
                  style={{
                    backgroundColor: colors[index % colors.length],
                    minWidth: '24px',
                    minHeight: '12px',
                    borderRadius: '3px'
                  }}
                />
                <span style={{ padding: '0 6px' }}>{group.label}</span>
              </span>
            ))}
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
            ? { top: 0, right: 60, bottom: 30, left: 0 }
            : { top: 0, right: 48, bottom: 50, left: 0 }
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
                tick={{ fontSize: 14, fill: '#1f2833' }}
                axisLine={AXIS_LINE_STYLE}
                tickLine={TICK_LINE_STYLE}
              />
            </>
          ) : (
            <>
              <XAxis
                type="category"
                dataKey="optionDisplay"
                height={100}
                tick={<CustomXAxisTick />}
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
