import type { BrowserWindow } from "electron";
import type { BackendServiceManager } from "../backend/backend-service";
import { logger } from "../backend/logger";
import { LogFileType } from "../backend/logger";
import type { UpdateService } from "../update-service";
import { registerFileHandlers } from "./file-handlers";
import { registerSystemHandlers } from "./system-handlers";
import { registerUpdateHandlers } from "./update-handlers";

/**
 * Registers all IPC handlers for the application
 * @param mainWindow The main browser window
 * @param backendService The backend service manager (if needed by any handlers)
 * @param updateService The update service (if needed by any handlers)
 */
export function registerIpcHandlers({
	updateService,
}: {
	mainWindow: BrowserWindow;
	backendService?: BackendServiceManager;
	updateService?: UpdateService;
}): void {
	try {
		logger.info("Registering IPC handlers", LogFileType.BACKEND);

		// Register file-related handlers
		registerFileHandlers();

		// Register system-related handlers
		registerSystemHandlers();

		// Register update-related handlers if updateService is provided
		if (updateService) {
			registerUpdateHandlers(updateService);
		}

		// Additional handler categories can be registered here

		logger.info(
			"All IPC handlers registered successfully",
			LogFileType.BACKEND,
		);
	} catch (error) {
		logger.error("Error registering IPC handlers:", LogFileType.BACKEND, error);
	}
}
