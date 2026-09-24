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
				asideQuestionTopOffset,
				asideScrollToTurn,
				asideScrollTrigger,
				asideAnnouncement,
				asideAnnounceableText,
				asideModelDeclined,
				ASIDE_ASK_BUSY,
				ASIDE_CONTINUATION_ESCAPE,
				ASIDE_DECLINED_OPTIONS,
				ASIDE_OFF_PANEL_MAX_CHARS,
				ASIDE_ADOPT_CONFIRM_FLOOR_MS,
				reportUncarriedAsideRefusal,
				asideAdoptChord,
				asideAdoptCap,
				asideAdoptConfirm,
				asideAdoptChordStep,
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
				"@shared/api/local-operator/desktop-api";
			/*
			   The payload reader the panel renders a question with (U14). The REAL one,
			   so a question the panel would paint as markup is asserted by the same rule
			   the transcript renders by rather than by a copy of it.
			*/
			export { parseReplies } from
				"./src/renderer/src/features/chat/utils/reply-utils";`,
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
				composerPlaceholder,
				COMPOSER_PLACEHOLDER,
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
	asideQuestionTopOffset,
	asideScrollToTurn,
	asideScrollTrigger,
	asideAnnouncement,
	asideAnnounceableText,
	asideModelDeclined,
	ASIDE_ASK_BUSY,
	ASIDE_CONTINUATION_ESCAPE,
	ASIDE_DECLINED_OPTIONS,
	ASIDE_OFF_PANEL_MAX_CHARS,
	ASIDE_ADOPT_CONFIRM_FLOOR_MS,
	reportUncarriedAsideRefusal,
	asideAdoptChord,
	asideAdoptCap,
	asideAdoptConfirm,
	asideAdoptChordStep,
	asideAdoptReady,
	asideAdoptBlockedReason,
	__registerCanonicalResync,
	resyncCanonicalSession,
	batchMovesView,
	DesktopControlError,
	parseReplies,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const {
	clearSubmittedText,
	recordsSubmittedMessage,
	isOffRecordAsk,
	settleOffRecordPayload,
	composerPlaceholder,
	COMPOSER_PLACEHOLDER,
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
	/const busy = asideAskBlockedReason\(useAsideStore\.getState\(\), sessionId\);\s*if \(busy\) \{\s*(?:\/\*[\s\S]*?\*\/\s*)?noteAsideRefusal\(busy\);\s*return false;/;
const RE_DISPATCH_ASIDE_BUSY_GATE =
	/const busy = asideAskBlockedReason\(\s*useAsideStore\.getState\(\),\s*sessionId,\s*\);\s*if \(busy\) \{\s*(?:\/\*[\s\S]*?\*\/\s*)?if \(noteAsideRefusal\) noteAsideRefusal\(busy\);\s*else note\(busy, true\);\s*return "retained";/;
const RE_PAGE_CLEARS_ASIDE_REFUSAL =
	/clearError = useCallback\(\(\) => \{\s*setSendError\(null\);\s*setSendErrorCode\(undefined\);\s*\}, \[\]\);/;
const RE_DISPATCH_CLEARS_ASIDE_REFUSAL = /clearAsideRefusal\?\.\(\);/;
const RE_PANEL_RETURNS_FOCUS = /onReturnFocus\?\.\(\)/g;
const RE_PANEL_DESCRIBED_BY =
	/aria-describedby=\{blocked !== null \? blockedId : undefined\}/;
const RE_PANEL_REASON_ID = /<p id=\{blockedId\}/;
/*
 * The Send control's verb is stated TWICE — the tooltip's content and the button's
 * own accessible name — and each gets its own pin (agent review round 5, R5-2: only
 * the tooltip half was asserted, so the reviewer's M11 mutation — the label reading
 * "Send message" on both arms — left every suite green).
 *
 * Both arms carry the GATE term (R5-3): `chat-page.tsx` resolves a pending `ask`
 * gate before it looks for an aside, and `composerPlaceholder` already orders the
 * gate ahead of the aside term, so a label that named the aside while a gate was
 * pending named a destination the press does not reach.
 */
/*
 * Anchored on the TOOLTIP's own `content={` (agent review round 6, R6-2): the label
 * and the tooltip share one expression, so an unanchored pattern was satisfied by the
 * label alone and a mutation of the tooltip only (M9) passed. The tooltip's WHY
 * comment sits between the brace and the expression, hence the optional block.
 */
const RE_SEND_VERB =
	/content=\{\s*(?:\/\*[\s\S]*?\*\/\s*)?aside !== null && !awaitingAnswer\s*\?\s*"Ask the aside"\s*:\s*"Send message"\s*\}/;
const RE_SEND_LABEL =
	/aria-label=\{\s*aside !== null && !awaitingAnswer\s*\?\s*"Ask the aside"\s*:\s*"Send message"\s*\}/;
/*
 * The cap counts the question's MEASURED box and the gap under it (design round 4,
 * D16). `Q` is a number the panel measures, not an assumption about how many lines a
 * question - or a quote staged in it - takes, because that is the width's decision.
 */
const RE_PANEL_CAP_COUNTS_QUESTION =
	/\$\{question\} \+ \$\{ASIDE_TURN_GAP_REM\}/;
const RE_PANEL_CAP_PASSES_THE_MEASUREMENT =
	/maxHeight: asideExchangeCap\(isSmallView, newestQuestionBox\)/;
const RE_PANEL_CAP_MEASURES_THE_QUESTION =
	/const questionBox = question\s*\?\s*question\.getBoundingClientRect\(\)\.height\s*:\s*null;/;
const RE_PANEL_SCROLLS_TO_TURN =
	/const wanted = asideScrollToTurn\(geometry\);\s*region\.scrollTop = wanted;/;
/*
 * The move toward the question's own top is bounded by two early returns, and the
 * pair is what keeps it from becoming a follow: one for a turn whose target is
 * settled, one for a region the READER has taken over (their scroll is `> 1` away
 * from what this effect last wrote). Design round 3's D11 offered this shape as its
 * option (a) — a fixed target re-applied until it is reached, never past it.
 */
const RE_PANEL_SCROLLS_ONCE =
	/if \(scrollDone\.current === lastTurnId\) return;/;
const RE_PANEL_SCROLLS_UNTIL_REACHED =
	/if \(wanted === Math\.max\(0, asideQuestionTopOffset\(geometry\)\)\) \{\s*scrollDone\.current = lastTurnId;/;
const RE_PANEL_YIELDS_TO_THE_READER =
	/Math\.abs\(region\.scrollTop - written\.offset\) > 1/;
/*
 * The move's trigger is the newest turn's GROWTH, phase included (QA round 4, Q33):
 * the value test below pins what the trigger distinguishes, and this pins that the
 * panel's effect is keyed on it rather than on the answer's length alone.
 */
const RE_PANEL_SCROLL_TRIGGER =
	/const newestTurnGrowth = asideScrollTrigger\(\s*lastTurnId \? streams\[lastTurnId\] : undefined,\s*\);/;
/*
 * The busy line's retirement (U12/D13): the effect is gated on the busy code and
 * asks the same predicate the gate uses, so the line ends with the state it names —
 * on the answer settling and on the panel closing alike.
 */
/*
 * The ONE line both halves of U12 hang on (agent review round 6, R6-3): the busy
 * sentence is raised WITH its code, and the code is what `withholdsRetryHint` drops
 * the "Send it again" suffix for and what the retire effect below is gated on.
 * Without it the line regains the suffix and is never retired, and every value test
 * stays green, because the setter lives in a component this harness cannot mount.
 */
const RE_PAGE_RAISES_THE_BUSY_CODE =
	/const noteAsideRefusal = useCallback\(\(sentence: string\) => \{\s*setSendError\(sentence\);\s*setSendErrorCode\(ASIDE_STILL_ANSWERING_CODE\);\s*\}, \[\]\);/;
const RE_PAGE_RETIRES_THE_BUSY_LINE =
	/if \(sendErrorCode !== ASIDE_STILL_ANSWERING_CODE\) return;\s*if \(asideBusy\) return;\s*clearError\(\);/;
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

/*
 * WHAT ESC DISCARDS IS THE ENTRY THE OWNER HOLDS (UX round 3, U19).
 *
 * The panel sends the user to Escape with "close the aside and discard it", and the
 * id that sentence trusts has to be the entry the exchange lives under. The owner
 * keys that entry by the CONTINUATION that created it - a continuation copies its
 * prefix's turns into a new entry of its own and marks the prefix adopted - so:
 *
 * - after an ANSWERED follow-up the exchange's entry is the newest answered turn, and
 *   the id the ask path continues from is that turn by construction;
 * - after a REFUSED follow-up the owner has DROPPED the refused turn's entry (a
 *   question with no answer is neither continuable nor adoptable), so naming the
 *   newest turn asks it to delete nothing - UX drove exactly that as `404` on
 *   `DELETE .../asides/<refused id>` while the entry holding the whole exchange
 *   answered `GET` `200` with `turns: 2` and was still `200` 9.9s later.
 *
 * So this asserts the id on the wire in both arms, driven through the real store and
 * the real transactions: the answer's own case is the one the reviewer's mutation
 * would leave green (`previousAsideId` happens to equal the answered id there), and
 * the refusal is the case that separates them.
 */
test("closing discards the exchange's own entry, answered or refused", async () => {
	reset();
	/** An owner that answers every aside it is asked. */
	const answer = async (request) => ({
		data: { aside_id: request.requestId, text: "an answer", off_record: true },
	});
	handler = answer;
	const base = await askAside(SESSION, "the base question");
	const followUp = await askAside(SESSION, "the follow-up");
	closeAside(SESSION);
	const answeredClose = calls.at(-1);
	assert.equal(answeredClose.op, "sessions.aside.close");
	assert.equal(answeredClose.asideId, followUp);
	/*
	 * The prefix is NOT the entry: naming it would discard the first turn's own copy
	 * of the exchange while the newest answered turn still held all of it.
	 */
	assert.notEqual(answeredClose.asideId, base);

	reset();
	handler = async (request) =>
		request.text === "a refused follow-up"
			? Promise.reject(
					new DesktopControlError(
						409,
						"The model did not answer your aside in text. No answer was produced: ask again.",
						undefined,
						"aside_unanswered",
					),
				)
			: answer(request);
	const held = await askAside(SESSION, "the base question");
	await assert.rejects(() => askAside(SESSION, "a refused follow-up"));
	const state = useAsideStore.getState();
	const refusedTurn = lastAsideTurn(state, SESSION).asideId;
	// U19's own pair: the newest turn is the refused one, the exchange is the answered
	// one below it, and the two ids are what the close path has to choose between.
	assert.equal(previousAsideId(state, SESSION), refusedTurn);
	assert.equal(lastAnsweredAsideId(state, SESSION), held);
	closeAside(SESSION);
	const refusedClose = calls.at(-1);
	assert.equal(refusedClose.op, "sessions.aside.close");
	assert.equal(
		refusedClose.asideId,
		held,
		"the DELETE names the entry holding the exchange, not the refused turn",
	);
	assert.notEqual(refusedClose.asideId, refusedTurn);
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

/*
 * THE CHORD ASKS ONCE BEFORE IT ADOPTS (UX round 2, U16; the operator's ruling).
 * `⌘+F` is Find everywhere else, adopting cannot be taken back, and it used to
 * commit the exchange 52ms after one press. The chord is kept; the first press
 * states on the panel what a second will do, and only the second adopts - and the
 * second has to be able to be a DECISION, which is what the floor is for (UX round
 * 3, U17).
 */
test("the adopt chord confirms on its first press and adopts on its second", () => {
	/*
	 * The step is keyed on the newest turn: an arm for one exchange never adopts a
	 * later one the user has not seen the confirm for.
	 */
	assert.equal(asideAdoptChordStep(null, "t1", 0), "arm");
	assert.equal(
		asideAdoptChordStep({ turnId: "t1", at: 0 }, "t1", 400),
		"adopt",
	);
	assert.equal(
		asideAdoptChordStep({ turnId: "t1", at: 0 }, "t2", 400),
		"arm",
		"an arm for one exchange never adopts another",
	);
	/*
	 * AND A REFLEX SECOND PRESS IS NOT A SECOND PRESS (UX round 3, U17): UX adopted
	 * with two presses 66ms apart, because the arm was keyed on the turn id and on no
	 * clock. The floor is the only thing that separates the two gestures, so both
	 * sides of it are asserted - the same press at 66ms and just under the boundary
	 * does nothing, and one inside a read of the confirm adopts.
	 */
	assert.equal(
		asideAdoptChordStep({ turnId: "t1", at: 30_708 }, "t1", 30_774),
		"ignore",
		"UX's own 66ms double-tap must not adopt",
	);
	assert.equal(
		asideAdoptChordStep(
			{ turnId: "t1", at: 0 },
			"t1",
			ASIDE_ADOPT_CONFIRM_FLOOR_MS - 1,
		),
		"ignore",
	);
	assert.equal(
		asideAdoptChordStep(
			{ turnId: "t1", at: 0 },
			"t1",
			ASIDE_ADOPT_CONFIRM_FLOOR_MS,
		),
		"adopt",
		"at the boundary the press is a decision",
	);
	/*
	 * The floor is measured from the CONFIRM, not from the last press, so an ignored
	 * press leaves the gesture armed: a third press that follows a read adopts rather
	 * than being swallowed in turn.
	 */
	assert.equal(
		asideAdoptChordStep({ turnId: "t1", at: 1_000 }, "t1", 1_066),
		"ignore",
	);
	assert.equal(
		asideAdoptChordStep({ turnId: "t1", at: 1_000 }, "t1", 1_400),
		"adopt",
	);
	// The threshold is a real one: a floor under the reported reflex would be no floor.
	assert.equal(ASIDE_ADOPT_CONFIRM_FLOOR_MS > 66, true);

	// The receipt names the key and that the act is permanent.
	assert.equal(
		asideAdoptConfirm(true),
		"Press ⌘+F again to add the aside to the conversation. Once added, it stays there.",
	);
	assert.match(asideAdoptConfirm(false), /^Press Ctrl\+F again/);

	// The composer applies it: the first press raises the confirm on the panel's
	// notice line and returns BEFORE `adoptAside`; the second clears the arm and adopts.
	const input = read(
		"src/renderer/src/features/chat/components/message-input.tsx",
	);
	assert.match(
		input,
		/asideAdoptChordStep\(\s*adoptArmedTurn\.current,\s*lastTurn\.asideId,\s*now,\s*\);\s*if \(step === "arm"\) \{\s*adoptArmedTurn\.current = \{ turnId: lastTurn\.asideId, at: now \};\s*useAsideStore\s*\.getState\(\)\s*\.setAsideNotice\(sessionForAside, asideAdoptConfirm\(IS_MAC\)\);\s*return;\s*\}\s*\/\*[\s\S]*?\*\/\s*if \(step === "ignore"\) return;\s*adoptArmedTurn\.current = null;\s*void adoptAside\(sessionForAside\)/,
	);
	// A new ask clears the notice, so a stale confirm cannot sit over a new exchange.
	reset();
	useAsideStore.getState().attachAside(SESSION);
	useAsideStore.getState().setAsideNotice(SESSION, asideAdoptConfirm(true));
	useAsideStore.getState().beginAsk(SESSION, "t2", "next");
	assert.equal(useAsideStore.getState().attached[SESSION].notice, null);
	// And a conversation turn starting withdraws the confirm and the arm, and only
	// the notice the chord raised (R6-5): the second press would fall through there.
	assert.match(
		input,
		/useEffect\(\(\) => \{\s*if \(!asideStreaming \|\| adoptArmedTurn\.current === null\) return;\s*adoptArmedTurn\.current = null;[\s\S]{0,200}?notice === asideAdoptConfirm\(IS_MAC\)\)\s*store\.setAsideNotice\(sessionForAside, null\);\s*\}, \[asideStreaming, asideSessionId\]\);/,
	);
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
 * all). The placeholder is therefore asked as an ORDER: the gate's term must win
 * over the aside's, or the box promises a route the press does not take.
 *
 * Asked BY VALUE through `composerPlaceholder`, the one function the box's
 * placeholder is built from since main's pending-send work (#479) lifted the
 * chain out of the JSX - this used to compare the two literals' offsets in
 * `message-input.tsx`, which only proved the order while the chain was inline.
 * The fold onto that main also placed the aside term against the new
 * `sendingUnsettled` one, so that position is pinned here too.
 */
test("the placeholder names the destination the press actually reaches", () => {
	const idle = {
		unavailable: false,
		inputDisabled: false,
		awaitingAnswer: false,
		asideAttached: false,
		sendingUnsettled: false,
		awaitingReply: false,
	};
	assert.equal(
		COMPOSER_PLACEHOLDER.aside,
		"Ask off the record — Esc closes the aside",
	);
	assert.equal(
		composerPlaceholder({ ...idle, asideAttached: true }),
		COMPOSER_PLACEHOLDER.aside,
	);
	assert.equal(
		composerPlaceholder({ ...idle, asideAttached: true, awaitingAnswer: true }),
		COMPOSER_PLACEHOLDER.answer,
		"the gate's placeholder term must precede the aside's: while a gate is unanswered the press answers the GATE",
	);
	// A box that takes no keystrokes is not invited to take one.
	assert.equal(
		composerPlaceholder({ ...idle, asideAttached: true, inputDisabled: true }),
		COMPOSER_PLACEHOLDER.busy,
	);
	assert.equal(
		composerPlaceholder({ ...idle, asideAttached: true, unavailable: true }),
		COMPOSER_PLACEHOLDER.unavailable,
	);
	/*
	 * And the attached aside outranks BOTH send-state sentences: the next Enter
	 * goes off the record whatever the thread is doing, and an aside's own press
	 * holds `sendInFlight` for its microtask - `Sending your message` there would
	 * describe a message the conversation never receives.
	 */
	assert.equal(
		composerPlaceholder({
			...idle,
			asideAttached: true,
			sendingUnsettled: true,
			awaitingReply: true,
		}),
		COMPOSER_PLACEHOLDER.aside,
	);
	// The wiring: the composer hands the attached panel to the function.
	assert.match(
		read("src/renderer/src/features/chat/components/message-input.tsx"),
		/asideAttached: aside !== null,/,
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
 * A REFUSED CONTINUATION IS THE ONE REFUSAL THE PANEL MAY NEED HELP WITH (U1) — AND
 * ONLY WHEN THE PREFIX IS WHAT WAS REFUSED (UX round 2, U11; round 5, R5-1).
 *
 * With the prefix rule above, a continuation is refused by the owner for two
 * unrelated reasons. When the exchange it names is genuinely gone — the plain-string
 * 409, or the 422 exchange bound — the owner's own sentence ("ask again") is advice
 * that cannot work from that panel, and the escape that does work is Escape and a
 * fresh `/btw`. When the MODEL declines (409 `aside_unanswered` /
 * `aside_empty_answer`) the owner pops that ask's own entry and restores the prefix,
 * so the panel is still continuable and a retry IN PLACE is answered: UX round 2
 * drove exactly that and got an answer 4.7s later, while following the escape clause
 * throws away the whole off-the-record exchange, answers included.
 *
 * So the clause is appended where it is true, on THREE conditions now: the ask
 * continued (a fresh one opens a clean entry), and the refusal is not the model's.
 * The predicate is the code rather than the sentence, because the sentences are the
 * owner's copy.
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

	/*
	 * THE MODEL-DECLINED ARM, DRIVEN THROUGH THE REAL `askAside` on both codes the
	 * owner uses — and the clause is ABSENT from both, because the panel it is printed
	 * on is still usable.
	 */
	for (const code of ["aside_unanswered", "aside_empty_answer"]) {
		reset();
		const declined = new DesktopControlError(
			409,
			"The model did not answer your aside in text. No answer was produced: ask again.",
			undefined,
			code,
		);
		handler = async (request) =>
			request.text === "second"
				? Promise.reject(declined)
				: {
						data: {
							aside_id: request.requestId,
							text: "the answer",
							off_record: true,
						},
					};
		await askAside(SESSION, "first");
		await assert.rejects(() => askAside(SESSION, "second"));
		const refused = useAsideStore.getState().streams[calls[1].requestId];
		/*
		 * The owner's sentence, then BOTH real options and what each costs (the
		 * operator's ruling on U11): asking here keeps the exchange, and Esc - the
		 * key a user reaches for when a panel looks stuck - discards it.
		 *
		 * AND THE REMEDY IS STATED ONCE (UX round 3, U18). The owner's sentence ends
		 * in `ask again.` and the clause opened by saying it again, so the reading was
		 * `No answer was produced: ask again. Ask again here to keep this exchange, or
		 * press Esc...` - the remedy the user needs behind a stutter, seven rows of red
		 * text at narrow. The trailing half of the duplication is dropped where the
		 * clause states the remedy, and the count below is the property rather than the
		 * string: it fails on the stutter coming back, from either half.
		 */
		assert.equal(
			refused.error,
			`${declined.message.replace(/\s+ask again\.$/, "")} ${ASIDE_DECLINED_OPTIONS}`,
			`a ${code} refusal keeps the owner's sentence and states both roads: the panel still continues`,
		);
		assert.equal(
			(refused.error?.match(/ask again/gi) ?? []).length,
			1,
			"the remedy is stated once, and the clause is what states it",
		);
		assert.match(refused.error, /^The model did not answer your aside in text/);
		assert.match(refused.error, /No answer was produced: Ask again here/);
		assert.match(refused.error, /Ask again here to keep this exchange/);
		assert.match(refused.error, /press Esc to close the aside and discard it/);
		assert.equal(
			(refused.error ?? "").includes(ASIDE_CONTINUATION_ESCAPE),
			false,
			"the escape clause would send the user away from a working panel",
		);
		assert.equal(asideModelDeclined(declined), true);
	}
	// The predicate discriminates rather than always answering: the lost prefix carries
	// no code at all, and neither does a transport failure or this app's own codes.
	assert.equal(
		asideModelDeclined(
			new DesktopControlError(409, "This aside is no longer available"),
		),
		false,
	);
	assert.equal(asideModelDeclined(new Error("fetch failed")), false);
	assert.equal(
		asideModelDeclined(
			new DesktopControlError(500, "boom", undefined, "aside_not_answered"),
		),
		false,
		"this app's own code is not one of the owner's two",
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
	assert.equal(
		asidePanelRefusal(
			new DesktopControlError(409, "gone", undefined, "aside_unanswered"),
			true,
		),
		`gone ${ASIDE_DECLINED_OPTIONS}`,
		"continued, but the model declined: the exchange is still continuable",
	);
	// A FRESH ask the model declined has no exchange above it for Esc to cost, so the
	// owner's sentence stands alone - the options clause is a continuation's only.
	assert.equal(
		asidePanelRefusal(
			new DesktopControlError(409, "gone", undefined, "aside_unanswered"),
			false,
		),
		"gone",
	);
	// The lost-prefix clause says what Esc costs as well, since it sends the user there.
	assert.match(ASIDE_CONTINUATION_ESCAPE, /discards this exchange/);
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
 *
 * AND THE LINE IT RAISES IS RETIRED WITH THE CONDITION IT NAMES (UX round 2, U12 and
 * U13; agent review round 5, R5-5; design round 3, D13). Three things were wrong
 * with the sentence, and they are one fix:
 *
 *  - it was followed by the composer's generic "Your message is still in the
 *    composer. Send it again.", so one line told the user to wait and to press now.
 *    The code is what withholds that suffix, and it is on the composer's own
 *    predicate next to the ninth one rather than borrowed from it — this refusal is
 *    "not yet" where that one is "never".
 *  - it stayed on screen after the answer had settled: measured still reading "still
 *    answering" 9.4s later, beside an adopt control that had gone live.
 *  - the `/btw` door wrote the same momentary condition into the TRANSCRIPT as a red
 *    receipt, which stayed between unrelated turns. One condition, one surface, one
 *    lifetime: the composer line, retired when the predicate stops holding.
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

	// The sentence names the press that does work at the moment it starts working.
	assert.equal(
		ASIDE_ASK_BUSY,
		"The aside is still answering. Press Enter again once the answer is in.",
	);
	assert.equal(ASIDE_ASK_BUSY.includes("\u2014"), false);

	const page = read("src/renderer/src/features/chat/components/chat-page.tsx");
	const dispatch = read(
		"src/renderer/src/features/chat/components/slash-dispatch.ts",
	);
	assert.match(page, RE_PAGE_ASIDE_BUSY_GATE);
	assert.match(dispatch, RE_DISPATCH_ASIDE_BUSY_GATE);
	// The text stays with the user: `false` is the composer's refusal-before-
	// admission, and `retained` is the dispatcher's own word for the same outcome.
	assert.match(page, /noteAsideRefusal\(busy\);\s*return false;/);
	assert.match(dispatch, /return "retained";/);
	/*
	 * NEITHER DOOR WRITES THIS ONE TO THE TRANSCRIPT ANY MORE (U13). The composer door
	 * never did; the `/btw` door did, and the only surviving `note(busy, true)` is the
	 * fallback for a caller with no composer line to state it on.
	 */
	assert.equal([...dispatch.matchAll(/note\(busy, true\)/g)].length, 1);
	assert.match(dispatch, /if \(noteAsideRefusal\) noteAsideRefusal\(busy\);/);

	/*
	 * THE CODE, AND ITS CONSEQUENCE. `withholdsRetryHint` is what removes the false
	 * suffix, and the page's retire effect is what removes the stale line — the two
	 * halves of the fix, each pinned where it lives.
	 */
	const sessions = read(
		"src/renderer/src/shared/store/canonical-sessions-store.ts",
	);
	assert.match(
		sessions,
		/export const ASIDE_STILL_ANSWERING_CODE = "aside_still_answering";/,
	);
	assert.match(sessions, /code === ASIDE_STILL_ANSWERING_CODE \|\|/);
	assert.match(page, RE_PAGE_RAISES_THE_BUSY_CODE);
	assert.match(page, RE_PAGE_RETIRES_THE_BUSY_LINE);
	assert.match(page, /noteAsideRefusal,/);
	assert.match(dispatch, /noteAsideRefusal\?: \(sentence: string\) => void;/);
});

