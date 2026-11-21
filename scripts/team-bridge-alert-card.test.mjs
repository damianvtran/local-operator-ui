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
 *    claim states (including "unreported" on today's hub), link verification,
 *    and the owner-only ask CTA;
 *  - the render: a card replaces the bare body, an app row draws no link
 *    preview, and every claim state renders line E and line F;
 *  - the menu: "Manage apps" only with `can_manage_integrations`, "Alert
 *    responder" only where the reader's own agent is an active member.
 * Geometry (0px reflow) is measured in the browser capture, not jsdom.
 */
const bundle = await build({
	stdin: {
		contents: `
export { TeamBridgeMessageList } from './src/renderer/src/features/team-bridge/team-bridge-message-list';
export { TeamBridgeAlertCard } from './src/renderer/src/features/team-bridge/team-bridge-alert-card';
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
	grouped_count: 0,
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
		card(alertRow({}, { claim_summary: { state: "unclaimed" } })).claim.kind,
		"unclaimed",
	);
});

test("claim states: claimed, waiting (with ask), escalated", () => {
	const claimed = card(
		alertRow(
			{},
			{
				claim_summary: {
					state: "claimed",
					holder_name: "Aida",
					owner_name: "Ada",
					autonomy_tier: "T0",
					latest_status_line: "likely cause: deploy 4f1",
				},
			},
		),
	).claim;
	assert.equal(claimed.kind, "claimed");
	assert.equal(claimed.tier, "T0");
	const waiting = card(
		alertRow(
			{},
			{
				claim_summary: {
					state: "claimed",
					holder_name: "Aida",
					waiting_approval_for: { ask_id: "ask_1", session_id: "s_1" },
				},
			},
		),
	).claim;
	assert.equal(waiting.kind, "waiting");
	assert.deepEqual(waiting.ask, { askId: "ask_1", sessionId: "s_1" });
	const escalated = card(
		alertRow({}, { claim_summary: { state: "claimed", escalated: true } }),
	).claim;
	assert.equal(escalated.kind, "escalated");
});

test("the ask CTA is the owner's: only an ask pending on THIS device", () => {
	const claim = card(
		alertRow(
			{},
			{
				claim_summary: {
					state: "claimed",
					waiting_approval_for: { ask_id: "ask_1", session_id: "s_1" },
				},
			},
		),
	).claim;
	assert.deepEqual(m.alertAskOnThisDevice(claim, new Set(["ask_1"])), {
		askId: "ask_1",
		sessionId: "s_1",
	});
	assert.equal(m.alertAskOnThisDevice(claim, new Set(["ask_2"])), null);
	assert.equal(m.alertAskOnThisDevice(claim, new Set()), null);
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
	assert.match(html, /id 7a3c9f…c4e1/);
	assert.match(html, /Open on app\.datadoghq\.com/);
	assert.match(html, /No claim reported yet/);
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
		{ state: "unclaimed" },
		{ state: "claimed", holder_name: "Aida", owner_name: "Ada" },
		{ state: "claimed", escalated: true },
		{
			state: "claimed",
			waiting_approval_for: { ask_id: "a", session_id: "s" },
		},
	]) {
		const html = renderCard(alertRow({}, { claim_summary: summary }));
		assert.equal(html.match(/data-alert-claim-strip=/g)?.length, 1);
		assert.equal(html.match(/data-alert-actions=""/g)?.length, 1);
		assert.match(html, /min-h-9/);
		assert.match(html, /h-7/);
	}
	assert.match(
		renderCard(
			alertRow(
				{},
				{
					claim_summary: {
						state: "claimed",
						holder_name: "Aida",
						owner_name: "Ada",
					},
				},
			),
		),
		/Taken by Aida for Ada/,
	);
});

test("the Review ask button renders only with an ask and a handler", () => {
	const row = alertRow(
		{},
		{
			claim_summary: {
				state: "claimed",
				holder_name: "Aida",
				waiting_approval_for: { ask_id: "a", session_id: "s" },
			},
		},
	);
	assert.doesNotMatch(renderCard(row), /Review ask/);
	assert.match(
		renderCard(row, {
			ask: { askId: "a", sessionId: "s" },
			onReviewAsk: () => {},
		}),
		/Review ask in Local Operator/,
	);
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
