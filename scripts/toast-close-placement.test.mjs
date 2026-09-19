#!/usr/bin/env node
/**
 * The toast's close button is placed by TWO inset properties, and it is the
 * cascade between them that decides which side of the toast it sits on.
 *
 * Why this is a test rather than a paragraph. The operator reported the close
 * (X) button "hanging over the toast's top-LEFT corner, offset inward". The
 * cause was one token: `--toast-close-button-start: "unset"` in
 * `themed-toast-container.tsx`'s inline `TOAST_THEME`, which was written to
 * "keep the close button on the right" and did the opposite. Sonner declares
 * that property on `html[dir='ltr']` and on `[data-sonner-toaster][dir='ltr']`
 * with the value `0`, and consumes it on the close button as
 * `left: var(--toast-close-button-start); right: var(--toast-close-button-end)`
 * — so the inline declaration overrides an INHERITED value, and `unset` on a
 * custom property means `inherit` (a custom property is inherited by default),
 * i.e. it re-stated the `0` it was meant to clear. Both insets then resolved to
 * a length, which is the over-constrained case: LTR keeps `left` and drops
 * `right`, and the RTL transform carried the circle 7px INWARD from the left
 * corner instead of outward from the right one. `auto` is the value that
 * governs nothing.
 *
 * That is a resolution question, not a pixel one, and the resolution is what
 * this file pins — because the repository's browser rigs cannot run in CI
 * (`scripts/toast-close-geometry.mjs` drives a private headless Chrome, as
 * `capture-evidence.mjs` and the other geometry rigs do) while `pnpm
 * test:desktop` runs on an `ubuntu-latest` runner with no browser at all. So
 * the split is explicit: the RIG owns the pixels (it measures both boxes, the
 * four deltas, the corner distances and viewport containment, in two toast
 * shapes and three themes, and fails on the pre-fix tree), and this file owns
 * the rule that decides them.
 *
 * What it does NOT model, stated rather than implied: no layout. It resolves
 * the two insets and the transform's sign, then asserts which side governs and
 * that the transform agrees with it. Whether the resulting box lands on the
 * corner is `toast-close-geometry.mjs`'s claim and is measured there.
 *
 * The values are read from the SHIPPED artefacts rather than re-typed: sonner's
 * own `dist/styles.css` (resolved through the package's export map) and the
 * shipped component's inline theme, bundled out of the real
 * `themed-toast-container.tsx` by esbuild the way `toast-lifetime.test.mjs`
 * bundles it. An upstream change to either — a renamed custom property, a
 * different box, an LTR/RTL pair that stops being a mirror — fails this file by
 * name instead of silently modelling the old contract.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const sonnerPath = require.resolve("sonner").replace(/index\.js$/, "index.mjs");
const sheet = readFileSync(require.resolve("sonner/dist/styles.css"), "utf8");

/**
 * The shipped inline theme, out of the shipped component.
 *
 * The component module is bundled whole (react stubbed, the way
 * `toast-lifetime.test.mjs` does it) and `ThemedToastContainer` is called with
 * the props `main.tsx` calls it with. Its `toastOptions.style` is the object
 * sonner spreads onto every toast's `<li>`, and that `<li>` is the close
 * button's containing block — so this is the declaration the cascade below
 * actually resolves, not a copy kept in sync by hand.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { ThemedToastContainer } from "./src/renderer/src/shared/components/common/themed-toast-container";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	jsx: "automatic",
	format: "cjs",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "toast-placement-react-stub",
			setup(builder) {
				builder.onResolve({ filter: /^sonner$/ }, () => ({ path: sonnerPath }));
				builder.onResolve(
					{ filter: /^react(?:-dom|\/jsx-runtime)?$/ },
					({ path }) => ({ path, namespace: "stub" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
					contents:
						path === "react-dom"
							? "export default { flushSync: (fn) => fn() };"
							: `
							export const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
							export const jsx = (type, props) => ({ type, props });
							export const jsxs = jsx;
							export const forwardRef = (fn) => fn;
							export const useState = (initial) => [typeof initial === "function" ? initial() : initial, () => {}];
							export const useRef = (current) => ({ current });
							export const useMemo = (fn) => fn();
							export const useCallback = (fn) => fn;
							export const useEffect = () => {};
							export const useLayoutEffect = useEffect;
							export default { createElement, forwardRef, useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, isValidElement: (value) => Boolean(value?.type) };
						`,
					loader: "js",
				}));
			},
		},
	],
});

const module_ = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, {
	module: module_,
	exports: module_.exports,
});
const container = module_.exports.ThemedToastContainer({ duration: undefined });
const inline = container.props.toastOptions.style;

/**
 * One declaration block's properties, as a name -> value map.
 *
 * Small on purpose: these two files carry the values this test compares, and a
 * CSS parser would be a new dependency added to a suite that runs on every
 * change. The block boundary is the first `{` to the first `}` after it, which
 * is exact for the single declarations being read.
 */
