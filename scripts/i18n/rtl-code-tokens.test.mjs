import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE TOKENS THE CODE PAINTS ITSELF: a slash-command row's `/{label}` and its
 * alias run, and a value the daemon hands the ask card.
 *
 * WHY THIS NEEDS ITS OWN FILE. `bidi-isolation.test.mjs` covers the strings that
 * pass through `translate()` - catalogue values and their arguments. These two
 * surfaces never touch a catalogue: the command word is a literal built in
 * `commandRowContent`, and an ask's question is the daemon's own text. So
 * neither `isolateSigils` nor `isolateArguments` ever sees them, and in Urdu
 * they painted wrong: the slash popup showed `help/`, `exit/`, `clear/` instead
 * of `/help`, `/exit`, `/clear` (QA Q1 / design D1, round 1), and a question
 * ending in `?` showed `?Which environment should I deploy this to` (design D2).
 *
 * WHAT IS ASSERTED, AND WHY EXACT CODE POINTS. "Contains a mark" would pass for
 * the wrong wrapper, for a nested pair, or for one isolate per token - and the
 * last of those is not a hypothetical: adjacent isolates in an RTL paragraph are
 * ordered right-to-left, so per-token wrapping REVERSES `/h /?` instead of
 * fixing it (measured below with `fribidi --rtl`). Each assertion is the exact
 * expected string, so any of those wrappers fails.
 *
 * THE NEGATIVE CONTROL IS THE PRE-FIX CODE ITSELF. One bundle is built with the
 * two new helpers replaced - in memory, over the real module path - by the
 * identity function, which is exactly what the render path did before they
 * existed: no isolation at all. The same assertions must then FAIL, and
 * `fribidi` must show the reversal. Nothing on disk is edited for it.
 */

