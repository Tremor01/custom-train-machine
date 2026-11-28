import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerRoutes } from '../../server/routes.js';
import { createJobStore } from '../../server/job-store.js';
import { createModelStore } from '../../server/model-store.js';
import sharp from 'sharp';
import { mkdir, rename, writeFile } from 'node:fs/promises';

test('serves API without token authentication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctm-api-'));
  const app = Fastify();
  const ml = { train: async () => ({ classes: [], metrics: [] }), predict: async () => ({ classes: [], probabilities: [] }) };
  await registerRoutes(app, { ml, jobs: createJobStore(), models: createModelStore(join(root, 'models')), dataDirectory: root });
  try {
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    assert.equal((await app.inject('/api/train/unknown')).statusCode, 404);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('accepts multipart training and returns a pollable job without auth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctm-train-api-'));
  const app = Fastify({ bodyLimit: 70 * 1024 * 1024 });
  await app.register(multipart, { limits: { files: 4000, fileSize: 6 * 1024 * 1024, fields: 8 } });
  const jobs = createJobStore();
  let received;
   const ml = { train: async (payload, progress) => { received = payload; progress({ phase: 'features', progress: 100, message: 'Feature pass done' }); await mkdir(payload.stagingDirectory, { recursive: true }); await writeFile(join(payload.stagingDirectory, 'model.json'), '{}'); await writeFile(join(payload.stagingDirectory, 'weights.bin'), 'weights'); await writeFile(join(payload.stagingDirectory, 'manifest.json'), JSON.stringify({ classes: payload.classes, embeddingSize: 1280 })); await rename(payload.stagingDirectory, join(root, 'models', `.staging-${payload.modelId}`)); return { classes: payload.classes, metrics: [{ epoch: 1 }], validation: { actual: [0, 1], predicted: [0, 1] }, counts: [0, 0], embeddingSize: 1280 }; }, predict: async () => ({ classes: [], probabilities: [] }), activateModel: async () => ({ loaded: true }) };
  await registerRoutes(app, { ml, jobs, models: createModelStore(join(root, 'models')), dataDirectory: root });
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#cc8844' } }).png().toBuffer();
  try {
    const boundary = 'test-multipart-boundary';
    const field = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const file = (name, filename, bytes) => Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`), bytes, Buffer.from('\r\n')]);
    const payload = Buffer.concat([Buffer.from(field('classes', JSON.stringify([{ name: 'A', color: '#7158dc', emoji: 'A', sound: 'none' }, { name: 'B', color: '#ed8b52', emoji: 'B', sound: 'none' }]))), Buffer.from(field('exampleCounts', '[1,1]')), file('image_0_0', 'a.png', image), file('image_1_0', 'b.png', image), Buffer.from(`--${boundary}--\r\n`)]);
    const response = await app.inject({ method: 'POST', url: '/api/train', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(response.statusCode, 202, response.body);
    const { jobId } = response.json();
    let result;
    for (let attempt = 0; attempt < 50; attempt++) {
      result = (await app.inject({ url: `/api/train/${jobId}` })).json();
      if (result.status === 'completed' || result.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(result.status, 'completed', result.error);
    assert.deepEqual(result.validation, { actual: [0, 1], predicted: [0, 1] });
    assert.equal(received.classes.length, 2);
    assert.equal(received.classes[0].examples.length, 1);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('rejects non-multipart training without leaving an active job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctm-train-type-'));
  const app = Fastify();
  await app.register(multipart);
  const jobs = createJobStore();
  const models = createModelStore(join(root, 'models'));
  await registerRoutes(app, { ml: {}, jobs, models, dataDirectory: root });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/train', payload: { classes: [] } });
    assert.equal(response.statusCode, 415);
    assert.equal(jobs.active(), null);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('marks job failed when background cleanup rejects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctm-cleanup-'));
  const app = Fastify();
  await app.register(multipart);
  const jobs = createJobStore();
  const models = { reserveId: async () => '11111111-1111-4111-8111-111111111111', publishExisting: async () => {}, activeId: async () => null, deactivate: async () => {}, discard: async () => {}, removeVersion: async () => { throw new Error('cleanup failed'); } };
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#cc8844' } }).png().toBuffer();
  const ml = { train: async ({ modelId, stagingDirectory }) => { await mkdir(stagingDirectory, { recursive: true }); await writeFile(join(stagingDirectory, 'model.json'), '{}'); await writeFile(join(stagingDirectory, 'weights.bin'), 'weights'); await writeFile(join(stagingDirectory, 'manifest.json'), JSON.stringify({ embeddingSize: 1280, classes: [] })); return { modelId, classes: [], metrics: [] }; } };
  await registerRoutes(app, { ml, jobs, models, dataDirectory: root });
  try {
    const boundary = 'cleanup-boundary';
    const field = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const file = name => Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), image, Buffer.from('\r\n')]);
    const payload = Buffer.concat([Buffer.from(field('classes', JSON.stringify([{ name: 'A' }, { name: 'B' }]))), Buffer.from(field('exampleCounts', '[1,1]')), file('image_0_0'), file('image_1_0'), Buffer.from(`--${boundary}--\r\n`)]);
    const response = await app.inject({ method: 'POST', url: '/api/train', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(response.statusCode, 202);
    const { jobId } = response.json();
    let job;
    for (let attempt = 0; attempt < 100; attempt++) {
      job = jobs.get(jobId);
      if (job.status === 'completed' || job.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'failed');
    assert.equal(jobs.active(), null);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

test('publishes trained model artifacts and preserves previous active model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctm-rollback-'));
  const models = createModelStore(join(root, 'models'));
  const previous = await models.publish({ embeddingSize: 1280, classes: [{ name: 'old' }] }, async directory => {
    await writeFile(join(directory, 'model.json'), '{}');
    await writeFile(join(directory, 'weights.bin'), 'old');
  });
  const next = await models.reserveId();
  const stage = join(root, 'models', `.staging-${next}`);
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, 'model.json'), '{}');
  await writeFile(join(stage, 'weights.bin'), 'new');
  await writeFile(join(stage, 'manifest.json'), JSON.stringify({ embeddingSize: 1280, classes: [{ name: 'new' }] }));
  try {
    await models.publishExisting(next, { metrics: [] });
    await models.activate(next);
    await models.activate(previous);
    assert.equal(await models.activeId(), previous);
    assert.ok(models.artifactPath(next, 'model.json'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime activation failure restores the prior active model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctm-activation-rollback-'));
  const models = createModelStore(join(root, 'models'));
  const previous = await models.publish({ classes: [{ name: 'old' }] }, async directory => {
    await writeFile(join(directory, 'model.json'), '{}');
    await writeFile(join(directory, 'weights.bin'), 'old');
  });
  const next = await models.publish({ classes: [{ name: 'new' }] }, async directory => {
    await writeFile(join(directory, 'model.json'), '{}');
    await writeFile(join(directory, 'weights.bin'), 'new');
  });
  await models.activate(previous);
  const jobs = createJobStore();
  const app = Fastify();
  await app.register(multipart);
  const ml = {
    train: async ({ modelId, stagingDirectory }) => {
      await mkdir(stagingDirectory, { recursive: true });
      await writeFile(join(stagingDirectory, 'model.json'), '{}');
      await writeFile(join(stagingDirectory, 'weights.bin'), 'trained');
      await writeFile(join(stagingDirectory, 'manifest.json'), JSON.stringify({ embeddingSize: 1280, classes: [] }));
      return { modelId, classes: [], metrics: [] };
    },
    activateModel: async () => { throw new Error('runtime activation failed'); },
  };
  await registerRoutes(app, { ml, jobs, models, dataDirectory: root });
  try {
    const boundary = 'activation-boundary';
    const field = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const file = name => Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), awaitImage, Buffer.from('\r\n')]);
    const awaitImage = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#cc8844' } }).png().toBuffer();
    const payload = Buffer.concat([Buffer.from(field('classes', JSON.stringify([{ name: 'A' }, { name: 'B' }]))), Buffer.from(field('exampleCounts', '[1,1]')), file('image_0_0'), file('image_1_0'), Buffer.from(`--${boundary}--\r\n`)]);
    const response = await app.inject({ method: 'POST', url: '/api/train', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(response.statusCode, 202);
    for (let attempt = 0; attempt < 100 && jobs.get(response.json().jobId).status !== 'failed'; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await models.activeId(), previous);
    assert.equal(jobs.get(response.json().jobId).status, 'failed');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
