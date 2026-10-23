// LANX 2.5.1: the microphone tap for voice typing and voice memos. It runs in
// the browser's audio thread and hands every block of samples to the page.
// (A file of its own: the page's security policy allows scripts from LANX
// itself, not from in-memory blobs.)
class LanxTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("lanx-tap", LanxTap);
