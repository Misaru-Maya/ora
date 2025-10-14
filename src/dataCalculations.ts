import { ParsedCSV, QuestionDef, SortOrder } from './types'

// Custom rounding function that rounds up from 0.45 instead of 0.5
// This matches the rounding behavior of the reference platform
export function customRound(value: number): number {
  const floor = Math.floor(value)
  const decimal = value - floor
  // Round up if decimal part is >= 0.45
  return decimal >= 0.45 ? Math.ceil(value) : floor
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
  segmentColumn: string
  groups: string[]
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
  dataset, question, segmentColumn, groups, sortOrder
}: BuildSeriesArgs): BuildSeriesResult {
  if (!groups.length) {
    return { data: [], groups: [] }
  }
  const rows = dataset.rows

  const respIdCol = dataset.summary.columns.find(
    c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
  ) || dataset.summary.columns[0]

  const groupInfo = groups.reduce<Map<string, {
    rows: Record<string, any>[]
    uniqueRespondents: string[]
    singleCounts?: Record<string, number>
    singleDenom?: number
  }>>((map, groupLabel) => {
    // Handle "Overall" as a special case: include ALL rows
    const filtered = groupLabel === 'Overall'
      ? rows
      : rows.filter(r => String(r[segmentColumn]) === groupLabel)
    const respondentIds = uniq(filtered.map(r => stripQuotes(String(r[respIdCol] ?? '').trim())).filter(Boolean))
    map.set(groupLabel, {
      rows: filtered,
      uniqueRespondents: respondentIds
    })
    return map
  }, new Map())

  if (question.type !== 'multi' && question.singleSourceColumn) {
    for (const [groupLabel, info] of groupInfo.entries()) {
      const counts: Record<string, number> = {}

      // For product-level questions, count all responses (rows), not just unique respondents
      if (question.level === 'row' || dataset.summary.isProductTest) {
        // Count all rows with answers
        for (const r of info.rows) {
          const value = stripQuotes(String(r[question.singleSourceColumn!] ?? '').trim())
          if (!value) continue
          const normalized = value.toLowerCase()
          counts[normalized] = (counts[normalized] || 0) + 1
        }
        // Denominator is total rows with answers
        const totalAnswered = Object.values(counts).reduce((sum, count) => sum + count, 0)
        info.singleCounts = counts
        info.singleDenom = totalAnswered
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

  groups.forEach((label, index) => {
    const key = getKeyForGroup(label, index)
    groupMeta.push({ label, key })
  })

  const dataWithIndex = question.columns.map((col, originalIndex) => {
    const optionLabel = normalizeValue(col.optionLabel)
    if (shouldExcludeLabel(optionLabel)) return null
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
        // First, determine which respondents answered this question at all
        const answeredRespondents = new Set<string>()

        if (question.textSummaryColumn) {
          // For text summary columns, anyone with non-empty text answered
          for (const r of info.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            const textValue = r[question.textSummaryColumn]
            if (textValue && textValue !== '') {
              answeredRespondents.add(respondent)
            }
          }
        } else {
          // For binary columns, check if ANY option was selected
          for (const r of info.rows) {
            const respondent = normalizeValue(r[respIdCol])
            if (!respondent) continue

            // Check all columns for this question to see if respondent answered
            for (const qCol of question.columns) {
              const headersToCheck = [qCol.header, ...(qCol.alternateHeaders || [])]
              for (const header of headersToCheck) {
                const v = r[header]
                if (v === 1 || v === true || v === '1' || v === 'true' || v === 'Y') {
                  answeredRespondents.add(respondent)
                  break
                }
              }
              if (answeredRespondents.has(respondent)) break
            }
          }
        }

        // Denominator is number of respondents who answered this question
        denom = answeredRespondents.size

        if (denom) {
          const seen = new Set<string>()

          // Check if this question uses a text summary column (pipe-separated or single values)
          if (question.textSummaryColumn && col.header.startsWith('__TEXT_MULTI__')) {
            // Parse values from text summary column (can be pipe-separated or single value)
            const optionLabelLower = optionLabel.toLowerCase()
            for (const r of info.rows) {
              const respondent = normalizeValue(r[respIdCol])
              if (!respondent) continue

              const textValue = r[question.textSummaryColumn]
              if (!textValue || textValue === '') continue

              const cleanedValue = stripQuotes(String(textValue).trim())

              // Split by pipe (or treat as single value if no pipe)
              const options = cleanedValue.includes('|')
                ? cleanedValue.split('|').map(opt => stripQuotes(opt.trim()).toLowerCase())
                : [cleanedValue.toLowerCase()]

              // Check if this option is present in the list
              if (options.includes(optionLabelLower)) {
                seen.add(respondent)
              }
            }
          } else {
            // Check both primary header and alternate headers (for binary columns)
            const headersToCheck = [col.header, ...(col.alternateHeaders || [])]
            for (const r of info.rows) {
              const respondent = normalizeValue(r[respIdCol])
              if (!respondent) continue
              // Check if any of the headers (primary or alternates) has a truthy value
              for (const header of headersToCheck) {
                const v = r[header]
                if (v === 1 || v === true || v === '1' || v === 'true' || v === 'Y') {
                  seen.add(respondent)
                  break // Don't double-count same respondent
                }
              }
            }
          }
          count = seen.size
        }
      } else if (question.singleSourceColumn) {
        const cleanedLabel = optionLabel.toLowerCase()
        const counts = info.singleCounts || {}
        denom = info.singleDenom ?? info.uniqueRespondents.length
        count = counts[cleanedLabel] || 0
      }

      // Calculate percentage with proper rounding to avoid floating point issues
      // Round to 10 decimal places first to fix floating point precision issues
      const percent = denom ? Math.round((count / denom) * 100 * 1e10) / 1e10 : 0
      row[meta.key] = percent
      groupSummaries.push({
        label: meta.label,
        count,
        denominator: denom,
        percent
      })
    })

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
      const avg = (row: SeriesDataPoint & { __index: number }) => {
        let total = 0
        let count = 0
        groupMeta.forEach(meta => {
          const value = typeof row[meta.key] === 'number' ? (row[meta.key] as number) : 0
          total += value
          count += 1
        })
        return count ? total / count : 0
      }
      const diff = avg(a) - avg(b)
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

  const data: SeriesDataPoint[] = dataWithIndex.map(({ __index, ...rest }) => rest)

  return {
    data,
    groups: groupMeta
  }
}
