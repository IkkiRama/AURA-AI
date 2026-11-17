class AuraMicrophone extends AudioWorkletProcessor {
  phase = 0;
  total = 0;
  samples = 0;
  frame = new Int16Array(640);
  length = 0;

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.total += sample;
      this.samples += 1;
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      const average = this.total / this.samples;
      this.frame[this.length++] = Math.round(Math.max(-1, Math.min(1, average)) * 32767);
      this.phase -= sampleRate;
      this.total = this.samples = 0;
      if (this.length === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Int16Array(640);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('aura-microphone', AuraMicrophone);
