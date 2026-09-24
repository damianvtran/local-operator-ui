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
 * centre on a 40px band, which needed the circles' centre pulled down to 20 (it
 * reads 16.00 at the default - see the instrument note below). That decision is withdrawn - on macOS the
 * renderer gives the OS controls their own 32px lane and puts the brand BELOW it
 * (`sidebar-navigation.tsx`, `data-titlebar-lane`), so nothing shares a centre
 * with the lights any more.
 *
 * The lane's height is derived from the OS frame itself rather than chosen: their
 * hit frames are 16px tall at y 8, so 8 above + 16 + one 8px step below = 32, and
 * its centre is 16. At the platform default the drawn circles measure that same
 * centre: a `screencapture -l` window capture reads them spanning y 9.00-23.00
 * (Ø 14.00, centre 16.00). That capture is the ONLY instrument that can see them -
 * `Page.captureScreenshot` photographs the renderer alone, so no frame this app
 * can take contains the traffic lights - and the pixel scan over it cannot resolve
 * a circle either (its x-run for one circle reads 10.00 against a height of
 * 14.00), which is why an earlier round's "Ø 13.5, centre 15.75" is withdrawn: it
 * was derived from a spec figure rather than measured, and it claims a half-pixel
 * precision the instrument does not have. Nothing depends on the difference -
 * nothing shares a centre with the lights, which is the point of revision 2. A
 * `trafficLightPosition` here would therefore be native chrome moved for nothing.
 * So: not set, and do not re-derive it. `x` was never moved.
 */
export function titlebarOptions(
	platform: NodeJS.Platform,
): Pick<BrowserWindowConstructorOptions, "titleBarStyle"> {
	return platform === "darwin" ? { titleBarStyle: "hidden" } : {};
}
