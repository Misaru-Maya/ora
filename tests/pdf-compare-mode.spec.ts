import { test, expect } from '@playwright/test'
import path from 'path'

const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_SS27_Big_Ideas_TerritoryConcept_Research-1765391859983.csv'

test.describe('PDF Export Compare vs Filter Mode', () => {
  test('should use Compare in filename when Compare toggle is ON', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload CSV
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for charts to load
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(2000)

    // First, we need to select 2+ segments to make the Compare toggle appear
    // Look for the segment dropdown in the sidebar
    const segmentDropdown = page.locator('div[class*="select"]').first()

    // Find segments section - look for a dropdown or segment selector
    // The sidebar should have segment options
    console.log('Looking for segment selector...')

    // Try clicking on the segment area to open dropdown
    const segmentSection = page.locator('text=Segment').first()
    if (await segmentSection.count() > 0) {
      console.log('Found Segment section')
      await segmentSection.click()
      await page.waitForTimeout(500)
    }

    // Look for checkboxes or multi-select options
    const checkboxes = page.locator('input[type="checkbox"]')
    const checkboxCount = await checkboxes.count()
    console.log(`Found ${checkboxCount} checkboxes`)

    // Select first two checkboxes if available
    if (checkboxCount >= 2) {
      await checkboxes.nth(0).click()
      await page.waitForTimeout(300)
      await checkboxes.nth(1).click()
      await page.waitForTimeout(500)
      console.log('Selected 2 segments')
    }

    // Now the Compare toggle should be visible
    await page.waitForTimeout(500)

    // Look for Compare toggle
    const compareToggle = page.locator('text=Compare').first()
    if (await compareToggle.count() > 0) {
      console.log('Found Compare toggle, clicking...')
      // Click the toggle (it should be near the Compare text)
      const boundingBox = await compareToggle.boundingBox()
      if (boundingBox) {
        // Click on the toggle to the left of the text
        await page.mouse.click(boundingBox.x - 20, boundingBox.y + boundingBox.height / 2)
        await page.waitForTimeout(500)
      }
    } else {
      console.log('Compare toggle not found - may need different segment selection approach')
    }

    // Now export PDF and check the filename
    const exportButton = page.locator('button:has-text("Export PDF")')

    if (await exportButton.count() > 0) {
      console.log('Found Export PDF button')

      // Set up download listener
      const downloadPromise = page.waitForEvent('download', { timeout: 60000 })

      await exportButton.click()
      console.log('Clicked Export PDF')

      const download = await downloadPromise
      const fileName = download.suggestedFilename()

      console.log('Downloaded file:', fileName)

      // Check if filename contains Compare or Filter
      if (fileName.includes('Compare')) {
        console.log('✓ Filename correctly contains "Compare"')
      } else if (fileName.includes('Filter')) {
        console.log('✗ Filename contains "Filter" but Compare toggle should be ON')
      }

      expect(fileName).toContain('Compare')
    } else {
      console.log('Export PDF button not found')
    }
  })

  test('should use Filter in filename when Compare toggle is OFF', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload CSV
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for charts to load
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(2000)

    // DON'T click the Compare toggle - leave it OFF

    // Export PDF and check the filename
    const exportButton = page.locator('button:has-text("Export PDF")')

    if (await exportButton.count() > 0) {
      console.log('Found Export PDF button')

      // Set up download listener
      const downloadPromise = page.waitForEvent('download', { timeout: 60000 })

      await exportButton.click()
      console.log('Clicked Export PDF')

      const download = await downloadPromise
      const fileName = download.suggestedFilename()

      console.log('Downloaded file:', fileName)

      // Check if filename contains Filter (Compare toggle is OFF)
      if (fileName.includes('Filter')) {
        console.log('✓ Filename correctly contains "Filter"')
      } else if (fileName.includes('Compare')) {
        console.log('✗ Filename contains "Compare" but Compare toggle should be OFF')
      }

      expect(fileName).toContain('Filter')
    }
  })

  test('debug: check Compare toggle state and selections', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload CSV
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for charts to load
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(2000)

    // Find Compare text and nearby toggle
    const compareText = page.locator('text=Compare')
    const compareTextCount = await compareText.count()
    console.log(`Found ${compareTextCount} "Compare" text elements`)

    // Look for all toggle-like elements
    const toggles = page.locator('div[class*="cursor-pointer"][class*="rounded-full"]')
    const toggleCount = await toggles.count()
    console.log(`Found ${toggleCount} potential toggle elements`)

    // Find the sidebar
    const sidebar = page.locator('div[style*="width: 256px"], div[style*="width:256px"]').first()
    if (await sidebar.count() > 0) {
      console.log('Found sidebar')

      // Look for Compare toggle in sidebar
      const sidebarCompare = sidebar.locator('text=Compare')
      if (await sidebarCompare.count() > 0) {
        console.log('Found Compare in sidebar')

        // Get parent and find toggle
        const parent = sidebarCompare.locator('xpath=ancestor::div[1]')
        const parentHtml = await parent.innerHTML()
        console.log('Parent HTML:', parentHtml.substring(0, 200))
      }
    }

    // Try clicking on the Compare toggle area
    const compareLabel = page.locator('span:text("Compare")').first()
    if (await compareLabel.count() > 0) {
      const boundingBox = await compareLabel.boundingBox()
      console.log('Compare label bounding box:', boundingBox)

      // Click to the left of the label where toggle should be
      if (boundingBox) {
        await page.mouse.click(boundingBox.x - 30, boundingBox.y + boundingBox.height / 2)
        console.log('Clicked to the left of Compare label')
        await page.waitForTimeout(500)
      }
    }

    // Now check selections state via console
    await page.evaluate(() => {
      console.log('Checking React state...')
    })

    // Take a screenshot for debugging
    await page.screenshot({ path: '/Users/misakifunada/Desktop/compare-toggle-debug.png', fullPage: false })
    console.log('Screenshot saved to Desktop')
  })
})
