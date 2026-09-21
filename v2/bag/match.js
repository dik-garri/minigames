/* Опознание предметов: приводит написанное гостем к словарной записи.
   Задача — засчитать «пелёнки», «пелёнка» и «Пеленка» как один предмет,
   простить одну опечатку и при этом не склеить два разных предмета. */

// окончания отрезаются от самого длинного к самому короткому
const ENDINGS = [
  'ами', 'ями', 'ов', 'ев', 'ах', 'ях', 'ой', 'ей', 'ый', 'ий', 'ая', 'яя',
  'ое', 'ее', 'ые', 'ие', 'ью', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь'
];

const MIN_STEM = 4;      // короче основу не режем: «боди», «слип»
const FUZZY_FROM = 7;    /* Опечатки прощаем только длинным словам, и только при
                            совпадении первой буквы. На шести буквах пары вроде
                            «пелёнка/зелёнка», «пинетки/пипетка», «качалка/каталка»
                            расходятся ровно на один символ — это разные предметы,
                            и склеивать их нельзя. */

function stem(word) {
  if (word.length <= MIN_STEM) return word;
  for (const end of ENDINGS) {
    if (word.length - end.length >= MIN_STEM && word.endsWith(end)) {
      return word.slice(0, -end.length);
    }
  }
  return word;
}

/* Ключ предмета: слова по алфавиту, каждое без окончания.
   Порядок слов не важен — «салфетки влажные» = «влажные салфетки». */
function normalize(raw) {
  const cleaned = String(raw)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z0-9\s-]/g, ' ')
    .replace(/[-\s]+/g, ' ')
    .trim();

  if (!cleaned) return '';
  return cleaned.split(' ').map(stem).sort().join(' ');
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;   // дальше нам не интересно
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}

function buildIndex(items) {
  const byKey = new Map();
  items.forEach(([canonical, ...synonyms]) => {
    [canonical, ...synonyms].forEach((name) => {
      const key = normalize(name);
      if (key && !byKey.has(key)) byKey.set(key, canonical);
    });
  });
  return byKey;
}

/* Возвращает { key, canonical, fuzzy } — canonical пуст, если предмета нет в словаре.
   key нужен, чтобы ловить повторы даже среди незнакомых слов.
   fuzzy показывает, что слово опознано с поправкой на опечатку: игроку это
   показывается явно, чтобы он видел, что именно ему засчитали. */
function lookup(raw, index) {
  const key = normalize(raw);
  if (!key) return null;

  const exact = index.get(key);
  if (exact) return { key, canonical: exact, fuzzy: false };

  // одна опечатка в длинном однословном названии
  if (!key.includes(' ') && key.length >= FUZZY_FROM) {
    for (const [candidate, canonical] of index) {
      if (candidate.includes(' ')) continue;
      if (candidate[0] !== key[0]) continue;
      if (Math.abs(candidate.length - key.length) > 1) continue;
      if (levenshtein(key, candidate) <= 1) return { key: candidate, canonical, fuzzy: true };
    }
  }

  return { key, canonical: '', fuzzy: false };
}

if (typeof module !== 'undefined') {
  module.exports = { stem, normalize, levenshtein, buildIndex, lookup, MIN_STEM, FUZZY_FROM };
}
