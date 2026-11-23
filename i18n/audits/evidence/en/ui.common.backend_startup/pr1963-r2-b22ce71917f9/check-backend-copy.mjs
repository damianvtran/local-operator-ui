import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { IntlMessageFormat } = await import(pathToFileURL(resolve(root, 'node_modules/intl-messageformat/index.js')));
const namespace = 'ui.common.backend_startup';
const plural = { detail_starting: 'seconds', 'reason.timed_out': 'seconds', repeated_failures: 'count' };
const keys = ['title_stopped', 'reason.stopped', 'repeated_failures', 'detail_starting', 'reason.timed_out', 'reason.crashed', 'reason.exited', 'reason.unknown'];
const samples = [1, 2, 5, 11, 21, 22, 25, 30, 1_000_000];
let parsed = 0, assertions = 0;
console.log(`Node ${process.version}, ICU ${process.versions.icu}, intl-messageformat ${JSON.parse(readFileSync(resolve(root,'node_modules/intl-messageformat/package.json'))).version}`);
for (const locale of ['es', 'fr', 'hi', 'ru', 'ur', 'vi', 'zh-CN']) {
 const file = JSON.parse(readFileSync(resolve(root, 'src/i18n/catalogues', locale, `${namespace}.json`)));
 const rules = new Intl.PluralRules(locale);
 const numeric = new Intl.NumberFormat(locale);
 for (const key of keys) {
  const f = new IntlMessageFormat(file[`${namespace}.${key}`], locale);
  parsed++;
  const ast = f.getAst();
  assert.doesNotMatch(file[`${namespace}.${key}`], /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
  if (Object.hasOwn(plural, key)) {
   const [p] = ast.filter(x => x.type !== 0);
   assert.equal(p.type, 6);
   assert.equal(p.value, plural[key]);
   assert.equal(p.pluralType, 'cardinal');
   assert.deepEqual(Object.keys(p.options).sort(), rules.resolvedOptions().pluralCategories.sort());
   for (const value of samples) {
    const category = rules.select(value);
    const arm = p.options[category].value;
    assert.equal(arm.filter(x => x.type === 7).length, 1);
    const formatted = f.format({ [p.value]: value });
    assert.equal(typeof formatted, 'string');
    assert.ok(formatted.includes(numeric.format(value)));
    assert.doesNotMatch(formatted, /[{}#]/u);
    assertions++;
    console.log(`${locale} ${key} ${value} ${category} → ${formatted}`);
   }
  } else {
   assert.ok(ast.every(x => x.type === 0));
   assert.equal(f.format(), file[`${namespace}.${key}`]);
  }
 }
}
console.log(`PASS: ${parsed} target messages parsed; ${assertions} plural renders verified`);
