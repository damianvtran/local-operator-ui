import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import {
	deferred,
	delay,
	mount,
	ui,
	until,
} from "./fixtures/team-bridge-auth-owner-page.mjs";

/*
 * INSTANT OPEN (tb-instant-open), measured at the runner rather than argued from
 * a reading of the source.
 *
 * The report was "opening Team Bridge can take a few seconds with a loading
 * wheel". The cause was a serial waterfall in front of the first paint: the whole
 * page held a full-screen gate until `capabilities` and `team_bridge.status`
 * answered, and only then did the core reads start - with the account-scope
 * conversation list among them, which a single-organization account immediately
 * threw away in favour of its own organization's list.
 *
 * These numbers are STRUCTURAL: round trips removed, counted through the REAL
 * page, the REAL hooks and keys, and the REAL shipped QueryClient against a
 * controlled transport. Nothing here models production latency - the transport
 * answers on a timer, so a wall-clock reading would measure this fixture and not
 * the app. Only the preload transport is a fixture.
 */

const SHARED = {
	tenant_id: "org_shared",
	tenant_name: "Shared",
	eligible: true,
	endpoint: null,
};
const PLAN_TITLE = "Team Bridge requires a Radient Team plan";
const ROW = "Shared thread";

const row = (overrides = {}) => ({
	id: "bcv_shared",
	tenant_id: "org_shared",
	kind: "group",
	name: ROW,
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2026-10-23T12:00:00Z",
	latest_seq: 0,
	members: [
		{
			account_id: "acct_a",
			kind: "human",
			display_label: "acct_a",
			state: "active",
			role: "member",
		},
	],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	...overrides,
});

/** Exactly the snapshot the shell's notification watcher leaves for this account. */
const seedWatcherSnapshot = ({ client, ui: bundle }) =>
	client.setQueryData(bundle.teamBridgeKeys.conversations("all", "acct_a"), {
		conversations: [row()],
		has_more: false,
	});

/** The list round trips the page has made, named by the scope it asked for. */
const listScopes = (app) =>
	app.fixture.calls
		.filter((call) => call.op === "team_bridge.conversations.list")
		.map((call) => (call.scope === "account" ? "account" : call.tenant_id));

test("a cold single-organization open asks for that organization's list once", async () => {
	/*
	 * THE NUMBER THIS TEST OWNS. Cold single-tenant open, mount to rail painted:
	 * before - ["account", "org_shared"], two round trips, the first discarded;
	 * after - ["org_shared"], one. The account-scope read is not narrowed, it is
	 * never issued: the organization set the hub already carries decides the scope
	 * before the first list request.
	 */
	const app = await mount({ path: "/team-bridge", tenants: [SHARED] });
	try {
		await until(
			() => app.host.textContent.includes(ROW),
			"the organization's rail row",
		);
		assert.deepEqual(
			listScopes(app),
			["org_shared"],
			`one organization-scope list read, saw ${JSON.stringify(listScopes(app))}`,
		);
	} finally {
		await app.close();
	}
});

test("the rail paints from the watcher's cache before the eligibility gate answers", async () => {
	/*
	 * MECHANISM 2, and the line it draws. The verdict decides whether this surface
	 * exists for the account, so an ineligible answer still wins (the test below);
	 * what the gate must no longer do is hide rows this account already read. Here
	 * the status read is held open, the watcher's snapshot is in cache, and the
	 * rail must be readable before the verdict lands - with no list request spent
	 * to get there, because the rows came from the watcher's own poll.
	 */
	const gate = deferred();
	const app = await mount({
		path: "/team-bridge",
		tenants: [SHARED],
		statusGate: gate,
		waitReady: false,
		seed: seedWatcherSnapshot,
	});
	try {
		await until(
			() => app.host.textContent.includes(ROW),
			"the cached rail row before the verdict",
		);
		assert.deepEqual(
			listScopes(app),
			[],
			"the paint spends no list request of its own",
		);
		/* The rows are painted but must not claim to be current: the affordance is
		   the honest half of painting from cache. */
		assert.ok(
			app.host.querySelector("[data-rail-refreshing]"),
			"a cached paint says it is not yet current",
		);
		/* Writes stay shut while the verdict is unknown: the shipped owner guard is
		   what refuses them, and it has not answered either. */
		assert.equal(
			app.host.querySelector('[aria-label="Send message"]')?.disabled ?? true,
			true,
			"no write is offered before the verdict",
		);
		gate.resolve();
		await until(
			() => listScopes(app).length === 1,
			"the organization's list read after the verdict",
		);
	} finally {
		gate.resolve();
		await app.close();
	}
});

