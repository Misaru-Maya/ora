import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_Test_3_White_Leather_Trainer_Styles_Evaluation-1765499395332.csv'
const TEMP_PATH = '/tmp'

test.describe('PDF Export Feature', () => {
  test('should export chart gallery as PDF with content (not blank)', async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to load
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the test CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for the file to be processed and charts to appear
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })

    // Give it more time for charts to fully render
    await page.waitForTimeout(3000)

    // Verify the Export PDF button is visible
    const exportPdfButton = page.locator('button:has-text("Export PDF")')
    await expect(exportPdfButton).toBeVisible({ timeout: 10000 })

    // Set up download listener before clicking (increased timeout for larger PDF)
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 })

    // Click the Export PDF button
    await exportPdfButton.click()

    // Wait for the download to complete
    const download = await downloadPromise

    // Get the suggested filename
    const suggestedFilename = download.suggestedFilename()
    console.log('Downloaded file:', suggestedFilename)

    // Save the file to temp directory
    const tempFilePath = path.join(TEMP_PATH, suggestedFilename)
    await download.saveAs(tempFilePath)

    // Verify the file was saved
    expect(fs.existsSync(tempFilePath)).toBe(true)

    // Verify it's a PDF with actual content (not blank)
    // A blank PDF is typically < 5KB, a PDF with chart content should be > 50KB
    const stats = fs.statSync(tempFilePath)
    console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`)

    // Check that PDF has substantial content (not blank)
    expect(stats.size).toBeGreaterThan(50000) // Should be at least 50KB with charts

    console.log('SUCCESS: PDF exported with content (file size indicates non-blank)')

    // Clean up
    fs.unlinkSync(tempFilePath)
  })
})
