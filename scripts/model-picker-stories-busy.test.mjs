import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE MODEL PICKER'S BUSY-RETRY STORIES, RUN — not just compiled.
 *
 * Why this file exists: `scripts/model-switch-busy-resend.test.mjs` proves the
 * repeat at the module seam, but the stories are where the picker's REAL
 * composition is pinned, and nothing in CI runs a story's `play`. Round 1 shipped
 * a retry that left `AckTimeoutIndeterminate` and `AckTimeoutNotApplied` asserting
 * `mutations=1` inside the default one-second `waitFor`: the frames settled at
 * `mutations=4` after ~6 s of waits, both stories were red, and CI was green
 * because no lane executes a play. Design found it by hand (round 1, D1).
 *
 * So this harness mounts the SHIPPED stories module in jsdom and runs the
 * shipped `render` + `play` pairs. It fakes nothing about the assertions: a
 * stale expectation in the stories is a failure here, which is the property the
 * round-1 defect lacked. What it does NOT claim is pixels — jsdom lays nothing
 * out, so screenshots remain the design lane's evidence.
 *
 * The transport is not stubbed HERE either: the stories install their own
 * (`window.api.desktop.request`), so what runs is the picker's production path
 * over the story's fixture backend.
 */

/* --------------------------------------------------------------- jsdom */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Node",
	"SVGElement",
	"Event",
	"MouseEvent",
	"KeyboardEvent",
	"CustomEvent",
	"MutationObserver",
	"NodeFilter",
	"HTMLInputElement",
	"localStorage",
	"navigator",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"ResizeObserver",
]) {
	if (dom.window[key] === undefined) continue;
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value:
			typeof dom.window[key] === "function" && key.startsWith("request")
				? dom.window[key].bind(dom.window)
				: dom.window[key],
	});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * jsdom implements no `PointerEvent`, and the stories' `pickRow` hovers and
 * clicks a row with `userEvent`. MouseEvent under that type is the shim this
 * repo's other component suites use for the same reason; the picker's row
 * listens on `pointerover`/`mouseover`/`mousedown`, none of which read pointer
 * properties.
 */
if (!dom.window.PointerEvent) {
	Object.defineProperty(dom.window, "PointerEvent", {
		configurable: true,
		value: dom.window.MouseEvent,
	});
	globalThis.PointerEvent = dom.window.MouseEvent;
}

const { act } = await import("react");
const { createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { MemoryRouter } = await import("react-router-dom");

/* --------------------------------------------------------------- bundle */

/*
 * `@storybook/test` stays EXTERNAL. It binds `screen` to `document.body` when it
 * is first evaluated, so it must be imported after the jsdom globals above exist
 * — which is exactly what leaving it out of the bundle buys: the bundle imports
 * it at load time, and the bundle is loaded from here, after this file's setup.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/pickers/model-picker.stories";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@renderer": "./src/renderer/src",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty", ".woff": "empty", ".woff2": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
		"react-router-dom",
		"@tanstack/react-query",
		"@storybook/test",
	],
});

/*
 * WRITTEN OUTSIDE THE TRACKED TREE (review round 2, nit). `scripts/` is tracked, so
 * an artifact left by a lane that dies between the write and the import would show
 * up as an untracked file in a tree-clean check. `node_modules` is ignored
 * wholesale, and a bundle written there still resolves bare specifiers by walking
 * up to the repository's own `node_modules`.
 */
const bundleDir = join(process.cwd(), "node_modules", ".cache");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `_model-picker-stories-${process.pid}.mjs`);
const bundleUrl = pathToFileURL(bundlePath).href;
await writeFile(bundlePath, bundle.outputFiles[0].text);
/*
 * THE ARTIFACT IS ALSO REAPED ON EXIT. The `finally` below only runs if this
 * process gets as far as the import; a run that fails to build, or one killed
 * between the write and the import (a bounded harness, a cancelled QA lane),
 * leaves the bundle behind — measured in `scripts/` before the path moved to
 * `node_modules/.cache`, and the reason
 * this handler exists rather than the `finally` alone.
 */
