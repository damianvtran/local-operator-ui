/**
 * LEAVING TEAM BRIDGE AND COMING BACK RESTORES WHERE THE READER WAS, through the
 * REAL container (operator report: "when switching back to the team bridge, it
 * doesn't remember which channel/message/group etc I had selected and always
 * defaults back to general").
 *
 * ROOT CAUSE UNDER TEST. `TeamBridgePage` is a route element, so leaving it for
 * another route unmounts it; `target` restarted at `null` and the one-shot
 * landing effect chose #general. The fix reads a persisted per-account,
 * per-scope record in the page's initialisers. Every case here mounts the
 * shipped page (container, hooks, React Query, contract parsers) through
 * `fixtures/team-bridge-auth-owner-page.mjs`; only the preload transport is a
 * fixture. `leave()`/`back()` unmount and remount the page with the shell and
 * the QueryClient kept, exactly as the router does. "Restart" is a fresh mount
 * with the QueryClient cleared and only `localStorage` carried over.
 *
 * NO #GENERAL FLASH is asserted on the Profiler's committed frames, not the
 * final DOM: a restore that painted #general for one commit and then corrected
 * would pass a final-state check.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
process.env.TEAM_BRIDGE_PLAIN_MENUS = "1";
const { delay, mount, until } = await import(
	"./fixtures/team-bridge-auth-owner-page.mjs"
);

const now = "2026-10-23T12:00:00Z";
const person = (id, kind = "human") => ({
	account_id: id,
	kind,
	display_label: id,
	state: "active",
	role: "member",
});
const row = (id, tenant, patch = {}) => ({
	id,
	tenant_id: tenant,
	kind: "channel",
	name: id,
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: "acct_a",
	last_message_at: now,
	latest_seq: 0,
	members: [person("acct_a")],
	member: true,
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	...patch,
});
const general = (tenant) =>
	row(`gen_${tenant}`, tenant, { name: "general", builtin: "general" });
const ORGS = {
	org_shared: [
		general("org_shared"),
		row("launch_shared", "org_shared", { name: "launch" }),
		row("grp_shared", "org_shared", {
			kind: "group",
			visibility: "private",
			name: "Design crew",
		}),
		row("dm_peer", "org_shared", {
			kind: "dm",
			visibility: "private",
			name: undefined,
			members: [person("acct_a"), person("acct_peer_0")],
		}),
	],
	org_other: [
		general("org_other"),
		row("launch_other", "org_other", { name: "ops" }),
	],
};
const msg = (conversation, seq) => ({
	id: `msg_${conversation}_${seq}`,
	conversation_id: conversation,
	seq,
	sender: person("acct_b"),
	body: `line ${seq} of ${conversation}`,
	origin: "human",
	created_at: now,
});

const ERROR_COPY = /could not be loaded|not open to you|unavailable/i;

/* Each organization answers its own rows; the account read answers the union. */
function scenario(app, { orgs = ORGS } = {}) {
	const fixture = app.fixture ?? app;
	fixture.listFor = (request) => ({
		conversations:
			request.status === "archived"
				? []
				: request.scope === "account"
					? Object.values(orgs).flat()
					: (orgs[request.tenant_id] ?? []),
	});
	for (const rows of Object.values(orgs))
		for (const conversation of rows)
			fixture.historyByConversation.set(conversation.id, [
				msg(conversation.id, 1),
				msg(conversation.id, 2),
			]);
}

const selected = (app) =>
	app.host
		.querySelector('[aria-current="page"][data-conversation-id]')
		?.getAttribute("data-conversation-id") ??
	(app.host
		.querySelector('[aria-current="page"][data-team-bridge-person]')
		?.getAttribute("data-team-bridge-person")
		? `person:${app.host
				.querySelector('[aria-current="page"][data-team-bridge-person]')
				.getAttribute("data-team-bridge-person")}`
		: null) ??
	(app.host
		.querySelector('[aria-current="page"][data-team-bridge-chief]')
		?.getAttribute("data-team-bridge-chief")
		? `chief:${app.host
				.querySelector('[aria-current="page"][data-team-bridge-chief]')
				.getAttribute("data-team-bridge-chief")}`
		: null);

const click = async (element, label) => {
	assert.ok(element, `not found: ${label}`);
	await act(async () => element.click());
};
const pick = (app, id) =>
	click(
		app.host.querySelector(`[data-conversation-id="${id}"]`),
		`rail row ${id}`,
	);

