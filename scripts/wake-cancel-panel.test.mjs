import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The wakes cancel interaction, driven on the shipped pane body in a real DOM
 * (jsdom).
 *
 * Why this file exists. Three of this slice's claims are about TIME, REMOUNTING
 * and the WIRE, not about a still: whether the one-press write really sends one
 * request per press and marks its row, whether a refused attempt's sentence
 * OUTLIVES the canonical re-read's list churn (the class that killed a
 * section-owned dialog on monitors, U2), and whether an `aida-` row sends
 * NOTHING while the confirmation on her conversation names her and hands the
 * keyboard to the safe action. Source text cannot answer those, and the frames
 * cannot answer the request COUNT; so the cases below mount the REAL
 * `RunDetailsPanel` — the level that owns the interaction, above the section's
 * mount gate — and drive it with a stubbed write.
 *
 * What is faked, and only that: the `wakeControls` object (the write's shape)
 * and the `wakeAida` identity, because the wire and `aida.status` are not this
 * file's subject. The panel, the section, the row, the popover, the shared
 * primitives and the stores are the shipped ones.
 *
 * What it is NOT: evidence about pixels — the evidence set carries that — and
 * not a substitute for the live drive against a real daemon.
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
 * jsdom ships no `CSS` object, and the panel's focus-fallback effect builds its
 * row selector with a BARE `CSS.escape` (the repo's idiom for a selector out of
 * wire data — N2's fix). The same one-line shim the repo's other bare-escape
 * harnesses install (`backend-settings-collapse.test.mjs`,
 * `completion-view-ack.test.mjs`): the selector it produces is not what this
 * file asserts, so identity-escape is enough here.
 */
globalThis.CSS = { escape: (value) => String(value) };
/*
 * The frame loop, queued rather than run (the dismiss harness's reason): rimraf
 * / presence code that waits on a frame must not race a real clock, so frames
 * are drained only when the harness says so (`frame()`, inside `settle`).
 */
const queuedFrames = [];
globalThis.requestAnimationFrame = (callback) => {
	queuedFrames.push(callback);
	return queuedFrames.length;
};
globalThis.cancelAnimationFrame = () => {};
/*
 * Drain at most FOUR queued frames, oldest first.
 *
 * WHY A CAP AND NOT "every queued frame". A floating-positioned card keeps
 * asking for frames while it is open, and jsdom has no layout for it to settle
 * against: draining the queue to empty executes that loop's next generation and
 * the generation after it, and the press that opens the card goes from
 * milliseconds to minutes (measured: draining to empty made the first press take
 * 15 s, then 29 s, then 106 s as earlier cases' loops compounded; capping at four
 * keeps every case in the hundreds of milliseconds). The cap is a harness
 * concession with a named cost: a frame chain longer than four deep does not run
 * inside a `settle`, and no assertion here needs one to.
 */
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
const bundlePath = new URL("._wake-cancel-panel.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => undefined));
const { RunDetailsPanel, deriveRunDetails } = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

/* ------------------------------------------------------------------ fixtures */

const NOW_MS = 1_700_000_000_000;

/** The operator's 4-hourly check-in, as the wire carries it. */
const wireWake = (id, message, overrides = {}) => ({
	id,
	message,
	next_due_at: NOW_MS + 4 * 60 * 60 * 1000,
	every_ms: 4 * 60 * 60 * 1000,
	created_at: NOW_MS - 60_000,
	limit: null,
	fired_count: 0,
	remaining: null,
	...overrides,
});

const wakesOf = (wakes) =>
	deriveRunDetails({ jobs: [], todos: [], wakes, monitors: [], nowMs: NOW_MS });

/** An identity that knows nothing: no capability, nothing resolved. */
const UNKNOWN_AIDA = {
	capability: false,
	statusResolved: false,
	sessionId: null,
	name: "Aida",
};

/** Her conversation, resolved: the arm that names her. */
const HER_SESSION = "aaaa11112222";
const RESOLVED_AIDA = {
	capability: true,
	statusResolved: true,
	sessionId: HER_SESSION,
	name: "Aida",
};

const OWNER_REFUSAL =
	"This conversation is open in a running session, which owns its wakes. Nothing was written. Retry in a moment, or change them from that session.";

/* ------------------------------------------------------------------ harness */

/**
 * Mount the shipped pane body with a stub write and hand back the handles a
 * case drives it with. `rerender` replaces props on the SAME root — which is
 * what the canonical re-read's churn is: the same pane, a new `details`.
 */
/*
 * Every mount is registered and torn down after EVERY case, not only by the
 * case's own final `unmount`: a case that fails mid-way would otherwise leave
 * its panel (and any card it portaled into `document.body`) behind, and the
 * next case's `confirmCard()` would find the WRONG card — measured here as a
 * pass-in-isolation / fail-in-suite split, which is the worst shape a test can
 * have.
 */
const mounted = [];

const mount = async (initial) => {
	let props = initial;
	const element = () =>
		React.createElement(RunDetailsPanel, {
			details: wakesOf(props.wakes),
			mcpServers: [],
			mcpGrantRunning: false,
			mcpRemedy: {},
			childrenOpenable: false,
			onOpenChild: () => undefined,
			rosterExpanded: false,
			onToggleRosterExpanded: () => undefined,
			paneWidth: 420,
			monitorControls: { cancel: async () => ({ ok: true }) },
			wakeControls: { cancel: props.cancel },
			wakeAida: props.aida ?? UNKNOWN_AIDA,
			sessionId: props.sessionId,
		});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element());
	});
	const handles = {
		/* The root's own container, so a case can nest it under a pane marker. */
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

/** Flush microtasks and effects until `predicate` holds, bounded. */
const settle = async (predicate, attempts = 60) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		await act(async () => {});
		await act(async () => frame());
		if (predicate()) return true;
	}
	return false;
};

