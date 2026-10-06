import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * THE ROW'S POINTER-INTENT GATE (issue #840), pinned at the seam where it can rot
 * silently and green tests cannot see it: the attribute one module WRITES and the
 * class variants another module READS are two files, and a rename in either makes
 * the row's acts stop appearing under the pointer with no error anywhere.
 *
 * The three claims here:
 *
 *  1. ONE WRITER. `chat-row-hover-intent.tsx` is what sets and clears the
 *     attribute, it arms the app's own `HOVER_INTENT_MS` (not a second number, and
 *     not the pan's `TOOLTIP_DELAY_MS`), cancels on leave, and does not suppress
 *     itself under `prefers-reduced-motion` (a display switch is not motion).
 *  2. EVERY READER AGREES. All four per-row acts - the pair wrapper, the archive,
 *     the pin and the grip - reveal on that attribute, and none of them still
 *     reveals on the bare `group-hover` that the change replaced.
 *  3. IT IS MOUNTED, NOT A HOOK IN A RENDER FUNCTION. The row is a plain render
 *     function, so the gate has to be a component the row mounts; the module's own
 *     note records why (`sessionRow` cannot run a hook per row).
 */

const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const INTENT =
	"src/renderer/src/features/chat/components/chat-row-hover-intent.tsx";

const sidebar = readFileSync(SIDEBAR, "utf8");
const intent = readFileSync(INTENT, "utf8");
/*
 * The prose in these two files names the constants it is explaining - the pan's
 * `TOOLTIP_DELAY_MS` is the number the dwell must beat, and reduced motion is the
 * setting the reveal deliberately ignores - so the assertions that forbid those
 * tokens have to read the CODE rather than the comments.
 */
const codeOf = (source) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const intentCode = codeOf(intent);
const sidebarCode = codeOf(sidebar);

/** The single attribute the gate writes; the class strings below are the readers. */
const ATTRIBUTE = "data-session-hover-intent";

test("the gate writes the one attribute the controls read", () => {
	assert.match(
		intent,
		new RegExp(`ROW_HOVER_INTENT_ATTRIBUTE = "${ATTRIBUTE}"`),
		"the writer names the attribute the readers' class variants expect",
	);
	assert.ok(
		intent.includes("setAttribute(ROW_HOVER_INTENT_ATTRIBUTE"),
		"the dwell sets the attribute",
	);
	assert.ok(
		intent.includes("removeAttribute(ROW_HOVER_INTENT_ATTRIBUTE"),
		"and leaving clears it",
	);
});

test("the dwell is the app's hover-intent constant, and it is cancelled on leave", () => {
	assert.ok(
		intent.includes(
			'import { HOVER_INTENT_MS } from "@shared/components/common/resizable-divider"',
		),
		"the constant is IMPORTED rather than restated - the app has one number for 'the pointer has decided to stay'",
	);
	assert.ok(
		intent.includes("setTimeout(") && intent.includes("HOVER_INTENT_MS"),
		"the dwell is armed with that constant",
	);
	assert.ok(
		!/TOOLTIP_DELAY_MS/.test(intentCode),
		"and it is not the pan's 400ms TooltipProvider default, which is the number the acts must reveal BEFORE",
	);
	assert.ok(
		intent.includes('"pointerleave"'),
		"leaving the row cancels the pending dwell",
	);
	assert.ok(
		intent.includes("clearTimeout("),
		"cancelling actually clears the timer",
	);
});

test("reduced motion is not consulted: the reveal is a display switch, not motion", () => {
	assert.equal(
		/prefers-reduced-motion/.test(intentCode),
		false,
		"a `display` switch with no transition is not one of the four properties docs/branding.md animates; suppressing it would take the acts away from the readers most likely to need them",
	);
});

test("all four per-row acts reveal on the dwell, and none on a bare hover", () => {
	/*
	 * The four the change names. The patterns are deliberately the WHOLE class
	 * string, because a half-applied change is the failure this test exists for: a
	 * control left on `group-hover:flex` would still pop under a passing pointer
	 * while its neighbours waited, which reads as a glitch rather than a dwell.
	 */
	const reveals = [
		[
			"pair wrapper",
			'"hidden group-data-[session-hover-intent]:flex group-focus-within:flex"',
		],
		[
			"archive",
			'"group-data-[session-hover-intent]:flex group-data-[session-hover-intent]:text-ink-muted"',
		],
		[
			"pin",
			'"group-data-[session-hover-intent]:flex group-data-[session-hover-intent]:text-ink-muted group-focus-within:flex group-focus-within:text-ink-muted"',
		],
		[
			"grip",
			'"group-data-[session-hover-intent]:flex group-data-[session-hover-intent]:text-ink-muted"',
		],
	];
	for (const [name, classes] of reveals) {
		assert.ok(
			sidebar.includes(classes),
			`the ${name} reveals on the dwell with this exact class string`,
		);
	}
	/*
	 * AND THE TIME GIVES WAY ON THE SAME CLOCK. The timestamp is the other half of
	 * the one swap the reveal is: if it still hid on the bare hover it would blank
	 * for the whole dwell and leave a hole where the time was.
	 */
	assert.ok(
		sidebar.includes(
			'className="ml-auto shrink-0 pl-2 font-mono text-ink-dim text-mono-sm tabular-nums group-focus-within:hidden group-data-[session-hover-intent]:hidden"',
		),
		"the trailing time leaves on the acts' own clock",
	);
	/*
	 * THE OLD REVEAL IS GONE FROM THE ACTS. Scoped to the four class strings above
	 * rather than to the whole file: `chat-sidebar.tsx` legitimately reveals OTHER
	 * things on `group-hover` (the drafts row's own trash control), and a file-wide
	 * ban would be a second rule about a different surface.
	 */
	for (const [name, classes] of reveals) {
		assert.equal(
			classes.includes("group-hover:"),
			false,
			`the ${name} does not also carry the immediate hover reveal`,
		);
	}
	assert.equal(
		/class(Name)?=\{?[^}]*group-hover:flex/.test(
			sidebar.slice(
				sidebar.indexOf("data-session-control-pair"),
				sidebar.indexOf("data-session-control-pair") + 400,
			),
		),
		false,
		"and the pair wrapper's own class expression has no immediate hover term left",
	);
});

test("the keyboard path is untouched: focus-within stays immediate", () => {
	/*
	 * The gate is the POINTER's half only. `group-focus-within` is what makes the
	 * acts reachable by Tab, and a dwell on it would make the keyboard wait out a
	 * pointer timer it never asked for.
	 */
	assert.ok(
		sidebar.includes(
			'"hidden group-data-[session-hover-intent]:flex group-focus-within:flex"',
		),
		"the pair wrapper keeps its focus term",
	);
	assert.ok(
		intentCode.includes('"pointerenter"') &&
			!/addEventListener\("focus/.test(intentCode),
		"the gate listens to the pointer alone - it does not gate focus",
	);
});

test("the gate is mounted per row, as a component", () => {
	assert.ok(
		sidebar.includes(
			'import { ChatRowHoverIntent } from "./chat-row-hover-intent";',
		),
		"the row imports it",
	);
	assert.ok(
		/\(pinsEnabled \|\| archiveEnabled\) && <ChatRowHoverIntent \/>/.test(
			sidebar,
		),
		"and mounts it under the same condition that puts the row's `group` on the box - the two are one pair, because the attribute it writes is only read by descendants of that box",
	);
	assert.ok(
		/export function ChatRowHoverIntent\(/.test(intent),
		"it is a component, which is what lets per-row state exist inside a plain render function's output",
	);
});
