export const SAMPLE_RATE = 16_000;
const maxFrames = SAMPLE_RATE * 12;
const minimum = SAMPLE_RATE * 0.8;
const quietLimit = SAMPLE_RATE * 0.65;
const partialEvery = SAMPLE_RATE * 1.7;
const preRoll = SAMPLE_RATE * 0.16;

export interface AudioSlice { pcm: Int16Array; final: boolean }

/** Bounded VAD for PCM frames from the microphone worklet. */
export class SpeechBuffer {
  private readonly pcm = new Int16Array(maxFrames);
  private length = 0;
  private voicedFrames = 0;
  private quiet = 0;
  private lastPartial = 0;
  private consecutiveVoice = 0;
  private floor = 0.003;

  push(frame: Int16Array): AudioSlice | null {
    if (!frame.length || frame.length > preRoll) return null;
    let squared = 0;
    for (const sample of frame) squared += (sample / 32768) ** 2;
    const level = Math.sqrt(squared / frame.length);
    const voice = level > Math.max(0.008, this.floor * 3.2);
    if (!voice && !this.voicedFrames) this.floor = this.floor * 0.98 + level * 0.02;
    this.consecutiveVoice = voice ? this.consecutiveVoice + frame.length : 0;
    if (!this.voicedFrames && this.consecutiveVoice < SAMPLE_RATE * 0.12) {
      const preserved = Math.min(this.length, preRoll - frame.length);
      this.pcm.copyWithin(0, this.length - preserved, this.length);
      this.pcm.set(frame, preserved);
      this.length = preserved + frame.length;
      return null;
    }
    const count = Math.min(frame.length, maxFrames - this.length);
    this.pcm.set(frame.subarray(0, count), this.length);
    this.length += count;
    if (voice) this.voicedFrames += count;
    this.quiet = voice ? 0 : this.quiet + count;
    if (this.quiet >= quietLimit || this.length >= maxFrames) {
      const pcm = this.voicedFrames >= SAMPLE_RATE * 0.24 && this.length >= minimum ? this.pcm.slice(0, this.length) : null;
      this.length = this.voicedFrames = this.quiet = this.lastPartial = this.consecutiveVoice = 0;
      return pcm ? { pcm, final: true } : null;
    }
    if (this.length - this.lastPartial >= partialEvery) {
      this.lastPartial = this.length;
      return { pcm: this.pcm.slice(0, this.length), final: false };
    }
    return null;
  }
}
