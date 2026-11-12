import { readFileSync } from 'node:fs';
const { IntlMessageFormat } = await import('/Users/damian/local-operator-ui/.worktrees/i18n-s16a/node_modules/intl-messageformat/index.js');
const draft = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const en = JSON.parse(readFileSync('/Users/damian/local-operator-ui/.worktrees/i18n-s16a/src/i18n/catalogues/en/ui.chat.canonical.json', 'utf8'));
const counts = [0, 1, 2, 3, 5, 11, 21, 22, 100, 1000000];
const mats = ['video', 'voiceover', 'sound_effect', 'other'];
const pr = new Intl.PluralRules('ru');
console.log('CLDR ru categories:', JSON.stringify(pr.resolvedOptions().pluralCategories));
console.log('category map:', counts.map((c) => `${c}=${pr.select(c)}`).join(' '));
const th = (msg) => new IntlMessageFormat(msg, 'ru');
const out = [];
const b = (id, msg, args) => {
  try {
    out.push(`${id} | ${JSON.stringify(args)} | ${th(msg).format(args)}`);
  } catch (e) {
    out.push(`${id} | ${JSON.stringify(args)} | ERROR ${e.message}`);
  }
};
for (const k of Object.keys(draft)) {
  const short = k.replace('ui.chat.canonical.', '');
  if (k.endsWith('composing_sized') || k.endsWith('queued_sized')) b(short, draft[k], { size: '12,4 КБ' });
  else if (k.endsWith('composing_empty') || k.endsWith('queued_empty') || k.endsWith('state.queued') || k.endsWith('writing_request') || k.endsWith('already_finished')) b(short, draft[k], {});
  else if (k.endsWith('queue_ahead')) for (const c of counts) b(short, draft[k], { count: c });
  else if (k.includes('running_batch')) for (const m of mats) for (const c of [1, 2, 3, 5, 11, 21, 22, 100, 1000000]) b(`${short}[${m}]`, draft[k], { material: m, total: c });
  else if (k.endsWith('state.running')) for (const m of mats) b(`${short}[${m}]`, draft[k], { material: m });
  else if (k.endsWith('state.done') || k.endsWith('done_batch') || k.endsWith('state.failed') || k.endsWith('failed_batch'))
    for (const m of mats) b(`${short}[${m}]`, draft[k], { material: m });
  else out.push(`UNHANDLED ${k}`);
}
console.log(out.join('\n'));
console.log('LEFTOVER_BRACES_LINES:', out.filter((l) => /[{}]/.test(l)).length);
const enNew = Object.keys(en).filter(
  (k) => /tool\.(composing|queued)_(sized|empty)$/.test(k) || k.startsWith('ui.chat.canonical.image_gen.state.'),
);
console.log('EN_NEW:', enNew.length, 'DRAFT:', Object.keys(draft).length,
  'MISSING:', JSON.stringify(enNew.filter((k) => !(k in draft))),
  'EXTRA:', JSON.stringify(Object.keys(draft).filter((k) => !enNew.includes(k))));
