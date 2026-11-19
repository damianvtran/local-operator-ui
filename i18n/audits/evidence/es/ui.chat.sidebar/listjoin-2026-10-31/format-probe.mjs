import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const root = '/Users/damian/local-operator-ui/.worktrees/i18n-listjoin';
const require = createRequire(`${root}/package.json`);
const { IntlMessageFormat } = require('intl-messageformat');
const { parse, TYPE } = require('@formatjs/icu-messageformat-parser');
const key = 'ui.chat.sidebar.agents.list_join';
const load = locale => JSON.parse(readFileSync(`${root}/src/i18n/catalogues/${locale}/ui.chat.sidebar.json`, 'utf8'));
const en = load('en');
const es = load('es');
assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
const source = parse(en[key]);
const target = parse(es[key]);
assert.equal(target.length, 1);
assert.equal(target[0].type, TYPE.select);
assert.equal(target[0].value, 'position');
assert.deepEqual(Object.keys(target[0].options).sort(), ['middle', 'other', 'pair']);
for (const arm of ['pair', 'middle', 'other']) {
  const args = nodes => nodes.filter(node => node.type === TYPE.argument).map(node => node.value);
  assert.deepEqual(args(target[0].options[arm].value), ['head', 'tail']);
  assert.deepEqual(args(target[0].options[arm].value), args(source[0].options[arm].value));
}
const fmt = new IntlMessageFormat(es[key], 'es');
const join = (head, tail, position) => fmt.format({head, tail, position});
const outputs = {
  pair: join('Coder', 'Reviewer', 'pair'),
  middle: join('Coder', 'Reviewer', 'middle'),
  other: join('Coder, Reviewer', 'Designer', 'end'),
  explicit_other: join('Coder, Reviewer', 'Designer', 'other'),
  two_names: ['Coder', 'Reviewer'].reduce((head, tail, index) => index === 0 ? tail : join(head, tail, 'pair'), ''),
  three_names: ['Coder', 'Reviewer', 'Designer'].reduce((head, tail, index) => index === 0 ? tail : join(head, tail, index === 2 ? 'end' : 'middle'), ''),
  i_sound_limitation_pair: join('Coder', 'Investigador', 'pair'),
  i_sound_limitation_final: join('Coder, Reviewer', 'Investigador', 'end'),
};
assert.equal(outputs.pair, 'Coder y Reviewer');
assert.equal(outputs.middle, 'Coder, Reviewer');
assert.equal(outputs.other, 'Coder, Reviewer y Designer');
assert.equal(outputs.explicit_other, outputs.other);
assert.equal(outputs.two_names, outputs.pair);
assert.equal(outputs.three_names, outputs.other);
assert.equal(outputs.i_sound_limitation_pair, 'Coder y Investigador');
assert.equal(outputs.i_sound_limitation_final, 'Coder, Reviewer y Investigador');
assert.throws(() => new IntlMessageFormat(es[key].slice(0, -1), 'es'));
assert.throws(() => fmt.format({position: 'pair', head: 'Coder'}));
console.log(JSON.stringify({status:'passed', key, arms:{pair:'{head} y {tail}', middle:'{head}, {tail}', other:'{head} y {tail}'}, outputs, checks:['JSON and namespace key parity', 'position/select and pair/middle/other preserved', 'head/tail argument names and types preserved in every arm', 'real intl-messageformat formatting for every arm', 'end and explicit other use the other arm', 'two/three-name fold matching caller', 'known i-sound limitation reproduced', 'malformed ICU and missing-tail negative controls rejected'], namespace_key_count:Object.keys(es).length}, null, 2));
