import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = '/Users/damian/local-operator-ui/.worktrees/i18n-s8';
const bundle = '/Users/damian/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23';
const require = createRequire(root + '/package.json');
const { parse } = require('@formatjs/icu-messageformat-parser');
const { duplicateKeys } = await import(pathToFileURL(root + '/scripts/i18n/check-duplicates.mjs'));
const { namespaceGap } = await import(pathToFileURL(root + '/scripts/i18n/context-parity.mjs'));
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const en = read(root + '/src/i18n/catalogues/en/ui.library.json');
const target = read(root + '/src/i18n/catalogues/zh-CN/ui.library.json');
const context = read(root + '/src/i18n/catalogues/en/ui.library.context.json');
const keys = Object.keys(read(bundle + '/keys20.json'));
const assert = (v, why) => { if (!v) throw new Error(why); };
const head = execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim();
assert(head === '8a9ce1f808c266ebe9a0e924094344cea60c2c23', 'wrong head');
console.log('HEAD ' + head);
const expected = read(bundle + '/expected-hashes.json');
for (const [id, hash] of Object.entries(expected.hashes)) {
  const p = root + '/src/i18n/catalogues/' + id + '.json';
  const actual = execFileSync('shasum', ['-a','256',p],{encoding:'utf8'}).split(/\s+/)[0];
  assert(hash === actual, 'hash mismatch ' + id);
  console.log('HASH PASS ' + id + ' ' + actual);
}
const glossary = execFileSync('shasum',['-a','256',bundle+'/glossary.md'],{encoding:'utf8'}).split(/\s+/)[0];
assert(glossary === '0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8','glossary mismatch');
console.log('GLOSSARY HASH PASS ' + glossary);
for (const p of ['en/ui.library.json','en/ui.library.context.json','zh-CN/ui.library.json']) {
 const d = duplicateKeys(readFileSync(root+'/src/i18n/catalogues/'+p,'utf8'));
 assert(d.length===0,'duplicate keys '+p);
 console.log('REPO duplicateKeys PASS ' + p);
}
const gap = namespaceGap('ui.library', root+'/src/i18n/catalogues');
assert(gap.hasSidecar && gap.uncovered.length===0 && gap.orphaned.length===0, 'context parity');
console.log('REPO namespaceGap PASS zero uncovered/orphaned');
assert(JSON.stringify(Object.keys(en).sort())===JSON.stringify(Object.keys(target).sort()),'key parity');
console.log('JSON/key parity PASS total=' + Object.keys(en).length);
const old = JSON.parse(execFileSync('git',['show','0e12072d2b3:src/i18n/catalogues/zh-CN/ui.library.json'],{cwd:root,encoding:'utf8'}));
const changed = Object.keys(old).filter(k => !(k in target) || old[k]!==target[k]);
const added = Object.keys(target).filter(k=>!(k in old));
assert(changed.length===0,'changed or removed legacy values');
assert(JSON.stringify(added.sort())===JSON.stringify(keys.slice().sort()),'delta differs');
console.log('DELTA PASS exactly 20 additions, zero removals/changes; legacy=' + Object.keys(old).length + ' NOT RECERTIFIED');
for (const k of keys) {
 assert(en[k]===read(bundle+'/keys20.json')[k].english,'key source snapshot mismatch '+k);
 assert(JSON.stringify(context[k])===JSON.stringify(read(bundle+'/keys20.json')[k].context),'context snapshot mismatch '+k);
 const sourceAST = parse(en[k]); const targetAST = parse(target[k]);
 assert(sourceAST.every(n=>n.type===0) && targetAST.every(n=>n.type===0),'unexpected ICU syntax '+k);
 assert(!/[{}<>`]/u.test(target[k]),'unexpected placeholders/markup '+k);
 const invisible=[...target[k]].filter(c=>/[\p{Cf}\p{Zl}\p{Zp}\u00a0\u202f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(c));
 assert(invisible.length===0,'invisible character '+k);
 const chars=[...target[k]].length;
 const cells=[...target[k]].reduce((n,c)=>n+(/[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(c)?2:1),0);
 console.log('KEY PASS ' + k + ' = '+JSON.stringify(target[k])+' chars='+chars+' estimated_cells='+cells+' ICU=literal invisible=none');
}
console.log('MECHANICAL PASS: production ICU parser for all 20 new English/target messages; no arguments, plurals/selects, markup, code or flags in scope. No full-suite/build/server/browser/ledger writes attempted.');
