/*
 * The document root's direction follows the locale, derived from the language
 * manifest rather than a code list.
 *
 * WHAT THIS PROVES: `ur` writes `dir="rtl" lang="ur"` on `<html>`; `en` and
 * `zh-CN` write `ltr` with their own tags; and switching the store after mount
 * rewrites the attribute WITHOUT remounting the tree (the probe's mount counter
 * stays at one). The last case is the live-update contract — a reload would also
 * show the right attribute, so an attribute-only assertion could not tell the
 * two apart.
 *
 * WHAT IT DOES NOT PROVE: that the layout mirrors. jsdom has no layout engine,
 * so the mirrored geometry is a rendered-app fact (the PR's captured frames and
 * `getBoundingClientRect` numbers), not a unit-test fact.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
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
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// See `language-live-updates.test.mjs`: jsdom's own accessors refuse to be
		// read out of context; the ones React needs are not among them.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const bundle = await build({
	stdin: {
		contents: [
			'export { useDocumentDirection, applyDocumentDirection } from "./src/renderer/src/shared/i18n/use-document-direction";',
			'export { setLocale } from "./src/i18n/locale";',
			'export { resolveLanguage, textDirectionFor } from "./src/i18n/direction";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

const bundlePath = new URL("_document-direction.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const { useDocumentDirection, setLocale, resolveLanguage, textDirectionFor } =
	await import(bundlePath.href);

test("the manifest resolves direction by language, not by region", () => {
	assert.deepEqual(resolveLanguage("ur"), { lang: "ur", dir: "rtl" });
	assert.deepEqual(resolveLanguage("en"), { lang: "en", dir: "ltr" });
	assert.deepEqual(resolveLanguage("zh-CN"), { lang: "zh-CN", dir: "ltr" });
	// Device tags arrive un-normalised before a backend answer. Direction follows
	// the language, but `lang` must NOT be rewritten: `zh-TW` is not `zh-CN`.
	assert.deepEqual(resolveLanguage("ur-PK"), { lang: "ur-PK", dir: "rtl" });
	assert.deepEqual(resolveLanguage("en-US"), { lang: "en-US", dir: "ltr" });
	assert.deepEqual(resolveLanguage("fr-CA"), { lang: "fr-CA", dir: "ltr" });
	assert.deepEqual(resolveLanguage("zh-TW"), { lang: "zh-TW", dir: "ltr" });
	// An unshipped tag still carries a usable `lang`, and defaults to LTR.
	assert.deepEqual(resolveLanguage("xx-YY"), { lang: "xx-YY", dir: "ltr" });
	assert.equal(textDirectionFor("ur"), "rtl");
	assert.equal(textDirectionFor("hi"), "ltr");
	assert.equal(textDirectionFor("zh-TW"), "ltr");
});

test("the document root follows the locale live, without remounting", async () => {
	setLocale("en");

	let mounts = 0;
	const Probe = () => {
		// A MOUNT effect, not a render counter: a locale change legitimately
		// re-renders the tree, and only a remount re-runs this empty-dep effect.
		React.useEffect(() => {
			mounts += 1;
		}, []);
		useDocumentDirection();
		return null;
	};

	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(React.createElement(Probe, null));
		});

		const html = document.documentElement;
		assert.equal(html.getAttribute("dir"), "ltr");
		assert.equal(html.getAttribute("lang"), "en");
		const firstMountCount = mounts;

		await act(async () => setLocale("ur"));
		assert.equal(html.getAttribute("dir"), "rtl", "Urdu must mirror the root");
		assert.equal(html.getAttribute("lang"), "ur");
		assert.equal(
			mounts,
			firstMountCount,
			"a locale change must not remount the tree",
		);

		await act(async () => setLocale("zh-CN"));
		assert.equal(html.getAttribute("dir"), "ltr");
		assert.equal(html.getAttribute("lang"), "zh-CN");
		assert.equal(mounts, firstMountCount);

		// Back to Urdu: the live path must work in both directions, not only into RTL.
		await act(async () => setLocale("ur"));
		assert.equal(html.getAttribute("dir"), "rtl");
		assert.equal(html.getAttribute("lang"), "ur");
		assert.equal(mounts, firstMountCount);
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});
