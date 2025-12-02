/**
 * Regression Analysis Module for ORA
 *
 * This module provides statistical analysis to isolate the effect of different
 * segment categories (e.g., Audience Type, Gender, Age) when comparing groups.
 *
 * It addresses the confounding variable problem where, for example:
 * - CRM population skews female
 * - Panel population skews male
 * - Making it unclear if differences are due to audience type or demographics
 */

import type { ParsedCSV, QuestionDef, SegmentDef } from './types'

// ============================================================================
// Types
// ============================================================================

export interface SegmentDistribution {
  segment: string           // e.g., "Gender"
  value: string            // e.g., "Female"
  count: number            // Number of respondents
  proportion: number       // Proportion (0-1)
}

export interface StratumData {
  stratum: string          // e.g., "Female, 25-34"
  segments: SegmentDef[]   // The segment combination
  groupCounts: Record<string, {
    count: number
    denominator: number
    percent: number
  }>
  sampleSize: number       // Total respondents in this stratum
}

export interface StratifiedAnalysisResult {
  question: QuestionDef
  option: string           // The answer option being analyzed
  strata: StratumData[]    // Breakdown by stratum
  rawComparison: {
    groups: Record<string, {
      percent: number
      count: number
      denominator: number
    }>
    difference: number     // Raw difference between primary groups
  }
  adjustedComparison: {
    groups: Record<string, {
      adjustedPercent: number
    }>
    adjustedDifference: number  // Difference after standardization
  }
  standardPopulation: SegmentDistribution[]  // Weights used
}

export interface PropensityWeight {
  respondentId: string
  originalGroup: string    // e.g., "CRM" or "Panel"
  propensityScore: number  // P(being in reference group | demographics)
  weight: number           // Inverse probability weight
}

export interface PropensityWeightedResult {
  question: QuestionDef
  option: string
  referenceGroup: string   // The group we're weighting TO (e.g., "Panel")
  targetGroup: string      // The group we're weighting FROM (e.g., "CRM")
  rawComparison: {
    referencePercent: number
    targetPercent: number
    difference: number
  }
  weightedComparison: {
    referencePercent: number
    targetWeightedPercent: number  // After reweighting
    adjustedDifference: number
  }
  demographicBalance: {
    before: Record<string, SegmentDistribution[]>
    after: Record<string, SegmentDistribution[]>
  }
  effectiveSampleSize: number  // Accounts for weighting
}

export interface RegressionCoefficient {
  variable: string         // e.g., "Audience Type (CRM vs Panel)"
  coefficient: number      // Effect size (in percentage points)
  standardError: number
  tStatistic: number
  pValue: number
  significant: boolean     // p < 0.05
  confidenceInterval: [number, number]
}

export interface RegressionResult {
  question: QuestionDef
  option: string
  dependentVariable: string  // The outcome being predicted
  coefficients: RegressionCoefficient[]
  modelFit: {
    rSquared: number
    adjustedRSquared: number
    fStatistic: number
    fPValue: number
  }
  sampleSize: number
  interpretation: string   // Human-readable interpretation
}

export interface RegressionAnalysisConfig {
  primaryComparison: {
    column: string         // e.g., "Audience Type"
    referenceGroup: string // e.g., "Panel" (baseline)
    targetGroup: string    // e.g., "CRM" (comparison)
  }
  controlVariables: Array<{
    column: string         // e.g., "Gender", "Age"
    type: 'categorical' | 'ordinal' | 'continuous'
  }>
  analysisType: 'stratified' | 'propensity' | 'regression' | 'all'
}

// ============================================================================
// Helper Functions
// ============================================================================

function stripQuotes(value: string): string {
  if (!value) return value
  let result = value.trim()
  if ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1)
  }
  return result.trim()
}

function getRespondentId(row: Record<string, any>, columns: string[]): string {
  const respIdCol = columns.find(
    c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
  ) || columns[0]
  return stripQuotes(String(row[respIdCol] ?? '').trim())
}

