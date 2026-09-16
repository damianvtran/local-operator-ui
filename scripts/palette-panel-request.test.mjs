import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The palette's request to open a panel, its consumption by a presenter, and the
 * claim that arbitrates between the two presenters.
 *
 * All of it is pure state, so it is pinned here rather than inferred from a
 * mounted host: what makes this mechanism safe is that a request is ONE-SHOT
 * (matched on its own nonce), that a request nothing could consume expires
 * instead of firing later against a pane the user has since opened for another
 * reason, and that two hosts mounted at once still produce exactly one presenter.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/panel-presentation-store";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { PANEL_REQUEST_TTL_MS, shellHostAction, usePanelPresentationStore } =
	module;

const store = () => usePanelPresentationStore.getState();

test("nothing is pending until something asks", () => {
	assert.equal(store().request, null);
});

test("a request names its destination and carries its own identity", () => {
	store().requestPanel("usage");
	const first = store().request;
	assert.equal(first.destination, "usage");
	assert.equal(typeof first.nonce, "number");
	assert.ok(first.requestedAt > 0);

	store().requestPanel("info");
	const second = store().request;
	assert.notEqual(second.nonce, first.nonce);
	assert.equal(second.destination, "info");
});

test("the consumer retires the request it acted on", () => {
	store().requestPanel("analytics");
	const nonce = store().request.nonce;
	store().consumePanel(nonce);
	assert.equal(store().request, null);
});

test("a stale consumer cannot clear a newer request", () => {
	/*
	 * The one race this mechanism has: the pane reads a request, and by the time
	 * it retires it the user has asked for another one. Matching on the nonce
	 * means the older consumer retires only what it consumed, so the newer request
	 * is still there for the next mount to act on — rather than being swallowed by
	 * a consumer that never saw it.
	 */
	store().requestPanel("usage");
	const stale = store().request.nonce;
	store().requestPanel("info");
	store().consumePanel(stale);
	assert.equal(store().request.destination, "info");
	store().consumePanel(store().request.nonce);
	assert.equal(store().request, null);
});

test("the expiry is short enough to be a bound, not a backlog", () => {
	/*
	 * The number is a judgement, so it is pinned rather than left free: long
	 * enough to cover a route change (milliseconds) and short enough that a
	 * request nobody could consume cannot arrive as a surprise later.
	 */
	assert.ok(PANEL_REQUEST_TTL_MS > 1000);
	assert.ok(PANEL_REQUEST_TTL_MS <= 30_000);
});

/*
 * The claim, which is what lets TWO hosts share the one presentation slot.
 *
 * The store cannot decide which host presents by looking at the route: the chat
 * route also paints its connecting and error states, where nothing can present
 * anything, so a route check strands a request that no pane can consume until it
 * expires. The question is therefore "is a presenter mounted", asked of the
 * presenters — and these are the four properties that make the answer safe.
 */

test("nobody has claimed the slot until a presenter mounts", () => {
	assert.equal(store().presenterClaimed, false);
});

test("a claim is visible while it is held and gone once it is released", () => {
	const release = store().claimPresenter();
	assert.equal(store().presenterClaimed, true);
	release();
	assert.equal(store().presenterClaimed, false);
});

test("two overlapping claims do not let the first release clear the second", () => {
	/*
	 * The pane swap this exists for: React mounts the incoming pane before it
	 * unmounts the outgoing one, so the two claims overlap. With a single boolean
	 * the outgoing pane's release would clear the incoming pane's claim and the
	 * shell host would then present a session-scoped request the pane was about to
	 * answer.
	 */
	const outgoing = store().claimPresenter();
	const incoming = store().claimPresenter();
	outgoing();
	assert.equal(
		store().presenterClaimed,
		true,
		"the incoming pane still owns the slot",
	);
	incoming();
	assert.equal(store().presenterClaimed, false);
});

test("a release called twice cannot decrement someone else's claim", () => {
	/*
	 * A cleanup that somehow runs twice — a caller holding the release past its
	 * effect — must not take away a claim it does not own.
	 */
	const first = store().claimPresenter();
	const release = store().claimPresenter();
	release();
	release();
	assert.equal(store().presenterClaimed, true);
	first();
	assert.equal(store().presenterClaimed, false);
});

