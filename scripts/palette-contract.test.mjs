import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * The palette's two chords, across the process boundary that splits them.
 *
 * `Cmd/Ctrl+P` is decided in MAIN (a `before-input-event` hook, which is where
 * it has always been) and arrives in the renderer as an IPC message; `Cmd/Ctrl+K`
 * is decided in the RENDERER, because a canvas editor can claim it and main
 * cannot ask. Each half keeps working when the other is broken — main swallows
 * the press and sends into an empty room, or the renderer listens for a message
 * nothing sends — so a change to one side can kill a chord silently.
 *
 * It happened: the port to the renderer's own listener dropped the IPC
 * subscription with the component it had lived in, `Cmd+P` stopped opening
 * anything, and every suite stayed green because nothing asserted the pair
 * (round 1, R-1). This file is that assertion, read off the sources rather than
 * rendered, because the question is whether both halves exist at all.
 *
 * SINCE ISSUES #659 AND #850 THERE ARE THREE DOORS AND THEY HAVE DISTINCT JOBS,
 * and this file pins what each door ASKS FOR as well as that it exists:
 * `Cmd/Ctrl+K` is the chats door (the quick switcher), `Cmd/Ctrl+P` the
 * everything door, and `Cmd/Ctrl+Shift+P` the commands door. The two
 * main-process chords send on DISTINCT channels — before #850 main did not look
 * at Shift, so both arrived as one message and a third door was indistinguishable
 * from the second. A door that still opened the same view as another is the
 * defect the split removes, and it would satisfy a subscription-only check
 * exactly as the pre-split code did.
 */

const read = (path) => readFileSync(path, "utf8");

/*
 * Comments are stripped before matching, and the RECEIVER is named.
 *
 * Both matter, and the review round that asked for this named why: a raw-text
 * match for the channel also matched `window.api.ipcRenderer.on(...)` — a
 * receiver whose whitelist (`preload/index.ts`, `validChannels`) cannot carry
 * this channel and whose `on` returns nothing — so a one-token swap would have
 * re-killed `Cmd/Ctrl+P` with every suite green. And a commented-out
 * subscription satisfied the subscription and teardown patterns both.
 */
const code = (path) =>
	read(path)
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			return !(
				trimmed.startsWith("//") ||
				trimmed.startsWith("*") ||
				trimmed.startsWith("/*")
			);
		})
		.join("\n");

const MAIN = code("src/main/index.ts");
/*
 * WHICH DOOR A PRESS MEANS now lives in its own main-side module rather than in
 * the `before-input-event` listener, so the rule can be driven directly (QA
 * round 1's Q-B1/Q-B2: a `headless` lane cannot satisfy the hook's focus gate,
 * so the branch was unreachable there). The two pins below therefore read the
 * RULE in `palette-door.ts` and the WIRING in `index.ts` separately - the way
 * the renderer half of this file already reads `palette-shortcut.ts` and the
 * hook apart.
 */
const DOOR = code("src/main/palette-door.ts");
const HOOK = code(
	"src/renderer/src/features/command-palette/use-command-palette-shortcut.ts",
);
const APP = code("src/renderer/src/app.tsx");
const SHORTCUT = code(
	"src/renderer/src/features/command-palette/palette-shortcut.ts",
);

test("main sends a DISTINCT channel for each main-process door", () => {
	/*
	 * Both chords are answered in main (the renderer cannot see them: the hook
	 * fires first and preventDefaults), and they must arrive on DIFFERENT channels
	 * (issue #850). Before this, Shift was unchecked, so `Cmd+Shift+P` took
	 * `Cmd+P`'s path and the commands door did not exist.
	 */
	assert.match(
		DOOR,
		/everything:\s*"toggle-command-palette",[\s\S]{0,80}?commands:\s*"toggle-command-palette-commands",/,
		"the rule must name one channel per door; a shared channel is the missing third door",
	);
	assert.match(
		DOOR,
		/input\.shift[\s\S]{0,40}?PALETTE_DOOR_CHANNELS\.commands[\s\S]{0,40}?:[\s\S]{0,40}?PALETTE_DOOR_CHANNELS\.everything/,
		"and Shift must be what selects between them",
	);
	/*
	 * The WIRING, read separately: the listener must SEND the channel the rule
	 * returned, and must not decide a door of its own. A registration that
	 * re-derived the condition would leave the pure rule untested in the app and
	 * the app untested by the rule.
	 */
	assert.match(
		MAIN,
		/webContents\.send\(\s*paletteChannel\s*,?\s*\)/,
		"main must send the channel the rule chose",
	);
	assert.match(
		MAIN,
		/paletteDoorChannel\(\s*process\.platform\s*,\s*input\s*\)/,
		"and it must come from the pure rule, handed the platform it has to read",
	);
	assert.doesNotMatch(
		MAIN,
		/input\.key\.toLowerCase\(\) === "p"/,
		"the P decision belongs to `paletteDoorChannel`, not to a second copy in the listener",
	);
});

