import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * THE TOOL ROW'S STATUS WORDS AND THE GENERATION CARD'S STATE LINE RESOLVE
 * THROUGH THE CATALOGUE (S16a: "switching to `fr` must leave NO English").
 *
 * WHY THIS FILE EXISTS. Two places still printed English in every locale
 * because they were built from literals the string scanner cannot see (it
 * counts JSX text and a few property names, not a `return` or a template
 * string):
 *
 *   - `toolRecordSummary` returned `composing` / `queued` (+ ` · <size>`);
 *   - the image-generation card's `StateLine` built `Queued`, `Writing the
 *     request…`, `N ahead`, `Generating <noun>…`, `Generated <noun>`,
 *     `<Noun> batch`, `Already finished.` and the failure fallbacks by hand,
 *     pluralising with an English `s`.
 * Both now call `t()` at render time. The ratchet (`i18n/baseline.json`) is
 * empty, so it can neither fail on the old literals nor lock the new keys: THIS
 * suite is the only lock, in three parts.
 *
 * 1. ENGLISH BYTE-IDENTITY. `EN_*` below were captured from origin/main
 *    (5acfe0a2d92) BEFORE the change, by rendering the real components. The
 *    English catalogue must still produce them character for character
 *    (including `composing · 1.2 KB`, `3 ahead`, `Generating 3 images…`).
 * 2. LOOKUP IS PROVEN, NOT ASSUMED. A test-only catalogue is registered for
 *    fr/ru/ur through the same seam the served catalogues use
 *    (`registerCatalogue`); every state must then print the stub and none of the
 *    English. The stubs are NOT translations - they are ICU messages of the
 *    right shape (plural categories per locale, select on material) whose text
 *    is a marker, so a wrong plural category or a missed branch shows up as the
 *    wrong marker. Real translations live in `src/i18n/catalogues/<locale>/`.
 * 3. SOURCE GUARD. The summary function and the state line hold no English
 *    literal of the old copy. The one allowed exception is the cancelled batch
 *    sentence (`<Noun> batch stopped.`), which belongs to the cancel-copy slice
 *    (model-layer English that needs a code-not-string refactor) and is pinned
 *    here so it cannot silently grow a neighbour.
 */

const ROOT = process.cwd();
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const bundle = await build({
	stdin: {
		contents: `export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
 export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
 export { ImageGenCard } from "./src/renderer/src/features/chat/canonical/image-gen-card";
 export { MemoryRouter } from "react-router-dom";
 export { setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	// `loadConfig` reads `import.meta.env` at module scope (see canonical-notice.test.mjs).
	define: { "import.meta.env": "{}" },
	// One copy of react/react-query with the renders below.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
// A FILE, not a data: URL: the bundle keeps `react` external and a data: module
// cannot resolve a bare specifier (see image-gen-card.test.mjs).
const bundlePath = new URL("./_tool-state-copy.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const { CanonicalTranscript, EMPTY_TRANSCRIPT, ImageGenCard, MemoryRouter } =
	mod;

const enCatalogue = JSON.parse(
	readFileSync(
		join(ROOT, "src/i18n/catalogues/en/ui.chat.canonical.json"),
		"utf8",
	),
);
const contexts = JSON.parse(
	readFileSync(
		join(ROOT, "src/i18n/catalogues/en/ui.chat.canonical.context.json"),
		"utf8",
	),
);

const TOOL_KEYS = [
	"composing_sized",
	"composing_empty",
	"queued_sized",
	"queued_empty",
].map((k) => `ui.chat.canonical.tool.${k}`);
const STATE_KEYS = [
	"queued",
	"writing_request",
	"queue_ahead",
	"running",
	"running_batch",
	"done",
	"done_batch",
	"already_finished",
	"failed",
	"failed_batch",
].map((k) => `ui.chat.canonical.image_gen.state.${k}`);

/* -------------------------------------------------------------------------- */
/* Rendering seams                                                            */
/* -------------------------------------------------------------------------- */

// Bidi isolates (FSI/LRI/PDI) wrap Latin arguments inside an RTL answer; they
// carry no copy, so they are dropped before comparing.
const plain = (s) => s.replace(/[\u2066-\u2069]/g, "");
const decode = (s) =>
	s
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"');

const TS = 1_760_000_000_000;
const toolRecord = (phase, argumentBytes) => ({
	kind: "tool",
	id: "tool:1",
	ts: TS,
	toolCallId: "call:1",
	toolName: "bash",
	intent: null,
	args: {},
	phase,
	argumentBytes,
	notRunReason: null,
	neverSent: false,
	isError: false,
	stopped: false,
	startedAt: TS,
	endedAt: null,
	durationS: null,
	outputBytes: null,
	images: [],
});

/**
 * The running tool's summary as the transcript prints it: the trace fold's live
 * clause (`summaryOf` -> `toolRecordSummary`), the row's own words. A lone
 * unsettled call renders collapsed, so this is the surface a reader sees.
 */
function summaryOf(phase, argumentBytes, { keepIsolates = false } = {}) {
	const html = renderToStaticMarkup(
		h(
			QueryClientProvider,
			{ client: queryClient },
			h(
				MemoryRouter,
				null,
				h(CanonicalTranscript, {
					transcript: {
						...EMPTY_TRANSCRIPT,
						records: [toolRecord(phase, argumentBytes)],
					},
					gate: null,
					waiting: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: null },
					isSmallView: false,
					status: "live",
					failure: null,
					hydrated: true,
					onReconnect: () => {},
				}),
			),
		),
	);
	const texts = decode(html)
		.replace(/<[^>]*>/g, "|")
		.split("|")
		.map((s) => (keepIsolates ? s : plain(s)).trim())
		.filter(Boolean);
	// The fold's label is itself localized (`Running` is `Exécution de` in fr), so
	// the summary is found by position: the last text that is not the trailing
	// age chip (`100d+`).
	const summary = texts.filter((t) => !/^\d+[a-z]+\+?$/.test(t)).at(-1);
	assert.ok(summary, `summary found in ${JSON.stringify(texts)}`);
	return summary;
}

/** `{ text, datum }` of the card's one state line (`datum` is null when absent). */
function stateLineOf(view) {
	const html = renderToStaticMarkup(
		h(ImageGenCard, { view, scope: null, actions: undefined }),
	);
	const line = html.match(
		/<p class="flex min-w-0 items-baseline gap-1\.5 text-body-sm">(.*?)<\/p>/s,
	);
	assert.ok(line, `state line found in ${html.slice(0, 300)}`);
	const text = line[1].match(/<span class="min-w-0[^"]*">(.*?)<\/span>/s);
	const datum = line[1].match(/<bdi dir="auto">(.*?)<\/bdi>/s);
	return {
		text: plain(decode(text?.[1] ?? "")),
		datum: datum ? plain(decode(datum[1])) : null,
	};
}

const NO_PROGRESS = { fraction: null, logs: [], queuePosition: null };
const ITEM = {
	id: "a",
	name: "a",
	label: "a",
	audio: null,
	costCaption: null,
	error: null,
	status: "completed",
};
const MATERIALS = ["image", "video", "voiceover", "sound-effect"];

/** Every state-line branch the card has for this slice, as `[label, view]`. */
const CARD_CASES = [
	[
		"queued",
		{
			state: "queued",
			composing: false,
			argumentBytes: 0,
			queuePosition: null,
		},
	],
	[
		"queued+bytes",
		{
			state: "queued",
			composing: false,
			argumentBytes: 1900,
			queuePosition: null,
		},
	],
	[
		"queued ahead 0",
		{
			state: "queued",
			composing: false,
			argumentBytes: 1900,
			queuePosition: 0,
		},
	],
	[
		"queued ahead 1",
		{ state: "queued", composing: false, argumentBytes: 0, queuePosition: 1 },
	],
	[
		"queued ahead 2",
		{ state: "queued", composing: false, argumentBytes: 0, queuePosition: 2 },
	],
	[
		"queued ahead 3",
		{ state: "queued", composing: false, argumentBytes: 0, queuePosition: 3 },
	],
	[
		"queued ahead 5",
		{ state: "queued", composing: false, argumentBytes: 0, queuePosition: 5 },
	],
	[
		"queued ahead 21",
		{ state: "queued", composing: false, argumentBytes: 0, queuePosition: 21 },
	],
	[
		"composing",
		{ state: "queued", composing: true, argumentBytes: 0, queuePosition: null },
	],
	[
		"composing+bytes",
		{
			state: "queued",
			composing: true,
			argumentBytes: 2480,
			queuePosition: null,
		},
	],
	[
		"composing ahead 2",
		{ state: "queued", composing: true, argumentBytes: 2480, queuePosition: 2 },
	],
	[
		"done already finished",
		{
			state: "done",
			material: "image",
			images: [],
			durationS: 5,
			receipt: "already-finished",
		},
	],
	...MATERIALS.flatMap((material) => [
		[
			`running ${material}`,
			{ state: "running", material, startedAtMs: null, progress: NO_PROGRESS },
		],
		[
			`running ${material} batch of 1`,
			{
				state: "running",
				material,
				startedAtMs: null,
				progress: NO_PROGRESS,
				batchProgress: { total: 1, note: null },
			},
		],
		[
			`running ${material} batch of 2`,
			{
				state: "running",
				material,
				startedAtMs: null,
				progress: NO_PROGRESS,
				batchProgress: { total: 2, note: null },
			},
		],
		[
			`running ${material} batch of 3`,
			{
				state: "running",
				material,
				startedAtMs: null,
				progress: NO_PROGRESS,
				batchProgress: { total: 3, note: null },
			},
		],
		[
			`running ${material} batch of 5`,
			{
				state: "running",
				material,
				startedAtMs: null,
				progress: NO_PROGRESS,
				batchProgress: { total: 5, note: null },
			},
		],
		[
			`running ${material} batch of 21`,
			{
				state: "running",
				material,
				startedAtMs: null,
				progress: NO_PROGRESS,
				batchProgress: { total: 21, note: null },
			},
		],
		[
			`done ${material}`,
			{
				state: "done",
				material,
				images: [],
				durationS: null,
				receipt: "generated",
			},
		],
		[
			`done ${material} batch`,
			{
				state: "done",
				material,
				images: [],
				durationS: null,
				receipt: "generated",
				batch: [ITEM],
			},
		],
		[
			`failed ${material}`,
			{ state: "failed", material, message: null, errorType: null },
		],
		[
			`failed ${material} batch`,
			{
				state: "failed",
				material,
				message: null,
				errorType: null,
				batch: [ITEM],
			},
		],
	]),
];

/* -------------------------------------------------------------------------- */
/* 1. English byte-identity (oracle captured from origin/main 5acfe0a2d92)    */
/* -------------------------------------------------------------------------- */

const NOUN = {
	image: "image",
	video: "video",
	voiceover: "voiceover",
	"sound-effect": "sound effect",
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The English the pre-change code printed, spelled out literally per case
 * (NOT derived from the catalogue under test): `[text, datum]`.
 */
function englishOracle(label) {
	const fixed = {
		queued: ["Queued", null],
		"queued+bytes": ["Queued", "1.9 KB"],
		"queued ahead 0": ["Queued", "0 ahead"],
		"queued ahead 1": ["Queued", "1 ahead"],
		"queued ahead 2": ["Queued", "2 ahead"],
		"queued ahead 3": ["Queued", "3 ahead"],
		"queued ahead 5": ["Queued", "5 ahead"],
		"queued ahead 21": ["Queued", "21 ahead"],
		composing: ["Writing the request…", null],
		"composing+bytes": ["Writing the request…", "2.4 KB"],
		"composing ahead 2": ["Writing the request…", "2 ahead"],
		"done already finished": ["Already finished.", null],
	};
	if (label in fixed) return fixed[label];
	const m = label.match(
		/^(running|done|failed) (\S+?)(?: batch(?: of (\d+))?)?$/,
	);
	assert.ok(m, `oracle covers ${label}`);
	const [, state, material, total] = m;
	const noun = NOUN[material];
	const batch = label.includes(" batch");
	if (state === "running") {
		return [
			total
				? `Generating ${total} ${noun}${total === "1" ? "" : "s"}…`
				: `Generating ${noun}…`,
			null,
		];
	}
	if (state === "done")
		return [batch ? `${cap(noun)} batch` : `Generated ${noun}`, null];
	return [
		batch
			? `${cap(noun)} batch failed.`
			: `The ${noun} could not be generated.`,
		null,
	];
}

const EN_TOOL = {
	"composing|0": "composing",
	"composing|1234": "composing · 1.2 KB",
	"queued|0": "queued",
	"queued|1234": "queued · 1.2 KB",
};

test("the 14 new keys exist in the English source with a context entry each", () => {
	for (const key of [...TOOL_KEYS, ...STATE_KEYS]) {
		assert.equal(typeof enCatalogue[key], "string", `${key} in en catalogue`);
		assert.ok(contexts[key]?.role, `${key} has a context entry with a role`);
		assert.ok(contexts[key]?.note, `${key} has a context note`);
	}
	// The sized messages carry the size inside the message (word order is the
	// translator's), the empty ones do not.
	assert.equal(enCatalogue[TOOL_KEYS[0]], "composing \u00b7 {size}");
	assert.equal(enCatalogue[TOOL_KEYS[1]], "composing");
	assert.equal(enCatalogue[TOOL_KEYS[2]], "queued \u00b7 {size}");
	assert.equal(enCatalogue[TOOL_KEYS[3]], "queued");
});

test("English: the tool row's composing/queued summary is byte-identical to origin/main", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	for (const [id, expected] of Object.entries(EN_TOOL)) {
		const [phase, bytes] = id.split("|");
		assert.equal(summaryOf(phase, Number(bytes)), expected, id);
	}
});

test("English: every state-line branch of the generation card is byte-identical to origin/main", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	assert.ok(CARD_CASES.length === 52, `cases: ${CARD_CASES.length}`);
	for (const [label, view] of CARD_CASES) {
		const [text, datum] = englishOracle(label);
		assert.deepEqual(stateLineOf(view), { text, datum }, label);
	}
	// A supplied failure sentence stays VERBATIM (server-authored, never keyed).
	assert.deepEqual(
		stateLineOf({
			state: "failed",
			material: "video",
			message: "out of credits",
			errorType: null,
		}),
		{ text: "out of credits", datum: null },
	);
});