test("the claim is not disturbed by requests coming and going", () => {
	const release = store().claimPresenter();
	store().requestPanel("analytics");
	assert.equal(store().presenterClaimed, true);
	store().consumePanel(store().request.nonce);
	assert.equal(store().presenterClaimed, true);
	release();
	assert.equal(store().presenterClaimed, false);
});

/*
 * The invoker, which is what makes closing a shell-presented panel leave the
 * keyboard where the user was (UX round 1, U1).
 *
 * It rides with the request because the requester is the last one who can see
 * it: the palette holds focus in its own search field, and the panel's mount
 * removes that field in the same commit — so a host that read
 * `document.activeElement` when the request ARRIVED recorded a node that was
 * already gone, and closing the panel dropped focus on `document.body`.
 */

test("a request carries the control to return focus to", () => {
	const row = { focus() {} };
	store().requestPanel("info", row);
	assert.equal(store().request.invoker, row);
	/*
	 * And a caller with no control to name gets `null` rather than a guess: the
	 * honest fallback is the host's (whatever is focused when it presents), not a
	 * field silently holding a stale node from the request before this one.
	 */
	store().requestPanel("usage");
	assert.equal(store().request.invoker, null);
});

/*
 * What the SHELL host does with a request, which is the arbitration the second
 * presenter adds — and the one state a render cannot be driven into from a test
 * (code review round 1, M1).
 *
 * The gesture, in full, because the order of the branches is the fix:
 *
 *   1. On `/settings` with a session in the store, the palette opens Analytics.
 *      No pane is mounted, so the shell host presents it.
 *   2. The palette chord opens again OVER the panel, and the user picks Session —
 *      a pane-only destination. The palette writes the request and routes to
 *      `/chat`, so a pane is mounting in the SAME commit, and it will present
 *      the picker.
 *   3. The shell host must therefore yield. Before this rule it returned early
 *      for a destination it cannot present — leaving its own panel up — and the
 *      pane's picker opened underneath it: two stacked modals, the lower one with
 *      no cue about where it came from.
 */

test("the shell host presents a machine request when no pane owns the slot", () => {
	store().requestPanel("analytics");
	assert.equal(
		shellHostAction({
			request: store().request,
			presentable: true,
			claimed: false,
			now: store().request.requestedAt,
		}),
		"present",
	);
});

test("the shell host leaves a machine request to the pane that claimed the slot", () => {
	store().requestPanel("analytics");
	assert.equal(
		shellHostAction({
			request: store().request,
			presentable: true,
			claimed: true,
			now: store().request.requestedAt,
		}),
		"hold",
	);
});

test("a request the shell host cannot present makes it yield, panel or no panel", () => {
	store().requestPanel("session.diagnostics");
	/*
	 * Both values of `claimed`, because the gesture's own race is which host's
	 * effect React runs first: the pane claims in the same commit the request
	 * arrives, so a rule that asked the claim first would have depended on that
	 * ordering. Yielding on the destination alone does not.
	 */
	for (const claimed of [false, true]) {
		assert.equal(
			shellHostAction({
				request: store().request,
				presentable: false,
				claimed,
				now: store().request.requestedAt,
			}),
			"yield",
			`a pane-only request must be handed to the pane (claimed: ${claimed})`,
		);
	}
});

test("a request nothing can still consume is retired rather than acted on", () => {
	store().requestPanel("info");
	const request = store().request;
	assert.equal(
		shellHostAction({
			request,
			presentable: true,
			claimed: false,
			now: request.requestedAt + PANEL_REQUEST_TTL_MS + 1,
		}),
		"retire",
	);
	/*
	 * And the TTL is asked BEFORE the destination: an expired pane-only request is
	 * still retired, which is what stops the store holding a destination for the
	 * life of the window on a route no pane ever mounts on.
	 */
	assert.equal(
		shellHostAction({
			request,
			presentable: false,
			claimed: false,
			now: request.requestedAt + PANEL_REQUEST_TTL_MS + 1,
		}),
		"retire",
	);
	store().consumePanel(request.nonce);
});

test("no request is nothing to do, not a decision", () => {
	assert.equal(
		shellHostAction({
			request: null,
			presentable: true,
			claimed: false,
			now: Date.now(),
		}),
		null,
	);
});
