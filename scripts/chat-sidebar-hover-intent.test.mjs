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

/*
 * EACH ACT IS READ IN ITS OWN WINDOW (agent review round 1, M2). The archive and
 * the pin carry the SAME reveal class string - one mechanism on two controls - so
 * a file-wide `sidebar.includes(...)` proved only that ONE of them still carried
 * it: a half-applied change (one act reverted, its twin left alone) is exactly the
 * failure this test exists for, and the shared substring was blind to it. The
 * windows are delimited by the controls' OWN markers, which is a boundary that
 * moves with the file rather than a character count that rots.
 */
const CONTROLS = [
	{ name: "grip", marker: "data-session-pin-grip" },
	{ name: "pin", marker: "data-session-pin" },
	{ name: "archive", marker: "data-session-archive" },
	{ name: "pair wrapper", marker: "data-session-control-pair" },
];

/** The marker as the JSX writes it: alone on its own line, never as a prefix. */
const markerIndex = (marker) => {
	const match = new RegExp(`\\n\\s*${marker}\\n`).exec(sidebar);
	assert.ok(match, `${marker} is drawn on its own line`);
	return match.index;
};

/** One act's own source: from its marker to the next control's, capped. */
const ownRegion = (marker, span = Number.POSITIVE_INFINITY) => {
	const at = markerIndex(marker);
	const next = CONTROLS.map((entry) => markerIndex(entry.marker))
		.filter((index) => index > at)
		.sort((a, b) => a - b)[0];
	return sidebar.slice(at, Math.min(next ?? at + span, at + span));
};

/*
 * ONE ACT'S OWN SOURCE, BOUNDED BY THE NEXT ACT'S MARKER - AND THE CAP IS FOR THE
 * LAST ACT ALONE (agent review round 2's MAJOR). A fixed 1500-character cap looks
 * harmless and is not: the archive's class list sits 7,402 characters past its own
 * marker and the pin's 6,099, both behind long comment blocks, so a cap that
 * comfortably reached the grip (525) and the pair wrapper (439) stopped thousands
 * of characters SHORT of the two acts whose shared substring the previous round
 * was itself raised about - a bare-hover term reintroduced on either of them was
 * invisible to the negative checks below. The pair wrapper is the file's last act,
 * so it has no successor marker to stop at and keeps a cap: wide enough to cover
 * its class expression, short enough to stop before the drafts row's unrelated
 * reveal further down. Windows are read as CODE (`codeOf`), because the prose in
 * these blocks names the very selectors the negative checks forbid.
 */
const PAIR_SPAN = 1500;
const spanFor = (marker) =>
	marker === "data-session-control-pair" ? PAIR_SPAN : undefined;

const ownCode = (marker) => codeOf(ownRegion(marker, spanFor(marker)));

const DWELL =
	'"group-data-[session-hover-intent]:flex group-data-[session-hover-intent]:text-ink-muted"';
const FOCUS =
	'"group-has-[:focus-visible]:flex group-has-[:focus-visible]:text-ink-muted"';

test("all four per-row acts reveal on the dwell, and none on a bare hover", () => {
	const expects = [
		[
			"pair wrapper",
			"data-session-control-pair",
			[
				'"hidden group-data-[session-hover-intent]:flex group-has-[:focus-visible]:flex"',
			],
		],
		["archive", "data-session-archive", [DWELL, FOCUS]],
		[
			"pin",
			"data-session-pin",
			[
				'"group-data-[session-hover-intent]:flex group-data-[session-hover-intent]:text-ink-muted group-has-[:focus-visible]:flex group-has-[:focus-visible]:text-ink-muted"',
			],
		],
		["grip", "data-session-pin-grip", [DWELL]],
	];
	for (const [name, marker, classes] of expects) {
		const own = ownCode(marker);
		for (const cls of classes) {
			assert.ok(
				own.includes(cls),
				`the ${name}'s own class list carries ${cls}`,
			);
		}
	}
	/*
	 * THE OLD REVEAL IS GONE FROM EVERY ACT. Scoped to each control's own window
	 * rather than to the whole file: `chat-sidebar.tsx` legitimately reveals OTHER
	 * things on `group-hover` (the drafts row's own trash control), and a file-wide
	 * ban would be a second rule about a different surface.
	 */
	for (const { name, marker } of CONTROLS) {
		assert.equal(
			/group-hover:/.test(ownCode(marker)),
			false,
			`the ${name} does not also carry the immediate hover reveal`,
		);
	}
	/*
	 * AND THE GRIP IS THE ONE ACT WITH NO KEYBOARD TERM (design D3): it is
	 * `aria-hidden` and unfocusable, so revealing it for the keyboard would offer a
	 * sighted keyboard reader a handle they cannot operate. Its window is the one
	 * place either focus term would be a regression.
	 */
	assert.equal(
		/group-focus-within|group-has-\[\:focus-visible\]/.test(
			ownCode("data-session-pin-grip"),
		),
		false,
		"the grip still has no focus term of either spelling",
	);
	/*
	 * AND THE TIME GIVES WAY ON THE SAME CLOCK. The timestamp is the other half of
	 * the one swap the reveal is: if it still hid on the bare hover it would blank
	 * for the whole dwell and leave a hole where the time was.
	 */
	assert.ok(
		sidebar.includes(
			'className="ml-auto shrink-0 pl-2 font-mono text-ink-dim text-mono-sm tabular-nums group-has-[:focus-visible]:hidden group-data-[session-hover-intent]:hidden"',
		),
		"the trailing time leaves on the acts' own clock",
	);
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

test("the keyboard's door is focus-visible: immediate for a Tab, closed to a press", () => {
	/*
	 * THE POINTER'S HALF IS THE DWELL AND THE KEYBOARD'S IS NOT (issue #840), but the
	 * keyboard's door is `:focus-visible` rather than any focus at all - agent review
	 * round 1's Q-1, UX's U1: the bare `group-focus-within` is raised for a
	 * MOUSE-driven focus too, so a press in the row's trailing band focused the row's
	 * button, revealed the acts inside the gesture, narrowed the button out from under
	 * the mouseup, and the click that followed was swallowed by the row's wrapper. A
	 * Tab still reveals the acts immediately; a press no longer re-lays the row out.
	 */
	for (const marker of [
		"data-session-control-pair",
		"data-session-archive",
		"data-session-pin",
	]) {
		assert.equal(
			/group-focus-within/.test(ownCode(marker)),
			false,
			`${marker} does not reveal on focus at all - only on a keyboard focus`,
		);
	}
	assert.ok(
		ownCode("data-session-control-pair").includes(
			"group-has-[:focus-visible]:flex",
		),
		"the pair wrapper keeps an immediate door for the keyboard",
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
