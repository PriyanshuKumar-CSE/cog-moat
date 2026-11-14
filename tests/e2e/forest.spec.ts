import { expect, test } from '@playwright/test'

test('forest scene runs scan, fire, encroachment and both approval paths', async ({ page }) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto('/#forest')
  await expect(page.getByTestId('forest-health')).toBeVisible()
  await page.waitForTimeout(2600)
  await page.screenshot({ path: 'tests/e2e/shots/forest-scan.png' })

  // Fire hotspot, then encroachment at the boundary edge.
  await expect(page.getByTestId('forest-alert-fire')).toBeVisible({ timeout: 12_000 })
  await expect(page.getByTestId('forest-alert-clearing')).toBeVisible({ timeout: 12_000 })
  await expect(page.getByTestId('forest-alert-clearing')).toContainText('ha')
  await page.screenshot({ path: 'tests/e2e/shots/forest-alerts.png' })

  // Human gate: reject with a reason code. Nothing is dispatched.
  const card = page.getByTestId('approval-card')
  await expect(card).toBeVisible({ timeout: 25_000 })
  await expect(card).toContainText('Forest Officer')
  await page.screenshot({ path: 'tests/e2e/shots/forest-approve.png' })
  await card.getByRole('button', { name: 'Reject', exact: true }).click()
  await card.getByRole('button', { name: 'weather', exact: true }).click()
  const outcome = page.getByTestId('forest-outcome')
  await expect(outcome).toContainText('Not dispatched')
  await expect(page.getByTestId('forest-alert-fire')).toContainText('not dispatched')
  await expect(page.getByTestId('forest-verify').locator('.ledger-row').first()).toContainText('REJECTED')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'tests/e2e/shots/forest-reject.png' })

  // Next cycle: accept. Patrol dispatch is recorded on the ledger.
  await expect(card).toBeVisible({ timeout: 45_000 })
  await card.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(outcome).toContainText('Patrol dispatch recorded')
  await expect(page.getByTestId('forest-alert-fire')).toContainText('under response')
  await expect(page.getByTestId('forest-verify').locator('.ledger-row').first()).toContainText('DISPATCHED')
  await page.waitForTimeout(3400)
  await page.screenshot({ path: 'tests/e2e/shots/forest-dispatch.png' })

  // IES record of the fire detection, with lineage back to the thermal frames.
  await page.getByTestId('forest-alert-fire').click()
  const inspect = page.getByTestId('inspect-panel')
  await expect(inspect).toContainText('IES hash recomputed')
  await expect(inspect).toContainText('fire_detector')
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'tests/e2e/shots/forest-inspect.png' })
  await page.keyboard.press('Escape')

  // Ledger block verifies.
  await page.getByTestId('forest-verify').locator('.ledger-row').first().click()
  await expect(inspect).toContainText('Ed25519 signature valid')
  await page.keyboard.press('Escape')

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
