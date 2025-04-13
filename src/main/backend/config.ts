/**
 * Backend Configuration
 *
 * This module is responsible for loading and validating environment variables
 * for the backend process. It loads variables from .env file and provides
 * type-safe access to configuration values.
 */

import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";
import { LogFileType, logger } from "./logger";

// Load environment variables from .env file
const envResult = dotenvConfig({
	path: join(process.cwd(), ".env"),
	override: true,
});

if (envResult.error) {
	logger.warn(
		"Failed to load .env file, using process.env only",
		LogFileType.BACKEND,
		envResult.error,
	);
}

/**
 * Environment variables schema using Zod for validation
 */
const envSchema = z.object({
	// API configuration
	VITE_LOCAL_OPERATOR_API_URL: z
		.string()
		.url("API URL must be a valid URL")
		.optional()
		.default("http://127.0.0.1:1111"),

	// Backend service manager configuration
	VITE_DISABLE_BACKEND_MANAGER: z
		.enum(["true", "false"])
		.optional()
		.default("false"),

	// Logging
	VITE_LOG_LEVEL: z
		.enum(["debug", "info", "warn", "error"])
		.optional()
		.default("info"),

	// Analytics
	VITE_PUBLIC_POSTHOG_KEY: z
		.string()
		.optional()
		.default("phc_u6n9doAtCUbpFbydIqzupCxqCaGUO4SiHMEU5ESvQRL"),

	VITE_PUBLIC_POSTHOG_HOST: z
		.string()
		.url("PostHog host must be a valid URL")
		.optional()
		.default("https://us.i.posthog.com"),

	// OAuth Configuration
	VITE_GOOGLE_CLIENT_ID: z.string().min(1, "Google Client ID is required"),
	VITE_MICROSOFT_CLIENT_ID: z
		.string()
		.min(1, "Microsoft Client ID is required"),
	VITE_MICROSOFT_TENANT_ID: z
		.string()
		.min(1, "Microsoft Tenant ID is required"),
});

/**
 * Type definition for the backend configuration
 */
export type BackendConfig = z.infer<typeof envSchema>;

/**
 * Loads and validates environment variables
 * @returns Validated configuration object
 * @throws Error if required environment variables are missing or invalid
 */
function loadConfig(): BackendConfig {
	try {
		// Get all environment variables from process.env
		const envVars: Record<string, string> = {};

		// Extract all VITE_ prefixed environment variables
		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith("VITE_") && value !== undefined) {
				envVars[key] = value;
			}
		}

		// Validate environment variables against schema
		return envSchema.parse(envVars);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const formattedErrors = error.errors
				.map((err) => `${err.path.join(".")}: ${err.message}`)
				.join("\n");

			logger.error(
				`Configuration validation failed:\n${formattedErrors}`,
				LogFileType.BACKEND,
			);
			throw new Error(`Configuration validation failed:\n${formattedErrors}`);
		}

		logger.error(
			`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
			LogFileType.BACKEND,
		);
		throw new Error(
			`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Backend configuration singleton
 */
export const backendConfig = loadConfig();

/**
 * API client configuration derived from the backend config
 */
export const apiConfig = {
	baseUrl: backendConfig.VITE_LOCAL_OPERATOR_API_URL,
};
