import React, { useState, useRef, useEffect, useCallback } from 'react'
import { WordCloudCanvas } from './WordCloudCanvas'

const FREE_TEXT_ANALYZER_URL = 'https://chatgpt.com/g/g-693def96d1ec8191a4b8bb8545a70487-free-text-analyzer'

interface FreeTextDisplayProps {
  questionLabel: string
  uniqueValueCount: number
  totalResponses: number
  rawTextResponses: string[]
  onSaveQuestionLabel?: (newLabel: string) => void
  questionTypeBadge?: React.ReactNode
  showSegment?: boolean
  showContainer?: boolean
}

export const FreeTextDisplay: React.FC<FreeTextDisplayProps> = ({
  questionLabel,
  uniqueValueCount,
  totalResponses,
  rawTextResponses,
  onSaveQuestionLabel,
  questionTypeBadge,
  showSegment = true,
  showContainer = true,
}) => {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(questionLabel)
  const containerRef = useRef<HTMLDivElement>(null)

  // Resize state
  const [chartWidthPercent, setChartWidthPercent] = useState(100)
  const [chartHeightOffset, setChartHeightOffset] = useState(0)
  const [isResizingChart, setIsResizingChart] = useState(false)
  const [isResizingHeight, setIsResizingHeight] = useState(false)
  const [resizingHandle, setResizingHandle] = useState<'left' | 'right' | null>(null)
  const chartResizeStartX = useRef<number>(0)
  const chartResizeStartWidth = useRef<number>(100)
  const heightResizeStartY = useRef<number>(0)
  const heightResizeStartOffset = useRef<number>(0)

  // Container dimensions for word cloud
  const [containerWidth, setContainerWidth] = useState(800)
  const baseHeight = 350

  // Update container width on mount and resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth * (chartWidthPercent / 100) * 0.95
        setContainerWidth(Math.max(300, width))
      }
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [chartWidthPercent])

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

  const openFreeTextAnalyzer = () => {
    window.open(FREE_TEXT_ANALYZER_URL, '_blank', 'noopener,noreferrer')
  }

  // Width resize handlers
  const handleChartResizeStart = (handle: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingChart(true)
    setResizingHandle(handle)
    chartResizeStartX.current = e.clientX
    chartResizeStartWidth.current = chartWidthPercent
  }

  // Height resize handlers
  const handleHeightResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingHeight(true)
    heightResizeStartY.current = e.clientY
    heightResizeStartOffset.current = chartHeightOffset
  }

  // Width resize effect
  useEffect(() => {
    if (!isResizingChart) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - chartResizeStartX.current
      const containerWidth = containerRef.current?.offsetWidth || 800
      const deltaPercent = (deltaX / containerWidth) * 100 * 2

      let newWidth: number
      if (resizingHandle === 'right') {
        newWidth = chartResizeStartWidth.current + deltaPercent
      } else {
        newWidth = chartResizeStartWidth.current - deltaPercent
      }

      newWidth = Math.max(40, Math.min(100, newWidth))
      setChartWidthPercent(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizingChart(false)
      setResizingHandle(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingChart, resizingHandle])

  // Height resize effect
  useEffect(() => {
    if (!isResizingHeight) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - heightResizeStartY.current
      const newOffset = Math.max(-150, Math.min(300, heightResizeStartOffset.current + deltaY))
      setChartHeightOffset(newOffset)
    }

    const handleMouseUp = () => {
      setIsResizingHeight(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingHeight])

  // Copy to clipboard handler
  const handleCopyToClipboard = useCallback(async () => {
    const canvas = containerRef.current?.querySelector('canvas')
    if (!canvas) return

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to create blob'))
        }, 'image/png')
      })
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
      // Could add a toast notification here
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }, [])

  const effectiveHeight = baseHeight + chartHeightOffset

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        width: '100%',
        paddingTop: '0px',
        paddingBottom: '30px',
        position: 'relative',
        minHeight: `${effectiveHeight + 200}px`,
      }}
    >
      {/* Right resize handle */}
      <div
        onMouseDown={handleChartResizeStart('right')}
        style={{
          position: 'absolute',
          left: `calc(${chartWidthPercent * 0.95}% + 40px)`,
          top: '50%',
          transform: 'translateY(-50%)',
          height: '80px',
          width: '20px',
          cursor: 'ew-resize',
          backgroundColor: isResizingChart && resizingHandle === 'right' ? 'rgba(58, 133, 24, 0.3)' : 'transparent',
          transition: 'background-color 0.15s ease',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px',
        }}
        onMouseEnter={(e) => {
          if (!isResizingChart) {
            e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.2)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizingChart || resizingHandle !== 'right') {
            e.currentTarget.style.backgroundColor = 'transparent'
          }
        }}
      >
        <div style={{
          width: '3px',
          height: '40px',
          backgroundColor: isResizingChart && resizingHandle === 'right' ? '#3A8518' : '#CED6DE',
          borderRadius: '2px',
          transition: 'background-color 0.15s ease',
        }} />
      </div>

      {/* Main content */}
      <div style={{ width: `${chartWidthPercent}%` }}>
        {/* Export wrapper with rounded corners and shadow */}
        <div
          style={{
            backgroundColor: showContainer ? '#ffffff' : 'transparent',
            borderRadius: showContainer ? '20px' : '0',
            boxShadow: showContainer ? '0 4px 20px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)' : 'none',
            padding: showContainer ? '32px 48px 32px 48px' : '0',
            margin: '8px auto 0px auto',
            width: '95%',
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
            {/* Left: Segment Label */}
            {showSegment && (
              <div style={{ flex: '0 0 auto', minWidth: '80px' }}>
                <p style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'rgba(113, 127, 144, 0.6)',
                  margin: 0,
                  fontFamily: 'Space Grotesk, sans-serif',
                }}>
                  Free Text
                </p>
              </div>
            )}

            {/* Center: Title */}
            <div style={{
              flex: '1 1 auto',
              textAlign: 'center',
              minWidth: 0,
              maxWidth: 'calc(100% - 200px)',
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
                  style={{
                    fontFamily: 'Space Grotesk, sans-serif',
                    wordWrap: 'break-word',
                    whiteSpace: 'normal',
                    lineHeight: '1.4',
                    margin: 0,
                    cursor: onSaveQuestionLabel ? 'pointer' : 'default',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: '#717F90',
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

          {/* Stats + Button Row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
            marginBottom: '24px',
          }}>
            {/* Stats Container */}
            <div style={{
              display: 'flex',
              gap: '24px',
              alignItems: 'center',
              padding: '12px 20px',
              backgroundColor: '#F8F9FA',
              borderRadius: '8px',
              border: '1px solid #E5E8EC',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#3A8518',
                  fontFamily: 'Space Grotesk',
                }}>
                  {totalResponses.toLocaleString()}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#717F90',
                  fontFamily: 'Space Grotesk',
                }}>
                  Responses
                </div>
              </div>
              <div style={{ width: '1px', height: '40px', backgroundColor: '#E5E8EC' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#717F90',
                  fontFamily: 'Space Grotesk',
                }}>
                  {uniqueValueCount.toLocaleString()}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#717F90',
                  fontFamily: 'Space Grotesk',
                }}>
                  Unique
                </div>
              </div>
            </div>

            {/* Free Text Analyzer Button */}
            <button
              onClick={openFreeTextAnalyzer}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'linear-gradient(135deg, #3A8518 0%, #22c55e 100%)',
                color: 'white',
                padding: '10px 20px',
                borderRadius: '8px',
                fontFamily: 'Space Grotesk',
                fontWeight: 600,
                fontSize: '14px',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(58, 133, 24, 0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              Free Text Analyzer
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>

            {/* Copy to Clipboard Button */}
            <button
              onClick={handleCopyToClipboard}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#f9fafb',
                color: '#717F90',
                border: '1px solid #e5e7eb',
                padding: '10px 20px',
                borderRadius: '8px',
                fontFamily: 'Space Grotesk',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f3f4f6'
                e.currentTarget.style.borderColor = '#d1d5db'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#f9fafb'
                e.currentTarget.style.borderColor = '#e5e7eb'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </button>
          </div>

          {/* Word Cloud */}
          {totalResponses > 0 ? (
            <WordCloudCanvas
              textData={rawTextResponses}
              questionLabel={questionLabel}
              containerWidth={containerWidth}
              containerHeight={effectiveHeight}
            />
          ) : (
            <div style={{
              width: '100%',
              height: effectiveHeight,
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
        </div>
      </div>

      {/* Height resize handle */}
      <div
        onMouseDown={handleHeightResizeStart}
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '0',
          transform: 'translateX(-50%)',
          width: '80px',
          height: '20px',
          cursor: 'ns-resize',
          backgroundColor: isResizingHeight ? 'rgba(58, 133, 24, 0.3)' : 'transparent',
          transition: 'background-color 0.15s ease',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '4px',
        }}
        onMouseEnter={(e) => {
          if (!isResizingHeight) {
            e.currentTarget.style.backgroundColor = 'rgba(58, 133, 24, 0.2)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizingHeight) {
            e.currentTarget.style.backgroundColor = 'transparent'
          }
        }}
      >
        <div style={{
          width: '40px',
          height: '3px',
          backgroundColor: isResizingHeight ? '#3A8518' : '#CED6DE',
          borderRadius: '2px',
          transition: 'background-color 0.15s ease',
        }} />
      </div>
    </div>
  )
}
