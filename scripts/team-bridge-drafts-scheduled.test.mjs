import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// Exercise shipped helpers/hooks, not a second persistence implementation.
// This is DOM/state and wire-contract proof, not a native/rendered-frame claim.
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
for (const name of [
	"HTMLElement",
	"Element",
	"Node",
	"NodeFilter",
	"MutationObserver",
	"DocumentFragment",
	"CustomEvent",
	"HTMLInputElement",
])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
// Same selected-row import seam as the directory suite: keep the shipped role
// literal without pulling the unrelated full chat sidebar into this DOM probe.
const sidebarRole = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
).match(/export const rowCurrent =\s*("[^"]+")/)?.[1];
assert.ok(sidebarRole);
const SIDEBAR_IMPORT = /chat\/components\/chat-sidebar$/;
const ANY_PATH = /.*/;
const sidebarStub = {
	name: "chat-sidebar-stub",
	setup(build) {
		build.onResolve({ filter: SIDEBAR_IMPORT }, () => ({
			path: "sidebar-role",
			namespace: "stub",
		}));
		build.onLoad({ filter: ANY_PATH, namespace: "stub" }, () => ({
			contents: `export const rowCurrent = ${sidebarRole};`,
			loader: "js",
		}));
	},
};
const bundle = await build({
	stdin: {
		contents: `export {registerCatalogue, setLocale} from "./src/i18n";
 export {TeamBridgeApi} from "./src/renderer/src/shared/api/local-operator/team-bridge-api";
 export {agentMessagesApi} from "./src/renderer/src/shared/api/local-operator/agent-messages-api";
 export {draftAccountEpoch} from "./src/renderer/src/shared/store/team-bridge-draft-account";
 export {TeamBridgePageView} from "./src/renderer/src/features/team-bridge/team-bridge-page";
 export * from "./src/renderer/src/features/team-bridge/team-bridge-drafts";
 export * from "./src/renderer/src/features/team-bridge/use-team-bridge-drafts";
 export * from "./src/renderer/src/features/team-bridge/team-bridge-scheduling";
 export {desktopEndpoint, desktopRequestSchema} from "./src/shared/desktop-contract";
 export {TeamBridgeScheduledListView, TeamBridgeScheduledRow, TeamBridgeScheduleDialog} from "./src/renderer/src/features/team-bridge/team-bridge-scheduled";
 export {teamBridgeScheduledMessageSchema, teamBridgeScheduledListSchema} from "./src/shared/team-bridge-contract";
 export {useStickToBottom} from "./src/renderer/src/features/team-bridge/use-stick-to-bottom";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["react", "react-dom"],
	plugins: [sidebarStub],
	// DOM/state test only: CSS is deliberately not claimed as frame evidence.
	loader: { ".css": "empty" },
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiled = new Module(
	`${process.cwd()}/scripts/team-bridge-drafts-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/team-bridge-drafts-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const model = compiled.exports;
const LOST_RESPONSE = /response lost/;
const person = { type: "person", accountId: "acct_b" };
const other = { type: "chief", accountId: "acct_b" };
let current;
function Probe(props) {
	current = model.useTeamBridgeDrafts(
		props.account ?? "acct_a",
		props.tenant ?? "org_a",
		props.target ?? person,
		"",
		props.signedOut,
	);
	return null;
}

async function mount() {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	const render = async (props = {}) => {
		await act(async () => root.render(React.createElement(Probe, props)));
	};
	const close = async () => {
		await act(async () => root.unmount());
		element.remove();
	};
	await render();
	return { render, close };
}

test("drafts survive target/org switching and reload, with recipient chips and retry ID", async () => {
	localStorage.clear();
	const app = await mount();
	await act(async () => current.setBody("private person draft"));
	const ref = current.current.clientRef;
	await app.render({ target: other });
	assert.equal(current.body, "");
	await act(async () => current.setBody("chief draft"));
	await app.render({ tenant: "org_b" });
	assert.equal(current.body, "");
	await act(async () => current.setBody("other org"));
	await app.render();
	assert.equal(current.body, "private person draft");
	assert.equal(current.current.clientRef, ref);
	const target = {
		type: "compose",
		recipients: [{ kind: "human", accountId: "acct_b", label: "Bea" }],
	};
	await app.render({ target });
	await act(async () => current.setBody("group draft"));
	await act(async () =>
		current.update({
			conversationId: "bcv_created",
			sendAt: "2030-01-01T12:00:00Z",
		}),
	);
	await app.close();
	const reload = await mount();
	await reload.render({ target });
	assert.equal(current.body, "group draft");
	assert.deepEqual(current.current.target.recipients, target.recipients);
	assert.equal(current.current.conversationId, "bcv_created");
	assert.equal(current.current.sendAt, "2030-01-01T12:00:00Z");
	await reload.close();
});

test("settling a send clears only the submitted revision in its original target", async () => {
	localStorage.clear();
	const app = await mount();
	await act(async () => current.setBody("same"));
	const submitted = current;
	const ref = current.current.clientRef;
	await app.render({ target: other });
	await act(async () => current.setBody("same"));
	await act(async () =>
		submitted.clearSent(model.draftTargetKey(person), "same", ref),
	);
	assert.equal(current.body, "same");
	await app.render();
	assert.equal(current.body, "");
	await act(async () => current.setBody("first"));
	const old = current;
	await act(async () => current.setBody("edited"));
	await act(async () =>
		old.clearSent(model.draftTargetKey(person), "first", old.current.clientRef),
	);
	assert.equal(current.body, "edited");
	await app.close();
});

test("authoritative logout/account switch erases old authored bodies but offline reads do not", () => {
	localStorage.clear();
	const key = model.draftStorageKey("acct_a", "org_a");
	localStorage.setItem(
		key,
		JSON.stringify({
			[model.draftTargetKey(person)]: {
				target: person,
				body: "private",
				clientRef: "ref",
			},
		}),
	);
	model.reconcileDraftAccount(localStorage, { state: "unavailable" });
	assert.ok(localStorage.getItem(key));
	model.reconcileDraftAccount(localStorage, {
		state: "ready",
		account_id: "acct_b",
	});
	assert.equal(localStorage.getItem(key), null);
	const next = model.draftStorageKey("acct_b", "org_a");
	localStorage.setItem(next, "{}");
	model.reconcileDraftAccount(localStorage, { state: "signed_out" });
	assert.equal(localStorage.getItem(next), null);
});

test("corrupt recipient storage cannot crash the To bar; scope keys cannot collide", () => {
	assert.notEqual(
		model.draftStorageKey("a:b", "c"),
		model.draftStorageKey("a", "b:c"),
	);
	const invalid = {
		compose: {
			target: { type: "compose", recipients: [null] },
			body: "text",
			clientRef: "ref",
		},
	};
	assert.deepEqual(
		model.readDrafts({ getItem: () => JSON.stringify(invalid) }, "key"),
		{},
	);
	assert.deepEqual(model.readDrafts({ getItem: () => "{broken" }, "key"), {});
});

test("first create succeeds, schedule response is lost, reload retry reuses conversation and client_ref", async () => {
	const events = [];
	let acknowledged;
	let fail = true;
	let creates = 0;
	const args = {
		tenantId: "org_a",
		body: "draft",
		clientRef: "stable-ref",
		sendAt: "2030-01-01T12:00:00Z",
		recipients: [
			{ kind: "human", accountId: "b", label: "Bea" },
			{ kind: "human", accountId: "c", label: "Cora" },
		],
		remembered: new Map(),
		onCreated: (id) => {
			acknowledged = id;
			events.push("durable-id");
		},
		create: async () => {
			creates++;
			return { id: "bcv_group", tenant_id: "org_a" };
		},
		schedule: async (request) => {
			events.push("post");
			assert.equal(request.conversation_id, acknowledged);
			assert.equal(request.client_ref, "stable-ref");
			if (fail) throw new Error("response lost");
			return { id: "scheduled" };
		},
	};
	await assert.rejects(model.scheduleTeamBridgeDraft(args), LOST_RESPONSE);
	assert.deepEqual(events, ["durable-id", "post"]);
	fail = false;
	await model.scheduleTeamBridgeDraft({
		...args,
		remembered: new Map(),
		conversationId: acknowledged,
	});
	assert.equal(creates, 1);
});

test("local date validation rejects normalization and enforces inclusive server window", () => {
	const value = "2030-04-05T12:30";
	const at = new Date(value).getTime();
	assert.equal(
		model.scheduledSendAt(value, at - 60_000),
		new Date(at).toISOString(),
	);
	assert.equal(model.scheduledSendAt(value, at - 59_999), null);
	assert.equal(
		model.scheduledSendAt(value, at - 120 * 86_400_000),
		new Date(at).toISOString(),
	);
	assert.equal(model.scheduledSendAt(value, at - 120 * 86_400_000 - 1), null);
	assert.equal(
		model.scheduledSendAt("2030-02-30T12:30", at - 86_400_000),
		null,
	);
	assert.equal(model.scheduledSendAt("not a date"), null);
});

test("scheduled ops map strict tenant selectors and normal DTOs, including msg-only cancel ack", () => {
	const create = model.desktopRequestSchema.parse({
		op: "team_bridge.scheduled.create",
		tenant_id: "org_a",
		conversation_id: "bcv_a",
		client_ref: "ref",
		body: "private",
		send_at: "2030-04-05T12:30:00Z",
	});
	assert.equal(
		model.desktopEndpoint(create).path,
		"/v1/desktop/team-bridge/scheduled",
	);
	assert.equal(model.desktopEndpoint(create).method, "POST");
	const update = model.desktopEndpoint(
		model.desktopRequestSchema.parse({
			op: "team_bridge.scheduled.update",
			tenant_id: "org_a",
			scheduled_id: "bsch_1",
			body: "edit",
		}),
	);
	assert.equal(
		update.path,
		"/v1/desktop/team-bridge/scheduled/bsch_1?tenant_id=org_a",
	);
	assert.deepEqual(update.body, { body: "edit" });
	const cancel = model.desktopEndpoint(
		model.desktopRequestSchema.parse({
			op: "team_bridge.scheduled.cancel",
			tenant_id: "org_a",
			scheduled_id: "id",
		}),
	);
	assert.equal(cancel.method, "DELETE");
	assert.equal(
		model.desktopRequestSchema.safeParse({
			op: "team_bridge.scheduled.cancel",
			scheduled_id: "id",
		}).success,
		false,
	);
	assert.equal(
		model.desktopRequestSchema.safeParse({
			...create,
			send_at: "2030-04-05T12:30:00",
		}).success,
		false,
	);
	assert.equal(
		model.desktopRequestSchema.safeParse({ ...create, unexpected: true })
			.success,
		false,
	);
	const row = {
		id: "id",
		tenant_id: "org_a",
		conversation_id: "bcv_a",
		body: "private",
		send_at: create.send_at,
		status: "sending",
		created_at: create.send_at,
	};
	assert.equal(
		model.teamBridgeScheduledListSchema.parse({ scheduled: [row] }).scheduled
			.length,
		1,
	);
	assert.equal(
		model.teamBridgeScheduledMessageSchema.safeParse({ ...row, status: "sent" })
			.success,
		false,
	);
});

test("changed To recipients invalidate an acknowledged group ID, reordering does not", async () => {
	localStorage.clear();
	const app = await mount();
	const b = { kind: "human", accountId: "b", label: "Bea" };
	const c = { kind: "human", accountId: "c", label: "Cora" };
	await app.render({ target: { type: "compose", recipients: [b, c] } });
	await act(async () =>
		current.update({
			body: "draft",
			conversationId: "old_group",
			sendAt: "2030-01-01T12:00:00Z",
		}),
	);
	const ref = current.current.clientRef;
	await app.render({ target: { type: "compose", recipients: [c, b] } });
	assert.equal(current.current.conversationId, "old_group");
	assert.equal(current.current.clientRef, ref);
	await app.render({ target: { type: "compose", recipients: [b] } });
	assert.equal(current.current.conversationId, undefined);
	assert.equal(current.current.sendAt, undefined);
	assert.notEqual(current.current.clientRef, ref);
	assert.equal(current.body, "draft");
	await app.close();
});

test("quota failure preserves in-memory work across target switches and refuses durable send setup", async () => {
	localStorage.clear();
	const app = await mount();
	const prototype = Object.getPrototypeOf(localStorage);
	const original = prototype.setItem;
	prototype.setItem = () => {
		throw new Error("quota");
	};
	try {
		let persisted;
		await act(async () => {
			persisted = current.update({ body: "do not lose" });
		});
		assert.equal(persisted, false);
		assert.equal(current.storageFailed, true);
		await app.render({ target: other });
		await app.render();
		assert.equal(current.body, "do not lose");
	} finally {
		prototype.setItem = original;
		await app.close();
	}
});

test("cancel race and network errors preserve rows, refresh state, and leave an accessible error", async () => {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	const row = {
		id: "bsch_a",
		tenant_id: "org_a",
		conversation_id: "bcv_a",
		body: "private fixture",
		send_at: "2030-04-05T12:30:00Z",
		status: "scheduled",
		created_at: "2030-04-05T10:00:00Z",
	};
	let refreshes = 0;
	const requests = [];
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				return {
					status: 409,
					body: {
						detail: { code: "invalid_transition", message: "already sending" },
					},
				};
			},
		},
	};
	try {
		await act(async () =>
			root.render(
				React.createElement(model.TeamBridgeScheduledListView, {
					state: "ready",
					messages: [row],
					refresh: async () => {
						refreshes++;
					},
				}),
			),
		);
		const cancel = [...element.querySelectorAll("button")].find(
			(button) => button.textContent === "Cancel message",
		);
		assert.ok(cancel);
		await act(async () => cancel.click());
		assert.equal(requests[0].op, "team_bridge.scheduled.cancel");
		assert.equal(requests[0].tenant_id, "org_a");
		assert.equal(refreshes, 1);
		assert.ok(element.querySelector('[role="alert"]'));
		assert.ok(element.textContent.includes("private fixture"));
		window.api.desktop.request = async () => {
			throw new Error("offline");
		};
		await act(async () => cancel.click());
		assert.equal(refreshes, 2);
		assert.equal(cancel.disabled, false);
		await act(async () =>
			root.render(
				React.createElement(model.TeamBridgeScheduledListView, {
					state: "ready",
					messages: [{ ...row, status: "sending" }],
					refresh: async () => {},
				}),
			),
		);
		assert.equal(
			[...element.querySelectorAll("button")].some(
				(button) => button.textContent === "Cancel message",
			),
			false,
		);
	} finally {
		await act(async () => root.unmount());
		element.remove();
		window.api = undefined;
	}
});

test("late draft callbacks cannot restore private bodies after logout or account replacement", async () => {
	localStorage.clear();
	const app = await mount();
	await act(async () => current.setBody("private deferred body"));
	const stale = current;
	let resolve;
	const deferred = new Promise((done) => {
		resolve = done;
	});
	const completion = deferred.then(() => {
		stale.update({ conversationId: "late_group" });
		stale.update({ createUncertain: false, sendAt: undefined });
		stale.clearSent(
			model.draftTargetKey(person),
			"different body",
			stale.current.clientRef,
		);
	});
	model.reconcileDraftAccount(localStorage, { state: "signed_out" });
	await app.render({ signedOut: true });
	await act(async () => {
		resolve();
		await completion;
	});
	assert.equal(
		localStorage.getItem(model.draftStorageKey("acct_a", "org_a")),
		null,
	);
	await app.render({ account: "acct_b" });
	await act(async () => stale.setBody("late edit"));
	assert.equal(
		localStorage.getItem(model.draftStorageKey("acct_a", "org_a")),
		null,
	);
	await app.close();
});

test("two schedules after first-group success reuse the created conversation", async () => {
	const compose = {
		type: "compose",
		recipients: [
			{ kind: "human", accountId: "b", label: "Bea" },
			{ kind: "human", accountId: "c", label: "Cora" },
		],
	};
	let target = compose;
	let groups = 0;
	const run = async () => {
		const startedOn = target;
		await model.scheduleTeamBridgeDraft({
			tenantId: "org_a",
			recipients: compose.recipients,
			conversationId: target.type === "conversation" ? target.id : undefined,
			body: "scheduled draft",
			clientRef: crypto.randomUUID(),
			sendAt: "2030-01-01T12:00:00Z",
			remembered: new Map(),
			onCreated: () => {},
			create: async () => ({ id: `group_${++groups}` }),
			schedule: async () => ({}),
			onScheduled: (id) => {
				const next = model.scheduledTargetAfterSuccess(startedOn, target, id);
				if (next) target = next;
			},
		});
	};
	await run();
	await run();
	assert.equal(groups, 1);
	assert.equal(target.id, "group_1");
});

test("account revocation fences callbacks after page unmount and same-account login", async () => {
	localStorage.clear();
	const app = await mount();
	await act(async () => current.setBody("unmounted private body"));
	const stale = current;
	await app.close();
	model.reconcileDraftAccount(localStorage, { state: "signed_out" });
	const again = await mount();
	await act(async () => stale.update({ conversationId: "late_group" }));
	assert.equal(
		localStorage.getItem(model.draftStorageKey("acct_a", "org_a")),
		null,
	);
	await again.close();
});

test("schedule completion does not navigate away from a subsequently selected target", async () => {
	const started = { type: "compose", recipients: [] };
	const selected = { type: "conversation", id: "other" };
	assert.equal(
		model.scheduledTargetAfterSuccess(started, selected, "created"),
		null,
	);
	assert.deepEqual(
		model.scheduledTargetAfterSuccess(started, started, "created"),
		{ type: "conversation", id: "created" },
	);
	assert.equal(
		model.canResetScheduleAttempt("2030-01-01T12:00:00Z", 429),
		false,
	);
	assert.equal(
		model.canResetScheduleAttempt("2030-01-01T12:00:00Z", 400),
		false,
	);
	assert.equal(model.canResetScheduleAttempt(undefined, 400), true);
});

test("one organization refusal preserves another organization's pending schedule", async () => {
	const row = {
		id: "bsch_a",
		tenant_id: "org_ok",
		send_at: "2030-01-01T12:00:00Z",
	};
	const result = await model.listScheduledTenants(
		["org_ok", "org_refused"],
		async (tenant) => {
			if (tenant === "org_refused") throw new Error("refused");
			return { scheduled: [row] };
		},
	);
	assert.deepEqual(result.scheduled, [row]);
	assert.deepEqual(result.failedTenants, ["org_refused"]);
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	try {
		await act(async () =>
			root.render(
				React.createElement(model.TeamBridgeScheduledListView, {
					state: "ready",
					failedTenants: result.failedTenants,
					organizationNames: { org_refused: "Northwind team" },
					messages: [
						{
							...row,
							conversation_id: "bcv_a",
							body: "pending fixture",
							status: "scheduled",
							created_at: row.send_at,
						},
					],
					refresh: async () => {},
				}),
			),
		);
		assert.ok(element.textContent.includes("Northwind team"));
		assert.equal(element.textContent.includes("org_refused"), false);
		assert.ok(
			[...element.querySelectorAll("button")].some(
				(button) => button.textContent === "Cancel message",
			),
		);
		await act(async () =>
			root.render(
				React.createElement(model.TeamBridgeScheduledListView, {
					state: "ready",
					failedTenants: ["org_unknown"],
					messages: [],
					refresh: async () => {},
				}),
			),
		);
		assert.ok(element.textContent.includes("org_unknown"));
	} finally {
		await act(async () => root.unmount());
		element.remove();
	}
});

test("body-only edits omit send_at, unchanged fields and original second precision survive", () => {
	const row = { body: "old", send_at: "2030-04-05T12:30:45Z" };
	assert.deepEqual(model.scheduledEditPatch(row, row.send_at, "edited"), {
		body: "edited",
	});
	assert.deepEqual(model.scheduledEditPatch(row, row.send_at, "old"), {});
	assert.deepEqual(
		model.scheduledEditPatch(row, "2030-04-05T13:30:00Z", "old"),
		{ send_at: "2030-04-05T13:30:00Z" },
	);
});

test("edit failures refresh the list for 429, 409 and offline; failed edits stay in the dialog", async () => {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	const row = {
		id: "bsch_edit",
		tenant_id: "org_a",
		conversation_id: "bcv_a",
		body: "original fixture",
		send_at: new Date(Date.now() + 600_000).toISOString(),
		status: "scheduled",
		created_at: new Date().toISOString(),
	};
	let refreshes = 0;
	let status = 429;
	const requests = [];
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				if (status === null) throw new Error("offline");
				return {
					status,
					body: { detail: { code: "invalid_transition", message: "refused" } },
				};
			},
		},
	};
	try {
		await act(async () =>
			root.render(
				React.createElement(model.TeamBridgeScheduledRow, {
					message: row,
					refresh: async () => {
						refreshes++;
					},
				}),
			),
		);
		await act(async () =>
			[...element.querySelectorAll("button")]
				.find((button) => button.textContent === "Reschedule")
				.click(),
		);
		const dialog = document.querySelector('[role="dialog"]');
		assert.ok(dialog);
		const input = dialog.querySelector('input[type="datetime-local"]');
		assert.equal(input.value, model.scheduledLocalInput(row.send_at));
		const textarea = dialog.querySelector("textarea");
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				dom.window.HTMLTextAreaElement.prototype,
				"value",
			).set.call(textarea, "edited fixture");
			textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		const action = () =>
			[...dialog.querySelectorAll("button")].find(
				(button) =>
					button.textContent === "Review schedule" ||
					button.textContent === "Confirm schedule",
			);
		assert.equal(action().disabled, false);
		await act(async () => action().click());
		for (const refusal of [429, 409, null]) {
			status = refusal;
			await act(async () => action().click());
		}
		assert.equal(refreshes, 3);
		assert.equal(textarea.value, "edited fixture");
		assert.ok(dialog.querySelector('[role="alert"]'));
		assert.ok(
			requests.every(
				(request) =>
					request.body === "edited fixture" && request.send_at === undefined,
			),
		);
		await act(async () =>
			[...dialog.querySelectorAll("button")]
				.find((button) => button.getAttribute("aria-label") === "Close")
				.click(),
		);
		await act(async () =>
			root.render(
				React.createElement(model.TeamBridgeScheduledRow, {
					message: { ...row, body: "latest server body" },
					refresh: async () => {},
				}),
			),
		);
		await act(async () =>
			[...element.querySelectorAll("button")]
				.find((button) => button.textContent === "Reschedule")
				.click(),
		);
		assert.equal(
			document.querySelector('[role="dialog"] textarea').value,
			"latest server body",
		);
	} finally {
		await act(async () => root.unmount());
		element.remove();
		window.api = undefined;
	}
});

