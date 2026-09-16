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
 * failures earn the one retry, that no panel row re-reads on focus, that
 * reopening after an expired read DOES read again (the other half of that
 * decision, since the copy tells the user to reopen), and the budget table
 * itself. The transport's real signal for a long read is not assertable from
 * here — it takes a socket held past the old budget, which is the stall in
 * `desktop-contract.test.mjs` — and freshness stays per panel in
 * `panel-queries.ts`, argued one row at a time there.
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
	desktopRequestDeadlineDetail,
	DESKTOP_DEADLINE_EXCEEDED_CODE,
} = await bundleInto(
	"panel-queries",
	`export { analyticsQueryOptions, failoversQueryOptions, infoQueryOptions, sessionReportQueryOptions } from "./${PANELS}";
	 export { DesktopControlError, desktopRequestTimeoutMs, isDeadlineExceeded } from "./src/renderer/src/shared/api/local-operator/desktop-api";
	 export { desktopRequestDeadlineMs, desktopRequestDeadlineDetail, DESKTOP_DEADLINE_EXCEEDED_CODE } from "./src/shared/desktop-contract";`,
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
		desktopRequestDeadlineDetail(
			"analytics.get",
			desktopRequestDeadlineMs("analytics.get"),
		).message,
		undefined,
		DESKTOP_DEADLINE_EXCEEDED_CODE,
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

test("the two budgets read as one table: three long ops, everything else short", () => {
	/*
	 * Literals, not a comparison against the other side.
	 *
	 * The first version of this test asserted `desktopRequestTimeoutMs(op) >
	 * desktopRequestDeadlineMs(op)`, which passes for every op by construction —
	 * one is defined as the other plus `DESKTOP_DEADLINE_MARGIN_MS` — and would
	 * keep passing at a margin of zero (review round 1, R2). The invariant it was
	 * trying to protect is real but lives elsewhere: whether the transport hands
	 * `fetch` the long signal is only observable from a real request, which is the
	 * 22 s stall in `desktop-contract.test.mjs`. What belongs HERE is the table
	 * itself, so a change to any of these numbers has to be a deliberate one.
	 */
	for (const op of ["analytics.get", "usage.get", "sessions.report"]) {
		assert.equal(desktopRequestDeadlineMs(op), 90_000, op);
		assert.equal(
			desktopRequestTimeoutMs(op),
			95_000,
			`${op}: the renderer must still be the later of the two`,
		);
	}
	for (const op of [
		"config.get",
		"capabilities",
		"info.get",
		"sessions.failovers",
		"sessions.message",
	]) {
		assert.equal(desktopRequestDeadlineMs(op), 20_000, op);
		assert.equal(desktopRequestTimeoutMs(op), 25_000, op);
	}
});

/**
 * Reopening a panel is the refresh gesture, so it has to actually read.
 *
 * This is the OTHER half of `refetchOnWindowFocus: false` (design round 1, D6):
 * the copy tells a user whose read expired to reopen the panel, and that advice
 * is only true if a mount re-reads rather than being served the failure it
 * already has in the cache. React Query's own mount path is the test here
 * (`QueryObserver.subscribe`, which is what `useQuery` does on mount), because
 * `fetchQuery` would fetch whatever the cache said.
 */
test("a panel opened after an expired read reads again, and does not wait twice", async () => {
	const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
	const { defaultQueryOptions } = await bundleInto(
		"query-client-defaults",
		`export { defaultQueryOptions } from "./src/renderer/src/shared/api/query-client";`,
	);
	let reads = 0;
	const options = {
		...analyticsQueryOptions({ days: 7, sinceMs: 0, untilMs: 1 }),
		queryFn: async () => {
			reads += 1;
			throw expired();
		},
	};
	const client = new QueryClient({ defaultOptions: defaultQueryOptions });
	/** One open: mount, wait for a settled result, unmount. */
	const open = () =>
		new Promise((resolve) => {
			const observer = new QueryObserver(client, options);
			const unsubscribe = observer.subscribe(() => {
				const result = observer.getCurrentResult();
				if (result.isFetching || result.status === "pending") return;
				unsubscribe();
				resolve(result);
			});
		});
	const first = await open();
	assert.equal(first.isError, true);
	assert.equal(reads, 1, "the expired read itself: no retry, one attempt");
	// The advice in the sentence, executed.
	const second = await open();
	assert.equal(second.isError, true);
	assert.equal(
		reads,
		2,
		"reopening after an expired read must read again, not reuse the failure",
	);
	/*
	 * `clear()` before the test ends: the app's defaults carry `gcTime: 10 min`,
	 * and a cache still holding the failed query keeps a collection timer armed,
	 * which outlives this file and hangs the runner rather than the test.
	 */
	client.clear();
});

/**
 * The `/usage` view is the fifth read on the long budget, and it inherited the
 * one default this change set removed from the other four (review round 1, R1).
 *
 * Its `retry: 0` is its own decision and stays; the focus refetch is not, and a
 * focus change re-probing every signed-in provider is a real cost rather than a
 * hypothetical one.
 */
test("the /usage read does not re-probe providers because the window was focused", async () => {
	const { usageQueryOptions } = await bundleInto(
		"usage-view",
		`export { usageQueryOptions } from "./src/renderer/src/features/chat/pickers/usage-view";`,
	);
	const options = usageQueryOptions(undefined, false);
	assert.equal(options.refetchOnWindowFocus, false);
	assert.equal(options.retry, 0, "its own decision, unchanged by this change");
});
