/* Экран ведущего для проектора: «Найди своих», «Кто я?», «Правда или ложь» и блиц.
   Листает помощник с ноутбука — мышью, стрелками или кликером для презентаций.
   Счёт лежит в localStorage: перезагрузка страницы ничего не теряет. */

const SAVE_KEY = 'faith-screen-v3';
const BLITZ_MS = 60 * 1000;   // время одной команды в блице
const MIN_TEAMS = 2;
const MAX_TEAMS = 6;
const NEXT_KEYS = ['ArrowRight', 'PageDown', ' ', 'Enter'];   // кликеры шлют PageDown / PageUp
const BACK_KEYS = ['ArrowLeft', 'PageUp'];

const app = document.getElementById('app');

const fresh = () => ({
  view: 'menu',
  teams: ['Команда 1', 'Команда 2', 'Команда 3', 'Команда 4'],
  find: { i: 0, step: 0 },
  // marks[персонаж][команда] = { at: на какой подсказке сдали лист, ok: null | true | false }
  who: { i: 0, step: 1, marks: {} },
  truth: { i: 0, shown: false },
  // turns[команда] = [{ q: номер вопроса, ok }]; cursor — следующий неиспользованный вопрос
  blitz: { phase: 'pick', team: null, cursor: 0, endsAt: 0, turns: {} }
});

let state = load();
let ticker = null;
let audio = null;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (saved && Array.isArray(saved.teams)) return { ...fresh(), ...saved };
  } catch (e) { /* приватное окно или испорченная запись — начинаем с чистого листа */ }
  return fresh();
}

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* играем и без сохранения */ }
}

/* ——— утилиты ——— */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const plural = (n, one, few, many) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
};

const teamName = (t) => (state.teams[t] || '').trim() || `Команда ${t + 1}`;
const teamColor = (t) => `--c: var(--t${t})`;

function whoPoints(t) {
  return Object.values(state.who.marks).reduce((sum, row) => {
    const m = row[t];
    return sum + (m && m.ok === true ? 4 - m.at : 0);
  }, 0);
}
const blitzPoints = (t) => (state.blitz.turns[t] || []).filter((a) => a.ok).length;
const total = (t) => whoPoints(t) + blitzPoints(t);

function go(view) {
  state.view = view;
  save();
  render();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}

/* Звук конца раунда. AudioContext будим на «Старт» — без жеста браузер молчит. */
function wakeAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch (e) { audio = null; }
}

function beep() {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = 440;
  gain.gain.setValueAtTime(0.25, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.9);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.9);
}

/* ——— каркас ——— */

function frame(title, body, foot = '') {
  return `
    <header class="top">
      <button class="top__menu" data-act="go" data-view="menu" type="button">← Меню</button>
      <p class="top__title">${title}</p>
      <p class="top__keys">→ дальше · ← назад · F — весь экран</p>
    </header>
    <main class="stage">${body}</main>
    <footer class="foot">${foot}</footer>`;
}

/* ——— меню ——— */

function viewMenu() {
  const n = state.teams.length;
  const tile = (view, name, desc) => `
    <button class="tile" data-act="go" data-view="${view}" type="button">
      <span class="tile__name">${name}</span>
      <span class="tile__desc">${desc}</span>
    </button>`;
  return `
    <main class="menu">
      <p class="eyebrow">Молодёжная встреча · экран для проектора</p>
      <h1 class="menu__title">Игры</h1>
      <div class="tiles">
        ${tile('find', 'Найди своих', 'Знакомство и сбор команд')}
        ${tile('teams', 'Команды', `${n} ${plural(n, 'команда', 'команды', 'команд')} — вписать названия`)}
        ${tile('who', 'Кто я?', 'Персонаж по трём подсказкам')}
        ${tile('truth', 'Правда или ложь', 'Разминка для всего зала')}
        ${tile('blitz', 'Блиц', 'По минуте на команду')}
        ${tile('score', 'Счёт', 'Итог двух командных игр')}
      </div>
      <p class="menu__foot">
        F — во весь экран, листать стрелками, кликером или мышью.
        <a href="print.html" target="_blank">Распечатка для ведущего</a> ·
        <button class="link" data-act="reset" type="button">Обнулить счёт</button>
      </p>
    </main>`;
}

/* ——— команды ——— */