/* Mount in one organization, with the scenario rows, settled on the landing. */
async function open({ path = "/team-bridge?tenant=org_shared", orgs } = {}) {
	const app = await mount({ lifecycle: [], path, waitReady: false });
	scenario(app, { orgs });
	await act(async () =>
		app.client.invalidateQueries({ queryKey: ["team-bridge"] }),
	);
	await until(() => selected(app) !== null, "a conversation is selected");
	return app;
}

/* Leave for another route and come back, recording every committed frame. */
async function roundTrip(app) {
	await app.leave();
	const from = app.frames.length;
	await app.back();
	return from;
}

/* Every frame committed since `from` that shows a selection at all. */
const selections = (app, from) =>
	app.frames
		.slice(from)
		.map((frame) => frame.selectedId)
		.filter((id) => id !== null);

/*
 * "Restart": unmount, drop every in-memory cache, keep only `localStorage`, and
 * mount a fresh page with no deep link - which is what relaunching the app does.
 */
async function restart(app, { orgs } = {}) {
	const saved = { ...localStorage };
	await app.close();
	const next = await mount({
		lifecycle: [],
		path: "/team-bridge",
		waitReady: false,
		seed: ({ fixture }) => {
			for (const [key, value] of Object.entries(saved))
				localStorage.setItem(key, value);
			scenario(fixture, { orgs });
		},
	});
	return next;
}

test("a channel stays selected across leave and return, with no #general frame", async () => {
	const app = await open();
	try {
		assert.equal(
			selected(app),
			"gen_org_shared",
			"first open lands on #general",
		);
		await pick(app, "launch_shared");
		await until(() => selected(app) === "launch_shared", "launch selected");
		const from = await roundTrip(app);
		await until(() => selected(app) === "launch_shared", "launch restored");
		assert.deepEqual(
			[...new Set(selections(app, from))],
			["launch_shared"],
			"every committed frame after return shows the restored channel",
		);
	} finally {
		await app.close();
	}
});

test("a private group and a person DM are restored", async () => {
	const app = await open();
	try {
		await pick(app, "grp_shared");
		await until(() => selected(app) === "grp_shared", "group selected");
		await roundTrip(app);
		await until(() => selected(app) === "grp_shared", "group restored");

		const personRow = await (async () => {
			await until(
				() => app.host.querySelector('[data-team-bridge-person="acct_peer_0"]'),
				"person row listed",
			);
			return app.host.querySelector('[data-team-bridge-person="acct_peer_0"]');
		})();
		await click(personRow, "person row");
		await until(() => selected(app) === "person:acct_peer_0", "DM selected");
		const from = await roundTrip(app);
		await until(() => selected(app) === "person:acct_peer_0", "DM restored");
		assert.ok(
			!selections(app, from).includes("gen_org_shared"),
			"#general never painted on the way back",
		);
	} finally {
		await app.close();
	}
});

test("an agent DM (chief of staff) target is restored", async () => {
	const app = await open();
	try {
		// The fixture directory carries no agents, so the chief target is seeded
		// as the page itself would have written it, then the page is reopened.
		await app.leave();
		const stored = JSON.parse(localStorage.getItem("lo.teamBridge.view.v1"));
		stored.acct_a.scopes.org_shared = {
			target: { type: "chief", accountId: "acct_peer_0" },
		};
		localStorage.setItem("lo.teamBridge.view.v1", JSON.stringify(stored));
		const from = app.frames.length;
		await app.back();
		await delay();
		await delay();
		// The directory answered and the peer is a member, so the target holds
		// (no chief row draws without an agent; the landing never ran either).
		assert.ok(
			!selections(app, from).includes("gen_org_shared"),
			"the remembered agent target was not replaced by #general",
		);
		const view = JSON.parse(localStorage.getItem("lo.teamBridge.view.v1"))
			.acct_a.scopes.org_shared;
		assert.deepEqual(view.target, { type: "chief", accountId: "acct_peer_0" });
	} finally {
		await app.close();
	}
});

