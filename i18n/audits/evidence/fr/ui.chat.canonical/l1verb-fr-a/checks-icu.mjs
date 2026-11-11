/**
 * L1 tool-row verbs (fr, pass A) — ICU / placeholder parity.
 *
 * Run from the local-operator-ui worktree root so `@formatjs/icu-messageformat-parser`
 * and `intl-messageformat` (the app's own dependencies) resolve:
 *
 *   PREP_DIR=<_l1-prep dir> node --input-type=module -e "$(cat <this file>)"
 *
 * Proves: every en value and its fr counterpart parse as ICU, and the element
 * signature (literal / argument, with its name) is identical. This slice has no
 * placeholders at all, so a clean run also proves none was invented or dropped.
 */
import { readFileSync } from 'node:fs';
import { parse } from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';

const prep = process.env.PREP_DIR || '.';
const keys = JSON.parse(readFileSync(`${prep}/keys.json`, 'utf8'));
const fr = JSON.parse(readFileSync(`${prep}/fr.json`, 'utf8'));
const sig = (els) => JSON.stringify(els.map((e) => (e.type === 1 ? ['arg', e.value] : ['lit'])));

let bad = [];
let n = 0;
for (const k of Object.keys(keys)) {
	n++;
	let a;
	let b;
	try {
		a = parse(keys[k].en, { requiresOtherClause: true });
	} catch (e) {
		bad.push([k, 'EN parse', e.message]);
		continue;
	}
	try {
		b = parse(fr[k], { requiresOtherClause: true });
	} catch (e) {
		bad.push([k, 'FR parse', e.message]);
		continue;
	}
	if (sig(a) !== sig(b)) bad.push([k, 'placeholder/element mismatch', `${sig(a)} vs ${sig(b)}`]);
}
console.log(`parsed ${n} keys; ICU/placeholder problems: ${bad.length}`);
for (const b of bad) console.log(' ', b.join(' | '));

let failures = 0;
for (const [k, v] of Object.entries(fr)) {
	try {
		new IntlMessageFormat(v, 'fr');
	} catch (e) {
		failures++;
		console.log('FR format fail', k, e.message);
	}
}
console.log(`IntlMessageFormat(fr) failures: ${failures}`);
