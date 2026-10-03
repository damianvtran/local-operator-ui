/**
 * The action row under a turn-closing answer (#695): which actions it offers,
 * what its Copy writes, and what a press does.
 *
 * FOUR THINGS LIVE HERE, and they are the parts a frame cannot settle:
 *
 * 1. WHICH ACTIONS THE ROW OFFERS (`answerActionsFor`) - copy always and
 *    first, speak only when an agent id resolves, and fork only for a row the
 *    transcript can name a cut point for.
 * 2. WHICH ROWS ARE CUT POINTS (`forkEntryId`) - the settled user and assistant
 *    rows carry the journal entry id a fork is cut through; a tool row's id is
 *    `tool:<call id>` and is not one.
 * 3. WHAT COPY WRITES - the answer's VISIBLE text (`parseReplies`'s
 *    `remainingContent`), markdown verbatim and without a reply-quote's
 *    `<reply-to>` transport markup. Asserted against the SHIPPED parser with a
 *    fixture that carries all three shapes (a reply block, a fence, a table),
 *    because the failure mode this guards is a payload that quietly becomes the
 *    raw `record.text` - which would paste the reader's own prompt back at them.
 * 3. WHAT A PRESS DOES - one clipboard call through the canonical path, the
 *    label flipped to `Copied`, and the label returning to `Copy` on the timer
 *    that this row needs and the older toolbars never did (they reset on their
 *    subject changing; this row's subject never changes while it is mounted).
 *    Mounted in JSDOM against the real component and the real clipboard call
 *    site, because "the press copies" is not a claim a source scan can carry.
 * 4. WHAT THE FORK PRESS ASKS FOR - a presentation request naming THIS row's
 *    conversation and THIS row's entry, against the real store the pane
 *    consumes. "The press carries the row's id" is a fact about an argument no
 *    frame can show.
 * 5. THE FAILURE PATH - a refused write leaves the label alone. `Copied` on a
 *    press the browser discarded is the one outcome this row must not produce.
 * 6. THE MOUNT GATE - the row appears only where the transcript's `isQuotable`
 *    says there are words to copy. Asserted by RENDERING the real transcript
 *    with an answer still streaming and with an answer whose whole body is
 *    reply markup, because a gate read off the source is a gate a single
 *    constant in `quote-model.ts` can bypass without failing anything.
 *
 * WHAT THIS FILE DOES NOT PROVE: how the row looks in any theme, where its box
 * sits against the answer's (that is a DOM measurement -
 * `scripts/chat-alignment-geometry.mjs`, quoted in
 * `docs/evidence/chat-canonical-message-actions/README.md`), or that a real
 * Speech service answers. The frames are the first two; the third is the
 * speech stack's own subject.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** One alias for the static renders below, so their shape stays readable. */
const h = React.createElement;

/*
 * React reads this flag to decide whether `act`'s warning applies. Without it
 * every mount in this file warns "The current testing environment is not
 * configured to support act(...)" - noise that would bury a real warning about
 * the component.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The persisted stores (the canonical sessions store reaches this bundle through
 * the row's speech target) resolve their storage ONCE, at module evaluation,
 * before this file's own mount creates a jsdom window - so the storage has to
 * exist here, ahead of the bundle import, or the store's write path throws on
 * `undefined.setItem`.
 */
const persisted = new Map();
globalThis.localStorage = {
	getItem: (key) => persisted.get(key) ?? null,
	setItem: (key, value) => persisted.set(key, value),
	removeItem: (key) => persisted.delete(key),
};

const ROW_SOURCE = readFileSync(
	"src/renderer/src/features/chat/canonical/message-actions-row.tsx",
	"utf8",
);
const TRANSCRIPT_SOURCE = readFileSync(
	"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	"utf8",
);

/*
 * The regex literals this module uses, hoisted to the top level: the
 * `useTopLevelRegex` rule charges a literal constructed inside a function, and
 * `scripts/` is outside `pnpm lint`'s path list, so this tree's own gate
 * (`pnpm lint:scripts`) is the only thing that would have said so.
 */
const RE_ROW_MOUNT =
	/<AnswerActionRow\b[\s\S]{0,200}bodyText=\{remainingContent\}/;
