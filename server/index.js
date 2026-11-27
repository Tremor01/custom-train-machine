import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { resolve, join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMlService } from './ml-service.js';
import { createJobStore } from './job-store.js';
import { createModelStore } from './model-store.js';
import { registerRoutes } from './routes.js';
import { staticContentType } from './static-content.js';

const directory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const dataDirectory = resolve(process.env.DATA_DIR || join(directory, '..', 'data'));
await mkdir(join(dataDirectory, 'models'), { recursive: true });
await mkdir(join(dataDirectory, 'jobs'), { recursive: true });
const app = Fastify({ bodyLimit: 70 * 1024 * 1024, logger: true });
await app.register(multipart, { limits: { files: 4000, fileSize: 6 * 1024 * 1024, fields: 8 } });
const ml = createMlService();
const jobs = createJobStore();
const models = createModelStore(join(dataDirectory, 'models'));
await registerRoutes(app, { ml, jobs, models, dataDirectory });

const activeId = await models.activeId();
app.addHook('onReady', async () => {
  if (activeId) {
    const manifest = await models.readManifest(activeId);
    if (manifest) {
      try { await ml.activateModel({ modelPath: join(dataDirectory, 'models', activeId, 'model.json'), modelDirectory: join(dataDirectory, 'models', activeId), classes: manifest.classes }); }
      catch (error) { app.log.error({ error }, 'Could not restore active model'); }
    }
  }
  const manifestFiles = await models.listArtifacts(activeId).catch(() => []);
  if (activeId && !manifestFiles.includes('model.json')) app.log.warn('Active model metadata is missing or corrupt');
});

if (process.env.NODE_ENV === 'production') {
  const dist = join(directory, '..', 'dist');
  app.get('/*', async (request, reply) => {
  const relative = decodeURIComponent(request.url.split('?')[0]).replace(/^\/+/, '');
  const asset = resolve(dist, relative || 'index.html');
    if (!asset.startsWith(`${dist}/`) && asset !== join(dist, 'index.html')) return reply.code(404).send();
    try { return reply.type(staticContentType(asset)).send(await readFile(asset)); }
    catch {
      if (relative.includes('.')) return reply.code(404).send();
      return reply.type('text/html; charset=utf-8').send(await readFile(join(dist, 'index.html')));
    }
  });
}

app.addHook('onClose', async () => ml.close());
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
await app.listen({ host, port });
