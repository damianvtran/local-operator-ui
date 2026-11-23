/**
 * NEVER-KEYED ENGLISH IN THE RUN PANEL'S MCP REMEDIES, MONITORS AND CHECKPOINTS
 * (slice S17c).
 *
 * WHY THIS FILE EXISTS. Switching the app to French still left English on the
 * run panel: the MCP failure leads (`The sign-in could not be started`), the
 * remedy controls (`Grant account access`, `Reload`), the key-form outcomes, the
 * `N of M connected` and `N tools` tallies, the monitor row's labels, the wake
 * cadence and the checkpoint's `Turn N` fallback all came out of model tables
 * and template literals the string scanner cannot see. They now resolve through
 * `ui.chat.run_details.*` keys when they are READ, so a live locale switch
 * repaints them.
 *
 * WHAT IS ASSERTED. (1) ENGLISH IS UNCHANGED BYTE FOR BYTE: each expected value
 * below is the literal the pre-change source printed, including the raw,
 * ungrouped counts (`1000 tools`, not `1,000 tools`). (2) A synthetic marker
 * catalogue changes every one of them, so a literal that never reached the
 * catalogue stays visible as English. (3) Machine tokens inside the copy (key
 * IDs, durations) pass through untouched.
 *
 * NEGATIVE CONTROL. `S17C_CONTROL_BASE=origin/main node --test
 * scripts/i18n/run-details-mcp-copy.test.mjs` swaps the four model files for
 * their bytes at that ref, without touching HEAD. Measured on this branch: 5
 * of 7 tests fail — the marker test because the base answers English under the
 * marker catalogue, and the English tests because they call the helpers this
 * slice introduced (`mcpSettingsActionLabel`, `mcpToolCount`,
 * `mcpKeyStoreOutcome`), which the base does not export. The key-count and
 * job-cancel source pins read files the control does not swap, so they pass.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const controlBase = process.env.S17C_CONTROL_BASE;
const CONTROL_MODEL =
	/\/(?:mcp-failure|run-detail-model|checkpoint-model|use-mcp-remedy)\.ts$/;

const bundle = await build({
	plugins: controlBase
		? [
				{
					name: "pre-fix-model-control",
					setup(builder) {
						builder.onLoad({ filter: CONTROL_MODEL }, ({ path }) => ({
							contents: execFileSync(
								"git",
								["show", `${controlBase}:${relative(process.cwd(), path)}`],
								{ encoding: "utf8" },
							),
							loader: "ts",
						}));
					},
				},
			]
		: [],
	stdin: {
		// Namespaces rather than named re-exports, so the control build (whose base
		// lacks the new helpers) still bundles and fails on the assertion instead.
		contents: `
			export * as failure from "./src/renderer/src/features/chat/components/run-details/mcp-failure";
			export * as model from "./src/renderer/src/features/chat/components/run-details/run-detail-model";
			export * as remedy from "./src/renderer/src/features/chat/components/run-details/use-mcp-remedy";
			export * as checkpoint from "./src/renderer/src/features/chat/canonical/checkpoint-model";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export { DESKTOP_REFUSAL_CODE } from "./src/shared/desktop-contract";
			export { clearRegisteredCatalogues, registerCatalogue, setLocale } from "@shared/i18n";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	jsx: "automatic",
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/package.json");',
	},
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".css": "empty" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	define: { "import.meta.env": "{}" },
});
const {
	failure,
	model,
	remedy,
	checkpoint,
	DesktopControlError,
	DESKTOP_REFUSAL_CODE,
	clearRegisteredCatalogues,
	registerCatalogue,
	setLocale,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const EN = JSON.parse(
	readFileSync("src/i18n/catalogues/en/ui.chat.run_details.json", "utf8"),
);

/** The keys this slice added: every one must be reached by a marker below. */
const S17C_KEYS = Object.keys(EN).filter((key) =>
	/^ui\.chat\.run_details\.(?:mcp_failure\.lead\.|mcp_failure\.with_reason$|mcp_failure\.settings_action$|mcp\.control\.|mcp\.tool_count$|mcp\.connected_tally$|mcp_key\.(?:replace_confirmation|not_saved|saved_not_connected)|job_cancel\.|wake\.every$|wake\.cadence_finished$|wake\.cadence_remaining$|monitor\.|checkpoint\.turn_fallback$)/.test(
		key,
	),
);

/**
 * A marker catalogue: every S17c key renders `FR[<key>]` plus its arguments, a
 * shape no English sentence has. The arguments are echoed so a test can prove
 * the machine tokens arrived untouched.
 */
const MARKER = Object.fromEntries(
	S17C_KEYS.map((key) => {
		const args = [
			...new Set([...EN[key].matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1])),
		].filter((name) => !["count", "total", "remaining"].includes(name));
		return [
			key,
			`FR[${key.replace("ui.chat.run_details.", "")}]${args.map((a) => `{${a}}`).join("|")}`,
		];
	}),
);

