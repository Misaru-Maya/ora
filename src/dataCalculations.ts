import type { ParsedCSV, QuestionDef, SortOrder, SegmentDef, ComparisonSet, ProductBucket } from './types'
import { stripQuotes } from './utils'

// Performance: Disable console logs in production
const isDev = process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}

// Custom rounding function using standard rounding (>0.5)
export function customRound(value: number): number {
  return Math.round(value)
}

export interface GroupSeriesMeta {
  label: string
  key: string
}

export interface SeriesDataPoint {
  option: string
  optionDisplay: string
  significance: Array<{
    pair: [string, string]
    chiSquare: number
    significant: boolean
  }>
  groupSummaries: Array<{
    label: string
    count: number
    denominator: number
    percent: number
  }>
  [groupKey: string]: number | string | Array<{
    pair: [string, string]
    chiSquare: number
    significant: boolean
  }> | Array<{
    label: string
    count: number
    denominator: number
    percent: number
  }>
}

export interface BuildSeriesArgs {
  dataset: ParsedCSV
  question: QuestionDef
  segmentColumn?: string
  groups?: string[]
  segments?: SegmentDef[]  // New: supports multiple columns
  sortOrder: SortOrder
}

export interface BuildSeriesResult {
  data: SeriesDataPoint[]
  groups: GroupSeriesMeta[]
}

const EXCLUDED_LABELS = ['other', 'not specified', 'none of the above', 'no preference', 'prefer not to say']

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

// Detect if a question is about money/income
function isMoneyQuestion(question: QuestionDef): boolean {
  const label = question.label.toLowerCase()
  const keywords = ['income', 'salary', 'earn', 'wage', 'pay', 'household income', 'annual income', 'revenue', '$', '£', '€', 'price', 'cost']
  return keywords.some(keyword => label.includes(keyword))
}

// Parse monetary value from text for sorting
function parseMoneyValue(text: string): number {
  // Handle "Prefer not to say" and similar - put at end
  if (/prefer not|rather not|decline|not say/i.test(text)) {
    return Number.MAX_SAFE_INTEGER
  }

  // Extract first number with optional currency symbols
  // Matches: $25,000 or £25,000 or 25,000 or 25000
  const match = text.match(/[\$£€]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/i)

  if (match) {
    // Remove commas and parse
    const baseValue = parseInt(match[1].replace(/,/g, ''), 10)

    // Handle "Under" prefix - should sort before the value
    if (/^under\s+/i.test(text)) {
      return baseValue - 0.5
    }

    // Handle "Over" prefix - should sort after the value
    if (/^over\s+/i.test(text)) {
      return baseValue + 0.5
    }

    return baseValue
  }

  return 0
}

