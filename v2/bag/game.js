/* Что в маминой сумке — три минуты на то, чтобы вспомнить детские вещи.
   Подсчёт целиком на устройстве: результат виден сразу, ведущий ничего не сводит. */

const ROUND_MS = 3 * 60 * 1000;
const RUSH_MS = 45 * 1000;        // с этого момента таймер краснеет
const SAVE_KEY = 'baby-bag-v1';

// пороги подобраны под три минуты: за пять они были бы вдвое дальше
const MILESTONES = [
  { at: 8,  text: 'Собрались в поликлинику' },
  { at: 15, text: 'Готовы к выписке' },
  { at: 22, text: 'Мама со стажем' },
  { at: 30, text: 'Это уже детский магазин' }
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

/* ——— физика вещей ———
   Ярлыки не выкладываются строчками, а падают в сумку и сваливаются кучей:
   к концу игры видно, насколько она набита. Без rAF или при отключённом
   движении в системе остаётся обычная раскладка потоком. */

const calmMode = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const PHYSICS = typeof Physics !== 'undefined' &&
  typeof requestAnimationFrame === 'function' &&
  typeof document.createElement('div').getBoundingClientRect === 'function' &&
  !calmMode();

const DENSE_STEPS = 2;        // сколько раз утрамбовываем вещи при переполнении
let world = null;
let raf = null;
let lastFrame = 0;
let dense = 0;

function bagSize() {
  const rect = el.bagBody.getBoundingClientRect();
  return { w: Math.max(rect.width - 24, 80), h: Math.max(rect.height - 28, 80) };
}

function ensureWorld() {
  const { w, h } = bagSize();
  if (!world) world = new Physics.World({ width: w, height: h, gravity: 2400, wallBounce: 0.25 });
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

const pileTop = () =>
  world.bodies.length ? Math.min(...world.bodies.map((b) => b.y)) : world.height;

/* Сумка набилась — утрамбовываем: ярлыки становятся мельче, куча оседает */
function densify() {
  if (dense >= DENSE_STEPS || pileTop() > 6) return;
  dense++;
  el.bagBody.classList.add(`is-dense-${dense}`);
  world.bodies.forEach((body) => {
    if (!body.node) return;
    body.w = body.node.offsetWidth;
    body.h = body.node.offsetHeight;
    body.wake();
  });
  runLoop();
}

function dropIntoBag(node) {
  const { w } = bagSize();
  const width = node.offsetWidth || 90;
  const height = node.offsetHeight || 34;
  const body = new Physics.Body({
    x: Math.min(Math.max((w - width) / 2 + (Math.random() - 0.5) * w * 0.5, 0), Math.max(w - width, 0)),
    y: -height - 10,
    w: width,
    h: height,
    vx: (Math.random() - 0.5) * 140,
    vy: 120,
    va: (Math.random() - 0.5) * 160,
    angle: (Math.random() - 0.5) * 16,
    restitution: 0.18,
    friction: 0.72,
    node
  });
  ensureWorld().add(body);
  densify();
  runLoop();
  return body;
}

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

// поворот экрана: сумка меняет размер, куча должна остаться внутри
if (typeof addEventListener === 'function') {
  addEventListener('resize', () => {
    if (!PHYSICS || !world || !state || state.done) return;
    ensureWorld();
    world.bodies.forEach((b) => b.wake());
    runLoop();
  });
}

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
  el.time.classList.toggle('is-late', left <= RUSH_MS);
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

  if (!PHYSICS) {
    if (!fresh) chip.style.animation = 'none';
    el.bagBody.prepend(chip);
    return;
  }

  chip.style.animation = 'none';   // падением занимается физика
  el.bagBody.append(chip);
  dropIntoBag(chip);
  draw();
}

function renderBag() {
  updateScore();
  [...el.bagBody.querySelectorAll('.thing')].forEach((n) => n.remove());
  if (PHYSICS) {
    el.bagBody.classList.add('is-physical');
    ensureWorld().clear();
  }

  state.things.forEach((thing) => addThingToBag(thing, false));

  /* Продолжение прерванной игры: вещи должны уже лежать в сумке,
     а не сыпаться заново на глазах у игрока. */
  if (PHYSICS && state.things.length) {
    for (let i = 0; i < 400 && !world.settled; i++) world.step(1 / 60);
    draw();
  }

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
  stopLoop();
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
  const text = `Что в маминой сумке: ${total} ${plural(total, 'вещь', 'вещи', 'вещей')} за 3 минуты.${tail}`;
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