const withLocale = (locale, catalogue, body) => {
	registerCatalogue(locale, catalogue);
	setLocale(locale);
	try {
		body();
	} finally {
		clearRegisteredCatalogues();
		setLocale("en");
	}
};

const LEADS = {
	probe: "This server's sign-in method could not be checked",
	grant: "The sign-in could not be started",
	reconnect: "The server could not be reconnected",
	reload: "This server's configuration could not be re-read",
	add: "The server could not be added",
	key: "The keys were not saved",
	status: "The sign-in status could not be refreshed",
	disconnect: "The server could not be disconnected",
	remove: "The server could not be removed",
	test: "The connection test could not be started",
};
const CONTROLS = {
	grant: "Grant account access",
	key: "Enter API key",
	reconnect: "Reconnect",
	reload: "Reload",
};
const HOUR = 3_600_000;
// No row is a problem here: the attention clause is a separate, already keyed message.
const row = (status) => ({ status, problem: false });

test("every S17c key is reached by the marker catalogue", () => {
	// 36 keys: the count the PR's key table states. A key added later without a
	// marker would make the marker tests pass on its English fallback.
	assert.equal(S17C_KEYS.length, 36);
});

test("MCP failure copy is unchanged in English", () => {
	setLocale("en");
	for (const [phase, lead] of Object.entries(LEADS))
		assert.equal(failure.MCP_FAILURE_LEAD[phase], lead, phase);
	for (const [kind, word] of Object.entries(CONTROLS))
		assert.equal(model.MCP_CONTROL_WORD[kind], word, kind);
	assert.equal(
		failure.mcpSettingsActionLabel(),
		"Open this server in Settings",
	);
	assert.deepEqual(
		failure.mcpConfigActions().map((action) => action.label),
		["Reload", "Open this server in Settings"],
	);
	const refusal = failure.mcpFailure(
		"grant",
		new DesktopControlError(
			401,
			"server words",
			undefined,
			DESKTOP_REFUSAL_CODE.rejectedCredential ??
				Object.values(DESKTOP_REFUSAL_CODE)[0],
		),
		false,
	);
	assert.match(refusal.message, /^The sign-in could not be started\. \S/);
});

test("MCP failure copy follows the active locale when it is read", () => {
	withLocale("fr", MARKER, () => {
		for (const phase of Object.keys(LEADS))
			assert.equal(
				failure.MCP_FAILURE_LEAD[phase],
				`FR[mcp_failure.lead.${phase}]`,
			);
		for (const kind of Object.keys(CONTROLS))
			assert.equal(model.MCP_CONTROL_WORD[kind], `FR[mcp.control.${kind}]`);
		assert.deepEqual(
			failure.mcpConfigActions().map((action) => action.label),
			["FR[mcp.control.reload]", "FR[mcp_failure.settings_action]"],
		);
		const refusal = failure.mcpFailure(
			"grant",
			new DesktopControlError(
				401,
				"server words",
				undefined,
				Object.values(DESKTOP_REFUSAL_CODE)[0],
			),
			false,
		);
		assert.match(
			refusal.message,
			/^FR\[mcp_failure\.with_reason\]FR\[mcp_failure\.lead\.grant\]\|/,
		);
	});
	// Back in English the same table answers English again: nothing was cached.
	assert.equal(failure.MCP_FAILURE_LEAD.grant, LEADS.grant);
});

test("key-store outcomes are unchanged in English and keep the IDs verbatim", () => {
	setLocale("en");
	const out = remedy.mcpKeyStoreOutcome;
	assert.equal(
		out(
			{ code: "replace_confirmation_required", saved_ids: [], failed_ids: [] },
			[],
		),
		"Confirm replacement of the existing shared keys before saving.",
	);
	assert.equal(
		out(
			{
				code: "replace_confirmation_required",
				saved_ids: ["A", "B"],
				failed_ids: [],
			},
			[],
		),
		"Confirm replacement of the existing shared keys before saving. Saved: A, B.",
	);
	assert.equal(
		out(undefined, ["API_KEY", "TOKEN"]),
		"Not saved: API_KEY, TOKEN. Unlock or repair the encrypted store, then retry.",
	);
	assert.equal(
		out({ code: "partial", saved_ids: ["A"], failed_ids: ["B"] }, ["A", "B"]),
		"Not saved: B. Unlock or repair the encrypted store, then retry. Saved: A.",
	);
	withLocale("fr", MARKER, () => {
		assert.equal(
			out({ code: "partial", saved_ids: ["A"], failed_ids: ["B"] }, []),
			"FR[mcp_key.not_saved_saved]B|A",
		);
	});
});