export function buildSeries({
  dataset, question, segmentColumn, groups, segments, sortOrder
}: BuildSeriesArgs): BuildSeriesResult {
  // Support both old API (segmentColumn + groups) and new API (segments)
  const effectiveSegments: SegmentDef[] = segments || (
    segmentColumn && groups
      ? groups.map(value => ({ column: segmentColumn, value }))
      : []
  )

  if (!effectiveSegments.length) {
    return { data: [], groups: [] }
  }
  const rows = dataset.rows

  const respIdCol = dataset.summary.columns.find(
    c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
  ) || dataset.summary.columns[0]

  // Always calculate Overall values for sorting, even if Overall is not in effectiveSegments
  const overallInfo = {
    rows: rows,
    uniqueRespondents: uniq(rows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean)),
    singleCounts: undefined as Record<string, number> | undefined,
    singleDenom: undefined as number | undefined
  }

  const groupInfo = effectiveSegments.reduce<Map<string, {
    rows: Record<string, any>[]
    uniqueRespondents: string[]
    singleCounts?: Record<string, number>
    singleDenom?: number
  }>>((map, segment) => {
    const groupLabel = segment.value

    // Handle "Overall" as a special case: include ALL rows
    if (segment.value === 'Overall') {
      const respondentIds = uniq(rows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean))
      map.set(groupLabel, {
        rows: rows,
        uniqueRespondents: respondentIds
      })
      return map
    }

    // Check if segment.column is a question ID (consumer question used as segment)
    const segmentQuestion = dataset.questions.find(q => q.qid === segment.column)

    let filtered: Record<string, any>[]

    if (segmentQuestion) {
      // This is a consumer question used as a segment
      devLog(`[FILTER] Consumer question segment: ${segmentQuestion.qid} (${segmentQuestion.type}), value: ${segment.value}`)

      if (segmentQuestion.type === 'single' && segmentQuestion.singleSourceColumn) {
        // Single-select question: filter by the value in the source column
        devLog(`[FILTER] Single-select filtering by column: ${segmentQuestion.singleSourceColumn}, looking for value: "${segment.value}"`)
        filtered = rows.filter(r => {
          const cellValue = stripQuotes(String(r[segmentQuestion.singleSourceColumn!]))
          const targetValue = stripQuotes(segment.value)
          return cellValue === targetValue
        })
        devLog(`[FILTER] Filtered ${filtered.length} rows out of ${rows.length}`)

        // Debug if no matches found
        if (filtered.length === 0 && rows.length > 0) {
          devLog(`[FILTER] ⚠️ No matches for single-select. Sampling first 5 values from column "${segmentQuestion.singleSourceColumn}":`)
          rows.slice(0, 5).forEach((r, i) => {
            const val = r[segmentQuestion.singleSourceColumn!]
            devLog(`  Row ${i}: "${val}" (stripped: "${stripQuotes(String(val))}")`)
          })
          devLog(`[FILTER] Available options:`, segmentQuestion.columns.map(c => c.optionLabel))
        }
      } else if (segmentQuestion.type === 'multi') {
        // Multi-select question: find the column for this option
        const optionColumn = segmentQuestion.columns.find(col => col.optionLabel === segment.value)
        devLog(`[FILTER] Multi-select option column:`, optionColumn)
        if (optionColumn) {
          // Check for alternate headers (case-insensitive duplicates)
          const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
          devLog(`[FILTER] Checking headers:`, headersToCheck)

          // Filter rows where this option's column has a truthy value (1, "1", true, etc.)
          filtered = rows.filter(r => {
            // Check all possible headers for this option
            return headersToCheck.some(header => {
              const val = r[header]
              const isTruthy = val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
              if (isTruthy) {
                devLog(`[FILTER] Match found in header "${header}" with value:`, val)
              }
              return isTruthy
            })
          })
          devLog(`[FILTER] Filtered ${filtered.length} rows out of ${rows.length} for option "${segment.value}"`)

          // Sample first few rows to debug
          if (filtered.length === 0 && rows.length > 0) {
            devLog(`[FILTER] ⚠️ No matches found. Sampling first row:`, rows[0])
            headersToCheck.forEach(header => {
              devLog(`[FILTER] Header "${header}" values in first 5 rows:`, rows.slice(0, 5).map(r => r[header]))
            })
          }
        } else {
          devLog(`[FILTER] ❌ Option column not found for: ${segment.value}`)
          devLog(`[FILTER] Available options:`, segmentQuestion.columns.map(c => c.optionLabel))
          filtered = []
        }
      } else {
        // Unsupported question type for segmentation
        devLog(`[FILTER] ❌ Unsupported question type: ${segmentQuestion.type}`)
        filtered = []
      }
    } else {
      // Regular segment column (Age, Gender, etc.)
      devLog(`[FILTER] Regular segment: ${segment.column} = ${segment.value}`)
      filtered = rows.filter(r => stripQuotes(String(r[segment.column])) === stripQuotes(segment.value))
      devLog(`[FILTER] Filtered ${filtered.length} rows out of ${rows.length}`)
    }

    const respondentIds = uniq(filtered.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean))
    map.set(groupLabel, {
      rows: filtered,
      uniqueRespondents: respondentIds
    })
    return map
  }, new Map())

  if (question.type !== 'multi' && question.singleSourceColumn) {
    // Calculate Overall counts first
    const overallCounts: Record<string, number> = {}
    if (question.level === 'row' || dataset.summary.isProductTest) {
      // COUNT AT RESPONDENT LEVEL: Count unique respondents (changed from row-level)
      const seen = new Map<string, string>()
      for (const r of overallInfo.rows) {
        const respondent = stripQuotes(String(r[respIdCol] ?? '').trim())
        if (!respondent) continue
        const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
        if (!value) continue
        // Only count first response from each respondent
        if (!seen.has(respondent)) {
          seen.set(respondent, value)
        }
      }
      seen.forEach(value => {
        const normalized = value.toLowerCase()
        overallCounts[normalized] = (overallCounts[normalized] || 0) + 1
      })
      overallInfo.singleCounts = overallCounts
      overallInfo.singleDenom = seen.size
    } else {
      const seen = new Map<string, string>()
      for (const r of overallInfo.rows) {
        const respondent = stripQuotes(String(r[respIdCol] ?? '').trim())
        if (!respondent || seen.has(respondent)) continue
        const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
        if (!value) continue
        seen.set(respondent, value)
      }
      seen.forEach(value => {
        const normalized = value.toLowerCase()
        overallCounts[normalized] = (overallCounts[normalized] || 0) + 1
      })
      overallInfo.singleCounts = overallCounts
      overallInfo.singleDenom = seen.size
    }

    // Calculate counts for each selected segment
    for (const [_groupLabel, info] of groupInfo.entries()) {
      const counts: Record<string, number> = {}

      // COUNT AT RESPONDENT LEVEL: Count unique respondents (changed from row-level)
      if (question.level === 'row' || dataset.summary.isProductTest) {
        const seen = new Map<string, string>()
        for (const r of info.rows) {
          const respondent = stripQuotes(String(r[respIdCol] ?? '').trim())
          if (!respondent) continue
          const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
          if (!value) continue
          // Only count first response from each respondent
          if (!seen.has(respondent)) {
            seen.set(respondent, value)
          }
        }
        seen.forEach(value => {
          const normalized = value.toLowerCase()
          counts[normalized] = (counts[normalized] || 0) + 1
        })
        info.singleCounts = counts
        info.singleDenom = seen.size
      } else {
        // For respondent-level questions, count unique respondents
        const seen = new Map<string, string>()
        for (const r of info.rows) {
          const respondent = stripQuotes(String(r[respIdCol] ?? '').trim())
          if (!respondent || seen.has(respondent)) continue
          const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
          if (!value) continue
          seen.set(respondent, value)
        }
        // Count case-insensitively by normalizing to lowercase
        seen.forEach(value => {
          const normalized = value.toLowerCase()
          counts[normalized] = (counts[normalized] || 0) + 1
        })
        info.singleCounts = counts
        info.singleDenom = seen.size
      }
    }
  }

  const normalizeValue = (value: unknown) => {
    if (value === null || value === undefined) return ''
    return stripQuotes(String(value).trim())
  }

  const _shouldExcludeLabel = (label: string) => {
    const normalized = normalizeValue(label).toLowerCase()
    return !normalized || EXCLUDED_LABELS.some(ex => normalized === ex || normalized.includes(ex))
  }

  const groupMeta: GroupSeriesMeta[] = []
  const usedKeys = new Set<string>()
  const getKeyForGroup = (label: string, index: number) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `group_${index + 1}`
    let key = base
    let counter = 1
    while (usedKeys.has(key)) {
      key = `${base}_${counter}`
      counter += 1
    }
    usedKeys.add(key)
    return key
  }

  effectiveSegments.forEach((segment, index) => {
    const key = getKeyForGroup(segment.value, index)
    groupMeta.push({ label: segment.value, key })
  })

  const dataWithIndex = question.columns.map((col, originalIndex) => {
    const optionLabel = normalizeValue(col.optionLabel)
    // Skip empty/blank labels entirely
    if (!optionLabel || optionLabel.trim() === '') {
      return null
    }
    const groupSummaries: SeriesDataPoint['groupSummaries'] = []
    const row: SeriesDataPoint & { __index: number } = {
      option: optionLabel,
      optionDisplay: optionLabel,
      significance: [],
      groupSummaries,
      __index: originalIndex,
    }

    groupMeta.forEach(meta => {
      const info = groupInfo.get(meta.label)
      if (!info) {
        row[meta.key] = 0
        return
      }

      let count = 0
      let denom = 0

      if (question.type === 'multi') {
        const isRowLevel = question.level === 'row' || dataset.summary.isProductTest

        if (isRowLevel) {
          // COUNT AT RESPONDENT LEVEL: Each unique respondent is counted once (changed from row-level)
          const seen = new Set<string>()
          const answeredRespondents = new Set<string>()

          if (question.textSummaryColumn && col.header.startsWith('__TEXT_MULTI__')) {
            const optionLabelLower = optionLabel.toLowerCase()
            for (const r of info.rows) {
              const respondent = normalizeValue(r[respIdCol])
              if (!respondent) continue

              const textValue = r[question.textSummaryColumn]
              if (!textValue || textValue === '') continue

              answeredRespondents.add(respondent)

              const cleanedValue = stripQuotes(String(textValue).trim())
              const options = cleanedValue.includes('|')
                ? cleanedValue.split('|').map(opt => stripQuotes(opt.trim()).toLowerCase())
                : [cleanedValue.toLowerCase()]

              if (options.includes(optionLabelLower)) {
                seen.add(respondent)
              }
            }
          } else {
            const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
            const allQuestionHeaders = question.columns.flatMap(qCol =>
              [qCol.header, ...(qCol.alternateHeaders || [])]
            )

            for (const r of info.rows) {
              const respondent = normalizeValue(r[respIdCol])
              if (!respondent) continue

              let hasAnswerForThisRow = false
              for (const h of allQuestionHeaders) {
                const val = r[h]
                if (val === 1 || val === true || val === '1' || val === 'true' || val === 'Y') {
                  hasAnswerForThisRow = true
                  break
                }
              }
              if (!hasAnswerForThisRow) continue

              answeredRespondents.add(respondent)

              for (const header of headersToCheck) {
                const v = r[header]
                if (v === 1 || v === true || v === '1' || v === 'true' || v === 'Y') {
                  seen.add(respondent)
                  break
                }
              }
            }
          }

          count = seen.size
          denom = answeredRespondents.size
        } else {
          // COUNT AT RESPONDENT LEVEL: Each unique respondent is counted once
          const seen = new Set<string>()
          const answeredRespondents = new Set<string>()

          if (question.textSummaryColumn && col.header.startsWith('__TEXT_MULTI__')) {
            const optionLabelLower = optionLabel.toLowerCase()
            for (const r of info.rows) {
              const respondent = normalizeValue(r[respIdCol])
              if (!respondent) continue

              const textValue = r[question.textSummaryColumn]
              if (!textValue || textValue === '') continue

              answeredRespondents.add(respondent)

              const cleanedValue = stripQuotes(String(textValue).trim())
              const options = cleanedValue.includes('|')
                ? cleanedValue.split('|').map(opt => stripQuotes(opt.trim()).toLowerCase())
                : [cleanedValue.toLowerCase()]

              if (options.includes(optionLabelLower)) {
                seen.add(respondent)
              }
            }
          } else {
            for (const r of info.rows) {
              const respondent = normalizeValue(r[respIdCol])
              if (!respondent) continue

              for (const qCol of question.columns) {
                const checkHeaders = [qCol.header, ...(qCol.alternateHeaders || [])]
                for (const h of checkHeaders) {
                  const val = r[h]
                  if (val === 1 || val === true || val === '1' || val === 'true' || val === 'Y') {
                    answeredRespondents.add(respondent)
                    break
                  }
                }
                if (answeredRespondents.has(respondent)) break
              }
            }

            const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
            for (const r of info.rows) {
              const respondent = normalizeValue(r[respIdCol])
              if (!respondent) continue

              for (const header of headersToCheck) {
                const v = r[header]
                if (v === 1 || v === true || v === '1' || v === 'true' || v === 'Y') {
                  seen.add(respondent)
                  break
                }
              }
            }
          }

          count = seen.size
          denom = answeredRespondents.size
        }
      } else if (question.type === 'ranking') {
        // For ranking questions, calculate average ranking score
        const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
        const rankingsByRespondent = new Map<string, number>()

        // Collect ranking values per unique respondent (first occurrence only)
        for (const r of info.rows) {
          const respondent = normalizeValue(r[respIdCol])
          if (!respondent) continue

          // Skip if we already have a ranking for this respondent
          if (rankingsByRespondent.has(respondent)) continue

          for (const header of headersToCheck) {
            const value = r[header]
            if (value !== null && value !== undefined && value !== '') {
              const numValue = typeof value === 'number' ? value : parseFloat(String(value))
              if (!isNaN(numValue) && numValue > 0) {
                rankingsByRespondent.set(respondent, numValue)
                break
              }
            }
          }
        }

        const rankings = Array.from(rankingsByRespondent.values())

        // Calculate average ranking (lower is better)
        const avgRanking = rankings.length > 0
          ? rankings.reduce((sum, val) => sum + val, 0) / rankings.length
          : 0

        // Store the UNROUNDED average ranking for sorting (will be rounded for display later)
        row[meta.key] = avgRanking
        groupSummaries.push({
          label: meta.label,
          count: rankings.length,
          denominator: info.uniqueRespondents.length,
          percent: avgRanking // Store avg ranking in percent field for display
        })
      } else if (question.singleSourceColumn) {
        const cleanedLabel = optionLabel.toLowerCase()
        const counts = info.singleCounts || {}
        denom = info.singleDenom ?? info.uniqueRespondents.length
        count = counts[cleanedLabel] || 0
      }

      // Calculate percentage with proper rounding to avoid floating point issues
      // Round to 10 decimal places first to fix floating point precision issues
      const percent = denom ? Math.round((count / denom) * 100 * 1e10) / 1e10 : 0

      // For ranking questions, store the ranking value directly instead of percentage
      if (question.type === 'ranking') {
        // row[meta.key] is already set above, don't overwrite it
      } else {
        row[meta.key] = percent
        groupSummaries.push({
          label: meta.label,
          count,
          denominator: denom,
          percent
        })
      }
    })

    // Calculate Overall value for sorting (even if Overall is not in selected segments)
    let overallCount = 0
    let overallDenom = 0

    if (question.type === 'multi') {
      const isRowLevel = question.level === 'row' || dataset.summary.isProductTest

      if (isRowLevel) {
        // COUNT AT RESPONDENT LEVEL: Each unique respondent is counted once (changed from row-level)
        const seen = new Set<string>()
        const answeredRespondents = new Set<string>()

        if (question.textSummaryColumn && col.header.startsWith('__TEXT_MULTI__')) {
          const optionLabelLower = optionLabel.toLowerCase()
          for (const r of overallInfo.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            const textValue = r[question.textSummaryColumn]
            if (!textValue || textValue === '') continue

            answeredRespondents.add(respondent)

            const cleanedValue = stripQuotes(String(textValue).trim())
            const options = cleanedValue.includes('|')
              ? cleanedValue.split('|').map(opt => stripQuotes(opt.trim()).toLowerCase())
              : [cleanedValue.toLowerCase()]

            if (options.includes(optionLabelLower)) {
              seen.add(respondent)
            }
          }
        } else {
          const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
          const allQuestionHeaders = question.columns.flatMap(qCol =>
            [qCol.header, ...(qCol.alternateHeaders || [])]
          )

          for (const r of overallInfo.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            let hasAnswerForThisRow = false
            for (const h of allQuestionHeaders) {
              const val = r[h]
              if (val === 1 || val === true || val === '1' || val === 'true' || val === 'Y') {
                hasAnswerForThisRow = true
                break
              }
            }
            if (!hasAnswerForThisRow) continue

            answeredRespondents.add(respondent)

            for (const header of headersToCheck) {
              const v = r[header]
              if (v === 1 || v === true || v === '1' || v === 'true' || v === 'Y') {
                seen.add(respondent)
                break
              }
            }
          }
        }

        overallCount = seen.size
        overallDenom = answeredRespondents.size
      } else {
        const seen = new Set<string>()
        const answeredRespondents = new Set<string>()

        if (question.textSummaryColumn && col.header.startsWith('__TEXT_MULTI__')) {
          const optionLabelLower = optionLabel.toLowerCase()
          for (const r of overallInfo.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            const textValue = r[question.textSummaryColumn]
            if (!textValue || textValue === '') continue

            answeredRespondents.add(respondent)

            const cleanedValue = stripQuotes(String(textValue).trim())
            const options = cleanedValue.includes('|')
              ? cleanedValue.split('|').map(opt => stripQuotes(opt.trim()).toLowerCase())
              : [cleanedValue.toLowerCase()]

            if (options.includes(optionLabelLower)) {
              seen.add(respondent)
            }
          }
        } else {
          for (const r of overallInfo.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            for (const qCol of question.columns) {
              const checkHeaders = [qCol.header, ...(qCol.alternateHeaders || [])]
              for (const h of checkHeaders) {
                const val = r[h]
                if (val === 1 || val === true || val === '1' || val === 'true' || val === 'Y') {
                  answeredRespondents.add(respondent)
                  break
                }
              }
              if (answeredRespondents.has(respondent)) break
            }
          }

          const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
          for (const r of overallInfo.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            for (const header of headersToCheck) {
              const v = r[header]
              if (v === 1 || v === true || v === '1' || v === 'true' || v === 'Y') {
                seen.add(respondent)
                break
              }
            }
          }
        }

        overallCount = seen.size
        overallDenom = answeredRespondents.size
      }
    } else if (question.type === 'ranking') {
      const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
      const rankingsByRespondent = new Map<string, number>()

      // Collect ranking values per unique respondent (first occurrence only)
      for (const r of overallInfo.rows) {
        const respondent = normalizeValue(r[respIdCol])
        if (!respondent) continue

        // Skip if we already have a ranking for this respondent
        if (rankingsByRespondent.has(respondent)) continue

        for (const header of headersToCheck) {
          const value = r[header]
          if (value !== null && value !== undefined && value !== '') {
            const numValue = typeof value === 'number' ? value : parseFloat(String(value))
            if (!isNaN(numValue) && numValue > 0) {
              rankingsByRespondent.set(respondent, numValue)
              break
            }
          }
        }
      }

      const rankings = Array.from(rankingsByRespondent.values())
      const avgRanking = rankings.length > 0
        ? rankings.reduce((sum, val) => sum + val, 0) / rankings.length
        : 0

      // For ranking questions, store the UNROUNDED ranking value for accurate sorting
      row['__overallValue' as any] = avgRanking
    } else if (question.singleSourceColumn) {
      const cleanedLabel = optionLabel.toLowerCase()
      const counts = overallInfo.singleCounts || {}
      overallDenom = overallInfo.singleDenom ?? overallInfo.uniqueRespondents.length
      overallCount = counts[cleanedLabel] || 0
    }

    // Store Overall percentage for non-ranking questions
    if (question.type !== 'ranking') {
      const overallPercent = overallDenom ? Math.round((overallCount / overallDenom) * 100 * 1e10) / 1e10 : 0
      row['__overallValue' as any] = overallPercent
    }

    // Compute chi-square significance for each pair of groups
    const significanceResults: SeriesDataPoint['significance'] = []
    let hasSignificant = false
    for (let i = 0; i < groupSummaries.length; i += 1) {
      for (let j = i + 1; j < groupSummaries.length; j += 1) {
        const g1 = groupSummaries[i]
        const g2 = groupSummaries[j]
        if (!g1.denominator || !g2.denominator) continue
        const a = g1.count
        const b = Math.max(g1.denominator - g1.count, 0)
        const c = g2.count
        const d = Math.max(g2.denominator - g2.count, 0)
        const total = a + b + c + d
        if (total === 0) continue
        const numerator = (a * d - b * c) ** 2 * total
        const denom = (a + b) * (c + d) * (a + c) * (b + d)
        if (denom === 0) continue
        const chiSquare = numerator / denom
        const significant = chiSquare >= 3.841
        if (significant) hasSignificant = true
        significanceResults.push({
          pair: [g1.label, g2.label],
          chiSquare,
          significant
        })
      }
    }
    row.significance = significanceResults
    if (hasSignificant) {
      row.optionDisplay = `${optionLabel}*`
    }

    return row
  }).filter((row): row is SeriesDataPoint & { __index: number } => row !== null)

  const sortByAverage = (direction: 'asc' | 'desc') => {
    return dataWithIndex.sort((a, b) => {
      const getValue = (row: SeriesDataPoint & { __index: number }) => {
        // Always use the __overallValue for sorting (calculated above)
        const overallValue = (row as any)['__overallValue']
        if (typeof overallValue === 'number') {
          return overallValue
        }

        // Fallback: calculate average across all groups (shouldn't happen)
        let total = 0
        let count = 0
        groupMeta.forEach(meta => {
          const value = typeof row[meta.key] === 'number' ? (row[meta.key] as number) : 0
          total += value
          count += 1
        })
        return count ? total / count : 0
      }
      const diff = getValue(a) - getValue(b)
      return direction === 'asc' ? diff : -diff
    })
  }

  const sortByMoney = () => {
    return dataWithIndex.sort((a, b) => {
      const aValue = parseMoneyValue(a.optionDisplay)
      const bValue = parseMoneyValue(b.optionDisplay)
      return aValue - bValue
    })
  }

  // Check if this is a money question
  const isMoney = isMoneyQuestion(question)

  if (isMoney) {
    // For money questions, always sort by monetary value (ascending)
    sortByMoney()
  } else if (sortOrder === 'ascending') {
    sortByAverage('asc')
  } else if (sortOrder === 'descending') {
    sortByAverage('desc')
  } else {
    dataWithIndex.sort((a, b) => a.__index - b.__index)
  }

  // Sort by __overallValue descending to determine top 8 for default selection
  const sortedByOverall = [...dataWithIndex].sort((a, b) => {
    const aVal = (a as any)['__overallValue'] ?? 0
    const bVal = (b as any)['__overallValue'] ?? 0
    return bVal - aVal // Descending order
  })

  // Get the top 8 option names (used for default selection in ChartGallery)
  const top8Options = new Set(sortedByOverall.slice(0, 8).map(item => item.option))

  // Return ALL options (not filtered), preserving original sort order
  // The ChartGallery component will handle default selection of top 8
  const data: SeriesDataPoint[] = dataWithIndex
    .filter((item): item is SeriesDataPoint & { __index: number } => item !== null)
    .map(({ __index, __overallValue, ...rest }: any) => ({
      ...rest,
      __isTop8: top8Options.has(rest.option) // Mark top 8 options for default selection
    }))

  return {
    data,
    groups: groupMeta
  }
}

