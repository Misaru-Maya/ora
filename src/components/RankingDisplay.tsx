import React, { useState } from 'react'
import { SeriesDataPoint, GroupSeriesMeta } from '../dataCalculations'

interface RankingDisplayProps {
  data: SeriesDataPoint[]
  group: GroupSeriesMeta
  questionLabel: string
  onSaveQuestionLabel?: (newLabel: string) => void
}

export const RankingDisplay: React.FC<RankingDisplayProps> = ({
  data,
  group,
  questionLabel,
  onSaveQuestionLabel
}) => {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(questionLabel)

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
    <div className="flex flex-col items-center space-y-4">
      {/* Question Title */}
      <div className="text-center" style={{ paddingBottom: '20px', maxWidth: '500px', width: '100%' }}>
        {editingTitle ? (
          <textarea
            autoFocus
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSaveTitle()
              }
              if (e.key === 'Escape') {
                setTitleInput(questionLabel)
                setEditingTitle(false)
              }
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
              fontWeight: 600,
              minHeight: '60px',
              resize: 'vertical',
              fontFamily: 'Space Grotesk, sans-serif',
              lineHeight: '1.4',
              textAlign: 'center'
            }}
          />
        ) : (
          <h3
            className="text-sm font-semibold text-brand-gray"
            style={{
              cursor: onSaveQuestionLabel ? 'pointer' : 'default',
              fontFamily: 'Space Grotesk, sans-serif',
              wordWrap: 'break-word',
              whiteSpace: 'normal',
              lineHeight: '1.4'
            }}
            onClick={() => {
              if (onSaveQuestionLabel) {
                setEditingTitle(true)
                setTitleInput(questionLabel)
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

      {/* Ranking List - Center Aligned */}
      <div className="space-y-0" style={{ maxWidth: '500px', width: '100%' }}>
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
        <div className="py-10 text-center text-xs text-brand-gray/60">
          No ranking data available.
        </div>
      )}
    </div>
  )
}
