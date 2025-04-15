import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { ipcMain, shell } from "electron";
import { logger } from "../backend/logger";
import { LogFileType } from "../backend/logger";

export type ReadFileResponse =
	| { success: true; data: string }
	| { success: false; error: unknown }; // or use `string` if you always send error.message

export type FileInfo = {
	name: string;
	path: string;
	isDirectory: boolean;
	extension: string;
	size: number;
	lastModified: number;
};

export type ListDirectoryResponse =
	| { success: true; files: FileInfo[] }
	| { success: false; error: unknown };

/**
 * Registers all file-related IPC handlers
 */
export function registerFileHandlers(): void {
	// Handler for listing directory contents
	ipcMain.handle(
		"list-directory",
		async (_, dirPath: string): Promise<ListDirectoryResponse> => {
			try {
				const files = readdirSync(dirPath);
				const fileInfos: FileInfo[] = files.map((file) => {
					const fullPath = join(dirPath, file);
					const stats = statSync(fullPath);
					return {
						name: file,
						path: fullPath,
						isDirectory: stats.isDirectory(),
						extension: extname(file).toLowerCase(),
						size: stats.size,
						lastModified: stats.mtimeMs,
					};
				});
				return { success: true, files: fileInfos };
			} catch (error) {
				logger.error("Error listing directory:", LogFileType.BACKEND, error);
				return { success: false, error };
			}
		},
	);

	// Handler for opening files with the default application
	ipcMain.handle("open-file", async (_, filePath) => {
		try {
			await shell.openPath(filePath);
		} catch (error) {
			logger.error("Error opening file:", LogFileType.BACKEND, error);
		}
	});

	// Handler for reading file contents
	ipcMain.handle(
		"read-file",
		async (_, filePath: string): Promise<ReadFileResponse> => {
			try {
				const data = readFileSync(filePath, "utf-8");
				return { success: true, data };
			} catch (error) {
				logger.error("Error reading file:", LogFileType.BACKEND, error);
				return { success: false, error };
			}
		},
	);

	// Handler for opening external URLs
	ipcMain.handle("open-external", async (_, url) => {
		try {
			await shell.openExternal(url);
		} catch (error) {
			logger.error("Error opening URL:", LogFileType.BACKEND, error);
		}
	});

	// Handler for getting the parent directory of a file
	ipcMain.handle(
		"get-parent-directory",
		async (
			_,
			filePath: string,
		): Promise<{ success: boolean; directory?: string; error?: unknown }> => {
			try {
				// Normalize the path
				const normalizedPath = filePath.startsWith("file://")
					? filePath.substring(7)
					: filePath;

				// Check if the path exists
				if (!existsSync(normalizedPath)) {
					return { success: false, error: "File does not exist" };
				}

				// Get the parent directory
				const parentDir = dirname(normalizedPath);
				return { success: true, directory: parentDir };
			} catch (error) {
				logger.error(
					"Error getting parent directory:",
					LogFileType.BACKEND,
					error,
				);
				return { success: false, error };
			}
		},
	);
}
