import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The Monitors cancel interaction, driven on the shipped pane body in a real
 * DOM (jsdom).
 *
 * Why this file exists. The round's findings are about TIME and REMOUNTING,
 * not about a still: whether a refusal survives the canonical re-read's list
 * churn (U2), whether the write's window holds one request per press (U3),
 * whether a receipt's acknowledgement shows before the lagging re-read lands
 * (U4), whether a reopened dialog is clean (U5), and whether a dismissed
 * refusal leaves its record on the row and the next attempt clears it (U8).
 * Source text cannot answer those, and the frames cannot answer the request
 * COUNT; so the cases below mount the REAL `RunDetailsPanel` - the level that
 * owns the interaction, above the section's mount gate - and drive it with a
 * stubbed write.
 *
 * What is faked, and only that: the `controls` object (`useMonitorControls`'s
 * shape), because the wire is not this file's subject. The panel, the section,
 * the dialog, the shared modal, the stores and the primitives are the shipped
 * ones.
 *
 * What it is NOT: evidence about pixels - docs/evidence/chat-run-panel/
 * monitor-cancel-* is that - and not a substitute for the live drive the UX
 * walk performs against a real daemon.
 */

// React DOM feature-detects at import time, so the document exists first.
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chats",
});
/*
 * jsdom's own constructors are FORCED onto the global - Node 26 defines `Event`
 * and `CustomEvent` itself, and a React tree whose events are built from Node's
 * classes fails inside the commit phase with an error that reads like a
 * component bug. The recipe is `agents-offer-dismiss.test.mjs`'s.
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
/** Drain every queued frame, oldest first. */
const frame = () => {
	for (const callback of queuedFrames.splice(0)) callback(0);
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
const bundlePath = new URL(
	"._monitor-cancel-dialog.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => undefined));
const { RunDetailsPanel, deriveRunDetails } = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

/* ------------------------------------------------------------------ fixtures */

const NOW_MS = 1_700_000_000_000;

/**
 * The route's owner-present refusal, verbatim (`local_operator/monitors/
 * arm.py::OWNER_ANSWERED_MESSAGE`), so the sentence under test is the wire's
 * rather than a paraphrase.
 */
const OWNER_REFUSAL =
	"This conversation is open in a running session, which owns its monitors. Nothing was written. Retry in a moment, or change them from that session.";

/** One armed monitor in `MonitorState`'s shape (the composer-tabs helper's). */
const wireMonitor = (id, name) => ({
	id,
	name,
	tool: "bash",
	arguments: {},
	every_ms: 60_000,
	until_at: null,
	description: "",
	created_at: NOW_MS - 60_000,
	next_due_at: NOW_MS + 30_000,
	last_check_at: NOW_MS - 30_000,
	checks: 1,
	deliveries: 0,
	consecutive_failures: 0,
	disabled: false,
	disabled_reason: "",
});

const monitorsOf = (monitors) =>
	deriveRunDetails({ jobs: [], todos: [], wakes: [], monitors, nowMs: NOW_MS });

/* ------------------------------------------------------------------ harness */

/**
 * Mount the shipped pane body with a stub write and hand back the handles a
 * case drives it with. `rerender` replaces props on the SAME root - which is
 * what the canonical re-read's churn is: the same pane, a new `details`.
 */
const mount = async (initial) => {
	let props = initial;
	const element = () =>
		React.createElement(RunDetailsPanel, {
			details: monitorsOf(props.monitors),
			mcpServers: [],
			mcpGrantRunning: false,
			// Only the MCP section reads it, and no case renders that section.
			mcpRemedy: {},
			childrenOpenable: false,
			onOpenChild: () => undefined,
			rosterExpanded: false,
			onToggleRosterExpanded: () => undefined,
			paneWidth: 420,
			monitorControls: { cancel: props.cancel },
			/*
			 * The wakes cancel interaction (the wakes control slice) is inert here:
			 * this file's subject is the MONITORS' dialog, and the panel requires the
			 * pair the same way it requires the monitor controls. The wakes side is
			 * driven by script/wake-cancel-panel.test.mjs.
			 */
			wakeControls: { cancel: async () => ({ ok: true }) },
			wakeAida: {
				capability: false,
				statusResolved: false,
				sessionId: null,
				name: "Aida",
			},
			sessionId: props.sessionId,
		});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element());
	});
	return {
		rerender: async (updates) => {
			props = { ...props, ...updates };
			await act(async () => {
				root.render(element());
			});
		},
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
};

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
const dialog = () => document.body.querySelector('[role="dialog"]');
const sentenceIn = (text) => (dialog()?.textContent ?? "").includes(text);

