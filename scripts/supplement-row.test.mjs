/**
 * The supplement block's DOM contract, asked of the SHIPPED row.
 *
 * WHAT THIS FILE IS FOR (design round 1, D1's pin; reworked by the operator
 * decisions of 2026-10-16 and 2026-10-19): while the block's own turn renders
 * condensed the block shows the SAME files section as its expanded self —
 * actionable `[data-supplement-file]` rows and the `[data-supplement-images]`
 * tile grid — and graphics are VISIBLE BY DEFAULT: a graphics-only or mixed
 * finish renders its budgeted `[data-supplement-slot]` head with the Hide clause
 * without a press (the 2026-10-19 operator request; it supersedes the closed
 * default this file used to pin). Static markup runs no effects, so the slot is
 * the reserved box and no document or iframe exists yet; the viewport gate and
 * the fetch counts are `supplement-disclosure.test.mjs`'s mounted contract.
 * The file also pins the glyph-fallback slot of an image tile and the graphics
 * disclosure's singular arm (`Show all 1 graphic`, U7).
 *
 * WHY STATIC MARKUP AND NOT A MOUNT. The contract is about what the row
 * RENDERS; `renderToStaticMarkup` runs every render pass and no effect, so a
 * slot in the markup means the row decided to show one — and a document fetch,
 * which is an effect, cannot muddy the reading. The mount-level transitions
 * (a bar opening restores the block) are `turn-collapse-model.test.mjs`'s
 * `runIsCondensed` case and the transcript's own behaviour suite; the pixels
 * are the frames.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: [
			'export { SupplementRow } from "./src/renderer/src/features/chat/canonical/supplement-row";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
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
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_supplement-row-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(bundlePath);
});
const { SupplementRow } = await import(bundlePath.href);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_791_000_060;
const digest = (seed) =>
	createHash("sha256").update(seed).digest("hex").slice(0, 32);
const file = (path, name, sizeBytes, kind = "markdown") => ({
	path,
	name,
	kind,
	sizeBytes,
	mtime: 1_790_999_940,
	why: "written by write",
});
const component = (seed, title, heightHint) => ({
	attachment: digest(seed),
	title,
	source: "bench.csv rows 1-4 (tool result of bash at 10:41)",
	mime: "text/html",
	heightHint,
});
const supplement = (over) => ({
	kind: "supplement",
	ts: TS,
	anchor: "a1",
	job: "0123456789ab",
	version: 1,
	state: "done",
	files: [],
	filesMore: 0,
	more: [],
	components: [],
	error: "",
	dismissed: false,
	live: false,
	...over,
});
const render = (record, condensed) =>
	renderToStaticMarkup(
		h(SupplementRow, {
			record,
			sessionId: "5ea1face0001",
			condensed,
		}),
	);
const textOf = (markup) =>
	markup
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&middot;/g, "·")
		.replace(/&#x27;/g, "'")
		.replace(/\s+/g, " ")
		.trim();

/* --------------------------- the failed line ----------------------------- */

test("the failed line names the typed cause, and stays bare without one", () => {
	const failed = { state: "failed", error: "generator:ProviderError" };
	const withCause = render(supplement({ ...failed, cause: "provider_quota" }));
	assert.ok(
		textOf(withCause).includes(
			"Couldn't prepare highlights — provider limit reached",
		),
		textOf(withCause),
	);
	/*
	 * A token this build does not know and a row without one both keep the
	 * bare sentence byte-for-byte (the additive claim).
	 */
	const unknown = render(
		supplement({ ...failed, cause: "provider_from_the_future" }),
	);
	assert.ok(
		textOf(unknown).includes("Couldn't prepare highlights"),
		textOf(unknown),
	);
	assert.ok(!textOf(unknown).includes(" — "), textOf(unknown));
	const bare = render(supplement(failed));
	assert.ok(textOf(bare).includes("Couldn't prepare highlights"), textOf(bare));
	assert.ok(!textOf(bare).includes(" — "), textOf(bare));
	// The Retry affordance is unchanged on every arm.
	for (const markup of [withCause, unknown, bare]) {
		assert.ok(markup.includes("data-supplement-retry"), "retry pin");
	}
});

/* -------------------------- the condensed arms --------------------------- */

