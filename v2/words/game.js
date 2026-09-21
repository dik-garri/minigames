/* Детские слова — сборка слов из кубиков на скорость.
   Всё считается на устройстве: страница статическая, бэкенда нет.
   Общий старт даёт отсчёт 3-2-1 на каждом телефоне. */

const WORDS = [
  'МЛАДЕНЕЦ', 'ГРУДНИЧОК', 'СОПЛЕОТСОС', 'ПОДГУЗНИК', 'ВАННОЧКА',
  'ПРИСЫПКА', 'БУТЫЛОЧКА', 'ПРИКОРМ', 'СЛЮНЯВЧИК', 'УКАЧИВАНИЕ',
  'ПОГРЕМУШКА', 'ГРЫЗУНОК', 'ПРОРЕЗЫВАТЕЛЬ', 'МОЛОКООТСОС', 'ПОЛЗУНКИ',
  'ПУСТЫШКА', 'БОДИ', 'СЛИПИК', 'ЛЮБОВЬ', 'ГОРШОК'
];

const SAVE_KEY = 'baby-words-v1';
const MAX_HINTS = 5;   // подсказок на всю игру

const $ = (id) => document.getElementById(id);
const el = {
  screens: {
    intro: $('screen-intro'),
    count: $('screen-count'),
    game:  $('screen-game'),
    done:  $('screen-done')
  },
  start: $('btn-start'),
  resumeNote: $('resume-note'),
  resume: $('btn-resume'),
  countNumber: $('count-number'),
  solved: $('hud-solved'),
  fill: $('hud-fill'),
  time: $('hud-time'),
  boardHint: $('board-hint'),
  slots: $('slots'),
  cubes: $('cubes'),
  hint: $('btn-hint'),
  skip: $('btn-skip'),
  flash: $('flash'),
  live: $('live'),
  resultTime: $('result-time'),
  statHints: $('stat-hints'),
  statSkips: $('stat-skips'),
  copy: $('btn-copy'),
  again: $('btn-again'),
  confetti: $('confetti')
};

let state = null;   // сохраняемый прогресс
let round = null;   // текущее слово: кубики и слоты
let ticker = null;
let busy = false;   // блокирует ввод между словами
let wakeLock = null;

/* ——— физика кубиков ———
   Кубики не просто появляются, а сыплются на стол и укладываются кучей.
   Если движение выключено в системе или браузер без rAF — раскладка обычная,
   потоком, и игра работает ровно так же. */

const calmMode = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const PHYSICS = typeof Physics !== 'undefined' &&
  typeof requestAnimationFrame === 'function' &&
  typeof document.createElement('div').getBoundingClientRect === 'function' &&
  !calmMode();

const FLIGHT_MS = 220;        // сколько кубик летит в слот
let world = null;
let raf = null;
let lastFrame = 0;
let debris = [];              // разлетающиеся буквы после верного слова

function fieldSize() {
  const rect = el.cubes.getBoundingClientRect();
  return { w: Math.max(rect.width, 80), h: Math.max(rect.height, 80) };
}

function ensureWorld() {
  const { w, h } = fieldSize();
  if (!world) world = new Physics.World({ width: w, height: h, gravity: 2800 });
  else world.resize(w, h);
  return world;
}

function draw() {
  for (const body of world.bodies) {
    if (!body.node) continue;
    body.node.style.transform =
      `translate(${body.x.toFixed(1)}px, ${body.y.toFixed(1)}px) rotate(${body.angle.toFixed(1)}deg)`;
  }
}

function loop(now) {
  const dt = Math.min((now - lastFrame) / 1000 || 0.016, 0.05);
  lastFrame = now;

  let steps = Math.max(1, Math.round(dt / (1 / 60)));
  while (steps--) world.step(1 / 60);
  draw();

  if (world.settled) { raf = null; return; }
  raf = requestAnimationFrame(loop);
}

