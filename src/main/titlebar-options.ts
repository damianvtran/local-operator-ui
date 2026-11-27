import type { BrowserWindowConstructorOptions } from "electron";
import {
	WINDOW_CHROME_HEIGHT,
	WINDOW_CHROME_TRANSPARENT,
	type WindowChromeColors,
	type WindowChromeMode,
	chromePlatformFor,
} from "../shared/window-chrome";

/**
 * Native titlebar configuration for the main app window.
 *
 * Keep this decision pure so the platform matrix can be exercised on any CI
 * host. On macOS the app hides Electron's title bar and keeps its traffic lights
 * (`hidden` leaves them and their OS-managed hit targets intact, so the renderer
 * never draws substitute controls) - that half is unchanged from #462/#477. On
 * Windows and Linux the same `hidden` style now comes WITH a `titleBarOverlay`,
 * because those two platforms have nothing outside the client area to leave: the
 * caption buttons are Electron's own views, drawn into the client area, and are
 * enabled by the overlay's presence and by nothing else. `hidden` without an
 * overlay there is a window with no way to close, minimize or maximize it, which
 * is the shape a public bug report describes and which `titlebar-options.test.mjs`
 * makes unreachable over every input.
 *
 * The native fallback (`mode: "native"`) returns the pre-redesign answer on every
 * platform: the OS draws the whole frame.
 *
 * macOS keeps the real traffic lights, now centered in the shared 40px
 * window-control row. The earlier 32px strip had no renderer controls beside
 * them; moving them then bought nothing. With navigation on the same row,
 * `{ x: 12, y: 12 }` gives the native 16px hit boxes space above and below.
 * The renderer reserves the physical left corner independently of text direction.
 * CapturePage shows only the renderer, not the native traffic lights.
 *
 * WHY WINDOWS' OVERLAY COLOUR IS FULLY TRANSPARENT AND LINUX' IS NOT. The ground
 * under Windows' top-right corner is not one colour - `canvas` under the chat
 * header, `sunken` under a pane toolbar, a banner's own wash while one is up. With
 * alpha 0 the button container is non-opaque and each button skips its background
 * fill (`win_caption_button.cc`), so the controls always sit on whatever the app
 * painted, with no IPC round trip and therefore no frame where the box lags a pane
 * opening. Linux forces the overlay colour opaque before it draws the icons
 * (`electron_frame_view_linux.cc`), so a transparent value there renders the
 * glyphs against black: it takes the ground the renderer reports.
 */
export type TitlebarOptionsInput = {
	mode: WindowChromeMode;
	colors: WindowChromeColors;
};

export function titlebarOptions(
	platform: NodeJS.Platform | string,
	chrome: TitlebarOptionsInput,
): Pick<
	BrowserWindowConstructorOptions,
	"titleBarStyle" | "titleBarOverlay" | "trafficLightPosition"
> {
	/* macOS supplies its own controls, not WCO. Its renderer exclusions are
	 * fixed; full screen clears them through the main-process chrome facts. */
	if (platform === "darwin") {
		return { titleBarStyle: "hidden", trafficLightPosition: { x: 12, y: 12 } };
	}

	/*
	 * ANYTHING THAT IS NOT darwin, win32 OR linux KEEPS THE FRAME IT HAS ALWAYS HAD.
	 *
	 * The check is on the REAL platform rather than on the three-value CSS
	 * vocabulary, because the two questions are different: the CSS has to pick one of
	 * three branches (an unknown unix is not a Mac, so it takes the Linux rules) while
	 * the FRAME is a platform capability - `titleBarOverlay` and the WCO frame view
	 * exist on the three platforms this app ships for, and there is no code path on a
	 * BSD to draw the buttons. Guessing `hidden` there is the shape that loses every
	 * window control, with no test able to see it on a machine we own.
	 */
	if (platform !== "win32" && platform !== "linux") {
		return {};
	}
	if (chrome.mode === "native") return {};

	const chromePlatform = chromePlatformFor(platform);

	return {
		titleBarStyle: "hidden",
		titleBarOverlay: {
			color:
				chromePlatform === "win"
					? /* Transparent: the app's own ground shows through. See the docblock. */
						WINDOW_CHROME_TRANSPARENT
					: /* Opaque reported ground: Linux forces alpha to ff, so a transparent
						 value would paint the glyphs on black. The renderer reports the
						 resolved ground of the element owning the controls' corner and main
						 re-applies it with `setTitleBarOverlay`; this is the value for the
						 first frame, before any report has arrived, which is why it is the
						 palette's `canvas` rather than a guessed pane ground. */
						chrome.colors.ground,
			symbolColor: chrome.colors.symbol,
			/*
			 * 40 is the app's own toolbar step, so the caption buttons are exactly as
			 * tall as the row they end: the chat header, every pane toolbar and the
			 * sidebar's brand row are all `h-10`. It sits inside Microsoft's 32-48
			 * range. `height` is an integer; a fractional one is rejected.
			 */
			height: WINDOW_CHROME_HEIGHT,
		},
	};
}
