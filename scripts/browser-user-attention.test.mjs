/**
 * The browser never takes the user's view; it lists what it is waiting on.
 *
 * WHY THIS FILE EXISTS. Operator report 2026-11-15: the desktop app's browser
 * was "stealing the view" — a password manager's prompt in an agent's tab
 * ("Your password manager needs you in this agent's tab … the agent is paused
 * on this tab … Return to agent") switched him into the Browser from wherever
 * he was. His ask: "fix that and make sure that any browser approvals, etc show
 * up as notifications in the sidebar instead and the user can then decide when
 * they're able to interact with that instead of forcing the interaction".
 *
 * Each trigger is pinned on both halves:
 *   - ARRIVAL moves nothing: no tab activation, no window raise or popup
 *     presentation, no route/conversation/pane change;
 *   - it appears as a notification row (and so in the Browser badge count);
 *   - the row's CLICK lands on the right tab with the prompt visible, and only
 *     then may custody give the view back.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/user-attention";',
			'export { effectivePresentation } from "./src/main/browser/popups";',
			'export * from "./src/renderer/src/shared/browser-user-attention";',
			'export { consentClickTarget } from "./src/renderer/src/shared/browser-consent-attention";',
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
const {
	attentionArrivals,
	HeldPopups,
	browserAttentionRows,
	consentClickTarget,
	createCustodyAttention,
	effectivePresentation,
	holdsPopup,
	openBrowserAttention,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const read = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ONEPASSWORD = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
const PROMPT = `chrome-extension://${ONEPASSWORD}/inline/notification/notification.html?language=en#type=notificationManager`;
const GONE = { isDestroyed: () => true };

/** A registry and channel that record everything the custody wiring does. */
function rig({ active = 7, tabs = [1, 7] } = {}) {
	const calls = [];
	const state = { active, tabs: new Set(tabs) };
	const attention = createCustodyAttention({
		registry: {
			exists: (tabId) => state.tabs.has(tabId),
			activeTabId: () => state.active,
			activate: (tabId) => {
				calls.push(["activate", tabId]);
				state.active = tabId;
			},
		},
		clearNotice: (tabId) => calls.push(["clearNotice", tabId]),
		notifyChanged: () => calls.push(["changed"]),
		sendEnded: (view) => calls.push(["ended", view.tabId, view.at]),
	});
	return { attention, calls, state };
}

// ---- main: the passkey custody hold ----------------------------------------

test("a passkey request arrival: the tab is NOT activated and nothing is raised; the projection is re-published", () => {
	const { attention, calls, state } = rig();
	// A pending request is RECORDED and projected; it never arrives as a view
	// steal (operator requirement, 2026-11-23). The old passkey WAITING row and
	// the "paused on this tab" copy are gone with the tab lock
	// (`extensions/auth-request.ts`), so this module is driven by the request view
	// and nothing else.
	attention.onBegin({ tabId: 1, at: 500 });
	assert.deepEqual(
		calls,
		[["clearNotice", 1], ["changed"]],
		"a stale notice band is cleared (R1) and the projection refreshed — nothing else",
	);
	assert.equal(state.active, 7, "the user's browser tab did not move");
	// A PASSIVE autofill card is not a request: nothing records it, so nothing can
	// reach this module for it (see `scripts/auth-request.test.mjs`).
});

test("passkey hold: the row's click activates the tab; the hold ending gives the user's tab back", () => {
	const { attention, calls, state } = rig();
	attention.onBegin({ tabId: 1, at: 5 });
	attention.userOpened(1);
	assert.equal(state.active, 1, "the held tab is now the one in front");
	assert.deepEqual(calls.slice(2), [
		["clearNotice", 1],
		["activate", 1],
	]);
	calls.length = 0;
	attention.onEnd({ tabId: 1, at: 5 });
	assert.deepEqual(calls, [
		["clearNotice", 1],
		["activate", 7],
		["ended", 1, 5],
	]);
});

test("passkey hold ended without the user ever opening it: nothing is activated, the row clears", () => {
	const { attention, calls, state } = rig();
	attention.onBegin({ tabId: 1, at: 5 });
	attention.onEnd({ tabId: 1, at: 5 });
	assert.equal(state.active, 7);
	assert.deepEqual(calls, [
		["clearNotice", 1],
		["changed"],
		["clearNotice", 1],
		["changed"],
		["ended", 1, 5],
	]);
});

test("passkey hold: a tab the user picked after opening it is kept on release", () => {
	const { attention, calls, state } = rig({ tabs: [1, 7, 9] });
	attention.userOpened(1);
	state.active = 9;
	calls.length = 0;
	attention.onEnd({ tabId: 1, at: 5 });
	assert.equal(state.active, 9);
	assert.ok(!calls.some(([kind]) => kind === "activate"));
});

