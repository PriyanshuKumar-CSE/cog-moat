import type { ReactNode } from 'react'

/** Read-only, syntax-coloured JSON. Long hashes wrap rather than overflow. */
export function JsonView({ data, keyOrder }: { data: unknown; keyOrder?: string[] }) {
  return <pre className="json">{render(data, 0, keyOrder)}</pre>
}

function render(v: unknown, depth: number, keyOrder?: string[]): ReactNode {
  const pad = '  '.repeat(depth)
  if (v === null) return <span className="json__null">null</span>
  if (typeof v === 'string') return <span className="json__str">"{v}"</span>
  if (typeof v === 'number') return <span className="json__num">{v}</span>
  if (typeof v === 'boolean') return <span className="json__bool">{String(v)}</span>
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return (
      <>
        {'[\n'}
        {v.map((item, i) => (
          <span key={i}>
            {pad}
            {'  '}
            {render(item, depth + 1)}
            {i < v.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {pad}
        {']'}
      </>
    )
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    let keys = Object.keys(obj)
    if (keyOrder && depth === 0) keys = [...keyOrder.filter((k) => k in obj), ...keys.filter((k) => !keyOrder.includes(k))]
    if (keys.length === 0) return '{}'
    return (
      <>
        {'{\n'}
        {keys.map((k, i) => (
          <span key={k}>
            {pad}
            {'  '}
            <span className="json__key">"{k}"</span>
            {': '}
            {render(obj[k], depth + 1)}
            {i < keys.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {pad}
        {'}'}
      </>
    )
  }
  return String(v)
}
