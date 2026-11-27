import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const isId = value => /^[0-9a-f-]{36}$/i.test(value);

export function createModelStore(root) {
  const activeFile = join(root, 'active.json');
  return {
    async reserveId() { return randomUUID(); },
    async publish(manifest, writeArtifacts, id = randomUUID()) {
      await mkdir(root, { recursive: true });
      const staging = join(root, `.staging-${id}`);
      const destination = join(root, id);
      await mkdir(staging, { recursive: false });
      try {
        await writeArtifacts(staging);
        await writeFile(join(staging, 'manifest.json'), JSON.stringify({ ...manifest, id, format: 'custom-train-machine-server-v1' }));
        await rename(staging, destination);
        const temporaryActive = join(root, `.active-${id}.tmp`);
        await writeFile(temporaryActive, JSON.stringify({ id }));
        await rename(temporaryActive, activeFile);
        return id;
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    },
    async activeId() {
      try { const { id } = JSON.parse(await readFile(activeFile, 'utf8')); return isId(id) ? id : null; }
      catch { return null; }
    },
    async readManifest(id) {
      if (!isId(id)) return null;
      try { return JSON.parse(await readFile(join(root, id, 'manifest.json'), 'utf8')); }
      catch { return null; }
    },
    artifactPath(id, file) {
      if (!isId(id) || !/^(?:model\.json|manifest\.json|weights\.bin|group\d+-shard\d+of\d+\.bin)$/.test(file)) return null;
      return join(root, id, file);
    },
    async publishExisting(id, manifest) {
      if (!isId(id)) throw new Error('Invalid model ID.');
      const trainingStage = join(root, `.staging-${id}`);
      const directory = join(root, id);
      const stageFiles = await readdir(trainingStage);
      const written = JSON.parse(await readFile(join(trainingStage, 'manifest.json'), 'utf8'));
      if (!written || written.embeddingSize !== 1280 || !Array.isArray(written.classes) || !stageFiles.includes('model.json') || !stageFiles.some(file => file.endsWith('.bin'))) throw new Error('Model artifacts are incomplete.');
      const nextManifest = { ...written, ...manifest, id, format: 'custom-train-machine-server-v1' };
      await writeFile(join(trainingStage, 'manifest.json'), JSON.stringify(nextManifest));
      await rename(trainingStage, directory);
      return id;
    },
    async removeVersion(id) { if (isId(id) && id !== await this.activeId()) await rm(join(root, id), { recursive: true, force: true }); },
    async activate(id) {
      if (!isId(id)) throw new Error('Model is incomplete.');
      const manifest = await this.readManifest(id);
      const artifacts = await this.listArtifacts(id);
      if (!manifest || !artifacts.includes('model.json') || !artifacts.some(file => file.endsWith('.bin'))) throw new Error('Model is incomplete.');
      const temporaryActive = join(root, `.active-${id}.tmp`);
      await writeFile(temporaryActive, JSON.stringify({ id }));
      try { await rename(temporaryActive, activeFile); }
      catch (error) {
        await rm(temporaryActive, { force: true });
        throw error;
      }
    },
    async deactivate() { await rm(activeFile, { force: true }); },
    async discard(id) { if (isId(id) && id !== await this.activeId()) await rm(join(root, id), { recursive: true, force: true }); },
    async loadActiveManifest() { const id = await this.activeId(); return id ? this.readManifest(id) : null; },
    async listArtifacts(id) {
      if (!isId(id)) return [];
      try { return (await readdir(join(root, id))).filter(file => this.artifactPath(id, file)); }
      catch { return []; }
    },
  };
}
