import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The persisted "where the reader was" record (`team-bridge-view-memory.ts`),
 * executed through esbuild so the test runs the SAME TypeScript the renderer
 * bundles - the house pattern of `team-bridge-scope-preference.test.mjs`. The
 * container behaviour it feeds is proven through the real page in
 * `team-bridge-view-restore.test.mjs`; this suite pins the storage contract:
 * per account, per scope, tolerant of anything a hand edit or a downgrade can
 * leave behind, and never throwing into the page.
 */
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-view-memory";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const memory = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const KEY = memory.VIEW_MEMORY_KEY;

function fakeStorage(initial) {
	const map = new Map(
		initial === undefined ? [] : [[KEY, JSON.stringify(initial)]],
	);
	return {
		map,
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => void map.set(key, String(value)),
	};
}

const channel = { target: { type: "conversation", id: "bcv_launch" } };

test("each scope keeps its own view, and the last write names the current scope", () => {
	const storage = fakeStorage();
	memory.writeViewMemory(storage, "acct-1", "org_a", channel);
	memory.writeViewMemory(storage, "acct-1", "org_b", {
		target: { type: "person", accountId: "acct-peer" },
	});
	memory.writeViewMemory(storage, "acct-1", "all", {
		target: { type: "conversation", id: "bcv_union" },
	});
	assert.deepEqual(
		memory.readViewMemory(storage, "acct-1", "org_a").target,
		channel.target,
	);
	assert.deepEqual(memory.readViewMemory(storage, "acct-1", "org_b").target, {
		type: "person",
		accountId: "acct-peer",
	});
	assert.equal(
		memory.readViewMemory(storage, "acct-1", "all").target.id,
		"bcv_union",
	);
	assert.equal(memory.readLastScope(storage, "acct-1"), "all");
});

test("a view flushed for one scope can name another as current (unmount across a switch)", () => {
	const storage = fakeStorage();
	memory.writeViewMemory(storage, "acct-1", "org_a", channel, "org_b");
	assert.equal(memory.readLastScope(storage, "acct-1"), "org_b");
	assert.ok(memory.readViewMemory(storage, "acct-1", "org_a"));
});

test("writeLastScope moves the current scope and keeps every view", () => {
	const storage = fakeStorage();
	memory.writeViewMemory(storage, "acct-1", "org_a", channel);
	memory.writeLastScope(storage, "acct-1", "org_b");
	assert.equal(memory.readLastScope(storage, "acct-1"), "org_b");
	assert.deepEqual(
		memory.readViewMemory(storage, "acct-1", "org_a").target,
		channel.target,
	);
});

test("accounts never read each other's record, and a write keeps the other account", () => {
	const storage = fakeStorage();
	memory.writeViewMemory(storage, "acct-1", "org_a", channel);
	memory.writeViewMemory(storage, "acct-2", "org_a", {
		target: { type: "conversation", id: "bcv_other" },
	});
	assert.equal(
		memory.readViewMemory(storage, "acct-1", "org_a").target.id,
		"bcv_launch",
	);
	assert.equal(memory.readViewMemory(storage, "acct-3", "org_a"), null);
	assert.equal(memory.readLastScope(storage, "acct-3"), undefined);
});

test("every target kind round-trips: channel/group, person DM, agent DM, compose", () => {
	const storage = fakeStorage();
	const targets = [
		{ type: "conversation", id: "bcv_group" },
		{ type: "person", accountId: "acct-peer" },
		{ type: "chief", accountId: "acct-peer" },
		{
			type: "compose",
			recipients: [
				{ kind: "human", accountId: "acct-peer", label: "Peer" },
				{
					kind: "agent",
					accountId: "acct-peer",
					endpointId: "ep_1",
					label: "Peer's agent",
				},
			],
		},
	];
	for (const target of targets) {
		memory.writeViewMemory(storage, "acct-1", "org_a", { target });
		assert.deepEqual(
			memory.readViewMemory(storage, "acct-1", "org_a").target,
			target,
		);
	}
});

