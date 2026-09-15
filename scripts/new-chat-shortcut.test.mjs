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
				pressBelongsToCanvas,
			} from "./src/renderer/src/features/chat/components/canvas/canvas-shortcut-scope";
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
	target: TARGET_PAGE,
	...overrides,
});

/** The chords the rule must answer, in this app's own spelling. */
const FIRES = [
	["⌘N on macOS", press()],
	["Ctrl+N on Windows and Linux", press({ metaKey: false, ctrlKey: true })],
	["⌘N from a real element", press({ target: TARGET_PAGE })],
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
	["a bare n", press({ metaKey: false })],
	["n typed into the composer", press({ key: "n", metaKey: false })],
	["⌘O", press({ key: "o" })],
	["⌘K", press({ key: "k" })],
	[
		"a HELD ⌘N, whose repeats would stage a draft each",
		press({ repeat: true }),
	],
	[
		"a press an inner layer already claimed",
		press({ defaultPrevented: true }),
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
	assert.equal(pressBelongsToCanvas(targetInside(CANVAS_SHORTCUT_SCOPE_ATTR)), true);
	for (const target of [TARGET_PAGE, { closest: () => null }, null, {}])
		assert.equal(
			pressBelongsToCanvas(target),
			false,
			"a target with no canvas ancestor belongs to the page, not to the pane",
		);
});

test("the cap is the platform's own spelling, in two caps the component can split", () => {
	assert.equal(newChatShortcutCap("MacIntel"), "⌘+N");
	assert.equal(newChatShortcutCap("Win32"), "Ctrl+N");
	assert.equal(newChatShortcutCap("Linux armv8l"), "Ctrl+N");
	for (const platform of ["MacIntel", "Win32", "Linux armv8l"]) {
		const cap = newChatShortcutCap(platform);
		assert.equal(
			cap.split("+").length,
			2,
			`${cap} is not one modifier over one key; KeyboardShortcut renders one cap per "+"-separated term`,
		);
	}
});

/*
 * The call sites. Each pin is scoped to the expression that makes the claim, so
 * a neighbouring line cannot satisfy it: the app shell's registration, the row's
 * cap, and the canvas's guard against the chord it shares with the app.
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
});

test("the New chat row prints the cap from the same module the binding reads", () => {
	const labelAt = sidebar.indexOf(">New chat</span>");
	assert.ok(labelAt > 0, "the row's label is what anchors this pin");
	const buttonAt = sidebar.lastIndexOf("<button", labelAt);
	const button = sidebar.slice(buttonAt, sidebar.indexOf("</button>", labelAt));
	assert.ok(
		button.includes("<KeyboardShortcut") &&
			button.includes("newChatShortcutCap(navigator.platform)"),
		`the row must render the cap the chord is, from the one module that spells it:\n${button}`,
	);
	assert.ok(
		button.includes('className="flex-1 text-left"'),
		"the label's flex-1 is what holds the cap in the trailing column, where the All chats row holds its count",
	);
});

test("the canvas scopes its own ⌘N to presses that came from the pane", () => {
	const nBranchAt = canvas.indexOf('event.key === "n"');
	assert.ok(nBranchAt > 0, "the canvas's new-file chord is what this pins");
	const branch = canvas.slice(nBranchAt, canvas.indexOf("setCreateFileDialogOpen(true)", nBranchAt));
	assert.ok(
		branch.includes("pressBelongsToCanvas(event.target)"),
		`the canvas's ⌘N must be scoped, or one press from the sidebar raises its dialog AND stages a chat:\n${branch}`,
	);
	assert.ok(
		canvas.includes("data-canvas-shortcuts"),
		"the pane must carry the marker the scope is read from",
	);
	/*
	 * `⌘O` is deliberately NOT scoped — nothing else claims it — and this states
	 * it so a later reader does not "fix" the asymmetry: what is asserted is that
	 * the scope test appears in the `⌘N` branch and not in the `⌘O` one.
	 */
	const oBranchAt = canvas.indexOf('event.key === "o"');
	const oBranch = canvas.slice(oBranchAt, canvas.indexOf("handleOpenFile()", oBranchAt));
	assert.ok(
		!oBranch.includes("pressBelongsToCanvas"),
		`the ⌘O branch takes no scope test: nothing else claims that chord, so guarding it would only take a working shortcut away:\n${oBranch}`,
	);
});
