import { expect, test } from '@playwright/test'

test('mine scene runs the dispatch case through a human decision and a measured outcome', async ({ page }) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto('/#mine')
  await expect(page.getByTestId('mine-site')).toBeVisible()
  await expect(page.getByTestId('mine-decision')).toContainText('Situation')
  await expect(page.getByTestId('mine-situation')).toContainText('Loader 1 has')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'tests/e2e/shots/mine-situation.png' })

  // A completed trip is checked against the haul-trip spec and counted.
  const trip = page.getByTestId('mine-trip')
  await expect(trip).toContainText('COUNTED', { timeout: 15_000 })
  await expect(trip).toContainText('payload')
  await page.getByTestId('mine-trip-json').click()
  const inspect = page.getByTestId('inspect-panel')
  await expect(inspect).toContainText('IES hash recomputed')
  await expect(inspect).toContainText('haul_trip')
  await expect(inspect).toContainText('trip_correlator')
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'tests/e2e/shots/mine-trip-inspect.png' })
  await page.keyboard.press('Escape')
  await expect(inspect).toBeHidden()

  // The scheduler recommends; a person decides. Reject with a reason (wet haul road).
  const card = page.getByTestId('approval-card')
  await expect(card).toBeVisible({ timeout: 25_000 })
  await expect(card).toContainText('Move Truck 14 from Loader 1 to Loader 2')
  await expect(page.getByTestId('mine-forecast')).toContainText('miss by')
  await page.screenshot({ path: 'tests/e2e/shots/mine-approve.png' })
  await card.getByRole('button', { name: 'Reject' }).click()
  await card.getByRole('button', { name: 'weather' }).click()
  await expect(card).toBeHidden()
  const outcome = page.getByTestId('mine-outcome')
  await expect(outcome).toContainText('REJECTED')
  await expect(outcome).toContainText('Measuring since')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'tests/e2e/shots/mine-reject.png' })

  // After the window, the outcome is measured and the decision record is inspectable.
  await expect(outcome).toContainText('Measured', { timeout: 15_000 })
  await outcome.getByRole('button', { name: 'JSON' }).click()
  await expect(inspect).toContainText('verification')
  await expect(inspect).toContainText('weather')
  await page.keyboard.press('Escape')

  // The case replays: next cycle, send Truck 9 instead.
  await expect(card).toBeVisible({ timeout: 40_000 })
  await card.getByRole('button', { name: 'Modify' }).click()
  await card.getByRole('button', { name: 'Send Truck 9 instead' }).click()
  await expect(outcome).toContainText('MODIFIED')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'tests/e2e/shots/mine-modify.png' })

  // Next cycle: accept, and the measured outcome improves the forecast.
  await expect(card).toBeVisible({ timeout: 40_000 })
  await card.getByRole('button', { name: 'Accept' }).click()
  await expect(outcome).toContainText('ACCEPTED')
  await expect(page.getByTestId('mine-forecast')).toContainText('on track', { timeout: 12_000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'tests/e2e/shots/mine-accept.png' })

  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0
        const t0 = performance.now()
        const f = () => {
          n++
          if (performance.now() - t0 < 2000) requestAnimationFrame(f)
          else resolve((n * 1000) / (performance.now() - t0))
        }
        requestAnimationFrame(f)
      }),
  )
  console.log('fps', fps.toFixed(1))
  expect(errors).toEqual([])
})
