/**
 * s16d fr audit checker (independent auditor, READ-ONLY).
 *
 * Runs the app's OWN formatter path end to end: the real `formatDividerLabel`
 * (message-grouping), the real `formatMessageDateTime` (date-utils), the real
 * `t()` + IntlMessageFormat (messages.ts), with the fr candidate values
 * registered as the fr catalogue and the locale set to fr. Nothing is written;
 * esbuild runs with write:false and imports the bundle from a data: URL.
 *
 * Checks: placeholder parity (ICU AST, not regex), no throws, NFC, no bidi
 * controls beyond precedent, composed-output grid, and negative controls on
 * in-memory mutants that MUST fail.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

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

const CANDIDATE = {
	"ui.common.time.today_at": "Aujourd\u2019hui \u00e0 {time}",
	"ui.common.time.yesterday": "Hier",
	"ui.common.time.weekday_at": "{weekday} \u00e0 {time}",
	"ui.common.time.date_at": "{date} \u00e0 {time}",
	// sibling already landed in the repo (context for consistency, not audited)
	"ui.common.time.yesterday_at": "Hier \u00e0 {time}",
};
const ENGLISH = {
	"ui.common.time.today_at": "Today {time}",
	"ui.common.time.yesterday": "Yesterday",
	"ui.common.time.weekday_at": "{weekday} {time}",
	"ui.common.time.date_at": "{date}, {time}",
	"ui.common.time.yesterday_at": "Yesterday {time}",
};

const reset = () => {
	clearRegisteredCatalogues();
	setLocale("en");
};
setLocale("fr");
registerCatalogue("fr", CANDIDATE);

/* ---------- 1. placeholder parity through the ICU AST ---------- */
const argsOf = (msg) => {
	const out = [];
	const walk = (els) => {
		for (const el of els ?? []) {
			if (el.type === 1) out.push(`#${el.value}`); // argument
			if (el.type === 2) out.push(`#${el.value}`); // number
			if (el.type === 3) out.push(`%${el.value}`); // date
			if (el.type === 4) out.push(`&${el.value}`); // time
			if (el.type === 6) {
				out.push(`plural(${el.value})`);
				walk(el.options && Object.values(el.options).flatMap((o) => o.value));
			}
			if (el.type === 5) {
				out.push(`select(${el.value})`);
				walk(el.options && Object.values(el.options).flatMap((o) => o.value));
			}
			if (el.value && Array.isArray(el.value) && el.type !== 1) walk(el.value);
		}
	};
	walk(parse(msg, { requiresOtherClause: false }));
	return out.sort();
};

