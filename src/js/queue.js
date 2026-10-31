// Play queue: "Next in queue" (user-added) plays before "Next from <context>".
// Shuffle plays every song of the context once (a random permutation) before any repeats.
import { shuffleArray, uid } from './util.js';

export class Queue {
  context = null;   // { type, id, name }
  ids = [];         // song ids of the context, in context order
  order = [];       // play order: indexes into ids
  pos = -1;         // position in order of the current context track
  user = [];        // [{ uid, songId }] — Next in queue
  current = null;   // { songId, fromQueue }
  shuffle = false;
  repeat = 'off';   // 'off' | 'all' | 'one'

  #permutation(first) {
    const rest = shuffleArray(this.ids.map((_, i) => i).filter((i) => i !== first));
    return first >= 0 ? [first, ...rest] : rest;
  }
  setContext(context, ids, start = 0) {
    this.context = context;
    this.ids = ids.slice();
    if (this.shuffle) { this.order = this.#permutation(start >= 0 ? start : -1); this.pos = 0; }
    else { this.order = this.ids.map((_, i) => i); this.pos = Math.max(0, start); }
    this.current = this.ids.length ? { songId: this.ids[this.order[this.pos]], fromQueue: false } : null;
  }
  get songId() { return this.current?.songId ?? null; }
  #ctxSong(p = this.pos) { return this.ids[this.order[p]]; }

  setShuffle(on) {
    this.shuffle = on;
    if (!this.ids.length) return;
    const cur = this.order[this.pos] ?? 0;
    if (on) { this.order = this.#permutation(cur); this.pos = 0; }
    else { this.order = this.ids.map((_, i) => i); this.pos = cur; }
  }
  cycleRepeat() { this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat]; return this.repeat; }

  /** What next() would return, without changing anything. */
  peekNext(auto = true) {
    if (!this.current) return null;
    if (auto && this.repeat === 'one') return this.current.songId;
    if (this.user.length) return this.user[0].songId;
    if (this.pos + 1 < this.order.length) return this.#ctxSong(this.pos + 1);
    if (this.repeat === 'all' && this.ids.length) {
      if (this.shuffle) {
        if (!this.nextCycle) {
          this.nextCycle = this.#permutation(-1);
          if (this.nextCycle.length > 1 && this.nextCycle[0] === this.order[this.pos]) this.nextCycle.push(this.nextCycle.shift());
        }
        return this.ids[this.nextCycle[0]];
      }
      return this.ids[0];
    }
    return null;
  }
  /** Advance. Returns the new song id, or null when the end of the context is reached (repeat off). */
  next(auto = true) {
    if (!this.current) return null;
    if (auto && this.repeat === 'one') return this.current.songId;
    if (this.user.length) {
      this.current = { songId: this.user.shift().songId, fromQueue: true };
      return this.current.songId;
    }
    if (this.pos + 1 < this.order.length) this.pos++;
    else if (this.repeat === 'all' && this.ids.length) {
      this.peekNext(auto);
      this.order = this.shuffle ? this.nextCycle : this.ids.map((_, i) => i);
      this.pos = 0;
    } else {
      // End of context: go back to the start (stopped), like a finished playlist.
      if (this.shuffle) this.order = this.#permutation(-1);
      this.pos = 0;
      this.nextCycle = null;
      this.current = this.ids.length ? { songId: this.#ctxSong(), fromQueue: false } : null;
      return null;
    }
    this.nextCycle = null;
    this.current = { songId: this.#ctxSong(), fromQueue: false };
    return this.current.songId;
  }
  prev() {
    if (!this.current) return null;
    if (this.current.fromQueue) { this.current = { songId: this.#ctxSong(), fromQueue: false }; return this.current.songId; }
    if (this.pos > 0) this.pos--;
    else if (this.repeat === 'all') this.pos = this.order.length - 1;
    this.current = { songId: this.#ctxSong(), fromQueue: false };
    return this.current.songId;
  }

  upcoming() { return this.order.slice(this.pos + 1).map((i) => this.ids[i]); }
  playNext(songIds) { this.user.unshift(...songIds.map((songId) => ({ uid: uid(), songId }))); this.nextCycle = null; }
  addToQueue(songIds) { this.user.push(...songIds.map((songId) => ({ uid: uid(), songId }))); }
  removeQueued(uids) { const s = new Set(uids); this.user = this.user.filter((q) => !s.has(q.uid)); }
  clearQueue() { this.user = []; }
  moveQueued(from, to) { const [x] = this.user.splice(from, 1); this.user.splice(to, 0, x); }
  /** Remove an upcoming context track (k = index within upcoming()). */
  removeUpcoming(k) { this.order.splice(this.pos + 1 + k, 1); }
  moveUpcoming(from, to) { const [x] = this.order.splice(this.pos + 1 + from, 1); this.order.splice(this.pos + 1 + to, 0, x); }
  /** Jump to a queued item; items before it are dropped (as if they had been skipped). */
  jumpToQueued(index) {
    const [q] = this.user.splice(0, index + 1).slice(-1);
    this.current = { songId: q.songId, fromQueue: true };
    return q.songId;
  }
  jumpToUpcoming(k) {
    this.pos = this.pos + 1 + k;
    this.current = { songId: this.#ctxSong(), fromQueue: false };
    return this.current.songId;
  }

  serialize() {
    const { context, ids, order, pos, user, current, shuffle, repeat } = this;
    return { context, ids, order, pos, user, current, shuffle, repeat };
  }
  restore(o) { Object.assign(this, o, { nextCycle: null }); }
  /** Drop songs that no longer exist (e.g. deleted from the library). */
  prune(exists) {
    const keep = this.ids.map((id) => exists(id));
    if (keep.every(Boolean) && this.user.every((q) => exists(q.songId))) return;
    const map = [];
    let n = 0;
    this.ids = this.ids.filter((_, i) => { map[i] = keep[i] ? n++ : -1; return keep[i]; });
    const curIdx = this.order[this.pos];
    this.order = this.order.map((i) => map[i]).filter((i) => i >= 0);
    this.pos = Math.max(0, this.order.indexOf(map[curIdx] ?? -1));
    this.user = this.user.filter((q) => exists(q.songId));
    if (this.current && !exists(this.current.songId)) this.current = this.ids.length ? { songId: this.#ctxSong(), fromQueue: false } : null;
  }
}