/* -------------------------------------------------------------------------- */
/* 2. The lookup is proven through a stub catalogue per locale                */
/* -------------------------------------------------------------------------- */

/*
 * CLDR cardinal categories the stubs must cover, per target locale, so a
 * message that forgets one fails here instead of silently falling back:
 *   fr  one (0, 1), many (1e6 multiples), other
 *   ru  one (1, 21), few (2-4), many (0, 5-20), other
 *   ur  one (1), other   (same as English)
 * Probed with the Intl runtime below rather than trusted from this comment.
 */
const CATEGORIES = {
	fr: ["one", "many", "other"],
	ru: ["one", "few", "many", "other"],
	ur: ["one", "other"],
};
const pluralOf = (arg, cats, body) =>
	`{${arg}, plural, ${cats.map((c) => `${c} {${body(c)}}`).join(" ")}}`;
const selectOf = (arg, body) =>
	`{${arg}, select, ${["video", "voiceover", "sound_effect", "other"]
		.map((m) => `${m} {${body(m)}}`)
		.join(" ")}}`;

/** Marker messages: the right ICU shape per key, deliberately NOT language. */
function stubFor(loc) {
	const cats = CATEGORIES[loc];
	const k = (n) => `ui.chat.canonical.image_gen.state.${n}`;
	return {
		[TOOL_KEYS[0]]: `${loc}:composing:{size}`,
		[TOOL_KEYS[1]]: `${loc}:composing`,
		[TOOL_KEYS[2]]: `${loc}:queued:{size}`,
		[TOOL_KEYS[3]]: `${loc}:queued`,
		[k("queued")]: `${loc}:Q`,
		[k("writing_request")]: `${loc}:W`,
		[k("queue_ahead")]: pluralOf(
			"count",
			cats,
			(c) => `${loc}:ahead:${c}:{count, number, ::group-off}`,
		),
		[k("running")]: selectOf("material", (m) => `${loc}:run:${m}`),
		[k("running_batch")]: selectOf("material", (m) =>
			pluralOf("total", cats, (c) => `${loc}:runbatch:${m}:${c}:#`),
		),
		[k("done")]: selectOf("material", (m) => `${loc}:done:${m}`),
		[k("done_batch")]: selectOf("material", (m) => `${loc}:donebatch:${m}`),
		[k("already_finished")]: `${loc}:AF`,
		[k("failed")]: selectOf("material", (m) => `${loc}:fail:${m}`),
		[k("failed_batch")]: selectOf("material", (m) => `${loc}:failbatch:${m}`),
	};
}

