import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

export function createMlService({ workerFactory = () => new Worker(new URL('./training-worker.js', import.meta.url), { type: 'module' }) } = {}) {
  const worker = workerFactory();
  const pending = new Map();
  let closed = false;
  let failed = false;
  const onMessage = event => {
    const message = event.data ?? event;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === 'progress') { entry.onProgress?.(message.progress); return; }
    pending.delete(message.id);
    if (message.type === 'error') entry.reject(new Error(message.error));
    else entry.resolve(message.result);
  };
  const onError = error => {
    failed = true;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  if (typeof worker.on === 'function') {
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', code => {
      if (code !== 0 || pending.size) onError(new Error(`ML worker exited unexpectedly (code ${code}).`));
      else failed = true;
    });
  } else worker.onmessage = onMessage;
  let busy = false;
  function request(type, payload, onProgress) {
    if (closed || failed) return Promise.reject(new Error('ML worker is closed or unavailable.'));
    if (busy) return Promise.reject(Object.assign(new Error('ML worker is busy.'), { code: 'ML_BUSY' }));
    const id = randomUUID();
    busy = true;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: value => { busy = false; resolve(value); }, reject: error => { busy = false; reject(error); }, onProgress });
      try { worker.postMessage({ id, type, payload }); }
      catch (error) { pending.delete(id); busy = false; reject(error); }
    });
  }
  return {
    train(payload, onProgress) { return request('train', payload, onProgress); },
    predict(payload) { return request('predict', payload); },
    activateModel(payload) { return request('activate-model', payload); },
    async close() { closed = true; onError(new Error('ML worker closed.')); await worker.terminate(); },
  };
}