/** The open confirmation, wherever its portal landed. */
const confirmCard = () => document.body.querySelector("[data-wake-confirm]");

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

/* -------------------------------------------------------------------- cases */

test("a one-press write sends one request, opens nothing, and marks the row", async () => {
	const calls = [];
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async (id) => {
			calls.push(id);
			return { ok: true };
		},
	});
	const control = document.querySelector('[data-wake-cancel="w1"]');
	assert.ok(control, "an ordinary wake offers the control at rest");
	assert.equal(
		document.querySelector("[data-wake-confirm]"),
		null,
		"nothing is asked before the press",
	);
	await press(control);
	assert.ok(
		await settle(
			() =>
				document
					.querySelector('[data-wake-cancel="w1"]')
					?.getAttribute("data-wake-cancel-state") === "cancelled",
		),
		"the receipt marks the row before the re-read drops it",
	);
	assert.deepEqual(calls, ["w1"], "one press, one request");
	assert.equal(
		document.querySelector("[data-wake-confirm]"),
		null,
		"no confirmation on the one-press path",
	);
	const marked = document.querySelector('[data-wake-cancel="w1"]');
	assert.equal(marked.textContent, "Cancelled");
	assert.equal(
		marked.hasAttribute("disabled"),
		true,
		"and it is no longer a control",
	);
	await p.unmount();
});

test("a one-press refusal keeps its sentence on the row, and it survives the churn", async () => {
	const calls = [];
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async (id) => {
			calls.push(id);
			return { ok: false, detail: OWNER_REFUSAL };
		},
	});
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(
		await settle(
			() => document.querySelector("[data-wake-cancel-note]") !== null,
		),
		"the refusal renders",
	);
	/*
	 * ONE STATEMENT, and it is the row's: the short `Cancel refused` tag is
	 * retired (design round 1, D5 — the tag and the sentence said the same thing
	 * twice), the whole sentence stays on the row because there is no card on
	 * this path for it to live in, and the control beside it remains LIVE as the
	 * next attempt.
	 */
	assert.equal(
		document.querySelector('[data-wake-cancel-state="refused"]'),
		null,
		"the short tag is gone",
	);
	assert.equal(
		document.querySelector('[data-wake-cancel="w1"]')?.disabled,
		false,
		"and the control is still the next attempt",
	);
	assert.equal(
		document.querySelector("[data-wake-cancel-note]")?.textContent,
		OWNER_REFUSAL,
		"the sentence is on the row, whole",
	);
	assert.deepEqual(
		calls,
		["w1"],
		"the refusal is the write's own answer, not a re-send",
	);

	/*
	 * THE CHURN. The canonical re-read a cancel fires re-renders the pane with an
	 * EMPTY wakes list for a frame — the class that killed a section-owned dialog
	 * on monitors (U2). The row's record is owned by the pane BODY, so emptying
	 * the list takes the ROW (asserted) and not the sentence's home: when the row
	 * returns, the record is still there, and no second attempt was made.
	 */
	await p.rerender({ wakes: [] });
	assert.equal(
		document.querySelector('[data-wake-cancel="w1"]'),
		null,
		"the churn really happened: the section's rows are gone",
	);
	await p.rerender({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
	});
	assert.equal(
		document.querySelector("[data-wake-cancel-note]")?.textContent,
		OWNER_REFUSAL,
		"the sentence outlived the churn with its row",
	);
	assert.deepEqual(calls, ["w1"], "and the churn did not re-send");
	await p.unmount();
});