/*
 * AN APPENDED TURN IS BROUGHT INTO THE REGION'S VIEW — AND STAYS THERE ONCE THE
 * ANSWER CAN FINALLY PUT IT AT THE TOP (design round 2, D6; round 3, D11).
 *
 * D6: a follow-up asked while the exchange overflows was painted below the region's
 * fold — measured 88px under it at wide, 687px at narrow — so the question, its
 * thinking line and the answer that followed were all invisible and the ask looked
 * as though it had done nothing.
 *
 * D11: the clamp landed the new turn at the region's BOTTOM, because at that moment
 * the turn is only its question and its thinking line (43px of the 248px region at
 * wide). The answer then streamed downward out of view — 43 of 300px visible for the
 * whole stream at wide, 62 of 883px at narrow, the user scrolling nothing while the
 * thumb shrank — so the target D6 chose is re-applied on content growth until the
 * region can actually reach it, and stops there.
 *
 * The scroll is one measurement against the region's own rectangles, so it is a pure
 * function here; the effect that calls it, the two conditions that end the move, and
 * the region's own focusability are asserted from the panel's source.
 */
test("an appended turn is scrolled into the region's view, and on to the question's own top", () => {
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

	/*
	 * THE D11 SEQUENCE, in the numbers the finding measured at wide: a 248px region,
	 * a question whose CONTENT offset is 312.3 (205.3 below the region's top once the
	 * region has scrolled to its 107px end), and three moment samples of one stream.
	 *
	 * `turnTop` is written against `scrollTop` for exactly the reason the helper under
	 * test exists: the two rectangles report where the question is on SCREEN, and the
	 * target is where it is in the content, so a sample at any region position asks
	 * for the same 312.3.
	 */
	const wide = (scrollHeight, scrollTop = 0) => ({
		regionTop: 100,
		turnTop: 412.3 - scrollTop,
		scrollTop,
		scrollHeight,
		clientHeight: 248,
	});
	// The target is the QUESTION, and it does not move as the answer arrives: this is
	// what makes re-applying it a move toward a fixed place rather than a follow.
	assert.equal(asideQuestionTopOffset(wide(355)), 312.3);
	assert.equal(asideQuestionTopOffset(wide(900)), 312.3);
	assert.equal(
		asideQuestionTopOffset(wide(900, 107)),
		312.3,
		"the target is read from content, so the region's own position does not shift it",
	);
	// AT THE APPEND the region cannot get there: 355 − 248 = 107, so the question
	// still sits 205.3px down — the clamp, which is D11's starting point.
	assert.equal(asideScrollToTurn(wide(355)), 107);
	assert.equal(
		asideScrollToTurn(wide(355)) ===
			Math.max(0, asideQuestionTopOffset(wide(355))),
		false,
		"the clamp bit, so the target is not reached and the effect must run again",
	);
	// MID-STREAM the ceiling has grown past the question's offset: this is the moment
	// the one-shot D6 scroll stopped short of.
	assert.equal(asideScrollToTurn(wide(500)), 252);
	assert.equal(asideScrollToTurn(wide(900)), 312.3);
	assert.equal(
		asideScrollToTurn(wide(900)) ===
			Math.max(0, asideQuestionTopOffset(wide(900))),
		true,
		"reached: the question is at the region's top, so the move ends",
	);

	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	assert.match(panel, RE_PANEL_SCROLLS_TO_TURN);
	// ENDED FOR A TURN WHOSE TARGET IS SETTLED — the property that keeps this from
	// running on every chunk of every turn forever.
	assert.match(panel, RE_PANEL_SCROLLS_ONCE);
	// AND ENDED BY THE READER, which is what makes the re-application a move toward a
	// target rather than a pin to content.
	assert.match(panel, RE_PANEL_SCROLLS_UNTIL_REACHED);
	assert.match(panel, RE_PANEL_YIELDS_TO_THE_READER);
	// The per-chunk trigger, so the move survives the answer arriving at all - and
	// the refusal that REPLACES the thinking line with no answer at all (Q33).
	assert.match(panel, RE_PANEL_SCROLL_TRIGGER);
	/*
	 * AND THE TURN'S OWN MEASURED BOX IS THE OTHER ONE (agent review round 7, R7-3,
	 * which UX round 3's U21 then measured in the flow). The store's trigger is
	 * `phase:length`, so it cannot see a box that grew with the store untouched - the
	 * diagram UX drove: the region held 43px, then 625px once the mermaid SVG was in at
	 * 2975ms, with `scrollTop` still 0 and its maximum grown to 377px, leaving the newest
	 * answer cut at the edge with no sign it had grown. The property R7-3 asked for is
	 * that the trigger covers growth rather than the answer's length and phase, and the
	 * pair below is it: the box is measured from the DOM and then named as a dependency.
	 * A partial revert - the measurement kept and the dependency dropped - cannot satisfy
	 * both halves.
	 */
	assert.match(
		panel,
		/const \[newestTurnBox, setNewestTurnBox\] = useState<number \| null>\(\s*null,?\s*\);/,
	);
	assert.match(panel, /const box = node\.getBoundingClientRect\(\)\.height;/);
	assert.match(panel, /observer\.observe\(node\);/);
	// The observed node is the newest TURN's box, which is what holds the answer the
	// diagram lands in - not the question, which is only one of its children.
	assert.match(
		panel,
		/\{\s*turn\.asideId === lastTurnId \? newestTurnRef : undefined\s*\}/,
	);
	assert.match(panel, /\}, \[lastTurnId, newestTurnGrowth, newestTurnBox\]\);/);
	assert.match(panel, RE_PANEL_REGION_FOCUSABLE);
});