test("Drafts quick view and an open thread pane are restored", async () => {
	const app = await open();
	try {
		await click(
			[...app.host.querySelectorAll("button")].find(
				(b) => b.textContent.trim() === "Drafts",
			),
			"Drafts",
		);
		await until(
			() =>
				app.host.querySelector('[aria-current="page"]')?.textContent.trim() ===
				"Drafts",
			"drafts open",
		);
		await roundTrip(app);
		await until(
			() =>
				[...app.host.querySelectorAll('[aria-current="page"]')].some(
					(b) => b.textContent.trim() === "Drafts",
				),
			"drafts restored",
		);

		// Thread pane: seed a remembered thread on #launch and come back.
		await pick(app, "launch_shared");
		await until(() => selected(app) === "launch_shared", "launch selected");
		await app.leave();
		const stored = JSON.parse(localStorage.getItem("lo.teamBridge.view.v1"));
		stored.acct_a.scopes.org_shared.thread = {
			tenantId: "org_shared",
			conversationId: "launch_shared",
			rootId: "msg_launch_shared_1",
		};
		localStorage.setItem("lo.teamBridge.view.v1", JSON.stringify(stored));
		await app.back();
		await until(
			() =>
				app.host.querySelector(
					'aside[aria-label="Thread"], [data-thread-close]',
				),
			"thread pane reopened",
		);
		assert.equal(selected(app), "launch_shared");
	} finally {
		await app.close();
	}
});

test("the composer draft survives leaving and returning", async () => {
	const app = await open();
	try {
		await pick(app, "launch_shared");
		await until(() => app.host.querySelector("textarea"), "composer mounted");
		const field = app.host.querySelector("textarea");
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype,
				"value",
			).set.call(field, "half-written thought");
			field.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await roundTrip(app);
		await until(
			() =>
				app.host.querySelector("textarea")?.value === "half-written thought",
			"draft restored in the restored conversation",
		);
		assert.equal(selected(app), "launch_shared");
	} finally {
		await app.close();
	}
});

test("a reader scrolled up returns to the same message; at the bottom returns to newest", async () => {
	const app = await open();
	try {
		await pick(app, "launch_shared");
		await until(
			() => app.host.querySelector('[data-message-id="msg_launch_shared_2"]'),
			"history rendered",
		);
		/* The TIMELINE's viewport: the rail is a ScrollArea too, and comes first. */
		const viewport = app.host
			.querySelector('[data-message-id="msg_launch_shared_1"]')
			.closest("[data-radix-scroll-area-viewport]");
		/* jsdom has no layout: give the viewport and rows a geometry so the
		   anchor arithmetic has something real to read. Row 1 at the top. */
		Object.defineProperty(viewport, "scrollHeight", {
			configurable: true,
			value: 2000,
		});
		Object.defineProperty(viewport, "clientHeight", {
			configurable: true,
			value: 400,
		});
		viewport.getBoundingClientRect = () => ({ top: 0, bottom: 400 });
		const rowOne = app.host.querySelector(
			'[data-message-id="msg_launch_shared_1"]',
		);
		rowOne.getBoundingClientRect = () => ({ top: -20, bottom: 80 });
		await act(async () => {
			viewport.scrollTop = 100;
			viewport.dispatchEvent(new window.Event("scroll"));
		});
		await app.leave();
		const view = JSON.parse(localStorage.getItem("lo.teamBridge.view.v1"))
			.acct_a.scopes.org_shared;
		assert.deepEqual(view.scroll, {
			messageId: "msg_launch_shared_1",
			offset: -20,
			targetKey: "conversation:launch_shared",
		});
		await app.back();
		await until(() => selected(app) === "launch_shared", "launch restored");

		// At the newest message: the record says "newest" (null), not a row.
		await until(
			() => app.host.querySelector('[data-message-id="msg_launch_shared_1"]'),
			"restored history rendered",
		);
		const fresh = app.host
			.querySelector('[data-message-id="msg_launch_shared_1"]')
			.closest("[data-radix-scroll-area-viewport]");
		Object.defineProperty(fresh, "scrollHeight", {
			configurable: true,
			value: 2000,
		});
		Object.defineProperty(fresh, "clientHeight", {
			configurable: true,
			value: 400,
		});
		await act(async () => {
			fresh.scrollTop = 1600;
			fresh.dispatchEvent(new window.Event("scroll"));
		});
		await app.leave();
		assert.equal(
			JSON.parse(localStorage.getItem("lo.teamBridge.view.v1")).acct_a.scopes
				.org_shared.scroll,
			null,
		);
	} finally {
		await app.close();
	}
});

