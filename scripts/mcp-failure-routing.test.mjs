import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The dead end UX review round 2 found (U1), pinned where it lived.
 *
 * A refused MCP control reached the screen as the BACKEND's sentence — "The MCP
 * control was refused. Check server ownership, transport and current operation
 * state." and "Session owner is unavailable. Reconnect and reconcile before
 * retrying." — with a retry of the identical request as the only control, and the
 * row's own remedies two screens away. Two things have to hold for that to stay
 * fixed, and they are asserted separately:
 *
 *   - the COPY: no sentence this module authors may contain the wire's internal
 *     nouns, and a status the app can classify must not be answered with the
 *     sentence the wire chose;
 *   - the ROUTING: the remedies offered from a failure are the row's own, the
 *     request that just failed is not offered again under a second label, the
 *     route to the row exists wherever a remedy does, and a failure about the
 *     SERVER offers none at all — nothing in the dialog can fix a server that did
 *     not answer.
 *
 * The SOURCE half is here for the same reason `mcp-auth-surface.test.mjs` has one:
 * the defect was one renderer printing a caught message, and a test over the files
 * that happen to do it today cannot see the next one.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/run-details/mcp-failure";' +
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
	// The component tree imports styles from its story, not from itself; this
	// keeps a CSS import from failing the bundle if one is added beside it.
	loader: { ".css": "empty" },
});
const {
	DesktopControlError,
	MCP_SETTINGS_ACTION_LABEL,
	mcpConfigActions,
	mcpFailure,
	mcpFailureActions,
	mcpServerSettingsRoute,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The two sentences the backend actually sends, verbatim from the routes. */
const REFUSED_409 =
	"The MCP control was refused. Check server ownership, transport and current operation state.";
const SESSION_503 =
	"Session owner is unavailable. Reconnect and reconcile before retrying.";
/** And the one MAIN authors, i.e. no backend answered this request at all. */
const TRANSPORT_503 =
	"The backend could not complete this request. Check its connection and try again.";

/** Every phase the renderer can fail in. */
const PHASES = [
	"probe",
	"grant",
	"reconnect",
	"reload",
	"add",
	"key",
	"cancel",
	"status",
	"disconnect",
	"remove",
];

/**
 * The vocabulary the finding quoted, and the reason this module exists.
 *
 * `session owner` is here too: it is not a thing any surface of this app shows,
 * and the round's own note was that the second sentence names one.
 */
const INTERNAL_NOUNS = [
	"ownership",
	"server ownership",
	"transport",
	"current operation state",
	"operation state",
	"reconcile",
	"session owner",
];

test("a refusal is stated in the user's terms, never in the wire's", () => {
	for (const phase of PHASES) {
		const failure = mcpFailure(
			phase,
			new DesktopControlError(409, REFUSED_409),
			false,
		);
		assert.equal(failure.cause, "refused", phase);
		assert.equal(failure.phase, phase);
		// The wire's sentence is not what the user reads, and no fragment of it is:
		// this is the finding's own frame, and the assertion that would have caught
		// it is that the string never reaches the message.
		assert.notEqual(failure.message, REFUSED_409);
		for (const noun of INTERNAL_NOUNS)
			assert.ok(
				!failure.message.toLowerCase().includes(noun),
				`${phase}: "${failure.message}" names ${noun}`,
			);
		// It still says what happened and what was NOT done to the user's server.
		assert.match(failure.message, /nothing was changed/, phase);
	}
});

test("the one cause this surface can name is named", () => {
	// A grant in flight is the ONE cause the renderer can establish for itself:
	// `mcp/desktop.py` allows one grant per session and refuses the rest with the
	// same opaque 409, and `mcp.list` publishes the operations.
	const busy = mcpFailure(
		"grant",
		new DesktopControlError(409, REFUSED_409),
		true,
	);
	assert.equal(busy.cause, "busy");
	assert.match(busy.message, /sign-in is already running/);
	assert.match(busy.message, /cancel it from the server's row/);
	for (const noun of INTERNAL_NOUNS)
		assert.ok(!busy.message.toLowerCase().includes(noun));
});

test("a 503 that the app wrote is about the server, the backend's is about the session", () => {
	// MAIN's own two 503 bodies mean no answer arrived, so the app's shared
	// classification (not a session claim) is the honest reading.
	const server = mcpFailure(
		"grant",
		new DesktopControlError(503, TRANSPORT_503),
		false,
	);
	assert.equal(server.cause, "server");
	assert.match(server.message, /server is not answering/);
	assert.ok(!server.message.includes("session is not running"));
	assert.deepEqual(
		mcpFailureActions({
			row: { remedy: { kind: "grant" }, keyNames: [] },
			phase: "grant",
			cause: server.cause,
			keyEntryAvailable: true,
		}),
		[],
		"nothing in this dialog fixes a server that did not answer, so no control claims to",
	);

	const session = mcpFailure(
		"grant",
		new DesktopControlError(503, SESSION_503),
		false,
	);
	assert.equal(session.cause, "session");
	assert.match(session.message, /this conversation's session is not running/);
	// The generic sentence is replaced rather than echoed; there is nothing in it a
	// reader can act on.
	assert.equal(session.detail, null);
	for (const noun of INTERNAL_NOUNS)
		assert.ok(!session.message.toLowerCase().includes(noun));

	// A vetted startup reason reached through ActionableConnectionError is carried
	// through VERBATIM instead: it is the server's own diagnosis, and a paraphrase
	// of a diagnosis is a claim nobody can check.
	const reason = "Chrome could not be started for the sign-in.";
	const actionable = mcpFailure(
		"grant",
		new DesktopControlError(503, reason),
		false,
	);
	assert.equal(actionable.cause, "session");
	assert.equal(actionable.detail, reason);
});

test("a 404 is the app's own 'older server' reading", () => {
	const outdated = mcpFailure(
		"grant",
		new DesktopControlError(404, "Not Found"),
		false,
	);
	assert.equal(outdated.cause, "server");
	assert.match(outdated.message, /older than this app expects/);
	assert.match(outdated.message, /Update the server/);
});

test("a server-cause failure offers nothing, whatever the row's own remedy is", () => {
	/*
	 * QA round 1 (Q1) found this live, and it is the same defect the two code
	 * review majors were describing from the doc side: the states whose own
	 * contract is "nothing here can help" offered the ROW's remedy, accented as the
	 * dialog's primary, and pressing it answered with a second failure ("The sign-in
	 * could not be started. The Local Operator server is older than this app
	 * expects."). The cause was ordering rather than a missing guard — the row's
	 * remedy was pushed before the `cause === "server"` early return — so the case
	 * has to be pinned against a row that CARRIES a remedy, at every phase.
	 *
	 * The three states are the three reproduced on the fixture: a server older than
	 * this app (404), an app that cannot authenticate to its own server (401), and a
	 * request that never answered (no status at all, and main's own 503, which mean
	 * the same thing and are classified the same way).
	 */
	const serverStates = [
		[
			"404",
			new DesktopControlError(404, "Not Found"),
			/older than this app expects/,
		],
		[
			"401",
			new DesktopControlError(401, "Unauthorized"),
			/cannot authenticate/,
		],
		[
			"no answer",
			new DesktopControlError(null, "Failed to fetch"),
			/is not answering/,
		],
		[
			"main's 503",
			new DesktopControlError(503, TRANSPORT_503),
			/is not answering/,
		],
	];
	const rows = [
		{ remedy: { kind: "grant" }, keyNames: [] },
		{ remedy: { kind: "key" }, keyNames: ["HUBSPOT_TOKEN"] },
		{ remedy: { kind: "reconnect" }, keyNames: [] },
		{ remedy: null, keyNames: [] },
	];
	for (const [label, error, sentence] of serverStates) {
		const failure = mcpFailure("probe", error, false);
		assert.equal(failure.cause, "server", label);
		assert.match(failure.message, sentence, label);
		for (const row of rows)
			for (const phase of PHASES)
				for (const keyEntryAvailable of [true, false])
					assert.deepEqual(
						mcpFailureActions({
							row,
							phase,
							cause: failure.cause,
							keyEntryAvailable,
						}),
						[],
						`${label}: ${phase} offered ${row.remedy?.kind ?? "no"} remedy for a failure nothing here can fix`,
					);
	}
});

test("the remedy that just failed is not offered again, and the route is wherever a remedy is", () => {
	const grantRow = { remedy: { kind: "grant" }, keyNames: [] };
	const kinds = (actions) => actions.map((action) => action.kind);

	// A probe that failed offers the row's own sign-in, a reload, and the row.
	assert.deepEqual(
		kinds(
			mcpFailureActions({
				row: grantRow,
				phase: "probe",
				cause: "refused",
				keyEntryAvailable: true,
			}),
		),
		["grant", "reload", "settings"],
	);
	// The refusal of a grant press does NOT: `Try again` in the dialog's actions
	// row is that retry, and a second label for one request is what made a retry
	// look like an escape.
	assert.deepEqual(
		kinds(
			mcpFailureActions({
				row: grantRow,
				phase: "grant",
				cause: "refused",
				keyEntryAvailable: true,
			}),
		),
		["reload", "settings"],
	);
	// A session that is not running keeps its remedies, because a control request
	// is itself what re-engages a session (`desktop_lifecycle.py` binds the runtime
	// before routing): the fixture answered 200 to the next `reload` after the
	// session had gone. Only the request that just failed is withheld. This is the
	// authoritative reading of the module's routing contract (review R1 and QA Q5
	// asked which of the two it was, and the doc now states this one), and the
	// SERVER cause is the one that offers nothing at all.
	assert.deepEqual(
		kinds(
			mcpFailureActions({
				row: grantRow,
				phase: "grant",
				cause: "session",
				keyEntryAvailable: true,
			}),
		),
		["reload", "settings"],
	);
	// A reload that failed is not offered again either, and that is the same rule
	// one level down: the phase excludes its own remedy for every phase, not only
	// for the three the row derives.
	assert.deepEqual(
		kinds(
			mcpFailureActions({
				row: grantRow,
				phase: "reload",
				cause: "refused",
				keyEntryAvailable: true,
			}),
		),
		["grant", "settings"],
	);
	// A probe failure keeps the row's own sign-in as the leading remedy: it is the
	// same operation its row offers, and the failed request was the probe.
	assert.deepEqual(
		kinds(
			mcpFailureActions({
				row: grantRow,
				phase: "probe",
				cause: "session",
				keyEntryAvailable: true,
			}),
		),
		["grant", "reload", "settings"],
	);
	// A declared key is a genuinely different path from the grant, so it is
	// offered — but only where this build can actually take a write.
	assert.deepEqual(
		kinds(
			mcpFailureActions({
				row: { remedy: { kind: "key" }, keyNames: ["HUBSPOT_TOKEN"] },
				phase: "grant",
				cause: "refused",
				keyEntryAvailable: true,
			}),
		),
		["key", "reload", "settings"],
	);
	assert.deepEqual(
		kinds(
			mcpFailureActions({
				row: { remedy: { kind: "key" }, keyNames: ["HUBSPOT_TOKEN"] },
				phase: "grant",
				cause: "refused",
				keyEntryAvailable: false,
			}),
		),
		["reload", "settings"],
	);
	// The row's sentence form ("manage this server's credentials in Settings") has
	// no control of its own, so the route is what carries the reader there.
	assert.deepEqual(
		kinds(
			mcpFailureActions({
				row: { remedy: { kind: "words", label: "x" }, keyNames: [] },
				phase: "probe",
				cause: "unknown",
				keyEntryAvailable: true,
			}),
		),
		["reload", "settings"],
	);
	// Every action carries a label a reader can act on, and where actions are
	// offered at all the route to the row is last.
	for (const cause of ["refused", "busy", "session", "unknown"]) {
		const actions = mcpFailureActions({
			row: grantRow,
			phase: "reconnect",
			cause,
			keyEntryAvailable: true,
		});
		assert.ok(actions.length > 0, cause);
		for (const action of actions) assert.ok(action.label.trim().length > 0);
		assert.equal(actions.at(-1).kind, "settings", cause);
	}
	assert.deepEqual(
		mcpConfigActions().map((action) => action.kind),
		["reload", "settings"],
	);
});

test("the route lands on the row, and it is the one the settings page reads", () => {
	assert.equal(
		mcpServerSettingsRoute("oauth-synthetic"),
		"/settings?section=integrations&mcp=oauth-synthetic",
	);
	// An argument with a space would arrive as two tokens, so it is encoded — the
	// settings reader resolves the argument against the loaded list
	// (`resolveMcpServerTarget`), which is what makes `reauth hubspot` land.
	assert.equal(
		mcpServerSettingsRoute("reauth hubspot"),
		"/settings?section=integrations&mcp=reauth%20hubspot",
	);
	const settingsPage = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	// Both halves of the route have to be read by the page that receives it.
	assert.match(settingsPage, /params\.get\("mcp"\)/);
	assert.match(settingsPage, /sectionFromQuery/);
	assert.match(settingsPage, /highlightServer=\{mcpTarget\}/);
});

test("no surface prints the caught message as copy", () => {
	/*
	 * The half that keeps this from coming back through a new caller. The defect
	 * was one renderer passing a caught error's own text to the screen; a test over
	 * the files that do it today cannot see the next one, and every MCP surface
	 * here is checked rather than the three the finding named.
	 */
	const surfaces = [
		"src/renderer/src/features/chat/components/run-details/mcp-auth-dialog.tsx",
		"src/renderer/src/features/chat/components/run-details/mcp-key-dialog.tsx",
		"src/renderer/src/features/chat/components/run-details/use-mcp-remedy.ts",
		"src/renderer/src/features/settings/components/mcp-management-section.tsx",
	];
	for (const file of surfaces) {
		const source = readFileSync(file, "utf8");
		assert.ok(
			!/userFacingMessage/.test(source),
			`${file} renders a caught message: MCP failures go through mcpFailure`,
		);
		assert.ok(
			!/cause\.message/.test(source),
			`${file} renders a caught message: MCP failures go through mcpFailure`,
		);
	}

	// And the surfaces that SHOW a failure offer the remedies with it, which is the
	// pairing the finding is about: a sentence without a route is the dead end.
	const dialog = readFileSync(
		"src/renderer/src/features/chat/components/run-details/mcp-auth-dialog.tsx",
		"utf8",
	);
	assert.match(dialog, /mcpFailureActions\(/);
	// The probe's classification takes the grant state from the read this dialog
	// already renders. A hardcoded `false` here made the `busy` cause — the one this
	// surface can name with certainty, because `mcp.list` publishes the operations —
	// unreachable through the dialog, so reopening it during a running sign-in said
	// "the server refused it without giving a reason" (review R3).
	assert.match(
		dialog,
		/mcpFailure\(\s*"probe",\s*cause,\s*mcpGrantInFlight\(status\.data\?\.operations\),/,
	);
	assert.ok(!/mcpFailure\("probe",\s*cause,\s*false\)/.test(dialog));
	assert.match(dialog, /mcpServerSettingsRoute\(row\.name\)/);
	assert.match(dialog, /data-mcp-failure-action=/);
	// The row that refuses in the panel is a control offline too: the sentence stays
	// and the route to the row is beside it.
	const panel = readFileSync(
		"src/renderer/src/features/chat/components/run-details/run-detail-mcp.tsx",
		"utf8",
	);
	assert.match(panel, /MCP_SETTINGS_ACTION_LABEL/);
	assert.match(panel, /mcpServerSettingsRoute\(row\.name\)/);
});
