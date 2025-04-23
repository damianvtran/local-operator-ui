import type { Plugin } from "vite";
import dotenv from "dotenv";
import { resolve } from "node:path";

// Load .env file from the project root if it exists
dotenv.config({ path: resolve(process.cwd(), ".env") });

/**
 * Vite plugin to replace placeholder values in src/main/backend/config.ts
 * with environment variables from .env during build.
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

	const targetFile = resolve(process.cwd(), "src/main/backend/config.ts");

	const replacements: Record<string, string> = {
		REPL_VITE_GOOGLE_CLIENT_ID: `${process.env.VITE_GOOGLE_CLIENT_ID || ""}`,
		REPL_VITE_GOOGLE_CLIENT_SECRET: `${process.env.VITE_GOOGLE_CLIENT_SECRET || ""}`,
		REPL_VITE_MICROSOFT_CLIENT_ID: `${process.env.VITE_MICROSOFT_CLIENT_ID || ""}`,
		REPL_VITE_MICROSOFT_TENANT_ID: `${process.env.VITE_MICROSOFT_TENANT_ID || ""}`,
	};

	const escapeRegExp = (string: string): string => {
		return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	};

	return {
		name: "replace-backend-config",
		// Use the transform hook to modify the file content
		transform(code, id) {
			// Check if the current file is the target file
			if (id === targetFile) {
				let modifiedCode = code;
				// Apply each replacement
				for (const [placeholderWithQuotes, replacementValue] of Object.entries(
					replacements,
				)) {
					// Use a regex for global replacement, escaping the placeholder string
					const regex = new RegExp(escapeRegExp(placeholderWithQuotes), "g");
					modifiedCode = modifiedCode.replace(regex, replacementValue);
				}
				return {
					code: modifiedCode,
					map: null, // No source map changes needed for simple replacement
				};
			}
			// Return null for files we don't want to transform
			return null;
		},
	};
}
