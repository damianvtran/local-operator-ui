import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
/*
 * Imported inside a `try`, not beside it: a bundle that fails to LOAD (a bad
 * alias, a Vite-only global the next author has not stubbed) used to leave a
 * 269k-line artefact in `scripts/`, which then rode into `pnpm lint` and
 * `lint:scripts` as a changed file and buried the real error behind `ENOBUFS`.
 * The sibling in `suggestion-stack-react.test.mjs` has the same shape; this one
 * pays for the lesson it taught.
 */
let workingLineModule;
try {
	workingLineModule = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const {
	WorkingLine,
	deriveWorkingLine,
	workingLineInputFor,
	ADMITTED_SEND_ACTIVITY,
} = workingLineModule;

/*
 * A SECOND BUNDLE, and it is the point of the section below: the shipped
 * `CanonicalTranscript`, so the fold reaches the band through the component's
 * OWN call site and memo rather than through a hand-mapped argument list.
 *
 * WHY IT EXISTS. The wiring between `frontend` and `workingLineInputFor` is two
 * property lines inside a `useMemo` (`canonical-transcript.tsx`), and a test
 * that hands `foldedPhase` to the builder itself cannot see them: deleting the
 * call site, or dropping the pair from the memo's dependency array, leaves every
 * fast test in this repository green and only a Storybook story would notice.
 * That is a seam in the unit gate rather than in the fix, and it is closed here.
 *
 * The alias, loader and external set are the ones `canonical-notice.test.mjs`
 * already uses to bundle this same component for a server render; here it is
 * MOUNTED instead, because the property under test needs a SECOND render whose
 * only change is the fold.
 */
const transcriptBundle = await build({
	stdin: {
		contents: `
			export { CanonicalTranscript } from "./${canonical}canonical-transcript";
			export { EMPTY_TRANSCRIPT } from "./${canonical}transcript-reducer";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/*
	 * The externals are `canonical-notice.test.mjs`'s list plus `react-dom/client`,
	 * which this file needs because it MOUNTS. Everything else — MUI among it — is
	 * bundled, and that is not a preference: left external, `@mui/material/styles`
	 * is a BARE DIRECTORY import at runtime and node refuses it
	 * (`ERR_UNSUPPORTED_DIR_IMPORT`), where esbuild resolves it through the
	 * package's export map at bundle time.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
	],
	/*
	 * BOTH of these exist because the bundle runs outside Vite, and each was a
	 * hard failure rather than a warning:
	 *
	 * - `import.meta.env.DEV` is a VITE-only construct. esbuild leaves
	 *   `import.meta.env` undefined, so the pane's perf effect (`if
	 *   (!import.meta.env.DEV) return;`) throws `Cannot read properties of
	 *   undefined (reading 'DEV')`. The FIRST time an effect runs, which a server
	 *   render never does — which is why `canonical-notice.test.mjs` can bundle
	 *   this same component without defining it. `false` is the branch a
	 *   production renderer takes, and the effect it guards is a debug readout.
	 * - `process.env.NODE_ENV` is unset under `node --test`, and MUI is BUNDLED
	 *   here (left external, `@mui/material/styles` is a bare DIRECTORY import and
	 *   node refuses it: `ERR_UNSUPPORTED_DIR_IMPORT`), so its branches need the
	 *   variable present. `development` keeps every value it looks up.
	 */
	define: {
		"import.meta.env.DEV": "false",
		"import.meta.env.PROD": "true",
		"process.env.NODE_ENV": '"development"',
	},
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@renderer": `${process.cwd()}/src/renderer/src`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	write: false,
});
const transcriptBundlePath = new URL(
	`./_working-line-transcript-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(transcriptBundlePath, transcriptBundle.outputFiles[0].text);
// Unlinked in a `finally`, for the reason the first bundle's comment gives.
let transcriptModule;
try {
	transcriptModule = await import(transcriptBundlePath.href);
} finally {
	await unlink(transcriptBundlePath);
}
const { CanonicalTranscript, EMPTY_TRANSCRIPT } = transcriptModule;

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
	 *
	 * WHAT IT DOES NOT COVER, said here because assuming it did is what left the
	 * seam: the mapping from `frontend` to these two arguments is HANDED OVER in
	 * this fixture, so the `useMemo` in `canonical-transcript.tsx` that performs
	 * it is untested by it. The case below mounts the shipped component for
	 * exactly that reason.
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

/*
 * ------------------------------------------------- the call site, mounted
 *
 * The wiring between the reader's `frontend` and the rung's anchor, run through
 * the SHIPPED `CanonicalTranscript` rather than handed over as an argument.
 */

/**
 * The pane's transcript: one user row, which is the honest shape of the state
 * this defect was reported in (a resumed conversation has a history, and a row
 * keeps the pane out of its row-less `h-0` collapse).
 */
const paneTranscript = {
	...EMPTY_TRANSCRIPT,
	records: [
		{
			kind: "user",
			id: "u-resume",
			ts: 1,
			text: "Re-run the transport suite against the resumed clock.",
			images: [],
		},
	],
	index: new Map([["u-resume", 0]]),
};

/**
 * The pane's props, held by IDENTITY between the two renders below.
 *
 * Load-bearing rather than tidy: the assertion is that a changed `frontend`
 * alone re-derives the rung, so every other prop — and therefore every other
 * dependency of the memo — has to be the same object on both renders, or the
 * memo would recompute for a reason that has nothing to do with the fold.
 */
const paneProps = {
	transcript: paneTranscript,
	gate: null,
	waiting: true,
	starting: false,
	startingAfterId: null,
	loadingOlder: false,
	onLoadOlder: async () => true,
	containerRef: { current: null },
	isSmallView: false,
	status: "live",
	failure: null,
	awaitingHydration: false,
	onReconnect: () => {},
};

/**
 * One mounted pane, on a clock this file drives.
 *
 * The `Date` stub is the reason the numbers asserted below are arithmetic: the
 * band reads the wall clock against its anchor, so a real clock would make `1m32s`
 * a function of how long the harness took to get there.
 */
async function paneFixture(now, run) {
	const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
	const { window } = dom;
	const intervals = new Map();
	let nextTimer = 1;
	const originals = new Map();
	for (const [key, value] of Object.entries({
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
		/*
		 * jsdom implements neither, and the pane reaches for
		 * `requestAnimationFrame` from a layout effect on mount. Timers rather than
		 * `window` members: the bundle reads them off the global, the way it would
		 * in a renderer.
		 */
		requestAnimationFrame: (callback) => setTimeout(() => callback(now), 0),
		cancelAnimationFrame: (id) => clearTimeout(id),
		/* jsdom implements no `ResizeObserver` either, and the pane measures with
		   one; nothing here is a measurement, so the stub observes nothing. */
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	})) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const realNow = Date.now;
	Date.now = () => now;
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
		/** The band's clock slot: the second of its two agent-hidden spans. */
		label: () =>
			window.document.querySelectorAll("[data-lo-working-line] span")[2]
				?.textContent,
		render: async (frontend) => {
			await act(() =>
				root.render(h(CanonicalTranscript, { ...paneProps, frontend })),
			);
		},
	};
	try {
		await run(api);
	} finally {
		Date.now = realNow;
		await act(() => root.unmount());
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	}
}

test("the pane's own call site hands the fold's zero to the band", async () => {
	/*
	 * M3, the half a rendered pane CAN answer. `waiting` IS `frontend.streaming`
	 * (`chat-page.tsx`), so a resumed pane cannot paint the band before the state
	 * carrying the fold is present: the mount below is the production sequence,
	 * and `WorkingLine`'s phase-change-only re-anchor therefore adopts the resumed
	 * anchor on this first frame.
	 *
	 * What it pins: the two property lines in `canonical-transcript.tsx` that
	 * carry `activity_phase` and `activity_phase_started_at` into
	 * `workingLineInputFor`. Remove either and the band mounts at its own zero.
	 * The test in the section after this one covers the memo's dependency array,
	 * which a single mount cannot see.
	 */
	await paneFixture(PHASE_STARTED_MS, async (api) => {
		await api.render({
			activity_phase: "thinking",
			activity_phase_started_at: PHASE_STARTED_EPOCH - 92,
		});
		assert.equal(
			api.label(),
			"1m32s",
			"the resumed snapshot's own phase zero reaches the band through the pane",
		);
	});
});

test("a pane whose fold states nothing keeps the local zero", async () => {
	// The control for the case above, and the behaviour this change deliberately
	// does not move: no phase, no stamp, so the band counts from its own mount.
	await paneFixture(PHASE_STARTED_MS, async (api) => {
		await api.render({ activity_phase: "", activity_phase_started_at: null });
		assert.equal(api.label(), "0s");
	});
});

/*
 * --------------------------------------------------- the memo's dependency array
 *
 * The half a MOUNT cannot answer, and the reason it needs its own case rather
 * than a second render.
 *
 * A `useMemo` whose dependency array lost the fold pair returns the rung it
 * cached, and the only consumer of that rung is `WorkingLine`, whose anchor is
 * re-read on a PHASE change alone (design round 2's D3). A phase change is always
 * accompanied by a change to `transcript.records` — the derived phase is a
 * function of those records and of nothing else — and `records` is itself a
 * dependency, so a stale memo is not reachable through the rendered clock. The
 * array is therefore asserted where it lives, in the source, in the shape
 * `canonical-chat.test.mjs` already uses for a call site it cannot render.
 *
 * If a THIRD reader of this memo ever appears, this case fails loudly and its
 * count is what the author updates; that is the intended behaviour, because the
 * count is the contract.
 */
const PANE_SOURCE =
	"src/renderer/src/features/chat/canonical/canonical-transcript.tsx";

/** The pane's source with its comments removed, the way the sibling guards read it. */
const paneSource = readFileSync(PANE_SOURCE, "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const paneLines = paneSource.split("\n").map((line) => line.trim());

test("the pane's rung memo READS the fold and DEPENDS on it", () => {
	// Read, at the builder's call site: the pair is taken off `frontend` rather
	// than reached for through its index signature or defaulted to a literal.
	assert.match(
		paneSource,
		/foldedPhase:\s*frontend\?\.activity_phase,/,
		"the builder is handed the producer's phase",
	);
	assert.match(
		paneSource,
		/foldedPhaseStartedAt:\s*frontend\?\.activity_phase_started_at,/,
		"and the instant that phase began",
	);

	// Depended on, as a bare entry in some dependency array. A bare entry is the
	// only spelling that distinguishes a dependency from an argument: at the call
	// site both fields sit behind a `foldedPhase...:` prefix, so a line that is
	// exactly `frontend?.activity_phase,` can only be an array member.
	for (const field of [
		"frontend?.activity_phase,",
		"frontend?.activity_phase_started_at,",
	]) {
		assert.equal(
			paneLines.filter((line) => line === field).length,
			1,
			`${field} is exactly one entry of exactly one dependency array`,
		);
	}
});
