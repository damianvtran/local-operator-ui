/**
 * S16d: DATES, TIMES, NUMBERS AND PERCENTS FOLLOW THE LIVE UI LOCALE
 * (operator acceptance: "switching to `fr` must leave NO English anywhere in
 * the interface ... and the same must hold for every supported language").
 *
 *     node --test scripts/i18n/s16d-live-locale.test.mjs
 *
 * WHY THIS FILE EXISTS. After #1866 the analytics panel, timezone offsets and
 * speech counts followed the language, but a second family of sites still read
 * the OPERATING SYSTEM's region (`toLocaleString()`, `Intl.DateTimeFormat(
 * undefined, ...)`, module-scope formatters frozen at import) or spelled
 * English words by hand (`Today`/`Yesterday`, date-fns' `h:mm a` `PM`, a bare
 * `%`). Each makes a French window print `3:42 PM` or `Yesterday`. They now go
 * through the Intl layer (`src/i18n/format.ts`) at CALL time, and the day words
 * are catalogue keys.
 *
 * THREE LOCKS, as #1866/#1870 did:
 *
 * 1. ENGLISH BYTE-IDENTITY. The `OLD_*` functions below are the pre-change
 *    formulas copied from origin/main (7c2b6af6648) with the locale made
 *    explicit (`en-US`) so the grid does not depend on the machine running it.
 *    The new code under locale `en` must equal them for every input in the grid.
 * 2. THE LOCALE IS LIVE. The same call under fr / ru / ur / zh-CN must change
 *    with `setLocale`, and the day words must come from the CATALOGUE (a marker
 *    catalogue is registered, as `tool-state-copy.test.mjs` does: the markers
 *    are not translations, they prove lookup, not wording).
 * 3. SOURCE GUARDS. None of the touched files may reintroduce a bare
 *    `toLocale*String(`, `Intl.DateTimeFormat(undefined`, or a pinned `en-US`,
 *    so the pattern cannot regress through a mounted-component path the model
 *    tests do not reach (these components are JSX files with many providers).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export { formatDividerLabel } from "./src/renderer/src/features/chat/utils/message-grouping";
			export { formatMessageDateTime } from "./src/renderer/src/shared/utils/date-utils";
			export { absoluteDate } from "./src/renderer/src/features/library/library-model";
			export { formatPercent } from "./src/renderer/src/features/chat/pickers/panels/formatters";
			export { modelAccessPresentation } from "./src/renderer/src/features/chat/session-status/session-model";
			export { timezoneOptions } from "./src/renderer/src/features/settings/components/timezone-options";
			export { installStartedText, verifyStagedArtifact } from "./src/main/update-install";
			export { FULL_NUMERIC_STAMP, formatDateTime, formatNumber } from "./src/i18n/format";
			export { clearRegisteredCatalogues, registerCatalogue } from "./src/i18n/messages";
			export { setLocale } from "./src/i18n/locale";
			export { bundledEnglish } from "./src/i18n/keys.gen";
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
const { setLocale, registerCatalogue, clearRegisteredCatalogues } = mod;

const reset = () => {
	clearRegisteredCatalogues();
	setLocale("en");
};
const underLocale = (locale, fn) => {
	setLocale(locale);
	try {
		return fn();
	} finally {
		reset();
	}
};

/* ------------------------------------------------------------------ */
/* Pre-change formulas (origin/main 7c2b6af6648), locale made explicit. */
/* ------------------------------------------------------------------ */

const OLD_TIME = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
});
const OLD_WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const OLD_DATE = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "long",
	year: "numeric",
});
const isSameDay = (a, b) =>
	a.getFullYear() === b.getFullYear() &&
	a.getMonth() === b.getMonth() &&
	a.getDate() === b.getDate();
const OLD_formatDividerLabel = (date, now) => {
	if (isSameDay(date, now)) return `Today ${OLD_TIME.format(date)}`;
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (isSameDay(date, yesterday)) return `Yesterday ${OLD_TIME.format(date)}`;
	const weekAgo = new Date(now);
	weekAgo.setDate(now.getDate() - 6);
	if (date > weekAgo)
		return `${OLD_WEEKDAY.format(date)} ${OLD_TIME.format(date)}`;
	return `${OLD_DATE.format(date)}, ${OLD_TIME.format(date)}`;
};