test("a pending group schedule does not steal selection after target switch", async () => {
	const started = {
		type: "compose",
		recipients: [
			{ kind: "human", accountId: "b", label: "Bea" },
			{ kind: "human", accountId: "c", label: "Cora" },
		],
	};
	let target = started;
	let resolve;
	let posted;
	const began = new Promise((done) => {
		posted = done;
	});
	const response = new Promise((done) => {
		resolve = done;
	});
	const pending = model.scheduleTeamBridgeDraft({
		tenantId: "org_a",
		recipients: started.recipients,
		body: "draft",
		clientRef: "ref",
		sendAt: "2030-01-01T12:00:00Z",
		remembered: new Map(),
		onCreated: () => {},
		create: async () => ({ id: "created" }),
		schedule: async () => {
			posted();
			await response;
			return {};
		},
		onScheduled: (id) => {
			const next = model.scheduledTargetAfterSuccess(started, target, id);
			if (next) target = next;
		},
	});
	await began;
	target = { type: "person", accountId: "other" };
	resolve();
	await pending;
	assert.deepEqual(target, { type: "person", accountId: "other" });
});

test("direct account replacement and return never reauthorize an old draft callback", async () => {
	localStorage.clear();
	const app = await mount();
	await act(async () => current.setBody("old account body"));
	const stale = current;
	await app.render({ account: "acct_replacement" });
	await act(async () => stale.update({ conversationId: "late" }));
	assert.equal(
		localStorage.getItem(model.draftStorageKey("acct_a", "org_a")),
		null,
	);
	await app.render();
	await act(async () => stale.setBody("late body"));
	assert.equal(
		localStorage.getItem(model.draftStorageKey("acct_a", "org_a")),
		null,
	);
	await app.close();
});

