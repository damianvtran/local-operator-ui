import { z } from "zod";

/**
 * Environment variables schema using Zod for validation
 */
const envSchema = z.object({
	// API configuration
	VITE_LOCAL_OPERATOR_API_URL: z
		.string()
		.url("API URL must be a valid URL")
		.optional()
		.default("http://localhost:1111"),

	// Radient agent-server base URL
	VITE_RADIENT_SERVER_BASE_URL: z
		.string()
		.url("Radient server base URL must be a valid URL")
		.optional()
		.default("https://api.radienthq.com"),

	// Radient OAuth client ID (required)
	VITE_RADIENT_CLIENT_ID: z
		.string({
			required_error: "VITE_RADIENT_CLIENT_ID is required",
			invalid_type_error: "VITE_RADIENT_CLIENT_ID must be a string",
		})
		.min(1, "VITE_RADIENT_CLIENT_ID cannot be empty"),

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
});

/**
 * Type definition for the application configuration
 */
export type AppConfig = z.infer<typeof envSchema>;

/**
 * Loads and validates environment variables
 * @returns Validated configuration object
 * @throws Error if required environment variables are missing or invalid
 */
function loadConfig(): AppConfig {
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
		if (error instanceof z.ZodError) {
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

/**
 * Application configuration singleton
 */
export const config = loadConfig();

/**
 * API client configuration derived from the app config
 */
export const apiConfig = {
	baseUrl: config.VITE_LOCAL_OPERATOR_API_URL,
	radientBaseUrl: config.VITE_RADIENT_SERVER_BASE_URL,
	radientClientId: config.VITE_RADIENT_CLIENT_ID,
};