function getSegmentValue(row: Record<string, any>, column: string, questions: QuestionDef[]): string | null {
  // Check if this is a question-based segment
  const question = questions.find(q => q.qid === column)

  if (question) {
    if (question.type === 'single' && question.singleSourceColumn) {
      return stripQuotes(String(row[question.singleSourceColumn] ?? ''))
    }
    // For multi-select, we'd need different handling
    return null
  }

  // Regular segment column
  const value = stripQuotes(String(row[column] ?? ''))
  return value && value !== 'null' && value !== 'undefined' ? value : null
}

function getUniqueValues(
  rows: Record<string, any>[],
  column: string,
  questions: QuestionDef[]
): string[] {
  const values = new Set<string>()
  for (const row of rows) {
    const value = getSegmentValue(row, column, questions)
    if (value) values.add(value)
  }
  return Array.from(values).sort()
}

// ============================================================================
// Stratified Analysis
// ============================================================================

/**
 * Perform stratified analysis to compare groups while controlling for demographics.
 *
 * This creates a breakdown table showing results within each demographic stratum,
 * then combines them using direct standardization to the overall population.
 */
export function performStratifiedAnalysis(
  dataset: ParsedCSV,
  question: QuestionDef,
  option: string,
  primaryComparison: { column: string; groups: string[] },
  controlVariables: string[]
): StratifiedAnalysisResult {
  const rows = dataset.rows
  const columns = dataset.summary.columns
  const questions = dataset.questions

  // Get unique values for each control variable
  const controlValues: Record<string, string[]> = {}
  for (const control of controlVariables) {
    controlValues[control] = getUniqueValues(rows, control, questions)
  }

  // Generate all stratum combinations
  const strataCombinations = generateStrataCombinations(controlValues)

  // Calculate results for each stratum
  const strata: StratumData[] = []
  const overallCounts: Record<string, { count: number; denom: number }> = {}

  for (const combination of strataCombinations) {
    const stratumLabel = Object.entries(combination)
      .map(([_col, val]) => val)
      .join(', ')

    const stratumSegments: SegmentDef[] = Object.entries(combination)
      .map(([column, value]) => ({ column, value }))

    // Filter rows to this stratum
    const stratumRows = rows.filter(row => {
      return Object.entries(combination).every(([col, val]) => {
        const rowValue = getSegmentValue(row, col, questions)
        return rowValue === val
      })
    })

    if (stratumRows.length === 0) continue

    // Calculate percentages for each primary group within this stratum
    const groupCounts: Record<string, { count: number; denominator: number; percent: number }> = {}

    for (const group of primaryComparison.groups) {
      // Filter to this group
      const groupRows = stratumRows.filter(row => {
        const groupValue = getSegmentValue(row, primaryComparison.column, questions)
        return groupValue === group
      })

      // Count respondents who selected the option
      const { count, denom } = countOptionResponses(
        groupRows,
        question,
        option,
        columns
      )

      groupCounts[group] = {
        count,
        denominator: denom,
        percent: denom > 0 ? (count / denom) * 100 : 0
      }

      // Accumulate for overall
      if (!overallCounts[group]) {
        overallCounts[group] = { count: 0, denom: 0 }
      }
      overallCounts[group].count += count
      overallCounts[group].denom += denom
    }

    strata.push({
      stratum: stratumLabel,
      segments: stratumSegments,
      groupCounts,
      sampleSize: stratumRows.length
    })
  }

  // Calculate raw comparison (overall without adjustment)
  const rawGroups: Record<string, { percent: number; count: number; denominator: number }> = {}
  for (const group of primaryComparison.groups) {
    const { count, denom } = overallCounts[group] || { count: 0, denom: 0 }
    rawGroups[group] = {
      percent: denom > 0 ? (count / denom) * 100 : 0,
      count,
      denominator: denom
    }
  }

  // Calculate standard population weights (overall distribution of control variables)
  const standardPopulation = calculateStandardPopulation(rows, controlVariables, questions)

  // Calculate adjusted (standardized) comparison
  const adjustedGroups: Record<string, { adjustedPercent: number }> = {}
  for (const group of primaryComparison.groups) {
    let weightedSum = 0
    let totalWeight = 0

    for (const stratum of strata) {
      // Find the weight for this stratum from the standard population
      const stratumWeight = getStratumWeight(stratum.segments, standardPopulation)
      const groupData = stratum.groupCounts[group]

      if (groupData && groupData.denominator > 0) {
        weightedSum += groupData.percent * stratumWeight
        totalWeight += stratumWeight
      }
    }

    adjustedGroups[group] = {
      adjustedPercent: totalWeight > 0 ? weightedSum / totalWeight : 0
    }
  }

  // Calculate differences
  const groupNames = primaryComparison.groups
  const rawDifference = groupNames.length >= 2
    ? rawGroups[groupNames[1]]?.percent - rawGroups[groupNames[0]]?.percent
    : 0
  const adjustedDifference = groupNames.length >= 2
    ? adjustedGroups[groupNames[1]]?.adjustedPercent - adjustedGroups[groupNames[0]]?.adjustedPercent
    : 0

  return {
    question,
    option,
    strata,
    rawComparison: {
      groups: rawGroups,
      difference: rawDifference
    },
    adjustedComparison: {
      groups: adjustedGroups,
      adjustedDifference
    },
    standardPopulation
  }
}

