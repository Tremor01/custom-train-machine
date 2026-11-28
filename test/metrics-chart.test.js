import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTrainingMetrics } from '../src/metrics-chart.js';

function svg() {
  const children = [];
  return { children, append(node) { children.push(node); }, replaceChildren(...nodes) { children.splice(0, children.length, ...nodes); } };
}

test('renders training and validation metric series as chart paths and updates labels', () => {
  const accuracy = svg(), loss = svg();
  const labels = { accuracy: {}, loss: {} };

  renderTrainingMetrics([
    { epoch: 1, accuracy: 0.6, valAccuracy: 0.5, loss: 0.8, valLoss: 0.9 },
    { epoch: 2, accuracy: 0.9, valAccuracy: 0.75, loss: 0.3, valLoss: 0.4 },
  ], { accuracy, loss, labels, createElement: name => ({ name, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }) });

  assert.equal(accuracy.children.length, 2);
  assert.deepEqual(accuracy.children.map(path => path.attributes.class), ['training-line', 'validation-line']);
  assert.deepEqual(accuracy.children.map(path => path.attributes.stroke), ['#725bd1', '#e98b52']);
  assert.equal(accuracy.children[0].attributes.d, 'M 12,46.4 L 288,20.6');
  assert.doesNotMatch(accuracy.children[0].attributes.d, /NaN/);
  assert.equal(labels.accuracy.textContent, '90%');
  assert.equal(labels.loss.textContent, '0.30');
  assert.equal(loss.children.length, 2);
});

test('centers a single epoch point on each chart', () => {
  const accuracy = svg(), loss = svg();
  renderTrainingMetrics([{ epoch: 1, accuracy: 0.5, loss: 0.25 }], { accuracy, loss, labels: { accuracy: {}, loss: {} }, createElement: () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }) });
  assert.equal(accuracy.children[0].attributes.d, 'M 150,55');
  assert.equal(loss.children[0].attributes.d, 'M 150,76.5');
});

test('renders training-only metrics and clears charts for empty or invalid data', () => {
  const accuracy = svg(), loss = svg();
  const labels = { accuracy: {}, loss: {} };
  const options = { accuracy, loss, labels, createElement: () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }) };

  renderTrainingMetrics([{ epoch: 1, accuracy: 0.7, loss: 0.5 }], options);
  assert.equal(accuracy.children.length, 1);
  assert.equal(loss.children.length, 1);
  renderTrainingMetrics([], options);
  assert.deepEqual(accuracy.children, []);
  assert.deepEqual(loss.children, []);
  assert.equal(labels.accuracy.textContent, '—');
  assert.equal(labels.loss.textContent, '—');
});
