import * as tf from '@tensorflow/tfjs';
import { loadExtractor } from './model-loader.js';
import { selectClass, validateClasses, gameRolesValid, gameOutcome, createGameLifecycle, createCameraStarter, createRestartableLoop, createTabState, splitExamples, buildConfusionMatrix, validateProjectData, stopCameraStream, gamePreviewMove } from './logic.js';
import { createCaptureController } from './capture.js';
import './style.css';

document.querySelector('#app').innerHTML = `
<header><div class="brand"><span class="logo">◉</span><div><strong>Мастерская распознавания</strong><small>Своя модель. Свои правила.</small></div></div><span class="local">● &nbsp;Локальная мастерская</span></header>
<main><section class="intro"><div><p class="kicker">Интерактивное машинное обучение</p><h1>Научите камеру<br>видеть по-вашему.</h1><p>Добавьте примеры, обучите модель и настройте реакцию для каждого класса.</p></div><div class="intro-mark">✳</div></section>
<nav class="app-tabs" role="tablist" aria-label="Разделы приложения"><button id="tab-training" class="app-tab active" role="tab" aria-selected="true" aria-controls="panel-training">Обучение и проверка</button><button id="tab-game" class="app-tab" role="tab" aria-selected="false" aria-controls="panel-game">Камень · ножницы · бумага</button></nav>
<div id="panel-training" class="tab-panel" role="tabpanel" aria-labelledby="tab-training"><div class="workspace"><section class="left"><div class="section-heading"><div><span class="step">1</span><h2>Примеры классов</h2></div><button id="add" class="secondary">+ Добавить класс</button></div><p class="hint">Добавьте хотя бы по одному изображению в два класса. Больше разнообразных примеров повышает качество.</p><div id="classes"></div><div class="training"><div><span class="step">2</span><h2>Обучение модели</h2><p class="hint">Обучение происходит в вашем браузере.</p></div><button id="train" class="primary">Обучить модель</button></div><div id="download-status" hidden><p class="hint">Загрузка базовой модели MobileNet…</p><progress aria-label="Загрузка базовой модели"></progress></div><progress id="progress" max="100" value="0" aria-label="Прогресс обучения"></progress><p id="status" class="status" aria-live="polite">Добавьте примеры, чтобы начать.</p><section id="charts" hidden><h3>Ход обучения</h3><p class="hint">Примерно 20% примеров каждого класса отложены для проверки. На графиках отдельно показано обучение и проверка.</p><div class="chart-legend"><span class="training-line">Обучение</span><span class="validation-line">Проверка</span></div><div class="chart-grid"><div><strong>Точность <span id="accuracy-value">—</span></strong><svg id="accuracy-chart" viewBox="0 0 300 110" role="img" aria-label="График точности"></svg></div><div><strong>Ошибка <span id="loss-value">—</span></strong><svg id="loss-chart" viewBox="0 0 300 110" role="img" aria-label="График ошибки"></svg></div></div></section><section id="confusion-section" hidden><h3>Матрица ошибок</h3><p id="confusion-note" class="hint"></p><div class="table-scroll"><table id="confusion-matrix" aria-label="Матрица ошибок"></table></div></section></section>
<aside><div class="section-heading"><div><span class="step">3</span><h2>Проверка</h2></div><span class="live">КАМЕРА</span></div><div class="camera" id="camera-stage"><video id="video" autoplay playsinline muted></video><div id="camera-placeholder">◉<span>Включите камеру,<br>чтобы начать</span></div><div id="fullscreen-result" class="fullscreen-result" aria-live="polite"><span>✳</span><strong>Ожидание модели</strong></div><button id="fullscreen" class="fullscreen-button" aria-label="Увеличить камеру">⛶</button><button id="expanded-toggle" class="secondary expanded-toggle">Остановить распознавание</button></div><button id="camera" class="secondary full">Включить камеру</button><button id="prediction-toggle" class="secondary full">Остановить распознавание</button><p id="fps" class="hint">Скорость распознавания: —</p><div id="result" class="result"><span id="emoji">✳</span><div><small>Результат распознавания</small><strong id="result-name">Ожидание модели</strong></div></div><div id="predictions"></div><label class="threshold">Порог уверенности <output id="threshold-value">75%</output><input id="threshold" type="range" min="30" max="99" value="75"></label><div class="files"><h3>Проект и модель</h3><p class="hint">Файл включает классы, настройки и изображения; обученная модель сохраняется вместе с ними.</p><div class="file-actions"><button id="save" class="secondary" disabled>↓ Сохранить проект</button><label class="secondary upload">↑ Загрузить проект<input id="load" type="file" accept=".json,application/json" hidden></label></div></div></aside></div></div>
<section id="panel-game" class="game-panel tab-panel" role="tabpanel" aria-labelledby="tab-game" hidden><div class="game-title"><div><p class="kicker">Раундовая игра на вашей модели</p><h2>Камень · ножницы · бумага</h2></div><p class="hint">Назначьте классы жестам и сыграйте против компьютера.</p></div><div class="game-layout"><div class="game-camera-column"><div class="camera" id="camera-stage-game"><video id="game-video" autoplay playsinline muted></video><div id="game-camera-placeholder">◉<span>Включите камеру,<br>чтобы начать</span></div><div id="game-live-result" class="fullscreen-result" aria-live="polite"><span>✳</span><strong>Ожидание модели</strong></div></div><div class="game-camera-controls"><button id="camera-game" class="secondary">Включить камеру</button><button id="prediction-toggle-game" class="secondary">Остановить распознавание</button><button id="fullscreen-game" class="secondary" aria-label="Полноэкранный режим камеры">⛶ На весь экран</button><span id="game-fps" class="hint">Скорость распознавания: —</span></div></div><section class="game-board"><div class="section-heading"><h2>Настройка раунда</h2><span class="live">ИГРА</span></div><div class="game-roles"><label>Камень<select id="role-rock"></select></label><label>Ножницы<select id="role-scissors"></select></label><label>Бумага<select id="role-paper"></select></label></div><div class="game-round"><span id="player-move">✊</span><span class="versus">VS</span><span id="computer-move">?</span></div><p id="game-status" class="status" aria-live="polite">Назначьте классы и обучите модель.</p><button id="game-start" class="primary full" disabled>Начать раунд</button><div id="confetti" class="confetti" aria-hidden="true"></div><p class="hint">После обратного отсчёта покажите жест. При низкой уверенности распознавание продолжится автоматически.</p></section></div></section></main>`

