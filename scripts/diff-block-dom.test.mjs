/**
 * Diff disclosure regressions from PR #1824's review. Mount the shipped component
 * so node identity/focus and its layout-effect scroll correction are exercised,
 * not a second implementation. jsdom has no layout; explicit rectangles below
 * model the canonical reverse scroller. The bounded story proves real geometry.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
});
const originals = new Map();
for (const [key, value] of Object.entries({
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
const bundle = await build({
	stdin: {
		contents: [
			'export { DiffBlock } from "./src/renderer/src/features/chat/components/trace/diff-block";',
			'export { setLocale } from "./src/renderer/src/shared/i18n";',
			'export { createElement, act } from "react";',
			'export { createRoot } from "react-dom/client";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@renderer": "./src/renderer/src",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	tsconfig: "tsconfig.app.json",
});
const bundlePath = new URL(
	`./_diff-block-dom-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	DiffBlock,
	setLocale,
	createElement: h,
	act,
	createRoot,
} = await import(bundlePath.href);
await unlink(bundlePath);
setLocale("en");
after(() => {
	dom.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});
const diff = [
	"--- ",
	"+++ ",
	...Array.from({ length: 100 }, (_, i) => `${i % 2 ? "+" : "-"}line ${i}`),
];
async function mount(props = {}) {
	const scroller = document.createElement("div");
	scroller.dataset.loCanonicalTranscript = "true";
	scroller.setAttribute("role", "log");
	document.body.append(scroller);
	const root = createRoot(scroller);
	await act(() => root.render(h(DiffBlock, { diff, ...props })));
	return {
		scroller,
		button: scroller.querySelector("button"),
		well: scroller.firstElementChild,
		async close() {
			await act(() => root.unmount());
			scroller.remove();
		},
	};
}

test("R1-1: one focused toggle survives expand and collapse", async () => {
	const view = await mount();
	try {
		view.well.scrollIntoView = () => {};
		view.button.focus();
		assert.ok(
			document.activeElement === view.button,
			"toggle retains keyboard focus",
		);
		for (const expanded of [true, false, true, false]) {
			await act(() => view.button.click());
			assert.ok(
				view.scroller.querySelector("button") === view.button,
				"one persistent toggle node",
			);
			assert.ok(
				document.activeElement === view.button,
				"toggle retains keyboard focus",
			);
			assert.equal(view.button.getAttribute("aria-expanded"), String(expanded));
			assert.equal(
				view.scroller.querySelectorAll("[data-diff-line]").length,
				expanded ? 100 : 40,
			);
			assert.equal(
				view.button.textContent,
				expanded ? "Show less" : "… 60 more diff lines",
			);
		}
	} finally {
		await view.close();
	}
});

test("U1 / R1-3: expand anchors line 41, collapse returns the well to view", async () => {
	const view = await mount();
	const prototype = dom.window.HTMLElement.prototype;
	const oldRect = prototype.getBoundingClientRect;
	let collapsedIntoView;
	try {
		view.scroller.scrollTop = 0;
		prototype.getBoundingClientRect = function () {
			// Real reverse scrolling moves the new line far above the old toggle.
			const top =
				this === view.scroller
					? 20
					: this === view.button
						? 520
						: this.dataset.diffLine === "40"
							? -500
							: 0;
			return {
				top,
				bottom: top + 18,
				height: 18,
				left: 0,
				right: 400,
				width: 400,
			};
		};
		view.well.scrollIntoView = (options) => {
			collapsedIntoView = options;
		};
		await act(() => view.button.click());
		assert.equal(
			view.scroller.scrollTop,
			-1020,
			"correct negative scrollTop by new-line minus old-button top",
		);
		await act(() => view.button.click());
		assert.deepEqual(collapsedIntoView, { block: "nearest" });
	} finally {
		prototype.getBoundingClientRect = oldRect;
		await view.close();
	}
});

test("D1-D4: start alignment, inset label focus, persistent affordance and truncation", async () => {
	const view = await mount({ truncatedRows: 494 });
	try {
		view.well.scrollIntoView = () => {};
		for (const expanded of [false, true, false]) {
			if (view.button.getAttribute("aria-expanded") !== String(expanded))
				await act(() => view.button.click());
			assert.ok(
				view.well.textContent.includes(
					"Diff truncated — 494 more lines not recorded",
				),
			);
			assert.ok(view.button.classList.contains("text-start"));
			assert.ok(view.button.classList.contains("underline"));
			assert.ok(!view.button.classList.contains("text-left"));
			assert.ok(
				view.button.firstElementChild.className.includes(
					"outline-offset-[-2px]",
				),
			);
			assert.ok(!view.button.firstElementChild.classList.contains("pb-3"));
		}
	} finally {
		await view.close();
	}
});

test("R1-2: real headerless withheld payload renders one notice with no toggle", async () => {
	const view = await mount({
		diff: [
			"[output withheld: credential redaction requires a complete bounded diff]",
			...Array(203).fill(""),
		],
	});
	try {
		assert.equal(view.button, null);
		assert.equal(view.well.children.length, 1);
		assert.equal(view.well.textContent, "Diff not available for this change");
	} finally {
		await view.close();
	}
});
