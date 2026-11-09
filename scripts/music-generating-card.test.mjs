import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { act, createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The in-chat music generating card (operator decision a-69e7: "Show the
 * generating motif inline in chat"), asserted at its two layers:
 *
 *   - the STATE DERIVATION (`music-generating-model.ts`): settlement row >
 *     live Jobs row > the call's own `queued` receipt, never a guessed figure;
 *     each card reads ITS job only, so concurrent jobs never cross;
 *   - the RENDERED card: the stable `data-music-generating=<job>` selector,
 *     the motion-safe-only animation (reduced motion paints the same box at
 *     rest), identical motif geometry across states, and a Cancel press that
 *     asks the confirm flow about this card's own job row and no other.
 *
 * The transcript's job id plumbing (`job_result` rows carry `jobId`) is
 * asserted through the real reducer so a renamed field cannot pass here.
 */

const alias = {
	"@renderer": "./src/renderer/src",
	"@shared": "./src/renderer/src/shared",
	"@features": "./src/renderer/src/features",
	"@assets": "./src/renderer/src/assets",
};
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/chat/canonical/music-generating-model";
export { MusicGeneratingCard, ConnectedMusicGeneratingCard } from "./src/renderer/src/features/chat/canonical/music-generating-card";
export { ownsMaterialArtifact } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";
export { EMPTY_TRANSCRIPT, applyHistoryPage } from "./src/renderer/src/features/chat/canonical/transcript-reducer";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias,
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	define: { "import.meta.env": "{}" },
	// React stays external so the renderer below shares this file's instance.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react-dom/client",
		"react/jsx-runtime",
	],
});
const bundlePath = new URL(
	"./_music-generating-card.bundle.mjs",
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
	musicGeneratingView,
	jobResultStatus,
	musicJobIdOf,
	MusicGeneratingCard,
	ConnectedMusicGeneratingCard,
	MusicJobsLiveContext,
	ownsMaterialArtifact,
	EMPTY_TRANSCRIPT,
	applyHistoryPage,
} = mod;

const receiptDetails = (job) => ({
	job_id: job,
	stage: "queued",
	material: "music",
	model: "radient/music",
	tracks: [],
	cancel_support: "queued_only",
});
const row = (id, overrides = {}) => ({
	id,
	label: `Music ${id}`,
	jobType: "music",
	status: "running",
	music: { stage: "polling", total: 2, completed: 1, attribution: "" },
	...overrides,
});

test("only a music call that registered a detached job gets the card", () => {
	assert.equal(
		musicGeneratingView({
			toolName: "generate_video",
			details: receiptDetails("a"),
			row: undefined,
			settlement: undefined,
		}),
		null,
	);
	assert.equal(
		musicGeneratingView({
			toolName: "generate_music",
			details: { error: "music_unavailable" },
			row: undefined,
			settlement: undefined,
		}),
		null,
	);
	assert.equal(musicJobIdOf({ job_id: "a", material: "video" }), null);
	const queued = musicGeneratingView({
		toolName: "generate_music",
		details: receiptDetails("a"),
		row: undefined,
		settlement: undefined,
	});
	assert.equal(queued.state, "queued");
	assert.equal(queued.total, 0, "no live row: no invented track count");
	assert.equal(queued.cancelRow, null);
});

test("pending settles: queued → generating with progress → done", () => {
	const details = receiptDetails("job1");
	const q = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: row("job1", { status: "queued", music: undefined }),
		settlement: undefined,
	});
	assert.equal(q.state, "queued");
	const g = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: row("job1"),
		settlement: undefined,
	});
	assert.deepEqual([g.state, g.completed, g.total], ["generating", 1, 2]);
	assert.equal(g.cancelRow.id, "job1");
	const asking = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: row("job1", {
			music: { stage: "cancel_requested", total: 2, completed: 1 },
		}),
		settlement: undefined,
	});
	assert.equal(asking.state, "cancel_requested");
	assert.equal(
		asking.cancelRow,
		null,
		"a requested cancel is not offered twice",
	);
	const done = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: row("job1", { status: "done" }),
		settlement: {
			status: "completed",
			receipt: {
				attribution: "",
				tracks: [
					{ id: "t1", images: [{}], cost: null },
					{ id: "t2", images: [{}], cost: null },
				],
			},
		},
	});
	assert.deepEqual(
		[done.state, done.completed, done.total, done.cost],
		["done", 2, 2, null],
	);
	const modify = musicGeneratingView({
		toolName: "modify_music",
		details,
		row: row("job1"),
		settlement: undefined,
	});
	assert.equal(modify.modify, true);
});

