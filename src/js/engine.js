// Audio engine. Two <audio> elements ("slots") take turns so the next song is already loaded:
// it starts right as the current one ends (near-gapless) or overlaps it (crossfade).
// Web Audio (needed for crossfade, EQ, normalisation and volume above 100%) is only used while one of those is on;
// otherwise the elements play directly, which is the most reliable for background play on phones.
import * as opfs from './opfs.js';
import { Emitter } from './util.js';

export const EQ_BANDS = [60, 150, 400, 1000, 2400, 15000];
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0], bass: [6, 4, 1, 0, 0, 0], 'bass-down': [-6, -4, -1, 0, 0, 0],
  treble: [0, 0, 0, 1, 4, 6], vocal: [-2, -1, 2, 4, 3, 0], rock: [4, 2, -1, 1, 3, 4],
  pop: [-1, 2, 4, 3, 0, -1], acoustic: [3, 2, 1, 2, 2, 2], electronic: [5, 3, 0, -1, 2, 4],
};
export const GAP_LEAD = 0.01;
export const MAX_VOLUME = 1.5; // 150%: above 100% the sound is boosted through Web Audio, with a limiter // seconds before the end at which the next song is started when not crossfading
const db2gain = (db) => 10 ** (db / 20);

export class Engine extends Emitter {
  slots = [];
  cur = 0;
  web = false;
  ctx = null;
  next = null;          // song preloaded in the idle slot (ready to start)
  pendingNext = undefined;
  transition = null;    // { from, timer } while the previous song finishes / fades out
  stopAfterCurrent = false;
  opts = { crossfade: 0, normalize: false, eq: { enabled: false, gains: [0, 0, 0, 0, 0, 0] } };
  volume = 0.8;
  muted = false;
  #timer = 0;
  #switching = Promise.resolve();