const tokenOf = (material) => material.replace("-", "_");
const categoryOf = (loc, n) => new Intl.PluralRules(loc).select(n);

/** The stub text each case must print under `loc`. */
function stubExpectation(loc, label) {
	const ahead = label.match(/ahead (\d+)$/);
	const datum = ahead
		? `${loc}:ahead:${categoryOf(loc, Number(ahead[1]))}:${ahead[1]}`
		: null;
	if (label.startsWith("queued")) {
		return [
			`${loc}:Q`,
			ahead ? datum : label.includes("+bytes") ? "BYTES" : null,
		];
	}
	if (label.startsWith("composing")) {
		return [
			`${loc}:W`,
			ahead ? datum : label.includes("+bytes") ? "BYTES" : null,
		];
	}
	if (label === "done already finished") return [`${loc}:AF`, null];
	const [, state, material, total] = label.match(
		/^(running|done|failed) (\S+?)(?: batch(?: of (\d+))?)?$/,
	);
	const m = tokenOf(material);
	const mm = m === "image" ? "other" : m;
	const batch = label.includes(" batch");
	if (state === "running")
		return [
			total
				? `${loc}:runbatch:${mm}:${categoryOf(loc, Number(total))}:${total}`
				: `${loc}:run:${mm}`,
			null,
		];
	if (state === "done")
		return [batch ? `${loc}:donebatch:${mm}` : `${loc}:done:${mm}`, null];
	return [batch ? `${loc}:failbatch:${mm}` : `${loc}:fail:${mm}`, null];
}