test("failed and cancelled settle with the receipt's own billed caption", () => {
	const details = receiptDetails("job1");
	const failed = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: undefined,
		settlement: {
			status: "failed",
			receipt: {
				attribution: "",
				tracks: [
					{
						id: "t1",
						images: [],
						error: true,
						cost: { amount_usd: 0, basis: "billed" },
					},
				],
			},
		},
	});
	assert.equal(failed.state, "failed");
	assert.equal(failed.cost, "Cost $0 (billed).");
	const cancelled = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: undefined,
		settlement: { status: "cancelled", receipt: null },
	});
	assert.deepEqual([cancelled.state, cancelled.cost], ["cancelled", null]);
	const mixed = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: undefined,
		settlement: {
			status: "failed",
			receipt: {
				attribution: "",
				tracks: [
					{ id: "a", images: [], cost: { amount_usd: 0, basis: "billed" } },
					{
						id: "b",
						images: [],
						cost: { amount_usd: 0.01, basis: "estimated" },
					},
				],
			},
		},
	});
	assert.equal(mixed.cost, null, "mixed bases are never summed under one word");
	const liveFailed = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: row("job1", { status: "failed" }),
		settlement: undefined,
	});
	assert.equal(liveFailed.state, "failed");
});

test("job_result status parses Core's frozen sentence, quotes in labels included", () => {
	assert.equal(
		jobResultStatus("background job 'Music' completed:\nready"),
		"completed",
	);
	assert.equal(
		jobResultStatus("background job 'It's 'x'' cancelled."),
		"cancelled",
	);
	assert.equal(
		jobResultStatus("background job 'Music' failed (pinned a, ran on b):\nx"),
		"failed",
	);
	assert.equal(jobResultStatus("Music ready"), null);
});

test("job_result rows carry their job id through the real reducer", () => {
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			{
				id: "r1",
				ts: 1760000000,
				type: "message",
				payload: {
					kind: "custom",
					custom_type: "job_result",
					details: {
						job_id: "job1",
						text: "background job 'Music' cancelled.",
					},
				},
			},
		],
	});
	const record = state.records.find((r) => r.kind === "custom");
	assert.ok(
		record,
		`custom record expected, got ${JSON.stringify(state.records.map((r) => r.kind))}`,
	);
	assert.equal(record.jobId, "job1");
});

test("a music call with a job stays inline through turn and action folds", () => {
	const base = {
		kind: "tool",
		id: "c",
		toolName: "generate_music",
		phase: "done",
	};
	assert.equal(
		ownsMaterialArtifact({ ...base, details: receiptDetails("j") }),
		true,
	);
	assert.equal(
		ownsMaterialArtifact({ ...base, details: { error: "x" } }),
		false,
	);
});

test("multiple concurrent jobs each read only their own row", () => {
	const rows = new Map([
		["a", row("a", { music: { stage: "polling", total: 1, completed: 0 } })],
		["b", row("b")],
	]);
	const a = musicGeneratingView({
		toolName: "generate_music",
		details: receiptDetails("a"),
		row: rows.get("a"),
		settlement: undefined,
	});
	const b = musicGeneratingView({
		toolName: "generate_music",
		details: receiptDetails("b"),
		row: rows.get("b"),
		settlement: undefined,
	});
	assert.deepEqual([a.jobId, a.cancelRow.id, a.total], ["a", "a", 1]);
	assert.deepEqual([b.jobId, b.cancelRow.id, b.total], ["b", "b", 2]);
});