function viewTeams() {
  const n = state.teams.length;
  const rows = state.teams.map((name, t) => `
    <label class="team-row" style="${teamColor(t)}">
      <span class="team-row__n">${t + 1}</span>
      <input class="team-row__input" data-team="${t}" value="${esc(name)}" maxlength="24" autocomplete="off" spellcheck="false">
    </label>`).join('');
  return frame('Команды', `
    <div class="teams">
      ${rows}
      <div class="teams__count">
        <button class="btn btn--ghost" data-act="team-del" type="button" ${n <= MIN_TEAMS ? 'disabled' : ''}>− команда</button>
        <button class="btn btn--ghost" data-act="team-add" type="button" ${n >= MAX_TEAMS ? 'disabled' : ''}>+ команда</button>
      </div>
    </div>`,
  '<button class="btn" data-act="go" data-view="who" type="button">К игре «Кто я?» →</button>');
}

/* ——— Найди своих ——— */

const FIND_MAIN = FIND.filter((r) => !r.reserve && !r.final).length;
const FIND_FINAL = FIND.findIndex((r) => r.final);

function viewFind() {
  const { i, step } = state.find;
  const r = FIND[i];
  const label = r.final ? 'Финал' : r.reserve ? 'Запасной раунд' : `Раунд ${i + 1} из ${FIND_MAIN}`;
  const body = r.final
    ? `<p class="find__text">${r.text}</p>`
    : `<div class="corners corners--${r.opts.length}">
        ${r.opts.map((o, k) => `<div class="corner" style="${teamColor(k)}">${o}</div>`).join('')}
      </div>`;
  const task = step > 0
    ? `<p class="find__task"><span class="find__label">В группе</span>${r.task}</p>`
    : '<p class="find__task find__task--wait">→ задание для групп</p>';
  return frame('Найди своих', `
    <p class="kicker">${label}</p>
    <h2 class="find__q">${r.q}</h2>
    ${body}
    ${task}`,
  i === FIND_FINAL
    ? '<button class="btn" data-act="go" data-view="teams" type="button">Вписать названия команд →</button>'
    : '<button class="link" data-act="find-final" type="button">К финалу ⇥</button>');
}

function navFind(d) {
  const f = state.find;
  if (d > 0) {
    if (f.step === 0) f.step = 1;
    else if (f.i < FIND.length - 1) { f.i++; f.step = 0; }
    else return go('teams');
  } else if (f.step === 1) f.step = 0;
  else if (f.i > 0) { f.i--; f.step = 1; }
  save();
  render();
}

/* ——— Кто я? ——— */

function viewWho() {
  const { i, step } = state.who;
  const hero = HEROES[i];
  const marks = state.who.marks[i] || {};
  const reveal = step === 4;
  const clues = hero.clues.map(([text, ref], k) => {
    const open = k < step;
    return `
      <li class="clue ${open ? 'is-open' : ''}">
        <span class="clue__pts">${3 - k}</span>
        <span class="clue__text">${open ? text : `Подсказка ${k + 1}`}</span>
        ${reveal ? `<span class="clue__ref">${ref}</span>` : ''}
      </li>`;
  }).join('');
  const label = i < HEROES_MAIN ? `Персонаж ${i + 1} из ${HEROES_MAIN}` : `Запасной персонаж · ${i + 1 - HEROES_MAIN}`;
  const enough = reveal && i >= HEROES_MAIN - 1
    ? '<button class="link" data-act="go" data-view="truth" type="button">Хватит — к «Правде или лжи» ⇥</button>'
    : '';
  return frame('Кто я?', `
    <p class="kicker">${label} · баллы за подсказку слева</p>
    <ol class="clues">${clues}</ol>
    <p class="answer ${reveal ? 'is-open' : ''}">${reveal ? hero.name : 'Кто я?'}</p>`,
  `<div class="chips">${state.teams.map((_, t) => whoChip(t, marks[t], step)).join('')}</div>
   <p class="foot__hint">${reveal
     ? 'Кто угадал? Клик или цифра команды: ? → ✓ → ✗'
     : 'Команда подняла лист — клик или цифра команды. Ответ сдают один раз'}</p>
   ${enough}`);
}