const OLD_absoluteDate = (seconds) =>
	!seconds
		? ""
		: new Date(seconds * 1000).toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
			});

const roundHalfEven = (value) => {
	const floor = Math.floor(value);
	const diff = value - floor;
	if (diff < 0.5) return floor;
	if (diff > 0.5) return floor + 1;
	return floor % 2 === 0 ? floor : floor + 1;
};
const OLD_formatPercent = (fraction) => {
	if (fraction === null || fraction === undefined) return "—";
	const pct = fraction * 100;
	if (pct > 99 && pct < 100) return "99%";
	return `${roundHalfEven(pct)}%`;
};

/* A date grid covering midnight, noon, single/double-digit months, year ends. */
const STAMPS = [
	new Date(2026, 0, 1, 0, 0, 0),
	new Date(2026, 0, 9, 9, 5, 7),
	new Date(2026, 5, 15, 12, 0, 0),
	new Date(2026, 10, 5, 15, 42, 1),
	new Date(2026, 11, 31, 23, 59, 59),
	new Date(2025, 8, 12, 4, 53, 0),
];

/* ------------------------------------------------------------------ */
/* 1. English byte-identity                                            */
/* ------------------------------------------------------------------ */

test("English: the day-divider label equals the pre-change label for every branch", () => {
	const now = new Date(2026, 10, 12, 10, 0, 0);
	const samples = [
		new Date(2026, 10, 12, 9, 30), // today
		new Date(2026, 10, 11, 23, 50), // yesterday
		new Date(2026, 10, 8, 8, 5), // inside the week
		new Date(2026, 9, 1, 17, 0), // older
		new Date(2025, 0, 2, 0, 0), // previous year
	];
	let compared = 0;
	for (const date of samples) {
		assert.equal(
			mod.formatDividerLabel(date, now),
			OLD_formatDividerLabel(date, now),
			date.toISOString(),
		);
		compared += 1;
	}
	assert.equal(compared, 5);
	assert.equal(mod.formatDividerLabel(samples[0], now), "Today 9:30 AM");
	assert.equal(mod.formatDividerLabel(samples[1], now), "Yesterday 11:50 PM");
});

test("English: the library's absolute date, FULL_NUMERIC_STAMP, numbers and percents are unchanged", () => {
	for (const date of STAMPS) {
		const seconds = Math.floor(date.getTime() / 1000);
		assert.equal(mod.absoluteDate(seconds), OLD_absoluteDate(seconds));
		// `toLocaleString()` with no arguments is the pre-change spelling of
		// every FULL_NUMERIC_STAMP site (session picker row, "Detected ...",
		// "Install started ...").
		assert.equal(
			mod.formatDateTime(date, mod.FULL_NUMERIC_STAMP),
			date.toLocaleString("en-US"),
		);
		assert.equal(
			mod.formatDateTime(date, { hour: "2-digit", minute: "2-digit" }),
			date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
		);
	}
	for (const n of [0, 7, 999, 1000, 8192, 131072, 1048576, 21474836]) {
		assert.equal(mod.formatNumber(n), n.toLocaleString("en-US"));
	}
	assert.equal(mod.absoluteDate(null), "");
	assert.equal(mod.absoluteDate(undefined), "");
});

test("English: formatPercent equals the pre-change formula over 0..1 in 0.1% steps plus the edges", () => {
	const inputs = [null, undefined, -0.05, 1.5, Number.NaN, 0.995, 0.99, 0.9999];
	for (let i = 0; i <= 1000; i += 1) inputs.push(i / 1000);
	let compared = 0;
	for (const value of inputs) {
		const expected = OLD_formatPercent(value);
		// `NaN%` and `-5%` are what the old template printed for those inputs;
		// Intl prints the same ASCII bytes under `en`.
		assert.equal(mod.formatPercent(value), expected, String(value));
		compared += 1;
	}
	assert.equal(compared, 1009);
	assert.equal(mod.formatPercent(0.73), "73%");
	assert.equal(mod.formatPercent(0.996), "99%");
	assert.equal(mod.formatPercent(1), "100%");
});

