import json
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if '--software-webgl' in sys.argv else []
    browser = p.chromium.launch(headless='--headed' not in sys.argv, executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', args=args)
    page = browser.new_page()
    page.goto('http://127.0.0.1:5188/', wait_until='domcontentloaded')
    page.locator('#train').wait_for()
    print('GRAPHICS', json.dumps(page.evaluate('''() => {
      const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return null; const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION)};
    }''')), flush=True)
    for backend in ['webgl', 'cpu']:
        result = page.evaluate('''async backend => {
          try {
            const tf = await import('/node_modules/.vite/deps/@tensorflow_tfjs.js');
            const {loadExtractor} = await import('/src/model-loader.js');
            if (!await tf.setBackend(backend)) return {backend, error:'unavailable'};
            await tf.ready();
            const t0 = performance.now(); const model = await loadExtractor('/models/mobilenet/model.json', () => {});
            const load = performance.now() - t0;
            const image = document.createElement('canvas'); image.width = image.height = 224;
            const ctx = image.getContext('2d'); ctx.fillStyle = '#ca3'; ctx.fillRect(0, 0, 224, 224);
            const times = [];
            for (let i = 0; i < 4; i++) {
              const t = performance.now(); const embedding = tf.tidy(() => model.infer(image, true));
              await embedding.data(); embedding.dispose(); times.push(performance.now() - t);
              await new Promise(r => setTimeout(r, 0));
            }
            model.model.dispose();
            return {backend:tf.getBackend(), load_ms:load, inference_ms:times};
          } catch(e) {return {backend, error:String(e)}}
        }''', backend)
        print('BENCHMARK', json.dumps(result), flush=True)
    browser.close()
