/**
 * ARCHIVE / DELETE, THROUGH THE REAL CONTAINER (review round 1: U1/D1, D2, U2, U4, U5).
 *
 * WHY THIS SUITE EXISTS. `team-bridge-archive.test.mjs` renders `TeamBridgePageView`
 * with props, which is exactly how U1 shipped: the view resolved an archived channel,
 * the CONTAINER did not, so its history read stayed disabled and the banner sat over
 * "No messages yet. Say hello." Every view-level test passed because the test supplied
 * `messages` itself. This suite mounts the shipped `TeamBridgePage` (container, hooks,
 * React Query cache, desktop contract parsers, auth owner fence) and stubs ONLY the
 * preload transport, through the same fixture the auth-owner suite uses
 * (`fixtures/team-bridge-auth-owner-page.mjs`); the archive scenario it adds answers the
 * live and archived lists and per-conversation history as agent-server does.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
/* The fixture reads this when it bundles, so set it before the (dynamic) import. */
process.env.TEAM_BRIDGE_PLAIN_MENUS = "1";
const { delay, mount, ui, until } = await import(
	"./fixtures/team-bridge-auth-owner-page.mjs"
);

const person = (id, role = "member") => ({
	account_id: id,
	kind: "human",
	display_label: id,
	state: "active",
	role,
});

const channel = (id, name, patch = {}) => ({
	id,
	tenant_id: "org_shared",
	kind: "channel",
	name,
	visibility: "tenant",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2026-10-23T12:00:00Z",
	latest_seq: 0,
	members: [person("acct_a", "owner")],
	member: true,
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	can_administer: true,
	...patch,
});

const archivedChannel = (id, name, patch = {}) =>
	channel(id, name, {
		status: "archived",
		archived_at: "2026-10-25T09:30:00Z",
		archived_by: "acct_b",
		archived_by_label: "Bea",
		...patch,
	});

const msg = (conversationId, seq, body) => ({
	id: `msg_${conversationId}_${seq}`,
	conversation_id: conversationId,
	seq,
	sender: person("acct_b"),
	body,
	origin: "human",
	created_at: "2026-10-24T10:00:00Z",
});

const press = async (app, predicate, label) => {
	const button = [...app.host.querySelectorAll("button")].find(predicate);
	assert.ok(button, `button not found: ${label}`);
	await act(async () => button.click());
};
const byText = (text) => (b) => b.textContent.trim() === text;
const byLabel = (label) => (b) => b.getAttribute("aria-label") === label;

/* The scenario rows are assigned after mount, so make the page re-read both lists. */
const seeded = (app) =>
	act(async () =>
		app.client.invalidateQueries({
			queryKey: ui.teamBridgeKeys.conversationsPrefix,
		}),
	);

/* The page lands on its first channel at load; wait until it has settled there. */
const ready = async (app) => {
	await until(
		() => app.host.querySelector("[data-conversation-id]"),
		"rail rows rendered",
	);
};

/* Click a listed archived row: wait for the (lazy) archived read to put it there. */
const openArchivedRow = async (app, id) => {
	await until(
		() => app.host.querySelector(`[data-conversation-id="${id}"]`),
		`archived row ${id} listed`,
	);
	await press(
		app,
		(b) => b.getAttribute("data-conversation-id") === id,
		`archived row ${id}`,
	);
};

/* The plain-DOM menu (see the fixture) opens on click. */
const openMenu = async (trigger) => {
	assert.ok(trigger, "menu trigger present");
	await act(async () => trigger.click());
};

const openArchivedView = async (app) => {
	await press(app, byText("Archived channels"), "Archived channels entry");
	await until(
		() => app.host.querySelector('section[aria-label="Archived channels"]'),
		"archived view open",
	);
};

