import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * Exercise the shipped decision model and the real React list, not a second
 * copy of its mount logic. The DOM checks prove that the class reaches the
 * actual row; the model checks pin the stream/identity rules without timing or
 * a daemon. No animation timing is simulated here: the browser frames cover
 * the motion itself and its reduced-motion override.
 */
const bundle = await build({
	stdin: {
		contents: `export {TeamBridgeMessageList} from './src/renderer/src/features/team-bridge/team-bridge-message-list'; export {TeamBridgeThreadPaneView, pagingSettled} from './src/renderer/src/features/team-bridge/team-bridge-thread-pane'; export {teamBridgeArrivalStreamKey, teamBridgeLiveArrivals, teamBridgeObserveArrivals, teamBridgeOpenEmptyArrivals, teamBridgeSuspendArrivals, resetTeamBridgeArrivals} from './src/renderer/src/features/team-bridge/team-bridge-arrival-model'; export {createRoot} from 'react-dom/client'; export {act} from 'react'; export {createElement} from 'react';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	external: ["react", "react-dom/server"],
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
});
const { writeFile, unlink } = await import("node:fs/promises");
const path = `${process.cwd()}/.arrival-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(path);
} finally {
	await unlink(path);
}

const {
	TeamBridgeMessageList,
	TeamBridgeThreadPaneView,
	teamBridgeLiveArrivals,
	teamBridgeArrivalStreamKey,
	teamBridgeObserveArrivals,
	teamBridgeOpenEmptyArrivals,
	teamBridgeSuspendArrivals,
	resetTeamBridgeArrivals,
	createRoot,
	act,
	createElement,
} = mod;

function message(id, seq, extra = {}) {
	return {
		id,
		conversation_id: "bcv_arrival",
		seq,
		sender: { account_id: "acct_sender", kind: "human", display_label: "Ada" },
		body: id,
		origin: "human",
		created_at: "2026-10-26T10:00:00Z",
		...extra,
	};
}

const key = "tenant/conversation";
const ids = (result) => [...result].sort();

test("initial load and a refetch do not animate", () => {
	resetTeamBridgeArrivals();
	assert.deepEqual(ids(teamBridgeLiveArrivals(key, [message("a", 1)])), []);
	assert.deepEqual(ids(teamBridgeLiveArrivals(key, [message("a", 1)])), []);
});

test("an older page stays still, and the newer page above the watermark animates", () => {
	resetTeamBridgeArrivals();
	teamBridgeLiveArrivals(key, [message("b", 2), message("c", 3)]);
	assert.deepEqual(
		ids(
			teamBridgeLiveArrivals(key, [
				message("a", 1),
				message("b", 2),
				message("c", 3),
			]),
		),
		[],
	);
	teamBridgeLiveArrivals(key, [message("b", 2), message("c", 3)]);
	assert.deepEqual(
		ids(
			teamBridgeLiveArrivals(key, [
				message("b", 2),
				message("c", 3),
				message("history", 4),
			]),
		),
		["history"],
	);
});

test("a conversation switch has an independent initial load", () => {
	resetTeamBridgeArrivals();
	teamBridgeLiveArrivals("tenant/one", [message("a", 1)]);
	assert.deepEqual(
		ids(teamBridgeLiveArrivals("tenant/two", [message("a", 1)])),
		[],
	);
	assert.deepEqual(
		ids(
			teamBridgeLiveArrivals("tenant/one", [
				message("a", 1),
				message("live", 2),
			]),
		),
		["live"],
	);
});

test("a live incoming message and a fresh send animate once", () => {
	resetTeamBridgeArrivals();
	teamBridgeLiveArrivals(key, [message("a", 1)]);
	assert.deepEqual(
		ids(teamBridgeLiveArrivals(key, [message("a", 1), message("incoming", 2)])),
		["incoming"],
	);
	assert.deepEqual(
		ids(
			teamBridgeLiveArrivals(key, [
				message("a", 1),
				message("incoming", 2),
				message("sent", 3),
			]),
		),
		["sent"],
	);
	assert.deepEqual(
		ids(
			teamBridgeLiveArrivals(key, [
				message("a", 1),
				message("incoming", 2),
				message("sent", 3),
			]),
		),
		[],
	);
});

test("an open empty conversation animates its first live message", () => {
	resetTeamBridgeArrivals();
	teamBridgeObserveArrivals(key, []);
	assert.deepEqual(ids(teamBridgeLiveArrivals(key, [message("first", 1)])), [
		"first",
	]);
});

test("a closed stream restores messages learned while away without motion", () => {
	resetTeamBridgeArrivals();
	teamBridgeLiveArrivals(key, [message("a", 1)]);
	teamBridgeSuspendArrivals(key);
	assert.deepEqual(
		ids(teamBridgeLiveArrivals(key, [message("a", 1), message("away", 2)])),
		[],
	);
});

test("read does not consume an arrival before a React commit", () => {
	resetTeamBridgeArrivals();
	teamBridgeLiveArrivals(key, [message("a", 1)]);
	const next = [message("a", 1), message("live", 2)];
	assert.deepEqual(ids(teamBridgeLiveArrivals(key, next, { commit: false })), [
		"live",
	]);
	assert.deepEqual(ids(teamBridgeLiveArrivals(key, next, { commit: false })), [
		"live",
	]);
	teamBridgeObserveArrivals(key, next);
	assert.deepEqual(ids(teamBridgeLiveArrivals(key, next)), []);
});

/*
 * REVIEW ROUND 1 — the three ways the arrival half still animated history. Each
 * drives the shipped list (or the shipped pane) through the same harness the
 * happy-path test uses, because all three were decisions made in a component,
 * not in the model: A1 in the list's token state, A2 in the thread pane's
 * unmount, A3 in the page's empty-conversation effect.
 */

test("A1: a conversation switch cannot carry arrival tokens across streams", async () => {
	const { render, teardown, arrivingIds } = domList();
	const aKey = teamBridgeArrivalStreamKey("t", "conv_a");
	const bKey = teamBridgeArrivalStreamKey("t", "conv_b");
	try {
		const a1 = message("a1", 1);
		const a2 = message("a2", 2);
		await render([a1], aKey);
		await render([a1, a2], aKey);
		assert.deepEqual(arrivingIds(), ["a2"]);
		/*
		 * Switch inside the motion, exactly as the page does: one list instance,
		 * a new key. `seq` is numbered per conversation, so B's second message
		 * shares `a2`'s sequence number - the collision the tokens used to leak on.
		 */
		await render([message("b1", 1), message("b2", 2)], bKey);
		assert.deepEqual(arrivingIds(), []);
	} finally {
		await teardown();
	}
});

test("A1: a held arrival is released by a bounded timer, not only animationend", async () => {
	const { render, teardown, arrivingIds } = domList();
	const held = teamBridgeArrivalStreamKey("t", "conv_held");
	try {
		const one = message("h1", 1);
		await render([one], held);
		await render([one, message("h2", 2)], held);
		assert.deepEqual(arrivingIds(), ["h2"]);
		/*
		 * `animationend` never fires under `prefers-reduced-motion` and does not
		 * fire when the row unmounts mid-motion. The timer is what keeps that from
		 * leaving a token behind, so the test waits it out rather than dispatching
		 * the event.
		 */
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 900));
		});
		await render([one, message("h2", 2)]);
		assert.deepEqual(arrivingIds(), []);
	} finally {
		await teardown();
	}
});

