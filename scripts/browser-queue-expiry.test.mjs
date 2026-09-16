import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { StrictMode, act, createElement } from "react";
// React DOM feature-detects its host at import time, so the document has to exist
// before it is loaded (the same bootstrap `suggestion-stack-react.test.mjs` uses).
const bootstrapDOM = new JSDOM("<!doctype html>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.requestAnimationFrame = (callback) =>
	bootstrapDOM.window.setTimeout(() => callback(Date.now()), 0);
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	// `Reflect.deleteProperty` rather than `delete`, which the lint contract forbids:
	// the property has to be genuinely gone, not set to `undefined`, so a later
	// import in the same process does not inherit this file's document.
	Reflect.deleteProperty(globalThis, "window");
	Reflect.deleteProperty(globalThis, "document");
});

/*
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT `browser-chrome.test.mjs`.
 *
 * QA's round-2 Q3 found that a request which dies of its own ten-minute TTL while
 * the user watches drops the badge but produces no resolved row until some
 * unrelated change pushes a projection — "the count changed and nothing said why",
 * at the one moment expiry creates. The fix is a second trigger on the hook: the
 * same reconcile now also runs on the tick that already moves `now`.
 *
 * The neighbour file renders with `renderToStaticMarkup`, where EFFECTS DO NOT RUN,
 * so it can prove the reconcile's rule and cannot prove that anything calls it on a
 * tick. This file runs the real hook, with real effects and a real interval, under
 * jsdom, and asserts the row appears with no new props: the trigger is the clock,
 * which is the whole of the finding.
 */
const PROBE = `
	import { createElement, useEffect, useRef, useState } from "react";
	import { useApprovalQueue, reconcileResolved, liveRequests } from "./src/renderer/src/features/browser/model/approval-queue-model";

	/*
	 * The hook under test, reporting its model on every render. The parent never
	 * changes the props after the first render: any resolved row that appears came
	 * from the renderer's own clock.
	 */
	export function renderQueueProbe(requests, tabs, onModel) {
		const Probe = () => {
			const model = useApprovalQueue(requests, tabs);
			useEffect(() => {
				onModel(model);
			});
			return null;
		};
		return Probe;
	}

	export { reconcileResolved, liveRequests };
`;

