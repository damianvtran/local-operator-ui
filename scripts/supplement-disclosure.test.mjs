/** Mounted shipped-row contract; only the desktop media boundary is synthetic. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"localStorage",
	"sessionStorage",
	"navigator",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"MutationObserver",
	"MouseEvent",
	"KeyboardEvent",
	"Event",
	"CustomEvent",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({
	matches: true,
	addEventListener() {},
	removeEventListener() {},
});
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
after(() => dom.window.close());
const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: [
			'export { SupplementRow } from "./src/renderer/src/features/chat/canonical/supplement-row"; export { Disclosure } from "./src/renderer/src/shared/components/ui/disclosure"; export { ComposerStatusRow } from "./src/renderer/src/features/chat/components/composer-status-row";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
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
	`./_supplement-disclosure-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(bundlePath);
});
const { SupplementRow, Disclosure, ComposerStatusRow } = await import(
	bundlePath.href
);

const TS = 1_791_000_060;
const digest = (seed) =>
	createHash("sha256").update(seed).digest("hex").slice(0, 32);
const component = (seed, title, heightHint) => ({
	attachment: digest(seed),
	title,
	source: "bench.csv rows 1-4 (tool result of bash at 10:41)",
	mime: "text/html",
	heightHint,
});
const supplement = (over) => ({
	kind: "supplement",
	ts: TS,
	anchor: "a1",
	job: "0123456789ab",
	version: 1,
	state: "done",
	files: [],
	filesMore: 0,
	more: [],
	components: [],
	error: "",
	dismissed: false,
	live: false,
	...over,
});

test("local permission is open by default, honours Hide, resets by identity and never duplicates", async () => {
	const requests = [];
	window.api = {
		desktop: {
			media: async (request) => {
				requests.push(request);
				return {
					status: 200,
					kind: "json",
					body: { html: "<!doctype html><p>Synthetic graphic</p>" },
				};
			},
		},
	};
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const record = supplement({
		components: [
			component("local-one", "Chart", 320),
			component("local-two", "Table", 320),
		],
	});
	const render = async (record, condensed) => {
		await act(async () => {
			root.render(
				h(SupplementRow, {
					record,
					sessionId: "synthetic-graphics",
					condensed,
				}),
			);
		});
	};
	const click = async (copy) => {
		const button = [...host.querySelectorAll("button")].find(
			(b) => b.textContent.trim() === copy,
		);
		assert.ok(button, copy);
		await act(async () => button.click());
	};
	const count = (selector) => host.querySelectorAll(selector).length;
	/*
	 * The viewport gate is the fetch's ONLY trigger now that the local
	 * permission defaults open: a cold slot off-screen must stay a reserved box.
	 * The callback is captured so each step says when the row is "near".
	 */
	const observers = new Set();
	globalThis.IntersectionObserver = class {
		constructor(callback) {
			this.callback = callback;
			observers.add(this);
		}
		observe() {}
		disconnect() {
			observers.delete(this);
		}
	};
	const enterViewport = () => {
		for (const observer of [...observers]) {
			observer.callback([{ isIntersecting: true }]);
		}
	};
	try {
		await render(record, true);
		assert.equal(
			count("[data-supplement-slot]"),
			1,
			"default-open budgeted head",
		);
		assert.equal(
			count("iframe"),
			0,
			"offscreen default-open slot paints no frame",
		);
		assert.equal(
			requests.length,
			0,
			"offscreen default-open issues no document request",
		);
		const reveal = [...host.querySelectorAll("button")].find(
			(button) => button.textContent.trim() === "Hide 2 graphics",
		);
		assert.ok(reveal, "the default state offers the Hide control");
		reveal.focus();
		assert.equal(reveal.getAttribute("aria-expanded"), "true");
		await click("Hide 2 graphics");
		assert.equal(count("[data-supplement-slot]"), 0);
		assert.equal(count("iframe"), 0);
		assert.ok(host.textContent.includes("Show 1 of 2 graphics"));
		await render({ ...record }, true);
		assert.equal(
			count("[data-supplement-slot]"),
			0,
			"Hide survives a re-render of the same identity",
		);
		await click("Show 1 of 2 graphics");
		assert.equal(count("[data-supplement-slot]"), 1);
		assert.equal(requests.length, 0, "opening offscreen does not fetch");
		assert.equal(
			document.activeElement,
			reveal,
			"opening does not steal trigger focus",
		);
		assert.equal(reveal.getAttribute("aria-expanded"), "true");
		assert.ok(
			host.querySelector("[data-supplement-condensed]"),
			"does not expand work",
		);
		await act(async () => enterViewport());
		assert.equal(count("iframe"), 1);
		assert.equal(requests.length, 1);
		await render(record, false);
		assert.equal(
			count("iframe"),
			1,
			"expanded work has no duplicate local body",
		);
		assert.equal(
			requests.length,
			1,
			"the work bar's expand reuses the document",
		);
		await render(record, true);
		assert.equal(
			count("iframe"),
			1,
			"collapsing work preserves explicit local permission",
		);
		assert.ok(host.textContent.includes("Hide 2 graphics"));
		await click("Show all 1 graphic");
		await act(async () => enterViewport());
		assert.equal(
			count("iframe"),
			2,
			"explicit overflow still mounts tail once",
		);
		await click("Hide 2 graphics");
		assert.equal(count("iframe"), 0);
		await click("Show 1 of 2 graphics");
		assert.equal(count("iframe"), 1, "local Hide revokes the overflow grant");
		await click("Show all 1 graphic");
		await click("Show fewer");
		assert.equal(count("iframe"), 1);
		await click("Hide 2 graphics");
		assert.equal(count("[data-supplement-slot]"), 0);
		const beforeReset = requests.length;
		/*
		 * Leave THIS identity hidden before switching, so the return below can
		 * tell reset-to-default (open) from per-identity memory (closed).
		 */
		assert.ok(host.textContent.includes("Show 1 of 2 graphics"));
		/*
		 * A replacement identity starts at the DEFAULT (open). Off-screen that
		 * still means the reserved box only: the reset is not permission to fetch.
		 */
		await render(
			{
				...record,
				job: "replacement-job",
				components: [component("new-identity", "New graphic", 320)],
			},
			true,
		);
		assert.ok(
			host.textContent.includes("Hide 1 graphic"),
			"a new identity starts open",
		);
		assert.equal(count("[data-supplement-slot]"), 1);
		assert.equal(count("iframe"), 0);
		assert.equal(
			requests.length,
			beforeReset,
			"offscreen replacement fetches nothing",
		);
		await act(async () => enterViewport());
		assert.equal(
			requests.length,
			beforeReset + 1,
			"in-view replacement fetches exactly once",
		);
		assert.equal(count("iframe"), 1);
		/*
		 * Returning to the first identity starts OPEN again: the reset is to the
		 * default, not to that identity's old Hide, so no permission is resurrected.
		 */
		await render({ ...record }, true);
		assert.ok(host.textContent.includes("Hide 2 graphics"));
		assert.equal(
			count("[data-supplement-slot]"),
			1,
			"old permission cannot resurrect",
		);
		/*
		 * The identity is `(session, anchor, job)`, not the record version: a
		 * regeneration of the same job is the same graphic to the reader, so a
		 * Hide survives it; a different job is a different supplement and opens.
		 */
		await click("Hide 2 graphics");
		await render({ ...record, version: record.version + 1 }, true);
		assert.equal(
			count("[data-supplement-slot]"),
			0,
			"a version bump of the same job keeps the Hide",
		);
		assert.ok(host.textContent.includes("Show 1 of 2 graphics"));
		await render({ ...record, job: "next-job" }, true);
		assert.ok(
			host.textContent.includes("Hide 2 graphics"),
			"a different job starts open",
		);
		assert.equal(count("[data-supplement-slot]"), 1);
	} finally {
		await act(async () => root.unmount());
		host.remove();
		globalThis.IntersectionObserver = undefined;
	}
});

