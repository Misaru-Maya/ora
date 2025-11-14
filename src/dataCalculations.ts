import { ParsedCSV, QuestionDef, SortOrder, SegmentDef } from './types'

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

const EXCLUDED_LABELS = ['other', 'not specified', 'none of the above', 'skip']

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

function stripQuotes(value: string): string {
  if (!value) return value
  let result = value.trim()
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('“') && result.endsWith('”'))) {
    result = result.slice(1, -1)
  } else if (result.startsWith("'") && result.endsWith("'")) {
    result = result.slice(1, -1)
  }
  return result.replace(/""/g, '"').trim()
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
    const filtered = segment.value === 'Overall'
      ? rows
      : rows.filter(r => stripQuotes(String(r[segment.column])) === stripQuotes(segment.value))
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
    for (const [groupLabel, info] of groupInfo.entries()) {
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

  const shouldExcludeLabel = (label: string) => {
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
        const rankings: number[] = []

        // Collect all ranking values for this option
        for (const r of info.rows) {
          for (const header of headersToCheck) {
            const value = r[header]
            if (value !== null && value !== undefined && value !== '') {
              const numValue = typeof value === 'number' ? value : parseFloat(String(value))
              if (!isNaN(numValue) && numValue > 0) {
                rankings.push(numValue)
                break
              }
            }
          }
        }

        // Calculate average ranking (lower is better)
        const avgRanking = rankings.length > 0
          ? rankings.reduce((sum, val) => sum + val, 0) / rankings.length
          : 0

        // Store the average ranking as the value
        row[meta.key] = Math.round(avgRanking * 10) / 10 // Round to 1 decimal place
        groupSummaries.push({
          label: meta.label,
          count: rankings.length,
          denominator: info.rows.length,
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
      const rankings: number[] = []

      for (const r of overallInfo.rows) {
        for (const header of headersToCheck) {
          const value = r[header]
          if (value !== null && value !== undefined && value !== '') {
            const numValue = typeof value === 'number' ? value : parseFloat(String(value))
            if (!isNaN(numValue) && numValue > 0) {
              rankings.push(numValue)
              break
            }
          }
        }
      }

      const avgRanking = rankings.length > 0
        ? rankings.reduce((sum, val) => sum + val, 0) / rankings.length
        : 0

      // For ranking questions, store the ranking value directly
      row['__overallValue' as any] = Math.round(avgRanking * 10) / 10
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

  const data: SeriesDataPoint[] = dataWithIndex
    .filter((item): item is SeriesDataPoint & { __index: number } => item !== null)
    .map(({ __index, __overallValue, ...rest }: any) => rest)

  return {
    data,
    groups: groupMeta
  }
}
