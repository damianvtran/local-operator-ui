import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import {
	deferred,
	delay,
	mount,
	send,
	type,
	ui,
	until,
} from "./fixtures/team-bridge-auth-owner-page.mjs";

const MARKER = "PRIVATE_A_BASELINE_39164868";
const readyA = async (app) => {
	assert.equal(
		app.client,
		ui.queryClient,
		"the shipped singleton, not an approximate test client",
	);
	assert.equal(app.client.getDefaultOptions().queries.gcTime, 600_000);
	assert.equal(app.client.getDefaultOptions().mutations.retry, 1);
	await until(
		() =>
			app.host.querySelector("[data-auth-principal]")?.textContent === "acct_a",
		"actual auth A",
	);
	app.fixture.messages.set(JSON.stringify(["acct_a", "org_shared"]), [
		{
			id: "msg_private_A",
			conversation_id: "bcv_shared",
			seq: 1,
			sender: { account_id: "acct_a", kind: "human", display_label: "A" },
			body: MARKER,
			origin: "human",
			created_at: "2026-10-23T12:00:00Z",
		},
	]);
	await act(async () =>
		app.client.invalidateQueries({
			queryKey: ui.teamBridgeKeys.messages("bcv_shared", "org_shared"),
		}),
	);
	await until(
		() => app.host.textContent.includes(MARKER),
		"A private body visibly admitted",
	);
	await until(
		() => app.host.querySelector("[data-nav-attention]")?.textContent === "7",
		"real owned A nav count",
	);
};
const selectConversation = async (app) => {
	await until(
		() =>
			[...app.host.querySelectorAll("button")].some((node) =>
				node.textContent.includes("Shared thread"),
			),
		"current owner admitted conversation row",
	);
	const button = [...app.host.querySelectorAll("button")].find((node) =>
		node.textContent.includes("Shared thread"),
	);
	assert.ok(button, "real conversation row");
	await act(async () => button.click());
	await until(
		() => app.host.querySelector("textarea"),
		"actual conversation composer",
	);
};
const assertNoForeignFrame = (app, marker = MARKER) => {
	assert.equal(
		app.frames.filter(
			(frame) =>
				frame.auth === "acct_b" &&
				(frame.text.includes(marker) || frame.draft.includes(marker)),
		).length,
		0,
		"every committed B-auth frame excludes A private data",
	);
};

// Exact original e5 boundary: real auth commissioning, singleton TTL600000,
// account B observed, then B history refusal. Not Electron or real-JWT proof.
test("actual auth completion cannot expose cached A history when B history is refused", async () => {
	const app = await mount();
	try {
		await readyA(app);
		app.fixture.refuseHistory.add("acct_b");
		await app.changeAuth("acct_b");
		await act(async () => new Promise((resolve) => setTimeout(resolve, 40)));
		assert.equal(
			app.host.querySelector("[data-auth-principal]").textContent,
			"acct_b",
		);
		await until(
			() =>
				app.frames.some(
					(frame) => frame.auth === "acct_b" && frame.account === "acct_b",
				),
			"real B auth and bridge status commit",
		);
		assert.ok(
			app.host.textContent.includes("Shared thread"),
			"B page is mounted with its admitted conversation, not an empty false pass",
		);
		assert.equal(app.host.textContent.includes(MARKER), false);
		assertNoForeignFrame(app);
		// Reopen the same conversation as B: isolation cannot pass merely by
		// leaving the selected history pane absent after the owner remount.
		await selectConversation(app);
		await until(
			() =>
				app.fixture.calls.some(
					(call) =>
						call.owner === "acct_b" && call.op === "team_bridge.messages.list",
				),
			"actual B history read reaches controlled 404",
		);
		await until(
			() => app.host.querySelector("[data-nav-attention]")?.textContent === "2",
			"real owned B nav count",
		);
		assert.equal(
			app.frames.some((frame) => frame.auth === "acct_b" && frame.nav === "7"),
			false,
			"no prior account badge frame",
		);
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.messages("bcv_shared", "org_shared"),
			}),
		);
		assertNoForeignFrame(app);
		assert.equal(app.host.textContent.includes(MARKER), false);
	} finally {
		await app.close();
	}
});

