import { ipcMain } from "electron";
import { logger } from "../backend/logger";
import { LogFileType } from "../backend/logger";
import type { UpdateService } from "../update-service";

/**
 * Registers all update-related IPC handlers
 * @param updateService The update service instance
 */
export function registerUpdateHandlers(updateService: UpdateService): void {
	// Check for UI updates
	ipcMain.handle("check-for-updates", async () => {
		logger.info("Checking for UI updates...", LogFileType.UPDATE_SERVICE);
		try {
			return await updateService.checkForUpdates();
		} catch (error) {
			logger.error(
				"Error checking for UI updates:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			throw error;
		}
	});

	// Check for backend updates
	ipcMain.handle("check-for-backend-updates", async () => {
		logger.info("Checking for backend updates...", LogFileType.UPDATE_SERVICE);
		try {
			return await updateService.checkForBackendUpdates();
		} catch (error) {
			logger.error(
				"Error checking for backend updates:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			throw error;
		}
	});

	// Check for all updates (UI and backend)
	ipcMain.handle("check-for-all-updates", async () => {
		logger.info(
			"Checking for all updates (UI and backend)...",
			LogFileType.UPDATE_SERVICE,
		);
		try {
			return await updateService.checkForAllUpdates();
		} catch (error) {
			logger.error(
				"Error checking for all updates:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			throw error;
		}
	});

	// Update backend
	ipcMain.handle("update-backend", async () => {
		logger.info("Updating backend...", LogFileType.UPDATE_SERVICE);
		try {
			return await updateService.updateBackend();
		} catch (error) {
			logger.error(
				"Error updating backend:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			throw error;
		}
	});

	// Download update
	ipcMain.handle("download-update", async () => {
		logger.info("Downloading update...", LogFileType.UPDATE_SERVICE);
		try {
			// Use autoUpdater directly through the UpdateService
			return await require("electron-updater").autoUpdater.downloadUpdate();
		} catch (error) {
			logger.error(
				"Error downloading update:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			throw error;
		}
	});

	// Quit and install update
	ipcMain.handle("quit-and-install", () => {
		logger.info(
			"Quitting and installing update...",
			LogFileType.UPDATE_SERVICE,
		);
		// Use the quitAndInstall method from UpdateService
		updateService.quitAndInstall();
	});
}
