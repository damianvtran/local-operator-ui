/**
 * The panel reads' shared failure policy, executable.
 *
 *     node --test scripts/panel-read-policy.test.mjs
 *
 * Why this file exists. The four panel reads inherited `retry: 1` and
 * `refetchOnWindowFocus: true` from the app-wide defaults in
 * `query-client.ts`, and both defaults are wrong for a read whose cost is the
 * ledger rather than the request:
 *
 *   - a retry after the transport's own deadline re-runs the scan the daemon is
 *     STILL executing. Measured against one isolated backend with three
 *     concurrent `analytics.get` reads: 16-17.4 s each, where the same read
 *     alone answered in ~7 s;
 *   - a focus refetch re-reads a snapshot the user opened, which is what the
 *     panels' own freshness table says nothing does ("No polling anywhere.
 *     Every panel is a snapshot the user opened, refreshed by reopening").
 *
 * WHAT THIS ASSERTS. The decisions, on the shipped options objects: which
 * failures earn the one retry, and that no panel row re-reads on focus. It does
 * not assert timings — the deadlines are asserted as relationships in
 * `desktop-renderer-transport.test.mjs` (renderer vs transport) and in
 * `desktop-contract.test.mjs` (the per-op table, plus a real expired request) —
 * and it does not assert freshness, which stays per panel in the same file and
 * is argued one row at a time there.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * A real file rather than a `data:` URL, for the reason
 * `panel-info-credentials.test.mjs` states: a bare specifier cannot resolve out
 * of one. `packages: "external"` keeps `@tanstack/react-query` out of the
 * bundle; the options objects are built without calling React at all.
 */
const CACHE = join(ROOT, "node_modules/.cache/panel-read-policy");
const bundleInto = async (name, contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		loader: { ".css": "empty" },
		alias: {
			"@shared": resolve("src/renderer/src/shared"),
			"@renderer": resolve("src/renderer/src"),
			"@features": resolve("src/renderer/src/features"),
		},
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const PANELS = "src/renderer/src/features/chat/pickers/panels/panel-queries.ts";
const {
	analyticsQueryOptions,
	failoversQueryOptions,
	infoQueryOptions,
	sessionReportQueryOptions,
	DesktopControlError,
	desktopRequestTimeoutMs,
	desktopRequestDeadlineMs,
} = await bundleInto(
	"panel-queries",
	`export { analyticsQueryOptions, failoversQueryOptions, infoQueryOptions, sessionReportQueryOptions } from "./${PANELS}";
	 export { DesktopControlError, desktopRequestTimeoutMs, isDeadlineExceeded } from "./src/renderer/src/shared/api/local-operator/desktop-api";
	 export { desktopRequestDeadlineMs } from "./src/shared/desktop-contract";`,
);

/** Every panel read, named the way a failure report would name it. */
const READS = () => ({
	analytics: analyticsQueryOptions({
		days: 7,
		sinceMs: 0,
		untilMs: 1,
	}),
	info: infoQueryOptions(),
	session: sessionReportQueryOptions("123456abcdef"),
	failovers: failoversQueryOptions("123456abcdef"),
});

/**
 * The transport's own expired-read outcome, built through the shipped class.
 *
 * `status: 504` and the code together, because `isDeadlineExceeded` reads both
 * and this is the shape `desktop-transport.ts` returns for a request that ran
 * out of its budget.
 */
const expired = () =>
	new DesktopControlError(
		504,
		"The ledger read did not finish within 90 seconds, so the app stopped waiting for it.",
		undefined,
		"deadline_exceeded",
	);

test("every panel read declines to retry a read that ran out of its budget", () => {
	for (const [panel, options] of Object.entries(READS())) {
		assert.equal(
			typeof options.retry,
			"function",
			`${panel} must carry its own retry policy, not inherit the app default`,
		);
		assert.equal(
			options.retry(0, expired()),
			false,
			`${panel} must not re-run a scan the backend is still executing`,
		);
	}
});

test("every panel read still retries an ordinary failure once, and only once", () => {
	for (const [panel, options] of Object.entries(READS())) {
		// The failures a retry CAN repair: a socket that was not up yet, a
		// backend that was still starting. Same shape as the app default.
		assert.equal(
			options.retry(0, new DesktopControlError(503, "no")),
			true,
			panel,
		);
		assert.equal(
			options.retry(1, new DesktopControlError(503, "no")),
			false,
			panel,
		);
	}
});

test("no panel read re-reads its snapshot on a focus change", () => {
	for (const [panel, options] of Object.entries(READS())) {
		assert.equal(
			options.refetchOnWindowFocus,
			false,
			`${panel} is a snapshot the user opened; a focus change is not the ask`,
		);
	}
});

test("the renderer's deadline outlives the transport's for the same op", () => {
	/*
	 * The invariant the transport documents: the renderer's bound exists only for
	 * the IPC round trip that never settles, so main - the layer that knows the
	 * HTTP status - has to be the one that gives up first. Asserted per op
	 * because both sides are now sized per op: a mirror that moved on one side
	 * would leave a ledger read rejected by the renderer while main was still
	 * going to answer it.
	 */
	for (const op of [
		"analytics.get",
		"usage.get",
		"sessions.report",
		"config.get",
	]) {
		assert.ok(
			desktopRequestTimeoutMs(op) > desktopRequestDeadlineMs(op),
			`the renderer must wait longer than main for ${op}`,
		);
	}
	// And the ledger reads are the ones main's budget was moved for, so the
	// renderer's for them is necessarily the longer one of the two.
	assert.ok(
		desktopRequestDeadlineMs("analytics.get") >
			desktopRequestDeadlineMs("config.get"),
	);
});
