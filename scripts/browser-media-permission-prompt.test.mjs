/**
 * The camera/microphone band's renderer behaviour (PR #1843 round-1 review):
 * the real component, bundled with esbuild and mounted in jsdom, driven with
 * DOM events. It pins what the design/UX rounds found and main cannot see:
 *   - D1 the site is emphasised (its own `font-medium` span), in every state
 *     that names it;
 *   - D2 Allow and Block share one Button variant (same classes at rest and
 *     on hover);
 *   - D5 the region and dismiss names follow the variant (mic / camera / both /
 *     blocked / system-blocked);
 *   - U2 the blocked state offers Allow (no Block) and dismiss;
 *   - U6/D3 the system-blocked state offers "Open System Settings";
 *   - U5 a KEYBOARD answer hands focus back to the page, a pointer one does not;
 *   - U8 Escape dismisses (never grants).
 *
 * jsdom-dispatched events are untrusted, so every decision here carries
 * `trusted: false` — main's refusal of those is
 * `scripts/browser-media-permissions.test.mjs`'s subject, not this file's.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bundle = await build({
	entryPoints: [
		"src/renderer/src/features/browser/components/browser-media-permission-prompt.tsx",
	],
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	write: false,
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
});

const MEET = "https://meet.google.com";
const BLOCKED_COPY =
	/^Camera and microphone are blocked for meet\.google\.com\./;
const RESTART_COPY = /quit and reopen Local Operator/;

function promptView(kinds = ["audio", "video"], extra = {}) {
	return {
		kind: "prompt",
		tabId: 7,
		id: "p-1",
		origin: MEET,
		kinds,
		ownerKind: "user",
		at: 0,
		...extra,
	};
}

async function mounted(fn) {
	const dom = new JSDOM('<div id="mount"></div>', {
		url: "http://127.0.0.1:1/#/browser",
		pretendToBeVisual: true,
	});
	const saved = new Map();
	for (const key of [
		"window",
		"document",
		"navigator",
		"Node",
		"Element",
		"HTMLElement",
		"MutationObserver",
		"getComputedStyle",
		"Event",
		"KeyboardEvent",
		"MouseEvent",
		"CustomEvent",
		"IS_REACT_ACT_ENVIRONMENT",
	]) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
		});
	}
	let root;
	try {
		const mod = { exports: {} };
		new Function("require", "module", "exports", bundle.outputFiles[0].text)(
			createRequire(import.meta.url),
			mod,
			mod.exports,
		);
		const { createRoot } = await import("react-dom/client");
		root = createRoot(document.getElementById("mount"));
		const calls = { decide: [], settings: [], focus: 0 };
		const render = (view) =>
			act(async () =>
				root.render(
					React.createElement(mod.exports.BrowserMediaPermissionPrompt, {
						view,
						onDecide: (v, decision, trusted) =>
							calls.decide.push([v.kind, decision, trusted]),
						onOpenSystemSettings: (v) => calls.settings.push(v.id),
						onReturnFocus: () => calls.focus++,
					}),
				),
			);
		await fn({ dom, render, calls });
	} finally {
		if (root) await act(async () => root.unmount());
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
		dom.window.close();
	}
}

const band = () =>
	document.querySelector('[data-tour-tag="browser-media-permission"]');
const button = (name) =>
	[...band().querySelectorAll("button")].find(
		(b) => b.textContent === name || b.getAttribute("aria-label") === name,
	);
const click = (dom, el, detail) =>
	act(async () =>
		el.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, detail }),
		),
	);

test("D1/D2/D5: the site is emphasised, Allow and Block share a variant, names follow the variant", async () => {
	await mounted(async ({ render }) => {
		await render(promptView());
		const emphasised = band().querySelector("p .font-medium");
		assert.equal(emphasised?.textContent, "meet.google.com", "D1");
		assert.equal(
			band().querySelector("p").textContent,
			"meet.google.com wants to use your camera and microphone.",
			"the sentence is intact around the span",
		);
		assert.equal(button("Allow").className, button("Block").className, "D2");
		assert.equal(
			band().getAttribute("aria-label"),
			"Camera and microphone request",
		);
		assert.ok(button("Dismiss camera and microphone request"));

		await render(promptView(["audio"]));
		assert.equal(
			band().getAttribute("aria-label"),
			"Microphone request",
			"D5 mic",
		);
		assert.ok(button("Dismiss microphone request"));
		await render(promptView(["video"]));
		assert.equal(
			band().getAttribute("aria-label"),
			"Camera request",
			"D5 camera",
		);
		assert.ok(button("Dismiss camera request"));
	});
});

test("U2: the blocked state names the site, offers Allow (no Block) and dismiss", async () => {
	await mounted(async ({ dom, render, calls }) => {
		await render({ ...promptView(), kind: "blocked", id: "b-1" });
		assert.equal(band().dataset.mediaPermissionKind, "blocked");
		assert.match(band().querySelector("p").textContent, BLOCKED_COPY);
		assert.equal(
			band().querySelector("p .font-medium")?.textContent,
			"meet.google.com",
		);
		assert.equal(
			band().getAttribute("aria-label"),
			"Camera and microphone blocked for this site",
		);
		assert.equal(button("Block"), undefined, "nothing to block again");
		assert.ok(button("Dismiss notice"));
		await click(dom, button("Allow"), 1);
		assert.deepEqual(calls.decide, [["blocked", "allow", false]]);
	});
});

test("U6/D3: the system-blocked state offers Open System Settings and says a restart may be needed", async () => {
	await mounted(async ({ dom, render, calls }) => {
		await render({
			...promptView(["video"]),
			kind: "system-blocked",
			id: "s-1",
		});
		assert.equal(
			band().getAttribute("aria-label"),
			"Camera turned off in macOS",
			"D5",
		);
		assert.match(band().textContent, RESTART_COPY);
		assert.equal(button("Allow"), undefined);
		await click(dom, button("Open System Settings"), 1);
		assert.deepEqual(calls.settings, ["s-1"]);
		assert.equal(calls.focus, 0, "a pointer click keeps its own focus");
		await click(dom, button("Open System Settings"), 0);
		assert.equal(calls.focus, 1, "a keyboard activation returns focus");
	});
});

test("U5/U8: a keyboard answer returns focus to the page; Escape dismisses and never grants", async () => {
	await mounted(async ({ dom, render, calls }) => {
		await render(promptView());
		await click(dom, button("Block"), 1);
		assert.equal(calls.focus, 0, "pointer: no focus hand-back");
		await click(dom, button("Block"), 0);
		assert.equal(calls.focus, 1, "keyboard (detail 0): focus goes to the page");
		await act(async () =>
			button("Allow").dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			),
		);
		assert.deepEqual(calls.decide.at(-1), ["prompt", "dismiss", false]);
		assert.equal(calls.focus, 2);
		assert.ok(!calls.decide.some(([, d]) => d === "allow"), "Esc never allows");
	});
});
