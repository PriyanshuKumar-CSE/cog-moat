// Usage: node scripts/shot.mjs <hash> <waitMs> <out.png> [step[ || step...]]
// A step is a selector to click, or key:<Key> to press a key.
// Needs `npm run dev -- --port 5199` running (or set E2E_PORT to another port).
import { chromium } from '@playwright/test'

const [hash = 'loop', wait = '3000', out = 'tests/e2e/shots/shot.png', click] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(`http://localhost:${process.env.E2E_PORT ?? 5199}/#${hash}`)
// Optional clicks before the shot, separated by " || ".
for (const sel of click ? click.split(' || ') : []) {
  await page.waitForTimeout(1500)
  if (sel.startsWith('key:')) await page.keyboard.press(sel.slice(4))
  else await page.locator(sel).first().click()
}
await page.waitForTimeout(Number(wait))
await page.screenshot({ path: out })
if (errors.length) console.log('ERRORS', errors)
await browser.close()
