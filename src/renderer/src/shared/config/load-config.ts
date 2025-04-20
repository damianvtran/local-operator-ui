import { envSchema, AppConfig } from "./env-schema";
import { ZodError } from "zod";

/**
 * Loads and validates environment variables
 * @returns Validated configuration object
 * @throws Error if required environment variables are missing or invalid
 */
export function loadConfig(): AppConfig {
	try {
		// Get all environment variables from import.meta.env
		const envVars: Record<string, string> = {};

		// Extract all VITE_ prefixed environment variables
		for (const [key, value] of Object.entries(import.meta.env)) {
			if (key.startsWith("VITE_")) {
				envVars[key] = String(value);
			}
		}

		// Validate environment variables against schema
		return envSchema.parse(envVars);
	} catch (error) {
		if (error instanceof ZodError) {
			const formattedErrors = error.errors
				.map((err) => `${err.path.join(".")}: ${err.message}`)
				.join("\n");

			throw new Error(`Configuration validation failed:\n${formattedErrors}`);
		}

		throw new Error(
			`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
