import { expect, test, type Page } from '@playwright/test'

const activeStage = (page: Page) => page.getByTestId('building-stages').locator('.bld__stage.is-active')

test('building scene: frame milestone signed, build moves on, rejection repeats, monitoring raises a work order', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  // Enter from Forest with the keyboard, as a presenter would.
  await page.goto('/#forest')
  await expect(page.getByTestId('forest-health')).toBeVisible()
  await page.waitForTimeout(1000)
  await page.keyboard.press('6')
  await expect(page).toHaveURL(/#building$/)
  await page.waitForTimeout(1400)
  await page.screenshot({ path: 'tests/e2e/shots/building-transition.png' })

  const overview = page.getByTestId('building-overview')
  const evidence = page.getByTestId('building-evidence')
  await expect(overview).toContainText('B+G+6')
  await expect(activeStage(page)).toContainText('RCC frame')
  await expect(page.getByTestId('building-health')).toContainText('Settlement')

  // 1. Scan: the drone flags findings one by one.
  await expect(evidence.locator('.bld__find')).toHaveCount(3, { timeout: 10_000 })
  await page.screenshot({ path: 'tests/e2e/shots/building-scan.png' })
  await evidence.locator('.bld__find').first().click()
  const inspect = page.getByTestId('inspect-panel')
  await expect(inspect).toContainText('IES hash recomputed')
  await expect(inspect).toContainText('site_defect_detector')
  await page.keyboard.press('Escape')

  // 2. Plan vs BIM, 3. verifier chain, 4. human gate. Nothing settles before the decision.
  await expect(overview.locator('.bld__chip.is-active')).toHaveText('Plan', { timeout: 8_000 })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'tests/e2e/shots/building-plan.png' })
  const card = page.getByTestId('approval-card')
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card).toContainText('Structural Engineer')
  await expect(card).toContainText('Sign RCC frame milestone')
  await expect(page.getByTestId('building-cert')).toHaveCount(0)
  await page.screenshot({ path: 'tests/e2e/shots/building-approve.png' })
  await card.getByRole('button', { name: 'Accept', exact: true }).click()

  // 5. Certificate on the ledger, 6. RA bill released. The frame is now done.
  const cert = page.getByTestId('building-cert')
  await expect(cert).toContainText('cert_', { timeout: 4_000 })
  await expect(page.getByTestId('building-outcome')).toContainText('RA bill released', { timeout: 4_000 })
  await expect(cert).not.toContainText('₹')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/shots/building-settle.png' })
  await cert.getByRole('button', { name: 'Inspect block' }).click()
  await expect(inspect).toContainText('Ed25519 signature valid')
  await expect(inspect).toContainText('certificate_id')
  await page.keyboard.press('Escape')

  // Time-lapse to masonry, which is scanned next.
  await page.waitForTimeout(3600)
  await page.screenshot({ path: 'tests/e2e/shots/building-timelapse.png' })
  await expect(activeStage(page)).toContainText('Masonry', { timeout: 8_000 })

  // Reject masonry with a reason code: the bill is held and the milestone repeats after rework.
  await expect(card).toBeVisible({ timeout: 25_000 })
  await card.getByRole('button', { name: 'Reject', exact: true }).click()
  await card.getByRole('button', { name: 'weather', exact: true }).click()
  await expect(cert).toContainText('REJECTED', { timeout: 4_000 })
  await expect(cert).not.toContainText('cert_')
  await expect(page.getByTestId('building-outcome')).toContainText('RA bill held', { timeout: 4_000 })
  await page.screenshot({ path: 'tests/e2e/shots/building-reject.png' })
  await expect(overview.locator('.bld__chip.is-active')).toHaveText('Scan', { timeout: 12_000 })
  await expect(activeStage(page)).toContainText('Masonry')

  // Jump to structural health after handover: a crack gauge crosses its limit.
  await page.getByTestId('building-stages').getByRole('button', { name: /Monitoring/ }).click()
  await expect(activeStage(page)).toContainText('Monitoring')
  await expect(page.getByTestId('building-health')).toContainText('CG-2 ABOVE LIMIT', { timeout: 10_000 })
  await expect(evidence).toContainText('CRACK WIDENING')
  await page.screenshot({ path: 'tests/e2e/shots/building-monitoring.png' })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Raise inspection work order')
  await card.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(cert).toContainText('wo_', { timeout: 4_000 })
  await expect(page.getByTestId('building-outcome')).toContainText('Inspection ordered', { timeout: 4_000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/shots/building-workorder.png' })

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