const RE_CLOSES_TURN_LINE = /\{closesTurn && \(/;
const RE_ROW_MOUNT_SITES = /<AnswerActionRow\b/g;
const RE_USER_ROW_MOUNT = /<AnswerActionRow\s+kind="user"/;

/**
 * One in-memory build of the shipped row and its model.
 *
 * React stays EXTERNAL, the recipe the other mount rigs in this tree carry: the
 * component is rendered by this process's `react-dom`, and a bundled second copy
 * of React would give it a different hook dispatcher. The credential probe is
 * aliased to a fixture - the real hook is a react-query read against a local
 * server, and what this file needs from it is only the ANSWER, in both of its
 * halves.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { AnswerActionRow } from "./src/renderer/src/features/chat/canonical/message-actions-row";
			export { answerActionsFor, forkEntryId, forkExcerpt, FORK_EXCERPT_MAX_CHARS, ANSWER_ACTIONS_LABEL, COPY_FEEDBACK_MS } from "./src/renderer/src/features/chat/canonical/message-actions";
			export { parseReplies } from "./src/renderer/src/features/chat/utils/reply-utils";
			export { EMPTY_TRANSCRIPT, applyHistoryPage } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
			export { useSpeechStore } from "@shared/store/speech-store";
			export { usePanelPresentationStore } from "@shared/store/panel-presentation-store";
			export { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: [
		"react",
		"react/jsx-runtime",
		"react-dom",
		"react-dom/server",
		"@tanstack/react-query",
	],
	plugins: [
		{
			/*
			 * The probe, answered statically. `speech` selects which half of it
			 * the mount sees, so one bundle covers "configured" and "not
			 * configured" without a second build.
			 * THE SHAPE IS THE SHIPPED ONE (issue #674): the consumers read the
			 * shared capability and the disabled tooltip's class, not the file
			 * question the probe used to answer alone. A fixture that answers the
			 * old shape leaves `canUseRadientSpeech` undefined, so the row renders
			 * its control disabled whatever `speechConfigured` says — the assertion
			 * below then fails for a contract the fixture never spoke, which is how
			 * this file was found (its run also ended in the memory guard's kill).
			 */
			name: "credential-probe-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-credentials/ },
					() => ({ path: "probe", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						export const useRadientCredentialProbe = () => ({
							canUseRadientSpeech: globalThis.__speechConfigured === true,
							/*
							 * An ANSWERED "no key" is the sign-in class's own arm; a
							 * configured probe never renders a block at all.
							 */
							speechBlock: globalThis.__speechConfigured === true
								? "could-not-check"
								: "sign-in",
						});
					`,
				}));
			},
		},
	],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
	jsx: "automatic",
});
/*
 * Written to a real file rather than imported as a data: URL: the bundle imports
 * React by bare specifier (external, so one copy is shared with this process's
 * renderer), and a data: URL has no base path for module resolution. Removed as
 * soon as it is imported - the recipe `aida-rail-marks.test.mjs` states.
 */
const bundlePath = new URL("./_message-actions.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------------------------------------ the rules */

test("copy is always offered, and it is first", () => {
	assert.deepEqual(mod.answerActionsFor(), ["copy", "speak"]);
	assert.deepEqual(mod.answerActionsFor({ role: "answer" }), ["copy", "speak"]);
	assert.deepEqual(
		mod.answerActionsFor({ role: "user" }),
		["copy"],
		"the reader's own turn offers Copy alone",
	);
});

test("fork is offered LAST, and only for a row with a cut point", () => {
	assert.deepEqual(
		mod.answerActionsFor({}),
		["copy", "speak"],
		"nothing is appended for a row with no cut point",
	);
	assert.deepEqual(
		mod.answerActionsFor({ forkable: true }),
		["copy", "speak", "fork"],
		"fork joins the row last when the record is a cut point",
	);
	assert.deepEqual(
		mod.answerActionsFor({ role: "user" }),
		["copy"],
		"the user arm is Copy alone until the row is a cut point - never Speak",
	);
	assert.deepEqual(
		mod.answerActionsFor({ role: "user", forkable: true }),
		["copy", "fork"],
		"the user arm takes fork too, and still never takes speak",
	);
});

test("the row is capped at two actions, and Quote is not one of them", () => {
	for (const role of ["answer", undefined]) {
		assert.ok(
			mod.answerActionsFor({ role }).length <= 2,
			"the model caps the row at two",
		);
	}
});

test("which records carry a fork cut point, and which do not", () => {
	const user = { kind: "user", id: "4a1b", ts: 1, text: "hi", images: [] };
	const answer = {
		kind: "assistant",
		id: "9c2d",
		ts: 1,
		text: "there",
		streaming: false,
	};
	assert.equal(mod.forkEntryId(user), "4a1b", "a user row's id is the entry");
	assert.equal(mod.forkEntryId(answer), "9c2d", "and so is a settled answer's");
	/*
	 * THE THREE REFUSALS, each for its own reason: a tool row's id is
	 * `tool:<call id>` (the core answers `has_entry` no for it), a streaming
	 * answer's id is the LIVE row's - the commit is what puts it in the journal -
	 * and the machine-voice kinds are not conversation rows at all.
	 */
	assert.equal(
		mod.forkEntryId({ kind: "tool", id: "tool:abc", ts: 1 }),
		null,
		"a tool row is not a cut point, whatever its id looks like",
	);
	for (const kind of ["notice", "peer", "wake", "custom", "compaction"]) {
		assert.equal(
			mod.forkEntryId({ kind, id: "e1", ts: 1 }),
			null,
			`a ${kind} row is not a cut point`,
		);
	}
	assert.equal(
		mod.forkEntryId({ ...answer, streaming: true }),
		null,
		"a row still receiving deltas names no committed entry",
	);
});

test("the row shows exactly the actions the model publishes, and Quote is not one of them", async () => {
	/*
	 * Read off the RENDER, because the model's own answer cannot fail this: the
	 * list is typed, so asserting "no quote" against it asserts the compiler.
	 * What the model decides is which buttons are on the DOM, and that is the
	 * fact a third action would show up in and nowhere else.
	 *
	 * TWO SHAPES, because the fork arm is conditional: a row mounted with no cut
	 * point (the child reader, a story, every test above) offers the two controls
	 * it always did, and one mounted with both halves offers Fork last.
	 *
	 * WHICH IS WHERE THE OLD CAP NOW LIVES. This case replaces one named "the row
	 * is capped at two actions, and Quote is not one of them", and it keeps that
	 * case's grounds rather than dropping them with its name: the cap was a
	 * statement about the line's width and about the slot #694 was reserving. The
	 * arm without a cut point still pins exactly two, so that half of the old
	 * case is unchanged; the cut-point arm is three, and the reason three is the
	 * number the repository states - #694's overflow home having shipped as the
	 * sidebar row context menu, and the only numbered cap being that menu's "two
	 * at most, pushing it three" - is written out on `message-actions.ts`'s
	 * `FORK` comment, which is what a reader of the ruling should open.
	 */
	const plain = await mount();
	assert.deepEqual(
		[
			...plain.dom.window.document.querySelectorAll(
				"[data-lo-answer-actions] button",
			),
		].map((node) => node.getAttribute("aria-label")),
		["Copy", "Speak aloud"],
		"exactly two controls on a row with no cut point, with no Quote among them",
	);
	assert.equal(
		plain.dom.window.document.querySelector(
			'[data-lo-answer-actions] button[aria-label="Fork from this message"]',
		),
		null,
		"and no Fork, withdrawn rather than disabled",
	);
	await plain.unmount();

	const row = await mount({
		conversationId: "c1",
		entryId: "entry-a1",
	});
	assert.deepEqual(
		[
			...row.dom.window.document.querySelectorAll(
				"[data-lo-answer-actions] button",
			),
		].map((node) => node.getAttribute("aria-label")),
		["Copy", "Speak aloud", "Fork from this message"],
		"Fork joins the row LAST when the record is a cut point",
	);
	await row.unmount();
});

/* ------------------------------------------------- what Copy writes */

const REPLY_BLOCK = [
	"<reply-to>Is the March import finished?</reply-to>",
	"",
	"Four were late, and the oldest is 41 days behind.",
	"",
	"| invoice | days |",
	"|---|---|",
	"| INV-0041 | 41 |",
	"",
	"```sql",
	"select * from invoices where paid_at is null;",
	"```",
].join("\n");

test("the copied text is the VISIBLE answer, not the wire text", () => {
	const { remainingContent, replies } = mod.parseReplies(REPLY_BLOCK);
	assert.equal(replies.length, 1, "the fixture carries one reply block");
	assert.ok(
		!remainingContent.includes("<reply-to>"),
		"the transport markup is not something the reader can see, so it is not something Copy hands over",
	);
	assert.ok(
		remainingContent.includes("| INV-0041 | 41 |"),
		"markdown source is copied verbatim: the table survives",
	);
	assert.ok(
		remainingContent.includes("select * from invoices where paid_at is null;"),
		"the fence's body survives, and so do its fences",
	);
	assert.notEqual(
		remainingContent,
		REPLY_BLOCK,
		"the visible text is NOT the raw record text - this is the assertion the payload is pinned by",
	);
});

test("an answer with no reply block copies its own text, trimmed", () => {
	const { remainingContent } = mod.parseReplies("\n\nthe answer\n\n");
	assert.equal(remainingContent, "the answer");
});

/* --------------------------------------------- the press, mounted */

/**
 * A JSDOM mount of the real row, with the clipboard and the clipboard only
 * faked.
 *
 * `writeText` is the seam the app itself uses (`copyTarget`), so faking it
 * exercises the shipped call site, the shipped label switch and the shipped
 * timer - which is the whole of what a press does.
 */
const mount = async ({
	speechConfigured = false,
	refuseWrite = false,
	conversationId,
	entryId,
} = {}) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	/*
	 * `navigator` is a getter-only property on this runtime's global object, so it
	 * is REPLACED rather than assigned - the row's copy path reads the global, and
	 * a failed assignment here would leave the test exercising Node's own
	 * `navigator` (which has no clipboard) while claiming to exercise the app's.
	 */
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: dom.window.navigator,
	});
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Node = dom.window.Node;
	/*
	 * The EVENT CLASSES, for the same realm reason as `navigator` above: this
	 * runtime's own `Event` is a different class from JSDOM's, so a component
	 * that constructs one (Radix's tooltip does, on focus) hands jsdom's
	 * `dispatchEvent` a value it refuses - `parameter 1 is not of type 'Event'`
	 * - and React unmounts the tree. Wiring the constructors alongside the rest
	 * of the realm is what makes a real `focus()` observable here.
	 */
	for (const name of [
		"Event",
		"CustomEvent",
		"MouseEvent",
		"KeyboardEvent",
		"FocusEvent",
		"PointerEvent",
	]) {
		if (dom.window[name]) globalThis[name] = dom.window[name];
	}
	globalThis.__speechConfigured = speechConfigured;

	const written = [];
	Object.defineProperty(dom.window.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text) => {
				if (refuseWrite) throw new Error("clipboard refused");
				written.push(text);
			},
		},
	});

	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(mod.AnswerActionRow, {
				bodyText: "Four were late, and the oldest is 41 days behind.",
				agentId: "c1",
				speechId: "a1",
				conversationId,
				entryId,
			}),
		);
	});
	const button = (label) =>
		dom.window.document.querySelector(
			`[data-lo-answer-actions] button[aria-label="${label}"]`,
		);
	/*
	 * Teardown handed back WITH the mount rather than kept as a file-scope
	 * helper: `root.unmount()` is what runs the component's effect cleanups (a
	 * helper that only dropped the body's HTML would leave the tree mounted and
	 * prove nothing about the unmount path), and a bound handle cannot be read
	 * before it exists.
	 */
	const unmount = async () => {
		await act(async () => {
			root.unmount();
		});
		dom.window.document.body.innerHTML = "";
	};
	return { dom, written, button, root, unmount };
};

