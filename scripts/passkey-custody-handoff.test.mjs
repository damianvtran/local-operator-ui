/**
 * The renderer's handoff give-back (design U1/D3).
 *
 * WHY THIS FILE EXISTS, AND WHAT IT NO LONGER COVERS. It used to also pin
 * "passkey custody": an agent tab was held while a password manager's prompt was
 * up, and every agent action on it was refused. That model is gone — operator
 * requirement, 2026-11-23: a passkey request must not hold or steal an
 * agent-owned tab. The acceptance matrix for the replacement lives in
 * `scripts/auth-request.test.mjs`; what remains here is the courtesy that
 * outlived it: when a wait ENDS, a user who deliberately followed it from its
 * sidebar row gets their conversation, route, draft and pane back — and only if
 * they are still where the handoff put them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { CustodyHandoffs } from "./src/renderer/src/shared/browser-passkey-custody-handoff";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	external: ["electron"],
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/");',
	},
});
const { CustodyHandoffs } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const viewB = {
	pathname: "/chat",
	activeSessionId: "session:b",
	activeDraftKey: null,
	browserPaneOpen: false,
};
const toA = { kind: "conversation", sessionId: "session:a" };

test("U1: the user is given back their conversation and route when still on the handoff view", () => {
	const handoffs = new CustodyHandoffs();
	const handoff = handoffs.begin({ tabId: 1, at: 5 }, toA, viewB);
	assert.deepEqual(handoff, {
		pathname: "/chat",
		activeSessionId: "session:a",
		activeDraftKey: null,
		browserPaneOpen: true,
	});
	assert.deepEqual(handoffs.end({ tabId: 1, at: 5 }, handoff), {
		session: "session:b",
	});
	const fromSettings = { ...viewB, pathname: "/settings" };
	const again = handoffs.begin({ tabId: 1, at: 6 }, toA, fromSettings);
	assert.deepEqual(handoffs.end({ tabId: 1, at: 6 }, again), {
		session: "session:b",
		navigate: "/settings",
	});
});

test("U1: a deliberate move during the wait is kept (conversation, route, pane closed)", () => {
	for (const moved of [
		{ activeSessionId: "session:c" },
		{ pathname: "/browser" },
		{ browserPaneOpen: false },
		{ activeDraftKey: "draft-1" },
	]) {
		const handoffs = new CustodyHandoffs();
		const handoff = handoffs.begin({ tabId: 1, at: 5 }, toA, viewB);
		assert.equal(
			handoffs.end({ tabId: 1, at: 5 }, { ...handoff, ...moved }),
			null,
			JSON.stringify(moved),
		);
	}
});

test("U1: same conversation with its pane closed: only the pane the handoff opened is closed", () => {
	const handoffs = new CustodyHandoffs();
	const before = { ...viewB, activeSessionId: "session:a" };
	const handoff = handoffs.begin({ tabId: 1, at: 5 }, toA, before);
	assert.deepEqual(handoffs.end({ tabId: 1, at: 5 }, handoff), {
		closeBrowserPane: true,
	});
	const open = { ...before, browserPaneOpen: true };
	const none = handoffs.begin({ tabId: 1, at: 7 }, toA, open);
	assert.equal(
		handoffs.end({ tabId: 1, at: 7 }, none),
		null,
		"nothing moved, nothing to give back",
	);
});

test("U1: a draft and the browser route come back; a repeat attention for the same wait moves nothing", () => {
	const handoffs = new CustodyHandoffs();
	const drafting = {
		...viewB,
		activeSessionId: null,
		activeDraftKey: "draft-9",
	};
	const handoff = handoffs.begin({ tabId: 1, at: 5 }, toA, drafting);
	assert.equal(
		handoffs.begin({ tabId: 1, at: 5 }, toA, handoff),
		null,
		"same identity: no second move",
	);
	assert.deepEqual(handoffs.end({ tabId: 1, at: 5 }, handoff), {
		openDraft: "draft-9",
	});
	const browser = handoffs.begin(
		{ tabId: 2, at: 8 },
		{ kind: "browser" },
		viewB,
	);
	assert.deepEqual(handoffs.end({ tabId: 2, at: 8 }, browser), {
		navigate: "/chat",
	});
	assert.equal(
		handoffs.end({ tabId: 2, at: 8 }, browser),
		null,
		"an ended wait gives back once",
	);
});
