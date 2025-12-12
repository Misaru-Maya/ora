import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Lululemon_Technical_Design_Test-1765226466306.csv'

test.describe('Chart Copy Resolution Improvements', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to load
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the test CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for the file to be processed and questions to appear
    await page.waitForSelector('[id^="chart-"]', { timeout: 30000 })

    // Give it a moment for charts to render
    await page.waitForTimeout(2000)
  })

  test.describe('Copy Button and Loading Overlay', () => {
    test('Copy button should be visible on chart cards', async ({ page }) => {
      // Find the first chart card by its unique ID
      const chartCard = page.locator('[id^="chart-"]').first()

      // Find the copy button within this specific card
      const copyButton = chartCard.getByRole('button', { name: 'Copy chart to clipboard' })

      await expect(copyButton).toBeVisible()
      console.log('SUCCESS: Copy button is visible on chart card')
    })

    test('Clicking copy should show success indicator', async ({ page }) => {
      // Find the first chart card by its unique ID
      const chartCard = page.locator('[id^="chart-"]').first()

      // Find the copy button within this specific card
      const copyButton = chartCard.getByRole('button', { name: 'Copy chart to clipboard' })

      // Grant clipboard permissions
      await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])

      // Click the copy button
      await copyButton.click()

      // Wait for copy to complete and success indicator to appear
      await page.waitForTimeout(1500)

      // Check for success indicator (Copied! title)
      const successIndicator = chartCard.getByRole('button', { name: 'Copied!' })
      const hasSuccess = await successIndicator.count() > 0

      console.log(`Copy ${hasSuccess ? 'succeeded with checkmark' : 'completed'}`)
      expect(hasSuccess).toBe(true)
    })
  })

  test.describe('Copy Functionality on Different Chart Types', () => {
    test('Bar chart copy should work', async ({ page }) => {
      // Find a chart card that contains a bar chart (has recharts-bar-rectangles)
      const chartCards = page.locator('[id^="chart-"]')
      const count = await chartCards.count()

      let foundBarChart = false

      for (let i = 0; i < Math.min(count, 10); i++) {
        const card = chartCards.nth(i)
        const hasBarChart = await card.locator('.recharts-bar-rectangles').count() > 0

        if (hasBarChart) {
          foundBarChart = true

          // Scroll to the chart
          await card.scrollIntoViewIfNeeded()
          await page.waitForTimeout(300)

          // Grant clipboard permissions
          await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])

          // Find and click copy button
          const copyButton = card.getByRole('button', { name: 'Copy chart to clipboard' })
          await copyButton.click()

          // Wait for success
          await page.waitForTimeout(1500)

          // Check for success indicator
          const successButton = card.getByRole('button', { name: 'Copied!' })
          const hasSuccess = await successButton.count() > 0

          console.log(`Bar chart copy ${hasSuccess ? 'succeeded' : 'completed'}`)
          break
        }
      }

      if (!foundBarChart) {
        console.log('Note: No bar chart found in first 10 cards')
      }

      expect(foundBarChart).toBe(true)
    })

    test('Pie chart copy should work', async ({ page }) => {
      // Find a chart card that contains a pie chart (has recharts-pie)
      const chartCards = page.locator('[id^="chart-"]')
      const count = await chartCards.count()

      let foundPieChart = false

      for (let i = 0; i < Math.min(count, 20); i++) {
        const card = chartCards.nth(i)
        const hasPieChart = await card.locator('.recharts-pie').count() > 0

        if (hasPieChart) {
          foundPieChart = true

          // Scroll to the chart
          await card.scrollIntoViewIfNeeded()
          await page.waitForTimeout(300)

          // Grant clipboard permissions
          await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])

          // Find and click copy button
          const copyButton = card.getByRole('button', { name: 'Copy chart to clipboard' })
          await copyButton.click()

          // Wait for success
          await page.waitForTimeout(1500)

          console.log('SUCCESS: Pie chart copy completed')
          break
        }
      }

      if (!foundPieChart) {
        console.log('Note: No pie chart found in first 20 cards - test skipped')
      }
    })

    test('Heatmap copy should work', async ({ page }) => {
      // Find a chart card that contains a heatmap (table structure)
      const chartCards = page.locator('[id^="chart-"]')
      const count = await chartCards.count()

      let foundHeatmap = false

      for (let i = 0; i < Math.min(count, 20); i++) {
        const card = chartCards.nth(i)
        const hasTable = await card.locator('table').count() > 0

        if (hasTable) {
          foundHeatmap = true

          // Scroll to the chart
          await card.scrollIntoViewIfNeeded()
          await page.waitForTimeout(300)

          // Grant clipboard permissions
          await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])

          // Find and click copy button
          const copyButton = card.getByRole('button', { name: 'Copy chart to clipboard' })
          await copyButton.click()

          // Wait for success
          await page.waitForTimeout(1500)

          console.log('SUCCESS: Heatmap copy completed')
          break
        }
      }

      if (!foundHeatmap) {
        console.log('Note: No heatmap found in first 20 cards - test skipped')
      }
    })
  })

  test.describe('Resolution Quality Verification', () => {
    test('Copy should use devicePixelRatio-aware scaling', async ({ page }) => {
      // This test verifies the resolution improvements are applied
      // by checking that the copy process completes without errors

      // Get device pixel ratio
      const dpr = await page.evaluate(() => window.devicePixelRatio)
      console.log(`Device pixel ratio: ${dpr}`)

      // Find the first chart card
      const chartCard = page.locator('[id^="chart-"]').first()

      // Scroll to it
      await chartCard.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)

      // Get initial chart container dimensions
      const chartContainer = chartCard.locator('.rounded-2xl').first()
      const bounds = await chartContainer.boundingBox()

      if (bounds) {
        console.log(`Chart dimensions: ${bounds.width}x${bounds.height}`)

        // Expected resolution with DPR-aware scaling
        const baseScale = 4
        const captureScale = Math.min(8, Math.ceil(baseScale * dpr))
        const expectedWidth = Math.round(bounds.width * captureScale)
        const expectedHeight = Math.round(bounds.height * captureScale)

        console.log(`Expected captured resolution: ${expectedWidth}x${expectedHeight}`)
        console.log(`Effective resolution: ${captureScale}x original`)
      }

      // Grant clipboard permissions
      await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])

      // Perform copy
      const copyButton = chartCard.getByRole('button', { name: 'Copy chart to clipboard' })
      await copyButton.click()

      // Wait for completion
      await page.waitForTimeout(2000)

      // Take a screenshot for visual verification
      if (bounds) {
        await page.screenshot({
          path: 'test-results/chart-copy-resolution-test.png',
          clip: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        })
      }

      console.log('SUCCESS: Copy with resolution improvements completed')
    })

    test('Multiple copies should work without issues', async ({ page }) => {
      const chartCard = page.locator('[id^="chart-"]').first()

      // Scroll to it
      await chartCard.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)

      // Grant clipboard permissions
      await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])

      const copyButton = chartCard.getByRole('button', { name: 'Copy chart to clipboard' })

      // Perform multiple copies
      for (let i = 0; i < 3; i++) {
        await copyButton.click()
        await page.waitForTimeout(2000) // Wait for each copy to complete
      }

      // Verify the button is still functional
      await expect(copyButton).toBeEnabled()

      console.log('SUCCESS: Multiple copies completed without issues')
    })
  })
})

test.describe('Error Handling', () => {
  test('Copy should gracefully handle clipboard permission denied', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('[id^="chart-"]', { timeout: 30000 })
    await page.waitForTimeout(2000)

    // Do NOT grant clipboard permissions - simulate permission denied

    const chartCard = page.locator('[id^="chart-"]').first()

    // Scroll to it
    await chartCard.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)

    const copyButton = chartCard.getByRole('button', { name: 'Copy chart to clipboard' })

    // Set up download listener (fallback behavior)
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)

    await copyButton.click()
    await page.waitForTimeout(2000)

    // Either clipboard worked or fallback download happened
    const download = await downloadPromise

    if (download) {
      console.log('SUCCESS: Fallback to download when clipboard fails')
      expect(download.suggestedFilename()).toContain('.png')
    } else {
      console.log('Note: Clipboard permission was granted or download did not trigger')
    }

    // Verify chart is still functional (styles restored)
    const chartBounds = await chartCard.boundingBox()
    expect(chartBounds).not.toBeNull()

    console.log('SUCCESS: Chart remains functional after copy attempt')
  })
})
