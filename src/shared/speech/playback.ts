/** Playback messages between the trusted workspace renderer and main. */
export type PlaybackMessage =
  | { type: 'play'; id: string; pcmBase64: string; sampleRate: number; channels: number; volume: number; text: string }
  | { type: 'cancel'; id: string }

export type SpeechUiEvent =
  | { type: 'state'; status: import('./types').SpeechStatus }
  | { type: 'result'; readingId: number; result: { finished: boolean; error?: string } }
  | { type: 'error'; message: string }
