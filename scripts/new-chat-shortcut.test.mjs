/**
 * The New chat chord: `⌘N` on macOS, `Ctrl+N` on Windows/Linux.
 *
 *     node --test scripts/new-chat-shortcut.test.mjs
 *
 * The shortcut, its cap beside the sidebar's New chat row, and the one press the
 * canvas pane already owns are three halves of one promise, and each is a
 * decision that cannot be made from the markup alone. So the file asserts both
 * layers:
 *
 *   1. the RULE, over the SHIPPED predicate, bundled from source with esbuild
 *      exactly as `draft-selection.test.mjs` bundles the draft store. The
 *      predicates take a plain `KeyboardEvent` shape, so the cases below are the
 *      same objects the handler passes — a literal with a fake `target`, never a
 *      re-statement of the rule in the test's own words;
 *   2. the CALL SITES, as source text, in the idiom `new-chat-row.test.mjs`
 *      uses for the row it guards. `app.tsx`, `chat-sidebar.tsx` and
 *      `canvas/index.tsx` cannot be rendered in isolation — they read the
 *      router, the session store and the desktop capability hooks — so what is
 *      pinned is that they still ask the rule rather than re-deriving it.
 *
 * The second layer is the load-bearing one for the canvas. Its `⌘N` binding sits
 * on the WINDOW and is unguarded in the file before this change, so a press from
 * the sidebar used to raise its create-file dialog; the guard that scopes it is
 * one line, and a one-line guard is also a one-line deletion. What this file
 * does NOT prove is that a browser dispatches a keyboard event the way the shape
 * says, or that the caps are legible where they now sit: the first is the DOM's
 * contract, and the second is in `docs/evidence/new-chat-shortcut/README.md`,
 * measured from the running renderer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: `
			export {
				newChatShortcutCap,
				shouldStartNewChat,
			} from "./src/renderer/src/features/chat/new-chat-shortcut";
			export {
				CANVAS_SHORTCUT_SCOPE_ATTR,
				canvasShortcutAction,
				pressBelongsToCanvas,
			} from "./src/renderer/src/features/chat/keyboard-scopes";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

const bundlePath = new URL("./_new-chat-shortcut.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	CANVAS_SHORTCUT_SCOPE_ATTR,
	canvasShortcutAction,
	newChatShortcutCap,
	pressBelongsToCanvas,
	shouldStartNewChat,
} = await import(bundlePath.href);
await unlink(bundlePath);

/**
 * A stand-in for the event's `target`.
 *
 * It answers `closest` for the selectors it was built with and `null` for every
 * other, because that is the whole of what the shipped predicates ask an element
 * for — the attribute names below are the app's own, taken from
 * `CANVAS_SHORTCUT_SCOPE_ATTR` and the rule's role list rather than retyped, so
 * a renamed marker cannot leave these cases asserting a selector nothing uses.
 */
const targetInside = (...selectors) => ({
	closest: (selector) =>
		selectors.some((known) => selector.includes(known)) ? {} : null,
});

/** A press from a real element outside every surface the rule knows about. */
const TARGET_PAGE = { closest: () => null };

/**
 * One press, as the handler builds it.
 *
 * `⌘N` with no other modifier is the default, so each case below states only the
 * property it is about.
 */
const press = (overrides = {}) => ({
	key: "n",
	metaKey: true,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	repeat: false,
	defaultPrevented: false,
	isComposing: false,
	target: TARGET_PAGE,
	...overrides,
});

/**
 * The chords the rule must answer, in this app's own spelling.
 *
 * One case per PROPERTY, which is why the `<body>` press appears once rather
 * than twice: a neighbouring case that differs only in how the same fact was
 * spelled inflates the count without asserting anything the first did not.
 */
const FIRES = [
	["⌘N on macOS", press()],
	["Ctrl+N on Windows and Linux", press({ metaKey: false, ctrlKey: true })],
	[
		"⌘N from <body>, where focus lands when it is lost",
		press({ target: { closest: () => null } }),
	],
	// A synthetic or detached press can carry no target at all. It belongs to
	// nobody, which is the page's to answer rather than a surface's.
	["⌘N from a press with no target", press({ target: null })],
];

