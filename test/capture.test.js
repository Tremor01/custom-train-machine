import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureController } from '../src/capture.js';

test('collects frames only for the selected class and stops at the limit', () => {
  let tick; let stopped = 0;
  const a = { examples: [] }, b = { examples: [] };
  const capture = createCaptureController({ schedule: fn => { tick = fn; return 1; }, cancel: () => stopped++, frame: () => 'frame', limit: 2 });
  capture.start(a);
  tick(); tick();
  assert.equal(a.examples.length, 2);
  assert.equal(b.examples.length, 0);
  assert.equal(capture.current(), null);
  assert.equal(stopped, 1);
});

test('switching classes cancels the previous capture', () => {
  let tick; let cancelled = 0;
  const a = { examples: [] }, b = { examples: [] };
  const capture = createCaptureController({ schedule: fn => { tick = fn; return 1; }, cancel: () => cancelled++, frame: () => 'frame' });
  capture.start(a); capture.start(b); tick();
  assert.equal(cancelled, 1);
  assert.equal(a.examples.length, 0);
  assert.equal(b.examples.length, 1);
});

test('updates the camera capture limit without resetting collected examples', () => {
  let tick, cancelled = 0;
  const item = { examples: [] };
  const capture = createCaptureController({ schedule: fn => { tick = fn; return 1; }, cancel: () => cancelled++, frame: () => 'frame' });
  capture.start(item);
  capture.setLimit(2);
  tick(); tick();
  assert.equal(item.examples.length, 2);
  assert.equal(capture.current(), null);
  assert.equal(cancelled, 1);
});
