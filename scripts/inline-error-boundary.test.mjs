/**
 * The scoped boundary contract: a render crash in one item becomes an inline
 * alert in that item, siblings and the host stay mounted, the crash is logged
 * through the shared bounded formatter, and moving to another item (resetKeys)
 * or pressing Retry renders normally again.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const dom = new JSDOM("<main id='root'></main>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
for (const name of ["Element", "Node", "MutationObserver", "CustomEvent"])
	globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", {
	value: dom.window.navigator,
	configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const built = await build({
	stdin: {
		contents:
			'export { InlineErrorBoundary } from "./src/renderer/src/shared/components/common/inline-error-boundary"; export { setLocale } from "./src/i18n";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	write: false,
	logLevel: "silent",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
});
const mod = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(
	require,
	mod,
	mod.exports,
);
const { InlineErrorBoundary, setLocale } = mod.exports;
setLocale("en");

const h = React.createElement;
const state = { broken: new Set() };
function Item({ id }) {
	if (state.broken.has(id)) throw new TypeError(`item ${id} cannot render`);
	return h("p", { "data-testid": `item-${id}` }, `item ${id}`);
}
function Page({ selected }) {
	return h(
		"section",
		{ "data-testid": "host" },
		h("h1", null, "host heading"),
		h(
			InlineErrorBoundary,
			{ resetKeys: [selected], testId: "scoped" },
			h(Item, { id: selected }),
		),
		h("p", { "data-testid": "sibling" }, "sibling"),
	);
}

async function mount() {
	const errors = [];
	const original = console.error;
	console.error = (...args) => errors.push(args.map(String).join(" "));
	const root = createRoot(document.getElementById("root"));
	const render = async (selected) =>
		act(async () => {
			root.render(h(Page, { selected }));
		});
	const q = (id) => document.querySelector(`[data-testid="${id}"]`);
	return {
		errors,
		render,
		q,
		done: async () => {
			await act(async () => root.unmount());
			console.error = original;
		},
	};
}

test("a throwing item renders an inline alert while the host stays mounted", async () => {
	state.broken = new Set(["bad"]);
	const m = await mount();
	try {
		await m.render("bad");
		const alert = m.q("scoped");
		assert.ok(alert, "inline alert rendered");
		assert.equal(alert.getAttribute("role"), "alert");
		assert.ok(alert.textContent.includes("Something went wrong"));
		assert.ok(alert.textContent.includes("Try again"));
		assert.ok(m.q("host"), "host stays mounted");
		assert.ok(m.q("sibling"), "sibling stays mounted");
		assert.ok(
			m.errors.some((e) => e.includes("item bad cannot render")),
			"the crash is logged, not swallowed",
		);
	} finally {
		await m.done();
	}
});

test("changing the reset key renders the next item normally", async () => {
	state.broken = new Set(["bad"]);
	const m = await mount();
	try {
		await m.render("bad");
		assert.ok(m.q("scoped"));
		await m.render("good");
		assert.equal(m.q("scoped"), null, "the previous crash is released");
		assert.ok(m.q("item-good"));
	} finally {
		await m.done();
	}
});

test("Retry re-renders the same item once it can render", async () => {
	state.broken = new Set(["flaky"]);
	const m = await mount();
	try {
		await m.render("flaky");
		const retry = m.q("scoped").querySelector("button");
		state.broken.delete("flaky");
		await act(async () => retry.click());
		assert.equal(m.q("scoped"), null);
		assert.ok(m.q("item-flaky"));
	} finally {
		await m.done();
	}
});