test("a condensed block shows its graphics by default, behind the viewport gate", () => {
	/*
	 * THE GRAPHICS-ONLY ARM now defaults OPEN (operator request, 2026-10-19;
	 * superseding the closed default from 2026-10-16): the budgeted head's slot
	 * is in the markup without a press and the same block still offers Hide. A
	 * static render runs no effects, so the slot is the reserved box and no
	 * iframe/document exists yet — the viewport gate and fetch counts are the
	 * mounted contract in `supplement-disclosure.test.mjs`.
	 */
	const arms = [
		// components only
		[
			supplement({ components: [component("one", "Chart", 320)] }),
			"Hide 1 graphic",
		],
		[
			supplement({
				components: [
					component("one", "Chart", 320),
					component("two", "Table", 320),
				],
			}),
			"Hide 2 graphics",
		],
	];
	for (const [record, line] of arms) {
		const markup = render(record, true);
		assert.ok(
			markup.includes("data-supplement-condensed"),
			`the condensed form must be pinned on the DOM: ${line}`,
		);
		assert.equal(
			(markup.match(/data-supplement-slot/g) ?? []).length,
			1,
			`the budgeted head is mounted by default: ${line}`,
		);
		assert.ok(
			!markup.includes("<iframe"),
			`static markup cannot paint the document: ${line}`,
		);
		assert.ok(
			textOf(markup).startsWith(line),
			`the Hide clause leads the visible body: ${line}`,
		);
		assert.ok(
			textOf(markup).includes("Source: bench.csv rows 1-4"),
			`the budgeted head keeps its caption: ${line}`,
		);
	}
});

test("a condensed block's files are the SAME actionable rows as the expanded form", () => {
	/*
	 * The operator decision of 2026-10-16: the expanded files section IS the
	 * condensed form's files part (the small-set principle — an inert count
	 * sentence must not be the only route to a file — extended to the folded
	 * turn). The passive clause's bytes (`2 files: latency.md, bench.csv`) must
	 * not survive anywhere, and the rows must be full `data-supplement-file`
	 * rows without a slot or an iframe beside them.
	 */
	const files = [
		file("reports/latency.md", "latency.md", 4120),
		file("data/bench.csv", "bench.csv", 913, "csv"),
	];
	for (const condensed of [true, false]) {
		const markup = render(supplement({ files }), condensed);
		assert.ok(
			markup.includes("data-supplement-condensed") === condensed,
			`condensed marker matches the form (condensed=${condensed})`,
		);
		assert.equal(
			(markup.match(/data-supplement-file=""/g) ?? []).length,
			2,
			`both files render as actionable rows (condensed=${condensed})`,
		);
		assert.ok(
			!textOf(markup).includes("files:"),
			`the passive count clause is gone (condensed=${condensed})`,
		);
		assert.ok(!markup.includes("data-supplement-slot"));
		assert.ok(!markup.includes("<iframe"));
	}
	/* Mixed sets retain their file rows and show their graphics by default. */
	const mixed = render(
		supplement({ files, components: [component("one", "Chart", 320)] }),
		true,
	);
	assert.equal((mixed.match(/data-supplement-file=""/g) ?? []).length, 2);
	assert.ok(
		textOf(mixed).includes("Hide 1 graphic"),
		"graphics are visible beside files",
	);
	assert.ok(
		mixed.includes("data-supplement-slot"),
		"mixed graphics default open",
	);
});

test("a not-settled condensed block leads with its rows and keeps its actions", () => {
	const record = supplement({
		state: "queued",
		live: true,
		files: [
			file("reports/latency.md", "latency.md", 4120),
			file("data/bench.csv", "bench.csv", 913, "csv"),
		],
	});
	const markup = render(record, true);
	/*
	 * The rows are known while the job runs, so they are drawn above the state
	 * line and the old counts prefix (`2 files`) has no job left — the text is
	 * the rows' own names, then the shimmer line and the action pair. The
	 * separators are their OWN spans and the gaps between segments are flex
	 * gaps — the state line's existing grammar — so the dots are in the TEXT
	 * and the spaces are not.
	 */
	assert.equal((markup.match(/data-supplement-file=""/g) ?? []).length, 2);
	const text = textOf(markup);
	assert.ok(!text.includes("2 files"), "the counts prefix is gone");
	assert.ok(text.includes("Preparing highlights…"), text);
	assert.ok(text.includes("Adjust…") && text.includes("Cancel"), text);
	assert.ok(!markup.includes("data-supplement-slot"));
	assert.ok(!markup.includes("<iframe"));
});

