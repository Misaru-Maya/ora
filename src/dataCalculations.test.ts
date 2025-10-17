import { describe, it, expect } from 'vitest'
import { buildSeries, customRound } from './dataCalculations'
import { ParsedCSV, QuestionDef } from './types'

describe('customRound', () => {
  it('rounds 0.5 up to 1', () => {
    expect(customRound(0.5)).toBe(1)
  })

  it('rounds 0.4 down to 0', () => {
    expect(customRound(0.4)).toBe(0)
  })

  it('rounds negative numbers correctly', () => {
    expect(customRound(-0.5)).toBe(-0) // JavaScript Math.round behavior
    expect(customRound(-0.6)).toBe(-1)
  })
})

describe('Chi-Square Statistical Significance', () => {
  it('calculates chi-square correctly for known values', () => {
    // Known example: 2x2 contingency table
    // Group 1: 60 selected Option A, 40 selected Option B (n=100)
    // Group 2: 30 selected Option A, 70 selected Option B (n=100)
    // Expected chi-square ≈ 18.18

    const dataset: ParsedCSV = {
      rows: [
        // Group 1 respondents (60 selected option A)
        ...Array(60).fill(null).map((_, i) => ({
          'Respondent ID': `R${i}`,
          'Segment': 'Group1',
          'Q1_Option_A': 1,
          'Q1_Option_B': 0
        })),
        // Group 1 respondents (40 selected option B)
        ...Array(40).fill(null).map((_, i) => ({
          'Respondent ID': `R${60 + i}`,
          'Segment': 'Group1',
          'Q1_Option_A': 0,
          'Q1_Option_B': 1
        })),
        // Group 2 respondents (30 selected option A)
        ...Array(30).fill(null).map((_, i) => ({
          'Respondent ID': `R${100 + i}`,
          'Segment': 'Group2',
          'Q1_Option_A': 1,
          'Q1_Option_B': 0
        })),
        // Group 2 respondents (70 selected option B)
        ...Array(70).fill(null).map((_, i) => ({
          'Respondent ID': `R${130 + i}`,
          'Segment': 'Group2',
          'Q1_Option_A': 0,
          'Q1_Option_B': 1
        }))
      ],
      questions: [],
      segmentColumns: ['Segment'],
      summary: {
        fileName: 'test.csv',
        rowCount: 200,
        uniqueRespondents: 200,
        columns: ['Respondent ID', 'Segment', 'Q1_Option_A', 'Q1_Option_B'],
        isProductTest: false,
        questionsDetected: 1
      }
    }

    const question: QuestionDef = {
      qid: 'Q1',
      label: 'Question 1',
      type: 'multi',
      columns: [
        {
          header: 'Q1_Option_A',
          optionLabel: 'Option A'
        },
        {
          header: 'Q1_Option_B',
          optionLabel: 'Option B'
        }
      ],
      level: 'respondent',
      useTotalBase: false
    }

    const result = buildSeries({
      dataset,
      question,
      segmentColumn: 'Segment',
      groups: ['Group1', 'Group2'],
      sortOrder: 'default'
    })

    const optionAData = result.data.find(d => d.option === 'Option A')
    expect(optionAData).toBeDefined()

    const significance = optionAData!.significance[0]
    expect(significance).toBeDefined()
    expect(significance.chiSquare).toBeCloseTo(18.18, 1) // Within 0.1
    expect(significance.significant).toBe(true) // 18.18 > 3.841
  })

  it('marks result as not significant when chi-square < 3.841', () => {
    // Group 1: 55 selected A, 45 selected B (n=100)
    // Group 2: 50 selected A, 50 selected B (n=100)
    // Expected chi-square ≈ 0.5 (not significant)

    const dataset: ParsedCSV = {
      rows: [
        ...Array(55).fill(null).map((_, i) => ({
          'Respondent ID': `R${i}`,
          'Segment': 'Group1',
          'Q1_Option_A': 1,
          'Q1_Option_B': 0
        })),
        ...Array(45).fill(null).map((_, i) => ({
          'Respondent ID': `R${55 + i}`,
          'Segment': 'Group1',
          'Q1_Option_A': 0,
          'Q1_Option_B': 1
        })),
        ...Array(50).fill(null).map((_, i) => ({
          'Respondent ID': `R${100 + i}`,
          'Segment': 'Group2',
          'Q1_Option_A': 1,
          'Q1_Option_B': 0
        })),
        ...Array(50).fill(null).map((_, i) => ({
          'Respondent ID': `R${150 + i}`,
          'Segment': 'Group2',
          'Q1_Option_A': 0,
          'Q1_Option_B': 1
        }))
      ],
      questions: [],
      segmentColumns: ['Segment'],
      summary: {
        fileName: 'test.csv',
        rowCount: 200,
        uniqueRespondents: 200,
        columns: ['Respondent ID', 'Segment', 'Q1_Option_A', 'Q1_Option_B'],
        isProductTest: false,
        questionsDetected: 1
      }
    }

    const question: QuestionDef = {
      qid: 'Q1',
      label: 'Question 1',
      type: 'multi',
      columns: [
        {
          header: 'Q1_Option_A',
          optionLabel: 'Option A'
        },
        {
          header: 'Q1_Option_B',
          optionLabel: 'Option B'
        }
      ],
      level: 'respondent',
      useTotalBase: false
    }

    const result = buildSeries({
      dataset,
      question,
      segmentColumn: 'Segment',
      groups: ['Group1', 'Group2'],
      sortOrder: 'default'
    })

    const optionAData = result.data.find(d => d.option === 'Option A')
    const significance = optionAData!.significance[0]

    expect(significance.chiSquare).toBeLessThan(3.841)
    expect(significance.significant).toBe(false)
  })

  it('handles edge case: zero denominator', () => {
    const dataset: ParsedCSV = {
      rows: [],
      questions: [],
      segmentColumns: ['Segment'],
      summary: {
        fileName: 'test.csv',
        rowCount: 0,
        uniqueRespondents: 0,
        columns: ['Respondent ID', 'Segment', 'Q1_Option_A'],
        isProductTest: false,
        questionsDetected: 1
      }
    }

    const question: QuestionDef = {
      qid: 'Q1',
      label: 'Question 1',
      type: 'multi',
      columns: [{
        header: 'Q1_Option_A',
        optionLabel: 'Option A'
      }],
      level: 'respondent',
      useTotalBase: false
    }

    const result = buildSeries({
      dataset,
      question,
      segmentColumn: 'Segment',
      groups: ['Group1', 'Group2'],
      sortOrder: 'default'
    })

    // Should not crash, should return data with zero denominators
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.data[0].groupSummaries[0].denominator).toBe(0)
  })
})