test("English: the hover-row stamp is unchanged for today / yesterday / weekday / ISO", () => {
	const now = new Date();
	const at = (days, hours, minutes) =>
		new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() - days,
			hours,
			minutes,
		);
	const pad = (n) => String(n).padStart(2, "0");
	const clock = (d) => OLD_TIME.format(d);
	const today = at(0, 0, 5); // 12:05 AM, always "today" and never in the future
	assert.equal(mod.formatMessageDateTime(today), clock(today));
	assert.equal(mod.formatMessageDateTime(today), "12:05 AM");
	assert.equal(mod.formatMessageDateTime(at(1, 15, 42)), "Yesterday");
	const three = at(3, 15, 42);
	assert.equal(
		mod.formatMessageDateTime(three),
		new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(three),
	);
	const old = at(30, 9, 0);
	assert.equal(
		mod.formatMessageDateTime(old),
		`${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())}`,
	);
	assert.equal(mod.formatMessageDateTime(undefined), "");
});

/* ------------------------------------------------------------------ */
/* 2. The locale is live                                               */
/* ------------------------------------------------------------------ */

/** Marker catalogue: proves lookup, not wording (see tool-state-copy.test). */
const markers = (loc) => ({
	"ui.common.time.today_at": `${loc}:TODAY {time}`,
	"ui.common.time.yesterday_at": `${loc}:YESTERDAY {time}`,
	"ui.common.time.yesterday": `${loc}:YESTERDAY`,
	"ui.common.time.weekday_at": `${loc}:WEEKDAY {weekday}|{time}`,
	"ui.common.time.date_at": `${loc}:DATE {date}|{time}`,
});

for (const loc of ["fr", "ru", "ur", "zh-CN"]) {
	test(`${loc}: the divider label comes from the catalogue and the clock/date from Intl`, () => {
		const now = new Date(2026, 10, 12, 10, 0, 0);
		clearRegisteredCatalogues();
		registerCatalogue(loc, markers(loc));
		try {
			underLocale(loc, () => {
				// `t()` wraps each argument in FSI..PDI under a right-to-left locale (ur), so
				// the markers are compared with the isolates stripped; the isolation
				// itself is `bidi-isolation.test.mjs`' contract.
				const intl = (opts, d) => new Intl.DateTimeFormat(loc, opts).format(d);
				const bare = (text) => text.replace(/[\u2066-\u2069]/g, "");
				const clock = { hour: "numeric", minute: "2-digit" };
				const today = new Date(2026, 10, 12, 9, 30);
				const yesterday = new Date(2026, 10, 11, 23, 50);
				const week = new Date(2026, 10, 8, 8, 5);
				const older = new Date(2026, 9, 1, 17, 0);
				assert.equal(
					bare(mod.formatDividerLabel(today, now)),
					`${loc}:TODAY ${intl(clock, today)}`,
				);
				assert.equal(
					bare(mod.formatDividerLabel(yesterday, now)),
					`${loc}:YESTERDAY ${intl(clock, yesterday)}`,
				);
				assert.equal(
					bare(mod.formatDividerLabel(week, now)),
					`${loc}:WEEKDAY ${intl({ weekday: "long" }, week)}|${intl(clock, week)}`,
				);
				assert.equal(
					bare(mod.formatDividerLabel(older, now)),
					`${loc}:DATE ${intl({ day: "numeric", month: "long", year: "numeric" }, older)}|${intl(clock, older)}`,
				);
				// No English day word survives. (AM/PM are NOT asserted: CLDR's own `ur`
				// clock is the Latin `AM`/`PM`, which the layer cannot and should not override.)
				for (const date of [today, yesterday, week, older]) {
					const label = mod.formatDividerLabel(date, now);
					assert.doesNotMatch(label, /Today|Yesterday|Monday|Sunday/);
				}
			});
		} finally {
			reset();
		}
	});
}

