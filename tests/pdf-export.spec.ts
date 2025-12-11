import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Lululemon_Technical_Design_Test-1765226466306.csv'
const DESKTOP_PATH = '/Users/misakifunada/Desktop'

test.describe('PDF Export Feature', () => {
  test('should export chart gallery as PDF and save to desktop', async ({ page }) => {
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
    await page.waitForTimeout(5000)

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

    // Save the file to the desktop
    const desktopFilePath = path.join(DESKTOP_PATH, suggestedFilename)
    await download.saveAs(desktopFilePath)

    // Verify the file was saved
    expect(fs.existsSync(desktopFilePath)).toBe(true)

    // Verify it's a PDF (check file size is reasonable)
    const stats = fs.statSync(desktopFilePath)
    expect(stats.size).toBeGreaterThan(1000) // Should be at least 1KB

    console.log(`PDF saved to: ${desktopFilePath}`)
    console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`)
  })
})
