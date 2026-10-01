import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * WHO GETS A "RETRY", AND WHO MUST NOT.
 *
 * WHY THIS FILE EXISTS RATHER THAN A FRAME. The configuration run's error states
 * all look alike on screen — a red sentence beside Dismiss — and the difference
 * that matters is not visible: on exactly ONE of them is the request still
 * outstanding. `fail()` keeps the run's id through every failure so the run
 * stays nameable (review round 1, M2), and the strip used to read that id as
 * "there is something to send again" — which put Retry on a settle-read failure,
 * a dropped transport and a refused Stop, where the request HAD been delivered
 * and pressing it would run it a second time (agent review round 2, M-new). A
 * frame cannot hold that distinction and a still cannot tell the states apart,
 * so the rule is pinned here against the REAL composer.
 *
 * WHAT IS REAL: the shipped `ConfigComposer`, `RunStrip` and `RunSummary`, the
 * `Button`/`Badge`/`Textarea` primitives and `cn`. What is faked, and only that:
 * the run handle itself, which is a plain object in every case — the states
 * under test are decisions about a value, not about a hook.
 *
 * THE SAME FILE PINS THE REFUSED STOP (UX review round 3, U1). A Stop the
 * backend refuses is not the run stopping: it used to take the error branch,
 * which dropped the live Stop control and the elapsed time and said the run had
 * stopped while its turn ran on. The rule is a store fact (the status stays
 * `running`, the id stays reachable) plus a strip fact (the sentence, with Stop
 * still there), so both are asserted here — the store directly, the strip
 * against the real component.
 *
 * WHAT IT IS NOT: evidence about pixels. jsdom has no layout engine, so nothing
 * here says where the strip sits; that is the frames' job.
 */

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/agents",
});
/*
 * jsdom's constructors are forced onto the global: Node defines `Event` and
 * friends itself, and a React tree whose events are built from Node's classes
 * fails inside the commit phase with an error that reads like a component bug.
 * The recipe is `agents-offer-dismiss.test.mjs`'s.
 */
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * THE ENVIRONMENT THE COMPOSER'S GRAPH NEEDS, now that this test mounts it: a
 * bridge that answers instead of throwing, storage for the two persisted stores,
 * a frame scheduler jsdom omits without `pretendToBeVisual`, and resize
 * observation for the docked strip's measurement. Each is a shim, not a
 * behaviour — the recipe is `agents-composer-mount.test.mjs`'s.
 */
DOM.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async (channel) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
};
const storage = new Map();
Object.defineProperty(DOM.window, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
		clear: () => storage.clear(),
		key: (index) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		},
	},
});
globalThis.localStorage = DOM.window.localStorage;
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
DOM.window.HTMLCanvasElement.prototype.getContext = () => ({
	measureText: (text) => ({ width: String(text).length * 8 }),
	font: "",
	fillText: () => {},
	clearRect: () => {},
	save: () => {},
	restore: () => {},
});
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});

