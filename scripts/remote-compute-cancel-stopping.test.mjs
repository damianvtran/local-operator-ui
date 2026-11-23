/**
 * The Cancel button while a run is being stopped: the card and the runs dialog.
 *
 * WHY A DOM TEST. Design round 4 (D15) is about a CONTROL'S state, not a value:
 * after a press, `cancel.isPending` is true for the beat the request takes and
 * false for the rest of the window, while the run reports `stopping` until the
 * server settles it. A model test can pin the fact (`stopping: true`) but not
 * that the shipped button reads it - so this mounts the real `RemoteRunCard` and
 * the real `RemoteRunsDialog` against a stub of the desktop transport and reads
 * the `disabled` property off the rendered DOM.
 *
 * REAL: both components, their query hooks, the shared model, the English
 * catalogue, React with jsdom.
 * SUBSTITUTED: `window.api.desktop.request` (answered per test with the wire's
 * own envelope), which is the one seam a renderer has to the daemon.
 *
 * WHAT IT DOES NOT PROVE: pixels. That is the frame evidence's job.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that cannot be redefined; the DOM globals above suffice.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class SilentResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = SilentResizeObserver;
dom.window.ResizeObserver = SilentResizeObserver;
/* Radix's dialog and the app's own media hooks both ask; jsdom has neither. */
dom.window.matchMedia ??= () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});

/** The transport, answered per test: one list of requests in, one envelope out. */
const REQUESTS = [];
let answer = async () => ({
	status: 404,
	body: { error: { code: "not_found" } },
});
globalThis.window.api = {
	desktop: {
		request: async (request) => {
			REQUESTS.push(request);
			return answer(request);
		},
	},
};

const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RemoteRunCard } from "./src/renderer/src/features/remote-compute/remote-run-card";
import { RemoteRunsDialog } from "./src/renderer/src/features/remote-compute/remote-runs-list";
export function mount(container, which, props) {
	const root = createRoot(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const child =
		which === "card"
			? createElement(RemoteRunCard, props)
			: createElement(RemoteRunsDialog, props);
	root.render(
		createElement(QueryClientProvider, { client }, child),
	);
	return root;
}
`;
const ONE_REACT = /^(react|react-dom)(\/.*)?$/;
const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "rc-cancel.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "{}" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@renderer": `${process.cwd()}/src/renderer/src`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: { ".css": "empty", ".svg": "empty", ".png": "empty" },
	plugins: [
		{
			name: "one-react",
			setup(builder) {
				// One React for the bundle and the test's own `act`, or the hook
				// dispatcher belongs to a second copy and every mount throws.
				builder.onResolve({ filter: ONE_REACT }, (args) => ({
					path: args.path,
					external: true,
				}));
			},
		},
	],
	write: false,
});
const bundlePath = new URL(
	`./_remote-compute-cancel-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mount } = await import(bundlePath.href);
after(() => {
	/* jsdom's visual mode runs a rAF loop, and a query keeps its poll timer until
	 * its client is gone: closing the window is what stops the loop the runner
	 * would otherwise wait on forever. */
	dom.window.close();
	return unlink(bundlePath);
});

const { act } = await import("react");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async (rounds = 10) => {
	for (let i = 0; i < rounds; i += 1)
		await act(async () => {
			await flush();
		});
};

const RUN_ID = "9f2c1a04e7b3";
/** A run in flight, in the wire's own shape. */
const run = (over = {}) => ({
	id: RUN_ID,
	name: "fix the failing test",
	tier: "cloud_run",
	status: "running",
	started_at: Date.now() - 5_000,
	deadline_at: Date.now() + 3_600_000,
	metered_seconds: 5,
	charged_usd: 0,
	hold_usd: 0.42,
	network_id: null,
	...over,
});

/**
 * Mount, then wait for the selector the case reads.
 *
 * A FIXED NUMBER OF FLUSHES IS NOT ENOUGH: the read is a promise and Radix mounts
 * the dialog's content in its own effect, so "settle ten times" passed alone and
 * failed behind another test. This waits for the rendered fact instead, and says
 * which selector it was waiting for when it gives up.
 */
const render = async (which, props, ready) => {
	const container = document.createElement("div");
	document.body.append(container);
	let root;
	await act(async () => {
		root = mount(container, which, props);
	});
	for (let i = 0; i < 120; i += 1) {
		if (document.body.querySelector(ready)) break;
		await settle(1);
	}
	assert.ok(
		document.body.querySelector(ready),
		`the ${which} never rendered ${ready}`,
	);
	return { container, root };
};

