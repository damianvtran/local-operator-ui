import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * TEAM BRIDGE INTEGRATION (APP) MESSAGES: parse them, and never draw a person.
 *
 *     node --test scripts/team-bridge-integration-origin.test.mjs
 *
 * WHY. Team Integrations (approved C3 RFC, agent-server #401/#408) lets an
 * admin-installed app - Datadog, Grafana, Alertmanager, incident.io - post into
 * a channel with an app token. The hub serves such a row as
 * `origin: "integration"` with `sender: {kind: "integration", account_id:
 * <app id>, display_label: <app name>}` (agent-server
 * internal/services/integration_post.go). Before this change the message schema
 * closed both enums, so ONE app post failed the whole conversation page.
 *
 * WHAT EACH SECTION CAN FALSIFY:
 *  - WIRE: an app row and a future-origin row both parse inside a page, and an
 *    unknown origin or sender kind degrades to the `unknown` sentinel.
 *  - MAPPING: `teamBridgeSenderPresentation` reads either field marking an app
 *    as an app, and either unknown field as unknown, ahead of a known kind.
 *  - NAMING: an app is named by its stored label only - never resolved against
 *    the directory, even when its id collides with a member's.
 *  - AUDIT: the owner-audit mapper keeps an app an app.
 *  - RENDER: the shipped list draws an app row with the "App" badge and the app
 *    plate, no profile-card trigger, and an unknown row as a generic sender.
 *
 * WHAT IT DOES NOT PROVE: pixels (the Storybook frames' job,
 * `team-bridge-integration-messages.stories.tsx`), or that the hub sends these
 * rows (agent-server's suites).
 */
const bundle = await build({
	stdin: {
		contents: `
export { TeamBridgeMessageList } from './src/renderer/src/features/team-bridge/team-bridge-message-list';
export { teamBridgeMessageSchema, teamBridgeMessagePageSchema } from './src/shared/team-bridge-contract';
export { teamBridgeSenderPresentation, participantLabel } from './src/renderer/src/features/team-bridge/team-bridge-model';
export { threadParticipants } from './src/renderer/src/features/team-bridge/team-bridge-threads-model';
export { ownerAuditToBridgeMessage, ownerAuditSenderProfile } from './src/renderer/src/features/team-bridge/team-bridge-owner-audit-model';
export { teamBridgeDeliveryLines } from './src/renderer/src/features/team-bridge/team-bridge-delivery-annotation-model';
export { setLocale } from './src/i18n';
export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { QueryClient, QueryClientProvider } from '@tanstack/react-query';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
});
const path = `${process.cwd()}/.integration-origin-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
let m;
try {
	m = await import(path);
} finally {
	await unlink(path);
}
m.setLocale("en");

const APP_ID = "iap_0123456789abcdef";
const appMessage = (extra = {}) => ({
	id: "bcm_app",
	conversation_id: "bcv_alerts",
	seq: 1,
	sender: { account_id: APP_ID, kind: "integration", display_label: "Grafana" },
	body: "[FIRING:1] HighErrorRate api-prod",
	body_hash: "h",
	origin: "integration",
	created_at: "2026-11-17T14:00:00Z",
	...extra,
});
const humanMessage = (extra = {}) => ({
	id: "bcm_ada",
	conversation_id: "bcv_alerts",
	seq: 2,
	sender: { account_id: "acct_ada", kind: "human", display_label: "Ada" },
	body: "Looking",
	origin: "human",
	created_at: "2026-11-17T14:01:00Z",
	...extra,
});
const chiefLabels = {
	named: (agent, person) => `${agent} (${person})`,
	unnamed: (person) => `${person}'s chief of staff`,
};

/* ---------------------------------------------------------------- WIRE */

test("an integration message parses with its origin and sender kind intact", () => {
	const parsed = m.teamBridgeMessageSchema.parse(appMessage());
	assert.equal(parsed.origin, "integration");
	assert.equal(parsed.sender.kind, "integration");
	assert.equal(parsed.sender.display_label, "Grafana");
});

test("one app row and one future-origin row do not fail the page", () => {
	const page = m.teamBridgeMessagePageSchema.parse({
		messages: [
			appMessage(),
			humanMessage(),
			humanMessage({
				id: "bcm_future",
				seq: 3,
				origin: "workflow",
				sender: { account_id: "x_1", kind: "robot", display_label: "Thing" },
			}),
		],
	});
	assert.deepEqual(
		page.messages.map((row) => [row.origin, row.sender.kind]),
		[
			["integration", "integration"],
			["human", "human"],
			["unknown", "unknown"],
		],
	);
});

test("a missing or malformed origin degrades to unknown, never throws", () => {
	const { origin: _drop, ...noOrigin } = humanMessage();
	assert.equal(m.teamBridgeMessageSchema.parse(noOrigin).origin, "unknown");
	assert.equal(
		m.teamBridgeMessageSchema.parse(humanMessage({ origin: 7 })).origin,
		"unknown",
	);
});

test("an app replier keeps its kind in reply_participant_ids", () => {
	const parsed = m.teamBridgeMessageSchema.parse(
		humanMessage({
			reply_count: 2,
			reply_participants: ["Grafana", "Ada"],
			reply_participant_ids: [
				{ account_id: APP_ID, kind: "integration" },
				{ account_id: "acct_ada", kind: "robot" },
			],
		}),
	);
	assert.deepEqual(m.threadParticipants(parsed), [
		{ label: "Grafana", accountId: APP_ID, kind: "integration" },
		{ label: "Ada" },
	]);
});

/* ------------------------------------------------------------- MAPPING */

test("sender presentation: an app or unknown field wins over a known kind", () => {
	const cases = [
		["human", "human", "human"],
		["agent", "agent", "agent"],
		["system", "human", "human"],
		["integration", "integration", "app"],
		// Contradictory rows read as the LESS trusted identity.
		["integration", "human", "app"],
		["human", "integration", "app"],
		["unknown", "human", "unknown"],
		["agent", "unknown", "unknown"],
		["unknown", "integration", "app"],
	];
	for (const [origin, kind, expected] of cases)
		assert.equal(
			m.teamBridgeSenderPresentation({ origin, sender: { kind } }),
			expected,
			`${origin}/${kind}`,
		);
});

/* -------------------------------------------------------------- NAMING */

test("an app is named by its stored label, never by a colliding directory row", () => {
	const people = [
		{
			account_id: APP_ID,
			display_label: "Mallory Person",
			name: "Mallory Person",
			role: "member",
			bridge_enabled: true,
			bridge_state: "active",
		},
	];
	const app = appMessage().sender;
	assert.equal(m.participantLabel(app, people, chiefLabels), "Grafana");
	assert.equal(
		m.participantLabel({ ...app, kind: "unknown" }, people, chiefLabels),
		"Grafana",
	);
	assert.equal(
		m.participantLabel({ ...app, display_label: " " }, people, chiefLabels),
		null,
	);
});

/* --------------------------------------------------------------- AUDIT */

test("the owner audit keeps an app an app and resolves no profile for it", () => {
	const mapped = m.ownerAuditToBridgeMessage({
		...appMessage(),
		body: "alert",
		delivery_states: [],
	});
	assert.equal(mapped.origin, "integration");
	assert.equal(mapped.sender.kind, "integration");
	assert.equal(mapped.sender.audit_unknown_kind, undefined);
	assert.equal(
		m.ownerAuditSenderProfile(mapped.sender, [
			{ account_id: APP_ID, display_label: "Mallory" },
		]),
		undefined,
	);
});

test("an app row discloses no refusal class (only explicit human origin does)", () => {
	const lines = m.teamBridgeDeliveryLines(
		[
			{
				endpoint_id: "ep_1",
				state: "refused",
				refusal_class: "abusive",
				recipient_label: "Aida",
				recipient_owner_label: "Ben",
			},
		],
		{ origin: "integration", sender: { kind: "integration" } },
	);
	assert.equal(JSON.stringify(lines).includes("abusive"), false);
});

/* -------------------------------------------------------------- RENDER */

// The profile card's avatar reads through react-query; a client with no
// fetches behind it (static render) is enough for the card to mount.
const listMarkup = (props) =>
	m.renderToStaticMarkup(
		m.createElement(
			m.QueryClientProvider,
			{ client: new m.QueryClient() },
			m.createElement(m.TeamBridgeMessageList, {
				labelFor: (sender) => sender.display_label,
				arrivalsEnabled: false,
				...props,
			}),
		),
	);
const rowOf = (html, id) => {
	const start = html.indexOf(`data-message-id="${id}"`);
	assert.notEqual(start, -1, `row ${id} rendered`);
	const end = html.indexOf("</li>", start);
	return html.slice(start, end);
};

test("an app row: app plate, App badge, its own name, no profile-card trigger", () => {
	// A directory member with the app's id must still not dress the row.
	const html = listMarkup({
		messages: [appMessage(), humanMessage()],
		labelFor: (sender) =>
			sender.kind === "integration" ? "Mallory Person" : sender.display_label,
		profileFor: (sender) => ({
			account_id: sender.account_id,
			display_label: "Mallory Person",
			role: "member",
			bridge_enabled: true,
			bridge_state: "active",
		}),
	});
	const app = rowOf(html, "bcm_app");
	assert.match(app, /data-sender-kind="app"/);
	assert.match(app, /data-sender-avatar="app"/);
	assert.match(app, /data-sender-badge="app"[^>]*>App</);
	assert.match(app, />Grafana</);
	assert.equal(app.includes("Mallory"), false);
	// The profile card's trigger is a <button> on the name and the avatar;
	// a person row with a profile has both, an app row has neither.
	assert.equal(app.includes("<button"), false, "no profile-card trigger");
	const human = rowOf(html, "bcm_ada");
	assert.doesNotMatch(human, /data-sender-kind/);
	assert.equal(
		human.includes("<button"),
		true,
		"control: a person keeps the card",
	);
	assert.doesNotMatch(human, /data-sender-badge/);
});

test("an unknown-origin row renders as a generic sender, not a person", () => {
	const parsed = m.teamBridgeMessageSchema.parse(
		humanMessage({ id: "bcm_future", origin: "workflow" }),
	);
	const html = listMarkup({ messages: [parsed] });
	const row = rowOf(html, "bcm_future");
	assert.match(row, /data-sender-kind="unknown"/);
	assert.match(row, /data-sender-avatar="unknown"/);
	assert.doesNotMatch(row, /data-sender-badge/);
});

test("an unnamed app reads as a placeholder, not as a blank or a person", () => {
	const html = listMarkup({
		messages: [
			appMessage({
				sender: {
					account_id: APP_ID,
					kind: "integration",
					display_label: "Member",
				},
			}),
		],
	});
	const row = rowOf(html, "bcm_app");
	assert.match(row, />Unknown app</);
	assert.doesNotMatch(row, /Unknown person/);
});
