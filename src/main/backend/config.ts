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

/**
 * The environment this process was LAUNCHED with, captured before the `.env`
 * below is applied.
 *
 * Why this exists, and why it is captured here rather than beside the decisions
 * that read it. `dotenvConfig` below runs at import time with `override: true`,
 * so from the next line onward `process.env` is no longer a record of the
 * launch: it is the launch with whatever is in a file at `process.cwd()` folded
 * in, and the file wins over the shell. A decision about the LAUNCH — how this
 * process was asked to behave — has to be resolved from what the operator
 * actually launched. Otherwise this repo's own gitignored, long-lived `.env`
 * (which AGENTS.md requires for `pnpm dev`) can arm the renderer dev driver, or
 * turn a deliberate `headless` run into a window that takes the operator's
 * focus, and an explicit `LOCAL_OPERATOR_UI_DEV_DRIVER=0` typed at the shell
 * cannot turn it off again.
 *
 * Captured in THIS module, on the statement before the mutation, rather than in
 * its own module imported first by whoever needs it: being the code that
 * rewrites `process.env` is what makes "this is the state before the rewrite"
 * true by construction instead of by import order that a later refactor can
 * quietly break. It is a plain snapshot, not a live view, so nothing that
 * mutates `process.env` afterwards can reach back into it.
 *
 * Add a key to it by asking the same question a reader of a launch would: did
 * the operator (or the harness) say this, or did a file in the working directory
 * say it? Launch facts — the window mode, the dev driver's opt-in — take this
 * one. Product configuration (`VITE_*`, the API URL, credentials) keeps reading
 * `process.env` after the dotenv call, because a `.env` is exactly where that is
 * supposed to come from.
 */
export const launchEnv: Record<string, string | undefined> = {
	...process.env,
};

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
	//
	// NOTE: the default below is PostHog's PUBLIC project API key (the `phc_`
	// kind), not a server secret. It is publishable by design — every PostHog
	// customer embeds one in shipped client code — and only identifies this
	// build to our PostHog project for analytics/feature flags. It grants no
	// read access to project data, so secret scanners flagging it in the
	// published npm bundle (out/main/index.jsc inlines this default) are
	// false positives. Never put a `phx_` personal API key here; those ARE
	// secrets and must never ship.
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
	VITE_GOOGLE_CLIENT_ID: z
		.string()
		.optional()
		.default("REPL_VITE_GOOGLE_CLIENT_ID"),
	VITE_GOOGLE_CLIENT_SECRET: z
		.string()
		.optional()
		.default("REPL_VITE_GOOGLE_CLIENT_SECRET"),
	VITE_MICROSOFT_CLIENT_ID: z
		.string()
		.optional()
		.default("REPL_VITE_MICROSOFT_CLIENT_ID"),
	VITE_MICROSOFT_TENANT_ID: z
		.string()
		.optional()
		.default("REPL_VITE_MICROSOFT_TENANT_ID"),
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