function runLoop() {
  if (!PHYSICS || raf) return;
  lastFrame = performance.now();
  raf = requestAnimationFrame(loop);
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
}

/* Кубик встаёт в мир: либо сыплется сверху, либо возвращается из слота */
function spawnBody(node, at) {
  const size = node.offsetWidth || 56;
  const { w } = fieldSize();
  const body = new Physics.Body({
    x: at ? at.x : Math.random() * Math.max(w - size, 1),
    y: at ? at.y : -size - Math.random() * 140,
    w: size,
    h: size,
    vx: at ? (Math.random() - 0.5) * 120 : (Math.random() - 0.5) * 90,
    vy: at ? 40 : 0,
    va: (Math.random() - 0.5) * 220,
    angle: at ? 0 : (Math.random() - 0.5) * 30,
    restitution: 0.34,
    node
  });
  world.add(body);
  runLoop();
  return body;
}

/* Координаты слота в системе координат поля с кубиками */
function slotOffset(slotIndex) {
  const slot = el.slots.children[slotIndex].getBoundingClientRect();
  const field = el.cubes.getBoundingClientRect();
  return { x: slot.left - field.left, y: slot.top - field.top, size: slot.width };
}

/* ——— утилиты ——— */

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const formatTime = (ms) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const buzz = (pattern) => {
  if (navigator.vibrate) navigator.vibrate(pattern);
};

function showScreen(name) {
  Object.entries(el.screens).forEach(([key, node]) => {
    const on = key === name;
    node.classList.toggle('is-on', on);
    node.setAttribute('aria-hidden', String(!on));
  });
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* экран просто погаснет как обычно */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state && !state.done) keepAwake();
});

// поворот экрана: стол меняет размер, куча должна остаться внутри
if (typeof addEventListener === 'function') {
  addEventListener('resize', () => {
    if (!PHYSICS || !world || !round) return;
    ensureWorld();
    world.bodies.forEach((b) => b.wake());
    runLoop();
  });
}

/* ——— сохранение (телефон может уснуть или обновить вкладку) ——— */

const save = () => {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* приватный режим */ }
};

const load = () => {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
};

const clearSave = () => {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ничего */ }
};

/* ——— игра ——— */

function newGame() {
  state = {
    queue: shuffle(WORDS.map((_, i) => i)),
    solved: 0,
    hints: 0,
    skips: 0,
    startedAt: Date.now(),
    done: false
  };
  save();
}

function countdown() {
  showScreen('count');
  const steps = ['3', '2', '1', 'Поехали!'];
  let i = 0;

  const step = () => {
    el.countNumber.textContent = steps[i];
    el.countNumber.classList.toggle('count--go', i === steps.length - 1);
    el.countNumber.style.animation = 'none';
    void el.countNumber.offsetWidth;   // перезапуск анимации
    el.countNumber.style.animation = '';
    buzz(i === steps.length - 1 ? [30, 60, 30] : 25);
    i++;
    if (i < steps.length) {
      setTimeout(step, 750);
    } else {
      setTimeout(() => {
        state.startedAt = Date.now();   // время идёт с первого слова
        save();
        startPlaying();
      }, 700);
    }
  };
  step();
}

function startPlaying() {
  showScreen('game');
  keepAwake();
  dealWord();
  updateHud();
  clearInterval(ticker);
  ticker = setInterval(updateHud, 250);
}

function dealWord() {
  const word = WORDS[state.queue[0]];
  const letters = word.split('');

  // перемешиваем так, чтобы слово не выпало собранным
  let mixed = shuffle(letters);
  const unique = new Set(letters).size > 1;
  let guard = 0;
  while (unique && mixed.join('') === word && guard++ < 20) mixed = shuffle(letters);

  round = {
    word,
    tiles: mixed.map((ch) => ({ ch, used: false })),
    slots: letters.map(() => ({ ch: null, tile: null, locked: false }))
  };

  el.boardHint.textContent = `${word.length} букв`;
  el.boardHint.className = 'board__hint';
  updateHintButton();
  el.skip.disabled = state.queue.length < 2;
  renderSlots();
  renderCubes(true);
  el.live.textContent = `Новое слово, ${word.length} букв`;
}

