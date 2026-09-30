import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The BACKEND's own pinned catalog payload, run through this page's model.
 *
 * ## Why this file exists
 *
 * `desktop-control-contract.ts` is hand-written, and the file itself says the
 * limit out loud: `desktopResult<T>` is an unchecked cast, so a backend rename
 * arrives silently, and a parity assertion "against a pinned payload from the
 * backend" is what catching it needs - which the UI repo could not make on its
 * own. The backend PR now ships exactly that payload
 * (`docs/fixtures/mcp-catalog.json`), and this is the assertion it was published
 * for. The vendored copy is byte-identical to that head's file apart from the
 * JSON formatting normalisation noted below - verified by comparing the two
 * documents, not by trusting the copy.
 *
 * ## What it proves, and what it cannot
 *
 * It proves the payload the backend PINS runs through this page's derivations:
 * every top-level and per-row field name is one the contract declares, and every
 * value in the payload's vocabularies (`status`, `actions`, `transport`,
 * `source.kind`, `auth.kind`, `tool_count_basis`, `status_basis`) is one the
 * renderer words or handles - with the copy checked, not merely the absence of a
 * crash.
 *
 * The hard limit, stated rather than implied: the fixture is a COPY, so this
 * test sees a backend change only when somebody re-copies the file. That is the
 * same convergence cost `docs/evidence/manifest.json` carries, and the reason
 * the copy names its source revision below. Re-copying is one command, followed
 * by `pnpm exec biome format --write` on it - the copy is byte-identical to the
 * backend's file except for that normalisation, which this repo's scripts lint
 * gate requires of every changed file under `scripts/` (the READINGS are
 * identical either way; only indentation differs):
 *
 *   cp <backend>/docs/fixtures/mcp-catalog.json scripts/fixtures/mcp-catalog-<version>.json
 *
 * ## Why an unknown status is the interesting case
 *
 * `status` is the backend's vocabulary to extend. The renderer used to fall
 * through a `default:` branch to "Ready", which is a health claim about a row
 * nobody read, so the model now refuses a word it does not know in words and
 * this file pins both halves: the payload is INSIDE the vocabulary, and a word
 * outside it renders "Status unavailable" rather than "Ready".
 */

/** The backend revision and version this copy was taken from. */
const FIXTURE = "scripts/fixtures/mcp-catalog-0.62.30.json";
const BACKEND_SOURCE =
	"local-operator `main` at `de9f1d014` (tag `v0.62.30`), which carries #1507, #1511 and #1536. THIS IS A RE-VENDOR, not a re-check: the copy is the backend's own `docs/fixtures/mcp-catalog.json` at that ref, through the documented command (`cp <backend>/docs/fixtures/mcp-catalog.json scripts/fixtures/mcp-catalog-<version>.json`) and `biome format --write`, with its name carrying the version it came from. WHAT MOVED IT: #1536 (merged 2026-09-24T20:06Z) added `last_seen_at` to every row of that payload and to `catalog.py`, epoch SECONDS, set iff `tool_count_basis == \"last_seen\"` - the field this page needs to say WHEN a row last worked rather than only that it did (R4-3). The old copy (0.62.17) had no such key, which made this file's re-vendor path a failing test: `ROW_FIELDS` asserts an exact key set per row, so re-copying the payload the backend ships failed `row linear carries a field set the contract does not declare` until the contract and this list learned the field (R4-1). HISTORY, as bare SHAs: the copy was taken at #1511 `aa927158a`, re-checked at `e2ac4b95e`, then at `0d1a1370e` - one file, `de817bc4...`, unchanged across all three - and #1511's branch head stopped being the payload's authority when its content merged to `main` and `main` moved it again. The next reader should re-derive this ref from `main`, not from the merged PR's branch";
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/components/integrations/integration-model";' +
			'export { signInProgress } from "./src/renderer/src/features/settings/components/integrations/integration-sign-in-dialog";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
	loader: { ".css": "empty" },
	jsx: "automatic",
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const document_ = JSON.parse(readFileSync(FIXTURE, "utf8"));
const rows = document_.servers;

/** The fields the contract declares, spelled once so both sides are asserted. */
const CATALOG_FIELDS = [
	"cwd",
	"project_scope_available",
	"global_path",
	"project_path",
	"status_source",
	"session_id",
	"servers",
	"operations",
];

