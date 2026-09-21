/* Что в маминой сумке — пять минут на то, чтобы вспомнить детские вещи.
   Подсчёт целиком на устройстве: результат виден сразу, ведущий ничего не сводит. */

const ROUND_MS = 5 * 60 * 1000;
const SAVE_KEY = 'baby-bag-v1';

const MILESTONES = [
  { at: 10, text: 'Собрались в поликлинику' },
  { at: 20, text: 'Готовы к выписке' },
  { at: 30, text: 'Мама со стажем' },
  { at: 40, text: 'Это уже детский магазин' }
];

const $ = (id) => document.getElementById(id);
const el = {
  screens: { intro: $('screen-intro'), count: $('screen-count'), game: $('screen-game'), done: $('screen-done') },
  start: $('btn-start'),
  resumeNote: $('resume-note'),
  resume: $('btn-resume'),
  countNumber: $('count-number'),
  time: $('hud-time'),
  score: $('hud-score'),
  unknown: $('hud-unknown'),
  form: $('entry-form'),
  field: $('entry-field'),
  status: $('status'),
  bagBody: $('bag-body'),
  bagEmpty: $('bag-empty'),
  live: $('live'),
  resultCount: $('result-count'),
  resultLabel: $('result-label'),
  finalList: $('final-list'),
  finalUnknown: $('final-unknown'),
  copy: $('btn-copy'),
  again: $('btn-again'),
  confetti: $('confetti')
};

const INDEX = buildIndex(ITEMS);

let state = null;
let ticker = null;
let wakeLock = null;

/* ——— мелочи ——— */

const formatTime = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const buzz = (p) => { if (navigator.vibrate) navigator.vibrate(p); };

const plural = (n, one, few, many) => {
  const t = n % 100, u = n % 10;
  if (t >= 11 && t <= 14) return many;
  if (u === 1) return one;
  if (u >= 2 && u <= 4) return few;
  return many;
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
  } catch { /* экран погаснет как обычно */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state && !state.done) keepAwake();
});

const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* приватный режим */ } };
const load = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; } };
const clearSave = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* ничего */ } };

/* ——— конфетти ——— */

const CONFETTI_COLORS = ['#FF5D73', '#17A67A', '#FFD27D', '#B79CFF', '#FFFFFF'];

function dropConfetti({ count, speed, spread }) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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

/* ——— игра ——— */

function newGame() {
  state = { things: [], startedAt: Date.now(), done: false, shown: [] };
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
    void el.countNumber.offsetWidth;
    el.countNumber.style.animation = '';
    buzz(i === steps.length - 1 ? [30, 60, 30] : 25);
    i++;
    if (i < steps.length) setTimeout(step, 750);
    else setTimeout(() => { state.startedAt = Date.now(); save(); startPlaying(); }, 700);
  };
  step();
}

function startPlaying() {
  showScreen('game');
  keepAwake();
  renderBag();
  tick();
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
  el.field.focus();
}

function tick() {
  const left = state.startedAt + ROUND_MS - Date.now();
  el.time.textContent = formatTime(left);
  el.time.classList.toggle('is-late', left <= 60000);
  if (left <= 0) finish();
}

function say(text, kind) {
  el.status.textContent = text;
  el.status.className = `status${kind ? ` status--${kind}` : ''}`;
}

/* В счёт идут только вещи из словаря. Остальные лежат в сумке с пометкой:
   ведущий может их признать, но сама игра их не засчитывает. */
const counted = () => state.things.filter((t) => t.known).length;
const disputed = () => state.things.filter((t) => !t.known);

function updateScore() {
  el.score.textContent = counted();
  const open = disputed().length;
  el.unknown.textContent = open ? `+${open} под вопросом` : '';
}