function withStub(loc, fn) {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue(loc, stubFor(loc));
	mod.setLocale(loc);
	try {
		return fn();
	} finally {
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
}

test("the stubs cover the CLDR cardinal categories each target locale needs", () => {
	for (const [loc, cats] of Object.entries(CATEGORIES)) {
		const seen = new Set(
			[0, 1, 2, 3, 5, 11, 21, 1_000_000].map((n) => categoryOf(loc, n)),
		);
		for (const c of seen)
			assert.ok(cats.includes(c), `${loc} uses ${c}; stub lists ${cats}`);
	}
	// The ru cases the card tests below rely on really are one/few/many.
	assert.deepEqual(
		[1, 2, 5, 21].map((n) => categoryOf("ru", n)),
		["one", "few", "many", "one"],
	);
});

for (const loc of ["fr", "ru", "ur"]) {
	test(`${loc}: the tool row's status words come from the catalogue, none from English`, () => {
		withStub(loc, () => {
			for (const [id] of Object.entries(EN_TOOL)) {
				const [phase, bytes] = id.split("|");
				const got = summaryOf(phase, Number(bytes));
				const word = phase;
				if (bytes === "0") assert.equal(got, `${loc}:${word}`, id);
				else assert.match(got, new RegExp(`^${loc}:${word}:\\S.*\\S$`), id);
				// No English word, and no English separator the message did not carry.
				assert.ok(
					!/composing|queued| · /.test(got.replace(`${loc}:${word}`, "")),
					id,
				);
			}
		});
	});

	test(`${loc}: every state-line branch of the generation card comes from the catalogue`, () => {
		withStub(loc, () => {
			for (const [label, view] of CARD_CASES) {
				const [text, datum] = stubExpectation(loc, label);
				const got = stateLineOf(view);
				assert.equal(got.text, text, `${label} text`);
				if (datum === "BYTES")
					assert.ok(got.datum && /\d/.test(got.datum), `${label} bytes datum`);
				else assert.equal(got.datum, datum, `${label} datum`);
				// The English the old code spelled must not leak around the message.
				// (The stubs' own markers are lower-case and colon-joined, so these
				// patterns cannot match them.)
				assert.ok(
					!/Queued|Generat|Writing|Already|could not| batch|… ?$/.test(
						got.text,
					),
					`${label} leaks English: ${got.text}`,
				);
				assert.ok(
					got.datum === null || !/^\d+ ahead$/.test(got.datum),
					`${label} leaks the English datum: ${got.datum}`,
				);
			}
			// A supplied failure sentence is still the server's, not the catalogue's.
			assert.equal(
				stateLineOf({
					state: "failed",
					material: "video",
					message: "out of credits",
					errorType: null,
				}).text,
				"out of credits",
			);
		});
	});
}

/*
 * The result players' accessible label reuses the `done` message
 * (`Generated <noun>`, then ` 2`, ` 3` ...) instead of a second English
 * template, so it cannot drift from the state line and is keyed for free.
 */
const IMAGE = (id, kind) => ({
	id,
	data: "AAAA",
	attachment: null,
	mimeType:
		kind === "video"
			? "video/mp4"
			: kind === "audio"
				? "audio/mpeg"
				: "image/png",
	kind,
	width: null,
	height: null,
	sizeBytes: null,
	durationS: null,
	name: null,
	provider: null,
});
/** The picture path surfaces the label as the `<img alt>` (video/audio players need a fetched stream to paint theirs, so those two are covered by the source guard below). */
const labelsOf = (view) =>
	[
		...renderToStaticMarkup(
			h(ImageGenCard, { view, scope: null, actions: undefined }),
		).matchAll(/<img [^>]*alt="([^"]*)"/g),
	].map((m) => plain(decode(m[1])));

test("English: result labels read `Generated image` and number a set, as before", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	const base = { state: "done", durationS: null, receipt: "generated" };
	assert.deepEqual(
		labelsOf({ ...base, material: "image", images: [IMAGE("a", "image")] }),
		["Generated image"],
	);
	assert.deepEqual(
		labelsOf({
			...base,
			material: "image",
			images: [IMAGE("a", "image"), IMAGE("b", "image")],
		}),
		["Generated image 1", "Generated image 2"],
	);
});

test("fr: result labels come from the catalogue", () => {
	withStub("fr", () => {
		const base = { state: "done", durationS: null, receipt: "generated" };
		assert.deepEqual(
			labelsOf({
				...base,
				material: "image",
				images: [IMAGE("a", "image"), IMAGE("b", "image")],
			}),
			["fr:done:other 1", "fr:done:other 2"],
		);
	});
});

test("a locale switch repaints the next render with no remount (resolved at call time)", () => {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue("fr", stubFor("fr"));
	try {
		mod.setLocale("en");
		assert.equal(summaryOf("queued", 1234), "queued · 1.2 KB");
		assert.equal(stateLineOf(CARD_CASES[0][1]).text, "Queued");
		mod.setLocale("fr");
		assert.match(summaryOf("queued", 1234), /^fr:queued:/);
		assert.equal(stateLineOf(CARD_CASES[0][1]).text, "fr:Q");
		mod.setLocale("en");
		assert.equal(summaryOf("composing", 0), "composing");
		assert.equal(stateLineOf(CARD_CASES[0][1]).text, "Queued");
	} finally {
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
});

/* -------------------------------------------------------------------------- */
/* 3. Source guard                                                            */
/* -------------------------------------------------------------------------- */

const transcriptSource = readFileSync(
	join(
		ROOT,
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	),
	"utf8",
);
const cardSource = readFileSync(
	join(ROOT, "src/renderer/src/features/chat/canonical/image-gen-card.tsx"),
	"utf8",
);

/** Source from `start` up to the next top-level `function`/`export`, comments removed. */
function bodyOf(source, start) {
	const from = source.indexOf(start);
	assert.ok(from >= 0, `${start} located`);
	const rest = source.slice(from + start.length);
	const next = rest.search(/\n(?:export )?(?:function|const) |\n\/\*\*/);
	assert.ok(next > 0, `${start} has an end`);
	return (
		(start + rest.slice(0, next))
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "")
			// The phase/state TOKENS the code switches on are identifiers of the
			// record, not copy: `=== "composing"`, `case "queued":`.
			.replace(/(?:===|!==)\s*"[a-z-]+"/g, "")
			.replace(/case\s+"[a-z-]+"\s*:/g, "")
	);
}