test("live auth B hides A data even while Team Bridge status is still A", async () => {
	const app = await mount();
	try {
		await readyA(app);
		app.fixture.statusGate = deferred();
		app.fixture.account = "acct_b";
		await act(async () => ui.commissionAccountRead(app.client));
		await until(
			() =>
				app.host.querySelector("[data-auth-principal]")?.textContent ===
				"acct_b",
			"actual auth B before bridge status",
		);
		assert.equal(app.host.textContent.includes(MARKER), false);
		assertNoForeignFrame(app);
		app.fixture.statusGate.resolve();
		app.fixture.statusGate = null;
		await delay();
	} finally {
		await app.close();
	}
});

test("late A history cannot repopulate B after actual auth completion", async () => {
	const app = await mount();
	try {
		await readyA(app);
		const gate = deferred();
		app.fixture.historyGate = gate;
		let held;
		await act(async () => {
			held = app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.messages("bcv_shared", "org_shared"),
			});
		});
		await delay();
		app.fixture.historyGate = null;
		app.fixture.refuseHistory.add("acct_b");
		await app.changeAuth("acct_b");
		await act(async () => gate.resolve());
		await act(async () => held);
		assert.equal(app.host.textContent.includes(MARKER), false);
		assertNoForeignFrame(app);
	} finally {
		await app.close();
	}
});

test("actual auth A-B-A preserves only A's typed text without optimistic send return", async () => {
	const app = await mount();
	const body = "A typed private text retained for A only";
	try {
		await type(app.host, body);
		await app.changeAuth("acct_b");
		await selectConversation(app);
		assert.equal(app.host.querySelector("textarea").value, "");
		assertNoForeignFrame(app, body);
		await type(app.host, "B owns different text");
		await app.changeAuth("acct_a");
		await selectConversation(app);
		assert.equal(app.host.querySelector("textarea").value, body);
		assert.equal(
			app.fixture.calls.filter(
				(call) => call.op === "team_bridge.messages.send",
			).length,
			0,
		);
		assert.equal(
			app.host.querySelector("[data-pending]"),
			null,
			"no optimistic feature restoration",
		);
	} finally {
		await app.close();
	}
});

test("inherited mutation retry cannot dispatch A private text as B after real auth completion", async () => {
	const app = await mount();
	const body = "A held private send";
	try {
		app.fixture.postGate = deferred();
		await type(app.host, body);
		await send(app.host);
		await until(
			() =>
				app.fixture.calls.some(
					(call) => call.op === "team_bridge.messages.send",
				),
			"A POST dispatched",
		);
		const gate = app.fixture.postGate;
		await app.changeAuth("acct_b");
		app.fixture.postGate = null;
		app.fixture.refuse = true;
		await act(async () => gate.resolve());
		await act(async () => new Promise((resolve) => setTimeout(resolve, 1200)));
		const posts = app.fixture.calls.filter(
			(call) => call.op === "team_bridge.messages.send",
		);
		assert.equal(
			posts.length,
			1,
			"automatic retry refused before B credential dispatch",
		);
		assert.equal(posts[0].owner, "acct_a");
		assertNoForeignFrame(app, body);
	} finally {
		await app.close();
	}
});

test("auth completion revokes private rendering before the new account read answers", async () => {
	const app = await mount();
	let commissioned;
	try {
		await readyA(app);
		app.fixture.account = "acct_b";
		app.fixture.authGate = deferred();
		await act(async () => {
			commissioned = ui.commissionAccountRead(app.client);
		});
		await delay();
		assert.equal(
			app.host.textContent.includes(MARKER),
			false,
			"credential-write transition cannot keep showing A while account read is pending",
		);
		app.fixture.authGate.resolve();
		app.fixture.authGate = null;
		await act(async () => commissioned);
		await act(async () =>
			app.client.invalidateQueries({ queryKey: ui.teamBridgeKeys.status }),
		);
		await until(
			() =>
				app.frames.some(
					(frame) => frame.auth === "acct_b" && frame.account === "acct_b",
				),
			"real B auth/status commit after pending transition",
		);
		assertNoForeignFrame(app);
	} finally {
		app.fixture.authGate?.resolve();
		await app.close();
	}
});