test("merged draft enumeration is memoized across rerenders and local writes", async () => {
	localStorage.clear();
	const foreignKey = model.draftStorageKey("acct_a", "org_cached");
	localStorage.setItem(
		foreignKey,
		JSON.stringify({
			[model.draftTargetKey(person)]: {
				target: person,
				body: "cached",
				clientRef: "cached-ref",
			},
		}),
	);
	const prototype = Object.getPrototypeOf(localStorage);
	const original = prototype.getItem;
	let reads = 0;
	prototype.getItem = function (key) {
		if (key === foreignKey) reads++;
		return original.call(this, key);
	};
	const app = await mount();
	try {
		await app.render({ tenant: "all" });
		const first = reads;
		await app.render({ tenant: "all" });
		await act(async () => current.setBody("local write"));
		assert.ok(first > 0);
		assert.equal(reads, first);
		assert.ok(current.entries.some(({ entry }) => entry.body === "cached"));
	} finally {
		prototype.getItem = original;
		await app.close();
	}
});

test("a held schedule can be explicitly discarded before a fresh send or schedule", async () => {
	for (const mode of ["send", "schedule"]) {
		localStorage.clear();
		const element = document.createElement("div");
		document.body.append(element);
		let root = createRoot(element);
		const key = model.draftStorageKey("acct_recovery", "org_recovery");
		const target = { type: "conversation", id: "bcv_recovery" };
		const body = "recover this draft";
		const heldTime = new Date(Date.now() + 3_600_000).toISOString();
		localStorage.setItem(
			key,
			JSON.stringify({
				[model.draftTargetKey(target)]: {
					target,
					body,
					clientRef: "held-reference",
					sendAt: heldTime,
				},
			}),
		);
		const sends = [];
		const schedules = [];
		let refuse = true;
		const conversation = {
			id: target.id,
			tenant_id: "org_recovery",
			kind: "group",
			name: "Recovery",
			members: [],
			visibility: "private",
			agent_capable: false,
			status: "open",
			created_by: "acct_recovery",
			last_message_at: heldTime,
			latest_seq: 0,
			last_read_seq: 0,
			unread_count: 0,
			muted: false,
		};
		const props = {
			selfAccountId: "acct_recovery",
			scope: "org_recovery",
			target,
			conversations: [conversation],
			messages: [],
			organizations: [
				{
					tenantId: "org_recovery",
					name: "Recovery organization",
					role: "owner",
					unread: 0,
				},
			],
			totalUnread: 0,
			listState: "ready",
			messageState: "ready",
			onTarget: () => {},
			onNewChannel: () => {},
			onScopeChange: () => {},
			onSend: async (...args) => {
				sends.push(args);
			},
			onSchedule: async (...args) => {
				schedules.push(args);
				if (refuse)
					throw Object.assign(new Error("outside window"), { status: 400 });
			},
		};
		try {
			await act(async () =>
				root.render(React.createElement(model.TeamBridgePageView, props)),
			);
			await act(async () =>
				[...element.querySelectorAll("button")]
					.find((button) => button.textContent === "Retry previous schedule")
					.click(),
			);
			assert.equal(schedules.length, 1);
			assert.equal(
				JSON.parse(localStorage.getItem(key))[model.draftTargetKey(target)]
					.clientRef,
				"held-reference",
			);
			// Re-mount from disk: recovery must not depend on clearing renderer memory.
			await act(async () => root.unmount());
			root = createRoot(element);
			await act(async () =>
				root.render(React.createElement(model.TeamBridgePageView, props)),
			);
			const send =
				element.querySelector('button[aria-label="Send message"]') ??
				[...element.querySelectorAll("button")].find(
					(button) => button.getAttribute("aria-label") === "Send",
				);
			assert.ok(send);
			assert.equal(send.disabled, true);
			assert.ok(send.getAttribute("aria-describedby"));
			const discard = [...element.querySelectorAll("button")].find(
				(button) =>
					button.textContent === "I checked Scheduled — discard this attempt",
			);
			assert.ok(discard);
			await act(async () => discard.click());
			const entry = JSON.parse(localStorage.getItem(key))[
				model.draftTargetKey(target)
			];
			assert.equal(entry.sendAt, undefined);
			assert.notEqual(entry.clientRef, "held-reference");
			assert.equal(entry.body, body);
			refuse = false;
			if (mode === "send") {
				await act(async () => send.click());
				assert.equal(sends.length, 1);
				assert.equal(sends[0][0], body);
				assert.equal(sends[0][1], entry.clientRef);
			} else {
				await act(async () =>
					element
						.querySelector('button[aria-label="Schedule message"]')
						.click(),
				);
				const dialog = document.querySelector('[role="dialog"]');
				const input = dialog.querySelector('input[type="datetime-local"]');
				await act(async () => {
					Object.getOwnPropertyDescriptor(
						dom.window.HTMLInputElement.prototype,
						"value",
					).set.call(
						input,
						model.scheduledLocalInput(
							new Date(Date.now() + 7_200_000).toISOString(),
						),
					);
					input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
				});
				const action = () =>
					[...dialog.querySelectorAll("button")].find(
						(button) =>
							button.textContent === "Review schedule" ||
							button.textContent === "Confirm schedule",
					);
				await act(async () => action().click());
				await act(async () => action().click());
				assert.equal(schedules.length, 2);
				assert.notEqual(schedules[1][1], "held-reference");
				assert.notEqual(schedules[1][2], heldTime);
			}
		} finally {
			await act(async () => root.unmount());
			element.remove();
		}
	}
});

