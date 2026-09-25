import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Settings > Integrations, as the table it is: state -> words, state -> the ONE
 * action, the overflow, grouping, when to poll, which route a control takes,
 * URL/name validation, and the older-backend fallback.
 *
 * Why a table test rather than a render test: every defect the UX walk and the
 * design audit found on this page (U6, D8, D9, N1, N3, N4) was a MAPPING - the
 * wire's word printed as copy, the same four buttons on every row, "1 tools",
 * a URL with two schemes accepted - and a mapping is pinned exactly by
 * asserting its outputs. The stories photograph the same rows; this file is
 * what fails when the mapping moves.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/components/integrations/integration-model";' +
			'export { catalogControlBody, sessionControlBody, catalogCwdFor, newestRosterRow, sessionCwdFromSnapshot, rememberCatalogCwd, rememberedCatalogCwd, CATALOG_CWD_STORAGE_KEY } from "./src/renderer/src/features/settings/components/integrations/use-integrations";' +
			'export { readRowMemoryTable, writeRowMemories, credentialsRefusalMessage } from "./src/renderer/src/features/settings/components/integrations/use-integrations";' +
			'export { signInProgress } from "./src/renderer/src/features/settings/components/integrations/integration-sign-in-dialog";' +
			'export { keylessReference, keyDialogSave, KEYLESS_VALUE_KEY, MAX_REFERENCE_LENGTH } from "./src/renderer/src/features/settings/components/integrations/integration-key-dialog";' +
			'export { forgetCatalogCwd, cwdAfterRefusal, catalogQueryErrorIsInvalidCwd, CATALOG_CWD_STORAGE_KEY as CWD_KEY } from "./src/renderer/src/features/settings/components/integrations/use-integrations";' +
			'export { isSignedOut, isFailedSignOut } from "./src/renderer/src/features/settings/components/integrations/integration-model";' +
			'export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";' +
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
	loader: { ".css": "empty" },
	// React and the component tree are imported for the dialog's helper; they are
	// only evaluated, never rendered, so the jsx transform is all that is needed.
	jsx: "automatic",
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A catalog row in the backend contract's own field names. */
const row = (name, overrides = {}) => ({
	id: name,
	name,
	scope: "global",
	project_cwd: null,
	source: {
		kind: "local-operator",
		path: "/home/u/.local-operator/mcp.json",
		editable: true,
		owned_scope: "global",
	},
	transport: "remote_url",
	endpoint: {
		command: null,
		url: "https://x.example/mcp",
		endpoint_redacted: false,
	},
	status: "not_started",
	status_reason: null,
	status_observed_at: null,
	status_basis: "stored",
	auth: { kind: "none", signed_in: null, secret_refs: [] },
	tool_count: null,
	tool_count_basis: null,
	actions: ["test", "remove"],
	...overrides,
});

const op = (name, overrides = {}) => ({
	id: "a".repeat(32),
	name,
	action: "login",
	status: "running",
	created_at: 1,
	credential_removed: false,
	...overrides,
});

/* ------------------------------------------------------------ copy */

test("tool counts are singular and plural, never '1 tools'", () => {
	assert.equal(m.toolCountLabel(1), "1 tool");
	assert.equal(m.toolCountLabel(0), "0 tools");
	assert.equal(m.toolCountLabel(12), "12 tools");
	assert.equal(m.integrationCountLabel(1), "1 integration");
	assert.equal(m.integrationCountLabel(7), "7 integrations");
});

test("each status reads in plain words, with its tone", () => {
	const cases = [
		[
			row("a", {
				status: "connected",
				tool_count: 12,
				tool_count_basis: "probe",
			}),
			"Connected · 12 tools",
			"success",
		],
		[
			row("a", { status: "connected", tool_count: 1 }),
			"Connected · 1 tool",
			"success",
		],
		[row("a", { status: "connected" }), "Connected", "success"],
		[row("a", { status: "connecting" }), "Connecting…", "info"],
		[
			row("a", {
				status: "needs_sign_in",
				auth: { kind: "oauth", signed_in: false, secret_refs: [] },
			}),
			"Needs sign-in",
			"warning",
		],
		[
			row("a", {
				status: "needs_sign_in",
				auth: {
					kind: "api_key",
					signed_in: false,
					secret_refs: [{ id: "K", state: "missing" }],
				},
			}),
			"Needs a key",
			"warning",
		],
		[
			row("a", { status: "error", status_reason: "boom" }),
			"Couldn't start",
			"danger",
		],
		[row("a", { status: "not_started" }), "Ready", "neutral"],
	];
	for (const [input, label, tone] of cases) {
		const view = m.integrationStatus(input);
		assert.equal(view.label, label);
		assert.equal(view.tone, tone);
	}
});

test("no status label is wire vocabulary", () => {
	const wire =
		/\b(cold|auth-required|stdio|http|transport|not_started|needs_sign_in)\b/;
	for (const status of [
		"connected",
		"connecting",
		"needs_sign_in",
		"error",
		"not_started",
	]) {
		const view = m.integrationStatus(row("a", { status, status_reason: null }));
		assert.doesNotMatch(view.label, wire);
		if (view.detail) assert.doesNotMatch(view.detail, wire);
	}
});

test("an error always carries a reason, and says so when the backend gave none", () => {
	assert.equal(
		m.integrationStatus(
			row("a", { status: "error", status_reason: "npx: command not found" }),
		).detail,
		"npx: command not found",
	);
	assert.equal(
		m.integrationStatus(row("a", { status: "error" })).detail,
		"No reason was given.",
	);
});

test("a running sign-in reads as signing in, not as still needing one", () => {
	const view = m.integrationStatus(
		row("a", {
			status: "needs_sign_in",
			auth: { kind: "oauth", signed_in: false, secret_refs: [] },
		}),
		[op("a")],
	);
	assert.equal(view.label, "Signing in…");
	assert.equal(view.busy, true);
});

test("meta names how it runs, scope only when a project file exists, and the source", () => {
	const local = row("a", { transport: "local_command" });
	assert.deepEqual(m.integrationMeta(local, false), ["Local command"]);
	assert.deepEqual(m.integrationMeta(local, true), ["Local command", "Global"]);
	assert.deepEqual(m.integrationMeta(row("a", { scope: "project" }), true), [
		"Remote URL",
		"This project",
	]);
	const codex = row("a", {
		source: {
			kind: "codex",
			path: "/h/.codex/config.toml",
			editable: false,
			owned_scope: null,
		},
	});
	assert.deepEqual(m.integrationMeta(codex, false), [
		"Remote URL",
		"Imported from Codex CLI",
	]);
	const lastSeen = row("a", { tool_count: 3, tool_count_basis: "last_seen" });
	assert.deepEqual(m.integrationMeta(lastSeen, false), [
		"Remote URL",
		"3 tools when last checked",
	]);
});

/* ---------------------------------------------------------- actions */

test("the ONE primary action is chosen by state from what the backend offers", () => {
	const kind = (overrides, ops) =>
		m.primaryAction(row("a", overrides), ops)?.kind ?? null;
	// Healthy or busy rows lead with nothing.
	assert.equal(
		kind({ status: "connected", actions: ["test", "remove"] }),
		null,
	);
	assert.equal(kind({ status: "connecting" }), null);
	// Needs sign-in: sign in > add key > sign in again > fix.
	assert.equal(
		kind({ status: "needs_sign_in", actions: ["sign_in", "set_key"] }),
		"sign_in",
	);
	assert.equal(
		kind({ status: "needs_sign_in", actions: ["set_key", "test"] }),
		"set_key",
	);
	assert.equal(
		kind({ status: "needs_sign_in", actions: ["reauth"] }),
		"reauth",
	);
	assert.equal(kind({ status: "needs_sign_in", actions: ["remove"] }), "fix");
	// Error: reconnect (live) > retry > fix.
	assert.equal(
		kind({ status: "error", actions: ["connect", "test"] }),
		"connect",
	);
	assert.equal(kind({ status: "error", actions: ["test"] }), "test");
	assert.equal(
		m.primaryAction(row("a", { status: "error", actions: ["test"] })).label,
		"Retry",
	);
	assert.equal(kind({ status: "error", actions: ["remove"] }), "fix");
	// Ready: connect (live) > test.
	assert.equal(kind({ status: "not_started", actions: ["test"] }), "test");
	assert.equal(
		kind({ status: "not_started", actions: ["connect", "test"] }),
		"connect",
	);
	// Nothing to press twice while an operation runs.
	assert.equal(
		kind({ status: "not_started", actions: ["test"] }, [
			op("a", { action: "test" }),
		]),
		null,
	);
});

test("no sign-in is ever offered that the backend did not list", () => {
	// A local command with no references: the walk's dead end (U6).
	const local = row("echo", {
		transport: "local_command",
		actions: ["test", "remove"],
	});
	for (const status of ["not_started", "error", "connected", "needs_sign_in"]) {
		const r = { ...local, status };
		assert.notEqual(m.primaryAction(r)?.kind, "sign_in");
		assert.ok(
			!m
				.overflowItems(r)
				.some((i) => i.kind === "reauth" || i.kind === "sign_out"),
		);
	}
});

test("the overflow holds the rest, never the primary, Remove last and destructive", () => {
	const r = row("n", {
		status: "connected",
		auth: { kind: "oauth", signed_in: true, secret_refs: [] },
		actions: ["test", "reauth", "sign_out", "remove"],
	});
	const kinds = m.overflowItems(r).map((i) => i.kind);
	assert.deepEqual(kinds, [
		"test",
		"reauth",
		"sign_out",
		"open_config",
		"remove",
	]);
	assert.equal(m.overflowItems(r).at(-1).destructive, true);
	// A Ready row leads with Test, so Test is not repeated in its overflow.
	const ready = m
		.overflowItems(row("e", { actions: ["test", "remove"] }))
		.map((i) => i.kind);
	assert.deepEqual(ready, ["open_config", "remove"]);
});

