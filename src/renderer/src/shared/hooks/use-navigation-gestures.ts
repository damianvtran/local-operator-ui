/**
 * The app's navigation gestures, mounted for the whole session (issue #675).
 *
 * A `keydown` and a `mouseup` listener on `window`, non-capturing, both feeding
 * the pure decisions in `@shared/navigation-gesture` and moving the router by
 * one entry. The window-level registration is the point rather than a
 * formality: it is what makes the ordering rule in that module's docblock work,
 * so a run-details reader or a CodeMirror buffer that has already claimed the
 * gesture keeps it (they run as the event bubbles; this listener runs last).
 *
 * WHAT THIS HALF CANNOT REACH, and why there is a second owner. The driven
 * browser pane is a `WebContentsView` with its own webContents, so while it
 * holds focus the app's DOM never sees the keystroke or the click — main wires
 * those in `src/main/browser/index.ts` (`before-input-event` on each view) and
 * answers them with the pane's own history. ONE owner per gesture per surface,
 * and no double-handling: an event that lands here by definition did not land
 * in a driven page, and vice versa.
 *
 * `preventDefault` on a match: the app's own prefixed gestures must not also
 * reach whatever has focus while the route moves under it — the same rule the
 * palette's listener states for Cmd/Ctrl+K.
 */

import {
	navigationChordDirection,
	navigationMouseDirection,
} from "@shared/navigation-gesture";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function useNavigationGestures(): void {
	const navigate = useNavigate();

	useEffect(() => {
		const step = (direction: "back" | "forward") => {
			// +1 walks the hash-router history forward, -1 back — the same
			// movement the nav rail performs by pushing a path, in reverse.
			navigate(direction === "back" ? -1 : 1);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			const direction = navigationChordDirection(event);
			if (!direction) return;
			event.preventDefault();
			step(direction);
		};
		const onMouseUp = (event: MouseEvent) => {
			const direction = navigationMouseDirection(event);
			if (!direction) return;
			event.preventDefault();
			step(direction);
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, [navigate]);
}
