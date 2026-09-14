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
				MOVE_SETTLE_TIMEOUT_MS,
				moveReceiptLine,
				pendingAfterCommit,
				pendingAfterFailure,
				pendingAfterReceipt,
				pendingAfterStream,
				runMoveSession,
				transcriptRanEval,
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
	MOVE_SETTLE_TIMEOUT_MS,
	moveReceiptLine,
	pendingAfterCommit,
	pendingAfterFailure,
	pendingAfterReceipt,
	pendingAfterStream,
	runMoveSession,
	transcriptRanEval,
	errors: fixtureErrors,
} = await import(bundlePath.href);
await unlink(bundlePath);

const SESSION = "123456abcdef";
const OTHER_SESSION = "ffffffffffff";

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
	assert.deepEqual(answer?.cwd, "/Users/me/moved");
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
			cwd: "~/nope",
			note,
			evalUsed: false,
		});
		assert.equal(answer, null, "a refusal reports no receipt");
		assert.deepEqual(notes, [{ text: expected, error: true }]);
	}
});

test("a failure nobody authored is not quoted at the user", async () => {
	reset(fixtureErrors.raw);
	const answer = await runMoveSession({
		sessionId: SESSION,
		cwd: "~/moved",
		note,
		evalUsed: false,
	});
	assert.equal(answer, null);
	assert.equal(notes.length, 1);
	assert.equal(notes[0].error, true);
	assert.ok(
		!notes[0].text.includes("fetch failed"),
		`a runtime exception is not copy: ${notes[0].text}`,
	);
	assert.equal(notes[0].text, "The working directory was not changed.");
});

test("the optimistic value is dropped by a refusal and held until the stream agrees", () => {
	const committed = pendingAfterCommit(SESSION, "~/moved");
	assert.deepEqual(committed, {
		sessionId: SESSION,
		path: "~/moved",
		target: null,
	});

	// Rule 2: a refusal reverts the chip to the stream's value.
	assert.equal(pendingAfterFailure(committed, SESSION), null);

	// Rule 3: the resolved directory is what the stream has to agree with, and a
	// frame that still carries the OLD cwd is expected after a `rebound` - the
	// retiring runtime's last words name the directory it started in - so it must
	// not be read as agreement.
	const confirmed = pendingAfterReceipt(committed, SESSION, "/Users/me/moved");
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
	const mine = pendingAfterCommit(SESSION, "~/moved");
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

test("no request is issued at all without the session_move capability", () => {
	// (a) The gate is asked of the capability the feature is keyed on, and the
	// commit path returns before it can spend a round trip learning 404.
	assert.match(
		moveSource,
		/const enabled = desktopFeatureEnabled\(input\.capabilities, "session_move"\)/,
	);
	assert.match(
		moveSource,
		/if \(!enabled \|\| !sessionId\) return;/,
		"the commit path must be gated, not merely the chip's render",
	);
	// The chip's editability is the same question, asked once at the place that
	// owns the session identity.
	assert.match(
		chatPageSource,
		/desktopFeatureEnabled\(capabilities\.data, "session_move"\)/,
	);
	// And the sentence that stands in for the missing route, which is the whole
	// degradation story for an older backend.
	assert.match(
		MOVE_UNAVAILABLE_REASON,
		/^This backend cannot move a live session\./,
	);
});

test("a commit issues exactly one request", () => {
	// (b) `moveTo` is the hook's only writer of the pending latch and its only
	// await of the write path, so one commit cannot become two retirements of the
	// runtime. Counted inside the hook rather than in the module, because the
	// module legitimately has a SECOND call site: the registry's argument runner,
	// which is a one-liner over the same write path and is the reason a typed
	// `/move <path>` and the chip cannot drift apart.
	const hookBody = moveSource.slice(
		moveSource.indexOf("export function useSessionMove("),
		moveSource.indexOf("export function useSessionMoveCapability("),
	);
	assert.ok(hookBody.length > 0, "the hook body must be found to be pinned");
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
		2,
		"the module's only call sites are the chip's commit and the registry's runner",
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
		/"session\.move": \{\s*kind: "picker",\s*component: MovePicker,\s*argsBehavior: "execute",\s*runArgs: runMoveSessionFromDispatch,/,
	);
});

test("the eval latch is keyed by session, not by a bare boolean", () => {
	// (f) The TUI hit this exact bug and solved it with a set of ids: a boolean
	// carries one conversation's `eval` into the next one's receipt.
	assert.match(moveSource, /const seen = useRef<Set<string>>\(new Set\(\)\)/);
	assert.match(moveSource, /seen\.current\.has\(sessionId\)/);
	assert.match(moveSource, /seen\.current\.add\(sessionId\)/);
	assert.ok(
		!moveSource.includes("const seen = useRef(false)"),
		"a bare boolean latch is the defect this pins",
	);
});
