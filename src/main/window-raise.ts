/**
 * The only place in the main process that raises or focuses a window.
 *
 * Why it is its own module. `ready-to-show` used to call `show()`
 * unconditionally, so every agent-driven launch activated the app and took the
 * operator's keyboard focus. The fix is a gate, and a gate is only worth
 * anything if it is the ONLY way through: a single stray `window.show()`
 * re-breaks the operator's focus, and — measured on Electron 35.5.1 / macOS —
 * `focusable: false` does not save you. `NativeWindowMac::Show()` calls
 * `activateIgnoringOtherApps:YES` for every non-panel window whatever
 * `focusable` says, so a non-focusable window that is shown still makes the app
 * frontmost while `isFocused()` keeps reading false. The policy therefore has
 * to live at the call sites, and every call site is in this file.
 *
 * `scripts/window-mode.test.mjs` asserts both halves: that this module applies
 * the policy correctly (with a fake window, per mode) and that no other file
 * under `src/main/` calls `show`, `showInactive` or `focus` on a window.
 *
 * The parameter type is the slice of `BrowserWindow` a raise touches, so the
 * policy is testable in process without Electron — the same reason
 * `window-mode.ts` imports nothing from Electron either.
 */

import type { WindowShow } from "./window-mode";

/** The slice of `BrowserWindow` that raising a window touches. */
export interface RaisableWindow {
	show(): void;
	showInactive(): void;
	focus(): void;
	isMinimized(): boolean;
	restore(): void;
}

/**
 * What `ready-to-show` does: bring the window up the way the launch plan
 * allows.
 *
 * `normal` and the released app are the same call — `show()`, which focuses the
 * window on every platform. It deliberately does NOT add an explicit `focus()`:
 * that is not what shipped, and the point of `normal` is that nothing about a
 * person's launch changed.
 */
export function presentWindow(window: RaisableWindow, show: WindowShow): void {
	if (show === "never") return;
	if (window.isMinimized()) window.restore();
	if (show === "inactive") window.showInactive();
	else window.show();
}

/**
 * What a second launch or a clicked notification banner asks for: bring this
 * window to the operator.
 *
 * In `normal` this is one `show()` more than the pre-change second-instance
 * path made, which restored and focused only. That is deliberate rather than
 * indistinguishable: the app HAS a hide path (`{ role: "hide" }`, Cmd+H), so
 * after the operator hides the window a second launch or a banner click now
 * brings it back instead of focusing it while it stays hidden — which is what
 * asking for the window means. The uniform sequence is the point: one function
 * decides, so a mode cannot be half-applied at one call site and not the other.
 *
 * It ends focused only in `normal`. `inactive` orders the window without
 * activating the app, and `headless` does nothing here at all — the caller
 * still delivers the conversation to the renderer, so the window holds the
 * right screen while staying off screen, which is what the mode promises. If
 * this path could raise a headless window, a notification click during a QA run
 * would be the one thing that interrupts the operator.
 */
export function raiseWindow(window: RaisableWindow, show: WindowShow): void {
	if (show === "never") return;
	if (window.isMinimized()) window.restore();
	if (show === "inactive") {
		window.showInactive();
		return;
	}
	window.show();
	window.focus();
}
