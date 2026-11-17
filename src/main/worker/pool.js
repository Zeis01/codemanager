// Pula wątków roboczych. Gdy wątek nie wystartuje, operacja wykonuje się w procesie głównym.
'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

class Pool {
  constructor({ size = 2, file = path.join(__dirname, 'task.js') } = {}) {
    this.file = file; this.size = Math.max(1, size); this.workers = []; this.queue = []; this.seq = 0; this.pending = new Map(); this.broken = false;
  }
  spawn() {
    const w = new Worker(this.file);
    w.busy = 0;
    w.on('message', m => { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); w.busy--; if (m.ok) p.res(m.data); else p.rej(new Error(m.error)); this.pump(); });
    w.on('error', e => this.fail(w, e));
    w.on('exit', code => { if (code !== 0) this.fail(w, new Error('Wątek roboczy zakończył się kodem ' + code)); });
    this.workers.push(w);
    return w;
  }
  fail(w, err) {
    if (!this.workers.includes(w)) return;
    err.workerError = true;
    this.failures = (this.failures || 0) + 1;
    if (this.failures >= 3) this.broken = true; // wątki nie działają – dalej wszystko w procesie głównym
    this.workers = this.workers.filter(x => x !== w);
    for (const [id, p] of this.pending) if (p.w === w) { this.pending.delete(id); p.rej(err); }
    this.pump();
  }
  pick() {
    let w = this.workers.find(x => x.busy === 0);
    if (!w && this.workers.length < this.size) { try { w = this.spawn(); } catch { this.broken = true; return null; } }
    return w || null;
  }
  pump() {
    while (this.queue.length) {
      const w = this.pick(); if (!w) return;
      const job = this.queue.shift();
      const id = ++this.seq; w.busy++;
      this.pending.set(id, { res: job.res, rej: job.rej, w });
      try { w.postMessage({ id, op: job.op, args: job.args }); }
      catch (e) { this.pending.delete(id); w.busy--; job.rej(Object.assign(e, { workerError: true })); }
    }
  }
  run(op, args, fallback) {
    if (this.broken && fallback) return Promise.resolve().then(fallback);
    return new Promise((res, rej) => { this.queue.push({ op, args, res, rej }); this.pump(); }).catch(e => {
      if (fallback && (e.workerError || /DataCloneError|could not be cloned/i.test(e.message))) return fallback();
      throw e;
    });
  }
  close() { for (const w of this.workers) w.terminate(); this.workers = []; }
}

module.exports = { Pool };