test("a row this app cannot write gets a disabled remove that says where", () => {
	const r = row("g", {
		source: {
			kind: "codex",
			path: "/h/.codex/config.toml",
			editable: false,
			owned_scope: null,
		},
		actions: ["test"],
	});
	const last = m.overflowItems(r).at(-1);
	assert.equal(last.kind, "remove_elsewhere");
	assert.equal(last.label, "Remove in Codex CLI");
	assert.match(last.hint, /Codex CLI's config/);
});

test("a running operation offers Cancel and hides the actions it would race", () => {
	const kinds = m
		.overflowItems(
			row("a", { status: "connecting", actions: ["test", "remove"] }),
			[op("a", { action: "test" })],
		)
		.map((i) => i.kind);
	assert.equal(kinds[0], "cancel");
	assert.ok(!kinds.includes("test"));
});

/* ---------------------------------------------------------- groups */

test("rows group as needs attention, connected, ready, and empty groups vanish", () => {
	const rows = [
		row("ready1"),
		row("conn", { status: "connected" }),
		row("err", { status: "error" }),
		row("auth", { status: "needs_sign_in" }),
		row("busy", { status: "connecting" }),
	];
	const groups = m.groupIntegrations(rows);
	assert.deepEqual(
		groups.map((g) => [g.id, g.title, g.rows.map((r) => r.name)]),
		[
			["attention", "Needs attention", ["err", "auth"]],
			["connected", "Connected", ["conn"]],
			["ready", "Available", ["ready1", "busy"]],
		],
	);
	assert.deepEqual(
		m.groupIntegrations([row("c", { status: "connected" })]).map((g) => g.id),
		["connected"],
	);
	assert.deepEqual(m.groupIntegrations([]), []);
});

/* ---------------------------------------------------------- polling */

test("the list polls every 2 s only while something is moving", () => {
	assert.equal(m.integrationsPollInterval(undefined), false);
	assert.equal(
		m.integrationsPollInterval({ servers: [row("a")], operations: [] }),
		false,
	);
	assert.equal(
		m.integrationsPollInterval({
			servers: [row("a", { status: "connecting" })],
			operations: [],
		}),
		2000,
	);
	assert.equal(
		m.integrationsPollInterval({ servers: [row("a")], operations: [op("a")] }),
		2000,
	);
	// A settled operation does not keep the timer alive.
	assert.equal(
		m.integrationsPollInterval({
			servers: [row("a")],
			operations: [op("a", { status: "complete" })],
		}),
		false,
	);
});

/* ------------------------------------------------------ add form */

test("URL validation refuses the shapes the backend accepted on the walk", () => {
	assert.equal(m.integrationUrlProblem("https://mcp.example.com/mcp"), null);
	assert.equal(m.integrationUrlProblem("http://localhost:8080/mcp"), null);
	assert.match(m.integrationUrlProblem(""), /Enter the server's URL/);
	assert.match(m.integrationUrlProblem("mcp.example.com"), /full URL/);
	assert.match(m.integrationUrlProblem("ftp://x.example"), /https:\/\//);
	assert.match(
		m.integrationUrlProblem("https://u:p@x.example/mcp"),
		/username or password/,
	);
	assert.match(
		m.integrationUrlProblem("https://x.example/mcp?key=1"),
		/\? or #/,
	);
	assert.match(
		m.integrationUrlProblem(
			"https://a.example.com/mcphttps://b.example.com/mcp",
		),
		/two URLs/,
	);
});

test("name validation mirrors the wire pattern and refuses duplicates", () => {
	assert.equal(m.integrationNameProblem("notion", []), null);
	assert.match(m.integrationNameProblem("", []), /Give it a name/);
	assert.match(m.integrationNameProblem("my server", []), /no spaces/);
	assert.match(
		m.integrationNameProblem("notion", ["notion"]),
		/already exists/,
	);
	assert.deepEqual(m.parseIntegrationArgs(" a \n\n b c \n"), ["a", "b c"]);
});

/* -------------------------------------------------------- routes */

test("controls take the catalog route's shape, and live verbs stay off it", () => {
	assert.deepEqual(m.catalogControlBody({ action: "test", name: "a" }), {
		action: "test",
		name: "a",
	});
	assert.deepEqual(m.catalogControlBody({ action: "login", name: "a" }), {
		action: "login",
		name: "a",
		confirmed: true,
	});
	assert.deepEqual(
		m.catalogControlBody({ action: "cancel", operationId: "f".repeat(32) }),
		{
			action: "cancel",
			operation_id: "f".repeat(32),
		},
	);
	for (const action of ["connect", "disconnect", "reload"])
		assert.equal(m.catalogControlBody({ action, name: "a" }), null);
	// The session route has no probe-only verb: test is its awaited reconnect.
	assert.deepEqual(m.sessionControlBody({ action: "test", name: "a" }), {
		action: "connect",
		name: "a",
	});
});

test("every catalog body the section builds passes the request schema, and routes sessionless", () => {
	const bodies = [
		{ action: "test", name: "a" },
		{ action: "login", name: "a" },
		{ action: "remove", name: "a", scope: "global" },
		{ action: "add", name: "a", scope: "global", command: "npx", args: ["x"] },
		{
			action: "add",
			name: "b",
			scope: "project",
			url: "https://x.example/mcp",
		},
		{ action: "cancel", operationId: "0".repeat(32) },
	];
	for (const request of bodies) {
		const control = m.catalogControlBody(request);
		const parsed = m.desktopRequestSchema.safeParse({
			op: "mcp.catalog.control",
			control,
		});
		assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
		const endpoint = m.desktopEndpoint(parsed.data);
		assert.equal(endpoint.path, "/v1/desktop/mcp");
		assert.equal(endpoint.method, "POST");
		assert.ok(
			!endpoint.path.includes("/sessions/"),
			"the catalog never addresses a session",
		);
	}
	// The GET omits what it was not given, and encodes what it was.
	assert.equal(
		m.desktopEndpoint({ op: "mcp.catalog" }).path,
		"/v1/desktop/mcp",
	);
	assert.equal(
		m.desktopEndpoint({
			op: "mcp.catalog",
			cwd: "/Users/a b",
			sessionId: "a1b2c3d4e5f6",
		}).path,
		"/v1/desktop/mcp?cwd=%2FUsers%2Fa+b&session_id=a1b2c3d4e5f6",
	);
	// A relative cwd is refused before it reaches the wire (the backend 422s it).
	assert.equal(
		m.desktopRequestSchema.safeParse({ op: "mcp.catalog", cwd: "~" }).success,
		false,
	);
	// And a live verb is not a catalog action at all.
	assert.equal(
		m.desktopRequestSchema.safeParse({
			op: "mcp.catalog.control",
			control: { action: "reload", name: "a" },
		}).success,
		false,
	);
});

test("only an absolute cwd is lent to the catalog; `~` means the default", () => {
	assert.equal(m.catalogCwdFor("~"), null);
	assert.equal(m.catalogCwdFor(null), null);
	assert.equal(m.catalogCwdFor("/Users/a/proj"), "/Users/a/proj");
	assert.equal(m.catalogCwdFor("C:\\proj"), "C:\\proj");
});

/* ----------------------------------------------------- refusals */

test("a catalog refusal code is worded, never the backend's text", () => {
	const refusal = new m.DesktopControlError(
		409,
		"raw backend text",
		undefined,
		"write_failed",
	);
	const message = m.integrationFailureMessage("add", refusal, false);
	assert.match(
		message,
		/^The server could not be added\. The config file couldn't be written/,
	);
	assert.doesNotMatch(message, /raw backend text/);
	for (const code of [
		"exists",
		"not_owned",
		"project_scope_unavailable",
		"unknown_server",
		"oauth_unsupported",
		"grant_running",
		"too_many_operations",
		"write_failed",
		"invalid_config",
		"mcp_starting",
		"operation_unavailable",
	])
		assert.ok(m.CATALOG_REFUSAL_COPY[code], `no copy for ${code}`);
});

test("a refusal code this build has never seen still gets a true sentence", () => {
	/*
	 * The code set belongs to the BACKEND, so a new one must not break the page
	 * or be silently swallowed: the reader gets the generic refusal, in the
	 * product's voice, and never the backend's own text (which can quote a
	 * credential).
	 */
	for (const code of ["brand_new_code", undefined]) {
		const cause = new m.DesktopControlError(
			409,
			"raw backend text with a token in it",
			undefined,
			code,
		);
		const message = m.integrationFailureMessage("test", cause, false);
		assert.match(message, /^The connection test could not be started\./);
		assert.doesNotMatch(message, /raw backend text/);
		assert.match(
			message,
			new RegExp(
				code === undefined
					? // No code at all is the session route's blanket 409: still generic.
						"refused it"
					: m.CATALOG_REFUSAL_FALLBACK.slice(0, 24),
			),
		);
	}
});

test("a dialog body keeps the room a focused control's ring needs (D12, n3)", () => {
	/*
	 * Round 2's MAJOR: with nothing between the body and the control, the control
	 * spanned the container's content box exactly, and the ring - `outline-width:
	 * 2px` at `outline-offset: 2px` (src/renderer/src/styles/index.css), clipped
	 * by the scroll body it sits in - lost its left and right sides.
	 *
	 * Round 2 fixed it with `p-1.5 -mx-1.5` on the body plus a `px-1.5` wrapper
	 * per control. That drew the ring, and cost two things the design round then
	 * raised: the body was 12 px wider than its scroller, so the scroller showed a
	 * stray horizontal strip (404 px of content inside a 398 px area, n3), and
	 * every label and input sat 6 px inside the prose edge (D20, deferred as the
	 * shared-component change it is).
	 *
	 * THIS ROUND'S SHAPE is the body's own `p-1.5` alone - the body exactly as
	 * wide as the scroller, so there is nothing to scroll horizontally - with
	 * `-mx-1.5` on the PROSE, which is what puts the text back on the title's edge
	 * (D7) without making anything overflow. The control therefore sits 6 px in
	 * from the text edge, which is the room the ring is drawn in. Re-measured on
	 * the rendered stories in both brand palettes: 4 accent pixels on the focused
	 * input's mid row (2 per side), the same number round 2 measured for the fix
	 * that introduced the strip.
	 *
	 * WHAT THIS PINS, AND WHAT IT CANNOT: it reads the source, so it cannot tell
	 * whether the padding lands on the element the control is inside. The frames
	 * and the pixel count are what answer that; this is what fails when the room
	 * is dropped again in a refactor, which is how it was lost the first time.
	 */
	for (const file of [
		"src/renderer/src/features/settings/components/integrations/integration-key-dialog.tsx",
		"src/renderer/src/features/settings/components/integrations/integration-sign-in-dialog.tsx",
	]) {
		const source = readFileSync(file, "utf8");
		/*
		 * The room, and the reason it is the body's own padding: the negative
		 * margin beside it is what made the scroller wider than its viewport.
		 *
		 * The WHOLE class string is asserted, not "some class containing p-1.5":
		 * the label wrappers carry `gap-1.5`, which a loose pattern matches, and
		 * removing the body's padding then survived this pin (measured).
		 */
		assert.match(
			source,
			/className="flex flex-col gap-3 p-1\.5 text-body text-ink-muted"/,
			`${file}: the scroll body carries p-1.5, the room the outline is drawn in`,
		);
		assert.doesNotMatch(
			source,
			/className="[^"]*-mx-1\.5[^"]*p-1\.5[^"]*"/,
			`${file}: the body must not widen itself with -mx-1.5, which overflows the scroller (n3)`,
		);
		/*
		 * The text edge, which the negative margin has to reach: prose on the
		 * title's edge while the body stays the scroller's width.
		 */
		assert.match(
			source,
			/<p className="[^"]*-mx-1\.5/,
			`${file}: the prose carries -mx-1.5 so its text sits on the title's edge (D7)`,
		);
	}
});

/* ------------------------------------------------------ sign-in */

test("a cancelled attempt does not erase the credential state it never changed (U14)", () => {
	/*
	 * Round 2: with `linear` signed out (correct: "Signed out | Sign in"),
	 * starting a sign-in and cancelling it filed the row back under "Ready" with
	 * NO primary action, beside servers that genuinely work - the last thing the
	 * user did had changed nothing about the credential, and the page forgot the
	 * thing that had. A cancelled operation carries no information about the
	 * credential, so the newest DECISIVE one still does.
	 */
	const signedOut = row("linear", {
		status: "not_started",
		status_basis: "stored",
		tool_count: null,
		auth: { kind: "oauth", signed_in: false, secret_refs: [] },
		actions: ["test", "sign_in", "remove"],
	});
	const logout = op("linear", {
		id: "b".repeat(32),
		action: "logout",
		status: "complete",
		created_at: 1,
	});
	const cancelled = op("linear", {
		id: "c".repeat(32),
		action: "login",
		status: "cancelled",
		created_at: 2,
	});

	assert.equal(
		m.latestOperationFor("linear", [logout, cancelled]).id,
		cancelled.id,
		"the cancelled attempt IS the newest operation - which is why it needed its own rule",
	);
	assert.equal(
		m.decisiveOperationFor("linear", [logout, cancelled]).id,
		logout.id,
	);

	const status = m.integrationStatus(
		signedOut,
		[logout, cancelled],
		undefined,
		1_000,
	);
	assert.equal(status.label, "Signed out");
	assert.equal(status.tone, "warning");
	assert.equal(
		m.integrationGroupOf(signedOut, [logout, cancelled]),
		"attention",
	);
	assertLeadsWithSignIn(m.primaryAction(signedOut, [logout, cancelled]));

	/*
	 * And the row this defect was measured on: with the skip removed, the same
	 * two operations leave the newest one a cancelled login - not a sign-out,
	 * not a failure - so the row reads Ready with nothing on it to press.
	 */
	const before = m.integrationStatus(signedOut, [cancelled], undefined, 1_000);
	assert.notEqual(before.label, "Signed out");

	// The memory keeps treating the row as credential-less, too: a failed or
	// cancelled attempt is not a reading, so `connectedAt` must not survive it.
	assert.equal(
		m.memoryFor(
			m.advanceMemories(undefined, {
				servers: [signedOut],
				operations: [logout, cancelled],
			}),
			"linear",
		).connectedAt,
		null,
	);
});

/** The two things U14 asks for: the Sign in is there, and it leads. */
function assertLeadsWithSignIn(primary) {
	assert.equal(primary.kind, "sign_in");
	assert.equal(primary.label, "Sign in");
}

test("a Connect on a never-checked row is an offer, not a demand (D13)", () => {
	/*
	 * Round 2: the session route's Ready rows (`echo`, `gitlab`) carried the same
	 * OUTLINED Connect as the `Sign in` on a row needing attention. A row that
	 * says nothing is wrong, and whose Connect only starts a server, is drawn at
	 * the ghost weight; the live runtime's "Not connected" row keeps the outlined
	 * one, because there the press IS the decision.
	 */
	const cold = row("echo", {
		status: "not_started",
		status_basis: "stored",
		actions: ["connect", "test", "remove"],
	});
	assert.equal(m.primaryAction(cold, [], undefined).variant, "ghost");

	const live = row("notion", {
		status: "not_started",
		status_basis: "live",
		actions: ["test", "connect", "sign_out", "remove"],
	});
	assert.equal(
		m.primaryAction(live, [], undefined).variant,
		undefined,
		"a live `not_started` is Not connected, and that row is asking for the press",
	);

	/*
	 * A row that HAS been checked keeps the outlined weight: it has a result, so
	 * its next step is to answer it. The memory is what says so, and it is
	 * advanced the way the page advances it.
	 */
	const checked = row("echo", {
		status: "connected",
		status_basis: "probe",
		status_observed_at: 1_000,
		tool_count: 3,
		tool_count_basis: "probe",
		actions: ["connect", "test", "remove"],
	});
	const memories = m.advanceMemories(
		undefined,
		{ servers: [checked], operations: [] },
		1_000,
	);
	const idle = { ...checked, status: "not_started", status_basis: "stored" };
	assert.equal(
		m.primaryAction(idle, [], memories).variant,
		undefined,
		"a row with a remembered reading is not demoted to a ghost",
	);
});

test("the sign-in dialog claims a browser opened only when the backend said so", () => {
	assert.match(
		m.signInProgress("linear", null, false).message,
		/Waiting for you to approve/,
	);
	assert.match(
		m.signInProgress("linear", op("linear", { browser_opened: null }), false)
			.message,
		/Waiting for you to approve/,
	);
	assert.match(
		m.signInProgress("linear", op("linear", { browser_opened: true }), false)
			.message,
		/Your browser opened/,
	);
	const noBrowser = m.signInProgress(
		"linear",
		op("linear", {
			browser_opened: false,
			authorization_url: "https://x.example/auth",
		}),
		false,
	);
	assert.match(noBrowser.message, /didn't open/);
	assert.equal(noBrowser.link, "https://x.example/auth");
	for (const operation of [
		null,
		op("linear"),
		op("linear", { browser_opened: false }),
	])
		assert.doesNotMatch(
			m.signInProgress("linear", operation, false).message,
			/browser opened/,
		);
});

test("a failed sign-in separates what happened, the server's words, and what to do", () => {
	/*
	 * Round 1 (D6): one paragraph with the backend's sentence spliced in after a
	 * colon, all of it `danger`, and a next step - Try again - that cannot fix a
	 * rejected redirect. The three parts are separate fields now, and the next
	 * step is chosen from the reason.
	 *
	 * Round 2 (D15) adds the second axis: the sentence may only name a control
	 * the row actually has, so every key-mentioning case is asserted BOTH ways.
	 */
	const redirect = m.signInProgress(
		"linear",
		op("linear", { status: "failed", message: "redirect refused" }),
		true,
	);
	assert.equal(redirect.message, "Sign-in didn't finish.");
	assert.equal(redirect.reason, "redirect refused");
	assert.match(redirect.nextStep, /add a key/);
	assert.doesNotMatch(redirect.message, /redirect/);
	// The same reason on a row with no key route: same diagnosis, and no advice
	// the surface cannot carry out.
	const redirectNoKey = m.signInProgress(
		"linear",
		op("linear", { status: "failed", message: "redirect refused" }),
		false,
	);
	assert.doesNotMatch(redirectNoKey.nextStep, /key/);
	assert.match(redirectNoKey.nextStep, /Check the server's settings/);

	const bare = m.signInProgress(
		"linear",
		op("linear", { status: "failed" }),
		false,
	);
	assert.equal(bare.message, "Sign-in didn't finish.");
	assert.match(bare.reason, /didn't say why/);
	assert.notEqual(bare.message, "Sign-in failed.");

	// The no-OAuth failure points at the key route, which is the one that works -
	// where there is one.
	const noOAuthOperation = op("acme", {
		status: "failed",
		message:
			"No OAuth authorization server was discovered for this server; check its URL and your network, or add its key instead.",
	});
	const noOAuth = m.signInProgress("acme", noOAuthOperation, true);
	assert.match(noOAuth.nextStep, /Add its key/);
	const noOAuthNoKey = m.signInProgress("linear", noOAuthOperation, false);
	assert.doesNotMatch(noOAuthNoKey.nextStep, /key/);
	assert.match(noOAuthNoKey.nextStep, /Check the server's settings/);
	assert.equal(
		m.signInProgress("linear", op("linear", { status: "complete" }), false)
			.tone,
		"success",
	);
});

/* --------------------------------------------------- fallback */

test("an older backend's session document renders through the same rows", () => {
	const doc = m.catalogFromSessionState(
		{
			servers: [
				{
					name: "echo",
					source: "/h/.local-operator/mcp.json",
					owned_scope: "global",
					status: "cold",
					transport: "stdio",
					transport_oauth_supported: false,
				},
				{
					name: "hub",
					source: "/h/.local-operator/mcp.json",
					owned_scope: "global",
					status: "auth-required",
					transport: "http",
				},
				{
					name: "cf",
					source: "/h/.local-operator/mcp.json",
					owned_scope: "global",
					status: "connected",
					transport: "http",
					tool_count: 9,
				},
				{
					name: "gl",
					source: "/h/.codex/config.toml",
					owned_scope: null,
					status: "disconnected",
					transport: "http",
				},
				{
					name: "kb",
					source: "/h/.local-operator/mcp.json",
					owned_scope: "global",
					status: "cold",
					transport: "stdio",
					secret_refs: [{ id: "KB_KEY", bindings: [] }],
				},
			],
			operations: [],
			cold: true,
		},
		"a1b2c3d4e5f6",
	);
	const byName = Object.fromEntries(doc.servers.map((r) => [r.name, r]));
	assert.equal(byName.echo.status, "not_started");
	assert.equal(byName.echo.transport, "local_command");
	assert.ok(
		!byName.echo.actions.includes("sign_in"),
		"no sign-in on a stdio server",
	);
	assert.equal(m.integrationStatus(byName.echo).label, "Ready");
	assert.equal(byName.hub.status, "needs_sign_in");
	assert.equal(m.primaryAction(byName.hub).kind, "sign_in");
	assert.equal(m.integrationStatus(byName.cf).label, "Connected · 9 tools");
	assert.equal(byName.gl.source.kind, "codex");
	assert.equal(byName.gl.source.editable, false);
	assert.equal(m.primaryAction(byName.kb)?.kind, "connect");
	assert.ok(byName.kb.actions.includes("set_key"));
	// A cold document has no live runtime to reload.
	assert.ok(!byName.echo.actions.includes("reload"));
	// No project-owned row: the scope distinction has nothing on its other side.
	assert.equal(doc.project_scope_available, false);
});

test("the fallback borrows the newest roster row", () => {
	assert.equal(
		m.newestRosterRow([
			{ session_id: "old", updated_at: 1 },
			{ session_id: "new", updated_at: 2 },
		]).session_id,
		"new",
	);
	assert.equal(m.newestRosterRow([]), null);
});

test("the section renders from the model and prints no wire word", () => {
	const section = readFileSync(
		"src/renderer/src/features/settings/components/mcp-management-section.tsx",
		"utf8",
	);
	const rowSource = readFileSync(
		"src/renderer/src/features/settings/components/integrations/integration-row.tsx",
		"utf8",
	);
	// The old badge printed the status verbatim; the transport token likewise.
	for (const source of [section, rowSource]) {
		assert.doesNotMatch(source, /\{server\.status \?\? "unknown"\}/);
		assert.doesNotMatch(source, /\{server\.transport\}/);
		assert.doesNotMatch(
			source,
			/border-accent/,
			"deep-link highlight is bg-row-selected (D14)",
		);
	}
	assert.match(rowSource, /bg-row-selected/);
	assert.match(section, /groupIntegrations\(/);
});

/* ------------------------------------------------------------------------
 * Round 1's behaviour fixes, each one pinned to the rule it comes from.
 * ---------------------------------------------------------------------- */

test("an expired check keeps its last RESULT and its group (U1)", () => {
	/*
	 * The row was, then its 300 s probe expired and the backend answered
	 * `not_started`/`stored` with a last-seen count. Reporting that as "Ready"
	 * read as a downgrade to a user who had just seen "Connected" - the same
	 * word the page used for a server that had never been checked at all.
	 */
	const connected = row("notion", {
		status: "connected",
		status_basis: "probe",
		status_observed_at: 1_000,
		tool_count: 1,
		tool_count_basis: "probe",
	});
	const at = 1_000_000;
	const memories = m.advanceMemories(
		undefined,
		{
			servers: [connected],
			operations: [],
		},
		at,
	);
	assert.equal(memories.notion.connectedAt, at, "a probe stamps the time");

	// Five minutes later the same server, as the backend then reports it.
	const expired = {
		...connected,
		status: "not_started",
		status_basis: "stored",
		status_observed_at: null,
		tool_count: 1,
		tool_count_basis: "last_seen",
	};
	const later = m.advanceMemories(
		memories,
		{ servers: [expired], operations: [] },
		at + 6 * 60 * 1000,
	);
	const status = m.integrationStatus(expired, [], later, at + 6 * 60 * 1000);
	assert.equal(status.label, "Worked 6 min ago · 1 tool");
	assert.equal(status.tone, "success");
	assert.equal(
		m.integrationGroupOf(expired, [], later),
		"connected",
		"the row stays where the user last saw it",
	);
	// And it leads with nothing: its Test is in the overflow, no test button.
	assert.equal(m.primaryAction(expired, [], later), null);

	/*
	 * Without the memory - a fresh page load - the row still does not decay to
	 * the idle word (Q1): the backend's own `last_seen` count is a reading it
	 * stands behind, and "Worked earlier · 1 tool" is the whole of what that
	 * payload supports. No time is claimed, because none was sent.
	 */
	const cold = m.integrationStatus(expired, [], undefined, at);
	assert.equal(cold.label, "Worked earlier · 1 tool");
	assert.equal(cold.tone, "success");
	assert.equal(m.integrationGroupOf(expired, [], undefined), "connected");
	/*
	 * And with no evidence at all - no memory, no count - the idle word is the
	 * honest one: nothing here has checked it, so the page says nothing.
	 */
	const bare = { ...expired, tool_count: null, tool_count_basis: null };
	assert.equal(m.integrationStatus(bare, [], undefined, at).label, "Ready");
});

test("a live runtime's idle row is NOT called Ready (F3)", () => {
	/*
	 * A chat has this server configured and is not connected to it. "Ready" with
	 * "Nothing is wrong. It starts when a chat uses it" was a claim the payload
	 * contradicts: the chat IS using it.
	 */
	const live = row("notion", {
		status: "not_started",
		status_basis: "live",
		actions: ["test", "connect", "reload", "remove"],
	});
	const status = m.integrationStatus(live, [], undefined, 1_000);
	assert.equal(status.label, "Not connected");
	assert.notEqual(status.label, "Ready");
	assert.equal(m.primaryAction(live, [], undefined).kind, "connect");
});

test("a sign-out reads as signing out, then as signed out (U2)", () => {
	const oauth = row("linear", {
		status: "not_started",
		status_basis: "stored",
		auth: { kind: "oauth", signed_in: false, secret_refs: [] },
		tool_count: 3,
		tool_count_basis: "last_seen",
		actions: ["test", "sign_in", "remove"],
	});
	const running = [op("linear", { action: "logout", status: "running" })];
	assert.equal(
		m.integrationStatus(oauth, running, undefined, 1_000).label,
		"Signing out…",
	);
	const settled = [op("linear", { action: "logout", status: "complete" })];
	const after = m.integrationStatus(oauth, settled, undefined, 1_000);
	assert.equal(after.label, "Signed out");
	assert.equal(after.tone, "warning");
	assert.equal(m.primaryAction(oauth, settled, undefined).kind, "sign_in");
	assert.equal(m.integrationGroupOf(oauth, settled, undefined), "attention");

	/*
	 * And a sign-out destroys the credential, so the remembered good result is
	 * dropped rather than resurfacing as "Worked 6 min ago" later.
	 */
	const memories = m.advanceMemories(
		m.advanceMemories(
			undefined,
			{
				servers: [{ ...oauth, status: "connected", status_basis: "probe" }],
				operations: [],
			},
			5_000,
		),
		{ servers: [oauth], operations: settled },
		6_000,
	);
	assert.equal(memories.linear.connectedAt, null);
});

test("a re-tested failed row keeps its group while the test runs (F5)", () => {
	/*
	 * The backend rewrites the row to `connecting` the moment an operation
	 * starts, so the group has to be remembered from the last quiet read: the row
	 * used to jump from Needs attention to Ready under the pointer.
	 */
	const failed = row("acme", {
		status: "error",
		status_basis: "probe",
		status_reason: "the server exited with code 1",
	});
	const quiet = m.advanceMemories(
		undefined,
		{ servers: [failed], operations: [] },
		1_000,
	);
	assert.equal(m.integrationGroupOf(failed, [], quiet), "attention");

	const testing = [
		op("acme", { id: "b".repeat(32), action: "test", status: "running" }),
	];
	const running = {
		...failed,
		status: "connecting",
		status_basis: "operation",
	};
	const during = m.advanceMemories(
		quiet,
		{ servers: [running], operations: testing },
		2_000,
	);
	assert.equal(
		m.integrationGroupOf(running, testing, during),
		"attention",
		"still the row needing attention while its Retry runs",
	);
	assert.equal(
		m.integrationStatus(running, testing, during, 2_000).label,
		"Connecting…",
	);

	// Settled: the pin is released and the backend's answer takes over.
	const settled = m.advanceMemories(
		during,
		{ servers: [failed], operations: [] },
		3_000,
	);
	assert.equal(m.integrationGroupOf(failed, [], settled), "attention");
});

test("a running operation is its own basis, not a probe (contract delta)", () => {
	const linear = row("linear", {
		status: "connecting",
		status_basis: "operation",
		status_observed_at: null,
	});
	const ops = [op("linear", { action: "login", status: "running" })];
	assert.equal(
		m.integrationStatus(linear, ops, undefined, 1_000).label,
		"Signing in…",
	);
	// U4: the grant's link stays reachable after the dialog is dismissed.
	assert.equal(
		m.primaryAction(linear, ops, undefined).label,
		"Continue sign-in",
	);
});

test("a server with no OAuth takes a key, under either name (U3)", () => {
	const noAuth = row("acme-api", {
		status: "needs_sign_in",
		auth: { kind: "unknown", signed_in: null, secret_refs: [] },
		actions: ["test", "sign_in", "add_key", "remove"],
	});
	/*
	 * The backend has not settled whether the verb is `set_key` or `add_key`, so
	 * both are the same control here: a row that offers either gets "Add key".
	 */
	assert.equal(m.offersKey(noAuth), true);
	/*
	 * With nothing known yet, Sign in leads: the backend offers it because an
	 * `unknown` kind cannot be ruled in or out until the network answers, and
	 * OAuth is the smoother path when it exists. The KEY route takes over the
	 * moment the sign-in comes back with no authorization server.
	 */
	assert.equal(m.primaryAction(noAuth, [], undefined).kind, "sign_in");
	// A row offering only the key route leads with the key.
	const keyOnly = { ...noAuth, actions: ["test", "add_key", "remove"] };
	assert.equal(m.primaryAction(keyOnly, [], undefined).kind, "set_key");
	assert.equal(m.primaryAction(keyOnly, [], undefined).label, "Add key");
	// The older name for the same verb behaves identically.
	assert.equal(
		m.primaryAction(
			{ ...noAuth, actions: ["test", "set_key", "remove"] },
			[],
			undefined,
		).kind,
		"set_key",
	);

	/*
	 * The discovery comes from the backend's own failure record, which is where
	 * it says no authorization server was found. A row with no key route offered
	 * at all still leads with the key when the failure says so - which is the
	 * case the walk hit, where the backend offered only `sign_in`.
	 */
	const signInOnly = row("acme-api", {
		status: "needs_sign_in",
		auth: { kind: "unknown", signed_in: null, secret_refs: [] },
		actions: ["test", "sign_in", "remove"],
	});
	const failed = [
		op("acme-api", {
			status: "failed",
			message:
				"No OAuth authorization server was discovered for this server; check its URL and your network, or add its key instead.",
		}),
	];
	assert.equal(m.needsKeyFor(noAuth, failed, m.NO_MEMORY), true);
	assert.equal(
		m.integrationStatus(
			{ ...noAuth, status: "not_started" },
			failed,
			undefined,
			1_000,
		).label,
		"Needs a key",
	);
	assert.equal(
		m.primaryAction({ ...noAuth, status: "not_started" }, failed, undefined)
			.label,
		"Add key",
	);
	// A row with no key route at all is not promised one it cannot have - and
	// that gate is exactly U11's open finding: the actions list is the BACKEND's
	// knowledge, which only exists after a Test has failed. Deferred, not
	// disputed; the deferral note on PR #491 carries the reconciliation.
	assert.equal(m.needsKeyFor(signInOnly, failed, m.NO_MEMORY), false);
});

test("only a never-checked row leads with a Test, and it is drawn ghost (D1)", () => {
	const fresh = row("echo", {
		status: "not_started",
		actions: ["test", "remove"],
	});
	const first = m.primaryAction(fresh, [], undefined);
	assert.equal(first.kind, "test");
	assert.equal(
		first.variant,
		"ghost",
		"outlined weight belongs to the rows that need something",
	);

	const checked = row("filesystem", {
		status: "not_started",
		tool_count: 5,
		tool_count_basis: "last_seen",
		actions: ["test", "remove"],
	});
	/*
	 * A row that HAS been checked leads with nothing: its Test is in the
	 * overflow, exactly where a connected row's is.
	 */
	assert.equal(m.primaryAction(checked, [], undefined), null);
	assert.equal(
		m.overflowItems(checked, [], undefined)[0].kind,
		"test",
		"the action is still reachable, one level in",
	);
});

test("a backend reason is shown without the transport prefix or a chat command (U7, Q4)", () => {
	assert.equal(
		m.publicRowReason("Connection closed: Error: NOTION_TOKEN is not set"),
		"NOTION_TOKEN is not set",
	);
	assert.equal(
		m.publicRowReason("Connection closed: Error: Connection closed: boom"),
		"boom",
	);
	// A terminal slash command is not a reason for a Settings reader: it is
	// dropped rather than reworded, because the row's own button says what to do.
	assert.equal(m.publicRowReason("/mcp login linear to authorize"), null);
	assert.equal(m.publicRowReason(null), null);

	const rowWithCommand = row("linear", {
		status: "needs_sign_in",
		status_reason: "/mcp login linear to authorize",
		actions: ["test", "sign_in", "remove"],
	});
	assert.equal(
		m.integrationStatus(rowWithCommand, [], undefined, 1_000).detail,
		null,
	);
});

test("the active chat's folder survives a reload (Q1)", () => {
	/*
	 * The roster row carries no `cwd`, so the page asked for the HOME catalog and
	 * every project-scoped server vanished once the app reloaded. The snapshot
	 * does carry it, and this is the path that was measured against the backend.
	 */
	const snapshot = {
		session_id: "s",
		payload: {
			frontend: { snapshot: { cwd: "/Users/you/projects/acme" } },
			history: {},
			cold: true,
		},
	};
	assert.equal(m.sessionCwdFromSnapshot(snapshot), "/Users/you/projects/acme");
	// Every missing layer answers "unknown folder" rather than throwing inside a
	// render: this walks a document that is not part of the typed contract.
	for (const broken of [
		undefined,
		null,
		{},
		{ payload: null },
		{ payload: {} },
		{ payload: { frontend: {} } },
		{ payload: { frontend: { snapshot: {} } } },
		{ payload: { frontend: { snapshot: { cwd: 7 } } } },
		{ payload: { frontend: { snapshot: { cwd: "  " } } } },
	])
		assert.equal(m.sessionCwdFromSnapshot(broken), null);

	// And the resolution is remembered, so the next reload paints the right
	// catalog on its first frame instead of the home one.
	const store = new Map();
	const storage = {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => store.set(key, value),
	};
	assert.equal(m.rememberedCatalogCwd("s", storage), null);
	m.rememberCatalogCwd("s", "/Users/you/projects/acme", storage);
	assert.equal(
		m.rememberedCatalogCwd("s", storage),
		"/Users/you/projects/acme",
	);
	assert.equal(m.rememberedCatalogCwd("other", storage), null);
	// A conversation's folder is a path the page lends, never a guess.
	assert.equal(
		m.catalogCwdFor(m.rememberedCatalogCwd("s", storage)),
		"/Users/you/projects/acme",
	);
	m.rememberCatalogCwd("s", "~", storage);
	assert.equal(
		m.rememberedCatalogCwd("s", storage),
		"/Users/you/projects/acme",
	);
	// A store that throws must not fail a render.
	m.rememberCatalogCwd("s", "/tmp", {
		getItem: () => {
			throw new Error("nope");
		},
		setItem: () => undefined,
	});
	assert.equal(
		m.rememberedCatalogCwd("s", {
			getItem: () => "{not json",
			setItem: () => undefined,
		}),
		null,
	);
});

test("a prototype key is not a refusal sentence (F6)", () => {
	/*
	 * `code in CATALOG_REFUSAL_COPY` walks the prototype, so a backend code of
	 * "toString" would have put a FUNCTION where the dialog writes a sentence.
	 */
	for (const code of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
		const message = m.integrationFailureMessage(
			"status",
			new m.DesktopControlError({
				status: 409,
				message: "refused",
				code,
			}),
			false,
		);
		assert.equal(typeof message, "string");
		assert.doesNotMatch(message, /function|native code/);
	}
});

test("add_key is the key route, under the backend's own shape (U3, #1511 aa927158a)", () => {
	/*
	 * The backend's decision, pinned: for a remote server it owns that declares
	 * no `${ID}` and needs a key, the row is `needs_sign_in` with `auth.kind`
	 * api_key and `add_key` REPLACING `sign_in` - never beside it, because a
	 * server with nothing to fill has no use for a browser grant.
	 */
	const acme = row("acme-api", {
		status: "needs_sign_in",
		status_basis: "stored",
		auth: { kind: "api_key", signed_in: false, secret_refs: [] },
		actions: ["test", "add_key", "remove"],
	});
	assert.equal(m.offersKey(acme), true);
	const primary = m.primaryAction(acme, [], undefined);
	assert.equal(primary.kind, "set_key");
	assert.equal(primary.label, "Add key");
	assert.equal(
		m.integrationStatus(acme, [], undefined, 1_000).label,
		"Needs a key",
	);
	// And nothing on the row offers a sign-in.
	assert.equal(
		m
			.overflowItems(acme, [], undefined)
			.some((item) => item.kind === "sign_in"),
		false,
	);

	/*
	 * A server whose config DOES declare references keeps the backend's other
	 * verb, and the same page control.
	 */
	const postgres = row("postgres-prod", {
		status: "needs_sign_in",
		auth: {
			kind: "api_key",
			signed_in: false,
			secret_refs: [{ id: "PGPASSWORD", state: "missing" }],
		},
		actions: ["test", "set_key", "remove"],
	});
	assert.equal(m.offersKey(postgres), true);
	assert.equal(m.primaryAction(postgres, [], undefined).label, "Add key");
});

test("a keyless write derives a PER-SERVER reference (U15)", () => {
	/*
	 * `POST /v1/desktop/mcp/credentials` with `header` needs exactly one id in
	 * `values`, and the id reaches the config as `${ID}`, which the backend then
	 * resolves from the encrypted store. The id is therefore the store's name for
	 * the secret, and deriving it from the HEADER alone made two unrelated
	 * services that both want `X-Api-Key` share one secret: the second write came
	 * back `replace_confirmation_required`, the dialog had no control to answer
	 * it, and answering it by overwriting would have broken the integration that
	 * worked (U15).
	 *
	 * THE BACKEND'S OWN PATTERN is `SECRET_ID_RE` in `mcp/config.py`:
	 * `^[A-Za-z_][A-Za-z0-9_]{0,127}$` - so 128 characters is the hard cap, and
	 * the derivation has to stay inside it whatever the user typed.
	 */
	const backendReference = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
	assert.equal(
		m.keylessReference("acme-new", "X-Api-Key"),
		"ACME_NEW_X_API_KEY",
		"the integration's name leads, so two services cannot collide",
	);
	assert.equal(
		m.keylessReference("acme-new", "Authorization"),
		"ACME_NEW_AUTHORIZATION",
	);
	/*
	 * The defect itself, stated as a test: the same header on two servers must
	 * NOT produce one id.
	 */
	assert.notEqual(
		m.keylessReference("acme-key", "X-Api-Key"),
		m.keylessReference("acme-new", "X-Api-Key"),
	);
	assert.equal(
		m.keylessReference("acme-new", "x-api-key"),
		"ACME_NEW_X_API_KEY",
	);
	assert.equal(
		m.keylessReference("acme-new", "  X Api Key  "),
		"ACME_NEW_X_API_KEY",
	);
	assert.equal(
		m.keylessReference("7-token", "Authorization"),
		"K_7_TOKEN_AUTHORIZATION",
	);
	// Nothing to name yet: the field is empty, so the Save button stays disabled.
	assert.equal(m.keylessReference("", ""), "");
	assert.equal(m.keylessReference("acme-new", "  "), "");
	/*
	 * A name that normalises to something the reference alphabet cannot START
	 * with gets a prefix, and one that normalises cleanly (leading separators
	 * stripped) needs none.
	 */
	assert.equal(
		m.keylessReference("-bad-", "Authorization"),
		"BAD_AUTHORIZATION",
	);
	assert.equal(
		m.keylessReference("7-token", "x-api-key"),
		"K_7_TOKEN_X_API_KEY",
	);
	for (const [name, header] of [
		["acme-new", "Authorization"],
		["acme-new", "x-api-key"],
		["7-token", "a"],
		["a", "A.B/C"],
		["a".repeat(100), "x".repeat(80)],
	]) {
		const reference = m.keylessReference(name, header);
		assert.match(
			reference,
			backendReference,
			`${name}/${header} must derive a reference the backend accepts`,
		);
		assert.ok(
			reference.length <= m.MAX_REFERENCE_LENGTH,
			`${name}/${header} stayed inside the cap`,
		);
	}
	/*
	 * A name long enough to be truncated keeps a digest of the FULL name, so two
	 * long names sharing a prefix cannot collide into one secret - the defect
	 * this naming exists to fix, one indirection further out.
	 */
	const long = m.keylessReference(`${"s".repeat(120)}one`, "X-Api-Key");
	const longer = m.keylessReference(`${"s".repeat(120)}two`, "X-Api-Key");
	assert.notEqual(
		long,
		longer,
		"a truncated reference still tells the servers apart",
	);
	assert.equal(
		long,
		m.keylessReference(`${"s".repeat(120)}one`, "X-Api-Key"),
		"and it is stable across calls, so a re-save finds the same secret",
	);
});

test("a keyless credential write carries the header to the right endpoint", () => {
	const request = {
		op: "mcp.catalog.credentials",
		cwd: "/home/u/project",
		name: "acme-api",
		values: { AUTHORIZATION: "shh" },
		confirmedReplace: [],
		header: "Authorization",
	};
	assert.equal(
		m.desktopRequestSchema.safeParse(request).success,
		true,
		"the schema refuses nothing the page sends",
	);
	const endpoint = m.desktopEndpoint(request);
	assert.equal(endpoint.path, "/v1/desktop/mcp/credentials");
	assert.equal(endpoint.body.header, "Authorization");
	// Without it the request is the set_key write it always was.
	const plain = m.desktopEndpoint({ ...request, header: undefined });
	assert.equal("header" in plain.body, false);
});

test("the key dialog hands onSave the HEADER, not just the values (R2-1)", () => {
	/*
	 * Round 2's blocker. The dialog's Save used to call
	 * `onSave(values, replace && canReplace ? names : [])` while the header
	 * parameter had been added downstream, so a keyless write went to the
	 * backend as a plain `set_key`, was refused with `invalid_target`, and the
	 * page blamed the encrypted store. Nothing caught it: the test called
	 * `desktopEndpoint` directly and could not see the call site at all.
	 *
	 * These are the ACTUAL arguments the button hands over, through the same
	 * function the button calls.
	 */
	const keyless = m.keyDialogSave({
		name: "acme-new",
		keyless: true,
		freeName: "X-Api-Key",
		names: ["ACME_NEW_X_API_KEY"],
		values: { [m.KEYLESS_VALUE_KEY]: "  s3cret  " },
		replace: false,
		canReplace: false,
	});
	assert.equal(
		keyless.header,
		"X-Api-Key",
		"the header travels with the write",
	);
	assert.deepEqual(
		Object.keys(keyless.values),
		["ACME_NEW_X_API_KEY"],
		"exactly one id, and it is this server's own (U15)",
	);
	assert.equal(
		keyless.values.ACME_NEW_X_API_KEY,
		"s3cret",
		"trimmed, and the value is the secret",
	);
	assert.deepEqual(keyless.confirmedReplace, []);

	// The referenceful mode is the `set_key` write it always was: no header.
	const referenced = m.keyDialogSave({
		name: "acme-api",
		keyless: false,
		freeName: "",
		names: ["PGPASSWORD", "PGUSER"],
		values: { PGPASSWORD: "p", PGUSER: "u" },
		replace: true,
		canReplace: true,
	});
	assert.equal(
		referenced.header,
		undefined,
		"no header where the config names the key",
	);
	assert.deepEqual(referenced.confirmedReplace, ["PGPASSWORD", "PGUSER"]);
	assert.deepEqual(referenced.values, { PGPASSWORD: "p", PGUSER: "u" });

	/*
	 * And the button has no second path: the SHIPPED module hands the payload's
	 * three fields to `onSave` and never reconstructs them. Reverting the call
	 * site to the two-argument form - the defect - fails here.
	 */
	const source = readFileSync(
		"src/renderer/src/features/settings/components/integrations/integration-key-dialog.tsx",
		"utf8",
	);
	assert.match(
		source,
		/onSave\(payload\.values, payload\.confirmedReplace, payload\.header\)/,
		"the Save button passes the tested payload through, header included",
	);
	// The other hop, which the round-1 comment claimed without evidence.
	const section = readFileSync(
		"src/renderer/src/features/settings/components/mcp-management-section.tsx",
		"utf8",
	);
	assert.match(
		section,
		/storeKeys\(dialog\.name, values, confirmedReplace, header\)/,
		"the section forwards the header into the credentials write",
	);
});

test("only a COMPLETE sign-out is a sign-out, and a failed one says so (R2-2)", () => {
	/*
	 * Round 2: a failed or cancelled sign-out read "Signed out" with no Sign in,
	 * while the credential was still stored - the page telling the user their
	 * account was gone and hiding the button they needed.
	 */
	const complete = op("notion", { action: "logout", status: "complete" });
	const failed = op("notion", { action: "logout", status: "failed" });
	const cancelled = op("notion", { action: "logout", status: "cancelled" });
	assert.equal(m.isSignedOut(complete), true);
	assert.equal(
		m.isSignedOut(failed),
		false,
		"a failed sign-out kept the credential",
	);
	assert.equal(m.isSignedOut(cancelled), false);
	assert.equal(m.isFailedSignOut(failed), true);
	assert.equal(
		m.isFailedSignOut(complete),
		false,
		"a completed one is not a failure",
	);
	assert.equal(m.isFailedSignOut(op("notion", { status: "running" })), false);

	const base = row("notion", { status: "not_started", status_basis: "stored" });
	assert.equal(
		m.integrationStatus(base, [complete], undefined, 1_000).label,
		"Signed out",
	);
	const after = m.integrationStatus(base, [failed], undefined, 1_000);
	assert.equal(after.label, "Sign-out didn't finish");
	assert.equal(after.tone, "warning");
});

test("the expired-check memory is for a STORED basis, never a live one (R2-3)", () => {
	/*
	 * Round 2: after a live Disconnect the row read "Worked 3 min ago - 12 tools"
	 * under Connected in a success tone, because the memory branch ran before the
	 * live `not_started` branch. A live runtime saying `not_started` is the
	 * opposite claim, and the payload is entitled to be believed.
	 */
	const connected = row("notion", {
		status: "connected",
		status_basis: "probe",
		status_observed_at: 1_000,
		tool_count: 12,
		tool_count_basis: "probe",
	});
	const at = 1_000_000;
	const memories = m.advanceMemories(
		undefined,
		{ servers: [connected], operations: [] },
		at,
	);

	// The stored basis, which is what the memory exists for: the reading holds.
	const stored = {
		...connected,
		status: "not_started",
		status_basis: "stored",
		status_observed_at: null,
		tool_count: 12,
		tool_count_basis: "last_seen",
	};
	const kept = m.integrationStatus(stored, [], memories, at + 60_000);
	assert.match(kept.label, /^Worked /, "a stored basis keeps its last result");

	// The LIVE basis, which is a chat telling us it is not connected right now.
	const live = {
		...connected,
		status: "not_started",
		status_basis: "live",
		status_observed_at: null,
	};
	const now = m.integrationStatus(live, [], memories, at + 60_000);
	assert.equal(now.label, "Not connected");
	assert.notEqual(
		now.tone,
		"success",
		"no success tone for a row the chat says is off",
	);
	assert.equal(m.integrationGroupOf(connected, [], memories), "connected");
	assert.notEqual(
		m.integrationGroupOf(live, [], memories),
		"connected",
		"a disconnected live row is not in Connected",
	);
});

test("the key route leads on the page's evidence, while a silent row still gets Sign in (R2-6; U11 deferred)", () => {
	/*
	 * R2-6: deleting the "Add key leads over Sign in" branch left every test
	 * green, which is how a fix regresses silently. A row that offers both must
	 * lead with the key - a browser grant cannot fill a key.
	 */
	const both = row("acme-api", {
		status: "needs_sign_in",
		status_basis: "stored",
		auth: { kind: "api_key", signed_in: false, secret_refs: [] },
		actions: ["test", "sign_in", "add_key", "remove"],
	});
	/*
	 * Reaching this branch takes the page's OWN evidence, because the backend
	 * listed a sign-in too: the sign-in it offered is the path that just failed
	 * for want of an authorization server, and the memory of that failure is
	 * what has to outrank it.
	 */
	const memories = m.advanceMemories(
		undefined,
		{
			servers: [both],
			operations: [
				op("acme-api", {
					status: "failed",
					message:
						"No OAuth authorization server was discovered for this server; check its URL and your network, or add its key instead.",
				}),
			],
		},
		1_000,
	);
	assert.equal(m.needsKeyFor(both, [], memories["acme-api"]), true);
	assert.equal(m.primaryAction(both, [], memories).label, "Add key");
	assert.equal(m.primaryAction(both, [], memories).kind, "set_key");

	/*
	 * U11's case, pinned as it stands rather than as it should be: an untested
	 * key-only server whose actions list carries no key verb still gets Sign in,
	 * because `needsKeyFor` reads the backend's list. This assertion is the
	 * deferral made visible - the day U11 is implemented, it must be updated in
	 * the same commit, which is the point of writing it down here.
	 */
	const silent = row("acme-api", {
		status: "needs_sign_in",
		status_basis: "stored",
		auth: { kind: "api_key", signed_in: false, secret_refs: [] },
		actions: ["test", "sign_in", "remove"],
	});
	assert.equal(m.needsKeyFor(silent, [], m.NO_MEMORY), false, "today's gate");
	assert.equal(m.primaryAction(silent, [], undefined).label, "Sign in");
	// And a row with no key evidence at all still gets its Sign in too.
	const oauth = row("linear", {
		status: "needs_sign_in",
		status_basis: "stored",
		auth: { kind: "oauth", signed_in: false, secret_refs: [] },
		actions: ["test", "sign_in", "remove"],
	});
	assert.equal(m.primaryAction(oauth, [], undefined).label, "Sign in");
});

test("the expired-check reading survives a reload (U10, Q1)", () => {
	/*
	 * WHAT THE BACKEND ACTUALLY SENDS. The first version of this test fed the
	 * model a `stored` row carrying `status_observed_at`, and the whole fix rested
	 * on that field arriving - but `catalog.py` sets it on the `live` and `probe`
	 * bases alone, so a stored row always carries null and the fallback could
	 * never fire against a real backend. The row below is the payload the UX and
	 * QA walks captured: stored, `not_started`, null timestamp, a last-seen count.
	 *
	 * The reading therefore has to come from what the PAGE keeps, and the shape
	 * that survives a reload is the store `use-integrations` writes:
	 * `memoriesTable` -> the store -> `seedMemories` on the next mount. Both
	 * halves are exercised here, so the round-trip is pinned rather than the
	 * functions separately.
	 */
	const store = new Map();
	const storage = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => void store.set(key, value),
	};
	const expired = row("notion", {
		status: "not_started",
		status_basis: "stored",
		status_observed_at: null,
		tool_count: 12,
		tool_count_basis: "last_seen",
	});
	const document = { servers: [expired], operations: [] };

	// Page one: the probe answered, the page watched it, and it wrote that down.
	const at = Date.now() - 6 * 60 * 1000;
	const seen = m.advanceMemories(
		undefined,
		{
			servers: [
				row("notion", {
					status: "connected",
					status_basis: "probe",
					tool_count: 12,
				}),
			],
			operations: [],
		},
		at,
	);
	m.writeRowMemories(m.memoriesTable(seen, document), storage);
	assert.ok(store.size > 0, "the reading was written to the store");

	// Page two: a fresh mount, no refs, only what the store holds.
	const reloaded = m.seedMemories({}, document, m.readRowMemoryTable(storage));
	const status = m.integrationStatus(expired, [], reloaded);
	assert.equal(status.label, "Worked 6 min ago · 12 tools");
	assert.equal(status.tone, "success");
	assert.equal(
		m.integrationGroupOf(expired, [], reloaded),
		"connected",
		"and it is still where the user last saw it",
	);
	// Its Test belongs in the overflow, exactly as on a connected row.
	assert.equal(m.primaryAction(expired, [], reloaded), null);

	/*
	 * NO MEMORY AT ALL - a first run, or a store that was cleared - still does not
	 * decay to "Ready": the row's own `last_seen` count is evidence the backend
	 * stands behind, and the page says exactly that much and no more.
	 */
	const cold = m.integrationStatus(expired, [], undefined);
	assert.equal(cold.label, "Worked earlier · 12 tools");
	assert.equal(m.integrationGroupOf(expired, [], undefined), "connected");
	// And with no count either, the idle word is the honest one.
	assert.equal(
		m.integrationStatus(
			{ ...expired, tool_count: null, tool_count_basis: null },
			[],
			undefined,
		).label,
		"Ready",
	);

	/*
	 * THE SECONDS TRAP, as the review measured it. `status_observed_at` is epoch
	 * SECONDS while every clock in this page is milliseconds, and reading it as
	 * milliseconds rendered a real six-minute-old check as "Worked 20700 d ago".
	 * The field is not read at all now, so the row falls back to the count.
	 */
	const seconds = {
		...expired,
		status_observed_at: Math.floor((Date.now() - 6 * 60 * 1000) / 1000),
	};
	const secondsReading = m.integrationStatus(seconds, [], undefined);
	assert.equal(secondsReading.label, "Worked earlier · 12 tools");
	assert.doesNotMatch(secondsReading.label, /20700 d/);
	assert.doesNotMatch(secondsReading.label, / d ago/);

	/*
	 * And an entry the page did not write is not trusted: a millisecond stamp is
	 * required, so a seconds-valued one is refused rather than converted into a
	 * claim about when the row last worked.
	 */
	assert.equal(m.parseRowMemory({ connectedAt: 1_700_000_000 }), null);
	assert.ok(m.parseRowMemory({ connectedAt: Date.now() }));
});

test("a refused folder is dropped, forgotten, and recognised by code (R2-4)", () => {
	/*
	 * `invalid_cwd` used to dead-end the page: an error screen, no rows, and a
	 * Retry that repeated the refusal. The folder is now dropped so the query
	 * re-keys to the global catalog, and it is forgotten so the next reload does
	 * not resolve back to it.
	 */
	assert.equal(
		m.cwdAfterRefusal("/home/u/gone", "/home/u/gone"),
		null,
		"the refused folder is not asked for again",
	);
	assert.equal(
		m.cwdAfterRefusal("/home/u/here", "/home/u/gone"),
		"/home/u/here",
	);
	assert.equal(m.cwdAfterRefusal(null, "/home/u/gone"), null);
	assert.equal(m.cwdAfterRefusal("/home/u/here", null), "/home/u/here");

	// Recognised from the CODE, never from a message the backend may reword.
	assert.equal(m.catalogQueryErrorIsInvalidCwd({ code: "invalid_cwd" }), true);
	assert.equal(
		m.catalogQueryErrorIsInvalidCwd(new Error("invalid_cwd")),
		false,
	);
	assert.equal(m.catalogQueryErrorIsInvalidCwd(null), false);

	// And the store is actually cleaned, not just ignored.
	const table = {
		[m.CWD_KEY]: JSON.stringify({ s1: "/home/u/gone", s2: "/home/u/here" }),
	};
	const storage = {
		getItem: (key) => table[key] ?? null,
		setItem: (key, value) => {
			table[key] = value;
		},
	};
	m.forgetCatalogCwd("s1", storage);
	const left = JSON.parse(table[m.CWD_KEY]);
	assert.equal("s1" in left, false, "the refused folder is forgotten");
	assert.equal(
		left.s2,
		"/home/u/here",
		"and only that conversation's entry goes",
	);

	// A store that throws is not a failed render, here either.
	m.forgetCatalogCwd("s2", {
		getItem: () => {
			throw new Error("no store");
		},
		setItem: () => {},
	});
});

test("a refusal from the live route refreshes the list before it is reported (R2-5)", () => {
	/*
	 * The row's own sentence says the list was refreshed, and that refresh used
	 * to happen only on the success path: a refused connect or disconnect left
	 * the page on a document the backend had just contradicted. Deleting the
	 * invalidation from the catch left every test green, so this reads the
	 * shipped source for the catch itself.
	 */
	const source = readFileSync(
		"src/renderer/src/features/settings/components/integrations/use-integrations.ts",
		"utf8",
	);
	const live = source.slice(
		source.indexOf("const liveControl = useCallback("),
		source.indexOf("const storeKeys = useCallback("),
	);
	assert.match(live, /catch \(cause\)/, "the live route catches its refusals");
	assert.match(
		live,
		/catch \(cause\)[\s\S]*?invalidateQueries\(\{ queryKey: catalogKey \}\)[\s\S]*?throw cause;/,
		"and refreshes BEFORE it rethrows, so the sentence is true when printed",
	);
	/*
	 * And the OTHER route's catch, which is the one the reviewer's mutation
	 * (M1) survived on: the catalog `control()` re-reads on a 409 before it
	 * rethrows. It is a source assertion for the same reason as the one above -
	 * this suite bundles the module's pure exports, not the hook, so a
	 * QueryClient spy is not available here and the source is what pins the
	 * ORDER that makes the row's sentence true.
	 */
	/*
	 * ENDS AT `liveControl`, which is declared between these two and contains its
	 * own invalidate-and-rethrow pair. Ending at `storeKeys` - as this slice did
	 * - swallowed that function, so the lazy pattern below matched liveControl's
	 * pair instead, and deleting `control()`'s own 409 invalidate left the suite
	 * green (m-1, reproduced by the reviewer).
	 */
	const catalog = source.slice(
		source.indexOf("const control = useCallback("),
		source.indexOf("const liveControl = useCallback("),
	);
	assert.match(
		catalog,
		/cause instanceof DesktopControlError && cause\.status === 409[\s\S]*?invalidateQueries\(\{ queryKey: catalogKey \}\)[\s\S]*?throw cause;/,
		"the catalog route refreshes on a 409 before it rethrows too",
	);
});

test("the key route is offered only where the backend lists it (round-3 eligibility)", () => {
	/*
	 * Backend #1511's round-3 rule, relayed with the fixture re-pin: a LITERAL
	 * header server is not eligible for `add_key`, and the backend does not list
	 * it. The page's affordances follow the list, so a server that carries its
	 * header verbatim gets no key button - and, from the same fixture, the two
	 * servers that ARE offered a key verb get exactly one.
	 */
	const literal = row("literal-header", {
		status: "needs_sign_in",
		status_basis: "stored",
		auth: { kind: "api_key", signed_in: false, secret_refs: [] },
		actions: ["test", "sign_in", "remove"],
	});
	assert.equal(
		m.offersKey(literal),
		false,
		"no key verb means no key affordance",
	);
	assert.equal(m.primaryAction(literal, [], undefined).kind, "sign_in");
	assert.equal(
		m
			.overflowItems(literal, [], undefined)
			.some((item) => item.kind === "set_key"),
		false,
		"and not hidden in the overflow either",
	);

	// The two the fixture does offer one, under either name.
	for (const name of ["acme-api", "postgres-prod"]) {
		assert.equal(
			m.offersKey(
				row(name, {
					auth: { kind: "api_key", signed_in: false, secret_refs: [] },
					actions: [
						"test",
						name === "acme-api" ? "add_key" : "set_key",
						"remove",
					],
				}),
			),
			true,
			name,
		);
	}
});

/* ------------------------------------ round 3 (Q2, m-2..m-4, U14-U19, n-1..n4) */

test("cancelling a FIRST sign-in leaves the row needing one (U14 residual)", () => {
	/*
	 * The backend's own verdict ("needs_sign_in") ages out of the payload with its
	 * probe TTL, and a cancelled attempt is a NO-OP - so what is left is a bare
	 * `not_started`, and the row was filed under Available with no primary action
	 * on the strength of the attempt the user abandoned.
	 */
	const needs = row("linear-two", {
		status: "needs_sign_in",
		status_basis: "probe",
		auth: { kind: "oauth", signed_in: false, secret_refs: [] },
		actions: ["test", "sign_in", "remove"],
	});
	const memories = m.advanceMemories(
		undefined,
		{ servers: [needs], operations: [] },
		1_000,
	);
	assert.equal(
		memories["linear-two"].needsSignIn,
		true,
		"the read that asks for a sign-in is remembered",
	);

	// The attempt the user started, then cancelled.
	const cancelled = op("linear-two", {
		id: "b".repeat(32),
		status: "cancelled",
		created_at: 2,
	});
	const after = {
		...needs,
		status: "not_started",
		status_basis: "stored",
		status_reason: null,
	};
	const later = m.advanceMemories(
		memories,
		{ servers: [after], operations: [cancelled] },
		2_000,
	);
	const status = m.integrationStatus(after, [cancelled], later);
	assert.equal(status.label, "Needs sign-in");
	assert.equal(status.tone, "warning");
	assert.equal(m.integrationGroupOf(after, [cancelled], later), "attention");
	const primary = m.primaryAction(after, [cancelled], later);
	assert.equal(primary.kind, "sign_in");
	assert.equal(primary.label, "Sign in");

	// The signed-out path keeps its own, more specific wording (round 2's fix).
	const completed = op("linear-two", {
		id: "c".repeat(32),
		action: "logout",
		status: "complete",
		created_at: 3,
	});
	const signedOut = m.advanceMemories(
		later,
		{ servers: [after], operations: [completed] },
		3_000,
	);
	const signedOutStatus = m.integrationStatus(after, [completed], signedOut);
	assert.equal(signedOutStatus.label, "Signed out");
	assert.equal(signedOut["linear-two"].needsSignIn, false);
	assert.equal(m.primaryAction(after, [completed], signedOut).label, "Sign in");

	// A completed sign-in clears it: the row is connected, so nothing is asked for.
	const connected = {
		...after,
		status: "connected",
		status_basis: "probe",
		tool_count: 3,
		tool_count_basis: "probe",
	};
	const settled = m.advanceMemories(
		later,
		{ servers: [connected], operations: [] },
		4_000,
	);
	assert.equal(settled["linear-two"].needsSignIn, false);
	assert.equal(
		m.integrationStatus(connected, [], settled).label,
		"Connected · 3 tools",
	);
});

test("a failed sign-out files under Needs attention and leads with the retry (m-2, Q3, U16)", () => {
	const signedIn = row("linear", {
		status: "connected",
		status_basis: "probe",
		tool_count: 3,
		auth: {
			kind: "oauth",
			signed_in: true,
			secret_refs: [{ id: "LINEAR_TOKEN", state: "encrypted" }],
		},
		actions: ["test", "reauth", "sign_out", "remove"],
	});
	const failedLogout = op("linear", {
		action: "logout",
		status: "failed",
		message:
			"MCP logout failed for 'linear': could not delete the stored credential for http://127.0.0.1:8296/mcp (attempt to write a readonly database) - it is still in place, so a fresh grant would silently reuse it",
	});
	const memories = m.advanceMemories(
		undefined,
		{ servers: [signedIn], operations: [] },
		1_000,
	);
	// What the backend answers afterwards: still stored, still signed in.
	const after = {
		...signedIn,
		status: "not_started",
		status_basis: "stored",
		tool_count: 3,
		tool_count_basis: "last_seen",
	};
	const status = m.integrationStatus(after, [failedLogout], memories);
	assert.equal(status.label, "Sign-out didn't finish");
	assert.equal(status.tone, "warning");
	/*
	 * U16: the reason this row used to print was the backend's developer text - a
	 * SQLite error and "a fresh grant would silently reuse it" - which is true,
	 * alarming, and no help to the person looking at the row. It stays in the
	 * config/file view.
	 */
	assert.doesNotMatch(status.detail, /readonly|fresh grant|MCP logout|sqlite/i);
	assert.match(status.detail, /still saved/i);
	/*
	 * D21: the detail must NOT name the control standing beside it. "Try Sign out
	 * again." was the `Sign out again` button to the row's right read aloud, and
	 * the button's own label is asserted just below.
	 */
	assert.doesNotMatch(status.detail, /Sign out again/i);
	/*
	 * m-2 / Q3: the row's own words are a warning, so its group has to be the one
	 * that holds rows needing a decision - it sat under Connected while the page
	 * stayed mounted and moved to Available on a reload, two readings that
	 * disagreed with each other as well as with the words.
	 */
	assert.equal(
		m.integrationGroupOf(after, [failedLogout], memories),
		"attention",
	);
	const primary = m.primaryAction(after, [failedLogout], memories);
	assert.equal(primary.kind, "sign_out");
	assert.equal(primary.label, "Sign out again");
});

test("a Disconnect the user pressed is authoritative until a read confirms (Q2)", () => {
	/*
	 * After a live Disconnect the page re-reads once and stops polling, and that
	 * read can land on the config-only answer: the overlay was measured flapping
	 * 12 live / 8 config across 20 reads inside one second. The pre-Disconnect
	 * "worked" memory then worded the row as a success - "Worked just now ·
	 * 2 tools" under Connected, with no Connect - while the backend said not
	 * connected. The memory the control writes is what makes the row honest
	 * whatever the next read says.
	 */
	const live = row("docs-search", {
		status: "connected",
		status_basis: "live",
		tool_count: 12,
	});
	const memories = m.advanceMemories(
		undefined,
		{ servers: [live], operations: [] },
		1_000,
	);
	assert.equal(memories["docs-search"].connectedAt, 1_000);

	// The press: what the hook writes before the re-read is awaited.
	const pressed = {
		...memories,
		"docs-search": {
			...memories["docs-search"],
			connectedAt: null,
			disconnectedAt: 2_000,
		},
	};
	const stored = row("docs-search", {
		status: "not_started",
		status_basis: "stored",
		tool_count: 12,
		tool_count_basis: "last_seen",
		actions: ["test", "connect", "remove"],
	});
	assert.equal(
		m.integrationStatus(stored, [], pressed).label,
		"Not connected",
		"the config-only read does not restore a worked reading",
	);
	assert.equal(m.integrationGroupOf(stored, [], pressed), "ready");
	assert.equal(
		m.primaryAction(stored, [], pressed).kind,
		"connect",
		"and the row still offers the way back",
	);

	// Still authoritative one read later, and through `advanceMemories`.
	const later = m.advanceMemories(
		pressed,
		{ servers: [stored], operations: [] },
		3_000,
	);
	assert.equal(m.integrationStatus(stored, [], later).label, "Not connected");
	assert.equal(m.integrationGroupOf(stored, [], later), "ready");

	// A read that says it is CONNECTED is the confirmation, and clears the claim.
	const back = {
		...live,
		status: "connected",
		status_basis: "live",
		tool_count: 12,
		tool_count_basis: "live",
	};
	const confirmed = m.advanceMemories(
		later,
		{ servers: [back], operations: [] },
		4_000,
	);
	assert.equal(confirmed["docs-search"].disconnectedAt, null);
	assert.equal(
		m.integrationStatus(back, [], confirmed).label,
		"Connected · 12 tools",
	);
});

test("a live Disconnect outlives the read that contradicts it, and never claims a worked reading (Q1, round 4)", () => {
	/*
	 * THE REAL LIVE SHAPE, which the round-3 pin did not build. QA measured it on
	 * a warm runtime: the row read `Connected · 2 tools` with Disconnect in its
	 * menu, the press went to the overlay's own route, and the ONE read that
	 * followed landed on the flap's other arm - the overlay answers `live` about
	 * 12 times in 20 and config-only the other 8, all inside a second - so the
	 * row went on reading "Worked just now · 2 tools" under Connected with no
	 * Connect offered, for the whole 20 s sample, while the backend said
	 * `not_started` with `connect` in its actions. Two of three runs; the third
	 * landed on the live arm, which is why one read must not decide.
	 *
	 * The payload here is the one the backend actually sends, `last_seen` count
	 * and all: `tool_count` with `tool_count_basis: "last_seen"`, and #1536's
	 * `last_seen_at` beside it.
	 */
	const press = 2_000;
	const held = press + m.CONTROL_SETTLE_MS;
	const warm = row("qa-keyless-A", {
		status: "connected",
		status_basis: "live",
		tool_count: 2,
		tool_count_basis: "live",
	});
	const before = m.advanceMemories(
		undefined,
		{ servers: [warm], operations: [] },
		1_000,
	);
	assert.equal(before["qa-keyless-A"].connectedAt, 1_000);

	// Exactly what the hook's control memory writes on a Disconnect.
	const pressed = {
		...before,
		"qa-keyless-A": {
			...before["qa-keyless-A"],
			connectedAt: null,
			disconnectedAt: press,
			holdUntil: held,
		},
	};

	/*
	 * THE ARM THAT FAILED. The contradicting read is a `live` row that still says
	 * connected - the flap's stale half - carrying the last-seen count and time.
	 */
	const staleLive = row("qa-keyless-A", {
		status: "connected",
		status_basis: "live",
		tool_count: 2,
		tool_count_basis: "last_seen",
		last_seen_at: 1_790_247_000,
		actions: ["test", "set_key", "remove", "connect"],
	});
	const during = m.advanceMemories(
		pressed,
		{ servers: [staleLive], operations: [] },
		press + 700,
	);
	assert.equal(
		during["qa-keyless-A"].disconnectedAt,
		press,
		"a contradicting read inside the hold does not clear the user's Disconnect",
	);
	assert.equal(
		during["qa-keyless-A"].connectedAt,
		null,
		"and it does not stamp a worked reading either",
	);
	assert.equal(
		m.integrationStatus(staleLive, [], during).label,
		"Not connected",
		"so the row cannot claim a health the payload does not support",
	);
	assert.equal(m.integrationGroupOf(staleLive, [], during), "ready");
	assert.equal(m.primaryAction(staleLive, [], during).kind, "connect");
	/*
	 * AND THE MENU (R5-1b): the controls were asserted, the menu was not, and a
	 * revert of `overflowItems`' status substitution left the suite green while
	 * putting **Disconnect** back in the menu of a row whose own words say "Not
	 * connected" - the exact contradiction this fix removes. The primary is
	 * `connect`, so `connect` itself belongs to the button and not the menu; what
	 * must not be here is Disconnect.
	 */
	const menu = m.overflowItems(staleLive, [], during).map((item) => item.kind);
	assert.ok(
		!menu.includes("disconnect"),
		`a row under a standing Disconnect does not offer Disconnect (menu: ${menu.join(", ")})`,
	);
	assert.ok(!menu.includes("connect"), "and it does not repeat the primary");

	/*
	 * The other arm the round measured - the config-only answer - and the one the
	 * round-3 pin did build. Kept because both arms are real payloads.
	 */
	const disconnectable = row("qa-keyless-A", {
		status: "connected",
		status_basis: "live",
		tool_count: 2,
		tool_count_basis: "live",
		actions: ["test", "disconnect", "set_key", "remove"],
	});
	const storedArm = row("qa-keyless-A", {
		status: "not_started",
		status_basis: "stored",
		tool_count: 2,
		tool_count_basis: "last_seen",
		last_seen_at: 1_790_247_000,
		actions: ["test", "set_key", "remove", "connect"],
	});
	const configOnly = m.advanceMemories(
		pressed,
		{ servers: [storedArm], operations: [] },
		press + 800,
	);
	assert.equal(
		m.integrationStatus(storedArm, [], configOnly).label,
		"Not connected",
	);
	assert.equal(
		configOnly["qa-keyless-A"].connectedAt,
		null,
		"a stored last-seen count does not become a worked reading while the hold stands",
	);

	/*
	 * PAST THE HOLD the newest read wins again: the app never holds a claim the
	 * backend has stopped supporting, and a Disconnect that truly failed has to
	 * be able to come back.
	 */
	const after = m.advanceMemories(
		during,
		{ servers: [staleLive], operations: [] },
		held + 1,
	);
	assert.equal(after["qa-keyless-A"].disconnectedAt, null);
	assert.equal(after["qa-keyless-A"].connectedAt, held + 1);
	assert.equal(
		m.integrationStatus(staleLive, [], after).label,
		"Connected · 2 tools",
	);
	/*
	 * The same substitution, seen from the other side: a payload that really does
	 * offer Disconnect keeps it once the window has passed, and does not offer it
	 * while the press stands. Both halves matter - without the second this could
	 * pass by never offering the verb at all.
	 */
	const offersDisconnect = (memory) =>
		m
			.overflowItems(disconnectable, [], memory)
			.map((item) => item.kind)
			.includes("disconnect");
	assert.ok(
		offersDisconnect(after),
		"after the window the menu follows the read and offers Disconnect",
	);
	assert.ok(
		!offersDisconnect(during),
		"and inside the window it does not, however the read words the row",
	);
	assert.equal(after["qa-keyless-A"].holdUntil, null);
});

test("a held Disconnect groups with its own words, whatever the fresh read says (R5-3)", () => {
	/*
	 * The group has its own copy of the press's rule, and the round-4 claim that
	 * `effectiveStatus` is the single place the words, the group and the controls
	 * all read it was not true of this function: its `disconnectedAt` branch sat
	 * BELOW the `needs_sign_in`/`error` branch, so inside the very window the fix
	 * exists for, a held Disconnect whose fresh read said `needs_sign_in` rendered
	 * the words "Not connected" with a `connect` primary while the row sat under
	 * Needs attention. Reproduced by the reviewer on both statuses.
	 */
	const press = 5_000;
	const held = press + m.CONTROL_SETTLE_MS;
	const memories = {
		"qa-keyless-A": {
			...m.NO_MEMORY,
			disconnectedAt: press,
			holdUntil: held,
		},
	};
	for (const status of ["needs_sign_in", "error"]) {
		const fresh = row("qa-keyless-A", {
			status,
			status_reason: "The server said so.",
			actions: ["test", "connect", "remove"],
		});
		assert.equal(
			m.integrationStatus(fresh, [], memories, press + 1_000).label,
			"Not connected",
			`the words follow the press (${status})`,
		);
		assert.equal(
			m.integrationGroupOf(fresh, [], memories),
			"ready",
			`and the section follows the words, not the read (${status})`,
		);
		assert.equal(m.primaryAction(fresh, [], memories).kind, "connect");
	}
});

test("the payload's last-seen time is consumed once, in seconds, and refused when it is not a time (R4-3)", () => {
	/*
	 * #1536 publishes `last_seen_at` as epoch SECONDS, set iff the count is a
	 * `last_seen` count. It is the only second-valued stamp this page receives,
	 * and the same unit trap already cost this branch twice - a real six-minute
	 * check once rendered "Worked 20700 d ago" - so it enters through one named
	 * conversion, and it is refused rather than guessed at in either direction.
	 */
	assert.equal(m.lastSeenMillis(1_790_247_000), 1_790_247_000_000);
	assert.equal(
		m.lastSeenMillis(1_790_247_000_000),
		1_790_247_000_000,
		"a millisecond stamp is passed through, not multiplied again",
	);
	for (const value of [
		null,
		undefined,
		"1790247000",
		0,
		999_999_999,
		Number.NaN,
	])
		assert.equal(m.lastSeenMillis(value), null, `refused: ${String(value)}`);
	/*
	 * AND THE UPPER BOUND (R5-4): anything in the accepted band used to be
	 * multiplied and taken, so 999 999 999 999 "seconds" - year 33658 - and a
	 * stamp from the future both rendered `Worked just now` in the success tone,
	 * because `relativeTime` clamps a negative delta to "just now". The value is a
	 * tool-cache mtime and cannot be either of those from this backend, which is
	 * why the answer is a refusal rather than a repair: the row falls back to the
	 * vaguer "Worked earlier", which is true.
	 */
	assert.equal(m.lastSeenMillis(999_999_999_999), null, "an implausible stamp");
	assert.equal(
		m.lastSeenMillis((Date.now() + 86_400_000) / 1000),
		null,
		"a stamp a day in the future",
	);
	/*
	 * AND THE BOUND IS AT THE SCALE OF THE CLASS IT REFUSES (R6-3): an hour of
	 * tolerance, because the value this exists for is four orders of magnitude
	 * beyond any clock disagreement, and a minute also discarded a genuinely fresh
	 * stamp from a host whose clock runs fast. Inside the tolerance the stamp is
	 * read as NOW rather than refused - `relativeTime` clamps a negative delta to
	 * "just now" anyway, so a reading from a slightly fast host IS a reading just
	 * taken, and saying so costs the row nothing.
	 */
	const now = 1_790_247_600_000;
	assert.equal(
		m.lastSeenMillis((now + 60_000) / 1000, now),
		now,
		"a stamp a minute ahead is read as now, not discarded",
	);
	assert.equal(
		m.lastSeenMillis((now + 30 * 60_000) / 1000, now),
		now,
		"and so is half an hour ahead",
	);
	assert.equal(
		m.lastSeenMillis((now + 2 * 60 * 60_000) / 1000, now),
		null,
		"two hours ahead is not a reading this page will render",
	);
	assert.equal(
		m.lastSeenMillis((now - 60_000) / 1000, now),
		now - 60_000,
		"a minute in the past is returned as it is",
	);

	/*
	 * The page's own reading of it: a `stored` row standing behind a last-seen
	 * count, with no memory of its own - the reload case - carries the time the
	 * backend took the count, so the row can say WHEN rather than only that it
	 * did.
	 */
	const twoHours = 2 * 60 * 60 * 1000;
	const stored = row("filesystem", {
		status: "not_started",
		status_basis: "stored",
		tool_count: 5,
		tool_count_basis: "last_seen",
		last_seen_at: (now - twoHours) / 1000,
	});
	const memories = m.advanceMemories(
		undefined,
		{ servers: [stored], operations: [] },
		now,
	);
	assert.equal(memories.filesystem.connectedAt, now - twoHours);
	assert.equal(memories.filesystem.connectedToolCount, 5);
	assert.equal(
		// `now` passed explicitly: the label is an age, and a wall clock would
		// make this assertion pass for the wrong reason one day and fail the next.
		m.integrationStatus(stored, [], memories, now).label,
		"Worked 2 h ago · 5 tools",
	);
	// And from the payload alone, with no memory yet: the same age, because the
	// backend published it rather than the page having watched it.
	assert.equal(
		m.integrationStatus(stored, [], undefined, now).label,
		"Worked 2 h ago · 5 tools",
	);
	assert.equal(m.integrationGroupOf(stored, [], memories), "connected");
	// No usable time: the vaguer wording, which is still true.
	const untimed = row("filesystem", {
		status: "not_started",
		status_basis: "stored",
		tool_count: 5,
		tool_count_basis: "last_seen",
		last_seen_at: null,
	});
	assert.equal(
		m.integrationStatus(
			untimed,
			[],
			m.advanceMemories(undefined, { servers: [untimed], operations: [] }, now),
			now,
		).label,
		"Worked earlier · 5 tools",
	);
});

test("a scoped document does not erase a global row's recorded state (U17)", () => {
	/*
	 * Operations are scoped to a cwd while global rows are not, so a project
	 * document answers `operations: []` for a row whose last sign-out this page
	 * watched happen - and `linear` went from "Sign-out didn't finish" to "Ready"
	 * by opening a chat in a project folder.
	 */
	const global = row("linear", {
		status: "not_started",
		status_basis: "stored",
		auth: {
			kind: "oauth",
			signed_in: true,
			secret_refs: [{ id: "LINEAR_TOKEN", state: "encrypted" }],
		},
		actions: ["test", "sign_out", "remove"],
	});
	const failedLogout = op("linear", { action: "logout", status: "failed" });
	// The page watched it happen under the default (global) document.
	const memories = m.advanceMemories(
		undefined,
		{ servers: [global], operations: [failedLogout] },
		1_000,
	);
	assert.ok(memories.linear.lastDecisive, "the operation is remembered");

	// Then a project document arrives, and it carries no operations for the row.
	const scoped = m.advanceMemories(
		memories,
		{ servers: [global], operations: [] },
		2_000,
	);
	assert.equal(
		m.integrationStatus(global, [], scoped).label,
		"Sign-out didn't finish",
		"the recorded state survives the scope change",
	);
	assert.equal(m.integrationGroupOf(global, [], scoped), "attention");
	assert.equal(m.primaryAction(global, [], scoped).label, "Sign out again");
	// And the memory is what it reads: no operations at all is the same answer.
	assert.equal(
		m.integrationStatus(global, [], scoped).label,
		m.integrationStatus(global, [], memories).label,
	);
});

test("the folder banner follows the folder that was refused (m-3)", () => {
	/*
	 * The flag used to stay true for the whole mount, so switching to a chat whose
	 * folder is fine still carried "This chat's folder no longer exists" over a
	 * project catalog that was reading perfectly.
	 */
	assert.equal(m.folderUnavailableFor("/home/u/gone", "/home/u/gone"), true);
	assert.equal(m.folderUnavailableFor("/home/u/gone", "/home/u/here"), false);
	assert.equal(m.folderUnavailableFor("/home/u/gone", null), false);
	assert.equal(m.folderUnavailableFor(null, "/home/u/here"), false);
});

test("the dialog's reason line never names the key route a row does not have (n-1)", () => {
	const backendReason =
		"No OAuth authorization server was discovered for this server; check its URL and your network, or add its key instead.";
	// With a key route the sentence stands as the server wrote it.
	assert.equal(m.publicSignInReason(backendReason, true), backendReason);
	/*
	 * Without one, the trailing advice is dropped rather than reworded: it names a
	 * control this surface cannot draw, which is the defect `signInNextStep` was
	 * fixed for (D15) one line further up the same dialog, and U11's remaining
	 * contradiction.
	 */
	const honest = m.publicSignInReason(backendReason, false);
	assert.doesNotMatch(honest, /add its key/i);
	assert.match(honest, /No OAuth authorization server was discovered/);
	assert.match(honest, /\.$/, "and it still ends as a sentence");
	// An absent reason stays absent, so the caller can say the server gave none.
	assert.equal(m.publicSignInReason(null, false), null);
	assert.equal(m.publicSignInReason("   ", false), null);
	// A sentence with nothing to strip is untouched.
	assert.equal(
		m.publicSignInReason("The server refused the redirect.", false),
		"The server refused the redirect.",
	);
});

test("a credentials refusal names the control the dialog actually draws (n-3)", () => {
	/*
	 * Two things this pins. First, the `invalid_target` sentence had no test at
	 * all: rewording it or deleting it left the suite green, because it existed
	 * only inside a callback. Second, the conflict sentence named "Replace saved
	 * values" - a plural label the dialog stopped using, and on a keyless row a
	 * control that was not on screen at all (U15).
	 */
	assert.equal(
		m.credentialsRefusalMessage("saved", [], {}),
		null,
		"a saved write has no message",
	);
	const conflict = m.credentialsRefusalMessage(
		"replace_confirmation_required",
		[],
		{ ACME_NEW_X_API_KEY: "v" },
	);
	assert.match(conflict, new RegExp(m.replaceControlLabel(1)));
	assert.doesNotMatch(conflict, /Replace saved values/);
	assert.match(
		m.credentialsRefusalMessage("replace_confirmation_required", [], {
			A: "1",
			B: "2",
		}),
		new RegExp(m.replaceControlLabel(2)),
		"the plural label is named when the dialog draws that one",
	);
	const invalid = m.credentialsRefusalMessage("invalid_target", [], {
		AUTHORIZATION: "v",
	});
	assert.match(invalid, /can't carry this key/i);
	assert.match(invalid, /Nothing was saved/);
	// A code nobody knows still says what happened, naming the ids the backend
	// refused, and falls back to the ids the write carried when it named none.
	assert.match(
		m.credentialsRefusalMessage("write_failed", ["A", "B"], { A: "1", B: "2" }),
		/A, B/,
	);
	assert.match(
		m.credentialsRefusalMessage("write_failed", [], { C: "1" }),
		/C/,
	);
});

test("a row's reason drops a status code, which explains nothing (n4)", () => {
	/*
	 * The rejected-key reason read "acme-new rejected our credentials (401) - set
	 * its API key or headers": a number where an explanation belongs, on a row
	 * whose action already says what to do (Add key).
	 */
	assert.equal(
		m.publicRowReason(
			"acme-new rejected our credentials (401) - set its API key or headers",
		),
		"acme-new rejected our credentials - set its API key or headers",
	);
	// A number that is part of a longer token is not a status code.
	assert.equal(
		m.publicRowReason("MCP-401-server refused the read"),
		"MCP-401-server refused the read",
	);
	// The transport prefixes are still stripped, and only those.
	assert.equal(m.publicRowReason("connection closed: boom"), "boom");
	assert.equal(m.publicRowReason("/mcp reload"), null);
	assert.equal(m.publicRowReason(null), null);
});

test("the dialogs and the row list keep the geometry and the rules the walk measured (D19, n3, U18, U19, m-4)", () => {
	/*
	 * Source pins, and their limits stated: this suite bundles the model, not the
	 * components, so it cannot render them. What it can do is fail when the line
	 * that carries a rule is deleted, which is how each of these was lost once.
	 * The rendered proof is the captured frames and the walk's measurements.
	 */
	const signIn = readFileSync(
		"src/renderer/src/features/settings/components/integrations/integration-sign-in-dialog.tsx",
		"utf8",
	);
	/*
	 * D19: every phase is capped by `max-w-md`, and a short phase collapsed to the
	 * 320 px floor - so the panel snapped 64 px narrower on each side at the exact
	 * moment the user came back from the browser. `fullWidth` holds one width.
	 */
	assert.match(
		signIn,
		/^\t\t\tfullWidth$/m,
		"the sign-in dialog passes the prop that holds one width across its phases (D19)",
	);

	const keyDialog = readFileSync(
		"src/renderer/src/features/settings/components/integrations/integration-key-dialog.tsx",
		"utf8",
	);
	// n3: neither body may widen itself past its scroller, which drew a stray
	// horizontal strip under the last control.
	for (const [file, source] of [
		["key", keyDialog],
		["sign-in", signIn],
	]) {
		assert.doesNotMatch(
			source,
			/className="[^"]*-mx-1\.5[^"]*p-1\.5[^"]*"/,
			`${file}: the scroll body is the scroller's own width (n3)`,
		);
	}
	/*
	 * U19: a press on a control in the add form's actions row must not blur the
	 * field above it, because the blur can insert an error line and move the
	 * button between mousedown and mouseup - which is how a click on Add
	 * integration with an empty Name did nothing at all while Enter worked.
	 */
	const addForm = readFileSync(
		"src/renderer/src/features/settings/components/integrations/add-integration-form.tsx",
		"utf8",
	);
	const stable = [...addForm.matchAll(/onMouseDown=\{keepGeometryStable\}/g)]
		.length;
	assert.equal(
		stable,
		2,
		`both controls in the actions row hold their geometry across the press (found ${stable}, expected 2)`,
	);
	const section = readFileSync(
		"src/renderer/src/features/settings/components/mcp-management-section.tsx",
		"utf8",
	);
	/*
	 * m-4: the deferred focus move is armed with a DEADLINE and dropped past it.
	 * Armed until the row stopped asking for a sign-in, it could take focus long
	 * after the dialog that armed it, from wherever the user had moved on to.
	 */
	assert.match(
		section,
		/Date\.now\(\) > focusRow\.until/,
		"a stale focus move is dropped rather than performed (m-4)",
	);
	assert.match(
		section,
		/until: Date\.now\(\) \+ FOCUS_ARM_MS/,
		"and every arm site carries the deadline",
	);
	/*
	 * m-4's OTHER half, whose reach is stated rather than implied (R4-5): the
	 * disarm timer is BELT AND BRACES - the deadline check above is what makes a
	 * late move impossible - so deleting it leaves this suite green, and that is
	 * a property of the design rather than a hole. It is still pinned, because a
	 * `focusRow` that outlived its window sitting in state is what the timer is
	 * for, and nothing else would notice.
	 */
	const disarm = section.slice(
		section.indexOf("Disarm the move when its window closes"),
		section.indexOf(
			"return (",
			section.indexOf("Disarm the move when its window closes"),
		),
	);
	assert.match(
		disarm,
		/window\.setTimeout\(/,
		"the armed move is disarmed when its window closes (m-4, belt and braces)",
	);
	assert.match(
		disarm,
		/setFocusRow\(null\)/,
		"and disarming means dropping it",
	);
	/*
	 * Q2/U20: the move must land AFTER the closing surface's own focus restore.
	 * A dialog or a row menu closing runs Radix's close-auto-focus, whose target
	 * is the control that opened it - a menu item the close has already
	 * unmounted - so a focus performed in the same tick was overwritten with
	 * `<body>` on the two arms whose row then never re-rendered: the confirm on a
	 * failed sign-out and a key save that left the row with no primary.
	 *
	 * The slice runs from the moment the move has a target to the end of that
	 * effect, so it cannot reach a later `window.setTimeout` elsewhere in the
	 * file (the round-3 lesson: a slice that runs past its function matches the
	 * next one's code and then proves nothing).
	 */
	const deferred = section.slice(
		/*
		 * Anchored on the move's own first line, NOT on the guard: the guard text
		 * occurs twice in this file (the remove flow's focus uses it too), so a
		 * slice that starts at the text it asserts proves nothing - the round-3
		 * lesson about slices that run past, or land inside, the wrong function.
		 * That is why the guard's own pin below reads this slice.
		 */
		section.indexOf("const element = primary"),
		section.indexOf(
			"}, [focusRow, servers, operations, integrations.memories]);",
		),
	);
	assert.match(
		deferred,
		/window\.setTimeout\(\(\) => \{/,
		"the deferred move runs a macrotask later, past Radix's own restore (Q2, U20)",
	);
	assert.match(
		deferred,
		/element\.isConnected/,
		"and only onto a control that is still in the document",
	);
	// U18: the four completions that used to leave focus on `<body>`.
	assert.match(
		section,
		/closeSignIn = useCallback\(/,
		"the sign-in dialog hands focus back through the row (U12, U18)",
	);
	/*
	 * U18's four completions, pinned by name so a fifth site cannot quietly
	 * replace one: the sign-in close, the sign-out confirm and a successful key
	 * save arm the deferred row move, and the add form's cancel hands focus back
	 * to the control that OPENED it (the form is inline, and its opener is still
	 * on screen).
	 */
	const arms = [...section.matchAll(/setFocusRow\(\{/g)].length;
	assert.equal(
		arms,
		3,
		`the deferred row move is armed by exactly these three completions (found ${arms})`,
	);
	assert.match(
		addForm,
		/onCancel|onCancel\(\)/,
		"the add form's cancel is wired to the section, which returns focus to its opener (U18)",
	);
	assert.match(
		section,
		/onCancel=\{\(\) => \{\n\t\t\t\tsetShowAdd\(false\);[\s\S]{0,400}?addSlotRef\.current\?\.focus\(\)/,
		"and that handler puts focus back on Add integration, not on <body>",
	);

	/*
	 * Q2's wiring half, pinned at the source for the same reason: the rule lives
	 * in the model (tested above), but a rule nothing writes is a rule that does
	 * nothing. The hook has to record the user's Disconnect, and the list has to
	 * keep asking for a bounded window afterwards - otherwise the one read that
	 * follows can land on the config-only answer and the row never hears the
	 * confirmation.
	 */
	const hook = readFileSync(
		"src/renderer/src/features/settings/components/integrations/use-integrations.ts",
		"utf8",
	);
	assert.match(
		hook,
		/disconnectedAt: Date\.now\(\)/,
		"the hook writes the user's Disconnect into the row's memory (Q2)",
	);
	assert.match(
		hook,
		/markControlMemory\(request\)/,
		"and it does so on the control path, not only in a test",
	);
	/*
	 * R5-1a: THE HOLD IS WRITTEN BY THE SAME ARM, and it is pinned by SLICING the
	 * arm rather than by matching the field anywhere in the hook. Round 5 found
	 * that dropping `holdUntil` from this one line (use-integrations.ts:792-798)
	 * left the whole suite green - the model tests build that memory by hand - and
	 * that in the app the hold then never opens, so the live Q1 defect returns in
	 * full with every test still passing. The slice starts at the deadline's own
	 * line and ends at the `setMemoryEpoch` that closes the arm, so it cannot
	 * reach a later function's code (the round-3 lesson about slices that run
	 * past their function, which then prove nothing).
	 */
	const armStart = hook.indexOf(
		"const holdUntil = Date.now() + CONTROL_SETTLE_MS;",
	);
	assert.ok(armStart > 0, "the hook computes the hold's deadline (R5-1a)");
	const controlArm = hook.slice(
		armStart,
		/*
		 * END ANCHOR: the arm's own closing write, not the state bump that follows
		 * it (R6-2). `setMemoryEpoch((epoch) => epoch + 1);` occurs twice in the
		 * hook and says nothing about this arm, so the slice used to end at the
		 * first one after the start: inserting one unrelated `setMemoryEpoch(...)`
		 * before the write, with the wiring untouched, failed this pin (61 -> 60).
		 * It failed in the safe direction, but an anchor that a change elsewhere
		 * can move is the shape that has already had to be re-anchored twice on
		 * this branch. This line occurs once and IS the boundary being asserted.
		 */
		hook.indexOf(
			"memoriesRef.current = { ...memoriesRef.current, [request.name]: next };",
			armStart,
		),
	);
	assert.match(
		controlArm,
		/disconnectedAt: Date\.now\(\),?\s*\n?\s*holdUntil,/,
		"the Disconnect the hook writes opens the hold with it (R5-1a)",
	);
	assert.match(
		controlArm,
		/connectedAt: null/,
		"and it drops the worked reading in the same object",
	);
	/*
	 * R5-1b's source half. The behavioural half is the menu assertion in the Q1
	 * test; this is the line that makes the menu and the words agree, and round 5
	 * showed it could be reverted to the raw status with everything green.
	 */
	const modelSource = readFileSync(
		"src/renderer/src/features/settings/components/integrations/integration-model.ts",
		"utf8",
	);
	/*
	 * R6-4: written to tolerate a reflow rather than to match one exact line - the
	 * behavioural assertion in the Q1 test is what carries this rule, and a
	 * prettier reformat of a correct file must not fail the suite for its own
	 * reasons.
	 */
	assert.match(
		modelSource,
		/const\s+status\s*=\s*effectiveStatus\(\s*row,\s*memoryFor\(\s*memories,\s*row\.name,?\s*\)\s*,?\s*\)/,
		"the menu derives its status from the same substitution the words and the controls use (R5-1b)",
	);
	/*
	 * R5-1c: the stay-armed guard, which is the half of Q2/U20 that stops the
	 * move being DROPPED when the row's control does not exist yet. Round 5
	 * deleted it with everything green; without it a move armed before the primary
	 * is registered leaves focus where the closing surface left it, which is the
	 * `<body>` U20 measured.
	 */
	assert.match(
		deferred,
		/if \(!element\) return;/,
		"a move with nothing to land on stays armed rather than being dropped (R5-1c)",
	);
	/*
	 * AND THE WINDOW IS DECLARED BEFORE THE QUERIES THAT READ IT. React Query
	 * calls `refetchInterval` during the render that builds the options, so a
	 * `pollIntervalFor` declared further down the component body is in its
	 * temporal dead zone the first time it is asked - measured on the built app as
	 * `ReferenceError: Cannot access 'ee' before initialization`, which took the
	 * whole Settings page down to a blank screen. No unit test can see that; this
	 * asserts the ORDER, and the live walk is what proves the page renders.
	 */
	assert.ok(
		hook.indexOf("const pollIntervalFor = useCallback(") <
			hook.indexOf("const catalogQuery = useQuery"),
		"the poll helper is declared before the first query that calls it",
	);
	const polls = [
		...hook.matchAll(
			/refetchInterval: \(query\) =>\s*\n?\s*pollIntervalFor\(/g,
		),
	].length;
	assert.equal(
		polls,
		2,
		`both routes poll through the settle window (found ${polls}, expected 2)`,
	);
	assert.match(
		hook,
		/Date\.now\(\) < settleUntilRef\.current\s*\n\s*\? INTEGRATIONS_POLL_MS\s*\n\s*: integrationsPollInterval\(data\)/,
		"which polls every tick inside the window and hands back to the moving-row rule after it (Q2)",
	);
});
