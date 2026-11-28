import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { selectClass, validateClasses, gameRolesValid, gameOutcome, createGameLifecycle, createCameraStarter, createTabState, createRestartableLoop, splitExamples, buildConfusionMatrix, validateProjectData, stopCameraStream, gamePreviewMove } from '../src/logic.js';

test('splits examples by class and keeps singleton classes in training', () => {
  const { training, validation } = splitExamples([
    { examples: ['a', 'b', 'c', 'd', 'e'] },
    { examples: ['only'] },
  ]);
  const all = [...training, ...validation];
  assert.deepEqual(all.map(item => item.example).sort(), ['a', 'b', 'c', 'd', 'e', 'only']);
  assert.equal(validation.filter(item => item.classIndex === 0).length, 1);
  assert.equal(training.filter(item => item.classIndex === 0).length, 4);
  assert.equal(validation.some(item => item.classIndex === 1), false);
  assert.equal(training.some(item => item.example === 'only'), true);
});

test('builds a confusion matrix from actual and predicted class indexes', () => {
  assert.deepEqual(buildConfusionMatrix([0, 0, 1], [0, 1, 1], 2), [[1, 1], [0, 1]]);
});

test('validation results generate the confusion counts shown after training', () => {
  const validation = { actual: [0, 0, 1], predicted: [0, 1, 1] };
  assert.deepEqual(buildConfusionMatrix(validation.actual, validation.predicted, 2), [[1, 1], [0, 1]]);
});

test('accepts projects with examples before training and legacy model files', () => {
  assert.deepEqual(validateProjectData({ format: 'custom-train-machine-v2', classes: [{ examples: [] }, { examples: ['data:image/png;base64,AA=='] }] }), { hasExamples: true, hasModel: false, exampleLimit: 200 });
  assert.deepEqual(validateProjectData({ format: 'custom-train-machine-v2', classes: [{ examples: [] }, { examples: [] }], exampleLimit: 350 }), { hasExamples: true, hasModel: false, exampleLimit: 350 });
  assert.deepEqual(validateProjectData({ format: 'custom-train-machine-v1', classes: [{}, {}], modelTopology: {}, weightSpecs: [], weightData: 'AA==' }), { hasExamples: false, hasModel: true, exampleLimit: 200 });
});

test('rejects projects with malformed examples or incomplete model data', () => {
  assert.throws(() => validateProjectData({ format: 'custom-train-machine-v2', classes: [{}, {}] }), /Неверный формат/);
  assert.throws(() => validateProjectData({ format: 'custom-train-machine-v2', classes: [{ examples: [] }, { examples: [] }], weightData: '' }), /Неверный формат/);
  assert.throws(() => validateProjectData({ format: 'custom-train-machine-v2', classes: [{ examples: [] }, { examples: [] }], exampleLimit: 0 }), /Неверный формат/);
});

test('stops every track when the camera is turned off', () => {
  let stopped = 0;
  stopCameraStream({ getTracks: () => [{ stop() { stopped++; } }, { stop() { stopped++; } }] });
  assert.equal(stopped, 2);
});

test('selects the most confident class only above the threshold', () => {
  assert.equal(selectClass([0.3, 0.8], 0.7), 1);
  assert.equal(selectClass([0.3, 0.6], 0.7), -1);
});

test('requires at least two classes with examples', () => {
  assert.equal(validateClasses([{ examples: [1] }]), false);
  assert.equal(validateClasses([{ examples: [1] }, { examples: [] }]), false);
  assert.equal(validateClasses([{ examples: [1] }, { examples: [2] }]), true);
});

test('game roles require three distinct current classes', () => {
  const classes = [{}, {}, {}];
  assert.equal(gameRolesValid(classes, [0, 1, 2]), true);
  assert.equal(gameRolesValid(classes, [0, 0, 2]), false);
  assert.equal(gameRolesValid(classes, [0, 1, null]), false);
  assert.equal(gameRolesValid(classes, [0, 1, 3]), false);
  assert.equal(gameRolesValid(classes.slice(0, 2), [0, 1, 2]), false);
});