test("tallies, monitor labels and the wake cadence are unchanged in English", () => {
	setLocale("en");
	assert.equal(model.mcpToolCount(1), "1 tool");
	assert.equal(model.mcpToolCount(0), "0 tools");
	assert.equal(model.mcpToolCount(1000), "1000 tools");
	assert.equal(model.monitorClause(1), "1 monitor armed");
	assert.equal(model.monitorClause(1000), "1000 monitors armed");
	assert.equal(
		model.mcpTally([row("connected"), row("connected"), row("connecting")]),
		"2 of 3 connected",
	);
	assert.equal(model.formatWakeCadence(HOUR, null), "every 1h");
	assert.equal(
		model.formatWakeCadence(HOUR, 0),
		"every 1h · no deliveries left",
	);
	assert.equal(model.formatWakeCadence(HOUR, 3), "every 1h · 3 left");
	// A negative wire count prints as sent (the function's documented contract).
	assert.equal(model.formatWakeCadence(HOUR, -2), "every 1h · -2 left");
	const now = Date.UTC(2026, 10, 13, 12);
	const [disabled, waiting, failing] = model
		.deriveMonitors(
			[
				{
					id: "m1",
					name: "a",
					disabled: true,
					disabled_reason: "x",
					next_due_at: now + HOUR,
				},
				{ id: "m2", name: "b" },
				{
					id: "m3",
					name: "c",
					every_ms: HOUR,
					consecutive_failures: 3,
					last_check_at: now - HOUR,
				},
			],
			now,
		)
		.sort((a, b) => a.id.localeCompare(b.id));
	assert.equal(disabled.whenLabel, "disabled");
	assert.equal(waiting.whenLabel, "waiting");
	assert.equal(failing.healthLabel, "3 failed");
	assert.equal(failing.interval, "every 1h");
	assert.match(failing.lastCheckLabel, /^last check \S/);
	assert.equal(
		checkpoint.checkpointTitle({ turn: 1234, naming: { state: "pending" } }),
		"Turn 1234",
	);
});

test("tallies, monitor labels, wake cadence and checkpoint fallback follow the locale", () => {
	withLocale("fr", MARKER, () => {
		assert.equal(model.mcpToolCount(2), "FR[mcp.tool_count]2");
		assert.equal(model.monitorClause(2), "FR[monitor.armed_count]2");
		assert.equal(
			model.mcpTally([row("connected"), row("connecting")]).split(" · ")[0],
			"FR[mcp.connected_tally]1|2",
		);
		assert.equal(model.formatWakeCadence(HOUR, null), "FR[wake.every]1h");
		assert.equal(
			model.formatWakeCadence(HOUR, 0),
			"FR[wake.cadence_finished]1h",
		);
		assert.equal(
			model.formatWakeCadence(HOUR, 3),
			"FR[wake.cadence_remaining]1h|3",
		);
		const now = Date.UTC(2026, 10, 13, 12);
		const rows = model
			.deriveMonitors(
				[
					{ id: "m1", name: "a", disabled: true, next_due_at: now + HOUR },
					{ id: "m2", name: "b" },
					{
						id: "m3",
						name: "c",
						every_ms: HOUR,
						consecutive_failures: 3,
						last_check_at: now - HOUR,
					},
				],
				now,
			)
			.sort((a, b) => a.id.localeCompare(b.id));
		assert.equal(rows[0].whenLabel, "FR[monitor.disabled]");
		assert.equal(rows[1].whenLabel, "FR[monitor.waiting]");
		assert.equal(rows[2].healthLabel, "FR[monitor.failed_count]3");
		assert.equal(rows[2].interval, "FR[wake.every]1h");
		assert.match(rows[2].lastCheckLabel, /^FR\[monitor\.last_check\]\S/);
		assert.equal(
			checkpoint.checkpointTitle({ turn: 7, naming: { state: "pending" } }),
			"FR[checkpoint.turn_fallback]7",
		);
	});
});

test("the job-cancel card keys its title, body and buttons", () => {
	// A portal component with window listeners; the source pin is the honest
	// check here, and the scanner's allowance (shrink-only) pins the rest.
	const source = readFileSync(
		"src/renderer/src/features/chat/components/run-details/job-cancel-popover.tsx",
		"utf8",
	);
	for (const key of ["title", "body", "confirm", "cancelling"])
		assert.match(
			source,
			new RegExp(`t\\("ui\\.chat\\.run_details\\.job_cancel\\.${key}"`),
		);
	// Quoted-literal shapes only: the docblock names these words in prose.
	assert.doesNotMatch(
		source,
		/title = "|"Cancelling…" : "Cancel"|`The runtime asks the provider/,
	);
	assert.equal(EN["ui.chat.run_details.job_cancel.title"], "Cancel this job?");
	assert.equal(
		EN["ui.chat.run_details.job_cancel.body"],
		"The runtime asks the provider to stop “{label}”. The row says “Cancelled” only when the job settles.",
	);
});
