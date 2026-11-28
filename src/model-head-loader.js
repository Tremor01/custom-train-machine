export async function loadServerHead({ modelId, fetch: fetchResource, tf }) {
  const base = `/api/models/${modelId}`;
  const response = await fetchResource(`${base}/model.json`);
  if (!response.ok) throw Error('Не удалось загрузить модель с сервера.');
  const json = await response.json();
  const groups = await Promise.all(json.weightsManifest.map(async group => {
    const buffers = await Promise.all(group.paths.map(async path => {
      const shard = await fetchResource(path);
      if (!shard.ok) throw Error('Не удалось загрузить веса модели.');
      return new Uint8Array(await shard.arrayBuffer());
    }));
    return { specs: group.weights, buffers };
  }));
  const specs = groups.flatMap(group => group.specs);
  const parts = groups.flatMap(group => group.buffers);
  const weightData = new Uint8Array(parts.reduce((size, buffer) => size + buffer.length, 0));
  let offset = 0;
  for (const part of parts) { weightData.set(part, offset); offset += part.length; }
  return tf.loadLayersModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: specs, weightData: weightData.buffer }));
}
