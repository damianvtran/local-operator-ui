/**
 * The console surface close path (#754), as the shipped source pins it.
 *
 *     node --test scripts/console-close.test.mjs
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, because the split is the reason for its
 * shape. The new path is three seams across two processes — a renderer control, an
 * IPC channel behind main's sender check, and `ConsoleHost.close` — and the parts a
 * source read can falsify are the WIRING and the FLAGS: which control reaches which
 * channel, what the pane sends for a running surface versus an ended one, and that
 * the row's close control is a sibling of the tab rather than a button inside a
 * button. Those are facts about the JSX and the handlers that mount both, read the
 * `chat-sidebar-row-menu.test.mjs` way, with comments stripped so a rule can never
 * be satisfied by prose about the rule.
 *
 * THE EXECUTED HALVES LIVE IN THEIR OWN INSTRUMENTS, and this file says where so a
 * reader does not mistake it for the whole claim:
 *
 *   - the host's own semantics — the `busy` refusal of a kill-less close of a
 *     running surface, the exit code a kill reports, and the history a dismissal
 *     removes so a relaunch cannot restore it — are `scripts/console-host.test.mjs`'s,
 *     where the fake pty and the fake `ipcMain` can run them;
 *   - the dialog's open / cancel / confirm flow against the real pane component is
 *     `scripts/console-pane-render.test.mjs`'s;
 *   - the pixels and a real pty are the live rig's (`scripts/console-host-proof.mjs`
 *     and the frames on the pull request).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const IPC = "src/main/console/ipc.ts";
const PRELOAD = "src/preload/index.ts";
const PRELOAD_TYPES = "src/preload/index.d.ts";
const SESSION_HOOK =
	"src/renderer/src/features/console/hooks/use-console-session.ts";
const PANE = "src/renderer/src/features/console/components/console-pane.tsx";
const DIALOG =
	"src/renderer/src/features/console/components/console-close-dialog.tsx";

const read = (relative) => readFileSync(relative, "utf8");
/** Comments stripped, so a rule can never be satisfied by prose about the rule -
 * the form `chat-sidebar-row-menu.test.mjs` documents. */
const code = (relative) =>
	read(relative)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
const between = (source, from, to) => {
	const at = source.indexOf(from);
	assert.notEqual(at, -1, `no source matches ${JSON.stringify(from)}`);
	const end = source.indexOf(to, at + from.length);
	assert.notEqual(
		end,
		-1,
		`no source matches ${JSON.stringify(to)} after ${JSON.stringify(from)}`,
	);
	return source.slice(at, end);
};

const IPC_CODE = code(IPC);
const PRELOAD_CODE = code(PRELOAD);
const PANE_CODE = code(PANE);

test("the close channel is on the namespace and every handler authorizes its sender", () => {
	/*
	 * The channel list is what a test enumerates, so the new name has to BE in it
	 * (the host suite's registration test walks the same list, which is what would
	 * catch a handler registered on a name the list does not carry). And the handler
	 * has to sit behind `authorize(event)` — the same three-part sender check every
	 * other handler on this namespace makes (design 2.4), never the bare
	 * `ipcMain.handle` a new channel can be added with by accident.
	 */
	const list = between(IPC_CODE, "CONSOLE_IPC_CHANNELS = [", "] as const");
	assert.ok(
		list.includes('"console-close-surface"'),
		"console-close-surface is not in CONSOLE_IPC_CHANNELS",
	);
	const handler = between(
		IPC_CODE,
		'"console-close-surface",',
		'ipcMain.handle("console-open-pane"',
	);
	assert.ok(
		handler.includes("authorize(event)"),
		"the close handler does not go through the sender check",
	);
	/*
	 * The flags pass through TRI-STATE rather than coerced: `kill` absent means
	 * "only forget an exited surface", and `kill: false` on a running one is the
	 * refusal `busy` exists for - so a truthy coercion here would silently pick an
	 * act for a caller who named neither. This is the renderer boundary's half of
	 * the contract `console-host.test.mjs` executes.
	 */
	assert.ok(
		handler.includes('kill: optionalBoolean(input.kill, "kill")') &&
			handler.includes('retain: optionalBoolean(input.retain, "retain")'),
		"the close handler does not pass both flags through as tri-state booleans",
	);
	assert.ok(
		handler.includes("host.close("),
		"the close handler does not reach the host's own close",
	);
	/*
	 * And a flag that is not a flag is refused rather than interpreted: this is
	 * untrusted input on a renderer channel, the same rule the namespace's other
	 * arguments follow.
	 */
	const helper = between(IPC_CODE, "function optionalBoolean", "}");
	assert.ok(
		helper.includes('typeof value !== "boolean"') && helper.includes("throw"),
		"a non-boolean close flag would be coerced rather than refused",
	);
});

