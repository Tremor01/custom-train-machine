import * as browserTf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { normalizeImage } from './image-input.js';
import { splitExamples } from '../src/logic.js';

let extractorPromise;
let tfPromise;
let tfNodeAvailable = false;
let active = null;
let queued = Promise.resolve();

async function getExtractor() {
  await getTensorFlow();
  if (!extractorPromise) extractorPromise = mobilenet.load({ version: 2, alpha: 1, inputRange: [0, 1], modelUrl: {
    async load() {
      const modelPath = join(process.cwd(), 'public', 'models', 'mobilenet', 'model.json');
      const json = JSON.parse(await readFile(modelPath, 'utf8'));
      const baseDirectory = join(process.cwd(), 'public', 'models', 'mobilenet');
      const buffers = await Promise.all(json.weightsManifest.flatMap(group => group.paths.map(file => readFile(join(baseDirectory, file)))));
      const weightData = Buffer.concat(buffers);
      return { modelTopology: json.modelTopology, weightSpecs: json.weightsManifest.flatMap(group => group.weights), weightData: Uint8Array.from(weightData).buffer, format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy };
    },
  } });
  return extractorPromise;
}

async function getTensorFlow() {
  if (!tfPromise) tfPromise = (async () => {
    try { const module = await import('@tensorflow/tfjs-node'); tfNodeAvailable = true; return module; }
    catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND' && !error.message.includes('tfjs_binding.node')) throw error;
    }
    await browserTf.setBackend('cpu');
    await browserTf.ready();
    return browserTf;
  })();
  return tfPromise;
}

function send(id, type, payload) { parentPort.postMessage({ id, type, [type === 'progress' ? 'progress' : 'result']: payload }); }

async function tensorFromImage(buffer) {
  const image = await normalizeImage(buffer);
  const tf = await getTensorFlow();
  const pixels = Float32Array.from(image.values, value => value * 255);
  return tf.tensor4d(pixels, [1, image.height, image.width, 3]);
}

async function train(payload, id) {
  const tf = await getTensorFlow();
  const base = await getExtractor();
  const classes = payload.classes;
  const split = splitExamples(classes);
  const training = [], validation = [], labels = [], validationLabels = [];
  const all = [...split.training.map(x => ({ ...x, validation: false })), ...split.validation.map(x => ({ ...x, validation: true }))];
  let xs, ys, validationXs, validationYs, model, optimizer;
  try {
  for (let i = 0; i < all.length; i++) {
    const sample = all[i];
    const buffer = await readFile(sample.example);
    const input = await tensorFromImage(buffer);
    try {
      const embedding = tf.tidy(() => base.infer(input, true).squeeze());
      (sample.validation ? validation : training).push(embedding);
      (sample.validation ? validationLabels : labels).push(sample.classIndex);
    } finally { input.dispose(); }
    send(id, 'progress', { phase: 'features', progress: Math.round((i + 1) * 100 / all.length), message: `Извлечение признаков ${i + 1}/${all.length}` });
  }
  if (!training.length) { validation.forEach(tensor => tensor.dispose()); throw new Error('Not enough examples to train; each class needs at least two images.'); }
  xs = tf.stack(training);
  const labelTensor = tf.tensor1d(labels, 'int32');
  try { ys = tf.oneHot(labelTensor, classes.length); } finally { labelTensor.dispose(); }
  validationXs = validation.length ? tf.stack(validation) : null;
  if (validation.length) {
    const validationLabelTensor = tf.tensor1d(validationLabels, 'int32');
    try { validationYs = tf.oneHot(validationLabelTensor, classes.length); } finally { validationLabelTensor.dispose(); }
  }
  model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [1280], units: 64, activation: 'relu' }));
  model.add(tf.layers.dense({ units: classes.length, activation: 'softmax' }));
  optimizer = tf.train.adam(0.001);
  model.compile({ optimizer, loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  try {
    const metrics = [];
    await model.fit(xs, ys, { epochs: 25, batchSize: Math.min(16, labels.length), shuffle: true, ...(validationXs ? { validationData: [validationXs, validationYs] } : {}), callbacks: { onEpochEnd: async (epoch, values) => { const item = { epoch: epoch + 1, loss: values.loss, accuracy: values.acc ?? values.accuracy, valLoss: values.val_loss, valAccuracy: values.val_acc ?? values.val_accuracy }; metrics.push(item); send(id, 'progress', { phase: 'training', progress: Math.round((epoch + 1) * 100 / 25), metrics, message: `Обучение: эпоха ${epoch + 1}/25` }); } } });
    let validationResult = null;
    if (validationXs) {
      const validationOutput = model.predict(validationXs);
      const predictedTensor = validationOutput.argMax(1);
      try {
        validationResult = { actual: validationLabels, predicted: Array.from(await predictedTensor.data()) };
      } finally {
        predictedTensor.dispose();
        validationOutput.dispose();
      }
    }
    return { model, classes, metrics, counts: classes.map((_, i) => validationLabels.filter(label => label === i).length), validation: validationResult };
  } catch (error) { model.dispose(); throw error; }
  } finally {
    xs?.dispose(); ys?.dispose(); validationXs?.dispose(); validationYs?.dispose();
    training.forEach(t => t.dispose()); validation.forEach(t => t.dispose());
    optimizer?.dispose();
  }
}