const bundle = await build({
	stdin: {
		contents: [
			'export { ConfigComposer } from "./src/renderer/src/features/agents/config-run/config-composer";',
			'export { useConfigRunStore } from "./src/renderer/src/features/agents/config-run/config-run-store";',
			'export { createRoot } from "react-dom/client";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		/*
		 * `@features` IS RESOLVED NOW, and the reason is the mount: `ConfigComposer`
		 * renders `MessageInput`, which reaches `@features/chat/*` (the pickers, the
		 * aside, the status strip). Without this alias the specifier fell through to
		 * `packages: "external"` and the bundle died at import with
		 * ERR_MODULE_NOT_FOUND — the desktop suite's one failure on #740. The mount
		 * test (`agents-composer-mount.test.mjs`) resolves the same way.
		 */
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	/*
	 * EVERYTHING ELSE IS BUNDLED, which is the mount test's configuration and the
	 * only one that works once the composer's chat-side graph is in play: with
	 * `packages: "external"` those specifiers stay external and Node then refuses
	 * their CJS directory imports (`@mui/material/styles`) with
	 * ERR_UNSUPPORTED_DIR_IMPORT — a bundler-policy failure, not a product one.
	 */
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
});

/*
 * THE BUNDLE IS WRITTEN BESIDE THIS FILE AND IMPORTED BY PATH, which is the
 * pattern `agents-offer-dismiss.test.mjs` uses and the reason for it: the
 * component graph reaches bare specifiers (`react`, `clsx` through `cn`,
 * `lucide-react`), and a `data:` URL cannot resolve those — Node raises
 * ERR_UNSUPPORTED_RESOLVE_REQUEST on the first one. A dot-prefixed sibling file
 * resolves them from the repo's own `node_modules` and is removed as soon as the
 * suite finishes.
 */
const bundlePath = new URL("._agents-config-retry.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	ConfigComposer,
	useConfigRunStore,
	QueryClient,
	QueryClientProvider,
	createRoot,
} = await import(bundlePath.href);

/**
 * One run handle, in a named state.
 *
 * The four failures the store can reach are distinguished by `unsent` (and the
 * composer by `canRetry`, which the hook derives from it): only a request the
 * run never received is retryable.
 */
const handle = (overrides = {}) => ({
	enabled: true,
	disabledReason: null,
	status: "error",
	sessionId: "session-1",
	topic: "Add a reviewer that only reads tests",
	error: "The run finished, but its results could not be read.",
	stopError: null,
	draft: "Add a reviewer that only reads tests",
	setDraft: () => undefined,
	about: null,
	setAbout: () => undefined,
	touched: [],
	step: null,
	elapsed: "4s",
	activity: [],
	results: [],
	answer: "",
	start: async () => undefined,
	stop: async () => undefined,
	retry: async () => undefined,
	canRetry: false,
	dismiss: () => undefined,
	starting: false,
	attached: false,
	...overrides,
});

/*
 * EVERY MOUNT IS TRACKED SO IT CAN BE TORN DOWN (see the `after` hook below).
 * WHY THAT MATTERS ENOUGH TO KEEP A LIST: this file used to end in a module-scope
 * `process.exit(0)`, which under `node --test` runs BEFORE any registered case —
 * the file reported green without executing a single one (code review round 1,
 * B1). Removing it exposed the real problem it was hiding: the mounted composer
 * leaves handles (the transcription manager's registration, and a react-query
 * client whose garbage-collection timers outlive the test) that keep the process
 * alive after the last case, which the runner reports as a file-level timeout.
 * The cure is to close what the file opened, not to exit.
 */
const mounts = [];

const mount = async (run) => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	/*
	 * A PROVIDER, because the mounted box reads query state (the credential probe
	 * behind the recording indicator, the composer's own error boundary). One
	 * client per mount, retries off: nothing here presses a query's control.
	 */
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(ConfigComposer, {
					run,
					about: null,
					onClearAbout: () => undefined,
				}),
			),
		);
	});
	mounts.push({ root, queryClient });
	return { host, root };
};

test("a request that was never delivered offers Retry", async () => {
	const { host, root } = await mount(
		handle({
			// The sessions.message catch: the create landed, the prompt did not.
			unsent: true,
			canRetry: true,
			error:
				"The run was set up, but your request could not be sent. It is still in the box — send it again when the backend is reachable.",
		}),
	);
	assert.ok(
		host.querySelector('[data-testid="config-retry"]'),
		"Retry for an unsent request",
	);
	assert.match(host.textContent ?? "", /could not be sent/);
	await act(async () => root.unmount());
});

test("a failure that already delivered the request offers no Retry", async () => {
	/*
	 * THE THREE SHAPES M-new NAMED, each with the session id still set (which is
	 * the whole trap): a settle read that failed after the run may have written,
	 * a transport that dropped while the run is still going, and a Stop that was
	 * refused. In every one of them the request reached the run, so re-sending it
	 * is a second run of the same work.
	 */
	const shapes = [
		{
			label: "settle-read failure",
			error: "The run finished, but its results could not be read.",
		},
		{
			label: "stream failure",
			error: "The connection to the run was lost. It may still be going.",
		},
		{
			label: "stop failure",
			error: "The run could not be stopped.",
		},
	];
	for (const shape of shapes) {
		const { host, root } = await mount(
			handle({ canRetry: false, error: shape.error }),
		);
		assert.equal(
			host.querySelector('[data-testid="config-retry"]'),
			null,
			`no Retry on a ${shape.label}`,
		);
		// The error is still reported, and Dismiss is still the way out.
		assert.match(host.textContent ?? "", new RegExp(shape.error.slice(0, 24)));
		assert.ok(
			[...host.querySelectorAll("button")].some(
				(node) => node.textContent?.trim() === "Dismiss",
			),
			`Dismiss remains on a ${shape.label}`,
		);
		await act(async () => root.unmount());
	}
});