test("A2: the thread pane's root list is its own stream, and never animates", () => {
	/*
	 * SOURCE PIN, and the finding's actual reproduction: at the reviewed head the
	 * root list passed NO key, so it defaulted to the timeline's own - and because
	 * the pane is keyed per root, closing a thread unmounted that list and
	 * suspended the open timeline's stream. The behaviour test below exercises the
	 * mechanism; this is what refuses the regression.
	 */
	const pane = readFileSync(
		`${process.cwd()}/src/renderer/src/features/team-bridge/team-bridge-thread-pane.tsx`,
		"utf8",
	);
	assert.match(
		pane,
		/messages=\{\[root\]\}\s*[\s\S]{0,400}?arrivalKey=\{`\$\{teamBridgeArrivalStreamKey\(tenantId, root\.conversation_id\)\}\/root`\}/,
		"the thread pane's root list must carry its own arrival key: without one it takes the timeline's, and closing the thread suspends the open timeline",
	);
	assert.match(
		pane,
		/messages=\{\[root\]\}[\s\S]{0,600}?arrivalsEnabled=\{false\}/,
		"the root is a single row and must never animate",
	);
});

test("A2: opening and closing a thread leaves the open timeline animating", async () => {
	const { render, renderElement, teardown, arrivingIds } = domList();
	const timelineKey = teamBridgeArrivalStreamKey("t", "conv_timeline");
	const timeline = [message("x", 1)];
	try {
		await render(timeline, timelineKey);
		// The pane's root list: its own key, and it never animates.
		await renderElement(
			createElement(TeamBridgeMessageList, {
				messages: [{ ...message("root", 9), id: "root" }],
				labelFor: (sender) => sender.display_label,
				arrivalKey: `${timelineKey}/root`,
				arrivalsEnabled: false,
			}),
		);
		// Closing the thread unmounts that list, then the timeline gets a message.
		await render(timeline, timelineKey);
		await render([...timeline, message("y", 2)], timelineKey);
		assert.deepEqual(arrivingIds(), ["y"]);
	} finally {
		await teardown();
	}
});