for (const [name, event] of FIRES)
	test(`${name} starts a new chat`, () => {
		assert.equal(shouldStartNewChat(event), true);
	});

/** Every way the same key means something else instead. */
const REFUSED = [
	["⌘⇧N", press({ shiftKey: true })],
	["⌥⌘N", press({ altKey: true })],
	[
		"a bare n, which belongs to whatever text field has focus",
		press({ metaKey: false }),
	],
	["⌘O", press({ key: "o" })],
	[
		"a HELD ⌘N, whose repeats would stage a draft each",
		press({ repeat: true }),
	],
	["a press an inner layer already claimed", press({ defaultPrevented: true })],
	[
		"⌘N pressed mid-IME-composition, whose field this would unmount",
		press({ isComposing: true }),
	],
	[
		"⌘N inside the canvas pane, which binds the same chord to new file",
		press({ target: targetInside(CANVAS_SHORTCUT_SCOPE_ATTR) }),
	],
	[
		"⌘N inside an open dialog",
		press({ target: targetInside('[role="dialog"]') }),
	],
	[
		"⌘N inside an open alert dialog",
		press({ target: targetInside('[role="alertdialog"]') }),
	],
	["⌘N inside an open menu", press({ target: targetInside('[role="menu"]') })],
	[
		"⌘N inside an open listbox",
		press({ target: targetInside('[role="listbox"]') }),
	],
];

for (const [name, event] of REFUSED)
	test(`${name} does not start a new chat`, () => {
		assert.equal(shouldStartNewChat(event), false);
	});

test("the canvas scope is the pane's own attribute, and a press from it is the canvas's", () => {
	assert.equal(CANVAS_SHORTCUT_SCOPE_ATTR, "data-canvas-shortcuts");
	assert.equal(
		pressBelongsToCanvas(targetInside(CANVAS_SHORTCUT_SCOPE_ATTR)),
		true,
	);
	for (const target of [TARGET_PAGE, { closest: () => null }, null, {}])
		assert.equal(
			pressBelongsToCanvas(target),
			false,
			"a target with no canvas ancestor belongs to the page, not to the pane",
		);
});

test("the cap is the platform's own spelling, in two caps the component can split", () => {
	assert.equal(newChatShortcutCap(true), "⌘+N");
	assert.equal(newChatShortcutCap(false), "Ctrl+N");
	for (const isMac of [true, false]) {
		const cap = newChatShortcutCap(isMac);
		assert.equal(
			cap.split("+").length,
			2,
			`${cap} is not one modifier over one key; KeyboardShortcut renders one cap per "+"-separated term`,
		);
	}
});

/*
 * The call sites. The DECISIONS are asserted behaviourally above and here; what
 * these pins add is that the components still ask the shipped rule rather than
 * re-deriving it, and that nothing has grown a second copy of a rule that is
 * shared for the express reason that two copies drift.
 */

const app = readFileSync(join(ROOT, "src/renderer/src/app.tsx"), "utf8");
const sidebar = readFileSync(
	join(ROOT, "src/renderer/src/features/chat/components/chat-sidebar.tsx"),
	"utf8",
);
const canvas = readFileSync(
	join(ROOT, "src/renderer/src/features/chat/components/canvas/index.tsx"),
	"utf8",
);

/*
 * Those pins as MODULE-level patterns rather than literals inside a test body,
 * which is what `useTopLevelRegex` asks for: a literal in a function is rebuilt
 * on every call, and nothing here needs that. None of the five carries `g` or
 * `y`, so none carries a `lastIndex` from one use to the next and hoisting
 * cannot change what any of them answers.
 */

/**
 * The shell's gate CALL rather than the identifier it is stored in.
 *
 * `listener.includes("catalogueReady")` alone would keep passing if the bit or
 * its version drifted, which is exactly the drift the row's own gate exists to
 * prevent, so the call itself is what this reads.
 */
