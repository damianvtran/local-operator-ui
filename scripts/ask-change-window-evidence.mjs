#!/usr/bin/env node
/**
 * THE CHANGE WINDOW, IN A REAL DOM — the three claims that cannot be asserted by
 * markup alone.
 *
 * WHY THIS IS A RIG AND NOT A `.test.mjs`. `scripts/ask-revise.test.mjs` renders the
 * shipped panel with `renderToStaticMarkup`, which is the right cost for a state
 * that is decided at render time — and it cannot press anything. Three of this
 * round's claims are about what happens AFTER a press, or about markup a `Disclosure`
 * only paints once it is OPEN:
 *
 *   1. UX round 1, U2 — pressing `Change answer` unmounts the control that was
 *      pressed and mounts the form in its place, and the keyboard has to follow it.
 *      Measured, not asserted from source: `document.activeElement` after the press.
 *   2. Design round 1, D1 = UX round 1, U1 — a refused change must withdraw the door
 *      whose only possible outcome is that refusal (the second press the finding
 *      measured).
 *   3. UX round 1, U1 — the sentence has to TRAVEL with the ask. The reachable path
 *      (the frame catches up while the press is in flight) files the ask as settled
 *      history, whose rows exist only inside the section's disclosure — so the
 *      proof requires opening it and then reading the row's own summary.
 *   4. Design round 1, D2 = agent review round 1's MAJOR — §10's window is `answered`
 *      OR `late`; the `late` half draws the same door in the same DOM.
 *   5. Agent review round 2's minor, and round 3's BLOCKER — a refusal that NEVER
 *      REACHED the backend must not withdraw the door. Only the owner's own verdict
 *      shuts it (`refusedByOwner`), because the outcome record is never cleared and a
 *      failed press would otherwise leave the ask with no affordance until the mount
 *      changed. Case 6 builds that record the way the CALLER does — the shipped
 *      classifier over a `DesktopControlError` the shipped transport really threw —
 *      because the first cut hand-wrote `{ sending: false, refused }` with no flag at
 *      all, so it passed while every real failure classified as the owner's.
 *
 * WHAT IS REAL: the shipped `AskPanel` → `AskRow` → `Disclosure` subtree, the
 * shipped fixtures' shapes, the shipped transport and the shipped refusal classifier
 * (case 6), and real DOM events. What is faked: the `changed` receipt and the
 * `refused` sentence of the cases that only test the RENDER of a record — the record
 * is a prop here, because it is the caller's state and this rig has no caller.
 *
 * The repo keeps jsdom mounts of this graph in bounded one-shot rigs rather than in
 * `node --test` for a measured reason (`scripts/fleet-ask-escape-evidence.mjs`: a
 * runaway tree the fleet's memory guard reaped). Run it bounded:
 *
 *   NODE_OPTIONS=--max-old-space-size=1024 timeout 120 \
 *     node scripts/ask-change-window-evidence.mjs
 *
 * A watchdog inside the process means a stuck mount exits 3 with a reason rather
 * than hanging a shell.
 */

import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const WATCHDOG_MS = 90_000;
const watchdog = setTimeout(() => {
	console.error(
		"ask-change-window-evidence: WATCHDOG fired — the mount did not settle",
	);
	process.exit(3);
}, WATCHDOG_MS);
watchdog.unref?.();

const lines = [];
const say = (line) => {
	lines.push(line);
};
let failures = 0;
const check = (label, ok, detail) => {
	say(
		`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : `  [${detail}]`}`,
	);
	if (!ok) failures += 1;
};

/*
 * QUIET, DELIBERATELY: the panel's disclosure triggers carry tooltips, whose
 * provider is above this subtree, and React dev-build warnings about that are
 * per-render. The transcript below is the output.
 */
console.error = () => {};

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chat",
});
for (const key of [
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
]) {
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
};

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

/** One two-question ask, the shape the whole-ask body exists for. */
const ask = (over) => ({
	ask_id: "a-change",
	created_at: NOW - 3 * MINUTE,
	expires_at: NOW + 27 * MINUTE,
	timeout_s: 1800,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "q1",
			question: "Which environment?",
			options: [{ label: "staging" }, { label: "production" }],
			multi: false,
		},
		{
			id: "q2",
			question: "Freeze the deploy window?",
			options: [{ label: "yes" }, { label: "no" }],
			multi: false,
		},
	],
	...over,
});
const answeredNotDelivered = () =>
	ask({
		status: "answered",
		answered_at: NOW - MINUTE,
		answered_by: { surface: "desktop" },
		answers: { q1: ["staging"], q2: ["yes"] },
	});