function generateStrataCombinations(
  controlValues: Record<string, string[]>
): Array<Record<string, string>> {
  const columns = Object.keys(controlValues)
  if (columns.length === 0) return [{}]

  const combinations: Array<Record<string, string>> = []

  function recurse(index: number, current: Record<string, string>) {
    if (index === columns.length) {
      combinations.push({ ...current })
      return
    }

    const col = columns[index]
    for (const value of controlValues[col]) {
      current[col] = value
      recurse(index + 1, current)
    }
  }

  recurse(0, {})
  return combinations
}

function countOptionResponses(
  rows: Record<string, any>[],
  question: QuestionDef,
  option: string,
  columns: string[]
): { count: number; denom: number } {
  const respIdCol = columns.find(
    c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
  ) || columns[0]

  const seen = new Set<string>()
  const answered = new Set<string>()

  if (question.type === 'multi') {
    // Find the column for this option
    const optionCol = question.columns.find(c => c.optionLabel === option)
    if (!optionCol) return { count: 0, denom: 0 }

    const headersToCheck = [optionCol.header, ...(optionCol.alternateHeaders || [])]

    for (const row of rows) {
      const respondent = stripQuotes(String(row[respIdCol] ?? '').trim())
      if (!respondent) continue

      // Check if respondent answered this question at all
      let hasAnswer = false
      for (const col of question.columns) {
        const headers = [col.header, ...(col.alternateHeaders || [])]
        for (const h of headers) {
          const val = row[h]
          if (val === 1 || val === '1' || val === true) {
            hasAnswer = true
            break
          }
        }
        if (hasAnswer) break
      }
      if (!hasAnswer) continue

      answered.add(respondent)

      // Check if selected this option
      for (const header of headersToCheck) {
        const val = row[header]
        if (val === 1 || val === '1' || val === true) {
          seen.add(respondent)
          break
        }
      }
    }
  } else if (question.singleSourceColumn) {
    // Single select
    for (const row of rows) {
      const respondent = stripQuotes(String(row[respIdCol] ?? '').trim())
      if (!respondent) continue

      const value = stripQuotes(String(row[question.singleSourceColumn] ?? ''))
      if (!value) continue

      answered.add(respondent)
      if (value.toLowerCase() === option.toLowerCase()) {
        seen.add(respondent)
      }
    }
  }

  return { count: seen.size, denom: answered.size }
}

function calculateStandardPopulation(
  rows: Record<string, any>[],
  controlVariables: string[],
  questions: QuestionDef[]
): SegmentDistribution[] {
  const distributions: SegmentDistribution[] = []
  const totalRespondents = new Set(
    rows.map(r => stripQuotes(String(r['Respondent Id'] ?? '').trim())).filter(Boolean)
  ).size

  for (const control of controlVariables) {
    const values = getUniqueValues(rows, control, questions)
    for (const value of values) {
      const matchingRespondents = new Set<string>()
      for (const row of rows) {
        const respondent = stripQuotes(String(row['Respondent Id'] ?? '').trim())
        const rowValue = getSegmentValue(row, control, questions)
        if (respondent && rowValue === value) {
          matchingRespondents.add(respondent)
        }
      }
      distributions.push({
        segment: control,
        value,
        count: matchingRespondents.size,
        proportion: matchingRespondents.size / totalRespondents
      })
    }
  }

  return distributions
}

