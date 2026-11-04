/**
 * THE TEAM BRIDGE RAIL HOLDS ITS SCROLL POSITION, through the REAL container
 * (operator report: "when I click a channel it scrolls me back to the top ...
 * the scroll position in the sidebar should be held so I can sift through
 * channels/DMs").
 *
 * ROOT CAUSE UNDER TEST. `TeamBridgePageView` is keyed by its target, so every
 * selection unmounted the rail's `ScrollArea` with the rest of the view and a
 * fresh viewport mounted at scrollTop 0. Each pick below therefore asserts TWO
 * things: the viewport is a NEW element (the remount really happened, so the
 * case exercises the path that lost the offset) and its scrollTop is the one
 * the reader left. On the pre-fix code every pick case reads 0.
 *
 * jsdom does no layout: `scrollTop` is stored as written and no `scroll` event
 * fires on a programmatic write, so `scrollRail` dispatches the event a real
 * wheel scroll would. The reveal cases stub the two geometry reads they need.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act } from "react";
process.env.TEAM_BRIDGE_PLAIN_MENUS = "1";
const { delay, mount, until, ui } = await import(
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
/* Enough channels that every other section sits well below the fold. */
const channels = (tenant, count = 30) => [
	row(`gen_${tenant}`, tenant, { name: "general", builtin: "general" }),
	...Array.from({ length: count }, (_, i) =>
		row(`ch${i}_${tenant}`, tenant, { name: `channel-${i}` }),
	),
];
const orgRows = (tenant) => [
	...channels(tenant),
	row(`grp_${tenant}`, tenant, {
		kind: "group",
		visibility: "private",
		name: "Design crew",
	}),
	row(`dm_${tenant}`, tenant, {
		kind: "dm",
		visibility: "private",
		name: undefined,
		members: [person("acct_a"), person("acct_peer_0")],
	}),
];
const ORGS = {
	org_shared: orgRows("org_shared"),
	org_other: orgRows("org_other"),
};

/* A chief of staff in the directory: a member carrying an agent. */
const DIRECTORY = [
	{
		account_id: "acct_peer_0",
		display_label: "Peer",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
	},
	{
		account_id: "acct_ben",
		display_label: "Ben",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
	},
];
/* One conversation in the read-only "Your chief of staff's messages" history. */
const AUDIT = [
	{
		id: "bconv_audit_dm",
		kind: "dm",
		name: null,
		visibility: "private",
		status: "active",
		last_message_at: now,
		latest_seq: 4,
		members: [
			{
				account_id: "acct_ben",
				kind: "human",
				display_label: "Ben",
				role: "member",
				state: "active",
				joined_seq: 0,
				notify: "all",
			},
		],
		member_count: 2,
		viewers: [
			{
				account_id: "acct_a",
				display_label: "acct_a",
				reason: "agent_owner",
				agent_member_key: "a:bep_aida",
			},
		],
		agent: {
			account_id: "acct_aida",
			display_label: "Aida",
			state: "active",
			joined_seq: 1,
		},
	},
];

function scenario(fixture, orgs = ORGS) {
	fixture.listFor = (request) => ({
		conversations:
			request.status === "archived"
				? []
				: request.scope === "account"
					? Object.values(orgs).flat()
					: (orgs[request.tenant_id] ?? []),
	});
	fixture.directoryMembers = DIRECTORY;
	fixture.ownerAuditConversations = AUDIT;
}

/* The rail's viewport, found by a row it holds rather than by an attribute
   this change adds, so the same suite runs unchanged against the pre-fix code. */
const viewport = (app) =>
	app.host
		.querySelector('[data-conversation-id^="gen_"]')
		?.closest("[data-radix-scroll-area-viewport]") ?? null;
/* Scroll the rail the way a reader does: the offset, then its scroll event. */
async function scrollRail(app, top) {
	const element = viewport(app);
	assert.ok(element, "rail viewport mounted");
	await act(async () => {
		element.scrollTop = top;
		element.dispatchEvent(new window.Event("scroll"));
	});
	return element;
}
const selectedRow = (app) =>
	viewport(app)?.querySelector('[aria-current="page"]') ?? null;