  constructor() { super(); this.#build(false); }
  get slot() { return this.slots[this.cur]; }
  get idle() { return this.slots[1 - this.cur]; }
  get el() { return this.slot.el; }
  get song() { return this.slot.song; }
  get paused() { return this.el.paused; }
  get currentTime() { return this.el.currentTime || this.slot.startAt || 0; }
  get duration() { const d = this.el.duration; return Number.isFinite(d) ? d : this.slot.song?.duration || 0; }

  #build(web) {
    for (const s of this.slots) { s.el.pause(); s.el.removeAttribute('src'); s.el.load(); if (s.url) URL.revokeObjectURL(s.url); }
    if (!web && this.ctx) { this.ctx.close(); this.ctx = null; }
    this.web = web;
    if (web && !this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      this.master = this.ctx.createGain();
      this.filters = EQ_BANDS.map((f, i) => {
        const b = this.ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.Q.value = 1;
        return b;
      });
      this.filters.reduce((a, b) => (a.connect(b), b)).connect(this.master);
      // Limiter, used only when the volume is above 100%, so boosted loud songs don't distort.
      this.limiter = this.ctx.createDynamicsCompressor();
      Object.entries({ threshold: -1.5, knee: 0, ratio: 20, attack: 0.002, release: 0.15 }).forEach(([k, v]) => { this.limiter[k].value = v; });
      this.limiter.connect(this.ctx.destination);
      this.master.connect(this.ctx.destination);
      this.ctx.onstatechange = () => { if (this.ctx?.state === 'suspended' && !this.el.paused) this.ctx.resume(); };
    }
    this.slots = [0, 1].map((i) => {
      const el = new Audio();
      el.preload = 'auto';
      const s = { el, song: null, url: null, i };
      if (web) {
        s.norm = this.ctx.createGain();
        s.fade = this.ctx.createGain();
        this.ctx.createMediaElementSource(el).connect(s.norm);
        s.norm.connect(s.fade).connect(this.filters[0]);
      }
      el.addEventListener('timeupdate', () => { if (s === this.slot) { this.emit('time'); this.#check(); } });
      el.addEventListener('ended', () => this.#ended(s));
      el.addEventListener('play', () => s === this.slot && this.emit('state'));
      el.addEventListener('pause', () => s === this.slot && this.emit('state'));
      el.addEventListener('durationchange', () => s === this.slot && this.emit('time'));
      el.addEventListener('error', () => { if (s === this.slot && s.song) this.emit('error', s.song); });
      return s;
    });
    this.cur = 0;
    this.next = null;
    this.transition = null;
    this.#applyVolume();
    this.#applyEq();
  }

  #setSrc(s, song) {
    s.song = song;
    s.ready = false;
    return (s.loading = (async () => {
      const file = await opfs.getFile(song.file);
      if (s.song !== song) return; // superseded while awaiting
      if (s.url) URL.revokeObjectURL(s.url);
      s.url = URL.createObjectURL(file);
      s.el.src = s.url;
      s.ready = true;
    })());
  }
  #applyNorm(s) {
    if (!this.web || !s.song) return;
    s.norm.gain.value = this.opts.normalize ? db2gain(s.song.rg ?? s.song.loud ?? 0) : 1;
  }
  #setFade(s, v) {
    if (!this.web) return;
    s.fade.gain.cancelScheduledValues(0);
    s.fade.gain.value = v;
  }
  #applyVolume() {
    const v = this.muted ? 0 : this.volume;
    if (this.web) {
      this.master.gain.value = v;
      this.slots.forEach((s) => { s.el.volume = 1; });
      this.master.disconnect();
      this.master.connect(v > 1 ? this.limiter : this.ctx.destination);
    } else this.slots.forEach((s) => { s.el.volume = Math.min(1, v); });
  }
  #needWeb() { return this.opts.crossfade > 0 || this.opts.normalize || this.opts.eq.enabled || this.volume > 1; }
  /** Switch between plain and Web Audio output (one switch at a time), keeping the song and position. */
  #switchMode() {
    return (this.#switching = this.#switching.then(async () => {
      const need = this.#needWeb();
      if (need === this.web) { this.#applyVolume(); return; }
      const song = this.song, t = this.currentTime, playing = !this.paused, next = this.next;
      this.#build(need);
      if (song) await this.load(song, { autoplay: playing, at: t });
      if (next) this.preload(next);
    }));
  }
  #applyEq() {
    if (!this.web) return;
    const on = this.opts.eq.enabled;
    this.filters.forEach((f, i) => { f.gain.value = on ? this.opts.eq.gains[i] || 0 : 0; });
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(MAX_VOLUME, v));
    if (this.#needWeb() !== this.web) this.#switchMode(); else this.#applyVolume();
    this.emit('volume');
  }
  setMuted(m) { this.muted = m; this.#applyVolume(); this.emit('volume'); }

  /** Apply crossfade / normalisation / EQ settings, switching between plain and Web Audio output if needed. */
  async setOptions(opts) {
    this.opts = { ...this.opts, ...opts };
    if (this.#needWeb() !== this.web) await this.#switchMode();
    else {
      this.slots.forEach((s) => this.#applyNorm(s));
      this.#applyEq();
      this.#check();
    }
  }

  /** Make `song` the current song (reusing the preloaded slot when it matches). */
  async load(song, { autoplay = true, at = 0 } = {}) {
    this.#endTransition();
    clearTimeout(this.#timer);
    const old = this.slot, s = this.idle;
    old.el.pause();
    if (s.song !== song || s.el.error) await this.#setSrc(s, song);
    this.cur = s.i;
    this.next = null;
    s.startAt = at;
    try { s.el.currentTime = at; } catch {}
    this.#applyNorm(s);
    this.#setFade(s, 1);
    if (old !== s) { try { old.el.currentTime = 0; } catch {} }
    this.emit('track', song);
    this.emit('time');
    if (autoplay) await this.play();
    else this.emit('state');
  }
  /** Load the song that should follow into the idle slot (null = nothing follows). */
  preload(song) {
    if (this.transition) { this.pendingNext = song; return; }
    this.pendingNext = undefined;
    this.next = song || null;
    if (song && this.idle.song !== song) this.#setSrc(this.idle, song);
    this.#check();
  }
  async play() {
    if (!this.song) return;
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    try { await this.el.play(); } catch (e) { if (e.name !== 'AbortError') this.emit('state'); }
    this.#check();
  }
  pause() {
    this.#endTransition();
    clearTimeout(this.#timer);
    this.el.pause();
  }
  seek(t) {
    this.#endTransition();
    this.el.currentTime = Math.max(0, Math.min(t, this.duration || t));
    this.emit('time');
    this.#check();
  }

  #lead() {
    const d = this.duration;
    if (this.web && this.opts.crossfade > 0) return Math.min(this.opts.crossfade, d / 2, (this.next?.duration || d) / 2);
    return GAP_LEAD;
  }
  #check() {
    clearTimeout(this.#timer);
    const el = this.el;
    if (el.paused || this.transition || !this.next || this.stopAfterCurrent || !Number.isFinite(el.duration)) return;
    if (!this.idle.ready) { this.#timer = setTimeout(() => this.#check(), 50); return; }
    const remaining = el.duration - el.currentTime, lead = this.#lead(), wait = remaining - lead;
    if (wait <= 0.005) this.#startNext(Math.max(0, remaining));
    else this.#timer = setTimeout(() => this.#check(), wait > 1 ? (wait - 0.5) * 1000 : wait * 1000);
  }
  #startNext(remaining) {
    const from = this.slot, to = this.idle, song = this.next;
    if (!song || to.song !== song) return;
    this.cur = to.i;
    this.next = null;
    to.startAt = 0;
    try { to.el.currentTime = 0; } catch {}
    this.#applyNorm(to);
    const fading = this.web && this.opts.crossfade > 0 && remaining > 0.1;
    if (fading) {
      const now = this.ctx.currentTime, n = 32;
      const out = new Float32Array(n), inn = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / (n - 1); out[i] = Math.cos(x * Math.PI / 2); inn[i] = Math.sin(x * Math.PI / 2); }
      from.fade.gain.cancelScheduledValues(0);
      from.fade.gain.setValueCurveAtTime(out, now, remaining);
      to.fade.gain.cancelScheduledValues(0);
      to.fade.gain.setValueCurveAtTime(inn, now, remaining);
    } else this.#setFade(to, 1);
    this.transition = { from, timer: setTimeout(() => this.#endTransition(), remaining * 1000 + 250) };
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    to.el.play().catch(() => {});
    this.emit('advance', song);
    this.emit('time');
  }
  #endTransition() {
    const tr = this.transition;
    if (!tr) return;
    this.transition = null;
    clearTimeout(tr.timer);
    tr.from.el.pause();
    this.#setFade(tr.from, 1);
    if (this.pendingNext !== undefined) this.preload(this.pendingNext);
  }
  async #ended(s) {
    if (this.transition?.from === s) { this.#endTransition(); return; }
    if (s !== this.slot) return;
    if (this.next && !this.stopAfterCurrent) { await this.idle.loading; if (s === this.slot) this.#startNext(0); }
    else this.emit('ended');
  }
}