test("an ineligible account is shown no cached surface at all", async () => {
	/*
	 * THE OTHER SIDE OF THE LINE. Same cached snapshot, same account, and the
	 * verdict says the plan does not include the bridge: the panel renders and not
	 * one cached row or control reaches the screen. A cache is a record of what this
	 * account could read, never permission to show a surface it may not have.
	 */
	const app = await mount({
		path: "/team-bridge",
		tenants: [SHARED],
		surfaceState: "A",
		waitReady: false,
		seed: seedWatcherSnapshot,
	});
	try {
		await until(
			() => app.host.textContent.includes(PLAN_TITLE),
			"the plan gate",
		);
		assert.equal(
			app.host.textContent.includes(ROW),
			false,
			"no cached row under an ineligible verdict",
		);
		assert.deepEqual(listScopes(app), [], "and no list read either");
	} finally {
		await app.close();
	}
});

/*
 * A MULTI-ORG ACCOUNT THAT MAY NOT READ STILL GETS ITS PANEL (review round 2, M3
 * on ui#1970). The opening hold waits for the default org, which memberships
 * answer, and memberships stay disabled once the verdict refuses reads. With two
 * hub tenants and a two-org watcher snapshot the hold used to win over the
 * eligibility branch and leave "Checking Team Bridge…" up for good. The test
 * above passes only because it is single-tenant; these are the two-tenant cases.
 */
const twoOrgSnapshot = ({ client, ui: bundle }) =>
	client.setQueryData(bundle.teamBridgeKeys.conversations("all", "acct_a"), {
		conversations: [
			row(),
			row({ id: "bcv_other", tenant_id: "org_other", name: "Other thread" }),
		],
		has_more: false,
	});
for (const { verdict, title, options } of [
	{
		verdict: "plan_required",
		title: PLAN_TITLE,
		options: { surfaceState: "A" },
	},
	{
		verdict: "rate_limited",
		title: "Slowing down requests",
		options: {
			statusState: "unavailable",
			statusError: { code: "rate_limited", message: "Too many requests" },
		},
	},
	{
		verdict: "unavailable",
		title: "Team Bridge is unavailable",
		options: { statusState: "unavailable" },
	},
]) {
	test(`a two-org ${verdict} account sees its panel, not an endless gate`, async () => {
		const app = await mount({
			path: "/team-bridge",
			waitReady: false,
			seed: twoOrgSnapshot,
			...options,
		});
		try {
			await until(
				() => app.host.textContent.includes(title),
				`the ${verdict} panel`,
			);
			assert.equal(
				app.host.textContent.includes(ROW),
				false,
				"no cached row under a refusing verdict",
			);
			assert.deepEqual(listScopes(app), [], "and no list read either");
		} finally {
			await app.close();
		}
	});
}

test("an unread refresh is visible, not a silently stale count", async () => {
	/*
	 * MECHANISM 4 for the one number a reader acts on. Cached rows stay on screen
	 * while the reads behind them settle, so the total and the per-row counts must
	 * say out loud that they are being re-read instead of presenting a stale count
	 * as current.
	 */
	const app = await mount();
	const gate = deferred();
	try {
		await until(() => app.host.textContent.includes(ROW), "the rail row");
		app.fixture.unreadGate = gate;
		await act(async () => {
			void app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.unreadPrefix,
			});
		});
		await until(
			() =>
				app.host
					.querySelector("[data-rail-refreshing]")
					?.getAttribute("data-rail-refreshing") === "unread",
			"a visible unread refresh",
		);
		/* Visible means both readings: the state is on screen and named for a
		   screen reader, and the rows it describes are still there. */
		assert.equal(app.host.textContent.includes(ROW), true);
		assert.equal(
			app.host.querySelector('[aria-busy="true"]') !== null,
			true,
			"the busy region is announced",
		);
		gate.resolve();
		await until(
			() => app.host.querySelector("[data-rail-refreshing]") === null,
			"the affordance clears once the count is current",
		);
	} finally {
		app.fixture.unreadGate = null;
		gate.resolve();
		await app.close();
	}
});

