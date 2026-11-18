/** Compiles the current host/registry/policy with synthetic views, not Electron. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: ["registry", "tab-reaper", "host", "ownership"]
			.map((name) => `export * from "./src/main/browser/${name}";`)
			.join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { electron: join(process.cwd(), "scripts/browser-electron-stub.ts") },
});
const {
	TabRegistry,
	TabReaper,
	BrowserHost,
	OwnershipLedger,
	MAX_AGENT_TABS,
	RECLAIM_QUIET_MS,
	surfaceToken,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const generation = "a".repeat(64);
const ended = (id) => ({
	session_id: id,
	verdict: "ended",
	turn: "idle",
	retained: false,
	provenance: "browser_terminal",
	generation,
});
const response = (...ids) => ({ owners: ids.map(ended) });

class FakeView {
	constructor(id) {
		this.webContents = {
			id,
			isDestroyed: () => false,
			getURL: () => "https://example.com/",
			getTitle: () => "example",
			on() {},
			once() {},
			removeListener() {},
		};
	}
	setBounds() {}
	setVisible() {}
}

function rig() {
	const removed = [];
	const ledgerReceipts = [];
	const state = {
		now: Date.now(),
		read: async (ids) => response(...ids),
		current: generation,
		auth: new Map(),
		holds: new Set(),
	};
	const registry = new TabRegistry(
		(_opts, tabId) => new FakeView(tabId),
		(tabId, _wcId, cascade) => {
			removed.push({ tabId, cascade });
			// Mirror releaseTab's ordinary cascade; reclaim must disable it and
			// atomically remove only the graph the policy evaluated.
			if (cascade !== false)
				for (const child of registry.unadoptedLinkTabs(tabId))
					registry.destroy(child.tabId);
		},
		() => {},
	);
	const ownership = new OwnershipLedger({
		closeTab: async () => false,
		isLive: (token) => {
			try {
				return !!registry.requireSurface(token);
			} catch {
				return false;
			}
		},
	});
	const opts = {
		registry,
		resolver: {
			read: (ids) => state.read(ids),
			currentGeneration: () => state.current,
		},
		protected: (tab) =>
			state.holds.has(tab.tabId) || ownership.isRetained(surfaceToken(tab)),
		authProtection: ({ tabId }) => state.auth.get(tabId) ?? "non_auth",
		onReclaimed: (tabs) => {
			for (const tab of tabs) {
				assert.equal(
					registry.get(tab.tabId),
					undefined,
					"closed before observers run",
				);
				ownership.noteReclaimed(surfaceToken(tab));
				ledgerReceipts.push(tab.tabId);
			}
		},
		now: () => state.now,
	};
	const tab = (id = "target", extra = {}) => {
		const record = registry.create({ owner: "agent", sessionId: id, ...extra });
		record.lastUsedAt = state.now - RECLAIM_QUIET_MS;
		return record;
	};
	return {
		state,
		registry,
		ownership,
		removed,
		ledgerReceipts,
		opts,
		reaper: new TabReaper(opts),
		tab,
	};
}

test("R1: select a descendant and the opener and complete graph survive; only a fully qualified graph closes", async () => {
	const { tab, registry, reaper, state, removed, ledgerReceipts } = rig();
	const parent = tab();
	const child = tab("target", { openedByTab: parent.tabId });
	const grandchild = tab("target", { openedByTab: child.tabId });
	const user = tab("viewer", { owner: "user" });
	registry.activate(grandchild.tabId);
	assert.equal(await reaper.sweep(), 0);
	registry.activate(user.tabId);
	state.now = grandchild.lastHumanUseAt + RECLAIM_QUIET_MS;
	state.holds.add(grandchild.tabId);
	assert.equal(await reaper.sweep(), 0);
	state.holds.clear();
	const handle = surfaceToken(parent);
	assert.equal(await reaper.sweep(), 3);
	assert.deepEqual(
		removed,
		[parent, child, grandchild].map(({ tabId }) => ({ tabId, cascade: false })),
	);
	assert.deepEqual(
		ledgerReceipts,
		removed.map(({ tabId }) => tabId),
	);
	assert.throws(() => registry.requireSurface(handle), {
		code: "tab_closed",
		data: { reason: "reaped_session_ended" },
	});
	assert.throws(
		() =>
			registry.requireSurface(
				`${handle.slice(0, -1)}${handle.endsWith("z") ? "y" : "z"}`,
			),
		{ code: "tab_closed", data: { reason: "unknown_handle" } },
	);
});

test("R2: failed, delayed and changed observations never authorize close, even after a confirmed held read", async () => {
	const { tab, registry, reaper, state } = rig();
	const record = tab();
	state.holds.add(record.tabId);
	assert.equal(await reaper.sweep(), 0);
	state.holds.clear();
	state.read = async () => {
		throw new Error("daemon unavailable");
	};
	assert.equal(await reaper.sweep(), 0);
	const delayed = Promise.withResolvers();
	const started = Promise.withResolvers();
	let calls = 0;
	state.read = async () => {
		if (++calls === 1) return response("target");
		started.resolve();
		return delayed.promise;
	};
	const sweep = reaper.sweep();
	await started.promise;
	await registry.lane(record.tabId, async () => {});
	state.now = record.lastUsedAt + RECLAIM_QUIET_MS;
	delayed.resolve(response("target"));
	assert.equal(await sweep, 0, "activity epoch, not just timestamp, changed");
	state.read = async () => response("target");
	state.current = "b".repeat(64);
	assert.equal(await reaper.sweep(), 0);
	state.current = null;
	assert.equal(
		await reaper.sweep(),
		0,
		"stable repeated HTTP answers aren't a mutation fence",
	);
});

test("R2: reject changed nonce, navigation and ownership scope while reading", async () => {
	for (const mutate of [
		async (record) => {
			record.nonce = "changed";
		},
		async (record) => {
			record.documentEpoch++;
		},
		async (_record, registry) => registry.withReclaimBarrier(async () => {}),
	]) {
		const { tab, registry, reaper, state } = rig();
		const record = tab();
		let calls = 0;
		state.read = async () => {
			if (++calls === 2) await mutate(record, registry);
			return response("target");
		};
		assert.equal(await reaper.sweep(), 0);
	}
});

test("R3/Q2: real dispatch holds both fresh and resumed opens across paused CDP attach", async () => {
	for (const resume of [false, true]) {
		const { tab, registry, reaper, ownership, state } = rig();
		const entered = Promise.withResolvers();
		const release = Promise.withResolvers();
		const host = new BrowserHost({
			registry,
			ownership,
			cdp: {
				attach: async () => {
					entered.resolve();
					await release.promise;
				},
			},
			approvals: {
				originAllowed: () => true,
				documentAllowed: () => true,
				approvedUrl: () => true,
				accessFor: () => ({ allowed: true }),
				rememberDocument() {},
			},
			onChanged() {},
			log() {},
		});
		const existing = resume ? tab() : null;
		const open = host.dispatch(
			"open",
			{
				requester: "session:target",
				...(existing ? { tab: surfaceToken(existing) } : {}),
			},
			"synthetic-open",
		);
		try {
			await Promise.race([
				entered.promise,
				open.then(() => {
					throw new Error("open skipped attach");
				}),
			]);
			const record = registry.list()[0];
			state.now = record.lastUsedAt + RECLAIM_QUIET_MS;
			assert.equal(await reaper.sweep(), 0);
			assert.equal(registry.get(record.tabId), record);
		} finally {
			release.resolve();
			const result = await open;
			assert.ok(registry.requireSurface(result.tab));
		}
	}
});

test("R4/Q1: selected dwell, switch away, switch back and native input refresh protection", async (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	const { tab, registry, reaper, state } = rig();
	const selected = tab();
	registry.activate(selected.tabId);
	state.now += RECLAIM_QUIET_MS + 1;
	t.mock.timers.setTime(state.now);
	assert.equal(await reaper.sweep(), 0);
	const user = tab("user", { owner: "user" }); // user creation also changes selection
	assert.equal(selected.lastHumanUseAt, Date.now());
	state.now = Date.now() + RECLAIM_QUIET_MS - 1;
	assert.equal(await reaper.sweep(), 0);
	registry.activate(selected.tabId);
	assert.equal(await reaper.sweep(), 0);
	registry.activate(user.tabId);
	registry.notePossibleHumanUse(selected.tabId);
	assert.equal(selected.lastHumanUseAt, Date.now());
	state.now = Date.now() + RECLAIM_QUIET_MS - 1;
	assert.equal(await reaper.sweep(), 0);
});

test("R5: page-driven allocations and explicit opens both refuse at eight while reclaim is unconfigured", async () => {
	const { registry, tab, ownership, opts } = rig();
	const records = Array.from({ length: MAX_AGENT_TABS }, (_, i) =>
		tab(`target-${i}`),
	);
	const reaper = new TabReaper({ ...opts, resolver: undefined });
	assert.equal(await reaper.sweep(), 0);
	assert.throws(() => tab("target-0", { openedByTab: records[0].tabId }), {
		code: "tab_limit",
	});
	const host = new BrowserHost({ registry, ownership, approvals: {} });
	await assert.rejects(
		host.dispatch("open", { requester: "session:newcomer" }, "synthetic-cap"),
		{ code: "tab_limit" },
	);
	assert.deepEqual(registry.list(), records);
});

test("fail closed for unknown auth, prompt, approval, retain, unknown/live owner and human ancestry", async () => {
	const { registry, tab, reaper, state, opts } = rig();
	const record = tab();
	for (const auth of ["unknown", "auth", "pending_prompt"]) {
		state.auth.set(record.tabId, auth);
		assert.equal(await reaper.sweep(), 0);
	}
	state.auth.clear();
	state.holds.add(record.tabId); // approval/custody/recording are host-owned protection inputs
	assert.equal(await reaper.sweep(), 0);
	state.holds.clear();
	for (const verdict of [
		null,
		{ owners: [] },
		{ owners: [ended("target"), ended("target")] },
		...[
			["verdict", "live"],
			["verdict", "unknown"],
			["retained", true],
			["retained", null],
			["turn", "unknown"],
			["turn", "awaiting_user"],
			["provenance", "none"],
			["generation", "invalid"],
		].map(([key, value]) => ({
			owners: [{ ...ended("target"), [key]: value }],
		})),
	]) {
		state.read = async () => verdict;
		assert.equal(await reaper.sweep(), 0);
	}
	state.read = async (ids) => response(...ids);
	for (const guard of ["humanOrigin", "adopted", "restored"]) {
		record[guard] = true;
		assert.equal(await reaper.sweep(), 0);
		record[guard] = false;
	}
	const user = registry.create({ owner: "user" });
	record.openedByTab = user.tabId;
	assert.equal(await reaper.sweep(), 0);
	assert.equal(
		await new TabReaper({ ...opts, authProtection: undefined }).sweep(),
		0,
	);
});

test("proof-gated retain beats an ended verdict and reclaim leaves an owner-only receipt", async () => {
	const { tab, registry, reaper, ownership } = rig();
	const identity = {
		requester: "session:target",
		owner_proof: "synthetic-proof-".repeat(3),
		owner_generation: "synthetic-generation",
		allocation_id: "synthetic-allocation",
	};
	const record = tab("target", { allocationId: identity.allocation_id });
	const handle = surfaceToken(record);
	await ownership.withOwnership("open", identity, async () => {
		ownership.recordAllocation(identity, handle, "allocated");
		return { tab: handle };
	});
	const host = new BrowserHost({ registry, ownership });
	await host.dispatch(
		"owner_retain",
		{ ...identity, reason: "synthetic hold" },
		"retain",
	);
	assert.equal(await reaper.sweep(), 0);
	await host.dispatch("owner_release", identity, "release");
	assert.equal(await reaper.sweep(), 1);
	const receipt = await host.dispatch("owner_recover", identity, "recover");
	assert.equal(receipt.state, "reaped_session_ended");
	assert.equal(receipt.tab, "");
	const other = await host.dispatch(
		"owner_recover",
		{
			...identity,
			requester: "session:other",
			owner_proof: "different-synthetic-proof-".repeat(2),
		},
		"other-owner",
	);
	assert.deepEqual(other, { ownership_version: 1, state: "unresolved" });
});