function renderSlots() {
  el.slots.className = 'slots';
  el.slots.replaceChildren(...round.slots.map((slot, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot';
    b.textContent = slot.ch || '';
    if (slot.ch) b.classList.add('is-filled');
    if (slot.locked) b.classList.add('is-locked');
    b.setAttribute('aria-label', slot.ch ? `Буква ${slot.ch}, убрать` : `Пустое место ${i + 1}`);
    b.addEventListener('click', () => takeBack(i));
    return b;
  }));
}

function renderCubes(fresh) {
  el.cubes.classList.toggle('is-physical', PHYSICS);
  el.cubes.replaceChildren(...round.tiles.map((tile, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cube' + (tile.used ? ' is-used' : '') + (fresh && !PHYSICS ? ' is-new' : '');
    b.style.setProperty('--t', `${(i % 5) * 3 - 6}deg`);
    if (fresh && !PHYSICS) b.style.animationDelay = `${i * 35}ms`;
    b.textContent = tile.ch;
    b.setAttribute('aria-label', `Буква ${tile.ch}`);
    b.addEventListener('click', () => placeTile(i));
    return b;
  }));

  if (!PHYSICS) return;

  // старые тела больше не нужны: слово сменилось
  debris.forEach((node) => node.remove());
  debris = [];
  ensureWorld().clear();
  round.tiles.forEach((tile, i) => {
    const node = el.cubes.children[i];
    if (tile.used) { node.style.transform = ''; return; }
    tile.body = spawnBody(node, null);
  });
  draw();
}

function syncView() {
  round.slots.forEach((slot, i) => {
    const node = el.slots.children[i];
    node.textContent = slot.ch || '';
    node.classList.toggle('is-filled', Boolean(slot.ch));
    node.classList.toggle('is-locked', slot.locked);
  });
  round.tiles.forEach((tile, i) => {
    el.cubes.children[i].classList.toggle('is-used', tile.used);
    // убранный в слот кубик больше не участвует в куче
    if (PHYSICS && tile.used && tile.body) {
      world.remove(tile.body);
      tile.body = null;
    }
  });
}

/* Салют из букв: собранное слово подбрасывает свои буквы над столом */
function burstWord() {
  if (!PHYSICS) return;
  const field = el.cubes.getBoundingClientRect();

  round.slots.forEach((slot, i) => {
    const rect = el.slots.children[i].getBoundingClientRect();
    const node = document.createElement('span');
    node.className = 'cube cube--debris';
    node.textContent = slot.ch;
    node.style.width = node.style.height = `${rect.width}px`;
    node.style.fontSize = `${rect.width * 0.46}px`;
    el.cubes.append(node);
    debris.push(node);

    const spread = (i - (round.slots.length - 1) / 2) * 90;
    world.add(new Physics.Body({
      x: rect.left - field.left,
      y: rect.top - field.top,
      w: rect.width,
      h: rect.width,
      vx: spread + (Math.random() - 0.5) * 120,
      vy: -560 - Math.random() * 260,
      va: (Math.random() - 0.5) * 700,
      restitution: 0.42,
      node
    }));
  });

  runLoop();
}

function placeTile(tileIndex) {
  if (busy) return;
  const tile = round.tiles[tileIndex];
  if (!tile || tile.used) return;

  const slotIndex = round.slots.findIndex((s) => !s.ch);
  if (slotIndex === -1) return;

  round.slots[slotIndex] = { ch: tile.ch, tile: tileIndex, locked: false };
  tile.used = true;

  if (!PHYSICS) {
    syncView();
    checkWord();
    return;
  }

  flyToSlot(tileIndex, slotIndex);
}

