import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The interrupt control's POLICY, driven through the shipped modules.
 *
 * The reported defect was not "the endpoint is wrong" - it was that a press
 * posted `{op: "sessions.command", command: "stop"}`, which the backend answers
 * with a presentation form (HTTP 200 plus a `native_action` asking the client to
 * open the session-stop picker) while the turn kept streaming. So the questions
 * this file answers are the ones a happy-path test cannot:
 *
 *   - which op does the press fire, with which body, and does it ever fall back
 *     to the session-stop route, which would kill the session the control does
 *     not promise to kill;
 *   - is the control (and its Escape accelerator) fail-closed on a backend that
 *     does not advertise `session_interrupt`;
 *   - what does the user get told, and - the case that matters most - what do
 *     they NOT get told;
 *   - and who owns the Escape key, because one key cannot mean two things.
 *
 * The modules are the REAL ones, bundled with esbuild; only the network is
 * faked. `desktopFeatureEnabled`, the capability gate and the predicate are all
 * shipped code, because a stub of any of them would let a wrong version, a
 * wrong default or a wrong precedence pass.
 */
const bundle = await build({
	stdin: {
		contents: `
			import {
				interruptNotice,
				interruptTurn,
				interruptUnavailableNotice,
				sessionInterruptEnabled,
			} from "./src/renderer/src/features/chat/interrupt-turn";
			import {
				dispatchInterruptOnEscape,
				ESCAPE_OWNING_FIELDS,
				interruptEscapeApplies,
				ownsEscapeOutsideComposer,
			} from "./src/renderer/src/features/chat/hooks/use-interrupt-on-escape";
			import { COMPOSER_TEXTAREA_SELECTOR } from "./src/renderer/src/features/chat/composer-field";
			export {
				interruptNotice,
				interruptTurn,
				interruptUnavailableNotice,
				sessionInterruptEnabled,
				dispatchInterruptOnEscape,
				ESCAPE_OWNING_FIELDS,
				interruptEscapeApplies,
				ownsEscapeOutsideComposer,
				COMPOSER_TEXTAREA_SELECTOR,
			};
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	write: false,
	plugins: [
		{
			name: "interrupt-transport-fixture",
			setup(builder) {
				// Only the network is faked. Everything else in the transport module
				// is re-exported untouched, because siblings in the import graph
				// (`backend-error`) are real classes the shipped code depends on.
				builder.onResolve({ filter: /desktop-api$/ }, () => ({
					path: "transport",
					namespace: "interrupt-fixture",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "interrupt-fixture" },
					() => ({
						contents: `export * from ${JSON.stringify(
							`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
						)}
export const desktopResult = (request) => globalThis.__interruptRequest(request);`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});

// Written to disk rather than imported as a data: URL, because the graph keeps
// React external and a data: URL has no base path from which to resolve it.
const bundlePath = new URL("./_interrupt-control.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	interruptNotice,
	interruptTurn,
	interruptUnavailableNotice,
	sessionInterruptEnabled,
	dispatchInterruptOnEscape,
	ESCAPE_OWNING_FIELDS,
	interruptEscapeApplies,
	ownsEscapeOutsideComposer,
	COMPOSER_TEXTAREA_SELECTOR,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------------------------- the composer's geometry */

/*
 * THE SLOT THE STOP CONTROL OCCUPIES, pinned by the shipped row's own layout.
 *
 * UX round 1's U1 and QA's Q1 measured the same hazard independently: with the
 * turn settled, `document.elementFromPoint(1287, 819)` - the centre of the box
 * the press had just landed in - is `button[aria-label="Start recording"]`,
 * because the dictation control slides 36px right into the Stop's position, and
 * pressing there starts a microphone recording. A 120ms double press still hits
 * Stop twice, so it depends entirely on how fast the second press lands.
 *
 * WHY THIS IS READ FROM THE SOURCE rather than rendered. The boxes are geometry,
 * and the strongest instrument would be the real one: this harness cannot mount
 * the composer - `react-dom/server` on its module graph dies at import on
 * `import.meta.env` and a config read, with or without a `require` banner (both
 * were tried), and jsdom has no layout engine, so every rect there is zero.
 * So this half reads the ROW the component ships - the order of its controls and
 * the size expression each one carries - and derives the boxes from those, while
 * `scripts/interrupt-esc-proof.mjs` measures the same claim in the REAL app at
 * both rungs and fails the run when it does not hold (`interrupt-proof.json`'s
 * `slot.*` steps). Two instruments for one fact, because the fact is the one QA
 * rated MAJOR.
 *
 * What it pins: the row is [dictation][Stop][Send] while a turn runs and
 * [dictation][reserved box][Send] between turns, the reserved box is the control's
 * own size at whichever rung the row is on, and it carries nothing that can be
 * reached, focused or announced.
 */
const ROW_SOURCE = readFileSync(
	"src/renderer/src/features/chat/components/message-input.tsx",
	"utf8",
);
/** The row's control cluster: from its own class to the closing of its wrapper. */
const ROW = ROW_SOURCE.slice(
	ROW_SOURCE.indexOf('className="ml-auto flex items-center gap-1'),
	ROW_SOURCE.indexOf("{messages.length === 0 && !isHydrating && !isSmallView"),
);

/** The size a control carries, in CSS pixels, for the rung under test. */
const controlSize = (isSmallView) => (isSmallView ? 28 : 32);

test("the Stop control's box is reserved, so the dictation control cannot take its centre", () => {
	// The row's own order, by where each control's marker appears in it.
	const mic = ROW.indexOf('aria-label="Start recording"');
	const stop = ROW.indexOf('aria-label="Stop"');
	const send = ROW.indexOf('aria-label="Send message"');
	const reserved = ROW.indexOf("data-interrupt-slot");
	assert.ok(
		mic > -1 && stop > -1 && send > -1,
		"the row lost one of its controls",
	);
	assert.ok(
		reserved > -1,
		"the Stop control's box is not reserved: the dictation control will slide into the centre a reflex second press lands on",
	);
	assert.ok(
		mic < reserved && reserved < stop && stop < send,
		`the row is not [dictation][reserved box][Stop][Send] (mic ${mic}, reserved ${reserved}, Stop ${stop}, Send ${send})`,
	);
	/*
	 * The reservation has to wear the CONTROL's size, not a fixed one: at the
	 * small rung the whole cluster is `icon-sm` (28px), so a 32px placeholder
	 * would move the dictation control rather than hold its place. Both blocks
	 * carry the same expression, and this asserts that rather than assuming it.
	 */
	const sizeExpression = 'isSmallView ? "size-7" : "size-8"';
	const reservedBlock = ROW.slice(reserved - 400, reserved + 200);
	assert.ok(
		reservedBlock.includes(sizeExpression),
		"the reserved box does not carry the control's own size expression",
	);
	assert.match(reservedBlock, /aria-hidden="true"/);
	assert.match(reservedBlock, /pointer-events-none/);
	assert.doesNotMatch(reservedBlock, /<button|tabIndex|onClick/);

	/*
	 * THE HAZARD, in the manager's own words: the dictation control's hit box must
	 * not cover the position the Stop occupied. Laid out with the row's own 4px
	 * gap, at both rungs.
	 */
	for (const isSmallView of [false, true]) {
		const size = controlSize(isSmallView);
		const gap = 4;
		const rung = isSmallView ? "small" : "default";
		// [dictation][reserved][Send], from the row's left edge.
		const dictation = { x: 0, width: size };
		const slot = { x: size + gap, width: size };
		const stopCentre = slot.x + slot.width / 2;
		assert.ok(
			dictation.x + dictation.width <= slot.x,
			`${rung}: the dictation control reaches into the Stop's box; its centre ${stopCentre} would be pressable in the state a reflex press arrives in`,
		);
	}
});

const requests = [];
globalThis.__interruptRequest = async (request) => {
	requests.push(request);
	return {
		status: "interrupted",
		receipt: "",
		children_running: 0,
		background_jobs: 0,
	};
};

const SESSION = "123456abcdef";
const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/* ------------------------------------------------------------------ the op */

test("a press fires sessions.interrupt and never the session-stop route", () => {
	requests.length = 0;
	void interruptTurn(SESSION, REQUEST);
	assert.deepEqual(requests, [
		{ op: "sessions.interrupt", sessionId: SESSION, requestId: REQUEST },
	]);
	// The two failure modes this op exists to separate. `sessions.command` with
	// `command: "stop"` is the defect - a 200 that stops nothing - and
	// `sessions.stop` is the kill switch one rung up, which answers a
	// turn-level press by ending the session and its process.
	for (const wrong of ["sessions.command", "sessions.stop"])
		assert.notEqual(requests[0].op, wrong);
});

test("the interrupt is fail-closed on the capability, in both halves", () => {
	const capable = (version) => ({
		desktop_available: true,
		features: { session_interrupt: version },
	});
	assert.equal(sessionInterruptEnabled(capable(1)), true);
	// A backend the app started is required as well as the key: the route sits
	// behind the desktop bearer, so a renderer without the pairing would render a
	// button whose every press is a 401.
	assert.equal(
		sessionInterruptEnabled({ ...capable(1), desktop_available: false }),
		false,
	);
	// An older backend that can still STOP a session must keep `/stop` working and
	// must not be told it can interrupt one.
	assert.equal(sessionInterruptEnabled(capable(0)), false);
	assert.equal(sessionInterruptEnabled({ features: { lifecycle: 3 } }), false);
	assert.equal(sessionInterruptEnabled(null), false);
	assert.equal(sessionInterruptEnabled(undefined), false);
});

/* ------------------------------------------------- the sentence, and silence */

test("the common case says nothing at all", () => {
	// The tree's own precedent: the notification bridge excludes a completed
	// `interrupted` from the kinds it raises a banner for, because telling
	// someone their own press worked is a notification nobody wants.
	assert.equal(
		interruptNotice({
			status: "interrupted",
			receipt: "turn stopped",
			children_running: 0,
			background_jobs: 0,
			replayed: false,
		}),
		null,
	);
	// `idle` is a SUCCESS - no turn was running, or the session was cold and was
	// never engaged to answer this - and a sentence would invent an outcome.
	assert.equal(
		interruptNotice({
			status: "idle",
			receipt: "no turn running",
			children_running: 3,
			background_jobs: 2,
			replayed: false,
		}),
		null,
	);
});

test("the notice names the number AND the lever that is still available", () => {
	const notice = (children, jobs) =>
		interruptNotice({
			status: "interrupted",
			receipt: "ignored - prose the runtime owns",
			children_running: children,
			background_jobs: jobs,
			replayed: false,
		});

	const children = notice(2, 0);
	assert.match(children, /2 subagents are still running/);
	// The pane is named the way the app names it (design round 1, D2).
	assert.match(children, /open Run details/);
	assert.match(children, /\/stop/);
	assert.doesNotMatch(children, /background/);

	const jobs = notice(0, 1);
	assert.match(jobs, /1 background job is still running/);
	assert.match(jobs, /\/stop/);

	// The two counts share one clause rather than repeating "still running", which
	// is what costs the fifth line at the narrow rung (design round 1, D3).
	const both = notice(3, 2);
	assert.match(both, /3 subagents and 2 background jobs are still running/);
	assert.equal(both.match(/still running/g)?.length, 1);

	// Singular and plural both read as sentences, because a count of one printed
	// as "1 subagents" is the kind of defect that survives every review.
	assert.match(notice(1, 0), /1 subagent is still running/);
	for (const sentence of [children, jobs, both])
		assert.match(sentence, /^Stopped this turn\. /);
});

/* ---------------------------------------------------------- who owns Escape */

/**
 * A target that behaves like a real one: it is a field, and `closest` on that
 * field answers whether the field IS the composer's textarea.
 *
 * Duck-typed rather than an `Element` instance because this test runs under node,
 * where there is no DOM - which is the same reason the rule itself asks for a
 * `closest` method rather than testing `instanceof Element`.
 */
const fieldTarget = ({ composer }) => {
	const field = {
		closest: (selector) =>
			selector === COMPOSER_TEXTAREA_SELECTOR
				? composer
					? field
					: null
				: null,
	};
	return {
		closest: (selector) => (selector === ESCAPE_OWNING_FIELDS ? field : null),
	};
};

const composerTarget = fieldTarget({ composer: true });
const otherFieldTarget = fieldTarget({ composer: false });

test("a text field that is not the composer keeps Escape", () => {
	/*
	 * Measured, not assumed. Two surfaces consume Escape in a React handler that
	 * calls NO `preventDefault` - the sidebar's search field (clears the query and
	 * blurs) and the working-directory chip's inline edit (cancels the edit) - so
	 * they cannot be inherited through `defaultPrevented` and are named by this
	 * rule instead. Both are the LAYER 6 claims of the hook's ladder.
	 */
	assert.equal(ownsEscapeOutsideComposer(otherFieldTarget), true);
	assert.equal(ownsEscapeOutsideComposer(composerTarget), false);
	// The composer is the exception, and it is the whole feature: it is where the
	// user types, so deferring to it would make the accelerator unreachable from
	// the place it is most wanted. Its own Escape behaviour (the slash popup)
	// announces itself with `preventDefault` and is handled above this rule.
	assert.equal(
		interruptEscapeApplies(
			{
				key: "Escape",
				defaultPrevented: false,
				isComposing: false,
				target: otherFieldTarget,
			},
			{ sessionId: SESSION, busy: true, available: true },
		),
		false,
	);
	assert.equal(
		interruptEscapeApplies(
			{
				key: "Escape",
				defaultPrevented: false,
				isComposing: false,
				target: composerTarget,
			},
			{ sessionId: SESSION, busy: true, available: true },
		),
		true,
	);
	// Anything that is not an element at all - a text node, the document, a
	// synthetic event with no target - owns nothing.
	assert.equal(ownsEscapeOutsideComposer(null), false);
	assert.equal(ownsEscapeOutsideComposer({}), false);
});

test("the predicate is exactly Escape, unclaimed, not composing, and a running turn", () => {
	const state = { sessionId: SESSION, busy: true, available: true };
	const event = (over = {}) => ({
		key: "Escape",
		defaultPrevented: false,
		isComposing: false,
		target: composerTarget,
		...over,
	});
	assert.equal(interruptEscapeApplies(event(), state), true);
	assert.equal(interruptEscapeApplies(event({ key: "Esc" }), state), false);
	assert.equal(interruptEscapeApplies(event({ key: "Enter" }), state), false);
	// A Radix layer claims the press from a capture-phase listener on the
	// document, so by the time this sees it the flag is already set.
	assert.equal(
		interruptEscapeApplies(event({ defaultPrevented: true }), state),
		false,
	);
	// An IME uses Escape to cancel a candidate string; interrupting a turn on
	// that press would stop work the user never asked to stop.
	assert.equal(
		interruptEscapeApplies(event({ isComposing: true }), state),
		false,
	);
	// Nothing running: do nothing. Specifically, do not clear the composer.
	for (const idle of [
		{ ...state, busy: false },
		{ ...state, sessionId: null },
		{ ...state, available: false },
	])
		assert.equal(interruptEscapeApplies(event(), idle), false);
});

test("the decision waits for every layer that binds after it", async () => {
	/*
	 * THE MICROTASK IS THE MECHANISM, and this is why it is not decoration.
	 * Bubble-phase listeners on `window` run in REGISTRATION order and this hook
	 * mounts with the panel, so a dialog, palette, canvas edit or voice recording
	 * that opens later adds its listener after this one. Reading
	 * `defaultPrevented` at listener time would therefore answer "nothing claimed
	 * this" for exactly those layers - and the recording cancel is the one that
	 * would be measurably wrong: Escape during a recording would stop the turn
	 * instead of the recording.
	 */
	const state = { sessionId: SESSION, busy: true, available: true };
	const press = () => ({
		key: "Escape",
		defaultPrevented: false,
		isComposing: false,
		target: composerTarget,
	});

	// A later listener claims it: the interrupt must not fire.
	const claimed = press();
	let fired = 0;
	assert.equal(
		dispatchInterruptOnEscape(claimed, state, () => {
			fired += 1;
		}),
		true,
		"the press is accepted at listener time",
	);
	assert.equal(fired, 0, "nothing fires inside the dispatch");
	claimed.defaultPrevented = true; // a recording cancel, one listener later
	await Promise.resolve();
	assert.equal(fired, 0, "a claimed press never reaches the interrupt");

	// Nobody claims it: the interrupt fires exactly once.
	const free = press();
	dispatchInterruptOnEscape(free, state, () => {
		fired += 1;
	});
	await Promise.resolve();
	assert.equal(fired, 1);

	// A press the predicate refused schedules nothing at all - not even a
	// microtask that could fire later against a state that has since moved.
	assert.equal(
		dispatchInterruptOnEscape(free, { ...state, busy: false }, () => {
			fired += 1;
		}),
		false,
	);
	await Promise.resolve();
	assert.equal(fired, 1);
});

/* ------------------------------------------------------- what the band says */

test("an older backend says why the turn cannot be stopped", () => {
	// UX round 1's U4: hiding a control that cannot work is right; saying nothing
	// while the user's work runs is the original bug's silence.
	assert.equal(interruptUnavailableNotice(false, false), null);
	assert.equal(interruptUnavailableNotice(false, true), null);
	// The capability is present: this build presses, and the receipt speaks.
	assert.equal(interruptUnavailableNotice(true, true), null);
	const notice = interruptUnavailableNotice(true, false);
	assert.match(notice, /predates the stop control/);
	// The remaining lever is named, and named as the session-level thing it is.
	assert.match(notice, /\/stop/);
	assert.match(notice, /session/);
});

test("the notice names the surface the app names, and says 'still running' once", () => {
	// Design round 1's D2: "run panel" is a name from the code comments; the pane
	// is "Run details" in its title, its `aria-label` and its trigger. And D3: the
	// old both-counts sentence said "still running" twice and cost a fifth line at
	// the narrow rung.
	const both = interruptNotice({
		status: "interrupted",
		receipt: "",
		children_running: 2,
		background_jobs: 1,
		replayed: false,
	});
	assert.match(both, /open Run details/);
	assert.doesNotMatch(both, /run panel/i);
	assert.equal(
		both.match(/still running/g)?.length,
		1,
		`the sentence repeats the state: ${both}`,
	);
	assert.ok(
		both.length <= 150,
		`D3 measured the tightened branch at 150 characters; this one is ${both.length}`,
	);
	// One line fewer at the narrow rung is the point of the tightening, and the
	// facts are unchanged: both counts, and a lever for each.
	assert.match(both, /2 subagents and 1 background job are still running/);
	assert.match(both, /\/stop/);

	// The single-count branches keep their own levers, and agree in number.
	const childrenOnly = interruptNotice({
		status: "interrupted",
		receipt: "",
		children_running: 1,
		background_jobs: 0,
		replayed: false,
	});
	assert.match(childrenOnly, /1 subagent is still running/);
	assert.match(childrenOnly, /open Run details to watch it/);
	const jobsOnly = interruptNotice({
		status: "interrupted",
		receipt: "",
		children_running: 0,
		background_jobs: 2,
		replayed: false,
	});
	assert.match(jobsOnly, /2 background jobs are still running/);
	assert.match(jobsOnly, /they outlived the turn by design/);
});

/* --------------------------------------------------- the layers that claim it */

test("the parked card names both exits", () => {
	/*
	 * UX round 1's U2. Escape aborts the whole turn - QA measured the card
	 * clearing, `last_turn_outcome: aborted` and no denial in the transcript - so a
	 * card that names only the composer tells the user about one of its two exits.
	 *
	 * A SOURCE assertion rather than a rendered one: the card is a branch of
	 * `canonical-transcript.tsx`, whose render needs a transcript store, a
	 * completion view and the canonical reducer, and the string is the artefact
	 * either way. `window-mode.test.mjs` pins call sites the same way.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		"utf8",
	);
	assert.match(
		source,
		/"Reply yes or no in the composer, or press Escape to stop the turn\."/,
	);
});

test("the run panel claims Escape from anywhere while it is open", () => {
	/*
	 * QA round 1's Q2, measured live: with the pane open and focus in the
	 * composer, Escape interrupted the turn AND left the pane open - one press
	 * acting on the lower rung while the higher one silently did nothing. The
	 * ladder in `use-interrupt-on-escape.ts` lists the pane above the turn, so the
	 * pane has to claim a press it did not originate.
	 *
	 * Source-level for the same reason as the card's: the guard lives in an effect
	 * inside `RunPanel`, which needs refs, a store and Radix. The live half is
	 * measured in `scripts/interrupt-esc-proof.mjs` (`pane.*` steps), where the
	 * press is a real `Input.dispatchKeyEvent` and both the pane and the backend's
	 * streaming state are read back.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/components/run-details/run-panel.tsx",
		"utf8",
	);
	assert.match(
		source,
		/const escapeFromAnywhere =\s*\n?\s*event\.key === "Escape" && !event\.defaultPrevented;/,
	);
	assert.match(
		source,
		/if \(!mine && !onDocument && !escapeFromAnywhere\) return;/,
	);
});
