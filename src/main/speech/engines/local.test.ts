import { describe, expect, it } from 'vitest'
import { synthesizeLocal } from './local'
import { decodePcmWav } from './wav'

function wav(): Buffer {
  const b = Buffer.alloc(48)
  b.write('RIFF', 0); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36)
  b.writeUInt32LE(4, 40); b.writeInt16LE(1, 44); b.writeInt16LE(-1, 46)
  return b
}

describe('local engine', () => {
  it('decodes valid PCM and rejects truncation or wrong format', () => {
    expect(decodePcmWav(wav())).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16, pcm: Buffer.from([1, 0, 255, 255]) })
    expect(() => decodePcmWav(wav().subarray(0, 46))).toThrow('Truncated')
    const compressed = wav(); compressed.writeUInt16LE(3, 20)
    expect(() => decodePcmWav(compressed)).toThrow('Unsupported')
  })
  it('passes text through a private input file, not shell arguments', async () => {
    const script = `const fs=require('fs'); if(fs.readFileSync(process.argv[1],'utf8')!=='hello $(echo bad)') process.exit(1); fs.writeFileSync(process.argv[2],Buffer.from('${wav().toString('base64')}','base64'))`
    const result = await synthesizeLocal({ text: 'hello $(echo bad)', voice: 'test', command: process.execPath, argsTemplate: ['-e', script, '{input}', '{output}'], engineDir: '' })
    expect(result.pcm.length).toBe(4)
  })
  it('cancels a running process and rejects missing templates', async () => {
    const controller = new AbortController()
    const running = synthesizeLocal({ text: 'hello', voice: 'test', command: process.execPath, argsTemplate: ['-e', 'setTimeout(()=>{},10000)', '{input}', '{output}'], engineDir: '', signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(running).rejects.toThrow('cancelled')
    await expect(synthesizeLocal({ text: 'hello', voice: 'test', command: process.execPath, argsTemplate: [], engineDir: '' })).rejects.toThrow('placeholders')
  })
})
