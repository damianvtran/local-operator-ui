/**
 * Logger Module
 *
 * This module provides logging functionality for the application.
 * It uses electron-log to save logs to a persistent location.
 */

import { app } from "electron";
import { join } from "node:path";
import electronLog from "electron-log";
import fs from "node:fs";

/**
 * Logger class
 * Manages logging for the application
 */
export class Logger {
	private static instance: Logger;
	private logPath: string;
	private logger: typeof electronLog;

	/**
	 * Private constructor to enforce singleton pattern
	 */
	private constructor() {
		// Set up log path based on platform
		if (process.platform === "win32") {
			this.logPath = join(app.getPath("userData"), "logs");
		} else if (process.platform === "darwin") {
			this.logPath = join(
				app.getPath("home"),
				"Library",
				"Application Support",
				"Local Operator",
				"logs",
			);
		} else {
			// Linux
			this.logPath = join(
				app.getPath("home"),
				".config",
				"local-operator",
				"logs",
			);
		}

		// Ensure log directory exists
		if (!fs.existsSync(this.logPath)) {
			fs.mkdirSync(this.logPath, { recursive: true });
		}

		// Configure electron-log
		this.logger = electronLog;

		// Set log file path
		this.logger.transports.file.resolvePath = () =>
			join(this.logPath, "backend-installer.log");

		// Configure log level and format
		this.logger.transports.file.level = "debug";
		this.logger.transports.file.format =
			"[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

		// Set max log file size (10MB) and keep last 5 log files
		this.logger.transports.file.maxSize = 10 * 1024 * 1024;

		// Also log to console in development mode
		if (process.env.NODE_ENV === "development") {
			this.logger.transports.console.level = "debug";
		} else {
			this.logger.transports.console.level = "info";
		}

		this.logger.info("Logger initialized");
		this.logger.info(`Log path: ${this.logPath}`);
	}

	/**
	 * Get the singleton instance of the Logger
	 * @returns The Logger instance
	 */
	public static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	/**
	 * Log an info message
	 * @param message The message to log
	 * @param optionalParams Optional parameters to log
	 */
	public info(message: string, ...optionalParams: unknown[]): void {
		this.logger.info(message, ...optionalParams);
	}

	/**
	 * Log a warning message
	 * @param message The message to log
	 * @param optionalParams Optional parameters to log
	 */
	public warn(message: string, ...optionalParams: unknown[]): void {
		this.logger.warn(message, ...optionalParams);
	}

	/**
	 * Log an error message
	 * @param message The message to log
	 * @param optionalParams Optional parameters to log
	 */
	public error(message: string, ...optionalParams: unknown[]): void {
		this.logger.error(message, ...optionalParams);
	}

	/**
	 * Log a debug message
	 * @param message The message to log
	 * @param optionalParams Optional parameters to log
	 */
	public debug(message: string, ...optionalParams: unknown[]): void {
		this.logger.debug(message, ...optionalParams);
	}

	/**
	 * Log an exception
	 * @param error The error to log
	 * @param context Optional context information
	 */
	public exception(error: Error, context?: string): void {
		if (context) {
			this.logger.error(`[${context}] ${error.message}`);
			this.logger.error(error.stack);
		} else {
			this.logger.error(error.message);
			this.logger.error(error.stack);
		}
	}

	/**
	 * Get the log path
	 * @returns The path to the log directory
	 */
	public getLogPath(): string {
		return this.logPath;
	}
}

// Export a default logger instance
export const logger = Logger.getInstance();
