/** Extract PCM from an uncompressed WAV while checking all RIFF chunk boundaries. */
export interface PcmAudio {
  pcm: Buffer
  sampleRate: number
  channels: number
  bitsPerSample: number
}

export function decodePcmWav(bytes: Buffer): PcmAudio {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid WAV header')
  }
  const end = bytes.readUInt32LE(4) + 8
  if (end > bytes.length || end < 12) throw new Error('Truncated WAV file')
  let format: { sampleRate: number; channels: number; bitsPerSample: number; blockAlign: number } | undefined
  let data: Buffer | undefined
  for (let pos = 12; pos < end;) {
    if (pos + 8 > end) throw new Error('Truncated WAV chunk header')
    const tag = bytes.toString('ascii', pos, pos + 4)
    const size = bytes.readUInt32LE(pos + 4)
    const start = pos + 8
    const next = start + size + (size & 1)
    if (start + size > end || next > end) throw new Error('Truncated WAV chunk')
    if (tag === 'fmt ') {
      if (format || size < 16 || bytes.readUInt16LE(start) !== 1) throw new Error('Unsupported WAV format')
      format = {
        channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4),
        blockAlign: bytes.readUInt16LE(start + 12), bitsPerSample: bytes.readUInt16LE(start + 14),
      }
      if (format.channels < 1 || format.channels > 2 || format.sampleRate < 8000 || format.sampleRate > 192000 ||
          format.bitsPerSample !== 16 || format.blockAlign !== format.channels * 2) throw new Error('Unsupported WAV audio parameters')
    } else if (tag === 'data') {
      if (data) throw new Error('Multiple WAV data chunks are not supported')
      data = bytes.subarray(start, start + size)
    }
    pos = next
  }
  if (!format || !data || !data.length || data.length % format.blockAlign) throw new Error('Invalid WAV audio data')
  return { pcm: data, sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bitsPerSample }
}