test('game maps low-confidence predictions to retry and computes winner', () => {
  const roles = [2, 0, 1];
  assert.equal(gameOutcome(-1, 0, roles), 'retry');
  assert.equal(gameOutcome(2, 1, roles), 'win');
  assert.equal(gameOutcome(0, 1, roles), 'draw');
  assert.equal(gameOutcome(1, 1, roles), 'lose');
  assert.equal(gameOutcome(-1, 0, roles), 'retry');
});

test('game preview shows the top mapped gesture below the round confidence threshold', () => {
  assert.equal(selectClass([0.52, 0.3, 0.18], 0.75), -1);
  assert.equal(gamePreviewMove([0.52, 0.3, 0.18], [1, 2, 0]), 2);
});

test('cancelling a game clears its active and waiting state', () => {
  const game = createGameLifecycle();
  game.start({ roles: [0, 1, 2] });
  game.awaitPrediction();
  game.cancel();
  assert.equal(game.running, false);
  assert.equal(game.awaiting, false);
  assert.equal(game.resolvePrediction(0), false);
});

test('finishing a round clears running state and allows the next round', async () => {
  const game = createGameLifecycle();
  const first = game.start();
  const prediction = game.awaitPrediction();
  assert.equal(game.resolvePrediction(2), true);
  assert.equal(await prediction, 2);
  assert.equal(game.finish(), true);
  assert.equal(game.running, false);
  const second = game.start();
  assert.notEqual(first, second);
  assert.equal(game.isCurrent(first), false);
});

test('camera starter shares pending request and stops stream if setup fails', async () => {
  let resolveMedia; let requests = 0; let stopped = 0;
  const start = createCameraStarter(async () => { requests++; return new Promise(resolve => { resolveMedia = resolve; }); }, async () => {});
  const first = start(); const second = start();
  assert.equal(requests, 1);
  const tracks = [{ stop() { stopped++; } }];
  resolveMedia({ getTracks: () => tracks });
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  assert.equal(stopped, 0);

  const failed = createCameraStarter(async () => ({ getTracks: () => tracks }), async () => { throw Error('play failed'); });
  await assert.rejects(failed(), /play failed/);
  assert.equal(stopped, 1);
});

test('camera starter rolls back attached video elements when playback setup fails', async () => {
  const videos = [{ srcObject: null }, { srcObject: null }];
  let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const start = createCameraStarter(async () => stream, async value => {
    videos.forEach(video => { video.srcObject = value; });
    throw Error('play failed');
  }, value => videos.forEach(video => { if (video.srcObject === value) video.srcObject = null; }));

  await assert.rejects(start(), /play failed/);

  assert.equal(stopped, 1);
  assert.deepEqual(videos.map(video => video.srcObject), [null, null]);
});

test('tab state switches between training and game without discarding the current tab on invalid input', () => {
  const tabs = createTabState();
  assert.equal(tabs.current(), 'training');
  assert.equal(tabs.select('game'), 'game');
  assert.equal(tabs.current(), 'game');
  assert.throws(() => tabs.select('settings'), /Unknown tab/);
  assert.equal(tabs.current(), 'game');
  assert.equal(tabs.select('training'), 'training');
});

test('restartable loop remembers a restart requested while the previous run is finishing', async () => {
  const loop = createRestartableLoop();
  let finishFirst;
  let runs = 0;
  const run = () => {
    runs++;
    if (runs === 1) return new Promise(resolve => { finishFirst = resolve; });
  };

  const first = loop.start(run);
  const repeated = loop.start(run);
  assert.equal(first, repeated);
  loop.start(run);
  finishFirst();
  await first;
  assert.equal(runs, 2);
  assert.equal(loop.running, false);
});

