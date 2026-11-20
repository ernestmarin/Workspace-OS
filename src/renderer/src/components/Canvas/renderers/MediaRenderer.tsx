import { bytesToBlob } from '../../../lib/bytesToBlob'
import { useSafeObjectUrl } from '../../../lib/useSafeObjectUrl'
import styles from './MediaRenderer.module.css'
import { basename as pathBase } from '../../../lib/paths'

interface MediaRendererProps {
  filePath: string
  type: 'video' | 'audio'
}

export function MediaRenderer({ filePath, type }: MediaRendererProps): JSX.Element {
  /*
   * Lifetime lives in `useSafeObjectUrl` (see its note): the inlined version
   * revoked from `src` STATE, always `null` in a `[filePath]`-keyed cleanup, so
   * each media switch leaked a blob. `type` is part of the key because the same
   * path can be rendered as either element.
   */
  const { url: src, error } = useSafeObjectUrl(
    () => window.workspace.fs.readFileBytes(filePath),
    (bytes) => {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      const mimeMap: Record<string, string> = {
        mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
        avi: 'video/x-msvideo', mkv: 'video/x-matroska',
        mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
        aac: 'audio/aac', ogg: 'audio/ogg', m4a: 'audio/mp4',
      }
      return bytesToBlob(bytes, mimeMap[ext] ?? `${type}/*`)
    },
    `${filePath}\u0000${type}`,
  )

  if (error) return <div className={styles.error}>Cannot open media: {error}</div>
  if (!src) return <div className={styles.loading}>Loading…</div>

  return (
    <div className={styles.root}>
      {type === 'video' ? (
        <video className={styles.video} src={src} controls autoPlay={false} />
      ) : (
        <div className={styles.audioWrap}>
          <div className={styles.audioLabel}>{pathBase(filePath)}</div>
          <audio className={styles.audio} src={src} controls />
        </div>
      )}
    </div>
  )
}
