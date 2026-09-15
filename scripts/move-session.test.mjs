import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The desktop's `/move`: the write path, the chip's latch, and the wiring.
 *
 * What this file is for. Moving a live session is a lifecycle operation whose
 * failure modes are all QUIET: a chip that keeps naming the directory the
 * backend refused, an optimistic value that a late `frontend.update` carrying
 * the OLD cwd reverts, one session's pending value painted on another session's
 * chip, an `eval` warning claimed for a conversation that never ran eval, and a
 * move that fires against a backend with no route and calls the 404 a bug in the
 * feature. None of those break a happy path, so the happy path is not what is
 * asserted here.
 *
 * HOW EACH PART IS DRIVEN, and why they are not all driven the same way:
 *
 *   - `runMoveSession` is a plain async function, so the real one is called
 *     against a faked transport (`desktopResult`) - the only stubbed thing in
 *     this file. `userFacingMessage` and the error classes are the REAL ones,
 *     because the assertion that matters is which of them decides the sentence a
 *     user reads (a stub would let the exception's own message through and the
 *     test would agree with the bug).
 *   - the chip's latch is four pure transitions (`pendingAfter*`) plus the two
 *     effects that call them, so the transitions are exercised directly. The
 *     rules ARE those functions - that is why they are exported - and a rule that
 *     only existed inside a React effect is a rule no test could falsify.
 *   - the hook cannot be rendered here: there is no jsdom in this tree and this
 *     change is not the place to add one (the same call `scripts/ask-options.test.mjs`
 *     documents). So the three WIRING invariants that are properties of the
 *     shipped source rather than of a function - the capability gate, the single
 *     request per commit, and a typed `/move` never posting to `/commands`
 *     first - are pinned by reading the shipped files and asserting the one
 *     expression that carries each decision. Each pin says what it is pinning and
 *     what would have to come here instead of quietly dropping it.
 */