function whoChip(t, m, step) {
  let tag = '';
  let cls = '';
  if (m && step < 4) { tag = `✋ ${m.at}-я`; cls = 'is-locked'; }
  else if (m && m.ok === true) { tag = `+${4 - m.at}`; cls = 'is-good'; }
  else if (m && m.ok === false) { tag = '✗'; cls = 'is-bad'; }
  else if (m) { tag = `? ${m.at}-я`; cls = 'is-locked'; }
  else if (step === 4) cls = 'is-off';
  return `
    <button class="chip ${cls}" data-act="who-team" data-team="${t}" style="${teamColor(t)}" type="button">
      <span class="chip__n">${t + 1}</span>
      <span class="chip__name">${esc(teamName(t))}</span>
      <span class="chip__score">${total(t)}</span>
      ${tag ? `<span class="chip__tag">${tag}</span>` : ''}
    </button>`;
}

/* До ответа клик сдаёт лист на текущей подсказке (повторный — отменяет ошибку).
   После ответа — отмечает, верно ли: ? → ✓ → ✗ → ?. */
function toggleWho(t) {
  const w = state.who;
  const row = (w.marks[w.i] = w.marks[w.i] || {});
  if (w.step < 4) {
    if (row[t]) delete row[t];
    else row[t] = { at: w.step, ok: null };
  } else if (row[t]) {
    const ok = row[t].ok;
    row[t].ok = ok === null ? true : ok === true ? false : null;
  } else return;
  save();
  render();
}

function navWho(d) {
  const w = state.who;
  if (d > 0) {
    if (w.step < 4) w.step++;
    else if (w.i < HEROES.length - 1) { w.i++; w.step = 1; }
    else return go('truth');
  } else if (w.step > 1) w.step--;
  else if (w.i > 0) { w.i--; w.step = 4; }
  save();
  render();
}

/* ——— Правда или ложь ——— */

function viewTruth() {
  const { i, shown } = state.truth;
  const s = TRUTH[i];
  const verdict = shown
    ? `<div class="verdict verdict--${s.ok ? 'yes' : 'no'}">
        <b class="verdict__word">${s.ok ? 'Правда' : 'Ложь'}</b>
        <span class="verdict__why">${s.why}</span>
        <span class="verdict__ref">${s.ref}</span>
      </div>`
    : `<div class="verdict verdict--wait">
        <span class="vote vote--yes">↑ Правда — руки вверх</span>
        <span class="vote vote--no">✕ Ложь — руки крестом на груди</span>
      </div>`;
  return frame('Правда или ложь', `
    <p class="kicker">Утверждение ${i + 1} из ${TRUTH.length}</p>
    <h2 class="statement">${s.s}</h2>
    ${verdict}`,
  `<p class="foot__hint">Ошибся — садишься на место. Побеждает тот, кто остался стоять последним.</p>
   <button class="link" data-act="go" data-view="blitz" type="button">К блицу ⇥</button>`);
}

function navTruth(d) {
  const tr = state.truth;
  if (d > 0) {
    if (!tr.shown) tr.shown = true;
    else if (tr.i < TRUTH.length - 1) { tr.i++; tr.shown = false; }
    else return go('blitz');
  } else if (tr.shown) tr.shown = false;
  else if (tr.i > 0) { tr.i--; tr.shown = true; }
  save();
  render();
}

/* ——— блиц ——— */

function viewBlitz() {
  const b = state.blitz;
  if (b.phase === 'ready') return blitzReady();
  if (b.phase === 'run') return blitzRun();
  if (b.phase === 'done') return blitzDone();
  return blitzPick();
}

function blitzPick() {
  const left = BLITZ.length - state.blitz.cursor;
  const cards = state.teams.map((_, t) => {
    const played = state.blitz.turns[t];
    const n = blitzPoints(t);
    return `
      <button class="pick" data-act="blitz-pick" data-team="${t}" style="${teamColor(t)}" type="button">
        <span class="pick__n">${t + 1}</span>
        <span class="pick__name">${esc(teamName(t))}</span>
        <span class="pick__score">${played ? `${n} ${plural(n, 'верный', 'верных', 'верных')}` : 'ещё не играла'}</span>
      </button>`;
  }).join('');
  return frame('Блиц', `
    <p class="kicker">Минута на команду · в запасе ${left} ${plural(left, 'вопрос', 'вопроса', 'вопросов')}</p>
    <h2 class="blitz__title">Чья очередь?</h2>
    <div class="picks">${cards}</div>`,
  '<button class="btn" data-act="go" data-view="score" type="button">Итоговый счёт →</button>');
}