const answeredDelivered = () =>
	ask({ ...answeredNotDelivered(), delivered: true });
const lateNotDelivered = () =>
	ask({
		ask_id: "a-late",
		expires_at: NOW - 2 * MINUTE,
		status: "late",
		answered_at: NOW - MINUTE,
		answered_by: { surface: "desktop" },
		answers: { q1: ["staging"], q2: ["yes"] },
	});
/** A secret-only question, where the form's landing is the masked field. */
const secretAsk = () =>
	ask({
		ask_id: "a-secret",
		status: "answered",
		answered_at: NOW - MINUTE,
		answered_by: { surface: "desktop" },
		answers: { q1: ["API_KEY"] },
		questions: [
			{
				id: "q1",
				question: "Paste the deploy key",
				secret: true,
				options: undefined,
			},
		],
	});

const REFUSAL = "already delivered — send a new message";

const bundle = await build({
	stdin: {
		contents: [
			'export { AskPanel } from "./src/renderer/src/features/chat/components/asks/ask-panel";',
			'export { askQueueView, askRefusalIsOwner, askRefusalSentence } from "./src/renderer/src/features/chat/ask-queue";',
			'export { desktopResult } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { DESKTOP_MACHINE_DETAIL, DESKTOP_REFUSAL_CODE } from "./src/shared/desktop-contract";',
			'export { createRoot } from "react-dom/client";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	alias: {
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
	},
	loader: { ".css": "empty", ".svg": "text" },
	define: { "import.meta.env": "{}" },
	logLevel: "silent",
});
const bundlePath = `${process.cwd()}/.ask-change-window-evidence.bundle.mjs`;
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	AskPanel,
	askQueueView,
	askRefusalIsOwner,
	askRefusalSentence,
	desktopResult,
	DESKTOP_MACHINE_DETAIL,
	DESKTOP_REFUSAL_CODE,
	createRoot,
} = await import(bundlePath);
await unlink(bundlePath);

const flush = async (times = 6) => {
	for (let i = 0; i < times; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

const click = async (target) => {
	await act(async () => {
		target.dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await flush();
};

/*
 * The revise press's own body, so the transport under test sees the request the
 * product sends.
 */
const REVISE_REQUEST = {
	op: "sessions.answer",
	sessionId: "0f9c1e2d3a4b",
	askId: "a-change",
	answers: { q1: ["staging"] },
	revise: true,
};

/**
 * Drive the SHIPPED transport over one stubbed reply from main, and hand back the
 * error it threw.
 *
 * `desktopRequest` reads the real IPC channel off `window.api.desktop.request`, so
 * stubbing exactly that is the whole seam: `desktopResult` parses the envelope and
 * throws the SHIPPED `DesktopControlError`. Nothing below hand-builds an error — that
 * is what round 3's finding was about, and the rig's own record has to come from the
 * same code the app runs or it proves nothing about the classification.
 */
const transportRefusal = async (reply) => {
	DOM.window.api = {
		desktop: {
			request: async () => {
				if (reply instanceof Error) throw reply;
				return reply;
			},
		},
	};
	let error;
	try {
		await desktopResult(REVISE_REQUEST);
	} catch (caught) {
		error = caught;
	} finally {
		// `Reflect` rather than the `delete` operator (`biome`'s `noDelete` rule): the
		// jsdom window keeps its own identity, only the stub comes off it.
		Reflect.deleteProperty(DOM.window, "api");
	}
	if (error === undefined) throw new Error("the transport did not refuse");
	return error;
};

/** The caller's own record, built exactly the way `chat-page.tsx` builds it. */
const refusalRecord = async (reply) => {
	const error = await transportRefusal(reply);
	return {
		sending: false,
		refused: askRefusalSentence(error),
		refusedByOwner: askRefusalIsOwner(error),
	};
};

/**
 * Mount the shipped panel over one ask, with the caller's record supplied.
 *
 * Re-mounted per case rather than reused: two of the claims are about what a mount
 * looks like, and a shared root would carry the previous case's focus and open
 * state into the next.
 */
const mount = async ({ rows, outcomes }) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			React.createElement(AskPanel, {
				view: askQueueView({ asks: rows, asks_open: 0 }),
				nowMs: NOW,
				answering: false,
				outcomes,
				drafts: {},
				onDraftChange: () => undefined,
				onAnswer: () => undefined,
				onDecline: () => undefined,
				onRevise: () => undefined,
			}),
		);
	});
	await flush();
	return { container, root };
};