const declarations = (rule) => {
	const open = rule.indexOf("{");
	const close = rule.indexOf("}", open);
	const body = rule.slice(open + 1, close);
	const out = {};
	for (const line of body.split(";")) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	return out;
};

const ruleAt = (selector) => {
	const at = sheet.indexOf(`${selector} {`);
	assert.notEqual(
		at,
		-1,
		`sonner's stylesheet no longer declares \`${selector}\``,
	);
	return declarations(sheet.slice(at));
};

const LTR = "html[dir='ltr'],\n[data-sonner-toaster][dir='ltr']";
const RTL = "html[dir='rtl'],\n[data-sonner-toaster][dir='rtl']";
const CLOSE_BUTTON =
	"[data-sonner-toast][data-styled='true'] [data-close-button]";

const START = "--toast-close-button-start";
const END = "--toast-close-button-end";
const TRANSFORM = "--toast-close-button-transform";

const ltr = ruleAt(LTR);
const rtl = ruleAt(RTL);
const closeButton = ruleAt(CLOSE_BUTTON);

/**
 * The resolution a browser performs for the two insets, in one function.
 *
 * A custom property's declared value goes through the same CSS-wide keywords as
 * any other property, and the property is INHERITED — which is the whole trap.
 * `levels` is the chain the button inherits through, the element's own
 * declaration first and the outermost ancestor last, and each level is read
 * outward with the value carried: a level that declares nothing passes the
 * inherited value through, and `unset` (or `inherit`) on an inherited property
 * means exactly the same thing. A chain that leaves the property declared
 * nowhere ends at the guaranteed-invalid value, where the consuming `var()`
 * in `left: var(--toast-close-button-start)` fails and the property falls back
 * to `auto` — which is what a declaration of `unset` on the OUTERMOST level does
 * too, and is why sonner's own RTL block works while the same spelling on a
 * descendant does not.
 *
 * Bound: `initial`/`revert` on a custom property are not modelled, because no
 * declaration in this contract uses them; one that did would be read here as a
 * literal token, and the assertions below would fail loudly on it rather than
 * passing quietly.
 */
const resolveInset = (name, levels) => {
	let value;
	for (const level of [...levels].reverse()) {
		const declared = level[name];
		if (declared === undefined) continue;
		if (declared !== "unset" && declared !== "inherit") value = declared;
	}
	return value === undefined ? "auto" : value;
};

/** The insets as resolved, and the side LTR then lays the box out from. */
const resolve = (inlineStyle, ancestor) => {
	const levels = [inlineStyle, ancestor];
	const insets = {
		left: resolveInset(START, levels),
		right: resolveInset(END, levels),
	};
	/*
	 * `left` and `right` are PHYSICAL properties on this button, so the mapping
	 * is direct rather than direction-dependent — and when both are set, the
	 * over-constrained case keeps `left` and drops `right`, which is how a
	 * right-hand placement ends up painted on the left.
	 */
	const governing =
		insets.left === "auto"
			? insets.right === "auto"
				? null
				: "right"
			: "left";
	return { insets, governing };
};

