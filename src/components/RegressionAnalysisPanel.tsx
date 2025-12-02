/**
 * RegressionAnalysisPanel Component
 *
 * UI for configuring and displaying regression analysis results.
 * Allows users to isolate the effect of different segment categories
 * when comparing groups.
 */

import React, { useMemo, useState } from 'react'
import type { ParsedCSV, QuestionDef, SegmentDef } from '../types'
import {
  runRegressionAnalysis,
  getAvailableControlVariables,
} from '../regressionAnalysis'
import type {
  FullRegressionAnalysis,
  RegressionAnalysisConfig,
  OptionAnalysisResult
} from '../regressionAnalysis'

interface RegressionAnalysisPanelProps {
  dataset: ParsedCSV
  questions: QuestionDef[]
  currentSegments: SegmentDef[]
  onClose: () => void
}

export const RegressionAnalysisPanel: React.FC<RegressionAnalysisPanelProps> = ({
  dataset,
  questions,
  currentSegments,
  onClose
}) => {
  // State for configuration - all hooks must be called before any early returns
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number>(-1)
  const [primaryColumn, setPrimaryColumn] = useState<string>('')
  const [referenceGroup, setReferenceGroup] = useState<string>('')
  const [targetGroup, setTargetGroup] = useState<string>('')
  const [selectedControls, setSelectedControls] = useState<string[]>([])
  const [analysisType, _setAnalysisType] = useState<'stratified' | 'propensity' | 'all'>('all')

  // State for results
  const [results, setResults] = useState<FullRegressionAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false)

  // Filter questions to only include analyzable types (exclude open text)
  const filteredQuestions = useMemo(() => {
    if (!questions) return []
    return questions.filter(q => {
      const labelLower = q.label.toLowerCase()

      // Exclude questions with "(text)" in the label
      if (labelLower.includes('(text)')) return false

      // Exclude questions with "(text)" in column headers or option labels
      const columnHasTextToken = q.columns.some(col =>
        col.header.toLowerCase().includes('(text)') ||
        col.optionLabel.toLowerCase().includes('(text)')
      )
      if (columnHasTextToken) return false

      // Exclude questions with "(text)" in source column
      if (q.singleSourceColumn) {
        const singleLower = q.singleSourceColumn.toLowerCase()
        if (singleLower.includes('(text)')) return false
      }

      // Include: single, multi, ranking, likert, and sentiment questions
      const validTypes = ['single', 'multi', 'ranking']
      if (validTypes.includes(q.type)) return true
      // Also include if it's a Likert question
      if (q.isLikert) return true
      // Include sentiment questions (check label)
      if (labelLower.includes('(sentiment)')) return true

      return false
    })
  }, [questions])

  // Get the currently selected question (null if none selected)
  const selectedQuestion = selectedQuestionIndex >= 0 ? filteredQuestions?.[selectedQuestionIndex] : null

  // Get available control variables
  const availableControls = useMemo(() =>
    getAvailableControlVariables(dataset),
    [dataset]
  )

  // Get unique values for primary comparison column
  const primaryColumnValues = useMemo(() => {
    if (!primaryColumn) return []
    const control = availableControls.find(c => c.column === primaryColumn)
    return control?.values || []
  }, [primaryColumn, availableControls])

  // Initialize from current segments if available
  React.useEffect(() => {
    if (currentSegments.length >= 2) {
      const columns = [...new Set(currentSegments.map(s => s.column))]
      if (columns.length === 1 && columns[0] !== 'Overall') {
        setPrimaryColumn(columns[0])
        setReferenceGroup(currentSegments[0].value)
        setTargetGroup(currentSegments[1].value)
      }
    }
  }, [currentSegments])

  // Early return if no questions available
  if (!questions || questions.length === 0) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}
        onClick={onClose}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            padding: '40px',
            textAlign: 'center'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p style={{ color: '#6b7280' }}>No questions available for analysis.</p>
          <button
            onClick={onClose}
            style={{
              marginTop: '16px',
              padding: '10px 20px',
              backgroundColor: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  // Run analysis
  const handleRunAnalysis = () => {
    if (!selectedQuestion || !primaryColumn || !referenceGroup || !targetGroup || selectedControls.length === 0) {
      return
    }

    setIsAnalyzing(true)

    setTimeout(() => {
      try {
        const config: RegressionAnalysisConfig = {
          primaryComparison: {
            column: primaryColumn,
            referenceGroup,
            targetGroup
          },
          controlVariables: selectedControls.map(col => ({
            column: col,
            type: 'categorical' as const
          })),
          analysisType
        }

        const analysisResults = runRegressionAnalysis(dataset, selectedQuestion, config)
        setResults(analysisResults)
        setSectionsCollapsed(true) // Collapse sections after successful analysis
      } catch (error) {
        console.error('Analysis error:', error)
      } finally {
        setIsAnalyzing(false)
      }
    }, 100)
  }

  // Handle "Run Another Analysis" - expand sections
  const handleRunAnother = () => {
    setSectionsCollapsed(false)
  }

  const canRunAnalysis = primaryColumn && referenceGroup && targetGroup && selectedControls.length > 0

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          maxWidth: '800px',
          width: '100%',
          maxHeight: 'calc(100vh - 40px)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 28px',
            borderBottom: '1px solid #e5e7eb',
            background: 'linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: '#dcfce7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                <path d="M7 21h10" />
                <path d="M12 3v18" />
                <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
              </svg>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#111827' }}>
                Apples-to-Apples Comparison
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#6b7280' }}>
                Compare groups fairly by accounting for demographic differences
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '28px'
          }}
        >
          {/* Info tooltip - shown on hover */}
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: '20px' }}>
            <div
              className="info-tooltip-trigger"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'help',
                color: '#6b7280',
                fontSize: '13px'
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
              </svg>
              <span>What does this do?</span>
            </div>
            <div
              className="info-tooltip-content"
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '8px',
                backgroundColor: '#14532d',
                color: '#f0fdf4',
                padding: '14px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                lineHeight: '1.5',
                width: '320px',
                zIndex: 100,
                boxShadow: '0 10px 25px -5px rgba(58, 133, 24, 0.3)',
                opacity: 0,
                visibility: 'hidden',
                transition: 'opacity 0.2s, visibility 0.2s'
              }}
            >
              <p style={{ margin: '0 0 8px 0' }}>
                When comparing groups (e.g., Panel vs CRM), demographic differences can skew results.
              </p>
              <p style={{ margin: 0 }}>
                This analysis <strong style={{ color: '#86efac' }}>adjusts for demographics</strong> to show the "true" difference between groups, controlling for factors like Gender and Age.
              </p>
              <div
                style={{
                  position: 'absolute',
                  top: '-6px',
                  left: '20px',
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#14532d',
                  transform: 'rotate(45deg)'
                }}
              />
            </div>
          </div>

          {/* Collapsible Sections Container */}
          <div
            style={{
              maxHeight: sectionsCollapsed ? '0px' : '2000px',
              overflow: 'hidden',
              transition: 'max-height 0.4s ease-in-out, opacity 0.3s ease-in-out',
              opacity: sectionsCollapsed ? 0 : 1
            }}
          >
          {/* Step 1: Select Question */}
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#dcfce7',
                  color: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700
                }}
              >
                1
              </span>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Question to Analyze
              </h3>
            </div>

            <div
              style={{
                backgroundColor: '#f9fafb',
                borderRadius: '12px',
                padding: '20px'
              }}
            >
              <select
                value={selectedQuestionIndex}
                onChange={(e) => {
                  setSelectedQuestionIndex(Number(e.target.value))
                  setResults(null) // Clear previous results when question changes
                }}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '14px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value={-1}>Select question...</option>
                {filteredQuestions?.map((q, idx) => (
                  <option key={`question-${idx}`} value={idx}>
                    {q.label}
                  </option>
                ))}
              </select>

            </div>
          </div>

          {/* Step 2: Select Groups */}
          <div style={{ marginBottom: '28px', position: 'relative' }}>
            {/* Overlay when section is not yet accessible */}
            {!selectedQuestion && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(255, 255, 255, 0.6)',
                  borderRadius: '12px',
                  zIndex: 10,
                  cursor: 'not-allowed'
                }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: selectedQuestion ? '#dcfce7' : '#e5e7eb',
                  color: selectedQuestion ? '#16a34a' : '#9ca3af',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                  transition: 'all 0.2s'
                }}
              >
                2
              </span>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: selectedQuestion ? '#374151' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', transition: 'color 0.2s' }}>
                Groups to Compare
              </h3>
            </div>

            <div
              style={{
                backgroundColor: '#f9fafb',
                borderRadius: '12px',
                padding: '20px'
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#4b5563', marginBottom: '8px' }}>
                    Comparison Segment
                  </label>
                  <select
                    value={primaryColumn}
                    onChange={(e) => {
                      const newColumn = e.target.value
                      setPrimaryColumn(newColumn)

                      // Set smart defaults based on the selected column
                      const control = availableControls.find(c => c.column === newColumn)
                      const values = control?.values || []
                      const lowerLabel = control?.label?.toLowerCase() || ''
                      const lowerColumn = newColumn.toLowerCase()

                      // Check for Gender
                      if (lowerLabel.includes('gender') || lowerColumn.includes('gender')) {
                        const male = values.find(v => v.toLowerCase() === 'male')
                        const female = values.find(v => v.toLowerCase() === 'female')
                        if (male && female) {
                          setReferenceGroup(male)
                          setTargetGroup(female)
                          return
                        }
                      }

                      // Check for Audience Type
                      if (lowerLabel.includes('audience') || lowerColumn.includes('audience')) {
                        const crm = values.find(v => v.toLowerCase() === 'crm')
                        const panel = values.find(v => v.toLowerCase() === 'panel')
                        if (crm && panel) {
                          setReferenceGroup(crm)
                          setTargetGroup(panel)
                          return
                        }
                      }

                      // No smart defaults, reset
                      setReferenceGroup('')
                      setTargetGroup('')
                    }}
                    disabled={!selectedQuestion}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      backgroundColor: '#ffffff',
                      cursor: selectedQuestion ? 'pointer' : 'not-allowed',
                      outline: 'none'
                    }}
                  >
                    <option value="">Select segment...</option>
                    {availableControls.map((control, idx) => (
                      <option key={`primary-${control.column}-${idx}`} value={control.column}>
                        {control.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#4b5563', marginBottom: '8px' }}>
                    Baseline Group
                  </label>
                  <select
                    value={referenceGroup}
                    onChange={(e) => setReferenceGroup(e.target.value)}
                    disabled={!primaryColumn}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      backgroundColor: !primaryColumn ? '#f3f4f6' : '#ffffff',
                      cursor: !primaryColumn ? 'not-allowed' : 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value="">Select baseline...</option>
                    {primaryColumnValues
                      .filter(v => v !== targetGroup)
                      .map((value, idx) => (
                        <option key={`ref-${value}-${idx}`} value={value}>{value}</option>
                      ))
                    }
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#4b5563', marginBottom: '8px' }}>
                    Compare To
                  </label>
                  <select
                    value={targetGroup}
                    onChange={(e) => setTargetGroup(e.target.value)}
                    disabled={!primaryColumn}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      backgroundColor: !primaryColumn ? '#f3f4f6' : '#ffffff',
                      cursor: !primaryColumn ? 'not-allowed' : 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value="">Select group...</option>
                    {primaryColumnValues
                      .filter(v => v !== referenceGroup)
                      .map((value, idx) => (
                        <option key={`target-${value}-${idx}`} value={value}>{value}</option>
                      ))
                    }
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3: Control Variables */}
          {(() => {
            const step3Active = selectedQuestion && primaryColumn && referenceGroup && targetGroup
            return (
              <div style={{ marginBottom: '28px', position: 'relative' }}>
                {/* Overlay when section is not yet accessible */}
                {!step3Active && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(255, 255, 255, 0.6)',
                      borderRadius: '12px',
                      zIndex: 10,
                      cursor: 'not-allowed'
                    }}
                  />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <span
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: step3Active ? '#dcfce7' : '#e5e7eb',
                      color: step3Active ? '#16a34a' : '#9ca3af',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      fontWeight: 700,
                      transition: 'all 0.2s'
                    }}
                  >
                    3
                  </span>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: step3Active ? '#374151' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', transition: 'color 0.2s' }}>
                    Demographics to Control For
                  </h3>
                </div>

                <div
                  style={{
                    backgroundColor: '#f9fafb',
                    borderRadius: '12px',
                    padding: '20px'
                  }}
                >
                  <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#6b7280' }}>
                    Choose variables that might be confounding the comparison (e.g., if CRM skews female, select Gender)
                  </p>

                  <select
                    value=""
                    onChange={(e) => {
                      const value = e.target.value
                      if (value && !selectedControls.includes(value)) {
                        setSelectedControls([...selectedControls, value])
                      }
                    }}
                    disabled={!step3Active}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '14px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      backgroundColor: '#ffffff',
                      cursor: step3Active ? 'pointer' : 'not-allowed',
                      outline: 'none'
                    }}
                  >
                    <option value="">Select demographic...</option>
                    {availableControls
                      .filter(c => c.column !== primaryColumn && !selectedControls.includes(c.column))
                      .map((control, idx) => (
                        <option key={`control-${control.column}-${idx}`} value={control.column}>
                          {control.label}
                        </option>
                      ))
                    }
                  </select>

                  {selectedControls.length > 0 && (
                    <div
                      style={{
                        marginTop: '12px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px'
                      }}
                    >
                      {selectedControls.map((col, idx) => {
                        const control = availableControls.find(c => c.column === col)
                        return (
                          <span
                            key={`selected-${col}-${idx}`}
                            style={{
                              padding: '6px 10px',
                              borderRadius: '16px',
                              fontSize: '13px',
                              fontWeight: 500,
                              backgroundColor: '#dcfce7',
                              color: '#16a34a',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                          >
                            {control?.label || col}
                            <button
                              onClick={() => setSelectedControls(selectedControls.filter(c => c !== col))}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: '0',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#16a34a'
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}

                </div>
              </div>
            )
          })()}

          {/* Run Button */}
          {(() => {
            const buttonActive = selectedControls.length > 0
            return (
              <div style={{ position: 'relative' }}>
                {/* Overlay when button is not yet accessible */}
                {!buttonActive && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(255, 255, 255, 0.6)',
                      borderRadius: '10px',
                      zIndex: 10,
                      cursor: 'not-allowed'
                    }}
                  />
                )}
                <button
                  onClick={handleRunAnalysis}
                  disabled={!canRunAnalysis || isAnalyzing}
                  style={{
                    width: '100%',
                    padding: '14px 24px',
                    fontSize: '15px',
                    fontWeight: 600,
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: buttonActive ? '#16a34a' : '#d1d5db',
                    color: '#ffffff',
                    cursor: buttonActive && canRunAnalysis ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    transition: 'all 0.2s',
                    marginBottom: '8px'
                  }}
                  onMouseEnter={(e) => {
                    if (buttonActive && canRunAnalysis) e.currentTarget.style.backgroundColor = '#15803d'
                  }}
                  onMouseLeave={(e) => {
                    if (buttonActive) e.currentTarget.style.backgroundColor = '#16a34a'
                  }}
                >
                  {isAnalyzing ? (
                    <>
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          border: '2px solid rgba(255,255,255,0.3)',
                          borderTopColor: '#ffffff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }}
                      />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 3v18h18" />
                        <path d="M18 9l-5 5-4-4-3 3" />
                      </svg>
                      Run Analysis
                    </>
                  )}
                </button>
              </div>
            )
          })()}
          </div>
          {/* End Collapsible Sections Container */}

          {/* Run Another Analysis Button - shown when sections are collapsed */}
          {sectionsCollapsed && results && (
            <button
              onClick={handleRunAnother}
              style={{
                width: '100%',
                padding: '14px 24px',
                fontSize: '15px',
                fontWeight: 600,
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#16a34a',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                transition: 'background-color 0.2s',
                marginBottom: '8px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#15803d'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#16a34a'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18" />
                <path d="M18 9l-5 5-4-4-3 3" />
              </svg>
              Run Another Analysis
            </button>
          )}

          {/* Results Section */}
          {results && (
            <div style={{ marginTop: '32px', paddingTop: '28px', borderTop: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: '#dbeafe',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 700
                  }}
                >
                  4
                </span>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Results
                </h3>
              </div>

              {/* Summary Card - Main results */}
              <SummaryCard results={results} controlVariables={selectedControls} />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .info-tooltip-trigger:hover + .info-tooltip-content,
        .info-tooltip-content:hover {
          opacity: 1 !important;
          visibility: visible !important;
        }
      `}</style>
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

interface SummaryCardProps {
  results: FullRegressionAnalysis
  controlVariables: string[]
}

const SummaryCard: React.FC<SummaryCardProps> = ({ results, controlVariables }) => {
  const { summary, config, optionResults } = results

  // Format control variables for display
  const controlsLabel = controlVariables.length > 0
    ? controlVariables.join(' & ')
    : 'Demographics'

  // Get comparison groups
  const targetGroup = config.primaryComparison.targetGroup
  const referenceGroup = config.primaryComparison.referenceGroup

  // Separate significant and insignificant options
  const significantOptions = optionResults?.filter(o => o.isSignificant) || []
  const insignificantOptions = optionResults?.filter(o => !o.isSignificant) || []

  return (
    <div>
      {/* Interpretation Header */}
      <div
        style={{
          backgroundColor: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: '10px',
          padding: '18px',
          marginBottom: '20px'
        }}
      >
        <div style={{ display: 'flex', gap: '12px' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0369a1" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <p style={{ margin: 0, fontSize: '14px', color: '#0c4a6e', lineHeight: '1.6' }}>
            {summary.interpretation}
          </p>
        </div>
      </div>

      {/* Significant Differences Section */}
      {significantOptions.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{
            fontSize: '13px',
            fontWeight: 600,
            color: '#16a34a',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Significant Differences ({'>'}5% gap after adjustment)
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {significantOptions.map((option, idx) => (
              <OptionResultRow
                key={`sig-${idx}`}
                option={option}
                targetGroup={targetGroup}
                referenceGroup={referenceGroup}
                isSignificant={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      {significantOptions.length > 0 && insignificantOptions.length > 0 && (
        <div style={{
          borderTop: '1px dashed #d1d5db',
          margin: '20px 0',
          position: 'relative'
        }}>
          <span style={{
            position: 'absolute',
            top: '-10px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#ffffff',
            padding: '0 12px',
            fontSize: '11px',
            color: '#9ca3af',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Below threshold
          </span>
        </div>
      )}

      {/* Insignificant Differences Section */}
      {insignificantOptions.length > 0 && (
        <div>
          <div style={{
            fontSize: '13px',
            fontWeight: 500,
            color: '#6b7280',
            marginBottom: '12px'
          }}>
            {significantOptions.length === 0 ? 'All Options' : 'Other Options'} ({'<'}5% gap)
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {insignificantOptions.map((option, idx) => (
              <OptionResultRow
                key={`insig-${idx}`}
                option={option}
                targetGroup={targetGroup}
                referenceGroup={referenceGroup}
                isSignificant={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Note about methodology */}
      <div style={{
        marginTop: '24px',
        padding: '12px 16px',
        backgroundColor: '#f9fafb',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#6b7280'
      }}>
        <strong>Note:</strong> Results are adjusted for {controlsLabel} using stratified analysis.
        Gaps {'<'}5% are considered not statistically meaningful.
      </div>
    </div>
  )
}

interface OptionResultRowProps {
  option: OptionAnalysisResult
  targetGroup: string
  referenceGroup: string
  isSignificant: boolean
}

const OptionResultRow: React.FC<OptionResultRowProps> = ({
  option,
  targetGroup,
  referenceGroup,
  isSignificant
}) => {
  const absGap = Math.abs(option.adjustedDifference)

  return (
    <div
      style={{
        backgroundColor: isSignificant ? '#f0fdf4' : '#f9fafb',
        border: isSignificant ? '1px solid #bbf7d0' : '1px solid #e5e7eb',
        borderRadius: '10px',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 500,
          color: '#111827',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {option.option}
        </div>
        <div style={{
          fontSize: '12px',
          color: '#6b7280',
          marginTop: '4px'
        }}>
          {targetGroup}: {option.targetGroupPercent.toFixed(0)}% • {referenceGroup}: {option.referenceGroupPercent.toFixed(0)}%
        </div>
      </div>

      <div style={{
        textAlign: 'right',
        flexShrink: 0
      }}>
        <div style={{
          fontSize: '15px',
          fontWeight: 600,
          color: isSignificant ? '#16a34a' : '#6b7280'
        }}>
          {option.favoredGroupLabel}
        </div>
        {!isSignificant && absGap < 1 && (
          <div style={{
            fontSize: '11px',
            color: '#9ca3af',
            marginTop: '2px'
          }}>
            No meaningful difference
          </div>
        )}
      </div>
    </div>
  )
}

export default RegressionAnalysisPanel