// Multi-filter comparison: Build series data from comparison sets
// Each ComparisonSet has filters with AND logic, and sets are compared side-by-side
export interface BuildSeriesFromComparisonSetsArgs {
  dataset: ParsedCSV
  question: QuestionDef
  comparisonSets: ComparisonSet[]
  sortOrder: SortOrder
}

export function buildSeriesFromComparisonSets({
  dataset, question, comparisonSets, sortOrder
}: BuildSeriesFromComparisonSetsArgs): BuildSeriesResult {
  if (!comparisonSets.length) {
    return { data: [], groups: [] }
  }

  const rows = dataset.rows
  const respIdCol = dataset.summary.columns.find(
    c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
  ) || dataset.summary.columns[0]

  const normalizeValue = (value: unknown) => {
    if (value === null || value === undefined) return ''
    return stripQuotes(String(value).trim())
  }

  // Helper: filter rows based on a set of filters (AND across columns, OR within same column)
  const filterRowsByComparisonSet = (setFilters: SegmentDef[]): Record<string, any>[] => {
    if (!setFilters.length) return rows

    // Group filters by column for proper OR logic within same column
    const filtersByColumn = new Map<string, string[]>()
    setFilters.forEach(filter => {
      const values = filtersByColumn.get(filter.column) || []
      values.push(filter.value)
      filtersByColumn.set(filter.column, values)
    })

    return rows.filter(row => {
      // Each column group must match (AND across columns, OR within each column)
      return Array.from(filtersByColumn.entries()).every(([column, values]) => {
        // Check if this column is a consumer question
        const consumerQuestion = dataset.questions.find(q => q.qid === column)

        if (consumerQuestion) {
          if (consumerQuestion.type === 'single' && consumerQuestion.singleSourceColumn) {
            const rowValue = stripQuotes(String(row[consumerQuestion.singleSourceColumn]))
            // OR logic: match ANY of the values for this column
            return values.some(value => stripQuotes(value) === rowValue)
          } else if (consumerQuestion.type === 'multi') {
            // OR logic: match ANY of the values for this column
            return values.some(value => {
              const optionColumn = consumerQuestion.columns.find(col => col.optionLabel === value)
              if (optionColumn) {
                const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
                return headersToCheck.some(header => {
                  const val = row[header]
                  return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
                })
              }
              return false
            })
          }
          return false
        } else {
          // Regular segment column - OR logic: match ANY of the values
          const rowValue = stripQuotes(String(row[column]))
          return values.some(value => rowValue === stripQuotes(value))
        }
      })
    })
  }

  // Build group info for each comparison set
  const groupInfo = new Map<string, {
    rows: Record<string, any>[]
    uniqueRespondents: string[]
    singleCounts?: Record<string, number>
    singleDenom?: number
  }>()

  comparisonSets.forEach(compSet => {
    const filteredRows = filterRowsByComparisonSet(compSet.filters)
    const respondentIds = uniq(filteredRows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean))
    groupInfo.set(compSet.id, {
      rows: filteredRows,
      uniqueRespondents: respondentIds
    })
  })

  // For single-select questions, pre-calculate counts
  if (question.type !== 'multi' && question.singleSourceColumn) {
    for (const [setId, info] of groupInfo.entries()) {
      const counts: Record<string, number> = {}
      const isRowLevel = question.level === 'row' || dataset.summary.isProductTest

      if (isRowLevel) {
        const seen = new Map<string, string>()
        for (const r of info.rows) {
          const respondent = stripQuotes(String(r[respIdCol] ?? '').trim())
          if (!respondent) continue
          const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
          if (!value) continue
          if (!seen.has(respondent)) {
            seen.set(respondent, value)
          }
        }
        seen.forEach(value => {
          const normalized = value.toLowerCase()
          counts[normalized] = (counts[normalized] || 0) + 1
        })
        info.singleCounts = counts
        info.singleDenom = seen.size
      } else {
        const seen = new Map<string, string>()
        for (const r of info.rows) {
          const respondent = stripQuotes(String(r[respIdCol] ?? '').trim())
          if (!respondent || seen.has(respondent)) continue
          const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
          if (!value) continue
          seen.set(respondent, value)
        }
        seen.forEach(value => {
          const normalized = value.toLowerCase()
          counts[normalized] = (counts[normalized] || 0) + 1
        })
        info.singleCounts = counts
        info.singleDenom = seen.size
      }
    }
  }

  // Build group metadata
  const groupMeta: GroupSeriesMeta[] = []
  const usedKeys = new Set<string>()
  const getKeyForGroup = (label: string, index: number) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `group_${index + 1}`
    let key = base
    let counter = 1
    while (usedKeys.has(key)) {
      key = `${base}_${counter}`
      counter += 1
    }
    usedKeys.add(key)
    return key
  }

  comparisonSets.forEach((compSet, index) => {
    const key = getKeyForGroup(compSet.label, index)
    groupMeta.push({ label: compSet.label, key })
  })

  // Build data for each question option
  const dataWithIndex = question.columns.map((col, originalIndex) => {
    const optionLabel = normalizeValue(col.optionLabel)
    if (!optionLabel || optionLabel.trim() === '') {
      return null
    }

    const groupSummaries: SeriesDataPoint['groupSummaries'] = []
    const row: SeriesDataPoint & { __index: number } = {
      option: optionLabel,
      optionDisplay: optionLabel,
      significance: [],
      groupSummaries,
      __index: originalIndex,
    }

    groupMeta.forEach((meta, idx) => {
      const compSet = comparisonSets[idx]
      const info = groupInfo.get(compSet.id)
      if (!info) {
        row[meta.key] = 0
        return
      }

      let count = 0
      let denom = 0

      if (question.type === 'multi') {
        const isRowLevel = question.level === 'row' || dataset.summary.isProductTest
        const seen = new Set<string>()
        const answeredRespondents = new Set<string>()

        if (question.textSummaryColumn && col.header.startsWith('__TEXT_MULTI__')) {
          const optionLabelLower = optionLabel.toLowerCase()
          for (const r of info.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            const textValue = r[question.textSummaryColumn]
            if (!textValue || textValue === '') continue

            answeredRespondents.add(respondent)

            const cleanedValue = stripQuotes(String(textValue).trim())
            const options = cleanedValue.includes('|')
              ? cleanedValue.split('|').map(opt => stripQuotes(opt.trim()).toLowerCase())
              : [cleanedValue.toLowerCase()]

            if (options.includes(optionLabelLower)) {
              seen.add(respondent)
            }
          }
        } else {
          const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
          const allQuestionHeaders = question.columns.flatMap(qCol =>
            [qCol.header, ...(qCol.alternateHeaders || [])]
          )

          for (const r of info.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            let hasAnswerForThisRow = false
            for (const h of allQuestionHeaders) {
              const val = r[h]
              if (val === 1 || val === true || val === '1' || val === 'true' || val === 'Y') {
                hasAnswerForThisRow = true
                break
              }
            }
            if (!hasAnswerForThisRow) continue

            answeredRespondents.add(respondent)

            for (const header of headersToCheck) {
              const v = r[header]
              if (v === 1 || v === true || v === '1' || v === 'true' || v === 'Y') {
                seen.add(respondent)
                break
              }
            }
          }
        }

        count = seen.size
        denom = answeredRespondents.size
      } else if (question.type === 'ranking') {
        const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
        const rankingsByRespondent = new Map<string, number>()

        for (const r of info.rows) {
          const respondent = normalizeValue(r[respIdCol])
          if (!respondent) continue
          if (rankingsByRespondent.has(respondent)) continue

          for (const header of headersToCheck) {
            const value = r[header]
            if (value !== null && value !== undefined && value !== '') {
              const numValue = typeof value === 'number' ? value : parseFloat(String(value))
              if (!isNaN(numValue) && numValue > 0) {
                rankingsByRespondent.set(respondent, numValue)
                break
              }
            }
          }
        }

        const rankings = Array.from(rankingsByRespondent.values())
        const avgRanking = rankings.length > 0
          ? rankings.reduce((sum, val) => sum + val, 0) / rankings.length
          : 0

        row[meta.key] = avgRanking
        groupSummaries.push({
          label: meta.label,
          count: rankings.length,
          denominator: info.uniqueRespondents.length,
          percent: avgRanking
        })
      } else if (question.singleSourceColumn) {
        const cleanedLabel = optionLabel.toLowerCase()
        const counts = info.singleCounts || {}
        denom = info.singleDenom ?? info.uniqueRespondents.length
        count = counts[cleanedLabel] || 0
      }

      // Calculate percentage
      if (question.type !== 'ranking') {
        const percent = denom ? Math.round((count / denom) * 100 * 1e10) / 1e10 : 0
        row[meta.key] = percent
        groupSummaries.push({
          label: meta.label,
          count,
          denominator: denom,
          percent
        })
      }
    })

    // Calculate chi-square significance for each pair of groups
    const significanceResults: SeriesDataPoint['significance'] = []
    let hasSignificant = false
    for (let i = 0; i < groupSummaries.length; i += 1) {
      for (let j = i + 1; j < groupSummaries.length; j += 1) {
        const g1 = groupSummaries[i]
        const g2 = groupSummaries[j]
        if (!g1.denominator || !g2.denominator) continue
        const a = g1.count
        const b = Math.max(g1.denominator - g1.count, 0)
        const c = g2.count
        const d = Math.max(g2.denominator - g2.count, 0)
        const total = a + b + c + d
        if (total === 0) continue
        const numerator = (a * d - b * c) ** 2 * total
        const denominator = (a + b) * (c + d) * (a + c) * (b + d)
        if (denominator === 0) continue
        const chiSquare = numerator / denominator
        const significant = chiSquare >= 3.841
        if (significant) hasSignificant = true
        significanceResults.push({
          pair: [g1.label, g2.label],
          chiSquare,
          significant
        })
      }
    }
    row.significance = significanceResults
    if (hasSignificant) {
      row.optionDisplay = `${optionLabel}*`
    }

    return row
  }).filter((row): row is SeriesDataPoint & { __index: number } => row !== null)

  // Apply sorting
  const sortByAverage = (direction: 'asc' | 'desc') => {
    return dataWithIndex.sort((a, b) => {
      const getValue = (row: SeriesDataPoint & { __index: number }) => {
        let total = 0
        let count = 0
        groupMeta.forEach(meta => {
          const value = typeof row[meta.key] === 'number' ? (row[meta.key] as number) : 0
          total += value
          count += 1
        })
        return count ? total / count : 0
      }
      const diff = getValue(a) - getValue(b)
      return direction === 'asc' ? diff : -diff
    })
  }

  if (sortOrder === 'ascending') {
    sortByAverage('asc')
  } else if (sortOrder === 'descending') {
    sortByAverage('desc')
  } else {
    dataWithIndex.sort((a, b) => a.__index - b.__index)
  }

  const data: SeriesDataPoint[] = dataWithIndex
    .map(({ __index, ...rest }) => rest as SeriesDataPoint)

  return {
    data,
    groups: groupMeta
  }
}

