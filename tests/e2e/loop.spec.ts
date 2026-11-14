import { expect, test } from '@playwright/test'

test('loop scene runs a full cycle with human approval', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await page.goto('/#loop')
  await expect(page.getByTestId('loop-steps')).toBeVisible()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'tests/e2e/shots/loop-intent.png' })

  await expect(page.getByTestId('approval-card')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: 'tests/e2e/shots/loop-approve.png' })
  await page.getByRole('button', { name: 'Accept' }).click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'tests/e2e/shots/loop-settle.png' })

  await page.getByTestId('loop-ledger').locator('.ledger-row').first().click()
  await expect(page.getByTestId('inspect-panel')).toContainText('Ed25519 signature valid')
  await page.waitForTimeout(700)
  await page.screenshot({ path: 'tests/e2e/shots/loop-inspect.png' })
  await page.keyboard.press('Escape')

  await page.getByTestId('loop-steps').getByRole('button', { name: 'open' }).first().click()
  await expect(page.getByTestId('drill-scheduler')).toBeVisible()
  await page.waitForTimeout(700)
  await page.screenshot({ path: 'tests/e2e/shots/loop-scheduler.png' })

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