test("the hover-row 'Yesterday' is keyed and its clock follows the locale's hour cycle", () => {
	clearRegisteredCatalogues();
	registerCatalogue("fr", markers("fr"));
	try {
		const now = new Date();
		const yesterday = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() - 1,
			15,
			42,
		);
		underLocale("fr", () =>
			assert.equal(mod.formatMessageDateTime(yesterday), "fr:YESTERDAY"),
		);
		const today = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			0,
			5,
		);
		// French is a 24-hour language: the date-fns `h:mm a` printed `12:05 AM`.
		// Expected from Intl itself (the ICU in use spells midnight `0:05`).
		underLocale("fr", () => {
			const label = mod.formatMessageDateTime(today);
			assert.equal(
				label,
				new Intl.DateTimeFormat("fr", {
					hour: "numeric",
					minute: "2-digit",
				}).format(today),
			);
			assert.doesNotMatch(label, /AM|PM/);
		});
	} finally {
		reset();
	}
});

test("library date, session access time and percent follow the locale", () => {
	const seconds = Math.floor(new Date(2026, 10, 5, 15, 42).getTime() / 1000);
	const en = mod.absoluteDate(seconds);
	assert.equal(en, "Nov 5, 2026");
	for (const [loc, expected] of [
		["fr", "5 nov. 2026"],
		["ru", "5 нояб. 2026 г."],
		["zh-CN", "2026年11月5日"],
		[
			"ur",
			new Intl.DateTimeFormat("ur", {
				year: "numeric",
				month: "short",
				day: "numeric",
			}).format(new Date(2026, 10, 5)),
		],
	]) {
		const got = underLocale(loc, () => mod.absoluteDate(seconds));
		assert.equal(got, expected, loc);
		assert.notEqual(got, en, `${loc} must not read like English`);
	}
	// The percent sign is CLDR text.
	const pct = (loc) => underLocale(loc, () => mod.formatPercent(0.73));
	assert.equal(pct("en"), "73%");
	for (const loc of ["fr", "ru", "ur", "zh-CN", "es", "hi", "vi"]) {
		// Whatever CLDR says for this locale (fr/ru/es put a no-break space
		// before the sign), not a table kept here.
		assert.equal(
			pct(loc),
			new Intl.NumberFormat(loc, { style: "percent" }).format(0.73),
			loc,
		);
	}
	assert.equal(pct("fr"), "73\u00a0%");

	const access = {
		provider: "openai",
		label: "OpenAI",
		effectiveState: "expired",
		observedAt: seconds,
	};
	const history = (loc) =>
		underLocale(loc, () => mod.modelAccessPresentation(access).history);
	assert.match(history("en"), /Nov 5, 2026/);
	assert.match(history("fr"), /5 nov\. 2026/);
	assert.doesNotMatch(history("fr"), /Nov|PM|AM/);
});

test("the installer record's stamp follows the live locale (the sentence stays English by design)", () => {
	const marker = { startedAt: new Date(2026, 10, 5, 15, 42, 1).toISOString() };
	const stamp = (loc) => underLocale(loc, () => mod.installStartedText(marker));
	assert.equal(stamp("en"), "11/5/2026, 3:42:01 PM");
	assert.equal(stamp("fr"), "05/11/2026 15:42:01");
	assert.equal(mod.installStartedText({ startedAt: "" }), "at an unknown time");
});

test("the disk refusal's size is spelled in the live locale (GiB symbol kept)", () => {
	const verdict = (loc) =>
		underLocale(loc, () =>
			mod.verifyStagedArtifact({
				filePath: "/tmp/a.zip",
				actualSize: 1000,
				actualSha512: "s",
				metadata: { url: "a.zip", sha512: "s", size: 1000 },
				freeBytes: 0,
				installedBundleSize: 2 * 1024 ** 3,
			}),
		);
	const en = verdict("en");
	assert.equal(en.block.code, "insufficient-disk-space");
	// 1000 B artifact + 3 x 2 GiB app copies + 256 MiB slack = 6.25 GiB.
	assert.match(en.block.remedy.text, /about 6\.3 GiB,/);
	assert.match(verdict("fr").block.remedy.text, /6,3\s+GiB,/);
});

test("timezone search finds a U+2212 offset typed with the keyboard hyphen", () => {
	const now = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
	const zone = mod
		.timezoneOptions("fr", now)
		.find((option) => option.id === "America/New_York");
	assert.ok(zone.description.includes("\u2212"), zone.description);
	assert.ok(zone.keywords.includes(zone.description), "the displayed spelling");
	assert.ok(
		zone.keywords.includes(zone.description.replace("\u2212", "-")),
		`ASCII twin missing: ${zone.keywords}`,
	);
	assert.equal(new Set(zone.keywords).size, zone.keywords.length);
});

