import type { Plugin } from "vite";
import dotenv from "dotenv";
import { resolve, normalize } from "node:path";
import { existsSync } from "node:fs";
/**
 * Loads environment variables from .env file at the project root if it exists.
 */
dotenv.config({ path: resolve(process.cwd(), ".env") });

/**
 * Vite plugin to replace placeholder values in src/main/backend/config.ts
 * with environment variables from .env during build.
 *
 * @returns {Plugin} Vite plugin instance for backend config replacement.
 * @throws {Error} If required environment variables or the target file are missing.
 */
export function replaceBackendConfigPlugin(): Plugin {
	if (!process.env.VITE_GOOGLE_CLIENT_ID) {
		throw new Error("VITE_GOOGLE_CLIENT_ID is not set");
	}
	if (!process.env.VITE_GOOGLE_CLIENT_SECRET) {
		throw new Error("VITE_GOOGLE_CLIENT_SECRET is not set");
	}
	if (!process.env.VITE_MICROSOFT_CLIENT_ID) {
		throw new Error("VITE_MICROSOFT_CLIENT_ID is not set");
	}
	if (!process.env.VITE_MICROSOFT_TENANT_ID) {
		throw new Error("VITE_MICROSOFT_TENANT_ID is not set");
	}

	const targetFile = normalize(resolve(process.cwd(), "src/main/backend/config.ts"));

  if(!existsSync(targetFile)) {
    throw new Error(`Target backend config file not found at: ${targetFile}`);
  }

	const replacements: Record<string, string> = {
		REPL_VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID,
		REPL_VITE_GOOGLE_CLIENT_SECRET: process.env.VITE_GOOGLE_CLIENT_SECRET,
		REPL_VITE_MICROSOFT_CLIENT_ID: process.env.VITE_MICROSOFT_CLIENT_ID,
		REPL_VITE_MICROSOFT_TENANT_ID: process.env.VITE_MICROSOFT_TENANT_ID,
	};

	const escapeRegExp = (string: string): string => {
		return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	};

	return {
		name: "replace-backend-config",
		/**
		 * Transforms the backend config file by replacing placeholders with environment values.
		 *
		 * @param {string} code - The file content.
		 * @param {string} id - The file path.
		 * @returns {{ code: string; map: null } | null} The transformed code or null if not applicable.
		 */
		transform(code, id) {
			// Normalize both paths for cross-platform compatibility
			const normalizedId = normalize(id);
			if (normalizedId === targetFile) {
				let modifiedCode = code;
				for (const [placeholderWithQuotes, replacementValue] of Object.entries(
					replacements,
				)) {
					const regex = new RegExp(escapeRegExp(placeholderWithQuotes), "g");
					modifiedCode = modifiedCode.replace(regex, replacementValue);
				}
				return {
					code: modifiedCode,
					map: null,
				};
			}
			return null;
		},
	};
}