const text = (node) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const buttons = (container, label) =>
	[...container.querySelectorAll("button")].filter(
		(button) => text(button) === label,
	);

/* ---------------------------------------------------------------- case 1 ---- */

{
	/*
	 * U2: the keyboard follows the press into the form. `Change answer` is unmounted
	 * and replaced, so without the hand-off `document.activeElement` is the BODY and
	 * the next Tab restarts at the top of the page.
	 */
	const { container } = await mount({ rows: [answeredNotDelivered()] });
	const [open] = buttons(container, "Change answer");
	check(
		"1. the answered-and-undelivered card offers `Change answer`",
		Boolean(open),
	);
	open.focus();
	check(
		"1. the pressed control holds focus before the press",
		document.activeElement === open,
	);
	await click(open);
	const landing = document.activeElement;
	check(
		"1. the form is open (its submit is on screen)",
		buttons(container, "Update answer").length === 1,
	);
	check(
		"1. focus follows the press INTO the form, not to the body",
		landing !== document.body &&
			landing instanceof DOM.window.HTMLElement &&
			(landing.matches("button[data-ask-option]") ||
				landing.matches("input[data-ask-secret]")),
		`active=${landing?.tagName ?? "null"} ${
			landing instanceof DOM.window.HTMLElement
				? (landing.getAttribute("data-ask-option") ??
					landing.getAttribute("data-ask-secret"))
				: ""
		}`,
	);
	check(
		"1. the landing is the FIRST live option of the form",
		landing ===
			container.querySelector("button[data-ask-option]:not([disabled])"),
	);
	/*
	 * UX round 1, U4 / design round 1, D6: the card and the chip state the CONDITION
	 * (`Answered — delivering`, `not yet delivered`) and neither names the BOUND. The
	 * sentence that does is this surface's own, and it rides with the control it is
	 * about — so it exists exactly while the form is open.
	 */
	const hint = "You can change this until the agent is handed your answer.";
	check(
		"1. the form names what closes the window",
		text(container).includes(hint),
	);
}

/* ---------------------------------------------------------------- case 2 ---- */

{
	/*
	 * The secret arm of the same rule: a secret-only ask has no option to take the
	 * hand-off, so the landing is the masked field (the pair `question-dock.tsx`
	 * reads for the identical press).
	 */
	const { container } = await mount({ rows: [secretAsk()] });
	const [open] = buttons(container, "Change answer");
	check("2. a secret card offers `Change answer` too", Boolean(open));
	await click(open);
	const landing = document.activeElement;
	check(
		"2. focus lands on the masked field when there is no option to take it",
		landing instanceof DOM.window.HTMLElement &&
			landing.matches("input[data-ask-secret]"),
		`active=${landing?.tagName ?? "null"}`,
	);
}

/* ---------------------------------------------------------------- case 3 ---- */

{
	/*
	 * D1 = U1, first half: the owner's refusal closes the door. The wire still says
	 * undelivered here (the frame the press was made from), so only the refusal can
	 * be what withdrew the control.
	 */
	const { container } = await mount({
		rows: [answeredNotDelivered()],
		/*
		 * `refusedByOwner` is the classification that shuts the door (agent review round 2,
		 * minor): the sentence alone is a fact about the press, not a verdict on the window.
		 */
		outcomes: {
			"a-change": { sending: false, refused: REFUSAL, refusedByOwner: true },
		},
	});
	check(
		"3. a refused change leaves NO `Change answer` to press again",
		buttons(container, "Change answer").length === 0,
	);
	check(
		"3. the owner's sentence is rendered in place",
		text(container).includes(REFUSAL),
	);
}