const CATALOGUE_GATE_CALL =
	/desktopFeatureEnabled\(\s*capabilities\.data,\s*"session_catalogue",\s*2,?\s*\)/;

/** Dispatch on the shared decision, and the two outcomes it can reach. */
const CANVAS_DISPATCHES_THE_DECISION = /canvasShortcutAction\(event\)/;
const CANVAS_OPENS_FILE = /action === "open-file"/;
const CANVAS_STARTS_FILE = /action === "new-file"/;

/*
 * A selector ASKED FOR with a role list, which the canvas must not hold a copy
 * of.
 *
 * THE `[]` THIS PATTERN USED TO CARRY WAS AN EMPTY CHARACTER CLASS, which
 * matches nothing, so every `.closest(`/`.querySelector(` call carrying a quoted
 * `[role=` selector satisfied the `!` assertion below: a green check that was
 * vacuous rather than a check that passed. It now reads "an opening quote,
 * apostrophe or backtick, any characters that are not the closing one, then
 * `[role=`", which matches the violation it is for and still refuses the two
 * things this pin is deliberately NOT about - a selector naming an attribute
 * constant - and the prose `role="dialog"` elsewhere in that file, which a
 * whole-file text check would trip over.
 *
 * WHY IT BACK-REFERENCES THE OPENING QUOTE (review round 2, F7). "Any characters
 * that are not the closing one" is not the same as "the same literal": a
 * selector written as a template literal can hold the OTHER quote characters
 * before it reaches `[role=` - `closest(\`${q ? "x" : 'y'}[role=dialog]\`)` -
 * and the first spelling stopped at that `"`, so a violation written that way
 * passed. Matching to the character the literal OPENED with (a back-reference)
 * closes it, and the lazy `[\s\S]*?` before it stops at the first `[role=` rather
 * than running into the next argument. ITS OWN BOUND, stated rather than implied:
 * this is a source-text pin, not a parser, so a template literal with a NESTED
 * escaped template before the `[role=` is still not seen. It is a pin over one
 * file this change owns, and the canvas's own behaviour is asserted separately
 * below.
 */