async function predict(payload) {
  const tf = await getTensorFlow();
  if (!active) throw new Error('No trained model is active.');
  const base = await getExtractor();
  const input = await tensorFromImage(payload.image);
  let output;
  try {
    const result = tf.tidy(() => active.model.predict(base.infer(input, true)));
    try { output = await result.data(); }
    finally { result.dispose(); }
  } finally { input.dispose(); }
  return { classes: active.classes, probabilities: Array.from(output) };
}

async function run(message) {
  const tf = await getTensorFlow();
  if (message.type === 'train') {
    const next = await train(message.payload, message.id);
    const destination = message.payload.modelDirectory;
    const staging = message.payload.stagingDirectory;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      const saveHandler = tfNodeAvailable ? pathToFileURL(staging).href : tf.io.withSaveHandler(async artifacts => {
        const rawWeights = artifacts.weightData;
        const weight = Buffer.from(rawWeights instanceof ArrayBuffer ? new Uint8Array(rawWeights) : rawWeights);
        await writeFile(join(staging, 'model.json'), JSON.stringify({ modelTopology: artifacts.modelTopology, format: artifacts.format, generatedBy: artifacts.generatedBy, convertedBy: artifacts.convertedBy, weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }] }));
        await writeFile(join(staging, 'weights.bin'), weight);
        return { modelArtifactsInfo: tf.io.getModelArtifactsInfoForJSON(artifacts) };
      });
      await next.model.save(saveHandler);
      const manifest = { classes: next.classes.map(({ name, color, emoji, sound }) => ({ name, color, emoji, sound })), extractor: { name: 'mobilenet-v2', alpha: 1, inputRange: [0, 1] }, input: { width: 224, height: 224, channels: 3 }, embeddingSize: 1280, metrics: next.metrics, counts: next.counts, validation: next.validation, artifactFormat: tfNodeAvailable ? 'file' : 'memory' };
      await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest));
      next.model.dispose();
      return manifest;
    } catch (error) { next.model.dispose(); await rm(staging, { recursive: true, force: true }); throw error; }
  }
  if (message.type === 'predict') return predict(message.payload);
  if (message.type === 'activate-model') {
    let next;
    const data = JSON.parse(await readFile(message.payload.modelPath, 'utf8'));
    const weightFile = data.weightsManifest?.[0]?.paths?.[0];
    const weightPath = join(message.payload.modelDirectory, weightFile || 'weights.bin');
    const weightData = await readFile(weightPath);
    next = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: data.modelTopology, weightSpecs: data.weightsManifest[0].weights, weightData: Uint8Array.from(weightData).buffer }));
    active?.model.dispose();
    active = { model: next, classes: message.payload.classes };
    return { loaded: true };
  }
  if (message.type === 'discard-model') {
    active?.model.dispose();
    active = null;
    return { discarded: true };
  }
  throw new Error('Unknown ML operation.');
}

parentPort.on('message', message => {
  if (workerData?.testTensorStats === true && message.type === '__test-tensor-count') {
    getTensorFlow().then(tf => parentPort.postMessage({ id: message.id, type: 'result', result: tf.memory().numTensors })).catch(error => parentPort.postMessage({ id: message.id, type: 'error', error: error.message }));
    return;
  }
  queued = queued.then(() => run(message)).then(result => send(message.id, 'result', result)).catch(error => parentPort.postMessage({ id: message.id, type: 'error', error: error.message }));
});