test("an engine row offers no control, states who manages it, and sends nothing", async () => {
	const calls = [];
	const p = await mount({
		wakes: [
			wireWake("aida-cadence", "Aida's daily check-in", {
				every_ms: 24 * 60 * 60 * 1000,
			}),
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async (id) => {
			calls.push(id);
			return { ok: true };
		},
	});
	const managed = document.querySelector("[data-wake-managed]");
	assert.ok(managed, "the engine row states its state");
	/*
	 * The VISIBLE state word is short, the whole sentence rides the state's
	 * `title`, and — since design round 1's D2 — the SAME sentence is drawn
	 * visibly as the row's note, because a lever reachable only by hover is a
	 * lever a keyboard or touch reader never sees.
	 */
	assert.equal(managed.textContent?.trim(), "managed by Aida");
	assert.match(
		managed.getAttribute("title") ?? "",
		/\/aida pause/,
		"the title carries the lever that works",
	);
	assert.match(
		document.querySelector("[data-wake-managed-note]")?.textContent ?? "",
		/\/aida pause/,
		"and so does the visible note",
	);
	assert.equal(
		document.querySelector('[data-wake-cancel="aida-cadence"]'),
		null,
		"and it offers no control at all",
	);
	assert.ok(
		document.querySelector('[data-wake-cancel="w1"]'),
		"the ordinary row beside it still offers one",
	);
	/*
	 * Nothing was pressed on the managed row, and nothing CAN be: the assertion
	 * above is that there is no element to press. One request count for the whole
	 * case, so a control that appeared somewhere unexpected would show up here.
	 */
	assert.deepEqual(calls, [], "no request for the engine row");
	await p.unmount();
});

test("her conversation asks first, names her, and Keep sends nothing", async () => {
	const calls = [];
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: HER_SESSION,
		aida: RESOLVED_AIDA,
		cancel: async (id) => {
			calls.push(id);
			return { ok: true };
		},
	});
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(
		await settle(() => confirmCard() !== null),
		"the confirmation opens",
	);
	assert.match(
		confirmCard().textContent,
		/Cancel Aida's check-in\?/,
		"the question names the chief of staff",
	);
	assert.match(confirmCard().textContent, /nothing re-creates it/);
	assert.deepEqual(calls, [], "opening asks; it does not write");

	await press(document.querySelector("[data-wake-confirm-keep]"));
	assert.ok(await settle(() => confirmCard() === null), "Keep closes the card");
	assert.deepEqual(calls, [], "and sends nothing");

	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(
		await settle(() => confirmCard() !== null),
		"reopening is a fresh question",
	);
	await press(document.querySelector("[data-wake-confirm-action]"));
	assert.ok(
		await settle(
			() =>
				document
					.querySelector('[data-wake-cancel="w1"]')
					?.getAttribute("data-wake-cancel-state") === "cancelled",
		),
		"the confirm writes and the row acknowledges",
	);
	assert.deepEqual(calls, ["w1"], "exactly one request for the one confirm");
	assert.equal(confirmCard(), null, "and the card closes on a landed write");
	await p.unmount();
});

