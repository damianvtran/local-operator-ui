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
				beginAsideStream,
				settledAsideStream,
				failedAsideStream,
				previousAsideId,
			} from "./src/renderer/src/shared/store/aside-store";
			export {
				askAside,
				adoptAside,
				closeAside,
				openAsidePanel,
				asideAdoptChord,
				asideAdoptCap,
				asideAdoptReady,
				asideAdoptBlockedReason,
			} from "./src/renderer/src/features/chat/aside";
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
	alias: { "@shared": "./src/renderer/src/shared" },
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
						// own sentence), anything else is not.
						contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error, fallback) =>
							error instanceof DesktopControlError || error instanceof UserFacingError
								? String(error.message || fallback)
								: fallback;
						export const desktopResult = (request) => globalThis.__asideRequest(request);`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});

const {
	useAsideStore,
	applyAsideDelta,
	beginAsideStream,
	settledAsideStream,
	failedAsideStream,
	previousAsideId,
	askAside,
	adoptAside,
	closeAside,
	openAsidePanel,
	asideAdoptChord,
	asideAdoptCap,
	asideAdoptReady,
	asideAdoptBlockedReason,
	DesktopControlError,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The assertions' own regex literals, HOISTED to the top level: this tree's
 * `useTopLevelRegex` rule charges a literal constructed inside a function, and
 * `scripts/` sits outside `pnpm lint`'s path list, so `pnpm lint:scripts` (which
 * compares each changed file against its base) is the only gate that would have
 * said so — the same shape `canonical-chat.test.mjs` records at its own top.
 */
const RE_ADOPT_SESSION_WORKING = /would splice a message into a live turn/;
const RE_ADOPT_NOTHING = /nothing to add/;
const RE_ADOPT_NO_EXCHANGE = /no exchange to add/;
const RE_ASIDE_RECEIPT =
	/Receipt<"aside_delta", \{ aside_id: string; delta: string \}>/;
const RE_ASIDE_EVENT = /Event<"aside_delta"/;
const RE_ASIDE_DELTA = /aside_delta/;
const RE_ROUTE_DELTA = /applyAsideDelta\(frame\.payload\.aside_id/;
const RE_ROUTE_DELTAS = /applyAsideDeltas\(frames\)/;
const RE_PANEL_LABEL = /aria-labelledby=\{titleId\}/;
const RE_MODAL_MARKS = /role="dialog"|role="alertdialog"|aria-modal/;
const RE_DIALOG_IMPORTS = /picker-host|ui\/dialog|ui\/sheet|ui\/popover/;
const RE_PANEL_MOUNT = /<AsidePanel/;
const RE_PANEL_GATE = /asideSessionId && aside !== null/;
const RE_DESTINATION = /"session\.aside": \{ kind: "aside" \}/;
const RE_OLD_PICKER = /AsidePicker/;
const RE_DISPATCH_ASIDE = /if \(entry\?\.kind === "aside"\)/;
const RE_DISPATCH_ASK = /askAside\(sessionId, args\)/;
const RE_DISPATCH_OPEN = /openAsidePanel\(sessionId\)/;

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
		throw new DesktopControlError("Close an aside or wait for it to expire");
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
			? Promise.reject(new DesktopControlError("This aside cannot be adopted"))
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
			? Promise.reject(new DesktopControlError("Wait for the aside to finish"))
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
		"Wait for the answer before adding this to the conversation.",
	);
	// The TUI's second: splicing a message into a live batch is a request no
	// provider accepts.
	assert.equal(asideAdoptReady(settled, true), false);
	assert.match(
		asideAdoptBlockedReason(settled, true) ?? "",
		RE_ADOPT_SESSION_WORKING,
	);
	// And a failed ask offers nothing to add.
	assert.equal(
		asideAdoptReady(failedAsideStream(undefined, "no"), false),
		false,
	);
	assert.match(
		asideAdoptBlockedReason(failedAsideStream(undefined, "no"), false) ?? "",
		RE_ADOPT_NOTHING,
	);
	// No aside at all is its own sentence rather than a crash.
	assert.equal(asideAdoptReady(undefined, false), false);
	assert.match(
		asideAdoptBlockedReason(undefined, false) ?? "",
		RE_ADOPT_NO_EXCHANGE,
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
