import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// React DOM feature-detects input events at import time. Give it a document
// before loading it, rather than activating its legacy IE event polyfill.
const bootstrapDOM = new JSDOM("<!doctype html>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * THE RESUMED CLOCK, on both halves of the working line.
 *
 * The operator report this file exists for: resuming (or attaching to) a
 * session whose tool call is CURRENTLY RUNNING restarted every elapsed counter
 * from the moment the view loaded — "each time I resume it says it's been
 * waiting for 0s regardless of how long". Two surfaces were wrong and both are
 * run here rather than argued from their call sites:
 *
 * 1. THE LADDER (`working-line-model.ts`). `deriveWorkingLine` returned only a
 *    label and a phase, so the row it fed had no anchor at all and fell back to
 *    `Date.now()` at mount. The producer's own fold (`activity_phase` /
 *    `activity_phase_started_at`) answers the phases with no card behind them,
 *    and a running batch is dated by its own oldest card — the same division of
 *    labour the TUI makes (`tui/app.py`'s `_current_activity` and
 *    `_folded_phase_epoch`), which is why the rule is asserted here rather than
 *    left to drift from its source.
 *
 * 2. THE ROW (`working-line.tsx`). It accepts `startedAt` and seeds its clock
 *    from it, so the assertion that matters is the RENDERED LABEL: a row handed
 *    an instant a minute back reads `1m`, not `0s` — which is the difference a
 *    story cannot pin, because a story that pins the anchor already believes
 *    the fix works.
 *
 * What this file does NOT claim: anything geometric. jsdom has no layout
 * engine, so the reserved clock slot's width is a measurement on a rendered
 * frame (`pnpm storybook`), not something a DOM test can carry.
 */

