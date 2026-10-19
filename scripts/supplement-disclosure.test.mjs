/** Mounted shipped-row contract; only the desktop media boundary is synthetic. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
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
			'export { SupplementRow } from "./src/renderer/src/features/chat/canonical/supplement-row"; export { Disclosure } from "./src/renderer/src/shared/components/ui/disclosure";',
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
const { SupplementRow, Disclosure } = await import(bundlePath.href);

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

test("local permission is closed/fetch-free, persists across work folds, resets by identity and never duplicates", async () => {
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
	try {
		await render(record, true);
		assert.equal(count("[data-supplement-slot]"), 0);
		assert.equal(count("iframe"), 0);
		assert.equal(requests.length, 0);
		const reveal = [...host.querySelectorAll("button")].find(
			(button) => button.textContent.trim() === "Show 1 of 2 graphics",
		);
		reveal.focus();
		assert.equal(reveal.getAttribute("aria-expanded"), "false");
		await click("Show 1 of 2 graphics");
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
		assert.equal(count("[data-supplement-slot]"), 1, "only the budgeted head");
		assert.equal(count("iframe"), 1);
		assert.equal(requests.length, 1);
		await render(record, false);
		assert.equal(
			count("iframe"),
			1,
			"expanded work has no duplicate local body",
		);
		await render(record, true);
		assert.equal(
			count("iframe"),
			1,
			"collapsing work preserves explicit local permission",
		);
		assert.ok(host.textContent.includes("Hide 2 graphics"));
		await click("Show all 1 graphic");
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
		await click("Show 1 of 2 graphics");
		const beforeReset = requests.length;
		await render(
			{
				...record,
				job: "replacement-job",
				components: [component("new-identity", "New graphic", 320)],
			},
			true,
		);
		assert.ok(host.textContent.includes("Show 1 graphic"));
		assert.equal(count("[data-supplement-slot]"), 0);
		assert.equal(count("iframe"), 0);
		assert.equal(
			requests.length,
			beforeReset,
			"identity reset never fetches replacement document",
		);
		await render(record, true);
		assert.equal(count("iframe"), 0, "old permission cannot resurrect");
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

test("local reveal retains the viewport gate and shows document refusal in place", async () => {
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
		await act(async () => host.querySelector("button").click());
		assert.equal(host.querySelectorAll("[data-supplement-slot]").length, 1);
		assert.equal(host.querySelectorAll("iframe").length, 0);
		assert.equal(
			requests.length,
			0,
			"opening offscreen must not bypass viewport gate",
		);
		await act(async () => enterViewport());
		assert.equal(requests.length, 1);
		assert.equal(host.querySelectorAll("iframe").length, 0);
		assert.ok(host.textContent.includes("Couldn't render this graphic"));
		assert.ok(
			host.textContent.includes("Hide 1 graphic"),
			"refusal leaves local close available",
		);
	} finally {
		await act(async () => root.unmount());
		host.remove();
		globalThis.IntersectionObserver = undefined;
	}
});

test("mixed files and graphics expose the same closed local reveal", async () => {
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
		assert.ok(host.textContent.includes("Show 1 graphic"));
		assert.equal(host.querySelectorAll("[data-supplement-slot]").length, 0);
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