async function open(path = "/team-bridge?tenant=org_shared", options = {}) {
	const app = await mount({
		lifecycle: [],
		path,
		...options,
		waitReady: false,
		seed: ({ fixture }) => scenario(fixture),
	});
	scenario(app.fixture);
	await act(async () =>
		app.client.invalidateQueries({ queryKey: ["team-bridge"] }),
	);
	await until(() => selectedRow(app), "a rail row is selected");
	return app;
}

/*
 * Click a rail row with the rail scrolled to 480, and assert the remounted
 * rail reads 480 - the operator's exact gesture, for one conversation kind.
 */
async function pickHolds(app, selector, label, at = 480) {
	await until(() => viewport(app)?.querySelector(selector), `${label} listed`);
	const before = await scrollRail(app, at);
	const target = viewport(app).querySelector(selector);
	await act(async () => target.click());
	await until(
		() => viewport(app)?.querySelector(`${selector}[aria-current="page"]`),
		`${label} selected`,
	);
	await delay();
	const after = viewport(app);
	assert.ok(after !== before, `${label}: the pick remounted the rail`);
	assert.equal(after.scrollTop, at, `${label}: rail scrollTop held`);
}

let restoreGeometry = null;
afterEach(() => {
	/* Held positions are module state by design (they outlive the route). */
	ui.resetHeldRailScrollForTest();
	restoreGeometry?.();
	restoreGeometry = null;
});

/*
 * Make the SELECTED row read as entirely below a 400px viewport and record
 * every scrollIntoView call; everything else keeps jsdom's own (zero) rects.
 */
function stubGeometry() {
	const proto = window.HTMLElement.prototype;
	const rect = proto.getBoundingClientRect;
	const into = proto.scrollIntoView;
	const calls = [];
	proto.getBoundingClientRect = function () {
		if (this.hasAttribute("data-radix-scroll-area-viewport"))
			return { top: 0, bottom: 400, left: 0, right: 288, height: 400 };
		if (this.getAttribute("aria-current") === "page")
			return { top: 900, bottom: 930, left: 0, right: 288, height: 30 };
		return rect.call(this);
	};
	proto.scrollIntoView = function (options) {
		calls.push({ id: this.getAttribute("data-conversation-id"), options });
	};
	restoreGeometry = () => {
		proto.getBoundingClientRect = rect;
		proto.scrollIntoView = into;
	};
	return calls;
}

/*
 * REAL-ENOUGH GEOMETRY (review R1 / QA Q1). jsdom gives every box a zero rect,
 * so a `scrollIntoView({block:"nearest"})` can never move anything and a test
 * of the org round trip passes on a no-op. This models a 400px rail viewport
 * whose rows stack 44px apart IN DOCUMENT ORDER, positioned from the live
 * `scrollTop`, with `nearest` implemented the way the browser does it - so a
 * reveal that should not run actually moves the rail, and the test sees it.
 */
const VIEWPORT_H = 400;
const ROW_H = 44;
function modelGeometry() {
	const proto = window.HTMLElement.prototype;
	const rect = proto.getBoundingClientRect;
	const into = proto.scrollIntoView;
	const box = (top) => ({
		top,
		bottom: top + ROW_H,
		left: 0,
		right: 288,
		height: ROW_H,
		width: 288,
	});
	const railOf = (el) => el.closest?.("[data-radix-scroll-area-viewport]");
	const offsetIn = (rail, el) => {
		const rows = [...rail.querySelectorAll("button")];
		const index = rows.indexOf(el);
		return index < 0 ? null : index * ROW_H;
	};
	const calls = [];
	proto.getBoundingClientRect = function () {
		if (this.hasAttribute("data-radix-scroll-area-viewport"))
			return {
				top: 0,
				bottom: VIEWPORT_H,
				left: 0,
				right: 288,
				height: VIEWPORT_H,
				width: 288,
			};
		const rail = railOf(this);
		const at = rail ? offsetIn(rail, this) : null;
		if (at !== null) return box(at - rail.scrollTop);
		return rect.call(this);
	};
	proto.scrollIntoView = function (options) {
		calls.push({ id: this.getAttribute("data-conversation-id"), options });
		const rail = railOf(this);
		const at = rail ? offsetIn(rail, this) : null;
		if (at === null) return;
		if (at < rail.scrollTop) rail.scrollTop = at;
		else if (at + ROW_H > rail.scrollTop + VIEWPORT_H)
			rail.scrollTop = at + ROW_H - VIEWPORT_H;
	};
	restoreGeometry = () => {
		proto.getBoundingClientRect = rect;
		proto.scrollIntoView = into;
	};
	return calls;
}