test("a refusal renders inside the confirmation and outlives the churn", async () => {
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: HER_SESSION,
		aida: RESOLVED_AIDA,
		cancel: async () => ({ ok: false, detail: OWNER_REFUSAL }),
	});
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(
		await settle(() => confirmCard() !== null),
		"the confirmation opens",
	);
	await press(document.querySelector("[data-wake-confirm-action]"));
	assert.ok(
		await settle(
			() =>
				confirmCard()?.querySelector("[data-wake-confirm-refusal]")
					?.textContent === OWNER_REFUSAL,
		),
		"the refusal renders in the card that asked",
	);
	/*
	 * The refusal hands the keyboard back to the SAFE action: the next Enter must
	 * not repeat a refused cancel.
	 */
	assert.equal(
		document.activeElement,
		document.querySelector("[data-wake-confirm-keep]"),
		"focus is on Keep after the refusal",
	);

	/* THE CHURN, again: the rows leave and the card stays. */
	await p.rerender({ wakes: [] });
	assert.equal(
		document.querySelector('[data-wake-cancel="w1"]'),
		null,
		"the section's rows are gone",
	);
	assert.ok(confirmCard() !== null, "the card is STILL mounted");
	assert.equal(
		confirmCard().querySelector("[data-wake-confirm-refusal]")?.textContent,
		OWNER_REFUSAL,
		"with its sentence still on screen",
	);
	await p.rerender({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
	});
	assert.ok(
		confirmCard() !== null,
		"and it never left while the rows returned",
	);

	/* Escape closes it, and the keyboard lands back on the row's control. */
	await act(async () => {
		document.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			}),
		);
	});
	assert.ok(
		await settle(() => confirmCard() === null),
		"Escape closes the card",
	);
	assert.ok(
		await settle(
			() =>
				document.activeElement ===
				document.querySelector('[data-wake-cancel="w1"]'),
		),
		"focus returns to the row's own control",
	);
	await p.unmount();
});

test("an unknown identity fails closed, and the question stays neutral", async () => {
	const calls = [];
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: "some-other-session",
		aida: {
			capability: true,
			statusResolved: false,
			sessionId: null,
			name: "Aida",
		},
		cancel: async (id) => {
			calls.push(id);
			return { ok: true };
		},
	});
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(
		await settle(() => confirmCard() !== null),
		"an unknown identity asks",
	);
	assert.match(
		confirmCard().textContent,
		/Cancel this wake\?/,
		"and never claims a name it cannot stand behind",
	);
	assert.doesNotMatch(confirmCard().textContent, /Aida/);
	assert.deepEqual(calls, [], "asking is not writing");
	await p.unmount();
});

test("while a write is in flight the confirmation cannot be dismissed and keeps its verb", async () => {
	const gate = deferred();
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: HER_SESSION,
		aida: RESOLVED_AIDA,
		cancel: () => gate.promise,
	});
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(
		await settle(() => confirmCard() !== null),
		"the confirmation opens",
	);
	await press(document.querySelector("[data-wake-confirm-action]"));
	assert.ok(
		await settle(
			() =>
				document
					.querySelector("[data-wake-confirm-action]")
					?.hasAttribute("disabled") === true,
		),
		"the write disables both buttons",
	);
	assert.equal(
		document.querySelector("[data-wake-confirm-action]").textContent,
		"Cancelling…",
		"and keeps the verb the reader pressed",
	);
	/* Every close path is refused while the write is out. */
	await act(async () => {
		document.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	await act(async () => {});
	assert.ok(confirmCard() !== null, "Escape cannot dismiss a write in flight");
	await act(async () => {
		gate.resolve({ ok: true });
	});
	assert.ok(
		await settle(() => confirmCard() === null),
		"and the landed write closes it",
	);
	await p.unmount();
});

test("a re-armed wake that inherits a freed handle is cancellable, not marked (Q1 / F2)", async () => {
	const calls = [];
	const successor = wireWake("w1", "Re-armed after the cancel", {
		created_at: NOW_MS + 60_000,
	});
	const p = await mount({
		wakes: [wireWake("w1", "First, and then cancelled")],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async (id) => {
			calls.push(id);
			return { ok: true };
		},
	});
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(
		await settle(
			() =>
				document.querySelector('[data-wake-cancel-state="cancelled"]') !== null,
		),
		"the receipt lands",
	);
	/*
	 * THE RE-MINT: the backend mints the lowest free handle, so the schedule that
	 * takes the cancelled one's place IS `w1` again — and a DIFFERENT schedule.
	 * Keyed by the handle alone, this row rendered `Cancelled`, disabled (QA
	 * round 1's Q1, reproduced on the live backend); keyed by handle + creation
	 * instant (`wakeRowKey`) it is a stranger to the mark.
	 */
	await p.rerender({ wakes: [successor] });
	const control = document.querySelector('[data-wake-cancel="w1"]');
	assert.ok(control, "the successor is drawn");
	assert.equal(
		control.getAttribute("data-wake-cancel-state"),
		null,
		"the successor is NOT wearing its predecessor's receipt",
	);
	assert.equal(control.disabled, false, "and it can be cancelled");
	await press(control);
	assert.ok(
		await settle(() => calls.length === 2),
		"the press sent its own write",
	);
	assert.deepEqual(
		calls,
		["w1", "w1"],
		"one request per press, on one handle, for two different schedules",
	);
	await p.unmount();
});