test("image-kind files render as a tile grid, rows keep the rest, in both forms", () => {
	/*
	 * The operator decision of 2026-10-16, second half: image files become the
	 * thumbnail grid (`data-supplement-images` with one tile per image), and a
	 * mixed set renders the grid AND the rows coherently. Static markup runs no
	 * effects, so the tiles are the RESERVED slot here — the picture arrives at
	 * mount through the shared thumbnail pipeline, whose own contract lives in
	 * `chat-image-expand.test.mjs` and the frames.
	 */
	const record = supplement({
		files: [
			file("renders/latency.png", "latency.png", 240_100, "image"),
			file("reports/latency.md", "latency.md", 4120),
			file("renders/throughput.png", "throughput.png", 180_000, "image"),
		],
	});
	for (const condensed of [true, false]) {
		const markup = render(record, condensed);
		assert.ok(markup.includes("data-supplement-images"), "grid present");
		assert.equal(
			(markup.match(/data-supplement-image-tile=""/g) ?? []).length,
			2,
			`one tile per image-kind file (condensed=${condensed})`,
		);
		assert.equal(
			(markup.match(/data-supplement-file=""/g) ?? []).length,
			1,
			`non-image files keep the row grammar (condensed=${condensed})`,
		);
		// The tile is a real control with a name, never a bare picture.
		assert.ok(markup.includes('aria-label="Open latency.png"'), markup);
	}
	/*
	 * A thumbnail that cannot load keeps its slot as the glyph receipt (the
	 * finder grid's own answer), pinned by class so the receipt's floored
	 * `border-control`/`sunken` triple can be grepped from the DOM marker's
	 * sibling.
	 */
	const noBridge = render(
		supplement({
			files: [file("renders/latency.png", "latency.png", 240_100, "image")],
		}),
		true,
	);
	assert.ok(noBridge.includes("data-supplement-image-tile"));
});

test("the expanded form carries the slots and the disclosures' own grammar", () => {
	// Two 480px hints against the static-markup fallback budget (900): the
	// second is behind the disclosure, singularized for one (U7).
	const record = supplement({
		components: [
			component("one", "Chart", 480),
			component("two", "Table", 480),
		],
	});
	const markup = render(record, false);
	assert.ok(markup.includes("data-supplement-slot"));
	assert.ok(markup.includes("Show all 1 graphic"), markup.slice(0, 400));
	assert.ok(!markup.includes("Show all 1 graphics"));
	assert.ok(markup.includes("data-supplement-show-all"));
	// The files disclosure, its own grammar: a chevron slot in the app's
	// disclosure idiom and the toggle's collapsed copy.
	const withFiles = render(
		supplement({
			files: [
				file("reports/latency.md", "latency.md", 4120),
				file("data/bench.csv", "bench.csv", 913, "csv"),
			],
			filesMore: 2,
			more: ["reports/q3.md", "reports/q4.md"],
		}),
		false,
	);
	assert.ok(withFiles.includes("2 more files"));
	assert.ok(withFiles.includes("data-supplement-more"));
	// The tail rows stay unmounted while collapsed; the toggle owns them.
	assert.ok(!withFiles.includes("q3.md"));
});

/* ------------------------------ the sounds ------------------------------- */

/*
 * THE SOUNDS SECTION (sound phase, 2026-10-17). Two facts are pinned, in both
 * forms of the block:
 *
 *   - a row THAT CARRIES sounds draws one `[data-supplement-sounds]` section
 *     with a compact player per sound, digest-scoped (the same `sound:<digest>`
 *     engine identity the transcript uses);
 *   - a row that carries NONE renders no section at all — not an empty one, not
 *     a heading — which is the shape every pre-sound-phase row arrives in.
 */
const sound = (seed, title, durationS) => ({
	attachment: digest(seed),
	mime: "audio/mpeg",
	title,
	durationS,
});

