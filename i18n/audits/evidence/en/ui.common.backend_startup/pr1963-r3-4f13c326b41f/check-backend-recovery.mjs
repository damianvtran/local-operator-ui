import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const base = 'f879a8a3024299e863ee3113eac854a0ac38944e';
const head = '3fbc7703cda0eb8dcbf42c4156f92facc4ae735b';
const ns = 'ui.common.backend_startup';
const keys = ['crashed', 'exited', 'unknown', 'stopped'].map(k => `${ns}.reason.${k}`).sort();
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const blob = (ref, file) => git('show', `${ref}:${file}`);
const manifest = JSON.parse(blob(head, 'i18n/languages.json'));
const locales = manifest.languages.filter(l => ['source', 'supported'].includes(l.status)).map(l => l.code);
assert.deepEqual([...locales].sort(), ['en', 'es', 'fr', 'hi', 'ru', 'ur', 'vi', 'zh-CN']);
const cat = (l) => `src/i18n/catalogues/${l}/${ns}.json`;
assert.deepEqual(git('diff', '--name-only', base, head).trim().split('\n').sort(), locales.map(cat).sort());
const dep = join(root, 'node_modules', 'intl-messageformat');
const { IntlMessageFormat } = await import(pathToFileURL(join(dep, 'index.js')));
console.log(`Node ${process.version}, ICU ${process.versions.icu}, intl-messageformat ${JSON.parse(readFileSync(join(dep,'package.json'))).version}`);
console.log(`Scope ${base}..${head}; manifest ${locales.length} locales; only eight catalogue files change.`);
const canonical = (s, l) => s.toLocaleLowerCase(l);
const forbidden = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const verifyValue = ({text, before, restart, copy, help, locale}) => {
 assert.ok(text.includes(restart));
 assert.ok(canonical(text, locale).endsWith(canonical(help, locale)));
 const anchor = canonical(text, locale).lastIndexOf(canonical(copy, locale));
 assert.ok(anchor >= 0);
 assert.equal(text.slice(0, anchor + copy.length), before.slice(0, anchor + copy.length), 'original reason, restart and retry condition preserved before the share instruction');
 assert.ok(text.length < before.length);
 assert.equal(text.normalize('NFC'), text);
 assert.doesNotMatch(text, forbidden);
 const message = new IntlMessageFormat(text, locale);
 assert.ok(message.getAst().every(element => element.type === 0), 'no ICU arguments, tags or arms');
 assert.equal(message.format(), text);
};
const markers = {
 en: ['Restart the server', 'copy the diagnostics'],
 es: ['Reinicia el servidor', 'copia el diagnóstico'],
 fr: ['Redémarrez le serveur', 'copiez les diagnostics'],
 hi: ['सर्वर दोबारा शुरू करें', 'डायग्नॉस्टिक्स कॉपी करें'],
 ru: ['Перезапустите сервер', 'скопируйте диагностику'],
 ur: ['سرور دوبارہ شروع کریں', 'تشخیصی معلومات نقل کریں'],
 vi: ['khởi động lại máy chủ', 'sao chép thông tin chẩn đoán'],
 'zh-CN': ['重启服务器', '复制诊断信息'],
};
let checked = 0;
for (const locale of locales) {
 const old = JSON.parse(blob(base, cat(locale)));
 const current = JSON.parse(blob(head, cat(locale)));
 assert.deepEqual(Object.keys(old), Object.keys(current));
 assert.deepEqual(Object.keys(current).filter(k => current[k] !== old[k]).sort(), keys);
 const escalation = new IntlMessageFormat(current[`${ns}.repeated_failures`], locale).format({ count: 2 });
 const delimiter = {'zh-CN': '。', hi: '। ', ur: '۔ '}[locale] ?? '. ';
 assert.ok(escalation.includes(delimiter), `escalation sentence delimiter for ${locale}`);
 const help = escalation.slice(escalation.indexOf(delimiter) + delimiter.length);
 const [restart, copy] = markers[locale];
 assert.ok(canonical(help, locale).includes(canonical(copy, locale)));
 // Hindi/Urdu put the help purpose ahead of the copy verb; compare the
 // invariant fact/restart/condition through the preceding separator instead.
 const prefixAnchor = ['hi', 'ur'].includes(locale) ? (locale === 'hi' ? ' तो ' : ' تو ') : copy;
 for (const key of keys) {
  const input = {text: current[key], before: old[key], restart, copy: prefixAnchor, help, locale};
  assert.ok(canonical(current[key], locale).includes(canonical(copy, locale)));
  verifyValue(input);
  assert.throws(() => verifyValue({...input, text: current[key] + ' stderr'}), {name: 'AssertionError'});
  checked++;
 }
 console.log(`${locale}: 4/4 literal ICU renders; original recovery/condition preserved; matches escalation CTA: ${help}`);
}
console.log(`PASS: ${checked} changed values, ${checked} drift negative controls, 0 off-scope key changes, 0 non-catalogue paths.`);
