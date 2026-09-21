import {
	TERMINAL_FONT_SIZE,
	applyCaptureTheme,
	measureCell,
	terminalFontFamily,
} from "@shared/themes/terminal-theme";
import { type FC, useEffect, useState } from "react";
import { ConsoleMirror } from "./console-mirror";

/**
 * The capture view: one surface's record, reconstructed in a renderer nobody is
 * looking at, for `console_screenshot` (design 13.2's second and third rows, 13.3).
 *
 * IT IS THE SAME COMPONENT AS THE PANE, which is the design's point rather than a
 * convenience: "the capture view is the same page as the pane (one component), so
 * the two paths cannot drift in font, theme or renderer". What this file adds is
 * only the four things a photographed reconstruction needs that an interactive
 * pane does not:
 *
 *  1. it is FED rather than subscribed (§13.2/13.3: main sends the retained bytes,
 *     because a capture renderer is not an authorized console client);
 *  2. it ANSWERS THE MEASUREMENT, because main needs the cell's pixel size to size
 *     the window before the bytes arrive and has no way to measure a font;
 *  3. it REPORTS SETTLED, so main photographs a painted frame rather than a guess
 *     (`requestAnimationFrame` twice: one frame is the DOM mutation, the second is
 *     the paint that contains it);
 *  4. it REPORTS WHICH RENDERER PAINTED, asserted from the DOM rather than assumed,
 *     because a silent switch to the canvas renderer is the one measured case where
 *     an offscreen frame is blank — and a blank frame is exactly what a capture
 *     retry would hide.
 *
 * NOTHING HERE IS INTERACTIVE: no caret blink (a blinking cursor would make the
 * frame a function of when it was taken), no input forwarding, no resize reports.
 * The grid comes from the feed and the window is sized to it.
 */

interface CaptureFeed {
	nonce: number;
	surface: string;
	cols: number;
	rows: number;
	theme: string | null;
	bytes_base64: string;
}

const decodeBytes = (base64: string): Uint8Array => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
};

export const ConsoleCapture: FC = () => {
	const [feed, setFeed] = useState<CaptureFeed | null>(null);

	useEffect(() => {
		const bridge = window.api?.desktopCapture;
		if (!bridge) return;
		const offMeasure = bridge.onMeasure(() => {
			// Answered with the SAME measurement the pane reports to main, so the
			// reconstruction's cell and the grid arithmetic agree by construction.
			bridge.measured(measureCell(terminalFontFamily(), TERMINAL_FONT_SIZE));
		});
		const offFeed = bridge.onFeed((payload) => {
			if (
				typeof payload?.bytes_base64 !== "string" ||
				typeof payload?.cols !== "number" ||
				typeof payload?.rows !== "number"
			)
				return;
			setFeed({
				nonce: typeof payload.nonce === "number" ? payload.nonce : 0,
				surface: typeof payload.surface === "string" ? payload.surface : "",
				cols: payload.cols,
				rows: payload.rows,
				theme: typeof payload.theme === "string" ? payload.theme : null,
				bytes_base64: payload.bytes_base64,
			});
		});
		return () => {
			offMeasure();
			offFeed();
		};
	}, []);

	/*
	 * The theme is pinned per feed rather than read from a preference: the frame is
	 * a function of `(bytes, grid, theme, font, renderer)` and the theme is one of
	 * its arguments (§13.3). Main sends the theme the pane last reported, so a
	 * reconstruction matches what the user was looking at.
	 */
	useEffect(() => {
		/*
		 * THE DECISION IS `applyCaptureTheme`'s, in the module that owns theme resolution,
		 * and Q-8 is why it is a function rather than three lines here: an ABSENT theme and
		 * an EMPTY one used to take the same early return, so `theme: ""` painted xterm's
		 * own frame with nothing in the log while every other unknown name was loud. The
		 * distinction is tested where it lives (`terminal-theme`), not here.
		 */
		applyCaptureTheme(feed?.theme);
	}, [feed?.theme]);

	if (!feed) return null;

	return (
		/*
		 * `key` ON THE NONCE, so a retry starts from a fresh terminal: main re-feeds
		 * the same record when a frame comes back blank, and a mirror that appended
		 * the second copy to the first would photograph a two-line-longer log.
		 */
		<ConsoleMirror
			key={feed.nonce}
			surface={feed.surface}
			visible={true}
			cols={feed.cols}
			rows={feed.rows}
			mode="capture"
			bytes={decodeBytes(feed.bytes_base64)}
			onSettled={() => {
				// Two frames: the first contains the DOM the write produced, the second
				// the paint that contains it. Then the renderer is read off the DOM.
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						const painted = document.querySelector(".xterm-screen canvas");
						window.api?.desktopCapture?.settled({
							renderer: painted ? "canvas" : "dom",
						});
					}),
				);
			}}
		/>
	);
};