test("A3: an empty conversation visited once does not animate its later history", async () => {
	const { render, teardown, arrivingIds } = domList();
	const bKey = teamBridgeArrivalStreamKey("t", "conv_empty");
	try {
		/*
		 * The page's own sequence. While B is ready and empty the page renders the
		 * empty paragraph, so NO list is mounted to notice anything - the two seams
		 * below ARE that state: marked open while on screen, suspended on leaving.
		 * A3 was the missing second half: nothing ever suspended it, so the stream
		 * stayed live forever and every later message animated on return.
		 */
		teamBridgeOpenEmptyArrivals(bKey);
		teamBridgeSuspendArrivals(bKey);
		// Back in B, with the three messages written while the reader was away.
		await render([message("b1", 1), message("b2", 2), message("b3", 3)], bKey);
		assert.deepEqual(arrivingIds(), []);
	} finally {
		await teardown();
	}
});

test("A3: the page suspends an empty stream on a key change, not on the read", () => {
	/*
	 * SOURCE PIN, because the two seams above are only the page's *contract*: the
	 * bug was that no caller performed the second one. The cleanup must hang off
	 * the key (a leave or a switch), not off `messages` - suspending when the
	 * first message lands would make that message a restore and swallow the one
	 * arrival this feature exists for.
	 */
	const page = readFileSync(
		`${process.cwd()}/src/renderer/src/features/team-bridge/team-bridge-page.tsx`,
		"utf8",
	);
	assert.match(
		page,
		/useLayoutEffect\(\s*\(\) => \(\) => teamBridgeSuspendArrivals\(timelineArrivalKey\),\s*\[timelineArrivalKey\],\s*\)/,
		"the empty-conversation mark is never suspended: the page must return a cleanup that suspends the key it opened, scoped to the key rather than to the message list",
	);
});

/*
 * M2 — the forward-pagination hold. A thread's "load more" page is restored
 * history, so the replies list must not animate it; the hold must lift the
 * moment the read settles, whatever it returned. The hold used to clear only
 * when the page GREW, which left it stuck on after a failed or empty page and
 * silently froze every later live reply in that thread.
 *
 * The decision is `nextPaging`'s neighbour in production (`nextPagingHold`
 * below is the pane's own function, imported from it), so these three cases are
 * the shipped one rather than a re-implementation. The pane itself cannot be
 * mounted here: `TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD` is false in this
 * build and the view renders nothing, which is why the wiring is pinned by the
 * source assertion below instead of by a rendered pane.
 */
for (const [outcome, page] of [
	["grows", { loadingMore: false, replies: 2 }],
	["fails", { loadingMore: false, loadingFailed: true }],
	["comes back empty", { loadingMore: false, empty: true }],
]) {
	test(`M2: the hold releases when the next page ${outcome}`, () => {
		// The read was in flight, then it settled with this outcome.
		const settled = mod.pagingSettled({
			loadingMore: page.loadingMore,
			sawInFlight: true,
			grew: Boolean(page.replies),
		});
		assert.equal(
			settled,
			true,
			`${outcome}: a settled read must lift the hold, or every later live reply in the thread stays still`,
		);
	});
}

test("M2: the hold survives the click's own render, before the read reports", () => {
	// click -> paging true while `loadingMore` is still false and nothing has
	// arrived: holding here is what stops the page animating when it lands.
	assert.equal(
		mod.pagingSettled({ loadingMore: false, sawInFlight: false, grew: false }),
		false,
	);
	assert.equal(
		mod.pagingSettled({ loadingMore: true, sawInFlight: false, grew: false }),
		false,
	);
});