test("quick view, thread and scroll round-trip; thread and scroll only apply to their own target", () => {
	const storage = fakeStorage();
	memory.writeViewMemory(storage, "acct-1", "org_a", {
		target: { type: "conversation", id: "bcv_launch" },
		quickView: "drafts",
		thread: {
			tenantId: "org_a",
			conversationId: "bcv_launch",
			rootId: "msg_root",
		},
		scroll: {
			messageId: "msg_7",
			offset: -12,
			targetKey: "conversation:bcv_launch",
		},
	});
	const view = memory.readViewMemory(storage, "acct-1", "org_a");
	assert.equal(view.quickView, "drafts");
	assert.equal(memory.rememberedThread(view).rootId, "msg_root");
	assert.deepEqual(memory.rememberedScroll(view, view.target), {
		messageId: "msg_7",
		offset: -12,
	});
	// The same record, read for another target, restores no position.
	assert.equal(
		memory.rememberedScroll(view, { type: "conversation", id: "bcv_other" }),
		null,
	);
	// A thread naming another conversation is never reopened.
	assert.equal(
		memory.rememberedThread({
			...view,
			thread: { ...view.thread, conversationId: "bcv_other" },
		}),
		null,
	);
});

test("a corrupt or foreign record reads as nothing and never throws", () => {
	const cases = [
		"not json",
		"null",
		"[]",
		JSON.stringify({ "acct-1": "org_a" }),
		JSON.stringify({ "acct-1": { scope: 42, scopes: [] } }),
		JSON.stringify({
			"acct-1": {
				scope: "org_a",
				scopes: { org_a: { target: { type: "conversation", id: "" } } },
			},
		}),
		JSON.stringify({
			"acct-1": {
				scope: "org_a",
				scopes: { org_a: { target: { type: "bogus", id: "x" } } },
			},
		}),
	];
	for (const raw of cases) {
		const storage = { getItem: () => raw, setItem: () => {} };
		assert.doesNotThrow(() =>
			memory.readViewMemory(storage, "acct-1", "org_a"),
		);
		assert.equal(memory.readViewMemory(storage, "acct-1", "org_a"), null, raw);
	}
	// Bad optional fields are dropped; the target still restores.
	const storage = fakeStorage({
		"acct-1": {
			scope: "org_a",
			scopes: {
				org_a: {
					target: { type: "conversation", id: "bcv_launch" },
					quickView: "nonsense",
					thread: { rootId: 7 },
					scroll: { messageId: "m", offset: "far" },
				},
			},
		},
	});
	assert.deepEqual(memory.readViewMemory(storage, "acct-1", "org_a"), {
		target: { type: "conversation", id: "bcv_launch" },
	});
});

test("a store that refuses writes costs only the memory", () => {
	const storage = {
		getItem: () => null,
		setItem: () => {
			throw new Error("quota exceeded");
		},
	};
	assert.doesNotThrow(() =>
		memory.writeViewMemory(storage, "acct-1", "org_a", channel),
	);
	assert.doesNotThrow(() => memory.writeLastScope(storage, "acct-1", "org_a"));
});

test("a conversation target's tenant round-trips; older and malformed records read without it", () => {
	/* The tenant lets a cold open start the conversation's history alongside the
	   list (`prefetchTeamBridgeLanding`). It is only kept for a conversation
	   target, only when it is a plausible id, and its absence is the old shape. */
	const storage = fakeStorage();
	const target = { type: "conversation", id: "c1" };
	memory.writeViewMemory(storage, "acct-1", "all", {
		target,
		tenantId: "org_a",
	});
	assert.equal(
		memory.readViewMemory(storage, "acct-1", "all").tenantId,
		"org_a",
	);
	memory.writeViewMemory(storage, "acct-1", "all", { target });
	assert.equal(
		"tenantId" in memory.readViewMemory(storage, "acct-1", "all"),
		false,
		"a record without a tenant (an older build's) reads without one",
	);
	memory.writeViewMemory(storage, "acct-1", "all", { target, tenantId: 42 });
	assert.equal(
		memory.readViewMemory(storage, "acct-1", "all").tenantId,
		undefined,
	);
	memory.writeViewMemory(storage, "acct-1", "all", {
		target: { type: "person", accountId: "p1" },
		tenantId: "org_a",
	});
	assert.equal(
		memory.readViewMemory(storage, "acct-1", "all").tenantId,
		undefined,
		"a person target carries no conversation tenant",
	);
});
