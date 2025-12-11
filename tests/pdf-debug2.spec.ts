import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Lululemon_Technical_Design_Test-1765226466306.csv'

test.describe('PDF Export Debug 2', () => {
  test('check what elements have negative margins or overflow', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(3000)

    // Find elements with negative margins that could cause overflow
    const negativeMarginElements = await page.evaluate(() => {
      const results: any[] = []
      const allElements = document.querySelectorAll('*')

      allElements.forEach((el, index) => {
        const style = window.getComputedStyle(el)
        const marginLeft = parseFloat(style.marginLeft)
        const marginRight = parseFloat(style.marginRight)
        const left = parseFloat(style.left)
        const right = parseFloat(style.right)

        if (marginLeft < 0 || marginRight < 0 || (style.position === 'absolute' && (left < 0 || right < 0))) {
          const rect = (el as HTMLElement).getBoundingClientRect()
          results.push({
            tag: el.tagName,
            className: el.className?.toString().substring(0, 50),
            marginLeft: style.marginLeft,
            marginRight: style.marginRight,
            position: style.position,
            left: style.left,
            right: style.right,
            boundingLeft: rect.left,
            boundingRight: rect.right,
            boundingWidth: rect.width
          })
        }
      })

      return results.slice(0, 20) // Limit to first 20
    })

    console.log('\n=== ELEMENTS WITH NEGATIVE MARGINS ===')
    negativeMarginElements.forEach((el, i) => {
      console.log(`${i}: ${el.tag}.${el.className} - marginLeft: ${el.marginLeft}, position: ${el.position}, left: ${el.left}`)
    })

    // Check elements that extend beyond the chart gallery container
    const overflowingElements = await page.evaluate(() => {
      const chartGallery = document.querySelector('.rounded-2xl.bg-white.p-3')
      if (!chartGallery) return []

      const galleryRect = chartGallery.getBoundingClientRect()
      const results: any[] = []

      const allChildren = chartGallery.querySelectorAll('*')
      allChildren.forEach((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect()
        // Check if element extends beyond gallery bounds
        if (rect.left < galleryRect.left || rect.right > galleryRect.right) {
          results.push({
            tag: el.tagName,
            className: el.className?.toString().substring(0, 50),
            elementLeft: rect.left,
            elementRight: rect.right,
            galleryLeft: galleryRect.left,
            galleryRight: galleryRect.right,
            overflowLeft: galleryRect.left - rect.left,
            overflowRight: rect.right - galleryRect.right
          })
        }
      })

      return results.slice(0, 20)
    })

    console.log('\n=== ELEMENTS OVERFLOWING GALLERY BOUNDS ===')
    overflowingElements.forEach((el, i) => {
      console.log(`${i}: ${el.tag}.${el.className}`)
      console.log(`   Element: [${el.elementLeft.toFixed(1)}, ${el.elementRight.toFixed(1)}]`)
      console.log(`   Gallery: [${el.galleryLeft.toFixed(1)}, ${el.galleryRight.toFixed(1)}]`)
      console.log(`   Overflow: left=${el.overflowLeft.toFixed(1)}px, right=${el.overflowRight.toFixed(1)}px`)
    })
  })
})