test("old runtime refuses covered private writes before dispatch and holds stay closed", async () => {
	const app = await mount();
	try {
		await readyA(app);
		assert.equal(
			app.host.querySelector('button[aria-label="Reply in thread"]'),
			null,
		);
		assert.equal(
			app.host.querySelector('button[aria-label="Add reaction"]'),
			null,
		);
		app.fixture.ownerGuard = 0;
		app.fixture.refuse = false;
		const before = app.fixture.calls.filter(
			(call) => call.op === "team_bridge.messages.send",
		).length;
		await assert.rejects(() =>
			ui.TeamBridgeApi.send("bcv_shared", {
				body: "private old-runtime refusal",
				clientRef: "fixture-ref",
				tenantId: "org_shared",
				expectedAccountId: "acct_a",
			}),
		);
		assert.equal(
			app.fixture.calls.filter(
				(call) => call.op === "team_bridge.messages.send",
			).length,
			before,
		);
	} finally {
		await app.close();
	}
});

const { desktopRequestSchema, desktopEndpoint: jobsCancelEndpoint } = ui;
// Owner guard metadata is local runtime authority, not a hub member body field.
for (const [op, fields, location] of [
	["conversations.create", { kind: "group", members: [] }, "body"],
	[
		"messages.send",
		{ conversation_id: "conv", client_ref: "ref", body: "private" },
		"body",
	],
	["conversations.join", { conversation_id: "conv" }, "body"],
	["conversations.notify", { conversation_id: "conv", notify: "mute" }, "body"],
	["read", { conversation_id: "conv", seq: 1 }, "body"],
	[
		"conversations.consent",
		{
			conversation_id: "conv",
			account_id: "member",
			decision: "accept",
			consent_version: "1",
		},
		"body",
	],
	[
		"conversations.lifecycle",
		{ conversation_id: "conv", action: "archive" },
		"query",
	],
	[
		"conversations.lifecycle",
		{ conversation_id: "conv", action: "unarchive" },
		"query",
	],
	[
		"conversations.lifecycle",
		{ conversation_id: "conv", action: "leave" },
		"query",
	],
	[
		"conversations.lifecycle",
		{ conversation_id: "conv", action: "join" },
		"body",
	],
	[
		"conversations.members.add",
		{
			conversation_id: "conv",
			members: [{ account_id: "member", kind: "human", display_label: "Peer" }],
		},
		"query",
	],
	[
		"conversations.members.remove",
		{ conversation_id: "conv", account_id: "member" },
		"query",
	],
]) {
	test(`conversation owner guard ${op} ${fields.action ?? ""} uses ${location} with explicit target tenant`, () => {
		const input = {
			op: `team_bridge.${op}`,
			...fields,
			expected_account_id: "captured-A",
			tenant_id: "other-org",
		};
		const parsed = desktopRequestSchema.parse(input);
		const route = jobsCancelEndpoint(parsed);
		const authority =
			location === "body"
				? route.body
				: Object.fromEntries(new URL(route.path, "http://local").searchParams);
		assert.equal(authority.expected_account_id, "captured-A");
		assert.equal(authority.tenant_id, "other-org");
		if (op === "conversations.members.add")
			assert.deepEqual(route.body, fields.members);
		assert.equal(
			desktopRequestSchema.safeParse({ ...input, tenant_id: undefined })
				.success,
			false,
		);
		assert.equal(
			desktopRequestSchema.safeParse({ ...input, expected_account_id: "" })
				.success,
			false,
		);
	});
}
