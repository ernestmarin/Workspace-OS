import { useState, useRef, useCallback } from 'react'
import { bytesToBlob } from '../../../lib/bytesToBlob'
import { useSafeObjectUrl } from '../../../lib/useSafeObjectUrl'
import styles from './ImageRenderer.module.css'
import { basename as pathBase } from '../../../lib/paths'

interface ImageRendererProps {
  filePath: string
}

export function ImageRenderer({ filePath }: ImageRendererProps): JSX.Element {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const offsetStart = useRef({ x: 0, y: 0 })

  /*
   * The object URL is created, owned and revoked by `useSafeObjectUrl` over a
   * per-run local (the inlined version revoked from `src` STATE, which is always
   * `null` in the cleanup of a `[filePath]`-keyed effect, so every image switch
   * leaked its blob). `filePath` is the "these are different bytes" key.
   */
  const { url: src, error } = useSafeObjectUrl(
    () => window.workspace.fs.readFileBytes(filePath),
    (bytes) => {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        ico: 'image/x-icon', bmp: 'image/bmp',
      }
      return bytesToBlob(bytes, mimeMap[ext] ?? 'image/png')
    },
    filePath,
  )

  // View state (zoom/pan) belongs to the image on screen: reset it when the file
  // changes. This is a render-time derivation from the key, not an effect, so it
  // cannot race the fetch.
  const [shownPath, setShownPath] = useState(filePath)
  if (shownPath !== filePath) {
    setShownPath(filePath)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale((s) => Math.max(0.1, Math.min(10, s * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    offsetStart.current = offset
  }, [offset])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    setOffset({
      x: offsetStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetStart.current.y + (e.clientY - dragStart.current.y),
    })
  }, [])

  const onMouseUp = useCallback(() => { dragging.current = false }, [])

  if (error) return <div className={styles.error}>Cannot open image: {error}</div>
  if (!src) return <div className={styles.loading}>Loading…</div>

  return (
    <div
      className={styles.root}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div className={styles.toolbar}>
        <button onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}>Reset</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(10, s * 1.25))}>+</button>
        <button onClick={() => setScale((s) => Math.max(0.1, s * 0.8))}>−</button>
      </div>
      <div className={styles.canvas}>
        <img
          src={src}
          className={styles.image}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: dragging.current ? 'grabbing' : 'grab',
          }}
          draggable={false}
          alt={pathBase(filePath)}
        />
      </div>
    </div>
  )
}
