import { readFileSync } from 'node:fs';
const mod = await import('/Users/damian/local-operator-ui/.worktrees/i18n-s16a/node_modules/@formatjs/icu-messageformat-parser/index.js');
const { parse } = mod;
const T = mod.TYPE ?? { literal: 0, argument: 1, number: 2, date: 3, time: 4, select: 5, plural: 6, pound: 7, tag: 8 };
const ROOT = '/Users/damian/local-operator-ui/.worktrees/i18n-s16a';
const draft = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const en = JSON.parse(readFileSync(ROOT + '/src/i18n/catalogues/en/ui.chat.canonical.json', 'utf8'));
const NEED = ['one', 'few', 'many', 'other'];

const optMap = (n) => (Array.isArray(n.options) ? Object.fromEntries(n.options.map((o) => [o.value, o.value])) : n.options);
const cats = (n) => Object.keys(optMap(n)).sort();
const children = (n) => (Array.isArray(n.options) ? n.options.map((o) => o.value) : Object.values(n.options).map((o) => o.value));

function norm(nodes, out = []) {
  for (const n of nodes) {
    if (n.type === T.literal) out.push({ t: 'lit', v: n.value });
    else if (n.type === T.argument) out.push({ t: 'arg', v: n.value, style: null });
    else if (n.type === T.number) out.push({ t: 'num', v: n.value, style: n.style ?? null });
    else if (n.type === T.pound) out.push({ t: 'pound' });
    else if (n.type === T.plural) {
      out.push({ t: 'plural', v: n.value, cats: cats(n) });
      for (const c of children(n)) norm(c, out);
    } else if (n.type === T.select) {
      out.push({ t: 'select', v: n.value, cats: cats(n) });
      for (const c of children(n)) norm(c, out);
    } else out.push({ t: 'type' + n.type });
  }
  return out;
}
const args = (f) => f.filter((x) => x.t === 'arg' || x.t === 'select' || x.t === 'plural').map((x) => x.v).sort();
const numStyles = (f) => f.filter((x) => x.t === 'num').map((x) => x.v + ':' + JSON.stringify(x.style)).sort();
const plurals = (f) => f.filter((x) => x.t === 'plural');
const selects = (f) => f.filter((x) => x.t === 'select').map((x) => x.v + '[' + x.cats.join(',') + ']');
const pounds = (f) => f.filter((x) => x.t === 'pound').length;
const lits = (f) => f.filter((x) => x.t === 'lit').map((x) => x.v).join('|');

const rows = [];
for (const k of Object.keys(draft)) {
  let enF, ruF;
  try {
    enF = norm(parse(en[k]));
    ruF = norm(parse(draft[k]));
  } catch (e) {
    rows.push({ key: k, error: e.message });
    continue;
  }
  const rp = plurals(ruF);
  rows.push({
    key: k.replace('ui.chat.canonical.', ''),
    argsEq: JSON.stringify(args(enF)) === JSON.stringify(args(ruF)),
    args: args(ruF),
    numParity: JSON.stringify(numStyles(enF)) === JSON.stringify(numStyles(ruF)),
    selects: selects(ruF),
    selectParity: JSON.stringify(selects(enF)) === JSON.stringify(selects(ruF)),
    plural: rp.map((p) => p.v + '[' + p.cats.join(',') + ']'),
    catsOk: rp.every((p) => NEED.every((c) => p.cats.includes(c))),
    enPlural: plurals(enF).map((p) => p.v + '[' + p.cats.join(',') + ']'),
    pound: pounds(enF) + '/' + pounds(ruF),
    dot: lits(enF).includes('·') === lits(ruF).includes('·'),
    ell: lits(enF).includes('…') === lits(ruF).includes('…'),
  });
}
for (const r of rows) console.log(JSON.stringify(r));
console.log('---');
console.log('ARGS_ALL_EQUAL:', rows.every((r) => r.argsEq));
console.log('NUM_STYLE_PARITY_ALL:', rows.every((r) => r.numParity));
console.log('SELECT_PARITY_ALL:', rows.every((r) => r.selectParity));
console.log('RU_PLURAL_CATS_OK_ALL:', rows.every((r) => r.catsOk));
console.log('POUND_PARITY_ALL:', rows.every((r) => r.pound.split('/')[0] === r.pound.split('/')[1]));
console.log('DOT_PARITY_ALL:', rows.every((r) => r.dot));
console.log('ELLIPSIS_PARITY_ALL:', rows.every((r) => r.ell));
