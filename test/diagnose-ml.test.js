import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runChild } from '../scripts/diagnose-ml.js';

const script = fileURLToPath(new URL('../scripts/diagnose-ml.js', import.meta.url));

test('parses bounded sample and batch arguments with defaults', () => {
  assert.deepEqual(parseArgs([]), { samples: 16, batches: [1, 4, 8, 16], timeoutMs: 60000, help: false });
  assert.deepEqual(parseArgs(['--samples', '3', '--batches', '2,3', '--timeout-ms', '123']), { samples: 3, batches: [2, 3], timeoutMs: 123, help: false });
});

test('rejects malformed and out-of-range options', () => {
  for (const args of [['--samples', '0'], ['--samples', '65'], ['--samples', '1.5'], ['--batches', '1,17'], ['--batches', '1,1'], ['--timeout-ms', '0'], ['--unknown']]) {
    assert.throws(() => parseArgs(args), undefined, args.join(' '));
  }
});

test('--help exits without importing TensorFlow', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
    child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--samples/);
  assert.equal(result.stderr, '');
});

test('importing the script does not launch its CLI', async () => {
  const child = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(new URL('../scripts/diagnose-ml.js', import.meta.url).href)}); console.log('imported')`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
    proc.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
    proc.on('error', reject);
    proc.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(child.code, 0);
  assert.equal(child.stdout.trim(), 'imported');
  assert.equal(child.stderr, '');
});

test('invalid internal child arguments exit before loading ML dependencies', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--child', '0', '999'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
    child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /--child expects batch 1\.\.16 and samples 1\.\.64/);
});

test('runChild retains a real child process timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diagnose-ml-'));
  const childScript = join(directory, 'sleep.mjs');
  try {
    await writeFile(childScript, 'setTimeout(() => {}, 10000);');
    const result = await runChild(process.execPath, [childScript], { timeoutMs: 50 });
    assert.equal(result.timedOut, true);
    assert.ok(result.durationMs >= 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('runChild reports a real child failure and stderr', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diagnose-ml-'));
  const childScript = join(directory, 'fail.mjs');
  try {
    await writeFile(childScript, "console.error('expected failure'); process.exit(7);");
    const result = await runChild(process.execPath, [childScript], { timeoutMs: 1000 });
    assert.equal(result.exitCode, 7);
    assert.match(result.stderr, /expected failure/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
