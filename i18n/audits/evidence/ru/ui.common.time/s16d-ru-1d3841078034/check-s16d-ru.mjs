/**
 * s16d ru audit checker — independent auditor (read-only).
 *
 * Formats the 4 candidate `ui.common.time` values through the SAME ICU entry
 * point the app uses (`new IntlMessageFormat(message, locale)`, src/i18n/messages.ts:152)
 * with the REAL argument strings the app's live-locale formatter produces for
 * ru (probed separately with Intl.DateTimeFormat), then runs in-memory negative
 * controls to prove the checks are discriminating.
 *
 * Run: node check-s16d-ru.mjs   (node_modules symlinked into the mirror)
 */
import { createRequire } from "node:module";

const MIRROR =
	process.env.MIRROR ?? `${process.env.HOME}/.local-operator/sessions/1d3841078034/scratchpad/mirror`;
const require = createRequire(`${MIRROR}/package.json`);
const { IntlMessageFormat } = require("intl-messageformat");

const LOCALE = "ru";

// ---- the candidate values (byte-for-byte from ru-s16d.json) ---------------
const CANDIDATE = {
	"ui.common.time.today_at": "Сегодня в {time}",
	"ui.common.time.yesterday": "Вчера",
	"ui.common.time.weekday_at": "{weekday}, {time}",
	"ui.common.time.date_at": "{date} в {time}",
};
// existing sibling already on main, for consistency
const SIBLING = { "ui.common.time.yesterday_at": "Вчера в {time}" };

const EN = {
	"ui.common.time.today_at": "Today {time}",
	"ui.common.time.yesterday": "Yesterday",
	"ui.common.time.weekday_at": "{weekday} {time}",
	"ui.common.time.date_at": "{date}, {time}",
	"ui.common.time.yesterday_at": "Yesterday {time}",
};

// ---- the REAL arguments, as the app's formatter renders them for ru ------
// Intl.DateTimeFormat("ru", CLOCK).format(2026-11-05 14:30)
const ARGS_TIME = "14:30";
// Intl.DateTimeFormat("ru", {weekday:"long"}).format(Mon 2026-11-02)
const ARGS_WEEKDAY = "понедельник";
// Intl.DateTimeFormat("ru", {day,month:"long",year}).format(2026-11-05)
const ARGS_DATE = "5 ноября 2026 г.";

const ARGS = {
	"ui.common.time.today_at": { time: ARGS_TIME },
	"ui.common.time.yesterday": {},
	"ui.common.time.weekday_at": { weekday: ARGS_WEEKDAY, time: ARGS_TIME },
	"ui.common.time.date_at": { date: ARGS_DATE, time: ARGS_TIME },
	"ui.common.time.yesterday_at": { time: ARGS_TIME },
};

const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/;

let failures = 0;
const say = (s) => console.log(s);
const bad = (s) => {
	failures++;
	console.log(`FAIL  ${s}`);
};
const ok = (s) => console.log(`ok    ${s}`);

