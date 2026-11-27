import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateJpegDataUrl } from './image-input.js';

export async function registerRoutes(app, { ml, jobs, models, dataDirectory }) {
  app.get('/api/health', async () => ({ ok: true }));
  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    request.log.error({ error }, 'API request failed');
    reply.code(status).send({ error: status === 500 ? 'Internal server error.' : error.message });
  });
  app.post('/api/train', { bodyLimit: 70 * 1024 * 1024 }, async (request, reply) => {
    let job;
    let inputDirectory;
    try {
      job = jobs.create();
      inputDirectory = join(dataDirectory, 'jobs', job.id);
      await mkdir(inputDirectory, { recursive: true });
      const inputDir = inputDirectory;
      const fields = {};
      const imagePaths = [];
      let totalBytes = 0;
      if (!request.isMultipart()) {
        jobs.update(job.id, { status: 'failed', error: 'Training requires multipart uploads.' });
        return reply.code(415).send({ error: 'Training requires multipart uploads.' });
      }
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (typeof part.value !== 'string' || part.value.length > 256 * 1024) throw new Error('Invalid form field.');
          if (fields[part.fieldname] !== undefined) throw new Error('Duplicate form field.');
          fields[part.fieldname] = part.value;
        } else if (part.type === 'file') {
          if (!/^image_\d+_\d+$/.test(part.fieldname)) throw new Error('Unexpected upload field.');
          const match = /^image_(\d+)_(\d+)$/.exec(part.fieldname);
          const classIndex = Number(match[1]), imageIndex = Number(match[2]);
          if (classIndex > 19 || imageIndex > 199 || imagePaths.some(item => item.classIndex === classIndex && item.imageIndex === imageIndex)) throw new Error('Unexpected or duplicate image index.');
          const imagePath = join(inputDir, `${classIndex}-${imageIndex}.img`);
          const chunks = []; let bytes = 0;
          for await (const chunk of part.file) { bytes += chunk.length; totalBytes += chunk.length; if (bytes > 6 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) throw new Error('Training upload exceeds size limit.'); chunks.push(chunk); }
          if (part.file.truncated) throw new Error('Image exceeds size limit.');
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(part.mimetype)) throw new Error('Unsupported image type.');
          const imageBuffer = Buffer.concat(chunks);
          const { normalizeImage } = await import('./image-input.js');
          await normalizeImage(imageBuffer);
          await writeFile(imagePath, imageBuffer, { flag: 'wx' });
          imagePaths.push({ classIndex, imageIndex, imagePath });
        }
      }
      const classesMeta = JSON.parse(fields.classes || 'null');
      const counts = JSON.parse(fields.exampleCounts || 'null');
      if (!Array.isArray(classesMeta) || classesMeta.length < 2 || classesMeta.length > 20 || !Array.isArray(counts) || counts.length !== classesMeta.length || counts.some(value => !Number.isInteger(value) || value < 1 || value > 200) || imagePaths.length !== counts.reduce((sum, value) => sum + value, 0)) throw new Error('Training uploads do not match class metadata.');
      const classes = classesMeta.map((item, classIndex) => {
        const examples = imagePaths.filter(file => file.classIndex === classIndex).sort((a, b) => a.imageIndex - b.imageIndex).map(file => file.imagePath);
        if (examples.length !== counts[classIndex] || examples.length < 1 || examples.length > 200) throw new Error('Invalid number of images per class.');
        return { name: String(item.name || '').trim().slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#7158dc', emoji: String(item.emoji || '✳').slice(0, 8), sound: ['chime', 'low', 'high', 'none'].includes(item.sound) ? item.sound : 'none', examples };
      });
      if (classes.length < 2 || classes.length > 20 || classes.some(item => !item.name)) throw new Error('Invalid class metadata.');
      const modelId = await models.reserveId();
      const modelDirectory = join(dataDirectory, 'models', modelId);
      const stagingDirectory = join(dataDirectory, 'models', `.staging-${modelId}`);
      const jobId = job.id;
      void ml.train({ modelId, stagingDirectory, modelDirectory, classes }, progress => jobs.update(jobId, { status: 'running', ...progress }))
        .then(async result => {
          await models.publishExisting(modelId, result);
          const previousId = await models.activeId();
          try {
            await models.activate(modelId);
            await ml.activateModel({ modelPath: join(modelDirectory, 'model.json'), modelDirectory, classes: result.classes });
            jobs.update(jobId, { status: 'completed', modelId, metrics: result.metrics, validation: result.validation ?? null });
          } catch (error) {
            try {
              if (previousId) await models.activate(previousId);
              else await models.deactivate();
            } catch (rollbackError) { request.log.error({ error: rollbackError }, 'Failed to restore the active model'); }
            try { await models.discard(modelId); }
            catch (cleanupError) { request.log.error({ error: cleanupError }, 'Failed to discard model version'); }
            throw error;
          }
        })
        .catch(async error => {
          try { await models.removeVersion(modelId); }
          catch (cleanupError) { request.log.error({ error: cleanupError }, 'Failed to clean up model version'); }
          jobs.update(jobId, { status: 'failed', error: error.message });
        })
        .finally(async () => {
          const cleanupResults = await Promise.allSettled([
            rm(inputDir, { recursive: true, force: true }),
            rm(stagingDirectory, { recursive: true, force: true }),
          ]);
          for (const result of cleanupResults) {
            if (result.status === 'rejected') request.log.error({ error: result.reason }, 'Failed to clean up training files');
          }
        });
      inputDirectory = null;
      return reply.code(202).send({ jobId, modelId });
    } catch (error) {
      if (job) jobs.update(job.id, { status: 'failed', error: error.message });
      if (error.code === 'JOB_ACTIVE' || error.code === 'ML_BUSY') return reply.code(409).send({ error: error.message });
      return reply.code(400).send({ error: error.message });
    } finally { if (inputDirectory) await rm(inputDirectory, { recursive: true, force: true }); }
  });

  app.get('/api/train/:jobId', async (request, reply) => {
    const job = jobs.get(request.params.jobId);
    if (!job) return reply.code(404).send({ error: 'Job not found.' });
    return job;
  });

  app.get('/api/models/:modelId/manifest.json', async (request, reply) => {
    const manifest = await models.readManifest(request.params.modelId);
    if (!manifest) return reply.code(404).send({ error: 'Model not found.' });
    reply.header('Cache-Control', 'no-cache');
    return manifest;
  });

  app.get('/api/models/:modelId/model.json', async (request, reply) => {
    const path = models.artifactPath(request.params.modelId, 'model.json');
    if (!path) return reply.code(404).send({ error: 'Model not found.' });
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      for (const group of data.weightsManifest || []) group.paths = group.paths.map(file => `/api/models/${request.params.modelId}/${encodeURIComponent(file)}`);
      reply.header('Cache-Control', 'no-cache');
      return data;
    } catch { return reply.code(404).send({ error: 'Model not found.' }); }
  });

  app.get('/api/models/:modelId/:shard', async (request, reply) => {
    const path = models.artifactPath(request.params.modelId, request.params.shard);
    if (!path || !request.params.shard.endsWith('.bin')) return reply.code(404).send({ error: 'Artifact not found.' });
    try { reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('application/octet-stream'); return await readFile(path); }
    catch { return reply.code(404).send({ error: 'Artifact not found.' }); }
  });



  app.post('/api/predict/:modelId', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    try {
      const modelId = request.params.modelId;
      if (modelId !== await models.activeId()) return reply.code(404).send({ error: 'Model not found.' });
      const image = validateJpegDataUrl(request.body?.image);
      return await ml.predict({ modelId, image });
    } catch (error) { return reply.code(error.code === 'ML_BUSY' ? 409 : 400).send({ error: error.message }); }
  });
}