test("a re-entry keeps its rows while the reads behind them settle", async () => {
	/*
	 * MECHANISM 4 for the list: stale-while-revalidate, never a skeleton over a
	 * request that is merely slow. The organization's list is held open after the
	 * verdict lands; the last known rows stay readable, the affordance says they are
	 * being checked, and the read still lands.
	 */
	const listGate = deferred();
	const app = await mount();
	try {
		await until(() => app.host.textContent.includes(ROW), "the rail row");
		app.fixture.listGate = listGate;
		await act(async () => {
			void app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			});
		});
		await delay();
		assert.equal(
			app.host.textContent.includes(ROW),
			true,
			"rows stay painted while the list is in flight",
		);
		assert.ok(
			app.host.querySelector("[data-rail-refreshing]"),
			"and the paint is labelled as refreshing",
		);
		listGate.resolve();
		app.fixture.listGate = null;
		await until(
			() => app.host.querySelector("[data-rail-refreshing]") === null,
			"the affordance clears once the list is current",
		);
	} finally {
		app.fixture.listGate = null;
		listGate.resolve();
		await app.close();
	}
});

const HOME_TENANT = {
	...SHARED,
	tenant_id: "org_other",
	tenant_name: "Other",
	eligible: false,
};
const HOME_MEMBER = {
	tenant_id: HOME_TENANT.tenant_id,
	tenant_name: HOME_TENANT.tenant_name,
	role: "member",
	status: "active",
	is_home: true,
	plan: { status: "none", seats: 0 },
};

for (const [profile, expectedScope, title] of [
	["cold", "org_shared", "Shared"],
	["remembered", "org_other", "Other"],
	["ambiguous", "account", "All organizations"],
]) {
	test(`multi-org ${profile}: status decides before memberships; only the decided list is requested`, async (t) => {
		const statusGate = deferred();
		const membershipsGate = deferred();
		const rows = [
			row(),
			row({ id: "bcv_other", tenant_id: "org_other", name: "Other thread" }),
		];
		const app = await mount({
			path: "/team-bridge",
			waitReady: false,
			statusGate,
			membershipsGate,
			memberships: [HOME_MEMBER],
			tenants: [{ ...HOME_TENANT, eligible: profile === "ambiguous" }, SHARED],
			seed: ({ client, ui: bundle, fixture }) => {
				if (profile === "remembered")
					localStorage.setItem(
						"lo.teamBridge.scope.v1",
						JSON.stringify({ acct_a: "org_other" }),
					);
				fixture.listFor = (request) => ({
					conversations:
						request.scope === "account"
							? rows
							: rows.filter((r) => r.tenant_id === request.tenant_id),
					has_more: false,
				});
				client.setQueryData(
					bundle.teamBridgeKeys.conversations("all", "acct_a"),
					{
						conversations: rows,
						has_more: false,
					},
					// Keep the snapshot available to paint, but stale so a decided
					// account scope revalidates instead of satisfying the list from cache.
					{ updatedAt: 1 },
				);
			},
		});
		const sessionScope = () =>
			JSON.parse(
				window.sessionStorage.getItem("lo.teamBridge.sessionScope.v1") ?? "{}",
			).acct_a;
		try {
			await until(
				() =>
					app.fixture.calls.some((call) => call.op === "team_bridge.status"),
				"status in flight",
			);
			assert.deepEqual(listScopes(app), [], "no list read before status");
			assert.equal(sessionScope(), undefined, "no interim session scope");
			await act(async () => statusGate.resolve());
			await until(
				() => listScopes(app).length > 0,
				"the decided conversation list",
			);
			await until(
				() =>
					app.frames.some(
						(frame) => frame.scopeTitle === `Organization: ${title}`,
					),
				"the decided switcher title",
			);
			await act(async () => membershipsGate.resolve());
			if (profile === "cold") {
				// The same tenant set now has two eligible rows. This is not a new
				// cold open: neither the rail nor its request scope may jump to All.
				app.fixture.tenants = [{ ...HOME_TENANT, eligible: true }, SHARED];
				await act(async () => {
					await app.client.invalidateQueries({
						queryKey: ui.teamBridgeKeys.status,
					});
				});
				assert.ok(
					app.fixture.calls.filter((call) => call.op === "team_bridge.status")
						.length > 1,
					"the status revalidation was dispatched",
				);
			}
			const painted = [
				...new Set(app.frames.map((frame) => frame.scopeTitle).filter(Boolean)),
			];
			assert.deepEqual(painted, [`Organization: ${title}`]);
			assert.deepEqual(listScopes(app), [expectedScope]);
			assert.equal(
				sessionScope(),
				expectedScope === "account" ? "all" : expectedScope,
			);
			t.diagnostic(
				`status tenants -> ${JSON.stringify(expectedScope)} list -> ${JSON.stringify(painted)}; session=${sessionScope()}`,
			);
		} finally {
			await act(async () => {
				statusGate.resolve();
				membershipsGate.resolve();
			});
			await app.close();
		}
	});
}