const orgSwitcher = (app) => {
	const switcher = () =>
		app.host.querySelector('button[aria-label^="Organization:"]');
	return async (label) => {
		await act(async () => switcher().click());
		const item = [...app.host.querySelectorAll('[role="menuitem"]')].find(
			(entry) => entry.textContent.trim().startsWith(label),
		);
		assert.ok(item, `menu ${label}`);
		await act(async () => item.click());
		await until(
			() => switcher().textContent.trim().startsWith(label),
			`${label} shown`,
		);
		await until(() => selectedRow(app), `${label}: a row is selected`);
		await delay();
		await delay();
	};
};

test("an org round trip restores a rail scrolled past its off-screen selected row (R1/Q1)", async () => {
	const app = await open("/team-bridge");
	const calls = modelGeometry();
	try {
		const choose = orgSwitcher(app);
		await choose("Shared");
		/* Default #general selected at the top; scroll far past it (QA 3c). */
		await scrollRail(app, 516);
		await choose("Other");
		await choose("Shared");
		assert.equal(
			viewport(app).scrollTop,
			516,
			`scroll-only: A -> B -> A restores 516 (scrollIntoView calls: ${JSON.stringify(calls)})`,
		);
		/* Pick a row, then scroll on past it so it is off screen (QA 3b). */
		await pickHolds(app, '[data-conversation-id="ch20_org_shared"]', "ch20");
		await scrollRail(app, 1200);
		await choose("Other");
		await choose("Shared");
		assert.equal(
			viewport(app).scrollTop,
			1200,
			`picked then scrolled on: A -> B -> A restores 1200 (calls: ${JSON.stringify(calls)})`,
		);
	} finally {
		await app.close();
	}
});

test("after leaving and returning, the reader's next scroll is held (Q2)", async () => {
	/* The shell's hosted column: on every return the rail is absent for the
	   commit that mounts the page, and portaled in a commit later. */
	const app = await open(undefined, { hostedRail: true });
	modelGeometry();
	try {
		await scrollRail(app, 816);
		await app.leave();
		await app.back();
		await until(
			() => viewport(app)?.scrollTop === 816,
			"the return restores 816",
		);

		/* The reader keeps sifting: a new offset, then a pick (QA 4c). */
		await scrollRail(app, 126);
		await pickHolds(app, '[data-conversation-id="ch3_org_shared"]', "ch3", 126);
		/* And a further scroll survives another leave/return (QA 4b). */
		await scrollRail(app, 246);
		await app.leave();
		await app.back();
		await until(() => selectedRow(app), "rail back after the second return");
		await delay();
		await delay();
		assert.equal(
			viewport(app).scrollTop,
			246,
			"the reader's 246 is restored, not the stale 816",
		);
	} finally {
		await app.close();
	}
});

test("picking a channel, group or DM below the fold keeps the rail where it was", async () => {
	const app = await open();
	try {
		await pickHolds(app, '[data-conversation-id="ch27_org_shared"]', "channel");
		await pickHolds(app, '[data-conversation-id="grp_org_shared"]', "group");
		await pickHolds(
			app,
			'[data-team-bridge-person="acct_peer_0"]',
			"person DM",
		);
	} finally {
		await app.close();
	}
});

test("picking a chief of staff and its read-only history keeps the rail where it was", async () => {
	const app = await open();
	try {
		await pickHolds(
			app,
			'[data-team-bridge-chief="acct_ben"]',
			"chief of staff",
		);
		const audit = 'section[aria-label="Your chief of staff’s messages"] button';
		await until(
			() => viewport(app)?.querySelector(audit),
			"chief-of-staff history listed",
		);
		const before = await scrollRail(app, 480);
		await act(async () => viewport(app).querySelector(audit).click());
		await until(
			() =>
				viewport(app)?.querySelector(
					'section[aria-label="Your chief of staff’s messages"] [aria-current="page"]',
				),
			"history row selected",
		);
		await delay();
		/* The audit is not a target, so the view may or may not remount here;
		   the reader-visible claim is the offset, asserted either way. */
		assert.equal(viewport(app).scrollTop, 480, "history pick: scrollTop held");
		void before;
	} finally {
		await app.close();
	}
});

