/**
 * Rules of the agent-tab reaper (`src/main/browser/tab-reaper.ts`) and the
 * registry hooks it drives (cap eviction, tombstoned stale handles).
 *
 * WHY THESE RULES ARE PINNED: the operator found the desktop browser host at its
 * eight-agent-tab cap with tabs stranded for hours by ended sessions, refusing a
 * live session's `open` (2026-11-17). The reaper closes such tabs; a wrong close
 * loses an agent's or a person's work, so every "never reap" case is asserted
 * here alongside every "reap" case.
 *
 * WHAT THESE TESTS ARE NOT: proof against a real Electron window. The registry's
 * views are fakes; the wiring's guards (active tab, held popups, custody,
 * recordings, pending approvals) are injected here exactly as `index.ts` injects
 * them, so the RULES are what is under test.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/registry";',
			'export * from "./src/main/browser/tab-reaper";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		electron: join(process.cwd(), "scripts/browser-electron-stub.ts"),
	},
});
const {
	TabRegistry,
	TabReaper,
	MAX_AGENT_TABS,
	AGENT_TAB_IDLE_REAP_MS,
	EVICTION_IDLE_FLOOR_MS,
	ENDED_SESSION_CONFIRMATIONS,
	surfaceToken,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const MIN = 60_000;
const BUSY_A = /busy-a \(5 tabs/;
const BUSY_B = /busy-b \(3 tabs/;
const IDLE_COPY = /45 minutes with no agent action/;
const EVICTED_COPY = /make room/;

class FakeWebContents {
	constructor(id) {
		this.id = id;
	}
	isDestroyed() {
		return false;
	}
	getURL() {
		return "https://example.com/login";
	}
	on() {}
	once() {}
	removeListener() {}
}

class FakeView {
	constructor(id) {
		this.webContents = new FakeWebContents(id);
	}
	setBounds() {}
	setVisible() {}
}

/** A registry plus a reaper wired the way `index.ts` wires them, with every
 * guard backed by a mutable set the test controls. */
function makeRig({ roster = null } = {}) {
	let nextId = 100;
	const removed = [];
	const registry = new TabRegistry(
		() => new FakeView(nextId++),
		(tabId) => removed.push(tabId),
		() => {},
	);
	const state = {
		now: Date.now(),
		engaged: new Set(),
		custody: new Set(),
		recording: new Set(),
		awaiting: new Set(),
		roster,
	};
	const reaped = [];
	const reaper = new TabReaper({
		registry,
		guards: {
			userEngaged: (record) =>
				registry.activeTab === record || state.engaged.has(record.tabId),
			inCustody: (record) => state.custody.has(record.tabId),
			busy: (record) => registry.isBusy(record.tabId),
			recording: (record) => state.recording.has(record.tabId),
			sessionAwaitingUser: (sessionId) => state.awaiting.has(sessionId),
		},
		reap: (record, reason) => {
			reaped.push({ tabId: record.tabId, reason });
			registry.reap(record.tabId, reason);
		},
		readRoster: async () => state.roster,
		now: () => state.now,
	});
	registry.setCapacityEvictor(() => reaper.evictForCapacity());
	/** Open an agent tab last used `idleMs` before the rig's clock. */
	const agentTab = (sessionId, idleMs = 0) => {
		const record = registry.create({ owner: "agent", sessionId });
		record.lastUsedAt = state.now - idleMs;
		return record;
	};
	return { registry, reaper, state, reaped, removed, agentTab };
}

test("an idle agent tab is reaped by the sweep at the threshold, not before", async () => {
	const { reaper, reaped, agentTab } = makeRig();
	const stale = agentTab("a", AGENT_TAB_IDLE_REAP_MS);
	agentTab("b", AGENT_TAB_IDLE_REAP_MS - MIN);
	assert.equal(await reaper.sweep(), 1);
	assert.deepEqual(reaped, [{ tabId: stale.tabId, reason: "idle" }]);
});

test("a tab whose session is cold on consecutive roster reads is reaped; absent or unknown is not", async () => {
	const { reaper, reaped, state, agentTab } = makeRig();
	const ended = agentTab("ended");
	agentTab("absent"); // not on the roster: a subagent, say — unknown, not ended
	agentTab("old-daemon"); // live_state not published
	agentTab("live");
	state.roster = [
		{ sessionId: "ended", liveState: "" },
		{ sessionId: "old-daemon", liveState: null },
		{ sessionId: "live", liveState: "idle" },
	];
	for (let read = 1; read < ENDED_SESSION_CONFIRMATIONS; read += 1) {
		assert.equal(await reaper.sweep(), 0, "one cold read is not enough");
	}
	// An unreadable roster neither confirms nor resets the streak.
	state.roster = null;
	assert.equal(await reaper.sweep(), 0);
	state.roster = [
		{ sessionId: "ended", liveState: "" },
		{ sessionId: "old-daemon", liveState: null },
		{ sessionId: "live", liveState: "idle" },
	];
	assert.equal(await reaper.sweep(), 1);
	assert.deepEqual(reaped, [{ tabId: ended.tabId, reason: "session_ended" }]);
});

test("a runtime coming back between reads resets the cold streak", async () => {
	const { reaper, state, agentTab } = makeRig();
	agentTab("flappy");
	state.roster = [{ sessionId: "flappy", liveState: "" }];
	await reaper.sweep();
	state.roster = [{ sessionId: "flappy", liveState: "busy" }];
	await reaper.sweep();
	state.roster = [{ sessionId: "flappy", liveState: "" }];
	assert.equal(await reaper.sweep(), 0);
});

