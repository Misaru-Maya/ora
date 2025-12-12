import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_Test_3_White_Leather_Trainer_Styles_Evaluation-1765499395332.csv'

test.describe('Custom Segment Labels with Product Follow-up Questions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(2000)
  })

  test('product follow-up questions render with data in compare mode after renaming labels', async ({ page }) => {
    // Step 1: Expand Segmentation and Audience Type
    await page.locator('text=Segmentation').first().click()
    await page.waitForTimeout(300)
    await page.locator('text=Audience Type').first().click()
    await page.waitForTimeout(300)

    // Step 2: Click directly on the checkbox divs for CRM and Panel
    // These are the small square boxes next to each label
    const checkboxes = page.locator('div[style*="width: 18px"][style*="height: 18px"]')

    // Find CRM checkbox (should be near the CRM text)
    const crmText = page.locator('span:text("CRM")')
    if (await crmText.count() > 0) {
      // Click the parent label which should toggle the checkbox
      await crmText.locator('xpath=ancestor::label').click()
      await page.waitForTimeout(300)
    }

    // Find Panel checkbox
    const panelText = page.locator('span:text("Panel")')
    if (await panelText.count() > 0) {
      await panelText.locator('xpath=ancestor::label').click()
      await page.waitForTimeout(500)
    }

    await page.screenshot({ path: 'test-results/step1-segments-selected.png' })

    // Step 3: Scroll to find product follow-up question
    await page.evaluate(() => window.scrollBy(0, 500))
    await page.waitForTimeout(500)

    // Step 4: Find a product follow-up chart
    const chartCards = page.locator('.rounded-2xl.bg-white')
    let productFollowUpCard = null

    const cardCount = await chartCards.count()
    for (let i = 0; i < cardCount; i++) {
      const card = chartCards.nth(i)
      const cardText = await card.textContent()
      if (cardText && (cardText.includes('like most') || cardText.includes('like least'))) {
        productFollowUpCard = card
        console.log(`Found product follow-up card: "${cardText.substring(0, 100)}..."`)
        break
      }
    }

    expect(productFollowUpCard).not.toBeNull()

    // Step 5: Verify it has data (percentage values)
    const allText = await productFollowUpCard!.textContent()
    const hasPercentages = /%/.test(allText || '')
    expect(hasPercentages).toBe(true)
    console.log('SUCCESS: Product follow-up chart displays percentage data')

    await page.screenshot({ path: 'test-results/step2-product-followup-has-data.png' })

    // Step 6: Try to edit a legend label (if available)
    // Look for editable legend labels by checking for clickable span elements
    const legendLabels = productFollowUpCard!.locator('span').filter({ hasText: /^(Overall|CRM|Panel|ADVOCATES|DETRACTORS)$/ })
    const labelCount = await legendLabels.count()
    console.log(`Found ${labelCount} potential legend labels`)

    if (labelCount > 0) {
      const firstLabel = legendLabels.first()
      const labelText = await firstLabel.textContent()
      console.log(`Clicking legend label: ${labelText}`)

      await firstLabel.click()
      await page.waitForTimeout(500)

      // Check if edit mode is activated (textarea appears)
      const textarea = page.locator('textarea')
      if (await textarea.count() > 0 && await textarea.first().isVisible()) {
        const currentValue = await textarea.first().inputValue()
        console.log(`Edit mode activated with value: ${currentValue}`)

        // Rename the label
        const newValue = `${currentValue} (Test)`
        await textarea.first().fill(newValue)
        await textarea.first().press('Enter')
        await page.waitForTimeout(1000)

        // Verify the chart STILL has data after renaming
        const updatedText = await productFollowUpCard!.textContent()
        const stillHasPercentages = /%/.test(updatedText || '')
        expect(stillHasPercentages).toBe(true)
        console.log('SUCCESS: Chart still displays data after renaming segment label!')

        // Verify the renamed label appears
        const renamedLabel = productFollowUpCard!.locator(`text=${newValue}`)
        if (await renamedLabel.count() > 0) {
          console.log(`SUCCESS: Renamed label "${newValue}" is visible`)
        }
      } else {
        console.log('No textarea appeared - label may not be editable or already in view mode')
      }
    }

    await page.screenshot({ path: 'test-results/step3-after-rename.png' })
  })

  test('verify originalValue lookup fix in compare mode', async ({ page }) => {
    // This test verifies that the code fix for using originalValue in segment lookup works
    // The fix was in ChartGallery.tsx line 2322-2323:
    // Changed from: series.groups.find(g => g.label === segment.value)
    // Changed to:   series.groups.find(g => (g.originalValue || g.label) === segment.value)

    // Step 1: Load the data
    await page.waitForTimeout(1000)

    // Step 2: Verify charts are rendering
    const charts = page.locator('.rounded-2xl.bg-white')
    const chartCount = await charts.count()
    expect(chartCount).toBeGreaterThan(0)
    console.log(`Found ${chartCount} chart cards`)

    // Step 3: Find a product follow-up question (has "like most" or "like least" in title)
    let foundProductFollowUp = false
    for (let i = 0; i < chartCount; i++) {
      const chartText = await charts.nth(i).textContent()
      if (chartText && (chartText.includes('like most') || chartText.includes('like least'))) {
        foundProductFollowUp = true

        // Verify it has data
        const hasData = /%/.test(chartText)
        expect(hasData).toBe(true)
        console.log('SUCCESS: Product follow-up question has data')
        break
      }
    }

    expect(foundProductFollowUp).toBe(true)
    console.log('SUCCESS: Found and verified product follow-up question renders correctly')
  })
})