test("main's palette branch reads its modifier per platform (issue #850)", () => {
	/*
	 * The macOS half of #850. `input.control || input.meta` is this app's usual
	 * "Cmd or Ctrl" reading, and on darwin it swallowed the palette's own Ctrl+P
	 * walk step before the renderer could see it. The palette branch now answers
	 * Cmd alone on darwin and leaves Control to the renderer; Windows and Linux
	 * keep the usual reading. Pinned on the wiring because the collision only
	 * exists in a focused, visible macOS window.
	 */
	assert.match(
		DOOR,
		/platform === "darwin"\s*\?\s*input\.meta\s*:\s*input\.control \|\| input\.meta/,
		"the rule must stop folding Control into Cmd on macOS",
	);
	assert.match(
		DOOR,
		/const modifier =[\s\S]{0,120}?platform === "darwin"/,
		"and the platform-aware modifier must be what the rule actually reads",
	);
	assert.match(
		MAIN,
		/paletteDoorChannel\(\s*process\.platform\s*,\s*input\s*\)/,
		"the listener reads the running platform rather than keeping a second copy of the split",
	);
	/*
	 * And the scope of that change is the palette branch alone: the app's usual
	 * reading stays for the zoom and speech branches, which do not collide with a
	 * renderer gesture.
	 */
	assert.match(
		MAIN,
		/const isCmdOrCtrl = input\.control \|\| input\.meta/,
		"the other branches keep the app's usual Cmd-or-Ctrl reading",
	);
});

test("main does NOT bind Cmd/Ctrl+K, which the renderer owns", () => {
	/*
	 * Two owners for one keystroke toggles twice and the palette never opens, and
	 * main cannot ask whether an editor claimed the key: `before-input-event`
	 * fires before the renderer sees it.
	 */
	assert.doesNotMatch(
		MAIN,
		/input\.key\.toLowerCase\(\) === "k"/,
		"Cmd/Ctrl+K must stay out of the main process's hook",
	);
	assert.match(
		SHORTCUT,
		/(key|code)\s*(===|\.toLowerCase\(\)\s*===)\s*"k"/,
		"the renderer's predicate is where Cmd/Ctrl+K is decided",
	);
});

