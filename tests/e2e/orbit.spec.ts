import { expect, test } from '@playwright/test'

test('orbit: globe, lift India, select a site, hide place names', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto('/#orbit')
  const footprint = page.getByTestId('orbit-footprint')
  await expect(footprint).toContainText('12+')
  await expect(footprint).toContainText('20,000+')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'tests/e2e/shots/orbit-globe.png' })

  await footprint.getByRole('button', { name: 'India' }).click()
  await page.waitForTimeout(3500)
  await page.screenshot({ path: 'tests/e2e/shots/orbit-india.png' })

  // Nagpur sits near the centre of the India plate at 1920x1080.
  await page.mouse.click(987, 561)
  const site = page.getByTestId('orbit-site')
  await expect(site).toContainText('MINE')

  // Hide place names from the presenter panel; the site panel title falls back.
  await page.keyboard.press('`')
  await page.getByTestId('presenter-panel').getByText('Place names (states, cities)').click()
  await expect(site).not.toContainText('Nagpur')
  await page.keyboard.press('`')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'tests/e2e/shots/orbit-names-hidden.png' })

  await site.getByRole('button', { name: /Enter/ }).click()
  await expect(page).toHaveURL(/#mine$/)
  expect(errors).toEqual([])
})