/** The x-sign of a `translate(<x>, <y>)` transform, as a number of percent. */
const transformX = (value) => {
	const match = /translate\(\s*(-?[\d.]+)%/.exec(value ?? "");
	assert.ok(match, `\`${value}\` is not a percentage translate`);
	return Number.parseFloat(match[1]);
};

test("sonner places the close button with two custom properties on one 20px box", () => {
	/*
	 * The contract the override below is written against. If upstream renames a
	 * property or moves the box, every assertion in this file would otherwise be
	 * answering a question nobody asked.
	 */
	assert.equal(closeButton.position, "absolute");
	assert.equal(closeButton.width, "20px");
	assert.equal(closeButton.height, "20px");
	assert.equal(closeButton.top, "0");
	assert.equal(closeButton.left, `var(${START})`);
	assert.equal(closeButton.right, `var(${END})`);
	assert.equal(closeButton.transform, `var(${TRANSFORM})`);

	assert.equal(ltr[START], "0");
	assert.equal(ltr[END], "unset");
	assert.equal(rtl[START], "unset");
	assert.equal(rtl[END], "0");
	assert.equal(
		transformX(rtl[TRANSFORM]),
		-transformX(ltr[TRANSFORM]),
		"sonner's RTL placement is the mirror of its LTR one, and this app's override relies on that",
	);
});

test("`unset` on a custom property inherits, which is how the button reached the LEFT edge", () => {
	/*
	 * The pre-fix declaration, resolved. This is the defect stated as a rule
	 * rather than as a distance, and it is why the fix is `auto` and not the
	 * other obvious spellings: `unset` here is `inherit` and re-states sonner's
	 * `0`, and even `revert` would resolve the same way (the ancestor's value is
	 * what the cascade across the toaster's rule settles on).
	 */
	const before = { [START]: "unset", [END]: "0px" };
	const { insets, governing } = resolve(before, ltr);
	assert.equal(insets.left, "0", "the inherited `0` survives `unset`");
	assert.equal(insets.right, "0px");
	assert.equal(
		governing,
		"left",
		"both insets as lengths is the over-constrained case, where LTR drops `right`",
	);

	/*
	 * And the same declaration against the RTL ancestor. This is the second half
	 * of the trap and the reason the bug was not direction-specific: the RTL rule
	 * declares `unset` too, so an `unset` override there falls back to the
	 * guaranteed-invalid value and lands the button on the left by a different
	 * route.
	 */
	const inRtl = resolve(before, rtl);
	assert.equal(inRtl.insets.left, "auto");
	assert.equal(inRtl.insets.right, "0px");
	assert.equal(inRtl.governing, "right");
});

test("the shipped theme leaves exactly one inset governing, and it is the right one", () => {
	const { insets, governing } = resolve(inline, ltr);

	assert.equal(
		insets.left,
		"auto",
		`--toast-close-button-start must govern nothing; it is declared as ${JSON.stringify(inline[START])}`,
	);
	assert.notEqual(insets.right, "auto");
	assert.equal(
		governing,
		"right",
		"the close button belongs on the toast's right",
	);

	/*
	 * Direction-independence, asserted rather than assumed: the override names
	 * the same physical side in an RTL document, because sonner's two ancestor
	 * rules differ only in which of the two properties is the `unset` one.
	 */
	const inRtl = resolve(inline, rtl);
	assert.deepEqual(inRtl, {
		insets: { left: "auto", right: "0px" },
		governing: "right",
	});
});

test("the shipped transform is sonner's own RTL one, and it points out of the side that governs", () => {
	const { governing } = resolve(inline, ltr);

	assert.equal(
		inline[TRANSFORM],
		rtl[TRANSFORM],
		"the outward translate has to be the one that goes with a right inset",
	);
	assert.ok(
		governing === "right"
			? transformX(inline[TRANSFORM]) > 0
			: transformX(inline[TRANSFORM]) < 0,
		`a ${governing}-governed box must translate ${governing === "right" ? "away from" : "toward"} its edge; the theme declares ${inline[TRANSFORM]}`,
	);
});