test("a row with sounds draws them in both forms; a row without draws nothing", () => {
	const record = supplement({
		files: [file("/w/report.md", "report.md", 1200)],
		sounds: [sound("s1", "Storm swell", 6.5), sound("s2", "", null)],
	});
	const expanded = render(record, false);
	assert.equal((expanded.match(/data-supplement-sounds=""/g) ?? []).length, 1);
	/*
	 * A DIGEST has no bytes in a static render, so each sound line draws its
	 * RESERVED row at the player's height (no spinner, no receipt) — the same
	 * place-holder the picture and video seats reserve. The players themselves
	 * mount once the resolver answers, which is the mount's job (and the
	 * operator gate's); what a static render can prove is that each sound has
	 * its own line and that the section exists exactly once.
	 */
	assert.equal(
		(expanded.match(/data-sound-player="compact"/g) ?? []).length,
		0,
		"no player before its bytes resolve",
	);
	assert.ok(expanded.includes("Storm swell"), "the producer's title is shown");
	// Both lines reserve their space, so the block's height is right on the
	// first paint and does not jump when the bytes land.
	assert.equal(
		(expanded.match(/class="h-11"/g) ?? []).length,
		2,
		"one reserved line per unresolved sound",
	);

	const condensed = render(record, true);
	assert.equal(
		(condensed.match(/data-supplement-sounds=""/g) ?? []).length,
		1,
		"the condensed form keeps the actionable media, as it does for files",
	);
	assert.equal(
		(condensed.match(/class="h-11"/g) ?? []).length,
		2,
		"both lines reserve, exactly as in the expanded form",
	);
	assert.equal(
		(condensed.match(/data-sound-player="compact"/g) ?? []).length,
		0,
	);
	assert.equal(
		condensed.includes("data-supplement-slot"),
		false,
		"and still draws no component slot",
	);
});

test("fourteen sounds draw one collage cell each, in both forms", () => {
	/*
	 * THE OPERATOR'S WALL (2026-10-23). The producer now sends every sound it
	 * generated, so fourteen arrived as fourteen stacked rows. The fix is a
	 * width-driven grid: the container answers to the BLOCK's own width, a
	 * single sound still fills the row, and no cell is dropped - the brief's
	 * explicit rule is no slice, no cap, no pagination.
	 */
	const sounds = Array.from({ length: 14 }, (_, index) =>
		sound(`collage-${index}`, `Take ${index + 1}`, 6 + index),
	);
	const record = supplement({ sounds });
	for (const condensed of [false, true]) {
		const markup = render(record, condensed);
		assert.equal(
			(markup.match(/data-supplement-sounds=""/g) ?? []).length,
			1,
			"one section in both forms",
		);
		assert.equal(
			(markup.match(/data-supplement-sound=""/g) ?? []).length,
			14,
			"every distinct digest gets its own cell",
		);
		assert.equal(
			(markup.match(/data-supplement-sound-placeholder=""/g) ?? []).length,
			14,
			"every cell carries its player's own seat (bytes resolve in the mount)",
		);
		assert.equal(
			(markup.match(/data-supplement-sound-title=""/g) ?? []).length,
			14,
			"each cell keeps the producer's title",
		);
		assert.ok(
			markup.includes("grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]"),
			"the collage is a responsive grid, not the old column",
		);
		assert.equal(
			(markup.match(/data-sound-player="compact"/g) ?? []).length,
			0,
			"the players mount once the resolver answers, never before",
		);
	}
});

test("a single sound keeps today's full-width row", () => {
	const markup = render(
		supplement({ sounds: [sound("only", "Solo take", 4)] }),
		false,
	);
	assert.equal((markup.match(/data-supplement-sound=""/g) ?? []).length, 1);
	assert.equal(
		markup.includes("auto-fit"),
		false,
		"one sound must not be squeezed into a multi-column template",
	);
});

test("a row whose sounds are absent or empty renders no sounds section at all", () => {
	for (const sounds of [
		/*
		 * ABSENT, which is what every row older than the wire change is: the
		 * shape is built without the key rather than deleted after the fact, so
		 * the absence is the fixture rather than a mutation.
		 */
		undefined,
		// Explicitly empty: the harness states the list only when it has one.
		[],
	]) {
		const base = supplement({ files: [file("/w/a.md", "a.md", 10)] });
		const record = sounds === undefined ? base : { ...base, sounds };
		for (const condensed of [false, true]) {
			const markup = render(record, condensed);
			assert.equal(
				markup.includes("data-supplement-sounds"),
				false,
				"never a stub section, in either form",
			);
			assert.equal(markup.includes("data-sound-player"), false);
		}
	}
});