/**
 * Every field of a catalog row.
 *
 * `operation` is present only on a POST answer and optional by contract, so it
 * is not required here - the fixture is a GET document. Nothing else is
 * optional: a row missing one of these would render a hole where a fact goes.
 */
const ROW_FIELDS = [
	"id",
	"name",
	"scope",
	"project_cwd",
	"source",
	"transport",
	"endpoint",
	"status",
	"status_reason",
	"status_observed_at",
	"status_basis",
	"auth",
	"tool_count",
	"tool_count_basis",
	// #1536's field. The row type in the shared contract carries it, and this
	// list must too: the exact key set is what makes a stale copy fail loudly.
	"last_seen_at",
	"actions",
];

test("the payload's last-seen time is on every row, and set only where it means something (#1536)", () => {
	/*
	 * The field's contract, asserted on the real payload rather than described:
	 * `last_seen_at` is epoch SECONDS and is set iff `tool_count_basis` is
	 * `last_seen` (local-operator#1536's own rule). A row that carries it with no
	 * `last_seen` count - or a count with no time - is the mismatch that would
	 * put an age on a reading the backend never took.
	 */
	for (const row of rows) {
		assert.ok(
			Object.prototype.hasOwnProperty.call(row, "last_seen_at"),
			`row ${row.name} must declare last_seen_at`,
		);
		const lastSeen = row.tool_count_basis === "last_seen";
		assert.equal(
			row.last_seen_at !== null,
			lastSeen,
			`row ${row.name}: last_seen_at is set iff the count is a last_seen count`,
		);
		if (lastSeen)
			assert.ok(
				row.last_seen_at > 1_000_000_000 && row.last_seen_at < 4_000_000_000,
				`row ${row.name}: last_seen_at is epoch SECONDS, not milliseconds`,
			);
	}
	assert.equal(rows.filter((row) => row.last_seen_at !== null).length, 2);
});

test("the fixture is the backend's pinned payload, not a hand-written one", () => {
	assert.equal(document_.cwd, "/Users/you/projects/acme");
	assert.equal(
		rows.length,
		7,
		"seven rows, one per state the audit asked for plus the add_key case",
	);
	// The vocabulary coverage THIS file's other tests rely on, so that thinning
	// the fixture cannot make them vacuous.
	assert.deepEqual(
		[...new Set(rows.map((row) => row.status))].sort(),
		[...m.INTEGRATION_STATUSES].sort(),
		`the payload must exercise every status the page words (source: ${BACKEND_SOURCE})`,
	);
	assert.deepEqual([...new Set(rows.map((row) => row.transport))].sort(), [
		"local_command",
		"remote_url",
	]);
	assert.deepEqual([...new Set(rows.map((row) => row.source.kind))].sort(), [
		"codex",
		"cursor",
		"local-operator",
	]);
});

test("every field the payload carries is one the contract declares", () => {
	assert.deepEqual(Object.keys(document_).sort(), [...CATALOG_FIELDS].sort());
	for (const row of rows) {
		assert.deepEqual(
			Object.keys(row).sort(),
			[...ROW_FIELDS].sort(),
			`row ${row.name} carries a field set the contract does not declare`,
		);
		assert.deepEqual(
			Object.keys(row.source).sort(),
			["editable", "kind", "owned_scope", "path"],
			`row ${row.name}: source fields`,
		);
		assert.deepEqual(
			Object.keys(row.endpoint).sort(),
			["command", "endpoint_redacted", "url"],
			`row ${row.name}: endpoint fields`,
		);
		assert.deepEqual(
			Object.keys(row.auth).sort(),
			["kind", "secret_refs", "signed_in"],
			`row ${row.name}: auth fields`,
		);
	}
});

test("every word in the payload's vocabularies is one this page handles", () => {
	for (const row of rows) {
		assert.ok(
			m.isKnownIntegrationStatus(row.status),
			`row ${row.name}: unknown status ${JSON.stringify(row.status)}`,
		);
		for (const action of row.actions)
			assert.ok(
				[
					"test",
					"sign_in",
					"set_key",
					"reauth",
					"sign_out",
					"remove",
					"connect",
					"disconnect",
					"add_key",
				].includes(action),
				`row ${row.name}: unknown action ${JSON.stringify(action)}`,
			);
		assert.ok(
			["local_command", "remote_url"].includes(row.transport),
			`row ${row.name}: unknown transport`,
		);
		assert.ok(
			["none", "oauth", "api_key", "unknown"].includes(row.auth.kind),
			`row ${row.name}: unknown auth kind`,
		);
		assert.ok(
			[null, "live", "probe", "last_seen"].includes(row.tool_count_basis),
			`row ${row.name}: unknown tool_count_basis`,
		);
		assert.ok(
			["live", "probe", "stored", "operation"].includes(row.status_basis),
			`row ${row.name}: unknown status_basis`,
		);
		for (const ref of row.auth.secret_refs)
			assert.ok(
				["encrypted", "missing", "unavailable"].includes(ref.state),
				`row ${row.name}: unknown secret state`,
			);
	}
});