test("normal first scheduling never flashes held recovery; only settled failure reveals it", async () => {
	const russian = JSON.parse(
		readFileSync("src/i18n/catalogues/ru/ui.teamBridge.json", "utf8"),
	);
	model.registerCatalogue("ru", russian);
	for (const outcome of ["success", "failure"]) {
		localStorage.clear();
		const element = document.createElement("div");
		document.body.append(element);
		const root = createRoot(element);
		let settle;
		const response = new Promise((resolve, reject) => {
			settle = () =>
				outcome === "success"
					? resolve({})
					: reject(new Error("fixture lost response"));
		});
		const time = new Date(Date.now() + 3_600_000).toISOString();
		const conversation = {
			id: "bcv_pending",
			tenant_id: "org_pending",
			kind: "group",
			name: "Pending schedule",
			members: [],
			visibility: "private",
			agent_capable: false,
			status: "open",
			created_by: "acct_pending",
			last_message_at: time,
			latest_seq: 0,
			last_read_seq: 0,
			unread_count: 0,
			muted: false,
		};
		const props = {
			selfAccountId: "acct_pending",
			scope: "org_pending",
			target: { type: "conversation", id: conversation.id },
			conversations: [conversation],
			messages: [],
			organizations: [
				{
					tenantId: "org_pending",
					name: "Pending organization",
					role: "owner",
					unread: 0,
				},
			],
			totalUnread: 0,
			listState: "ready",
			messageState: "ready",
			initialDraft: "pending fixture draft",
			onTarget: () => {},
			onNewChannel: () => {},
			onScopeChange: () => {},
			onSend: async () => {},
			onSchedule: () => response,
		};
		try {
			await act(async () =>
				root.render(React.createElement(model.TeamBridgePageView, props)),
			);
			await act(async () =>
				element.querySelector('button[aria-label="Schedule message"]').click(),
			);
			const dialog = document.querySelector('[role="dialog"]');
			const input = dialog.querySelector('input[type="datetime-local"]');
			await act(async () => {
				Object.getOwnPropertyDescriptor(
					dom.window.HTMLInputElement.prototype,
					"value",
				).set.call(input, model.scheduledLocalInput(time));
				input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
			});
			const action = () =>
				[...dialog.querySelectorAll("button")].find(
					(button) =>
						button.textContent === "Review schedule" ||
						button.textContent === "Confirm schedule",
				);
			await act(async () => action().click());
			await act(async () => action().click());
			assert.equal(
				element.textContent.includes("A previous schedule may still exist"),
				false,
			);
			assert.equal(element.textContent.includes("I checked Scheduled"), false);
			assert.equal(
				element.textContent.includes("Retry previous schedule"),
				false,
			);
			assert.equal(
				element
					.querySelector(
						'button[aria-label="Send"], button[aria-label="Send message"]',
					)
					?.getAttribute("aria-describedby"),
				null,
			);
			await act(async () => {
				settle();
				await response.catch(() => {});
			});
			if (outcome === "failure") {
				await act(async () => model.setLocale("ru"));
				const discard = [...element.querySelectorAll("button")].find(
					(button) =>
						button.textContent ===
						russian["ui.teamBridge.schedule.discard_attempt"],
				);
				assert.ok(discard);
				assert.equal(discard.classList.contains("whitespace-normal"), true);
				assert.equal(discard.classList.contains("h-auto"), true);
				const composer = discard.closest(".bg-elevated");
				assert.ok(composer?.querySelector("textarea"));
			} else
				assert.equal(
					element.textContent.includes("A previous schedule may still exist"),
					false,
				);
		} finally {
			await act(async () => {
				root.unmount();
				model.setLocale("en");
			});
			element.remove();
		}
	}
});