function getStratumWeight(
  segments: SegmentDef[],
  standardPopulation: SegmentDistribution[]
): number {
  // Multiply the proportions together (assuming independence)
  let weight = 1
  for (const seg of segments) {
    const dist = standardPopulation.find(d => d.segment === seg.column && d.value === seg.value)
    if (dist) {
      weight *= dist.proportion
    }
  }
  return weight
}

// ============================================================================
// Propensity Score Weighting
// ============================================================================

/**
 * Perform propensity score weighting to balance demographics between groups.
 *
 * This calculates the probability of being in the reference group given demographics,
 * then uses inverse probability weighting to create a "balanced" comparison.
 */
export function performPropensityWeighting(
  dataset: ParsedCSV,
  question: QuestionDef,
  option: string,
  primaryComparison: { column: string; referenceGroup: string; targetGroup: string },
  controlVariables: string[]
): PropensityWeightedResult {
  const rows = dataset.rows
  const columns = dataset.summary.columns
  const questions = dataset.questions

  // Get respondent-level data with group assignment and demographics
  const respondentData = getRespondentLevelData(
    rows,
    primaryComparison.column,
    controlVariables,
    columns,
    questions
  )

  // Calculate propensity scores using logistic regression approximation
  const propensityScores = calculatePropensityScores(
    respondentData,
    primaryComparison.referenceGroup,
    primaryComparison.targetGroup,
    controlVariables
  )

  // Calculate IPW weights for target group
  const weights = calculateIPWeights(
    propensityScores,
    primaryComparison.referenceGroup,
    primaryComparison.targetGroup
  )

  // Calculate raw (unweighted) comparison
  const rawReference = calculateGroupPercent(
    rows.filter(r => getSegmentValue(r, primaryComparison.column, questions) === primaryComparison.referenceGroup),
    question,
    option,
    columns
  )
  const rawTarget = calculateGroupPercent(
    rows.filter(r => getSegmentValue(r, primaryComparison.column, questions) === primaryComparison.targetGroup),
    question,
    option,
    columns
  )

  // Calculate weighted comparison for target group
  const targetRows = rows.filter(r =>
    getSegmentValue(r, primaryComparison.column, questions) === primaryComparison.targetGroup
  )
  const weightedTarget = calculateWeightedGroupPercent(
    targetRows,
    question,
    option,
    columns,
    weights
  )

  // Calculate demographic balance before/after
  const demographicBalance = calculateDemographicBalance(
    rows,
    primaryComparison,
    controlVariables,
    weights,
    questions
  )

  // Calculate effective sample size
  const effectiveSampleSize = calculateEffectiveSampleSize(weights)

  return {
    question,
    option,
    referenceGroup: primaryComparison.referenceGroup,
    targetGroup: primaryComparison.targetGroup,
    rawComparison: {
      referencePercent: rawReference,
      targetPercent: rawTarget,
      difference: rawTarget - rawReference
    },
    weightedComparison: {
      referencePercent: rawReference,  // Reference stays the same
      targetWeightedPercent: weightedTarget,
      adjustedDifference: weightedTarget - rawReference
    },
    demographicBalance,
    effectiveSampleSize
  }
}

interface RespondentRecord {
  respondentId: string
  group: string
  demographics: Record<string, string>
}

function getRespondentLevelData(
  rows: Record<string, any>[],
  groupColumn: string,
  controlVariables: string[],
  columns: string[],
  questions: QuestionDef[]
): RespondentRecord[] {
  const respondentMap = new Map<string, RespondentRecord>()

  for (const row of rows) {
    const respondentId = getRespondentId(row, columns)
    if (!respondentId) continue

    if (respondentMap.has(respondentId)) continue

    const group = getSegmentValue(row, groupColumn, questions)
    if (!group) continue

    const demographics: Record<string, string> = {}
    for (const control of controlVariables) {
      const value = getSegmentValue(row, control, questions)
      if (value) demographics[control] = value
    }

    respondentMap.set(respondentId, {
      respondentId,
      group,
      demographics
    })
  }

  return Array.from(respondentMap.values())
}

