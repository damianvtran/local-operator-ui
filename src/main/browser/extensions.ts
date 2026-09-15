import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type {
	BrowserExtensionRow,
	BrowserExtensionsState,
} from "../../shared/browser-extensions";
import { readJson, writeJsonAtomic } from "./atomic-json";

interface Registration {
	key: string;
	path: string;
	name: string;
	version: string;
	enabled: boolean;
	id: string | null;
	digest: string;
	keyId: string | null;
	permissions: string[];
	warnings: string[];
	popupPath: string | null;
}

export interface ExtensionRuntime {
	loadExtension: (
		path: string,
		options: { allowFileAccess: boolean },
	) => Promise<{ id: string }>;
	removeExtension: (id: string) => void;
	getExtension: (id: string) => unknown;
}

export interface ExtensionInspection {
	path: string;
	name: string;
	version: string;
	digest: string;
	keyId: string | null;
	permissions: string[];
	warnings: string[];
	popupPath: string | null;
}

export interface ExtensionManagerOptions {
	dir: string;
	runtime: ExtensionRuntime;
	chooseDirectory: () => Promise<string | null>;
	confirm: (inspection: ExtensionInspection) => Promise<boolean>;
	openPopup: (id: string, path: string, name: string) => Promise<void>;
	closePopup: (id: string) => void;
}

const DIGEST = /^[a-f0-9]{64}$/;
const EXTENSION_ID = /^[a-p]{32}$/;
const MAX_MANIFEST = 1024 * 1024;
const NO_DIRECTORY =
	"The extension directory is missing. Restore it, or remove the registration.";
const NO_MANIFEST =
	"This directory has no manifest.json. Choose an unpacked extension directory that contains one.";
const UNREADABLE_MANIFEST =
	"The extension manifest could not be read. Check that the file is readable.";
const COMPATIBILITY_WARNING =
	"Chrome extension support is partial. A successful load does not prove every feature works. Native messaging, browser-store services and desktop companion integrations are unavailable. File access is not granted.";

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** The two filesystem failures a directory can arrive in, in the manager's own
 * words rather than Node's.
 *
 * WHY this is a function and not three inline calls: `statSync`/`readFileSync`
 * outside a try reach the user as `ENOENT: no such file or directory, lstat
 * '/…'` — a syscall and a path where the promise (docs/browser-extensions.md,
 * "Load failures fail closed") is a message they can act on, and the second of
 * the three cases is the one a user hits by picking a folder that is not an
 * extension at all. Fail-closed either way; this is copy, not safety. */
function manifestText(canonical: string): string {
	const manifestPath = join(canonical, "manifest.json");
	let size: number;
	try {
		size = statSync(manifestPath).size;
	} catch {
		throw new Error(NO_MANIFEST);
	}
	if (size > MAX_MANIFEST)
		throw new Error("The extension manifest is too large.");
	try {
		return readFileSync(manifestPath, "utf8");
	} catch {
		throw new Error(UNREADABLE_MANIFEST);
	}
}

/** Approval covers a trusted directory AND its manifest. Keeping the canonical path
 * stable preserves Chromium's path-derived ID, and a manifest change on disk stops
 * automatic loading until the user explicitly reviews the new permissions. Source
 * code inside that directory is trusted code: this is not a signed-store updater. */