/* --------------------------------------------------------- the refused stop */

test("a refused Stop keeps the strip live and says the stop did not take", async () => {
	const { host, root } = await mount(
		handle({
			// The shape U1 was measured on: the interrupt RPC refused, the run live.
			status: "running",
			stopError: "The run did not acknowledge the request.",
			error: null,
		}),
	);
	const refused = host.querySelector('[data-testid="config-stop-refused"]');
	assert.ok(refused, "the strip says the stop was refused");
	assert.match(refused.textContent ?? "", /did not take/);
	assert.match(
		refused.textContent ?? "",
		/did not acknowledge/,
		"the refusal's own reason is shown too",
	);
	/*
	 * THE CONTROLS ARE THE POINT. The settled shape this replaced had Dismiss as
	 * its only button, which left a write-capable run with nothing that ends it.
	 */
	const buttons = [...host.querySelectorAll("button")].map((node) =>
		(node.textContent ?? "").trim(),
	);
	assert.ok(buttons.includes("Stop"), `Stop is still offered (got ${buttons})`);
	assert.ok(!buttons.includes("Dismiss"), "no Dismiss while the run is live");
	assert.match(host.textContent ?? "", /4s/, "the elapsed time keeps counting");
	await act(async () => root.unmount());
});

test("a run that finished but could not be read back does not read as a stop", async () => {
	const { host, root } = await mount(
		handle({
			status: "error",
			canRetry: false,
			error:
				"The run finished, but the agents and teams lists could not be read to describe what changed.",
		}),
	);
	const strip = host.querySelector('[data-testid="config-run-strip"]');
	assert.match(strip.textContent ?? "", /Finished with an error/);
	assert.doesNotMatch(
		strip.textContent ?? "",
		/Stopped with an error/,
		"the heading must not contradict the sentence under it (U2)",
	);
	await act(async () => root.unmount());
});

test("the store keeps a refused stop's run reachable until it settles", () => {
	const store = useConfigRunStore.getState();
	store.adopt("session-1", "Add a reviewer", null);
	useConfigRunStore.getState().settle([], "done", "");
	useConfigRunStore.getState().adopt("session-2", "Add a team", null);
	useConfigRunStore.getState().stopping();
	assert.equal(useConfigRunStore.getState().status, "stopping");
	useConfigRunStore.getState().stopFailed("refused by the rig");
	const refused = useConfigRunStore.getState();
	assert.equal(
		refused.status,
		"running",
		"a refused stop is not a stopped run",
	);
	assert.equal(refused.sessionId, "session-2", "the run stays nameable");
	assert.equal(refused.stopError, "refused by the rig");
	assert.ok(refused.startedAt, "the clock the elapsed reads is untouched");
	/*
	 * A second press starts clean, and a settled run has nothing left to refuse —
	 * without these two the sentence would outlive the situation it describes.
	 */
	useConfigRunStore.getState().stopping();
	assert.equal(useConfigRunStore.getState().stopError, null);
	useConfigRunStore.getState().stopFailed("refused again");
	useConfigRunStore.getState().settle([], "done", "answer");
	assert.equal(useConfigRunStore.getState().stopError, null);
	useConfigRunStore.getState().dismiss();
	assert.equal(useConfigRunStore.getState().stopError, null);
});

/*
 * THE TEARDOWN THE FILE OWES. Unmounting every root and unmounting the query
 * client (v5's own stop for its timers) is what lets the runner exit on its own
 * — no `process.exit`, which is the defect this hook exists to replace.
 */
after(async () => {
	for (const { root, queryClient } of mounts) {
		await act(async () => root.unmount());
		queryClient.clear();
		queryClient.unmount();
	}
});