test('main app markup has one tab shell and the shared model preview views', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal((source.match(/document\.querySelector\('#app'\)\.innerHTML/g) || []).length, 1);
  assert.match(source, /#game-live-result span/);
  assert.match(source, /#game-fps/);
  assert.match(source, /#game-live-result strong/);
  assert.match(source, /gameVideo = \$\('#game-video'\)/);
  assert.match(source, /await Promise\.all\(\[\$\('#video'\)\.play\(\), gameVideo\.play\(\)\]\)/);
  assert.match(source, /async function predictLoop\(\)/);
  assert.match(source, /state\.inferenceMode === 'server'/);
});

test('main app defines a confusion matrix renderer for training and validation', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /function renderConfusionMatrix\(validation\)/);
  assert.match(source, /renderConfusionMatrix\(null\)/);
  assert.match(source, /buildConfusionMatrix/);
  assert.match(source, /#confusion-section/);
  assert.match(source, /#confusion-note/);
  assert.match(source, /#confusion-matrix/);
});

test('client model loader uses server-provided shard URL without prefixing it twice', async () => {
  const { loadServerHead } = await import('../src/model-head-loader.js');
  const urls = [];
  const fetch = async url => {
    urls.push(url);
    return url.endsWith('/model.json')
      ? { ok: true, json: async () => ({ modelTopology: {}, weightsManifest: [{ paths: ['/api/models/id/weights.bin'], weights: [] }] }) }
      : { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  await loadServerHead({ modelId: 'id', fetch, tf: { io: { fromMemory: value => value }, loadLayersModel: async value => value } });
  assert.deepEqual(urls, ['/api/models/id/model.json', '/api/models/id/weights.bin']);
});

test('prediction mode changes do not force-clear active loop state', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /state\.running\s*=\s*false;\s*if \(state\.stream\) predictLoop\(\)/);
  const invalidate = source.match(/function invalidate\(\) \{[^\n]+/);
  assert.match(invalidate?.[0] || '', /state\.modelId = null/);
});

test('successful training starts prediction only when camera and recognition are enabled', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const trainSource = source.match(/async function train\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(trainSource, 'train() should be extractable for behavior testing');

  async function runTrain({ stream, predictionEnabled = true, outcome = 'completed' }) {
    let starts = 0;
    const state = { classes: [{ examples: ['data:image/png;base64,AA=='] }, { examples: ['data:image/png;base64,AA=='] }], busy: false, modelId: null, model: null, validation: null, stream, predictionEnabled, running: false };
    const elements = new Map();
    const $ = selector => {
      if (!elements.has(selector)) elements.set(selector, { disabled: false, inert: false, value: 0, hidden: false });
      return elements.get(selector);
    };
    const context = {
      state, $, validateClasses: () => true, capture: { stop() {} }, FormData: class { append() {} },
      atob: () => 'x', Uint8Array, Blob: class {}, setTimeout: callback => { callback(); return 0; },
      fetch: async url => url === '/api/train'
        ? { ok: true, json: async () => ({ jobId: 'job' }) }
        : { ok: true, json: async () => outcome === 'completed' ? { status: 'completed', modelId: 'trained-model' } : { status: 'failed', error: 'training failed' } },
      renderMetrics() {}, renderConfusionMatrix() {}, renderClasses() {}, renderGameRoles() {}, updateGameReady() {},
      notify() {}, predictLoop() { starts++; },
    };
    await vm.runInNewContext(`(${trainSource})()`, context);
    return { starts, state };
  }

  assert.equal((await runTrain({ stream: {} })).starts, 1, 'camera already on should start prediction');
  assert.equal((await runTrain({ stream: null })).starts, 0, 'camera-off training must not open or start camera');
  assert.equal((await runTrain({ stream: {}, predictionEnabled: false })).starts, 0, 'manual stop must remain respected');
  assert.equal((await runTrain({ stream: {}, outcome: 'failed' })).starts, 0, 'failed training must not start prediction');
});