test("the one-press write shows `Cancelling…`, disabled, while it is in flight (F8)", async () => {
	const gate = deferred();
	const p = await mount({
		wakes: [wireWake("w1", "A write the case can hold")],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async () => gate.promise,
	});
	const control = document.querySelector('[data-wake-cancel="w1"]');
	await press(control);
	assert.ok(
		await settle(() => control.textContent === "Cancelling…"),
		"the in-flight verb appears",
	);
	assert.equal(
		control.disabled,
		true,
		"and a second press is refused while it holds",
	);
	await act(async () => gate.resolve({ ok: true }));
	assert.ok(await settle(() => control.textContent === "Cancelled"));
	await p.unmount();
});

test("a landed one-press cancel lands the keyboard on the next row's control (U1)", async () => {
	/*
	 * UX round 1's U1: after Enter on the row's control, focus fell to `<body>`
	 * and the row left on the re-read. The successor is the landing stop. The
	 * guard must not depend on the browser having moved off the disabled control
	 * yet (jsdom keeps focus on one; Chromium blurs it; measured 2026-10-09) —
	 * the resolution decides either way, which is why this case needs no stub.
	 */
	const p = await mount({
		wakes: [
			wireWake("w1", "First"),
			wireWake("w2", "Second"),
			wireWake("w3", "Third"),
		],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async () => ({ ok: true }),
	});
	await press(document.querySelector('[data-wake-cancel="w2"]'));
	assert.ok(
		await settle(
			() =>
				document.activeElement ===
				document.querySelector('[data-wake-cancel="w3"]'),
		),
		"the keyboard lands on the successor row's control",
	);
	await p.unmount();
});

test("a landed cancel with no row after it lands the keyboard on the pane (U1)", async () => {
	/*
	 * The last row's successor is nothing, and `<body>` is the one landing the
	 * pane's standard forbids: the resolution falls to the pane's own focus
	 * container (`run-panel.tsx`'s `[data-run-panel-pane]`, `tabIndex={-1}`).
	 * The wrapper here is that marker; in the app the pane is the element that
	 * already contains these rows.
	 */
	const pane = document.createElement("section");
	pane.setAttribute("data-run-panel-pane", "");
	pane.tabIndex = -1;
	document.body.append(pane);
	const p = await mount({
		wakes: [wireWake("w1", "The only one")],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async () => ({ ok: true }),
	});
	pane.append(p.container);
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(
		await settle(() => document.activeElement === pane),
		"the keyboard lands on the pane, not the body",
	);
	await p.unmount();
});

test("a successor taken away by the re-read's churn lands on the pane (F13)", async () => {
	/*
	 * AGENT REVIEW ROUND 3's F13 (QA round 4's Q7 extends the same watch): the
	 * landing was resolved once, and the re-read's own churn — the pane
	 * re-renders with an EMPTY wakes list for a moment, the frame this
	 * interaction's header documents — unmounts the node the keyboard was just
	 * given, dropping focus to `<body>` (jsdom clears a removed active element
	 * the same way, measured; Blink's removal path agrees). The module-scope
	 * watcher re-resolves once: the pane takes the keyboard.
	 */
	const pane = document.createElement("section");
	pane.setAttribute("data-run-panel-pane", "");
	pane.tabIndex = -1;
	document.body.append(pane);
	const p = await mount({
		wakes: [
			wireWake("w1", "First"),
			wireWake("w2", "Second"),
			wireWake("w3", "Third"),
		],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async () => ({ ok: true }),
	});
	pane.append(p.container);
	await press(document.querySelector('[data-wake-cancel="w2"]'));
	assert.ok(
		await settle(
			() =>
				document.activeElement ===
				document.querySelector('[data-wake-cancel="w3"]'),
		),
		"the successor takes the keyboard first",
	);
	await p.rerender({ wakes: [] });
	assert.ok(
		await settle(() => document.activeElement === pane),
		"the churn's removal does not leave the keyboard on the body",
	);
	await p.unmount();
});

