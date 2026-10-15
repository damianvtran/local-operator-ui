import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/main/browser/page-controls.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { PageControls, PAGE_ZOOM_STEPS } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
function tab(id, owner = "user") {
	const wc = new EventEmitter();
	let request = 0;
	let factor = 1;
	const calls = [];
	Object.assign(wc, {
		isDestroyed: () => false,
		findInPage: (query, options) => {
			calls.push({ query, options });
			return ++request;
		},
		stopFindInPage: (action) => calls.push({ stop: action }),
		getZoomFactor: () => factor,
		setZoomFactor: (value) => {
			factor = value;
			calls.push({ zoom: value });
		},
	});
	return {
		tabId: id,
		owner,
		handedTo: null,
		presented: true,
		documentEpoch: 1,
		view: { webContents: wc },
		calls,
	};
}
test("find request/document/tab fences reject stale native counts; hide/close clears selection", () => {
	let changed = 0;
	const c = new PageControls(() => changed++);
	const a = tab(1);
	const b = tab(2);
	c.open(a);
	c.search(a, "hello", true, false);
	assert.equal(
		c.state(a).find.pending,
		true,
		"no match is not known until native result",
	);
	a.view.webContents.emit(
		"found-in-page",
		{},
		{ requestId: 1, activeMatchOrdinal: 1, matches: 8 },
	);
	assert.deepEqual(c.state(a).find, {
		tabId: 1,
		query: "hello",
		ordinal: 1,
		matches: 8,
		pending: false,
		unreported: false,
	});
	c.search(a, "other", true, false);
	a.view.webContents.emit(
		"found-in-page",
		{},
		{ requestId: 1, activeMatchOrdinal: 8, matches: 8 },
	);
	assert.equal(c.state(a).find.matches, 0);
	c.search(a, "other", false, true);
	assert.deepEqual(a.calls.at(-1), {
		query: "other",
		options: { forward: false, findNext: true },
	});
	c.reconcile(b);
	assert.equal(c.state(b).find, null);
	assert.equal(a.view.webContents.listenerCount("found-in-page"), 0);
	a.view.webContents.emit(
		"found-in-page",
		{},
		{ requestId: 3, activeMatchOrdinal: 3, matches: 3 },
	);
	assert.equal(c.state(b).find, null);
	c.open(b);
	c.search(b, "new", true, false);
	b.documentEpoch++;
	b.view.webContents.emit(
		"found-in-page",
		{},
		{ requestId: 1, activeMatchOrdinal: 4, matches: 9 },
	);
	assert.equal(c.state(b).find, null);
	c.open(b);
	b.presented = false;
	assert.equal(c.state(b).find, null);
	assert.equal(b.calls.at(-1).stop, "clearSelection");
	assert.equal(changed, 1, "only the matching live result broadcasts counts");
});
test("bounded native steps, independent tab factors, agent notice and pre-transfer reset", () => {
	const c = new PageControls(() => {});
	const a = tab(1);
	const b = tab(2);
	for (let i = 0; i < 30; i++) c.zoom(a, "in");
	assert.equal(c.state(a).zoom, 5);
	assert.equal(c.state(b).zoom, 1);
	for (let i = 0; i < 40; i++) c.zoom(a, "out");
	assert.equal(c.state(a).zoom, 0.25);
	c.zoom(a, "reset");
	c.zoom(a, "in");
	c.zoom(a, "in");
	c.zoom(a, "in");
	assert.equal(c.state(a).zoom, 1.5);
	c.prepareAgent(a);
	assert.equal(a.view.webContents.getZoomFactor(), 1);
	a.owner = "agent";
	c.zoom(a, "in");
	assert.equal(c.state(a).zoom, 1);
	assert.match(c.state(a).notice, /Zoom is off for tabs an agent is driving/);
	assert.equal(c.state(b).notice, null);
	assert.equal(PAGE_ZOOM_STEPS[0], 0.25);
	assert.equal(PAGE_ZOOM_STEPS.at(-1), 5);
});
test("find on an agent tab is cleared before an agent read/screenshot; no page injection", () => {
	const c = new PageControls(() => {});
	const a = tab(1, "agent");
	c.open(a);
	c.search(a, "private words", true, false);
	assert.equal(c.state(a).find.query, "private words");
	c.prepareAgent(a);
	assert.equal(c.state(a).find, null);
	assert.equal(a.calls.at(-2).stop, "clearSelection");
	assert.equal(a.view.webContents.getZoomFactor(), 1);
});

test("silent native result has a bounded neutral outcome; stop/switch cancels it", async () => {
	let changes = 0;
	const c = new PageControls(() => changes++, 10);
	const a = tab(1);
	c.search(a, "waiting", true, false);
	assert.equal(c.state(a).find.pending, true);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(c.state(a).find.pending, false);
	assert.equal(c.state(a).find.unreported, true);
	assert.equal(a.calls.at(-1).stop, "clearSelection");
	a.view.webContents.emit(
		"found-in-page",
		{},
		{ requestId: 1, activeMatchOrdinal: 1, matches: 99, finalUpdate: true },
	);
	assert.equal(c.state(a).find.matches, 0, "late timed-out result is fenced");
	c.search(a, "waiting", true, true);
	assert.equal(
		a.calls.at(-1).options.findNext,
		false,
		"Enter after timeout retries an initial native search",
	);
	c.clear();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(changes, 1, "clear cancels deadline; no orphan publication");
	assert.equal(c.state(a).find, null);
});