test("each pinned row derives its OWN words, with no wire word surviving", () => {
	/*
	 * The clock this set renders against: the payload's OWN newest observation,
	 * epoch seconds x 1000, derived from the fixture rather than read from the
	 * wall.
	 *
	 * WHY IT IS NOT `Date.now()`: #1536 publishes `last_seen_at` (epoch SECONDS)
	 * and the page now renders an AGE from it, so a wall clock would make the
	 * reading depend on the day the suite ran - the assertion would drift from
	 * "Worked 1 day ago" to "Worked 2 days ago" overnight and fail for a reason
	 * that has nothing to do with this branch. The payload's own time is also the
	 * more honest baseline: it is the moment the fixture describes.
	 */
	const NOW =
		Math.max(
			...rows.map((row) => (row.status_observed_at ?? 0) * 1000),
			...rows.map((row) => (row.last_seen_at ?? 0) * 1000),
		) || Date.now();
	const view = (name) =>
		m.integrationStatus(
			rows.find((row) => row.name === name),
			document_.operations,
			undefined,
			NOW,
		);
	const wire =
		/\b(cold|auth-required|stdio|http|not_started|needs_sign_in|transport)\b/i;

	// A live probe that answered: the only row allowed to claim Connected.
	assert.equal(view("github").label, "Connected · 12 tools");
	assert.equal(view("github").tone, "success");
	// A sign-in running for THIS row reads as signing in, from the operation the
	// payload carries.
	assert.equal(view("linear").label, "Signing in…");
	assert.equal(view("linear").busy, true);
	// An api_key row with a missing reference asks for the key, not for a sign-in.
	assert.equal(view("postgres-prod").label, "Needs a key");
	assert.equal(view("postgres-prod").tone, "warning");
	/*
	 * THE PINNED PAYLOAD'S ONE IDLE `stored` ROW, and it is the case Q1 turned
	 * on: `filesystem` carries a `last_seen` count, so the page says what that
	 * count supports - it worked, and no time is claimed because the backend
	 * publishes none - instead of decaying to the idle word. This assertion runs
	 * on a row the backend ACTUALLY SENDS, which is the correction the QA round
	 * asked for: the round-2 test proved the reload path on a `stored` row with a
	 * `status_observed_at` the backend never sets, and passed for that reason.
	 */
	assert.equal(
		view("filesystem").label,
		// "1 d", not "1 day": `relativeTime` abbreviates its unit everywhere, and
		// this reading goes through the same helper as "Worked 6 min ago".
		"Worked 1 d ago · 5 tools",
		"#1536 publishes WHEN the last-seen count was taken, so the row states the age instead of the vaguer 'Worked earlier'",
	);
	assert.equal(view("filesystem").tone, "success");
	// A row with NO count has no such evidence, so it stays idle - "Ready" is
	// then the honest word rather than a claim about work it may never have done.
	assert.equal(view("borrowed-github").label, "Ready");
	assert.equal(view("borrowed-github").tone, "neutral");
	// A failure says what went wrong, in the backend's own sanitized words.
	assert.equal(view("acme-broken").label, "Couldn't start");
	assert.equal(view("acme-broken").tone, "danger");
	// The backend's own sanitized sentence, verbatim: a reason, not a category,
	// and the whole point of the state (N4).
	assert.equal(
		view("acme-broken").detail,
		"the server exited with code 1 before completing a handshake",
	);

	for (const row of rows) {
		const derived = m.integrationStatus(row, document_.operations);
		assert.ok(derived.label.length > 0, `row ${row.name}: empty label`);
		for (const text of [derived.label, derived.detail].filter(Boolean))
			assert.doesNotMatch(text, wire, `row ${row.name}: wire word in ${text}`);
	}
});

