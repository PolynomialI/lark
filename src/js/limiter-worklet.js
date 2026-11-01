// Look-ahead peak limiter (runs on the audio thread). Keeps the output below -0.5 dBFS without
// "make-up gain" or pumping: it sees peaks 5 ms ahead, turns down smoothly, and recovers over ~200 ms.
class LarkLimiter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.look = Math.max(1, Math.round(sampleRate * 0.005));
    this.ceiling = 10 ** (-0.5 / 20);
    this.attack = 1 - Math.exp(-3 / this.look);
    this.release = 1 - Math.exp(-1 / (sampleRate * 0.2));
    this.bufL = new Float32Array(this.look);
    this.bufR = new Float32Array(this.look);
    this.pos = 0;
    this.held = 1;
    this.hold = 0;
    this.g = 1;
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    const L = inp[0], R = inp[1] || inp[0], oL = out[0], oR = out[1];
    const c = this.ceiling;
    for (let i = 0; i < oL.length; i++) {
      const xl = L ? L[i] : 0, xr = R ? R[i] : 0;
      const pk = Math.max(Math.abs(xl), Math.abs(xr));
      const need = pk > c ? c / pk : 1;
      if (need <= this.held) { this.held = need; this.hold = this.look; } else if (this.hold > 0) this.hold--; else this.held = need;
      this.g += (this.held - this.g) * (this.held < this.g ? this.attack : this.release);
      const p = this.pos;
      let yl = this.bufL[p] * this.g, yr = this.bufR[p] * this.g;
      this.bufL[p] = xl;
      this.bufR[p] = xr;
      this.pos = p + 1 === this.look ? 0 : p + 1;
      if (yl > c) yl = c; else if (yl < -c) yl = -c;
      if (yr > c) yr = c; else if (yr < -c) yr = -c;
      oL[i] = yl;
      if (oR) oR[i] = yr;
    }
    return true;
  }
}
registerProcessor('lark-limiter', LarkLimiter);