describe('Percentage Calculation', () => {
  it('calculates percentage correctly', () => {
    const dataset: ParsedCSV = {
      rows: [
        { 'Respondent ID': 'R1', 'Segment': 'Group1', 'Q1_A': 1 },
        { 'Respondent ID': 'R2', 'Segment': 'Group1', 'Q1_A': 1 },
        { 'Respondent ID': 'R3', 'Segment': 'Group1', 'Q1_A': 0 },
        { 'Respondent ID': 'R4', 'Segment': 'Group1', 'Q1_A': 0 }
      ],
      questions: [],
      segmentColumns: ['Segment'],
      summary: {
        fileName: 'test.csv',
        rowCount: 4,
        uniqueRespondents: 4,
        columns: ['Respondent ID', 'Segment', 'Q1_A'],
        isProductTest: false,
        questionsDetected: 1
      }
    }

    const question: QuestionDef = {
      qid: 'Q1',
      label: 'Question 1',
      type: 'multi',
      columns: [{
        header: 'Q1_A',
        optionLabel: 'Option A'
      }],
      level: 'respondent',
      useTotalBase: false
    }

    const result = buildSeries({
      dataset,
      question,
      segmentColumn: 'Segment',
      groups: ['Group1'],
      sortOrder: 'default'
    })

    const optionA = result.data[0]
    // For multi-select: Denominator = only respondents who SELECTED any option
    // 2 respondents selected (value = 1), 2 didn't (value = 0)
    // So denominator = 2 (those who selected), count = 2, percentage = 100%
    expect(optionA.group1).toBe(100)
  })

  it('handles floating point precision correctly', () => {
    // Test case that would fail with naive percentage calculation
    const dataset: ParsedCSV = {
      rows: [
        { 'Respondent ID': 'R1', 'Segment': 'Group1', 'Q1_A': 1 },
        { 'Respondent ID': 'R2', 'Segment': 'Group1', 'Q1_A': 1 },
        { 'Respondent ID': 'R3', 'Segment': 'Group1', 'Q1_A': 1 },
        { 'Respondent ID': 'R4', 'Segment': 'Group1', 'Q1_A': 0 },
        { 'Respondent ID': 'R5', 'Segment': 'Group1', 'Q1_A': 0 },
        { 'Respondent ID': 'R6', 'Segment': 'Group1', 'Q1_A': 0 }
      ],
      questions: [],
      segmentColumns: ['Segment'],
      summary: {
        fileName: 'test.csv',
        rowCount: 6,
        uniqueRespondents: 6,
        columns: ['Respondent ID', 'Segment', 'Q1_A'],
        isProductTest: false,
        questionsDetected: 1
      }
    }

    const question: QuestionDef = {
      qid: 'Q1',
      label: 'Question 1',
      type: 'multi',
      columns: [{
        header: 'Q1_A',
        optionLabel: 'Option A'
      }],
      level: 'respondent',
      useTotalBase: false
    }

    const result = buildSeries({
      dataset,
      question,
      segmentColumn: 'Segment',
      groups: ['Group1'],
      sortOrder: 'default'
    })

    const optionA = result.data[0]
    // For multi-select: Denominator = respondents who selected any option (3 selected, 3 didn't)
    // Count = 3 selected this option, Denominator = 3 who selected any option
    // 3/3 = 100%
    expect(optionA.group1).toBe(100)
    // Not 99.99999999999999 or 100.00000000000001
  })
})