test("the preload member invokes the channel, and its type says what it takes", () => {
	const member = between(PRELOAD_CODE, "closeSurface:", "openPane:");
	assert.ok(
		member.includes('invoke("console-close-surface"'),
		"the preload member does not invoke console-close-surface",
	);
	assert.ok(
		member.includes("options ?? {}"),
		"the preload member would lose an absent-options call",
	);
	const types = read(PRELOAD_TYPES);
	assert.ok(
		types.includes("closeSurface:") &&
			types.includes("options?: { kill?: boolean; retain?: boolean }"),
		"the window type does not carry the new member's shape",
	);
	const hook = code(SESSION_HOOK);
	const hookBody = between(
		hook,
		"const closeSurface = useCallback(",
		"const setSecure",
	);
	assert.ok(
		hookBody.includes(".closeSurface(surface, options)") &&
			hookBody.includes("read()"),
		"the hook's close does not reach the bridge and re-read the listing",
	);
});

test("a running row's press asks first, and only the confirm kills", () => {
	/*
	 * THE ASYMMETRY #754 SETTLED. A running surface's close is a kill - `host.close`
	 * refuses a kill-less close of one rather than orphaning a pty - so the press
	 * opens the question and the kill rides the answer. The assertion is that the
	 * running branch contains the QUESTION and not the call: a future edit that
	 * made the press kill outright would pass a test that only checked "kill: true
	 * exists somewhere", and fail this one.
	 */
	const runningBranch = between(
		PANE_CODE,
		"if (row.running) {",
		"void session.closeSurface(row.surface, { retain: false })",
	);
	assert.ok(
		runningBranch.includes("setPendingClose(row.surface)"),
		"a running row's close does not open the confirmation",
	);
	assert.ok(
		!runningBranch.includes("closeSurface"),
		"a running row's press reaches the host before the question is answered",
	);
	assert.ok(
		PANE_CODE.includes(".closeSurface(pendingClose, { kill: true })"),
		"the confirm no longer sends kill: true",
	);
	// One kill in the file, and it is the dialog's.
	assert.equal(
		PANE_CODE.split("kill: true").length - 1,
		1,
		"the pane holds more than one place that kills a surface",
	);
	// The ask goes through the dialog component, not an ad-hoc confirm.
	assert.ok(
		PANE_CODE.includes("<ConsoleCloseDialog") &&
			PANE_CODE.includes("open={pendingClose !== null}"),
		"the question is not the ConsoleCloseDialog the copy lives in",
	);
});

test("an ended row's press dismisses with retain: false, so a relaunch cannot restore it", () => {
	/*
	 * THE RETENTION FLAG IS THE CELL. The `retain` default for a user's surface is
	 * ON (design 7.2), so a dismissal that did not say `retain: false` would leave
	 * the surface in the retained registry and the next launch's restore would put
	 * the tab back - which is exactly the friction #754's repro reports. One
	 * occurrence in the file, so a future edit cannot quietly arm a second one.
	 */
	assert.ok(
		PANE_CODE.includes(
			"void session.closeSurface(row.surface, { retain: false })",
		),
		"an ended row's close does not send retain: false",
	);
	assert.equal(
		PANE_CODE.split("retain: false").length - 1,
		1,
		"the pane holds more than one dismissal",
	);
});