function blitzReady() {
  const t = state.blitz.team;
  const empty = state.blitz.cursor >= BLITZ.length;
  return frame('Блиц', `
    <p class="kicker">Готовится команда ${t + 1}</p>
    <h2 class="ready__team" style="${teamColor(t)}">${esc(teamName(t))}</h2>
    <p class="ready__rules">60 секунд. Ведущий читает вопросы подряд, команда отвечает. Не знаете — «пас», и сразу следующий.</p>
    ${state.blitz.turns[t] ? '<p class="ready__warn">Команда уже играла — прошлый результат заменится</p>' : ''}
    ${empty ? '<p class="ready__warn">Вопросы закончились — допишите новые в data.js</p>' : ''}`,
  `<button class="btn btn--ghost" data-act="blitz-back" type="button">← Другая команда</button>
   <button class="btn btn--go" data-act="blitz-start" type="button" ${empty ? 'disabled' : ''}>Старт</button>`);
}

function blitzRun() {
  const b = state.blitz;
  const answers = b.turns[b.team] || [];
  const log = answers.slice(-4).reverse().map((a) => `
    <li class="log__item ${a.ok ? 'is-good' : 'is-bad'}">${a.ok ? '✓' : '✗'} ${BLITZ[a.q][1]}</li>`).join('');
  return frame('Блиц', `
    <div class="timer" id="timer">
      <span class="timer__num" id="timer-num">60</span>
      <span class="timer__bar"><i id="timer-fill"></i></span>
    </div>
    <p class="kicker">${esc(teamName(b.team))} · вопрос № ${b.cursor + 1} · верно: ${blitzPoints(b.team)}</p>
    <h2 class="blitz__q">${BLITZ[b.cursor][0]}</h2>
    <ol class="log">${log}</ol>`,
  `<button class="btn btn--bad" data-act="blitz-mark" data-ok="0" type="button">✗ Пас <kbd>←</kbd></button>
   <button class="btn btn--good" data-act="blitz-mark" data-ok="1" type="button">✓ Верно <kbd>→</kbd></button>`);
}

function blitzDone() {
  const t = state.blitz.team;
  const answers = state.blitz.turns[t] || [];
  const n = blitzPoints(t);
  const review = answers.map((a, k) => `
    <li>
      <button class="review__item ${a.ok ? 'is-good' : 'is-bad'}" data-act="blitz-toggle" data-k="${k}" type="button">
        <span>${a.ok ? '✓' : '✗'}</span> ${BLITZ[a.q][0]} — <b>${BLITZ[a.q][1]}</b>
      </button>
    </li>`).join('');
  return frame('Блиц', `
    <p class="kicker">Время!</p>
    <h2 class="done__team" style="${teamColor(t)}">${esc(teamName(t))}</h2>
    <p class="done__score">${n} <span>${plural(n, 'верный ответ', 'верных ответа', 'верных ответов')}</span></p>
    <ol class="review">${review}</ol>`,
  `<p class="foot__hint">Ошиблись с отметкой — нажмите на вопрос</p>
   <button class="btn" data-act="blitz-back" type="button">Следующая команда →</button>`);
}

function pickBlitz(t) {
  Object.assign(state.blitz, { team: t, phase: 'ready' });
  save();
  render();
}

function startBlitz() {
  const b = state.blitz;
  if (b.cursor >= BLITZ.length) return;
  wakeAudio();
  b.turns[b.team] = [];
  b.endsAt = Date.now() + BLITZ_MS;
  b.phase = 'run';
  save();
  render();
}

function markBlitz(ok) {
  const b = state.blitz;
  b.turns[b.team].push({ q: b.cursor, ok });
  b.cursor++;
  if (b.cursor >= BLITZ.length) return finishBlitz();
  save();
  render();
}

function finishBlitz() {
  state.blitz.phase = 'done';
  beep();
  save();
  render();
}

function navBlitz(d) {
  const b = state.blitz;
  if (b.phase === 'ready') {
    if (d > 0) startBlitz();
    else { b.phase = 'pick'; save(); render(); }
  } else if (b.phase === 'run') markBlitz(d > 0);
  else if (b.phase === 'done' && d > 0) { b.phase = 'pick'; save(); render(); }
}