function calculatePropensityScores(
  respondentData: RespondentRecord[],
  referenceGroup: string,
  targetGroup: string,
  controlVariables: string[]
): Map<string, number> {
  // Filter to just the two groups we're comparing
  const relevantData = respondentData.filter(
    r => r.group === referenceGroup || r.group === targetGroup
  )

  if (relevantData.length === 0) {
    return new Map()
  }

  // Simple propensity score estimation using demographic distributions
  // This is a simplified approach - a full implementation would use logistic regression

  // Calculate P(reference | demographics) for each demographic combination
  const demographicCounts: Map<string, { reference: number; target: number }> = new Map()

  for (const record of relevantData) {
    const demoKey = controlVariables
      .map(v => record.demographics[v] || 'missing')
      .join('|')

    if (!demographicCounts.has(demoKey)) {
      demographicCounts.set(demoKey, { reference: 0, target: 0 })
    }

    const counts = demographicCounts.get(demoKey)!
    if (record.group === referenceGroup) {
      counts.reference++
    } else {
      counts.target++
    }
  }

  // Calculate propensity scores
  const scores = new Map<string, number>()
  for (const record of relevantData) {
    const demoKey = controlVariables
      .map(v => record.demographics[v] || 'missing')
      .join('|')

    const counts = demographicCounts.get(demoKey)!
    const total = counts.reference + counts.target

    // Propensity = P(being in reference group | demographics)
    // Add smoothing to avoid 0 or 1 probabilities
    const propensity = (counts.reference + 0.5) / (total + 1)
    scores.set(record.respondentId, propensity)
  }

  return scores
}

function calculateIPWeights(
  propensityScores: Map<string, number>,
  _referenceGroup: string,
  _targetGroup: string
): Map<string, number> {
  const weights = new Map<string, number>()

  for (const [respondentId, propensity] of propensityScores) {
    // For target group: weight = propensity / (1 - propensity)
    // This makes target group's demographics match reference group
    // For reference group: weight = 1 (no adjustment needed)

    // Clip propensity to avoid extreme weights
    const clippedPropensity = Math.max(0.05, Math.min(0.95, propensity))
    const weight = clippedPropensity / (1 - clippedPropensity)

    // Normalize weights to avoid extreme values (trim at 10x)
    weights.set(respondentId, Math.min(weight, 10))
  }

  return weights
}

function calculateGroupPercent(
  rows: Record<string, any>[],
  question: QuestionDef,
  option: string,
  columns: string[]
): number {
  const { count, denom } = countOptionResponses(rows, question, option, columns)
  return denom > 0 ? (count / denom) * 100 : 0
}

function calculateWeightedGroupPercent(
  rows: Record<string, any>[],
  question: QuestionDef,
  option: string,
  columns: string[],
  weights: Map<string, number>
): number {
  const respIdCol = columns.find(
    c => c.toLowerCase() === 'respondent id' || c.toLowerCase() === 'respondent_id'
  ) || columns[0]

  let weightedCount = 0
  let weightedDenom = 0

  if (question.type === 'multi') {
    const optionCol = question.columns.find(c => c.optionLabel === option)
    if (!optionCol) return 0

    const headersToCheck = [optionCol.header, ...(optionCol.alternateHeaders || [])]
    const seen = new Set<string>()

    for (const row of rows) {
      const respondent = stripQuotes(String(row[respIdCol] ?? '').trim())
      if (!respondent || seen.has(respondent)) continue
      seen.add(respondent)

      const weight = weights.get(respondent) || 1

      // Check if answered question
      let hasAnswer = false
      for (const col of question.columns) {
        const headers = [col.header, ...(col.alternateHeaders || [])]
        for (const h of headers) {
          const val = row[h]
          if (val === 1 || val === '1' || val === true) {
            hasAnswer = true
            break
          }
        }
        if (hasAnswer) break
      }
      if (!hasAnswer) continue

      weightedDenom += weight

      for (const header of headersToCheck) {
        const val = row[header]
        if (val === 1 || val === '1' || val === true) {
          weightedCount += weight
          break
        }
      }
    }
  } else if (question.singleSourceColumn) {
    const seen = new Set<string>()

    for (const row of rows) {
      const respondent = stripQuotes(String(row[respIdCol] ?? '').trim())
      if (!respondent || seen.has(respondent)) continue
      seen.add(respondent)

      const weight = weights.get(respondent) || 1
      const value = stripQuotes(String(row[question.singleSourceColumn] ?? ''))
      if (!value) continue

      weightedDenom += weight
      if (value.toLowerCase() === option.toLowerCase()) {
        weightedCount += weight
      }
    }
  }

  return weightedDenom > 0 ? (weightedCount / weightedDenom) * 100 : 0
}

