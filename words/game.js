/* Детские слова — сборка слов из кубиков на скорость.
   Всё считается на устройстве: страница статическая, бэкенда нет.
   Общий старт даёт отсчёт 3-2-1 на каждом телефоне. */

const WORDS = [
  'МЛАДЕНЕЦ', 'ГРУДНИЧОК', 'СОПЛЕОТСОС', 'ПОДГУЗНИК', 'ВАННОЧКА',
  'ПРИСЫПКА', 'БУТЫЛОЧКА', 'ПРИКОРМ', 'СЛЮНЯВЧИК', 'УКАЧИВАНИЕ',
  'ПОГРЕМУШКА', 'ГРЫЗУНОК', 'ПРОРЕЗЫВАТЕЛЬ', 'МОЛОКООТСОС', 'ПОЛЗУНКИ',
  'ПУСТЫШКА', 'БОДИ', 'СЛИПИК', 'ЛЮБОВЬ', 'СЛАДОСТЬ'
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
  again: $('btn-again')
};

let state = null;   // сохраняемый прогресс
let round = null;   // текущее слово: кубики и слоты
let ticker = null;
let busy = false;   // блокирует ввод между словами
let wakeLock = null;

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
  el.cubes.replaceChildren(...round.tiles.map((tile, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cube' + (tile.used ? ' is-used' : '') + (fresh ? ' is-new' : '');
    b.style.setProperty('--t', `${(i % 5) * 3 - 6}deg`);
    if (fresh) b.style.animationDelay = `${i * 35}ms`;
    b.textContent = tile.ch;
    b.setAttribute('aria-label', `Буква ${tile.ch}`);
    b.addEventListener('click', () => placeTile(i));
    return b;
  }));
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
  });
}

function placeTile(tileIndex) {
  if (busy) return;
  const tile = round.tiles[tileIndex];
  if (!tile || tile.used) return;

  const slotIndex = round.slots.findIndex((s) => !s.ch);
  if (slotIndex === -1) return;

  round.slots[slotIndex] = { ch: tile.ch, tile: tileIndex, locked: false };
  tile.used = true;
  syncView();
  checkWord();
}

function takeBack(slotIndex) {
  if (busy) return;
  const slot = round.slots[slotIndex];
  if (!slot.ch || slot.locked) return;

  round.tiles[slot.tile].used = false;
  round.slots[slotIndex] = { ch: null, tile: null, locked: false };
  syncView();
}

function freeSlot(i) {
  const slot = round.slots[i];
  if (!slot.ch) return;
  round.tiles[slot.tile].used = false;
  round.slots[i] = { ch: null, tile: null, locked: false };
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

function finish() {
  clearInterval(ticker);
  state.done = true;
  state.finishedAt = Date.now();
  save();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }

  el.resultTime.textContent = formatTime(state.finishedAt - state.startedAt);
  el.statHints.textContent = state.hints;
  el.statSkips.textContent = state.skips;
  el.copy.textContent = 'Скопировать результат';
  showScreen('done');
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
  const text = `Детские слова: 20 из 20 за ${time}. Подсказок: ${state.hints}.`;
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
