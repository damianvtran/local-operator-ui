import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { LogFileType, logger } from "./backend/logger";

/**
 * Type definition for store data
 */
export type StoreData = {
	radient_jwt: string;
	radient_jwt_expiry: number;
	// OAuth related fields
	oauth_provider?: "google" | "microsoft";
	oauth_access_token?: string;
	oauth_id_token?: string;
	oauth_expiry?: number;
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

		// Initialize with defaults
		this.data = { ...this.defaults };

		try {
			this.load();
		} catch (error) {
			logger.error(
				`Failed to load store from ${this.path}. Using defaults.`,
				LogFileType.BACKEND,
				error,
			);
			// If loading fails, save the defaults
			this.save();
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
