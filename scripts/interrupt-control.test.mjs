import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
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
const bundlePath = new URL(
	"./_interrupt-control.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	interruptNotice,
	interruptTurn,
	sessionInterruptEnabled,
	dispatchInterruptOnEscape,
	ESCAPE_OWNING_FIELDS,
	interruptEscapeApplies,
	ownsEscapeOutsideComposer,
	COMPOSER_TEXTAREA_SELECTOR,
} = await import(bundlePath.href);
await unlink(bundlePath);

const requests = [];
globalThis.__interruptRequest = async (request) => {
	requests.push(request);
	return { status: "interrupted", receipt: "", children_running: 0, background_jobs: 0 };
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
	assert.match(children, /run panel/);
	assert.match(children, /\/stop/);
	assert.doesNotMatch(children, /background/);

	const jobs = notice(0, 1);
	assert.match(jobs, /1 background job is still running/);
	assert.match(jobs, /\/stop/);

	const both = notice(3, 2);
	assert.match(both, /3 subagents are still running, and 2 background jobs/);

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
