import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { LogFileType, logger } from "./backend/logger";

/**
 * Type definition for store data
 */
export type StoreData = {
	// Radient token fields
	radient_access_token?: string;
	radient_refresh_token?: string;
	radient_token_expiry?: number;

	// OAuth fields
	oauth_provider?: "google" | "microsoft";
	oauth_access_token?: string;
	oauth_id_token?: string;
	oauth_expiry?: number;

	// Global hotkey
	global_hotkey?: string;
};

/**
 * Custom store implementation to replace electron-store
 * Provides a simple, type-safe persistent storage solution
 */
export class Store<T extends Record<string, unknown>> {
	private data: T;
	private readonly path: string;
	private readonly defaults: T;

	/**
	 * Creates a new Store instance
	 * @param options Configuration options for the store
	 * @param options.name Name of the store file (without extension)
	 * @param options.defaults Default values for the store
	 */
	constructor(options: { name?: string; defaults: T }) {
		const storeName = options.name || "config";
		this.defaults = options.defaults;

		// Get the appropriate app directory for storage
		const userDataPath = app.getPath("userData");
		this.path = path.join(userDataPath, `${storeName}-lo-store.json`);

		// Initialize with defaults first
		this.data = { ...this.defaults };

		try {
			this.load();
		} catch (loadError) {
			// Check if the error is a JSON parsing error (indicative of corruption)
			if (loadError instanceof SyntaxError) {
				logger.warn(
					`Detected corrupted store file (JSON parse error) at ${this.path}. Attempting recovery...`,
					LogFileType.BACKEND,
					loadError,
				);
				try {
					// Delete the corrupted file
					if (fs.existsSync(this.path)) {
						logger.info(
							`Deleting corrupted store file: ${this.path}`,
							LogFileType.BACKEND,
						);
						fs.unlinkSync(this.path);
					}
					// Reset data to defaults (already done above, but explicit here for clarity)
					this.data = { ...this.defaults };
					// Save the defaults to create a clean file
					this.save();
					logger.info(
						"Store recovered by deleting corrupted file and resetting to defaults.",
						LogFileType.BACKEND,
					);
				} catch (recoveryError) {
					logger.error(
						`Failed to recover store after corruption at ${this.path}. Data loss may occur.`,
						LogFileType.BACKEND,
						recoveryError,
					);
					// Continue with defaults in memory, but log the critical failure
					// Re-throw the recovery error to signal a critical initialization problem
					throw new Error(
						`Failed to recover corrupted store file: ${
							recoveryError instanceof Error
								? recoveryError.message
								: recoveryError
						}`,
					);
				}
			} else {
				// For other load errors (e.g., permissions), log and use defaults, but don't delete
				logger.error(
					`Failed to load store from ${this.path} due to non-parsing error. Using defaults.`,
					LogFileType.BACKEND,
					loadError,
				);
				// Ensure defaults are saved if loading failed for other reasons
				this.save();
				// Re-throw the original error to signal a potential issue
				throw loadError;
			}
		}
	}

	/**
	 * Load data from the store file
	 */
	private load(): void {
		if (fs.existsSync(this.path)) {
			try {
				const fileContents = fs.readFileSync(this.path, "utf8");
				const parsedData = JSON.parse(fileContents);
				// Merge with defaults to ensure all required fields exist
				this.data = { ...this.defaults, ...parsedData };
			} catch (error) {
				logger.error(
					`Error parsing store file ${this.path}`,
					LogFileType.BACKEND,
					error,
				);
				throw error;
			}
		} else {
			// File doesn't exist, use defaults
			this.data = { ...this.defaults };
		}
	}

	/**
	 * Save current data to the store file
	 */
	private save(): void {
		try {
			// Ensure the directory exists
			const dirname = path.dirname(this.path);
			if (!fs.existsSync(dirname)) {
				fs.mkdirSync(dirname, { recursive: true });
			}

			// Write data to file
			fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf8");
		} catch (error) {
			logger.error(
				`Failed to save store to ${this.path}`,
				LogFileType.BACKEND,
				error,
			);
			throw error;
		}
	}

	/**
	 * Get a value from the store
	 * @param key The key to retrieve
	 * @returns The value for the key, or undefined if not found
	 */
	get<K extends keyof T>(key: K): T[K] {
		return this.data[key];
	}

	/**
	 * Set a value in the store
	 * @param key The key to set
	 * @param value The value to store
	 */
	set<K extends keyof T>(key: K, value: T[K]): void {
		this.data[key] = value;
		this.save();
	}

	/**
	 * Delete a key from the store
	 * @param key The key to delete
	 */
	delete<K extends keyof T>(key: K): void {
		delete this.data[key];
		this.save();
	}

	/**
	 * Clear the store and reset to defaults
	 */
	clear(): void {
		this.data = { ...this.defaults };
		this.save();
	}

	/**
	 * Get all data from the store
	 * @returns All store data
	 */
	getAll(): T {
		return { ...this.data };
	}
}