const bundle = await build({
	stdin: {
		contents: `
			export {
				MOVE_UNAVAILABLE_REASON,
				MOVE_NOT_READY_REASON,
				MOVE_SETTLE_TIMEOUT_MS,
				moveReceiptLine,
				pendingAfterCommit,
				pendingAfterFailure,
				pendingAfterReceipt,
				pendingAfterStream,
				runMoveSession,
				transcriptRanEval,
				evalLatchAfterObserving,
				evalLatchHolds,
				updatePendingMoves,
				runMoveSessionFromDispatch,
				sessionMoveEnabled,
			} from "./src/renderer/src/features/chat/move-session";
			export { errors } from "desktop-api-move-fixture";
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
	external: ["react", "react/jsx-runtime", "uuid"],
	write: false,
	plugins: [
		{
			name: "move-transport-fixture",
			setup(builder) {
				builder.onResolve({ filter: /desktop-api(-move-fixture)?$/ }, () => ({
					path: "desktop-api-move-fixture",
					namespace: "move-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "move-fixture" }, () => ({
					// Only the network is faked. `DesktopControlError`,
					// `UserFacingError` and `userFacingMessage` are the real
					// implementations, re-exported from the shipped module, and the
					// fixture errors are built from the REAL classes so the sentence a
					// user reads is decided by the shipped classifier rather than by
					// this file's imitation of it.
					contents: `export * from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
import { DesktopControlError, UserFacingError } from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)};
export const desktopResult = (request) => globalThis.__moveRequest(request);
export const errors = {
	// The session is mid-turn: the backend's own refusal, mapped from the
	// RuntimeError the viewer raises.
	busy: new DesktopControlError(409, "this session is working right now — /move again when the turn finishes"),
	// A path that is not there. One of the three MoveError sentences.
	missing: new DesktopControlError(409, "no such directory: ~/nope"),
	// The 503 ladder for a lost owner.
	unavailable: new DesktopControlError(503, "Session owner is unavailable. Reconnect and reconcile before retrying."),
	// A client-side refusal, i.e. copy this renderer authored.
	clientRefusal: new UserFacingError("Your answer was not sent. The session is reconnecting."),
	// Nothing authored it: a runtime exception whose message is not copy.
	raw: new TypeError("fetch failed"),
};`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
// Written to disk rather than imported as a data: URL, because React stays
// external here and a data: URL has no base path from which to resolve it.
const bundlePath = new URL("./_move-session.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	MOVE_UNAVAILABLE_REASON,
	MOVE_NOT_READY_REASON,
	MOVE_SETTLE_TIMEOUT_MS,
	moveReceiptLine,
	pendingAfterCommit,
	pendingAfterFailure,
	pendingAfterReceipt,
	pendingAfterStream,
	runMoveSession,
	transcriptRanEval,
	evalLatchAfterObserving,
	evalLatchHolds,
	updatePendingMoves,
	runMoveSessionFromDispatch,
	sessionMoveEnabled,
	errors: fixtureErrors,
} = await import(bundlePath.href);
await unlink(bundlePath);

const SESSION = "123456abcdef";
const OTHER_SESSION = "ffffffffffff";
const REQUEST = "12345678-1234-4234-8234-123456789abc";

/** Requests the write path issued, and the notes it posted. */
const requests = [];
const notes = [];
let nextAnswer = null;
globalThis.__moveRequest = async (request) => {
	requests.push(request);
	if (nextAnswer instanceof Error) throw nextAnswer;
	return nextAnswer;
};
const reset = (answer) => {
	requests.length = 0;
	notes.length = 0;
	nextAnswer = answer ?? null;
};
const note = (text, error = false) => {
	notes.push({ text, error });
};
/** A receipt shaped like the route's answer. */
const receipt = (overrides = {}) => ({
	cwd: "/Users/me/moved",
	label: "~/moved",
	outcome: "cold",
	will_wait: false,
	...overrides,
});

test("a successful move posts the op once, with the path as typed", async () => {
	reset(receipt());
	const answer = await runMoveSession({
		sessionId: SESSION,
		requestId: REQUEST,
		cwd: "~/moved",
		note,
		evalUsed: false,
	});
	assert.equal(requests.length, 1, "one commit is one request");
	const request = requests[0];
	assert.equal(request.op, "sessions.move");
	assert.equal(request.sessionId, SESSION);
	assert.equal(
		request.cwd,
		"~/moved",
		"the path is sent as typed: `~` and a relative path resolve against the SESSION's directory, which only the backend owns",
	);
	assert.match(
		request.requestId,
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		"the receipt key is a real uuid, because the route journals on it and replays rather than retiring twice",
	);
	assert.equal(answer.kind, "settled");
	assert.equal(answer.receipt.cwd, "/Users/me/moved");
	assert.equal(
		request.requestId,
		REQUEST,
		"the operation retains the caller's identity",
	);
	assert.deepEqual(notes, [{ text: "moved to ~/moved", error: false }]);
});

test("the receipt's four sentences, and the eval clause only when eval was used", () => {
	const rebound = receipt({ outcome: "rebound", will_wait: true });
	assert.equal(
		moveReceiptLine(rebound, false),
		"moved to ~/moved — this session's runtime is restarting there",
	);
	assert.equal(
		moveReceiptLine(rebound, true),
		"moved to ~/moved — this session's runtime is restarting there, so everything you set up in eval was lost",
	);
	assert.equal(
		moveReceiptLine(receipt({ outcome: "unchanged" }), true),
		"already in ~/moved",
	);
	// The LABEL is the backend's, and it is what is printed: a client-side `~`
	// would spell the renderer's own home for a remote backend, which is a
	// different directory with the same name.
	assert.equal(moveReceiptLine(receipt(), false), "moved to ~/moved");
});

test("a refusal is the backend's own sentence, not a generic error", async () => {
	for (const [error, expected] of [
		[
			fixtureErrors.busy,
			"this session is working right now — /move again when the turn finishes",
		],
		[fixtureErrors.missing, "no such directory: ~/nope"],
		[
			fixtureErrors.unavailable,
			"Session owner is unavailable. Reconnect and reconcile before retrying.",
		],
		[
			fixtureErrors.clientRefusal,
			"Your answer was not sent. The session is reconnecting.",
		],
	]) {
		reset(error);
		const answer = await runMoveSession({
			sessionId: SESSION,
			requestId: REQUEST,
			cwd: "~/nope",
			note,
			evalUsed: false,
		});
		assert.deepEqual(answer, { kind: "refused", sentence: expected });
		assert.deepEqual(notes, [{ text: expected, error: true }]);
	}
});

test("a failure nobody authored is not quoted at the user", async () => {
	reset(fixtureErrors.raw);
	const answer = await runMoveSession({
		sessionId: SESSION,
		requestId: REQUEST,
		cwd: "~/moved",
		note,
		evalUsed: false,
	});
	assert.deepEqual(answer, {
		kind: "refused",
		sentence: "The working directory was not changed.",
	});
	assert.equal(notes.length, 1);
	assert.equal(notes[0].error, true);
	assert.ok(
		!notes[0].text.includes("fetch failed"),
		`a runtime exception is not copy: ${notes[0].text}`,
	);
	assert.equal(notes[0].text, "The working directory was not changed.");
});

test("the optimistic value is dropped by a refusal and held until the stream agrees", () => {
	const committed = pendingAfterCommit(SESSION, REQUEST, "~/moved");
	assert.deepEqual(committed, {
		sessionId: SESSION,
		requestId: REQUEST,
		path: "~/moved",
		target: null,
	});

	// Rule 2: a refusal reverts the chip to the stream's value.
	assert.equal(pendingAfterFailure(committed, REQUEST), null);

	// Rule 3: the resolved directory is what the stream has to agree with, and a
	// frame that still carries the OLD cwd is expected after a `rebound` - the
	// retiring runtime's last words name the directory it started in - so it must
	// not be read as agreement.
	const confirmed = pendingAfterReceipt(committed, REQUEST, "/Users/me/moved");
	assert.equal(
		pendingAfterStream(confirmed, SESSION, "/Users/me/old"),
		confirmed,
	);
	assert.equal(
		pendingAfterStream(confirmed, SESSION, "~/moved"),
		confirmed,
		"the label is not comparable: only the absolute path the receipt returned settles the latch",
	);
	assert.equal(pendingAfterStream(confirmed, SESSION, undefined), confirmed);
	assert.equal(pendingAfterStream(confirmed, SESSION, "/Users/me/moved"), null);

	// Before the receipt answers there is nothing to compare against, so a frame
	// cannot settle the latch at all.
	assert.equal(pendingAfterStream(committed, SESSION, "~/moved"), committed);
	assert.ok(
		MOVE_SETTLE_TIMEOUT_MS >= 15_000,
		"the bounded wait must outlast the documented 1-3 s successor boot with room for a slow machine",
	);
});

test("a pending value belongs to ONE session", () => {
	const mine = pendingAfterCommit(SESSION, REQUEST, "~/moved");
	// A conversation switch mid-move, in both directions: the other session's
	// chip must not paint this value, and this session's refusal/frames must not
	// clear it. Keyed by id rather than a bare boolean for exactly this reason.
	assert.equal(pendingAfterFailure(mine, OTHER_SESSION), mine);
	assert.equal(pendingAfterReceipt(mine, OTHER_SESSION, "/elsewhere"), mine);
	assert.equal(
		pendingAfterStream(mine, OTHER_SESSION, "/Users/me/moved"),
		mine,
	);
	assert.equal(
		pendingAfterStream(mine, undefined, "/Users/me/moved"),
		mine,
		"a pane with no session cannot settle a value it does not own",
	);
});

test("the eval latch reads the eval TOOL row and nothing else", () => {
	assert.equal(transcriptRanEval([]), false);
	assert.equal(
		transcriptRanEval([
			{ kind: "user", id: "a", ts: 0, text: "hi" },
			{ kind: "tool", id: "b", ts: 0, toolName: "bash" },
			{ kind: "assistant", id: "c", ts: 0, text: "ok" },
		]),
		false,
		"a `bash` row says nothing about the eval kernel",
	);
	assert.equal(
		transcriptRanEval([
			{ kind: "tool", id: "b", ts: 0, toolName: "bash" },
			{ kind: "tool", id: "d", ts: 0, toolName: "eval" },
		]),
		true,
	);
	// The warning is a courtesy about THIS conversation, so a session with no
	// `eval` row must not inherit another's - see the latch's own keying in
	// `useEvalUsage`, pinned below.
});

/*
 * The three wiring invariants, pinned on the shipped source.
 *
 * These are properties of how the pieces are connected rather than of any
 * function's answer, and this tree has no DOM to render the hook in. Each
 * assertion names the expression that carries the decision so that a rewrite has
 * to come here and say what replaced it.
 */
const read = (path) => readFileSync(path, "utf8");
const moveSource = read("src/renderer/src/features/chat/move-session.ts");
const dispatchSource = read(
	"src/renderer/src/features/chat/components/slash-dispatch.ts",
);
const registrySource = read(
	"src/renderer/src/features/chat/pickers/picker-registry.tsx",
);
const chatPageSource = read(
	"src/renderer/src/features/chat/components/chat-page.tsx",
);

/*
 * The hook body, for the pins that are about `useSessionMove` alone.
 *
 * `useSessionMove` is the file's LAST export, so the body runs to the end of the
 * file. It used to be sliced up to a following `useSessionMoveCapability`,
 * which this remediation removed: `indexOf` then returned -1, `slice(from, -1)`
 * silently returned nearly the whole file, and the pins below kept passing while
 * measuring something other than the hook (agent review n1's class of defect,
 * in the one place a stale boundary is invisible).
 */
const hookBody = moveSource.slice(
	moveSource.indexOf("export function useSessionMove("),
);
assert.ok(hookBody.length > 0, "the hook body must be found to be pinned");

test("no request is issued at all without the session_move capability", () => {
	// (a) The gate is asked of the move CONTRACT - `session_move` at 2 plus the
	// `frontend_replace` frame - through the one predicate that states that pair.
	// A version-only check here would enable a move against a backend whose
	// replacement frame this renderer cannot consume, which is a move that is
	// accepted and then never painted. The commit path still returns before it can
	// spend a round trip learning 404.
	assert.match(
		moveSource,
		/const enabled = sessionMoveEnabled\(input\.capabilities\)/,
	);
	assert.match(
		moveSource,
		/desktopFeatureEnabled\(capabilities, "session_move", 2\)/,
		"the exclusivity fence is version 2, not presence",
	);
	assert.match(
		moveSource,
		/desktopFeatureEnabled\(capabilities, "frontend_replace"\)/,
		"the replacement contract is required as well as the route",
	);
	assert.match(
		moveSource,
		/if \(!enabled \|\| !sessionId\) return \{ kind: "unavailable" \};/,
		"the commit path must be gated, not merely the chip's render",
	);
	// The chip's editability is the same question, asked once at the place that
	// owns the session identity.
	assert.match(chatPageSource, /sessionMoveEnabled\(capabilities\.data\)/);
	assert.doesNotMatch(
		chatPageSource,
		/desktopFeatureEnabled\(capabilities\.data, "session_move"\)/,
		"no surface may enable a move on a weaker check than the hook's",
	);
	// And the sentence that stands in for the missing route, which is the whole
	// degradation story for an older backend.
	assert.match(
		MOVE_UNAVAILABLE_REASON,
		/^This backend cannot move a live session\./,
	);
});

test("both `/move` forms ask the pane's readiness, not the capability alone (agent review R-3, R3-3)", () => {
	/*
	 * Round 2's R-3 was that the typed `/move <path>` form consulted the capability
	 * alone, so in the admission window - the pane's `draftKey` still set while its
	 * `sessionId` is already populated - the chip beside it was read-only and
	 * explained why, while the typed form posted a move for the same session. The fix
	 * is one predicate (`moveReady`, read once as `paneReady`) asked by both forms.
	 *
	 * This is a SOURCE pin, and it is worth saying what that does and does not buy:
	 * the dispatcher is a React hook, and this file bundles `move-session.ts` alone, so
	 * what is pinned is the WIRING - that each form asks the predicate and answers with
	 * the readiness sentence rather than the capability's. The behaviour it protects is
	 * covered from the other side by the bundle tests above (`runMoveSessionFromDispatch`)
	 * and by the chip's own readiness pins. Without this, deleting the `if (!paneReady)`
	 * branch would leave every gate green while restoring the round-2 defect verbatim.
	 */
	assert.match(
		dispatchSource,
		/const paneReady = moveReady \?\? true;/,
		"the pane's readiness is read once, with one default",
	);
	assert.equal(
		(dispatchSource.match(/if \(!paneReady\) \{/g) ?? []).length,
		2,
		"the bare form and the argument form must both consult it",
	);
	assert.equal(
		(dispatchSource.match(/note\(MOVE_NOT_READY_REASON, true\);/g) ?? [])
			.length,
		2,
		"and both must answer with the readiness sentence",
	);
	/*
	 * The identity guard sits ABOVE the readiness gate in both forms, which is what
	 * makes the readiness sentence TRUE wherever it can be reached: on a pane with no
	 * session at all the user is told to start a conversation, not that a session is
	 * still starting. The window is generous on purpose - it spans the sentence the
	 * guard posts - and the count is what carries the claim.
	 */
	assert.equal(
		(dispatchSource.match(
			/if \(!sessionId\) \{[\s\S]{0,600}?if \(!paneReady\) \{/g,
		) ?? []).length,
		2,
		"identity is answered before readiness, in both forms",
	);
	assert.notEqual(
		MOVE_NOT_READY_REASON,
		MOVE_UNAVAILABLE_REASON,
		"a session that is still starting is not a backend that cannot move one",
	);
	assert.match(MOVE_NOT_READY_REASON, /still starting/);
});

test("the latch's ref is written synchronously, before the state update (agent review R3-4, F4-4)", () => {
	/*
	 * The docblock two screens above promises that a second caller in the same task
	 * sees the first one's request without waiting for React, and only the
	 * synchronous write gives that: the updater's write happens when React evaluates
	 * the updater, which is an engine detail rather than a property of `moveTo`.
	 *
	 * This is pinned because it is unpinned otherwise: deleting the five synchronous
	 * lines leaves every other test in this file green (agent review round 4, F4-4),
	 * which is how a documented invariant quietly becomes a claim about React's
	 * scheduler again.
	 */
	assert.match(
		moveSource,
		/pendingRef\.current = updatePendingMoves\(\s*pendingRef\.current,\s*sessionId,\s*\(\) => committed,?\s*\)/,
		"the ref is assigned in moveTo itself, not only inside the updater",
	);
	const syncAt = moveSource.indexOf("pendingRef.current = updatePendingMoves(");
	const setAt = moveSource.indexOf("setMoves((current) => {");
	assert.ok(
		syncAt > 0 && setAt > syncAt,
		"and it is written BEFORE the state update, which is what closes the same-task window",
	);
});

test("the chip's accessible name carries the phrase its label slot paints (R3-1, F4-5)", () => {
	/*
	 * WCAG 2.5.3 (label in name) wants the visible text inside the accessible name,
	 * and in flight the visible phrase is "Moving session:" rather than "Working
	 * directory:". The only other assertion of that lived in a story `play`, and no
	 * gate runs a `play` (agent review round 3, R3-N2) - so the two phrases are
	 * pinned against each other here, on the shipped source.
	 */
	const chip = read(
		"src/renderer/src/features/chat/components/directory-indicator.tsx",
	);
	assert.match(
		chip,
		/aria-label=\{`\$\{pending \? "Moving session" : "Working directory"\}: \$\{shown\}`\}/,
		"the name is built from the same condition the slot paints",
	);
	assert.match(
		chip,
		/\{pending \? "Moving session:" : "Working directory:"\}/,
		"and the slot paints the phrase the name carries",
	);
	/*
	 * The phrases are COMPARED rather than counted: a count moves whenever an
	 * unrelated edit adds a third mention, while what label-in-name actually needs
	 * is that the name contains the label. Both are read out of the shipped source
	 * and asked directly.
	 */
	const painted = chip.match(/\{pending \? "(Moving session:)" : "(Working directory:)"\}/);
	const named = chip.match(
		/aria-label=\{`\$\{pending \? "(Moving session)" : "(Working directory)"\}/,
	);
	assert.ok(painted && named, "both the slot and the name must be found to be compared");
	assert.equal(
		named[1],
		painted[1].replace(/:$/, ""),
		"the in-flight label the user reads is the phrase the accessible name carries",
	);
	assert.equal(named[2], painted[2].replace(/:$/, ""));
});

