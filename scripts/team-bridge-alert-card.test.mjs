import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * TEAM INTEGRATIONS ALERT CARD (RFC §6.1, §10 items 2-4; D1/D2; U1; copy C2
 * deferred from agent-server #463). What this file pins:
 *  - the wire: `alert_meta` parses field-by-field and a malformed block costs
 *    the card, never the message;
 *  - the model: which rows are cards, severity/status/tone, group counts,
 *    claim states (including "unreported" on older hubs) and link verification;
 *  - the render: a card replaces the bare body, an app row draws no link
 *    preview, and every claim state renders line E, while line F exists only for actions;
 *  - the menu: "Manage apps" only with `can_manage_integrations`, "Alert
 *    responder" only where the reader's own agent is an active member.
 * Geometry (0px reflow) is measured in the browser capture, not jsdom.
 */
const bundle = await build({
	stdin: {
		contents: `
export { TeamBridgeMessageList } from './src/renderer/src/features/team-bridge/team-bridge-message-list';
export { TeamBridgeAlertCard, TeamBridgeAlertCardContainer, TeamBridgeAlertActionsContext } from './src/renderer/src/features/team-bridge/team-bridge-alert-card';
export { TeamBridgeResponderDialog } from './src/renderer/src/features/team-bridge/team-bridge-responder-dialog';
export * from './src/renderer/src/features/team-bridge/team-bridge-alert-model';
export { conversationMenuSections } from './src/renderer/src/features/team-bridge/team-bridge-conversation-menu-model';
export { teamBridgeMessageSchema, teamBridgeConversationSchema } from './src/shared/team-bridge-contract';
export { setLocale } from './src/i18n';
export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
});
const path = `${process.cwd()}/.alert-card-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
let m;
try {
	m = await import(path);
} finally {
	await unlink(path);
}
m.setLocale("en");

const meta = (extra = {}) => ({
	incident_key: "7a3c9f0e1d2b4c5a6e7f8091a2b3c4e1",
	app_id: "iap_1",
	app_name: "Datadog",
	source: "datadog",
	severity: "sev1",
	status: "firing",
	fire_count: 3,
	first_fired_at: "2026-11-21T14:02:00Z",
	last_fired_at: "2026-11-21T14:12:00Z",
	/* The hub clamps grouped_count to >= 1 and writes it on every root
	   (agent-server normalize.go, hookWriter.meta): 1 is a SINGLE alert (R1). */
	grouped_count: 1,
	labels: [
		{ key: "service", value: "scraper-api" },
		{ key: "env", value: "prod" },
		{ key: "region", value: "ca-central-1" },
		{ key: "team", value: "data" },
	],
	links: [
		{
			label: "",
			host: "app.datadoghq.com",
			url: "https://app.datadoghq.com/monitors/1",
		},
	],
	...extra,
});
const alertRow = (extra = {}, metaExtra = {}) => ({
	id: "bcmsg_alert",
	conversation_id: "bcv_alerts",
	seq: 1,
	sender: {
		account_id: "iap_1",
		kind: "integration",
		display_label: "Datadog",
	},
	body: "**scraper-api p99 latency above 2s**",
	origin: "integration",
	created_at: "2026-11-21T14:02:00Z",
	alert_meta: meta(metaExtra),
	...extra,
});
const parse = (row) => m.teamBridgeMessageSchema.parse(row);
const card = (row) => m.teamBridgeAlertCard(parse(row));

/* ---------------------------------------------------------------- WIRE */

test("alert_meta parses on an integration root", () => {
	const parsed = parse(alertRow());
	assert.equal(parsed.alert_meta.severity, "sev1");
	assert.equal(parsed.alert_meta.labels.length, 4);
});

test("a malformed alert_meta costs the card, never the message", () => {
	const parsed = parse({ ...alertRow(), alert_meta: "nonsense" });
	assert.equal(parsed.alert_meta, undefined);
	assert.equal(parsed.body, "**scraper-api p99 latency above 2s**");
	assert.equal(m.teamBridgeAlertCard(parsed), null);
});

test("a malformed field or entry costs only that field or entry", () => {
	const parsed = parse(
		alertRow(
			{},
			{
				fire_count: -4,
				labels: [{ key: "service", value: "api" }, 42],
				links: [null, { host: "x" }],
			},
		),
	);
	assert.equal(parsed.alert_meta.fire_count, undefined);
	assert.equal(parsed.alert_meta.severity, "sev1");
	const view = m.teamBridgeAlertCard(parsed);
	assert.deepEqual(view.labels, [{ key: "service", value: "api" }]);
	assert.deepEqual(view.links, []);
	assert.equal(view.fireCount, 1);
});

/* --------------------------------------------------------------- MODEL */

test("only an integration ROOT with alert_meta is a card", () => {
	assert.ok(card(alertRow()));
	assert.equal(card(alertRow({ alert_meta: undefined })), null);
	assert.equal(card(alertRow({ thread_root_id: "bcmsg_root" })), null);
	assert.equal(
		card(
			alertRow({
				origin: "human",
				sender: { account_id: "a", kind: "human", display_label: "Ada" },
			}),
		),
		null,
	);
});

test("severity and status are normalised; unknown never guesses a hue", () => {
	assert.equal(card(alertRow({}, { severity: "SEV2" })).severity, "sev2");
	assert.equal(card(alertRow({}, { severity: "p1" })).severity, "unknown");
	assert.equal(card(alertRow({}, { severity: "p1" })).tone, "dim");
	assert.equal(card(alertRow({}, { status: "paused" })).status, "unknown");
	/* Resolved overrides severity on the rail. */
	assert.equal(card(alertRow({}, { status: "resolved" })).tone, "success");
	assert.equal(card(alertRow({}, { status: "resolved" })).severity, "sev1");
});

test("a group card reports the count and clamps resolved to the total (C2)", () => {
	const view = card(
		alertRow({}, { storm: true, grouped_count: 6, group_resolved_count: 9 }),
	);
	assert.deepEqual(view.group, { total: 6, resolved: 6 });
	assert.equal(card(alertRow()).group, null);
});

test("a card is a group only when storm === true, whatever grouped_count says (R1)", () => {
	/* The hub's real single-alert shape: grouped_count 1, re-fired 4 times. */
	const single = card(
		alertRow({}, { severity: "sev2", grouped_count: 1, fire_count: 4 }),
	);
	assert.equal(single.group, null);
	assert.equal(single.fireCount, 4);
	/* A non-storm root with grouped_count > 1 is still one alert's card. */
	assert.equal(card(alertRow({}, { grouped_count: 3 })).group, null);
	assert.equal(
		card(alertRow({}, { storm: false, grouped_count: 3 })).group,
		null,
	);
	/* A resolved single alert is not "1 alert, 0 resolved". */
	assert.equal(
		card(alertRow({}, { status: "resolved", grouped_count: 1 })).group,
		null,
	);
});

test("resolvedAt is carried only on a resolved card (D1)", () => {
	const at = "2026-11-21T14:24:00Z";
	assert.equal(
		card(alertRow({}, { status: "resolved", resolved_at: at })).resolvedAt,
		at,
	);
	assert.equal(card(alertRow({}, { resolved_at: at })).resolvedAt, null);
});

test("links render only for https with a matching verified host", () => {
	const ok = m.safeAlertLink({
		host: "App.Datadoghq.com",
		url: "https://app.datadoghq.com/x",
	});
	assert.equal(ok.host, "app.datadoghq.com");
	for (const url of [
		"http://app.datadoghq.com/x",
		"https://evil.example/x",
		"https://app.datadoghq.com.evil.example/x",
		"https://user:pw@app.datadoghq.com/x",
		"javascript:alert(1)",
		"not a url",
	])
		assert.equal(
			m.safeAlertLink({ host: "app.datadoghq.com", url }),
			null,
			url,
		);
});

test("no claim block reads as unreported, never as unclaimed", () => {
	assert.equal(card(alertRow()).claim.kind, "unreported");
	assert.equal(
		card(alertRow({}, { claim_summary: { state: "released" } })).claim.kind,
		"unclaimed",
	);
});

const leaseExpiry = "2026-11-21T14:22:00.123456789Z";
const heldClaim = {
	state: "held",
	holder_kind: "agent",
	holder_name: "Aida",
	owner_name: "Ada",
	updated_at: "2026-11-21T14:12:00Z",
	lease_expires_at: leaseExpiry,
};

test("#465 held claim preserves the lease and reports waiting only for boolean true", () => {
	const waiting = { ...heldClaim, waiting_approval: true };
	const row = alertRow({}, { claim_summary: waiting });
	assert.deepEqual(parse(row).alert_meta.claim_summary, waiting);
	assert.deepEqual(card(row).claim, {
		kind: "waiting",
		holder: "Aida",
		owner: "Ada",
		updatedAt: heldClaim.updated_at,
		leaseExpiresAt: leaseExpiry,
	});
	for (const waiting_approval of [undefined, false]) {
		assert.equal(
			card(alertRow({}, { claim_summary: { ...heldClaim, waiting_approval } }))
				.claim.kind,
			"claimed",
		);
	}
});

test("malformed claim fields degrade in place; remote details are stripped", () => {
	const row = alertRow(
		{},
		{
			claim_summary: {
				...heldClaim,
				waiting_approval: "true",
				lease_expires_at: "not-a-timestamp",
				waiting_approval_for: {
					ask_id: "remote_ask",
					session_id: "remote_session",
				},
				latest_status_line: "not projected",
				escalated: true,
			},
		},
	);
	const parsed = parse(row);
	assert.equal(parsed.body, row.body);
	assert.equal(parsed.alert_meta.claim_summary.waiting_approval, undefined);
	assert.equal(parsed.alert_meta.claim_summary.lease_expires_at, undefined);
	for (const key of [
		"waiting_approval_for",
		"latest_status_line",
		"escalated",
	]) {
		assert.equal(Object.hasOwn(parsed.alert_meta.claim_summary, key), false);
	}
	assert.equal(card(row).claim.kind, "claimed");
	assert.equal(card(row).claim.leaseExpiresAt, null);
	for (const state of [undefined, 42, "waiting_approval", "future_state"]) {
		assert.deepEqual(
			card(
				alertRow(
					{},
					{ claim_summary: { ...heldClaim, state, waiting_approval: true } },
				),
			).claim,
			{ kind: "unreported" },
		);
	}
});

test("released and expired claims never enter the held or waiting view", () => {
	for (const state of ["released", "expired"]) {
		for (const fields of [
			{},
			{ waiting_approval: true, lease_expires_at: leaseExpiry },
		]) {
			assert.deepEqual(
				card(alertRow({}, { claim_summary: { state, ...fields } })).claim,
				{ kind: "unclaimed" },
			);
		}
	}
});

/* -------------------------------------------------------------- RENDER */

const renderCard = (row, props = {}) =>
	m.renderToStaticMarkup(
		m.createElement(m.TeamBridgeAlertCard, {
			card: card(row),
			body: m.createElement("p", null, "BODY"),
			locale: "en",
			...props,
		}),
	);

test("the card draws severity, status, counts, chips, fingerprint and host link", () => {
	const html = renderCard(alertRow());
	assert.match(html, /data-alert-card=""/);
	assert.match(html, />SEV1</);
	assert.match(html, />Firing</);
	assert.match(html, /Fired 3 times/);
	assert.match(html, />\+1</);
	assert.match(html, />7a3c9f…c4e1</);
	assert.doesNotMatch(html, /id 7a3c9f/);
	assert.match(html, /Incident fingerprint: 7a3c9f/);
	assert.match(html, /Open on app\.datadoghq\.com/);
	assert.match(html, /Responder not known yet/);
});

test("the hub's real single alert renders as one card: Fired 4 times, no group text (R1)", () => {
	const html = renderCard(
		alertRow({}, { severity: "sev2", grouped_count: 1, fire_count: 4 }),
	);
	assert.match(html, /Fired 4 times/);
	assert.match(html, />SEV2</);
	assert.doesNotMatch(html, /Worst/);
	assert.doesNotMatch(html, /\d+ alerts?, \d+ resolved/);
	assert.doesNotMatch(html, /data-alert-group/);
	const resolved = renderCard(
		alertRow({}, { status: "resolved", grouped_count: 1, fire_count: 1 }),
	);
	assert.doesNotMatch(resolved, /1 alert, 0 resolved/);
});

test("a resolved card says when it resolved and mutes its SEV badge (D1, D4)", () => {
	const html = renderCard(
		alertRow({}, { status: "resolved", resolved_at: "2026-11-21T14:24:00Z" }),
	);
	assert.match(html, /data-alert-clock="resolved"/);
	assert.match(html, /resolved \d{1,2}:24/);
	assert.doesNotMatch(html, /data-alert-clock="last"/);
	/* The SEV1 badge is neutral once resolved; a firing SEV1 keeps danger. */
	const sev = (h) => h.match(/<span[^>]*>SEV1<\/span>/)?.[0] ?? "";
	assert.doesNotMatch(sev(html), /danger/);
	assert.match(sev(renderCard(alertRow())), /danger/);
});

test("a group card names its worst severity and N alerts, M resolved", () => {
	const html = renderCard(
		alertRow({}, { storm: true, grouped_count: 6, group_resolved_count: 2 }),
	);
	assert.match(html, />Worst SEV1</);
	assert.match(html, /6 alerts, 2 resolved/);
});

test("every claim state renders line E and line F (fixed boxes, D1)", () => {
	for (const summary of [
		undefined,
		{ state: "released" },
		{ state: "held", holder_name: "Aida", owner_name: "Ada" },
		{
			state: "held",
			waiting_approval: true,
		},
	]) {
		const html = renderCard(alertRow({}, { claim_summary: summary }));
		assert.equal(html.match(/data-alert-claim-strip=/g)?.length, 1);
		/* Line F depends on links and the reader, never on the claim. */
		assert.equal(html.match(/data-alert-actions=""/g)?.length, 1);
		assert.match(html, /min-h-9/);
	}
	assert.match(
		renderCard(
			alertRow(
				{},
				{
					claim_summary: {
						state: "held",
						holder_name: "Aida",
						owner_name: "Ada",
					},
				},
			),
		),
		/Claimed: Aida for Ada/,
	);
});

test("the Review ask button renders only with an ask and a handler", () => {
	const row = alertRow(
		{},
		{
			claim_summary: {
				state: "held",
				holder_name: "Aida",
				waiting_approval: true,
			},
		},
	);
	assert.doesNotMatch(renderCard(row), /Review in Local Operator/);
	assert.match(
		renderCard(row, {
			ask: { askId: "a", sessionId: "s" },
			onReviewAsk: () => {},
		}),
		/Review in Local Operator/,
	);
});

test("line F is not drawn when it has nothing to hold (D3)", () => {
	const bare = renderCard(alertRow({}, { links: [] }));
	assert.doesNotMatch(bare, /data-alert-actions/);
	const withResponder = renderCard(alertRow({}, { links: [] }), {
		onResponders: () => {},
	});
	assert.match(withResponder, /data-alert-actions=""/);
	assert.match(withResponder, /Alert responder/);
});

test("lines A, D and F wrap by width instead of truncating (D2)", () => {
	const html = renderCard(alertRow(), { onResponders: () => {} });
	for (const line of ["A", "D"])
		assert.match(
			html,
			new RegExp(`data-alert-line="${line}" class="[^"]*flex-wrap`),
		);
	assert.match(html, /data-alert-actions="" class="[^"]*flex-wrap/);
	assert.match(html, /data-alert-clock="last" class="[^"]*shrink-0/);
});

test("the message list draws an alert root as a card with no link preview", () => {
	const html = m.renderToStaticMarkup(
		m.createElement(m.TeamBridgeMessageList, {
			messages: [parse(alertRow())],
			labelFor: (sender) => sender.display_label,
			arrivalsEnabled: false,
			locale: "en",
		}),
	);
	assert.match(html, /data-alert-card=""/);
	assert.match(html, /scraper-api p99 latency above 2s/);
	assert.doesNotMatch(html, /data-link-preview/);
});

test("the responder dialog is read-only and says the agent is not responding", () => {
	const html = m.renderToStaticMarkup(
		m.createElement(m.TeamBridgeResponderDialog, {
			open: true,
			channelName: "alerts-prod",
			agentName: "Aida",
			onClose: () => {},
		}),
	);
	/* Radix portals render nothing server-side; the component must not throw. */
	assert.equal(typeof html, "string");
});

/* ---------------------------------------------------------------- MENU */

/* The same shape the conversation-menu suite builds, parsed so the new
   `can_manage_integrations` field is read through the real contract. */
const channel = (extra = {}) =>
	m.teamBridgeConversationSchema.parse({
		id: "bcv_alerts",
		tenant_id: "t_1",
		kind: "channel",
		name: "alerts-prod",
		visibility: "tenant",
		agent_capable: true,
		status: "open",
		created_by: "acct_me",
		last_message_at: "2026-11-21T12:00:00.000Z",
		latest_seq: 1,
		last_read_seq: 1,
		unread_count: 0,
		muted: false,
		members: [
			{
				account_id: "acct_me",
				kind: "human",
				state: "active",
				role: "owner",
				display_label: "Me",
			},
			{
				account_id: "acct_me",
				kind: "agent",
				state: "active",
				role: "member",
				display_label: "Aida",
				endpoint_id: "be_me",
			},
		],
		...extra,
	});
const ids = (conversation) =>
	m
		.conversationMenuSections({
			conversation,
			selfAccountId: "acct_me",
			wiring: { manageApps: true, responder: true },
		})
		.flat()
		.map((item) => item.id);

test("Manage apps needs can_manage_integrations; absent fails closed", () => {
	assert.ok(
		ids(channel({ can_manage_integrations: true })).includes("manage_apps"),
	);
	assert.ok(!ids(channel()).includes("manage_apps"));
	assert.ok(
		!ids(channel({ can_manage_integrations: false })).includes("manage_apps"),
	);
	assert.ok(
		!ids(channel({ kind: "group", can_manage_integrations: true })).includes(
			"manage_apps",
		),
	);
});

test("Alert responder needs the reader's own agent active in the channel", () => {
	assert.ok(ids(channel()).includes("responder"));
	assert.ok(
		!ids(
			channel({
				members: [
					{
						account_id: "acct_me",
						kind: "human",
						state: "active",
						role: "owner",
						display_label: "Me",
					},
				],
			}),
		).includes("responder"),
	);
	assert.ok(
		!ids(
			channel({
				members: [
					{
						account_id: "acct_me",
						kind: "human",
						state: "active",
						role: "owner",
						display_label: "Me",
					},
					{
						account_id: "acct_other",
						kind: "agent",
						state: "active",
						role: "member",
						display_label: "Bo",
						endpoint_id: "be_other",
					},
				],
			}),
		).includes("responder"),
	);
});

/* A synthetic server ask id must not turn into a live navigation affordance.
 * There is no served alert-to-local-ask correlation yet; failing closed is
 * safer than opening an unrelated session because this machine has asks. */
test("the live container never invents an alert-to-local-ask correlation", () => {
	const row = alertRow(
		{},
		{
			claim_summary: {
				...heldClaim,
				waiting_approval: true,
				waiting_approval_for: {
					ask_id: "remote_ask",
					session_id: "remote_session",
				},
			},
		},
	);
	const html = m.renderToStaticMarkup(
		m.createElement(
			m.TeamBridgeAlertActionsContext.Provider,
			{ value: { onReviewAsk: () => {} } },
			m.createElement(m.TeamBridgeAlertCardContainer, {
				card: card(row),
				body: "BODY",
				locale: "en",
			}),
		),
	);
	assert.match(html, /data-alert-claim-strip="waiting"/);
	assert.equal(html.includes("Review in Local Operator"), false);
});