test("the row is a toolbar with the actions as its leftmost content", async () => {
	const { dom, button, unmount } = await mount();
	const toolbar = dom.window.document.querySelector("[data-lo-answer-actions]");
	assert.ok(toolbar, "the toolbar is in the DOM");
	assert.equal(toolbar.getAttribute("role"), "toolbar");
	assert.equal(toolbar.getAttribute("aria-label"), mod.ANSWER_ACTIONS_LABEL);
	assert.ok(
		button("Copy"),
		"Copy is offered at rest, with no pointer in the frame",
	);
	assert.ok(
		dom.window.document.querySelector(
			'[data-lo-answer-actions] [aria-hidden="true"]',
		),
		"the icons are hidden from the accessibility tree; the accessible name is the label",
	);
	await unmount();
});

test("a press copies the answer and says so, then stops saying so", async () => {
	const { dom, written, button, unmount } = await mount();
	await act(async () => {
		button("Copy").dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.deepEqual(
		written,
		["Four were late, and the oldest is 41 days behind."],
		"one clipboard call, carrying the answer the reader can see",
	);
	assert.ok(button("Copied"), "the label is the press's own answer");
	/*
	 * The reset is this row's own requirement: the older toolbars clear `copied`
	 * when their subject changes, and this button's subject never does. Waiting
	 * the real interval is the only way to prove the timer is armed at the
	 * shipped constant rather than at some other number.
	 */
	await act(async () => {
		await new Promise((resolve) =>
			setTimeout(resolve, mod.COPY_FEEDBACK_MS + 250),
		);
	});
	assert.ok(button("Copy"), "the label has returned to Copy");
	assert.equal(button("Copied"), null);
	await unmount();
});

test("a refused write does not claim success", async () => {
	const { dom, written, button, unmount } = await mount({ refuseWrite: true });
	await act(async () => {
		button("Copy").dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.deepEqual(written, [], "nothing reached the clipboard");
	assert.ok(button("Copy"), "the label is unchanged");
	assert.equal(button("Copied"), null, "a failed press must not claim success");
	await unmount();
});

/* ---------------------------------------------------- the fork press */

test("the fork press asks the pane for session.fork with THIS row's entry", async () => {
	const { dom, button, unmount } = await mount({
		conversationId: "c9",
		entryId: "entry-a1",
	});
	const store = mod.usePanelPresentationStore;
	/* A request left by an earlier test in this file would be the same trap. */
	store.setState({ request: null });
	const fork = button("Fork from this message");
	await act(async () => {
		fork.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	const request = store.getState().request;
	assert.ok(request, "the press wrote a request");
	assert.equal(request.destination, "session.fork");
	assert.equal(
		request.sessionId,
		"c9",
		"the request names the row's conversation, so the pane cannot substitute its own",
	);
	assert.equal(
		request.entryId,
		"entry-a1",
		"and the row's own transcript entry - which is what makes the picker a cut",
	);
	/*
	 * THE LABEL THE PICKER REPEATS BACK (UX round 1, U1): the row is
	 * hover-revealed and the panel covers it, so the excerpt is the only thing
	 * that can tell the reader which message the cut is at.
	 */
	assert.equal(
		request.entryExcerpt,
		"Four were late, and the oldest is 41 days behind.",
		"and how to name that entry back to the reader",
	);
	/*
	 * THE INVOKER IS THE BUTTON, and this is the assertion that discriminates
	 * (UX round 1, U2): the pane restores focus with `origin.focus()`, which a
	 * `role="toolbar"` div without a tabindex silently ignores. Asserting the
	 * tag alone would not settle it - the real claim is that focusing what the
	 * row hands over MOVES focus, so it is exercised.
	 */
	assert.equal(
		request.invoker?.tagName,
		"BUTTON",
		"the pressed control travels as the invoker, not the row's toolbar box",
	);
	assert.equal(
		request.invoker?.getAttribute("aria-label"),
		"Fork from this message",
		"and it is THIS control, so Escape returns to what was pressed",
	);
	request.invoker.focus();
	assert.equal(
		dom.window.document.activeElement,
		request.invoker,
		"the invoker is genuinely focusable - the pane's restore is not a no-op",
	);
	await unmount();
	store.setState({ request: null });
});

test("the excerpt the picker repeats is the row's own words, clamped", () => {
	assert.equal(mod.forkExcerpt("  a\n b   c "), "a b c");
	const long = mod.forkExcerpt("word ".repeat(60));
	assert.ok(
		long.length <= mod.FORK_EXCERPT_MAX_CHARS,
		"a long message is clamped to the declared budget, ellipsis included",
	);
	assert.ok(long.endsWith("\u2026"), "and says so with an ellipsis");
	assert.ok(
		!long.includes("  "),
		"the clamp never leaves the collapsed-whitespace guarantee behind",
	);
});

test("Speak is offered when there is an agent to speak with, and disabled when speech is not configured", async () => {
	const off = await mount({ speechConfigured: false });
	assert.ok(
		off.dom.window.document.querySelector(
			'[data-lo-answer-actions] button[aria-label="Speak aloud"]',
		),
		"the button is there",
	);
	assert.equal(
		off.dom.window.document.querySelector(
			'[data-lo-answer-actions] button[aria-label="Speak aloud"]',
		).disabled,
		true,
		"and it says so with its state rather than by hiding, so the reason in its tooltip can reach the reader",
	);
	await off.unmount();
});

/* ------------------------------------------------------- the wiring */

test("the row rides the turn-closing line and the user row's column, and nothing else mounts it", () => {
	assert.ok(
		RE_ROW_MOUNT.test(TRANSCRIPT_SOURCE),
		"the transcript hands the row the VISIBLE text, the same value its Quote gate reads",
	);
	assert.ok(
		RE_CLOSES_TURN_LINE.test(TRANSCRIPT_SOURCE),
		"the line's condition is closesTurn: the actions are a fact about the answer, while the numbers and the stamp are gated separately on !closingLineSuppressed",
	);
	assert.ok(
		TRANSCRIPT_SOURCE.includes(
			"!closingLineSuppressed && foot && foot.actions > 0",
		),
		"the caption keeps its own gate, so a bar'd turn still gets the actions and not the numbers",
	);
	assert.equal(
		(TRANSCRIPT_SOURCE.match(RE_ROW_MOUNT_SITES) ?? []).length,
		2,
		"two mount sites: the closing answer's own line, and the user row's copy arm",
	);
	/*
	 * And each site names itself: the answer arm hands over the visible text the
	 * Quote gate reads, the user arm wears the role that strips Speak from the
	 * model (`answerActionsFor`), so neither can be swapped for the other
	 * without this file going red.
	 */
	assert.ok(
		RE_USER_ROW_MOUNT.test(TRANSCRIPT_SOURCE),
		"the user arm is mounted with its role",
	);
});

test("one clipboard call site: the row uses copyTarget and adds no second implementation", () => {
	assert.ok(
		ROW_SOURCE.includes("copyTarget("),
		"the canonical path's copy is used",
	);
	assert.ok(
		!ROW_SOURCE.includes("navigator.clipboard"),
		"a second writeText is the defect the canonical path exists to prevent",
	);
	assert.ok(
		!ROW_SOURCE.includes("ClipboardItem"),
		"and no rich-clipboard variant either: the row copies plain text, like /copy",
	);
});

/* ---------------------------------------------------------- the mount gate */

/**
 * The transcript's OWN gate, rendered rather than read.
 *
 * Round 1's finding: forcing `isQuotable` to `true` in `quote-model.ts` left
 * this file 10/10, because every case here mounted the ROW directly - a rig
 * cannot see a gate that lives in the parent. What the reviewer mutated is
 * therefore asserted where it actually lives: the real `CanonicalTranscript`,
 * with answers whose quotability differs for each of the gate's three reasons.
 */
const GATE_TS = 1_760_000_000_000;

const gateUser = (id, text) => ({
	kind: "user",
	id,
	ts: GATE_TS,
	text,
	images: [],
});

const gateAnswer = (id, text, extra = {}) => ({
	kind: "assistant",
	id,
	ts: GATE_TS + 1_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
	...extra,
});

const transcriptMarkup = (records, conversationId = "story-conversation") =>
	renderToStaticMarkup(
		h(
			QueryClientProvider,
			{
				client: new QueryClient({
					defaultOptions: { queries: { retry: false } },
				}),
			},
			h(mod.CanonicalTranscript, {
				transcript: {
					...mod.EMPTY_TRANSCRIPT,
					records,
					index: new Map(records.map((row, at) => [row.id, at])),
				},
				frontend: null,
				gate: null,
				waiting: false,
				starting: false,
				loadingOlder: false,
				onLoadOlder: async () => true,
				containerRef: { current: null },
				isSmallView: false,
				status: "live",
				failure: null,
				awaitingHydration: false,
				onReconnect: () => {},
				/* `null` is the run-details child reader's own mount: no conversation. */
				conversationId: conversationId ?? undefined,
			}),
		),
	);

/**
 * The aria-labels of one row's buttons, read out of static markup.
 *
 * Static markup is enough for this and is the cheap half of the same claim
 * `scripts/speech-user-copy.test.mjs` makes with a live jsdom mount: the row's
 * controls and their order are decided by `answerActionsFor` at render, so the
 * labels are in the HTML - and this file runs on a host where that one cannot.
 */
const rowLabelsOf = (html, attr) => {
	const row = html.match(new RegExp(`<div[^>]*${attr}[^>]*>[\\s\\S]*?</div>`));
	if (!row) return null;
	return [...row[0].matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map(
		(m) => m[1],
	);
};

/** How many action rows the markup carries. */
const actionRowsIn = (html) =>
	(html.match(/data-lo-answer-actions/g) ?? []).length;

test("a settled answer carries the row, and the row is the transcript's own", () => {
	const html = transcriptMarkup([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "It finished with the same four invoices outstanding."),
	]);
	assert.equal(actionRowsIn(html), 1, "the settled answer carries one row");
});

/**
 * The operator's foot-line state, through the durable path: a turn that
 * COMPACTED mid-run. The memory statement is pinned, the hidden span
 * partitions into two segments around it, and no pre-answer segment carries
 * the turn's stamp - so the closing line keeps its foot, and the caption and
 * the action row paint TOGETHER. That is the composition the 2026-10-01
 * report is about, and the shape none of the other fixtures here paints.
 */
const compactedTurn = () => {
	const S = GATE_TS / 1000;
	const entry = (id, ts, payload) => ({ id, ts, type: "message", payload });
	return mod.applyHistoryPage(mod.EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: "Is the March import finished?" }],
			}),
			entry("t1", S + 2, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			{
				id: "n1",
				ts: S + 5,
				type: "compaction",
				payload: { tokens_before: 41_000 },
			},
			entry("t2", S + 8, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("a1", S + 70, {
				kind: "message",
				role: "assistant",
				content: [
					{ text: "It finished with the same four invoices outstanding." },
				],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

test("the closing line keeps the caption at its left and the actions at its right, stamp last", () => {
	/*
	 * THE OPERATOR'S ASK, as a document-order claim (2026-10-01): "rearrange so
	 * those are on the leftmost extent and the action buttons are to the
	 * right". The caption used to follow the buttons, so at rest - the buttons
	 * are opacity-only-hidden but hold their box - it read indented by the
	 * buttons' own width. The line must now paint caption first, the actions'
	 * `ml-auto` wrapper after it, and the stamp last; only a markup assertion
	 * can pin the ORDER, which is what the report was about (the geometry
	 * script reads the boxes; the frames show them).
	 */
	const html = transcriptMarkup(compactedTurn().records);
	const captionAt = html.indexOf("Worked for");
	const spacerAt = html.indexOf('class="ml-auto flex shrink-0"');
	const actionsAt = html.indexOf("data-lo-answer-actions");
	const stampAt = html.lastIndexOf("<time");
	assert.ok(
		captionAt >= 0,
		"this turn keeps its foot - the caption is on the closing line at all",
	);
	assert.ok(
		captionAt < spacerAt && spacerAt < actionsAt,
		"the caption leads the line and the actions' wrapper is the right cluster's first box (its ml-auto is what pushes the cluster)",
	);
	assert.ok(
		stampAt > actionsAt,
		"and the stamp closes the line, rightmost, exactly as it did before the rearrangement",
	);
});

/*
 * THE COMPOSITION, at the level that caught nothing before: which controls the
 * real transcript puts on each row. This is the assertion `scripts/speech-user-
 * copy.test.mjs` makes with a live jsdom mount (agent review round 1, B1 - it
 * went stale because only its file, and not this one, carried the two-row
 * shape), restated here in static markup so the claim is covered by a file that
 * runs on a loaded host as well.
 *
 * BOTH ARMS OF `forkable` at the mount site, because the gate is the mount's
 * answer (the record's own id) and not the row's: with a conversation and two
 * journalled records each row gains Fork last, and with no conversation the
 * transcript hands the row nothing to cut at and Fork is withdrawn.
 */
test("each row offers the controls its record can carry, Fork last", () => {
	const html = transcriptMarkup([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "It finished with the same four invoices outstanding."),
	]);
	assert.deepEqual(
		rowLabelsOf(html, "data-lo-user-actions"),
		["Copy", "Fork from this message"],
		"the reader's own message: Copy first, Fork last, and never Speak",
	);
	assert.deepEqual(
		rowLabelsOf(html, "data-lo-answer-actions"),
		["Copy", "Speak aloud", "Fork from this message"],
		"the answer: Copy, Speak, then the appended Fork",
	);
	/*
	 * And with no conversation there is no cut point to name, so the action is
	 * withdrawn rather than disabled - the same row, one control fewer.
	 */
	const bare = transcriptMarkup(
		[
			gateUser("u1", "Is the March import finished?"),
			gateAnswer("a1", "It finished with the same four invoices outstanding."),
		],
		null,
	);
	assert.deepEqual(
		rowLabelsOf(bare, "data-lo-user-actions"),
		["Copy"],
		"a transcript with no conversation offers no Fork",
	);
});

/*
 * The gate's two arms, and which one discriminates WHAT.
 *
 * The streaming arm pins the COMPOSITE the shipped tree states twice: a
 * streaming answer is not a closing answer at all (`closingAnswerIds` says an
 * unfinished answer closes a turn "without being an answer"), and it is not
 * quotable either - so it stays green if only one of the two rules moves, and
 * it fails if the row is mounted per-answer rather than per-turn.
 *
 * The EMPTY-BODY arm below is the one that discriminates the quotability gate
 * on its own: with `isQuotable` forced to `true` - round 1's mutation - that
 * fixture grows a row and this file goes red. Nothing else here does.
 */
test("an answer still receiving deltas carries none", () => {
	/*
	 * The mutation this pins: `isQuotable` returning `true` unconditionally
	 * paints a row here, and the count goes to two - a control whose press
	 * would stage a half-sentence the reader never saw finished.
	 */
	const html = transcriptMarkup([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "It finished with the same four invoices outstanding."),
		gateUser("u2", "And the April file?"),
		gateAnswer("a2", "The April loader read the header and the first", {
			streaming: true,
			complete: false,
			ts: GATE_TS + 5_000,
		}),
	]);
	assert.equal(
		actionRowsIn(html),
		1,
		"only the settled answer carries a row, not the one being written",
	);
});

/*
 * The chain, stated once: `isQuotable` is asked with the SAME
 * `remainingContent` the prose renders, so a body that is only reply markup
 * has nothing to offer and mounts no control - the failure `quote-model`
 * documents at length (a press that can only be raised by a highlight the
 * row has no words for is a silent no-op).
 */
test("an answer whose whole body is reply markup carries none", () => {
	const html = transcriptMarkup([
		gateUser("u1", "Is the March import finished?"),
		gateAnswer("a1", "<reply-to>Is the March import finished?</reply-to>"),
	]);
	assert.equal(
		actionRowsIn(html),
		0,
		"a body with no words in it has nothing to copy, so the row is absent",
	);
});

/* ------------------------------------------------------- the copy's timer */

test("unmounting the row clears the feedback timer the press armed", async () => {
	/*
	 * A timer that outlives its row would flip a button React has already let
	 * go of. The wrap below is the observation: the press arms exactly one
	 * timer and the unmount path clears THAT id - `root.unmount()` rather than
	 * an emptied body, because only the former runs the effect cleanup.
	 */
	const armed = [];
	const cleared = [];
	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;
	globalThis.setTimeout = (fn, ms, ...rest) => {
		const id = realSetTimeout(fn, ms, ...rest);
		armed.push(id);
		return id;
	};
	globalThis.clearTimeout = (id, ...rest) => {
		cleared.push(id);
		return realClearTimeout(id, ...rest);
	};
	try {
		const { dom, button, unmount } = await mount();
		await act(async () => {
			button("Copy").dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
		assert.equal(armed.length, 1, "the press armed one feedback timer");
		await unmount();
		assert.ok(
			cleared.includes(armed[0]),
			"the unmount cleared the timer the press armed",
		);
	} finally {
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
	}
});

/* ------------------------------------------------------------ the speech arm */

test("a configured service arms Speak, and the press carries the conversation's BINDING", async () => {
	/*
	 * The store's own `playSpeech` is replaced BEFORE the mount, not after:
	 * the row captures the function it renders with, so a wrapper installed
	 * once the tree is up is never the one the press reaches.
	 */
	const calls = [];
	const playSpeech = mod.useSpeechStore.getState().playSpeech;
	mod.useSpeechStore.setState({
		playSpeech: async (...args) => {
			calls.push(args);
			return playSpeech(...args);
		},
	});
	try {
		/*
		 * ARM 1, AND THE ONE THE OPERATOR MET: the conversation is mounted with the
		 * pane identity (`c1`) and the catalogue row carries NO agent binding - the
		 * ordinary shape of a conversation the reader opened himself. The press must
		 * still reach the store (the control is not disabled for want of a binding),
		 * and its target must be `null` - no binding, which is the agent-less route -
		 * NOT `c1`, which is a session id the daemon's registry cannot hold.
		 *
		 * The binding is written AFTER the mount, not before: the sessions store
		 * persists through `localStorage`, which the jsdom window this rig builds
		 * supplies (a `setState` ahead of it throws on the store's own write path).
		 */
		const { dom, button, unmount } = await mount({ speechConfigured: true });
		await act(async () => {
			mod.useCanonicalSessionsStore.setState({
				sessions: [{ session_id: "c1", binding: { agent: null, team: null } }],
			});
		});
		const speak = button("Speak aloud");
		assert.ok(speak, "Speak is present on an answer row");
		assert.equal(
			speak.disabled,
			false,
			"and it is ENABLED once the credential probe reports a key - the arm no frame in this set photographs",
		);
		/*
		 * The press is observed at the store's own entry point rather than at
		 * `loadingKey`: `playSpeech` sets that field and then clears it when
		 * the fetch it starts fails, and this rig has no Speech service - so reading
		 * it after the `act` window would read the cleared value rather than the
		 * call. What is asserted is the call itself: this answer's id, the resolved
		 * target, and the text the reader can see.
		 */
		await act(async () => {
			speak.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
		assert.deepEqual(
			calls,
			[["a1", null, "Four were late, and the oldest is 41 days behind."]],
			"a conversation with no binding presses through the agent-less route, keyed by THIS answer",
		);
		await unmount();

		/*
		 * ARM 2: the same row, with the catalogue naming a role agent. The press
		 * carries THAT BINDING - the daemon's attachment key, which is a display NAME
		 * - and the store's own `fetchSpeechFor` resolves it to the registry id the
		 * speech route takes (`speech-target.test.mjs` drives that resolution end to
		 * end, against a catalogue stub with the daemon's own query semantics).
		 */
		calls.length = 0;
		const second = await mount({ speechConfigured: true });
		/*
		 * INSIDE `act`, so the row RE-RENDERS with the binding before the press: the
		 * press closure reads the target the row last rendered with, and a store
		 * written outside a flush would be pressed against the previous value.
		 */
		await act(async () => {
			mod.useCanonicalSessionsStore.setState({
				sessions: [
					{ session_id: "c1", binding: { agent: "agent-9", team: null } },
				],
			});
		});
		assert.equal(
			mod.useCanonicalSessionsStore.getState().sessions[0]?.binding?.agent,
			"agent-9",
			"the catalogue holds the binding the press is about to resolve",
		);
		const armed = second.button("Speak aloud");
		assert.ok(armed, "Speak is present on the bound conversation's row too");
		await act(async () => {
			armed.dispatchEvent(
				new second.dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
		assert.deepEqual(
			calls,
			[["a1", "agent-9", "Four were late, and the oldest is 41 days behind."]],
			"a bound conversation presses its role agent, not the pane identity",
		);
		await second.unmount();
	} finally {
		mod.useSpeechStore.setState({ playSpeech });
	}
});

test("the control survives the swap to Stop, so focus stays in the row", async () => {
	/*
	 * Round 1's M3: the playing branch used to render a different element
	 * shape from the resting one, so the swap replaced the DOM node and a
	 * reader who had tabbed to Speak lost focus to the body at the moment the
	 * button became the stop control. Same node, same focus, new label.
	 */
	const { dom, button, unmount } = await mount({ speechConfigured: true });
	const labels = () =>
		[...dom.window.document.querySelectorAll("[data-lo-answer-actions] button")]
			.map((node) => node.getAttribute("aria-label"))
			.join(", ");
	const speak = button("Speak aloud");
	assert.ok(speak, "the resting control is there to focus");
	speak.focus();
	assert.equal(
		dom.window.document.activeElement,
		speak,
		"the control holds focus before the turn starts playing",
	);
	await act(async () => {
		mod.useSpeechStore.setState({ playingKey: "msg:a1" });
	});
	const stop = button("Stop");
	assert.ok(stop, `the control is now the stop control (labels: ${labels()})`);
	assert.equal(
		stop,
		speak,
		"and it is the SAME node rather than a replacement",
	);
	assert.equal(
		dom.window.document.activeElement,
		stop,
		"so focus never leaves the row",
	);
	await unmount();
	mod.useSpeechStore.setState({
		playingKey: null,
		loadingKey: null,
	});
});