test("the chip re-measures its overflow when the PATH changes (agent review R-1, R3-N2)", () => {
	/*
	 * The measured-overflow tooltip's effect depends on `shown` as well as on its
	 * `ResizeObserver`, and nothing in CI could see that: the story that asserts it
	 * (`cwd-move.stories.tsx`'s `GrownPath`) asserts in `play`, `play` only runs where
	 * a story is rendered in a browser, and that story set is deliberately outside the
	 * sweep - so a revert to the empty dependency list, which is exactly what made a
	 * mounted short path keep offering the generic hint after the path grew, would have
	 * passed every gate. This pins the effect's own dependency list beside the wiring
	 * it belongs to.
	 */
	const chipSource = read(
		"src/renderer/src/features/chat/components/directory-indicator.tsx",
	);
	const observerAt = chipSource.indexOf("new ResizeObserver(measure)");
	assert.ok(observerAt > 0, "the measuring effect must be found to be pinned");
	const effect = chipSource.slice(
		chipSource.lastIndexOf("useEffect(", observerAt),
		chipSource.indexOf("]);", observerAt) + 3,
	);
	assert.match(
		effect,
		/\}, \[shown\]\);/,
		"the path is a dependency: the observer alone cannot see a new VALUE",
	);
	assert.doesNotMatch(
		effect,
		/\}, \[\]\);/,
		"the empty list is the regression this pin exists for",
	);
});