test("the payload's actions produce one primary action per row, never a dead end", () => {
	const primary = (name) =>
		m.primaryAction(rows.find((row) => row.name === name));
	// A sign-in is offered because the backend offered it.
	assert.equal(
		primary("linear"),
		null,
		"a running operation has no action to press twice",
	);
	assert.equal(
		m.primaryAction(
			{ ...rows.find((row) => row.name === "linear"), status: "needs_sign_in" },
			[],
		).kind,
		"sign_in",
	);
	// A connected row leads with NO action, as the audit's table specifies; its
	// Test lives in the overflow.
	assert.equal(primary("github"), null);
	assert.equal(
		m.overflowItems(rows.find((row) => row.name === "github")).at(0).kind,
		"test",
	);
	assert.equal(primary("postgres-prod").kind, "set_key");
	/*
	 * D1: a row that HAS been checked leads with nothing, and its Test is in the
	 * overflow beside the connected row's - a column of identical outlined Test
	 * buttons on idle rows was the audit's complaint.
	 */
	assert.equal(primary("filesystem"), null);
	assert.equal(
		m.overflowItems(rows.find((row) => row.name === "filesystem"))[0].kind,
		"test",
		"the action is still one press away",
	);
	assert.equal(primary("acme-broken").kind, "test");
	assert.equal(primary("acme-broken").label, "Retry");
	// `borrowed-github` is a cursor row this app must not write: it may be
	// tested, and its Remove is the disabled item that says where to remove it.
	const borrowed = rows.find((row) => row.name === "borrowed-github");
	assert.ok(!borrowed.actions.includes("remove"));
	const last = m.overflowItems(borrowed).at(-1);
	assert.equal(last.kind, "remove_elsewhere");
	assert.match(last.label, /Cursor/);
});

test("the payload's rows group and read their scope/source correctly", () => {
	const groups = m.groupIntegrations(rows, document_.operations);
	assert.deepEqual(
		groups.map((group) => [group.id, group.rows.map((row) => row.name)]),
		[
			// `linear` is mid-sign-in, and it STAYS in the group the user left it
			// in rather than jumping the moment it was pressed.
			["attention", ["linear", "postgres-prod", "acme-api", "acme-broken"]],
			// `filesystem` sits with the row it shares a reading with: both say
			// they worked, one with a count the backend still stands behind.
			["connected", ["github", "filesystem"]],
			["ready", ["borrowed-github"]],
		],
	);
	// This payload has a separate project file, so scope is worth a word.
	const postgres = rows.find((row) => row.name === "postgres-prod");
	assert.deepEqual(
		m.integrationMeta(postgres, document_.project_scope_available),
		["Local command", "4 tools when last checked", "This project"],
	);
	const broken = rows.find((row) => row.name === "acme-broken");
	assert.deepEqual(
		m.integrationMeta(broken, document_.project_scope_available),
		["Local command", "Global", "Imported from Codex CLI"],
	);
	// And with no separate project file, the same rows carry no scope word.
	assert.deepEqual(m.integrationMeta(postgres, false), [
		"Local command",
		"4 tools when last checked",
	]);
});

test("the payload's running operation drives the sign-in dialog's own sentence", () => {
	const operation = document_.operations[0];
	assert.equal(operation.status, "running");
	assert.equal(operation.browser_opened, true);
	const progress = m.signInProgress(operation.name, operation, false);
	assert.match(progress.message, /Your browser opened/);
	assert.equal(progress.link, operation.authorization_url);
	// The same operation with the launcher's failure branch says the opposite,
	// which is what keeps the sentence a reading rather than a slogan.
	assert.match(
		m.signInProgress(
			operation.name,
			{ ...operation, browser_opened: false },
			false,
		).message,
		/didn't open/,
	);
});

test("a status this build does not know says so instead of claiming Ready", () => {
	const row = {
		...rows.find((row) => row.name === "filesystem"),
		status: "signed_out",
	};
	const view = m.integrationStatus(row);
	assert.equal(view.label, "Status unavailable");
	assert.notEqual(view.label, "Ready");
	assert.notEqual(view.label, "Connected");
	assert.equal(view.tone, "neutral");
	// It is offered the one control that can answer it, and it is not filed
	// under Needs attention - nothing has been observed to be wrong.
	assert.equal(m.primaryAction(row).label, "Check again");
	assert.equal(m.integrationGroupOf(row), "ready");
});
