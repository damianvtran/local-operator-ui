import assert from "node:assert/strict";
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
		contents: `export {TeamBridgeMessageList} from './src/renderer/src/features/team-bridge/team-bridge-message-list'; export {teamBridgeLiveArrivals, teamBridgeNextSeq, teamBridgeObserveArrivals, teamBridgeSuspendArrivals, resetTeamBridgeArrivals} from './src/renderer/src/features/team-bridge/team-bridge-arrival-model'; export {createRoot} from 'react-dom/client'; export {act} from 'react'; export {createElement} from 'react';`,
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
	teamBridgeLiveArrivals,
	teamBridgeNextSeq,
	teamBridgeObserveArrivals,
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

test("pagination restores older and newer history without motion", () => {
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

test("optimistic to confirmed aliases preserve the one-shot decision", () => {
	resetTeamBridgeArrivals();
	teamBridgeLiveArrivals(key, [message("a", 1)]);
	const optimistic = {
		id: "client-ref",
		client_ref: "client-ref",
		seq: teamBridgeNextSeq(key),
	};
	assert.deepEqual(
		ids(teamBridgeLiveArrivals(key, [message("a", 1), optimistic])),
		["client-ref"],
	);
	assert.deepEqual(
		ids(
			teamBridgeLiveArrivals(key, [
				message("a", 1),
				message("server-id", 2, { client_ref: "client-ref" }),
			]),
		),
		[],
	);
	assert.deepEqual(
		ids(
			teamBridgeLiveArrivals(key, [
				message("a", 1),
				message("server-id", 2, { client_ref: "client-ref" }),
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

test("the real list puts arrival only on the newly arrived row", async () => {
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
	const render = async (messages) => {
		await act(async () => {
			root.render(
				createElement(TeamBridgeMessageList, {
					messages,
					labelFor: (sender) => sender.display_label,
					arrivalKey: key,
				}),
			);
		});
	};
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
	} finally {
		await act(async () => root.unmount());
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
		globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
		dom.window.close();
	}
});