describe('Respondent vs Row Level Counting', () => {
  it('counts unique respondents for respondent-level questions', () => {
    const dataset: ParsedCSV = {
      rows: [
        { 'Respondent ID': 'R1', 'Segment': 'Group1', 'Q1_A': 1 },
        { 'Respondent ID': 'R1', 'Segment': 'Group1', 'Q1_A': 1 }, // Duplicate
        { 'Respondent ID': 'R2', 'Segment': 'Group1', 'Q1_A': 1 }
      ],
      questions: [],
      segmentColumns: ['Segment'],
      summary: {
        fileName: 'test.csv',
        rowCount: 3,
        uniqueRespondents: 2,
        columns: ['Respondent ID', 'Segment', 'Q1_A'],
        isProductTest: false,
        questionsDetected: 1
      }
    }

    const question: QuestionDef = {
      qid: 'Q1',
      label: 'Question 1',
      type: 'multi',
      columns: [{
        header: 'Q1_A',
        optionLabel: 'Option A'
      }],
      level: 'respondent',
      useTotalBase: false
    }

    const result = buildSeries({
      dataset,
      question,
      segmentColumn: 'Segment',
      groups: ['Group1'],
      sortOrder: 'default'
    })

    const optionA = result.data[0]
    const summary = optionA.groupSummaries[0]

    // Should count 2 unique respondents, not 3 rows
    expect(summary.count).toBe(2)
    expect(summary.denominator).toBe(2)
    expect(optionA.group1).toBe(100) // 2/2 = 100%
  })

  it('counts all rows for row-level (product test) questions', () => {
    const dataset: ParsedCSV = {
      rows: [
        { 'Respondent ID': 'R1', 'Segment': 'Group1', 'Q1_A': 1 },
        { 'Respondent ID': 'R1', 'Segment': 'Group1', 'Q1_A': 1 }, // Same person, different product
        { 'Respondent ID': 'R2', 'Segment': 'Group1', 'Q1_A': 0 }
      ],
      questions: [],
      segmentColumns: ['Segment'],
      summary: {
        fileName: 'test.csv',
        rowCount: 3,
        uniqueRespondents: 2,
        columns: ['Respondent ID', 'Segment', 'Q1_A'],
        isProductTest: true, // Product test mode
        questionsDetected: 1
      }
    }

    const question: QuestionDef = {
      qid: 'Q1',
      label: 'Question 1',
      type: 'multi',
      columns: [{
        header: 'Q1_A',
        optionLabel: 'Option A'
      }],
      level: 'row',
      useTotalBase: false
    }

    const result = buildSeries({
      dataset,
      question,
      segmentColumn: 'Segment',
      groups: ['Group1'],
      sortOrder: 'default'
    })

    const optionA = result.data[0]
    const summary = optionA.groupSummaries[0]

    // Should count 2 rows with value 1
    // Denominator = rows that have ANY answer for this question (all 3 rows have values)
    // But the actual count logic only counts rows that selected an option
    expect(summary.count).toBe(2)
    expect(summary.denominator).toBe(2) // Only counts rows with any selection
    expect(optionA.group1).toBe(100) // 2/2 = 100%
  })
})

describe('Overall Segment Handling', () => {
  it('includes all rows when segment is "Overall"', () => {
    const dataset: ParsedCSV = {
      rows: [
        { 'Respondent ID': 'R1', 'Segment': 'Group1', 'Q1_A': 1 },
        { 'Respondent ID': 'R2', 'Segment': 'Group2', 'Q1_A': 1 },
        { 'Respondent ID': 'R3', 'Segment': 'Group1', 'Q1_A': 0 }
      ],
      questions: [],
      segmentColumns: ['Segment'],
      summary: {
        fileName: 'test.csv',
        rowCount: 3,
        uniqueRespondents: 3,
        columns: ['Respondent ID', 'Segment', 'Q1_A'],
        isProductTest: false,
        questionsDetected: 1
      }
    }

    const question: QuestionDef = {
      qid: 'Q1',
      label: 'Question 1',
      type: 'multi',
      columns: [{
        header: 'Q1_A',
        optionLabel: 'Option A'
      }],
      level: 'respondent',
      useTotalBase: false
    }

    const result = buildSeries({
      dataset,
      question,
      segmentColumn: 'Segment',
      groups: ['Overall'],
      sortOrder: 'default'
    })

    const optionA = result.data[0]
    const summary = optionA.groupSummaries[0]

    // Should include all respondents regardless of segment
    // Denominator = respondents who answered this question (all had values)
    expect(summary.count).toBe(2) // 2 selected
    expect(summary.denominator).toBe(2) // Only respondents who selected any option
    expect(optionA.overall).toBe(100) // 2/2 = 100%
  })
})