/* ------------------------------------------------------------------ */
/* 3. Source guards                                                    */
/* ------------------------------------------------------------------ */

const TOUCHED = [
	"src/renderer/src/features/agent-hub/components/agent-card.tsx",
	"src/renderer/src/features/agents/config-run/config-composer.tsx",
	"src/renderer/src/features/chat/pickers/destination-pickers.tsx",
	"src/renderer/src/features/chat/session-status/session-model.ts",
	"src/renderer/src/features/chat/utils/message-grouping.ts",
	"src/renderer/src/features/library/library-model.ts",
	"src/renderer/src/features/settings/components/import-settings-view.tsx",
	"src/renderer/src/shared/components/common/check-for-updates-button.tsx",
	"src/renderer/src/shared/components/common/update-notification.tsx",
	"src/renderer/src/shared/utils/date-utils.ts",
	"src/main/update-install.ts",
	"src/main/backend/backend-service.ts",
];

/** Code only: comments may (and do) name the old spellings. */
const code = (file) =>
	readFileSync(file, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

test("no touched file reads the OS locale or hand-spells a day word again", () => {
	for (const file of TOUCHED) {
		const source = code(file);
		assert.doesNotMatch(
			source,
			/\.toLocale(?:Date|Time)?String\(/,
			`${file}: a bare toLocale*String reads the OS region`,
		);
		assert.doesNotMatch(
			source,
			/Intl\.(?:DateTimeFormat|NumberFormat)\(\s*(?:undefined|\[\])/,
			`${file}: Intl with an undefined locale reads the OS region`,
		);
		assert.doesNotMatch(source, /["'`]en-US["'`]/, `${file}: pinned en-US`);
	}
	const grouping = code(
		"src/renderer/src/features/chat/utils/message-grouping.ts",
	);
	assert.doesNotMatch(grouping, /`(?:Today|Yesterday) /, "English day word");
	assert.doesNotMatch(
		grouping,
		/^const \w+ = new Intl\./m,
		"module-scope Intl",
	);
	const dates = code("src/renderer/src/shared/utils/date-utils.ts");
	assert.doesNotMatch(dates, /"Yesterday"/, "hand-spelled Yesterday");
	assert.doesNotMatch(dates, /"h:mm a"|"EEEE"/, "date-fns English patterns");
	const percent = code(
		"src/renderer/src/features/chat/pickers/panels/formatters.ts",
	);
	assert.doesNotMatch(percent, /`\$\{roundHalfEven\(pct\)\}%`/, "bare % sign");
	const update = code(
		"src/renderer/src/shared/components/common/update-notification.tsx",
	);
	assert.doesNotMatch(
		update,
		/percent\)\}%/,
		"bare % after the download figure",
	);
});

test("every new key has English source and a context sidecar", () => {
	for (const key of [
		"ui.common.time.today_at",
		"ui.common.time.yesterday",
		"ui.common.time.weekday_at",
		"ui.common.time.date_at",
	]) {
		assert.equal(typeof mod.bundledEnglish[key], "string", key);
	}
	const sidecar = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.common.time.context.json", "utf8"),
	);
	for (const key of Object.keys(sidecar)) {
		assert.ok(sidecar[key].role && sidecar[key].tone, key);
	}
	assert.equal(mod.bundledEnglish["ui.common.time.today_at"], "Today {time}");
	assert.equal(mod.bundledEnglish["ui.common.time.yesterday"], "Yesterday");
});

test("the message stamp subscribes to the locale (a memoised row repaints on a language switch)", () => {
	// Mounting it bundles the whole UI kit (>4 GB in the memory-guarded
	// sandbox), so the contract is held at the source: the hook call is the
	// subscription, and it must sit inside the component body.
	const source = code(
		"src/renderer/src/features/chat/components/message-item/message-timestamp.tsx",
	);
	assert.match(
		source,
		/import \{ useI18nLocale \} from "@shared\/i18n\/use-locale"/,
	);
	assert.match(source, /=> \{\s*useI18nLocale\(\);/);
});