test("a list refresh (new message, unread badge, presence) keeps the rail where it was", async () => {
	const app = await open();
	try {
		const held = await scrollRail(app, 520);
		/* New message + unread badge on a row, and the chief's presence flips. */
		const next = {
			...ORGS,
			org_shared: ORGS.org_shared.map((r) =>
				r.id === "ch3_org_shared"
					? { ...r, latest_seq: 9, unread_count: 4, last_message_at: now }
					: r,
			),
		};
		scenario(app.fixture, next);
		app.fixture.directoryMembers = DIRECTORY.map((m) =>
			m.agent ? { ...m, agent: { ...m.agent, state: "offline" } } : m,
		);
		await act(async () =>
			app.client.invalidateQueries({ queryKey: ["team-bridge"] }),
		);
		await until(
			() =>
				viewport(app)
					?.querySelector('[data-conversation-id="ch3_org_shared"]')
					?.textContent.includes("4"),
			"the unread badge rendered",
		);
		await delay();
		assert.ok(viewport(app) === held, "a refresh does not remount the rail");
		assert.equal(viewport(app).scrollTop, 520, "refresh: scrollTop held");
	} finally {
		await app.close();
	}
});

test("each organization keeps its own rail position, and leaving Team Bridge keeps it", async () => {
	const app = await open("/team-bridge");
	try {
		const switcher = () =>
			app.host.querySelector('button[aria-label^="Organization:"]');
		const choose = async (label) => {
			await act(async () => switcher().click());
			const item = [...app.host.querySelectorAll('[role="menuitem"]')].find(
				(entry) => entry.textContent.trim().startsWith(label),
			);
			assert.ok(item, `menu ${label}`);
			await act(async () => item.click());
			await until(
				() => switcher().textContent.trim().startsWith(label),
				`${label} shown`,
			);
			await until(() => selectedRow(app), `${label}: a row is selected`);
			await delay();
		};
		await choose("Shared");
		await scrollRail(app, 600);
		await choose("Other");
		assert.notEqual(
			viewport(app).scrollTop,
			600,
			"Other does not inherit Shared's position",
		);
		await scrollRail(app, 240);
		await choose("Shared");
		assert.equal(viewport(app).scrollTop, 600, "A -> B -> A restores A");
		await choose("Other");
		assert.equal(viewport(app).scrollTop, 240, "B's own position restored");

		await app.leave();
		await app.back();
		await until(() => viewport(app), "rail back after return");
		await delay();
		assert.equal(
			viewport(app).scrollTop,
			240,
			"leaving Team Bridge and coming back restores the position",
		);
	} finally {
		await app.close();
	}
});

test("a rail pick never calls scrollIntoView; an off-screen deep-link target uses block nearest", async () => {
	/* Stubbed after the landing: the first paint's default selection is not a
	   pick, and the stub would otherwise call even #general off-screen. */
	const app = await open();
	const calls = stubGeometry();
	try {
		await pickHolds(app, '[data-conversation-id="ch27_org_shared"]', "channel");
		assert.deepEqual(
			calls,
			[],
			"a pick the reader made in the rail never moves it",
		);
	} finally {
		await app.close();
	}
	calls.length = 0;
	const linked = await open(
		"/team-bridge?tenant=org_shared&conversation=ch29_org_shared",
	);
	try {
		await until(
			() =>
				viewport(linked)?.querySelector(
					'[data-conversation-id="ch29_org_shared"][aria-current="page"]',
				),
			"deep-linked row selected",
		);
		await delay();
		assert.ok(
			calls.some(
				(call) =>
					call.id === "ch29_org_shared" && call.options?.block === "nearest",
			),
			`deep link revealed with block nearest: ${JSON.stringify(calls)}`,
		);
		assert.ok(
			calls.every((call) => call.options?.block === "nearest"),
			"never any other alignment",
		);
	} finally {
		await linked.close();
	}
});
