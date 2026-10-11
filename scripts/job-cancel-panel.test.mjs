import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The Jobs section's cancel interaction, driven against the REAL pane body
 * (`RunDetailsPanel` — the level that owns the interaction, above the section's
 * mount gate), the same arrangement `wake-cancel-panel.test.mjs` and
 * `monitor-cancel-dialog.test.mjs` use for their own cards.
 *
 * What is faked, and only that: the `jobControls` object (the write's shape),
 * so a case resolves the outcome by hand. Everything else is shipped code: the
 * partition that routes a `video` row into the Jobs list, the row that draws
 * the control, the pane body's confirmation with its frozen anchor, the
 * in-flight window, and the focus hand-back.
 *
 * The cases pin the design spec's desktop rules for this control (§2.2/§2.3):
 * the control rides the video row family ONLY; a press opens the placed
 * confirmation and never writes one; the confirm writes once; an ok is an
 * acknowledgement that paints NOTHING (the honesty clause — no local
 * `cancelled`, the wire owns that word); a refusal lands inside the card with
 * the engine's sentence and hands the keyboard back to Keep; Escape and an
 * outside press close an idle card and are blocked while a write is in flight.
 */

// React DOM feature-detects at import time, so the document exists first.
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chats",
});
/*
 * jsdom's own constructors are FORCED onto the global — Node 26 defines `Event`
 * and `CustomEvent` itself, and a React tree whose events are built from Node's
 * classes fails inside the commit phase with an error that reads like a
 * component bug. The recipe is `monitor-cancel-dialog.test.mjs`'s.
 */
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
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * jsdom ships no `CSS` object, and the interaction's focus fallback builds its
 * row selector with a BARE `CSS.escape` (the repo's idiom for a selector out of
 * wire data). The same one-line shim the repo's other bare-escape harnesses
 * install; the selector it produces is not what this file asserts, so
 * identity-escape is enough here.
 */
globalThis.CSS = { escape: (value) => String(value) };
/*
 * The frame loop, queued rather than run: presence code that waits on a frame
 * must not race a real clock, so frames are drained only when the harness says
 * so (`frame()`, inside `settle`). Capped at four for the wake harness's
 * measured reason: draining to empty executes a floating element's next
 * generation forever in a layout-less jsdom.
 */
const queuedFrames = [];
globalThis.requestAnimationFrame = (callback) => {
	queuedFrames.push(callback);
	return queuedFrames.length;
};
globalThis.cancelAnimationFrame = () => {};
const frame = (limit = 4) => {
	for (const callback of queuedFrames.splice(0, limit)) callback(0);
};
DOM.window.Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/* ------------------------------------------------------------------ bundle */

const bundle = await build({
	stdin: {
		contents: [
			'export { RunDetailsPanel } from "./src/renderer/src/features/chat/components/run-details/run-details-panel";',
			'export { deriveRunDetails } from "./src/renderer/src/features/chat/components/run-details/run-detail-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	jsx: "automatic",
});
const bundlePath = new URL("._job-cancel-panel.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => undefined));
const { RunDetailsPanel, deriveRunDetails } = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

/* ------------------------------------------------------------------ fixtures */

const NOW_MS = 1_700_000_000_000;
const VIDEO_LABEL = "Video generation (i2v, 8s, Radient)";

/** A running video job, as `frontend.jobs` will carry one (contract §1.7 G1). */
const videoJob = (overrides = {}) => ({
	id: "job-v1",
	type: "video",
	label: VIDEO_LABEL,
	status: "running",
	start_time: Math.round(NOW_MS / 1000) - 120,
	settled_at: null,
	...overrides,
});

/** A running shell job — the row family the control must NOT ride. */
const bashJob = (overrides = {}) => ({
	id: "job-b1",
	type: "bash",
	label: "bash: npm run build",
	status: "running",
	start_time: Math.round(NOW_MS / 1000) - 30,
	settled_at: null,
	...overrides,
});

const jobsOf = (jobs) =>
	deriveRunDetails({
		jobs,
		todos: [],
		wakes: [],
		monitors: [],
		nowMs: NOW_MS,
	});

/** An identity that knows nothing: no capability, nothing resolved. */
const UNKNOWN_AIDA = {
	capability: false,
	statusResolved: false,
	sessionId: null,
	name: "Aida",
};

/** The frozen `not_found` phrase, verbatim (`job-controls-model.ts`). */
const NOT_FOUND_PHRASE = "not cancelled — the provider no longer knows the job";

/* ------------------------------------------------------------------ harness */

const mounted = [];

const mount = async (initial) => {
	let props = initial;
	const element = () =>
		React.createElement(RunDetailsPanel, {
			details: jobsOf(props.jobs),
			mcpServers: [],
			mcpGrantRunning: false,
			mcpRemedy: {},
			childrenOpenable: false,
			onOpenChild: () => undefined,
			rosterExpanded: false,
			onToggleRosterExpanded: () => undefined,
			paneWidth: 420,
			monitorControls: { cancel: async () => ({ ok: true }) },
			wakeControls: { cancel: async () => ({ ok: true }) },
			jobControls: { cancel: props.cancel },
			wakeAida: UNKNOWN_AIDA,
			sessionId: props.sessionId,
		});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element());
	});
	const handles = {
		container,
		rerender: async (updates) => {
			props = { ...props, ...updates };
			await act(async () => {
				root.render(element());
			});
		},
		unmount: async () => {
			const index = mounted.indexOf(handles);
			if (index >= 0) mounted.splice(index, 1);
			await act(async () => root.unmount());
			container.remove();
		},
	};
	mounted.push(handles);
	return handles;
};

