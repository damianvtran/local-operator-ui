import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * TEAM BRIDGE MEMBERSHIP EVENTS: invited / joined / left ... as quiet lines.
 *
 *     node --test scripts/team-bridge-member-events.test.mjs
 *
 * Fixtures transcribe the frozen agent-server contract (`events[]` on the
 * conversation page: id, event_seq, kind, implicit, implicit_reason, actor,
 * targets, request_id, after_seq, at). The server is not deployed when this
 * lands, so these fixtures ARE the contract until it is.
 *
 * WHAT EACH SECTION CAN FALSIFY:
 *  - WIRE: a page without `events`, with an unknown kind, or with one malformed
 *    event still parses (a membership line must never blank a conversation).
 *  - PLACEMENT: `after_seq` interleave, never anchored to an optimistic row.
 *  - ROLL-UP + COPY: request_id+kind grouping, "and N others", owner-added agent,
 *    unknown kinds inert; whole ICU sentences, locale list joining.
 *  - CARRY: forward polls dedupe by id and respect the page's lower bound.
 *  - EVENTS ARE NOT MESSAGES: an events-only delta leaves the messages array
 *    (the input to unread, notify, arrival, read and stick-to-bottom) untouched,
 *    and the models that own those decisions never read `events`.
 *  - RENDER: the shipped list draws event lines between rows with no
 *    `data-message-id`; the owner-audit view never draws them.
 */