test("denied browser storage preserves in-memory drafts but cannot authorize persistence-dependent sends", async () => {
	localStorage.clear();
	const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		get() {
			throw new Error("browser storage denied");
		},
	});
	let app;
	try {
		app = await mount();
		let persisted;
		await act(async () => {
			persisted = current.update({ body: "retain this denied-storage draft" });
		});
		assert.equal(persisted, false);
		assert.equal(current.storageFailed, true);
		await app.render({ target: other });
		await app.render();
		assert.equal(current.body, "retain this denied-storage draft");
	} finally {
		if (app) await app.close();
		Object.defineProperty(window, "localStorage", descriptor);
	}
});

test("identity and status remain available with denied storage while account revocation still fences drafts", async () => {
	const descriptors = [
		Object.getOwnPropertyDescriptor(window, "localStorage"),
		Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
	];
	const previousApi = window.api;
	let result = {
		capability: 1,
		state: "ready",
		account_id: "acct_status_storage",
		tenant_id: "org_status_storage",
		surface_state: "B",
		visibility: {
			settings: true,
			inbox: true,
			account_door: true,
			onboarding: false,
		},
		update_required: false,
		local: { enabled: true, onboarding: "done", session: "fixture" },
		status: null,
		consent: null,
		error: null,
	};
	window.api = {
		desktop: { request: async () => ({ status: 200, body: { result } }) },
	};
	for (const object of [window, globalThis])
		Object.defineProperty(object, "localStorage", {
			configurable: true,
			get() {
				throw new Error("browser storage denied");
			},
		});
	try {
		assert.equal(await model.TeamBridgeApi.identity(), "acct_status_storage");
		assert.equal((await model.TeamBridgeApi.status()).state, "ready");
		assert.equal(
			(await model.agentMessagesApi.status("surface_open")).state,
			"ready",
		);
		const epoch = model.draftAccountEpoch("acct_status_storage");
		result = {
			...result,
			state: "signed_out",
			account_id: null,
			tenant_id: null,
		};
		assert.equal((await model.TeamBridgeApi.status()).state, "signed_out");
		assert.ok(model.draftAccountEpoch("acct_status_storage") > epoch);
	} finally {
		[window, globalThis].forEach((object, index) => {
			if (descriptors[index])
				Object.defineProperty(object, "localStorage", descriptors[index]);
			else Reflect.deleteProperty(object, "localStorage");
		});
		window.api = previousApi;
	}
});