test("source: the custody wiring asks for no raise and the trigger is gone from the union", () => {
	const index = read("src/main/browser/index.ts");
	const raise = read("src/main/window-raise.ts");
	assert.doesNotMatch(
		index,
		/\braiseWindow\b\s*\(/,
		"no raiseWindow call in the browser host",
	);
	assert.doesNotMatch(index, /trigger: "passkey-custody"/);
	assert.doesNotMatch(
		raise,
		/\|\s*"passkey-custody"/,
		"the raise name cannot be used again",
	);
	assert.doesNotMatch(
		index,
		/PASSKEY_CUSTODY_ATTENTION_CHANNEL|browser-passkey-custody-attention/,
		"no attention push the shell could navigate on",
	);
	assert.doesNotMatch(
		read("src/preload/index.ts"),
		/onPasskeyCustodyAttention/,
	);
	assert.doesNotMatch(
		read("src/renderer/src/app.tsx"),
		/onPasskeyCustodyAttention/,
	);
});

// ---- main: popups an agent's page opens ------------------------------------

test("agent popup arrival: held hidden (never presented), listed, and released when it closes", () => {
	// The opener's presentation for an agent tab is `inactive` under a normal or
	// inactive launch (`effectivePresentation`), which used to `showInactive()` —
	// on macOS that still ordered a window over whatever the operator was doing.
	for (const mode of ["focus", "inactive"]) {
		const presentation = effectivePresentation(mode, "new-window", "agent");
		assert.equal(holdsPopup("agent", presentation), true, mode);
	}
	assert.equal(
		holdsPopup("agent", "never"),
		false,
		"headless stays hidden for good, no row",
	);
	assert.equal(
		holdsPopup("user", effectivePresentation("focus", "new-window", "user")),
		false,
		"the popup a person just clicked for keeps its presentation",
	);
	assert.equal(holdsPopup(null, "focus"), false);

	const held = new HeldPopups(() => 42);
	const window = { isDestroyed: () => false };
	held.hold(3, window);
	assert.deepEqual(held.entries(), [{ kind: "popup", tabId: 3, at: 42 }]);
	assert.equal(held.release(window), true);
	assert.deepEqual(
		held.entries(),
		[],
		"a popup that finished on its own clears its row",
	);
	assert.equal(held.release(window), false);
});

test("agent popup: the row's click hands over every live held window once", () => {
	const held = new HeldPopups(() => 1);
	const live = { isDestroyed: () => false };
	const dead = { isDestroyed: () => true };
	held.hold(3, live);
	held.hold(3, dead);
	assert.deepEqual(held.take(3), [live]);
	assert.deepEqual(held.take(3), []);
	assert.deepEqual(held.entries(), []);
});

test("source: wirePopup holds an agent's popup BEFORE any presentation, and only a click presents it", () => {
	const index = read("src/main/browser/index.ts");
	const wire = index.slice(index.indexOf("function wirePopup("));
	const holdAt = wire.indexOf("if (holdsPopup(");
	const presentAt = wire.indexOf("presentPopupWindow(child");
	assert.ok(holdAt > 0 && presentAt > holdAt, "the hold branch returns first");
	assert.match(
		wire.slice(holdAt, presentAt),
		/heldPopups\.hold\(tabId, child\);[\s\S]*return;/,
	);
	// The click path: the one other presentation of a held popup, under its own name.
	assert.match(
		index,
		/for \(const popup of heldPopups\.take\(tabId\)\)\s*presentPopupWindow\(popup, options\.windowShow, \{\s*trigger: "popup-attention-open"/,
	);
	assert.match(
		read("src/main/browser/ipc.ts"),
		/ipcMain\.handle\("browser-open-user-attention", \(event, tabId: unknown\) => \{\s*authorize\(event\);/,
		"sender-checked: no agent or page can bring a tab forward",
	);
});

// ---- renderer: rows, badge count, click --------------------------------------

const state = {
	tabs: [
		{
			tabId: 1,
			url: "https://login.microsoft.com/fido/get",
			sessionId: "session:a",
		},
		{ tabId: 3, url: "https://accounts.example.com/o/oauth", sessionId: null },
		{ tabId: 7, url: "about:blank", sessionId: "session:b" },
	],
	pendingConsent: [
		{
			entryId: "e1",
			origin: "https://shop.example",
			expiresAt: 2_000,
			requesterSessionId: "session:b",
		},
		{
			entryId: "e0",
			origin: "https://old.example",
			expiresAt: 900,
			requesterSessionId: null,
		},
	],
	waitingOnUser: [
		{ kind: "popup", tabId: 3, at: 20 },
		{ kind: "passkey", tabId: 1, at: 10 },
		{ kind: "passkey", tabId: 99, at: 5 },
	],
};

test("every trigger becomes a notification row naming the session and the site; the badge counts them", () => {
	const rows = browserAttentionRows(state, 1_000);
	assert.deepEqual(
		rows.map(({ kind, tabId, entryId, origin, sessionId }) => ({
			kind,
			tabId,
			entryId,
			origin,
			sessionId,
		})),
		[
			{
				kind: "passkey",
				tabId: 1,
				entryId: null,
				origin: "https://login.microsoft.com",
				sessionId: "session:a",
			},
			{
				kind: "popup",
				tabId: 3,
				entryId: null,
				origin: "https://accounts.example.com",
				sessionId: null,
			},
			{
				kind: "site-access",
				tabId: null,
				entryId: "e1",
				origin: "https://shop.example",
				sessionId: "session:b",
			},
		],
		"oldest wait first, then live approvals; an expired approval and a wait on a closed tab are gone",
	);
	assert.equal(
		browserAttentionRows({ ...state, waitingOnUser: undefined }, 1_000).length,
		1,
		"an older main: approvals only",
	);
	assert.deepEqual(browserAttentionRows(null, 0), []);
	assert.equal(
		browserAttentionRows(
			{ ...state, waitingOnUser: [{ kind: "passkey", tabId: 7, at: 1 }] },
			1_000,
		)[0].origin,
		null,
		"a blank tab has no site to print",
	);
});

/** A shell that records every view change a click makes. */
function shell(
	sessions = [{ session_id: "session:a" }, { session_id: "session:b" }],
	{ opened = true } = {},
) {
	const calls = [];
	const deps = {
		target: (sessionId) => consentClickTarget(sessionId, sessions),
		openTab: async (tabId) => {
			calls.push(["openTab", tabId]);
			return opened;
		},
		noteConsent: (entryId) => calls.push(["noteConsent", entryId]),
		setActiveSession: (id) => calls.push(["session", id]),
		setBrowserPaneOpen: (open) => calls.push(["pane", open]),
		navigate: (path) => calls.push(["navigate", path]),
	};
	return { calls, deps };
}

test("click: a passkey row lands on its conversation's browser pane with the held tab in front", async () => {
	const [passkey] = browserAttentionRows(state, 1_000);
	const { calls, deps } = shell();
	await openBrowserAttention(passkey, deps);
	// No custody handoff is recorded any more (review N1: nothing in main ends
	// one, so a recorded handoff could never give anything back).
	assert.deepEqual(calls, [
		["openTab", 1],
		["session", "session:a"],
		["pane", true],
		["navigate", "/chat/session:a"],
	]);
});

test("click: a popup row on a tab no conversation owns lands on the browser route and presents the popup", async () => {
	const [, popup] = browserAttentionRows(state, 1_000);
	const { calls, deps } = shell();
	await openBrowserAttention(popup, deps);
	assert.deepEqual(calls, [
		["openTab", 3],
		["navigate", "/browser"],
	]);
});

test("click: a site-access row names the request for the approvals card, and opens no tab", async () => {
	const [, , access] = browserAttentionRows(state, 1_000);
	const { calls, deps } = shell();
	await openBrowserAttention(access, deps);
	assert.deepEqual(calls, [
		["noteConsent", "e1"],
		["session", "session:b"],
		["pane", true],
		["navigate", "/chat/session:b"],
	]);
});

test("click on a hold that ended meanwhile: main answers false, so nothing is recorded and the view stays (R2)", async () => {
	const [passkey, popup] = browserAttentionRows(state, 1_000);
	for (const row of [passkey, popup]) {
		const { calls, deps } = shell(undefined, { opened: false });
		await openBrowserAttention(row, deps);
		assert.deepEqual(calls, [["openTab", row.tabId]], `${row.kind}: no move`);
	}
});

test("live region: the first look announces nothing; later arrivals are announced, a returning wait again (U4)", () => {
	const rows = browserAttentionRows(state, 1_000);
	const first = attentionArrivals(null, rows.slice(0, 1));
	assert.deepEqual(first.arrivals, [], "standing waits are not news");
	const second = attentionArrivals(first.seen, rows);
	assert.deepEqual(
		second.arrivals.map((row) => row.key),
		rows.slice(1).map((row) => row.key),
	);
	const gone = attentionArrivals(second.seen, rows.slice(1));
	assert.deepEqual(gone.arrivals, [], "a row leaving is not an arrival");
	assert.deepEqual(
		attentionArrivals(gone.seen, rows).arrivals.map((row) => row.key),
		[rows[0].key],
		"the same wait coming back is announced again",
	);
});

test("source: the shell no longer navigates on a hold's arrival, and the rows are in the sidebar", () => {
	// The custody give-back is gone with custody (review N1): no listener for
	// an event main never sends, no handoff module, no preload bridge.
	const app = read("src/renderer/src/app.tsx");
	assert.doesNotMatch(app, /onPasskeyCustodyEnded|shellCustodyHandoffs/);
	assert.doesNotMatch(
		read("src/preload/index.ts"),
		/browser-passkey-custody-ended|onPasskeyCustodyEnded/,
	);
	assert.doesNotMatch(read("src/preload/index.d.ts"), /onPasskeyCustodyEnded/);
	assert.doesNotMatch(
		read(
			"src/renderer/src/features/browser/components/browser-attention-rows.tsx",
		),
		/beginCustodyHandoff|custody-handoff/,
	);
	const sidebar = read(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(sidebar, /<BrowserAttentionRows \/>/);
	assert.match(
		sidebar,
		/const browserApprovals = useBrowserAttention\(\)\.count;/,
	);
});
