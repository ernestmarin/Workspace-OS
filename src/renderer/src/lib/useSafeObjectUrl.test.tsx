// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSafeObjectUrl } from './useSafeObjectUrl'

/**
 * Object-URL lifetime. This is a REGRESSION test for a real leak: the effects
 * this hook replaces revoked the URL their cleanup captured from STATE, which is
 * always `null` at that point, so no image or media blob was ever released.
 *
 * Driven through a host component with `react-dom/client` (the pattern the other
 * renderer tests use) — no extra test-library dependency.
 */
let element: HTMLDivElement
let root: Root
let created: number
let revoked: string[]
const blob = (): Blob => new Blob([])
const flush = async (n = 12): Promise<void> => {
  for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve() })
}

function Host({
  read,
  urlKey,
  onState,
}: {
  read: () => Promise<Uint8Array>
  urlKey: string
  onState: (s: { url: string | null; error: string | null }) => void
}): null {
  const state = useSafeObjectUrl(read, blob, urlKey)
  onState(state)
  return null
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  element = document.createElement('div')
  document.body.appendChild(element)
  root = createRoot(element)
  created = 0
  revoked = []
  let n = 0
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      created += 1
      n += 1
      return `blob:test/${n}`
    },
    revokeObjectURL: (u: string) => {
      revoked.push(u)
    },
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  element.remove()
  vi.unstubAllGlobals()
})

describe('useSafeObjectUrl (batch TD-01)', () => {
  it('produces a URL for the loaded bytes', async () => {
    let seen: { url: string | null; error: string | null } = { url: null, error: null }
    await act(async () => {
      root.render(<Host read={async () => new Uint8Array([1, 2, 3])} urlKey="file-a" onState={(s) => { seen = s }} />)
    })
    await flush()
    expect(seen.url).toBe('blob:test/1')
    expect(seen.error).toBeNull()
  })

  it('revokes the URL it created when the key changes', async () => {
    let seen: { url: string | null; error: string | null } = { url: null, error: null }
    const read = async (): Promise<Uint8Array> => new Uint8Array([1])
    await act(async () => {
      root.render(<Host read={read} urlKey="file-a" onState={(s) => { seen = s }} />)
    })
    await flush()
    expect(seen.url).toBe('blob:test/1')
    await act(async () => {
      root.render(<Host read={read} urlKey="file-b" onState={(s) => { seen = s }} />)
    })
    await flush()
    expect(seen.url).toBe('blob:test/2')
    expect(revoked).toEqual(['blob:test/1'])
  })

  it('revokes on unmount', async () => {
    await act(async () => {
      root.render(<Host read={async () => new Uint8Array([1])} urlKey="file-a" onState={() => {}} />)
    })
    await flush()
    await act(async () => root.unmount())
    expect(revoked).toEqual(['blob:test/1'])
  })

  it('does not re-fetch when only the reader identity changes', async () => {
    const read = vi.fn(async () => new Uint8Array([1]))
    let seen: { url: string | null; error: string | null } = { url: null, error: null }
    await act(async () => {
      root.render(<Host read={read} urlKey="same-key" onState={(s) => { seen = s }} />)
    })
    await flush()
    expect(seen.url).toBe('blob:test/1')
    // A parent passing a fresh inline arrow must not trigger another fetch.
    await act(async () => {
      root.render(<Host read={async () => new Uint8Array([2])} urlKey="same-key" onState={(s) => { seen = s }} />)
    })
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(seen.url).toBe('blob:test/1')
  })

  it('surfaces a read failure and creates no URL', async () => {
    let seen: { url: string | null; error: string | null } = { url: null, error: null }
    await act(async () => {
      root.render(
        <Host
          read={async () => { throw new Error('cannot read it') }}
          urlKey="file-a"
          onState={(s) => { seen = s }}
        />,
      )
    })
    await flush()
    expect(seen.error).toBe('cannot read it')
    expect(seen.url).toBeNull()
    expect(created).toBe(0)
    expect(revoked).toEqual([])
  })

  it('ignores a load that settles after unmount', async () => {
    let settle: (b: Uint8Array) => void = () => {}
    const pending = new Promise<Uint8Array>((resolve) => { settle = resolve })
    await act(async () => {
      root.render(<Host read={() => pending} urlKey="file-a" onState={() => {}} />)
    })
    await act(async () => root.unmount())
    settle(new Uint8Array([1]))
    await flush()
    // No URL was created after teardown, so there is nothing left to leak.
    expect(created).toBe(0)
  })
})

describe('useSafeObjectUrl — "nothing to load" key', () => {
  it('does not read and clears the URL when the key becomes null', async () => {
    const read = vi.fn(async () => new Uint8Array([1]))
    const states: ({ url: string | null } | null)[] = []
    const render = (k: string | null): void => {
      root.render(<Host read={read} urlKey={k as string} onState={(s) => states.push(s)} />)
    }
    await act(async () => { render('a.png'); await flush() })
    expect(read).toHaveBeenCalledTimes(1)
    expect(states.at(-1)?.url).not.toBeNull()
    await act(async () => { render(null); await flush() })
    // A null key means "no thumbnail": no read, and nothing left on screen.
    expect(read).toHaveBeenCalledTimes(1)
    expect(states.at(-1)?.url).toBeNull()
    // Going back to a real key reads again rather than reusing the cleared URL.
    await act(async () => { render('a.png'); await flush() })
    expect(read).toHaveBeenCalledTimes(2)
    expect(states.at(-1)?.url).not.toBeNull()
  })
})