process.once("exit", () => {
	try {
		rmSync(bundlePath, { force: true });
	} catch {
		/* An exit path must not mask the failure it is running past. */
	}
});

let stories;
try {
	stories = await import(bundleUrl);
} finally {
	await unlink(bundlePath);
}

const REACT_QUERY_OPTIONS = {
	defaultOptions: { queries: { retry: false, gcTime: 0 } },
};

/**
 * Run one story's shipped `render` and `play` in a fresh root.
 *
 * The root is unmounted between stories so one frame's timers, queries and
 * installed bridge cannot answer for the next one.
 */
const runStory = async (name) => {
	const story = stories[name];
	assert.ok(story, `the story module exports ${name}`);
	assert.equal(typeof story.play, "function", `${name} carries a play`);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const client = new QueryClient(REACT_QUERY_OPTIONS);
	try {
		await act(async () => {
			root.render(
				h(
					QueryClientProvider,
					{ client },
					h(MemoryRouter, null, story.render()),
				),
			);
		});
		/*
		 * THE PLAY RUNS OUTSIDE `act`. Wrapped, testing-library's own `waitFor`
		 * (inside `@storybook/test`) lands in a nested act and the catalogue query's
		 * resolution never reaches the DOM — measured, `findAllByRole("option")`
		 * timed out over a list that a later act-flushed tick rendered with twelve
		 * rows. The act warnings that follow are the price of running the real
		 * play; they are warnings, not assertions.
		 */
		await story.play();
	} finally {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		client.clear();
		document.body.replaceChildren();
	}
};

/* ---------------------------------------------------------------- cases */

test("a lost ACK whose frame landed is CONFIRMED, and the repeat stops", async () => {
	/*
	 * One dispatch, no snapshot read, no note. Before design round 1's D3 this
	 * story ran the whole repeat (four attempts, ~6 s) and reported the switch as
	 * unconfirmed over a session already on it — the contradiction design found in
	 * the header/footer pair.
	 */
	await runStory("AckTimeoutConfirmedByFrame");
});

test("a switch that never landed reports the indeterminate register after the bounded repeat", async () => {
	/* Four attempts derived from the shipped bound, one read, one honest note. */
	await runStory("AckTimeoutNotApplied");
});

test("a busy owner that clears is confirmed on a SECOND, differently-identified attempt", async () => {
	/*
	 * The win the repeat exists for, and the one fact a screenshot cannot show:
	 * the second attempt's request id differs from the first, because a reused id
	 * would be the receipt journal's indeterminate 409 rather than a retry.
	 */
	await runStory("BusyThenConfirmed");
});

test("the unconfirmed lock stays locked, and the resolved arm still resolves", async () => {
	await runStory("UnconfirmedDefaultPending");
	await runStory("UnconfirmedDefaultFailed");
	await runStory("UnconfirmedDefaultCold");
	await runStory("UnconfirmedDefaultResolved");
});

test("an unreachable owner is not repeated", async () => {
	/* `runtime_unreachable` is not a busy refusal: one attempt, one read. */
	await runStory("DisconnectedOwnerUnconfirmed");
});

/*
 * DURABLE SETTINGS INTENTS (`features.settings_intents`). With the capability a
 * pick is a POST the dialog does not wait on; without it (the `Busy` story,
 * whose bridge advertises nothing) the picker is today's synchronous switch,
 * footer wait and all - the byte-for-byte fallback the capability gate promises.
 */
test("with settings intents a pick POSTs, closes at once and shows the queued chip", async () => {
	await runStory("IntentQueued");
});

test("a failed intent offers Retry, which resends the same value under a new request id", async () => {
	await runStory("IntentFailedRetry");
});

test("picks on three sessions in a row never wait on the first one's answer", async () => {
	await runStory("IntentBurstAcrossSessions");
});

test("without the capability the picker keeps today's synchronous switch", async () => {
	await runStory("Busy");
});
