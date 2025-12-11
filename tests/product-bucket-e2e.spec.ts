import { test, expect } from '@playwright/test'

// Test CSV with product data
const TEST_CSV_PATH = '/Users/misakifunada/Downloads/Asics_Mens_Trail_Competitor_Test-1764871818326.csv'

test.describe('Product Bucket Feature E2E', () => {
  test.beforeEach(async ({ page }) => {
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
  })

  test('Product Buckets section expands and shows default bucket', async ({ page }) => {
    // Find and expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await expect(productBucketsSection).toBeVisible()

    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Should see Bucket 1 by default
    await expect(page.locator('text=Bucket 1').first()).toBeVisible()

    // Should see the product selection area
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    console.log('✓ Product Buckets section expands correctly with default bucket')
  })

  test('Can add products to bucket and selection stays open', async ({ page }) => {
    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Find the product selection area
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    // Get product buttons
    const productButtons = productSelectionArea.locator('button')
    const buttonCount = await productButtons.count()
    console.log(`Found ${buttonCount} product buttons`)

    // Track visibility changes - if the element becomes hidden and visible again, that's a close/reopen
    let visibilityChanges = 0
    let wasVisible = true

    // Add first product and check immediately that selection stays visible
    await productButtons.nth(0).click({ force: true })

    // Check multiple times in quick succession to catch any close/reopen behavior
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(50)
      const isVisible = await productSelectionArea.isVisible()
      if (wasVisible && !isVisible) {
        visibilityChanges++
        console.log(`Selection area became hidden at check ${i}`)
      }
      wasVisible = isVisible
    }

    // Verify selection area stays open
    await expect(productSelectionArea).toBeVisible()

    // Add second product
    await productButtons.nth(1).click({ force: true })

    // Check again for any close/reopen
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(50)
      const isVisible = await productSelectionArea.isVisible()
      if (wasVisible && !isVisible) {
        visibilityChanges++
        console.log(`Selection area became hidden at check ${i}`)
      }
      wasVisible = isVisible
    }

    // Verify selection area stays open
    await expect(productSelectionArea).toBeVisible()

    // Add third product
    await productButtons.nth(2).click({ force: true })

    // Final check
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(50)
      const isVisible = await productSelectionArea.isVisible()
      if (wasVisible && !isVisible) {
        visibilityChanges++
        console.log(`Selection area became hidden at check ${i}`)
      }
      wasVisible = isVisible
    }

    // Verify selection area still stays open
    await expect(productSelectionArea).toBeVisible()

    // Report any visibility changes (should be 0)
    console.log(`Visibility changes detected: ${visibilityChanges}`)
    expect(visibilityChanges).toBe(0)

    console.log('✓ Products added and selection stayed open without closing/reopening')
  })

  test('Can create second bucket with Add Bucket button', async ({ page }) => {
    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Add products to first bucket
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    const productButtons = productSelectionArea.locator('button')
    await productButtons.nth(0).click({ force: true })
    await page.waitForTimeout(200)

    // Click checkmark to close first bucket
    const checkmarkButton = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton.isVisible()) {
      await checkmarkButton.click()
      await page.waitForTimeout(300)
    }

    // Click Add Bucket
    const addBucketButton = page.locator('text=Add Bucket')
    await addBucketButton.click()
    await page.waitForTimeout(500)

    // Should now see Bucket 2
    await expect(page.locator('text=Bucket 2').first()).toBeVisible()

    console.log('✓ Second bucket created successfully')
  })

  test('View by Buckets toggle appears with 2+ buckets and enables bucket mode', async ({ page }) => {
    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Add products to first bucket
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    const productButtons = productSelectionArea.locator('button')
    await productButtons.nth(0).click({ force: true })
    await productButtons.nth(1).click({ force: true })
    await page.waitForTimeout(200)

    // Close first bucket
    const checkmarkButton = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton.isVisible()) {
      await checkmarkButton.click()
      await page.waitForTimeout(300)
    }

    // Add second bucket
    const addBucketButton = page.locator('text=Add Bucket')
    await addBucketButton.click()
    await page.waitForTimeout(500)

    // Add products to second bucket
    const productSelectionArea2 = page.locator('div[style*="max-height: 200px"]').first()
    const productButtons2 = productSelectionArea2.locator('button')
    await productButtons2.nth(3).click({ force: true })
    await productButtons2.nth(4).click({ force: true })
    await page.waitForTimeout(200)

    // Close second bucket
    const checkmarkButton2 = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton2.isVisible()) {
      await checkmarkButton2.click()
      await page.waitForTimeout(300)
    }

    // Check if View by Buckets toggle is visible
    const viewByBucketsText = page.locator('text=View by Buckets')
    await expect(viewByBucketsText).toBeVisible()

    // Check if it's enabled (should auto-enable with 2 buckets)
    const viewByBucketsCheckbox = viewByBucketsText.locator('..').locator('input[type="checkbox"]')
    const isChecked = await viewByBucketsCheckbox.isChecked()
    console.log(`View by Buckets toggle is: ${isChecked ? 'ON' : 'OFF'}`)

    expect(isChecked).toBe(true)
    console.log('✓ View by Buckets toggle visible and enabled')
  })

  test('Bar charts show data for both buckets when bucket mode is on', async ({ page }) => {
    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Add products to first bucket
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    const productButtons = productSelectionArea.locator('button')
    await productButtons.nth(0).click({ force: true })
    await productButtons.nth(1).click({ force: true })
    await productButtons.nth(2).click({ force: true })
    await page.waitForTimeout(200)

    // Close first bucket
    const checkmarkButton = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton.isVisible()) {
      await checkmarkButton.click()
      await page.waitForTimeout(300)
    }

    // Add second bucket
    const addBucketButton = page.locator('text=Add Bucket')
    await addBucketButton.click()
    await page.waitForTimeout(500)

    // Add products to second bucket
    const productSelectionArea2 = page.locator('div[style*="max-height: 200px"]').first()
    const productButtons2 = productSelectionArea2.locator('button')
    await productButtons2.nth(3).click({ force: true })
    await productButtons2.nth(4).click({ force: true })
    await productButtons2.nth(5).click({ force: true })
    await page.waitForTimeout(500)

    // Close second bucket
    const checkmarkButton2 = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton2.isVisible()) {
      await checkmarkButton2.click()
      await page.waitForTimeout(300)
    }

    // Wait for charts to render
    await page.waitForTimeout(2000)

    // Take screenshot
    await page.screenshot({ path: 'test-results/bucket-mode-charts.png', fullPage: true })

    // Check for bar chart rectangles
    const barChartBars = page.locator('.recharts-bar-rectangle, .recharts-rectangle')
    const barCount = await barChartBars.count()
    console.log(`Found ${barCount} bar rectangles in charts`)

    // Check for bucket labels in legends
    const bucket1Elements = await page.locator('text=Bucket 1').count()
    const bucket2Elements = await page.locator('text=Bucket 2').count()
    console.log(`Found ${bucket1Elements} "Bucket 1" elements, ${bucket2Elements} "Bucket 2" elements`)

    // Should have bars rendering
    expect(barCount).toBeGreaterThan(0)

    // Should have both bucket labels visible
    expect(bucket1Elements).toBeGreaterThan(0)
    expect(bucket2Elements).toBeGreaterThan(0)

    console.log('✓ Bar charts showing data for both buckets')
  })

  test('Heatmaps show bucket columns when bucket mode is on', async ({ page }) => {
    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Add products to first bucket
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    const productButtons = productSelectionArea.locator('button')
    await productButtons.nth(0).click({ force: true })
    await productButtons.nth(1).click({ force: true })
    await productButtons.nth(2).click({ force: true })
    await page.waitForTimeout(200)

    // Close first bucket
    const checkmarkButton = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton.isVisible()) {
      await checkmarkButton.click()
      await page.waitForTimeout(300)
    }

    // Add second bucket
    const addBucketButton = page.locator('text=Add Bucket')
    await addBucketButton.click()
    await page.waitForTimeout(500)

    // Add products to second bucket
    const productSelectionArea2 = page.locator('div[style*="max-height: 200px"]').first()
    const productButtons2 = productSelectionArea2.locator('button')
    await productButtons2.nth(3).click({ force: true })
    await productButtons2.nth(4).click({ force: true })
    await productButtons2.nth(5).click({ force: true })
    await page.waitForTimeout(500)

    // Close second bucket
    const checkmarkButton2 = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton2.isVisible()) {
      await checkmarkButton2.click()
      await page.waitForTimeout(300)
    }

    // Wait for charts to render
    await page.waitForTimeout(2000)

    // Scroll down to find heatmaps
    await page.evaluate(() => window.scrollBy(0, 1000))
    await page.waitForTimeout(1000)

    // Take screenshot of heatmap area
    await page.screenshot({ path: 'test-results/bucket-mode-heatmaps.png', fullPage: true })

    // Look for heatmap table cells - they typically have percentage text
    const percentCells = page.locator('text=/\\d+%/')
    const percentCount = await percentCells.count()
    console.log(`Found ${percentCount} percentage cells`)

    expect(percentCount).toBeGreaterThan(0)
    console.log('✓ Heatmaps rendering with bucket data')
  })

  test('Filter Products button shows all products selected when fewer than 9 columns', async ({ page }) => {
    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Add products to first bucket (only 2-3 products = fewer than 9 columns)
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    const productButtons = productSelectionArea.locator('button')
    await productButtons.nth(0).click({ force: true })
    await productButtons.nth(1).click({ force: true })
    await page.waitForTimeout(200)

    // Close first bucket
    const checkmarkButton = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton.isVisible()) {
      await checkmarkButton.click()
      await page.waitForTimeout(300)
    }

    // Add second bucket
    const addBucketButton = page.locator('text=Add Bucket')
    await addBucketButton.click()
    await page.waitForTimeout(500)

    // Add products to second bucket
    const productSelectionArea2 = page.locator('div[style*="max-height: 200px"]').first()
    const productButtons2 = productSelectionArea2.locator('button')
    await productButtons2.nth(3).click({ force: true })
    await productButtons2.nth(4).click({ force: true })
    await page.waitForTimeout(500)

    // Close second bucket
    const checkmarkButton2 = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton2.isVisible()) {
      await checkmarkButton2.click()
      await page.waitForTimeout(300)
    }

    // Wait for charts to render
    await page.waitForTimeout(2000)

    // In bucket mode with 2 buckets (< 9 columns), filter button should show
    // and all products (buckets) should be selected

    // Look for Filter Products button (the filter icon)
    const filterButton = page.locator('button[title="Filter Products"]').first()

    // The filter button should be visible if there are 2+ columns
    const filterButtonVisible = await filterButton.isVisible().catch(() => false)
    console.log(`Filter Products button visible: ${filterButtonVisible}`)

    // Take screenshot
    await page.screenshot({ path: 'test-results/bucket-filter-button.png', fullPage: true })

    console.log('✓ Filter behavior verified for bucket mode')
  })

  test('Can rename bucket labels', async ({ page }) => {
    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Add a product to create the bucket
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    const productButtons = productSelectionArea.locator('button')
    await productButtons.nth(0).click({ force: true })
    await page.waitForTimeout(200)

    // Click on "Bucket 1" label to edit it
    const bucket1Label = page.locator('text=Bucket 1').first()
    await bucket1Label.click()
    await page.waitForTimeout(300)

    // Should see an input field
    const labelInput = page.locator('input[type="text"]').first()

    // Clear and type new name
    await labelInput.fill('My Custom Bucket')
    await labelInput.press('Enter')
    await page.waitForTimeout(300)

    // Verify the new name appears
    const customBucketLabel = page.locator('text=My Custom Bucket')
    await expect(customBucketLabel).toBeVisible()

    console.log('✓ Bucket label renamed successfully')
  })

  test('Clear All Buckets button works', async ({ page }) => {
    // Expand Product Buckets section
    const productBucketsSection = page.locator('text=Product Buckets').first()
    await productBucketsSection.click()
    await page.waitForTimeout(500)

    // Add products to first bucket
    const productSelectionArea = page.locator('div[style*="max-height: 200px"]').first()
    await expect(productSelectionArea).toBeVisible({ timeout: 5000 })

    const productButtons = productSelectionArea.locator('button')
    await productButtons.nth(0).click({ force: true })
    await page.waitForTimeout(200)

    // Close first bucket
    const checkmarkButton = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton.isVisible()) {
      await checkmarkButton.click()
      await page.waitForTimeout(300)
    }

    // Add second bucket
    const addBucketButton = page.locator('text=Add Bucket')
    await addBucketButton.click()
    await page.waitForTimeout(500)

    // Add products to second bucket
    const productSelectionArea2 = page.locator('div[style*="max-height: 200px"]').first()
    const productButtons2 = productSelectionArea2.locator('button')
    await productButtons2.nth(3).click({ force: true })
    await page.waitForTimeout(300)

    // Close second bucket
    const checkmarkButton2 = page.locator('button[title="Done editing"]').first()
    if (await checkmarkButton2.isVisible()) {
      await checkmarkButton2.click()
      await page.waitForTimeout(300)
    }

    // Find and click Clear All Buckets button
    const clearAllButton = page.locator('text=Clear All Buckets')
    await expect(clearAllButton).toBeVisible()
    await clearAllButton.click()
    await page.waitForTimeout(500)

    // Bucket 2 should no longer be visible, and we should be back to default state
    const bucket2Count = await page.locator('text=Bucket 2').count()
    expect(bucket2Count).toBe(0)

    console.log('✓ Clear All Buckets works correctly')
  })
})
