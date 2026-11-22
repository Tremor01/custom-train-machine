import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';

const base = 'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/';
const dir = fileURLToPath(new URL('../public/models/mobilenet/', import.meta.url));
async function download(name) {
  if (basename(name) !== name) throw new Error(`Недопустимое имя файла: ${name}`);
  const response = await fetch(new URL(name, base));
  if (!response.ok) throw new Error(`Ошибка загрузки ${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(join(dir, name), bytes);
  console.log(`${name}: ${bytes.length} байт`);
  return bytes;
}
await mkdir(dir, { recursive: true });
const manifest = JSON.parse(await download('model.json'));
for (const group of manifest.weightsManifest) for (const name of group.paths) await download(name);
