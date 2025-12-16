import React, { useState, useRef, useEffect } from 'react'
import { WordCloudCanvas } from './WordCloudCanvas'

interface FreeTextDisplayProps {
  questionLabel: string
  uniqueValueCount: number
  totalResponses: number
  rawTextResponses: string[]
  onSaveQuestionLabel?: (newLabel: string) => void
  questionTypeBadge?: React.ReactNode
  showSegment?: boolean
  showContainer?: boolean
  segmentLabel?: string
}

export const FreeTextDisplay: React.FC<FreeTextDisplayProps> = ({
  questionLabel,
  rawTextResponses,
  onSaveQuestionLabel,
  questionTypeBadge,
  showSegment = true,
  showContainer = true,
  segmentLabel = 'Overall',
}) => {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(questionLabel)
  const containerRef = useRef<HTMLDivElement>(null)

  // Container dimensions for word cloud
  const [containerWidth, setContainerWidth] = useState(800)
  const baseHeight = Math.round(350 * 1.10) // 10% bigger

  // Word cloud width resize state - default to circle (width = height)
  // Calculate initial percent so that effectiveCloudWidth = baseHeight
  const getDefaultCloudWidthPercent = (width: number) => {
    // Account for word list space (280px + 20px gap + 12px handle)
    const maxWidth = width - 312
    const circleWidth = Math.min(baseHeight, maxWidth)
    return Math.min(100, (circleWidth / width) * 100)
  }
  const [cloudWidthPercent, setCloudWidthPercent] = useState(() => getDefaultCloudWidthPercent(800))
  const [isResizingCloud, setIsResizingCloud] = useState(false)
  const resizeStartX = useRef<number>(0)
  const resizeStartWidth = useRef<number>(100)

  // Track if user has manually resized
  const hasUserResized = useRef(false)

  // Update container width on mount and resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth * 0.95
        const newWidth = Math.max(300, width)
        setContainerWidth(newWidth)
        // Only set default circle size if user hasn't manually resized
        if (!hasUserResized.current) {
          setCloudWidthPercent(getDefaultCloudWidthPercent(newWidth))
        }
      }
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  // Word cloud width resize effect
  useEffect(() => {
    if (!isResizingCloud) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeStartX.current
      const containerW = containerRef.current?.offsetWidth || 800
      const deltaPercent = (deltaX / containerW) * 100 * 2
      const newWidth = Math.max(40, Math.min(100, resizeStartWidth.current + deltaPercent))
      setCloudWidthPercent(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizingCloud(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingCloud])

  const handleCloudResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingCloud(true)
    hasUserResized.current = true
    resizeStartX.current = e.clientX
    resizeStartWidth.current = cloudWidthPercent
  }

  // Word list is 280px, need 20px gap between handle and word list
  // Handle should be at cloud edge (0px gap)
  const wordListWidth = 280
  const handleToWordListGap = 20
  const cloudToHandleGap = 0
  const maxCloudWidth = containerWidth - wordListWidth - handleToWordListGap - 12 // 12 = handle width
  // Apply 10% increase to cloud size
  const effectiveCloudWidth = Math.min(containerWidth * (cloudWidthPercent / 100), maxCloudWidth) * 1.10

  // Clean the label (remove Example: text and (text) marker)
  const cleanLabel = (label: string): string => {
    let result = label
    const exampleIndex = result.toLowerCase().indexOf('example:')
    if (exampleIndex !== -1) {
      result = result.substring(0, exampleIndex).trim()
    }
    return result.replace(/\s*\(text\)\s*/gi, '').trim()
  }

  const displayLabel = cleanLabel(questionLabel)

  const handleSaveTitle = () => {
    if (titleInput.trim() && onSaveQuestionLabel) {
      onSaveQuestionLabel(titleInput.trim())
    }
    setEditingTitle(false)
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        width: '100%',
        paddingTop: '0px',
        paddingBottom: '10px',
        position: 'relative',
      }}
    >
      {/* Main content */}
      <div style={{ width: '100%' }}>
        {/* Export wrapper with rounded corners and shadow */}
        <div
          style={{
            backgroundColor: showContainer ? '#ffffff' : 'transparent',
            borderRadius: showContainer ? '20px' : '0',
            boxShadow: showContainer ? '0 4px 20px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)' : 'none',
            padding: showContainer ? '32px 48px 96px 48px' : '0',
            margin: '0 auto',
            width: '95%',
            position: 'relative',
          }}
        >
          {/* Header Row */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            width: '100%',
            gap: '16px',
            marginBottom: '20px',
          }}>
            {/* Left: Segment Card */}
            {showSegment && (
              <div style={{ flex: '0 0 auto', minWidth: '80px' }}>
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
                  <span style={{ color: '#3A8518' }}>{segmentLabel}</span>
                </div>
              </div>
            )}

            {/* Center: Title */}
            <div style={{
              flex: '1 1 auto',
              textAlign: 'center',
              minWidth: 0,
            }}>
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
                    color: '#717F90',
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
                    cursor: onSaveQuestionLabel ? 'pointer' : 'default',
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
                    e.currentTarget.style.color = '#717F90'
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

          {/* Word Cloud - centered with resize handle */}
          {rawTextResponses.length > 0 ? (
            <WordCloudCanvas
              textData={rawTextResponses}
              questionLabel={questionLabel}
              containerWidth={effectiveCloudWidth}
              containerHeight={baseHeight}
              wordListWidth={containerWidth}
            />
          ) : (
            <div style={{
              width: '100%',
              height: baseHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#F8F9FA',
              borderRadius: '12px',
            }}>
              <div style={{
                color: '#717F90',
                fontFamily: 'Space Grotesk',
                fontSize: '14px',
              }}>
                No text responses available
              </div>
            </div>
          )}

          {/* Word cloud width resize handle (vertical bar 40px right of cloud edge) */}
          <div
            onMouseDown={handleCloudResizeStart}
            style={{
              position: 'absolute',
              left: `${effectiveCloudWidth + cloudToHandleGap}px`,
              top: '180px',
              width: '12px',
              height: '60px',
              cursor: 'ew-resize',
              backgroundColor: isResizingCloud ? 'rgba(58, 133, 24, 0.3)' : 'transparent',
              transition: 'background-color 0.15s ease',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => {
              if (!isResizingCloud) {
                e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.2)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isResizingCloud) {
                e.currentTarget.style.backgroundColor = 'transparent'
              }
            }}
          >
            <div style={{
              width: '3px',
              height: '30px',
              backgroundColor: isResizingCloud ? '#3A8518' : '#CED6DE',
              borderRadius: '2px',
              transition: 'background-color 0.15s ease',
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}
