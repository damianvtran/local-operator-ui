/**
 * s16d vi auditor checker — drives the APP's own formatter path for the 4 new
 * `ui.common.time` keys: real Intl arguments for vi, real intl-messageformat
 * composition, plus negative controls on in-memory mutants.
 * Read-only on the repo; reads intl-messageformat from the shared worktree.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(
	"/Users/damian/local-operator-ui/.worktrees/i18n-s16d/package.json",
);
const { IntlMessageFormat } = require("intl-messageformat");

const LOCALE = "vi";

// English source (src/i18n/catalogues/en/ui.common.time.json @ dcdcb6a9)
const EN = {
	"ui.common.time.yesterday_at": "Yesterday {time}",
	"ui.common.time.today_at": "Today {time}",
	"ui.common.time.yesterday": "Yesterday",
	"ui.common.time.weekday_at": "{weekday} {time}",
	"ui.common.time.date_at": "{date}, {time}",
};

// CANDIDATE (vi-s16d.json, sha256 303a1bc3a27a8860…)
const CAND = {
	"ui.common.time.today_at": "Hôm nay lúc {time}",
	"ui.common.time.yesterday": "Hôm qua",
	"ui.common.time.weekday_at": "{weekday} lúc {time}",
	"ui.common.time.date_at": "{date} lúc {time}",
};

// Already-landed sibling in the vi catalogue (precedent)
const LANDED = { "ui.common.time.yesterday_at": "Hôm qua lúc {time}" };

const CLOCK = { hour: "numeric", minute: "2-digit" };
const WEEKDAY = { weekday: "long" };
const LONG_DATE = { day: "numeric", month: "long", year: "numeric" };

const fmt = (opts) => new Intl.DateTimeFormat(LOCALE, opts);
const clock = fmt(CLOCK);
const weekday = fmt(WEEKDAY);
const longDate = fmt(LONG_DATE);

const now = new Date(2026, 10, 12, 14, 30, 0); // 2026-11-12 14:30 local
const sameDay = new Date(2026, 10, 12, 9, 5, 0);
const yday = new Date(2026, 10, 11, 23, 50, 0);
const midweek = new Date(2026, 10, 9, 15, 42, 0); // Monday
const older = new Date(2026, 10, 5, 14, 30, 0);

let fails = 0;
const bad = (m) => {
	fails++;
	console.log("FAIL", m);
};

const ARG_SETS = [
	["today", sameDay],
	["yesterday", yday],
	["weekday", midweek],
	["date", older],
];
const argsFor = (d) => ({
	time: clock.format(d),
	weekday: weekday.format(d),
	date: longDate.format(d),
});

console.log("=== ICU arguments the app supplies (vi) ===");
for (const [tag, d] of ARG_SETS) {
	const a = argsFor(d);
	console.log(
		`${tag.padEnd(10)} time=${JSON.stringify(a.time)} weekday=${JSON.stringify(a.weekday)} date=${JSON.stringify(a.date)}`,
	);
}

console.log("\n=== composed output per key (vi) ===");
const rendered = {};
const KEY_BY_SCENE = {
	today: "ui.common.time.today_at",
	yesterday: "ui.common.time.yesterday_at",
	weekday: "ui.common.time.weekday_at",
	date: "ui.common.time.date_at",
};
for (const [tag, d] of ARG_SETS) {
	const key = KEY_BY_SCENE[tag];
	const msg = CAND[key] ?? LANDED[key];
	const out = new IntlMessageFormat(msg, LOCALE).format(argsFor(d));
	rendered[key] = out;
	console.log(`${key.padEnd(28)} ${JSON.stringify(out)}`);
}
const standalone = new IntlMessageFormat(
	CAND["ui.common.time.yesterday"],
	LOCALE,
).format({});
rendered["ui.common.time.yesterday"] = standalone;
console.log(`${"ui.common.time.yesterday".padEnd(28)} ${JSON.stringify(standalone)}`);

// ---- checks -------------------------------------------------------------
console.log("\n=== checks ===");
const names = (s) =>
	[...s.matchAll(/\{\s*([A-Za-z0-9_]+)\s*(?:,\s*\w+)?[^}]*\}/g)]
		.map((m) => m[1])
		.sort();

// An English-token check: any ASCII word token that the English value itself
// uses (>=3 chars, ignoring placeholders) appearing in the target is leftover
// English. Vietnamese text is Latin-script, so a byte-level "has Latin" test
// cannot answer this; a token comparison can.
const enWords = (s) =>
	new Set(
		(s.replace(/\{\w+\}/g, " ").match(/[A-Za-z]{3,}/g) ?? []).map((w) =>
			w.toLowerCase(),
		),
	);
const englishLeft = (en, v) => {
	const toks = (v.replace(/\{\w+\}/g, " ").match(/[A-Za-z]{3,}/g) ?? []).map((w) =>
		w.toLowerCase(),
	);
	return toks.filter((w) => enWords(en).has(w));
};

for (const [k, v] of Object.entries(CAND)) {
	const en = EN[k];
	// 1. placeholder identity
	const a = names(en),
		b = names(v);
	if (JSON.stringify(a) !== JSON.stringify(b)) bad(`${k}: placeholders ${b} vs en ${a}`);
	// 2. NFC
	if (v.normalize("NFC") !== v) bad(`${k}: not NFC`);
	// 3. bidi controls beyond precedent
	const ctrl = [...v].filter((c) => /\p{Cf}/u.test(c));
	const enCtrl = [...en].filter((c) => /\p{Cf}/u.test(c));
	if (ctrl.length !== enCtrl.length) bad(`${k}: bidi/format controls ${ctrl.length} vs en ${enCtrl.length}`);
	// 4. no leftover English
	const left = englishLeft(en, v);
	if (left.length) bad(`${k}: English tokens left ${left} in ${JSON.stringify(v)}`);
	// 5. renders without throwing, no ICU error markers
	const out = rendered[k];
	if (out === undefined) bad(`${k}: did not render`);
	else if (/\{|}|^ui\.common/.test(out)) bad(`${k}: unresolved placeholder or key fallback in ${JSON.stringify(out)}`);
}
if (fails === 0) console.log("PASS: placeholders identical, NFC, no extra controls, all keys render");

// ---- negative controls on in-memory mutants ------------------------------
console.log("\n=== negative controls (must FAIL the same checks) ===");
const mutants = [
	["dropped placeholder (today_at)", "ui.common.time.today_at", "Hôm nay"],
	["renamed placeholder", "ui.common.time.today_at", "Hôm nay lúc {clock}"],
	["English left", "ui.common.time.today_at", "Today lúc {time}"],
	["NFD form", "ui.common.time.yesterday", "Hôm qua".normalize("NFD")],
	["RLM smuggled", "ui.common.time.yesterday", "Hôm\u200Fqua"],
];
for (const [tag, key, val] of mutants) {
	let ph = null,
		nfc = ok => ok,
		ctrl = 0;
	try {
		ph = JSON.stringify(names(val)) === JSON.stringify(names(EN[key])) ? "same" : "diff";
	} catch {
		ph = "throw";
	}
	const isNfc = val.normalize("NFC") === val;
	ctrl = [...val].filter((c) => /\p{Cf}/u.test(c)).length;
	let render = "ok";
	try {
		new IntlMessageFormat(val, LOCALE).format({ time: "14:30", weekday: "Thứ Hai", date: "5 tháng 11, 2026" });
	} catch (e) {
		render = "THROW";
	}
	const left = englishLeft(EN[key], val);
	const caught = ph !== "same" || !isNfc || ctrl > 0 || left.length > 0;
	console.log(
		`${caught ? "caught " : "MISSED "} ${tag.padEnd(32)} ph=${ph} nfc=${isNfc} ctrl=${ctrl} english=${left.join(",") || "-"} render=${render}`,
	);
	if (!caught) bad(`negative control not caught: ${tag}`);
}

// ---- width -------------------------------------------------------------
console.log("\n=== width (cells, display width) ===");
const cell = (s) => [...s].reduce((n, c) => n + (c.codePointAt(0) > 0x1100 ? 2 : 1), 0);
for (const [k, v] of Object.entries(rendered)) {
	console.log(`${k.padEnd(28)} cells=${cell(v)} ${JSON.stringify(v)}`);
}
const longest = Math.max(...Object.values(rendered).map(cell));
console.log("longest rendered:", longest, "cells (en longest:", Math.max(cell("Yesterday 11:50 PM"), cell("November 5, 2026, 2:30 PM")), ")");

console.log("\nfails =", fails);
process.exit(fails ? 1 : 0);