test("U1/D1: an archived channel opened from the Archived view loads its HISTORY in the real container", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		app.fixture.lifecycle = [
			channel("bcv_live", "launch"),
			archivedChannel("bcv_old", "release-proof-0.84.1"),
		];
		app.fixture.historyByConversation.set("bcv_old", [
			msg("bcv_old", 1, "UNIQUE-ARCHIVED-HISTORY-LINE"),
		]);
		await seeded(app);
		await ready(app);
		await openArchivedView(app);
		await until(
			() => app.host.querySelector('[data-conversation-id="bcv_old"]'),
			"archived row listed",
		);
		await openArchivedRow(app, "bcv_old");
		// THE REGRESSION: before the fix this timed out, because `selected` was null in
		// the container and the history read never fired.
		await until(
			() => app.host.textContent.includes("UNIQUE-ARCHIVED-HISTORY-LINE"),
			"archived history rendered",
		);
		assert.ok(
			app.fixture.calls.some((c) => c.historyFor === "bcv_old"),
			"the container requested the archived channel's history",
		);
		const text = app.host.textContent;
		assert.match(text, /This channel was archived by Bea/);
		assert.doesNotMatch(
			text,
			/Say hello/,
			"no invitation to post in an archived channel",
		);
		assert.equal(app.host.querySelector("textarea"), null, "no composer");
	} finally {
		await app.close();
	}
});

test("D5: an empty archived channel says so plainly, not 'Say hello'", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		app.fixture.lifecycle = [
			channel("bcv_live", "launch"),
			archivedChannel("bcv_empty", "scratch"),
		];
		app.fixture.historyByConversation.set("bcv_empty", []);
		await seeded(app);
		await ready(app);
		await openArchivedView(app);
		await openArchivedRow(app, "bcv_empty");
		await until(
			() => app.host.textContent.includes("No messages in this channel."),
			"archived empty copy",
		);
		assert.doesNotMatch(app.host.textContent, /Say hello/);
	} finally {
		await app.close();
	}
});

test("S4: an administrator who never joined gets the 'can manage, cannot read' state, not a generic error", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		app.fixture.lifecycle = [
			channel("bcv_live", "launch"),
			archivedChannel("bcv_foreign", "ops-sandbox", { member: false }),
		];
		app.fixture.notAMember.add("bcv_foreign");
		await seeded(app);
		await ready(app);
		await openArchivedView(app);
		await openArchivedRow(app, "bcv_foreign");
		await until(
			() => app.host.textContent.includes("you were never a member"),
			"forbidden state",
		);
		assert.doesNotMatch(app.host.textContent, /could not be loaded/i);
		// They can still manage it from here.
		assert.ok(
			[...app.host.querySelectorAll("button")].some(
				byText("Delete permanently"),
			),
		);
	} finally {
		await app.close();
	}
});

test("D2: archiving the open channel lands on the NEXT channel, never an 'Untitled conversation'", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		app.fixture.lifecycle = [
			channel("bcv_a", "alpha"),
			channel("bcv_b", "bravo"),
			channel("bcv_c", "charlie"),
		];
		await seeded(app);
		await ready(app);
		// Select bravo (the middle channel), then archive it from the HEADER menu.
		await press(
			app,
			(b) => b.getAttribute("data-conversation-id") === "bcv_b",
			"bravo row",
		);
		await until(
			() => app.host.querySelector('button[aria-label="Conversation options"]'),
			"header menu trigger",
		);
		await openMenu(
			app.host.querySelector('button[aria-label="Conversation options"]'),
		);
		await until(
			() =>
				[...document.querySelectorAll('[role="menuitem"]')].find((n) =>
					n.textContent.includes("Archive channel"),
				),
			"archive item in menu",
		);
		await act(async () =>
			[...document.querySelectorAll('[role="menuitem"]')]
				.find((n) => n.textContent.includes("Archive channel"))
				.click(),
		);
		await until(
			() => document.querySelector('[role="dialog"]'),
			"confirm dialog",
		);
		await act(async () =>
			[...document.querySelectorAll('[role="dialog"] button')]
				.find(byText("Archive channel"))
				.click(),
		);
		await until(
			() =>
				app.host.querySelector(
					'[data-conversation-id="bcv_c"][aria-current="page"]',
				),
			"landed on the next channel (charlie)",
		);
		assert.equal(
			app.host.querySelector('[data-conversation-id="bcv_b"]'),
			null,
			"the archived channel left the rail",
		);
		assert.doesNotMatch(app.host.textContent, /Untitled conversation/);
		assert.deepEqual(
			app.fixture.lifecycleCalls.map((c) => [c.op, c.id]),
			[["archive", "bcv_b"]],
		);
	} finally {
		await app.close();
	}
});