const CANVAS_ASKS_FOR_A_ROLE_LIST =
	/\.(?:closest|querySelector)\(\s*([`'"])(?:(?!\1)[\s\S])*?\[role=[\s\S]*?\1/;

test("the shell binds the chord on the document and asks the rule", () => {
	assert.ok(
		app.includes('document.addEventListener("keydown", onKeyDown)'),
		"the shell must bind the press on the document, which is where a press lands whatever has focus",
	);
	const listener = app.slice(
		app.indexOf("const onKeyDown = (event: KeyboardEvent)"),
		app.indexOf('document.addEventListener("keydown", onKeyDown)'),
	);
	assert.ok(
		listener.includes("shouldStartNewChat(event)"),
		`the shell must ask the shipped rule rather than re-deriving it:\n${listener}`,
	);
	assert.ok(
		listener.includes("stageDraft(undefined, true)") &&
			listener.includes('navigate("/chat")'),
		"staging a fresh untargeted draft and landing on it is what the row's own click does; a shortcut that only did one of the two would be a different action",
	);
	assert.ok(
		listener.includes("isOnboardingActive"),
		"the first-run wizard owns the window until it is answered",
	);
	/*
	 * The row's OWN gate, not a second idea of when a chat may be started: the
	 * sidebar disables New chat on the catalogue capability, so a chord that
	 * outranked it would act in the state where the visible control refuses.
	 */
	assert.ok(
		listener.includes("catalogueReady"),
		`the shell must take the gate the row is disabled on:
${listener}`,
	);
	assert.ok(
		CATALOGUE_GATE_CALL.test(app),
		"`catalogueReady` has to be the same capability bit the sidebar reads, with the same version",
	);
});

test("the New chat row prints the cap from the same module the binding reads", () => {
	const labelAt = sidebar.indexOf(">New chat</span>");
	assert.ok(labelAt > 0, "the row's label is what anchors this pin");
	const buttonAt = sidebar.lastIndexOf("<button", labelAt);
	const button = sidebar.slice(buttonAt, sidebar.indexOf("</button>", labelAt));
	assert.ok(
		button.includes("<KeyboardShortcut") &&
			button.includes("newChatShortcutCap(isMac)"),
		`the row must render the cap the chord is, from the one module that spells it:\n${button}`,
	);
	assert.ok(
		button.includes('className="flex-1 text-left"'),
		"the label's flex-1 is what holds the cap in the trailing column, where the All chats row holds its count",
	);
});

test("the canvas answers its own chords through the shared decision, and keeps no second copy of either rule", () => {
	/*
	 * The pane's chords are a function (`canvasShortcutAction`) precisely so this
	 * file can drive them: neither committed harness can open a canvas, so a rule
	 * written inline in the component would have no behavioural evidence at all.
	 * What is pinned here is that the component still DISPATCHES on that function —
	 * a revision that calls it and then opens the dialog regardless is the mutation
	 * a presence check cannot see.
	 */
	assert.ok(
		CANVAS_DISPATCHES_THE_DECISION.test(canvas) &&
			CANVAS_OPENS_FILE.test(canvas) &&
			CANVAS_STARTS_FILE.test(canvas),
		"the canvas must branch on the shipped decision rather than re-deriving its chords",
	);
	assert.ok(
		canvas.includes("data-canvas-shortcuts"),
		"the pane must carry the marker the scope is read from",
	);
	/*
	 * ONE copy of the overlay roles, and it is the shared module's: the canvas's
	 * Escape branch used to hold its own list, which is a fifth role waiting to
	 * drift from the shared four. What is pinned is a selector being ASKED FOR —
	 * `closest`/`querySelector` with a role list — rather than the string
	 * `role="dialog"`, which this file also carries in prose about Escape and
	 * which a whole-file text check would trip over.
	 */
	assert.ok(
		!CANVAS_ASKS_FOR_A_ROLE_LIST.test(canvas),
		"the canvas must not ask for a role list of its own; ask `pressLandsOnOverlay`",
	);
	assert.ok(
		canvas.includes("pressLandsOnOverlay(event.target)"),
		"the Escape branch is what reads the shared overlay test",
	);
});

test("the canvas's own chords, driven through the shipped decision", () => {
	const inPane = {
		closest: (selector) =>
			selector.includes(CANVAS_SHORTCUT_SCOPE_ATTR) ? {} : null,
	};
	const onPage = { closest: () => null };
	const cases = [
		[
			"⌘N from inside the pane is the pane's new file",
			{ key: "n", metaKey: true, ctrlKey: false, target: inPane },
			"new-file",
		],
		[
			"⌘N from the sidebar is NOT the pane's — it is the app's new chat",
			{ key: "n", metaKey: true, ctrlKey: false, target: onPage },
			null,
		],
		[
			"⌘N from <body>, where focus lands when it is lost, is the app's",
			{
				key: "n",
				metaKey: true,
				ctrlKey: false,
				target: { closest: () => null },
			},
			null,
		],
		[
			"Ctrl+N from inside the pane is the pane's",
			{ key: "n", metaKey: false, ctrlKey: true, target: inPane },
			"new-file",
		],
		// No scope test, deliberately: nothing else claims `⌘O`, so guarding it
		// would only take a working shortcut away from a focus in the sidebar.
		[
			"⌘O is the pane's from anywhere",
			{ key: "o", metaKey: true, ctrlKey: false, target: onPage },
			"open-file",
		],
		[
			"⌘O from inside the pane is the pane's too",
			{ key: "o", metaKey: true, ctrlKey: false, target: inPane },
			"open-file",
		],
		[
			"a chord the pane never claimed is nobody's",
			{ key: "k", metaKey: true, ctrlKey: false, target: inPane },
			null,
		],
		[
			"an unmodified key is nobody's",
			{ key: "n", metaKey: false, ctrlKey: false, target: inPane },
			null,
		],
	];
	for (const [name, event, expected] of cases)
		assert.equal(canvasShortcutAction(event), expected, name);
});