/*
 * A REFUSAL THAT REPLACES THE THINKING LINE RE-RUNS THE MOVE (QA round 4, Q33).
 *
 * The move above re-runs as the newest turn grows, and it used to learn of that growth
 * from the answer's LENGTH alone. A refused follow-up grows the turn by up to five
 * lines of alert while the answer stays empty, so nothing re-ran and the region rested
 * at the ceiling the append's clamp had reached: 15-20px of the alert hidden at wide
 * (the clause that says what Esc costs) and 78-117px at narrow (4 of 5 lines), in
 * every case exactly `maxScroll - scrollTop` after the refusal landed.
 *
 * Driven through the REAL store transitions an ask goes through, so the trigger is
 * asserted on the streams the panel actually reads rather than on hand-built ones.
 */
test("a refusal that replaces the thinking line re-runs the move toward the question", () => {
	reset();
	const store = () => useAsideStore.getState();
	const trigger = (id) => asideScrollTrigger(store().streams[id]);

	assert.equal(asideScrollTrigger(undefined), "none");

	// A refused follow-up: in flight with nothing, then refused with nothing. The
	// answer's length is 0 on both sides - the old trigger's blind spot.
	store().beginAsk(SESSION, "turn-refused", "a follow-up the model declines");
	const inFlight = trigger("turn-refused");
	store().failAside(
		"turn-refused",
		"The model did not answer your aside in text.",
	);
	assert.equal(store().streams["turn-refused"].text.length, 0);
	assert.notEqual(
		trigger("turn-refused"),
		inFlight,
		"the refusal grew the turn, so the move must be asked again",
	);

	// A refusal that lands after some chunks is a change too, at the same length.
	store().beginAsk(SESSION, "turn-cut", "a follow-up cut short");
	store().applyAsideDelta("turn-cut", "part");
	const beforeCut = trigger("turn-cut");
	store().failAside("turn-cut", "The aside was not answered.");
	assert.notEqual(trigger("turn-cut"), beforeCut);

	// A settle whose text equals what streamed replaces the live line as well.
	store().beginAsk(SESSION, "turn-settled", "an answered follow-up");
	const live = trigger("turn-settled");
	store().settleAside("turn-settled", "");
	assert.notEqual(trigger("turn-settled"), live);

	/*
	 * AND IT STAYS A TRIGGER, NOT A FOLLOW: an unchanged stream compares equal, so an
	 * idle re-render cannot re-run the effect, and the effect's own two early returns
	 * (target reached, reader scrolled - pinned in the test above) still end the move.
	 */
	assert.equal(trigger("turn-refused"), trigger("turn-refused"));
	assert.equal(
		asideScrollTrigger({
			text: "abc",
			streaming: true,
			settled: false,
			error: null,
		}),
		asideScrollTrigger({
			text: "abc",
			streaming: true,
			settled: false,
			error: null,
		}),
	);
	assert.equal(typeof trigger("turn-refused"), "string");
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
 *
 * THREE FOLLOW-UPS THE ROUND-5 STREAMS MEASURED, all pinned here because they are
 * one surface's cues and nothing else observes them:
 *
 *  - R5-2: the routing cue is stated TWICE — the tooltip's content and the button's
 *    accessible name — and only the tooltip was asserted, so the reviewer's mutation
 *    (the label reading "Send message" on both arms) left every suite green.
 *  - R5-3: the destination is the GATE's while one is pending. `chat-page.tsx`
 *    resolves a pending `ask` gate before it looks for an aside, and
 *    `composerPlaceholder` already orders the gate ahead of the aside term, so a
 *    control naming the aside there named somewhere the press does not reach.
 *  - U15/D15: the settle announcement reads the answer's markup aloud.
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
	// BOTH halves of the verb, each on its own (R5-2), and both carrying the gate
	// term (R5-3).
	assert.match(input, RE_SEND_VERB);
	assert.match(input, RE_SEND_LABEL);
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

	/*
	 * U15/D15: the announcement is PROSE, not the markup it was cut from. The panel
	 * paints this text through `MarkdownRenderer`, so the reader never sees the
	 * markers and must not hear them either.
	 */
	assert.equal(
		asideAnnouncement(
			settledAsideStream(
				"Transport failures and owner **5xx** responses, per provider, within a moving window.",
			),
		),
		"The aside answered: Transport failures and owner 5xx responses, per provider, within a moving window.",
	);
	assert.equal(
		asideAnnouncement(
			settledAsideStream(
				"Read `docs/desktop-controls.md` and __try__ it. Then continue.",
			),
		),
		"The aside answered: Read docs/desktop-controls.md and try it.",
	);
	assert.equal(
		asideAnnouncement(
			settledAsideStream(
				"See [the runbook](https://example.com/x) first. More text.",
			),
		),
		"The aside answered: See the runbook first.",
	);
	// The strip only consumes a MATCHING PAIR, which is what keeps an identifier the
	// reader was going to hear correctly intact.
	assert.equal(
		asideAnnounceableText("a_b_c and a * b and 2 * 3"),
		"a_b_c and a * b and 2 * 3",
	);
});