test("D2: archiving the LAST channel lands on the previous one", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		app.fixture.lifecycle = [
			channel("bcv_a", "alpha"),
			channel("bcv_b", "bravo"),
		];
		await seeded(app);
		await ready(app);
		await press(
			app,
			(b) => b.getAttribute("data-conversation-id") === "bcv_b",
			"bravo row",
		);
		await openMenu(
			app.host.querySelector('button[aria-label="Conversation options"]'),
		);
		await until(
			() =>
				[...document.querySelectorAll('[role="menuitem"]')].find((n) =>
					n.textContent.includes("Archive channel"),
				),
			"archive item",
		);
		await act(async () =>
			[...document.querySelectorAll('[role="menuitem"]')]
				.find((n) => n.textContent.includes("Archive channel"))
				.click(),
		);
		await act(async () =>
			[...document.querySelectorAll('[role="dialog"] button')]
				.find(byText("Archive channel"))
				.click(),
		);
		await until(
			() =>
				app.host.querySelector(
					'[data-conversation-id="bcv_a"][aria-current="page"]',
				),
			"landed on the previous channel (alpha)",
		);
	} finally {
		await app.close();
	}
});

test("U5: a refused archive from a rail row puts the row back AND announces it", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		app.fixture.lifecycle = [
			channel("bcv_a", "alpha"),
			channel("bcv_b", "bravo"),
		];
		app.fixture.lifecycleFailure = () => ({
			status: 409,
			body: { detail: { code: "invalid_transition", text: "Refused" } },
		});
		await seeded(app);
		await ready(app);
		// Archive bravo from ITS ROW's menu (the selection stays where it was).
		await openMenu(
			app.host.querySelector('button[aria-label="More actions for bravo"]'),
		);
		await until(
			() =>
				[...document.querySelectorAll('[role="menuitem"]')].find((n) =>
					n.textContent.includes("Archive channel"),
				),
			"row archive item",
		);
		await act(async () =>
			[...document.querySelectorAll('[role="menuitem"]')]
				.find((n) => n.textContent.includes("Archive channel"))
				.click(),
		);
		await act(async () =>
			[...document.querySelectorAll('[role="dialog"] button')]
				.find(byText("Archive channel"))
				.click(),
		);
		await until(
			() =>
				app.fixture.lifecycleCalls.some(
					(c) => c.op === "archive" && c.id === "bcv_b",
				),
			"archive attempted",
		);
		// The rollback restores the row...
		await until(
			() => app.host.querySelector('[data-conversation-id="bcv_b"]'),
			"row restored after the refusal",
		);
		// ...and the refusal is announced, naming the channel.
		await until(
			() => ui.toasts.some((m) => /bravo/.test(m)),
			"toast naming the channel",
		);
		assert.match(
			ui.toasts.find((m) => /bravo/.test(m)),
			/Couldn.t archive #bravo\. It is back in your sidebar\./,
		);
	} finally {
		await app.close();
	}
});