test("the default-open reveal retains the viewport gate and shows document refusal in place", async () => {
	const requests = [];
	let enterViewport;
	globalThis.IntersectionObserver = class {
		constructor(callback) {
			enterViewport = () => callback([{ isIntersecting: true }]);
		}
		observe() {}
		disconnect() {}
	};
	window.api = {
		desktop: {
			media: async (request) => {
				requests.push(request);
				return {
					status: 404,
					kind: "error",
					detail: "synthetic missing document",
				};
			},
		},
	};
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		const record = supplement({
			components: [component("refused-offscreen", "Unavailable", 320)],
		});
		await act(async () =>
			root.render(
				h(SupplementRow, {
					record,
					sessionId: "synthetic-refused",
					condensed: true,
				}),
			),
		);
		assert.equal(
			host.querySelectorAll("[data-supplement-slot]").length,
			1,
			"the graphic is visible by default",
		);
		assert.equal(
			requests.length,
			0,
			"the default-open frame offscreen must not bypass the viewport gate",
		);
		await act(async () => enterViewport());
		assert.equal(requests.length, 1);
		assert.equal(host.querySelectorAll("iframe").length, 0);
		assert.ok(host.textContent.includes("Couldn't render this graphic"));
		assert.ok(
			host.textContent.includes("Hide 1 graphic"),
			"refusal leaves local close available",
		);
		await act(async () => host.querySelector("button").click());
		assert.equal(
			host.querySelectorAll("[data-supplement-slot]").length,
			0,
			"Hide still folds the refused frame",
		);
	} finally {
		await act(async () => root.unmount());
		host.remove();
		globalThis.IntersectionObserver = undefined;
	}
});

