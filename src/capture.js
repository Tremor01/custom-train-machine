export function createCaptureController({ schedule, cancel, frame, onChange = () => {}, limit = 200 }) {
  let selected = null;
  let timer = null;
  let currentLimit = limit;
  function stop() {
    if (timer !== null) cancel(timer);
    timer = null;
    selected = null;
    onChange();
  }
  function start(item) {
    if (timer !== null) stop();
    selected = item;
    timer = schedule(() => {
      if (!selected) return;
      const image = frame();
      if (image) selected.examples.push(image);
      if (selected.examples.length >= currentLimit) stop();
      else onChange();
    });
    onChange();
  }
  function setLimit(value) {
    if (!Number.isInteger(value) || value < 1) throw new Error('Лимит примеров должен быть положительным целым числом.');
    currentLimit = value;
    if (selected && selected.examples.length >= currentLimit) stop();
  }
  return { start, stop, current: () => selected, setLimit };
}