test("the move gate is decided by BEHAVIOUR, not by the source spelling", () => {
	/*
	 * QA round 2, Q1. The property "no request at all without the capability" was
	 * pinned by source patterns (`assert.match(moveSource, /desktopFeatureEnabled\(…/)`),
	 * which cannot fail if the predicate is wired to the wrong value and cannot
	 * observe a request that is not sent - QA's own zero-request result lived in a
	 * comment rather than in the repository. These are the shapes a real backend
	 * serves, including the fail-closed intermediate that is the whole reason the
	 * contract version was bumped.
	 */
	const caps = (features, available = true) => ({
		desktop_available: available,
		features,
	});
	assert.equal(
		sessionMoveEnabled(undefined),
		false,
		"no capabilities: fail closed",
	);
	assert.equal(sessionMoveEnabled(null), false);
	assert.equal(
		sessionMoveEnabled(caps({ session_move: 2, frontend_replace: 1 }, false)),
		false,
		"an unpaired backend is not a capable one",
	);
	assert.equal(sessionMoveEnabled(caps({})), false, "no keys at all");
	assert.equal(
		sessionMoveEnabled(caps({ session_move: 1, frontend_replace: 1 })),
		false,
		"version 1 is the PRE-fence contract: it would accept a move the chip now refuses to promise",
	);
	assert.equal(
		sessionMoveEnabled(caps({ session_move: 2 })),
		false,
		"the replacement frame is required as well as the route, or the move is accepted and never painted",
	);
	assert.equal(
		sessionMoveEnabled(caps({ frontend_replace: 1 })),
		false,
		"and the route is required as well as the frame",
	);
	assert.equal(
		sessionMoveEnabled(caps({ session_move: 2, frontend_replace: 1 })),
		true,
		"the pair this renderer implements",
	);
});

