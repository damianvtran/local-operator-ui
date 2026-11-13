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
 * THE GENERATION CARDS' REMAINING LABELS RESOLVE THROUGH THE CATALOGUE
 * (S16f, English first: "switching to `fr` must leave NO English anywhere in the
 * interface ... and the same must hold for every supported language").
 *
 * #1870 keyed the card's STATE line. This slice keys the pure-renderer words
 * left around it - the sound batch's per-item status suffix and cost lines, its
 * summary and live "latest update" line, the positional media labels
 * ("Image 2", "Sound") and the supplement sound player's fallback name - and
 * repairs the one English-coupled query (the lightbox strip's focus lookup, in
 * `chat-image-expand.test.mjs`).
 *
 * THREE LOCKS, like `tool-state-copy.test.mjs` (the ratchet baseline is empty
 * and cannot see a `return` or a template string):
 *
 * 1. ENGLISH BYTE-IDENTITY. The `old*` functions below are the pre-change
 *    formulas copied VERBATIM from origin/main (7c43086791f) and swept over a
 *    grid of inputs; the keyed output must equal them character for character.
 * 2. LOOKUP IS PROVEN. fr / ru / ur get a test-only catalogue of marker
 *    messages (ICU of the right shape, text that is not language) registered
 *    through the same seam the served catalogues use; every label must then
 *    print the marker and none of the English.
 * 3. SOURCE GUARD. The call sites hold none of the old literals, and no `t()`
 *    runs at module scope (it would freeze the boot locale).
 *
 * NOT IN THIS SLICE (pinned below so the exceptions cannot grow a neighbour):
 * the cost caption "Cost $0.0123 (billed)." and the batch total built from it
 * by `caption.slice(5)` (needs structured cost facts first), the reducer-baked
 * settlement caption, durations, and everything that needs a backend wire code.
 */

const ROOT = process.cwd();
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const bundle = await build({
	stdin: {
		contents: `export { SoundBatch } from "./src/renderer/src/features/chat/canonical/sound-batch";
 export { ImageGenCard } from "./src/renderer/src/features/chat/canonical/image-gen-card";
 export { imageGenCardView } from "./src/renderer/src/features/chat/canonical/image-gen-card-model";
 export { soundBatchItems, soundBatchSummary, soundBatchCostCaption, soundBatchProgress } from "./src/renderer/src/features/chat/canonical/sound-batch-model";
 export { imageLabel, soundLabel } from "./src/renderer/src/features/chat/canonical/media-label";
 export { FoldMedia } from "./src/renderer/src/features/chat/canonical/fold-media";
 export { setLocale, registerCatalogue, clearRegisteredCatalogues, t } from "./src/i18n";`,
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
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
// A FILE, not a data: URL: the bundle keeps `react` external and a data: module
// cannot resolve a bare specifier (see tool-state-copy.test.mjs).
const bundlePath = new URL(
	"./_generation-card-labels.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const {
	SoundBatch,
	ImageGenCard,
	imageGenCardView,
	soundBatchItems,
	soundBatchSummary,
	soundBatchCostCaption,
	soundBatchProgress,
	imageLabel,
	soundLabel,
	FoldMedia,
} = mod;

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

const NEW_KEYS = {
	item_status: "ui.chat.canonical.sound.batch.item_status",
	summary: "ui.chat.canonical.sound.batch.summary",
	latest_update: "ui.chat.canonical.sound.batch.latest_update",
	cost_unknown: "ui.chat.canonical.sound.cost.unknown",
	cost_no_charge: "ui.chat.canonical.sound.cost.no_charge",
	cost_estimated_zero: "ui.chat.canonical.sound.cost.estimated_zero",
	cost_batch_unknown: "ui.chat.canonical.sound.cost.batch_unknown",
	image_label: "ui.chat.canonical.media.image_label",
	sound_label: "ui.chat.canonical.media.sound_label",
	sound_fallback: "ui.chat.canonical.supplement.sound_fallback_label",
};
const ALL_KEYS = Object.values(NEW_KEYS);

/* -------------------------------------------------------------------------- */
/* The pre-change formulas, verbatim from origin/main (7c43086791f)           */
/* -------------------------------------------------------------------------- */

const oldItemSuffix = (status) =>
	status !== "completed"
		? ` · ${status === "unknown" ? "Status unknown" : status === "cancelled" ? "Stopped" : "Failed"}`
		: "";

function oldSummary(details, items) {
	const result = details;
	const count = (key) => {
		const value = result[key];
		return typeof value === "number" && Number.isInteger(value) && value >= 0
			? value
			: items.filter((item) => item.status === key).length;
	};
	const cancelled = count("cancelled");
	const unknown = items.filter((item) => item.status === "unknown").length;
	const attention = items.filter((item) => item.status !== "completed");
	return `${count("completed")} completed · ${count("failed")} failed${cancelled ? ` · ${cancelled} cancelled/stopped` : ""}${unknown ? ` · ${unknown} status unknown` : ""}${attention.length ? `. Needs attention: ${attention.map((item) => item.label).join("; ")}` : ""}`;
}

const oldProgressNote = (item, total, name) =>
	typeof item === "number" &&
	Number.isInteger(item) &&
	item >= 1 &&
	item <= total &&
	typeof name === "string"
		? `Latest update: ${name} (item ${item} of ${total}).`
		: null;

const oldImageLabel = (position, count) =>
	count === 1 ? "Image" : `Image ${position}`;
const oldSoundLabel = (position, count) =>
	count === 1 ? "Sound" : `Sound ${position}`;

/* -------------------------------------------------------------------------- */
/* Fixtures and rendering seams                                               */
/* -------------------------------------------------------------------------- */

const plain = (s) => s.replace(/[\u2066-\u2069]/g, "");
const decode = (s) =>
	s
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"');

/** A receipt like the tool's: `statuses[i]` is completed / failed / cancelled / <anything else>. */
function receipt(statuses, { names, costs } = {}) {
	const artifacts = statuses.map((status, index) => {
		const failed = status === "failed";
		return {
			name: names?.[index] ?? `Sound ${index + 1}`,
			digest: failed || status === "cancelled" ? null : `digest-${index}`,
			duration_s: 2 + index,
			cost_usd: costs?.[index] ?? (failed ? 0 : (index + 1) / 1000),
			cost: {
				amount_usd: costs?.[index] ?? (failed ? 0 : (index + 1) / 1000),
				basis: index % 2 ? "estimated" : "billed",
			},
			status,
			request_id: `fixture-${index}`,
			error: failed ? "audio_rejected: server returned 400" : null,
		};
	});
	const images = artifacts
		.filter((a) => a.digest)
		.map((a) => ({
			id: a.digest,
			attachment: a.digest,
			kind: "audio",
			data: "AAAA",
			mimeType: "audio/wav",
			durationS: a.duration_s,
			name: a.name,
		}));
	return { artifacts, images };
}

const TS = 1_760_000_000_000;
const toolRecord = (over = {}) => ({
	kind: "tool",
	id: "tool:1",
	ts: TS,
	toolCallId: "call:1",
	toolName: "generate_sound_effect",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	notRunReason: null,
	notRunKind: null,
	neverSent: false,
	output: null,
	isError: false,
	durationS: null,
	startedAt: TS,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	details: null,
	...over,
});

const cardHtml = (view) =>
	renderToStaticMarkup(
		h(
			QueryClientProvider,
			{ client: queryClient },
			h(ImageGenCard, { view, scope: null, actions: undefined }),
		),
	);

/** The text of every `<p>` in some markup, tags stripped, entities decoded. */
const paragraphs = (html) =>
	[...html.matchAll(/<p\b[^>]*>(.*?)<\/p>/gs)].map((m) =>
		decode(m[1].replace(/<[^>]*>/g, "")),
	);

/** The batch as the card hands it to `SoundBatch`, rendered alone. */
function batchHtml(statuses, opts = {}, detailsOver = {}) {
	const { artifacts, images } = receipt(statuses, opts);
	const details = { artifacts, cost_complete: true, ...detailsOver };
	const items = soundBatchItems(details, images);
	return {
		html: renderToStaticMarkup(
			h(SoundBatch, {
				items,
				summary: soundBatchSummary(details, items),
				scope: null,
			}),
		),
		items,
		details,
	};
}

/* -------------------------------------------------------------------------- */
/* Test-only catalogues: the right ICU shape per key, text that is a marker   */
/* -------------------------------------------------------------------------- */

const CATEGORIES = {
	fr: ["one", "many", "other"],
	ru: ["one", "few", "many", "other"],
	ur: ["one", "other"],
};
const pluralOf = (arg, cats, body) =>
	`{${arg}, plural, ${cats.map((c) => `${c} {${body(c)}}`).join(" ")}}`;

function stubFor(loc) {
	const cats = CATEGORIES[loc];
	return {
		[NEW_KEYS.item_status]: `{status, select, failed {{label} ${loc}:failed} cancelled {{label} ${loc}:stopped} other {{label} ${loc}:unknown}}`,
		[NEW_KEYS.summary]: `${loc}:sum ${pluralOf("completed", cats, (c) => `c:${c}:{completed, number, ::group-off}`)} ${pluralOf("failed", cats, (c) => `f:${c}:{failed, number, ::group-off}`)}{cancelled, plural, =0 {} other { x:{cancelled, number, ::group-off}}}{unknown, plural, =0 {} other { u:{unknown, number, ::group-off}}}{has_attention, select, yes { attn:{labels}} other {}}`,
		[NEW_KEYS.latest_update]: `${loc}:latest:{name}:{item, number, ::group-off}/{total, number, ::group-off}`,
		[NEW_KEYS.cost_unknown]: `${loc}:cost-unknown`,
		[NEW_KEYS.cost_no_charge]: `${loc}:no-charge`,
		[NEW_KEYS.cost_estimated_zero]: `${loc}:est-zero`,
		[NEW_KEYS.cost_batch_unknown]: `${loc}:total-unknown`,
		[NEW_KEYS.image_label]: `{count, plural, =1 {${loc}:img} other {${loc}:img:{position, number, ::group-off}}}`,
		[NEW_KEYS.sound_label]: `{count, plural, =1 {${loc}:snd} other {${loc}:snd:{position, number, ::group-off}}}`,
		[NEW_KEYS.sound_fallback]: `${loc}:generated-sound`,
	};
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

/* -------------------------------------------------------------------------- */
/* 0. The keys exist, with context                                            */
/* -------------------------------------------------------------------------- */

test("the 10 new keys exist in the English source with a context entry each", () => {
	assert.equal(ALL_KEYS.length, 10);
	for (const key of ALL_KEYS) {
		assert.equal(typeof enCatalogue[key], "string", `${key} in source`);
		const context = contexts[key];
		assert.ok(context, `${key} has a context entry`);
		for (const field of ["role", "tone", "length", "note"])
			assert.equal(typeof context[field], "string", `${key} ${field}`);
	}
});

test("every ICU argument of a new key is described in its context sidecar", () => {
	for (const key of ALL_KEYS) {
		const args = new Set(
			[...enCatalogue[key].matchAll(/\{\s*([a-z_]+)\s*[,}]/g)].map((m) => m[1]),
		);
		const described = Object.keys(contexts[key]?.placeholders ?? {});
		for (const name of args)
			assert.ok(described.includes(name), `${key}: ${name} described`);
	}
});

/* -------------------------------------------------------------------------- */
/* 1. English byte-identity against the pre-change formulas                   */
/* -------------------------------------------------------------------------- */

test("English: the item suffix, the 'unavailable' and cost lines render exactly as before", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	const { html } = batchHtml(
		["completed", "failed", "cancelled", "future_status"],
		{ names: ["Rain", "Rain on glass", "Thunder", "Wind"] },
	);
	const lines = paragraphs(html);
	for (const [label, status] of [
		["Rain", "completed"],
		["Rain on glass", "failed"],
		["Thunder", "cancelled"],
		["Wind", "unknown"],
	])
		assert.ok(
			lines.includes(`${label}${oldItemSuffix(status)}`),
			`${label} line in ${JSON.stringify(lines)}`,
		);
	// A receipt row without a cost fact keeps the old fallback line.
	const none = renderToStaticMarkup(
		h(SoundBatch, {
			items: [
				{
					id: "a",
					name: "a",
					label: "a",
					audio: null,
					costCaption: null,
					error: null,
					status: "completed",
				},
			],
			summary: "s",
			scope: null,
		}),
	);
	assert.ok(paragraphs(none).includes("Cost not yet known."), none);
});

test("English: item cost lines for a failed zero-cost request are the old sentences", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	const { artifacts } = receipt(["failed", "failed"]);
	artifacts[0].cost.basis = "billed";
	artifacts[1].cost.basis = "estimated";
	const items = soundBatchItems({ artifacts, cost_complete: true }, []);
	assert.equal(items[0].costCaption, "No charge.");
	assert.equal(
		items[1].costCaption,
		"Estimated cost $0; final charge not confirmed.",
	);
	assert.equal(
		soundBatchCostCaption({ cost_complete: false }),
		"Total cost not yet known.",
	);
});

test("English: the batch summary equals the old formula across a grid of receipts", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	const grids = [
		[["completed"], {}],
		[["completed", "completed", "completed"], { completed: 3, failed: 0 }],
		[["completed", "failed"], { completed: 1, failed: 1, cancelled: 0 }],
		[["failed", "failed", "failed"], { completed: 0, failed: 3 }],
		[["completed", "cancelled", "cancelled"], { completed: 1, cancelled: 2 }],
		[["completed", "completed", "weird"], { completed: 2, failed: 0 }],
		[
			["completed", "failed", "cancelled", "weird"],
			{ completed: 1, failed: 1, cancelled: 1 },
		],
		// counters absent: the items decide; counters present but wrong-typed: items too.
		[["completed", "failed", "cancelled"], {}],
		[["completed", "failed"], { completed: "2", failed: -1 }],
		// a four-digit counter must not gain a thousands separator
		[["completed", "failed"], { completed: 1234, failed: 12345 }],
		[["failed"], { completed: 0, failed: 1, cancelled: 1000 }],
	];
	for (const [statuses, counters] of grids) {
		const { artifacts } = receipt(statuses, {
			names: statuses.map(
				(_, i) => ["Rain", "Rain", "Wind; gust", "Thunder"][i],
			),
		});
		const details = { artifacts, cost_complete: true, ...counters };
		const items = soundBatchItems(details, []);
		assert.equal(
			soundBatchSummary(details, items),
			oldSummary(details, items),
			JSON.stringify([statuses, counters]),
		);
	}
});

test("English: the running 'latest update' note equals the old template, and stays null off-range", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	for (const [item, total, name] of [
		[3, 10, "Rain"],
		[1, 1, "Rain on glass (2)"],
		[10, 10, "Wind; gust"],
		[11, 10, "Rain"],
		[0, 10, "Rain"],
		[1.5, 10, "Rain"],
		["3", 10, "Rain"],
		[3, 10, undefined],
	]) {
		const got = soundBatchProgress(
			{ sounds: [{}] },
			{ item, total, name },
		).note;
		assert.equal(
			got,
			oldProgressNote(item, total, name),
			String([item, total]),
		);
	}
	// And in the card the running batch still shows it as the note line.
	const view = imageGenCardView(
		toolRecord({
			phase: "running",
			details: { item: 3, total: 10, name: "Rain" },
		}),
	);
	assert.ok(
		paragraphs(cardHtml(view)).includes("Latest update: Rain (item 3 of 10)."),
	);
});

test("English: positional media labels equal the old scheme for 1..4 of 1..4", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	for (let count = 1; count <= 4; count++)
		for (let position = 1; position <= count; position++) {
			assert.equal(imageLabel(position, count), oldImageLabel(position, count));
			assert.equal(soundLabel(position, count), oldSoundLabel(position, count));
		}
	assert.equal(
		mod.t("ui.chat.canonical.supplement.sound_fallback_label"),
		"Generated sound",
	);
});

