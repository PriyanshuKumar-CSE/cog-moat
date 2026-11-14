import { expect, test } from '@playwright/test'

test('road scene: scan, plan check, verifier chain, human approval, certificate, funds', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  // Enter from Orbit so the scene transition runs as a presenter would see it.
  await page.goto('/#orbit')
  await expect(page.getByTestId('orbit-footprint')).toBeVisible()
  await page.waitForTimeout(1200)
  await page.keyboard.press('2')
  await page.waitForTimeout(1400)
  await page.screenshot({ path: 'tests/e2e/shots/road-transition.png' })
  await expect(page).toHaveURL(/#road$/)

  const overview = page.getByTestId('road-overview')
  const evidence = page.getByTestId('road-evidence')
  await expect(overview).toContainText('20,000+')
  await expect(overview).toContainText('km monitored')
  await expect(overview).toContainText('PMGSY')
  await expect(overview).toContainText('Mizoram')

  // 1. Scan: detections appear one by one.
  await expect(evidence.locator('.road__det')).toHaveCount(3, { timeout: 10_000 })
  await page.screenshot({ path: 'tests/e2e/shots/road-scan.png' })

  // Clicking a detection opens its IES record with a valid hash.
  await evidence.locator('.road__det').first().click()
  await expect(page.getByTestId('inspect-panel')).toContainText('IES hash recomputed')
  await expect(page.getByTestId('inspect-panel')).toContainText('road_defect_detector')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'tests/e2e/shots/road-inspect-detection.png' })
  await page.keyboard.press('Escape')

  // 2. Plan vs as-built.
  await expect(overview.locator('.steps__row.is-active')).toContainText('PLAN VS AS-BUILT', { timeout: 6_000 })
  await page.waitForTimeout(2600)
  await page.screenshot({ path: 'tests/e2e/shots/road-plan.png' })

  // 3. Verifier chain, then 4. human gate. Nothing settles before the decision.
  await expect(overview.locator('.steps__row.is-active')).toContainText('VERIFIER CHAIN', { timeout: 6_000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'tests/e2e/shots/road-verify.png' })
  const card = page.getByTestId('approval-card')
  await expect(card).toBeVisible({ timeout: 8_000 })
  await expect(card).toContainText('Executive Engineer')
  await expect(page.getByTestId('road-cert')).toHaveCount(0)
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'tests/e2e/shots/road-approve.png' })

  await card.getByRole('button', { name: 'Accept' }).click()
  await expect(card).toHaveCount(0)

  // 5. Certificate minted and sealed, 6. funds released.
  const cert = page.getByTestId('road-cert')
  await expect(cert).toContainText('cert_', { timeout: 4_000 })
  await expect(page.getByTestId('road-funds')).toContainText('Funds released', { timeout: 4_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'tests/e2e/shots/road-settle.png' })
  await expect(cert).not.toContainText('₹')

  await cert.getByRole('button', { name: 'Inspect block' }).click()
  const inspect = page.getByTestId('inspect-panel')
  await expect(inspect).toContainText('Ed25519 signature valid')
  await expect(inspect).toContainText('certificate_id')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'tests/e2e/shots/road-inspect-cert.png' })
  await page.keyboard.press('Escape')

  // The cycle loops: a new scan starts by itself.
  await expect(overview.locator('.steps__row.is-active')).toContainText('SCAN', { timeout: 10_000 })

  // Presenter can hide the state name.
  await page.keyboard.press('`')
  await page.getByTestId('presenter-panel').getByText('Place names (states, cities)').click()
  await page.keyboard.press('`')
  await expect(overview).not.toContainText('Mizoram')
  await expect(evidence).not.toContainText('Mizoram')

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

test('road scene: reject with a reason code does not settle', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto('/#road')
  const card = page.getByTestId('approval-card')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.getByRole('button', { name: 'Reject' }).click()
  await card.getByRole('button', { name: 'weather' }).click()

  const cert = page.getByTestId('road-cert')
  await expect(cert).toContainText('REJECTED', { timeout: 4_000 })
  await expect(cert).not.toContainText('cert_')
  await expect(page.getByTestId('road-funds')).toContainText('Rejected. Not settled.')
  await expect(page.getByTestId('road-funds')).toContainText('Funds held', { timeout: 4_000 })
  await expect(page.getByTestId('road-funds')).not.toContainText('Funds released')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'tests/e2e/shots/road-reject.png' })
  expect(errors).toEqual([])
})
