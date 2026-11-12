import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Source-only proof of the reason-code routing. It cannot prove the panel that
// renders the line, the service that emits the code, or a rendered frame; the
// hub-links scene and independent QA own those.
const bundled = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agents/hub-link-copy";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	logLevel: "silent",
	// `hub-link-copy` imports `t` from `@shared/i18n`, so the alias the sibling
	// hub suites use has to resolve here too.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const { hubReasonText, hubMarkFailureDetail } = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

/*
 * `alias-occupied` means an unowned local skill already holds the alias. It is
 * not a lineage conflict, so it must not render the mixed-lineage sentence that
 * `origin-conflict` uses; it names the local collision and the choice instead.
 */
test("alias-occupied names the occupied local alias", () => {
	assert.equal(
		hubReasonText("alias-occupied"),
		"That local alias is already used. Choose another.",
	);
});

test("alias-occupied with service detail resolves to the same sentence", () => {
	assert.equal(
		hubReasonText("alias-occupied/some/detail"),
		"That local alias is already used. Choose another.",
	);
});

test("origin-conflict still reports merge lineage", () => {
	assert.equal(
		hubReasonText("origin-conflict"),
		"This copy includes changes from another source. Automatic publication is paused.",
	);
});

/*
 * Operator report 2026-11-11: the collapsed failed mark said only "Retry
 * Incoming update for <team> at <source>". Its tooltip tail now carries the
 * service's own reason and when it was last checked, so a snapshot kept since
 * startup reads as old rather than current.
 */
const direction = (over) => ({
	state: "failed",
	classification: null,
	enabled: true,
	last_checked_at: null,
	last_success_at: null,
	attempts: 0,
	next_retry_at: null,
	error_class: null,
	error_subclass: null,
	safe_message: null,
	operation_id: null,
	model_used: null,
	summary: {},
	backup_receipt: null,
	...over,
});

test("a healthy direction adds nothing to the mark tooltip", () => {
	assert.equal(hubMarkFailureDetail(direction({ state: "idle" })), "");
});

test("a rejected sign-in names the hub's reason and the check time", () => {
	const detail = hubMarkFailureDetail(
		direction({
			error_class: "no-credential",
			error_subclass: "rejected",
			safe_message:
				"the hub did not accept the sign-in (HTTP 401: invalid API key format)",
			last_checked_at: "2026-11-11T15:55:16Z",
		}),
	);
	assert.match(
		detail,
		/^Reason: the hub did not accept the sign-in \(HTTP 401: invalid API key format\) Last checked: .+$/,
	);
	assert.ok(!detail.includes("2026-11-11T15:55:16Z"), "the time is formatted");
});

test("a failure with no stored sentence falls back to the translated class", () => {
	assert.equal(
		hubMarkFailureDetail(direction({ error_class: "no-credential" })),
		"Sign in to the hub before trying this action.",
	);
});
