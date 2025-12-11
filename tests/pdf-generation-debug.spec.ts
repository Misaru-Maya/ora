import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Lululemon_Technical_Design_Test-1765226466306.csv'
const DESKTOP_PATH = '/Users/misakifunada/Desktop'

test.describe('PDF Generation Debug', () => {
  test('generate PDF and log dimensions', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(3000)

    // Add console listener to capture logs from page
    page.on('console', msg => {
      if (msg.text().includes('PDF_DEBUG')) {
        console.log(msg.text())
      }
    })

    // Inject debug logging into the PDF export
    await page.evaluate(() => {
      // Find the Export PDF button
      const exportButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Export PDF'))

      if (exportButton) {
        console.log('PDF_DEBUG: Export button found')
      }
    })

    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 })

    // Click the Export PDF button
    const exportPdfButton = page.locator('button:has-text("Export PDF")')
    await exportPdfButton.click()

    // Wait for download
    const download = await downloadPromise
    const suggestedFilename = download.suggestedFilename()

    // Save to desktop with a debug suffix
    const desktopFilePath = path.join(DESKTOP_PATH, suggestedFilename.replace('.pdf', '_debug.pdf'))
    await download.saveAs(desktopFilePath)

    console.log(`\nPDF saved to: ${desktopFilePath}`)

    // Read the PDF to check dimensions (first few bytes contain some info)
    const pdfBuffer = fs.readFileSync(desktopFilePath)
    const pdfString = pdfBuffer.toString('utf8', 0, 2000)

    // Look for MediaBox which defines page dimensions in PDF
    const mediaBoxMatch = pdfString.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
    if (mediaBoxMatch) {
      console.log(`\nPDF MediaBox: [${mediaBoxMatch[1]}, ${mediaBoxMatch[2]}, ${mediaBoxMatch[3]}, ${mediaBoxMatch[4]}]`)
      console.log(`Page width: ${parseFloat(mediaBoxMatch[3]) - parseFloat(mediaBoxMatch[1])} points`)
      console.log(`Page height: ${parseFloat(mediaBoxMatch[4]) - parseFloat(mediaBoxMatch[2])} points`)
    } else {
      console.log('\nCould not find MediaBox in PDF header')
      // Log first part of PDF for debugging
      console.log('PDF header preview:', pdfString.substring(0, 500))
    }
  })
})