test("English: FoldMedia's tiles carry the same alt text as before", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	const image = (id) => ({
		id,
		data: "AAAA",
		attachment: null,
		mimeType: "image/png",
	});
	const alts = (images) =>
		[
			...renderToStaticMarkup(
				h(
					QueryClientProvider,
					{ client: queryClient },
					h(FoldMedia, { images, scope: null, onRevealMore: () => {} }),
				),
			).matchAll(/<img [^>]*alt="([^"]*)"/g),
		].map((m) => m[1]);
	assert.deepEqual(alts([image("a")]), ["Image"]);
	assert.deepEqual(alts([image("a"), image("b")]), ["Image 1", "Image 2"]);
});

/* -------------------------------------------------------------------------- */
/* 2. Lookup is proven: a non-English locale prints the marker, not English   */
/* -------------------------------------------------------------------------- */

const ENGLISH_BATCH_WORDS =
	/Failed|Stopped|Status unknown|Cost not yet known|No charge|Estimated cost|Needs attention| completed| failed|cancelled\/stopped|Latest update|Total cost not/;

for (const loc of ["fr", "ru", "ur"]) {
	test(`${loc}: the sound batch prints the keyed item suffix, cost and summary - no English`, () => {
		withStub(loc, () => {
			const { html, items } = batchHtml(
				["completed", "failed", "cancelled", "future_status"],
				{ names: ["Rain", "Rain on glass", "Thunder", "Wind"] },
			);
			const lines = paragraphs(html).map(plain);
			// ur's runtime isolates move nothing in the text once stripped.
			assert.ok(lines.includes(`Rain on glass ${loc}:failed`), lines.join("|"));
			assert.ok(lines.includes(`Thunder ${loc}:stopped`), lines.join("|"));
			assert.ok(lines.includes(`Wind ${loc}:unknown`), lines.join("|"));
			assert.ok(lines.includes("Rain"), "a completed item has no suffix");
			// Item costs come from the receipt's billed/estimated figures (the
			// excluded "Cost $X (billed)." sentence); the keyed fallback is the
			// no-fact line.
			// Item 1 is the fixture's "estimated" basis: a zero estimate, not a bill.
			assert.equal(items[1].costCaption, `${loc}:est-zero`);
			for (const line of lines.filter((l) => !/^Cost \$/.test(l)))
				assert.doesNotMatch(line, ENGLISH_BATCH_WORDS, line);
		});
	});

	test(`${loc}: item cost fallback, total fallback and the zero-estimate sentence are keyed`, () => {
		withStub(loc, () => {
			assert.equal(soundBatchCostCaption({}), `${loc}:total-unknown`);
			const { artifacts } = receipt(["failed"]);
			artifacts[0].cost.basis = "estimated";
			const [item] = soundBatchItems({ artifacts, cost_complete: true }, []);
			assert.equal(item.costCaption, `${loc}:est-zero`);
			artifacts[0].cost.basis = "billed";
			assert.equal(
				soundBatchItems({ artifacts, cost_complete: true }, [])[0].costCaption,
				`${loc}:no-charge`,
			);
			const html = renderToStaticMarkup(
				h(SoundBatch, {
					items: [{ ...item, costCaption: null }],
					summary: "s",
					scope: null,
				}),
			);
			assert.ok(paragraphs(html).includes(`${loc}:cost-unknown`), html);
		});
	});

	test(`${loc}: the summary picks the CLDR plural category per count and joins the labels with the locale's clause separator`, () => {
		withStub(loc, () => {
			const cat = (n) => new Intl.PluralRules(loc).select(n);
			const { artifacts } = receipt(["completed", "failed", "cancelled", "x"], {
				names: ["A", "B", "C", "D"],
			});
			const details = {
				artifacts,
				completed: 21,
				failed: 2,
				cancelled: 1,
				cost_complete: true,
			};
			const items = soundBatchItems(details, []);
			const separator = loc === "ur" ? "\u061B " : "; ";
			assert.equal(
				plain(soundBatchSummary(details, items)),
				`${loc}:sum c:${cat(21)}:21 f:${cat(2)}:2 x:1 u:1 attn:B${separator}C${separator}D`,
			);
			const clean = { ...details, artifacts: artifacts.slice(0, 1) };
			assert.equal(
				plain(soundBatchSummary(clean, soundBatchItems(clean, []))),
				`${loc}:sum c:${cat(21)}:21 f:${cat(2)}:2 x:1`,
			);
		});
	});

	test(`${loc}: the latest-update note and the positional labels are keyed`, () => {
		withStub(loc, () => {
			const note = soundBatchProgress(null, {
				item: 3,
				total: 10,
				name: "Rain",
			}).note;
			assert.equal(plain(note), `${loc}:latest:Rain:3/10`);
			assert.equal(imageLabel(1, 1), `${loc}:img`);
			assert.equal(imageLabel(2, 3), `${loc}:img:2`);
			assert.equal(soundLabel(1, 1), `${loc}:snd`);
			assert.equal(soundLabel(3, 3), `${loc}:snd:3`);
		});
	});
}

