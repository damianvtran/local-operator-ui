import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

// Reviewer M2 / QA Q1: bounding the transport made Settings terminate, but the
// user still waited ~60s. `useConfig` inherited `retry: 1` from the query
// client, so a stalled request paid the transport's ENTIRE 30s deadline, then
// paid it again. A user who gave up at 45s before the fix gives up at 45s
// after it, and reports issue 89 as unfixed.
//
// This test asserts the TIME, not merely that an error eventually appears. It
// drives the shipped transport through the real React Query retry machinery,
// with a real `window.api.desktop` bridge installed -- WITHOUT that bridge the
// renderer takes its browser-dev HTTP branch, which never calls `withDeadline`,
// so the measurement would be of a code path that does not ship.
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export { retryDesktopQuery } from "./src/renderer/src/shared/api/local-operator/backend-error";
			export { QueryClient } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const source = bundle.outputFiles[0].text;

/**
 * A fresh copy of the transport behind a REAL desktop bridge, so
 * `desktopRequest` takes the Electron IPC branch that ships rather than the
 * browser-dev `fetch` branch. A fresh copy per test keeps the module-level
 * deadline constant from leaking timer state between cases.
 */
async function loadWithBridge(request) {
	globalThis.window = { api: { desktop: { request } } };
	return import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`
	);
}

/**
 * Time how long a caller waits before it can render an actionable error,
 * fetching through React Query exactly as `useConfig` does: same retry
 * predicate, and `desktopResult`, which throws on non-2xx so the retry
 * machinery genuinely engages.
 */
async function timeToError(bridge, { retry }) {
	const { desktopResult, retryDesktopQuery, QueryClient } =
		await loadWithBridge(bridge);
	const client = new QueryClient();
	let attempts = 0;
	const started = Date.now();
	let error;
	try {
		await client.fetchQuery({
			queryKey: ["config"],
			queryFn: () => {
				attempts += 1;
				return desktopResult({ op: "config.get" });
			},
			retry: retry === "shipped" ? retryDesktopQuery : retry,
			// The client's real backoff is short next to a 30s deadline; pinning it
			// keeps the measurement about the deadline rather than about jitter.
			retryDelay: 10,
		});
	} catch (caught) {
		error = caught;
	}
	client.clear();
	return { elapsed: Date.now() - started, attempts, error };
}

/** Never answers: the exact issue-89 fault, and the shape main cannot report. */
const NEVER_REPLIES = () => new Promise(() => {});
/** A backend that answered and refused; a genuine transient worth one retry. */
const ANSWERS_503 = async () => ({
	status: 503,
	body: { detail: "The backend could not complete this request." },
});

// The budget a user is asked to wait before they are given something to do.
// Chosen against the transport's own 30s deadline plus headroom for the
// rejection to propagate, NOT against the ~60s the retry used to cost.
const ACTIONABLE_WITHIN_MS = 35000;

test("a stalled config load reaches an actionable error within one deadline, not two", async () => {
	const { elapsed, attempts, error } = await timeToError(NEVER_REPLIES, {
		retry: "shipped",
	});

	assert.ok(error, "a stalled load must settle into an error a user can act on");
	// The measurement that matters: one deadline, not two. At `retry: 1` this
	// is ~60s, which is the symptom the issue was reported for.
	assert.ok(
		elapsed < ACTIONABLE_WITHIN_MS,
		`took ${elapsed}ms to reach an actionable error; budget is ${ACTIONABLE_WITHIN_MS}ms`,
	);
	// Stated separately from the time so a future change that makes the deadline
	// itself shorter cannot hide a reinstated retry.
	assert.equal(
		attempts,
		1,
		"a deadline rejection was retried: the full budget is being paid twice",
	);
	assert.equal(error.status, null);
});

test("a backend that answers is still retried, because a 503 can be transient", async () => {
	// The retry is suppressed for "we waited and heard nothing", not for
	// "something answered and refused". Dropping the retry wholesale would lose
	// a real recovery, so the predicate has to distinguish the two.
	const { attempts, error } = await timeToError(ANSWERS_503, {
		retry: "shipped",
	});

	assert.equal(attempts, 2, "a 503 from a reachable backend must still retry");
	assert.equal(error.status, 503);
});

test("the queries a user waits on actually use the predicate", async () => {
	// The timings above prove the predicate works. They do not prove anything
	// consumes it, and a query that silently inherits `retry: 1` from the client
	// default pays the doubled wait no matter how correct the predicate is.
	for (const path of [
		"src/renderer/src/shared/hooks/use-config.ts",
		"src/renderer/src/shared/api/local-operator/desktop-hooks.ts",
	]) {
		const source = await readFile(path, "utf8");
		assert.ok(
			source.includes("retry: retryDesktopQuery"),
			`${path} no longer sets retry: retryDesktopQuery, so it inherits the doubled wait`,
		);
	}
});

test("the old behaviour would have exceeded the budget", async () => {
	// The mutation check, run as a test rather than by hand: with the inherited
	// `retry: 1` the same stall pays the deadline twice and blows the budget.
	// If this ever passes, the budget is no longer measuring anything.
	const { elapsed, attempts } = await timeToError(NEVER_REPLIES, { retry: 1 });

	assert.equal(attempts, 2);
	assert.ok(
		elapsed > ACTIONABLE_WITHIN_MS,
		`the pre-fix path took ${elapsed}ms, which no longer exceeds the ${ACTIONABLE_WITHIN_MS}ms budget`,
	);
});