export function inspectExtension(path: string): ExtensionInspection {
	let canonical: string;
	try {
		canonical = realpathSync(path);
	} catch {
		// A registration outlives its directory: `load()` re-inspects by path on
		// every start, so a directory the user moved or deleted lands here.
		throw new Error(NO_DIRECTORY);
	}
	if (!statSync(canonical).isDirectory())
		throw new Error("Choose an unpacked extension directory.");
	const text = manifestText(canonical);
	const manifest = JSON.parse(text);
	if (
		!manifest ||
		typeof manifest !== "object" ||
		![2, 3].includes(manifest.manifest_version) ||
		typeof manifest.name !== "string" ||
		!manifest.name.trim() ||
		typeof manifest.version !== "string"
	) {
		throw new Error(
			"A valid Manifest V2 or V3 extension manifest is required.",
		);
	}
	// Chromium derives keyed IDs from the public key's SHA-256. Check collisions
	// BEFORE loadExtension: loading a duplicate ID can replace the existing one.
	const keyId =
		typeof manifest.key === "string"
			? [
					...createHash("sha256")
						.update(Buffer.from(manifest.key, "base64"))
						.digest("hex")
						.slice(0, 32),
				]
					.map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
					.join("")
			: null;
	const permissions = [
		...strings(manifest.permissions).map((p) => `Permission: ${p}`),
		...strings(manifest.host_permissions).map((p) => `Site access: ${p}`),
		...strings(manifest.optional_permissions).map(
			(p) => `Optional permission: ${p}`,
		),
		...strings(manifest.optional_host_permissions).map(
			(p) => `Optional site access: ${p}`,
		),
	];
	for (const script of Array.isArray(manifest.content_scripts)
		? manifest.content_scripts
		: []) {
		permissions.push(
			...strings(script?.matches).map((p) => `Content scripts: ${p}`),
		);
	}
	const action =
		manifest.action ?? manifest.browser_action ?? manifest.page_action;
	const popupPath =
		typeof action?.default_popup === "string" && action.default_popup
			? action.default_popup
			: null;
	if (popupPath) {
		const url = new URL(
			popupPath,
			"chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
		);
		if (
			url.origin !== "null" ||
			url.protocol !== "chrome-extension:" ||
			url.hostname !== "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		) {
			throw new Error(
				"The extension popup must be a page inside the extension.",
			);
		}
	}
	const warnings = [COMPATIBILITY_WARNING];
	if (action && !popupPath)
		warnings.push(
			"This extension has no default popup. Action-click dispatch and browser toolbar integration are not available.",
		);
	if (popupPath)
		warnings.push(
			"Opens the declared default popup as an extension page. Active-tab grants, dynamic toolbar state and browser-window APIs may not behave like Chrome.",
		);
	return {
		path: canonical,
		name: manifest.name,
		version: manifest.version,
		digest: createHash("sha256").update(text).digest("hex"),
		keyId,
		permissions: [...new Set(permissions)],
		warnings,
		popupPath,
	};
}

function validRegistration(value: unknown): value is Registration {
	if (!value || typeof value !== "object") return false;
	const row = value as Registration;
	return (
		typeof row.key === "string" &&
		row.key.length > 0 &&
		typeof row.path === "string" &&
		isAbsolute(row.path) &&
		typeof row.name === "string" &&
		typeof row.version === "string" &&
		typeof row.enabled === "boolean" &&
		typeof row.digest === "string" &&
		DIGEST.test(row.digest) &&
		(row.keyId === null ||
			(typeof row.keyId === "string" && EXTENSION_ID.test(row.keyId))) &&
		(row.id === null ||
			(typeof row.id === "string" && EXTENSION_ID.test(row.id))) &&
		Array.isArray(row.permissions) &&
		row.permissions.every((p) => typeof p === "string") &&
		Array.isArray(row.warnings) &&
		row.warnings.every((p) => typeof p === "string") &&
		(row.popupPath === null || typeof row.popupPath === "string")
	);
}

/** Only registration metadata is written. Disable/remove never unlink a source
 * directory or clear extension storage. All mutations serialize across windows and
 * native dialogs so a second click cannot race an approval or lose a registry write. */
export class BrowserExtensionManager {
	private rows: Registration[] = [];
	private errors = new Map<string, string>();
	private registryError: string | null = null;
	private queue: Promise<unknown> = Promise.resolve();
	readonly filePath: string;

	constructor(private options: ExtensionManagerOptions) {
		this.filePath = join(options.dir, "extensions.json");
	}

	async start(): Promise<void> {
		const saved = readJson<{ version: number; rows: unknown[] }>(this.filePath);
		if (saved === null && !existsSync(this.filePath)) return;
		if (
			!saved ||
			saved.version !== 1 ||
			!Array.isArray(saved.rows) ||
			!saved.rows.every(validRegistration) ||
			new Set(saved.rows.map((r) => r.key)).size !== saved.rows.length ||
			new Set(saved.rows.map((r) => r.path)).size !== saved.rows.length
		) {
			this.registryError =
				"The extension registry is unreadable or invalid. No extensions were loaded. Restore the registry before making changes.";
			return;
		}
		this.rows = saved.rows;
		for (const row of this.rows) if (row.enabled) await this.load(row);
	}

	list(): BrowserExtensionsState {
		return {
			error: this.registryError,
			rows: this.rows.map(
				(row): BrowserExtensionRow => ({
					key: row.key,
					id: row.id,
					name: row.name,
					version: row.version,
					path: row.path,
					enabled: row.enabled,
					loaded: !!row.id && !!this.options.runtime.getExtension(row.id),
					error: this.errors.get(row.key) ?? null,
					permissions: [...row.permissions],
					warnings: [...row.warnings],
					popup: row.popupPath !== null,
				}),
			),
		};
	}