/*
 * NO SEED SCOPE EVER PAINTS, AND NOTHING OF IT IS MARKED READ (QA round 1, Q1
 * and Q2 on ui#1970). The opening scope used to start as the seed (this app
 * session's scope, else yesterday's pick, else the union) and be corrected to
 * the default org by a passive effect - after paint. Two paths reached that
 * paint: memberships ALREADY CACHED by the shell (no hold at all), and the hold
 * lifting in the same commit that still carried the seed. Meanwhile the seed's
 * remembered conversation was restored into the selection, so its history read
 * answered and the mark-read effect advanced its cursor - clearing unread the
 * reader never saw.
 *
 * Asserted over EVERY committed frame (the fixture's Profiler runs before
 * passive effects, i.e. exactly what the browser would paint), not the final
 * DOM: a one-frame flash is the defect.
 */
const SHARED_MEMBER = {
	tenant_id: "org_shared",
	tenant_name: "Shared",
	role: "member",
	status: "active",
	is_home: false,
	plan: { status: "active", seats: 5 },
};

const OTHER_THREAD = "Other thread";
const history = (conversation) =>
	[1, 2].map((seq) => ({
		id: `msg_${conversation}_${seq}`,
		conversation_id: conversation,
		seq,
		sender: {
			account_id: "acct_b",
			kind: "human",
			display_label: "acct_b",
		},
		body: `line ${seq} of ${conversation}`,
		origin: "human",
		created_at: "2026-10-23T12:00:00Z",
	}));
/*
 * Each case also runs under <React.StrictMode>, which the app's renderer root
 * opts into (review round 4, R4-1 on ui#1970): StrictMode renders an update
 * twice from committed state, so opening state kept in a ref written during
 * render survived a discarded pass and brought the seed's flash back.
 */
const STRICT_MODES = [false, true];
const strictLabel = (strict) => (strict ? " (StrictMode)" : "");
const OPENINGS = STRICT_MODES.flatMap((strict) =>
	["cached", "delayed"].map((membershipsPath) => ({ strict, membershipsPath })),
);
for (const { strict, membershipsPath } of OPENINGS)
	for (const profile of ["stale", "fresh"])
		test(`multi-org ${profile} open, memberships ${membershipsPath}${strictLabel(strict)}: only the default org ever paints, and the seed's conversation is never marked read`, async () => {
			const gate = membershipsPath === "delayed" ? deferred() : null;
			const app = await mount({
				path: "/team-bridge",
				waitReady: false,
				strict,
				membershipsGate: gate,
				memberships: [HOME_MEMBER, SHARED_MEMBER],
				tenants: [HOME_TENANT, SHARED],
				seed: ({ client, ui: bundle, fixture }) => {
					if (profile === "stale")
						// The saved scope is no longer in the returned tenant list.
						localStorage.setItem(
							"lo.teamBridge.view.v1",
							JSON.stringify({
								acct_a: {
									scope: "org_gone",
									scopes: {
										org_gone: {
											target: { type: "conversation", id: "bcv_other" },
											tenantId: "org_other",
										},
									},
								},
							}),
						);
					// The shell's watcher left both orgs' rows, with unread in Other.
					client.setQueryData(
						bundle.teamBridgeKeys.conversations("all", "acct_a"),
						{
							conversations: [
								row({ latest_seq: 2 }),
								row({
									id: "bcv_other",
									tenant_id: "org_other",
									name: OTHER_THREAD,
									latest_seq: 2,
									unread_count: 2,
								}),
							],
							has_more: false,
						},
					);
					// ...and, on the cached path, already read the memberships at boot.
					if (membershipsPath === "cached")
						client.setQueryData(["memberships", "account", "acct_a"], {
							memberships: [HOME_MEMBER, SHARED_MEMBER],
							tenants: [HOME_TENANT, SHARED],
						});
					fixture.historyByConversation.set("bcv_other", history("bcv_other"));
					fixture.historyByConversation.set(
						"bcv_shared",
						history("bcv_shared"),
					);
				},
			});
			try {
				if (gate) {
					await until(
						() =>
							app.fixture.calls.some(
								(call) => call.control?.operation === "memberships.list",
							),
						"the memberships read is in flight",
					);
					// Long enough for a held seed's history read and mark-read to land.
					await delay(150);
					await act(async () => gate.resolve());
				}
				await until(
					() =>
						app.frames.some(
							(frame) =>
								frame.scopeTitle === "Organization: Shared" &&
								frame.selectedId === "bcv_shared",
						),
					"the default org, on its own conversation",
				);
				await delay(150);
				const titles = [
					...new Set(app.frames.map((frame) => frame.scopeTitle)),
				].filter(Boolean);
				assert.deepEqual(
					titles,
					["Organization: Shared"],
					"no commit ever titled another scope",
				);
				assert.equal(
					app.frames.some(
						(frame) =>
							frame.selectedId === "bcv_other" ||
							frame.text.includes(OTHER_THREAD),
					),
					false,
					"no commit ever showed the seed's conversation or rows",
				);
				assert.deepEqual(
					app.fixture.calls
						.filter((call) => call.op === "team_bridge.read")
						.map((call) => call.conversation_id)
						.filter((id) => id !== "bcv_shared"),
					[],
					"no read POST for anything but the default org's conversation",
				);
				// A mark-read refreshes the list, so the default org may be read twice;
				// what matters is that no other scope's list was ever asked for.
				assert.deepEqual(
					[...new Set(listScopes(app))],
					["org_shared"],
					"only the default org's list is read",
				);
			} finally {
				await app.close();
			}
		});