test("a locale switch re-renders the same view with the new words (no frozen boot locale)", () => {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue("fr", stubFor("fr"));
	try {
		mod.setLocale("en");
		const en = batchHtml(["failed"], { names: ["Rain"] }).html;
		assert.ok(paragraphs(en).includes("Rain · Failed"));
		mod.setLocale("fr");
		const fr = batchHtml(["failed"], { names: ["Rain"] }).html;
		assert.ok(paragraphs(fr).includes("Rain fr:failed"));
		mod.setLocale("en");
		assert.equal(imageLabel(2, 3), "Image 2");
	} finally {
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
});

test("ur (RTL): a Latin item name is isolated by the runtime, the keyed words are not wrapped in an LTR box", () => {
	withStub("ur", () => {
		const { html } = batchHtml(["failed"], { names: ["Rain"] });
		const line = paragraphs(html)[1];
		// FSI..PDI around the Latin-led plain argument: its internal order is its own.
		assert.equal(line, "\u2068Rain\u2069 ur:failed");
		// The keyed copy takes the document's direction: neither a forced
		// dir="ltr" box nor a hand-set direction on these paragraphs.
		assert.doesNotMatch(html, /dir="ltr"/);
		assert.doesNotMatch(html, /dir="rtl"/);
	});
});

/* -------------------------------------------------------------------------- */
/* 3. Source guard                                                            */
/* -------------------------------------------------------------------------- */

const canonicalDir = "src/renderer/src/features/chat/canonical";
const read = (file) => readFileSync(join(ROOT, canonicalDir, file), "utf8");
const strip = (source) =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/\s\/\/ .*$/gm, "");