/* Кубик вылетает из кучи и садится в слот; буква в слоте проявляется,
   когда кубик долетел, иначе она двоится в полёте. */
function flyToSlot(tileIndex, slotIndex) {
  const tile = round.tiles[tileIndex];
  const node = el.cubes.children[tileIndex];
  const target = slotOffset(slotIndex);
  const size = node.offsetWidth || 56;

  if (tile.body) { world.remove(tile.body); tile.body = null; }

  const slotNode = el.slots.children[slotIndex];
  slotNode.classList.add('is-arriving');
  syncView();

  node.classList.remove('is-used');
  node.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(.3, .7, .3, 1)`;
  node.style.transform =
    `translate(${target.x}px, ${target.y}px) scale(${(target.size / size).toFixed(3)}) rotate(0deg)`;

  setTimeout(() => {
    node.style.transition = '';
    node.classList.add('is-used');
    slotNode.classList.remove('is-arriving');
    syncView();
    checkWord();
  }, FLIGHT_MS);
}

function takeBack(slotIndex) {
  if (busy) return;
  const slot = round.slots[slotIndex];
  if (!slot.ch || slot.locked) return;

  const tileIndex = slot.tile;
  round.tiles[tileIndex].used = false;
  round.slots[slotIndex] = { ch: null, tile: null, locked: false };
  syncView();
  if (PHYSICS) dropBackFromSlot(tileIndex, slotIndex);
}

/* Буква возвращается из слота: кубик появляется на месте слота и падает в кучу */
function dropBackFromSlot(tileIndex, slotIndex) {
  const node = el.cubes.children[tileIndex];
  const at = slotOffset(slotIndex);
  node.classList.remove('is-used');
  node.style.transition = '';
  round.tiles[tileIndex].body = spawnBody(node, at);
  draw();
}

function freeSlot(i) {
  const slot = round.slots[i];
  if (!slot.ch) return;
  const tileIndex = slot.tile;
  round.tiles[tileIndex].used = false;
  round.slots[i] = { ch: null, tile: null, locked: false };
  if (PHYSICS) dropBackFromSlot(tileIndex, i);
}

function hintsLeft() {
  return Math.max(0, MAX_HINTS - state.hints);
}

function updateHintButton() {
  const left = hintsLeft();
  el.hint.textContent = left ? `Подсказка · ${left}` : 'Подсказки кончились';
  el.hint.disabled = left === 0 || (round && round.slots.every((s) => s.locked));
}

function giveHint() {
  if (busy || hintsLeft() === 0) return;

  for (let i = 0; i < round.slots.length; i++) {
    const slot = round.slots[i];
    if (slot.locked) continue;

    // буква уже на месте — закрепим её бесплатно и пойдём дальше
    if (slot.ch === round.word[i]) {
      slot.locked = true;
      continue;
    }

    const need = round.word[i];
    freeSlot(i);

    let tileIndex = round.tiles.findIndex((t) => !t.used && t.ch === need);
    if (tileIndex === -1) {
      // нужная буква занята другим слотом — заберём оттуда
      const donor = round.slots.findIndex((s) => s.ch === need && !s.locked);
      if (donor === -1) break;
      tileIndex = round.slots[donor].tile;
      freeSlot(donor);
    }

    round.tiles[tileIndex].used = true;
    round.slots[i] = { ch: need, tile: tileIndex, locked: true };
    state.hints++;
    buzz(15);
    save();
    break;
  }

  syncView();
  checkWord();
  updateHintButton();
}

function skipWord() {
  if (busy || state.queue.length < 2) return;
  state.queue.push(state.queue.shift());
  state.skips++;
  save();
  dealWord();
}

function checkWord() {
  if (round.slots.some((s) => !s.ch)) return;

  const answer = round.slots.map((s) => s.ch).join('');
  if (answer === round.word) {
    solved();
  } else {
    wrong();
  }
}

function wrong() {
  busy = true;
  buzz([40, 50, 40]);
  el.slots.classList.add('is-wrong');
  el.boardHint.textContent = 'Не то слово';
  el.boardHint.className = 'board__hint is-bad';

  setTimeout(() => {
    el.slots.classList.remove('is-wrong');
    round.slots.forEach((_, i) => { if (!round.slots[i].locked) freeSlot(i); });
    el.boardHint.textContent = `${round.word.length} букв`;
    el.boardHint.className = 'board__hint';
    syncView();
    busy = false;
  }, 550);
}

function solved() {
  busy = true;
  buzz([20, 40, 60]);
  state.solved++;
  state.queue.shift();
  save();

  el.slots.classList.add('is-right');
  el.boardHint.textContent = round.word;
  el.boardHint.className = 'board__hint is-good';
  el.flash.classList.add('is-on');
  burstWord();
  cheer();
  el.live.textContent = `Верно: ${round.word}`;
  setTimeout(() => el.flash.classList.remove('is-on'), 500);
  updateHud();

  setTimeout(() => {
    busy = false;
    if (state.queue.length === 0) finish();
    else dealWord();
  }, 900);
}

function updateHud() {
  el.solved.textContent = state.solved;
  el.fill.style.width = `${(state.solved / WORDS.length) * 100}%`;
  el.time.textContent = formatTime(Date.now() - state.startedAt);
}

const CONFETTI_COLORS = ['#FF5D73', '#17A67A', '#FFD27D', '#B79CFF', '#FFFFFF'];

function dropConfetti({ count, speed, spread }) {
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm) return;

  const pieces = Array.from({ length: count }, (_, i) => {
    const piece = document.createElement('i');
    piece.style.left = `${50 + (Math.random() - 0.5) * spread}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDuration = `${speed + Math.random() * speed * 0.7}s`;
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    piece.style.setProperty('--spin', `${360 + Math.random() * 540}deg`);
    piece.addEventListener('animationend', () => piece.remove());
    return piece;
  });
  el.confetti.append(...pieces);
}

