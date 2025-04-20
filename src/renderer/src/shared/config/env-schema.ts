import { z } from "zod";

/**
 * Environment variables schema using Zod for validation
 */
export const envSchema = z.object({
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
