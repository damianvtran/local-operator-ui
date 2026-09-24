import type { BrowserWindowConstructorOptions } from "electron";

/**
 * Native titlebar configuration for the main app window.
 *
 * Keep this decision pure so the platform matrix can be exercised on any CI
 * host. Only macOS hides its titlebar: Electron leaves the native traffic lights
 * and their OS-managed hit targets intact, so the renderer never draws substitute
 * controls. Windows and Linux keep their already-tested native frame and palette.
 *
 * WHY THE LIGHTS KEEP THE PLATFORM DEFAULT (top-bar redesign, revision 2).
 * This function briefly moved them: `trafficLightPosition: { x: 9, y: 13 }` was
 * derived from a decision to put the brand mark BESIDE them, sharing one content
 * centre on a 40px band, which needed the circles' centre (a measured 15.75 at
 * the default) pulled down to 20. That decision is withdrawn - on macOS the
 * renderer gives the OS controls their own 32px lane and puts the brand BELOW it
 * (`sidebar-navigation.tsx`, `data-titlebar-lane`), so nothing shares a centre
 * with the lights any more.
 *
 * The lane's height is derived from the OS frame itself rather than chosen: their
 * hit frames are 16px tall at y 8, so 8 above + 16 + one 8px step below = 32, and
 * its centre is 16. At the platform default the drawn circles (Ø 13.5) span
 * y 9.0-22.5 - centre 15.75, i.e. on the lane's centre to within the half-pixel a
 * 2x display can address. A `trafficLightPosition` here would therefore be native
 * chrome moved for nothing, and it was the one item in this redesign that no
 * renderer frame could show at all (`Page.captureScreenshot` photographs the
 * renderer only). So: not set, and do not re-derive it. `x` was never moved.
 */
export function titlebarOptions(
	platform: NodeJS.Platform,
): Pick<BrowserWindowConstructorOptions, "titleBarStyle"> {
	return platform === "darwin" ? { titleBarStyle: "hidden" } : {};
}
