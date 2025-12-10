import React, { useState } from 'react'
import type { SeriesDataPoint, GroupSeriesMeta } from '../dataCalculations'

interface RankingDisplayProps {
  data: SeriesDataPoint[]
  group: GroupSeriesMeta
  questionLabel: string
  onSaveQuestionLabel?: (newLabel: string) => void
  questionTypeBadge?: React.ReactNode
  showSegment?: boolean
}

export const RankingDisplay: React.FC<RankingDisplayProps> = ({
  data,
  group,
  questionLabel,
  onSaveQuestionLabel,
  questionTypeBadge,
  showSegment = true
}) => {
  // Remove "Example: ..." text from ranking question labels
  const cleanLabel = (label: string): string => {
    const exampleIndex = label.toLowerCase().indexOf('example:')
    if (exampleIndex !== -1) {
      return label.substring(0, exampleIndex).trim()
    }
    return label
  }

  const displayLabel = cleanLabel(questionLabel)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(displayLabel)

  const handleSaveTitle = () => {
    if (titleInput.trim() && onSaveQuestionLabel) {
      onSaveQuestionLabel(titleInput.trim())
    }
    setEditingTitle(false)
  }

  // Sort by average ranking (ascending - lower rank is better)
  const sortedData = [...data].sort((a, b) => {
    const aValue = typeof a[group.key] === 'number' ? (a[group.key] as number) : 0
    const bValue = typeof b[group.key] === 'number' ? (b[group.key] as number) : 0
    return aValue - bValue
  })

  return (
    <div className="flex flex-col items-center" style={{ width: '100%', gap: '16px' }}>
      {/* Header Row: Segment (left) | Title (center) | Badge (right) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          width: '100%',
          gap: '16px'
        }}
      >
        {/* Left: Segment Label */}
        {showSegment && (
          <div style={{ flex: '0 0 auto', minWidth: '80px' }}>
            <p className="text-xs font-semibold text-brand-gray/60" style={{ margin: 0 }}>Segment: {group.label}</p>
          </div>
        )}

        {/* Center: Title */}
        <div
          style={{
            flex: '1 1 auto',
            textAlign: 'center',
            minWidth: 0,
            maxWidth: 'calc(100% - 200px)'
          }}
        >
          {editingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSaveTitle()
                }
                if (e.key === 'Escape') {
                  setTitleInput(displayLabel)
                  setEditingTitle(false)
                }
              }}
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
                textAlign: 'center'
              }}
            />
          ) : (
            <h3
              className="text-sm font-semibold text-brand-gray"
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                wordWrap: 'break-word',
                whiteSpace: 'normal',
                lineHeight: '1.4',
                margin: 0,
                cursor: onSaveQuestionLabel ? 'pointer' : 'default'
              }}
              onDoubleClick={() => {
                if (onSaveQuestionLabel) {
                  setEditingTitle(true)
                  setTitleInput(displayLabel)
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
              {displayLabel}
            </h3>
          )}
        </div>

        {/* Right: Question Type Badge */}
        <div style={{ flex: '0 0 auto', minWidth: '80px', display: 'flex', justifyContent: 'flex-end' }}>
          {questionTypeBadge}
        </div>
      </div>

      {/* Ranking List - Full Width */}
      <div className="space-y-0" style={{ width: '100%' }}>
        {sortedData.map((item, index) => {
          const avgRanking = typeof item[group.key] === 'number' ? (item[group.key] as number) : 0

          return (
            <div
              key={item.option}
              className="flex items-center"
              style={{
                padding: '12px 0',
                fontFamily: 'Space Grotesk, sans-serif',
                gap: '20px'
              }}
            >
              {/* Ranking Number */}
              <div
                className="flex-shrink-0 text-brand-gray font-semibold"
                style={{
                  fontSize: '16px',
                  minWidth: '40px',
                  textAlign: 'left'
                }}
              >
                #{index + 1}
              </div>

              {/* Answer Option - takes remaining space */}
              <div
                className="flex-1 text-brand-gray"
                style={{
                  fontSize: '16px'
                }}
              >
                {item.optionDisplay}
              </div>

              {/* Average Score - left aligned */}
              <div
                className="flex-shrink-0 font-semibold"
                style={{
                  fontSize: '16px',
                  color: '#3A8518',
                  minWidth: '120px',
                  textAlign: 'left'
                }}
              >
                {avgRanking.toFixed(1)} average
              </div>
            </div>
          )
        })}
      </div>

      {sortedData.length === 0 && (
        <div className="py-10 text-center text-sm text-brand-gray/60">
          No data available
        </div>
      )}
    </div>
  )
}
