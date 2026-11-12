import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * A MOUNTED GENERATION CARD REPAINTS WHEN THE LANGUAGE CHANGES (S16f).
 *
 * `generation-card-labels.test.mjs` proves each label resolves through the
 * catalogue by rendering twice. That cannot catch the defect this file exists
 * for: the sound batch's words are built in the card VIEW MODEL
 * (`imageGenCardView`) and its labels in `memo` rows, so a switch only repaints
 * them if the row that builds them re-renders on the locale store. Here the real
 * `CanonicalTranscript` is MOUNTED in jsdom with a done sound-effect batch and
 * two pictures; the locale moves with no remount and the text must follow, then
 * come back. English is the control on both ends.
 *
 * Kept apart from the server-render suite because installing jsdom globals
 * changes how React and the UI libraries probe the environment.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that refuse to leave their context; not needed here.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
dom.window.Element.prototype.scrollIntoView = () => {};
// The transcript pane measures itself; jsdom has no layout, so inert observers
// stand in (nothing here asserts geometry).
class InertObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}
globalThis.ResizeObserver ??= InertObserver;
globalThis.IntersectionObserver ??= InertObserver;
globalThis.MutationObserver ??= dom.window.MutationObserver;
globalThis.matchMedia ??= () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
});
dom.window.matchMedia ??= globalThis.matchMedia;

const ROOT = process.cwd();
const built = await build({
	stdin: {
		contents: `export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
 export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
 export { MemoryRouter } from "react-router-dom";
 export { setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	"./_generation-card-locale-switch.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, built.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanonicalTranscript, EMPTY_TRANSCRIPT, MemoryRouter } = mod;

after(() => {
	// React's scheduler keeps its MessagePorts ref'd; release them so the runner
	// exits (the same teardown `locale-reactivity.test.mjs` documents).
	for (const handle of process._getActiveHandles?.() ?? []) {
		try {
			if (handle?.constructor?.name === "MessagePort") handle.close();
		} catch {
			// not ours to force
		}
	}
	dom.window.close();
});

const TS = 1_760_000_000_000;
const artifact = (index, status, error = null) => ({
	name: ["Rain", "Thunder", "Wind"][index],
	digest: null,
	duration_s: 2,
	cost_usd: 0,
	cost: { amount_usd: 0, basis: "estimated" },
	status,
	request_id: `r-${index}`,
	error,
});
const soundBatch = {
	kind: "tool",
	id: "tool:1",
	ts: TS,
	toolCallId: "call:1",
	toolName: "generate_sound_effect",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	notRunReason: null,
	notRunKind: null,
	neverSent: false,
	output: null,
	isError: false,
	durationS: 5,
	startedAt: TS,
	endedAt: TS + 5000,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	details: {
		artifacts: [
			artifact(0, "completed"),
			artifact(1, "failed", "audio_rejected: 400"),
			artifact(2, "cancelled"),
		],
		completed: 1,
		failed: 1,
		cancelled: 1,
		cost_complete: true,
	},
};

const STUB = {
	"ui.chat.canonical.sound.batch.item_status":
		"{status, select, failed {{label} fr:failed} cancelled {{label} fr:stopped} other {{label} fr:unknown}}",
	"ui.chat.canonical.sound.batch.summary":
		"fr:summary {completed, number}/{failed, number}",
	"ui.chat.canonical.sound.cost.unknown": "fr:cost-unknown",
	"ui.chat.canonical.sound.cost.estimated_zero": "fr:est-zero",
};

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

test("a mounted sound batch repaints its status words, summary and cost line on a language switch", async () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	mod.registerCatalogue("fr", STUB);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(
				h(
					QueryClientProvider,
					{ client: queryClient },
					h(
						MemoryRouter,
						null,
						h(CanonicalTranscript, {
							transcript: { ...EMPTY_TRANSCRIPT, records: [soundBatch] },
							gate: null,
							waiting: false,
							loadingOlder: false,
							onLoadOlder: async () => true,
							containerRef: { current: null },
							isSmallView: false,
							status: "live",
							failure: null,
							hydrated: true,
							onReconnect: () => {},
						}),
					),
				),
			);
		});
		const text = () => container.textContent;
		// English control: the old words are on screen.
		assert.match(text(), /Thunder · Failed/);
		assert.match(text(), /Wind · Stopped/);
		assert.match(text(), /1 completed · 1 failed · 1 cancelled\/stopped/);
		assert.match(text(), /Needs attention: Thunder; Wind/);
		assert.match(text(), /Estimated cost \$0; final charge not confirmed\./);

		await act(async () => {
			mod.setLocale("fr");
		});
		assert.match(text(), /Thunder fr:failed/);
		assert.match(text(), /Wind fr:stopped/);
		assert.match(text(), /fr:summary 1\/1/);
		assert.match(text(), /fr:est-zero/);
		for (const gone of [
			"Failed",
			"Stopped",
			"Needs attention",
			"Estimated cost",
		])
			assert.ok(!text().includes(gone), `${gone} left after the switch`);

		await act(async () => {
			mod.setLocale("en");
		});
		assert.match(text(), /Thunder · Failed/);
		assert.ok(!text().includes("fr:"), "and back to English");
	} finally {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
});