function startTicker() {
  stopTicker();
  const tick = () => {
    const left = state.blitz.endsAt - Date.now();
    if (left <= 0) return finishBlitz();
    document.getElementById('timer-num').textContent = Math.ceil(left / 1000);
    document.getElementById('timer-fill').style.transform = `scaleX(${left / BLITZ_MS})`;
    document.getElementById('timer').classList.toggle('is-hurry', left <= 10000);
  };
  tick();
  ticker = setInterval(tick, 100);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

/* ——— счёт ——— */

function viewScore() {
  const rows = state.teams.map((_, t) => ({ t, who: whoPoints(t), blitz: blitzPoints(t), sum: total(t) }))
    .sort((a, b) => b.sum - a.sum);
  const top = rows[0].sum;
  const list = rows.map((r) => {
    const place = 1 + rows.filter((x) => x.sum > r.sum).length;
    return `
      <li class="row ${top > 0 && r.sum === top ? 'is-top' : ''}" style="${teamColor(r.t)}; --w: ${top > 0 ? r.sum / top : 0}">
        <span class="row__place">${place}</span>
        <span class="row__name">${esc(teamName(r.t))}</span>
        <span class="row__bar"><i></i></span>
        <span class="row__parts">«Кто я?» ${r.who} · блиц ${r.blitz}</span>
        <span class="row__sum">${r.sum}</span>
      </li>`;
  }).join('');
  return frame('Счёт', `
    <h2 class="score__title">Итоги</h2>
    <ol class="rows">${list}</ol>`);
}

/* ——— рендер и ввод ——— */

const VIEWS = {
  menu: viewMenu, teams: viewTeams, find: viewFind, who: viewWho,
  truth: viewTruth, blitz: viewBlitz, score: viewScore
};
const NAV = {
  find: navFind, who: navWho, truth: navTruth, blitz: navBlitz,
  teams: (d) => go(d > 0 ? 'who' : 'find')
};

function render() {
  if (!VIEWS[state.view]) state.view = 'menu';
  app.dataset.view = state.view;
  app.innerHTML = VIEWS[state.view]();
  if (state.view === 'blitz' && state.blitz.phase === 'run') startTicker();
  else stopTicker();
}

app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const t = Number(btn.dataset.team);
  switch (btn.dataset.act) {
    case 'go': return go(btn.dataset.view);
    case 'reset':
      if (!confirm('Обнулить счёт и начать игры сначала? Названия команд останутся.')) return;
      state = { ...fresh(), teams: state.teams };
      save();
      return render();
    case 'team-add':
      state.teams.push(`Команда ${state.teams.length + 1}`);
      save();
      return render();
    case 'team-del':
      state.teams.pop();
      save();
      return render();
    case 'find-final':
      state.find = { i: FIND_FINAL, step: 0 };
      save();
      return render();
    case 'who-team': return toggleWho(t);
    case 'blitz-pick': return pickBlitz(t);
    case 'blitz-back':
      state.blitz.phase = 'pick';
      save();
      return render();
    case 'blitz-start': return startBlitz();
    case 'blitz-mark': return markBlitz(btn.dataset.ok === '1');
    case 'blitz-toggle': {
      const a = state.blitz.turns[state.blitz.team][Number(btn.dataset.k)];
      a.ok = !a.ok;
      save();
      return render();
    }
  }
});

// Названия команд сохраняем по мере ввода, без перерисовки — иначе слетит фокус.
app.addEventListener('input', (e) => {
  if (e.target.dataset.team === undefined) return;
  state.teams[Number(e.target.dataset.team)] = e.target.value;
  save();
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.code === 'KeyF') return toggleFullscreen();   // по коду клавиши — работает и в русской раскладке
  if (e.key === 'Escape') return go('menu');
  if (/^[1-6]$/.test(e.key)) {
    const t = Number(e.key) - 1;
    if (t >= state.teams.length) return;
    if (state.view === 'who') toggleWho(t);
    else if (state.view === 'blitz' && state.blitz.phase === 'pick') pickBlitz(t);
    return;
  }
  const nav = NAV[state.view];
  if (!nav) return;
  // Пробел на кнопке в фокусе иначе нажмёт и её: шаг вышел бы двойным.
  if (NEXT_KEYS.includes(e.key) || BACK_KEYS.includes(e.key)) document.activeElement.blur();
  if (NEXT_KEYS.includes(e.key)) { e.preventDefault(); nav(1); }
  else if (BACK_KEYS.includes(e.key)) { e.preventDefault(); nav(-1); }
});

render();
