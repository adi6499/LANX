// LANX 3.13.0: sound for LANX's own call engine (src/lib/ownrtc), in the audio thread.
//  - "lanx-cap": cuts the microphone into 20 ms pieces (960 samples at 48 kHz) for the
//    Opus encoder;
//  - "lanx-play": plays what came in from the other PC, keeping only a short queue so
//    the sound is never late (a late piece is dropped, a missing one is silence).

class LanxCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 960;
    this.buf = new Float32Array(this.size);
    this.fill = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const n = Math.min(ch.length - i, this.size - this.fill);
        this.buf.set(ch.subarray(i, i + n), this.fill);
        this.fill += n;
        i += n;
        if (this.fill === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.fill = 0;
        }
      }
    }
    return true;
  }
}

class LanxPlay extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.head = 0; // read position in queue[0]
    this.queued = 0; // samples waiting
    this.started = false;
    // Start once 40 ms are here; never let more than 160 ms pile up.
    this.startAt = 1920;
    this.maxQueued = 7680;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (!(d instanceof Float32Array) || !d.length) return;
      this.queue.push(d);
      this.queued += d.length;
      while (this.queued > this.maxQueued && this.queue.length > 1) {
        const old = this.queue.shift();
        this.queued -= old.length - this.head;
        this.head = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!this.started) {
      if (this.queued < this.startAt) {
        out.fill(0);
        return true;
      }
      this.started = true;
    }
    let i = 0;
    while (i < out.length && this.queue.length) {
      const cur = this.queue[0];
      const n = Math.min(out.length - i, cur.length - this.head);
      out.set(cur.subarray(this.head, this.head + n), i);
      i += n;
      this.head += n;
      this.queued -= n;
      if (this.head >= cur.length) {
        this.queue.shift();
        this.head = 0;
      }
    }
    if (i < out.length) {
      out.fill(0, i);
      // Ran dry: wait for a little to gather again.
      this.started = false;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor("lanx-cap", LanxCapture);
registerProcessor("lanx-play", LanxPlay);