/*
 * THE DECIDED SCOPE'S OWN REMEMBERED CONVERSATION IS RESTORED (review round 4,
 * R4-2 on ui#1970). The opening drops the seed scope's restore and owes the
 * default org its own one. `bcv_shared` is the default org's landing whether or
 * not that restore runs, so this gives Shared a remembered SECOND conversation:
 * only the deferred restore selects it.
 */
for (const strict of STRICT_MODES)
	for (const membershipsPath of ["cached", "delayed"])
		test(`multi-org restart, memberships ${membershipsPath}${strictLabel(strict)}: the default org's own remembered conversation is restored`, async () => {
			const gate = membershipsPath === "delayed" ? deferred() : null;
			const rows = [
				row(),
				row({ id: "bcv_shared2", name: "Shared second" }),
				row({ id: "bcv_other", tenant_id: "org_other", name: OTHER_THREAD }),
			];
			const app = await mount({
				path: "/team-bridge",
				waitReady: false,
				strict,
				membershipsGate: gate,
				memberships: [HOME_MEMBER, SHARED_MEMBER],
				tenants: [HOME_TENANT, SHARED],
				seed: ({ client, ui: bundle, fixture }) => {
					fixture.listFor = (request) => ({
						conversations:
							request.scope === "account"
								? rows
								: rows.filter((r) => r.tenant_id === request.tenant_id),
						has_more: false,
					});
					// The stale last scope cannot mask the chosen Team org's own view.
					localStorage.setItem(
						"lo.teamBridge.scope.v1",
						JSON.stringify({ acct_a: "org_gone" }),
					);
					localStorage.setItem(
						"lo.teamBridge.view.v1",
						JSON.stringify({
							acct_a: {
								scope: "org_gone",
								scopes: {
									org_gone: {
										target: { type: "conversation", id: "bcv_other" },
										tenantId: "org_other",
									},
									org_shared: {
										target: { type: "conversation", id: "bcv_shared2" },
										tenantId: "org_shared",
									},
								},
							},
						}),
					);
					client.setQueryData(
						bundle.teamBridgeKeys.conversations("all", "acct_a"),
						{ conversations: rows, has_more: false },
					);
					if (membershipsPath === "cached")
						client.setQueryData(["memberships", "account", "acct_a"], {
							memberships: [HOME_MEMBER, SHARED_MEMBER],
							tenants: [HOME_TENANT, SHARED],
						});
				},
			});
			try {
				if (gate) {
					await until(
						() =>
							app.fixture.calls.some(
								(call) => call.control?.operation === "memberships.list",
							),
						"the memberships read is in flight",
					);
					await delay(150);
					await act(async () => gate.resolve());
				}
				await until(
					() =>
						app.frames.some(
							(frame) =>
								frame.scopeTitle === "Organization: Shared" && frame.selectedId,
						),
					"the default org, with a selection",
				);
				await delay(300);
				const sequence = [
					...new Set(
						app.frames.map(
							(frame) => `${frame.scopeTitle}|${frame.selectedId}`,
						),
					),
				];
				assert.equal(
					app.frames.at(-1).selectedId,
					"bcv_shared2",
					`the default org's remembered conversation; frames ${JSON.stringify(sequence)}`,
				);
				assert.equal(
					app.frames.some(
						(frame) =>
							frame.scopeTitle === "Organization: Shared" &&
							frame.selectedId === "bcv_shared",
					),
					false,
					`never the default landing first; frames ${JSON.stringify(sequence)}`,
				);
			} finally {
				await app.close();
			}
		});
