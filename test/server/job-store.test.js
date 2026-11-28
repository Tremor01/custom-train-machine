import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from '../../server/job-store.js';

test('allows one active job and records progress through completion', () => {
  const jobs = createJobStore();
  const job = jobs.create();
  assert.equal(job.status, 'queued');
  assert.throws(() => jobs.create(), { code: 'JOB_ACTIVE' });
  jobs.update(job.id, { status: 'running', phase: 'features', progress: 30 });
  jobs.update(job.id, { status: 'completed', modelId: 'model-1' });
  assert.equal(jobs.get(job.id).modelId, 'model-1');
  assert.equal(jobs.get(job.id).progress, 100);
});

test('keeps failed job status and rejects unknown IDs', () => {
  const jobs = createJobStore();
  const job = jobs.create();
  jobs.update(job.id, { status: 'failed', error: 'broken' });
  assert.equal(jobs.get(job.id).error, 'broken');
  assert.equal(jobs.get('missing'), null);
});
