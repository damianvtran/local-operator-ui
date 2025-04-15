import { app, ipcMain } from "electron";
import { logger } from "../backend/logger";
import { LogFileType } from "../backend/logger";

/**
 * Registers all system-related IPC handlers
 */
export function registerSystemHandlers(): void {
	// Handler for getting the application version
	ipcMain.handle("get-app-version", () => {
		return app.getVersion();
	});

	// Handler for getting platform information
	ipcMain.handle("get-platform-info", () => {
		return {
			platform: process.platform,
			arch: process.arch,
			nodeVersion: process.versions.node,
			electronVersion: process.versions.electron,
			chromeVersion: process.versions.chrome,
		};
	});
}
