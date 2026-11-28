import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Worker } from 'node:worker_threads';
import { createMlService } from '../../server/ml-service.js';

test('real worker trains, saves, activates and predicts using generated images', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ctm-worker-roundtrip-'));
  const modelDirectory = join(directory, 'published');
  const stagingDirectory = join(directory, 'staging');
  const classes = [];
  for (let classIndex = 0; classIndex < 2; classIndex++) {
    const examples = [];
    for (let index = 0; index < 3; index++) {
      const path = join(directory, `${classIndex}-${index}.png`);
      await sharp({ create: { width: 16, height: 16, channels: 3, background: classIndex ? { r: 235, g: 25 + index, b: 25 } : { r: 25, g: 25 + index, b: 235 } } }).png().toFile(path);
      examples.push(path);
    }
    classes.push({ name: `class-${classIndex}`, color: '#123456', emoji: 'x', sound: '', examples });
  }

  const service = createMlService();
  try {
    const progress = [];
    const manifest = await service.train({ classes, modelDirectory, stagingDirectory }, value => progress.push(value));
    assert.equal(manifest.metrics.length, 25);
    assert.ok(manifest.metrics.at(-1).accuracy > 0.5, `expected separable generated colors to train above chance; got ${manifest.metrics.at(-1).accuracy}`);
    assert.equal(manifest.validation.actual.length, 2);
    assert.equal(manifest.validation.predicted.length, 2);
    assert.ok(manifest.validation.actual.every(index => Number.isInteger(index) && index >= 0 && index < classes.length));
    assert.ok(manifest.validation.predicted.every(index => Number.isInteger(index) && index >= 0 && index < classes.length));
    assert.ok(progress.some(value => value.phase === 'training' && value.progress === 100));
    assert.ok((await readFile(join(stagingDirectory, 'weights.bin'))).length > 0);
    const savedManifest = JSON.parse(await readFile(join(stagingDirectory, 'manifest.json'), 'utf8'));
    assert.deepEqual(savedManifest.validation, manifest.validation);
    await mkdir(modelDirectory, { recursive: true });
    await writeFile(join(modelDirectory, 'model.json'), await readFile(join(stagingDirectory, 'model.json')));
    await writeFile(join(modelDirectory, 'weights.bin'), await readFile(join(stagingDirectory, 'weights.bin')));
    await service.activateModel({ modelPath: join(modelDirectory, 'model.json'), modelDirectory, classes });
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 235, g: 25, b: 25 } } }).png().toBuffer();
    const prediction = await service.predict({ image });
    assert.deepEqual(prediction.classes.map(item => item.name), ['class-0', 'class-1']);
    assert.equal(prediction.probabilities.length, 2);
    assert.ok(prediction.probabilities.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(prediction.probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-5);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('repeated real-worker predictions do not increase the live tensor count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ctm-worker-tensors-'));
  const classes = [];
  for (let classIndex = 0; classIndex < 2; classIndex++) {
    const examples = [];
    for (let index = 0; index < 3; index++) {
      const path = join(directory, `${classIndex}-${index}.png`);
      await sharp({ create: { width: 16, height: 16, channels: 3, background: classIndex ? { r: 235, g: 25, b: 25 } : { r: 25, g: 25, b: 235 } } }).png().toFile(path);
      examples.push(path);
    }
    classes.push({ name: `class-${classIndex}`, color: '#123456', emoji: 'x', sound: '', examples });
  }
  const worker = new Worker(new URL('../../server/training-worker.js', import.meta.url), { type: 'module', workerData: { testTensorStats: true } });
  const service = createMlService({ workerFactory: () => worker });
  try {
    const stagingDirectory = join(directory, 'staging');
    await service.train({ classes, modelDirectory: join(directory, 'published'), stagingDirectory });
    await service.activateModel({ modelPath: join(stagingDirectory, 'model.json'), modelDirectory: stagingDirectory, classes });
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 235, g: 25, b: 25 } } }).png().toBuffer();
    const tensorCount = () => new Promise((resolve, reject) => {
      const id = `tensor-count-${Math.random()}`;
      const onMessage = message => { if (message.id === id) { worker.off('message', onMessage); message.type === 'result' ? resolve(message.result) : reject(new Error(message.error)); } };
      worker.on('message', onMessage);
      worker.postMessage({ id, type: '__test-tensor-count' });
    });
    const baseline = await tensorCount();
    for (let i = 0; i < 3; i++) await service.predict({ image });
    assert.equal(await tensorCount(), baseline, 'prediction tensors should be disposed after each inference');
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('real worker extracts configurable feature batches and preserves validation labels for a singleton tail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ctm-worker-batches-'));
  const classes = [];
  for (let classIndex = 0; classIndex < 2; classIndex++) {
    const examples = [];
    for (let index = 0; index < (classIndex ? 8 : 9); index++) {
      const path = join(directory, `${classIndex}-${index}.png`);
      await sharp({ create: { width: 16, height: 16, channels: 3, background: classIndex ? { r: 235, g: 25, b: 25 } : { r: 25, g: 25, b: 235 } } }).png().toFile(path);
      examples.push(path);
    }
    classes.push({ name: `class-${classIndex}`, color: '#123456', emoji: 'x', sound: '', examples });
  }
  const worker = new Worker(new URL('../../server/training-worker.js', import.meta.url), { type: 'module', env: { ...process.env, FEATURE_BATCH_SIZE: '16' }, workerData: { testTensorStats: true } });
  const service = createMlService({ workerFactory: () => worker });
  try {
    const progress = [];
    const stagingDirectory = join(directory, 'staging');
    const manifest = await service.train({ classes, modelDirectory: join(directory, 'published'), stagingDirectory }, value => progress.push(value));
    const featureProgress = progress.filter(value => value.phase === 'features');
    assert.deepEqual(featureProgress.map(value => value.progress), [94, 100]);
    assert.deepEqual(featureProgress.map(value => value.message), ['Извлечение признаков 16/17', 'Извлечение признаков 17/17']);
    assert.deepEqual(manifest.validation.actual.slice().sort(), [0, 1]);
    assert.deepEqual(manifest.counts, [1, 1]);
    await service.close();
    const nextWorker = new Worker(new URL('../../server/training-worker.js', import.meta.url), { type: 'module', env: { ...process.env, FEATURE_BATCH_SIZE: '4' }, workerData: { testTensorStats: true } });
    const nextService = createMlService({ workerFactory: () => nextWorker });
    try {
      const tensorCount = () => new Promise((resolve, reject) => {
        const id = `tensor-count-${Math.random()}`;
        const onMessage = message => { if (message.id === id) { nextWorker.off('message', onMessage); message.type === 'result' ? resolve(message.result) : reject(new Error(message.error)); } };
        nextWorker.on('message', onMessage);
        nextWorker.postMessage({ id, type: '__test-tensor-count' });
      });
      const trainPayload = { classes, modelDirectory: join(directory, 'published'), stagingDirectory: join(directory, 'staging-four') };
      const batchProgress = [];
      await nextService.train(trainPayload, value => batchProgress.push(value));
      assert.deepEqual(batchProgress.filter(value => value.phase === 'features').map(value => value.progress), [24, 47, 71, 94, 100]);
      const baseline = await tensorCount();
      await nextService.train({ ...trainPayload, stagingDirectory: join(directory, 'staging-four-again') });
      assert.equal(await tensorCount(), baseline, 'repeated training should dispose all temporary feature tensors');
      const invalidClasses = structuredClone(classes);
      invalidClasses[1].examples[4] = join(directory, 'missing-image.png');
      await assert.rejects(nextService.train({ ...trainPayload, classes: invalidClasses, stagingDirectory: join(directory, 'staging-invalid') }), /ENOENT/);
      assert.equal(await tensorCount(), baseline, 'failed image extraction should dispose completed feature tensors');
    } finally {
      await nextService.close();
    }
  } finally {
    if (worker.threadId !== -1) await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('real worker rejects invalid feature batch size before reading examples', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ctm-worker-batch-config-'));
  const worker = new Worker(new URL('../../server/training-worker.js', import.meta.url), { type: 'module', env: { ...process.env, FEATURE_BATCH_SIZE: '17' } });
  const service = createMlService({ workerFactory: () => worker });
  try {
    await assert.rejects(service.train({ classes: [{ examples: ['/missing/a'] }, { examples: ['/missing/b'] }] }), /FEATURE_BATCH_SIZE must be an integer from 1 to 16/);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