afterEach(async () => {
	for (const handle of mounted.splice(0)) await handle.unmount();
	document.body.innerHTML = "";
});

const settle = async (predicate, attempts = 60) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		await act(async () => {});
		await act(async () => frame());
		if (predicate()) return true;
	}
	return false;
};

/** The open confirmation, wherever its portal landed. */
const confirmCard = () => document.body.querySelector("[data-job-confirm]");

/** Press a control the way a pointer does: focus first, then a bubbling click. */
const press = async (element) => {
	element.focus();
	await act(async () => {
		element.dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
};

/** A promise the case resolves by hand, so the in-flight window is a state. */
const deferred = () => {
	let resolve;
	const promise = new Promise((res) => {
		resolve = res;
	});
	return { promise, resolve };
};

/** The card's own buttons, by their visible text. */
const cardButton = (text) =>
	Array.from(confirmCard().querySelectorAll("button")).find(
		(button) => button.textContent === text,
	);

/* -------------------------------------------------------------------- cases */

test("the control rides the video row family only", async () => {
	const p = await mount({
		jobs: [videoJob(), bashJob()],
		sessionId: "sess1",
		cancel: async () => ({ ok: true }),
	});
	assert.ok(
		document.querySelector('[data-job-cancel="job-v1"]'),
		"a running video job offers the control at rest",
	);
	assert.equal(
		document.querySelector('[data-job-cancel="job-b1"]'),
		null,
		"a shell job does NOT: the pane leaves a running bash job alone by design",
	);
	assert.equal(
		document.querySelector("[data-job-confirm]"),
		null,
		"nothing is asked before a press",
	);
	await p.unmount();
});

test("a press opens the placed confirmation, states the act and the honesty clause, and writes nothing", async () => {
	const calls = [];
	const p = await mount({
		jobs: [videoJob()],
		sessionId: "sess1",
		cancel: async (id) => {
			calls.push(id);
			return { ok: true };
		},
	});
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	const text = confirmCard().textContent;
	assert.ok(text.includes("Cancel this job?"), "the title names the act");
	assert.ok(
		text.includes(`“${VIDEO_LABEL}”`),
		"the sentence names the job that was pressed",
	);
	assert.ok(
		text.includes("only when the job settles"),
		"the honesty clause is stated: a press is not the settle",
	);
	assert.equal(
		document.activeElement,
		cardButton("Keep"),
		"the keyboard starts on the safe action",
	);
	assert.deepEqual(calls, [], "opening the question writes nothing");
	await p.unmount();
});

test("confirm writes once for the pressed job; the ok closes the card and paints no local Cancelled", async () => {
	const calls = [];
	const gate = deferred();
	const p = await mount({
		jobs: [videoJob()],
		sessionId: "sess1",
		cancel: async (id) => {
			calls.push(id);
			return gate.promise;
		},
	});
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	await press(cardButton("Cancel"));
	/*
	 * THE IN-FLIGHT WINDOW: the action button keeps the same verb under way
	 * (`Cancelling…`, the monitors' D3 rule) and both buttons are held.
	 */
	assert.equal(cardButton("Cancelling…") !== undefined, true);
	assert.equal(cardButton("Cancelling…").disabled, true);
	assert.equal(cardButton("Keep").disabled, true);
	gate.resolve({ ok: true });
	assert.ok(
		await settle(() => confirmCard() === null),
		"the acknowledgement closes the card",
	);
	assert.deepEqual(calls, ["job-v1"], "one press, one request");
	/*
	 * NO LOCAL MARK (the honesty clause). The row is still on the wire's word —
	 * `running` — and nothing in it claims `Cancelled`: only the job's own
	 * settled word may (the canonical re-read is the row's only witness).
	 */
	const row = document.querySelector('[data-job-cancel="job-v1"]');
	assert.ok(row, "the row is still there while the wire still says running");
	const rowText = row.closest("li").textContent;
	assert.ok(!rowText.includes("Cancelled"), "no Cancelled off the press");
	assert.ok(rowText.includes("running"), "the wire's own word stands");
	await p.unmount();
});

test("a refusal stays inside the card with the engine's sentence, and the keyboard goes back to Keep", async () => {
	const calls = [];
	const p = await mount({
		jobs: [videoJob()],
		sessionId: "sess1",
		cancel: async (id) => {
			calls.push(id);
			return { ok: false, detail: NOT_FOUND_PHRASE };
		},
	});
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	await press(cardButton("Cancel"));
	assert.ok(
		await settle(() =>
			confirmCard()?.querySelector("[data-job-confirm-refusal]"),
		),
		"the refusal renders in the card",
	);
	assert.equal(
		confirmCard().querySelector("[data-job-confirm-refusal]").textContent,
		NOT_FOUND_PHRASE,
		"with the frozen not_found sentence, whole",
	);
	assert.equal(
		document.activeElement,
		cardButton("Keep"),
		"the keyboard is handed back to the safe action",
	);
	assert.deepEqual(calls, ["job-v1"], "the refusal is the write's own answer");
	const control = document.querySelector('[data-job-cancel="job-v1"]');
	assert.ok(
		control && !control.disabled,
		"the row's control is still the next attempt",
	);
	await p.unmount();
});

test("Escape closes an idle card and is held while the write is in flight", async () => {
	const gate = deferred();
	const p = await mount({
		jobs: [videoJob()],
		sessionId: "sess1",
		cancel: async () => gate.promise,
	});
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	await act(async () => {
		document.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	assert.ok(
		await settle(() => confirmCard() === null),
		"Escape closes the idle card",
	);
	assert.ok(
		await settle(
			() =>
				document.activeElement ===
				document.querySelector('[data-job-cancel="job-v1"]'),
		),
		"and the keyboard lands back on the row's own control",
	);
	/* Reopened, a write in flight blocks the same dismissal. */
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question reopens");
	await press(cardButton("Cancel"));
	await act(async () => {
		document.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	assert.ok(confirmCard() !== null, "Escape cannot dismiss a write in flight");
	gate.resolve({ ok: true });
	assert.ok(
		await settle(() => confirmCard() === null),
		"the ok closes it after",
	);
	await p.unmount();
});

test("an outside press closes an idle card, is blocked in flight, and keeps a focusable target's own landing", async () => {
	const gate = deferred();
	const p = await mount({
		jobs: [videoJob()],
		sessionId: "sess1",
		cancel: async () => gate.promise,
	});
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	/*
	 * A NON-FOCUSABLE target: the dismissal cancels the press's default — there
	 * is no landing worth preserving — and the card closes.
	 */
	const dismissal = new DOM.window.Event("pointerdown", {
		bubbles: true,
		cancelable: true,
	});
	document.body.dispatchEvent(dismissal);
	assert.ok(
		await settle(() => confirmCard() === null),
		"an outside press closes the question",
	);
	assert.equal(dismissal.defaultPrevented, true);
	/*
	 * A FOCUSABLE target (the taxonomy's real case — the composer, a menu item):
	 * the press's own default is KEPT — cancelling a pointerdown would swallow
	 * the click/caret it was making — and the dismissal says the keyboard stands
	 * down instead of being stolen (`pressKeepsFocus`).
	 */
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question reopens");
	const focusable = document.createElement("button");
	document.body.append(focusable);
	const kept = new DOM.window.Event("pointerdown", {
		bubbles: true,
		cancelable: true,
	});
	focusable.dispatchEvent(kept);
	assert.ok(
		await settle(() => confirmCard() === null),
		"the press on a focusable target still dismisses",
	);
	assert.equal(
		kept.defaultPrevented,
		false,
		"but its own landing is not cancelled",
	);
	/* Reopened, a write in flight leaves the press entirely alone. */
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question reopens");
	await press(cardButton("Cancel"));
	const blocked = new DOM.window.Event("pointerdown", {
		bubbles: true,
		cancelable: true,
	});
	document.body.dispatchEvent(blocked);
	await act(async () => {});
	assert.equal(
		blocked.defaultPrevented,
		false,
		"a busy card does not eat the press",
	);
	assert.ok(confirmCard() !== null, "and it cannot be dismissed");
	gate.resolve({ ok: true });
	assert.ok(
		await settle(() => confirmCard() === null),
		"the ok closes it after",
	);
	await p.unmount();
});

test("a session switch closes the question rather than reading it against another conversation's list", async () => {
	const p = await mount({
		jobs: [videoJob()],
		sessionId: "sess1",
		cancel: async () => ({ ok: true }),
	});
	await press(document.querySelector('[data-job-cancel="job-v1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	await p.rerender({ sessionId: "sess2" });
	assert.ok(
		await settle(() => confirmCard() === null),
		"the session boundary closes everything the interaction held",
	);
	await p.unmount();
});
