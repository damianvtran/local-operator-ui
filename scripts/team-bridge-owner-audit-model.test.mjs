/**
 * The owner-audit read model, and the two ways a reader could be misled.
 *
 *     node --test scripts/team-bridge-owner-audit-model.test.mjs
 *
 * Three claims, each with the instrument that can actually falsify it.
 *
 * 1. THE MODEL'S PURE FUNCTIONS, RUN FROM THE SHIPPED SOURCE. The module is
 *    bundled by esbuild in memory — the same way `agent-hub-queries.test.mjs`
 *    runs its hooks — so this asserts the code the app runs, not a restatement
 *    of its rules. `ownerAuditDelivery` decides how a message's screening
 *    outcome is LABELLED to the agent's owner; the dangerous near-miss is
 *    treating any agent sender without a verdict as the audited agent's "own"
 *    message, which would claim the owner's agent authored someone else's text.
 *    Every arm is pinned, including an agent sender of a DIFFERENT account.
 *
 * 2. THE NOT-OPEN GUARD IS THREE CONDITIONS, ASSERTED AGAINST THE TREE. A
 *    conversation id the caller cannot open used to fall through to the empty
 *    draft intro — "this is the beginning of your direct message history" about
 *    a DM of six messages (operator report, 2026-10-28). A frame cannot tell
 *    that branch from an untested one, so the three conditions that gate it are
 *    asserted where they are written. Removing any one of them re-opens the
 *    misreport: without `listState === "ready"` a cold start flashes it, and
 *    without the `conversation` target check a legitimate new DM draft loses its
 *    intro.
 *
 * 3. THE ONBOARDING DESIGNATES THE DURABLE CHIEF OF STAFF, NOT THE OPEN CHAT.
 *    The bug was a displayed task session being written into
 *    `team_bridge.session`, which designates a task as the agent's mailbox.
 *    Source-anchored: the prop is fed from the durable target, the model keeps
 *    an EXISTING explicit designation, and an unresolved target falls back to
 *    the empty string (the backend's own default) rather than to the displayed
 *    session.
 *
 * WHAT IT DOES NOT PROVE: that the audit routes answer, that the rail renders,
 * or that any pixel is right. Those are the real-app frames' job; this file is
 * green without either.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const read = (path) => readFileSync(path, "utf8");

// Same in-memory bundle pattern as scripts/agent-hub-queries.test.mjs: a data:
// URL cannot resolve a bare specifier, so everything is bundled rather than
// left external.
const bundle = await build({
	stdin: {
		contents: `
			export {
				ownerAuditDelivery,
				ownerAuditTitle,
				ownerAuditChronology,
			} from "./src/renderer/src/features/team-bridge/team-bridge-owner-audit-model";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});
const source = bundle.outputFiles[0].text;
const load = () =>
	import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`
	);
const model = await load();

// Source-anchored literals live at the top level: a regex inside a callback is what
// `useTopLevelRegex` reports, and hoisting them changes nothing about what is asserted.
const NOT_OPEN_GUARD =
	/target\?\.type === "conversation"\s*&&\s*shown === null\s*&&\s*listState === "ready"/;
const NOT_OPEN_COPY = /t\("ui\.teamBridge\.thread\.not_available"\)/;
const INTRO_PERSON = /t\("ui\.teamBridge\.thread\.intro_person"/;
const INTRO_CHIEF = /t\("ui\.teamBridge\.thread\.intro_chief"/;
const DURABLE_INTO_PROP =
	/sessionId=\{[^}]*durableAida\.data\?\.session_id[^}]*\}/;
const DISPLAYED_INTO_PROP = /sessionId=\{[^}]*displayedSessionId[^}]*\}/;
const KEEPS_EXPLICIT =
	/snapshot\.status\?\.local\.session\s*\n?\s*\?\s*this\.snapshot\.status\.local\.session/;
const EMPTY_FALLBACK = /:\s*sessionId\s*\n?\s*:\s*""/;

const AUDITED_AGENT = "acct-audited-agent";
const message = (over = {}) => ({
	id: "bcmsg_1",
	seq: 1,
	sender: { account_id: AUDITED_AGENT, kind: "agent", display_label: "Aida" },
	body: "text",
	origin: "agent",
	created_at: "2026-10-28T00:00:00Z",
	...over,
});

test("a verdict is labelled from the server's own status, never inferred", async () => {
	assert.equal(
		model.ownerAuditDelivery(
			message({ agent_delivery_status: "admitted" }),
			AUDITED_AGENT,
		),
		"admitted",
	);
	assert.equal(
		model.ownerAuditDelivery(
			message({ agent_delivery_status: "rejected" }),
			AUDITED_AGENT,
		),
		"rejected",
	);
	// A rejection is terminal and the server keeps the body null; the label must
	// still say so rather than falling through to "unknown".
	assert.equal(
		model.ownerAuditDelivery(
			message({ agent_delivery_status: "rejected", body: null }),
			AUDITED_AGENT,
		),
		"rejected",
	);
	assert.equal(
		model.ownerAuditDelivery(
			message({ agent_delivery_status: "not_screened" }),
			AUDITED_AGENT,
		),
		"not_screened",
	);
});

test("only the audited agent's OWN send is 'own', and only without a verdict", async () => {
	// The server omits the status on the agent's own sends: it never screens them.
	assert.equal(model.ownerAuditDelivery(message(), AUDITED_AGENT), "own");
	// A DIFFERENT agent account with no verdict is not "own" — this is the arm that
	// would otherwise let the audit claim its agent wrote someone else's message.
	assert.equal(
		model.ownerAuditDelivery(
			message({
				sender: {
					account_id: "acct-other",
					kind: "agent",
					display_label: "Other",
				},
			}),
			AUDITED_AGENT,
		),
		"unknown",
	);
	// A human sender without a verdict is not the agent's own either.
	assert.equal(
		model.ownerAuditDelivery(
			message({
				sender: {
					account_id: AUDITED_AGENT,
					kind: "human",
					display_label: "Damian",
				},
			}),
			AUDITED_AGENT,
		),
		"unknown",
	);
	// And an explicit verdict on an own-looking row wins over the authorship arm:
	// the server is the authority even if it ever labels one.
	assert.equal(
		model.ownerAuditDelivery(
			message({ agent_delivery_status: "admitted" }),
			AUDITED_AGENT,
		),
		"admitted",
	);
});

test("the title prefers the name, then the members, then the caller's fallback", () => {
	const members = [
		{ account_id: "a", kind: "human", display_label: "Damian" },
		{ account_id: "b", kind: "agent", display_label: "Aida (Ben)" },
	];
	assert.equal(
		model.ownerAuditTitle({ name: "  Q4 plan  ", members }, "fallback"),
		"Q4 plan",
	);
	assert.equal(
		model.ownerAuditTitle({ members }, "fallback"),
		"Damian, Aida (Ben)",
	);
	// Blank labels are dropped rather than joined into a title of commas, and an
	// unnamed DM of one agent still has a name.
	assert.equal(
		model.ownerAuditTitle(
			{
				members: [
					{ account_id: "a", kind: "human", display_label: "   " },
					{ account_id: "b", kind: "agent", display_label: "Aida" },
				],
			},
			"fallback",
		),
		"Aida",
	);
	assert.equal(model.ownerAuditTitle({ members: [] }, "Untitled"), "Untitled");
});

test("chronology de-duplicates an overlapping boundary and sorts by seq", () => {
	// An inclusive `after_seq` cursor re-serves the previous page's last row, and
	// the server pages newest-first: the model must not show it twice, and must
	// not inherit the server's direction.
	const older = [
		message({ id: "bcmsg_1", seq: 1 }),
		message({ id: "bcmsg_2", seq: 2 }),
	];
	const newer = [
		message({ id: "bcmsg_2", seq: 2, body: "restated" }),
		message({ id: "bcmsg_3", seq: 3 }),
	];
	const rows = model.ownerAuditChronology([newer, older]);
	assert.deepEqual(
		rows.map((row) => [row.id, row.seq]),
		[
			["bcmsg_1", 1],
			["bcmsg_2", 2],
			["bcmsg_3", 3],
		],
	);
	// The LAST occurrence of a duplicated row wins, so a re-read that healed a
	// missing body is the one shown.
	assert.equal(rows.find((row) => row.id === "bcmsg_2").body, "restated");
});

test("the not-open state is gated on all three conditions", () => {
	const page = read(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
	);
	// The three conditions, held as one guard: a conversation target, no row in
	// the caller's list, and a settled list.
	assert.match(
		page,
		NOT_OPEN_GUARD,
		"the not-open guard must keep all three conditions",
	);
	// It renders the dedicated copy, not the draft intro.
	assert.match(page, NOT_OPEN_COPY);
	// The draft intro stays reachable for the targets that legitimately have no
	// thread yet — the regression this guard could cause.
	assert.match(page, INTRO_PERSON);
	assert.match(page, INTRO_CHIEF);
});

test("onboarding designates the durable chief of staff, never the open chat", () => {
	const app = read("src/renderer/src/app.tsx");
	// The prop is fed from the durable target hook.
	assert.match(
		app,
		DURABLE_INTO_PROP,
		"AgentMessagesOnboarding must be given the durable CoS session",
	);
	// The displayed task session must never be designated again: that was the bug.
	assert.doesNotMatch(
		app,
		DISPLAYED_INTO_PROP,
		"the displayed task session must not be designated",
	);

	const model = read(
		"src/renderer/src/features/agent-messages/agent-messages-model.ts",
	);
	// An EXISTING explicit designation wins over anything re-onboarded.
	assert.match(model, KEEPS_EXPLICIT);
	// An unresolved target falls back to the EMPTY string -- the backend defaults
	// an unset designation to its durable session -- never to the displayed task.
	assert.match(model, EMPTY_FALLBACK);
});
