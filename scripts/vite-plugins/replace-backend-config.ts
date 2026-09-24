import { existsSync, readFileSync } from "node:fs";
import { normalize, resolve } from "node:path";
import dotenv from "dotenv";
import type { Plugin } from "vite";
/**
 * Loads environment variables from .env file at the project root if it exists.
 */
dotenv.config({ path: resolve(process.cwd(), ".env") });

/**
 * One `NAME: z.enum([...])` entry of the renderer's environment schema.
 */
export interface EnumEnvGuard {
	name: string;
	values: string[];
}

/**
 * The enum-valued variables the renderer's schema will REJECT at runtime, read out
 * of that schema rather than listed here by hand.
 *
 * WHY A BUILD-TIME GUARD FOR A RUNTIME SCHEMA. A wrong value here does not fail the
 * build. It is baked into the renderer bundle, and the window then throws
 * `Configuration validation failed` at boot and NEVER MOUNTS — measured (QA round 1
 * §0): a root `.env` carrying `VITE_DISABLE_BACKEND_MANAGER=1` against the schema's
 * `z.enum(["true", "false"])` produced an app whose `#app` stayed empty, and several
 * capture cells were then green against a window with no UI. The build is the last
 * moment the mistake is cheap, so the build is where it is refused, with the value
 * and the accepted set in the message.
 *
 * DERIVED, NOT COPIED, which is the same rule `check-build-env.mjs` states for the
 * required variables: a hand-written list of names can drift from the schema it
 * describes, and the direction it drifts is silent - a new enum variable would stay
 * unvalidated while this check stayed green. A schema this cannot parse (a `refine`,
 * a computed list) is simply not guarded, which is the honest limit of a derivation
 * rather than a claim that everything is covered.
 */
export function readEnumGuards(
	schemaPath: string = resolve(
		process.cwd(),
		"src/renderer/src/shared/config/env-schema.ts",
	),
): EnumEnvGuard[] {
	if (!existsSync(schemaPath)) return [];
	const source = readFileSync(schemaPath, "utf8");
	const guards: EnumEnvGuard[] = [];
	const pattern = /([A-Z][A-Z0-9_]*):\s*z\s*\.enum\(\[([^\]]*)\]/g;
	for (const match of source.matchAll(pattern)) {
		const values = [...match[2].matchAll(/"([^"]*)"/g)].map(
			(entry) => entry[1],
		);
		if (values.length > 0) guards.push({ name: match[1], values });
	}
	return guards;
}

/**
 * Refuse a set environment variable whose value the schema cannot accept.
 *
 * Unset is left alone: every one of these has a default, and an unset variable is
 * the schema's own business rather than a build error.
 */
export function assertEnumEnv(
	guards: EnumEnvGuard[],
	env: Record<string, string | undefined> = process.env,
): void {
	for (const { name, values } of guards) {
		const value = env[name];
		if (value === undefined) continue;
		if (!values.includes(value)) {
			throw new Error(
				`${name} must be one of ${values.join(" | ")}, received ${JSON.stringify(value)} - a value the renderer's schema rejects would let this build produce an app that dies at boot`,
			);
		}
	}
}

/**
 * Vite plugin to replace placeholder values in src/main/backend/config.ts
 * with environment variables from .env during build.
 *
 * @returns {Plugin} Vite plugin instance for backend config replacement.
 * @throws {Error} If required environment variables or the target file are missing.
 */
export function replaceBackendConfigPlugin(): Plugin {
	/*
	 * Before the required-variable checks rather than after, because this one names a
	 * value the caller TYPED rather than one they forgot - a mis-typed boolean is the
	 * case that shipped a blank window, and it deserves to be the first line read.
	 */
	assertEnumEnv(readEnumGuards());
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

	const targetFile = normalize(
		resolve(process.cwd(), "src/main/backend/config.ts"),
	);

	if (!existsSync(targetFile)) {
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