const canonical = "src/renderer/src/features/chat/canonical/";
const trace = "src/renderer/src/features/chat/components/trace/";
const bundle = await build({
	stdin: {
		contents: `
			export { WorkingLine } from "./${trace}working-line";
			export {
				deriveWorkingLine,
				workingLineInputFor,
				ADMITTED_SEND_ACTIVITY,
			} from "./${canonical}working-line-model";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
});
const bundlePath = new URL(
	`./_working-line-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	WorkingLine,
	deriveWorkingLine,
	workingLineInputFor,
	ADMITTED_SEND_ACTIVITY,
} = await import(bundlePath.href);
await unlink(bundlePath);

const h = React.createElement;

// ------------------------------------------------------------------ the ladder

/** The producer's stamp, in the epoch SECONDS the wire states it in. */
const PHASE_STARTED_EPOCH = 1_700_000_000;
const PHASE_STARTED_MS = PHASE_STARTED_EPOCH * 1000;

/** A running tool record, with the row's own clock where the reducer put it. */
const runningRow = (id, startedAt) => ({
	kind: "tool",
	id,
	ts: 1,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: null,
	phase: "running",
	argumentBytes: 0,
	output: null,
	isError: false,
	durationS: null,
	startedAt,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
});

const composingRow = (id) => ({
	...runningRow(id, null),
	phase: "composing",
});

const streamingRow = (id, text) => ({
	kind: "assistant",
	id,
	ts: 1,
	text,
	streaming: true,
	stopReason: null,
	error: false,
});

/** The ladder, read the way the transcript view reads it. */
const ladder = (pane) => deriveWorkingLine(workingLineInputFor(pane));

const base = (over) => ({
	waiting: true,
	compacting: false,
	starting: false,
	gate: false,
	unavailable: false,
	records: [],
	...over,
});

test("a running batch is dated by its OLDEST card, not by the folded phase edge", () => {
	/*
	 * The phase starts a new zero on every call that JOINS the batch, so the
	 * phase edge is the wrong anchor for it — a three-call batch would restart
	 * its clock three times (`frontend_state.py::_fold_activity_phase`). Every
	 * card must date itself: one unknown start poisons the zero, because the
	 * call the clock claims to measure is exactly the oldest one.
	 */
	const oldest = PHASE_STARTED_MS - 137_000;
	const derived = ladder({
		...base({}),
		records: [
			runningRow("t-new", PHASE_STARTED_MS - 2_000),
			runningRow("t-old", oldest),
		],
		// A fold that names the same phase must NOT outrank the cards.
		foldedPhase: "running",
		foldedPhaseStartedAt: PHASE_STARTED_EPOCH,
	});
	assert.equal(derived.activity, "running 2 tools");
	assert.equal(derived.phase, "running");
	assert.equal(derived.startedAt, oldest, "the oldest card's own start");

	// And one undateable card withholds the batch's zero rather than letting
	// the batch wear its sibling's age.
	const poisoned = ladder({
		...base({}),
		records: [
			runningRow("t-new", PHASE_STARTED_MS - 2_000),
			runningRow("t-undated", null),
		],
		foldedPhase: "running",
		foldedPhaseStartedAt: PHASE_STARTED_EPOCH,
	});
	assert.equal(
		poisoned.startedAt,
		undefined,
		"no stamp, so the row keeps its own local zero",
	);
});

test("a phase with no card behind it takes the producer's own zero", () => {
	/*
	 * `thinking` is the rung the operator's report names: there is no tool row
	 * behind it, so a per-call stamp cannot answer it, and before this the
	 * label a viewer resumed counted from the viewer's arrival.
	 */
	const thinking = ladder({
		...base({}),
		foldedPhase: "thinking",
		foldedPhaseStartedAt: PHASE_STARTED_EPOCH,
	});
	assert.deepEqual(thinking, {
		activity: "thinking",
		phase: "thinking",
		startedAt: PHASE_STARTED_MS,
	});

	const responding = ladder({
		...base({}),
		records: [streamingRow("a1", "Streaming")],
		foldedPhase: "responding",
		foldedPhaseStartedAt: PHASE_STARTED_EPOCH,
	});
	assert.deepEqual(responding, {
		activity: "responding",
		phase: "responding",
		startedAt: PHASE_STARTED_MS,
	});

	const composing = ladder({
		...base({}),
		records: [composingRow("t1")],
		foldedPhase: "composing",
		foldedPhaseStartedAt: PHASE_STARTED_EPOCH,
	});
	assert.deepEqual(composing, {
		activity: "composing a call",
		phase: "composing",
		startedAt: PHASE_STARTED_MS,
	});
});

test("a fold that disagrees with the derived phase is withheld, never substituted", () => {
	/*
	 * The gate is the TUI's (`OperatorApp._folded_phase_epoch`), and it is
	 * whole of the anchor's safety: the phase folded from the producer's events
	 * and the phase derived from the records are two reductions of one stream,
	 * so a disagreement means one of them missed events. Substituting a zero
	 * there is how a `retrying (attempt 2)` row once wore the age of the
	 * attempt that had just failed.
	 */
	const mismatch = ladder({
		...base({}),
		foldedPhase: "running",
		foldedPhaseStartedAt: PHASE_STARTED_EPOCH,
	});
	assert.deepEqual(
		mismatch,
		{ activity: "thinking", phase: "thinking" },
		"a fold for another phase leaves the row on its own zero",
	);

	// A producer that has no phase at all (`""` between turns) is the same
	// answer, and so is no fold: neither may invent an age.
	for (const absent of [
		{},
		{ foldedPhase: "" },
		{ foldedPhase: "thinking", foldedPhaseStartedAt: null },
		{ foldedPhase: "thinking", foldedPhaseStartedAt: 0 },
	]) {
		assert.deepEqual(
			ladder({ ...base({}), ...absent }),
			{ activity: "thinking", phase: "thinking" },
			`no usable stamp in ${JSON.stringify(absent)}`,
		);
	}
});

test("the admitted send keeps its own zero, and the fold cannot reach it", () => {
	/*
	 * This expression began when THIS app sent, so the app is the clock's own
	 * producer and there is nothing older to resume. Seeding it from the
	 * runtime's `thinking` edge would be a second answer to a question this
	 * branch already has the first answer to — and the two are not the same
	 * instant: the runtime's model call starts after the harness has the
	 * request.
	 */
	const admitted = ladder({
		waiting: false,
		compacting: false,
		starting: true,
		startingAfterId: "echo-1",
		gate: false,
		unavailable: false,
		records: [],
		foldedPhase: "thinking",
		foldedPhaseStartedAt: PHASE_STARTED_EPOCH,
	});
	assert.deepEqual(admitted, {
		activity: ADMITTED_SEND_ACTIVITY,
		phase: "thinking",
	});
});

test("a pane with no new fields derives exactly the object it always did", () => {
	/*
	 * The compatibility half, and the reason `workingLineInputFor` SPREADS the
	 * pair rather than spelling it out: a facade in tests, a legacy runtime and
	 * a session between turns all pass neither field, and an explicit
	 * `foldedPhase: undefined` would be a different object to every
	 * depth-aware comparison in `tool-row.test.mjs`.
	 */
	const withoutFold = ladder(base({}));
	assert.deepEqual(withoutFold, { activity: "thinking", phase: "thinking" });
	assert.equal(
		Object.hasOwn(withoutFold, "startedAt"),
		false,
		"the key is absent, not undefined",
	);
});

// ------------------------------------------------------------------- the row

/**
 * One mounted row, on a clock this file drives.
 *
 * `intervals` is a REGISTRY rather than faked timers for the reason the tip
 * row's harness gives: the component calls `window.setInterval`, which jsdom
 * owns and `node:test`'s `mock.timers` cannot reach, and the registry lets the
 * test advance the clock by exactly one period.
 *
 * `Date.now` is stubbed for the same reason and it is what makes the labels
 * asserted below ARITHMETIC rather than timing: the component reads the wall
 * clock at mount (to measure against its anchor) and on every tick, so a real
 * clock would make `1m` a function of how long the harness took to get there.
 * The stub is installed on the global `Date` rather than on
 * `window.Date`, because the bundle runs in node and reads node's global.
 */
async function fixture({ startedAt, now }, run) {
	const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
	const { window } = dom;
	const intervals = new Map();
	const clock = { now };
	let nextTimer = 1;
	let mounted = true;
	const originals = new Map();
	for (const [key, value] of Object.entries({
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const realNow = Date.now;
	Date.now = () => clock.now;
	window.matchMedia = (query) => ({
		media: query,
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	});
	window.setInterval = (fn, delay) => {
		const id = nextTimer++;
		intervals.set(id, { fn, delay });
		return id;
	};
	window.clearInterval = (id) => {
		intervals.delete(id);
	};

	const root = createRoot(window.document.getElementById("root"));
	const api = {
		window,
		/** Move the wall clock AND fire every live interval once. */
		advance: (ms) => {
			clock.now += ms;
			for (const entry of [...intervals.values()]) entry.fn();
		},
		/** The row's clock slot: the second of the two agent-hidden spans. */
		label: () =>
			window.document.querySelectorAll("[data-lo-working-line] span")[2]
				?.textContent,
		render: async () => {
			await act(() =>
				root.render(
					h(WorkingLine, {
						activity: "running bash",
						phase: "running",
						...(startedAt === undefined ? {} : { startedAt }),
					}),
				),
			);
		},
	};
	try {
		await run(api);
	} finally {
		Date.now = realNow;
		if (mounted) {
			mounted = false;
			await act(() => root.unmount());
		}
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	}
}

test("a row handed a real start renders the age, and keeps counting from it", async () => {
	/*
	 * The asserted property is the LABEL, because that is what the operator read:
	 * `0s` beside a call that had been running for minutes. The clock is driven
	 * by this file rather than read from the machine, so the numbers below are
	 * arithmetic.
	 */
	await fixture(
		{ startedAt: PHASE_STARTED_MS, now: PHASE_STARTED_MS + 60_000 },
		async (api) => {
			await api.render();
			assert.equal(
				api.label(),
				"1m",
				"the FIRST frame is the age the call has, which is what the shutter used to decide",
			);
			await act(() => api.advance(60_000));
			assert.equal(
				api.label(),
				"2m",
				"and the clock keeps counting from the anchor rather than restarting",
			);
		},
	);
});

test("the fold the wire carries reaches the rendered row", async () => {
	/*
	 * The two halves joined, from the WIRE FIELD NAMES the contract declares
	 * (`activity_phase` / `activity_phase_started_at`) rather than from the
	 * internal input shape: this is what pins that the resumed pane's row is
	 * driven by the producer's fold and not by the mount, and it fails if either
	 * the model stops relying on it or the builder stops carrying it.
	 */
	const frontend = {
		activity_phase: "running",
		activity_phase_started_at: PHASE_STARTED_EPOCH,
	};
	const derived = ladder({
		...base({}),
		records: [runningRow("t1", PHASE_STARTED_MS)],
		foldedPhase: frontend.activity_phase,
		foldedPhaseStartedAt: frontend.activity_phase_started_at,
	});
	await fixture(
		{ startedAt: derived.startedAt, now: PHASE_STARTED_MS + 137_000 },
		async (api) => {
			await api.render();
			assert.equal(api.label(), "2m17s", "137s of real work, not 0s");
		},
	);
});

test("a row with no start keeps today's honest local zero", async () => {
	// `startedAt` absent is the shape every phase without a stamp has, and it
	// must keep reading `0s` from the mount rather than being blanked: this is
	// the behaviour the fix deliberately does not change.
	await fixture(
		{ startedAt: undefined, now: PHASE_STARTED_MS },
		async (api) => {
			await api.render();
			assert.equal(api.label(), "0s");
		},
	);
});
