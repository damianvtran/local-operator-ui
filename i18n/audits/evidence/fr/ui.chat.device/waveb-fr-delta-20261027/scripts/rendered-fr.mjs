/**
 * Wave-B delta audit (fr) — RENDERED pass over the shipped tree.
 *
 * WHY A SECOND RENDER PASS. The mechanical pass (icu-audit.mjs) parses and
 * formats the raw catalogue values with `IntlMessageFormat` directly. This one
 * goes through the module the app actually calls: `src/i18n/messages.t()` with
 * `setLocale("fr")`, bundled from the checkout by esbuild the same way
 * `scripts/i18n/activation.test.mjs`'s "shipped tree" block does. It answers a
 * different question - does the value the catalogue holds actually reach the
 * screen in French, with its placeholders filled and its ICU quoting resolved -
 * and it prints every rendered string so the audit report can quote them.
 *
 * It also exercises the locale's plural categories through the real path
 * (0, 1, 2, 1000, 1000000, 1000001) on the one plural key in the wave.
 */
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const CWD = process.cwd();
const ROOT = CWD;
const manifest = JSON.parse(
	readFileSync(`${process.env.LOCAL_OPERATOR_SCRATCHPAD}/wave-b-delta-fr/wave-b-keys.json`, 'utf8'),
);

const bundle = await build({
	stdin: {
		contents: [
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
		].join('\n'),
		resolveDir: ROOT,
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const { messages, locale } = mod;

/** Values for every placeholder the wave's keys declare (count/name/label/...). */
const PARAMS = {
	count: 3,
	name: 'atelier',
	label: 'Anthropic',
	value: '--flag',
	command: '/model',
	prefix: '/mo',
	max: 4,
	formatvalue: '1 234',
	formatwindow: '200 000',
	formatpercent: '0 %',
	formatcontexttokens: '1 234',
	min: 1,
	liveversion: '1.0.0',
	detail: 'atelier',
	restartdrainbound: '2 min',
	shownselector: 'Claude',
	activelabel: 'Anthropic',
	retargetedlabel: 'Anthropic',
};

locale.setLocale('fr');
const rows = [];
for (const [namespace, keys] of Object.entries(manifest)) {
	for (const key of keys) {
		const rendered = messages.t(key, PARAMS);
		const english = messages.translate(key, PARAMS, 'en');
		rows.push({
			namespace,
			key,
			fr: rendered,
			en: english,
			keyEcho: rendered === key,
			leftoverBrace: /[{}]/.test(rendered),
		});
	}
}

// The plural key through the real path, at the values the fr guide names.
const pluralKey = 'ui.chat.device.row.conversations';
const plurals = {};
for (const count of [0, 1, 2, 1000, 1000000, 1500000, 1000001]) {
	plurals[count] = messages.t(pluralKey, { count });
}

const failures = rows.filter((row) => row.keyEcho || row.leftoverBrace);
const output = {
	renderedKeys: rows.length,
	failures,
	plurals,
	rows,
};
writeFileSync(
	`${process.env.LOCAL_OPERATOR_SCRATCHPAD}/wave-b-delta-fr/rendered-fr.json`,
	JSON.stringify(output, null, 1),
);
console.log(
	JSON.stringify({ renderedKeys: rows.length, failures: failures.length, plurals }, null, 1),
);
if (failures.length > 0) process.exitCode = 1;