test("U2: a first-attempt 404 on delete is NOT 'deleted': the row stays and the sentence is honest", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		app.fixture.lifecycle = [
			channel("bcv_live", "launch"),
			archivedChannel("bcv_old", "release-proof-0.84.1"),
		];
		app.fixture.historyByConversation.set("bcv_old", []);
		// The caller lost authority: the server's opaque 404, and nothing was erased.
		app.fixture.deleteFailure = () => ({
			status: 404,
			body: { detail: { code: "conversation_not_found", text: "Not found" } },
		});
		await seeded(app);
		await ready(app);
		await openArchivedView(app);
		await openArchivedRow(app, "bcv_old");
		await until(
			() =>
				[...app.host.querySelectorAll("button")].some(
					byText("Delete permanently"),
				),
			"banner delete",
		);
		await press(app, byText("Delete permanently"), "banner delete");
		await until(
			() => document.querySelector('[role="dialog"] input'),
			"delete dialog",
		);
		const field = document.querySelector('[role="dialog"] input');
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			).set.call(field, "release-proof-0.84.1");
			field.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await act(async () =>
			[...document.querySelectorAll('[role="dialog"] button')]
				.filter(byText("Delete permanently"))
				.at(-1)
				.click(),
		);
		await until(
			() => document.querySelector('[role="dialog"] [role="alert"]'),
			"delete refusal stated",
		);
		const alert = document.querySelector(
			'[role="dialog"] [role="alert"]',
		).textContent;
		assert.match(
			alert,
			/may already be deleted, or you may no longer be allowed/,
		);
		assert.doesNotMatch(alert, /^Deleted/i);
		// The dialog stays, so the person can read it: nothing was dropped from the cache.
		assert.ok(document.querySelector('[role="dialog"]'));
		const cached = app.client.getQueriesData({
			queryKey: ui.teamBridgeKeys.conversationsPrefix,
		});
		assert.ok(
			cached.some(([, page]) =>
				page?.conversations?.some((row) => row.id === "bcv_old"),
			),
			"the channel is still in the cache after an unproven 404",
		);
	} finally {
		await app.close();
	}
});

test("U4: the Archived view pages with Load more and appends the next page", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		const firstPage = Array.from({ length: 2 }, (_, i) =>
			archivedChannel(`bcv_p1_${i}`, `old-one-${i}`),
		);
		const secondPage = [archivedChannel("bcv_p2_0", "old-two-0")];
		app.fixture.lifecycle = [channel("bcv_live", "launch")];
		const original = window.api.desktop.request;
		window.api.desktop.request = async (request) => {
			if (
				request.op === "team_bridge.conversations.list" &&
				request.status === "archived"
			) {
				app.fixture.calls.push({ archivedList: request.cursor ?? null });
				return request.cursor
					? {
							status: 200,
							body: { result: { conversations: secondPage, has_more: false } },
						}
					: {
							status: 200,
							body: {
								result: {
									conversations: firstPage,
									has_more: true,
									next_cursor: "CURSOR_PAGE_2",
								},
							},
						};
			}
			return original(request);
		};
		await seeded(app);
		await ready(app);
		await openArchivedView(app);
		await until(
			() => app.host.querySelector('[data-conversation-id="bcv_p1_0"]'),
			"first archived page",
		);
		assert.equal(
			app.host.querySelector('[data-conversation-id="bcv_p2_0"]'),
			null,
		);
		await press(app, byText("Load more"), "Load more");
		await until(
			() => app.host.querySelector('[data-conversation-id="bcv_p2_0"]'),
			"second page appended",
		);
		assert.ok(
			app.host.querySelector('[data-conversation-id="bcv_p1_0"]'),
			"the first page is kept",
		);
		assert.ok(
			app.fixture.calls.some((c) => c.archivedList === "CURSOR_PAGE_2"),
			"the next page was requested with the server's cursor",
		);
		await delay();
		assert.ok(
			![...app.host.querySelectorAll("button")].some(byText("Load more")),
			"no Load more once the walk is exhausted",
		);
	} finally {
		await app.close();
	}
});

test("U3: the Archived view lists channels only, never an archived DM or group", async () => {
	const app = await mount({ lifecycle: [] });
	try {
		app.fixture.lifecycle = [
			channel("bcv_live", "launch"),
			archivedChannel("bcv_ch", "release-proof-0.84.1"),
			archivedChannel("bcv_dm", "", { kind: "dm", can_administer: false }),
			archivedChannel("bcv_grp", "", { kind: "group", can_administer: false }),
		];
		await seeded(app);
		await ready(app);
		await openArchivedView(app);
		await until(
			() => app.host.querySelector('[data-conversation-id="bcv_ch"]'),
			"archived channel listed",
		);
		assert.equal(
			app.host.querySelector('[data-conversation-id="bcv_dm"]'),
			null,
		);
		assert.equal(
			app.host.querySelector('[data-conversation-id="bcv_grp"]'),
			null,
		);
		assert.doesNotMatch(app.host.textContent, /Untitled conversation/);
	} finally {
		await app.close();
	}
});