test("something in the renderer subscribes to BOTH channels main sends on", () => {
	/*
	 * One subscription per door (issue #850). A single subscription cannot answer
	 * two chords, and a channel without a listener is a door that does nothing and
	 * says nothing (round 1, R-1) - so the pair is asserted rather than either half.
	 */
	for (const channel of [
		"toggle-command-palette",
		"toggle-command-palette-commands",
	]) {
		/*
		 * Each channel is NAMED once, as a constant, rather than typed at the call
		 * site: the strings are the contract with main's `before-input-event` hook,
		 * and a typo at a call site is a door that silently does nothing.
		 */
		assert.match(
			HOOK,
			new RegExp(`const \\w*CHANNEL\\w* = "${channel}"`),
			`the hook must name the \`${channel}\` channel main sends on`,
		);
	}
	/*
	 * Two subscriptions, each with a handler OF ITS OWN (`() =>` rather than a
	 * bare reference — `ipcRenderer.on` hands its listener the IPC event first).
	 */
	const subscriptions =
		HOOK.match(/electron\.ipcRenderer\.on\(\s*\w+\s*,\s*\(\s*\)\s*=>/g) ?? [];
	assert.equal(
		subscriptions.length,
		2,
		"there are two main-process doors, so two subscriptions, each with its own handler",
	);
	/*
	 * The handler must APPLY A DOOR, not call the store directly: the rule that
	 * decides open/close/switch is `paletteDoorOutcome` (in `palette-shortcut.ts`),
	 * and a handler that wrote the store itself would be a second decision — the
	 * shape that let the two chords drift apart in the first place.
	 */
	assert.match(
		HOOK,
		/applyPaletteDoor\(\s*"everything"\s*\)/,
		"the Cmd/Ctrl+P subscription must apply the everything door",
	);
	assert.match(
		HOOK,
		/applyPaletteDoor\(\s*"commands"\s*\)/,
		"the Cmd/Ctrl+Shift+P subscription must apply the commands door",
	);
	assert.match(
		HOOK,
		/paletteDoorOutcome\(/,
		"the handler must go through the shared door rule rather than writing the store itself",
	);
	/*
	 * The wrapper matters: `ipcRenderer.on` hands its listener the IPC EVENT as the
	 * first argument, and passing `applyPaletteDoor` by reference would try to read
	 * a door off that event (round 3's review named the same class).
	 */
	assert.doesNotMatch(
		HOOK,
		/ipcRenderer\.on\(\s*[^,]+,\s*applyPaletteDoor\s*,?\s*\)/,
		"a direct reference would be handed the IPC event, not a door",
	);
	/*
	 * Not `window.api`: that bridge's `validChannels` whitelist does not include
	 * these channels, so its `on` registers nothing and returns undefined — the
	 * subscription would be a line that does nothing and says nothing.
	 */
	assert.doesNotMatch(
		HOOK,
		/window\.api\.ipcRenderer\.on[\s\S]{0,80}toggle-command-palette/,
		"`toggle-command-palette` is not on the api bridge's whitelist",
	);
	/*
	 * And it must be mounted by the shell, not merely defined: a subscription
	 * inside a component that is unmounted while the palette is closed answers
	 * nothing, which is the same defect one step further along.
	 */
	assert.match(
		APP,
		/useCommandPaletteShortcut\(\)/,
		"the app shell mounts the hook",
	);
});

test("every subscription is torn down, so a remount cannot answer a press twice", () => {
	/*
	 * BOTH halves, counted rather than spot-checked: with two doors there are two
	 * `on` calls, and a teardown for only one of them would leave the other
	 * answering twice after a StrictMode remount or a second window.
	 */
	const unsubscribes = (
		HOOK.match(/unsubscribe\w*\?\.\(\)|unsubscribe\w*\(\)/g) ?? []
	).length;
	const subscriptions = (HOOK.match(/electron\.ipcRenderer\.on\(/g) ?? [])
		.length;
	assert.equal(
		subscriptions,
		2,
		"there are two main-process doors to subscribe to",
	);
	assert.equal(
		unsubscribes,
		subscriptions,
		"each `ipcRenderer.on` returns an unsubscribe, and every one must be called on cleanup",
	);
});

test("the three doors ask for different jobs, through one rule", () => {
	/*
	 * The split's whole point, pinned on both halves. Read off the wiring because
	 * the two main-process doors cannot be pressed in any headless run: main
	 * checks `isFocused() && isVisible()`, and a headless launch is neither
	 * (`docs/agent-driver.md` states the same limit for these chords).
	 *
	 * The SEEDS moved with the rule: they now live in `palette-shortcut.ts`'s own
	 * table, which derives each door's scope through `parsePaletteQuery` rather
	 * than mapping it a second time — so what this pins is that the table reads
	 * the seeds `palette-search.ts` defines rather than spelling them again.
	 */
	assert.match(
		SHORTCUT,
		/chats:\s*CONVERSATION_SWITCHER_SEED/,
		"the chats door must open on the seed `palette-search.ts` defines",
	);
	assert.match(
		SHORTCUT,
		/commands:\s*COMMAND_SCOPE_SEED/,
		"the commands door must open on the seed `palette-search.ts` defines",
	);
	assert.match(
		SHORTCUT,
		/everything:\s*""/,
		"the everything door's seed is the empty query, spelled rather than left to a fallback",
	);
	assert.match(
		SHORTCUT,
		/import\s*\{[^}]*COMMAND_SCOPE_SEED[^}]*\}\s*from\s*"\.\/palette-search"/,
		"the seeds must be the ones `palette-search.ts` defines, not a second spelling of each scope",
	);
	assert.match(
		HOOK,
		/paletteShortcutIntent\(event\)[\s\S]{0,240}?applyPaletteDoor\(\s*door\s*\)/,
		"the Cmd/Ctrl+K door must go through the same rule as the other two",
	);
});

/*
 * Two geometric invariants the UX round had to find by driving the app at a
 * window size nobody had tried (900x600), because both are invisible at the size
 * the committed frames use. Neither needs a browser to assert.
 */

/** The two full-bleed bands, named once: every assertion below reads them. */
const BANDS = [
	"src/renderer/src/shared/components/common/connectivity-banner.tsx",
	"src/renderer/src/shared/components/common/backend-compatibility-banner.tsx",
];

/**
 * The surfaces the shell mounts that declare a stacking level of their own.
 *
 * Named rather than discovered by scanning `src/`: a new global scan is a second
 * way of asking a question this file already asks, and a list a reviewer can check
 * is what keeps the comparison honest. `z-[1300]`/`z-[1301]` is the canvas inline
 * editor, `z-50` is the update notification.
 */
const SHELL_SURFACES = [
	"src/renderer/src/app.tsx",
	"src/renderer/src/shared/components/common/update-notification.tsx",
	"src/renderer/src/features/chat/components/canvas/inline-edit.tsx",
	...BANDS,
];

/** The source with its comments blanked, so a level named in prose is not a declaration. */
function withoutComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("the palette owns the screen over the app's full-bleed bands", () => {
	/*
	 * WHAT THIS USED TO BE, and why it is the same invariant in a new shape. The
	 * band was `fixed inset-x-0 top-0` and 68px tall and the dialog is centred, so
	 * at a window under ~638 CSS px the two overlapped and the band painted over
	 * the query field: the user typing into a field they could not see (UX round
	 * 1, U1). The band is the shell's FIRST CHILD in flow since D9
	 * (`docs/evidence/band-occlusion/`), so it carries no stacking level at all
	 * and that overlap is impossible by construction - the assertion is kept
	 * rather than deleted because the failure it was written for was real and
	 * invisible at the captured window size, and the property that keeps it
	 * impossible is a pairing this can still falsify: no band declares a level,
	 * and the modal declares one above every level the shell itself declares.
	 */
	for (const file of BANDS) {
		const source = read(file);
		/*
		 * Matched on the ATTRIBUTE rather than on the file: these components carry
		 * their old spelling in a comment (the change's own record of what moved),
		 * and a scan of the whole text would read that comment as a live class.
		 */
		assert.doesNotMatch(
			source,
			/className="[^"]*\bz-(?:\[?\d)/,
			`${file}: an in-flow band must declare no stacking level of its own`,
		);
	}
	const palette = read(
		"src/renderer/src/features/command-palette/components/command-palette.tsx",
	);
	const paletteZ = palette.match(/className="z-\[(\d+)\]/);
	assert.ok(paletteZ, "the palette must declare a stacking level of its own");
	/*
	 * The bar is the shell's OWN highest declared level, read from the surfaces the
	 * shell mounts rather than from a constant: `z-[1300]`/`z-[1301]` (the canvas
	 * inline editor) and `z-50` (the update notification) are the other levels a
	 * screen-owning modal has to clear, and comparing against them is what makes
	 * `> 0` a claim about this app rather than about arithmetic. Comments are
	 * stripped so a level named in prose is not a declaration.
	 */
	const declared = SHELL_SURFACES.flatMap((file) =>
		[...withoutComments(read(file)).matchAll(/\bz-(?:\[(\d+)\]|(\d+))/g)].map(
			(match) => Number(match[1] ?? match[2]),
		),
	);
	const highest = declared.length ? Math.max(...declared) : 0;
	assert.ok(
		Number(paletteZ[1]) > highest,
		`the palette paints at ${paletteZ[1]} and the shell's highest declared level is ${highest}: the modal must own the screen`,
	);
});

test("no status surface sits above the window, and the pane owns the ones there are", () => {
	/*
	 * THE ACCEPTANCE POINT NO OTHER GATE WATCHES. With no band up the region is the
	 * WHOLE window, and it is the whole window because both bands `return null`
	 * rather than because a `fixed` band happened to take no layout space - so a
	 * revert of the shell restructure, or of a band's `fixed inset-x-0 top-0 w-full`,
	 * would put the covered rows back with every other check in this file green.
	 * Three facts, each of which the reviewed change is the only reason for: the
	 * band's own class attribute is not positioned, the region below them is
	 * `flex-1 min-h-0`, and the two bands are the shell root's first children.
	 */
	/*
	 * THE REACH OF THIS, which is a literal class attribute and nothing else (review
	 * round 2, F5). `className="..."` is what it reads, so a band that took its
	 * positioning through `cn(...)` - this repo's route for conditional classes - would
	 * satisfy this assertion without carrying the class in an attribute at all. That is
	 * complete TODAY and only today: both band files use literal class names (0 `cn(`
	 * calls), and the day one of them grows a conditional class this assertion, the
	 * palette's level comparison and the first-children check below all need a scan of
	 * the class surface rather than of the attribute. Stated here so the limit is read
	 * beside the assertion rather than discovered when it matters.
	 */
	for (const file of BANDS) {
		assert.doesNotMatch(
			read(file),
			/className="[^"]*\bfixed\b/,
			`${file}: a band must not be positioned (it takes its height out of the shell)`,
		);
	}
	const app = read("src/renderer/src/app.tsx");
	const region = [...app.matchAll(/className="([^"]*)"/g)]
		.map((match) => match[1])
		.find(
			(classes) =>
				classes.includes("flex-1") &&
				classes.includes("min-h-0") &&
				classes.includes("overflow-hidden"),
		);
	assert.ok(
		region,
		"the region below the bands must be `flex-1 min-h-0 overflow-hidden`: `h-screen` on it would make the shell taller than the window whenever a band is up",
	);
	assert.match(
		app,
		/className="relative flex h-screen flex-col overflow-hidden"/,
		"the shell root must be a COLUMN, or the bands and the region share a row",
	);
	/*
	 * AND THE SHELL ROOT CARRIES NEITHER SURFACE ANY MORE (chat redesign §F2,
	 * design round 1 D3). The bands used to be the shell's first children and this
	 * file pinned that order; §F2's contract is the opposite - a status message
	 * belongs INSIDE the conversation pane, under its top row, so it can never
	 * span the sidebar or sit above the window controls - and the order pin is
	 * therefore replaced rather than deleted: the root must mount NEITHER band, and
	 * the pane must mount the strip.
	 */
	for (const gone of ["<ConnectivityBanner", "<BackendCompatibilityBanner />"])
		assert.ok(
			!withoutComments(app).includes(gone),
			`the shell root still mounts ${gone}: §F2 puts every status surface inside the conversation pane`,
		);
	const pane = withoutComments(
		read("src/renderer/src/features/chat/components/chat-content.tsx"),
	);
	const strip = pane.indexOf("<ChatStatusStrip />");
	const compatibility = pane.indexOf("<BackendCompatibilityBanner />");
	const header = pane.indexOf("<ChatHeader");
	assert.ok(
		header > -1 && strip > header && compatibility > strip,
		`the pane must mount the strip under its top row, with the compatibility band after it (header ${header}, strip ${strip}, compatibility ${compatibility})`,
	);
});

test("the key listener owns the field's keys, not the dialog's", () => {
	/*
	 * The listener is on `window`, so without this gate Tab-to-the-Clear-button
	 * followed by Enter ran a row instead of the focused control, and
	 * Shift/Alt+Arrow were taken from the caret (UX round 1, U2 and U3).
	 */
	const palette = read(
		"src/renderer/src/features/command-palette/components/command-palette.tsx",
	);
	assert.match(
		palette,
		/event\.target[^\n]*?INPUT_ID/,
		"the handler must stand down unless the event's target is the query field",
	);
});

test("the selection walk is the shared decision, not a second copy in the component", () => {
	/*
	 * Issue #761: the arrows and the Ctrl+N/Ctrl+P pair are decided once — the
	 * decision (`paletteStepIntent`) and its arithmetic (`paletteStepIndex`) are
	 * the pure functions `scripts/palette-shortcut.test.mjs` exercises. This is
	 * the wiring half, in the same shape as the close-time-restore pins below:
	 * the component must consult that decision rather than grow branches of its
	 * own, because a second copy here would leave the tests pinning a rule the
	 * app no longer runs. And the footer must draw the ADVERTISED caps (the
	 * reachable subset), never the bound pair: Ctrl+P is bound but unreachable
	 * in the packaged app, so drawing it is the dead-cap regression design
	 * round 1's D1 removed.
	 */
	const palette = code(
		"src/renderer/src/features/command-palette/components/command-palette.tsx",
	);
	assert.match(
		palette,
		/paletteStepIntent\(event\)/,
		"the selection handler must ask the shared walk decision",
	);
	assert.match(
		palette,
		/paletteStepIndex\(/,
		"the step's arithmetic must be the shared one, or wrap and count=0 stop being pinned",
	);
	assert.match(
		palette,
		/paletteReachableStepCaps\(/,
		"the footer must draw the reachable caps (Ctrl+N only) - Ctrl+P is bound but unreachable in the packaged app (design round 1, D1)",
	);
	assert.doesNotMatch(
		palette,
		/\bpaletteStepCaps\(/,
		"the bound set includes Ctrl+P; drawing it in this legend is exactly the dead-cap regression D1 removed",
	);
	assert.doesNotMatch(
		palette,
		/event\.key === "Arrow/,
		"the arrow branches belong to the decision now; a second copy is the drift this pins",
	);
});

/* ---------------------------------------------------------------- */
/* The close-time restore, and the one close it could not cover      */
/* ---------------------------------------------------------------- */

/*
 * The reported defect was not "the palette focuses the wrong thing": it was
 * that picking another conversation REPLACES the pane (`SessionPanel` is keyed
 * on the pane identity), so the node the palette captured on open is left
 * behind in the pane the user just left, the old `isConnected` question
 * answered "gone", and the restore parked the caret on the rail's Search button
 * 8-13 ms after the incoming composer had focused itself. Everything typed
 * afterwards reached a button.
 *
 * These are source pins on the two halves that make the new rule real, asserted
 * here rather than inferred from a mounted dialog because the question is
 * whether the CONTRACT is still wired to the same rule: the predicate itself is
 * exercised by `scripts/palette-focus.test.mjs`, and the behaviour by the
 * renderer driver's palette scenes and by QA on the built app.
 */
const PALETTE_SOURCE =
	"src/renderer/src/features/command-palette/components/command-palette.tsx";

test("the close-time restore asks the caret rule BEFORE it moves the caret anywhere", () => {
	/*
	 * A DESTINATION PIN, not a statement-order curiosity (review round 1, MINOR
	 * 2). What the old rule got wrong was not that it focused the rail - it was
	 * that it focused a node without asking the question that knew about the view
	 * move. So what this pins is the sequence: the rule is consulted, and only
	 * then may anything be focused. A restore that focuses first and asks later
	 * fails here whatever order its arms are written in.
	 */
	const palette = withoutComments(read(PALETTE_SOURCE));
	const from = palette.indexOf("const restoreFocus = useCallback(");
	assert.ok(from > -1, "the palette's close-time restore is gone");
	const restore = palette.slice(from, palette.indexOf("}, []);", from));
	const rule = restore.indexOf("closeTimeFocusOutcome({");
	assert.ok(
		rule > -1,
		"the restore must ask `closeTimeFocusOutcome`, not only 'is the captured node still connected' - the question that put focus on the rail",
	);
	const firstFocus = restore.indexOf(".focus()");
	assert.ok(firstFocus > -1, "the restore no longer focuses anything at all");
	assert.ok(
		firstFocus > rule,
		"nothing may be focused before the rule answers - a restore that focuses first is the rail door's defect with a rule bolted on beside it",
	);
});

test("each of the rule's three caret outcomes reaches its own destination", () => {
	/*
	 * The outcomes are the rule's (`scripts/palette-focus.test.mjs` bundles the
	 * eight cells); this is the other half of the contract - that the component
	 * still routes each one somewhere, and somewhere DIFFERENT. Written as one
	 * test because the claim is relational: `composer` hands over, `leave` moves
	 * nothing, `captured` is the only arm that focuses a captured node, and the
	 * rail's Search row is what is left when none of those applies.
	 */
	const palette = withoutComments(read(PALETTE_SOURCE));
	const from = palette.indexOf("const restoreFocus = useCallback(");
	assert.ok(from > -1, "the palette's close-time restore is gone");
	const restore = palette.slice(from, palette.indexOf("}, []);", from));

	const composerArm = restore.indexOf('if (outcome === "composer"');
	const leaveArm = restore.indexOf('if (outcome === "leave")');
	const capturedArm = restore.indexOf('if (outcome === "captured"');
	assert.ok(
		composerArm > -1,
		"a moved view has to be able to hand the caret to the composer it mounted",
	);
	assert.ok(
		leaveArm > composerArm,
		"the `leave` arm belongs after the hand-off",
	);
	assert.ok(
		capturedArm > leaveArm,
		"the captured-node restore is the last of the three",
	);

	assert.match(
		restore.slice(composerArm, leaveArm),
		/handCaretToComposer\(\)\) return;/,
		"`composer` must be answered by the composer's own hand-off, and must return rather than falling through to the rail when the hand-off fails on its own terms",
	);
	assert.doesNotMatch(
		restore.slice(leaveArm, capturedArm),
		/\.focus\(\)/,
		"`leave` means the caret is not moved: a `leave` arm that focuses is `captured` under another name",
	);
	assert.match(
		restore.slice(capturedArm),
		/previous\.focus\(\)/,
		"`captured` is the arm that puts the caret back where it was",
	);
	assert.equal(
		(restore.match(/previous\.focus\(\)/g) ?? []).length,
		1,
		"the captured node is focused in exactly one place, and it is behind the outcome that says so",
	);

	const trigger = restore.indexOf("[data-command-palette-trigger]");
	assert.ok(
		trigger > capturedArm,
		"the rail's Search row is the fallback - reached after the rule's own arms, never before them",
	);
});

test("the pane identity is captured at open, by the pane's own rule", () => {
	const palette = withoutComments(read(PALETTE_SOURCE));
	const open = palette.slice(
		palette.indexOf("if (!isCommandPaletteOpen) return;"),
		palette.indexOf("}, [isCommandPaletteOpen]);"),
	);
	assert.match(
		open,
		/returnFocusTo\.current =\s*active instanceof HTMLElement \? active : null;/,
		"the captured node is still captured where it always was",
	);
	assert.match(
		open,
		/identityAtOpen\.current = currentPanelIdentity\(\);/,
		"the identity has to be captured in the SAME effect, or the comparison it feeds is between two different instants",
	);
	/*
	 * And the rule behind it is the pane's, not a second notion of "the view
	 * moved": the draft's own session id is read, which is the term that makes
	 * the New-chat row (a fresh `draft:<uuid>`) a move - `stageDraft` leaves
	 * `activeSessionId` at the conversation the user is leaving.
	 */
	assert.match(palette, /panelIdentityOfView\(/);
	assert.match(palette, /state\.drafts\[draftKey\]\?\.sessionId/);
});

/* ------------------------------------------------------------------ *
 * The draft door (issues #844, #849)
 * ------------------------------------------------------------------ */

const PALETTE_SOURCES_SOURCE =
	"src/renderer/src/features/command-palette/use-palette-sources.ts";
const SESSIONS_STORE_SOURCE =
	"src/renderer/src/shared/store/canonical-sessions-store.ts";
const CHAT_PAGE_SOURCE =
	"src/renderer/src/features/chat/components/chat-page.tsx";

/**
 * Every entity row STAGES A DRAFT, and none of them builds a chat URL.
 *
 * The bug this closes (#844) was one row's TARGET, so the pin is on the target
 * rather than on a rendered press: `use-palette-sources.ts` composes the rows,
 * the view dispatches them, and both halves have to agree or the row lands
 * somewhere neither file intended. `/chat/<agent id>` had no non-session
 * fallback in the store — the `sessionByAgent` map had a reader and NO WRITER —
 * so any row that built it landed on the "legacy link" notice, which is why the
 * absence of a chat URL in the sources file is asserted rather than merely the
 * presence of the new target.
 */
test("the palette's entity rows stage a draft and build no chat URL", () => {
	const sources = code(PALETTE_SOURCES_SOURCE);
	/*
	 * The agent row: the draft door, keyed by the agent's own name (the slug
	 * every other surface addresses it by).
	 */
	assert.match(
		sources,
		/target: \{ type: "draft", kind: "agent", name: agent\.name \}/,
		"the agent row must stage an agent draft rather than open a chat URL",
	);
	/*
	 * And it must be GATED on the capability that can deliver it — a row whose
	 * only action is to stage a draft is not offered by a backend that cannot
	 * create sessions.
	 */
	assert.match(
		sources,
		/if \(canStageDraft\)[\s\S]{0,600}?kind: "agent"/,
		"the agent chat row must carry the sidebar's own canStageDraft gate",
	);
	/*
	 * The team row (#849): the row READS the display label while the draft is
	 * keyed by the slug. A row that staged the label would open a second, empty
	 * chat for a team that already has one, because the sidebar's rows are keyed
	 * by the slug.
	 */
	assert.match(
		sources,
		/name: teamDisplayName\(team\)/,
		"a team row reads the team's display label",
	);
	assert.match(
		sources,
		/*
		 * Read across the formatter's chosen line breaks rather than the one this
		 * pin was written against: biome reflows this object literal onto its own
		 * lines, and a pin that only matched the single-line spelling would go red
		 * on a formatting pass that changed nothing about the value.
		 */
		/type: "draft" as const,\s*kind: "team" as const,\s*name: team\.name,/,
		"a team row stages a team draft keyed by the SLUG, not by the label it reads",
	);
	assert.match(
		sources,
		/kind: "team" as const,[\s\S]{0,200}?group: "teams" as const/,
		"a team row carries the team kind and the team group",
	);
	/*
	 * The kinds are said on the row, so a same-named agent and team cannot be
	 * confused even with the section heading scrolled away.
	 */
	assert.match(sources, /hint: "Agent chat"/);
	assert.match(sources, /hint: "Team chat"/);
	/*
	 * And NOTHING in this file builds a chat URL any more. Asserted as an
	 * absence because that is the defect: the row that built one is the row that
	 * landed on the notice.
	 */
	assert.doesNotMatch(
		sources,
		/`\/chat\//,
		"no palette row may build a `/chat/...` URL: the entity rows stage drafts",
	);
	assert.doesNotMatch(
		sources,
		/"\/chat\//,
		"no palette row may build a `/chat/...` URL either",
	);
	assert.doesNotMatch(
		sources,
		/sessionByAgent/,
		"the palette must not read the removed `sessionByAgent` map",
	);
});

test("the view's runner has the draft case, in the sidebar's own order", () => {
	const view = code(PALETTE_SOURCE);
	const draftCase = view.slice(
		view.indexOf('case "draft"'),
		view.indexOf('case "panel"'),
	);
	assert.ok(draftCase.length > 0, "the runner must dispatch the draft target");
	/*
	 * The three statements, in the order the sidebar's rows use: stage (NOT
	 * fresh — the keyed `draft:<kind>:<name>` row is RE-USED, so a name pressed
	 * twice returns to its chat rather than emptying it), close the palette, then
	 * go to the chat route.
	 */
	assert.match(
		draftCase,
		/stageDraft\(\{ kind, name \}\)/,
		"the draft case must stage with the target's own kind and name",
	);
	assert.doesNotMatch(
		draftCase,
		/stageDraft\([^)]*,\s*true\s*\)/,
		"the draft case must NOT stage fresh: that would clear the keyed row the sidebar shares",
	);
	assert.ok(
		draftCase.indexOf("stageDraft") < draftCase.indexOf("closeCommandPalette"),
		"the stage happens before the close, as `handleNewChat` orders it",
	);
	assert.ok(
		draftCase.indexOf("closeCommandPalette") <
			draftCase.indexOf('navigate("/chat")'),
		"the close happens before the navigation, as `handleNewChat` orders it",
	);
});

test("the store no longer carries a reader-less `sessionByAgent` map", () => {
	/*
	 * REMOVED rather than populated (the maintainer's call on #844): there is no
	 * canonical-chat binding for an agent in this model — an agent may have many
	 * conversations — so the map was a lookup with no writer and the honest fix
	 * is to delete it rather than invent data for it.
	 */
	const store = code(SESSIONS_STORE_SOURCE);
	assert.doesNotMatch(
		store,
		/\bsessionByAgent\b/,
		"`sessionByAgent` must be gone from the store, not merely unused",
	);
	/*
	 * And the chat route keeps its honest sentence for a genuinely old link: any
	 * route identity that is not a session id gets the notice, which is what the
	 * map's empty branch used to do by accident.
	 */
	const page = code(CHAT_PAGE_SOURCE);
	assert.match(
		page,
		/if \(!SESSION_ID\.test\(routeIdentity\)\)[\s\S]{0,200}?setRouteError/,
		"a non-session route identity still gets the legacy-link sentence",
	);
	assert.match(
		page,
		/This legacy link has no canonical chat\. Its saved history is unchanged\./,
		"the sentence itself is unchanged: old links are still told the truth",
	);
	assert.doesNotMatch(
		page,
		/sessionByAgent/,
		"the chat page must not read the removed map",
	);
});