function addThing(raw) {
  const typed = raw.trim();
  if (typed.length < 2) return;

  const found = lookup(typed, INDEX);
  if (!found) return;

  /* Считаем предмет, а не написание: у «соски» и «пустышки» ключи разные,
     но предмет один — иначе синонимы приносили бы по очку каждый. */
  const id = found.canonical || found.key;
  const already = state.things.find((t) => t.id === id);
  if (already) {
    say(`«${already.name}» уже в сумке`, 'dupe');
    buzz([30, 40, 30]);
    return;
  }

  const name = found.canonical || typed.toLowerCase();
  state.things.push({ id, name, known: Boolean(found.canonical) });
  save();

  if (!found.canonical) {
    say(`«${name}» — нет в словаре, не засчитано`, 'unknown');
  } else if (found.fuzzy) {
    say(`Засчитано как «${name}»`, 'good');
  } else {
    say(`«${name}» — в сумке`, 'good');
  }

  buzz(18);
  updateScore();
  el.live.textContent = `${counted()}: ${name}`;
  addThingToBag(state.things[state.things.length - 1], true);
  checkMilestone();
}

function addThingToBag(thing, fresh) {
  if (el.bagEmpty) el.bagEmpty.hidden = true;
  const chip = document.createElement('span');
  chip.className = `thing${thing.known ? '' : ' thing--unknown'}`;
  chip.textContent = thing.name;
  if (!fresh) chip.style.animation = 'none';
  el.bagBody.prepend(chip);
}

function renderBag() {
  updateScore();
  [...el.bagBody.querySelectorAll('.thing')].forEach((n) => n.remove());
  state.things.forEach((thing) => addThingToBag(thing, false));
  if (el.bagEmpty) el.bagEmpty.hidden = state.things.length > 0;
}

function checkMilestone() {
  const reached = MILESTONES.find((m) => m.at === counted() && !state.shown.includes(m.at));
  if (!reached) return;
  state.shown.push(reached.at);
  save();

  const toast = document.createElement('div');
  toast.className = 'milestone';
  toast.textContent = reached.text;
  toast.addEventListener('animationend', () => toast.remove());
  el.screens.game.append(toast);
  dropConfetti({ count: 14, speed: 1.4, spread: 80 });
}

function finish() {
  clearInterval(ticker);
  if (state.done) return;
  state.done = true;
  save();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }

  const total = counted();
  const open = disputed();

  el.resultCount.textContent = total;
  el.resultLabel.textContent = `${plural(total, 'вещь', 'вещи', 'вещей')} в сумке`;

  // сначала засчитанные, спорные — в конце списка
  const ordered = [...state.things.filter((t) => t.known), ...open];
  el.finalList.replaceChildren(...ordered.map((thing) => {
    const chip = document.createElement('span');
    chip.className = `thing${thing.known ? '' : ' thing--unknown'}`;
    chip.textContent = thing.name;
    return chip;
  }));

  if (open.length) {
    el.finalUnknown.hidden = false;
    el.finalUnknown.textContent = `Не засчитано, нет в словаре: ${open.map((t) => t.name).join(', ')}. Если ведущий признает — прибавьте к счёту вручную.`;
  } else {
    el.finalUnknown.hidden = true;
  }

  el.copy.textContent = 'Скопировать результат';
  showScreen('done');
  dropConfetti({ count: 26, speed: 2.2, spread: 96 });
  buzz([30, 60, 30, 60, 90]);
}

/* ——— события ——— */

el.start.addEventListener('click', () => { newGame(); countdown(); });
el.resume.addEventListener('click', () => startPlaying());

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  addThing(el.field.value);
  el.field.value = '';
  el.field.focus();
});

el.copy.addEventListener('click', async () => {
  const total = counted();
  const open = disputed();
  const tail = open.length ? ` Под вопросом ещё ${open.length}: ${open.map((t) => t.name).join(', ')}.` : '';
  const text = `Что в маминой сумке: ${total} ${plural(total, 'вещь', 'вещи', 'вещей')} за 5 минут.${tail}`;
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
  el.status.textContent = ' ';
  el.status.className = 'status';
  showScreen('intro');
});

/* ——— продолжение прерванной игры ——— */

const saved = load();
if (saved && !saved.done && saved.startedAt + ROUND_MS > Date.now()) {
  state = saved;
  el.resumeNote.hidden = false;
  const left = formatTime(saved.startedAt + ROUND_MS - Date.now());
  el.resume.textContent = `Продолжить — осталось ${left}`;
}
