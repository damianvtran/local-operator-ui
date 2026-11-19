// Re-derivable mechanical checks for the ui.browser.media_permission audit
// (audit id mp1843-a1). Read-only; run from the repository root:
//   node i18n/audits/evidence/<locale>/ui.browser.media_permission/mp1843-a1-<locale>/verify.mjs
// It checks every non-English locale (the same script is retained in each
// locale's bundle). It needs the repo's own `intl-messageformat` (pnpm tree);
// NODE_PATH may point at a node_modules directory when run from an export.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const { IntlMessageFormat } = require("intl-messageformat");
const { parse, TYPE } = require("@formatjs/icu-messageformat-parser");

const NS = "ui.browser.media_permission";
const DIR = "src/i18n/catalogues";
const LOCALES = ["es", "fr", "hi", "ru", "ur", "vi", "zh-CN"];
const read = (p) => readFileSync(p);
const sha = (p) => createHash("sha256").update(read(p)).digest("hex");
const en = JSON.parse(read(`${DIR}/en/${NS}.json`));

// Argument names and select-arm sets, recursively, so a dropped arm or a
// renamed placeholder is caught even inside a select branch.
function shape(ast, out = { args: new Set(), selects: {} }) {
	for (const el of ast) {
		if (el.value !== undefined && el.type !== TYPE.literal) out.args.add(el.value);
		if (el.type === TYPE.select) {
			out.selects[el.value] = Object.keys(el.options).sort().join("|");
			for (const opt of Object.values(el.options)) shape(opt.value, out);
		}
	}
	return out;
}
const sig = (s) => {
	const r = shape(parse(s));
	return JSON.stringify({ args: [...r.args].sort(), selects: r.selects });
};

let failures = 0;
const fail = (m) => {
	failures++;
	console.log("FAIL", m);
};
console.log("en", sha(`${DIR}/en/${NS}.json`));
console.log("context", sha(`${DIR}/en/${NS}.context.json`));
for (const locale of LOCALES) {
	const path = `${DIR}/${locale}/${NS}.json`;
	const cat = JSON.parse(read(path));
	console.log(`\n== ${locale} ${sha(path)}`);
	if (JSON.stringify(Object.keys(cat).sort()) !== JSON.stringify(Object.keys(en).sort()))
		fail(`${locale}: key set differs from English`);
	for (const [key, value] of Object.entries(cat)) {
		const short = key.slice(NS.length + 1);
		if (sig(value) !== sig(en[key])) fail(`${locale} ${short}: ICU shape differs`);
		if (value !== value.normalize("NFC")) fail(`${locale} ${short}: not NFC`);
		if (/[\u200e\u200f\u2066-\u2069\u202a-\u202e\ufeff]/u.test(value))
			fail(`${locale} ${short}: manual bidi/format control`);
		if (value !== value.trim() || / {2}/.test(value)) fail(`${locale} ${short}: padding`);
		if (/\bLocal Operator\b/.test(en[key]) && !value.includes("Local Operator"))
			fail(`${locale} ${short}: product name not kept verbatim`);
		if (/macOS/.test(en[key]) && !value.includes("macOS"))
			fail(`${locale} ${short}: macOS not kept verbatim`);
		const arms = /devices/.test(value) ? ["audio", "video", "both"] : [null];
		for (const devices of arms) {
			const out = new IntlMessageFormat(value, locale).format({
				site: "meet.google.com",
				devices: devices ?? "both",
			});
			console.log(`  ${short}${devices ? `[${devices}]` : ""}: ${out}`);
			if (/[{}]/.test(out)) fail(`${locale} ${short}: unresolved brace in output`);
			if (value.includes("{site}") && !out.includes("meet.google.com"))
				fail(`${locale} ${short}: site not rendered`);
		}
	}
}
console.log(`\nverify: ${failures ? `FAILED ${failures}` : "ok"}`);
process.exit(failures ? 1 : 0);
