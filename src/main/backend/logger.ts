/**
 * Logger Module
 *
 * This module provides logging functionality for the application.
 * It uses electron-log to save logs to a persistent location.
 * Supports multiple log files for different components of the application.
 */

import fs from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import electronLog, { type ElectronLog } from "electron-log";

/**
 * Log file types
 */
export enum LogFileType {
	INSTALLER = "backend-installer.log",
	BACKEND = "backend-service.log",
}

/**
 * Logger class
 * Manages logging for the application
 */
export class Logger {
	private static instance: Logger;
	private logPath: string;
	private loggers: Map<LogFileType, ElectronLog>;

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

		// Initialize loggers map
		this.loggers = new Map();

		// Create and configure loggers for each log file type
		for (const logFileType of Object.values(LogFileType)) {
			// Configure a new logger instance
			const logger = electronLog.create(`logger-${logFileType}`) as ElectronLog;

			// Set log file path
			logger.transports.file.resolvePath = () =>
				join(this.logPath, logFileType);

			// Configure log level and format
			logger.transports.file.level = "debug";
			logger.transports.file.format =
				"[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

			// Set max log file size (10MB)
			logger.transports.file.maxSize = 10 * 1024 * 1024;

			// Also log to console in development mode
			if (process.env.NODE_ENV === "development") {
				logger.transports.console.level = "debug";
			} else {
				logger.transports.console.level = "info";
			}

			// Add logger to map
			this.loggers.set(logFileType, logger);
		}

		// Log initialization
		this.getLogger(LogFileType.INSTALLER).info("Logger initialized");
		this.getLogger(LogFileType.INSTALLER).info(`Log path: ${this.logPath}`);
		this.getLogger(LogFileType.BACKEND).info("Backend logger initialized");
		this.getLogger(LogFileType.BACKEND).info(`Log path: ${this.logPath}`);
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
	 * Get a specific logger instance
	 * @param logType The type of log file to use
	 * @returns The logger instance for the specified log file
	 */
	private getLogger(logType: LogFileType): ElectronLog {
		const logger =
			this.loggers.get(logType) || this.loggers.get(LogFileType.INSTALLER);
		if (!logger) {
			// This should never happen as we initialize all loggers in the constructor
			throw new Error(`Logger for ${logType} not found`);
		}
		return logger;
	}

	/**
	 * Log an info message
	 * @param message The message to log
	 * @param logType The type of log file to use (defaults to INSTALLER)
	 * @param optionalParams Optional parameters to log
	 */
	public info(
		message: string,
		logType: LogFileType = LogFileType.INSTALLER,
		...optionalParams: unknown[]
	): void {
		this.getLogger(logType).info(message, ...optionalParams);
	}

	/**
	 * Log a warning message
	 * @param message The message to log
	 * @param logType The type of log file to use (defaults to INSTALLER)
	 * @param optionalParams Optional parameters to log
	 */
	public warn(
		message: string,
		logType: LogFileType = LogFileType.INSTALLER,
		...optionalParams: unknown[]
	): void {
		this.getLogger(logType).warn(message, ...optionalParams);
	}

	/**
	 * Log an error message
	 * @param message The message to log
	 * @param logType The type of log file to use (defaults to INSTALLER)
	 * @param optionalParams Optional parameters to log
	 */
	public error(
		message: string,
		logType: LogFileType = LogFileType.INSTALLER,
		...optionalParams: unknown[]
	): void {
		this.getLogger(logType).error(message, ...optionalParams);
	}

	/**
	 * Log a debug message
	 * @param message The message to log
	 * @param logType The type of log file to use (defaults to INSTALLER)
	 * @param optionalParams Optional parameters to log
	 */
	public debug(
		message: string,
		logType: LogFileType = LogFileType.INSTALLER,
		...optionalParams: unknown[]
	): void {
		this.getLogger(logType).debug(message, ...optionalParams);
	}

	/**
	 * Log an exception
	 * @param error The error to log
	 * @param logType The type of log file to use (defaults to INSTALLER)
	 * @param context Optional context information
	 */
	public exception(
		error: Error,
		logType: LogFileType = LogFileType.INSTALLER,
		context?: string,
	): void {
		const logger = this.getLogger(logType);
		if (context) {
			logger.error(`[${context}] ${error.message}`);
			logger.error(error.stack);
		} else {
			logger.error(error.message);
			logger.error(error.stack);
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