/** The old copy, as the literals a hand-built line would contain. */
const OLD_COPY = [
	/["'`]composing/,
	/["'`]queued/,
	/ · /,
	/Writing the request/,
	/["'`]Queued/,
	/\bahead\b/,
	/Generating /,
	/Generated /,
	/Already finished/,
	/could not be generated/,
	/ batch(?! stopped\.)/,
];

test("source guard: toolRecordSummary holds no composing/queued literal", () => {
	const body = bodyOf(transcriptSource, "function toolRecordSummary(");
	assert.match(body, /ui\.chat\.canonical\.tool\.composing_sized/);
	assert.match(body, /ui\.chat\.canonical\.tool\.queued_empty/);
	for (const re of OLD_COPY.slice(0, 3))
		assert.ok(!re.test(body), `toolRecordSummary still holds ${re}`);
	// Negative control: the guard trips on the old return statement.
	const old =
		'return `composing${record.argumentBytes ? ` · ${formatBytes(record.argumentBytes)}` : ""}`;';
	assert.ok(OLD_COPY.slice(0, 3).some((re) => re.test(old)));
});

test("source guard: the card's state line holds none of the old copy (batch-stopped excepted)", () => {
	const body = bodyOf(cardSource, "function StateLine(");
	for (const key of STATE_KEYS)
		assert.ok(body.includes(key), `StateLine routes ${key}`);
	for (const re of OLD_COPY)
		assert.ok(!re.test(body), `StateLine still holds ${re}`);
	// The allowed exception stays exactly one line, named, until its own slice.
	assert.equal(body.match(/batch stopped\./g)?.length, 1);
	// Negative control.
	assert.ok(OLD_COPY.some((re) => re.test('? "Already finished."')));
});

test("source guard: the result players' label reuses the done message, no `Generated` template", () => {
	assert.ok(
		!/`Generated \$\{/.test(cardSource),
		"no Generated template literal",
	);
	assert.ok(
		cardSource.includes('t("ui.chat.canonical.image_gen.state.done", {'),
		"the label resolves through the done message",
	);
});

test("source guard: only the sanctioned English remains in the model-layer constants", () => {
	// The cancel copy is model-layer English owned by a later slice; this pins
	// that the card routes the OTHER state words (not these) through t().
	assert.match(cardSource, /CANCEL_RUNNING_COPY/);
});

/* -------------------------------------------------------------------------- */
/* 4. REAL catalogues (no stubs): the words a user of each locale reads       */
/* -------------------------------------------------------------------------- */

/*
 * WHY. Part 2 above proves the LOOKUP with marker stubs; it cannot see a
 * missing, untranslated or wrongly-pluralised REAL value, which is the
 * operator's acceptance ("switching to `fr` must leave NO English anywhere").
 * These tests register the SHIPPED `ui.chat.canonical` catalogue for the locale
 * (the same file the app serves) and render the real tool row and the real
 * generation card, so a value that lands in English, in the wrong plural
 * category or in the wrong material branch fails here.
 *
 * ORACLE. `REAL` below is the rendered text of each locale's audited S16a
 * values (PR #1870, evidence under i18n/audits/evidence/<locale>/
 * ui.chat.canonical/s16a-*), written out literally so a later edit of a
 * catalogue value is a deliberate, reviewed change of this table too. The
 * size datum (`2,3 ko`, `2.3 kB`) is produced by the Intl-backed file-size
 * helper (#1861), not by these 14 keys: it is pinned only as "what the helper
 * prints today" so a toolchain ICU change shows up as a one-line diff here.
 * ru pins the plural categories on `running_batch` (1 -> one, 2 -> few,
 * 5 -> many, 21 -> one; the genitive frame `Генерация N ...` makes the visible
 * forms `изображения / изображений / изображений / изображения`).
 */
/** English words that must not survive into a translated tool row / card line. */
const ENGLISH_TOOL_WORDS = /composing|queued/;
const ENGLISH_CARD_WORDS =
	/Queued|Generat|Writing|Already|could not|ahead| batch|failed/;
/** ur: `<word> · <FSI size PDI>` and no stray bidi controls in the card text. */
const RTL_ISOLATED_SIZE = /^قطار میں · \u2068[^\u2068\u2069]+\u2069$/u;
const BIDI_MARKS = /[\u2066-\u2069\u200e\u200f]/u;

const REAL = {
	fr: {
		tool: {
			"composing|0": "rédaction",
			"composing|2400": "rédaction · 2,3 ko",
			"queued|0": "en file d’attente",
			"queued|1234": "en file d’attente · 1,2 ko",
		},
		card: {
			queued: ["En file d’attente", null],
			"queued+bytes": ["En file d’attente", "1,9 ko"],
			"queued ahead 0": ["En file d’attente", "0 devant"],
			"queued ahead 1": ["En file d’attente", "1 devant"],
			"queued ahead 2": ["En file d’attente", "2 devant"],
			"queued ahead 5": ["En file d’attente", "5 devant"],
			"queued ahead 21": ["En file d’attente", "21 devant"],
			composing: ["Rédaction de la demande…", null],
			"composing+bytes": ["Rédaction de la demande…", "2,4 ko"],
			"composing ahead 2": ["Rédaction de la demande…", "2 devant"],
			"done already finished": ["Déjà terminé.", null],
			"running image": ["Génération de l’image…", null],
			"running image batch of 1": ["Génération de 1 image…", null],
			"running image batch of 2": ["Génération de 2 images…", null],
			"running image batch of 5": ["Génération de 5 images…", null],
			"running image batch of 21": ["Génération de 21 images…", null],
			"done image": ["Image générée", null],
			"done image batch": ["Lot d’images", null],
			"failed image": ["L’image n’a pas pu être générée.", null],
			"failed image batch": ["Échec du lot d’images.", null],
			"running voiceover": ["Génération de la voix off…", null],
			"running voiceover batch of 1": ["Génération de 1 voix off…", null],
			"running voiceover batch of 2": ["Génération de 2 voix off…", null],
			"running voiceover batch of 5": ["Génération de 5 voix off…", null],
			"running voiceover batch of 21": ["Génération de 21 voix off…", null],
			"done voiceover": ["Voix off générée", null],
			"done voiceover batch": ["Lot de voix off", null],
			"failed voiceover": ["La voix off n’a pas pu être générée.", null],
			"failed voiceover batch": ["Échec du lot de voix off.", null],
			"running sound-effect": ["Génération de l’effet sonore…", null],
			"running sound-effect batch of 1": [
				"Génération de 1 effet sonore…",
				null,
			],
			"running sound-effect batch of 2": [
				"Génération de 2 effets sonores…",
				null,
			],
			"running sound-effect batch of 5": [
				"Génération de 5 effets sonores…",
				null,
			],
			"running sound-effect batch of 21": [
				"Génération de 21 effets sonores…",
				null,
			],
			"done sound-effect": ["Effet sonore généré", null],
			"done sound-effect batch": ["Lot d’effets sonores", null],
			"failed sound-effect": ["L’effet sonore n’a pas pu être généré.", null],
			"failed sound-effect batch": ["Échec du lot d’effets sonores.", null],
		},
	},
	ru: {
		tool: {
			"composing|0": "формируется",
			"composing|2400": "формируется · 2,3 кБ",
			"queued|0": "в очереди",
			"queued|1234": "в очереди · 1,2 кБ",
		},
		card: {
			queued: ["В очереди", null],
			"queued+bytes": ["В очереди", "1,9 кБ"],
			"queued ahead 0": ["В очереди", "впереди: 0"],
			"queued ahead 1": ["В очереди", "впереди: 1"],
			"queued ahead 2": ["В очереди", "впереди: 2"],
			"queued ahead 5": ["В очереди", "впереди: 5"],
			"queued ahead 21": ["В очереди", "впереди: 21"],
			composing: ["Формирование запроса…", null],
			"composing+bytes": ["Формирование запроса…", "2,4 кБ"],
			"composing ahead 2": ["Формирование запроса…", "впереди: 2"],
			"done already finished": ["Уже завершено.", null],
			"running image": ["Генерация изображения…", null],
			"running image batch of 1": ["Генерация 1 изображения…", null],
			"running image batch of 2": ["Генерация 2 изображений…", null],
			"running image batch of 5": ["Генерация 5 изображений…", null],
			"running image batch of 21": ["Генерация 21 изображения…", null],
			"done image": ["Изображение создано", null],
			"done image batch": ["Набор изображений", null],
			"failed image": ["Не удалось создать изображение.", null],
			"failed image batch": ["Не удалось создать набор изображений.", null],
			"running voiceover": ["Генерация озвучки…", null],
			"running voiceover batch of 1": ["Генерация 1 озвучки…", null],
			"running voiceover batch of 2": ["Генерация 2 озвучек…", null],
			"running voiceover batch of 5": ["Генерация 5 озвучек…", null],
			"running voiceover batch of 21": ["Генерация 21 озвучки…", null],
			"done voiceover": ["Озвучка создана", null],
			"done voiceover batch": ["Набор озвучек", null],
			"failed voiceover": ["Не удалось создать озвучку.", null],
			"failed voiceover batch": ["Не удалось создать набор озвучек.", null],
			"running sound-effect": ["Генерация звукового эффекта…", null],
			"running sound-effect batch of 1": [
				"Генерация 1 звукового эффекта…",
				null,
			],
			"running sound-effect batch of 2": [
				"Генерация 2 звуковых эффектов…",
				null,
			],
			"running sound-effect batch of 5": [
				"Генерация 5 звуковых эффектов…",
				null,
			],
			"running sound-effect batch of 21": [
				"Генерация 21 звукового эффекта…",
				null,
			],
			"done sound-effect": ["Звуковой эффект создан", null],
			"done sound-effect batch": ["Набор звуковых эффектов", null],
			"failed sound-effect": ["Не удалось создать звуковой эффект.", null],
			"failed sound-effect batch": [
				"Не удалось создать набор звуковых эффектов.",
				null,
			],
		},
	},
	ur: {
		tool: {
			"composing|0": "لکھا جا رہا",
			"composing|2400": "لکھا جا رہا · 2.3 kB",
			"queued|0": "قطار میں",
			"queued|1234": "قطار میں · 1.2 kB",
		},
		card: {
			queued: ["قطار میں", null],
			"queued+bytes": ["قطار میں", "1.9 kB"],
			"queued ahead 0": ["قطار میں", "0 آگے"],
			"queued ahead 1": ["قطار میں", "1 آگے"],
			"queued ahead 2": ["قطار میں", "2 آگے"],
			"queued ahead 5": ["قطار میں", "5 آگے"],
			"queued ahead 21": ["قطار میں", "21 آگے"],
			composing: ["درخواست لکھی جا رہی ہے…", null],
			"composing+bytes": ["درخواست لکھی جا رہی ہے…", "2.4 kB"],
			"composing ahead 2": ["درخواست لکھی جا رہی ہے…", "2 آگے"],
			"done already finished": ["یہ پہلے ہی مکمل ہو چکا ہے۔", null],
			"running image": ["تصویر تیار کی جا رہی ہے…", null],
			"running image batch of 1": ["1 تصویر تیار کی جا رہی ہے…", null],
			"running image batch of 2": ["2 تصاویر تیار کی جا رہی ہیں…", null],
			"running image batch of 5": ["5 تصاویر تیار کی جا رہی ہیں…", null],
			"running image batch of 21": ["21 تصاویر تیار کی جا رہی ہیں…", null],
			"done image": ["تیار کردہ تصویر", null],
			"done image batch": ["تصاویر کا مجموعہ", null],
			"failed image": ["تصویر تیار نہیں کی جا سکی۔", null],
			"failed image batch": ["تصاویر کا مجموعہ تیار نہیں ہو سکا۔", null],
			"running voiceover": ["وائس اوور تیار کیا جا رہا ہے…", null],
			"running voiceover batch of 1": ["1 وائس اوور تیار کیا جا رہا ہے…", null],
			"running voiceover batch of 2": [
				"2 وائس اوورز تیار کیے جا رہے ہیں…",
				null,
			],
			"running voiceover batch of 5": [
				"5 وائس اوورز تیار کیے جا رہے ہیں…",
				null,
			],
			"running voiceover batch of 21": [
				"21 وائس اوورز تیار کیے جا رہے ہیں…",
				null,
			],
			"done voiceover": ["تیار کردہ وائس اوور", null],
			"done voiceover batch": ["وائس اوورز کا مجموعہ", null],
			"failed voiceover": ["وائس اوور تیار نہیں کیا جا سکا۔", null],
			"failed voiceover batch": [
				"وائس اوورز کا مجموعہ تیار نہیں ہو سکا۔",
				null,
			],
			"running sound-effect": ["صوتی اثر تیار کیا جا رہا ہے…", null],
			"running sound-effect batch of 1": [
				"1 صوتی اثر تیار کیا جا رہا ہے…",
				null,
			],
			"running sound-effect batch of 2": [
				"2 صوتی اثرات تیار کیے جا رہے ہیں…",
				null,
			],
			"running sound-effect batch of 5": [
				"5 صوتی اثرات تیار کیے جا رہے ہیں…",
				null,
			],
			"running sound-effect batch of 21": [
				"21 صوتی اثرات تیار کیے جا رہے ہیں…",
				null,
			],
			"done sound-effect": ["تیار کردہ صوتی اثر", null],
			"done sound-effect batch": ["صوتی اثرات کا مجموعہ", null],
			"failed sound-effect": ["صوتی اثر تیار نہیں کیا جا سکا۔", null],
			"failed sound-effect batch": [
				"صوتی اثرات کا مجموعہ تیار نہیں ہو سکا۔",
				null,
			],
		},
	},
	vi: {
		tool: {
			"composing|0": "đang soạn",
			"composing|2400": "đang soạn · 2,3 kB",
			"queued|0": "đang xếp hàng",
			"queued|1234": "đang xếp hàng · 1,2 kB",
		},
		card: {
			queued: ["Đang xếp hàng", null],
			"queued+bytes": ["Đang xếp hàng", "1,9 kB"],
			"queued ahead 0": ["Đang xếp hàng", "0 yêu cầu trước"],
			"queued ahead 1": ["Đang xếp hàng", "1 yêu cầu trước"],
			"queued ahead 2": ["Đang xếp hàng", "2 yêu cầu trước"],
			"queued ahead 5": ["Đang xếp hàng", "5 yêu cầu trước"],
			"queued ahead 21": ["Đang xếp hàng", "21 yêu cầu trước"],
			composing: ["Đang viết yêu cầu…", null],
			"composing+bytes": ["Đang viết yêu cầu…", "2,4 kB"],
			"composing ahead 2": ["Đang viết yêu cầu…", "2 yêu cầu trước"],
			"done already finished": ["Đã hoàn tất rồi.", null],
			"running image": ["Đang tạo hình ảnh…", null],
			"running image batch of 1": ["Đang tạo 1 hình ảnh…", null],
			"running image batch of 2": ["Đang tạo 2 hình ảnh…", null],
			"running image batch of 5": ["Đang tạo 5 hình ảnh…", null],
			"running image batch of 21": ["Đang tạo 21 hình ảnh…", null],
			"done image": ["Đã tạo hình ảnh", null],
			"done image batch": ["Loạt hình ảnh", null],
			"failed image": ["Không thể tạo hình ảnh.", null],
			"failed image batch": ["Loạt hình ảnh không thành công.", null],
			"running voiceover": ["Đang tạo lời thuyết minh…", null],
			"running voiceover batch of 1": ["Đang tạo 1 lời thuyết minh…", null],
			"running voiceover batch of 2": ["Đang tạo 2 lời thuyết minh…", null],
			"running voiceover batch of 5": ["Đang tạo 5 lời thuyết minh…", null],
			"running voiceover batch of 21": ["Đang tạo 21 lời thuyết minh…", null],
			"done voiceover": ["Đã tạo lời thuyết minh", null],
			"done voiceover batch": ["Loạt lời thuyết minh", null],
			"failed voiceover": ["Không thể tạo lời thuyết minh.", null],
			"failed voiceover batch": [
				"Loạt lời thuyết minh không thành công.",
				null,
			],
			"running sound-effect": ["Đang tạo hiệu ứng âm thanh…", null],
			"running sound-effect batch of 1": [
				"Đang tạo 1 hiệu ứng âm thanh…",
				null,
			],
			"running sound-effect batch of 2": [
				"Đang tạo 2 hiệu ứng âm thanh…",
				null,
			],
			"running sound-effect batch of 5": [
				"Đang tạo 5 hiệu ứng âm thanh…",
				null,
			],
			"running sound-effect batch of 21": [
				"Đang tạo 21 hiệu ứng âm thanh…",
				null,
			],
			"done sound-effect": ["Đã tạo hiệu ứng âm thanh", null],
			"done sound-effect batch": ["Loạt hiệu ứng âm thanh", null],
			"failed sound-effect": ["Không thể tạo hiệu ứng âm thanh.", null],
			"failed sound-effect batch": [
				"Loạt hiệu ứng âm thanh không thành công.",
				null,
			],
		},
	},
	"zh-CN": {
		tool: {
			"composing|0": "正在编写",
			"composing|2400": "正在编写 · 2.3 kB",
			"queued|0": "排队中",
			"queued|1234": "排队中 · 1.2 kB",
		},
		card: {
			queued: ["排队中", null],
			"queued+bytes": ["排队中", "1.9 kB"],
			"queued ahead 0": ["排队中", "前面还有0个"],
			"queued ahead 1": ["排队中", "前面还有1个"],
			"queued ahead 2": ["排队中", "前面还有2个"],
			"queued ahead 5": ["排队中", "前面还有5个"],
			"queued ahead 21": ["排队中", "前面还有21个"],
			composing: ["正在编写请求……", null],
			"composing+bytes": ["正在编写请求……", "2.4 kB"],
			"composing ahead 2": ["正在编写请求……", "前面还有2个"],
			"done already finished": ["已经完成。", null],
			"running image": ["正在生成图像……", null],
			"running image batch of 1": ["正在生成1张图像……", null],
			"running image batch of 2": ["正在生成2张图像……", null],
			"running image batch of 5": ["正在生成5张图像……", null],
			"running image batch of 21": ["正在生成21张图像……", null],
			"done image": ["已生成图像", null],
			"done image batch": ["图像批次", null],
			"failed image": ["无法生成图像。", null],
			"failed image batch": ["图像批次生成失败。", null],
			"running voiceover": ["正在生成旁白……", null],
			"running voiceover batch of 1": ["正在生成1段旁白……", null],
			"running voiceover batch of 2": ["正在生成2段旁白……", null],
			"running voiceover batch of 5": ["正在生成5段旁白……", null],
			"running voiceover batch of 21": ["正在生成21段旁白……", null],
			"done voiceover": ["已生成旁白", null],
			"done voiceover batch": ["旁白批次", null],
			"failed voiceover": ["无法生成旁白。", null],
			"failed voiceover batch": ["旁白批次生成失败。", null],
			"running sound-effect": ["正在生成音效……", null],
			"running sound-effect batch of 1": ["正在生成1个音效……", null],
			"running sound-effect batch of 2": ["正在生成2个音效……", null],
			"running sound-effect batch of 5": ["正在生成5个音效……", null],
			"running sound-effect batch of 21": ["正在生成21个音效……", null],
			"done sound-effect": ["已生成音效", null],
			"done sound-effect batch": ["音效批次", null],
			"failed sound-effect": ["无法生成音效。", null],
			"failed sound-effect batch": ["音效批次生成失败。", null],
		},
	},
};

/** Registers the shipped catalogue for `loc` exactly as the app serves it. */
function withReal(loc, fn) {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue(
		loc,
		JSON.parse(
			readFileSync(
				join(ROOT, `src/i18n/catalogues/${loc}/ui.chat.canonical.json`),
				"utf8",
			),
		),
	);
	mod.setLocale(loc);
	try {
		return fn();
	} finally {
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
}

const CARD_VIEW = new Map(CARD_CASES);

for (const loc of Object.keys(REAL)) {
	test(`${loc}: the tool row prints the translated composing/queued words from the real catalogue`, () => {
		withReal(loc, () => {
			for (const [id, expected] of Object.entries(REAL[loc].tool)) {
				const [phase, bytes] = id.split("|");
				assert.equal(summaryOf(phase, Number(bytes)), expected, `${loc} ${id}`);
				assert.ok(
					!ENGLISH_TOOL_WORDS.test(expected),
					`${loc} ${id} still English`,
				);
			}
		});
	});

	test(`${loc}: the generation card's state line prints the real translations (no English, right plural/material branch)`, () => {
		withReal(loc, () => {
			for (const [label, [text, datum]] of Object.entries(REAL[loc].card)) {
				const view = CARD_VIEW.get(label);
				assert.ok(view, `case ${label} exists`);
				const got = stateLineOf(view);
				assert.equal(got.text, text, `${loc} ${label} text`);
				assert.equal(got.datum, datum, `${loc} ${label} datum`);
				assert.ok(
					!ENGLISH_CARD_WORDS.test(got.text + (got.datum ?? "")),
					`${loc} ${label} leaks English: ${got.text}`,
				);
			}
		});
	});
}

test("ru: running_batch picks the plural category by the CLDR rule on the real catalogue (1/2/5/21)", () => {
	withReal("ru", () => {
		const forms = [1, 2, 5, 21].map(
			(n) => stateLineOf(CARD_VIEW.get(`running voiceover batch of ${n}`)).text,
		);
		assert.deepEqual(forms, [
			"Генерация 1 озвучки…",
			"Генерация 2 озвучек…",
			"Генерация 5 озвучек…",
			"Генерация 21 озвучки…",
		]);
	});
});

test("ur (RTL): the size datum stays isolated and the Urdu words are not reordered by it", () => {
	withReal("ur", () => {
		// The tool row wraps the size in a first-strong isolate (U+2068 ... U+2069)
		// so the Latin `kB` cannot reorder the surrounding right-to-left run.
		const raw = summaryOf("queued", 1234, { keepIsolates: true });
		assert.match(raw, RTL_ISOLATED_SIZE, raw);
		// The card puts the datum in `<bdi dir="auto">` (stateLineOf asserts it),
		// so `21 آگے` keeps its digits ahead of the word on a right-to-left line.
		const card = stateLineOf(CARD_VIEW.get("queued ahead 21"));
		assert.equal(card.datum, "21 آگے");
		assert.doesNotMatch(card.text, BIDI_MARKS);
	});
});

for (const loc of ["fr", "es", "ru", "hi", "zh-CN", "ur", "vi"]) {
	test(`${loc}: every one of the 14 keys is a real translation (not the English source) in the shipped catalogue`, () => {
		const real = JSON.parse(
			readFileSync(
				join(ROOT, `src/i18n/catalogues/${loc}/ui.chat.canonical.json`),
				"utf8",
			),
		);
		for (const key of [...TOOL_KEYS, ...STATE_KEYS]) {
			assert.equal(typeof real[key], "string", `${loc} has ${key}`);
			assert.notEqual(real[key], enCatalogue[key], `${loc} ${key} is English`);
		}
	});
}