test("each organization, and All organizations, remembers its own conversation", async () => {
	/* No `?tenant=`: that parameter pins the scope by contract (a deep link
	   outranks everything), and the real sidebar opens the bare route. Two
	   organizations and nothing stored open in the union. */
	const app = await open({ path: "/team-bridge" });
	try {
		const switcher = () =>
			app.host.querySelector('button[aria-label^="Organization:"]');
		const choose = async (label) => {
			await click(switcher(), "switcher");
			await click(
				[...app.host.querySelectorAll('[role="menuitem"]')].find((item) =>
					item.textContent.trim().startsWith(label),
				),
				`menu ${label}`,
			);
		};
		assert.equal(switcher().textContent.trim(), "All organizations");
		await choose("Shared");
		await until(() => selected(app) === "gen_org_shared", "shared: default");
		await pick(app, "launch_shared");
		await until(() => selected(app) === "launch_shared", "shared: launch");
		await choose("Other");
		await until(() => selected(app) === "gen_org_other", "other: default");
		await pick(app, "launch_other");
		await until(() => selected(app) === "launch_other", "other: ops");
		await choose("All organizations");
		await until(
			() => switcher().textContent.trim() === "All organizations",
			"union shown",
		);
		await until(
			() => app.host.querySelector('[data-conversation-id="grp_shared"]'),
			"union rows",
		);
		await pick(app, "grp_shared");
		await until(() => selected(app) === "grp_shared", "union: group");

		await choose("Shared");
		await until(() => selected(app) === "launch_shared", "shared restored");
		await choose("Other");
		await until(() => selected(app) === "launch_other", "other restored");
		await choose("All organizations");
		await until(() => selected(app) === "grp_shared", "union restored");
		// Leaving in the union returns to the union and its own conversation.
		await roundTrip(app);
		await until(() => selected(app) === "grp_shared", "union after return");
		assert.equal(switcher().textContent.trim(), "All organizations");
	} finally {
		await app.close();
	}
});

test("a remembered conversation that no longer exists falls back to #general silently", async () => {
	const app = await open();
	try {
		await pick(app, "launch_shared");
		await until(() => selected(app) === "launch_shared", "launch selected");
		await app.leave();
		// The channel is deleted (or access lost) while the reader is away.
		const orgs = {
			...ORGS,
			org_shared: ORGS.org_shared.filter((row) => row.id !== "launch_shared"),
		};
		scenario(app, { orgs });
		await act(async () =>
			app.client.invalidateQueries({ queryKey: ["team-bridge"] }),
		);
		await app.back();
		await until(
			() => selected(app) === "gen_org_shared",
			"fell back to #general",
		);
		assert.doesNotMatch(
			app.host.textContent,
			ERROR_COPY,
			"no error surfaced for the fallback",
		);
		// The fallback is now what is remembered.
		await roundTrip(app);
		await until(() => selected(app) === "gen_org_shared", "fallback persisted");
	} finally {
		await app.close();
	}
});

test("a notification click wins over the saved selection and becomes the saved one", async () => {
	const app = await open();
	let saved;
	try {
		await pick(app, "launch_shared");
		await until(() => selected(app) === "launch_shared", "launch selected");
		await app.leave();
		saved = { ...localStorage };
	} finally {
		await app.close();
	}
	/* The click arrives as the deep link both notification paths navigate to
	   (`teamBridgeOpenPath`), with the saved record already on disk. */
	const clicked = await mount({
		lifecycle: [],
		path: "/team-bridge?tenant=org_shared&conversation=grp_shared",
		waitReady: false,
		seed: ({ fixture }) => {
			for (const [key, value] of Object.entries(saved))
				localStorage.setItem(key, value);
			scenario(fixture);
		},
	});
	try {
		await until(() => selected(clicked) === "grp_shared", "click target");
		assert.ok(
			!selections(clicked, 0).includes("launch_shared"),
			"the saved selection never painted over the click",
		);
		await roundTrip(clicked);
		await until(
			() => selected(clicked) === "grp_shared",
			"the click target is the new saved selection",
		);
	} finally {
		await clicked.close();
	}
});

test("the selection and organization persist across an app restart", async () => {
	let app = await open();
	try {
		await until(
			() => app.host.querySelector('[data-team-bridge-person="acct_peer_0"]'),
			"person row listed",
		);
		await click(
			app.host.querySelector('[data-team-bridge-person="acct_peer_0"]'),
			"person row",
		);
		await until(() => selected(app) === "person:acct_peer_0", "DM selected");
		const before = selected(app);
		app = await restart(app);
		await until(() => selected(app) !== null, "restarted page landed");
		assert.equal(selected(app), before, "same conversation after restart");
		assert.ok(
			!selections(app, 0).includes("gen_org_shared"),
			"no #general frame on the restarted open",
		);
	} finally {
		await app.close();
	}
});
