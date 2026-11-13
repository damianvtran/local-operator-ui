import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
export { MusicGeneratingCard, ConnectedMusicGeneratingCard, useMusicGeneratingView, MUSIC_JOB_MISSING_GRACE_MS } from "./src/renderer/src/features/chat/canonical/music-generating-card";
export { useJobCancel } from "./src/renderer/src/features/chat/components/run-details/use-job-cancel";
export { ownsMaterialArtifact, collapsePlan } from "./src/renderer/src/features/chat/canonical/turn-collapse-model";
export { buildRows } from "./src/renderer/src/features/chat/canonical/transcript-rows";
export { MusicResult } from "./src/renderer/src/features/chat/canonical/music-result";
export { EMPTY_TRANSCRIPT, applyHistoryPage } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
export { deriveRunDetails } from "./src/renderer/src/features/chat/components/run-details/run-detail-model";`,
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
	useMusicGeneratingView,
	MUSIC_JOB_MISSING_GRACE_MS,
	useJobCancel,
	MusicJobsLiveContext,
	ownsMaterialArtifact,
	EMPTY_TRANSCRIPT,
	applyHistoryPage,
	buildRows,
	collapsePlan,
	MusicResult,
	deriveRunDetails,
	musicJobSettlementsOf,
	musicJobsLiveRowsOf,
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
	// R15-1 reproduction: the summary's own quoted word must not win.
	assert.equal(
		jobResultStatus(
			"background job 'music: dawn' failed:\nProvider error after track 'Dawn' completed early",
		),
		"failed",
	);
	assert.equal(
		jobResultStatus("background job 'x'\n' completed"),
		null,
		"a status only after a newline is no header status",
	);
});

test("done needs Core's completed or tracks with bytes; unknown/paused is unavailable (R15-2)", () => {
	const viewFor = (settlement) =>
		musicGeneratingView({
			toolName: "generate_music",
			details: receiptDetails("job1"),
			row: undefined,
			settlement,
		}).state;
	assert.equal(viewFor({ status: null, receipt: null }), "unavailable");
	assert.equal(viewFor({ status: "paused", receipt: null }), "unavailable");
	assert.equal(viewFor({ status: "completed", receipt: null }), "done");
	assert.equal(
		viewFor({
			status: null,
			receipt: {
				attribution: "",
				tracks: [{ id: "t", images: [{}], cost: null }],
			},
		}),
		"done",
		"audio that exists is ready whatever the sentence said",
	);
});

test("loaded run details without the job and no result: status unavailable (R15-4)", () => {
	const base = {
		toolName: "generate_music",
		details: receiptDetails("job9"),
		row: undefined,
		settlement: undefined,
	};
	assert.equal(musicGeneratingView(base).state, "queued");
	const lost = musicGeneratingView({ ...base, liveLoaded: true });
	assert.equal(lost.state, "unavailable");
	assert.equal(lost.cancelRow, null);
	const markup = renderToStaticMarkup(h(MusicGeneratingCard, { view: lost }));
	assert.match(markup, /data-music-state="unavailable"/);
	assert.match(markup, /Music status unavailable/);
	assert.doesNotMatch(markup, /animate-pulse"|data-music-cancel/);
	// A live row or a settlement always outranks "unavailable".
	assert.equal(
		musicGeneratingView({ ...base, liveLoaded: true, row: row("job9") }).state,
		"generating",
	);
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

/*
 * REGRESSION, native run 42894406065: a WHOLLY failed music job's receipt
 * folded behind a bare "Job result" bar. Replays the real history (entries
 * 82..97 of that run's session) through the app's own path - reducer ->
 * `buildRows` -> `collapsePlan` (settled, as the pane plans it) - and requires
 * the job_result row (entry 96, track aud_serving_11, zero artifacts) to paint
 * outside any collapsed segment, then renders its receipt.
 */
test("a wholly failed music job's receipt stays inline, track failed at $0 billed", () => {
	const { entries } = JSON.parse(
		readFileSync(
			new URL(
				"./fixtures/music-failed-job-result.native.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const { records } = applyHistoryPage(EMPTY_TRANSCRIPT, { entries });
	const failed = records.find(
		(r) => r.kind === "custom" && r.jobId === "c68d27aefb58",
	);
	assert.ok(
		failed?.music,
		"entry 96 reduces to a custom row with a music receipt",
	);
	assert.equal(failed.images?.length ?? 0, 0, "no artifact: nothing to play");
	assert.equal(ownsMaterialArtifact(failed), true);
	const plan = collapsePlan(buildRows(records, []), { live: false });
	const hidden = plan.runs.flatMap((run) =>
		run.segments
			.filter((segment) => segment.collapsed)
			.flatMap((segment) => segment.rows.map((row) => row.record.id)),
	);
	assert.ok(
		!hidden.includes(failed.id),
		`failed receipt folded away; collapsed rows: ${JSON.stringify(hidden)}`,
	);
	const markup = renderToStaticMarkup(
		h(MusicResult, { receipt: failed.music, scope: null }),
	);
	assert.match(markup, /data-music-track="aud_serving_11"/);
	assert.match(markup, /This track could not be generated\./);
	assert.match(markup, /Cost \$0 \(billed\)/);
	assert.doesNotMatch(markup, /data-sound-player/);
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

/*
 * D1/U7/Q2 (design r17): the label reads "{completed}/{total} tracks settled",
 * so `completed` must count SETTLED tracks - ready, failed, or ended by a
 * cancel - not only tracks with audio. A finished card that said "0/1 tracks
 * settled" told the operator one track was still pending. And a finished card's
 * motif rests: no animation, dimmed, the same 240x44 box so nothing reflows.
 */
test("a finished card counts every track settled and rests its motif (D1)", () => {
	const details = receiptDetails("job1");
	const settle = (status, tracks) =>
		musicGeneratingView({
			toolName: "generate_music",
			details,
			row: undefined,
			settlement: { status, receipt: { attribution: "", tracks } },
		});
	const ready = { id: "a", images: [{}], cost: null };
	const lost = { id: "b", images: [], error: true, cost: null };
	const resting = (view, label) => {
		const markup = renderToStaticMarkup(h(MusicGeneratingCard, { view }));
		const svg = svgOf(markup);
		assert.doesNotMatch(svg, /animate-pulse/, `${label}: never animated`);
		assert.match(svg, /opacity-40/, `${label}: dimmed at rest`);
		assert.match(svg, /width="240"/);
		assert.match(svg, /height="44"/);
		return markup;
	};
	const partial = settle("completed", [ready, lost]);
	assert.deepEqual(
		[partial.state, partial.completed, partial.total],
		["done", 2, 2],
	);
	assert.match(resting(partial, "partial"), /2\/2 tracks settled/);
	const failed = settle("failed", [lost]);
	assert.deepEqual(
		[failed.state, failed.completed, failed.total],
		["failed", 1, 1],
	);
	assert.match(resting(failed, "failed"), /1\/1 tracks settled/);
	for (const state of ["cancelled", "finished_after_cancel"]) {
		resting({ ...partial, state }, state);
	}
	// The live Jobs row settled before the durable row landed: same count.
	const liveFailed = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: row("job1", {
			status: "failed",
			music: { stage: "polling", total: 2, completed: 0 },
		}),
		settlement: undefined,
	});
	assert.deepEqual([liveFailed.completed, liveFailed.total], [2, 2]);
	// In flight: Core's own partial count, animated, never dimmed.
	const working = musicGeneratingView({
		toolName: "generate_music",
		details,
		row: row("job1"),
		settlement: undefined,
	});
	const live = renderToStaticMarkup(h(MusicGeneratingCard, { view: working }));
	assert.match(live, /1\/2 tracks settled/);
	assert.match(svgOf(live), /motion-safe:animate-pulse/);
	assert.doesNotMatch(svgOf(live), /opacity-40/);
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
	// jsdom ships no `CSS`; the cancel flow's focus landing uses `CSS.escape`
	// (the ids here are plain, so identity is enough - job-cancel-panel's idiom).
	CSS: { escape: (value) => String(value) },
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

test("a job missing from loaded run details reads queued until the grace ends (R15-4)", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { createRoot } = await import("react-dom/client");
	const Probe = () => {
		const view = useMusicGeneratingView(
			"generate_music",
			receiptDetails("gone"),
		);
		return h("span", { "data-state": view?.state ?? "none" });
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const live = { rows: new Map(), request: null, loaded: true };
	await act(async () => {
		root.render(h(MusicJobsLiveContext.Provider, { value: live }, h(Probe)));
	});
	const state = () => container.querySelector("[data-state]").dataset.state;
	assert.equal(state(), "queued", "a just-launched job is not called lost");
	await act(async () => t.mock.timers.tick(MUSIC_JOB_MISSING_GRACE_MS));
	assert.equal(state(), "unavailable");
	await act(async () => root.unmount());
	container.remove();
});

test("Escape after a card's Cancel returns focus to that card's control (R15-3)", async () => {
	const { createRoot } = await import("react-dom/client");
	let interaction;
	const Harness = ({ ids }) => {
		interaction = useJobCancel({
			sessionId: "s1",
			controls: { cancel: async () => ({ kind: "ok" }) },
			controlAttribute: "data-music-cancel",
		});
		return h(
			"div",
			null,
			...ids.map((id) =>
				h("button", { key: id, type: "button", "data-music-cancel": id }, id),
			),
		);
	};
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => root.render(h(Harness, { ids: ["a", "b"] })));
	const anchor = { left: 0, top: 0, right: 0, bottom: 0 };
	await act(async () => interaction.section.request(row("b"), anchor));
	assert.equal(interaction.popover.open, true);
	// The popover's Escape: a dismissal with no focusable press target.
	document.activeElement?.blur?.();
	await act(async () => interaction.popover.onCancel());
	assert.equal(
		document.activeElement,
		container.querySelector('[data-music-cancel="b"]'),
	);
	await act(async () => root.unmount());
	container.remove();
});

/*
 * The mount half of desktop-app run 42747060041 (macOS step 16): Core
 * 859729bd's real `generate_music` result, through the real reducer, yields a
 * record whose card renders `data-music-generating=<job>`. The fold half (the
 * row is not hidden in an ordinary turn) is `turn-collapse-model.test.mjs`'s
 * "Core-shaped pending music job" case, on the same fixture.
 */
test("Core's pending generate_music row mounts the generating card", () => {
	const fixture = JSON.parse(
		readFileSync(
			new URL("./fixtures/music-pending-core-859729bd.json", import.meta.url),
			"utf8",
		),
	);
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: fixture.entries,
	});
	const call = state.records.find(
		(r) => r.kind === "tool" && r.toolName === "generate_music",
	);
	assert.ok(call, "tool record expected");
	assert.equal(ownsMaterialArtifact(call), true);
	const view = musicGeneratingView({
		toolName: call.toolName,
		details: call.details,
		row: undefined,
		settlement: undefined,
	});
	assert.equal(view?.state, "queued");
	const markup = renderToStaticMarkup(h(MusicGeneratingCard, { view }));
	assert.ok(markup.includes(`data-music-generating="11f41d8c66d0"`), markup);
});

/*
 * FINISHED AFTER A CANCEL REQUEST (native run 42779240064, Core 859729bd). The
 * cancel ended the call's AsyncJob 8b1723b0f326 (`cancelled`) and Core's music
 * runner registered observer 5d2b5eecaee0 (`record.watcher`), which finished
 * track aud_serving_8 and billed it. The record below is that run's
 * `late_settlement` record (native.log), scrubbed of its idempotency key; the
 * job_result rows are what `Session._job_result_message` builds from it: the
 * cancelled task's row (its `latest_details` holds only `music`, so no receipt
 * is merged) and the observer's row (its `music_receipt` merged in, naming
 * music job 8b1723b0f326 under the observer's own `job_id`).
 */
const LATE_RECORD = {
	state: "completed",
	job: "8b1723b0f326",
	watcher: "5d2b5eecaee0",
	cancellation_requested: true,
	cancellation: [
		{ request_id: "aud_serving_8", requested: true, vendor_stopped: false },
	],
	attribution: "Synthetic QA upstream; no resale authorization",
	artifacts: [
		{
			digest: "34681b9e4cf82622b22fabbafab1d748",
			kind: "audio",
			name: "owned-silent-music-fixture.mp3",
			content_type: "audio/mpeg",
			size_bytes: 24493,
			duration_s: 3,
			material: "music",
			track_id: "aud_serving_8",
			artifact_id: "artifact_aud_serving_8",
			role: "full_mix",
			variant_index: 0,
			title: "Owned silent music fixture",
			operation: "compose",
		},
	],
	tracks: [
		{
			id: "aud_serving_8",
			title: "Owned silent music fixture",
			variant_index: 0,
			status: "COMPLETED",
			settled: true,
			cost: {
				v: 1,
				amount_usd: 0.007500000000000001,
				basis: "billed",
				units: 3000,
				unit: "millisecond",
				provider: "radient",
				model: "radient/music",
				tool_type: "music_generation",
			},
			error_type: null,
			artifacts_registered: true,
		},
	],
};
// `runner`'s final receipt (music/jobs.py): these keys, from the record.
const lateReceipt = (record) => ({
	job: record.job,
	material: "music",
	model: "radient/music",
	provider: "radient",
	tracks: record.tracks,
	artifacts: record.artifacts ?? [],
	attribution: record.attribution,
});
const jobResultEntry = (id, details) => ({
	id,
	ts: 1794300270,
	type: "message",
	payload: { kind: "custom", custom_type: "job_result", details },
});
const cancelledOriginal = jobResultEntry("r-cancel", {
	job_id: "8b1723b0f326",
	text: "background job 'Music' cancelled.",
});
const observerResult = (record) =>
	jobResultEntry("r-observer", {
		job_id: "5d2b5eecaee0",
		text: `background job 'Music' ${record.artifacts?.length ? "completed" : "failed"}:\\nmusic ready`,
		...lateReceipt(record),
	});
const settledFrom = (entries) =>
	musicJobSettlementsOf(
		applyHistoryPage(EMPTY_TRANSCRIPT, { entries }).records,
	);
const cardFor = (settlements, live = {}) =>
	musicGeneratingView({
		toolName: "generate_music",
		details: receiptDetails("8b1723b0f326"),
		row: live.rows?.get("8b1723b0f326"),
		successorRow: live.successors?.get("8b1723b0f326"),
		settlement: settlements.get("8b1723b0f326"),
	});

test("music that finished after a cancel request is not called cancelled (real Core shape)", () => {
	// Either arrival order: the successor never overwrites, it attaches.
	for (const entries of [
		[cancelledOriginal, observerResult(LATE_RECORD)],
		[observerResult(LATE_RECORD), cancelledOriginal],
	]) {
		const settlements = settledFrom(entries);
		assert.equal(
			settlements.has("5d2b5eecaee0"),
			false,
			"the observer is not a second card's job",
		);
		const view = cardFor(settlements);
		assert.deepEqual(
			[view.state, view.completed, view.total, view.cost],
			["finished_after_cancel", 1, 1, "Cost $0.0075 (billed)."],
		);
		const markup = renderToStaticMarkup(h(MusicGeneratingCard, { view }));
		assert.match(markup, /Music finished before it could be cancelled\./);
		assert.match(markup, /Cost \$0\.0075 \(billed\)\./);
		assert.doesNotMatch(markup, /Music generation cancelled/);
	}
	// The track itself still renders through the observer's own job_result
	// row (MusicResult reads `record.music`), unchanged by the card.
	const records = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [cancelledOriginal, observerResult(LATE_RECORD)],
	}).records.filter((record) => record.kind === "custom");
	const observer = records.find((record) => record.jobId === "5d2b5eecaee0");
	assert.deepEqual(
		observer.images.map((image) => image.attachment),
		["34681b9e4cf82622b22fabbafab1d748"],
	);
});

/*
 * The same fact from Core verbatim: native run 42862983641's entry 96, the
 * observer 96de655246c3's job_result for music job a911f847e12e (scrubbed
 * session history). Painted live it is the row round 23 made reach the pane
 * (`reconnect-page-gap.test.mjs`); here the card and the track it carries.
 */
test("Core's real late observer row: card finished_after_cancel, track on its own row", () => {
	const entry = JSON.parse(
		readFileSync(
			new URL(
				"./fixtures/music-late-result-entry-42862983641.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	// Core wrote no job_result for the cancelled task in that run (entries 0,
	// 20, 52, 71, 96 are the session's only job_result rows), so the live Jobs
	// row is what states the cancel - as the pane had it when the row landed.
	const original = {
		id: "a911f847e12e",
		type: "music",
		status: "cancelled",
		queued: false,
		label: "Music",
		start_time: 1_000,
		settled_at: 1_010,
		latest_details: {
			music: {
				job: "a911f847e12e",
				stage: "polling",
				tracks: [],
				attribution: "",
			},
		},
	};
	const live = musicJobsLiveRowsOf(
		deriveRunDetails({ jobs: [original], todos: [], nowMs: 1_060_000 }).jobs,
	);
	const records = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [entry],
	}).records;
	const view = musicGeneratingView({
		toolName: "generate_music",
		details: receiptDetails("a911f847e12e"),
		row: live.rows.get("a911f847e12e"),
		successorRow: live.successors?.get("a911f847e12e"),
		settlement: musicJobSettlementsOf(records).get("a911f847e12e"),
	});
	assert.deepEqual(
		[view.state, view.completed, view.total],
		["finished_after_cancel", 1, 1],
	);
	const row = records.find((record) => record.id === entry.id);
	assert.equal(row?.jobId, "96de655246c3");
	assert.deepEqual(
		row?.music?.tracks.map((track) => track.id),
		["aud_serving_8"],
		"the observer's own row carries the track MusicResult renders",
	);
});

test("a genuinely cancelled music job stays cancelled at $0", () => {
	// Only the cancelled task's row (the observer has not settled yet, or the
	// runtime predates observers): unchanged "cancelled", no cost line.
	const alone = cardFor(settledFrom([cancelledOriginal]));
	assert.deepEqual([alone.state, alone.cost], ["cancelled", null]);
	// The provider stopped: the observer settles with no audio and a $0 bill.
	const stopped = {
		...LATE_RECORD,
		state: "failed",
		artifacts: [],
		tracks: [
			{
				...LATE_RECORD.tracks[0],
				status: "CANCELLED",
				error_type: "cancelled",
				artifacts_registered: false,
				cost: { amount_usd: 0, basis: "billed" },
			},
		],
	};
	const view = cardFor(
		settledFrom([cancelledOriginal, observerResult(stopped)]),
	);
	// The cancelled track has settled (D1): the count is settled tracks, 1/1.
	assert.deepEqual(
		[view.state, view.completed, view.total, view.cost],
		["cancelled", 1, 1, "Cost $0 (billed)."],
	);
});

test("live: the observer row carries the job after a cancel, never a premature cancelled", () => {
	// The Jobs wire as Core serves it: the cancelled task, and the observer
	// whose `latest_details.music.job` names the original music job.
	const wire = (id, status, stage, settled) => ({
		id,
		type: "music",
		status,
		queued: false,
		label: "Music",
		start_time: 1_000,
		settled_at: status === "running" ? null : 1_010,
		latest_details: {
			music: {
				job: "8b1723b0f326",
				stage,
				tracks: [{ ...LATE_RECORD.tracks[0], settled }],
				attribution: "",
			},
		},
	});
	const liveOf = (jobs) => ({
		...musicJobsLiveRowsOf(
			deriveRunDetails({ jobs, todos: [], nowMs: 1_060_000 }).jobs,
		),
	});
	const original = wire("8b1723b0f326", "cancelled", "polling", false);
	const working = liveOf([
		original,
		wire("5d2b5eecaee0", "running", "cancel_requested", false),
	]);
	assert.equal(working.rows.has("5d2b5eecaee0"), false);
	assert.equal(working.successors.get("8b1723b0f326")?.id, "5d2b5eecaee0");
	const pending = cardFor(new Map(), working);
	assert.deepEqual(
		[pending.state, pending.cancelRow],
		["cancel_requested", null],
		"the provider was already asked: no second Cancel",
	);
	// The cancelled task's own job_result can land before the observer ends.
	const pendingWithRow = cardFor(settledFrom([cancelledOriginal]), working);
	assert.equal(pendingWithRow.state, "cancel_requested");
	// Core's `JobStatus` word for a clean finish is `completed` (harness/jobs.py);
	// `done` is the folded word a pre-folded roster carries. Both must state the
	// paid outcome - the wire word is the one Core actually sends (round 24).
	for (const status of ["completed", "done"]) {
		const finished = cardFor(
			new Map(),
			liveOf([original, wire("5d2b5eecaee0", status, "completed", true)]),
		);
		assert.deepEqual(
			[finished.state, finished.completed, finished.total],
			["finished_after_cancel", 1, 1],
			`a successor settled ${status}`,
		);
	}
	// No observer at all: the task's cancelled row states the outcome as before.
	assert.equal(cardFor(new Map(), liveOf([original])).state, "cancelled");
});
