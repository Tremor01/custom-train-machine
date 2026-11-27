const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderTrainingMetrics(metrics, { accuracy, loss, labels, createElement = name => document.createElementNS(SVG_NS, name) }) {
  accuracy.replaceChildren();
  loss.replaceChildren();
  const valid = Array.isArray(metrics) ? metrics.filter(item => Number.isFinite(item.accuracy) && Number.isFinite(item.loss)) : [];
  if (!valid.length) {
    labels.accuracy.textContent = '—';
    labels.loss.textContent = '—';
    return;
  }
  const draw = (svg, values, max, classes) => {
    classes.forEach(([key, className]) => {
      const points = values[key].map((value, index) => value === null ? null : `${values[key].length === 1 ? 150 : 12 + index * 276 / (values[key].length - 1)},${Number((98 - Math.max(0, Math.min(1, value / max)) * 86).toFixed(2))}`);
      const segments = [];
      let segment = [];
      points.forEach(point => { if (point === null) { if (segment.length) segments.push(segment); segment = []; } else segment.push(point); });
      if (segment.length) segments.push(segment);
      for (const part of segments) {
        const path = createElement('path');
        path.setAttribute('class', className);
        path.setAttribute('stroke', className === 'training-line' ? '#725bd1' : '#e98b52');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('d', part.map((point, index) => `${index ? 'L' : 'M'} ${point}`).join(' '));
        svg.append(path);
      }
    });
  };
  const accuracyValues = { training: valid.map(item => Number.isFinite(item.accuracy) ? item.accuracy : null), validation: valid.map(item => Number.isFinite(item.valAccuracy) ? item.valAccuracy : null) };
  const lossValues = { training: valid.map(item => Number.isFinite(item.loss) ? item.loss : null), validation: valid.map(item => Number.isFinite(item.valLoss) ? item.valLoss : null) };
  draw(accuracy, accuracyValues, 1, [['training', 'training-line'], ['validation', 'validation-line']]);
  const maxLoss = Math.max(1, ...Object.values(lossValues).flatMap(values => values.filter(Number.isFinite)));
  draw(loss, lossValues, maxLoss, [['training', 'training-line'], ['validation', 'validation-line']]);
  const last = valid.at(-1);
  labels.accuracy.textContent = `${Math.round(last.accuracy * 100)}%`;
  labels.loss.textContent = last.loss.toFixed(2);
}