/**
 * Press a control the way a pointer does: focus first (so the dialog's
 * opener-capture sees the trigger, as a real click does in Chromium), then a
 * bubbling click through React's delegated listener.
 */
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

test("a refusal survives the list churn: the dialog outlives the section's gate", async () => {
	/*
	 * U2, the walked defect: the canonical re-read a cancel fires re-renders
	 * the pane with an EMPTY monitors list for a frame; ~8 of 34 refusals lost
	 * their sentence 60-400 ms after it painted (the section unmounted, taking
	 * a section-owned dialog with it) and the keyboard fell to `<body>`. The
	 * dialog now lives in the pane body, above the gate: emptying the list must
	 * drop the ROWS (asserted, so the churn really happened) and leave the
	 * dialog and its sentence exactly where they were.
	 */
	const calls = [];
	const p = await mount({
		monitors: [
			wireMonitor("m1", "deploy queue"),
			wireMonitor("m2", "loom-pr-1710"),
		],
		sessionId: "s1",
		cancel: async (id) => {
			calls.push(id);
			return { ok: false, detail: OWNER_REFUSAL };
		},
	});
	await press(document.querySelector('[data-monitor-cancel="m2"]'));
	assert.ok(await settle(() => dialog() !== null), "the confirmation opens");
	await press(dialog().querySelector("[data-confirm-action]"));
	assert.ok(
		await settle(() => sentenceIn(OWNER_REFUSAL)),
		"the refusal renders in the dialog",
	);
	assert.deepEqual(
		calls,
		["m2"],
		"one request per press against an answering writer",
	);

	await p.rerender({ monitors: [] }); // THE CHURN
	assert.equal(
		document.querySelector('[data-monitor-cancel="m2"]'),
		null,
		"the section's rows are gone",
	);
	assert.ok(dialog() !== null, "the dialog is STILL mounted");
	assert.ok(sentenceIn(OWNER_REFUSAL), "and its sentence is still on screen");

	await p.rerender({
		monitors: [
			wireMonitor("m1", "deploy queue"),
			wireMonitor("m2", "loom-pr-1710"),
		],
	});
	assert.ok(
		dialog() !== null,
		"when the rows return the dialog has never left",
	);

	await p.unmount();
});

test("a dismissed refusal leaves its record on the row; the next open is clean and clears it", async () => {
	/*
	 * U8 + U5 + U2's focus half, in the order a reader meets them: the refusal
	 * hands the keyboard to Keep, Keep returns it to the row's control, the row
	 * records the refusal (whole sentence on `title`), and reopening is a FRESH
	 * question - no stale sentence (U5) and the record cleared (U8).
	 */
	const p = await mount({
		monitors: [wireMonitor("m2", "loom-pr-1710")],
		sessionId: "s1",
		cancel: async () => ({ ok: false, detail: OWNER_REFUSAL }),
	});
	const trigger = () => document.querySelector('[data-monitor-cancel="m2"]');
	await press(trigger());
	assert.ok(await settle(() => dialog() !== null), "the confirmation opens");
	await press(dialog().querySelector("[data-confirm-action]"));
	assert.ok(
		await settle(() => sentenceIn(OWNER_REFUSAL)),
		"the refusal renders",
	);
	assert.equal(
		document.activeElement,
		dialog().querySelector("[data-cancel-action]"),
		"focus moves to Keep on a refusal",
	);

	await press(dialog().querySelector("[data-cancel-action]"));
	assert.ok(await settle(() => dialog() === null), "Keep dismisses the dialog");
	assert.equal(
		document.activeElement,
		trigger(),
		"focus returns to the trigger that asked",
	);
	const record = document.querySelector(
		'[data-monitor-cancel-state="refused"]',
	);
	assert.ok(record, "the row records the refusal");
	assert.equal(
		record.getAttribute("title"),
		OWNER_REFUSAL,
		"with the whole sentence on the title",
	);

	await press(trigger());
	assert.ok(await settle(() => dialog() !== null), "it reopens");
	assert.equal(
		sentenceIn(OWNER_REFUSAL),
		false,
		"no stale sentence before any press (U5)",
	);
	assert.equal(
		document.querySelector('[data-monitor-cancel-state="refused"]'),
		null,
		"and the record clears on the next attempt (U8)",
	);

	await p.unmount();
});