function calculateDemographicBalance(
  rows: Record<string, any>[],
  primaryComparison: { column: string; referenceGroup: string; targetGroup: string },
  controlVariables: string[],
  weights: Map<string, number>,
  questions: QuestionDef[]
): { before: Record<string, SegmentDistribution[]>; after: Record<string, SegmentDistribution[]> } {
  const before: Record<string, SegmentDistribution[]> = {}
  const after: Record<string, SegmentDistribution[]> = {}

  for (const control of controlVariables) {
    before[control] = []
    after[control] = []

    const values = getUniqueValues(rows, control, questions)

    for (const value of values) {
      // Calculate before (unweighted)
      let refCount = 0
      let targetCount = 0
      let refTotal = 0
      let targetTotal = 0
      let targetWeightedCount = 0
      let targetWeightedTotal = 0

      const seen = new Set<string>()

      for (const row of rows) {
        const respondent = stripQuotes(String(row['Respondent Id'] ?? '').trim())
        if (!respondent || seen.has(respondent)) continue
        seen.add(respondent)

        const group = getSegmentValue(row, primaryComparison.column, questions)
        const controlValue = getSegmentValue(row, control, questions)

        if (group === primaryComparison.referenceGroup) {
          refTotal++
          if (controlValue === value) refCount++
        } else if (group === primaryComparison.targetGroup) {
          targetTotal++
          const weight = weights.get(respondent) || 1
          targetWeightedTotal += weight
          if (controlValue === value) {
            targetCount++
            targetWeightedCount += weight
          }
        }
      }

      before[control].push({
        segment: control,
        value,
        count: targetCount,
        proportion: targetTotal > 0 ? targetCount / targetTotal : 0
      })

      after[control].push({
        segment: control,
        value,
        count: Math.round(targetWeightedCount),
        proportion: targetWeightedTotal > 0 ? targetWeightedCount / targetWeightedTotal : 0
      })
    }
  }

  return { before, after }
}

function calculateEffectiveSampleSize(weights: Map<string, number>): number {
  const weightsArray = Array.from(weights.values())
  if (weightsArray.length === 0) return 0

  const sumWeights = weightsArray.reduce((a, b) => a + b, 0)
  const sumSquaredWeights = weightsArray.reduce((a, b) => a + b * b, 0)

  // Kish's effective sample size
  return (sumWeights * sumWeights) / sumSquaredWeights
}

// ============================================================================
// Analysis Runner
// ============================================================================

export interface OptionAnalysisResult {
  option: string
  rawDifference: number           // Before adjustment
  adjustedDifference: number      // After adjustment
  compositionEffect: number       // How much is explained by demographics
  targetGroupPercent: number      // e.g., Female's % who selected this option
  referenceGroupPercent: number   // e.g., Male's % who selected this option
  isSignificant: boolean          // True if gap >= 5% (meaningful difference)
  favoredGroup: string            // Which group is more likely to select this
  favoredGroupLabel: string       // e.g., "Females are 12% more likely"
}

export interface FullRegressionAnalysis {
  config: RegressionAnalysisConfig
  stratifiedResults: StratifiedAnalysisResult[]
  propensityResults: PropensityWeightedResult[]
  optionResults: OptionAnalysisResult[]  // All options analyzed
  summary: {
    rawDifference: number
    stratifiedDifference: number
    propensityDifference: number
    questionLabel: string        // The question being analyzed
    optionAnalyzed: string       // The specific option being measured (legacy, for first option)
    compositionEffect: number    // How much is explained by demographics
    behavioralEffect: number     // Residual "true" difference
    interpretation: string
  }
}

