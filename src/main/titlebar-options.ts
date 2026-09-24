import type { BrowserWindowConstructorOptions } from "electron";

/*
 * The macOS traffic lights' vertical offset, in CSS pixels from the window's
 * top-left, and why it is 13 rather than the platform default.
 *
 * The value is the DRAWN circle's top-left, not its 16px hit frame's - measured
 * on this repo's own Electron 44.3.0 by moving the lights on a standalone
 * BrowserWindow and photographing the window with `screencapture -l`: passing
 * nothing draws circles spanning y 9.0-22.5 (a centre of 15.75, i.e. the default
 * behaves as y 9), and passing `{ x: 8, y: 12 }` - through this option or through
 * `win.setWindowButtonPosition()` at runtime, which agree - draws y 12.0-25.5.
 * The circles are 13.5px, so `y: 13` lands their centre on 19.75.
 *
 * That 19.75 is aimed at the shell's own top band: the rail header, the
 * sidebar's heading block and the conversation header share one 40px band whose
 * content centre is 20 (see `chat-header.tsx`, `chat-sidebar.tsx` and
 * `sidebar-navigation.tsx`). At the default the lights sat on 15.75 - four
 * pixels above the brand mark beside them - which is the displacement the
 * operator reported as the logo and wordmark looking wrong against them. The
 * 0.25px that remains is the half-pixel a 2x display can address; passing
 * `13.25` is not worth the fractional value.
 *
 * `x` is restated at the platform default rather than left out, so the pair
 * reads as one position. It is deliberately NOT changed: passing `x: 8` was
 * measured to shift the whole cluster 1px left, which would move the lane's
 * left edge with it, and the renderer's 80px lane is sized to the lights where
 * they already are (`styles/index.css`).
 */
const MAC_TRAFFIC_LIGHT_POSITION = { x: 9, y: 13 } as const;

/**
 * Native titlebar configuration for the main app window.
 *
 * Keep this decision pure so the platform matrix can be exercised on any CI
 * host. Only macOS hides its titlebar: Electron leaves the native traffic lights
 * and their OS-managed hit targets intact, so the renderer never draws substitute
 * controls. Windows and Linux keep their already-tested native frame and palette,
 * and this function must hand them back the SAME empty object it always has -
 * `trafficLightPosition` is a macOS-only option and naming it for another
 * platform is a native-chrome change this branch has no business making.
 */
export function titlebarOptions(
	platform: NodeJS.Platform,
): Pick<
	BrowserWindowConstructorOptions,
	"titleBarStyle" | "trafficLightPosition"
> {
	return platform === "darwin"
		? {
				titleBarStyle: "hidden",
				trafficLightPosition: { ...MAC_TRAFFIC_LIGHT_POSITION },
			}
		: {};
}