test("the row keeps select-on-click and its markers, and the close control is a sibling of the tab", () => {
	/*
	 * NESTED INTERACTIVE ELEMENTS ARE NOT HTML: the X cannot live inside the tab
	 * button, so the row is a wrapper and the control follows the tab's own
	 * `</button>` - the shape the browser strip's tabs already carry. Asserted
	 * structurally: between the row's tab tag and the close control there is a
	 * closed button, and the close control is not inside the open one.
	 */
	const rowToClose = between(
		PANE_CODE,
		"const isActive = row.surface === surface?.surface;",
		'data-tour-tag="console-surface-close"',
	);
	const firstClose = rowToClose.indexOf("</button>");
	assert.notEqual(firstClose, -1, "the tab button never closes before the X");
	assert.ok(
		!rowToClose.slice(0, firstClose).includes("console-surface-close"),
		"the close control is nested inside the tab button",
	);
	/*
	 * SELECT-ON-CLICK IS UNTOUCHED: the tab button is still a button whose only
	 * click is the lens write, and the X is not a second one that could intercept
	 * it.
	 */
	assert.ok(
		rowToClose.includes('role="tab"') &&
			rowToClose.includes("onClick={() => setStored(row.surface)}"),
		"the tab button no longer owns select-on-click",
	);
	/*
	 * THE MARKERS STAY WHERE THEY WERE (#754's own constraint): the agent marker's
	 * predicate and the blip's element are still in the row, so the new control did
	 * not displace the provenance or the completion dot.
	 */
	assert.ok(
		PANE_CODE.includes('row.agentOwned || row.lastActor === "agent"') &&
			PANE_CODE.includes('data-tour-tag="console-surface-blip"'),
		"the row's agent marker or blip was disturbed",
	);
});

test("the control is reachable by mouse and keyboard, and its label names the state and the terminal", () => {
	/*
	 * REACHABILITY. The reveal is an opacity step with a hover AND a focus-within
	 * arm (`REVEAL_ON_HOVER_OR_FOCUS`, the browser strip's own constant) - so the
	 * keyboard path is a real one (Tab onto the row reveals the control, Tab again
	 * reaches it) and the pointer path reveals it from the ROW's hover, not from
	 * the control having to be hoverable while invisible. A reveal by `display` or
	 * by `visibility` would fail this: both remove the control from the focus order.
	 */
	const reveal = between(PANE_CODE, "const REVEAL_ON_HOVER_OR_FOCUS =", ";");
	assert.ok(
		reveal.includes("opacity-0") &&
			reveal.includes("group-hover:opacity-100") &&
			reveal.includes("group-focus-within:opacity-100"),
		"the reveal no longer answers to hover AND focus",
	);
	assert.ok(
		!reveal.includes("hidden") && !reveal.includes("visibility"),
		"the reveal hides the control from the focus order",
	);
	assert.ok(
		PANE_CODE.includes('"group flex h-7 shrink-0 items-center rounded-md"'),
		"the row lost the `group` the reveal hangs on",
	);
	/*
	 * LABELS. The act differs by state (a running surface is closed behind a
	 * question, an ended one is dismissed), the tooltip keeps the short sentence,
	 * and the accessible name names the terminal the press would act on - the
	 * browser strip's convention, so two rows are told apart by ear as well as by
	 * eye.
	 */
	assert.ok(
		PANE_CODE.includes(
			'content={row.running ? "Close terminal" : "Dismiss terminal"}',
		),
		"the tooltip no longer follows the row's state",
	);
	assert.ok(
		PANE_CODE.includes(
			'aria-label={`${row.running ? "Close" : "Dismiss"} ${surfaceTitle(row)}, tab ${index + 1} of ${surfaces.length}`}',
		),
		"the accessible name no longer names the state, the terminal and the position",
	);
	/*
	 * THE POSITION IS WHAT MAKES THE NAME UNIQUE (UX round 1, U4): `Close sh` alone
	 * collided for two shells, which is the ordinary strip. Asserted structurally —
	 * the suffix is present for every row, not only for a collision — because a name
	 * that changes with a neighbour's presence is a name a reader cannot rely on.
	 */
	assert.ok(
		PANE_CODE.includes("tab ${index + 1} of ${surfaces.length}"),
		"the accessible name no longer carries the tablist's own position",
	);
});

