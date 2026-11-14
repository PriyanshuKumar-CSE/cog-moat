import * as THREE from 'three'
import dotsRaw from '../../data/geo/dots.json'
import indiaRaw from '../../data/geo/india.json'
import worldRaw from '../../data/geo/world.json'

/**
 * Map data: Natural Earth 1:10m admin 0, India point of view (public domain).
 * India's boundary follows India's official depiction.
 * Rebuild with `node scripts/build-geo.mjs <source.geojson>`.
 */
export interface Country {
  id: string
  name: string
  /** Each ring is a flat [lon, lat, lon, lat, ...] list. */
  rings: number[][]
}

export const world = (worldRaw as { countries: Country[] }).countries
export const india = (indiaRaw as { countries: Country[] }).countries[0]
/** Flat [lon, lat, isIndia, ...]. */
export const landDots = dotsRaw as number[]

export const GLOBE_R = 5

export function lonLatToVec3(lon: number, lat: number, r = GLOBE_R, out = new THREE.Vector3()) {
  const phi = THREE.MathUtils.degToRad(lat)
  const lam = THREE.MathUtils.degToRad(lon)
  return out.set(r * Math.cos(phi) * Math.sin(lam), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(lam))
}

export function vec3ToLonLat(v: THREE.Vector3) {
  const r = v.length()
  return {
    lat: THREE.MathUtils.radToDeg(Math.asin(v.y / r)),
    lon: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)),
  }
}

/** Line-segment positions for country outlines on the sphere. */
export function outlinePositions(countries: Country[], r: number, filter?: (c: Country) => boolean) {
  const out: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  for (const c of countries) {
    if (filter && !filter(c)) continue
    for (const ring of c.rings) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        lonLatToVec3(ring[i], ring[i + 1], r, a)
        lonLatToVec3(ring[i + 2], ring[i + 3], r, b)
        out.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
  }
  return new Float32Array(out)
}

/** Latitude / longitude grid. */
export function graticulePositions(r: number, step = 15) {
  const out: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  for (let lat = -75; lat <= 75; lat += step) {
    for (let lon = -180; lon < 180; lon += 3) {
      lonLatToVec3(lon, lat, r, a)
      lonLatToVec3(lon + 3, lat, r, b)
      out.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  for (let lon = -180; lon < 180; lon += step) {
    for (let lat = -84; lat < 84; lat += 3) {
      lonLatToVec3(lon, lat, r, a)
      lonLatToVec3(lon, lat + 3, r, b)
      out.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  return new Float32Array(out)
}

/** Great-circle-ish arc lifted above the surface. */
export function arcPoints(from: [number, number], to: [number, number], r: number, segments = 64) {
  const a = lonLatToVec3(from[0], from[1], 1)
  const b = lonLatToVec3(to[0], to[1], 1)
  const angle = a.angleTo(b)
  const lift = 0.12 + angle * 0.22
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const p = new THREE.Vector3().copy(a).lerp(b, t).normalize()
    const h = Math.sin(Math.PI * t) * lift
    pts.push(p.multiplyScalar(r * (1 + h * 0.35)))
  }
  return pts
}

/* India plate: flat projection used when India lifts off the globe. */

export const PLATE_CENTER = { lon: 82.6, lat: 22.2 }
export const PLATE_SCALE = 0.3

export function plateXY(lon: number, lat: number): [number, number] {
  const k = Math.cos(THREE.MathUtils.degToRad(PLATE_CENTER.lat))
  return [(lon - PLATE_CENTER.lon) * PLATE_SCALE * k, (lat - PLATE_CENTER.lat) * PLATE_SCALE]
}

function inRing(x: number, y: number, r: number[]) {
  let c = false
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]
    const yi = r[i + 1]
    const xj = r[j]
    const yj = r[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

export function insideIndia(lon: number, lat: number) {
  return india.rings.some((r) => inRing(lon, lat, r))
}

/** Dot grid filling India, in plate coordinates. */
export function indiaPlateDots(step = 0.42) {
  const out: number[] = []
  for (let lat = 6; lat <= 37.5; lat += step) {
    for (let lon = 68; lon <= 97.5; lon += step) {
      if (insideIndia(lon, lat)) {
        const [x, y] = plateXY(lon, lat)
        out.push(x, y, 0)
      }
    }
  }
  return new Float32Array(out)
}

export function indiaPlateOutline() {
  const out: number[] = []
  for (const ring of india.rings) {
    for (let i = 0; i + 3 < ring.length; i += 2) {
      const [x0, y0] = plateXY(ring[i], ring[i + 1])
      const [x1, y1] = plateXY(ring[i + 2], ring[i + 3])
      out.push(x0, y0, 0, x1, y1, 0)
    }
  }
  return new Float32Array(out)
}
