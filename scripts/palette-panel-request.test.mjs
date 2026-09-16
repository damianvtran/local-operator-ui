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
const { PANEL_REQUEST_TTL_MS, usePanelPresentationStore } = module;

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
