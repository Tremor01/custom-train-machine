import test from 'node:test';
import assert from 'node:assert/strict';
import { createMlService } from '../../server/ml-service.js';

test('serializes model tasks in a long-lived worker and relays progress', async () => {
  const worker = {
    listeners: {},
    on(type, callback) { this.listeners[type] = callback; },
    postMessage(message) {
      if (message.type === 'train') {
        this.listeners.message({ id: message.id, type: 'progress', progress: { phase: 'features', progress: 25 } });
        setTimeout(() => this.listeners.message({ id: message.id, type: 'result', result: { modelId: 'm1' } }), 5);
      }
      if (message.type === 'predict') this.listeners.message({ id: message.id, type: 'result', result: [0.4, 0.6] });
    },
    terminate() {},
  };
  const service = createMlService({ workerFactory: () => worker });
  const progress = [];
  const trained = await service.train({ classes: [] }, value => progress.push(value));
  assert.equal(trained.modelId, 'm1');
  assert.equal(progress[0].phase, 'features');
  assert.deepEqual(await service.predict({ modelId: 'm1', image: Buffer.from('x') }), [0.4, 0.6]);
  await service.close();
});
