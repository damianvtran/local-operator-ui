import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The palette's request to open a panel, and the pane's consumption of it.
 *
 * Both halves are pure state, so they are pinned here rather than inferred from
 * a mounted pane: what makes this mechanism safe is that a request is ONE-SHOT
 * (matched on its own nonce), and that a request nothing could consume expires
 * instead of firing later against a pane the user has since opened for another
 * reason.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/chat-panel-request-store";',
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
const { PANEL_REQUEST_TTL_MS, useChatPanelRequestStore } = module;

const store = () => useChatPanelRequestStore.getState();

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
