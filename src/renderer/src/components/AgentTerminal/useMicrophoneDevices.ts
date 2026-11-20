import { useCallback, useEffect, useRef, useState } from 'react'

export interface MicrophoneDevice { id: string; label: string }

/** Bounded device metadata only. This never starts a stream or asks for consent. */
export function microphoneDevices(devices: readonly MediaDeviceInfo[]): MicrophoneDevice[] {
  const seen = new Set<string>()
  return devices.filter((device) => {
    if (device.kind !== 'audioinput' || !device.deviceId || device.deviceId.length > 1024 || seen.has(device.deviceId)) return false
    seen.add(device.deviceId)
    return true
  }).slice(0, 100).map((device) => ({ id: device.deviceId, label: device.label.slice(0, 256) }))
}

export function microphoneConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: { echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
    video: false,
  }
}

/** Enumerates only after a user refresh; device changes refresh an already-open list. */
export function useMicrophoneDevices(enabled: boolean): {
  devices: MicrophoneDevice[]; refreshing: boolean; error: string; refresh: () => void
} {
  const [devices, setDevices] = useState<MicrophoneDevice[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const generation = useRef(0)
  const requested = useRef(false)

  const refresh = useCallback(() => {
    if (!enabledRef.current) return
    requested.current = true
    const id = ++generation.current
    setRefreshing(true)
    setError('')
    void (async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) throw new Error('unsupported')
        const result = await navigator.mediaDevices.enumerateDevices()
        if (id !== generation.current || !enabledRef.current) return
        setDevices(microphoneDevices(result))
      } catch {
        if (id === generation.current && enabledRef.current) setError('Could not list microphones. Use system default or refresh again.')
      } finally {
        if (id === generation.current && enabledRef.current) setRefreshing(false)
      }
    })()
  }, [])

  useEffect(() => {
    // A per-effect handled counter keeps this effect's teardown from invalidating
    // a refresh that a NEWER effect started: the bump is scoped to its own run.
    const handled = generation
    if (!enabled) { handled.current++; setRefreshing(false) }
    const changed = (): void => { if (requested.current) refresh() }
    const media = navigator.mediaDevices
    if (enabled) media?.addEventListener?.('devicechange', changed)
    return () => {
      // Reading through the alias is the same live counter (a ref's identity is
      // stable); naming it makes the intent explicit rather than implicit.
      handled.current++
      media?.removeEventListener?.('devicechange', changed)
    }
  }, [enabled, refresh])

  return { devices, refreshing, error, refresh }
}