test("a landing survives the panel's own unmount and returns to the pane (Q7)", async () => {
	/*
	 * QA ROUND 4's Q7: the resync reconnects the stream, an `open{gap}` commit
	 * nulls `frontend` for a beat, `runDetails` goes with it, and the WHOLE run
	 * panel — the hook, its effects, and the node the keyboard was on —
	 * unmounts at once (4/13 natural presses settled on `<body>`; the panel
	 * back 13–700 ms later, nothing re-resolving). The watch now lives at
	 * module scope, so it outlives the unmount: with no home on screen it holds
	 * (bounded), and the pane's return is itself the mutation that ends it.
	 * The pane stub below is the panel's slot; here it leaves and comes back
	 * the way the gate's remount does.
	 */
	const p = await mount({
		wakes: [
			wireWake("w1", "First"),
			wireWake("w2", "Second"),
			wireWake("w3", "Third"),
		],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async () => ({ ok: true }),
	});
	await press(document.querySelector('[data-wake-cancel="w2"]'));
	assert.ok(
		await settle(
			() =>
				document.activeElement ===
				document.querySelector('[data-wake-cancel="w3"]'),
		),
		"the successor takes the keyboard first",
	);
	/*
	 * THE GATE'S GAP: everything inside the panel goes, the landing's node
	 * with it. jsdom moves a removed active element to the body (measured);
	 * the watch must not leave it there.
	 */
	await p.unmount();
	/* THE PANE RETURNS: a mutation the module watcher sees, like the gate's. */
	const returned = document.createElement("section");
	returned.setAttribute("data-run-panel-pane", "");
	returned.tabIndex = -1;
	document.body.append(returned);
	assert.ok(
		await settle(() => document.activeElement === returned),
		"the keyboard holds through the gap and lands on the returned pane",
	);
	returned.remove();
});

test("a refused press hands the keyboard back to its own retry control (U2)", async () => {
	const gate = deferred();
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: "sess1",
		aida: UNKNOWN_AIDA,
		cancel: async () => gate.promise,
	});
	const control = document.querySelector('[data-wake-cancel="w1"]');
	await press(control);
	/*
	 * The live condition the refusal left behind: the browser moves focus off a
	 * control that becomes DISABLED mid-write, and jsdom does not (measured), so
	 * the case blurs it the way the platform would — the condition the fix
	 * answers, not the fix itself.
	 */
	control.blur();
	await act(async () => gate.resolve({ ok: false, detail: OWNER_REFUSAL }));
	assert.ok(
		await settle(() => document.activeElement === control),
		"the surviving control — the next attempt — takes the keyboard back",
	);
	assert.equal(
		document.querySelector("[data-wake-cancel-note]")?.textContent,
		OWNER_REFUSAL,
		"and the sentence is there for the press that follows",
	);
	await p.unmount();
});

test("an outside press dismisses the question, and a busy write refuses it (F8)", async () => {
	const gate = deferred();
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: HER_SESSION,
		aida: RESOLVED_AIDA,
		cancel: async () => gate.promise,
	});
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	/*
	 * OUTSIDE, on the window listener the popover registers (capture phase):
	 * a pointerdown anywhere outside the card dismisses it, and the keyboard
	 * goes back to the row's own control.
	 */
	document.body.dispatchEvent(
		new DOM.window.Event("pointerdown", { bubbles: true }),
	);
	assert.ok(
		await settle(() => confirmCard() === null),
		"an outside press closes the question",
	);
	assert.ok(
		await settle(
			() =>
				document.activeElement ===
				document.querySelector('[data-wake-cancel="w1"]'),
		),
		"and focus is back on the control the question came from",
	);
	/* Reopened, a write in flight blocks the same dismissal. */
	await press(document.querySelector('[data-wake-cancel="w1"]'));
	assert.ok(await settle(() => confirmCard() !== null), "the question reopens");
	await press(
		Array.from(confirmCard().querySelectorAll("button")).find(
			(button) => button.textContent === "Cancel check-in",
		),
	);
	const blocked = new DOM.window.Event("pointerdown", {
		bubbles: true,
		cancelable: true,
	});
	document.body.dispatchEvent(blocked);
	await act(async () => {});
	assert.equal(
		blocked.defaultPrevented,
		false,
		"a busy write touches no default: only the dismissing press cancels one",
	);
	assert.ok(confirmCard() !== null, "the busy write keeps the card open");
	await act(async () => gate.resolve({ ok: true }));
	await settle(() => confirmCard() === null);
	await p.unmount();
});