const bundle = await build({
	stdin: { contents: PROBE, resolveDir: process.cwd(), loader: "tsx" },
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
});
const bundlePath = new URL(
	`./_queue-expiry-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { renderQueueProbe, reconcileResolved } = await import(bundlePath.href);
await unlink(bundlePath);

/*
 * THE APP MOUNTS ITSELF STRICT (`src/renderer/src/main.tsx`), so the probe renders
 * strict here too: an updater may be applied to the same base state more than once,
 * and anything that is not pure shows up only in that mount. That is how the
 * round-4 finding was reachable at all — the previous version of this file rendered
 * WITHOUT StrictMode, and the fix it was testing for a row that a strict build
 * never rendered.
 */
const renderProbe = (Probe) =>
	createElement(StrictMode, null, createElement(Probe));

const request = (overrides) => ({
	entryId: "entry-1",
	origin: "https://ttl.example",
	authority: "ttl.example",
	expiresAt: Date.now() + 300,
	requestedAt: Date.now(),
	requesterSessionId: "session-a",
	...overrides,
});

test("a request that dies of its TTL resolves on the renderer's tick, with no new projection", async () => {
	const reports = [];
	const host = bootstrapDOM.window.document.createElement("div");
	bootstrapDOM.window.document.body.appendChild(host);
	const root = createRoot(host);

	// One live request with a 300ms TTL, and a prop set that never changes again.
	const requests = [request({})];
	const Probe = renderQueueProbe(requests, [], (model) => reports.push(model));
	await act(async () => {
		root.render(renderProbe(Probe));
	});

	const first = reports.at(-1);
	assert.equal(first.count, 1, "the request is live on the first render");
	assert.deepEqual(first.resolved, [], "and nothing has resolved yet");

	// Nothing touches the app: no new props, no IPC, no user. Only the clock moves.
	const settled = await new Promise((resolve) => setTimeout(resolve, 1600));
	void settled;

	const last = reports.at(-1);
	assert.equal(
		last.count,
		0,
		"the badge falls on the renderer's own clock, as §3.4 says it does",
	);
	assert.equal(
		last.resolved.length,
		1,
		"and the row that explains it is there",
	);
	assert.equal(last.resolved[0].kind, "expired");
	assert.equal(last.resolved[0].authority, "ttl.example");

	await act(async () => {
		root.unmount();
	});
	host.remove();
});

test("a live request is never reported as resolved, however often the tick runs", async () => {
	const requests = [request({ expiresAt: Date.now() + 60_000 })];
	const reports = [];
	const host = bootstrapDOM.window.document.createElement("div");
	bootstrapDOM.window.document.body.appendChild(host);
	const root = createRoot(host);
	const Probe = renderQueueProbe(requests, [], (model) => reports.push(model));
	await act(async () => {
		root.render(renderProbe(Probe));
	});
	await new Promise((resolve) => setTimeout(resolve, 1600));
	const last = reports.at(-1);
	assert.equal(last.count, 1);
	assert.deepEqual(
		last.resolved,
		[],
		"the clock term is bounded by the entry's own expiresAt",
	);
	await act(async () => {
		root.unmount();
	});
	host.remove();
});

test("the reconcile's rule is unchanged for a departure: withdrawal stays a withdrawal", () => {
	const now = Date.now();
	const withdrawn = request({ expiresAt: now + 60_000 });
	const rows = reconcileResolved(
		[withdrawn],
		[],
		[],
		new Set(),
		new Set(),
		now,
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].kind, "withdrawn");
});

/*
 * THE ROW IS EXPLAINED ONCE, NOT ONCE PER RETENTION WINDOW (review round 3, MAJOR).
 *
 * Main keeps a dead entry in the projection until some unrelated change arrives, and
 * the interval that moves `now` runs for as long as ANY request is live. So a surface
 * whose de-dupe memory was derived from the retention-pruned `resolved` state
 * re-resolved the same entry every five minutes — a fresh `at` each time — for as
 * long as another request kept the clock alive, and re-announced it each time,
 * because the surface renders these rows inside `aria-live="polite"`. A stale
 * "expired" row on a five-minute loop is worse than a missing one.
 *
 * How the clock is moved: `Date.now` is the module's clock (`now` comes from
 * `Date.now()` in the hook, not from a timer's own reading), so the test holds the
 * clock in a variable, jumps it by more than `RESOLVED_RETENTION_MS`, and lets the
 * REAL interval fire. Nothing else about the app changes: same props, same entry in
 * the projection.
 *
 * This is the assertion that fails on the pre-fix code: the row's `at` is what a reset
 * looks like, and a pruned-then-re-added memory is the only thing that produces one.
 */
test("a stale entry is resolved once, not again every retention window", async () => {
	const realNow = Date.now;
	const startedAt = realNow();
	// The clock tracks real time so the first phase is an ordinary TTL, and `offset`
	// is what the jump adds on top of it.
	let offset = 0;
	Date.now = () => realNow() + offset;
	try {
		const reports = [];
		const host = bootstrapDOM.window.document.createElement("div");
		bootstrapDOM.window.document.body.appendChild(host);
		const root = createRoot(host);

		const requests = [
			// Dies almost immediately, and stays in the projection afterwards: main's
			// dead entries are removed by the next unrelated change, not by the clock.
			request({ entryId: "expiring", expiresAt: startedAt + 200 }),
			// Long-lived, and it is why the interval keeps ticking after the first row
			// appears — the condition the finding needs.
			request({
				entryId: "keeper",
				authority: "keeper.example",
				expiresAt: startedAt + 60 * 60_000,
			}),
		];
		const Probe = renderQueueProbe(requests, [], (model) =>
			reports.push(model),
		);
		await act(async () => {
			root.render(renderProbe(Probe));
		});

		// One real interval tick past the TTL: the row, with the `at` the surface first
		// explained it with.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1400));
		});
		const first = reports.at(-1);
		assert.equal(first.resolved.length, 1, "the expiry is explained once");
		const firstAt = first.resolved[0].at;

		// Now jump past the retention window with the interval still running, which is
		// exactly what an hour on a quiet surface looks like.
		offset += 301_000;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 2400));
		});

		/*
		 * THE ENTRY IS STILL IN THE PROJECTION HERE — nothing removed it — and the row is
		 * gone, which is retention doing its bounded job rather than the memory doing
		 * anything. What must NOT happen is the row coming back: `length === 1` with an
		 * `at` of `after` is the defect, and it is what the pre-fix derivation produced
		 * (the row is pruned from `resolved`, so its key leaves the de-dupe set, so the
		 * arm that reads the projection resolves it again). Asserting the empty list is
		 * asserting the absence of the loop, on a tick that did happen.
		 */
		const after = reports.at(-1);
		assert.equal(
			after.resolved.length,
			0,
			"the pruned row is not re-resolved from the projection",
		);
		assert.ok(
			after.now - firstAt >= 300_000,
			"and the window genuinely elapsed, so the prune above is retention's and not a clock that stalled",
		);
		// One more tick, in case the re-resolution lags a render behind the prune.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1200));
		});
		assert.equal(
			reports.at(-1).resolved.length,
			0,
			"and it does not arrive a tick later either",
		);

		await act(async () => {
			root.unmount();
		});
		host.remove();
	} finally {
		Date.now = realNow;
	}
});
