import { parse } from 'papaparse'
import fs from 'fs'
import { parseCSVToDataset } from '../src/csvParser.ts'

try {
  const csv = fs.readFileSync('test-sample.csv', 'utf8')
  const parsed = parse<Record<string, any>>(csv, { header: true, skipEmptyLines: true })
  if (parsed.errors.length) {
    console.error('Parse errors:', parsed.errors)
    process.exit(1)
  }
  const rows = parsed.data
  const dataset = parseCSVToDataset(rows, 'test')

  const summary = dataset.questions.slice(0, 5).map(q => ({
    qid: q.qid,
    label: q.label,
    type: q.type,
    options: q.columns.map(c => c.optionLabel).slice(0, 6),
  }))
  console.log('Questions sample:', JSON.stringify(summary, null, 2))
} catch (err) {
  console.error('Error inspecting dataset:', err)
  process.exit(1)
}