// The motif's own box, not the label icon's lucide svg.
const svgOf = (markup) => /<svg[^>]*data-music-motif=""[^>]*>/.exec(markup)[0];

test("render: stable selector, state copy, motion-safe-only animation, constant motif box", () => {
	const generating = musicGeneratingView({
		toolName: "generate_music",
		details: receiptDetails("job1"),
		row: row("job1"),
		settlement: undefined,
	});
	const live = renderToStaticMarkup(
		h(MusicGeneratingCard, { view: generating, onCancel: () => {} }),
	);
	assert.match(live, /data-music-generating="job1"/);
	assert.match(live, /Generating 2 tracks…/);
	assert.match(live, /1\/2 tracks settled/);
	assert.match(live, /data-music-cancel="job1"/);
	assert.match(svgOf(live), /motion-safe:animate-pulse/);
	assert.doesNotMatch(
		svgOf(live),
		/class="[^"]*(?<!:)animate-pulse/,
		"never an unconditional animation",
	);
	const done = renderToStaticMarkup(
		h(MusicGeneratingCard, {
			view: { ...generating, state: "done", cancelRow: null },
		}),
	);
	assert.match(done, /Music ready/);
	assert.doesNotMatch(done, /data-music-cancel/);
	assert.doesNotMatch(svgOf(done), /animate-pulse/);
	for (const markup of [live, done]) {
		assert.match(svgOf(markup), /width="240"/);
		assert.match(svgOf(markup), /height="44"/);
	}
	const single = renderToStaticMarkup(
		h(MusicGeneratingCard, { view: { ...generating, total: 1 } }),
	);
	assert.match(single, /Generating music…/);
	assert.doesNotMatch(single, /data-music-cancel/, "no handler, no control");
	const failed = renderToStaticMarkup(
		h(MusicGeneratingCard, {
			view: {
				...generating,
				state: "failed",
				cost: "Cost $0 (billed).",
				cancelRow: null,
			},
		}),
	);
	assert.match(failed, /Music generation failed\./);
	assert.match(failed, /Cost \$0 \(billed\)\./);
});

/* jsdom only for the press: no layout here, so nothing below is geometry. */
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
const restore = [];
for (const [key, value] of Object.entries({
	window: dom.window,
	document: dom.window.document,
	navigator: dom.window.navigator,
	HTMLElement: dom.window.HTMLElement,
	Element: dom.window.Element,
	Node: dom.window.Node,
	SVGElement: dom.window.SVGElement,
	Event: dom.window.Event,
	MouseEvent: dom.window.MouseEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
})) {
	restore.push([key, Object.getOwnPropertyDescriptor(globalThis, key)]);
	Object.defineProperty(globalThis, key, {
		value,
		configurable: true,
		writable: true,
	});
}
after(() => {
	for (const [key, descriptor] of restore) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	dom.window.close();
});

test("each card's Cancel asks the confirm flow about its own job row only", async () => {
	const { createRoot } = await import("react-dom/client");
	const rows = new Map([
		["a", row("a")],
		["b", row("b")],
	]);
	const requests = [];
	const live = {
		rows,
		request: (r, anchor) => requests.push({ id: r.id, anchor }),
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const viewOf = (id) =>
		musicGeneratingView({
			toolName: "generate_music",
			details: receiptDetails(id),
			row: rows.get(id),
			settlement: undefined,
		});
	await act(async () => {
		root.render(
			h(
				MusicJobsLiveContext.Provider,
				{ value: live },
				h(ConnectedMusicGeneratingCard, { view: viewOf("a") }),
				h(ConnectedMusicGeneratingCard, { view: viewOf("b") }),
			),
		);
	});
	assert.equal(container.querySelectorAll("[data-music-generating]").length, 2);
	await act(async () =>
		container.querySelector('[data-music-cancel="b"]').click(),
	);
	assert.deepEqual(
		requests.map((r) => r.id),
		["b"],
	);
	assert.deepEqual(Object.keys(requests[0].anchor).sort(), [
		"bottom",
		"left",
		"right",
		"top",
	]);
	await act(async () => root.unmount());
});