/**
 * Run full regression analysis on a question to isolate segment effects.
 * Analyzes ALL answer options and ranks them by the size of the adjusted gap.
 */
export function runRegressionAnalysis(
  dataset: ParsedCSV,
  question: QuestionDef,
  config: RegressionAnalysisConfig
): FullRegressionAnalysis {
  const options = question.columns.map(c => c.optionLabel).filter(Boolean)
  const targetGroup = config.primaryComparison.targetGroup
  const referenceGroup = config.primaryComparison.referenceGroup
  const controlColumns = config.controlVariables.map(c => c.column)

  const stratifiedResults: StratifiedAnalysisResult[] = []
  const propensityResults: PropensityWeightedResult[] = []
  const optionResults: OptionAnalysisResult[] = []

  // Analyze ALL options for this question
  for (const option of options) {
    if (config.analysisType === 'stratified' || config.analysisType === 'all') {
      const stratified = performStratifiedAnalysis(
        dataset,
        question,
        option,
        {
          column: config.primaryComparison.column,
          groups: [referenceGroup, targetGroup]
        },
        controlColumns
      )
      stratifiedResults.push(stratified)

      // Extract percentages for each group
      const targetPercent = stratified.rawComparison.groups[targetGroup]?.percent || 0
      const referencePercent = stratified.rawComparison.groups[referenceGroup]?.percent || 0
      const rawDiff = targetPercent - referencePercent
      const adjustedDiff = stratified.adjustedComparison.adjustedDifference
      const compositionEffect = rawDiff - adjustedDiff

      // Determine which group is favored (using adjusted difference)
      const isTargetFavored = adjustedDiff > 0
      const favoredGroup = isTargetFavored ? targetGroup : referenceGroup
      const absAdjusted = Math.abs(adjustedDiff)

      // Create human-readable label like "Females are 12% more likely"
      const groupLabel = formatGroupLabel(favoredGroup)
      const favoredGroupLabel = `${groupLabel} are ${absAdjusted.toFixed(0)}% more likely`

      // Significance threshold: >= 5% gap is meaningful
      const isSignificant = absAdjusted >= 5

      optionResults.push({
        option,
        rawDifference: rawDiff,
        adjustedDifference: adjustedDiff,
        compositionEffect,
        targetGroupPercent: targetPercent,
        referenceGroupPercent: referencePercent,
        isSignificant,
        favoredGroup,
        favoredGroupLabel
      })
    }
  }

  // Sort options by absolute adjusted difference (largest gaps first)
  optionResults.sort((a, b) => Math.abs(b.adjustedDifference) - Math.abs(a.adjustedDifference))

  // For the summary, use the option with the largest gap
  const topOption = optionResults[0]
  const rawDiff = topOption?.rawDifference || 0
  const stratDiff = topOption?.adjustedDifference || 0
  const propDiff = stratDiff // Use stratified as propensity approximation
  const compositionEffect = topOption?.compositionEffect || 0
  const behavioralEffect = stratDiff

  const interpretation = generateOverallInterpretation(
    optionResults,
    targetGroup,
    referenceGroup,
    controlColumns,
    config.primaryComparison.column,
    question.label
  )

  return {
    config,
    stratifiedResults,
    propensityResults,
    optionResults,
    summary: {
      rawDifference: rawDiff,
      stratifiedDifference: stratDiff,
      propensityDifference: propDiff,
      questionLabel: question.label,
      optionAnalyzed: topOption?.option || '',
      compositionEffect,
      behavioralEffect,
      interpretation
    }
  }
}

/**
 * Format group name for display (e.g., "Female" -> "Females", "CRM" -> "CRM respondents")
 */
function formatGroupLabel(group: string): string {
  const lower = group.toLowerCase()
  if (lower === 'female') return 'Females'
  if (lower === 'male') return 'Males'
  // For other groups, keep as-is
  return group
}

/**
 * Generate an overall interpretation based on all option results
 */