// короткий залп над доской — награда за слово
const cheer = () => dropConfetti({ count: 12, speed: 1.3, spread: 70 });

// щедрый финальный — на весь экран
const celebrate = () => dropConfetti({ count: 26, speed: 2.2, spread: 96 });

function finish() {
  clearInterval(ticker);
  stopLoop();
  state.done = true;
  state.finishedAt = Date.now();
  save();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }

  el.resultTime.textContent = formatTime(state.finishedAt - state.startedAt);
  el.statHints.textContent = state.hints;
  el.statSkips.textContent = state.skips;
  el.copy.textContent = 'Скопировать результат';
  showScreen('done');
  celebrate();
  buzz([30, 60, 30, 60, 90]);
}

/* ——— кнопки ——— */

el.start.addEventListener('click', () => {
  newGame();
  countdown();
});

el.resume.addEventListener('click', () => {
  startPlaying();
});

el.hint.addEventListener('click', giveHint);
el.skip.addEventListener('click', skipWord);

el.copy.addEventListener('click', async () => {
  const time = formatTime(state.finishedAt - state.startedAt);
  const text = `Детские слова: ${WORDS.length} из ${WORDS.length} за ${time}. Подсказок: ${state.hints} из ${MAX_HINTS}.`;
  try {
    await navigator.clipboard.writeText(text);
    el.copy.textContent = 'Скопировано ✓';
  } catch {
    el.copy.textContent = text;
  }
});

el.again.addEventListener('click', () => {
  clearSave();
  state = null;
  el.resumeNote.hidden = true;
  showScreen('intro');
});

/* ——— старт страницы: предложить продолжить неоконченную игру ——— */

const saved = load();
if (saved && !saved.done && saved.queue?.length) {
  state = saved;
  el.resumeNote.hidden = false;
  el.resume.textContent = `Продолжить — собрано ${saved.solved} из ${WORDS.length}`;
}