test("mixed files and graphics expose the same default-open local reveal", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		const record = supplement({
			files: [
				{
					path: "report.csv",
					name: "report.csv",
					kind: "csv",
					sizeBytes: 32,
					mtime: TS,
				},
			],
			components: [component("mixed", "Chart", 320)],
		});
		await act(async () =>
			root.render(
				h(SupplementRow, {
					record,
					condensed: true,
					sessionId: "synthetic-mixed",
				}),
			),
		);
		assert.ok(host.querySelector("[data-supplement-file]"));
		assert.ok(host.textContent.includes("Hide 1 graphic"));
		assert.equal(host.querySelectorAll("[data-supplement-slot]").length, 1);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

test("shared Disclosure controls only an existing open body, animated and ordinary", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		for (const animate of [false, true]) {
			for (const open of [false, true, false]) {
				await act(async () =>
					root.render(
						h(
							Disclosure,
							{ summary: "Shared body", open, animate },
							h("p", null, "Content"),
						),
					),
				);
				const button = host.querySelector("button");
				const controls = button.getAttribute("aria-controls");
				assert.equal(button.getAttribute("aria-expanded"), String(open));
				if (open)
					assert.ok(
						document.getElementById(controls),
						"open controls resolves",
					);
				else assert.equal(controls, null, "closed controls never dangles");
			}
		}
		await act(async () =>
			root.render(h(Disclosure, { summary: "Section", open: true })),
		);
		assert.equal(
			host.querySelector("button").getAttribute("aria-controls"),
			null,
			"contentless section has no target",
		);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

test("pending graphic has a nonvisual accessible loading status", async () => {
	window.api = { desktop: { media: async () => await new Promise(() => {}) } };
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () =>
			root.render(
				h(SupplementRow, {
					record: supplement({
						components: [component("pending-status", "Waiting chart", 320)],
					}),
					sessionId: "synthetic-pending",
					condensed: false,
				}),
			),
		);
		const status = host.querySelector("output");
		assert.ok(
			status,
			"document wait is announced, not only an aria-hidden shimmer",
		);
		assert.equal(status.textContent, "Loading graphic…");
		assert.ok(
			status.classList.contains("sr-only"),
			"visible treatment unchanged",
		);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

test("goal-chip consumer has no closed controls and resolves its open body", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	// Own the provider so this fixture can clear its query GC timers after
	// unmount, rather than retaining the optional hook's private fallback cache.
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	try {
		await act(async () =>
			root.render(
				h(
					QueryClientProvider,
					{ client },
					h(ComposerStatusRow, {
						frontend: { goal: "Ship it" },
						runDetails: null,
					}),
				),
			),
		);
		const trigger = host.querySelector(
			'button[aria-label="Expand the session goal — Ship it"]',
		);
		assert.ok(trigger, "real goal-chip trigger mounted");
		assert.equal(trigger.getAttribute("aria-expanded"), "false");
		assert.equal(trigger.getAttribute("aria-controls"), null);
		assert.equal(host.querySelector("[data-status-goal-body]"), null);
		await act(async () => trigger.click());
		assert.equal(trigger.getAttribute("aria-expanded"), "true");
		const id = trigger.getAttribute("aria-controls");
		assert.ok(id, "open consumer declares its controlled body");
		const body = document.getElementById(id);
		assert.ok(body, "open consumer's target exists");
		assert.ok(body.textContent.includes("Ship it"));
		await act(async () => trigger.click());
		assert.equal(trigger.getAttribute("aria-controls"), null);
		assert.equal(document.getElementById(id), null);
	} finally {
		await act(async () => root.unmount());
		client.clear();
		host.remove();
	}
});
