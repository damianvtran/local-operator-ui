// Re-derivable mechanical checks for the ui.browser.media_access audit
// (audit id mp1843-a3). Read-only; run from the repository root:
//   node i18n/audits/evidence/<locale>/ui.browser.media_access/mp1843-a3-<locale>/verify.mjs
// It checks every non-English locale (the same script is retained in each
// locale's bundle). It needs the repo's own `intl-messageformat` (pnpm tree);
// NODE_PATH may point at a node_modules directory when run from an export.
// Beyond the round-1 (mp1843-a1) checks it binds this namespace to the
// already-audited ui.browser.media_permission copy shown in the same band:
// the "other" arms of prompt_label/prompt_dismiss must equal that namespace's
// label/dismiss, blocked_hint must name its Allow button verbatim, and both
// System Settings strings must reuse its localized System Settings name.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const { IntlMessageFormat } = require("intl-messageformat");
const { parse, TYPE } = require("@formatjs/icu-messageformat-parser");

const NS = "ui.browser.media_access";
const SIBLING = "ui.browser.media_permission";
const DIR = "src/i18n/catalogues";
const LOCALES = ["es", "fr", "hi", "ru", "ur", "vi", "zh-CN"];
const MACOS_NAMES = {
	es: ["Ajustes del Sistema", "Privacidad y seguridad"],
	fr: ["Réglages Système", "Confidentialité et sécurité"],
	hi: ["सिस्टम सेटिंग्ज़", "गोपनीयता और सुरक्षा"],
	ru: ["Системные настройки", "Конфиденциальность и безопасность"],
	ur: ["System Settings", "Privacy & Security"],
	vi: ["Cài đặt hệ thống", "Quyền riêng tư & Bảo mật"],
	"zh-CN": ["系统设置", "隐私与安全性"],
};
const read = (p) => readFileSync(p);
const sha = (p) => createHash("sha256").update(read(p)).digest("hex");
const en = JSON.parse(read(`${DIR}/en/${NS}.json`));

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
const fmt = (value, locale, devices) =>
	new IntlMessageFormat(value, locale).format({ site: "meet.google.com", devices });

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
	const sib = JSON.parse(read(`${DIR}/${locale}/${SIBLING}.json`));
	console.log(`\n== ${locale} ${sha(path)} (sibling ${SIBLING} ${sha(`${DIR}/${locale}/${SIBLING}.json`)})`);
	if (JSON.stringify(Object.keys(cat).sort()) !== JSON.stringify(Object.keys(en).sort()))
		fail(`${locale}: key set differs from English`);
	for (const [key, value] of Object.entries(cat)) {
		const short = key.slice(NS.length + 1);
		if (!(key in en)) continue;
		if (sig(value) !== sig(en[key])) fail(`${locale} ${short}: ICU shape differs`);
		if (value !== value.normalize("NFC")) fail(`${locale} ${short}: not NFC`);
		if (/[\u200e\u200f\u2066-\u2069\u202a-\u202e\ufeff]/u.test(value))
			fail(`${locale} ${short}: manual bidi/format control`);
		if (value !== value.trim() || / {2}/.test(value)) fail(`${locale} ${short}: padding`);
		if (/\bLocal Operator\b/.test(en[key]) && !value.includes("Local Operator"))
			fail(`${locale} ${short}: product name not kept verbatim`);
		if (/macOS/.test(en[key]) && !value.includes("macOS"))
			fail(`${locale} ${short}: macOS not kept verbatim`);
		if (locale === "fr" && / [:;!?]/.test(value))
			fail(`${locale} ${short}: U+0020 before : ; ! ? (fr guide requires U+202F)`);
		const arms = /devices/.test(value) ? ["audio", "video", "other"] : [null];
		for (const devices of arms) {
			const out = fmt(value, locale, devices ?? "other");
			console.log(`  ${short}${devices ? `[${devices}]` : ""}: ${out}`);
			if (/[{}]/.test(out)) fail(`${locale} ${short}: unresolved brace in output`);
			if (value.includes("{site}") && !out.includes("meet.google.com"))
				fail(`${locale} ${short}: site not rendered`);
		}
	}
	// Consistency with the audited sibling namespace rendered in the same band.
	const other = (k) => fmt(cat[`${NS}.${k}`], locale, "other");
	if (other("prompt_label") !== sib[`${SIBLING}.label`])
		fail(`${locale} prompt_label[other] differs from ${SIBLING}.label`);
	if (other("prompt_dismiss") !== sib[`${SIBLING}.dismiss`])
		fail(`${locale} prompt_dismiss[other] differs from ${SIBLING}.dismiss`);
	const allow = sib[`${SIBLING}.allow`];
	// Checked per formatted arm: since round-2 remediation blocked_hint is a
	// devices select, and one arm could drop the button name.
	for (const devices of ["audio", "video", "other"])
		if (!fmt(cat[`${NS}.blocked_hint`], locale, devices).includes(allow))
			fail(`${locale} blocked_hint[${devices}] does not name the Allow button (${allow})`);
	// macOS pane path as the auditor recorded it (Apple's localized names; ur
	// keeps English per its style guide). Both hints must carry it verbatim
	// and the button must reuse the System Settings name.
	const [settings, privacy] = MACOS_NAMES[locale];
	const panePath = `${settings} › ${privacy}`;
	if (!sib[`${SIBLING}.system_blocked_hint`].includes(panePath))
		fail(`${locale} ${SIBLING}.system_blocked_hint lacks "${panePath}"`);
	if (!cat[`${NS}.system_blocked_hint`].includes(panePath))
		fail(`${locale} system_blocked_hint lacks "${panePath}"`);
	if (!cat[`${NS}.open_system_settings`].includes(settings))
		fail(`${locale} open_system_settings lacks "${settings}"`);
	console.log(`  [consistency] label/dismiss/allow (${allow}) and "${panePath}" checked`);
}
console.log(`\nverify: ${failures ? `FAILED ${failures}` : "ok"}`);
process.exit(failures ? 1 : 0);
