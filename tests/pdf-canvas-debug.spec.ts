import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Lululemon_Technical_Design_Test-1765226466306.csv'
const DESKTOP_PATH = '/Users/misakifunada/Desktop'

test.describe('PDF Canvas Debug', () => {
  test('capture and analyze canvas dimensions', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(3000)

    // Inject html2canvas and capture dimensions
    const dimensions = await page.evaluate(async () => {
      // @ts-ignore - html2canvas is loaded dynamically
      const html2canvas = (await import('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.esm.min.js')).default

      const element = document.querySelector('.rounded-2xl.bg-white.p-3') as HTMLElement
      if (!element) return { error: 'Element not found' }

      const captureWidth = element.clientWidth
      const captureScale = 2

      // Capture with same settings as PDF export
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: captureScale,
        logging: true,
        useCORS: true,
        width: captureWidth,
        height: element.scrollHeight,
        windowWidth: captureWidth,
        windowHeight: element.scrollHeight,
        x: 0,
        y: 0,
      })

      return {
        elementClientWidth: element.clientWidth,
        elementScrollWidth: element.scrollWidth,
        elementScrollHeight: element.scrollHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        captureWidth,
        captureScale,
        expectedCanvasWidth: captureWidth * captureScale,
        widthMatch: canvas.width === captureWidth * captureScale,
        // Check if content is properly clipped
        actualWidthAfterScale: canvas.width / captureScale,
      }
    })

    console.log('\n=== CANVAS CAPTURE DIMENSIONS ===')
    console.log(JSON.stringify(dimensions, null, 2))

    // The issue might be that the canvas width is larger than expected
    // If canvas.width > captureWidth * captureScale, then overflow content is being captured
  })
})
