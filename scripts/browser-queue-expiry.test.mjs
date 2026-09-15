import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
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
	delete globalThis.window;
	delete globalThis.document;
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
		root.render(createElement(Probe));
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
		root.render(createElement(Probe));
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
	const rows = reconcileResolved([withdrawn], [], [], new Set(), now);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].kind, "withdrawn");
});
