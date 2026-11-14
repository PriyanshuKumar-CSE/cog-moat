// Builds the bundled map data from Natural Earth (public domain).
//
// Source: Natural Earth 1:10m Admin 0 countries, India point of view
// (ne_10m_admin_0_countries_ind.geojson). India's boundary is drawn as India
// officially depicts it, including all of Jammu & Kashmir, Ladakh and
// Arunachal Pradesh.
//
// Usage: node scripts/build-geo.mjs /path/to/ne_10m_admin_0_countries_ind.geojson
import fs from 'node:fs'
import mapshaper from 'mapshaper'

const input = process.argv[2]
if (!input) {
  console.error('Pass the path to ne_10m_admin_0_countries_ind.geojson')
  process.exit(1)
}

async function simplify(pct, filter) {
  const cmd = [
    `-i input.geojson`,
    filter ? `-filter "${filter}"` : '',
    `-filter-fields ADM0_A3,NAME`,
    `-simplify ${pct} keep-shapes`,
    `-o out.geojson format=geojson precision=0.01`,
  ].join(' ')
  const out = await mapshaper.applyCommands(cmd, { 'input.geojson': fs.readFileSync(input, 'utf8') })
  return JSON.parse(out['out.geojson'])
}

/** Compact form: [{ id, name, rings: number[][] }] where each ring is a flat [lon, lat, ...] list. */
function compact(fc) {
  return fc.features
    .filter((f) => f.geometry)
    .map((f) => {
      const g = f.geometry
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      const rings = polys.map((p) => p[0].flat().map((v) => Math.round(v * 100) / 100))
      return { id: f.properties.ADM0_A3, name: f.properties.NAME, rings }
    })
}

const world = compact(await simplify('3%'))
const india = compact(await simplify('25%', "ADM0_A3 == 'IND'"))

// Land dot-matrix: points on a Fibonacci sphere that fall on land.
// Stored as flat [lon, lat, isIndia, ...] with 1-decimal precision.
function inRing(x, y, r) {
  let c = false
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
const boxes = world.map((c) => ({
  id: c.id,
  rings: c.rings.map((r) => {
    let x0 = 999, y0 = 999, x1 = -999, y1 = -999
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1])
    }
    return { r, x0, y0, x1, y1 }
  }),
}))
const N = 26000
const dots = []
const golden = Math.PI * (3 - Math.sqrt(5))
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2
  const lat = (Math.asin(y) * 180) / Math.PI
  const lon = ((((i * golden * 180) / Math.PI) % 360) + 540) % 360 - 180
  if (lat < -60) continue
  for (const c of boxes) {
    if (c.rings.some((b) => lon >= b.x0 && lon <= b.x1 && lat >= b.y0 && lat <= b.y1 && inRing(lon, lat, b.r))) {
      dots.push(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10, c.id === 'IND' ? 1 : 0)
      break
    }
  }
}
fs.writeFileSync('src/data/geo/dots.json', JSON.stringify(dots))
console.log('land dots', dots.length / 3)

const note = 'Natural Earth 1:10m admin 0, India point of view. Public domain.'
fs.writeFileSync('src/data/geo/world.json', JSON.stringify({ note, countries: world }))
fs.writeFileSync('src/data/geo/india.json', JSON.stringify({ note, countries: india }))
const count = (c) => c.reduce((n, x) => n + x.rings.reduce((m, r) => m + r.length / 2, 0), 0)
console.log('world points', count(world), 'india points', count(india))
