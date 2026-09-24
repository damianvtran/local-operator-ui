import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The aside panel's logic, at the two levels a node test can reach: the store's
 * reducer rules driven through the REAL module, and the ask/adopt/close
 * transactions driven through the shipped functions against a stubbed transport.
 *
 * WHY THIS FILE EXISTS. The panel is fed by a live-only SSE chunk
 * (`aside_delta`) whose two safety properties are invisible on screen: a chunk
 * that arrives after the POST settled must not be appended (or the answer shows
 * a duplicated tail), and the POST's returned text must REPLACE whatever
 * accumulated (which is what makes a dropped chunk cost nothing). Both are
 * properties of a sequence of events, and a still or a live click cannot produce
 * one. The gates the panel paints - the adopt chord, its readiness and its
 * refusal sentence - are pure functions, and the repo's own reason for writing
 * them as functions is that nothing else can reach them.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT COVER, and where that evidence lives:
 * the composer's own routing (Enter -> the aside rather than the thread) is a
 * behaviour of the composer, whose module graph reads `import.meta.env` at import
 * time and cannot be mounted in a node test; `scripts/desktop-stream.test.mjs`
 * owns the frame contract, and the coordinator's driven run owns the live path.
 * What is asserted here about the panel's WIRING is source-level and says so.
 *
 * `zustand/middleware` reaches for localStorage at import time in this tree;
 * this store uses none of it, but the bundle pulls the module graph the store
 * lives in, so the stand-in is cheap insurance rather than decoration.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/*
 * The transport, recorded rather than answered by the module: `desktopResult` is
 * the network and nothing else, which is the same seam `frontend-replace.test.mjs`
 * stubs. Each request is pushed so a test can assert what the panel SENT, and the
 * handler is swappable per test.
 */
const calls = [];
let handler = async () => ({ data: {} });
globalThis.__asideRequest = async (request) => {
	calls.push(request);
	return handler(request);
};

/*
 * The esbuild plugin's own filter literals, hoisted for the same reason the
 * assertion regexes below are (see their block): a literal built inside a
 * function is what this tree's `useTopLevelRegex` rule charges.
 */
const RE_DESKTOP_API_IMPORT = /local-operator\/desktop-api$/;
const RE_ANY_MODULE = /.*/;

const bundle = await build({
	stdin: {
		contents: `
			export {
				useAsideStore,
				applyAsideDelta,
				asideTurnIsCarried,
				beginAsideStream,
				settledAsideStream,
				failedAsideStream,
				previousAsideId,
				lastAsideTurn,
				lastAsideStream,
				lastAnsweredAsideId,
			} from "./src/renderer/src/shared/store/aside-store";
			export {
				askAside,
				adoptAside,
				closeAside,
				openAsidePanel,
				asideAskFailure,
				asidePanelRefusal,
				asideOffPanelRefusal,
				asideQuotedQuestion,
				asideAskBlockedReason,
				asideScrollToTurn,
				asideAnnouncement,
				ASIDE_ASK_BUSY,
				ASIDE_CONTINUATION_ESCAPE,
				reportUncarriedAsideRefusal,
				asideAdoptChord,
				asideAdoptCap,
				asideAdoptReady,
				asideAdoptBlockedReason,
			} from "./src/renderer/src/features/chat/aside";
			/*
			   The canonical hook rides this bundle because adoptAside re-reads the
			   session after the op (round 2, Q2): the resync registry the fix is
			   driven through, and the view-batch rule F8 moved from a source-text
			   assertion to a value assertion. Both are the REAL registries - a
			   recorder standing in for either would pass on a fix that never fires.
			*/
			export {
				__registerCanonicalResync,
				resyncCanonicalSession,
				batchMovesView,
			} from "./src/renderer/src/shared/hooks/use-canonical-session";
			/* The stub's OWN error class, so the instanceof check in the stub's
			   userFacingMessage below is the shipped rule and not a second spelling. */
			export { DesktopControlError } from
				"@shared/api/local-operator/desktop-api";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "aside-transport-fixture",
			setup(builder) {
				builder.onResolve({ filter: RE_DESKTOP_API_IMPORT }, () => ({
					path: "transport",
					namespace: "aside-fixture",
				}));
				builder.onLoad(
					{ filter: RE_ANY_MODULE, namespace: "aside-fixture" },
					() => ({
						// Only the network is faked. `userFacingMessage` keeps the real
						// judgement in spirit: a `DesktopControlError` is copy (the backend's
						// own sentence), anything else is not. The class carries the two
						// fields the REAL one carries (`desktop-api.ts`), because the
						// subscription-id compatibility retry keys on the response's own
						// status and sentence rather than on the message alone.
						contents: `
						export class DesktopControlError extends Error {
							constructor(status, message, cause, code) {
								super(message);
								this.name = "DesktopControlError";
								this.status = status;
								this.cause = cause;
								this.code = code;
							}
						}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error, fallback) =>
							error instanceof DesktopControlError || error instanceof UserFacingError
								? String(error.message || fallback)
								: fallback;
						export const desktopResult = (request) => globalThis.__asideRequest(request);
						/*
						 * The canonical hook's own transport seam, which this bundle now pulls in.
						 * Nothing calls it here: the hook is never MOUNTED in a node test, and the
						 * one thing the tests drive — the resync registry — is a plain map.
						 */
						export const subscribeDesktopStream = () => () => {};`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});

/*
 * THE COMPOSER'S PURE RULES, in their OWN bundle, through the real module.
 *
 * `use-message-input` reaches the canonical-session hook, so it cannot share the
 * aside bundle above: that one replaces the whole desktop-api module with the
 * transport fixture, while the composer's own graph takes the api itself. Built
 * with the real module and `import.meta.env` defined, which is all it needs to
 * load in node - and nothing in it is CALLED, so the real transport is never
 * reached. The rules under test are exported precisely so they can be asserted
 * without mounting the composer (`clearSubmittedText`'s own note).
 */
const composerBundle = await build({
	stdin: {
		contents: `
			export {
				clearSubmittedText,
				recordsSubmittedMessage,
				isOffRecordAsk,
				settleOffRecordPayload,
				SEND_HELD,
			} from "./src/renderer/src/shared/hooks/use-message-input";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	define: { "import.meta.env": "{}" },
});

