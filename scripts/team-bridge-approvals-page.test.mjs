/**
 * Team Bridge approvals, through the SHIPPED page (container, hooks, React
 * Query, the owner fence) with only the preload transport faked
 * (`fixtures/team-bridge-auth-owner-page.mjs`, `fixture.approvals`).
 *
 *     node --test scripts/team-bridge-approvals-page.test.mjs
 *
 * What each test guards (ui#1954, QA round 2):
 * 1. Q2 - a requests read that failed keeps the Approvals entry; opening it
 *    shows the error copy and starts NO read of its own (it used to loop at
 *    ~2 reads a second: a no-data refetch resets `isError`, the slot unmounted
 *    the panel, the panel's mount refetched). Retry is the read it starts.
 * 2. Q6 - the nav badge's `?view=requests` landing survives the view's
 *    remounts on a cold open (the first mount used to consume the parameter
 *    and the next mount opened conversations).
 * 3. R1-03 - a refused authorize decided nothing, so the selection is kept.
 * 4. R3-01 - after the badge's landing, the reader's first pick of another
 *    conversation closes Requests (the target change remounted the view before
 *    it could report leaving Requests, so the latch held and the next view
 *    reopened on Requests).
 * 5. U11 - with only a row locked to the other word selected, the disabled
 *    batch button reads its plain label, not "Deny 0 of 1".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
process.env.TEAM_BRIDGE_PLAIN_MENUS = "1";
// The Requests panel schedules focus with a frame; jsdom has none.
globalThis.requestAnimationFrame ??= (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
const { delay, mount, until } = await import(
	"./fixtures/team-bridge-auth-owner-page.mjs"
);

const LOAD_FAILED = "Requests could not be loaded.";
const INTRO = "Approval requests your teammates' agents sent you.";

const requestRow = (id, name) => ({
	message_id: id,
	thread_id: null,
	created_at: "2026-11-17T10:00:00Z",
	excerpt: `May ${name}'s agent deploy?`,
	request: { state: "pending", expires_at: null },
	sender: { account_id: `a_${id}`, endpoint_id: null, name, email: null },
	ask: { session_id: "s1", ask_id: `k_${id}`, status: "open" },
	decidable: true,
	unsent_decision: null,
});
const page = (items) => ({
	status: 200,
	body: {
		result: {
			tenant_id: "org_shared",
			items,
			pending_count: items.length,
			next_cursor: null,
			has_more: false,
		},
	},
});
const listCalls = (fixture) =>
	fixture.calls.filter((call) => call.op === "team_bridge.requests.list")
		.length;
const approvalsEntry = (host) =>
	[...host.querySelectorAll("button")].find((button) =>
		button.textContent.startsWith("Approvals"),
	);
const click = async (element) => {
	await act(async () => {
		element.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
};
const settle = async (ms) => {
	for (let waited = 0; waited < ms; waited += 10) await delay();
};

test("Q2: a failed requests read keeps the entry, shows the error, and only Retry reads again", async () => {
	let failing = true;
	const app = await mount({
		seed: ({ fixture }) => {
			fixture.approvals = {
				"team_bridge.requests.list": () =>
					failing
						? { status: 500, body: { detail: "hub down" } }
						: page([requestRow("bmsg_1", "Priya")]),
			};
		},
	});
	try {
		const { host, fixture } = app;
		await until(
			() => approvalsEntry(host),
			"the entry is drawn after a failure",
		);
		// The page's own read and its one retry settle before the click.
		await settle(1600);
		const before = listCalls(fixture);
		await click(approvalsEntry(host));
		await until(
			() => host.textContent.includes(LOAD_FAILED),
			"the error copy is on screen",
		);
		const entry = approvalsEntry(host);
		await settle(1500);
		assert.equal(
			listCalls(fixture),
			before,
			"opening Requests on a failed read starts no read (no mount refetch loop)",
		);
		assert.equal(approvalsEntry(host), entry, "the entry was never remounted");
		assert.ok(host.textContent.includes(LOAD_FAILED));

		failing = false;
		const retry = [...host.querySelectorAll("button")].find(
			(button) => button.textContent.trim() === "Try again",
		);
		assert.ok(retry, "the error panel offers Retry");
		await click(retry);
		await until(
			() => host.textContent.includes("May Priya's agent deploy?"),
			"Retry reads again and the row appears",
		);
		assert.equal(listCalls(fixture), before + 1, "Retry is exactly one read");
	} finally {
		await app.close();
	}
});

test("Q6: the badge's ?view=requests landing opens Requests on a cold open, across remounts", async () => {
	const app = await mount({
		path: "/team-bridge?view=requests",
		waitReady: false,
		seed: ({ fixture }) => {
			fixture.approvals = {
				"team_bridge.requests.list": () =>
					page([requestRow("bmsg_1", "Priya")]),
			};
		},
	});
	try {
		const { host } = app;
		await until(
			() => host.textContent.includes(INTRO),
			"the Requests panel opens",
		);
		// Long enough for the list, the landing conversation and every remount
		// they cause to settle: the panel must still be the one on screen.
		await settle(800);
		assert.ok(
			host.textContent.includes(INTRO),
			"Requests is still open after the view settled",
		);
		assert.equal(
			approvalsEntry(host)?.getAttribute("aria-current"),
			"page",
			"the rail marks Approvals as the current view",
		);
	} finally {
		await app.close();
	}
});

test("R3-01: after the badge's landing, picking another conversation leaves Requests", async () => {
	const app = await mount({
		path: "/team-bridge?view=requests",
		waitReady: false,
		seed: ({ fixture }) => {
			fixture.approvals = {
				"team_bridge.requests.list": () =>
					page([requestRow("bmsg_1", "Priya")]),
			};
			// A second open conversation to pick (listed through `created`).
			fixture.created = [
				{
					id: "bcv_second",
					tenant_id: "org_shared",
					kind: "group",
					name: "Second room",
					visibility: "private",
					agent_capable: false,
					status: "open",
					created_by: "acct_a",
					last_message_at: "2026-11-17T09:00:00Z",
					latest_seq: 0,
					members: [],
					last_read_seq: 0,
					unread_count: 0,
					muted: false,
				},
			];
		},
	});
	try {
		const { host } = app;
		await until(
			() => host.textContent.includes(INTRO),
			"the Requests panel opens",
		);
		await settle(800);
		// Pick whichever conversation the landing did NOT settle on: re-picking
		// the current row changes no target, so nothing remounts and the old
		// exit (the view's own report) already worked.
		const other = () =>
			[...host.querySelectorAll("[data-conversation-id]")].find(
				(row) => row.getAttribute("aria-current") !== "page",
			);
		await until(
			() =>
				host.querySelector('[data-conversation-id="bcv_second"]') && other(),
			"both conversations are listed, one of them current",
		);
		await click(other());
		await settle(800);
		assert.ok(
			!host.textContent.includes(INTRO),
			"the reader's pick closed Requests",
		);
		assert.notEqual(
			approvalsEntry(host)?.getAttribute("aria-current"),
			"page",
			"the rail no longer marks Approvals as current",
		);
	} finally {
		await app.close();
	}
});

test("R1-03: a refused confirmation prompt keeps the selection", async () => {
	const app = await mount({
		seed: ({ fixture }) => {
			fixture.approvals = {
				"team_bridge.requests.list": () =>
					page([requestRow("bmsg_1", "Priya"), requestRow("bmsg_2", "Omar")]),
				"team_bridge.requests.authorize": () => ({
					status: 409,
					body: { detail: { code: "operator_signature_unavailable" } },
				}),
			};
		},
	});
	try {
		const { host, fixture } = app;
		await until(() => approvalsEntry(host), "the entry is drawn");
		await click(approvalsEntry(host));
		await until(
			() => host.querySelector('[aria-label="Select the request from Priya"]'),
			"the rows render",
		);
		const box = () =>
			host.querySelector('[aria-label="Select the request from Priya"]');
		await click(box());
		assert.equal(box().getAttribute("aria-checked"), "true");
		const approveSelected = [...host.querySelectorAll("button")].find(
			(button) => button.textContent.startsWith("Approve selected"),
		);
		await click(approveSelected);
		await until(
			() =>
				host.textContent.includes("The confirmation prompt wasn't completed."),
			"the dismissal reads",
		);
		assert.equal(
			fixture.calls.filter((call) => call.op === "team_bridge.requests.decide")
				.length,
			0,
			"nothing was decided",
		);
		assert.equal(
			box().getAttribute("aria-checked"),
			"true",
			"the selection survives a refusal that decided nothing",
		);
	} finally {
		await app.close();
	}
});

test("U11: a batch word that would send nothing reads its plain label", async () => {
	const app = await mount({
		seed: ({ fixture }) => {
			fixture.approvals = {
				"team_bridge.requests.list": () =>
					page([
						{ ...requestRow("bmsg_1", "Priya"), unsent_decision: "approve" },
					]),
			};
		},
	});
	try {
		const { host } = app;
		await until(() => approvalsEntry(host), "the entry is drawn");
		await click(approvalsEntry(host));
		const box = () =>
			host.querySelector('[aria-label="Select the request from Priya"]');
		await until(box, "the locked row renders");
		await click(box());
		const deny = [...host.querySelectorAll("button")].find((button) =>
			button.textContent.startsWith("Deny selected"),
		);
		assert.ok(deny, "the deny batch button reads its plain label");
		assert.equal(deny.textContent.trim(), "Deny selected");
		assert.equal(deny.disabled, true, "and stays disabled");
		assert.ok(
			![...host.querySelectorAll("button")].some((button) =>
				button.textContent.includes("Deny 0 of"),
			),
			"no 'Deny 0 of 1'",
		);
	} finally {
		await app.close();
	}
});