/*
 * Design round 2, D9: at 640px the last timeline row sat under the composer's
 * top edge on first paint, because the timeline opened at scrollTop 0 and a
 * growing composer shrinks the viewport without growing the content. jsdom has
 * no layout, so the geometry is modelled (scrollHeight/clientHeight per
 * element, scrollTop clamped like a browser) and a stub ResizeObserver lets
 * the test resize the VIEWPORT: what is proved is the hook's decisions.
 */
test("D9: the timeline opens at the bottom and stays pinned when the composer grows, unless the reader scrolled up", async () => {
	const proto = window.HTMLElement.prototype;
	const saved = ["scrollHeight", "clientHeight", "scrollTop"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(proto, name),
	]);
	const tops = new WeakMap();
	const client = new WeakMap();
	const isViewport = (el) => el.hasAttribute("data-radix-scroll-area-viewport");
	Object.defineProperty(proto, "scrollHeight", {
		configurable: true,
		get() {
			return isViewport(this) ? 418 : 0;
		},
	});
	Object.defineProperty(proto, "clientHeight", {
		configurable: true,
		get() {
			return isViewport(this) ? (client.get(this) ?? 373) : 0;
		},
	});
	Object.defineProperty(proto, "scrollTop", {
		configurable: true,
		get() {
			return tops.get(this) ?? 0;
		},
		set(value) {
			const max = Math.max(0, this.scrollHeight - this.clientHeight);
			tops.set(this, Math.max(0, Math.min(max, value)));
		},
	});
	const observers = [];
	const savedObserver = globalThis.ResizeObserver;
	globalThis.ResizeObserver = class {
		constructor(callback) {
			this.callback = callback;
			this.targets = new Set();
			observers.push(this);
		}
		observe(target) {
			this.targets.add(target);
		}
		disconnect() {
			this.targets.clear();
		}
	};
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	function Timeline() {
		const { rootRef } = model.useStickToBottom({
			resetKey: "org_a:bcv_a:ready",
			contentKey: "1:bmsg_1",
		});
		return React.createElement(
			"div",
			{ ref: rootRef },
			React.createElement(
				"div",
				{ "data-radix-scroll-area-viewport": "" },
				React.createElement("div", null, "rows"),
			),
		);
	}
	const atBottom = (v) => v.scrollHeight - v.scrollTop - v.clientHeight <= 1;
	try {
		await act(async () => root.render(React.createElement(Timeline)));
		const viewport = element.querySelector("[data-radix-scroll-area-viewport]");
		assert.ok(atBottom(viewport), "opens at the newest row, not scrollTop 0");
		const watching = observers.find((o) => o.targets.has(viewport));
		assert.ok(
			watching,
			"the viewport itself is observed, not only its content",
		);
		// The composer grows by 60px: the viewport shrinks, content is unchanged.
		client.set(viewport, 313);
		assert.equal(
			atBottom(viewport),
			false,
			"harness: the shrink alone uncovers the bug",
		);
		await act(async () => watching.callback([]));
		assert.ok(atBottom(viewport), "a pinned reader stays on the newest row");
		// A reader who scrolled up is never moved by the composer.
		await act(async () => {
			viewport.scrollTop = 0;
			viewport.dispatchEvent(new window.Event("scroll"));
		});
		client.set(viewport, 253);
		await act(async () => watching.callback([]));
		assert.equal(viewport.scrollTop, 0);
	} finally {
		await act(async () => root.unmount());
		element.remove();
		globalThis.ResizeObserver = savedObserver;
		for (const [name, descriptor] of saved)
			if (descriptor) Object.defineProperty(proto, name, descriptor);
			else Reflect.deleteProperty(proto, name);
	}
});