const {
	useAsideStore,
	applyAsideDelta,
	asideTurnIsCarried,
	beginAsideStream,
	settledAsideStream,
	failedAsideStream,
	previousAsideId,
	lastAsideTurn,
	lastAsideStream,
	lastAnsweredAsideId,
	askAside,
	adoptAside,
	closeAside,
	openAsidePanel,
	asideAskFailure,
	asidePanelRefusal,
	asideOffPanelRefusal,
	asideQuotedQuestion,
	asideAskBlockedReason,
	asideScrollToTurn,
	asideAnnouncement,
	ASIDE_ASK_BUSY,
	ASIDE_CONTINUATION_ESCAPE,
	reportUncarriedAsideRefusal,
	asideAdoptChord,
	asideAdoptCap,
	asideAdoptReady,
	asideAdoptBlockedReason,
	__registerCanonicalResync,
	resyncCanonicalSession,
	batchMovesView,
	DesktopControlError,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const {
	clearSubmittedText,
	recordsSubmittedMessage,
	isOffRecordAsk,
	settleOffRecordPayload,
	SEND_HELD,
} = await import(
	`data:text/javascript;base64,${Buffer.from(composerBundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The assertions' own regex literals, HOISTED to the top level: this tree's
 * `useTopLevelRegex` rule charges a literal constructed inside a function, and
 * `scripts/` sits outside `pnpm lint`'s path list, so `pnpm lint:scripts` (which
 * compares each changed file against its base) is the only gate that would have
 * said so — the same shape `canonical-chat.test.mjs` records at its own top.
 */
const RE_ADOPT_SESSION_WORKING = /would splice a message into a live turn/;
/*
 * The two short reasons are asserted as whole strings rather than matched, so the
 * COPY is pinned and not merely a fragment of it: the point of the design round's
 * D2 is that each line carries one fact, and a regex over a substring would pass
 * against the sentence that carried three.
 */
const NO_EXCHANGE_REASON = "Nothing to add yet.";
const NOTHING_TO_ADD_REASON = "Nothing to add.";
/*
 * The wait is derived from the flag the paint uses, so its sentence describes the
 * SETTLING and not the answer's arrival - `Wait for the answer` is what printed
 * underneath an answer that had already arrived (design round 1, D3).
 */
const SETTLING_REASON =
	"The exchange is still settling — a moment before it can be added.";
const RE_ASIDE_RECEIPT =
	/Receipt<"aside_delta", \{ aside_id: string; delta: string \}>/;
const RE_ASIDE_EVENT = /Event<"aside_delta"/;
const RE_ASIDE_DELTA = /aside_delta/;
const RE_ROUTE_DELTA = /applyAsideDelta\(frame\.payload\.aside_id/;
const RE_ROUTE_DELTAS = /applyAsideDeltas\(frames\)/;
/*
 * The view-batch rule (round 1, F5): the one line that turns "this batch paints
 * nothing" into a non-render. The CLASSIFICATION it rests on used to be asserted
 * here as source text, which passed with the condition flipped, with an `||` for
 * the `&&`, or with a third inert type added - so `batchMovesView` is exported
 * and driven by value instead (see the classification test); this regex pins the
 * bail-out itself, which is one line inside an effect no node test can mount.
 */
const RE_VIEW_BATCH_BAILOUT =
	/if \(!batchMovesView\(frames\)\) return current;/;
/*
 * The pairing contract (round 1, PAIRING CHANGE): the op carries the asking
 * viewer's subscription id and the request body names it, because the answer's
 * chunks are published on a stream every attached viewer reads.
 */
const RE_ASIDE_OP_SUBSCRIPTION =
	/subscriptionId: z\.string\(\)\.regex\(SUBSCRIPTION_ID_PATTERN\)\.optional\(\),/;
const RE_ASIDE_BODY_SUBSCRIPTION = /subscription_id: request\.subscriptionId,/;
/*
 * The aside ask leaves the composer WITHOUT BEING AWAITED (round 1, F1). Awaiting
 * it held the box's clear and the composer's `admitting` state for the whole POST,
 * so a question visibly being answered above sat in the box and a follow-up typed
 * meanwhile was concatenated onto it by the next Enter.
 *
 * What it RETURNS is the off-record outcome, which carries the ask's own promise
 * (round 2, F6) - not awaited, and not the promise itself, which the submit would
 * await have held the same way.
 */
const RE_ASIDE_FIRE_AND_FORGET = /const ask = askAside\(/;
const RE_ASIDE_AWAITED = /await askAside\(/;
const RE_ASIDE_OUTCOME = /return \{ offRecord: ask \};/;
/*
 * What a `open` frame hands the renderer is what the ask must name, so the id's
 * origin is asserted rather than assumed: the routing fix is only correct if the
 * value sent with the ask is the stream's own subscription id.
 */
const RE_SUBSCRIPTION_IN_FRAME = /subscription_id/;
/*
 * The panel's own round-1 fixes: the live region (F4), the cap derived from the
 * answer's line box rather than chosen as 240px (D1), and the disabled control's
 * reason still present so the gate keeps saying why (D2).
 */
const RE_PANEL_LIVE_REGION = /<output className="sr-only" aria-live="polite">/;
const RE_PANEL_CAP_DERIVED = /asideExchangeCap/;
const RE_PANEL_CAP_SELECTOR = /max-h-\[240px\]/;
const RE_PANEL_LABEL = /aria-labelledby=\{titleId\}/;
const RE_MODAL_MARKS = /role="dialog"|role="alertdialog"|aria-modal/;
const RE_DIALOG_IMPORTS = /picker-host|ui\/dialog|ui\/sheet|ui\/popover/;
const RE_PANEL_MOUNT = /<AsidePanel/;
const RE_PANEL_GATE = /asideSessionId && aside !== null/;
const RE_DESTINATION = /"session\.aside": \{ kind: "aside" \}/;
const RE_OLD_PICKER = /AsidePicker/;
const RE_DISPATCH_ASIDE = /if \(entry\?\.kind === "aside"\)/;
/*
 * The command door asks with the SAME subscription id the composer does (round 1,
 * PAIRING CHANGE): the one-Enter path is the door this branch exists for, so an
 * ask that named no subscription would leave the frame that streams the answer
 * unreachable from exactly the surface the feature is about.
 */
const RE_DISPATCH_ASK =
	/askAside\(\s*sessionId,\s*args,\s*canonical\.subscriptionId/;
const RE_DISPATCH_OPEN = /openAsidePanel\(sessionId\)/;
/*
 * Both doors hand a refusal the panel cannot state to the SAME rule (round 3,
 * F9), and neither swallows one: the command door used to end its ask in an
 * empty `.catch(() => {})`.
 */
const RE_DISPATCH_REPORTS_UNCARRIED =
	/reportUncarriedAsideRefusal\(ask, sessionId, \(sentence\) =>\s*note\(sentence, true\)/;
/*
 * The composer's door reports through its own error line — and since round 4 it
 * hands the reporter a PAIR of writes rather than the setter itself, because a
 * refusal about an aside must also carry the code that withholds the composer's
 * generic "Send it again" (UX round 1, U4). The pin follows the code, not just the
 * closure, so a revert to the bare setter fails here.
 */
const RE_PAGE_REPORTS_UNCARRIED =
	/reportUncarriedAsideRefusal\(ask, sessionId, \(sentence\) => \{\s*setSendError\(sentence\);\s*setSendErrorCode\(ASIDE_NOT_ANSWERED_CODE\);/;
const RE_SWALLOWED_REFUSAL = /\.catch\(\(\) => \{\}\)/;

/*
 * ROUND 4'S OWN WIRING (agent review F12; UX round 1 U1/U2/U4-U7; design round 2
 * D6-D8/D10). The panel, the composer and the dispatcher are components and hooks
 * this harness cannot mount (this file's header), so the rules they apply are
 * asserted by VALUE above and the lines that APPLY them are pinned here — the same
 * split the file's other wiring pins use, and the reason each pin names the call
 * it is looking for rather than a bare identifier that a rename would satisfy.
 */
const RE_PAGE_ASIDE_BUSY_GATE =
	/const busy = asideAskBlockedReason\(useAsideStore\.getState\(\), sessionId\);\s*if \(busy\) \{\s*setSendError\(busy\);\s*return false;/;
const RE_DISPATCH_ASIDE_BUSY_GATE =
	/const busy = asideAskBlockedReason\(\s*useAsideStore\.getState\(\),\s*sessionId,\s*\);\s*if \(busy\) \{\s*note\(busy, true\);\s*return "retained";/;
const RE_PAGE_CLEARS_ASIDE_REFUSAL =
	/clearAsideRefusal: \(\) => \{\s*setSendError\(null\);\s*setSendErrorCode\(undefined\);/;
const RE_DISPATCH_CLEARS_ASIDE_REFUSAL = /clearAsideRefusal\?\.\(\);/;
const RE_PANEL_RETURNS_FOCUS = /onReturnFocus\?\.\(\)/g;
const RE_PANEL_DESCRIBED_BY =
	/aria-describedby=\{blocked !== null \? blockedId : undefined\}/;
const RE_PANEL_REASON_ID = /<p id=\{blockedId\}/;
const RE_SEND_VERB = /aside !== null \? "Ask the aside" : "Send message"/;
const RE_PANEL_CAP_COUNTS_QUESTION =
	/var\(--text-body-sm\) \* \$\{ASIDE_QUESTION_LINE_HEIGHT\}/;
const RE_PANEL_SCROLLS_TO_TURN = /region\.scrollTop = asideScrollToTurn\(\{/;
const RE_PANEL_SCROLLS_ONCE =
	/if \(scrolledTurn\.current === lastTurnId\) return;/;
const RE_PANEL_REGION_FOCUSABLE =
	/tabIndex=\{0\}\s+aria-label="The aside exchange"/;
/*
 * F11's effect trigger, pinned by F12: `retireRequest` is bumped by
 * `retireAcceptedPayload` and read by the effect's dependency list, and only those
 * two lines make an aside's answer retire the box's payload in its own commit.
 * Neither the bump nor the dependency is otherwise observable from here — the
 * mutation that removes the dependency leaves every other test green (review round
 * 4, M3) — so the pair is asserted literally, and the OLD dependency list is
 * asserted absent so a partial revert cannot satisfy both.
 */
const RE_RETIRE_REQUEST_BUMP =
	/setRetireRequest\(\(request\) => request \+ 1\);/;
const RE_RETIRE_REQUEST_TRIGGER = /\}, \[newMessage, retireRequest\]\);/;

const SESSION = "session-aside-1";
const OTHER_SESSION = "session-aside-2";

const reset = () => {
	calls.length = 0;
	handler = async () => ({ data: {} });
	useAsideStore.setState({ streams: {}, attached: {} });
};

/* ------------------------------------------------------------------ the store */

test("a chunk appends while the turn is live and is refused once it is not", () => {
	const open = beginAsideStream();
	assert.equal(applyAsideDelta(open, "a").text, "a");
	assert.equal(applyAsideDelta(applyAsideDelta(open, "a"), "b").text, "ab");
	assert.equal(applyAsideDelta(open, "a").streaming, true);
	/*
	 * THE THREE REFUSALS. An unknown id would otherwise open an entry no surface
	 * reads; a settled turn already holds the authoritative answer, so appending
	 * would duplicate that chunk's text; a failed one has nothing to append to.
	 */
	assert.equal(applyAsideDelta(undefined, "x"), undefined);
	assert.equal(applyAsideDelta(settledAsideStream("done"), "x"), undefined);
	assert.equal(
		applyAsideDelta(failedAsideStream(undefined, "no"), "x"),
		undefined,
	);
});

test("the response settles the turn and replaces the accumulated chunks", () => {
	reset();
	const store = useAsideStore.getState();
	store.beginAsk(SESSION, "id-1", "why is this slow?");
	store.applyAsideDelta("id-1", "par");
	store.applyAsideDelta("id-1", "tial");
	assert.deepEqual(useAsideStore.getState().streams["id-1"], {
		text: "partial",
		streaming: true,
		settled: false,
		error: null,
	});

	// The authoritative text arrives with a chunk the store never saw: the text is
	// the response's, not the concatenation of what happened to be delivered.
	store.settleAside("id-1", "partial and then the rest");
	assert.deepEqual(useAsideStore.getState().streams["id-1"], {
		text: "partial and then the rest",
		streaming: false,
		settled: true,
		error: null,
	});

	// A duplicate or late chunk cannot corrupt a settled answer.
	store.applyAsideDelta("id-1", " the rest");
	assert.equal(
		useAsideStore.getState().streams["id-1"].text,
		"partial and then the rest",
	);
});

test("a continuation keeps the exchange, and the prefix is the last turn", () => {
	reset();
	const store = useAsideStore.getState();
	store.beginAsk(SESSION, "id-1", "first");
	store.settleAside("id-1", "answer one");
	store.beginAsk(SESSION, "id-2", "second");
	assert.deepEqual(
		useAsideStore
			.getState()
			.attached[SESSION].turns.map((turn) => turn.asideId),
		["id-1", "id-2"],
	);
	assert.equal(previousAsideId(useAsideStore.getState(), SESSION), "id-2");
	assert.equal(
		previousAsideId(useAsideStore.getState(), OTHER_SESSION),
		undefined,
	);
	// The earlier answer stays readable: the panel paints the exchange, and the
	// answers are not copied onto the attachment.
	assert.equal(useAsideStore.getState().streams["id-1"].text, "answer one");
});

test("a failure keeps the part that arrived and records the reason", () => {
	reset();
	const store = useAsideStore.getState();
	store.beginAsk(SESSION, "id-1", "q");
	store.applyAsideDelta("id-1", "half an ans");
	store.failAside("id-1", "The aside was not answered.");
	assert.deepEqual(useAsideStore.getState().streams["id-1"], {
		text: "half an ans",
		streaming: false,
		settled: false,
		error: "The aside was not answered.",
	});
	// And an id nobody registered is left alone rather than materialised.
	store.failAside("nobody", "x");
	assert.equal(useAsideStore.getState().streams.nobody, undefined);
});

test("closing drops the attachment and every answer it was holding", () => {
	reset();
	const store = useAsideStore.getState();
	store.beginAsk(SESSION, "id-1", "first");
	store.beginAsk(SESSION, "id-2", "second");
	store.detachAside(SESSION);
	assert.deepEqual(useAsideStore.getState().attached[SESSION], undefined);
	assert.deepEqual(useAsideStore.getState().streams, {});
	// A chunk that outlives the panel lands nowhere rather than reopening an entry.
	store.applyAsideDelta("id-2", "late");
	assert.deepEqual(useAsideStore.getState().streams, {});
});

test("a bare /btw attaches an empty panel and does not clear an open one", () => {
	reset();
	openAsidePanel(SESSION);
	assert.deepEqual(useAsideStore.getState().attached[SESSION], {
		turns: [],
		notice: null,
	});
	useAsideStore.getState().beginAsk(SESSION, "id-1", "first");
	useAsideStore.getState().setAsideNotice(SESSION, "refused");
	// Re-opening must keep the exchange the user is looking at, and may clear the
	// refusal sentence, which answered the ask before this press.
	openAsidePanel(SESSION);
	assert.equal(useAsideStore.getState().attached[SESSION].turns.length, 1);
	assert.equal(useAsideStore.getState().attached[SESSION].notice, null);
	assert.equal(useAsideStore.getState().streams["id-1"].text, "");
});

/* --------------------------------------------------------------- the asks */

test("asking registers the turn BEFORE the request leaves, and settles on the response", async () => {
	reset();
	let seenAtRequest = null;
	handler = async (request) => {
		// The panel subscribes to its own id, so the entry has to exist before the
		// response does — otherwise the first `aside_delta` lands nowhere.
		seenAtRequest = useAsideStore.getState().streams[request.requestId];
		return {
			data: {
				aside_id: request.requestId,
				text: "the answer",
				off_record: true,
			},
		};
	};

	const asideId = await askAside(SESSION, "why is this slow?");
	assert.deepEqual(seenAtRequest, {
		text: "",
		streaming: true,
		settled: false,
		error: null,
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].op, "sessions.aside");
	assert.equal(calls[0].sessionId, SESSION);
	assert.equal(calls[0].text, "why is this slow?");
	// The first ask carries no prefix: there is no exchange to continue.
	assert.equal(calls[0].asideId, undefined);
	assert.equal(useAsideStore.getState().streams[asideId].text, "the answer");
	assert.equal(useAsideStore.getState().streams[asideId].settled, true);

	// The follow-up continues the same exchange, BY the id the store holds.
	await askAside(SESSION, "and what resets it?");
	assert.equal(calls[1].asideId, asideId);
});

test("a refused ask is recorded on its own turn and re-thrown", async () => {
	reset();
	handler = async () => {
		throw new DesktopControlError(
			null,
			"Close an aside or wait for it to expire",
		);
	};
	await assert.rejects(() => askAside(SESSION, "q"));
	const stream =
		useAsideStore.getState().streams[
			Object.keys(useAsideStore.getState().streams)[0]
		];
	assert.equal(stream.error, "Close an aside or wait for it to expire");
	assert.equal(stream.streaming, false);
	assert.equal(stream.settled, false);
	// The refusal is a fact about the panel, not a reason to lose the exchange.
	assert.equal(useAsideStore.getState().attached[SESSION].turns.length, 1);
});

/* -------------------------------------------------------------- adopting */

test("adopting posts the confirmed op for the LAST turn and detaches on success", async () => {
	reset();
	handler = async (request) =>
		request.op === "sessions.adopt"
			? { data: { aside_id: request.asideId, status: "adopted" } }
			: {
					data: { aside_id: request.requestId, text: "one", off_record: true },
				};
	const first = await askAside(SESSION, "a");
	const second = await askAside(SESSION, "b");
	assert.notEqual(first, second);

	await adoptAside(SESSION);
	const adopt = calls.at(-1);
	assert.equal(adopt.op, "sessions.adopt");
	assert.equal(adopt.confirmed, true);
	// The turn the backend can actually promote is the latest one: a continuation
	// marks its predecessor adopted, so the exchange lives under the new id.
	assert.equal(adopt.asideId, second);
	// The panel is gone on success: the rows are the receipt.
	assert.equal(useAsideStore.getState().attached[SESSION], undefined);
});

test("a refused adopt states itself on the panel and leaves it open", async () => {
	reset();
	handler = async (request) =>
		request.op === "sessions.adopt"
			? Promise.reject(
					new DesktopControlError(null, "This aside cannot be adopted"),
				)
			: {
					data: { aside_id: request.requestId, text: "one", off_record: true },
				};
	await askAside(SESSION, "a");
	await assert.rejects(() => adoptAside(SESSION));
	assert.equal(
		useAsideStore.getState().attached[SESSION].notice,
		"This aside cannot be adopted",
	);
	assert.equal(useAsideStore.getState().attached[SESSION].turns.length, 1);
});

/* --------------------------------------------------------------- closing */

test("closing releases the exchange and detaches even when the release is refused", async () => {
	reset();
	handler = async (request) =>
		request.op === "sessions.aside.close"
			? Promise.reject(
					new DesktopControlError(null, "Wait for the aside to finish"),
				)
			: {
					data: { aside_id: request.requestId, text: "one", off_record: true },
				};
	const asideId = await askAside(SESSION, "a");
	closeAside(SESSION);
	const close = calls.at(-1);
	assert.equal(close.op, "sessions.aside.close");
	assert.equal(close.asideId, asideId);

	// The DELETE is fire-and-forget; its rejection is the ordinary 409 race and must
	// not paint an error on a panel the user has just dismissed.
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(useAsideStore.getState().attached[SESSION], undefined);
	assert.deepEqual(useAsideStore.getState().streams, {});
});

/* ------------------------------------------------------------- the gates */

test("the chord is the app's modifier plus f, and nothing else", () => {
	const press = (over) => ({
		key: "f",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...over,
	});
	assert.equal(asideAdoptChord(press({ metaKey: true })), true);
	assert.equal(asideAdoptChord(press({ ctrlKey: true })), true);
	// Shift/alt are other apps' chords; a held key would adopt twice; an IME owns
	// its own presses; and a layer that already answered must not be overruled.
	assert.equal(
		asideAdoptChord(press({ metaKey: true, shiftKey: true })),
		false,
	);
	assert.equal(asideAdoptChord(press({ metaKey: true, altKey: true })), false);
	assert.equal(asideAdoptChord(press({ metaKey: true, repeat: true })), false);
	assert.equal(
		asideAdoptChord(press({ metaKey: true, isComposing: true })),
		false,
	);
	assert.equal(
		asideAdoptChord(press({ metaKey: true, defaultPrevented: true })),
		false,
	);
	assert.equal(asideAdoptChord(press({ metaKey: true, key: "g" })), false);
	assert.equal(asideAdoptChord(press()), false);
	assert.equal(asideAdoptCap(true), "⌘+F");
	assert.equal(asideAdoptCap(false), "Ctrl+F");
});

test("the adopt gate needs a settled answer and an idle session", () => {
	const settled = settledAsideStream("an answer");
	assert.equal(asideAdoptReady(settled, false), true);
	assert.equal(asideAdoptBlockedReason(settled, false), null);

	// The TUI's first term: nothing answered yet.
	assert.equal(asideAdoptReady(beginAsideStream(), false), false);
	assert.equal(
		asideAdoptBlockedReason(beginAsideStream(), false),
		SETTLING_REASON,
	);
	/*
	 * THE SENTENCE IS DERIVED FROM THE FLAG THE PAINT USES (round 1, D3). An
	 * answer's deltas finish painting about 0.6s before the POST returns, so a
	 * stream that holds the COMPLETE answer and is still `streaming` must not be
	 * told the answer has not arrived - which is what "Wait for the answer before
	 * adding this to the conversation" said underneath that complete answer. The
	 * wait is stated, the arrival is not, and the CONTROL stays on `settled`.
	 */
	const painted = applyAsideDelta(beginAsideStream(), "an answer");
	assert.equal(painted.settled, false);
	assert.equal(asideAdoptReady(painted, false), false);
	assert.equal(asideAdoptBlockedReason(painted, false), SETTLING_REASON);
	// The TUI's second: splicing a message into a live batch is a request no
	// provider accepts.
	assert.equal(asideAdoptReady(settled, true), false);
	assert.match(
		asideAdoptBlockedReason(settled, true) ?? "",
		RE_ADOPT_SESSION_WORKING,
	);
	/*
	 * And a failed ask offers nothing to add - ONE fact, because the alert above
	 * the control already states the cause (round 1, D2: the same instruction was
	 * being painted twice, once as the backend's refusal sentence paraphrased and
	 * once as this reason).
	 */
	assert.equal(
		asideAdoptReady(failedAsideStream(undefined, "no"), false),
		false,
	);
	assert.equal(
		asideAdoptBlockedReason(failedAsideStream(undefined, "no"), false),
		NOTHING_TO_ADD_REASON,
	);
	// No aside at all is its own sentence rather than a crash.
	assert.equal(asideAdoptReady(undefined, false), false);
	assert.equal(asideAdoptBlockedReason(undefined, false), NO_EXCHANGE_REASON);
});

/* --------------------------------------------------------- the composer's half */

/*
 * THE OFF-RECORD DESTINATION LEAVES NO TRACE, in two places at once (round 1,
 * F2). `submittedMessages` is persisted (`conversation-input-store.ts` writes the
 * whole `inputByConversation` to `localStorage`) and recalled by Up-arrow, so a
 * question typed at the composer while the panel is attached must not be written
 * into it while the same question typed after a bare `/btw` is not - which door
 * the user came through cannot decide whether the question outlives the app.
 */
test("an off-record ask is not written into the persisted composer history", () => {
	/*
	 * The outcome is an OBJECT now, carrying the ask's own answer (round 2, F6),
	 * which is exactly the shape a careless guard would classify as "an ordinary
	 * accepted send" and persist. The rule is asserted for the off-record ask
	 * itself, not for a string that stands in for it.
	 */
	const ask = { offRecord: Promise.resolve() };
	assert.equal(isOffRecordAsk(ask), true);
	assert.equal(recordsSubmittedMessage(ask), false);
	// The conversation's own send is, and the two failure answers are not: `false`
	// put the text back in the box, and `SEND_HELD` keeps the retry on the store's
	// claim rather than in a log it would have to be recalled from.
	assert.equal(recordsSubmittedMessage(true), true);
	assert.equal(recordsSubmittedMessage(undefined), true);
	assert.equal(recordsSubmittedMessage(false), false);
	assert.equal(recordsSubmittedMessage(SEND_HELD), false);
	/*
	 * AND NOTHING ELSE IS MISTAKEN FOR IT. The guard reads the shape, so the three
	 * answers that are NOT off-record asks must not be read as one - a widened
	 * check here would send every ordinary send down the ask's payload path.
	 */
	assert.equal(isOffRecordAsk(false), false);
	assert.equal(isOffRecordAsk(true), false);
	assert.equal(isOffRecordAsk(SEND_HELD), false);
	assert.equal(isOffRecordAsk(undefined), false);
});

/*
 * A REFUSED ASK RETIRES NOTHING, AN ANSWERED ONE RETIRES WHAT IT SENT (round 2,
 * F6). The question leaves at the press, so the payload's fate cannot be decided
 * there: the staged reply chips and the credential map belong to the next real
 * send when the ask is refused (the same rule a `false` outcome follows), and are
 * consumed when it is answered.
 */
test("an off-record ask's payload is retired on the answer and kept on a refusal", async () => {
	let retired = 0;
	const answered = { offRecord: Promise.resolve("the answer") };
	settleOffRecordPayload(answered, () => {
		retired += 1;
	});
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(retired, 1, "an answered ask consumed what it carried");

	const refused = {
		offRecord: Promise.reject(new Error("the aside was refused")),
	};
	settleOffRecordPayload(refused, () => {
		retired += 1;
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(
		retired,
		1,
		"a refused ask puts nothing anywhere, so it keeps them",
	);
});

/*
 * THE CONCATENATION THE REVIEW TRACED (round 1, F1). The box is retired at the
 * PRESS, not at the answer, so a follow-up typed while the answer streams starts
 * from an empty box; the clear that lands later may only write over text this
 * submit is still carrying, so it cannot join the two questions.
 */
test("a follow-up typed while the answer streams is not concatenated onto the question", () => {
	/* 1. The press, with the aside attached and "q1" in the box. */
	const submitted = "q1";
	let box = submitted;
	// The off-record outcome retires the box as the submit settles, which - with
	// the ask no longer awaited - is the same task as the press.
	box = clearSubmittedText(box, submitted);
	assert.equal(box, "");
	/* 2. The user types the next question while the answer is still arriving. */
	box += "q2";
	assert.equal(box, "q2");
	/* 3. The late clear - the composer's own, or an echo's - sees a box that no
	 *    longer holds the submitted text, so it is a no-op rather than a join. */
	assert.equal(clearSubmittedText(box, submitted), "q2");
	assert.equal(box.includes(submitted), false);
});

/*
 * AND THE ASK ITSELF IS REGISTERED BY THE PRESS, which is the mechanism the clear
 * above rests on: `beginAsk` runs synchronously, so the panel has the question and
 * a stream entry to receive a delta before the request has even been sent. A
 * caller that ignores the returned promise therefore loses nothing.
 */
test("an aside ask is registered and its answer needs no await", async () => {
	reset();
	let release;
	handler = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const inFlight = askAside(SESSION, "q1", "a".repeat(32));
	// Nothing has been awaited: the transport is still holding the request.
	assert.equal(calls.length, 1);
	const attached = useAsideStore.getState().attached[SESSION];
	assert.equal(attached.turns.length, 1);
	assert.equal(attached.turns[0].question, "q1");
	assert.equal(
		useAsideStore.getState().streams[attached.turns[0].asideId].streaming,
		true,
	);
	/*
	 * THE SUBSCRIPTION TRAVELS WITH THE ASK (round 1, PAIRING CHANGE). The answer's
	 * chunks are published on the session's stream, which every attached viewer
	 * reads, so the owner has to be told which subscription asked or the panel gets
	 * none of them and degrades to the settled answer alone.
	 */
	assert.equal(calls[0].subscriptionId, "a".repeat(32));
	release({
		data: { aside_id: "unused", text: "an answer", off_record: true },
	});
	await inFlight;
	assert.equal(
		useAsideStore.getState().streams[attached.turns[0].asideId].text,
		"an answer",
	);
});

/* ------------------------------------------------- the wiring, read from source */

const read = (path) => readFileSync(path, "utf8");

test("the frame is live-only and never reaches the transcript reducer", () => {
	const contract = read("src/shared/desktop-session-contract.ts");
	assert.match(contract, RE_ASIDE_RECEIPT);
	// Not an `event`: that is the arm the transcript reducer paints, and the whole
	// point of this frame is that it must not become a row.
	assert.doesNotMatch(contract, RE_ASIDE_EVENT);
	assert.doesNotMatch(
		read("src/renderer/src/features/chat/canonical/transcript-reducer.ts"),
		RE_ASIDE_DELTA,
	);
	// The stream routes it to its own store, outside the React updater.
	const hook = read("src/renderer/src/shared/hooks/use-canonical-session.ts");
	assert.match(hook, RE_ROUTE_DELTA);
	assert.match(hook, RE_ROUTE_DELTAS);
});

/*
 * AND THE BATCH IS TAKEN OUT OF THE VIEW UPDATE TOO (round 1, F5). Taking the
 * chunks out before the transcript reducer is half the rule; the other half is
 * that the batch must not reach `setView`, whose updater always returns a fresh
 * view object - so every `aside_delta` batch re-rendered the whole pane, the
 * composer subtree included, once per chunk for the length of the answer.
 */
test("a batch of off-record chunks does not repaint the view", () => {
	const hook = read("src/renderer/src/shared/hooks/use-canonical-session.ts");
	// `current`, not a fresh object: handing React the same reference is what
	// makes the bail-out a non-render rather than a cheap one. WHICH batches it
	// catches is asserted by value below, not by this file's characters.
	assert.match(hook, RE_VIEW_BATCH_BAILOUT);
});

/*
 * THE PRESS HANDS THE BOX BACK (round 1, F1). `askAside` is called without being
 * awaited, so the composer's own clear runs at the press rather than at the
 * answer, and the outcome the branch returns is the off-record one - which is
 * what keeps the text out of the history log and out of the box (F2).
 */
test("the aside ask leaves the composer without being awaited", () => {
	const page = read("src/renderer/src/features/chat/components/chat-page.tsx");
	assert.match(page, RE_ASIDE_FIRE_AND_FORGET);
	assert.doesNotMatch(page, RE_ASIDE_AWAITED);
	assert.match(page, RE_ASIDE_OUTCOME);
});

/*
 * THE SENTENCE AND THE PRESS AGREE (round 1, F3). A pending question card and an
 * attached aside can hold at once, and the gate branch is the one that wins in
 * `chat-page.tsx` (an `approval` gate is answered from the composer or not at
 * all). The placeholder is therefore read here as an ORDER: the gate's term must
 * come before the aside's, or the box promises a route the press does not take.
 */
test("the placeholder names the destination the press actually reaches", () => {
	const composer = read(
		"src/renderer/src/features/chat/components/message-input.tsx",
	);
	const gate = composer.indexOf("Answer the question above");
	const aside = composer.indexOf("Ask off the record — Esc closes the aside");
	assert.notEqual(gate, -1);
	assert.notEqual(aside, -1);
	assert.ok(
		gate < aside,
		"the gate's placeholder term must precede the aside's: while a gate is unanswered the press answers the GATE",
	);
});

/*
 * THE PANEL'S OWN ROUND-1 FIXES, read where they live: one live region carrying the
 * PHASE rather than the answer (F4), and a cap derived from the answer's own line
 * box instead of the 240px that cut through one (D1).
 */
test("the panel announces its phases and caps itself in whole line boxes", () => {
	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	assert.match(panel, RE_PANEL_LIVE_REGION);
	assert.match(panel, RE_PANEL_CAP_DERIVED);
	// The number this replaces is gone rather than left beside the derivation: two
	// caps in one element is how the partial line comes back.
	assert.doesNotMatch(panel, RE_PANEL_CAP_SELECTOR);
});

/*
 * THE PAIRING CONTRACT (round 1, PAIRING CHANGE). The backend fix routes
 * `aside_delta` to the subscription that asked; a POST that does not name one
 * receives none of the frames, which would leave the panel with the settled
 * answer and no streaming at all.
 */
test("the ask carries the subscription its chunks belong to", () => {
	const contract = read("src/shared/desktop-contract.ts");
	// OPTIONAL, so an owner that predates the routing still accepts the request.
	assert.match(contract, RE_ASIDE_OP_SUBSCRIPTION);
	assert.match(contract, RE_ASIDE_BODY_SUBSCRIPTION);
	// And the id is the stream's own, so the lease and the routing cannot disagree
	// about which subscription a viewer is.
	const engage = read("src/main/backend/session-engage.ts");
	assert.match(engage, RE_SUBSCRIPTION_IN_FRAME);
});

test("the panel is not a modal and owns none of the app's keys", () => {
	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	// A Radix dialog is what made the composer unusable; a surface that helps the
	// user compose cannot be the one that takes composing away.
	assert.doesNotMatch(panel, RE_MODAL_MARKS);
	assert.doesNotMatch(panel, RE_DIALOG_IMPORTS);
	// A labelled `section` IS the region role, which is what the surface declares
	// and what biome's noRedundantRoles is about.
	assert.match(panel, RE_PANEL_LABEL);
	// And the band mounts it, in flow, above the composer box.
	const composer = read(
		"src/renderer/src/features/chat/components/message-input.tsx",
	);
	assert.match(composer, RE_PANEL_MOUNT);
	assert.match(composer, RE_PANEL_GATE);
});

test("the destination routes to the panel rather than to a picker", () => {
	const registry = read(
		"src/renderer/src/features/chat/pickers/picker-registry.tsx",
	);
	assert.match(registry, RE_DESTINATION);
	// The modal adapter is gone rather than merely unused, so nothing can route to
	// it again: one destination, one presenter.
	assert.doesNotMatch(registry, RE_OLD_PICKER);
	assert.doesNotMatch(
		read("src/renderer/src/features/chat/pickers/destination-pickers.tsx"),
		RE_OLD_PICKER,
	);
	const dispatch = read(
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
	);
	assert.match(dispatch, RE_DISPATCH_ASIDE);
	// ONE ENTER: the question travels with the command and is asked immediately,
	// while a bare `/btw` only attaches the panel.
	assert.match(dispatch, RE_DISPATCH_ASK);
	assert.match(dispatch, RE_DISPATCH_OPEN);
});

/* ------------------------------------- the adopt's receipt, and its re-read */

/*
 * AN ADOPT MAKES THE PANE READ AGAIN (round 2, Q2).
 *
 * The owner appends the exchange to its journal and to its live context and
 * publishes NOTHING: no `event` frame carries the two messages and the frontend
 * refresh watermark is not advanced, so a mounted pane that never re-reads keeps
 * painting the conversation without them. Measured by the QA round on the running
 * stack: the rows were in the owner's journal at 0/3/10 s and the transcript
 * painted none of them in 20 s, nor on re-entering the pane.
 *
 * Driven through the REAL resync registry (`__registerCanonicalResync`) rather
 * than a recorder standing in for it: the fix is a call into that registry, so a
 * test that replaced it could pass on a fix that never fires.
 */

test("an adopt asks the pane to re-read the session, after the rows are durable", async () => {
	reset();
	const reads = [];
	const unregister = __registerCanonicalResync(SESSION, () =>
		reads.push(calls.length),
	);
	try {
		handler = async (request) =>
			request.op === "sessions.adopt"
				? { data: { aside_id: request.asideId, status: "adopted" } }
				: {
						data: {
							aside_id: request.requestId,
							text: "the answer",
							off_record: true,
						},
					};
		await askAside(SESSION, "a question");
		await adoptAside(SESSION);
		// Exactly one re-read: the pane's own snapshot read is what carries the
		// adopted rows, and the resync is the seam that produces it.
		assert.equal(reads.length, 1);
		// ASKED AFTER THE POST ANSWERED. `Session.adopt_aside` persists before it
		// adopts, so a read issued before the receipt would find the conversation
		// exactly as it was and the receipt would be a sentence about nothing.
		assert.equal(reads[0], calls.length);
		assert.equal(calls.at(-1).op, "sessions.adopt");
		// The panel still goes: the rows are the receipt, and they are now painted.
		assert.equal(useAsideStore.getState().attached[SESSION], undefined);
		// A session no pane is displaying is not a failure: there is nothing to
		// re-read, and the next mount reads the new state anyway.
		assert.equal(resyncCanonicalSession(OTHER_SESSION), false);
	} finally {
		unregister();
	}
});

test("a refused adopt asks for no re-read and leaves the panel up", async () => {
	reset();
	const reads = [];
	const unregister = __registerCanonicalResync(SESSION, () => reads.push(1));
	try {
		handler = async (request) =>
			request.op === "sessions.adopt"
				? Promise.reject(
						new DesktopControlError(null, "This aside cannot be adopted"),
					)
				: {
						data: {
							aside_id: request.requestId,
							text: "the answer",
							off_record: true,
						},
					};
		await askAside(SESSION, "a question");
		await assert.rejects(() => adoptAside(SESSION));
		// NOTHING JOINED THE CONVERSATION, so there is nothing new to read - and a
		// re-read here would be a repaint claimed as a receipt for an op that failed.
		assert.equal(reads.length, 0);
		assert.equal(useAsideStore.getState().attached[SESSION].turns.length, 1);
	} finally {
		unregister();
	}
});

/* ----------------------------------------- an owner older than the field */

/*
 * RELEASE SKEW, CLIENT SIDE (round 2, PAIRING COMPATIBILITY).
 *
 * `subscription_id` is accepted only by an owner built from the change that
 * added it, and the body model forbids unknown keys repo-wide, so an older owner
 * answers 422 to EVERY ask that carries it. The owner cannot be fixed from here,
 * so this window asks with the field, drops it once, and remembers - the field's
 * absence behaves exactly as it did before the field existed (the aside runs, the
 * POST's text settles the answer, and no live frames are published).
 *
 * Each test owns its session id: the memory is per window and per session, so one
 * test's remembered owner must not make another's first ask fieldless.
 */
const SESSION_SKEW_FIRST = "session-aside-skew-1";
const SESSION_SKEW_MEMORY = "session-aside-skew-2";
const SESSION_SKEW_OTHER = "session-aside-skew-3";
const SUBSCRIPTION = "a".repeat(32);
/* The desktop plane's own refusal of a body whose fields it will not take. */
const UNKNOWN_FIELDS_SENTENCE = "The request has invalid fields.";

/** An owner that forbids the field, and answers every fieldless ask. */
const forbidsTheField = async (request) => {
	if (request.subscriptionId !== undefined)
		throw new DesktopControlError(422, UNKNOWN_FIELDS_SENTENCE);
	return {
		data: {
			aside_id: request.requestId,
			text: "the whole answer",
			off_record: true,
		},
	};
};

test("an owner that forbids subscription_id is asked once more without it", async () => {
	reset();
	handler = forbidsTheField;
	const asideId = await askAside(SESSION_SKEW_FIRST, "why?", SUBSCRIPTION);
	assert.equal(calls.length, 2, "one refused request, one accepted one");
	assert.equal(calls[0].subscriptionId, SUBSCRIPTION);
	assert.equal(calls[1].subscriptionId, undefined);
	/*
	 * ONE ASK, NOT TWO. The retry re-uses the request id, so the panel's turn, its
	 * stream entry and the owner's own receipt are the same exchange: a retry that
	 * minted a new id would put a second question on the panel and strand the first
	 * entry, and the settle below would land on neither.
	 */
	assert.equal(calls[0].requestId, calls[1].requestId);
	assert.equal(
		useAsideStore.getState().attached[SESSION_SKEW_FIRST].turns.length,
		1,
	);
	assert.deepEqual(Object.keys(useAsideStore.getState().streams), [asideId]);
	// The answer still arrives whole: the fieldless body is answered exactly as it
	// was before the field existed.
	assert.equal(useAsideStore.getState().streams[asideId].settled, true);
	assert.equal(
		useAsideStore.getState().streams[asideId].text,
		"the whole answer",
	);
});

test("the next ask for that session skips the field instead of paying the refusal again", async () => {
	reset();
	handler = forbidsTheField;
	const first = await askAside(SESSION_SKEW_MEMORY, "q1", SUBSCRIPTION);
	assert.equal(calls.length, 2);
	calls.length = 0;
	const second = await askAside(SESSION_SKEW_MEMORY, "q2", SUBSCRIPTION);
	assert.equal(calls.length, 1, "the refusal is remembered, and paid once");
	assert.equal(calls[0].subscriptionId, undefined);
	// The continuation still continues, and it is the same owner's second ask.
	assert.deepEqual(
		useAsideStore
			.getState()
			.attached[SESSION_SKEW_MEMORY].turns.map((turn) => turn.asideId),
		[first, second],
	);
	/*
	 * AND IT IS NOT TARRED WITH IT. A second conversation on the same (older)
	 * owner is asked WITH the field first, exactly as the first was: the memory is
	 * a fact about the session that met the refusal, not about the daemon.
	 */
	calls.length = 0;
	await askAside(SESSION_SKEW_OTHER, "hello", SUBSCRIPTION);
	assert.equal(calls.length, 2);
	assert.equal(calls[0].subscriptionId, SUBSCRIPTION);
	assert.equal(calls[1].subscriptionId, undefined);
});

test("a 422 that is not the field refusal is not retried", async () => {
	reset();
	const session = "session-aside-422-other";
	const asideId = "aside-422";
	handler = async () =>
		Promise.reject(
			new DesktopControlError(
				422,
				"Confirm adding this aside to the conversation",
			),
		);
	await assert.rejects(() => askAside(session, "q", SUBSCRIPTION));
	// THE STATUS ALONE EARNS NOTHING. A route's own 422 - the same status, a
	// different sentence - is an ordinary failure whose retry budget is its own, and
	// retrying it would ask a refused question twice.
	assert.equal(calls.length, 1);
	assert.equal(
		calls[0].asideId,
		asideId === "aside-422" ? calls[0].asideId : undefined,
	);
	// The refusal is on the turn, stated with the backend's own sentence, as every
	// other failure is.
	const turn = previousAsideId(useAsideStore.getState(), session);
	assert.equal(
		useAsideStore.getState().streams[turn].error,
		"Confirm adding this aside to the conversation",
	);

	/*
	 * AND AN ASK THAT NAMED NO SUBSCRIPTION HAS NOTHING TO DROP: a 422 against it
	 * cannot be the field, so it is not retried either.
	 */
	reset();
	handler = async () =>
		Promise.reject(new DesktopControlError(422, UNKNOWN_FIELDS_SENTENCE));
	await assert.rejects(() => askAside(session, "q"));
	assert.equal(calls.length, 1);
});

/* -------------------------------------------------- the view-batch rule */

/*
 * WHAT COUNTS AS \"THIS BATCH PAINTS NOTHING\" (round 2, F8).
 *
 * Asserted BY VALUE, not by the file's characters: the bail-out that depends on
 * this classification is one line inside an effect no node test can mount, and a
 * source-text assertion would pass with the condition flipped, with an `||` for
 * the `&&`, or with a third type added to the inert list - each of which is a
 * transcript that stops updating while the suite stays green.
 */
test("only the two inert frame types leave the view alone, and an unknown one repaints", () => {
	const frame = (type) => ({ type });
	/* The two the fold treats as invisible: a heartbeat touches nothing, and an
	   aside chunk is routed to its own store before the reducer sees it. */
	assert.equal(batchMovesView([frame("aside_delta")]), false);
	assert.equal(batchMovesView([frame("heartbeat")]), false);
	assert.equal(
		batchMovesView([frame("aside_delta"), frame("heartbeat")]),
		false,
	);
	assert.equal(batchMovesView([]), false);
	/* Everything else writes something the pane paints. */
	for (const type of [
		"open",
		"snapshot",
		"event",
		"attention",
		"frontend.update",
		"frontend.replace",
	]) {
		assert.equal(batchMovesView([frame(type)]), true, type);
	}
	/*
	 * FAIL-SAFE, WHICH IS THE HALF A LIST-OF-INERT-TYPES WOULD GET WRONG: a frame
	 * type this rule has never heard of must repaint rather than go silent, because
	 * silence here is a transcript that stops updating for the rest of the session.
	 */
	assert.equal(batchMovesView([frame("something_new")]), true);
	assert.equal(
		batchMovesView([frame("aside_delta"), frame("something_new")]),
		true,
	);
});

/* ------------------------------- a refusal with no panel left to state it */

/*
 * WHICH SURFACE CAN STATE A REFUSAL (round 2, F7).
 *
 * The panel states it on the turn it is holding; `detachAside` deletes a turn AND
 * its stream entry, so a user who closes the panel while an answer is in flight
 * leaves `failAside` with nothing to write on - and the question left the screen
 * with the panel, so the composer is the only surface that still knows the ask
 * happened. `asideTurnIsCarried` is that rule as a value, and the composer's own
 * catch is the caller that asks it.
 */
test("a refusal has a surface while the panel holds the turn, and none once it does not", async () => {
	reset();
	handler = async (request) => ({
		data: { aside_id: request.requestId, text: "the answer", off_record: true },
	});
	const asideId = await askAside(SESSION, "a question");
	const state = () => useAsideStore.getState();
	assert.equal(asideTurnIsCarried(state(), asideId), true);
	closeAside(SESSION);
	assert.equal(asideTurnIsCarried(state(), asideId), false);
	// An id no surface ever held is the same answer: the store refuses to open an
	// entry for a frame whose panel has gone (see `applyAsideDelta`).
	assert.equal(asideTurnIsCarried(state(), "never-asked"), false);

	/*
	 * AND THE SENTENCE IS COMPOSED IN ONE PLACE, so the composer states the same
	 * words the panel does rather than a paraphrase of them.
	 */
	assert.equal(
		asideAskFailure(
			new DesktopControlError(null, "The aside was not answered."),
		),
		"The aside was not answered.",
	);
	assert.equal(
		asideAskFailure(new Error("TypeError: fetch failed")),
		"The aside was not answered.",
	);
});

/*
 * THE ONE-ENTER DOOR STATES A REFUSAL THE CLOSED PANEL CANNOT (round 3, F9).
 *
 * `/btw <question>` consumes the whole draft at the press, so Escape on the panel
 * before the answer takes the question off the screen, and `detachAside` leaves
 * `failAside` nothing to write the refusal on. The composer door already said so
 * on its error line; the command door ended in an empty catch and lost both. The
 * rule now lives in one helper both doors call, and this drives it through the
 * REAL store and ask: a report while the panel holds the turn would be a second
 * copy of the panel's sentence, and no report once it does not is the defect.
 */
test("a refusal after the panel closed is reported by the door, and only then", async () => {
	reset();
	let refuse;
	// Only the ASK is held open; the close the panel sends is answered at once.
	handler = (request) =>
		request.op === "sessions.aside"
			? new Promise((_, reject) => {
					refuse = reject;
				})
			: Promise.resolve({ data: {} });
	const reported = [];
	const closedFirst = askAside(SESSION, "a question");
	reportUncarriedAsideRefusal(closedFirst, SESSION, (sentence) =>
		reported.push(sentence),
	);
	closeAside(SESSION);
	refuse(
		new DesktopControlError(422, "Close an aside or wait for it to expire"),
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(
		reported,
		[
			asideOffPanelRefusal(
				"a question",
				new DesktopControlError(422, "Close an aside or wait for it to expire"),
			),
		],
		"the panel was gone, so the door is the only surface left to state it — and the only one that can still name the question",
	);

	reset();
	handler = async () => {
		throw new DesktopControlError(
			422,
			"Close an aside or wait for it to expire",
		);
	};
	const held = [];
	const heldAsk = askAside(SESSION, "a question");
	reportUncarriedAsideRefusal(heldAsk, SESSION, (sentence) =>
		held.push(sentence),
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(held, [], "the panel holds the turn and states it itself");
	const [stream] = Object.values(useAsideStore.getState().streams);
	assert.equal(stream.error, "Close an aside or wait for it to expire");

	/*
	 * And both doors are wired to it. The dispatcher is a hook whose module graph
	 * cannot be mounted here (this file's header), so its wiring is source-level
	 * and says so.
	 */
	const dispatch = read(
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
	);
	assert.match(dispatch, RE_DISPATCH_REPORTS_UNCARRIED);
	assert.doesNotMatch(dispatch, RE_SWALLOWED_REFUSAL);
	assert.match(
		read("src/renderer/src/features/chat/components/chat-page.tsx"),
		RE_PAGE_REPORTS_UNCARRIED,
	);
});

/* ------------------------------------------- the panel's failures (round 4) */

/*
 * A REFUSED ASK MUST NOT POISON THE PANEL IT WAS ASKED IN (UX round 1, U1).
 *
 * The owner DROPS the entry of an ask it refused — a question with no answer is
 * neither continuable nor adoptable — and it refuses a continuation whose prefix it
 * no longer holds with 409 "This aside is no longer available". The client named
 * the LAST turn as its prefix, so after one refused question every further question
 * in that panel 409d without a model request at all, while the refusal's own
 * sentence told the user to ask again. This drives the real `askAside` against a
 * transport that refuses one question, and reads the prefix off the request it
 * records: the last ANSWERED turn's id, or none at all when nothing was answered.
 */
test("a follow-up continues from the last ANSWERED turn, and a fresh ask from nothing", async () => {
	reset();
	handler = async (request) =>
		request.text === "refused"
			? Promise.reject(
					new DesktopControlError(409, "This aside is no longer available"),
				)
			: {
					data: {
						aside_id: request.requestId,
						text: "the answer",
						off_record: true,
					},
				};
	const first = await askAside(SESSION, "answered");
	// A fresh ask names no prefix: it opens the exchange rather than continuing it.
	assert.equal(calls[0].asideId, undefined);
	await assert.rejects(() => askAside(SESSION, "refused"));
	/*
	 * The store holds BOTH turns — the refused question stays on the panel with its
	 * refusal on it — so the last turn is the refused one, and that is the id the
	 * pre-fix client handed back.
	 */
	const state = () => useAsideStore.getState();
	assert.equal(previousAsideId(state(), SESSION), calls[1].requestId);
	assert.equal(lastAnsweredAsideId(state(), SESSION), first);
	await askAside(SESSION, "after the refusal");
	assert.equal(
		calls[2].asideId,
		first,
		"the continuation names the last answered turn, which the owner still holds",
	);

	/*
	 * AND NOTHING ANSWERED MEANS NOTHING TO CONTINUE: the owner has already dropped
	 * the refused entry, so a prefix would be naming an id it does not hold. This is
	 * the arm that makes "ask again" true on the panel the refusal is printed on.
	 */
	reset();
	handler = async () =>
		Promise.reject(
			new DesktopControlError(409, "This aside is no longer available"),
		);
	await assert.rejects(() => askAside(SESSION, "one"));
	await assert.rejects(() => askAside(SESSION, "two"));
	assert.equal(lastAnsweredAsideId(state(), SESSION), undefined);
	assert.equal(calls[1].asideId, undefined);
});

/*
 * A REFUSED CONTINUATION IS THE ONE REFUSAL THE PANEL NEEDS HELP WITH (U1).
 *
 * With the prefix rule above, a continuation is refused only when the exchange it
 * names is genuinely gone, and the owner's own sentence ("ask again") is then advice
 * that cannot work from that panel. The escape that does work is Escape and a fresh
 * `/btw`, so it is stated with the refusal — and stated ONLY there, because a fresh
 * ask opens a clean entry and printing an escape hatch over a panel that had already
 * recovered by itself would send the user away from it.
 */
test("a refused continuation is told the panel's own way out, and a fresh refusal is not", async () => {
	reset();
	handler = async (request) =>
		request.text === "second"
			? Promise.reject(
					new DesktopControlError(409, "This aside is no longer available"),
				)
			: {
					data: {
						aside_id: request.requestId,
						text: "the answer",
						off_record: true,
					},
				};
	await askAside(SESSION, "first");
	await assert.rejects(() => askAside(SESSION, "second"));
	const continued = useAsideStore.getState().streams[calls[1].requestId];
	assert.equal(
		continued.error,
		`This aside is no longer available ${ASIDE_CONTINUATION_ESCAPE}`,
	);

	reset();
	handler = async () =>
		Promise.reject(
			new DesktopControlError(409, "This aside is no longer available"),
		);
	await assert.rejects(() => askAside(SESSION, "only"));
	const fresh = useAsideStore.getState().streams[calls[0].requestId];
	assert.equal(
		fresh.error,
		"This aside is no longer available",
		"a fresh refusal needs no escape hatch: the next ask starts a clean entry",
	);
	assert.equal(
		asidePanelRefusal(new DesktopControlError(409, "gone"), false),
		"gone",
	); // The panel keeps the owner's own sentence, and nothing else.
	assert.equal(
		asidePanelRefusal(new DesktopControlError(409, "gone"), true),
		`gone ${ASIDE_CONTINUATION_ESCAPE}`,
	);
});

/*
 * A FOLLOW-UP SENT WHILE THE ANSWER STREAMS IS REFUSED IN THE APP, WITH THE TEXT
 * KEPT (UX round 1, U2). The composer is typable on purpose while an answer
 * streams, so this is the path the feature itself invites: the box emptied, the
 * question was painted, and 800ms later it read "no longer available" — the owner
 * refuses a continuation of an entry it is still running.
 *
 * The rule is a predicate so both doors apply the SAME one, and the two doors'
 * application of it is asserted from their source (this file's header: neither can
 * be mounted here). A failure is deliberately NOT busy: its entry was dropped, so
 * the next question starts a clean one — a gate here would be the dead end U1 is
 * about.
 */
test("an ask is refused in the app while the exchange is still answering", () => {
	reset();
	const store = () => useAsideStore.getState();
	assert.equal(
		asideAskBlockedReason(store(), SESSION),
		null,
		"no exchange: nothing to wait for",
	);
	store().beginAsk(SESSION, "turn-1", "asked");
	assert.equal(asideAskBlockedReason(store(), SESSION), ASIDE_ASK_BUSY);
	store().settleAside("turn-1", "answered");
	assert.equal(asideAskBlockedReason(store(), SESSION), null);
	store().beginAsk(SESSION, "turn-2", "asked again");
	store().failAside("turn-2", "no answer");
	assert.equal(
		asideAskBlockedReason(store(), SESSION),
		null,
		"a failed turn is not busy, or the panel would have no way back in",
	);
	assert.equal(asideAskBlockedReason(store(), OTHER_SESSION), null);

	const page = read("src/renderer/src/features/chat/components/chat-page.tsx");
	const dispatch = read(
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
	);
	assert.match(page, RE_PAGE_ASIDE_BUSY_GATE);
	assert.match(dispatch, RE_DISPATCH_ASIDE_BUSY_GATE);
	// The text stays with the user: `false` is the composer's refusal-before-
	// admission, and `retained` is the dispatcher's own word for the same outcome.
	assert.match(page, /setSendError\(busy\);\s*return false;/);
	assert.match(dispatch, /note\(busy, true\);\s*return "retained";/);
});

/*
 * AN APPENDED TURN IS BROUGHT INTO THE REGION'S VIEW, ONCE (design round 2, D6).
 *
 * A follow-up asked while the exchange overflows was painted below the region's
 * fold — measured 88px under it at wide, 687px at narrow — so the question, its
 * thinking line and the answer that followed were all invisible and the ask looked
 * as though it had done nothing. The scroll is one measurement against the region's
 * own rectangles, so it is a pure function here; the effect that calls it once per
 * appended turn, and the region's own focusability, are asserted from the panel's
 * source.
 */
test("an appended turn is scrolled into the region's view, once", () => {
	// A question below the fold, in the shape the finding measured at wide: the
	// region is at its top and the new question sits 88px under it.
	assert.equal(
		asideScrollToTurn({
			regionTop: 100,
			turnTop: 572,
			scrollTop: 0,
			scrollHeight: 355,
			clientHeight: 224,
		}),
		131,
		"the region scrolls to its own end, which is all it can reach",
	);
	// A question already at the region's top does not move a reader: an append that
	// lands where the region already is costs nothing.
	assert.equal(
		asideScrollToTurn({
			regionTop: 100,
			turnTop: 100,
			scrollTop: 40,
			scrollHeight: 500,
			clientHeight: 224,
		}),
		40,
	);
	// The region's own end is the ceiling, wherever the question sits below it.
	assert.equal(
		asideScrollToTurn({
			regionTop: 100,
			turnTop: 600,
			scrollTop: 0,
			scrollHeight: 355,
			clientHeight: 224,
		}),
		131,
	);
	// Nothing to scroll stays at the top rather than going negative.
	assert.equal(
		asideScrollToTurn({
			regionTop: 0,
			turnTop: 300,
			scrollTop: 0,
			scrollHeight: 200,
			clientHeight: 224,
		}),
		0,
	);
	// A question ABOVE the fold — the transcript is re-read, the turns repaint —
	// scrolls up to it rather than only ever downward.
	assert.equal(
		asideScrollToTurn({
			regionTop: 300,
			turnTop: 200,
			scrollTop: 120,
			scrollHeight: 900,
			clientHeight: 224,
		}),
		20,
	);

	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	assert.match(panel, RE_PANEL_SCROLLS_TO_TURN);
	// ONCE: the effect returns early for a turn it has already honoured, which is
	// what keeps this from becoming a pin-to-bottom on every chunk.
	assert.match(panel, RE_PANEL_SCROLLS_ONCE);
	assert.match(panel, RE_PANEL_REGION_FOCUSABLE);
});

/*
 * AN OFF-PANEL REFUSAL QUOTES ITS QUESTION, IN ONE SENTENCE FOR BOTH DOORS (UX
 * round 1, U4 with design round 2, D8).
 *
 * The two surfaces that exist because the panel does not were printing the owner's
 * sentence alone, which names no question — and the sentence itself ends in "ask
 * again" — while the question had left the screen with the panel (the `/btw` door
 * consumed the draft at the press). It is one composition so the composer's error
 * line and the dispatcher's transcript note cannot drift into two accounts of one
 * refusal, and the composer's own half of U4 rides the same push: without a code of
 * its own, the alert appended "Your message is still in the composer. Send it
 * again." to a sentence about a question that is in neither.
 */
test("an off-panel refusal quotes the question, and the composer drops the false retry hint", () => {
	assert.equal(
		asideOffPanelRefusal(
			"why is the budget capped?",
			new DesktopControlError(409, "No answer was produced: ask again."),
		),
		"Your aside “why is the budget capped?” got no answer: No answer was produced: ask again.",
	);
	// A question long enough to wrap the line is cut, and the quote always closes:
	// the quote marks and the ellipsis are three glyphs around a 59-character body.
	const long = asideQuotedQuestion("q".repeat(200));
	assert.equal(long.length, 62);
	assert.equal(long.endsWith("…”"), true);
	// Whitespace is collapsed for the same reason: the sentence is one line.
	assert.equal(asideQuotedQuestion("  a\n\nquestion  "), "“a question”");

	const page = read("src/renderer/src/features/chat/components/chat-page.tsx");
	assert.match(page, RE_PAGE_REPORTS_UNCARRIED);
	const store = read(
		"src/renderer/src/shared/store/canonical-sessions-store.ts",
	);
	assert.match(store, /code === ASIDE_NOT_ANSWERED_CODE \|\|/);
});

/*
 * THE COMPOSER'S LINE IS RETIRED BY EITHER DOOR, AND FOCUS COMES BACK WITH THE PANEL
 * (design round 2, D7; UX round 1, U6).
 *
 * D7: the line outlived the aside it described and sat 40px above a fresh panel that
 * was still thinking, because only a text edit or a thread send cleared it. U6: Add
 * to conversation, Close and Escape all unmount the control the user was standing
 * on, so focus fell to `<body>` and the next Tab started from the top of the page —
 * where Escape from the box already returned to the composer. Both are wiring on
 * components this harness cannot mount, so both are read from their source.
 */
test("a new aside retires the composer's line, and the panel hands focus back", () => {
	const page = read("src/renderer/src/features/chat/components/chat-page.tsx");
	const dispatch = read(
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
	);
	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	assert.match(page, RE_PAGE_CLEARS_ASIDE_REFUSAL);
	assert.match(dispatch, RE_DISPATCH_CLEARS_ASIDE_REFUSAL);
	// The panel's own ask retires it too, before the ask leaves.
	assert.match(page, /setSendError\(null\);\s*setSendErrorCode\(undefined\);/);
	/*
	 * AND THE FOCUS RETURNS FROM ALL THREE CONTROLS: the close control, the panel's
	 * Escape, and the adopt (after it settles, whether it adopted or was refused).
	 * A count rather than three spellings: the point is that no close path was left
	 * without the return.
	 */
	assert.equal(
		[...panel.matchAll(RE_PANEL_RETURNS_FOCUS)].length,
		3,
		"close, Escape and adopt all hand focus to the composer",
	);
	assert.match(
		read("src/renderer/src/features/chat/components/message-input.tsx"),
		/onReturnFocus=\{\(\) => textareaRef\.current\?\.focus\(\)\}/,
	);
});

/*
 * THE PANEL'S ACCESSIBLE CUES (UX round 1, U5, U8, U9 and U10).
 *
 * U9: the disabled adopt control's reason was a sibling paragraph bound to it by
 * nothing, so a reader heard "dimmed" with no explanation. U5: with the panel up,
 * the only routing cue was the placeholder, which is gone on the first keystroke, so
 * the send control now names the destination it reaches. U8: `⌘+F` means Find
 * everywhere else in this app, so the cap carries the verb. U10: the live region
 * announced the phase only, never the answer, so a reader had to leave the composer
 * and navigate in to hear one.
 */
test("the panel names its chord's verb, describes its blocked control, and announces the answer", () => {
	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	const input = read(
		"src/renderer/src/features/chat/components/message-input.tsx",
	);
	assert.match(panel, RE_PANEL_DESCRIBED_BY);
	assert.match(panel, RE_PANEL_REASON_ID);
	assert.match(input, RE_SEND_VERB);
	assert.match(panel, /content="Add the aside to the conversation"/);

	// The announcement: one sentence per phase, and the answer ONCE, at settle.
	assert.equal(asideAnnouncement(undefined), null);
	assert.equal(asideAnnouncement(beginAsideStream()), "Asking the aside");
	assert.equal(
		asideAnnouncement(failedAsideStream(undefined, "no answer")),
		"The aside was not answered",
	);
	assert.equal(
		asideAnnouncement(
			settledAsideStream("The budget counts failures. It resets on success."),
		),
		"The aside answered: The budget counts failures.",
	);
	// A settled answer with no sentence break is bounded rather than read whole.
	const longAnswer =
		asideAnnouncement(settledAsideStream("w".repeat(400))) ?? "";
	assert.equal(longAnswer.length, "The aside answered: ".length + 141);
	assert.equal(longAnswer.endsWith("…"), true);
	assert.equal(
		asideAnnouncement(settledAsideStream("   ")),
		"The aside answered",
	);
});

/*
 * THE CEILING COUNTS THE QUESTION AND ITS GAP (design round 2, D10).
 *
 * The cap budgeted answer lines only, while the region also holds the question's
 * line box (19.5px at wide) and the 4px gap under it — so an answer of nine complete
 * lines measured `scrollHeight` 225 against `clientHeight` 224 and the exchange grew
 * a full-height scrollbar that scrolled 1px and cut nothing. The two terms are in
 * the expression, and D1's whole-line property is what they protect: the budget left
 * over is still a whole number of the answer's line boxes.
 */
test("the ceiling counts the question's line and the gap under it", () => {
	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	assert.match(panel, RE_PANEL_CAP_COUNTS_QUESTION);
	assert.match(panel, /const ASIDE_QUESTION_LINE_HEIGHT = 1\.5;/);
	assert.match(panel, /const ASIDE_TURN_GAP_REM = "0\.25rem";/);
});

/*
 * AN ASIDE'S ANSWER RETIRES THE BOX'S PAYLOAD IN ITS OWN COMMIT (agent review round
 * 4, F12 — the regression pin F11 was missing).
 *
 * An off-record ask empties the box at the press and is answered seconds later, so
 * the retirement request is written in a commit where `newMessage` never changes; a
 * ref alone never re-runs an effect, which is how a consumed credential value stayed
 * in memory until the next edit. The trigger dependency is what fixes it, and the
 * reviewer's mutation (dropping it) left every other test in this file green — so
 * the bump, the dependency and the ABSENCE of the old dependency list are all
 * asserted here.
 */
test("the retirement request is a trigger the effect reads", () => {
	const input = read(
		"src/renderer/src/features/chat/components/message-input.tsx",
	);
	assert.match(input, RE_RETIRE_REQUEST_BUMP);
	assert.match(input, RE_RETIRE_REQUEST_TRIGGER);
	/*
	 * The bump is counted in the file the effect reads its dependencies from, and the
	 * pair above is the only mention of the trigger as a dependency — so a partial
	 * revert (the bump kept, the dependency dropped) cannot satisfy both sides. No
	 * negative assertion on the OLD list is possible: `}, [newMessage]);` is a
	 * legitimate dependency list on another effect of this same file.
	 */
	assert.equal([...input.matchAll(/newMessage, retireRequest/g)].length, 1);
});