test("M2: the pane renders the hold and releases it on settle", () => {
	const pane = readFileSync(
		`${process.cwd()}/src/renderer/src/features/team-bridge/team-bridge-thread-pane.tsx`,
		"utf8",
	);
	assert.match(
		pane,
		/arrivalsEnabled=\{!paging\}/,
		"the replies list must take its animation from the hold",
	);
	assert.match(
		pane,
		/pagingSettled\(\{/,
		"the pane must release the hold through `pagingSettled`",
	);
	assert.match(
		pane,
		/setTimeout\(\(\) => setPaging\(false\), 10_000\)/,
		"a read that never reports must not hold the pane forever: keep the backstop",
	);
});

/*
 * A JSDOM + React root with the shipped list mounted, so the arrival decision is
 * exercised through the component the app renders rather than a model double.
 * `unmount` tears the tree down; the caller always does it in a `finally`.
 */
function domList(initial) {
	const dom = new JSDOM(
		"<!doctype html><html><body><div id=root></div></body></html>",
		{ url: "http://localhost/" },
	);
	const previous = new Map();
	for (const name of [
		"window",
		"document",
		"navigator",
		"HTMLElement",
		"Node",
		"Element",
		"MutationObserver",
		"getComputedStyle",
	]) {
		if (dom.window[name] !== undefined) {
			previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
			Object.defineProperty(globalThis, name, {
				configurable: true,
				writable: true,
				value: dom.window[name],
			});
		}
	}
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	resetTeamBridgeArrivals();
	const container = dom.window.document.getElementById("root");
	const root = createRoot(container);
	const renderElement = async (element) => {
		await act(async () => {
			root.render(element);
		});
	};
	const render = (messages, arrivalKey = key, arrivalsEnabled = undefined) =>
		renderElement(
			createElement(TeamBridgeMessageList, {
				messages,
				labelFor: (sender) => sender.display_label,
				arrivalKey,
				arrivalsEnabled,
			}),
		);
	const teardown = async () => {
		await act(async () => root.unmount());
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
		globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
		dom.window.close();
	};
	const arrivingIds = () =>
		[...container.querySelectorAll(".lo-team-bridge-arrival")].map(
			(row) => row.dataset.messageId,
		);
	return { dom, container, render, renderElement, teardown, arrivingIds };
}

test("the real list puts arrival only on the newly arrived row", async () => {
	const { dom, container, render, teardown } = domList();
	try {
		const first = message("history", 1);
		await render([first]);
		assert.equal(
			container.querySelectorAll(".lo-team-bridge-arrival").length,
			0,
		);
		const live = message("live", 2);
		await render([first, live]);
		assert.deepEqual(
			[...container.querySelectorAll(".lo-team-bridge-arrival")].map(
				(row) => row.dataset.messageId,
			),
			["live"],
		);
		/*
		 * An unrelated re-render during the 240ms window must NOT drop the class:
		 * that snapped the row to its final state mid-motion before this fix.
		 */
		await render([first, { ...live, body: "live body updated" }]);
		assert.deepEqual(
			[...container.querySelectorAll(".lo-team-bridge-arrival")].map(
				(row) => row.dataset.messageId,
			),
			["live"],
		);
		// The class is released by the browser's own event, then stays released.
		const row = container.querySelector('[data-message-id="live"]');
		await act(async () => {
			row.dispatchEvent(
				new dom.window.Event("animationend", { bubbles: true }),
			);
		});
		await render([first, { ...live, body: "live body updated" }]);
		assert.equal(
			container.querySelectorAll(".lo-team-bridge-arrival").length,
			0,
		);
		/*
		 * M1 REGRESSION: a re-render must not suspend the stream. With the
		 * suspend cleanup attached to the messages dependency, the next live
		 * message arrives as a "restore" and never animates.
		 */
		const later = message("later", 3);
		await render([first, { ...live, body: "live body updated" }, later]);
		assert.deepEqual(
			[...container.querySelectorAll(".lo-team-bridge-arrival")].map(
				(row) => row.dataset.messageId,
			),
			["later"],
		);
	} finally {
		await teardown();
	}
});
