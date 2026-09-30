import { type BrowserWindow, ipcMain } from "electron";
import { isCompanionSettingsChange } from "../shared/companion-settings";
import type { DesktopCompanion } from "./desktop-companion";
import { trustedDesktopFrame } from "./desktop-transport";

export function registerCompanionSettings(
	getWindow: () => BrowserWindow | null,
	rendererUrl: string,
	companion: DesktopCompanion,
): () => void {
	const channels = [
		"companion-settings:get",
		"companion-settings:update",
		"companion-settings:import",
	];
	for (const channel of channels) {
		ipcMain.handle(channel, async (event, change: unknown) => {
			const window = getWindow();
			if (
				!window ||
				window.isDestroyed() ||
				event.sender !== window.webContents ||
				event.senderFrame !== window.webContents.mainFrame ||
				!trustedDesktopFrame(event.senderFrame?.url ?? "", rendererUrl)
			) {
				throw new Error("This window cannot change companion settings.");
			}
			if (channel === "companion-settings:update") {
				if (!isCompanionSettingsChange(change))
					throw new Error("Invalid companion settings.");
				companion.updateSettings(change);
			} else if (channel === "companion-settings:import") {
				await companion.chooseCharacter();
			}
			return companion.settings;
		});
	}
	return () => {
		for (const channel of channels) ipcMain.removeHandler(channel);
	};
}