// Product Bucketing: Build series data from product buckets
// Each bucket aggregates responses from all products in that bucket
// Used to compare product groupings (e.g., color themes) side-by-side
export interface BuildSeriesFromProductBucketsArgs {
  dataset: ParsedCSV
  question: QuestionDef
  productBuckets: ProductBucket[]
  productColumn: string
  sortOrder: SortOrder
  segments?: SegmentDef[]  // Optional segment filter to apply first
}

export function buildSeriesFromProductBuckets({
  dataset, question, productBuckets, productColumn, sortOrder, segments
}: BuildSeriesFromProductBucketsArgs): BuildSeriesResult {
  if (!productBuckets.length) {
    return { data: [], groups: [] }
  }

  const rows = dataset.rows
  const respIdCol = dataset.summary.columns.find(
    c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
  ) || dataset.summary.columns[0]

  const normalizeValue = (value: unknown) => {
    if (value === null || value === undefined) return ''
    return stripQuotes(String(value).trim())
  }

  // Helper: filter rows based on segment filters (AND across columns, OR within same column)
  const filterRowsBySegments = (inputRows: Record<string, any>[], segmentFilters: SegmentDef[]): Record<string, any>[] => {
    if (!segmentFilters || segmentFilters.length === 0) return inputRows

    // Group filters by column for proper OR logic within same column
    const filtersByColumn = new Map<string, string[]>()
    segmentFilters.forEach(filter => {
      // Skip "Overall" segments
      if (filter.column === 'Overall' || filter.value === 'Overall') return
      const values = filtersByColumn.get(filter.column) || []
      values.push(filter.value)
      filtersByColumn.set(filter.column, values)
    })

    if (filtersByColumn.size === 0) return inputRows

    return inputRows.filter(row => {
      return Array.from(filtersByColumn.entries()).every(([column, values]) => {
        const consumerQuestion = dataset.questions.find(q => q.qid === column)

        if (consumerQuestion) {
          if (consumerQuestion.type === 'single' && consumerQuestion.singleSourceColumn) {
            const rowValue = stripQuotes(String(row[consumerQuestion.singleSourceColumn]))
            return values.some(value => stripQuotes(value) === rowValue)
          } else if (consumerQuestion.type === 'multi') {
            return values.some(value => {
              const optionColumn = consumerQuestion.columns.find(col => col.optionLabel === value)
              if (optionColumn) {
                const headersToCheck = [optionColumn.header, ...(optionColumn.alternateHeaders || [])]
                return headersToCheck.some(header => {
                  const val = row[header]
                  return val === 1 || val === '1' || val === true || val === 'true' || val === 'TRUE' || val === 'Yes' || val === 'yes'
                })
              }
              return false
            })
          }
          return false
        } else {
          const rowValue = stripQuotes(String(row[column]))
          return values.some(value => rowValue === stripQuotes(value))
        }
      })
    })
  }

  // Apply segment filters first
  const filteredRows = filterRowsBySegments(rows, segments || [])

  // Build group info for each product bucket
  // For each bucket, get rows where productColumn matches any product in the bucket
  const groupInfo = new Map<string, {
    rows: Record<string, any>[]
    uniqueRespondents: string[]
    singleCounts?: Record<string, number>
    singleDenom?: number
  }>()

  productBuckets.forEach(bucket => {
    const bucketProducts = new Set(bucket.products.map(p => normalizeValue(p)))
    const bucketRows = filteredRows.filter(row => {
      const productValue = normalizeValue(row[productColumn])
      return bucketProducts.has(productValue)
    })
    const respondentIds = uniq(bucketRows.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean))

    groupInfo.set(bucket.id, {
      rows: bucketRows,
      uniqueRespondents: respondentIds
    })
  })

  // For single-select questions, pre-calculate counts per bucket
  if (question.type !== 'multi' && question.singleSourceColumn) {
    for (const [bucketId, info] of groupInfo.entries()) {
      const counts: Record<string, number> = {}
      const isRowLevel = question.level === 'row' || dataset.summary.isProductTest

      if (isRowLevel) {
        // COUNT AT RESPONDENT LEVEL: Count unique respondents per bucket
        const seen = new Map<string, string>()
        for (const r of info.rows) {
          const respondent = stripQuotes(String(r[respIdCol] ?? '').trim())
          if (!respondent) continue
          const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
          if (!value) continue
          if (!seen.has(respondent)) {
            seen.set(respondent, value)
          }
        }
        seen.forEach(value => {
          const normalized = value.toLowerCase()
          counts[normalized] = (counts[normalized] || 0) + 1
        })
        info.singleCounts = counts
        info.singleDenom = seen.size
      } else {
        const seen = new Map<string, string>()
        for (const r of info.rows) {
          const respondent = stripQuotes(String(r[respIdCol] ?? '').trim())
          if (!respondent || seen.has(respondent)) continue
          const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
          if (!value) continue
          seen.set(respondent, value)
        }
        seen.forEach(value => {
          const normalized = value.toLowerCase()
          counts[normalized] = (counts[normalized] || 0) + 1
        })
        info.singleCounts = counts
        info.singleDenom = seen.size
      }
    }
  }

  // Build group metadata for each bucket
  const groupMeta: GroupSeriesMeta[] = []
  const usedKeys = new Set<string>()
  const getKeyForGroup = (label: string, index: number) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_') || `bucket_${index + 1}`
    let key = base
    let counter = 1
    while (usedKeys.has(key)) {
      key = `${base}_${counter}`
      counter += 1
    }
    usedKeys.add(key)
    return key
  }

  productBuckets.forEach((bucket, index) => {
    const key = getKeyForGroup(bucket.label, index)
    groupMeta.push({ label: bucket.label, key })
  })

  // Build data for each question option
  const dataWithIndex = question.columns.map((col, originalIndex) => {
    const optionLabel = normalizeValue(col.optionLabel)
    if (!optionLabel || optionLabel.trim() === '') {
      return null
    }

    const groupSummaries: SeriesDataPoint['groupSummaries'] = []
    const row: SeriesDataPoint & { __index: number } = {
      option: optionLabel,
      optionDisplay: optionLabel,
      significance: [],
      groupSummaries,
      __index: originalIndex,
    }

    groupMeta.forEach((meta, idx) => {
      const bucket = productBuckets[idx]
      const info = groupInfo.get(bucket.id)
      if (!info) {
        row[meta.key] = 0
        return
      }

      let count = 0
      let denom = 0

      if (question.type === 'multi') {
        const seen = new Set<string>()
        const answeredRespondents = new Set<string>()

        if (question.textSummaryColumn && col.header.startsWith('__TEXT_MULTI__')) {
          const optionLabelLower = optionLabel.toLowerCase()
          for (const r of info.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            const textValue = r[question.textSummaryColumn]
            if (!textValue || textValue === '') continue

            answeredRespondents.add(respondent)

            const cleanedValue = stripQuotes(String(textValue).trim())
            const options = cleanedValue.includes('|')
              ? cleanedValue.split('|').map(opt => stripQuotes(opt.trim()).toLowerCase())
              : [cleanedValue.toLowerCase()]

            if (options.includes(optionLabelLower)) {
              seen.add(respondent)
            }
          }
        } else {
          const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
          const allQuestionHeaders = question.columns.flatMap(qCol =>
            [qCol.header, ...(qCol.alternateHeaders || [])]
          )

          for (const r of info.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            let hasAnswerForThisRow = false
            for (const h of allQuestionHeaders) {
              const val = r[h]
              if (val === 1 || val === true || val === '1' || val === 'true' || val === 'Y') {
                hasAnswerForThisRow = true
                break
              }
            }
            if (!hasAnswerForThisRow) continue

            answeredRespondents.add(respondent)

            for (const header of headersToCheck) {
              const v = r[header]
              if (v === 1 || v === true || v === '1' || v === 'true' || v === 'Y') {
                seen.add(respondent)
                break
              }
            }
          }
        }

        count = seen.size
        denom = answeredRespondents.size
      } else if (question.type === 'ranking') {
        const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
        const rankingsByRespondent = new Map<string, number>()

        for (const r of info.rows) {
          const respondent = normalizeValue(r[respIdCol])
          if (!respondent) continue
          if (rankingsByRespondent.has(respondent)) continue

          for (const header of headersToCheck) {
            const value = r[header]
            if (value !== null && value !== undefined && value !== '') {
              const numValue = typeof value === 'number' ? value : parseFloat(String(value))
              if (!isNaN(numValue) && numValue > 0) {
                rankingsByRespondent.set(respondent, numValue)
                break
              }
            }
          }
        }

        const rankings = Array.from(rankingsByRespondent.values())
        const avgRanking = rankings.length > 0
          ? rankings.reduce((sum, val) => sum + val, 0) / rankings.length
          : 0

        row[meta.key] = avgRanking
        groupSummaries.push({
          label: meta.label,
          count: rankings.length,
          denominator: info.uniqueRespondents.length,
          percent: avgRanking
        })
      } else if (question.singleSourceColumn) {
        const cleanedLabel = optionLabel.toLowerCase()
        const counts = info.singleCounts || {}
        denom = info.singleDenom ?? info.uniqueRespondents.length
        count = counts[cleanedLabel] || 0
      }

      // Calculate percentage
      if (question.type !== 'ranking') {
        const percent = denom ? Math.round((count / denom) * 100 * 1e10) / 1e10 : 0
        row[meta.key] = percent
        groupSummaries.push({
          label: meta.label,
          count,
          denominator: denom,
          percent
        })
      }
    })

    // Calculate chi-square significance for each pair of buckets
    const significanceResults: SeriesDataPoint['significance'] = []
    let hasSignificant = false
    for (let i = 0; i < groupSummaries.length; i += 1) {
      for (let j = i + 1; j < groupSummaries.length; j += 1) {
        const g1 = groupSummaries[i]
        const g2 = groupSummaries[j]
        if (!g1.denominator || !g2.denominator) continue
        const a = g1.count
        const b = Math.max(g1.denominator - g1.count, 0)
        const c = g2.count
        const d = Math.max(g2.denominator - g2.count, 0)
        const total = a + b + c + d
        if (total === 0) continue
        const numerator = (a * d - b * c) ** 2 * total
        const denominator = (a + b) * (c + d) * (a + c) * (b + d)
        if (denominator === 0) continue
        const chiSquare = numerator / denominator
        const significant = chiSquare >= 3.841
        if (significant) hasSignificant = true
        significanceResults.push({
          pair: [g1.label, g2.label],
          chiSquare,
          significant
        })
      }
    }
    row.significance = significanceResults
    if (hasSignificant) {
      row.optionDisplay = `${optionLabel}*`
    }

    return row
  }).filter((row): row is SeriesDataPoint & { __index: number } => row !== null)

  // Apply sorting
  const sortByAverage = (direction: 'asc' | 'desc') => {
    return dataWithIndex.sort((a, b) => {
      const getValue = (row: SeriesDataPoint & { __index: number }) => {
        let total = 0
        let count = 0
        groupMeta.forEach(meta => {
          const value = typeof row[meta.key] === 'number' ? (row[meta.key] as number) : 0
          total += value
          count += 1
        })
        return count ? total / count : 0
      }
      const diff = getValue(a) - getValue(b)
      return direction === 'asc' ? diff : -diff
    })
  }

  if (sortOrder === 'ascending') {
    sortByAverage('asc')
  } else if (sortOrder === 'descending') {
    sortByAverage('desc')
  } else {
    dataWithIndex.sort((a, b) => a.__index - b.__index)
  }

  const data: SeriesDataPoint[] = dataWithIndex
    .map(({ __index, ...rest }) => rest as SeriesDataPoint)

  return {
    data,
    groups: groupMeta
  }
}