function generateOverallInterpretation(
  optionResults: OptionAnalysisResult[],
  targetGroup: string,
  referenceGroup: string,
  controls: string[],
  _primaryColumn: string,
  _questionLabel: string
): string {
  const significantOptions = optionResults.filter(o => o.isSignificant)
  const controlsText = controls.join(' and ')

  if (significantOptions.length === 0) {
    return `After controlling for ${controlsText}, there are no significant differences (>5%) between ${targetGroup} and ${referenceGroup} for any answer options in this question.`
  }

  const topOption = significantOptions[0]
  const absAdj = Math.abs(topOption.adjustedDifference).toFixed(0)
  const favoredLabel = formatGroupLabel(topOption.favoredGroup)

  if (significantOptions.length === 1) {
    return `After controlling for ${controlsText}, ${favoredLabel} are ${absAdj}% more likely to select "${topOption.option}" compared to ${topOption.favoredGroup === targetGroup ? referenceGroup : targetGroup}.`
  }

  return `After controlling for ${controlsText}, there are ${significantOptions.length} answer options with significant differences. The largest gap is "${topOption.option}" where ${favoredLabel} are ${absAdj}% more likely.`
}

function _generateInterpretation(
  rawDiff: number,
  stratDiff: number,
  _propDiff: number,
  compositionEffect: number,
  targetGroup: string,
  referenceGroup: string,
  controls: string[],
  primaryColumn: string,
  _questionLabel: string,
  optionAnalyzed: string
): string {
  const direction = rawDiff > 0 ? 'more likely' : 'less likely'
  const absRaw = Math.abs(rawDiff).toFixed(1)
  const absAdj = Math.abs(stratDiff).toFixed(1)

  // Format control variables for display
  const controlsText = controls.join(' and ')

  // Create a short description of what's being measured
  const _metricDesc = optionAnalyzed
    ? `selecting "${optionAnalyzed}"`
    : 'this response'

  if (Math.abs(compositionEffect) < 1) {
    return `${targetGroup} respondents are ${absRaw}% ${direction} than ${referenceGroup} to select "${optionAnalyzed}". ` +
           `Even after accounting for ${controlsText} differences, the gap stays about the same (${absAdj}%). ` +
           `This suggests it's a real ${primaryColumn} difference, not caused by ${controlsText}.`
  }

  if (Math.abs(stratDiff) < 2) {
    return `At first glance, ${targetGroup} appears ${absRaw}% ${direction} than ${referenceGroup} to select "${optionAnalyzed}". ` +
           `But once we account for ${controlsText} differences, the gap nearly disappears (${absAdj}%). ` +
           `The original difference was mostly because ${targetGroup} and ${referenceGroup} have different ${controlsText} compositions.`
  }

  return `${targetGroup} respondents are ${absRaw}% ${direction} than ${referenceGroup} to select "${optionAnalyzed}". ` +
         `After accounting for ${controlsText} differences, the gap is ${absAdj}%. ` +
         `Part of the original difference was due to ${controlsText} composition, but a real ${primaryColumn} difference remains.`
}

// ============================================================================
// Exports for UI
// ============================================================================

export function getAvailableControlVariables(dataset: ParsedCSV): Array<{
  column: string
  label: string
  values: string[]
  type: 'segment' | 'question'
}> {
  const controls: Array<{
    column: string
    label: string
    values: string[]
    type: 'segment' | 'question'
  }> = []

  // Add segment columns
  for (const col of dataset.segmentColumns) {
    if (col === 'Overall') continue
    const values = getUniqueValues(dataset.rows, col, dataset.questions)
    if (values.length > 1 && values.length <= 20) {  // Reasonable number of categories
      controls.push({
        column: col,
        label: col,
        values,
        type: 'segment'
      })
    }
  }

  // Add relevant questions (single-select, non-ranking)
  for (const q of dataset.questions) {
    if (q.type === 'single' && q.singleSourceColumn) {
      const values = getUniqueValues(dataset.rows, q.qid, dataset.questions)
      if (values.length > 1 && values.length <= 15) {
        controls.push({
          column: q.qid,
          label: q.label,
          values,
          type: 'question'
        })
      }
    }
  }

  return controls
}
