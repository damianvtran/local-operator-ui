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
			'export { catalogControlBody, sessionControlBody, catalogCwdFor, newestRosterRow } from "./src/renderer/src/features/settings/components/integrations/use-integrations";' +
			'export { signInProgress } from "./src/renderer/src/features/settings/components/integrations/integration-sign-in-dialog";' +
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
	project_path: null,
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
		"3 tools last time",
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
			["ready", "Ready", ["ready1", "busy"]],
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

/* ------------------------------------------------------ sign-in */

test("the sign-in dialog claims a browser opened only when the backend said so", () => {
	assert.match(
		m.signInProgress("linear", null).message,
		/Waiting for you to approve/,
	);
	assert.match(
		m.signInProgress("linear", op("linear", { browser_opened: null })).message,
		/Waiting for you to approve/,
	);
	assert.match(
		m.signInProgress("linear", op("linear", { browser_opened: true })).message,
		/Your browser opened/,
	);
	const noBrowser = m.signInProgress(
		"linear",
		op("linear", {
			browser_opened: false,
			authorization_url: "https://x.example/auth",
		}),
	);
	assert.match(noBrowser.message, /didn't open/);
	assert.equal(noBrowser.link, "https://x.example/auth");
	for (const operation of [
		null,
		op("linear"),
		op("linear", { browser_opened: false }),
	])
		assert.doesNotMatch(
			m.signInProgress("linear", operation).message,
			/browser opened/,
		);
});

test("a failed sign-in gives the reason, or says there was none", () => {
	assert.equal(
		m.signInProgress(
			"linear",
			op("linear", { status: "failed", message: "redirect refused" }),
		).message,
		"Sign-in didn't finish: redirect refused",
	);
	const bare = m.signInProgress(
		"linear",
		op("linear", { status: "failed" }),
	).message;
	assert.match(bare, /didn't say why/);
	assert.notEqual(bare, "Sign-in failed.");
	assert.equal(
		m.signInProgress("linear", op("linear", { status: "complete" })).tone,
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