const $ = selector => document.querySelector(selector);
$('#player-move').textContent = '?';
$('#classes').insertAdjacentHTML('beforebegin', '<label class="example-limit">Максимум примеров на класс<input id="example-limit" type="number" min="1" step="1" value="200"></label>');
$('#game-status').insertAdjacentHTML('beforebegin', '<p id="game-threshold-hint" class="hint"></p>');
$('#download-status').innerHTML = '<p id="model-stage" class="hint" aria-live="polite"></p><progress id="model-progress" max="100" value="0" aria-label="Чтение файлов базовой модели"></progress>';
const gameLifecycle = createGameLifecycle();
const tabState = createTabState();
const predictionLoop = createRestartableLoop();
const gameVideo = $('#game-video');
const state = { classes: [], model: null, extractor: null, stream: null, active: -1, running: false, busy: false, predictionEnabled: true, game: null, validation: null, exampleLimit: 200 };
const colors = ['#7158dc', '#ed8b52', '#2b9d8f', '#dc5d83', '#4389c4'];
const emojiChoices = ['😊', '🌟', '🌿', '🎈', '😀', '😎', '🤩', '😂', '😮', '😢', '😡', '❤️', '⭐', '🌈', '🔥', '🌸', '🍎', '🍋', '🐱', '🐶', '⚽', '🎮', '🚀', '✅', '❌', '✊', '✌️', '✋'];
const gameMoves = ['✊', '✌️', '✋'];
const capture = createCaptureController({ schedule: fn => setInterval(fn, 150), cancel: clearInterval, frame: () => { const video = $('#video'); if (!video.videoWidth) return null; const canvas = document.createElement('canvas'); canvas.width = 224; canvas.height = 224; canvas.getContext('2d').drawImage(video, 0, 0, 224, 224); return canvas.toDataURL('image/jpeg', .8); }, onChange: () => { state.classes.forEach((item, index) => { const card = $('#classes').children[index]; if (!card) return; const button = card.querySelector('.capture'); const active = capture.current() === item; button.textContent = active ? '■ Остановить сбор' : '◉ Собирать с камеры'; button.classList.toggle('capturing', active); card.querySelector('.count').textContent = `${item.examples.length} прим.`; const thumbs = card.querySelector('.thumbs'); thumbs.replaceChildren(...item.examples.slice(-5).map(src => { const image = document.createElement('img'); image.src = src; image.alt = ''; return image; })); }); }, limit: state.exampleLimit });
function setExampleLimit(value) { if (!Number.isInteger(value) || value < 1) return; const collecting = Boolean(capture.current()); state.exampleLimit = value; capture.setLimit(value); if (collecting && !capture.current()) notify(`Сбор остановлен: достигнут новый лимит ${value}.`); }
function updateGameThreshold() { $('#game-threshold-hint').textContent = `Для хода нужна уверенность не ниже ${$('#threshold').value}%. Порог общий с вкладкой «Обучение и проверка».`; }
updateGameThreshold();
function notify(text, error = false) { $('#status').textContent = text; $('#status').classList.toggle('error', error); }
function addClass() {
  state.classes.push({ name: `Класс ${state.classes.length + 1}`, color: colors[state.classes.length % colors.length], emoji: ['😊', '🌟', '🌿', '🎈'][state.classes.length % 4], sound: 'chime', examples: [] });
  invalidate(); renderClasses();
}
function invalidate() { cancelGame('Модель или классы изменились. Проверьте назначения.'); if (state.model) { state.model.dispose(); state.model = null; } state.validation = null; $('#confusion-section').hidden = true; state.active = -1; state.game = null; $('#game-start').disabled = true; $('#save').disabled = !state.classes.length; $('#result-name').textContent = 'Ожидание модели'; $('#predictions').innerHTML = ''; if ($('#role-rock')) renderGameRoles(); }
function renderGameRoles() {
  for (const role of ['rock', 'scissors', 'paper']) {
    const select = $(`#role-${role}`); if (!select) continue;
    const previous = select.value;
    select.replaceChildren(new Option('Выберите класс', ''));
    state.classes.forEach((item, index) => select.add(new Option(item.name, String(index))));
    if (previous && Number(previous) < state.classes.length) select.value = previous;
  }
  updateGameReady();
}
function updateGameReady() {
  if (!$('#game-start')) return;
  const indexes = ['rock', 'scissors', 'paper'].map(role => $(`#role-${role}`).value === '' ? -1 : Number($(`#role-${role}`).value));
  if (!gameLifecycle.running) state.game = gameRolesValid(state.classes, indexes) && state.model ? { roles: indexes, classes: indexes.map(index => state.classes[index]), model: state.model } : null;
  $('#game-start').disabled = !state.game || state.busy || gameLifecycle.running;
  ['rock', 'scissors', 'paper'].forEach(role => { $(`#role-${role}`).disabled = gameLifecycle.running; });
  if (!state.game && !gameLifecycle.running && !$('#game-status').textContent.includes('отмен') && !$('#game-status').textContent.startsWith('Модель или классы изменились') && !$('#game-status').textContent.startsWith('Распознавание остановлено')) $('#game-status').textContent = 'Назначьте три разных класса и обучите модель.';
}
function cancelGame(message = 'Раунд отменён.') { const wasRunning = gameLifecycle.running; gameLifecycle.cancel(); if (wasRunning) $('#game-status').textContent = message; updateGameReady(); }
function handleGamePrediction(index, probabilities) {
  if (gameLifecycle.running && state.game) {
    const previewMove = gamePreviewMove(probabilities, state.game.roles);
    $('#player-move').textContent = previewMove < 0 ? '?' : gameMoves[previewMove];
  }
  if (!gameLifecycle.running || !state.game || !gameLifecycle.awaiting) return;
  const mapping = state.game;
  if (mapping.model !== state.model || mapping.classes.some((item, i) => state.classes[mapping.roles[i]] !== item)) {
    cancelGame('Назначения изменились. Настройте игру заново.'); return;
  }
  const move = gameOutcome(index, mapping.computer, mapping.roles);
  if (move === 'retry') { $('#game-status').textContent = 'Уверенность ниже порога — продолжаю распознавание…'; return; }
  gameLifecycle.resolvePrediction(index);
}
function switchTab(tab) {
  const gameTab = tabState.select(tab) === 'game';
  $('#tab-training').classList.toggle('active', !gameTab); $('#tab-game').classList.toggle('active', gameTab);
  $('#tab-training').setAttribute('aria-selected', String(!gameTab)); $('#tab-game').setAttribute('aria-selected', String(gameTab));
  $('#panel-training').hidden = gameTab; $('#panel-game').hidden = !gameTab;
  if (!gameTab) { cancelGame('Вкладка игры закрыта — раунд отменён.'); $('#camera-stage').classList.remove('expanded'); $('#fullscreen').textContent = '⛶'; if ($('#camera-stage-game').matches(':fullscreen')) document.exitFullscreen().catch(error => notify(`Не удалось закрыть полноэкранный режим: ${error.message}`, true)); }
  $('#game-camera-placeholder').hidden = Boolean(state.stream);
  $('#camera-placeholder').hidden = Boolean(state.stream);
}
async function startGame() {
  if (!state.game || gameLifecycle.running || state.busy) return;
  const originalMapping = state.game, originalModel = state.model;
  if (!state.stream) { try { await startCamera(); } catch (error) { $('#game-status').textContent = error.message; return; } }
  if (state.game !== originalMapping || state.model !== originalModel) return;
  if (!state.predictionEnabled) togglePrediction();
  const mapping = state.game;
  if (!mapping || mapping.model !== state.model) { updateGameReady(); return; }
  const token = gameLifecycle.start(); mapping.computer = Math.floor(Math.random() * 3);
  $('#computer-move').textContent = '?'; $('#player-move').textContent = '?'; $('#game-start').disabled = true; updateGameReady();
  for (let count = 3; count > 0 && gameLifecycle.running && gameLifecycle.isCurrent(token); count--) { $('#game-status').textContent = String(count); await new Promise(resolve => setTimeout(resolve, 700)); }
  if (!gameLifecycle.running || !gameLifecycle.isCurrent(token)) return;
  $('#game-status').textContent = 'Покажите камень, ножницы или бумагу…';
  const prediction = gameLifecycle.awaitPrediction();
  if (!state.predictionEnabled) { state.predictionEnabled = true; $('#prediction-toggle').textContent = 'Остановить распознавание'; $('#expanded-toggle').textContent = 'Остановить распознавание'; }
  predictLoop();
  if (!state.running) predictLoop();
  const predicted = await prediction;
  if (predicted !== undefined && gameLifecycle.isCurrent(token)) finishGamePrediction(predicted, mapping);
}
function finishGamePrediction(index, mapping) {
  gameLifecycle.finish();
  const move = gameOutcome(index, mapping.computer, mapping.roles);
  const labels = { win: 'Победа! 🎉', draw: 'Ничья!', lose: 'Компьютер победил.' };
  $('#game-status').textContent = labels[move];
  $('#player-move').textContent = gameMoves[mapping.roles.indexOf(index)];
  $('#computer-move').textContent = gameMoves[mapping.computer];
  if (move === 'win') { playSound('high'); const confetti = $('#confetti'); confetti.replaceChildren(...Array.from({ length: 26 }, (_, i) => { const piece = document.createElement('i'); piece.style.setProperty('--piece', i); piece.style.setProperty('--color', colors[i % colors.length]); return piece; })); setTimeout(() => confetti.replaceChildren(), 1800); }
  updateGameReady();
}
function renderClasses() {
  const root = $('#classes'); root.innerHTML = '';
  state.classes.forEach((item, index) => {
    const card = document.createElement('div'); card.className = 'class-card';
    card.innerHTML = `<div class="class-top"><span class="class-dot"></span><input class="name" aria-label="Название класса" maxlength="60"><button class="remove icon" title="Удалить класс" aria-label="Удалить класс">×</button></div><div class="examples"><div class="thumbs"></div><span class="count"></span></div><div class="example-actions"><button class="capture secondary">◉ Собирать с камеры</button><label class="secondary upload">+ Изображения<input class="images" type="file" accept="image/*" multiple hidden></label><button class="clear icon" title="Удалить примеры">Очистить</button></div><div class="settings"><label>Цвет<input class="color" type="color"></label><label>Смайл<input class="emoji-input" maxlength="8"></label><label>Звук<select class="sound"><option value="chime">Колокольчик</option><option value="low">Низкий</option><option value="high">Высокий</option><option value="none">Без звука</option></select></label></div>`;
    const picker = document.createElement('details'); picker.className = 'emoji-picker'; picker.innerHTML = '<summary class="emoji-pick" aria-label="Выбрать смайл"></summary><div class="emoji-options" role="group" aria-label="Варианты смайлов"></div>';
    const emojiButton = picker.querySelector('.emoji-pick'), options = picker.querySelector('.emoji-options');
    emojiButton.textContent = item.emoji;
    [...new Set([item.emoji, ...emojiChoices].filter(Boolean))].forEach(emoji => {
      const option = document.createElement('button'); option.type = 'button'; option.className = 'emoji-option'; option.textContent = emoji; option.setAttribute('aria-label', `Выбрать смайл ${emoji}`); option.setAttribute('aria-pressed', String(emoji === item.emoji));
      option.onclick = () => { item.emoji = emoji; emojiButton.textContent = emoji; picker.open = false; options.querySelectorAll('.emoji-option').forEach(button => button.setAttribute('aria-pressed', String(button === option))); };
      options.append(option);
    });
    card.querySelector('.emoji-input').replaceWith(picker);
    const el = s => card.querySelector(s); el('.name').value = item.name; el('.color').value = item.color; el('.sound').value = item.sound; el('.class-dot').style.background = item.color;
    el('.name').oninput = e => { item.name = e.target.value; renderGameRoles(); if (state.validation) renderConfusionMatrix(state.validation); }; el('.color').oninput = e => { item.color = e.target.value; el('.class-dot').style.background = item.color; }; el('.sound').onchange = e => { item.sound = e.target.value; };
    el('.count').textContent = `${item.examples.length} прим.`; item.examples.slice(-5).forEach(src => { const img = document.createElement('img'); img.src = src; img.alt = ''; el('.thumbs').append(img); });
    if (capture.current() === item) { el('.capture').textContent = '■ Остановить сбор'; el('.capture').classList.add('capturing'); }
    el('.remove').onclick = () => { if (capture.current() === item) capture.stop(); state.classes.splice(index, 1); invalidate(); renderClasses(); }; el('.clear').onclick = () => { if (capture.current() === item) capture.stop(); item.examples = []; invalidate(); renderClasses(); };
    el('.capture').onclick = async () => { if (capture.current() === item) { capture.stop(); return; } try { if (item.examples.length >= state.exampleLimit) throw Error(`В классе уже ${state.exampleLimit} примеров. Измените лимит или удалите примеры.`); await startCamera(); if (!state.classes.includes(item)) return; invalidate(); capture.start(item); notify('Идёт автоматический сбор кадров. Меняйте положение объекта и остановите сбор кнопкой.'); } catch (error) { notify(error.message, true); } };
    el('.images').onchange = async e => { for (const file of e.target.files) { if (item.examples.length >= state.exampleLimit) { notify(`Достигнут лимит ${state.exampleLimit} примеров в классе.`, true); break; } try { const data = await readDataURL(file); await loadImage(data); item.examples.push(data); } catch { notify(`Не удалось открыть изображение «${file.name}».`, true); } } invalidate(); renderClasses(); };
    root.append(card);
  });
}
function readDataURL(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
function loadImage(src) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; }); }
const startCameraRequest = createCameraStarter(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }), async stream => { for (const video of [$('#video'), gameVideo]) video.srcObject = stream; await Promise.all([$('#video').play(), gameVideo.play()]); });
async function startCamera() { if (state.stream) return; try { const stream = await startCameraRequest(); state.stream = stream; $('#camera-placeholder').hidden = true; $('#game-camera-placeholder').hidden = true; $('#camera').textContent = 'Выключить камеру'; $('#camera-game').textContent = 'Выключить камеру'; predictLoop(); } catch { if ($('#video').srcObject && !state.stream) { $('#video').srcObject = null; gameVideo.srcObject = null; } throw Error('Не удалось включить камеру. Проверьте разрешение браузера и подключение камеры.'); } }
function stopCamera() {
  if (!state.stream) return;
  capture.stop();
  cancelGame('Камера выключена — раунд отменён.');
  stopCameraStream(state.stream);
  state.stream = null;
  for (const video of [$('#video'), gameVideo]) { video.pause(); video.srcObject = null; }
  $('#camera-placeholder').hidden = false; $('#game-camera-placeholder').hidden = false;
  $('#camera').textContent = 'Включить камеру'; $('#camera-game').textContent = 'Включить камеру';
  state.active = -1;
  const result = state.model ? 'Камера выключена' : 'Ожидание модели';
  ['#result-name', '#fullscreen-result strong', '#game-live-result strong'].forEach(selector => { $(selector).textContent = result; });
  ['#emoji', '#fullscreen-result span', '#game-live-result span'].forEach(selector => { $(selector).textContent = '✳'; });
  ['#result', '#fullscreen-result', '#game-live-result'].forEach(selector => { $(selector).style.setProperty('--effect', '#e7e4f4'); });
  $('#predictions').replaceChildren();
  $('#fps').textContent = 'Камера выключена'; $('#game-fps').textContent = 'Камера выключена';
}
function toggleCamera() { if (state.stream) stopCamera(); else startCamera().catch(error => { notify(error.message, true); $('#game-status').textContent = error.message; }); }
async function extractor() {
  if (!state.extractor) {
    notify('Подготовка базовой модели MobileNet…');
    $('#download-status').hidden = false;
    const start = performance.now();
    let stage = 'reading';
    let percent = 0;
    const update = () => {
      const seconds = Math.floor((performance.now() - start) / 1000);
      $('#model-stage').textContent = stage === 'reading'
        ? `Чтение файлов модели: ${percent}% · прошло ${seconds} с`
        : `Подготовка модели и пробный запуск · прошло ${seconds} с`;
    };
    const timer = setInterval(update, 1000);
    try {
      state.extractor = await loadExtractor('/models/mobilenet/model.json', event => {
        stage = event.stage;
        if (stage === 'reading') {
          percent = Math.round(event.fraction * 100);
          $('#model-progress').value = percent;
        } else {
          $('#model-progress').removeAttribute('value');
          $('#model-progress').setAttribute('aria-label', 'Подготовка и пробный запуск модели');
        }
        update();
      });
      $('#model-stage').textContent = 'Базовая модель готова.';
      $('#model-progress').value = 100;
      notify('Базовая модель готова.');
    } catch (error) {
      $('#download-status').hidden = true;
      throw Error(`Не удалось загрузить локальную модель. Выполните npm run download-model и перезапустите сайт. ${error.message}`);
    } finally { clearInterval(timer); }
  }
  return state.extractor;
}
function drawChart(id, training, validation, max) {
  const line = (values, color) => {
    const points = values.map((value, i) => `${values.length < 2 ? 150 : 10 + i * 280 / (values.length - 1)},${100 - Math.max(0, Math.min(1, value / max)) * 90}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`;
  };
  $(id).innerHTML = `<path d="M10 10V100H290" fill="none" stroke="#dedbea"/>${line(training, '#725bd1')}${line(validation, '#e98b52')}`;
}
function renderConfusionMatrix(result) {
  const section = $('#confusion-section'), note = $('#confusion-note'), table = $('#confusion-matrix');
  state.validation = result;
  if (!result) { section.hidden = true; table.replaceChildren(); return; }
  section.hidden = false;
  table.replaceChildren();
  const total = result.counts.reduce((sum, count) => sum + count, 0);
  if (!total) { note.textContent = 'Для проверки добавьте минимум два примера в каждый класс.'; return; }
  const missing = result.counts.flatMap((count, index) => count ? [] : [state.classes[index].name]);
  note.textContent = `Отложено примеров: ${total}.${missing.length ? ` Не проверены классы: ${missing.join(', ')} — добавьте в них ещё примеры.` : ''}`;
  const head = document.createElement('thead'), header = document.createElement('tr'), corner = document.createElement('th');
  corner.scope = 'col'; corner.textContent = 'Факт ↓ / модель →'; header.append(corner);
  state.classes.forEach(item => { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = item.name; header.append(cell); });
  head.append(header);
  const body = document.createElement('tbody');
  state.classes.forEach((item, actual) => {
    const row = document.createElement('tr'), label = document.createElement('th');
    label.scope = 'row'; label.textContent = item.name; row.append(label);
    result.matrix[actual].forEach(count => { const cell = document.createElement('td'); cell.textContent = String(count); row.append(cell); });
    body.append(row);
  });
  table.append(head, body);
}
async function train() {
  if (!validateClasses(state.classes)) return notify('Добавьте хотя бы по одному изображению в каждый из двух или более классов.', true);
  if (state.busy) return; capture.stop(); state.busy = true; $('#train').disabled = true; $('#add').disabled = true; $('#save').disabled = true; $('#classes').inert = true; $('#progress').value = 0; $('#charts').hidden = false; renderConfusionMatrix(null);
  const accuracy = [], validationAccuracy = [], loss = [], validationLoss = [], tensors = [], validationTensors = [];
  let xs, ys, validationXs, validationYs, next;
  try {
    const base = await extractor(), split = splitExamples(state.classes);
    const labels = [], validationLabels = [];
    const samples = [...split.training.map(item => ({ ...item, validation: false })), ...split.validation.map(item => ({ ...item, validation: true }))];
    const total = samples.length;
    let processed = 0;
    notify(`Обработка примеров: 0 из ${total}`);
    $('#progress').value = 0;
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const sample of samples) {
      const image = await loadImage(sample.example);
      const tensor = tf.tidy(() => base.infer(image, true).squeeze());
      (sample.validation ? validationTensors : tensors).push(tensor);
      (sample.validation ? validationLabels : labels).push(sample.classIndex);
      processed++;
      $('#progress').value = processed * 100 / total;
      notify(`Обработка примеров: ${processed} из ${total}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    $('#progress').value = 0;
    notify('Подготовка к обучению…');
    await new Promise(resolve => setTimeout(resolve, 0));
    xs = tf.stack(tensors); ys = tf.tidy(() => tf.oneHot(tf.tensor1d(labels, 'int32'), state.classes.length));
    if (validationTensors.length) {
      validationXs = tf.stack(validationTensors);
      validationYs = tf.tidy(() => tf.oneHot(tf.tensor1d(validationLabels, 'int32'), state.classes.length));
    }
    next = tf.sequential(); next.add(tf.layers.dense({ inputShape: [xs.shape[1]], units: 64, activation: 'relu' })); next.add(tf.layers.dense({ units: state.classes.length, activation: 'softmax' })); next.compile({ optimizer: tf.train.adam(0.001), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
    const options = { epochs: 25, batchSize: Math.min(16, labels.length), shuffle: true, callbacks: { onEpochEnd: async (epoch, logs) => {
      const acc = logs.acc ?? logs.accuracy ?? 0, valAcc = logs.val_accuracy ?? logs.val_acc;
      const valLoss = logs.val_loss;
      accuracy.push(acc); loss.push(logs.loss);
      if (Number.isFinite(valAcc)) validationAccuracy.push(valAcc);
      if (Number.isFinite(valLoss)) validationLoss.push(valLoss);
      drawChart('#accuracy-chart', accuracy, validationAccuracy, 1);
      drawChart('#loss-chart', loss, validationLoss, Math.max(1, ...loss, ...validationLoss));
      $('#accuracy-value').textContent = `${Math.round(acc * 100)}% / ${Number.isFinite(valAcc) ? `${Math.round(valAcc * 100)}%` : '—'}`;
      $('#loss-value').textContent = `${logs.loss.toFixed(3)} / ${Number.isFinite(valLoss) ? valLoss.toFixed(3) : '—'}`;
      $('#progress').value = (epoch + 1) * 4;
      notify(`Обучение: эпоха ${epoch + 1} из 25 · точность ${Math.round(acc * 100)}%${Number.isFinite(valAcc) ? ` · проверка ${Math.round(valAcc * 100)}%` : ''}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    } } };
    if (validationXs) options.validationData = [validationXs, validationYs];
    await next.fit(xs, ys, options);
    let matrix = null;
    if (validationXs) {
      let predictions, predictedClasses;
      try {
        predictions = next.predict(validationXs);
        predictedClasses = predictions.argMax(-1);
        matrix = buildConfusionMatrix(validationLabels, Array.from(predictedClasses.dataSync()), state.classes.length);
      } finally { predictedClasses?.dispose(); predictions?.dispose(); }
    }
    const counts = state.classes.map((_, classIndex) => validationLabels.filter(label => label === classIndex).length);
    invalidate(); state.model = next; next = null; $('#save').disabled = false; renderGameRoles();
    renderConfusionMatrix({ matrix, counts });
    notify('Модель готова. Включите камеру для проверки.'); predictLoop();
  } catch (error) { notify(`Ошибка обучения: ${error.message}`, true); } finally { next?.dispose(); tensors.forEach(t => t.dispose()); validationTensors.forEach(t => t.dispose()); xs?.dispose(); ys?.dispose(); validationXs?.dispose(); validationYs?.dispose(); state.busy = false; $('#train').disabled = false; $('#add').disabled = false; $('#save').disabled = false; $('#classes').inert = false; }
}
function playSound(kind) { if (kind === 'none') return; try { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.frequency.value = { chime: 660, low: 330, high: 880 }[kind] || 660; gain.gain.setValueAtTime(.12, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .3); osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .3); osc.onended = () => ctx.close(); } catch {} }
async function predictLoop() {
  if (!state.stream || !state.model || !state.predictionEnabled) return; state.running = true;
  return predictionLoop.start(async () => {
    if (!state.stream || !state.model || !state.predictionEnabled) return;
    try { let frames = 0, last = performance.now(); while (state.stream && state.model && state.predictionEnabled) { if (!$('#video').videoWidth) { await new Promise(r => setTimeout(r, 100)); continue; } const model = state.model; const values = tf.tidy(() => model.predict(state.extractor.infer($('#video'), true)).dataSync().slice()); if (state.model !== model) break; const active = selectClass(values, Number($('#threshold').value) / 100); if (active !== state.active) { if (active >= 0) playSound(state.classes[active].sound); state.active = active; } const item = state.classes[active]; $('#emoji').textContent = item?.emoji || '✳'; $('#result-name').textContent = item?.name || 'Нет уверенного результата'; $('#result').style.setProperty('--effect', item?.color || '#e7e4f4'); $('#fullscreen-result span').textContent = item?.emoji || '✳'; $('#fullscreen-result strong').textContent = item?.name || 'Нет уверенного результата'; $('#fullscreen-result').style.setProperty('--effect', item?.color || '#e7e4f4'); $('#game-live-result span').textContent = item?.emoji || '✳'; $('#game-live-result strong').textContent = item?.name || 'Нет уверенного результата'; $('#game-live-result').style.setProperty('--effect', item?.color || '#e7e4f4'); $('#predictions').innerHTML = ''; values.forEach((value, i) => { const row = document.createElement('div'); row.className = 'prediction'; const label = document.createElement('span'); label.textContent = state.classes[i]?.name || `Класс ${i + 1}`; const score = document.createElement('strong'); score.textContent = `${Math.round(value * 100)}%`; row.append(label, score); $('#predictions').append(row); }); handleGamePrediction(active, values); if (gameLifecycle.awaiting && gameOutcome(active, state.game?.computer, state.game?.roles || []) !== 'retry') gameLifecycle.resolvePrediction(active); frames++; const now = performance.now(); if (now - last >= 1000) { const fps = `Скорость распознавания: ${(frames * 1000 / (now - last)).toFixed(1)} кадр/с`; $('#fps').textContent = fps; $('#game-fps').textContent = fps; frames = 0; last = now; } await tf.nextFrame(); } } catch (e) { notify(`Ошибка распознавания: ${e.message}`, true); cancelGame(`Ошибка распознавания: ${e.message}`); }
  }).finally(() => { state.running = predictionLoop.running; });
}
function encode(buffer) { const bytes = new Uint8Array(buffer); let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary); }
function decode(text) { const binary = atob(text); return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer; }
async function save() {
  if (state.busy) return;
  try {
    const saveArtifacts = async artifacts => {
      const data = { format: 'custom-train-machine-v2', classes: state.classes.map(({ name, color, emoji, sound, examples }) => ({ name, color, emoji, sound, examples })), threshold: Number($('#threshold').value), exampleLimit: state.exampleLimit };
      if (artifacts) Object.assign(data, { modelTopology: artifacts.modelTopology, weightSpecs: artifacts.weightSpecs, weightData: encode(artifacts.weightData) });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'custom-train-machine-project.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return artifacts ? { modelArtifactsInfo: tf.io.getModelArtifactsInfoForJSON(artifacts) } : {};
    };
    if (state.model) await state.model.save(tf.io.withSaveHandler(saveArtifacts));
    else await saveArtifacts();
    notify('Проект сохранён вместе с примерами.');
  } catch (error) { notify(`Не удалось сохранить проект: ${error.message}`, true); }
}
async function load(file) {
  let model;
  try {
    const data = JSON.parse(await file.text()), { hasExamples, hasModel, exampleLimit } = validateProjectData(data);
    if (hasModel) {
      await extractor();
      model = await tf.loadLayersModel(tf.io.fromMemory({ modelTopology: data.modelTopology, weightSpecs: data.weightSpecs, weightData: decode(data.weightData) }));
      if (model.outputs[0].shape.at(-1) !== data.classes.length) throw Error('Количество классов не совпадает с моделью.');
    }
    invalidate();
    state.classes = data.classes.map((c, i) => ({ name: String(c.name || `Класс ${i + 1}`), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : colors[i % colors.length], emoji: String(c.emoji || '✳'), sound: ['chime', 'low', 'high', 'none'].includes(c.sound) ? c.sound : 'none', examples: hasExamples ? c.examples : [] }));
    state.model = model; model = null;
    state.exampleLimit = exampleLimit; $('#example-limit').value = String(exampleLimit); capture.setLimit(exampleLimit);
    $('#threshold').value = Math.min(99, Math.max(30, Number(data.threshold) || 75)); $('#threshold-value').textContent = `${$('#threshold').value}%`; updateGameThreshold(); $('#save').disabled = false;
    renderClasses();
    notify(hasModel ? (hasExamples ? 'Проект загружен: модель, настройки и примеры восстановлены.' : 'Модель загружена. Старый файл не содержит примеры для повторного обучения.') : 'Проект загружен. Обучите модель, чтобы начать распознавание.');
    if (hasModel) predictLoop();
  } catch (error) { model?.dispose(); notify(`Не удалось загрузить проект: ${error.message}`, true); }
}
function togglePrediction() { state.predictionEnabled = !state.predictionEnabled; const text = state.predictionEnabled ? 'Остановить распознавание' : 'Включить распознавание'; $('#prediction-toggle').textContent = text; $('#expanded-toggle').textContent = text; $('#prediction-toggle-game').textContent = text; if (state.predictionEnabled) predictLoop(); else { if (gameLifecycle.running) cancelGame('Распознавание остановлено — раунд отменён.'); state.active = -1; $('#fps').textContent = 'Распознавание остановлено'; $('#emoji').textContent = '✳'; $('#result-name').textContent = 'Распознавание остановлено'; $('#result').style.setProperty('--effect', '#e7e4f4'); $('#fullscreen-result span').textContent = '✳'; $('#fullscreen-result strong').textContent = 'Распознавание остановлено'; $('#fullscreen-result').style.setProperty('--effect', '#e7e4f4'); $('#predictions').innerHTML = ''; } }
$('#tab-training').onclick = () => switchTab('training'); $('#tab-game').onclick = () => switchTab('game'); $('#camera-game').onclick = toggleCamera; $('#prediction-toggle-game').onclick = togglePrediction; $('#fullscreen-game').onclick = async () => { try { if (!document.fullscreenElement) await $('#camera-stage-game').requestFullscreen(); else await document.exitFullscreen(); } catch (error) { $('#game-status').textContent = `Не удалось открыть полноэкранный режим: ${error.message}`; } }; document.addEventListener('fullscreenchange', () => { $('#fullscreen-game').textContent = document.fullscreenElement === $('#camera-stage-game') ? '⛶ Выйти из полноэкранного режима' : '⛶ На весь экран'; }); $('#add').onclick = addClass; $('#train').onclick = train; $('#camera').onclick = toggleCamera; $('#prediction-toggle').onclick = togglePrediction; $('#expanded-toggle').onclick = togglePrediction; $('#fullscreen').onclick = () => { $('#camera-stage').classList.toggle('expanded'); $('#fullscreen').textContent = $('#camera-stage').classList.contains('expanded') ? '×' : '⛶'; }; $('#save').onclick = save; $('#load').onchange = e => { if (e.target.files[0] && !state.busy) { capture.stop(); load(e.target.files[0]); } e.target.value = ''; }; $('#threshold').oninput = e => { $('#threshold-value').textContent = `${e.target.value}%`; }; ['rock', 'scissors', 'paper'].forEach(role => $(`#role-${role}`).onchange = () => { if (!gameLifecycle.running) updateGameReady(); }); $('#game-start').onclick = startGame;
$('#threshold').addEventListener('input', updateGameThreshold);
$('#example-limit').addEventListener('change', e => { if (!Number.isInteger(e.target.valueAsNumber) || e.target.valueAsNumber < 1) e.target.value = String(state.exampleLimit); else setExampleLimit(e.target.valueAsNumber); });
addClass(); addClass();