const bundle = await build({
	stdin: {
		contents: `
export * from './src/renderer/src/features/team-bridge/team-bridge-member-events-model';
export { teamBridgeEventSentences } from './src/renderer/src/features/team-bridge/team-bridge-member-events';
export { TeamBridgeMessageList } from './src/renderer/src/features/team-bridge/team-bridge-message-list';
export { teamBridgeMessagePageSchema, teamBridgeEventKind, teamBridgeImplicitReason } from './src/shared/team-bridge-contract';
export { ownerAuditMessagePageSchema } from './src/shared/team-bridge-owner-audit-contract';
export { ownerAuditToBridgeMessage, ownerAuditChronology } from './src/renderer/src/features/team-bridge/team-bridge-owner-audit-model';
export { teamBridgeLiveArrivals, resetTeamBridgeArrivals } from './src/renderer/src/features/team-bridge/team-bridge-arrival-model';
export { setLocale } from './src/i18n';
export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';`,
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
const path = `${process.cwd()}/.member-events-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
let m;
try {
	m = await import(path);
} finally {
	await unlink(path);
}
m.setLocale("en");

const BEN = {
	kind: "human",
	account_id: "acct_ben",
	display_label: "Ben Tran",
};
const DAMIAN = {
	kind: "human",
	account_id: "acct_damian",
	display_label: "Damian Tran",
};
const SANA = {
	kind: "human",
	account_id: "acct_sana",
	display_label: "Sana Ketabchi",
};
const agent = (owner, name) => ({
	kind: "agent",
	account_id: owner.account_id,
	endpoint_id: `bep_${owner.account_id}`,
	display_label: `${name} (${owner.display_label})`,
});
const AIDA_SANA = agent(SANA, "Aida");
const AIDA_DAMIAN = agent(DAMIAN, "Aida");

let seq = 0;
const event = (overrides) => {
	seq += 1;
	return {
		id: `bcev_${seq}`,
		event_seq: seq,
		kind: "invited",
		implicit: false,
		actor: DAMIAN,
		targets: [SANA],
		request_id: `bcrq_${seq}`,
		after_seq: 0,
		at: "2026-10-30T14:02:11.123Z",
		...overrides,
	};
};
const message = (id, seqNo, extra = {}) => ({
	id,
	conversation_id: "bcv_events",
	seq: seqNo,
	sender: { account_id: "acct_ben", kind: "human", display_label: "Ben Tran" },
	body: id,
	origin: "human",
	created_at: "2026-10-30T14:00:00Z",
	...extra,
});
const label = (party) => party.display_label || "Unknown person";

/* ---------------------------------------------------------------- WIRE */

test("a page with no events field parses, and keeps events absent", () => {
	const page = m.teamBridgeMessagePageSchema.parse({
		messages: [message("a", 1)],
		has_more: false,
	});
	assert.equal("events" in page, false);
	assert.equal(page.events_truncated, undefined);
});

test("an unknown kind and an unknown implicit reason parse; the known-set check names them null", () => {
	const page = m.teamBridgeMessagePageSchema.parse({
		messages: [],
		events: [
			event({ kind: "promoted_to_admin" }),
			event({ kind: "joined", implicit: true, implicit_reason: "via_magic" }),
		],
		events_truncated: true,
	});
	assert.equal(page.events.length, 2);
	assert.equal(page.events_truncated, true);
	assert.equal(m.teamBridgeEventKind(page.events[0].kind), null);
	assert.equal(
		m.teamBridgeImplicitReason(page.events[1].implicit_reason),
		null,
	);
	assert.equal(m.teamBridgeEventKind("withdrawn"), "withdrawn");
	assert.equal(m.teamBridgeImplicitReason("owner_invite"), "owner_invite");
});

test("one malformed event is dropped; the page and the other events survive", () => {
	const page = m.teamBridgeMessagePageSchema.parse({
		messages: [message("a", 1)],
		events: [{ id: "bcev_bad", kind: "invited" }, event({}), null],
	});
	assert.equal(page.messages.length, 1);
	assert.equal(page.events.length, 1);
});

/* ----------------------------------------------------------- PLACEMENT */

test("after_seq interleave: after message k, before k+1; 0 is leading", () => {
	const rows = [message("m1", 1), message("m2", 2), message("m3", 3)];
	const anchors = m.teamBridgeEventAnchors(rows, [
		event({ id: "e0", after_seq: 0 }),
		event({ id: "e2", after_seq: 2 }),
		event({ id: "e2b", after_seq: 2 }),
	]);
	assert.deepEqual(
		anchors.get(m.TEAM_BRIDGE_EVENTS_LEADING).map((e) => e.id),
		["e0"],
	);
	assert.deepEqual(
		anchors.get("m2").map((e) => e.id),
		["e2", "e2b"],
	);
	assert.equal(anchors.has("m3"), false);
});

test("events never anchor to an optimistic (seq-less) row", () => {
	const rows = [
		message("m1", 1),
		message("m2", 2),
		{ ...message("optimistic", 0), seq: undefined },
	];
	const anchors = m.teamBridgeEventAnchors(rows, [
		event({ id: "future", after_seq: 99 }),
	]);
	assert.deepEqual(
		anchors.get("m2").map((e) => e.id),
		["future"],
		"after the newest SERVER row, before any optimistic row",
	);
	assert.equal(anchors.has("optimistic"), false);
});

test("a page older than the event's anchor still places it (gap below the page)", () => {
	const anchors = m.teamBridgeEventAnchors(
		[message("m40", 40), message("m41", 41)],
		[event({ id: "old", after_seq: 12 })],
	);
	assert.deepEqual(
		anchors.get(m.TEAM_BRIDGE_EVENTS_LEADING).map((e) => e.id),
		["old"],
	);
});

/* -------------------------------------------------------- ROLL-UP + COPY */

test("roll-up: one request_id + kind is one line; another kind is its own line", () => {
	const lines = m.teamBridgeEventLines([
		event({ id: "a", request_id: "bcrq_x", targets: [SANA] }),
		event({ id: "b", request_id: "bcrq_x", targets: [AIDA_SANA] }),
		event({ id: "c", request_id: "bcrq_x", kind: "joined", targets: [BEN] }),
	]);
	assert.equal(lines.length, 2);
	assert.equal(lines[0].key, "event:a", "keys live in their own namespace");
	assert.deepEqual(
		lines[0].targets.map((p) => p.display_label),
		["Sana Ketabchi", "Aida (Sana Ketabchi)"],
	);
	assert.equal(lines[1].kind, "joined");
});

test("roll-up never merges different requests (no time-window grouping)", () => {
	const lines = m.teamBridgeEventLines([
		event({ request_id: "bcrq_1" }),
		event({ request_id: "bcrq_2", targets: [BEN] }),
	]);
	assert.equal(lines.length, 2);
});

test("sentence: a single invite names everyone in one ICU sentence", () => {
	const [line] = m.teamBridgeEventLines([
		event({ request_id: "r", targets: [SANA] }),
		event({ request_id: "r", targets: [AIDA_SANA] }),
	]);
	const { shown, full, truncated } = m.teamBridgeEventSentences(
		line,
		label,
		"en",
	);
	assert.equal(
		shown,
		"Damian Tran invited Sana Ketabchi and Aida (Sana Ketabchi)",
	);
	assert.equal(full, shown);
	assert.equal(truncated, false);
});

test("sentence: more than two names read 'and N others'; the full list stays whole", () => {
	const [line] = m.teamBridgeEventLines([
		event({
			request_id: "r",
			actor: DAMIAN,
			targets: [BEN, SANA, AIDA_SANA, AIDA_DAMIAN],
		}),
	]);
	const { shown, full, truncated } = m.teamBridgeEventSentences(
		line,
		label,
		"en",
	);
	assert.equal(truncated, true);
	assert.equal(
		shown,
		"Damian Tran invited Ben Tran, Sana Ketabchi, and 2 others",
	);
	assert.equal(
		full,
		"Damian Tran invited Ben Tran, Sana Ketabchi, Aida (Sana Ketabchi), and Aida (Damian Tran)",
	);
	const [three] = m.teamBridgeEventLines([
		event({ targets: [BEN, SANA, AIDA_SANA] }),
	]);
	assert.match(
		m.teamBridgeEventSentences(three, label, "en").shown,
		/and 1 other$/,
		"ICU plural: one other",
	);
});

test("sentence: owner-implicit join reads 'added their agent'; other verbs", () => {
	const cases = [
		[
			event({
				kind: "joined",
				implicit: true,
				implicit_reason: "owner_invite",
				targets: [AIDA_DAMIAN],
			}),
			"Damian Tran added their agent Aida (Damian Tran)",
		],
		[
			event({ kind: "joined", actor: SANA, targets: [SANA] }),
			"Sana Ketabchi joined",
		],
		[
			event({ kind: "left", actor: SANA, targets: [SANA] }),
			"Sana Ketabchi left",
		],
		[
			event({ kind: "removed", targets: [BEN] }),
			"Damian Tran removed Ben Tran",
		],
		[
			event({ kind: "consented", actor: SANA, targets: [AIDA_SANA] }),
			"Sana Ketabchi approved Aida (Sana Ketabchi) joining",
		],
		[
			event({ kind: "declined", actor: SANA, targets: [SANA] }),
			"Sana Ketabchi declined the invitation",
		],
		[
			event({ kind: "withdrawn", targets: [BEN] }),
			"Damian Tran withdrew the invitation for Ben Tran",
		],
		[event({ kind: "promoted_to_admin" }), "Membership changed"],
		[
			event({
				kind: "joined",
				implicit: true,
				implicit_reason: "dm_receive_policy",
				actor: SANA,
				targets: [SANA],
			}),
			"Sana Ketabchi joined",
		],
	];
	for (const [raw, expected] of cases) {
		const [line] = m.teamBridgeEventLines([raw]);
		assert.equal(m.teamBridgeEventSentences(line, label, "en").shown, expected);
	}
});

test("the target list is joined by the LOCALE's list format, not a hard-coded comma", () => {
	const [line] = m.teamBridgeEventLines([event({ targets: [BEN, SANA] })]);
	assert.match(
		m.teamBridgeEventSentences(line, label, "fr").shown,
		/Ben Tran et Sana Ketabchi/,
	);
});

/* --------------------------------------------------------------- CARRY */

test("carry: a poll re-including the boundary dedupes by id; the newer copy wins", () => {
	const kept = event({ id: "keep", after_seq: 3 });
	const prev = { messages: [message("m3", 3)], events: [kept] };
	const next = {
		messages: [message("m3", 3), message("m4", 4)],
		events: [
			{ ...kept, at: "2026-10-30T15:00:00Z" },
			event({ id: "new", after_seq: 4 }),
		],
	};
	const merged = m.withCarriedTeamBridgeEvents(prev, next);
	assert.deepEqual(merged.events.map((e) => e.id).sort(), ["keep", "new"]);
	assert.equal(
		merged.events.find((e) => e.id === "keep").at,
		"2026-10-30T15:00:00Z",
	);
	assert.equal(merged.messages, next.messages, "messages are never touched");
});

test("carry keeps a line a later poll omitted, within the page's lower bound only", () => {
	const prev = {
		messages: [message("m5", 5)],
		events: [
			event({ id: "seen", after_seq: 5 }),
			event({ id: "gone", after_seq: 1 }),
		],
	};
	const next = {
		messages: [message("m5", 5), message("m6", 6)],
		has_more: true,
	};
	const merged = m.withCarriedTeamBridgeEvents(prev, next);
	assert.deepEqual(
		merged.events.map((e) => e.id),
		["seen"],
	);
	assert.equal(m.teamBridgeEventsLowerBound(next), 5);
	assert.equal(m.teamBridgeEventsLowerBound({ ...next, has_more: false }), 0);
});

test("carry with no events anywhere returns the hub's page itself (events stays absent)", () => {
	const next = { messages: [message("a", 1)] };
	assert.equal(m.withCarriedTeamBridgeEvents(undefined, next), next);
	assert.equal(m.withCarriedTeamBridgeEvents({ messages: [] }, next), next);
});

/* ------------------------------------------- EVENTS ARE NOT MESSAGES */

test("an events-only page delta changes nothing any message model reads", () => {
	const rows = [message("m1", 1), message("m2", 2)];
	const before = { messages: rows };
	const after = m.withCarriedTeamBridgeEvents(before, {
		messages: rows,
		events: [event({ id: "only", after_seq: 2 })],
	});
	// The messages array is the sole input of: unread/mark-read (`newest` seq),
	// stick-to-bottom (`contentKey`), arrival motion, thread read, notifications.
	assert.equal(after.messages, rows);
	const newest = (page) => Math.max(...page.messages.map((x) => x.seq));
	assert.equal(newest(after), newest(before));
	const contentKey = (page) =>
		`${page.messages.length}:${page.messages.at(-1)?.id ?? ""}`;
	assert.equal(contentKey(after), contentKey(before));
	m.resetTeamBridgeArrivals();
	m.teamBridgeLiveArrivals("t/c", before.messages);
	assert.deepEqual([...m.teamBridgeLiveArrivals("t/c", after.messages)], []);
	// The watcher's banner check reads `.messages[0]`: an events-only page
	// (a new conversation's creation events) has no message to banner.
	const creation = m.teamBridgeMessagePageSchema.parse({
		messages: [],
		events: [event({})],
	});
	assert.equal(creation.messages[0], undefined);
});

test("the unread, notify, arrival, viewing, thread-read and search models never read events", () => {
	const dir = "src/renderer/src/features/team-bridge";
	for (const file of [
		"team-bridge-arrival-model.ts",
		"team-bridge-notify-model.ts",
		"use-team-bridge-notifications.ts",
		"team-bridge-viewing.ts",
		"team-bridge-thread-read.ts",
		"team-bridge-thread-pane.tsx",
		"use-stick-to-bottom.ts",
		"team-bridge-owner-audit.tsx",
		"team-bridge-owner-audit-model.ts",
		"use-team-bridge-owner-audit.ts",
	]) {
		const source = readFileSync(`${dir}/${file}`, "utf8");
		assert.doesNotMatch(
			source,
			/\bevents\s*[=:?]|\.events\b|TeamBridgeEvent\b/,
			file,
		);
	}
});

/* -------------------------------------------------------------- RENDER */

const listMarkup = (props) =>
	m.renderToStaticMarkup(
		m.createElement(m.TeamBridgeMessageList, {
			labelFor: (sender) => sender.display_label,
			arrivalsEnabled: false,
			...props,
		}),
	);

test("render: event lines sit between rows, carry no data-message-id, and an absent field adds nothing", () => {
	const rows = [message("m1", 1), message("m2", 2)];
	const without = listMarkup({ messages: rows });
	assert.equal(without.includes("data-team-bridge-event"), false);
	assert.equal(listMarkup({ messages: rows, events: [] }), without);
	const html = listMarkup({
		messages: rows,
		events: [
			event({ id: "lead", after_seq: 0, targets: [BEN] }),
			event({
				id: "mid",
				kind: "left",
				actor: SANA,
				targets: [SANA],
				after_seq: 1,
			}),
		],
	});
	const order = [
		...html.matchAll(/data-(?:message-id|team-bridge-event)="([^"]+)"/g),
	].map((match) => match[1]);
	assert.deepEqual(order, ["event:lead", "m1", "event:mid", "m2"]);
	const line = html.match(
		/<li data-team-bridge-event="event:mid"[^>]*>.*?<\/li>/,
	)[0];
	assert.equal(line.includes("data-message-id"), false);
	assert.match(line, /text-ink-dim/);
	assert.match(line, /Sana Ketabchi left/);
	assert.equal(/<button/.test(line), false, "no toolbar, reactions or reply");
});

test("render: a shortened line is focusable and its accessible name holds every name", () => {
	const html = listMarkup({
		messages: [message("m1", 1)],
		events: [
			event({ after_seq: 1, targets: [BEN, SANA, AIDA_SANA, AIDA_DAMIAN] }),
		],
	});
	assert.match(html, /tabindex="0"/);
	assert.match(
		html,
		/aria-label="Damian Tran invited Ben Tran, Sana Ketabchi, Aida \(Sana Ketabchi\), and Aida \(Damian Tran\)"/,
	);
	assert.match(html, /and 2 others/);
});

test("owner audit: the adapter ignores events[] and the audit list draws no event line", () => {
	const page = m.ownerAuditMessagePageSchema.parse({
		messages: [
			{
				...message("a1", 1),
				agent_delivery_status: null,
			},
		],
		events: [event({ after_seq: 1 })],
	});
	const adapted = m
		.ownerAuditChronology([page.messages])
		.map(m.ownerAuditToBridgeMessage);
	for (const row of adapted) assert.equal("events" in row, false);
	// The audit view passes messages only (pinned statically above); drawn the
	// way it draws them, no event line appears.
	const html = listMarkup({ messages: adapted });
	assert.equal(html.includes("data-team-bridge-event"), false);
});