const bootstrap = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
for (const name of [
	"Node",
	"Element",
	"HTMLElement",
	"SVGElement",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"PointerEvent",
	"FocusEvent",
	"InputEvent",
	"DOMRect",
	"DocumentFragment",
]) {
	if (bootstrap.window[name] !== undefined)
		globalThis[name] = bootstrap.window[name];
}
for (const name of [
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	if (typeof bootstrap.window[name] === "function")
		globalThis[name] = bootstrap.window[name].bind(bootstrap.window);
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
bootstrap.window.HTMLCanvasElement.prototype.getContext = () => null;
/* jsdom implements no layout: the popup's active-row reveal is a no-op here. */
bootstrap.window.HTMLElement.prototype.scrollIntoView = () => {};
if (!globalThis.CSS)
	globalThis.CSS = {
		escape: (value) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`),
	};

const { createRoot } = await import("react-dom/client");

const BIDI = new URL("../../src/i18n/bidi.ts", import.meta.url).pathname;

/**
 * The pre-fix rendering, reconstructed rather than edited: the real `bidi.ts`,
 * with the two render-side wrappers redefined to return their input. `export *`
 * loses to an explicit local export, so every other helper in the module - the
 * ones `translate()` uses - is still the shipped one and the catalogue path is
 * not disturbed.
 */
const BIDI_SPECIFIER = /i18n\/bidi$/;
const ANY_MODULE = /.*/;

const preFixHelpers = {
	name: "pre-fix-helpers",
	setup(builder) {
		builder.onResolve({ filter: BIDI_SPECIFIER }, (args) =>
			args.path.includes("i18n/bidi")
				? { path: "pre-fix-bidi", namespace: "pre-fix" }
				: undefined,
		);
		builder.onLoad({ filter: ANY_MODULE, namespace: "pre-fix" }, () => ({
			contents: [
				`export * from ${JSON.stringify(BIDI)};`,
				"export function isolateSigilRun(text) { return text; }",
				"export function isolateValue(text) { return text; }",
			].join("\n"),
			loader: "js",
			resolveDir: BIDI.slice(0, BIDI.lastIndexOf("/")),
		}));
	},
};

let bundleSeq = 0;

/** The shipped modules, or the same modules with the pre-fix helpers. */
async function load({ preFix = false } = {}) {
	bundleSeq += 1;
	const bundle = await build({
		stdin: {
			contents: [
				'export { SlashSuggestionsPopup } from "./src/renderer/src/features/chat/components/slash-commands";',
				'export { AskPanel } from "./src/renderer/src/features/chat/components/asks/ask-panel";',
				'export { askQueueView } from "./src/renderer/src/features/chat/ask-queue";',
				'export * as bidi from "./src/i18n/bidi";',
				'export * as locale from "./src/i18n/locale";',
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
			"@shared": "./src/renderer/src/shared",
			"@features": "./src/renderer/src/features",
		},
		loader: { ".css": "empty" },
		jsx: "automatic",
		define: { "import.meta.env": "{}" },
		external: [
			"react",
			"react-dom",
			"react-dom/client",
			"react/jsx-runtime",
			"@tanstack/react-query",
		],
		plugins: preFix ? [preFixHelpers] : [],
	});
	// Written to disk rather than imported from a data: URL, because React stays
	// external and a data: URL has no base path to resolve it from.
	const path = new URL(
		`./_rtl-code-tokens-${bundleSeq}.bundle.mjs`,
		import.meta.url,
	);
	await writeFile(path, bundle.outputFiles[0].text);
	const modules = await import(path.href);
	await unlink(path);
	return modules;
}

const shipped = await load();
const preFix = await load({ preFix: true });

const FSI = "\u2068";
const LRI = "\u2066";
const PDI = "\u2069";
const CONTROLS = /[\u200e\u200f\u2066-\u2069]/g;
const strip = (value) => value.replace(CONTROLS, "");

/*
 * `fribidi --rtl` is the audit instrument the ur receipts already use: it
 * returns the text in VISUAL order for a right-to-left paragraph, so a control
 * that isolates the run leaves the token reading left-to-right and the absence
 * of one does not. Skipped, never silently passed, where it is not installed.
 */
const probe = spawnSync("fribidi", ["--rtl"], { input: "", encoding: "utf8" });
const hasFribidi = probe.status === 0 && probe.error === undefined;
const visual = (text) => {
	const out = spawnSync("fribidi", ["--rtl"], {
		input: text,
		encoding: "utf8",
	});
	assert.equal(out.status, 0, "fribidi ran");
	return strip(out.stdout).trim();
};

const QUESTION = "Which environment should I deploy this to?";

const command = (over = {}) => ({
	name: "help",
	description: "List the commands",
	aliases: ["h", "?"],
	echo: false,
	consumes_prompt: false,
	arguments: "none",
	destination: "session.help",
	execution: "owner",
	...over,
});

/** The popup's state, in the shape `slash-tags-popup.test.mjs` already pins. */
const popupState = (over = {}) => ({
	phase: "command",
	open: true,
	active: 0,
	matches: [{ kind: "command", command: command(), label: "help" }],
	listId: "slash-bidi-test",
	activeDescendantId: null,
	inline: undefined,
	effectiveEntry: () => undefined,
	argumentQuery: "",
	commandQuery: "",
	argumentList: { rows: [], loading: false, error: null, needsSession: false },
	reopen: () => {},
	close: () => {},
	setActive: () => {},
	setActiveHover: () => {},
	chosenByHand: false,
	isLoading: false,
	available: true,
	commands: [command()],
	commandNames: new Set(["help", "h", "?"]),
	promptCommands: new Set(),
	armedOnlyCommands: new Set(),
	hoists: false,
	paneHasSession: true,
	...over,
});

const mount = async (element) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => root.render(element));
	return {
		container,
		async unmount() {
			await act(async () => root.unmount());
			container.remove();
		},
	};
};

/** The two slash spans of one command row, in paint order. */
const rowSpans = (container) => {
	const spans = [...container.querySelectorAll("li span")];
	return { word: spans[0], aliases: spans[1] };
};

/*
 * THE UNIT CONTRACT. One isolate per PAINTED RUN, and byte-identity off RTL:
 * `isolateSigilRun` states LTR on the command word (LRI, since a command word is
 * always Latin), `isolateValue` lets the value's own first strong character
 * decide (FSI, since the daemon's question may be Arabic), and neither touches
 * an empty run.
 */
test("each wrapper adds exactly one isolate, and nothing outside RTL", () => {
	const { bidi } = shipped;
	assert.equal(bidi.isolateSigilRun("/help", "rtl"), `${LRI}/help${PDI}`);
	assert.equal(bidi.isolateSigilRun("/h /?", "rtl"), `${LRI}/h /?${PDI}`);
	assert.equal(bidi.isolateValue(QUESTION, "rtl"), `${FSI}${QUESTION}${PDI}`);
	for (const dir of ["ltr"]) {
		assert.equal(bidi.isolateSigilRun("/help", dir), "/help");
		assert.equal(bidi.isolateSigilRun("/h /?", dir), "/h /?");
		assert.equal(bidi.isolateValue(QUESTION, dir), QUESTION);
	}
	assert.equal(bidi.isolateSigilRun("", "rtl"), "");
	assert.equal(bidi.isolateValue("", "rtl"), "");
});

test("under ur a command row paints its word and its alias run whole, in order", async () => {
	shipped.locale.setLocale("ur");
	const rig = await mount(
		React.createElement(shipped.SlashSuggestionsPopup, {
			state: popupState(),
			onPick: () => {},
		}),
	);
	try {
		const { word, aliases } = rowSpans(rig.container);
		// One isolate over the word: the `/` and the name are one run.
		assert.equal(word.textContent, `${LRI}/help${PDI}`);
		// One isolate over the ALIAS RUN - not one per alias, which reverses.
		assert.equal(aliases.textContent, `${LRI}/h /?${PDI}`);
		assert.equal(strip(word.textContent), "/help");
		assert.equal(strip(aliases.textContent), "/h /?");
		if (hasFribidi) {
			// VISUAL order, which is what the operator saw: `help/` before the fix.
			assert.equal(visual(word.textContent), "/help");
			assert.equal(visual(aliases.textContent), "/h /?");
		}
	} finally {
		await rig.unmount();
	}
});

test("under an LTR locale the same row is byte-identical to the raw tokens", async () => {
	shipped.locale.setLocale("fr");
	const rig = await mount(
		React.createElement(shipped.SlashSuggestionsPopup, {
			state: popupState(),
			onPick: () => {},
		}),
	);
	try {
		const { word, aliases } = rowSpans(rig.container);
		assert.equal(word.textContent, "/help");
		assert.equal(aliases.textContent, "/h /?");
		assert.equal(CONTROLS.test(word.textContent), false);
		assert.equal(CONTROLS.test(aliases.textContent), false);
	} finally {
		await rig.unmount();
	}
});

test("under ur an ask payload keeps its terminal punctuation inside the run", async () => {
	shipped.locale.setLocale("ur");
	const NOW = 1_700_000_000_000;
	const ask = {
		ask_id: "a-bidi",
		created_at: NOW - 60_000,
		expires_at: NOW + 600_000,
		timeout_s: 900,
		urgent: false,
		status: "open",
		delivered: false,
		questions: [
			{ id: "q1", question: QUESTION, options: [{ label: "staging" }] },
		],
	};
	const rig = await mount(
		React.createElement(shipped.AskPanel, {
			view: shipped.askQueueView({ asks: [ask], asks_open: 1 }),
			nowMs: NOW,
			answering: false,
			drafts: {},
			onDraftChange: () => undefined,
			onAnswer: () => undefined,
			onDecline: () => undefined,
		}),
	);
	try {
		const field = rig.container.querySelector('[data-lo-ask-question="q1"]');
		assert.ok(field, "the live question card mounted");
		const painted = [...field.querySelectorAll("p")].find(
			(node) => strip(node.textContent) === QUESTION,
		);
		assert.ok(painted, "the question is painted");
		assert.equal(painted.textContent, `${FSI}${QUESTION}${PDI}`);
		if (hasFribidi) {
			// The defect read `?Which environment ...`: the `?` resolved to the
			// paragraph's direction and left the sentence it belongs to.
			assert.equal(visual(painted.textContent), QUESTION);
		}
	} finally {
		await rig.unmount();
	}
});

/*
 * THE NEGATIVE CONTROL: the pre-fix rendering, through the same real components.
 * Each positive above is paired here with its unisolated output, and the visual
 * assertion proves the pairing is about the defect and not about the wrapper:
 * `help/`, `h/ ?/`, `?Which environment ...`.
 */
test("the pre-fix rendering fails these assertions (the tests discriminate)", async () => {
	preFix.locale.setLocale("ur");
	const rig = await mount(
		React.createElement(preFix.SlashSuggestionsPopup, {
			state: popupState(),
			onPick: () => {},
		}),
	);
	try {
		const { word, aliases } = rowSpans(rig.container);
		assert.equal(word.textContent, "/help", "no isolate before the fix");
		assert.equal(aliases.textContent, "/h /?", "no isolate before the fix");
		assert.notEqual(word.textContent, `${LRI}/help${PDI}`);
		if (hasFribidi) {
			assert.equal(visual(word.textContent), "help/");
			assert.notEqual(visual(aliases.textContent), "/h /?", "the run reverses");
		}
	} finally {
		await rig.unmount();
	}
});

test("the pre-fix ask payload does displace its `?` (the tests discriminate)", async () => {
	preFix.locale.setLocale("ur");
	const NOW = 1_700_000_000_000;
	const ask = {
		ask_id: "a-prefix",
		created_at: NOW - 60_000,
		expires_at: NOW + 600_000,
		timeout_s: 900,
		urgent: false,
		status: "open",
		delivered: false,
		questions: [
			{ id: "q1", question: QUESTION, options: [{ label: "staging" }] },
		],
	};
	const rig = await mount(
		React.createElement(preFix.AskPanel, {
			view: preFix.askQueueView({ asks: [ask], asks_open: 1 }),
			nowMs: NOW,
			answering: false,
			drafts: {},
			onDraftChange: () => undefined,
			onAnswer: () => undefined,
			onDecline: () => undefined,
		}),
	);
	try {
		const field = rig.container.querySelector('[data-lo-ask-question="q1"]');
		const painted = [...field.querySelectorAll("p")].find(
			(node) => strip(node.textContent) === QUESTION,
		);
		assert.equal(painted.textContent, QUESTION, "no isolate before the fix");
		if (hasFribidi) {
			assert.equal(visual(painted.textContent), `?${QUESTION.slice(0, -1)}`);
		}
	} finally {
		await rig.unmount();
	}
});