/*
 * THE CEILING COUNTS THE QUESTION'S MEASURED BOX AND ITS GAP (design round 2, D10;
 * design round 4, D16 with UX round 3's U20/Q46).
 *
 * The cap budgeted answer lines only, while the region also holds the question block
 * and the 4px gap under it - so an answer of nine complete lines measured
 * `scrollHeight` 225 against `clientHeight` 224 and the exchange grew a full-height
 * scrollbar that scrolled 1px and cut nothing (D10). R6-4 then counted ONE line box
 * per staged quote, which is the width's decision rather than the question's, and lost
 * the property at the width where the quote wraps (D16). The cap now takes the question
 * node's own measured height, so the budget left over is a whole number of the answer's
 * line boxes for any question shape - which is what D1 promises and the arithmetic half
 * of the property is asserted on below.
 *
 * THIS IS THE PLUMBING HALF, and it is a pin because the expression cannot be trusted
 * to mean anything if the number handed to it is not a measurement: both halves of the
 * retired rule are gone rather than kept beside the new term, and the measurement is
 * the question paragraph's own box, observed rather than derived («R7-2»: setting the
 * term to a remembered line count left the suite green before this).
 */
test("the ceiling counts the question's measured box and the gap under it", () => {
	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	assert.match(panel, RE_PANEL_CAP_COUNTS_QUESTION);
	assert.match(panel, /const ASIDE_TURN_GAP_REM = "0\.25rem";/);
	assert.match(
		panel,
		/const ASIDE_QUESTION_MIN_BOX = `var\(--text-body-sm\) \* \$\{ASIDE_QUESTION_LINE_HEIGHT\}`;/,
	);

	// The measurement: state the cap reads, a ref for the newest question's own
	// paragraph, and a `ResizeObserver` that writes the box it lays out at.
	assert.match(
		panel,
		/const \[newestQuestionBox, setNewestQuestionBox\] = useState<number \| null>\(\s*null,?\s*\);/,
	);
	assert.match(
		panel,
		/const newestQuestionRef = useRef<HTMLParagraphElement>\(null\);/,
	);
	assert.match(panel, RE_PANEL_CAP_MEASURES_THE_QUESTION);
	assert.match(panel, /const observer = new ResizeObserver\(measure\);/);
	assert.match(panel, /observer\.observe\(node\);/);
	// The ref is the NEWEST turn's: an older question is not the block the edge is
	// measured from.
	assert.match(
		panel,
		/ref=\{\s*turn\.asideId === lastTurnId \? newestQuestionRef : undefined\s*\}/,
	);
	// And the state, not a line count, is what the cap is called with.
	assert.match(panel, RE_PANEL_CAP_PASSES_THE_MEASUREMENT);

	/*
	 * The retired mechanism is GONE, not kept in parallel: a per-quote line count beside a
	 * measured box is two answers to one question, and the one that is right at one width
	 * is the one that is wrong at another. Declarations, not mentions - the cap's own note
	 * names the three the amendment removed, which is how a later reader finds out why the
	 * expression has one term where it had three.
	 */
	assert.doesNotMatch(panel, /newestStagedQuotes/);
	assert.doesNotMatch(
		panel,
		/const ASIDE_QUOTE_PAD_Y_REM|const ASIDE_QUOTE_GAP_REM/,
	);
	assert.doesNotMatch(panel, /quoteBlock/);
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

/*
 * THE CAP CUTS BETWEEN ROWS, PARAGRAPH BREAK OR NOT (design round 1, D1; design
 * round 3, D12, which is D1 regressing).
 *
 * D1's whole-row property is arithmetic: the exchange's `max-height` is a whole
 * number of the answer's own line boxes plus the question block and the 4px under
 * it, so the boundary is the top edge of a row. The question block is the one the
 * panel MEASURES (design round 4, D16); the case this test is built on is a one-line
 * question, where the measurement and the line box are the same 19.5px, and the
 * shapes that separate the two are asserted at the end of it. The property itself
 * only holds while every block boundary INSIDE the answer is a whole number of those
 * boxes too, and
 * `markdown.css` spaces paragraphs by `0.5rem` — which is not. With a paragraph
 * break in the answer, round 3 measured the edge falling 11.9px into a 16.5px glyph
 * box at wide: a row of letter tops under a complete line, on an answer round 2 had
 * measured at 0 cut rows, so round 2's 0 was that answer's luck rather than the fix
 * holding.
 *
 * The numbers below are the ones both rounds derived from the tree, so this is the
 * same arithmetic the panel ships rather than a second derivation of it: `--text-body`
 * at 0.875rem gives a 22.4px answer line box, `--text-body-sm` at 0.8125rem with its
 * 1.5 leading gives a 19.5px question line, `gap-1` is the 4px between them, and the
 * answer's glyph box inside its line box is 16.5px with 2.5px of leading above it.
 */
test("the cap cuts between rows even when the answer has a paragraph break", () => {
	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	const css = read("src/renderer/src/features/chat/components/markdown.css");
	const styles = read("src/renderer/src/styles/index.css");

	// The terms, from the tree rather than from this file.
	assert.match(panel, /const ASIDE_EXCHANGE_LINES = 10;/);
	assert.match(panel, /const ASIDE_ANSWER_LINE_HEIGHT = 1\.6;/);
	assert.match(styles, /--text-body: 0\.875rem;/);
	assert.match(styles, /--text-body-sm: 0\.8125rem;/);
	assert.match(styles, /--text-body-sm--line-height: 1\.5;/);
	assert.match(panel, /const ASIDE_TURN_GAP_REM = "0\.25rem";/);

	const ROOT_PX = 16;
	const answerLineBox = 0.875 * ROOT_PX * 1.6;
	const questionLineBox = 0.8125 * ROOT_PX * 1.5;
	const turnGap = 0.25 * ROOT_PX;
	const cap = questionLineBox + turnGap + 10 * answerLineBox;
	const contentTop = questionLineBox + turnGap;
	const glyphBox = 16.5;
	const glyphLead = 2.5;
	const near = (a, b) => Math.abs(a - b) < 0.05;
	assert.equal(near(answerLineBox, 22.4), true, "the answer's line box");
	assert.equal(near(cap, 247.5), true, "the cap the panel derives");

	// D1's own property, stated: the budget left for the ANSWER is a whole number of
	// its line boxes, so the cap is exactly a row boundary from the content's top.
	assert.equal(near((cap - contentTop) / answerLineBox, 10), true);
	assert.equal(
		Number.isInteger(Math.round((cap - contentTop) / answerLineBox)),
		true,
	);

	/** Whether the cap's edge falls inside the glyphs of a row starting here. */
	const cuts = (lineBoxTop) => {
		const top = lineBoxTop + glyphLead;
		return top < cap && top + glyphBox > cap;
	};

	/* The rule the aside now states, and the one it replaced. */
	assert.match(css, /\.lo-markdown p \{\s*margin: 0\.5rem 0;\s*\}/);
	assert.match(
		css,
		/\.lo-markdown--row-grid p \{\s*margin: calc\(1em \* var\(--md-line-height, 1\.6\)\) 0;\s*\}/,
	);
	assert.match(panel, /const ASIDE_ANSWER_ROW_GRID = "lo-markdown--row-grid";/);
	assert.match(panel, /className=\{ASIDE_ANSWER_ROW_GRID\}/);

	/*
	 * THE RISING ROW, at every paragraph length. One line box of gap keeps the second
	 * paragraph on the same grid from the content's top, so no row can straddle the
	 * edge — which is the property, and it is not a property of one lucky answer.
	 */
	const gridGap = answerLineBox;
	for (let rows = 1; rows <= 20; rows++) {
		const secondParagraphTop = contentTop + rows * answerLineBox + gridGap;
		/*
		 * Stated as the ROW INDEX rather than as `% lineBox === 0`: these are floats, and
		 * `112 % 22.400000000000002` is 22.399999999999999 in this language, so the
		 * remainder form would fail on a correct grid roughly every time.
		 */
		assert.equal(
			near((secondParagraphTop - contentTop) / answerLineBox, rows + 1),
			true,
			`a ${rows}-row first paragraph leaves the next one on the grid`,
		);
		assert.equal(
			cuts(secondParagraphTop),
			false,
			`a ${rows}-row first paragraph cannot put a row across the edge`,
		);
	}

	/*
	 * AND THE COUNTERFACTUAL, on the very answer round 3 measured: a nine-row first
	 * paragraph and the old `0.5rem` gap put the next row's glyphs at 235.6-252.1,
	 * across a 247.5 edge — 11.9px into a 16.5px glyph box, which is the reported
	 * figure. This is what makes the loop above a fix rather than a tautology.
	 */
	const measuredRow = contentTop + 9 * answerLineBox;
	const oldGap = 0.5 * ROOT_PX;
	assert.equal(near(measuredRow + oldGap + glyphLead, 235.6), true);
	assert.equal(near(cap - (measuredRow + oldGap + glyphLead), 11.9), true);
	assert.equal(cuts(measuredRow + oldGap), true);
	// The paragraph the retired gap cut, named in the finding.
	assert.equal(near(measuredRow + oldGap + glyphLead + glyphBox, 252.1), true);
	// The row immediately ABOVE the edge is complete either way: the defect is the
	// cut row, not the number of rows shown.
	assert.equal(cuts(measuredRow), false);

	/*
	 * AND WITH THE QUESTION BLOCK'S OWN MEASURED BOX (design round 4, D16, which
	 * replaces R6-4's per-quote term; UX round 3's U20/Q46 drove it in the flow).
	 *
	 * R6-4 counted ONE line box per staged quote, which is a fact about the RENDERED
	 * WIDTH rather than about the quote - the same 44-character quote is one line at
	 * 1380 and two at 800 - so the identity this half asserts held only where that
	 * assumption happened to be true. It EVALUATES the panel's own `asideExchangeCap`
	 * body - the shipped expression, with its constants read from the file and its tokens
	 * resolved at the root size - for every question shape the review named, at both
	 * widths, and then reproduces design round 4's own figures from the rule it replaced.
	 */
	const capSource = panel.match(
		/const asideExchangeCap = \([^)]*\): string => \{\n([\s\S]*?)\n\};/,
	);
	assert.ok(capSource, "the cap is the arrow function this test evaluates");
	const constant = (name) => {
		const found = panel.match(new RegExp(`const ${name} = ([^;]+);`));
		assert.ok(found, `${name} is a constant of the panel`);
		return JSON.parse(found[1]);
	};
	/*
	 * The floor the cap uses before the node is measured is a token EXPRESSION rather than
	 * a literal, so it is read as the shape it is: one line of the question's own step.
	 * That is the binding the retired class-to-constant test held for the quote's classes -
	 * of that term's two halves, the measured box is now a NUMBER the panel observes and
	 * this floor is the only arithmetic left to bind.
	 */
	assert.match(
		panel,
		/const ASIDE_QUESTION_MIN_BOX = `var\(--text-body-sm\) \* \$\{ASIDE_QUESTION_LINE_HEIGHT\}`;/,
	);
	const ASIDE_QUESTION_MIN_BOX = `var(--text-body-sm) * ${constant("ASIDE_QUESTION_LINE_HEIGHT")}`;
	const capExpression = new Function(
		"isSmallView",
		"questionBox",
		"asideAnswerType",
		"ASIDE_ANSWER_LINE_HEIGHT",
		"ASIDE_EXCHANGE_LINES",
		"ASIDE_TURN_GAP_REM",
		"ASIDE_QUESTION_MIN_BOX",
		capSource[1],
	);
	/** The `calc()` the panel ships, in px, at the tokens `index.css` defines. */
	const shippedCap = (isSmallView, questionBox) => {
		const calc = capExpression(
			isSmallView,
			questionBox,
			(small) => ({
				fontSize: small ? "var(--text-body-sm)" : "var(--text-body)",
			}),
			constant("ASIDE_ANSWER_LINE_HEIGHT"),
			constant("ASIDE_EXCHANGE_LINES"),
			constant("ASIDE_TURN_GAP_REM"),
			ASIDE_QUESTION_MIN_BOX,
		);
		const arithmetic = calc
			.replace(/^calc/, "")
			.replaceAll("var(--text-body-sm)", String(0.8125 * ROOT_PX))
			.replaceAll("var(--text-body)", String(0.875 * ROOT_PX))
			.replace(/([\d.]+)rem/g, (_, rem) => String(Number(rem) * ROOT_PX))
			/*
			 * `Q` arrives as `${questionBox}px` - the measured number, which is the whole point
			 * of the term - and `px` is the unit this arithmetic is already in.
			 */
			.replace(/([\d.]+)px/g, "$1");
		assert.match(arithmetic, /^[\d.\s+*()]+$/, `the cap resolves: ${calc}`);
		return new Function(`return ${arithmetic};`)();
	};

	/*
	 * THE SHAPES, each as the question block's MEASURED height: no quote (D10 and D12's
	 * plain case), the 44-character quote the R6-4 cases stage as the ONE line box it is
	 * at 1380 and the TWO it wraps to at 800, two staged quotes, a wrapped quote under a
	 * three-line question, and the six- and seven-line questions of D16's narrow arm.
	 */
	const quoteBlock = (lines) =>
		lines * questionLineBox + 2 * 0.125 * ROOT_PX + 0.25 * ROOT_PX;
	const SHAPES = [
		{ what: "no quote", box: questionLineBox },
		{ what: "one quote", box: quoteBlock(1) + questionLineBox },
		{ what: "a wrapping quote", box: quoteBlock(2) + questionLineBox },
		{ what: "two quotes", box: 2 * quoteBlock(1) + questionLineBox },
		{
			what: "a wrapping quote under a three-line question",
			box: quoteBlock(2) + 3 * questionLineBox,
		},
		{ what: "a six-line question", box: 6 * questionLineBox },
		{ what: "a seven-line question", box: 7 * questionLineBox },
	];
	// The quote block QA's frame measured: a 23.5px rule plus the 4px under it.
	assert.equal(near(quoteBlock(1), 27.5), true, "the staged quote's block");
	// D10 and D12's plain case is unchanged: no quote, the same 247.5 edge.
	assert.equal(
		near(shippedCap(false, questionLineBox), cap),
		true,
		"no quote, same cap",
	);

	/** Whether an edge at `edge` falls inside the glyphs of a row starting at `rowTop`. */
	const cutsAt = (edge, rowTop) => {
		const top = rowTop + glyphLead;
		return top < edge && top + glyphBox > edge;
	};
	for (const isSmallView of [false, true]) {
		const lineBox = (isSmallView ? 0.8125 : 0.875) * ROOT_PX * 1.6;
		const where = isSmallView ? "narrow" : "wide";
		for (const shape of SHAPES) {
			const answerTop = shape.box + turnGap;
			const rows = (shippedCap(isSmallView, shape.box) - answerTop) / lineBox;
			assert.equal(
				near(rows, 10),
				true,
				`${shape.what} at ${where}: the edge is ${rows.toFixed(2)} line boxes below the answer's top, not 10`,
			);
			/*
			 * AND NO ROW IS CUT: every row's glyphs sit on one side of the edge. The row AFTER
			 * the last whole one is included on purpose - the cut D16 reports is that row's
			 * letter tops showing, which an exact `rows` alone would not name - and the glyph
			 * box is the wide one at both widths, which is the larger of the two and so cannot
			 * hide a cut at narrow.
			 */
			for (let row = 0; row <= 10; row++) {
				assert.equal(
					cutsAt(answerTop + 10 * lineBox, answerTop + row * lineBox),
					false,
					`${shape.what} at ${where}: row ${row} is cut by the edge`,
				);
			}
		}
	}
	/*
	 * THE COUNTERFACTUAL, on the shapes design round 4 measured: the rule this replaces -
	 * one question line, one line box per staged quote - put the edge (259 - 70.5) / 20.8 =
	 * 9.1 line boxes below the answer's top at narrow with a wrapping quote, 5.3 under a
	 * six-line question and 4.4 under a seven-line one, against the 259px cap the report
	 * names for the first and 231.5px for the others. Reproducing those figures from the
	 * same three steps is what makes the matrix a fix rather than a tautology; the loop
	 * after it is the same three shapes under the shipped rule, at 10.0.
	 */
	const legacyCap = (isSmallView, quoteCount) =>
		(isSmallView ? 0.8125 : 0.875) *
			ROOT_PX *
			constant("ASIDE_ANSWER_LINE_HEIGHT") *
			constant("ASIDE_EXCHANGE_LINES") +
		questionLineBox * (quoteCount + 1) +
		quoteCount * quoteBlock(0) +
		turnGap;
	const narrowLineBox = 0.8125 * ROOT_PX * 1.6;
	const wrappingQuote = SHAPES[2].box;
	const sixLine = SHAPES[5].box;
	const sevenLine = SHAPES[6].box;
	assert.equal(
		near(legacyCap(true, 1), 259),
		true,
		"the retired cap, as measured",
	);
	assert.equal(near(legacyCap(true, 0), 231.5), true, "and with no quote");
	assert.equal(
		near(wrappingQuote + turnGap, 70.5),
		true,
		"the answer's top under a wrapping quote, as measured",
	);
	assert.equal(
		near((legacyCap(true, 1) - wrappingQuote - turnGap) / narrowLineBox, 9.1),
		true,
		"the retired rule's edge at narrow, which design round 4 reported as 9.1",
	);
	assert.equal(
		near((legacyCap(true, 0) - sixLine - turnGap) / narrowLineBox, 5.3),
		true,
	);
	assert.equal(
		near((legacyCap(true, 0) - sevenLine - turnGap) / narrowLineBox, 4.4),
		true,
	);
	for (const box of [wrappingQuote, sixLine, sevenLine]) {
		assert.equal(
			near((shippedCap(true, box) - box - turnGap) / narrowLineBox, 10),
			true,
			"the shipped rule holds the whole-line edge where the retired one did not",
		);
	}
});

/*
 * AN OFF-PANEL REFUSAL FITS THE LINE THAT SHOWS IT (design round 3, D14).
 *
 * The composer's alert caps at six rows of `leading-5` (120px) and scrolls the
 * excess, and with the owner's whole sentence for a model refusal the composed
 * sentence ran to seven rows at the app's minimum window — the part that went out of
 * sight being `ask again`, so the operator read a refusal and no way out of it. The
 * panel has no cap and keeps the owner's sentence; the two off-panel surfaces do, and
 * the short form exists for exactly one arm because exactly one arm is long.
 */
test("an off-panel refusal keeps its remedy inside the line that shows it", () => {
	const declined = new DesktopControlError(
		409,
		"The model did not answer your aside in text — either a tool call, which is not available off the record, or nothing at all. No answer was produced: ask again.",
		undefined,
		"aside_unanswered",
	);
	const question =
		"walk me through the retry ladder end to end, from the first 5xx to the last provider";
	assert.equal(
		question.length > 60,
		true,
		"long enough for the quote to be cut",
	);

	const short = asideOffPanelRefusal(question, declined);
	assert.equal(short.length <= ASIDE_OFF_PANEL_MAX_CHARS, true, short);
	assert.equal(
		short.endsWith("Ask again."),
		true,
		"the remedy survives the cut",
	);
	assert.equal(short.includes("either a tool call"), false);
	assert.equal(short.includes("<reply-to>"), false);
	// The remedy is the SAME PANEL, which is what asking again in place does (U11's
	// own driven measurement) — not the `/btw` door, which would be U11's defect.
	assert.equal(short.includes("/btw"), false);

	/*
	 * THE OTHER ARMS KEEP THE OWNER'S SENTENCE VERBATIM, and they fit: the two the
	 * owner writes for a lost prefix and a refused field are a fraction of the budget,
	 * which is why the short form is keyed on the model refusals rather than applied
	 * to every cause.
	 */
	const lostPrefix = asideOffPanelRefusal(
		question,
		new DesktopControlError(409, "This aside is no longer available"),
	);
	assert.equal(
		lostPrefix.endsWith("This aside is no longer available"),
		true,
		"a lost prefix is still the owner's own sentence",
	);
	assert.equal(lostPrefix.length <= ASIDE_OFF_PANEL_MAX_CHARS, true);
	assert.equal(asideModelDeclined(declined), true);
});

/*
 * THE ADOPT REASON'S ORDER IS U3's RULE, AND IT IS PINNED HERE (agent review round
 * 5, R5-4).
 *
 * U3: the wait was derived from `settled` where the paint uses `streaming`, so "a
 * moment" sat under a complete answer. The fix is that the conversation's own work
 * outranks the settling term — and the reviewer's mutation (moving it back) left
 * `btw-aside` at 42/42, because nothing asserted the two terms TOGETHER.
 */
test("the conversation's work outranks the settling term in the adopt reason", () => {
	const both = asideAdoptBlockedReason(beginAsideStream(), true);
	assert.equal(typeof both, "string");
	assert.equal(
		both.includes("would splice a message into a live turn"),
		true,
		"the conversation's sentence is the one a streaming aside prints",
	);
	assert.equal(
		both.includes("still settling"),
		false,
		"and the settling sentence is not printed beside it",
	);
	// The settling term is not lost, only ranked: on its own it is what an idle
	// session shows under a streaming exchange.
	const settling = asideAdoptBlockedReason(beginAsideStream(), false);
	assert.equal(settling.includes("still settling"), true);
});

/*
 * THE PANEL PAINTS THE QUESTION THE USER SENT, NOT THE PAYLOAD IT TRAVELLED IN (UX
 * round 2, U14).
 *
 * An aside ask carries the string `buildSendPayload` assembles, so a question asked
 * with a staged quote reaches the panel as the quote's markup followed by the typed
 * words — and the panel painted that verbatim, `<reply-to>` and all, while the
 * transcript renders the identical string as a quote block (QA round 3, observation
 * 3, first exercised here). The panel now renders it through `parseReplies`, the one
 * reader of that format, shared with the transcript and the legacy paper path.
 */
test("the panel renders a staged quote instead of the payload's markup", () => {
	const payload =
		"<reply-to>within a moving window</reply-to>\nTOOLCALL2 SLOW: refused with a quote staged";
	const { replies, remainingContent } = parseReplies(payload);
	assert.equal(replies.length, 1);
	assert.equal(replies[0].text, "within a moving window");
	assert.equal(remainingContent, "TOOLCALL2 SLOW: refused with a quote staged");

	const panel = read(
		"src/renderer/src/features/chat/components/aside-panel.tsx",
	);
	assert.match(
		panel,
		/import \{ parseReplies \} from "\.\.\/utils\/reply-utils";/,
	);
	assert.match(panel, /\(\) => parseReplies\(question\)/);
	// The quote keeps the transcript's own shape, and the typed words are the
	// question — so the two surfaces cannot describe one payload two ways.
	assert.match(panel, /border-hairline border-l-2 py-0\.5 pl-2/);
	assert.match(panel, /\{remainingContent\}/);
	// The question reaches the renderer through the reader, not as a string.
	assert.match(panel, /<AsideQuestion question=\{turn\.question\} \/>/);
});
