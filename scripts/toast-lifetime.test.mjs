import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

/*
 * Exercise the shipped manager AND installed Sonner's actual auto-close effect,
 * not an adapter which invents Sonner's lifetime. No DOM/browser engine is
 * installed here: hooks collect first-mount effects and a clock runs timers.
 * Layout, hover and pixels remain the independent browser/design gate.
 * The test-only export exposes Sonner's private Toast without changing a byte
 * on disk; an upstream rename fails this test rather than silently modeling it.
 */
const require = createRequire(import.meta.url);
const sonnerPath = require.resolve("sonner").replace(/index\.js$/, "index.mjs");
const source = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stories = source(
	"src/renderer/src/features/chat/components/canvas/canvas.stories.tsx",
);
const refusalStory = stories
	.split("export const VariablesWriteRefused: Story = {")[1]
	.split("export const ")[0];
const bundle = await build({
	stdin: {
		contents: `
			export { ThemedToastContainer } from "./src/renderer/src/shared/components/common/themed-toast-container";
			export { showErrorToast } from "./src/renderer/src/shared/utils/toast-manager";
			export { toast, __TestToast } from "sonner";
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
			name: "sonner-first-mount-clock",
			setup(builder) {
				builder.onResolve({ filter: /^sonner$/ }, () => ({ path: sonnerPath }));
				builder.onLoad({ filter: /sonner\/dist\/index\.mjs$/ }, ({ path }) => ({
					contents: `${readFileSync(path, "utf8")}\nexport { Toast as __TestToast };`,
					loader: "js",
				}));
				builder.onResolve(
					{ filter: /^react(?:-dom|\/jsx-runtime)?$/ },
					({ path }) => ({ path, namespace: "hooks" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "hooks" }, ({ path }) => ({
					contents:
						path === "react-dom"
							? "export default { flushSync: fn => fn() };"
							: `
						export const createElement = (type, props, ...children) => ({type, props: {...props, children}});
						export const jsx = (type, props) => ({type, props});
						export const jsxs = jsx;
						export const forwardRef = fn => fn;
						export const useState = initial => [typeof initial === "function" ? initial() : initial, () => {}];
						export const useRef = current => ({current});
						export const useMemo = fn => fn();
						export const useCallback = fn => fn;
						export const useEffect = fn => globalThis.effects.push(fn);
						export const useLayoutEffect = useEffect;
						export default {createElement, forwardRef, useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, isValidElement: value => Boolean(value?.type)};
					`,
					loader: "js",
				}));
			},
		},
	],
});

function fixture(duration) {
	let now = 10_000;
	let nextId = 0;
	const timers = new Map();
	const context = {
		module: { exports: {} },
		effects: [],
		Date: class extends Date {
			constructor(...args) {
				super(...(args.length ? args : [now]));
			}
			static now() {
				return now;
			}
		},
		setTimeout: (fn, delay) => {
			const id = ++nextId;
			timers.set(id, { fn, at: now + delay });
			return id;
		},
		clearTimeout: (id) => timers.delete(id),
	};
	runInNewContext(bundle.outputFiles[0].text, context);
	// Sonner's CSS injection is intentionally not mounted. Only its clock and
	// visibility input participate; false means no hidden-tab/hover timer pause.
	context.document = { hidden: false, addEventListener() {} };
	context.window = { removeEventListener() {} };
	const api = context.module.exports;
	const container = api.ThemedToastContainer({ duration });
	const removed = [];
	const id = api.showErrorToast("This name is reserved for the session.");
	const toast = api.toast.getToasts().find((entry) => entry.id === id);
	const props = {
		...container.props,
		toast,
		index: 0,
		visibleToasts: 3,
		heights: [],
		toasts: [toast],
		gap: 14,
		expanded: false,
		interacting: false,
		setHeights() {},
		removeToast: (item) => removed.push(item.id),
	};
	const element = api.__TestToast(props);
	assert.equal(element.props["data-sonner-toast"], "");
	for (const effect of context.effects) effect();
	return {
		api,
		container,
		removed,
		id,
		advance(ms) {
			const end = now + ms;
			while (true) {
				const due = [...timers]
					.filter(([, timer]) => timer.at <= end)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				const [id, timer] = due;
				timers.delete(id);
				now = timer.at;
				timer.fn();
			}
			now = end;
		},
	};
}

test("production default reproduces the refusal gap despite two-second retries", () => {
	const f = fixture(undefined);
	assert.equal(f.container.props.duration, undefined);
	f.advance(2000);
	assert.equal(
		f.api.showErrorToast("This name is reserved for the session."),
		null,
	);
	f.advance(2000);
	assert.equal(
		f.api.showErrorToast("This name is reserved for the session."),
		null,
	);
	f.advance(500); // includes Sonner's real exit/unmount grace period
	assert.deepEqual(
		f.removed,
		[f.id],
		"default toast really expired before cooldown ended",
	);
});

test("refusal story keeps its one real toast beyond lifetime and cooldown without retries", () => {
	assert.match(
		refusalStory,
		/parameters: \{ toastDuration: Number\.POSITIVE_INFINITY \}/,
	);
	assert.doesNotMatch(refusalStory, /setInterval|keepAlive/);
	assert.equal(
		(
			refusalStory.match(
				/userEvent\.click\(\s*await screen\.findByRole\("button", \{ name: "Create" \}\)/g,
			) ?? []
		).length,
		1,
	);
	assert.match(
		source(".storybook/preview.tsx"),
		/duration=\{context\.parameters\.toastDuration\}/,
	);
	const f = fixture(Number.POSITIVE_INFINITY);
	assert.equal(f.container.props.duration, Number.POSITIVE_INFINITY);
	for (const delay of [4500, 2000, 60_000]) {
		f.advance(delay);
		assert.deepEqual(
			f.removed,
			[],
			"delayed capture must still have its toast",
		);
		assert.equal(
			f.api.toast.getToasts().length,
			1,
			"one refusal, no repeated fake writes",
		);
	}
});
