import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

export async function loadExtractor(url, onProgress) {
  onProgress({ stage: 'reading', fraction: 0 });
  const http = tf.io.http(url, {
    onProgress: fraction => onProgress({ stage: 'reading', fraction }),
  });
  const handler = {
    async load() {
      const artifacts = await http.load();
      onProgress({ stage: 'preparing' });
      await new Promise(resolve => setTimeout(resolve, 0));
      return artifacts;
    },
  };
  return mobilenet.load({ version: 2, alpha: 1, inputRange: [0, 1], modelUrl: handler });
}
