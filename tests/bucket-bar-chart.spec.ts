import { test, expect } from '@playwright/test'

// Test CSV with product data
const TEST_CSV_PATH = '/Users/misakifunada/Downloads/Asics_Mens_Trail_Competitor_Test-1764871818326.csv'

test.describe('Product Bucket Bar Chart Debug', () => {
  test('Bar chart shows data for both buckets', async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to load
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the test CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for the file to be processed and charts to appear
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 60000 })
    await page.waitForTimeout(3000)

    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // The first bucket should be in editing mode by default
    // Find the scrollable product selection area
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    // Get all product buttons within the selection area and add some to bucket 1
    const productButtons = productSelectionArea.locator('button')
    const buttonCount = await productButtons.count()
    console.log(`Found ${buttonCount} product buttons`)

    // Add first 3 products to Bucket 1
    // Verify the selection component stays open after each click
    if (buttonCount >= 3) {
      await productButtons.nth(0).click({ force: true })
      await page.waitForTimeout(200)
      // Verify product selection area is still visible
      await expect(productSelectionArea).toBeVisible()

      await productButtons.nth(1).click({ force: true })
      await page.waitForTimeout(200)
      // Verify product selection area is still visible
      await expect(productSelectionArea).toBeVisible()

      await productButtons.nth(2).click({ force: true })
      await page.waitForTimeout(500)
      // Verify product selection area is still visible after adding third product
      await expect(productSelectionArea).toBeVisible()
      console.log('✓ Product selection stayed open after selecting 3 products')
    }

    // Click the checkmark to close bucket 1 editing
    const checkmarkButton = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton.isVisible()) {
      await checkmarkButton.click()
      await page.waitForTimeout(300)
    }

    // Click Add Bucket to create Bucket 2
    const addBucketButton = page.locator('text=Add Bucket')
    await addBucketButton.click()
    await page.waitForTimeout(500)

    // Find the new product selection area (for bucket 2)
    const productSelectionArea2 = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea2).toBeVisible({ timeout: 5000 })

    // Get all product buttons and add different products to bucket 2
    const productButtons2 = productSelectionArea2.locator('button')
    const buttonCount2 = await productButtons2.count()
    console.log(`Found ${buttonCount2} product buttons for bucket 2`)

    // Add products 4, 5, 6 to Bucket 2
    if (buttonCount2 >= 6) {
      await productButtons2.nth(3).click({ force: true })
      await page.waitForTimeout(200)
      await productButtons2.nth(4).click({ force: true })
      await page.waitForTimeout(200)
      await productButtons2.nth(5).click({ force: true })
      await page.waitForTimeout(500)
    }

    // Close bucket 2 editing
    const checkmarkButton2 = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton2.isVisible()) {
      await checkmarkButton2.click()
      await page.waitForTimeout(300)
    }

    // Now enable "View by Buckets" toggle - it's a checkbox input inside a label
    // The checkbox input is hidden, so click on the visual label element instead
    const viewByBucketsToggleLabel = page.locator('text=View by Buckets').locator('..').locator('label')
    await viewByBucketsToggleLabel.scrollIntoViewIfNeeded()
    // Check if the toggle is already enabled
    const isChecked = await page.locator('text=View by Buckets').locator('..').locator('input[type="checkbox"]').isChecked()
    console.log(`View by Buckets toggle is currently: ${isChecked ? 'ON' : 'OFF'}`)
    if (!isChecked) {
      await viewByBucketsToggleLabel.click({ force: true })
    }
    await page.waitForTimeout(1000)

    // Take a screenshot to see the current state
    await page.screenshot({ path: 'test-results/bucket-bar-chart-state.png', fullPage: true })

    // Wait for charts to re-render
    await page.waitForTimeout(2000)

    // Look for bar chart bars - they should have recharts classes
    const barChartBars = page.locator('.recharts-bar-rectangle, .recharts-rectangle')
    const barCount = await barChartBars.count()
    console.log(`Found ${barCount} bar rectangles in charts`)

    // Check the legend items - look for Bucket 1 and Bucket 2 text on the page
    const bucket1Legend = page.locator('text=Bucket 1')
    const bucket2Legend = page.locator('text=Bucket 2')
    const bucket1Count = await bucket1Legend.count()
    const bucket2Count = await bucket2Legend.count()
    console.log(`Found ${bucket1Count} "Bucket 1" elements, ${bucket2Count} "Bucket 2" elements`)

    // Look at the chart data - inspect the DOM
    const chartContainers = page.locator('.recharts-responsive-container')
    const chartCount = await chartContainers.count()
    console.log(`Found ${chartCount} chart containers`)

    // Take another screenshot
    await page.screenshot({ path: 'test-results/bucket-bar-chart-final.png', fullPage: true })

    // The test should find some bar rectangles if data is being displayed
    // For debugging, we'll log what we find rather than fail
    if (barCount === 0) {
      console.log('WARNING: No bar rectangles found! Data may not be rendering.')

      // Let's check what the series data looks like by inspecting console logs
      const logs: string[] = []
      page.on('console', msg => logs.push(msg.text()))

      await page.reload()
      await page.waitForTimeout(5000)

      console.log('Console logs:', logs.filter(l => l.includes('series') || l.includes('bucket') || l.includes('group')))
    }

    expect(barCount).toBeGreaterThan(0)
  })
})
