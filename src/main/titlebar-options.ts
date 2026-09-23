import type { BrowserWindowConstructorOptions } from "electron";

/**
 * Native titlebar configuration for the main app window.
 *
 * Keep this decision pure so the platform matrix can be exercised on any CI
 * host. Only macOS hides its titlebar: Electron leaves the native traffic lights
 * and their OS-managed hit targets intact, so the renderer never draws substitute
 * controls. Windows and Linux keep their already-tested native frame and palette.
 */
export function titlebarOptions(
	platform: NodeJS.Platform,
): Pick<BrowserWindowConstructorOptions, "titleBarStyle"> {
	return platform === "darwin" ? { titleBarStyle: "hidden" } : {};
}
