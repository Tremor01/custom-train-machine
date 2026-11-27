import os from 'node:os';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const scriptPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(scriptPath));

export function parseArgs(args) {
  const result = { samples: 16, batches: [1, 4, 8, 16], timeoutMs: 60000, help: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help' || key === '-h') { result.help = true; continue; }
    if (!['--samples', '--batches', '--timeout-ms'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option or missing value: ${key}`);
    const value = args[++i];
    if (key === '--samples') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 64) throw new Error('--samples must be an integer from 1 to 64');
      result.samples = Number(value);
    } else if (key === '--timeout-ms') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 600000) throw new Error('--timeout-ms must be an integer from 1 to 600000');
      result.timeoutMs = Number(value);
    } else {
      if (!/^\d+(,\d+)*$/.test(value)) throw new Error('--batches must be comma-separated integers from 1 to 16');
      result.batches = value.split(',').map(Number);
      if (result.batches.some(n => n < 1 || n > 16) || new Set(result.batches).size !== result.batches.length) throw new Error('--batches must contain unique integers from 1 to 16');
    }
  }
  return result;
}

export function runChild(command, args, { timeoutMs = 60000, cwd = root, onMessage } = {}) {
  return new Promise(resolve => {
    const started = performance.now();
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = '', timedOut = false, message;
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-16384); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16384); });
    child.on('message', value => { message = value; onMessage?.(value); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); resolve({ error: error.message, stdout, stderr, durationMs: performance.now() - started, timedOut }); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, durationMs: performance.now() - started, timedOut, message });
    });
  });
}

async function hostReport() {
  const cpus = os.cpus();
  const report = { platform: os.platform(), architecture: os.arch(), node: process.version, cpuCount: cpus.length, availableParallelism: os.availableParallelism(), constrainedMemoryBytes: process.constrainedMemory?.(), cpuModel: cpus[0]?.model, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem() };
  if (os.platform() === 'linux') {
    for (const [key, path] of [['memoryMax', '/sys/fs/cgroup/memory.max'], ['cpuMax', '/sys/fs/cgroup/cpu.max']]) {
      try { report[key] = { value: (await readFile(path, 'utf8')).trim() }; }
      catch (error) { report[key] = { unavailable: true, errorCode: error.code || 'UNKNOWN' }; }
    }
  }
  return report;
}

const helpText = 'Usage: node scripts/diagnose-ml.js [--samples 1..64] [--batches 1,4,8,16] [--timeout-ms 1..600000]\n';

async function main(args) {
  let options;
  try { options = parseArgs(args); } catch (error) { process.stderr.write(`${error.message}\n${helpText}`); process.exitCode = 2; return; }
  if (options.help) { process.stdout.write(helpText); return; }
  process.stderr.write('Do not run alongside live training: this diagnostic uses CPU and memory.\n');
  const report = { host: await hostReport(), benchmark: { samplesPerBatch: options.samples, timeoutMsPerProcess: options.timeoutMs, results: [] }, notes: ['Synthetic compute only: excludes network, disk upload, classifier training, and caching; cache opportunity is not measured.', 'Peak RSS is each subprocess lifetime high-water mark, including model loading and warmup. A single measured pass is not a statistical performance guarantee.'] };
  for (const batchSize of options.batches) {
    process.stderr.write(`Benchmarking batch size ${batchSize}...\n`);
    const result = await runChild(process.execPath, [scriptPath, '--child', String(batchSize), String(options.samples)], { timeoutMs: options.timeoutMs, onMessage: message => { if (message.type === 'backend') report.backend = message.backend; } });
    if (!result.timedOut && result.exitCode === 0 && result.message?.type === 'result') report.benchmark.results.push(result.message.result);
    else report.benchmark.results.push({ batchSize, status: result.timedOut ? 'timeout' : 'failed', error: result.timedOut ? `Child exceeded ${options.timeoutMs} ms timeout` : result.message?.error || result.error || `child exited ${result.exitCode}`, stderr: result.stderr.slice(-16384), backend: result.message?.backend || result.backend || report.backend, durationMs: result.durationMs });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.benchmark.results.some(item => item.status === 'ok')) process.exitCode = 1;
}

async function childMain(batchSize, samples) {
  let tf, backend = { selectedImport: null, actualBackend: null, nativeError: null }, base;
  try {
    try { tf = await import('@tensorflow/tfjs-node'); backend.selectedImport = 'tfjs-node'; }
    catch (error) {
      backend.nativeError = error.message;
      if (error.code !== 'MODULE_NOT_FOUND' && !error.message.includes('tfjs_binding.node')) throw error;
      tf = await import('@tensorflow/tfjs');
      await tf.setBackend('cpu'); backend.selectedImport = '@tensorflow/tfjs';
    }
    await tf.ready(); backend.actualBackend = tf.getBackend();
    process.send?.({ type: 'backend', backend });
    const mobilenet = await import('@tensorflow-models/mobilenet');
    const { readFile: read, } = await import('node:fs/promises');
    const { normalizeImage } = await import('../server/image-input.js');
    base = await mobilenet.load({ version: 2, alpha: 1, inputRange: [0, 1], modelUrl: { async load() {
      const dir = join(root, 'public', 'models', 'mobilenet');
      const json = JSON.parse(await read(join(dir, 'model.json'), 'utf8'));
      const buffers = await Promise.all(json.weightsManifest.flatMap(group => group.paths.map(file => read(join(dir, file)))));
      return { modelTopology: json.modelTopology, weightSpecs: json.weightsManifest.flatMap(group => group.weights), weightData: Uint8Array.from(Buffer.concat(buffers)).buffer, format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy };
    } } });
    const sharp = (await import('sharp')).default;
    let preprocessMs = 0, inferenceMs = 0;
    const originalCount = tf.memory().numTensors;
    let sampleCountBefore = originalCount, sampleCountAfterCleanup = null, preprocessMemoryBefore, inferenceMemoryAfter;
    try {
      const images = await Promise.all(Array.from({ length: samples }, (_, i) => sharp({ create: { width: 48, height: 48, channels: 3, background: { r: (i * 67 + 17) % 256, g: (i * 113 + 31) % 256, b: (i * 193 + 53) % 256 } } }).jpeg().toBuffer()));
      const warmCount = Math.min(batchSize, samples);
      const warmImages = await Promise.all(images.slice(0, warmCount).map(normalizeImage));
      const warmPixels = new Float32Array(warmCount * 224 * 224 * 3);
      warmImages.forEach((image, i) => { for (let j = 0; j < image.values.length; j++) warmPixels[i * image.values.length + j] = image.values[j] * 255; });
      const warmTensor = tf.tensor4d(warmPixels, [warmCount, 224, 224, 3]);
      try { const warmOutput = base.infer(warmTensor, true); try { await warmOutput.data(); } finally { warmOutput.dispose(); } }
      finally { warmTensor.dispose(); }
      sampleCountBefore = tf.memory().numTensors;
      preprocessMemoryBefore = process.memoryUsage();
      for (let start = 0; start < samples; start += batchSize) {
        const chunk = images.slice(start, start + batchSize);
        let t = performance.now();
        const decoded = await Promise.all(chunk.map(normalizeImage));
        const pixels = new Float32Array(chunk.length * 224 * 224 * 3);
        decoded.forEach((image, i) => { for (let j = 0; j < image.values.length; j++) pixels[i * image.values.length + j] = image.values[j] * 255; });
        const input = tf.tensor4d(pixels, [chunk.length, 224, 224, 3]);
        preprocessMs += performance.now() - t;
        try {
          t = performance.now();
          const output = base.infer(input, true);
          try { await output.data(); } finally { output.dispose(); }
          inferenceMs += performance.now() - t;
        } finally { input.dispose(); }
      }
      sampleCountAfterCleanup = tf.memory().numTensors;
      inferenceMemoryAfter = process.memoryUsage();
      process.send?.({ type: 'result', result: { status: 'ok', batchSize, samples, preprocessMs, inferenceMs, totalMs: preprocessMs + inferenceMs, imagesPerSecond: samples * 1000 / (preprocessMs + inferenceMs), subprocessPeakRssBytes: process.resourceUsage().maxRSS * 1024, tensorCountBefore: sampleCountBefore, tensorCountAfterCleanup: sampleCountAfterCleanup, memoryUsageBefore: preprocessMemoryBefore, memoryUsageAfter: inferenceMemoryAfter } });
    } finally { if (base) { base.model?.dispose(); base = null; } }
  } catch (error) { process.send?.({ type: 'error', error: error.stack || error.message, backend }); process.exitCode = 1; }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === '--child') {
    if (process.argv.length !== 5 || !/^\d+$/.test(process.argv[3]) || !/^\d+$/.test(process.argv[4]) || Number(process.argv[3]) < 1 || Number(process.argv[3]) > 16 || Number(process.argv[4]) < 1 || Number(process.argv[4]) > 64) {
      process.stderr.write('--child expects batch 1..16 and samples 1..64\n'); process.exitCode = 2;
    } else childMain(Number(process.argv[3]), Number(process.argv[4]));
  } else main(process.argv.slice(2)).catch(error => { process.stderr.write(`Diagnostic failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
}