test("a commit issues exactly one request", () => {
	// (b) `moveTo` is the hook's only writer of the pending latch and its only
	// await of the write path, so one commit cannot become two retirements of the
	// runtime. Both the chip and the typed command use this controller: a second
	// raw transport caller would bypass its one-operation-per-settle latch.
	assert.doesNotMatch(
		moveSource,
		/useSessionMoveCapability/,
		"the removed capability hook must not be referenced by source or by this pin",
	);
	assert.equal(
		(hookBody.match(/await runMoveSession\(/g) ?? []).length,
		1,
		"the hook must call the write path exactly once",
	);
	assert.equal(
		(hookBody.match(/pendingAfterCommit\(/g) ?? []).length,
		1,
		"one commit is one latch transition",
	);
	assert.equal(
		(moveSource.match(/await runMoveSession\(/g) ?? []).length,
		1,
		"the shared session controller is the only raw move transport caller",
	);
});

test("a typed /move runs its argument without posting to /commands first", () => {
	// (e) The execute branch must sit BEFORE the command post: the whole point is
	// that a path is never handed to the runtime's slash dispatcher, which would
	// answer `move` with its "run it from a terminal" refusal - a false statement
	// about a command this surface can run.
	const executeBranch = dispatchSource.indexOf(
		'entry.argsBehavior === "execute"',
	);
	const commandPost = dispatchSource.indexOf('op: "sessions.command"');
	assert.ok(executeBranch > -1, "the execute branch must exist");
	assert.ok(commandPost > -1, "the command post must still exist");
	assert.ok(
		executeBranch < commandPost,
		"the execute branch must precede the command post, or `/move <path>` posts to /commands first",
	);
	assert.match(dispatchSource, /if \(!canMove\) \{/);
	assert.match(dispatchSource, /note\(MOVE_UNAVAILABLE_REASON, true\)/);
});

test("the destination table keys the move on the backend's own destination name", () => {
	// The seam between the two repositories: the backend presents `/move` as
	// `native_action(destination="session.move")`, and this table is the
	// renderer's answer for it. A rename on either side has to fail here rather
	// than render nothing when a user types `/move`.
	assert.match(
		registrySource,
		/"session\.move": \{\s*kind: "direct",\s*action: "focus-cwd-chip",\s*argsBehavior: "execute",\s*runArgs: runMoveSessionFromDispatch,/,
	);
});

test("stale request receipts and failures cannot settle a newer move", () => {
	const newer = pendingAfterCommit(SESSION, "new-request", "~/new");
	assert.equal(pendingAfterReceipt(newer, REQUEST, "/old"), newer);
	assert.equal(pendingAfterFailure(newer, REQUEST), newer);
	const confirmed = pendingAfterReceipt(newer, "new-request", "/new", 1000);
	assert.equal(confirmed.settleBy, 1000 + MOVE_SETTLE_TIMEOUT_MS);
	assert.equal(
		pendingAfterReceipt(confirmed, "new-request", "/new", 9000).settleBy,
		confirmed.settleBy,
	);
	assert.equal(pendingAfterStream(confirmed, SESSION, "/new"), null);
});

test("two pending sessions retain independent identities and original deadlines", () => {
	const a = pendingAfterReceipt(
		pendingAfterCommit(SESSION, REQUEST, "~/a"),
		REQUEST,
		"/a",
		1000,
	);
	const b = pendingAfterCommit(OTHER_SESSION, "request-b", "~/b");
	const moves = new Map([
		[SESSION, a],
		[OTHER_SESSION, b],
	]);
	const unchanged = updatePendingMoves(moves, SESSION, (value) =>
		pendingAfterFailure(value, "stale"),
	);
	assert.equal(unchanged, moves);
	const completedB = updatePendingMoves(moves, OTHER_SESSION, (value) =>
		pendingAfterFailure(value, "request-b"),
	);
	assert.equal(completedB.size, 1);
	assert.equal(completedB.get(SESSION), a);
	assert.equal(completedB.get(SESSION).settleBy, 1000 + MOVE_SETTLE_TIMEOUT_MS);
	assert.equal(
		moves.size,
		2,
		"updates must not mutate the previous React state",
	);
});

test("typed move uses the composer's controller instead of a second transport path", async () => {
	reset();
	const paths = [];
	await runMoveSessionFromDispatch({
		cwd: "../next",
		note,
		moveTo: async (path) => {
			paths.push(path);
			return { kind: "in-flight" };
		},
	});
	assert.deepEqual(paths, ["../next"]);
	assert.equal(requests.length, 0);
	assert.deepEqual(notes, [
		{ text: "A working-directory move is already in progress.", error: true },
	]);
});

test("the eval latch belongs to each session and survives transcript paging", () => {
	const original = new Set();
	const seen = evalLatchAfterObserving(original, SESSION, [
		{ kind: "tool", toolName: "eval" },
	]);
	assert.equal(original.size, 0, "latch updates are immutable");
	assert.equal(evalLatchHolds(seen, SESSION), true);
	assert.equal(evalLatchHolds(seen, OTHER_SESSION), false);
	assert.equal(evalLatchHolds(seen, undefined), false);
	assert.equal(evalLatchAfterObserving(seen, SESSION, []), seen);
	assert.equal(
		evalLatchAfterObserving(seen, OTHER_SESSION, [
			{ kind: "tool", toolName: "bash" },
		]),
		seen,
	);
});

test("the hook stores and reads the latch through the keyed predicate", () => {
	/*
	 * Agent review n1: this used to be pinned by a single source regex -
	 * `!includes("const seen = useRef(false)")` - which a `useState(false)` or
	 * `useRef<boolean>(false)` rewrite sailed straight past. The behavioural half
	 * above proves WHAT the latch answers; this pins that the hook actually asks
	 * that predicate rather than a boolean of its own, and the negative covers
	 * every spelling of the bare boolean in one go.
	 */
	assert.match(moveSource, /useRef<EvalLatch>\(EMPTY_EVAL_LATCH\)/);
	assert.match(
		moveSource,
		/evalLatchAfterObserving\(latch\.current, sessionId, records\)/,
	);
	assert.match(
		moveSource,
		/return evalLatchHolds\(latch\.current, sessionId\)/,
	);
	/*
	 * The negative is scoped to the HOOK BODY, not the file: the module's own
	 * docblock names the old `useState(false)` spelling when it explains what
	 * this latch replaced, and a file-wide regex would fail on that prose
	 * rather than on code.
	 */
	assert.doesNotMatch(
		hookBody,
		/use(?:Ref|State)(?:<boolean>)?\(false\)/,
		"a branch-global boolean cannot key a per-session latch",
	);
});