/* ---------------------------------------------------------------- case 4 ---- */

{
	/*
	 * U1, second half: the sentence travels with the ask. The frame caught up while
	 * the press was in flight, so the ask is settled history — whose rows are drawn
	 * only inside the section's disclosure, which is why this case has to open it.
	 */
	const { container } = await mount({
		rows: [answeredDelivered()],
		outcomes: {
			"a-change": { sending: false, refused: REFUSAL, refusedByOwner: true },
		},
	});
	const section = container.querySelector("[data-lo-ask-settled]");
	check("4. the ask left the pending list for `Settled`", Boolean(section));
	// The section's own trigger is the first button inside it; the rows are drawn only
	// once it is open, which is the whole reason this case needs a DOM.
	const header = section?.querySelector("button");
	check(
		"4. the section is collapsed before the press (so the rows are not drawn yet)",
		Boolean(header) && !text(section).includes(REFUSAL),
	);
	await click(header);
	check(
		"4. the settled row paints the owner's sentence WITHOUT opening the row",
		text(section).includes(REFUSAL),
		`text=${text(section).slice(0, 140)}`,
	);
}

/* ---------------------------------------------------------------- case 5 ---- */

{
	/*
	 * D2 = the review's MAJOR: §10's window is `answered` OR `late`, and the late half
	 * is the one that renders no door at all before the fix. Same DOM, same control.
	 */
	const { container } = await mount({ rows: [lateNotDelivered()] });
	check(
		"5. a LATE-but-undelivered answer offers the same door",
		buttons(container, "Change answer").length === 1,
	);
	const delivered = await mount({
		rows: [ask({ ...lateNotDelivered(), delivered: true })],
	});
	check(
		"5. a delivered one offers nothing (history)",
		buttons(delivered.container, "Change answer").length === 0,
	);
}

/* ---------------------------------------------------------------- case 6 ---- */

{
	/*
	 * AGENT REVIEW ROUND 2'S MINOR AND ROUND 3'S BLOCKER, in the DOM and THROUGH THE REAL
	 * PATH. A refusal that never reached the backend must NOT withdraw the door: the
	 * outcome record is never cleared, so closing on one left the ask with no affordance
	 * for the life of the mount. Only the owner's own verdict may, and the record is built
	 * by the CALLER'S OWN CODE (`askRefusalSentence` + `askRefusalIsOwner`, as
	 * `chat-page.tsx` and `fleet-ask-drawer.tsx` build it) over an error the shipped
	 * transport threw from main's 503 `transport.failed` envelope. The sentence is painted
	 * either way — it is a fact about the press.
	 */
	const failedRecord = await refusalRecord({
		status: 503,
		body: {
			detail: {
				code: DESKTOP_REFUSAL_CODE.transportFailed,
				message: DESKTOP_MACHINE_DETAIL.transportFailed,
			},
		},
	});
	const failed = await mount({
		rows: [answeredNotDelivered()],
		outcomes: { "a-change": failedRecord },
	});
	check(
		"6. a refusal that reached nothing keeps `Change answer`",
		buttons(failed.container, "Change answer").length === 1,
		`refusedByOwner=${failedRecord.refusedByOwner}`,
	);
	check(
		"6. and its sentence is still painted",
		text(failed.container).includes(failedRecord.refused),
		`sentence=${failedRecord.refused}`,
	);
	/*
	 * And the other half: the OWNER's refusal — a 409 carrying its own sentence — really
	 * does shut it, so the fix narrows the verdict rather than disabling it.
	 */
	const ownedRecord = await refusalRecord({
		status: 409,
		body: { detail: REFUSAL },
	});
	const owned = await mount({
		rows: [answeredNotDelivered()],
		outcomes: { "a-change": ownedRecord },
	});
	check(
		"6. the owner's verdict still shuts it",
		buttons(owned.container, "Change answer").length === 0,
		`refusedByOwner=${ownedRecord.refusedByOwner}`,
	);
}

/* ---------------------------------------------------------------- report ---- */

for (const line of lines) {
	process.stdout.write(`${line}\n`);
}
process.stdout.write(
	`\nask-change-window-evidence: ${failures === 0 ? "PASS" : `${failures} FAILURE(S)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
