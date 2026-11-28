export function selectClass(probabilities, threshold) {
  let best = -1;
  probabilities.forEach((value, index) => {
    if (value >= threshold && (best === -1 || value > probabilities[best])) best = index;
  });
  return best;
}

export function validateClasses(classes) {
  return classes.length >= 2 && classes.every(item => item.examples.length > 0);
}

export function splitExamples(classes) {
  const training = [], validation = [];
  classes.forEach((item, classIndex) => {
    const examples = item.examples.slice();
    for (let i = examples.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [examples[i], examples[j]] = [examples[j], examples[i]];
    }
    const holdout = examples.length > 1 ? Math.max(1, Math.floor(examples.length * 0.2)) : 0;
    examples.forEach((example, index) => (index < holdout ? validation : training).push({ example, classIndex }));
  });
  return { training, validation };
}

export function buildConfusionMatrix(actual, predicted, classCount) {
  const matrix = Array.from({ length: classCount }, () => Array(classCount).fill(0));
  actual.forEach((classIndex, index) => { matrix[classIndex][predicted[index]]++; });
  return matrix;
}

export function validateProjectData(data) {
  const invalid = () => { throw new Error('Неверный формат файла проекта.'); };
  if (!data || typeof data !== 'object') invalid();
  const hasExamples = data.format === 'custom-train-machine-v2';
  if (!hasExamples && data.format !== 'custom-train-machine-v1') invalid();
  if (!Array.isArray(data.classes) || data.classes.length < 2 || !data.classes.every(item => item && typeof item === 'object' && !Array.isArray(item))) invalid();
  const exampleLimit = data.exampleLimit === undefined ? 200 : data.exampleLimit;
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1) invalid();
  const anyModelFields = data.modelTopology !== undefined || data.weightSpecs !== undefined || data.weightData !== undefined;
  const hasModel = Boolean(data.modelTopology && Array.isArray(data.weightSpecs) && typeof data.weightData === 'string');
  if ((data.format === 'custom-train-machine-v1' && !hasModel) || (anyModelFields && !hasModel) || (hasExamples && data.classes.some(item => !Array.isArray(item.examples) || item.examples.some(src => typeof src !== 'string' || !src.startsWith('data:image/'))))) invalid();
  return { hasExamples, hasModel, exampleLimit };
}

export function gameRolesValid(classes, roles) {
  return roles.length === 3 && roles.every(index => Number.isInteger(index) && index >= 0 && index < classes.length) && new Set(roles).size === 3;
}

export function gameOutcome(predictedClass, computerMove, roles) {
  const playerMove = roles.indexOf(predictedClass);
  if (playerMove < 0) return 'retry';
  const difference = (computerMove - playerMove + 3) % 3;
  return difference === 0 ? 'draw' : difference === 1 ? 'win' : 'lose';
}

export function gamePreviewMove(probabilities, roles) {
  return roles.indexOf(selectClass(probabilities, 0));
}

export function createGameLifecycle() {
  let token = 0;
  let resolveWaiter = null;
  const game = {
    running: false,
    awaiting: false,
    start() { game.running = true; return ++token; },
    isCurrent(current) { return current === token; },
    awaitPrediction() { game.awaiting = true; return new Promise(resolve => { resolveWaiter = resolve; }); },
    resolvePrediction(value) {
      if (!game.running || !game.awaiting || !resolveWaiter) return false;
      game.awaiting = false;
      const resolve = resolveWaiter; resolveWaiter = null; resolve(value); return true;
    },
    finish() {
      if (!game.running) return false;
      token++; game.running = false; game.awaiting = false;
      if (resolveWaiter) { const resolve = resolveWaiter; resolveWaiter = null; resolve(undefined); }
      return true;
    },
    cancel() {
      token++; game.running = false; game.awaiting = false;
      if (resolveWaiter) { const resolve = resolveWaiter; resolveWaiter = null; resolve(undefined); }
    },
  };
  return game;
}

export function createCameraStarter(getUserMedia, attachVideo, detachVideo = () => {}) {
  let pending = null;
  return function start() {
    if (pending) return pending;
    pending = (async () => {
      const stream = await getUserMedia();
      try { await attachVideo(stream); return stream; }
      catch (error) { detachVideo(stream); stream.getTracks().forEach(track => track.stop()); throw error; }
    })().finally(() => { pending = null; });
    return pending;
  };
}

export function stopCameraStream(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

export function createRestartableLoop() {
  let pending = null;
  let restartRequested = false;
  const loop = {
    get running() { return pending !== null; },
    start(run) {
      if (pending) {
        restartRequested = true;
        return pending;
      }
      const current = (async () => {
        do {
          restartRequested = false;
          await run();
        } while (restartRequested);
      })().finally(() => { pending = null; });
      pending = current;
      return current;
    },
  };
  return loop;
}

export function createTabState(initial = 'training') {
  let active = initial === 'game' ? 'game' : 'training';
  return { current() { return active; }, select(tab) { if (tab !== 'training' && tab !== 'game') throw new Error(`Unknown tab: ${tab}`); active = tab; return active; } };
}