const lines = [];
const fail = [];
const ok = (cond, label, detail = "") => {
	lines.push(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	if (!cond) fail.push(label);
};

lines.push("== 1. placeholder parity (ICU AST) ==");
for (const key of Object.keys(ENGLISH)) {
	const en = argsOf(ENGLISH[key]);
	const fr = argsOf(CANDIDATE[key]);
	ok(
		JSON.stringify(en) === JSON.stringify(fr),
		`${key} args`,
		`en ${JSON.stringify(en)} / fr ${JSON.stringify(fr)}`,
	);
}

lines.push("\n== 1b. ICU parses + no plural/select cats to police ==");
for (const [key, value] of Object.entries(CANDIDATE)) {
	let threw = null;
	try {
		parse(value);
	} catch (e) {
		threw = String(e.message ?? e);
	}
	ok(threw === null, `${key} parses`, threw ?? "");
	ok(!/\{\s*\w+\s*,\s*(plural|select)/.test(value), `${key} has no plural/select`, "");
}

lines.push("\n== 1c. typography / encoding ==");
for (const [key, value] of Object.entries(CANDIDATE)) {
	ok(value === value.normalize("NFC"), `${key} NFC`, "");
	ok(!/[\u2066-\u2069\u200e\u200f\u202a-\u202e]/.test(value), `${key} no bidi controls`, "");
	ok(!/'/.test(value), `${key} no U+0027 apostrophe`, "");
	ok(!/  /.test(value), `${key} no double space`, "");
}
ok(CANDIDATE["ui.common.time.today_at"].includes("\u2019"), "today_at uses U+2019", "");

/* ---------- 2. real formatter grid: fr ---------- */
lines.push("\n== 2. composed output, fr (real Intl, real t()) ==");
const CLOCK = { hour: "numeric", minute: "2-digit" };
const WEEKDAY = { weekday: "long" };
const LONG_DATE = { day: "numeric", month: "long", year: "numeric" };

const probe = new Date(2026, 10, 9, 14, 30); // Monday 9 Nov 2026, 14:30 local
lines.push(`raw components for 2026-11-09T14:30 local:`);
lines.push(`  time    = ${JSON.stringify(mod.formatTime(probe, CLOCK))}`);
lines.push(`  weekday = ${JSON.stringify(mod.formatDate(probe, WEEKDAY))}`);
lines.push(`  date    = ${JSON.stringify(mod.formatDate(probe, LONG_DATE))}`);

const now = new Date(2026, 10, 12, 9, 15); // Thu 12 Nov 2026
const dayOff = (n, h = 14, m = 30) => {
	const d = new Date(now);
	d.setDate(now.getDate() - n);
	d.setHours(h, m, 0, 0);
	return d;
};
for (const [label, date] of [
	["today 14:30", dayOff(0)],
	["today 09:05", dayOff(0, 9, 5)],
	["yesterday 18:07", dayOff(1, 18, 7)],
	["2 days ago (weekday)", dayOff(2)],
	["5 days ago (weekday)", dayOff(5)],
	["8 days ago (date)", dayOff(8)],
	["40 days ago (date)", dayOff(40)],
]) {
	const out = mod.formatDividerLabel(date, now);
	lines.push(`  ${label.padEnd(22)} -> ${JSON.stringify(out)}`);
}

lines.push("\n  standalone hover label (formatMessageDateTime, yesterday):");
const yLabel = mod.formatMessageDateTime(dayOff(1, 18, 7));
lines.push(`  formatMessageDateTime(yesterday) -> ${JSON.stringify(yLabel)}`);
const tLabel = mod.formatMessageDateTime(dayOff(0, 14, 30));
lines.push(`  formatMessageDateTime(today)     -> ${JSON.stringify(tLabel)}`);

lines.push("\n  direct t() with real args:");
const time = mod.formatTime(probe, CLOCK);
lines.push(`  t(today_at)   -> ${JSON.stringify(t("ui.common.time.today_at", { time }))}`);
lines.push(`  t(yesterday)  -> ${JSON.stringify(t("ui.common.time.yesterday"))}`);
lines.push(
	`  t(weekday_at) -> ${JSON.stringify(t("ui.common.time.weekday_at", { weekday: mod.formatDate(probe, WEEKDAY), time }))}`,
);
lines.push(
	`  t(date_at)    -> ${JSON.stringify(t("ui.common.time.date_at", { date: mod.formatDate(probe, LONG_DATE), time }))}`,
);

lines.push("\n== 2b. no English left in the composed divider labels ==");
const englishRe = /\b(Today|Yesterday|Monday|November|AM|PM)\b/;
for (const [label, date] of [
	["today", dayOff(0)],
	["yesterday", dayOff(1)],
	["weekday", dayOff(2)],
	["date", dayOff(8)],
]) {
	const out = mod.formatDividerLabel(date, now);
	ok(!englishRe.test(out), `no English word in ${label}`, out);
	ok(!/[AP]M\b/.test(out), `no en hour cycle in ${label}`, out);
}

/* ---------- 3. negative controls on mutants ---------- */
lines.push("\n== 3. negative controls (each mutant MUST be caught) ==");
const control = (name, mutant, key) => {
	const en = argsOf(ENGLISH[key]);
	let caught = false;
	let why = "";
	try {
		const fr = argsOf(mutant);
		if (JSON.stringify(en) !== JSON.stringify(fr)) {
			caught = true;
			why = `args ${JSON.stringify(fr)}`;
		}
	} catch (e) {
		caught = true;
		why = "parse threw";
	}
	ok(caught, `control catches: ${name}`, why);
};
control("dropped placeholder", "Aujourd\u2019hui \u00e0", "ui.common.time.today_at");
control("renamed placeholder", "Aujourd\u2019hui \u00e0 {heure}", "ui.common.time.today_at");
control("added placeholder", "{date} \u00e0 {time} le {weekday}", "ui.common.time.date_at");
// English-left-behind and NFD are caught by the text-level checks
ok(
	/\bToday\b/.test("Today \u00e0 {time}"),
	"control catches: English word left (regex)",
	"",
);
ok(
	"Aujourd\u0027hui \u00e0 {time}" !== "Aujourd\u0027hui \u00e0 {time}".normalize("NFC") ||
		/'/.test("Aujourd\u0027hui \u00e0 {time}"),
	"control catches: ASCII apostrophe (regex)",
	"",
);
const nfd = "Aujourd\u2019hui a\u0300 {time}";
ok(nfd !== nfd.normalize("NFC"), "control catches: NFD decomposed accent", "");

/* ---------- 4. ur-shaped sibling sanity: fr untouched by bidi ---------- */
lines.push("\n== 4. LTR locale is not bidi-wrapped ==");
for (const [key, value] of Object.entries(CANDIDATE)) {
	const out = t(key, key.includes("weekday") ? { weekday: "lundi", time: "14:30" } : key.includes("date") ? { date: "9 novembre 2026", time: "14:30" } : key === "ui.common.time.yesterday" ? undefined : { time: "14:30" });
	ok(!/[\u2066-\u2069]/.test(out), `${key} not isolated`, JSON.stringify(out));
}

reset();

console.log(lines.join("\n"));
console.log(`\n== SUMMARY: ${fail.length === 0 ? "ALL PASS" : `${fail.length} FAIL`} ==`);
process.exit(fail.length === 0 ? 0 : 1);