/*
 * Review round 6 (F1 + M1): the stick-to-bottom hook binds its scroll, `load`
 * and ResizeObserver listeners per VIEWPORT. Drafts and Scheduled unmount the
 * timeline's ScrollArea, so returning to the same conversation mounts a new
 * viewport while tenant, conversation and message state are unchanged: the
 * page folds `quickView` into `resetKey` so the effect re-binds. These tests
 * model that shape (a viewport that unmounts and remounts) with the same
 * jsdom geometry stand-ins as the D9 test above.
 */
async function withStickHarness(run) {
	const proto = window.HTMLElement.prototype;
	const saved = ["scrollHeight", "clientHeight", "scrollTop"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(proto, name),
	]);
	const tops = new WeakMap();
	const isViewport = (el) => el.hasAttribute("data-radix-scroll-area-viewport");
	Object.defineProperty(proto, "scrollHeight", {
		configurable: true,
		get() {
			return isViewport(this) ? 600 : 0;
		},
	});
	Object.defineProperty(proto, "clientHeight", {
		configurable: true,
		get() {
			return isViewport(this) ? 400 : 0;
		},
	});
	Object.defineProperty(proto, "scrollTop", {
		configurable: true,
		get() {
			return tops.get(this) ?? 0;
		},
		set(value) {
			const max = Math.max(0, this.scrollHeight - this.clientHeight);
			tops.set(this, Math.max(0, Math.min(max, value)));
		},
	});
	const observers = [];
	const savedObserver = globalThis.ResizeObserver;
	globalThis.ResizeObserver = class {
		constructor() {
			this.targets = new Set();
			observers.push(this);
		}
		observe(target) {
			this.targets.add(target);
		}
		disconnect() {
			this.targets.clear();
		}
	};
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	try {
		await run({ element, root, observers });
	} finally {
		await act(async () => root.unmount());
		element.remove();
		globalThis.ResizeObserver = savedObserver;
		for (const [name, descriptor] of saved)
			if (descriptor) Object.defineProperty(proto, name, descriptor);
			else Reflect.deleteProperty(proto, name);
	}
}
const VIEWPORT = "[data-radix-scroll-area-viewport]";
function StickTimeline({ quickView, withQuickViewKey }) {
	const { rootRef } = model.useStickToBottom({
		resetKey: `org_a:bcv_a:ready${withQuickViewKey ? `:${quickView ?? ""}` : ""}`,
		contentKey: "1:bmsg_1",
	});
	// The page's shape: the timeline is the last branch of the quick-view ternary.
	return quickView
		? React.createElement("p", null, quickView)
		: React.createElement(
				"div",
				{ ref: rootRef },
				React.createElement(
					"div",
					{ "data-radix-scroll-area-viewport": "" },
					React.createElement("div", null, "rows"),
				),
			);
}
test("F1: re-selecting the conversation after Drafts/Scheduled reopens the timeline at the newest row, and the harness fails without the quickView key", async () => {
	for (const withQuickViewKey of [true, false]) {
		await withStickHarness(async ({ element, root, observers }) => {
			const render = (quickView) =>
				act(async () =>
					root.render(
						React.createElement(StickTimeline, { quickView, withQuickViewKey }),
					),
				);
			await render(null);
			const first = element.querySelector(VIEWPORT);
			assert.equal(first.scrollTop, 200, "first mount opens at the bottom");
			await render("scheduled");
			assert.equal(
				element.querySelector(VIEWPORT),
				null,
				"Scheduled unmounts it",
			);
			await render(null);
			const second = element.querySelector(VIEWPORT);
			assert.notEqual(second, first, "a NEW viewport mounted");
			const bound = observers.some((o) => o.targets.has(second));
			if (withQuickViewKey) {
				assert.equal(second.scrollTop, 200, "reopens at the newest row");
				assert.ok(bound, "listeners are bound to the new viewport");
			} else {
				// Negative control: the pre-fix key leaves the new viewport unbound.
				assert.equal(bound, false, "harness: without the key the hook is dead");
			}
		});
	}
});
test("M1: unmounting the timeline releases every listener it bound", async () => {
	await withStickHarness(async ({ element, root, observers }) => {
		await act(async () =>
			root.render(
				React.createElement(StickTimeline, { withQuickViewKey: true }),
			),
		);
		const viewport = element.querySelector(VIEWPORT);
		const calls = [];
		const remove = viewport.removeEventListener.bind(viewport);
		viewport.removeEventListener = (type, ...rest) => {
			calls.push(type);
			return remove(type, ...rest);
		};
		const watching = observers.filter((o) => o.targets.has(viewport));
		assert.ok(watching.length > 0, "the viewport was observed");
		await act(async () => root.render(React.createElement("p", null, "gone")));
		assert.deepEqual(calls.sort(), ["load", "scroll"]);
		for (const observer of watching)
			assert.equal(observer.targets.size, 0, "the observer disconnected");
	});
});

