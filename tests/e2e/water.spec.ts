import { expect, test } from '@playwright/test'

test('water scene detects a leak, waits for approval and writes to the Water Ledger', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto('/#water')
  const network = page.getByTestId('water-network')
  const anomaly = page.getByTestId('water-anomaly')
  const ledger = page.getByTestId('water-ledger')
  await expect(network).toBeVisible()
  await expect(anomaly).toContainText('MONITORING')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'tests/e2e/shots/water-flow.png' })

  // The balance check runs, then one DMA drifts above the NRW threshold.
  await expect(anomaly).toContainText('ALERT', { timeout: 15_000 })
  await expect(network).toContainText(/DMA \d over/)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'tests/e2e/shots/water-leak.png' })

  // Human gate: nothing is written before the Utility Engineer decides.
  const blocksBefore = Number((await ledger.locator('.panel__tag').innerText()).split(' ')[0])
  await expect(page.getByTestId('approval-card')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('approval-card')).toContainText('Utility Engineer')
  await page.screenshot({ path: 'tests/e2e/shots/water-approve.png' })
  expect(Number((await ledger.locator('.panel__tag').innerText()).split(' ')[0])).toBe(blocksBefore)

  // The detection record carries lineage back to the meter readings.
  const inspect = page.getByTestId('inspect-panel')
  await anomaly.getByRole('button', { name: /Detect/ }).click()
  await expect(inspect).toContainText('IES hash recomputed')
  await expect(inspect).toContainText('Derived via dma_balance')
  await page.keyboard.press('Escape')

  await page.getByTestId('approval-card').getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByTestId('approval-card')).toBeHidden()
  await expect(ledger.locator('.panel__tag')).toHaveText(`${blocksBefore + 1} blocks`)
  await expect(ledger.locator('.ledger-row').first()).toContainText('VERIFIED LOSS')
  await expect(anomaly).toContainText('Verified loss written to Water Ledger.')
  await page.waitForTimeout(2600)
  await page.screenshot({ path: 'tests/e2e/shots/water-ledger.png' })

  // Open the new Water Ledger block: every check is recomputed.
  await ledger.locator('.ledger-row').first().click()
  await expect(inspect).toContainText(`Water Ledger block #${blocksBefore}`)
  await expect(inspect).toContainText('Payload hash matches')
  await expect(inspect).toContainText('Linked to previous block')
  await expect(inspect).toContainText('Ed25519 signature valid')
  await expect(inspect.locator('.check--fail')).toHaveCount(0)
  await page.waitForTimeout(700)
  await page.screenshot({ path: 'tests/e2e/shots/water-inspect.png' })
  await page.keyboard.press('Escape')

  // Next night: reject with a reason code. A rejection is recorded, no loss entry is written.
  await expect(page.getByTestId('approval-card')).toBeVisible({ timeout: 40_000 })
  const card = page.getByTestId('approval-card')
  await card.getByRole('button', { name: 'Reject', exact: true }).click()
  await card.getByRole('button', { name: 'equipment' }).click()
  await expect(ledger.locator('.panel__tag')).toHaveText(`${blocksBefore + 2} blocks`)
  await expect(ledger.locator('.ledger-row').first()).toContainText('REJECTED')
  await expect(anomaly).toContainText('Rejection recorded. No loss entry written.')
  await page.waitForTimeout(2600)
  await page.screenshot({ path: 'tests/e2e/shots/water-reject.png' })
  await ledger.locator('.ledger-row').first().click()
  await expect(inspect).toContainText('Rejection. Recorded, no loss written.')
  await expect(inspect).toContainText('Ed25519 signature valid')
  await expect(inspect).toContainText('"loss": null')
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