function placeholders(msg) {
	return new Set(
		[...msg.matchAll(/\{\s*([A-Za-z_][\w]*)/g)].map((m) => m[1]),
	);
}

function format(msg, args) {
	const f = new IntlMessageFormat(msg, LOCALE);
	return f.format(args);
}

// ---- 1. placeholder identity vs English, both directions -----------------
say("== placeholder identity ==");
for (const key of Object.keys(CANDIDATE)) {
	const got = placeholders(CANDIDATE[key]);
	const want = placeholders(EN[key]);
	const missing = [...want].filter((p) => !got.has(p));
	const extra = [...got].filter((p) => !want.has(p));
	if (missing.length || extra.length) {
		bad(`${key}: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
	} else {
		ok(`${key}: {${[...got].join(", ")}{}} identical to English (${got.size})`);
	}
}

// ---- 2. formats, no throw, exact composed output -------------------------
say("\n== composed output (real ru args) ==");
const COMPOSED = {};
for (const key of [...Object.keys(CANDIDATE), ...Object.keys(SIBLING)]) {
	const msg = CANDIDATE[key] ?? SIBLING[key];
	try {
		const out = format(msg, ARGS[key]);
		COMPOSED[key] = out;
		ok(`${key} -> ${JSON.stringify(out)}`);
	} catch (e) {
		bad(`${key}: THREW ${e.message}`);
	}
}

// ---- 3. encoding hygiene -------------------------------------------------
say("\n== encoding ==");
for (const [key, msg] of Object.entries({ ...CANDIDATE, ...SIBLING })) {
	if (msg !== msg.normalize("NFC")) bad(`${key}: NOT NFC`);
	else ok(`${key}: NFC`);
	if (BIDI_CONTROLS.test(msg)) bad(`${key}: contains a bidi control`);
	const odd = [...msg].filter((c) => c.codePointAt(0) > 0x7f && !/[\u0400-\u04ff]/.test(c));
	if (odd.length) ok(`${key}: non-Cyrillic non-ASCII -> ${JSON.stringify(odd.join(""))}`);
}

// ---- 4. no English left --------------------------------------------------
say("\n== English residue ==");
// Latin words that would be English prose (not numbers/clock punctuation).
const ENGLISH_WORD =
	/\b(today|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at|on|ago|last|this)\b/i;
for (const [key, msg] of Object.entries({ ...CANDIDATE, ...SIBLING })) {
	const m = msg.match(ENGLISH_WORD);
	if (m) bad(`${key}: English word ${JSON.stringify(m[0])}`);
	else ok(`${key}: no English word`);
}

// ---- 5. NEGATIVE CONTROLS (in-memory mutants; prove the checks bite) -----
say("\n== negative controls ==");
const controls = [
	// the mutant REALLY drops {time}: value alone, no placeholder
	["dropped placeholder", "Сегодня", { time: ARGS_TIME }, "today_at"],
	["English left in", "Today {time}", { time: ARGS_TIME }, "today_at"],
	["renamed placeholder", "Сегодня в {tmie}", { time: ARGS_TIME }, "today_at"],
	["broken ICU", "Сегодня в {time", { time: ARGS_TIME }, "today_at"],
];

for (const [name, msg, args, refKey] of controls) {
	const want = placeholders(EN[`ui.common.time.${refKey}`]);
	const got = placeholders(msg);
	const phBad = [...want].some((p) => !got.has(p)) || [...got].some((p) => !want.has(p));
	const engBad = ENGLISH_WORD.test(msg);
	let threw = false;
	let out;
	try {
		out = format(msg, args);
	} catch {
		threw = true;
	}
	const caught = phBad || engBad || threw;
	const detail = `placeholder-mismatch=${phBad} english-residue=${engBad} format-threw=${threw}${threw ? "" : ` (silently printed ${JSON.stringify(out)})`}`;
	if (caught) ok(`control "${name}" DETECTED — ${detail}`);
	else bad(`control "${name}" NOT detected — checks are not discriminating — ${detail}`);
}

// NFD control: prove the NFC check bites. Must carry a DECOMPOSABLE letter —
// basic Cyrillic «Вчера» is already NFC under NFD, so it cannot prove anything;
// «й» (U+0439) decomposes to и + U+0306.
const nfd = "понедельник, й".normalize("NFD");
if (nfd !== nfd.normalize("NFC")) ok('control "NFD" DETECTED — differs under NFC');
else bad('control "NFD" NOT detected');
// and the whole-string NFD/BIDI gate must flag a value that is not NFC
const notNfc = "новый {time}".normalize("NFD"); // «й» really decomposes here
if (notNfc !== notNfc.normalize("NFC")) ok('control "non-NFC value" would be flagged by the NFC gate');
else bad('control "non-NFC value" not flagged');

say(`\n== ${failures === 0 ? "ALL CHECKS PASS" : `${failures} CHECK FAILURE(S)`} ==`);
console.log("\n== composed, for review ==");
for (const [k, v] of Object.entries(COMPOSED)) console.log(`  ${k.padEnd(28)} ${v}`);
process.exit(failures === 0 ? 0 : 1);