const BORDER_CLASS = /\bborder\b/;
test("D11: scheduled rows take the elevated ground on the surface page, never a border", async () => {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	try {
		await act(async () =>
			root.render(
				React.createElement(model.TeamBridgeScheduledRow, {
					message: {
						id: "bsch_d11",
						tenant_id: "org_a",
						conversation_id: "bcv_a",
						body: "fixture",
						send_at: "2030-04-05T12:30:00Z",
						status: "scheduled",
						created_at: "2030-04-05T10:00:00Z",
					},
					refresh: async () => {},
				}),
			),
		);
		const card = element.querySelector("article");
		assert.ok(card.classList.contains("bg-elevated"));
		assert.equal(card.classList.contains("bg-surface"), false);
		assert.equal(BORDER_CLASS.test(card.className), false);
	} finally {
		await act(async () => root.unmount());
		element.remove();
	}
});

/*
 * Round 12 regressions. Both were merge-resolution damage on the composer that
 * CI could not see: there was no test driving a send/schedule to completion
 * with the author still typing.
 */
const r12Conversation = {
	id: "bcv_r12",
	tenant_id: "org_r12",
	kind: "group",
	name: "Round twelve",
	members: [],
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_r12",
	last_message_at: "2030-01-01T00:00:00Z",
	latest_seq: 0,
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
};
const r12Props = (over = {}) => ({
	selfAccountId: "acct_r12",
	scope: "org_r12",
	target: { type: "conversation", id: r12Conversation.id },
	conversations: [r12Conversation],
	messages: [],
	organizations: [
		{
			tenantId: "org_r12",
			name: "Round twelve org",
			role: "owner",
			unread: 0,
		},
	],
	totalUnread: 0,
	listState: "ready",
	messageState: "ready",
	onTarget: () => {},
	onNewChannel: () => {},
	onScopeChange: () => {},
	onSend: async () => {},
	...over,
});
const r12Type = async (box, text) => {
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set.call(box, text);
		box.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
};
const r12Tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const r12SendButton = (element) =>
	element.querySelector(
		'button[aria-label="Send"], button[aria-label="Send message"]',
	);

test("r12 B1: text typed while a send is in flight survives the success clear", async () => {
	localStorage.clear();
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	try {
		await act(async () =>
			root.render(
				React.createElement(
					model.TeamBridgePageView,
					r12Props({ onSend: () => gate }),
				),
			),
		);
		const box = element.querySelector("textarea");
		await r12Type(box, "first line");
		await act(async () => r12SendButton(element).click());
		// The author keeps typing while the request is in flight.
		await r12Type(box, "first line, then more");
		await act(async () => {
			release();
			await gate;
			await r12Tick();
		});
		assert.equal(
			element.querySelector("textarea").value,
			"first line, then more",
			"mid-flight text stays in the composer",
		);
		const stored = JSON.parse(
			localStorage.getItem(model.draftStorageKey("acct_r12", "org_r12")) ??
				"{}",
		);
		assert.equal(
			stored[
				model.draftTargetKey({ type: "conversation", id: r12Conversation.id })
			]?.body,
			"first line, then more",
			"the durable draft keeps the later text",
		);
	} finally {
		await act(async () => root.unmount());
		element.remove();
	}
});

test("r12 M1: a scheduled body does not come back as an unsent draft after remount", async () => {
	localStorage.clear();
	const journal = { body: "" };
	const time = new Date(Date.now() + 3_600_000).toISOString();
	const element = document.createElement("div");
	document.body.append(element);
	let root = createRoot(element);
	const props = r12Props({
		draftJournal: journal,
		initialDraft: "",
		onSchedule: async () => ({}),
	});
	try {
		await act(async () =>
			root.render(React.createElement(model.TeamBridgePageView, props)),
		);
		const box = element.querySelector("textarea");
		await r12Type(box, "scheduled fixture body");
		await act(async () =>
			element.querySelector('button[aria-label="Schedule message"]').click(),
		);
		const dialog = document.querySelector('[role="dialog"]');
		const input = dialog.querySelector('input[type="datetime-local"]');
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				dom.window.HTMLInputElement.prototype,
				"value",
			).set.call(input, model.scheduledLocalInput(time));
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		const action = () =>
			[...dialog.querySelectorAll("button")].find(
				(button) =>
					button.textContent === "Review schedule" ||
					button.textContent === "Confirm schedule",
			);
		await act(async () => action().click());
		await act(async () => action().click());
		await act(async () => {
			await r12Tick();
			await r12Tick();
		});
		// Remount the SAME surface, as switching conversations and back does.
		await act(async () => root.unmount());
		root = createRoot(element);
		await act(async () =>
			root.render(React.createElement(model.TeamBridgePageView, props)),
		);
		assert.equal(
			element.querySelector("textarea").value,
			"",
			"the scheduled text is not reseeded as a draft",
		);
		assert.equal(journal.body, "", "the journal cleared with the durable row");
	} finally {
		await act(async () => root.unmount());
		element.remove();
	}
});

test("r12 minor c: a scheduled create forwards thread_root_id only when set", () => {
	const base = {
		op: "team_bridge.scheduled.create",
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		client_ref: "ref-1",
		body: "reply later",
		send_at: "2030-01-02T12:00:00Z",
	};
	const plain = model.desktopEndpoint(base);
	assert.equal("thread_root_id" in plain.body, false, "text-only schedule");
	const reply = model.desktopEndpoint({
		...base,
		thread_root_id: "bcmsg_abc123",
	});
	assert.equal(reply.body.thread_root_id, "bcmsg_abc123");
	assert.equal(reply.path, "/v1/desktop/team-bridge/scheduled");
});
