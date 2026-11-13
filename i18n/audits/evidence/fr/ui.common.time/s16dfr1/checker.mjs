/**
 * s16d fr LANDED-BYTES confirmation checker (independent auditor, READ-ONLY).
 *
 * Unlike check-s16d-fr.mjs (which registered the pre-landing candidate dict),
 * this one reads the LANDED fr catalogue from disk and registers it verbatim,
 * then drives the app's own formatter path, so the rendered strings are what
 * the shipped file produces. Also re-derives the mechanical properties from the
 * file itself and compares the English/fr key sets.
 */
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const LANDED = "src/i18n/catalogues/fr/ui.common.time.json";
const EN = "src/i18n/catalogues/en/ui.common.time.json";
const fr = JSON.parse(readFileSync(LANDED, "utf8"));
const en = JSON.parse(readFileSync(EN, "utf8"));

const bundle = await build({
	stdin: {
		contents: `
			export { formatDividerLabel } from "./src/renderer/src/features/chat/utils/message-grouping";
			export { formatMessageDateTime } from "./src/renderer/src/shared/utils/date-utils";
			export { formatDate, formatTime } from "./src/i18n/format";
			export { clearRegisteredCatalogues, registerCatalogue, t } from "./src/i18n/messages";
			export { setLocale } from "./src/i18n/locale";
			export { parse } from "@formatjs/icu-messageformat-parser";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { "@shared": "./src/renderer/src/shared" },
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { setLocale, registerCatalogue, clearRegisteredCatalogues, t, parse } = mod;

const lines = [];
const fail = [];
const ok = (cond, label, detail = "") => {
	lines.push(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	if (!cond) fail.push(label);
};

/* ---------- key set, from the two files on disk ---------- */
lines.push("== A. key-set equality (landed fr vs landed en) ==");
const enKeys = Object.keys(en).sort();
const frKeys = Object.keys(fr).sort();
ok(
	JSON.stringify(enKeys) === JSON.stringify(frKeys),
	"fr key set equals en",
	`missing ${enKeys.filter((k) => !frKeys.includes(k)).length}, extra ${frKeys.filter((k) => !enKeys.includes(k)).length}`,
);
ok(frKeys.length === 5, "5 keys", String(frKeys.length));

/* ---------- placeholder parity from the AST ---------- */
const argsOf = (msg) => {
	const out = [];
	const walk = (els) => {
		for (const el of els ?? []) {
			if (el.type === 1) out.push(`#${el.value}`);
			if (el.type === 6) {
				out.push(`plural(${el.value})`);
				walk(Object.values(el.options ?? {}).flatMap((o) => o.value));
			}
			if (el.type === 5) {
				out.push(`select(${el.value})`);
				walk(Object.values(el.options ?? {}).flatMap((o) => o.value));
			}
		}
	};
	walk(parse(msg, { requiresOtherClause: false }));
	return out.sort();
};
lines.push("\n== B. placeholder parity, landed bytes ==");
for (const key of enKeys) {
	let e, f;
	try {
		e = argsOf(en[key]);
		f = argsOf(fr[key]);
		ok(JSON.stringify(e) === JSON.stringify(f), `${key} args`, `${JSON.stringify(e)} / ${JSON.stringify(f)}`);
	} catch (err) {
		ok(false, `${key} parses`, String(err.message ?? err));
	}
	ok(!/\{\s*\w+\s*,\s*(plural|select)/.test(fr[key]), `${key} no plural/select`);
}

/* ---------- encoding from the landed values ---------- */
lines.push("\n== C. encoding ==");
for (const key of frKeys) {
	const v = fr[key];
	ok(v === v.normalize("NFC"), `${key} NFC`);
	ok(!/[\u2066-\u2069\u200e\u200f]/.test(v), `${key} no bidi controls`);
	ok(!/\u0027/.test(v), `${key} no U+0027`);
	ok(!/  /.test(v), `${key} no double space`);
}

/* ---------- render the landed file through the app ---------- */
setLocale("fr");
clearRegisteredCatalogues();
registerCatalogue("fr", fr);

const CLOCK = { hour: "numeric", minute: "2-digit" };
const WEEKDAY = { weekday: "long" };
const LONG_DATE = { day: "numeric", month: "long", year: "numeric" };

const now = new Date(2026, 10, 12, 9, 15);
const dayOff = (n, h = 14, m = 30) => {
	const d = new Date(now);
	d.setDate(now.getDate() - n);
	d.setHours(h, m, 0, 0);
	return d;
};
const probe = dayOff(3);

lines.push("\n== D. composed output from the LANDED fr file (real Intl) ==");
lines.push(`  time=${JSON.stringify(mod.formatTime(probe, CLOCK))} weekday=${JSON.stringify(mod.formatDate(probe, WEEKDAY))} date=${JSON.stringify(mod.formatDate(probe, LONG_DATE))}`);
const grid = [
	["today", dayOff(0), "Aujourd’hui à 14:30"],
	["yesterday", dayOff(1, 18, 7), "Hier à 18:07"],
	["weekday", dayOff(2), "mardi à 14:30"],
	["old date", dayOff(8), "4 novembre 2026 à 14:30"],
];
for (const [label, d, expected] of grid) {
	const got = mod.formatDividerLabel(d, now);
	ok(got === expected, `${label} label exact`, JSON.stringify(got));
	ok(!/\b(Today|Yesterday|Monday|November|AM|PM)\b/.test(got), `${label} no English`, got);
}
ok(
	mod.formatMessageDateTime(dayOff(1, 18, 7)) === "Hier",
	"hover yesterday label",
	JSON.stringify(mod.formatMessageDateTime(dayOff(1, 18, 7))),
);
const yAt = t("ui.common.time.yesterday_at", { time: mod.formatTime(probe, CLOCK) });
ok(yAt === "Hier à 14:30", "sibling yesterday_at unchanged", JSON.stringify(yAt));

/* ---------- negative controls ---------- */
lines.push("\n== E. negative controls (each MUST be caught) ==");
const caught = (name, mutant, key) => {
	let isCaught = false;
	let why = "";
	try {
		if (JSON.stringify(argsOf(mutant)) !== JSON.stringify(argsOf(en[key]))) {
			isCaught = true;
			why = `args ${JSON.stringify(argsOf(mutant))}`;
		}
	} catch {
		isCaught = true;
		why = "parse threw";
	}
	ok(isCaught, `caught: ${name}`, why);
};
caught("dropped {time}", "Aujourd’hui à", "ui.common.time.today_at");
caught("renamed {heur}", "Aujourd’hui à {heur}", "ui.common.time.today_at");
caught("added {date}", "{date} à {time} le {weekday}", "ui.common.time.date_at");
ok(/\bToday\b/.test("Today à {time}"), "caught: English left (regex)");
const nfd = "Aujourd\u2019hui a\u0300 {time}";
ok(nfd !== nfd.normalize("NFC"), "caught: NFD decomposed accent");

clearRegisteredCatalogues();
setLocale("en");

console.log(lines.join("\n"));
console.log(`\n== SUMMARY: ${fail.length === 0 ? "ALL PASS" : `${fail.length} FAIL`} ==`);
if (fail.length) console.log(fail.join("\n"));
process.exit(fail.length === 0 ? 0 : 1);