/** Source from `start` up to the next top-level declaration. */
function bodyOf(source, start) {
	const from = source.indexOf(start);
	assert.ok(from >= 0, `${start} located`);
	const rest = source.slice(from + start.length);
	const next = rest.search(
		/\n(?:export )?(?:async )?(?:function|const) |\n\/\*\*/,
	);
	return strip(start + (next > 0 ? rest.slice(0, next) : rest));
}

const OLD_LITERALS = [
	/Status unknown/,
	/["'`]Stopped/,
	/["'`] · Failed/,
	/Failed"/,
	/Cost not yet known/,
	/No charge/,
	/Estimated cost/,
	/Total cost not yet known/,
	/ completed ·/,
	/\bfailed\$\{/,
	/cancelled\/stopped/,
	/status unknown/,
	/Needs attention/,
	/Latest update/,
	/"Image"/,
	/`Image \$\{/,
	/"Sound"/,
	/`Sound \$\{/,
	/Generated sound"/,
];

test("source guard: the sound batch component and model hold none of the old copy", () => {
	const batch = strip(read("sound-batch.tsx"));
	const model = strip(read("sound-batch-model.ts"));
	for (const re of OLD_LITERALS) assert.doesNotMatch(batch, re, `batch ${re}`);
	// The model keeps exactly the sanctioned exceptions: the cost caption sentence
	// the batch total is cut from (`caption.slice(5)`), which needs structured
	// cost facts first. Every other function is clean.
	for (const fn of [
		"function batchItemCostCaption(",
		"export function soundBatchSummary(",
		"export function soundBatchProgress(",
	]) {
		const body = bodyOf(read("sound-batch-model.ts"), fn);
		for (const re of OLD_LITERALS) assert.doesNotMatch(body, re, `${fn} ${re}`);
	}
	const total = bodyOf(
		read("sound-batch-model.ts"),
		"export function soundBatchCostCaption(",
	);
	assert.match(total, /sound\.cost\.batch_unknown/);
	assert.ok(
		total.includes("caption.slice(5)"),
		"the sanctioned exception stays pinned",
	);
	assert.equal(model.match(/Known total cost/g)?.length, 1);
	// Each key is routed from its call site.
	assert.match(batch, /sound\.batch\.item_status/);
	assert.match(batch, /sound\.cost\.unknown/);
	assert.match(model, /sound\.batch\.summary/);
	assert.match(model, /sound\.batch\.latest_update/);
	assert.match(model, /sound\.cost\.no_charge/);
	assert.match(model, /sound\.cost\.estimated_zero/);
	// Negative controls: the guard trips on the old template and on the old suffix.
	assert.ok(OLD_LITERALS.some((re) => re.test("`Latest update: ${name}`")));
	assert.ok(OLD_LITERALS.some((re) => re.test('"Status unknown"')));
});

test("source guard: the media labels come from one keyed helper, not four hand-built templates", () => {
	const helper = strip(read("media-label.ts"));
	assert.match(helper, /media\.image_label/);
	assert.match(helper, /media\.sound_label/);
	for (const file of [
		"image-group-lightbox.tsx",
		"fold-media.tsx",
		"canonical-transcript.tsx",
	]) {
		const source = strip(read(file));
		assert.doesNotMatch(source, /`Image \$\{/, `${file} Image template`);
		assert.doesNotMatch(source, /`Sound \$\{/, `${file} Sound template`);
		assert.doesNotMatch(source, /\? "Image"/, `${file} Image literal`);
		assert.doesNotMatch(source, /\? "Sound"/, `${file} Sound literal`);
	}
	assert.match(strip(read("image-group-lightbox.tsx")), /imageLabel\(/);
	assert.match(strip(read("fold-media.tsx")), /imageLabel\(/);
	const transcript = strip(read("canonical-transcript.tsx"));
	assert.match(transcript, /imageLabel\(/);
	assert.match(transcript, /soundLabel\(/);
});

test("source guard: the lightbox strip's press label reuses the keyed message, and focus no longer queries an English aria-label", () => {
	const source = strip(read("image-group-lightbox.tsx"));
	assert.doesNotMatch(source, /Show image/);
	assert.doesNotMatch(source, /aria-label="Show image/);
	// The helper wraps the existing key; the press label, its title and the
	// reserved tile's name + title all go through it.
	assert.match(
		source,
		/const showImageLabel = [^;]*ui\.chat\.canonical\.lightbox\.show_image/s,
	);
	assert.ok(
		(source.match(/showImageLabel\(/g) ?? []).length >= 4,
		"press label + title and the reserved tile's name + title",
	);
	// The focus lookup finds the tile by its slot, a shipped data attribute.
	assert.match(source, /data-image-slot="\$\{index \+ 1\}"/);
});

test("source guard: the supplement sound player's fallback name is keyed", () => {
	const source = strip(read("supplement-row.tsx"));
	assert.doesNotMatch(source, /"Generated sound"/);
	assert.match(source, /supplement\.sound_fallback_label/);
});

test("source guard: no t() call runs at module scope in the files this slice touches", () => {
	for (const file of [
		"sound-batch.tsx",
		"sound-batch-model.ts",
		"media-label.ts",
		"image-group-lightbox.tsx",
		"fold-media.tsx",
		"supplement-row.tsx",
	]) {
		// A top-level `const X = t(` / `= translate(` is a frozen boot locale.
		assert.doesNotMatch(
			strip(read(file)),
			/^(?:export )?const \w+(?::[^=]+)? = (?:t|translate)\(/m,
			`${file} has a module-scope t()`,
		);
	}
});