	private mutate<T>(action: () => Promise<T>): Promise<T> {
		const result = this.queue.then(() => {
			if (this.registryError) throw new Error(this.registryError);
			return action();
		});
		this.queue = result.catch(() => undefined);
		return result;
	}

	private save(rows: Registration[]): void {
		if (!writeJsonAtomic(this.filePath, { version: 1, rows }))
			throw new Error(
				"Could not save the extension registry. No registration changes were applied.",
			);
		this.rows = rows;
	}

	private async load(row: Registration): Promise<void> {
		try {
			const inspection = inspectExtension(row.path);
			if (inspection.path !== row.path || inspection.digest !== row.digest)
				throw new Error(
					"The extension directory or manifest changed. Disable and enable it to review permissions again.",
				);
			if (
				inspection.keyId &&
				this.rows.some(
					(other) =>
						other.key !== row.key &&
						(other.keyId === inspection.keyId || other.id === inspection.keyId),
				)
			)
				throw new Error(
					"The extension ID conflicts with another registration. Remove that registration first.",
				);
			const loaded = await this.options.runtime.loadExtension(row.path, {
				allowFileAccess: false,
			});
			// A keyed extension can collide with another registered directory. Never
			// silently replace that identity or adopt a changed one on restart.
			if (
				(row.id && row.id !== loaded.id) ||
				this.rows.some(
					(other) => other.key !== row.key && other.id === loaded.id,
				)
			) {
				this.options.runtime.removeExtension(loaded.id);
				throw new Error(
					"The extension ID changed or conflicts with another registration.",
				);
			}
			const updated = { ...row, id: loaded.id };
			try {
				this.save(
					this.rows.map((other) => (other.key === row.key ? updated : other)),
				);
			} catch (error) {
				this.options.runtime.removeExtension(loaded.id);
				throw error;
			}
			this.errors.delete(row.key);
		} catch (error) {
			this.errors.set(
				row.key,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	install(): Promise<BrowserExtensionsState> {
		return this.mutate(async () => {
			const chosen = await this.options.chooseDirectory();
			if (!chosen) return this.list();
			const inspection = inspectExtension(chosen);
			if (this.rows.some((row) => row.path === inspection.path))
				throw new Error(
					"This directory is already registered. Enable it from the list.",
				);
			if (!(await this.options.confirm(inspection))) return this.list();
			const row: Registration = {
				...inspection,
				key: randomUUID(),
				id: null,
				enabled: true,
			};
			this.save([...this.rows, row]);
			await this.load(row);
			return this.list();
		});
	}

	setEnabled(key: string, enabled: boolean): Promise<BrowserExtensionsState> {
		return this.mutate(async () => {
			const row = this.find(key);
			if (enabled) {
				if (row.enabled && row.id && this.options.runtime.getExtension(row.id))
					return this.list();
				const inspection = inspectExtension(row.path);
				if (!(await this.options.confirm(inspection))) return this.list();
				const updated = { ...row, ...inspection, enabled: true };
				this.save(
					this.rows.map((other) => (other.key === key ? updated : other)),
				);
				await this.load(updated);
			} else {
				// Persist denial before unloading: a disk failure must not report a
				// durable disable while the next launch would enable it again.
				this.save(
					this.rows.map((other) =>
						other.key === key ? { ...other, enabled: false } : other,
					),
				);
				this.unload(row);
				this.errors.delete(key);
			}
			return this.list();
		});
	}

	remove(key: string): Promise<BrowserExtensionsState> {
		return this.mutate(async () => {
			const row = this.find(key);
			this.save(this.rows.filter((other) => other.key !== key));
			this.unload(row);
			this.errors.delete(key);
			return this.list();
		});
	}

	openPopup(key: string): Promise<void> {
		return this.mutate(async () => {
			const row = this.find(key);
			if (
				!row.enabled ||
				!row.id ||
				!this.options.runtime.getExtension(row.id) ||
				!row.popupPath
			)
				throw new Error("This extension has no loaded default popup.");
			await this.options.openPopup(row.id, row.popupPath, row.name);
		});
	}

	private find(key: string): Registration {
		const row = this.rows.find((item) => item.key === key);
		if (!row) throw new Error("The extension registration no longer exists.");
		return row;
	}

	private unload(row: Registration): void {
		if (row.id) {
			this.options.closePopup(row.id);
			this.options.runtime.removeExtension(row.id);
		}
	}

	stop(): void {
		for (const row of this.rows) this.unload(row);
	}
}