test("an outside press returns the keyboard while the card's Keep still holds it (U3)", async () => {
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: HER_SESSION,
		aida: RESOLVED_AIDA,
		cancel: async () => ({ ok: true }),
	});
	const control = document.querySelector('[data-wake-cancel="w1"]');
	await press(control);
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	const keep = confirmCard().querySelector('[data-wake-confirm-keep=""]');
	assert.ok(keep, "the safe action is drawn");
	/*
	 * THE LIVE ORDERING jsdom cannot reproduce: the press's focus default lands
	 * AFTER the close commit, so at the instant the resolution runs the keyboard
	 * is still on the card's own Keep — a fall-through, not a reader who moved
	 * on purpose. The keyboard read is stubbed to that state for the close (the
	 * `composer-tabs.test.mjs` precedent for stubbing exactly this platform
	 * read), and dropped before the assertion reads the browser's own value:
	 * the card, its dismissal, the resolution and the focus it asks for are all
	 * real. Restoring the prototype's own descriptor is the `composer-tabs`
	 * recipe (`delete` is a lint error in this tree).
	 */
	const realActiveElement = Object.getOwnPropertyDescriptor(
		DOM.window.Document.prototype,
		"activeElement",
	);
	Object.defineProperty(document, "activeElement", {
		configurable: true,
		get: () => keep,
	});
	const dismissal = new DOM.window.Event("pointerdown", {
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		document.body.dispatchEvent(dismissal);
	});
	assert.equal(
		dismissal.defaultPrevented,
		true,
		"the dismissal press cancels its own focus default (Q6)",
	);
	Object.defineProperty(document, "activeElement", realActiveElement);
	assert.ok(
		await settle(() => document.activeElement === control),
		"the keyboard returns to the control the question came from",
	);
	await p.unmount();
});

test("an outside press on a focusable target keeps the press's own intent (F15)", async () => {
	/*
	 * F15, refining Q6: cancelling the dismissing press's `pointerdown` also
	 * swallowed its compatibility mouse events, so a press aimed at something
	 * that can take focus — the composer, in the app — neither focused it nor
	 * placed a caret, and the landing stole the keyboard first. The cancel is
	 * now reserved for targets that cannot hold focus (the chrome arm pinned
	 * in the U3 case); on a focusable target the default is left alone and the
	 * landing stands down. jsdom lands no default, so the pin here is the two
	 * facts the browser acts on: the press is NOT cancelled, and the landing
	 * did not move the keyboard onto the row's control.
	 */
	const p = await mount({
		wakes: [
			wireWake("w1", "4-hourly proactive check-in (operator-set cadence)"),
		],
		sessionId: HER_SESSION,
		aida: RESOLVED_AIDA,
		cancel: async () => ({ ok: true }),
	});
	const control = document.querySelector('[data-wake-cancel="w1"]');
	await press(control);
	assert.ok(await settle(() => confirmCard() !== null), "the question opens");
	const field = document.createElement("textarea");
	document.body.append(field);
	const dismissal = new DOM.window.Event("pointerdown", {
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		field.dispatchEvent(dismissal);
	});
	assert.equal(
		dismissal.defaultPrevented,
		false,
		"a focusable target's press is not cancelled (F15)",
	);
	assert.ok(
		await settle(() => confirmCard() === null),
		"and it still dismisses the question",
	);
	assert.notEqual(
		document.activeElement,
		control,
		"the landing stood down: the keyboard was not moved to the row's control",
	);
	field.remove();
	await p.unmount();
});