test("the write's window holds one request and both buttons, and a receipt marks the row", async () => {
	/*
	 * U3 + U4: from the press, both footer buttons pend, the confirm swaps to
	 * `Stopping…` (design round 1, D3: the busy label keeps the confirm's own
	 * verb - `Stopping…` under `Stop monitor` - rather than turning into a
	 * different act mid-press), and a re-press reaches nothing - the count
	 * asserted below is what pins it, so the disabled attributes and the
	 * handler's `busy` guard are pinned as ONE behaviour rather than two. On the
	 * receipt the dialog closes and the row acknowledges IMMEDIATELY (U4's
	 * settling mark), reconciled by the re-read that drops the row.
	 */
	const calls = [];
	const gate = deferred();
	const p = await mount({
		monitors: [wireMonitor("m2", "loom-pr-1710")],
		sessionId: "s1",
		cancel: (id) => {
			calls.push(id);
			return gate.promise;
		},
	});
	await press(document.querySelector('[data-monitor-cancel="m2"]'));
	assert.ok(await settle(() => dialog() !== null), "the confirmation opens");
	await press(dialog().querySelector("[data-confirm-action]"));
	assert.ok(
		await settle(() => calls.length === 1),
		"the press sends one request",
	);

	const confirmButton = () => dialog().querySelector("[data-confirm-action]");
	const keepButton = () => dialog().querySelector("[data-cancel-action]");
	assert.ok(
		await settle(
			() =>
				confirmButton()?.hasAttribute("disabled") === true &&
				keepButton()?.hasAttribute("disabled") === true,
		),
		"both buttons pend while the write is in flight",
	);
	assert.equal(confirmButton().textContent.trim(), "Stopping…");
	assert.equal(confirmButton().getAttribute("aria-busy"), "true");

	await press(confirmButton());
	assert.equal(calls.length, 1, "a re-press sends nothing");

	await act(async () => {
		gate.resolve({ ok: true });
	});
	assert.ok(
		await settle(() => dialog() === null),
		"the receipt closes the dialog",
	);
	const mark = document.querySelector(
		'[data-monitor-cancel-state="cancelled"]',
	);
	assert.ok(mark, "the row acknowledges the receipt at once");
	assert.equal(mark.textContent.trim(), "Cancelled");
	assert.equal(
		mark.hasAttribute("disabled"),
		true,
		"the mark is the control itself, inert",
	);

	await p.rerender({ monitors: [] });
	assert.equal(
		document.querySelector('[data-monitor-cancel-state="cancelled"]'),
		null,
		"the re-read dropping the row is what ends the mark",
	);

	await p.unmount();
});

test("a session switch closes the interaction and clears the row records", async () => {
	/*
	 * Monitor handles are per-session (`m1`..), so a pending press or a record
	 * must not be readable against another conversation's list. The reset is
	 * the guard that makes that true rather than lucky.
	 */
	const p = await mount({
		monitors: [wireMonitor("m2", "loom-pr-1710")],
		sessionId: "s1",
		cancel: async () => ({ ok: false, detail: OWNER_REFUSAL }),
	});
	await press(document.querySelector('[data-monitor-cancel="m2"]'));
	assert.ok(await settle(() => dialog() !== null), "the confirmation opens");
	await press(dialog().querySelector("[data-confirm-action]"));
	assert.ok(
		await settle(() => sentenceIn(OWNER_REFUSAL)),
		"the refusal renders",
	);

	await p.rerender({ sessionId: "s2" });
	assert.ok(
		await settle(() => dialog() === null),
		"the dialog closes with the session",
	);
	assert.equal(
		document.querySelector('[data-monitor-cancel-state="refused"]'),
		null,
		"and the record does not follow it",
	);

	await p.unmount();
});
