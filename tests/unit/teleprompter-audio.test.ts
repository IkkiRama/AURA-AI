import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, SpeechBuffer } from '../../src/features/teleprompter/audio';

const quiet = new Int16Array(640);
const voice = Int16Array.from({ length: 640 }, (_, index) => Math.round(2600 * Math.sin(index * 0.13)));

describe('voice activity buffer', () => {
  it('does not emit transcriptions during long pauses or from an isolated noise burst', () => {
    const buffer = new SpeechBuffer();
    for (let index = 0; index < 100; index++) expect(buffer.push(quiet)).toBeNull();
    expect(buffer.push(voice)).toBeNull();
    for (let index = 0; index < 60; index++) expect(buffer.push(quiet)).toBeNull();
  });

  it('emits an interim update followed by a final after a real pause', () => {
    const buffer = new SpeechBuffer();
    const events = [];
    for (let index = 0; index < 50; index++) {
      const event = buffer.push(voice);
      if (event) events.push(event);
    }
    for (let index = 0; index < 20; index++) {
      const event = buffer.push(quiet);
      if (event) events.push(event);
    }
    expect(events.map((event) => event.final)).toEqual([false, true]);
    expect(events[1].pcm.length).toBeGreaterThan(events[0].pcm.length);
  });

  it('bounds continuous audio chunks to twelve seconds', () => {
    const buffer = new SpeechBuffer();
    const finals = [];
    for (let index = 0; index < 700; index++) {
      const event = buffer.push(voice);
      if (event?.final) finals.push(event.pcm.length);
    }
    expect(finals).toEqual([12 * SAMPLE_RATE, 12 * SAMPLE_RATE]);
  });
});