test("the question withdraws when its subject stops being closeable, and the keyboard is handed on", () => {
	/*
	 * THE WITHDRAWAL'S CONDITION (UX round 1, U2; agent review round 1, F1). It used
	 * to key on the LISTING alone, and an exited row stays listed — so the rule now
	 * also fires when the pending surface stops RUNNING. Asserted at the source, with
	 * the render suite executing both shapes.
	 */
	assert.ok(
		PANE_CODE.includes("if (entry?.running) return;"),
		"the question only withdraws when the row leaves the listing, not when it exits",
	);
	/*
	 * AND THE HANDOFF (UX round 1, U1): the removal drops the keyboard to `<body>`
	 * unless the pane hands it to the lens's row (or the empty state's own control),
	 * so both the record and the write have to be there. The bounded re-check is the
	 * mechanism that makes it land after a dialog's own exit releases the keyboard.
	 */
	assert.ok(
		PANE_CODE.includes("focusAfterRemoval.current = row.surface;") &&
			PANE_CODE.includes("focusAfterRemoval.current = null;") &&
			PANE_CODE.includes("timer = setTimeout(handoff, 25);") &&
			PANE_CODE.includes("target?.focus();"),
		"a removal no longer hands the keyboard to the lens's row",
	);
	/*
	 * AND THE REFUSAL (UX round 1, U3): the rejection is re-read then re-thrown by the
	 * hook, and the pane shows the handler's own clause — the channel's wrapper prefix
	 * is stripped rather than rendered.
	 */
	assert.ok(
		code(SESSION_HOOK).includes("read().then(() => Promise.reject(failure))"),
		"a refused close is swallowed instead of reaching the dialog that asked",
	);
	assert.ok(
		PANE_CODE.includes('lastIndexOf("Error: ")') &&
			PANE_CODE.includes("setCloseRefusal(refusalCopy(failure));"),
		"the refusal is not rendered in the handler's own words",
	);
});

test("the dialog asks the question with the safe answer defaulted, and the pane's own close is untouched", () => {
	const dialog = code(DIALOG);
	/*
	 * THE HOUSE COMPONENT, not a hand-rolled modal: `ConfirmationModal` focuses
	 * CANCEL on open (its own primitive's `onOpenAutoFocus`), so the safe action is
	 * what the keyboard holds and Enter cancels. This file asserts the dialog does
	 * not override that default, which is the property #754's "with confirmation
	 * where destructive" asks for.
	 */
	assert.ok(
		dialog.includes("<ConfirmationModal") &&
			dialog.includes("isDangerous") &&
			dialog.includes("busy={busy}"),
		"the close question is not the shared confirmation modal",
	);
	assert.ok(
		!dialog.includes("onOpenAutoFocus") && !dialog.includes("autoFocus"),
		"the dialog steers initial focus itself rather than keeping the safe default",
	);
	assert.ok(
		dialog.includes('title="Close this terminal?"') &&
			dialog.includes(
				"This ends the program running here and removes its tab.",
			) &&
			dialog.includes('confirmText="Close terminal"'),
		"the question's copy moved away from the contract this change committed",
	);
	/*
	 * THE ROUND-1 ADDITIONS TO THE SAME DIALOG: the retention reassurance is
	 * CONDITIONAL on the row's own retain flag (U6), and the refusal is rendered
	 * inside the dialog that asked, with the keyboard handed back to Cancel (U3).
	 */
	assert.ok(
		dialog.includes("keepsOutput") &&
			dialog.includes("Its output is kept.") &&
			dialog.includes("{refusal !== null ?") &&
			dialog.includes("focusCancelSignal={refusalSeq}"),
		"the refusal or the conditional reassurance left the dialog",
	);
	assert.ok(
		PANE_CODE.includes("keepsOutput={pendingRow?.retain ?? false}") &&
			PANE_CODE.includes("refusal={closeRefusal}") &&
			PANE_CODE.includes("refusalSeq={closeRefusalSeq}"),
		"the pane no longer feeds the dialog the row's own retention and its refusal",
	);
	/*
	 * AND THE PANE'S OWN CLOSE IS STILL THE PANE'S: "Close console" keeps the
	 * slot's own glyph and closes the pane - it never grew a surface flag, which
	 * would have silently turned the pane's exit into a kill (#754's triage calls
	 * this out as the control the user already had).
	 */
	assert.ok(
		PANE_CODE.includes('aria-label="Close console"') &&
			PANE_CODE.includes("onClick={onClose}"),
		"the pane's own close control changed",
	);
});