/*
 * EVERY TEST UNMOUNTS IN A `finally`: a root left mounted keeps its poll timer,
 * and an assertion that throws is exactly when the runner would be left waiting
 * on one.
 */
const cancelButton = (container) =>
	container.querySelector(
		"[data-remote-run-cancel], [data-radient-run-cancel]",
	);

/* --------------------------------------------------------------------- card */

const RUN_ANSWER = (status) => async (request) =>
	request.op === "remote_compute.run"
		? { status: 200, body: { result: { run: run({ status }) } } }
		: { status: 404, body: { error: { code: "not_found" } } };

test("a stopping run: the app's word, in flight, and Cancel disabled", async () => {
	answer = RUN_ANSWER("stopping");
	const { container, root } = await render(
		"card",
		{
			runId: RUN_ID,
			networkName: () => null,
			onForgotten: () => undefined,
		},
		"[data-remote-run-card]",
	);
	try {
		/*
		 * THE PHASE IS READ OFF THE RENDERED CARD, not off the model: `stopping` must
		 * stay in flight, so the card carries the live phase and the clock is still
		 * running beside the word.
		 */
		const card = container.querySelector("[data-remote-run-card]");
		assert.equal(card?.getAttribute("data-remote-run-card"), "in-flight");
		const status = container.querySelector("[data-remote-run-status]");
		assert.equal(status?.textContent, "Cancelling…");
		assert.equal(status?.getAttribute("data-remote-run-status"), "stopping");
		/* Not the raw token in the mono step: a word this app wrote. */
		assert.ok(!status?.className.includes("font-mono"));
		assert.ok(container.querySelector("[data-remote-run-elapsed]"));
		/* Cancel is still the offered action, and it does not invite a second press. */
		const button = cancelButton(container);
		assert.ok(button, "the stopping run still offers Cancel");
		assert.equal(button.disabled, true);
		assert.equal(button.textContent, "Cancel");
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

test("control: a running run's Cancel is enabled", async () => {
	answer = RUN_ANSWER("running");
	const { container, root } = await render(
		"card",
		{
			runId: RUN_ID,
			networkName: () => null,
			onForgotten: () => undefined,
		},
		"[data-remote-run-card]",
	);
	try {
		assert.equal(
			container
				.querySelector("[data-remote-run-card]")
				?.getAttribute("data-remote-run-card"),
			"in-flight",
		);
		assert.equal(
			container.querySelector("[data-remote-run-status]")?.textContent,
			"Running",
		);
		const button = cancelButton(container);
		assert.ok(button);
		assert.equal(button.disabled, false);
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});

/* ------------------------------------------------------------------- dialog */

/** The dialog's `remote_compute.runs` answer, with the row this case names. */
const runsAnswer = (status) => async (request) =>
	request.op === "remote_compute.runs"
		? {
				status: 200,
				body: { result: { runs: [run({ status })], server: "ok" } },
			}
		: { status: 404, body: { error: { code: "not_found" } } };

/**
 * The dialog portals to `document.body`, so its rows are read there rather than
 * inside the mount container.
 */
const openDialog = (status) => {
	answer = runsAnswer(status);
	return render(
		"dialog",
		{
			open: true,
			onOpenChange: () => undefined,
			enabled: true,
			networkName: () => null,
		},
		"[data-radient-run-row]",
	);
};

test("the dialog's row says Cancelling… too, and its Cancel is disabled", async () => {
	const { root } = await openDialog("stopping");
	try {
		const row = document.body.querySelector("[data-radient-run-row]");
		assert.equal(row?.getAttribute("data-radient-run-row"), "in-flight");
		assert.ok(row?.textContent?.includes("Cancelling…"));
		const button = cancelButton(document.body);
		assert.ok(button, "the stopping row still offers Cancel");
		assert.equal(button.disabled, true);
	} finally {
		await act(async () => root.unmount());
	}
});

test("control: the dialog's running row has an enabled Cancel", async () => {
	const { root } = await openDialog("running");
	try {
		assert.ok(
			document.body
				.querySelector("[data-radient-run-row]")
				?.textContent?.includes("Running"),
		);
		const button = cancelButton(document.body);
		assert.ok(button);
		assert.equal(button.disabled, false);
	} finally {
		await act(async () => root.unmount());
	}
});
