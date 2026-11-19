import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * Mount the production transcript with the neighboring foot-slot suite's DOM
 * shims. A locale switch must reach memoized tool-detail owners without new
 * transcript props; mounting initially in French would miss that regression.
 * jsdom proves the live text update, not rendered geometry or visual styling.
 */
const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	localStorage: window.localStorage,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
/* `useMediaQuery` inside the working line reads the jsdom window's, not the global. */
window.matchMedia ??= shims.matchMedia;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

/*
 * The transcript reads its cross-session visibility through react-query
 * (`useCrossSessionHidden`), so the mount needs a client in scope - unseeded is
 * the fail-closed path, which is the pane this suite's states photograph
 * (nothing hidden). `@tanstack/react-query` is external to the bundle so the
 * hook inside it and the provider below share ONE copy.
 */
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const bundle = await build({
	stdin: {
		contents:
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript"; export { setLocale } from "./src/renderer/src/shared/i18n";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	/* Vite's env, read in an effect by the transcript's dev-only readout. */
	define: { "import.meta.env": "{}" },
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
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_transcript-locale-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CanonicalTranscript, setLocale } = await import(bundlePath.href);
await unlink(bundlePath);

const TS = 1_760_000_000_000;

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

const userRecord = (id) => ({
	kind: "user",
	id,
	ts: TS,
	text: "Which invoices were late last month?",
	images: [],
});

const answerRecord = (id) => ({
	kind: "assistant",
	id,
	ts: TS,
	text: "Four invoices were late: 1042, 1088, 1103 and 1177.",
	streaming: false,
	stopReason: null,
	error: false,
});

/** The call in flight, which is the state a working line is derived from. */
const runningToolRecord = (id) => ({
	kind: "tool",
	id,
	ts: TS,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "pnpm test:desktop" },
	phase: "running",
	argumentBytes: 0,
	output: null,
	isError: false,
	durationS: null,
	startedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
});

const mount = (records, over = {}) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			h(
				QueryClientProvider,
				{ client: queryClient },
				h(CanonicalTranscript, {
					transcript: transcriptOf(records),
					gate: null,
					waiting: over.waiting ?? false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: container },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
				}),
			),
		);
	});
	return {
		container,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
};

for (const [notRunKind, english, french] of [
	["execution", "Not run", "Non exécuté"],
	["skipped", "Interrupted", "Interrompu"],
]) {
	test(`${english} tool detail follows a locale change`, () => {
		act(() => setLocale("en"));
		const tool = {
			...runningToolRecord(`tool:locale:${notRunKind}`),
			phase: "done",
			notRunKind,
			notRunReason: "Synthetic locale regression fixture",
		};
		const { container, unmount } = mount([
			userRecord(`user:locale:${notRunKind}`),
			tool,
			answerRecord(`answer:locale:${notRunKind}`),
		]);
		try {
			// Open the real action group and tool, not a substitute ToolRow.
			for (let step = 0; step < 3; step += 1) {
				if (container.querySelector('[data-detail-section="not-run"]')) break;
				const buttons = [
					...container.querySelectorAll('button[aria-expanded="false"]'),
				];
				assert.ok(buttons.length, "production disclosure is available");
				act(() => buttons[0].click());
			}
			const label = () =>
				container.querySelector('[data-detail-section="not-run"] > span')
					?.textContent;
			assert.equal(label(), english, "detail starts in English");
			// Keep the mounted transcript and record identities unchanged:
			// only the real locale store notifies its subscribed components.
			act(() => setLocale("fr"));
			assert.equal(label(), french, "memoized detail follows French locale");
		} finally {
			unmount();
			act(() => setLocale("en"));
		}
	});
}