test("never reaped: user tabs, a user's handed-over tab, the active tab, custody, held popup, busy lane, recording, awaiting approval", async () => {
	const { registry, reaper, state, reaped, agentTab } = makeRig({
		roster: [],
	});
	const old = AGENT_TAB_IDLE_REAP_MS * 10;
	const user = registry.create({ owner: "user" });
	user.lastUsedAt = state.now - old;
	const handed = registry.create({ owner: "user", activate: false });
	registry.handOver(handed.tabId, "session:h");
	handed.lastUsedAt = state.now - old;
	const active = agentTab("s1", old);
	registry.activate(active.tabId);
	active.lastUsedAt = state.now - old; // activation stamps; undo to test the guard itself
	const custody = agentTab("s2", old);
	state.custody.add(custody.tabId);
	const popup = agentTab("s3", old);
	state.engaged.add(popup.tabId);
	const recording = agentTab("s4", old);
	state.recording.add(recording.tabId);
	agentTab("s5", old);
	state.awaiting.add("s5");
	const busy = agentTab("s6", old);
	let release;
	const inFlight = registry.lane(
		busy.tabId,
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	busy.lastUsedAt = state.now - old;
	assert.equal(await reaper.sweep(), 0);
	assert.deepEqual(reaped, []);
	// The busy tab's own command finishing restarts its clock: still not reaped.
	release();
	await inFlight;
	assert.equal(await reaper.sweep(), 0);
	// Session-ended does not override a protection either.
	state.roster = [{ sessionId: "s2", liveState: "" }];
	await reaper.sweep();
	assert.equal(await reaper.sweep(), 0);
	assert.equal(registry.count(), 8);
});

test("at the cap the least-recently-used evictable tab is evicted and the open succeeds", () => {
	const { registry, reaped, state, agentTab } = makeRig();
	const tabs = [];
	for (let index = 0; index < MAX_AGENT_TABS; index += 1)
		tabs.push(agentTab(`s${index}`, EVICTION_IDLE_FLOOR_MS + index * MIN));
	// The stalest is protected (the user is looking at it): the next one goes.
	const stalest = tabs.at(-1);
	state.engaged.add(stalest.tabId);
	const fresh = registry.create({ owner: "agent", sessionId: "newcomer" });
	assert.ok(fresh.nonce);
	assert.deepEqual(reaped, [{ tabId: tabs.at(-2).tabId, reason: "evicted" }]);
	assert.equal(registry.agentTabCount(), MAX_AGENT_TABS);
});

test("at the cap with nothing evictable the open is refused, naming the holders", () => {
	const { registry, reaped, agentTab } = makeRig();
	for (let index = 0; index < MAX_AGENT_TABS; index += 1)
		agentTab(index < 5 ? "busy-a" : "busy-b", EVICTION_IDLE_FLOOR_MS - MIN);
	assert.throws(
		() => registry.create({ owner: "agent", sessionId: "newcomer" }),
		(error) => {
			assert.equal(error.code, "tab_limit");
			assert.match(error.message, BUSY_A);
			assert.match(error.message, BUSY_B);
			assert.deepEqual(
				error.data.holders.map((holder) => [holder.session, holder.tabs]),
				[
					["busy-a", 5],
					["busy-b", 3],
				],
			);
			return true;
		},
	);
	assert.deepEqual(reaped, []);
});

test("an ended session's tab is evicted ahead of an older live one", async () => {
	const { registry, reaper, reaped, state, agentTab } = makeRig();
	for (let index = 0; index < MAX_AGENT_TABS - 1; index += 1)
		agentTab(`live${index}`, EVICTION_IDLE_FLOOR_MS + 20 * MIN);
	const ended = agentTab("gone", 0);
	state.roster = [{ sessionId: "gone", liveState: "" }];
	// Confirm without letting the sweep itself reap it: protect, sweep, unprotect.
	state.engaged.add(ended.tabId);
	for (let read = 0; read < ENDED_SESSION_CONFIRMATIONS; read += 1)
		await reaper.sweep();
	state.engaged.delete(ended.tabId);
	registry.create({ owner: "agent", sessionId: "newcomer" });
	assert.deepEqual(reaped, [{ tabId: ended.tabId, reason: "evicted" }]);
});

test("the reaped tab's owner gets a typed reason on its stale handle; a guessed handle does not", async () => {
	const { registry, reaper, agentTab } = makeRig();
	const stale = agentTab("a", AGENT_TAB_IDLE_REAP_MS);
	const token = surfaceToken(stale);
	await reaper.sweep();
	assert.throws(
		() => registry.requireSurface(token),
		(error) =>
			error.code === "tab_closed" &&
			error.data.reason === "reaped_idle" &&
			IDLE_COPY.test(error.message),
	);
	assert.throws(
		() => registry.requireSurface(`ui:${stale.tabId}:${"f".repeat(32)}`),
		(error) =>
			error.code === "tab_closed" && error.data.reason === "unknown_handle",
	);
});

test("an evicted tab's owner is told it was evicted for room", () => {
	const { registry, agentTab } = makeRig();
	const tabs = [];
	for (let index = 0; index < MAX_AGENT_TABS; index += 1)
		tabs.push(agentTab(`s${index}`, EVICTION_IDLE_FLOOR_MS + index * MIN));
	const token = surfaceToken(tabs.at(-1));
	registry.create({ owner: "agent", sessionId: "newcomer" });
	assert.throws(
		() => registry.requireSurface(token),
		(error) =>
			error.code === "tab_closed" &&
			error.data.reason === "reaped_evicted" &&
			EVICTED_COPY.test(error.message),
	);
});
