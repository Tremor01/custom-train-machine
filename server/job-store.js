import { randomUUID } from 'node:crypto';

export function createJobStore() {
  const jobs = new Map();
  let activeId = null;
  return {
    create() {
      if (activeId) throw Object.assign(new Error('Training already running'), { code: 'JOB_ACTIVE' });
      const job = { id: randomUUID(), status: 'queued', phase: 'queued', progress: 0, metrics: null, modelId: null, error: null, createdAt: Date.now() };
      jobs.set(job.id, job);
      activeId = job.id;
      return { ...job };
    },
    update(id, patch) {
      const job = jobs.get(id);
      if (!job) return null;
      Object.assign(job, patch);
      if (job.status === 'completed') { job.progress = 100; activeId = null; }
      if (job.status === 'failed') activeId = null;
      return { ...job };
    },
    get(id) { const job = jobs.get(id); return job ? { ...job } : null; },
    active() { const job = activeId ? jobs.get(activeId) : null; return job ? { ...job } : null; },
  };
}
