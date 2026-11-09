/**
 * ExtensionManager: Chrome Web Store extensions for the embedded browser
 * (design extension-manager-design.md §4.1). Replaces the single-vendor
 * 1Password controller; that controller already WAS an extension manager
 * specialised to one id, so this generalizes it rather than adding a second
 * install stack beside it.
 *
 * Trust model, in order:
 * 1. Packages come only from the fixed store download URL for a regex-checked
 *    id, and must carry a valid developer proof bound to that id AND the Chrome
 *    Web Store publisher proof (crx.ts). No unpacked, sideloaded or CRX2 loads.
 * 2. Consent is a native dialog built from the VERIFIED manifest; the state
 *    entry it writes is the only consent. A cached CRX is never consent.
 * 3. The signed CRX is the trust root: every load (install, enable, startup)
 *    re-verifies it and extracts a fresh private tree; an edited extraction has
 *    no effect, a flipped CRX byte surfaces as `error: "verify"`.
 * 4. Updates are strictly newer 4-part versions only, re-verified the same way;
 *    one that asks for more access waits (`needs-reconsent`) with the old
 *    version still loaded — Chrome's own behaviour.
 * 5. Agents cannot drive any of this: management is desktop-renderer IPC only,
 *    installs come only from a user-owned presented focused tab, and every
 *    consent is a native dialog CDP cannot click (design §4.4).
 *
 * Why not electron-chrome-web-store's main-process half: no signature
 * verification, prefix origin check, unvalidated uninstall path (`..` deletes
 * userData), 3-part version compare, trust-on-disk loader (design §1).
 *
 * Bytecode build constraint (electron.vite.config.ts): no arrow functions in
 * class property initialisers; assign them in the constructor instead.
 */
import { readFile, rm } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { BrowserWindow, type Session, type WebContents } from "electron";
import {
	EXTENSION_STARTUP_DEADLINE_MS,
	type ExtensionError,
	type ExtensionStatus,
	type ExtensionSummary,
	isExtensionId,
} from "../../../shared/browser-extensions";
import type { WindowShow } from "../../window-mode";
import { presentPopupWindow } from "../../window-raise";
import {
	type AdapterBinding,
	extensionIdOfUrl,
	extensionsAdapter,
	isExtensionPageOf,
} from "./adapter";
import { ONEPASSWORD_EXTENSION_ID } from "./crx";
import {
	type ExtensionManifest,
	type PreparedExtension,
	UnsupportedManifestError,
	crxPath,
	downloadStoreCrx,
	ensurePrivateDirectory,
	persistStoreCrx,
	prepareExtension,
	removeStaleExtractions,
} from "./install";
import {
	type ExtensionAccess,
	accessGrew,
	accessOf,
	isStrictUpgrade,
} from "./policy";
import {
	type ExtensionsState,
	type InstalledExtension,
	readExtensionsState,
	writeExtensionsState,
} from "./state";

export interface InstallPrompt {
	id: string;
	name: string;
	version: string;
	access: ExtensionAccess;
	/** "update": an already-installed extension's newer version asks for more. */
	kind: "install" | "enable" | "update";
}

export interface ExtensionHooks {
	window: BrowserWindow;
	show: WindowShow;
	backgroundThrottling: boolean;
	/** `<userData>/browser-extensions`. */
	root: string;
	changed: () => void;
	createTab: (url: string, active: boolean) => Promise<WebContents>;
	selectTab: (contents: WebContents) => void;
	activeTab: () => WebContents | null;
	removeTab: (contents: WebContents) => void;
	/** Main's native-focus + presented USER-tab fact, not a worker-supplied flag. */
	mayPresentExtensionPopup: () => boolean;
	/** Native dialogs. Implementations answer false when the app window is not
	 * focused, so a probe/agent cannot summon or satisfy them. */
	confirmInstall: (prompt: InstallPrompt) => Promise<boolean>;
	confirmRemove: (name: string) => Promise<boolean>;
	/** Optional internal measurement: durations/categories only. */
	workerStartupMeasured?: (result: {
		elapsedMs: number;
		outcome: "ready" | "error";
	}) => void;
}

/** Chrome's webstorePrivate.Result values the store page understands. */
export type StoreInstallResult =
	| "success"
	| "user_cancelled"
	| "already_installed"
	| "install_in_progress"
	| "install_error"
	| "manifest_error"
	| "invalid_id";

interface Runtime {
	status: ExtensionStatus;
	error: ExtensionError;
	prepared: PreparedExtension | null;
	popupPath: string | null;
	optionsPath: string | null;
	operation: AbortController;
	pending: Promise<unknown> | null;
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const cancel = () => reject(new Error("Extension operation cancelled"));
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
		operation
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", cancel));
	});
}

/** Icons are inlined as data URLs (no new protocol handler) and bounded: a
 * larger file is simply not shown. 64 KiB is far above a 128px PNG icon. */
const MAX_ICON_BYTES = 64 * 1024;
const ICON_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
};

async function iconOf(prepared: PreparedExtension): Promise<string | null> {
	const icons = prepared.manifest.icons;
	if (!icons || typeof icons !== "object") return null;
	const sizes = Object.entries(icons as Record<string, unknown>)
		.filter(([size, path]) => /^\d+$/.test(size) && typeof path === "string")
		.sort(([a], [b]) => Number(a) - Number(b));
	const chosen =
		sizes.filter(([size]) => Number(size) <= 128).pop() ?? sizes[0];
	if (!chosen) return null;
	const path = resolve(
		prepared.directory,
		String(chosen[1]).replace(/^\//, ""),
	);
	const rel = relative(prepared.directory, path);
	const type = ICON_TYPES[extname(path).toLowerCase()];
	if (!type || !rel || rel.startsWith("..")) return null;
	try {
		const bytes = await readFile(path);
		return bytes.length > MAX_ICON_BYTES
			? null
			: `data:${type};base64,${bytes.toString("base64")}`;
	} catch {
		return null;
	}
}

/** A manifest-relative page as an absolute URL INSIDE that extension, or null
 * (a manifest pointing elsewhere is ignored rather than opened). */
function extensionPage(id: string, page: unknown): string | null {
	if (typeof page !== "string" || !page) return null;
	try {
		const url = new URL(page, `chrome-extension://${id}/`);
		return isExtensionPageOf(url.href, id) ? url.href : null;
	} catch {
		return null;
	}
}

function optionsPageOf(id: string, manifest: ExtensionManifest): string | null {
	return (
		extensionPage(id, manifest.options_ui?.page) ??
		extensionPage(id, manifest.options_page)
	);
}

export class ExtensionManager {
	private state: ExtensionsState = { version: 1, extensions: {} };
	private runtimes = new Map<string, Runtime>();
	private windows = new Map<string, BrowserWindow>();
	private disposed = false;
	private lifetime = new AbortController();
	private updating: Promise<number> | null = null;
	private readonly binding: AdapterBinding;
	constructor(
		private session: Session,
		private hooks: ExtensionHooks,
		binding?: AdapterBinding,
	) {
		this.binding = binding ?? extensionsAdapter(session);
		this.binding.hooks = hooks;
		this.binding.openExtension = (url) => this.openPage(url);
		this.binding.isActiveExtension = (id) => this.isActive(id);
		this.binding.mayActivateTab = () =>
			[...this.windows.values()].some(
				(window) => !window.isDestroyed() && window.isFocused(),
			);
	}

	// ---- queries ---------------------------------------------------------

	/** Loaded and enabled (a worker error still counts: it is loaded). */
	isActive(id: string): boolean {
		const entry = this.state.extensions[id];
		const runtime = this.runtimes.get(id);
		return (
			!this.disposed &&
			!!entry?.enabled &&
			!!runtime?.prepared &&
			(runtime.status === "enabled" ||
				runtime.status === "needs-reconsent" ||
				(runtime.status === "error" && runtime.error === "worker"))
		);
	}

	list(): ExtensionSummary[] {
		return Object.entries(this.state.extensions)
			.map(([id, entry]) => this.summary(id, entry))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** For the store page's install button state only (design §3C): id,
	 * enabled and version — nothing that enumerates more than it must. */
	storeStatus(id: string): "enabled" | "disabled" | "installable" {
		const entry = this.state.extensions[id];
		return !entry ? "installable" : entry.enabled ? "enabled" : "disabled";
	}

	storeList(): { id: string; enabled: boolean; version: string }[] {
		return Object.entries(this.state.extensions).map(([id, entry]) => ({
			id,
			enabled: entry.enabled,
			version: entry.version,
		}));
	}

	private summary(id: string, entry: InstalledExtension): ExtensionSummary {
		const runtime = this.runtimes.get(id);
		const access = entry.consented ?? {
			allSites: true,
			hosts: [],
			permissions: [],
		};
		const status: ExtensionStatus =
			runtime?.status ?? (entry.enabled ? "loading" : "disabled");
		return {
			id,
			name: entry.name,
			version: entry.version,
			status:
				status === "enabled" && entry.pendingVersion
					? "needs-reconsent"
					: status,
			error: runtime?.error ?? null,
			hasPopup: !!runtime?.popupPath && this.isActive(id),
			hasOptions: !!runtime?.optionsPath && this.isActive(id),
			iconDataUrl: entry.icon,
			allSites: access.allSites,
			hosts: access.hosts,
			permissions: access.permissions,
			pendingVersion: entry.pendingVersion ?? null,
		};
	}

	private runtime(id: string): Runtime {
		let runtime = this.runtimes.get(id);
		if (!runtime) {
			runtime = {
				status: "disabled",
				error: null,
				prepared: null,
				popupPath: null,
				optionsPath: null,
				operation: new AbortController(),
				pending: null,
			};
			this.runtimes.set(id, runtime);
		}
		return runtime;
	}

	private set(
		id: string,
		status: ExtensionStatus,
		error: ExtensionError = null,
	): void {
		const runtime = this.runtime(id);
		runtime.status = status;
		runtime.error = error;
		if (!this.disposed) this.hooks.changed();
	}

	private save(): void {
		writeExtensionsState(this.hooks.root, this.state);
	}

	/** Per-id single flight: a second op on a busy id is refused (null), not
	 * queued, so a double click can never interleave two loads of one id. */
	private exclusive<T>(
		id: string,
		task: (signal: AbortSignal) => Promise<T>,
	): Promise<T | null> {
		const runtime = this.runtime(id);
		if (this.disposed || runtime.pending) return Promise.resolve(null);
		runtime.operation = new AbortController();
		const signal = AbortSignal.any([
			this.lifetime.signal,
			runtime.operation.signal,
		]);
		const pending = task(signal).finally(() => {
			if (runtime.pending === pending) runtime.pending = null;
		});
		runtime.pending = pending;
		return pending;
	}

	cancel(id: string): void {
		this.runtimes.get(id)?.operation.abort();
	}

	// ---- startup -----------------------------------------------------------

	/** Load every enabled extension from its re-verified CRX. Sequential, so
	 * worker readiness events for one scope never race another's. */
	async restore(): Promise<void> {
		if (this.disposed) return;
		await ensurePrivateDirectory(this.hooks.root);
		this.state = readExtensionsState(this.hooks.root);
		await this.migrateSingleVendorLayout();
		for (const [id, entry] of Object.entries(this.state.extensions)) {
			if (this.disposed) return;
			if (!entry.enabled) {
				this.set(id, "disabled");
				continue;
			}
			await this.exclusive(id, async (signal) => {
				try {
					await removeStaleExtractions(this.hooks.root, id);
					const crx = await readFile(crxPath(this.hooks.root, id));
					const prepared = await prepareExtension(
						this.hooks.root,
						id,
						crx,
					).catch(() => null);
					if (!prepared) return this.set(id, "error", "verify");
					await this.activate(id, prepared, signal);
					// A migrated single-vendor entry's consent was that dialog's
					// all-sites text; pin it to the verified manifest it now runs.
					if (entry.consented === null && this.runtime(id).prepared) {
						entry.consented = accessOf(prepared.manifest);
						this.save();
						if (id === ONEPASSWORD_EXTENSION_ID)
							await rm(join(this.hooks.root, "1password"), {
								recursive: true,
								force: true,
							});
					}
				} catch {
					this.set(id, "error", "startup");
				}
			});
		}
	}

	/** One-shot, idempotent migration of `browser-extensions/1password/
	 * {official.crx,enabled.json}` (the unreleased single-vendor layout). The
	 * `enabled` value is copied verbatim; an absent/null marker stays absent, so
	 * a cached package never becomes implicit consent. The old directory is kept
	 * until the migrated entry loads (removed in restore()). */
	private async migrateSingleVendorLayout(): Promise<void> {
		const id = ONEPASSWORD_EXTENSION_ID;
		if (this.state.extensions[id]) return;
		const legacy = join(this.hooks.root, "1password");
		let enabled: unknown;
		let crx: Buffer;
		try {
			enabled = JSON.parse(
				await readFile(join(legacy, "enabled.json"), "utf8"),
			)?.enabled;
			crx = await readFile(join(legacy, "official.crx"));
		} catch {
			return;
		}
		if (typeof enabled !== "boolean") return;
		let prepared: PreparedExtension;
		try {
			prepared = await prepareExtension(this.hooks.root, id, crx);
		} catch {
			return; // An unverifiable legacy package is not migrated.
		}
		try {
			await persistStoreCrx(this.hooks.root, id, crx);
			this.state.extensions[id] = {
				enabled,
				installedAt: Date.now(),
				version: String(prepared.manifest.version ?? ""),
				name: prepared.name,
				icon: await iconOf(prepared),
				consented: null,
			};
			this.save();
			// A disabled entry never loads, so restore() would never reach the
			// cleanup below; its package now lives at <id>/official.crx.
			if (!enabled) await rm(legacy, { recursive: true, force: true });
		} finally {
			await prepared.dispose();
		}
	}

	// ---- install / enable / disable / remove --------------------------------

	/** Store-page install. The caller (webstore.ts) has already proved the
	 * request came from the exact store origin in a user-owned, presented,
	 * focused tab. Download + verify first, then a native dialog built from the
	 * VERIFIED manifest; nothing is persisted or loaded before "Add". */
	async installFromStore(id: string): Promise<StoreInstallResult> {
		if (!isExtensionId(id)) return "invalid_id";
		if (this.state.extensions[id]) return "already_installed";
		const result = await this.exclusive(
			id,
			async (signal): Promise<StoreInstallResult> => {
				let prepared: PreparedExtension;
				try {
					const crx = await downloadStoreCrx(id, signal);
					prepared = await prepareExtension(this.hooks.root, id, crx);
				} catch (error) {
					await this.forgetIfUninstalled(id);
					if (error instanceof UnsupportedManifestError)
						return "manifest_error";
					return signal.aborted ? "user_cancelled" : "install_error";
				}
				const access = accessOf(prepared.manifest);
				const version = String(prepared.manifest.version ?? "");
				const allowed =
					!signal.aborted &&
					(await this.hooks.confirmInstall({
						id,
						name: prepared.name,
						version,
						access,
						kind: "install",
					}));
				if (!allowed || signal.aborted || this.disposed) {
					await prepared.dispose();
					await this.forgetIfUninstalled(id);
					return "user_cancelled";
				}
				try {
					await persistStoreCrx(this.hooks.root, id, prepared.crx);
					this.state.extensions[id] = {
						enabled: true,
						installedAt: Date.now(),
						version,
						name: prepared.name,
						icon: await iconOf(prepared),
						consented: access,
					};
					this.save();
				} catch {
					await prepared.dispose();
					delete this.state.extensions[id];
					await this.forgetIfUninstalled(id);
					return "install_error";
				}
				await this.activate(id, prepared, signal);
				return "success";
			},
		);
		return result ?? "install_in_progress";
	}

	/** Remove the private directory of an id that has no state entry (a
	 * cancelled/failed install), so cancel leaves nothing on disk. */
	private async forgetIfUninstalled(id: string): Promise<void> {
		if (this.state.extensions[id]) return;
		this.runtimes.delete(id);
		await rm(join(this.hooks.root, id), { recursive: true, force: true }).catch(
			() => {},
		);
		if (!this.disposed) this.hooks.changed();
	}

	async setEnabled(id: string, enabled: boolean): Promise<boolean> {
		const entry = this.state.extensions[id];
		if (!entry) return false;
		if (!enabled) {
			// Disable wins over an in-flight load: abort it, then unload.
			this.cancel(id);
			await this.runtimes.get(id)?.pending?.catch(() => {});
			const done = await this.exclusive(id, async () => {
				await this.unload(id);
				entry.enabled = false;
				this.save();
				this.set(id, "disabled");
				return true;
			});
			return done ?? false;
		}
		const done = await this.exclusive(id, async (signal) => {
			// Re-enable (or approve a pending update) asks again: the user sees the
			// access of the exact package that will run.
			const pending = !!entry.pendingVersion;
			let prepared: PreparedExtension;
			try {
				const crx = await readFile(
					crxPath(this.hooks.root, id, pending ? "pending" : "official"),
				);
				prepared = await prepareExtension(this.hooks.root, id, crx);
			} catch {
				this.set(id, "error", "verify");
				return false;
			}
			const access = accessOf(prepared.manifest);
			const version = String(prepared.manifest.version ?? "");
			if (
				!(await this.hooks.confirmInstall({
					id,
					name: prepared.name,
					version,
					access,
					kind: pending ? "update" : "enable",
				})) ||
				signal.aborted
			) {
				await prepared.dispose();
				return false;
			}
			if (pending) {
				await persistStoreCrx(this.hooks.root, id, prepared.crx);
				await rm(crxPath(this.hooks.root, id, "pending"), { force: true });
				entry.pendingVersion = undefined;
				entry.version = version;
				entry.name = prepared.name;
				entry.icon = await iconOf(prepared);
			}
			entry.enabled = true;
			entry.consented = access;
			this.save();
			await this.activate(id, prepared, signal);
			return true;
		});
		return done ?? false;
	}

	/** Remove = unload + delete `<root>/<id>/` + clear the extension origin's
	 * storage (IndexedDB, localStorage, service worker registrations) + forget
	 * consent. Disable, by contrast, keeps storage. */
	async uninstall(id: string): Promise<boolean> {
		const entry = this.state.extensions[id];
		if (!entry || !isExtensionId(id)) return false;
		if (!(await this.hooks.confirmRemove(entry.name))) return false;
		this.cancel(id);
		await this.runtimes.get(id)?.pending?.catch(() => {});
		const done = await this.exclusive(id, async () => {
			await this.unload(id);
			delete this.state.extensions[id];
			this.save();
			await rm(join(this.hooks.root, id), { recursive: true, force: true });
			await this.session
				.clearStorageData({ origin: `chrome-extension://${id}` })
				.catch(() => {});
			return true;
		});
		this.runtimes.delete(id);
		if (!this.disposed) this.hooks.changed();
		return done ?? false;
	}

	private async unload(id: string): Promise<void> {
		const runtime = this.runtime(id);
		const window = this.windows.get(id);
		if (window && !window.isDestroyed()) window.close();
		this.session.extensions.removeExtension(id);
		await runtime.prepared?.dispose();
		runtime.prepared = null;
		runtime.popupPath = null;
		runtime.optionsPath = null;
	}

	// ---- updates -------------------------------------------------------------

	/** Manual "Check for updates" (v1 ships no timer; see PR body). For each
	 * installed id: download the store's current package, verify it exactly as
	 * an install, and accept only a STRICTLY newer 4-part version. More access
	 * than consented → park it as pending.crx and mark needs-reconsent while the
	 * old version keeps running. Returns how many updates were applied. */
	checkUpdates(): Promise<number> {
		if (this.updating) return this.updating;
		this.updating = this.runUpdates().finally(() => {
			this.updating = null;
		});
		return this.updating;
	}

	private async runUpdates(): Promise<number> {
		let applied = 0;
		for (const [id, entry] of Object.entries(this.state.extensions)) {
			if (this.disposed) break;
			const ok = await this.exclusive(id, async (signal) => {
				let prepared: PreparedExtension;
				try {
					prepared = await prepareExtension(
						this.hooks.root,
						id,
						await downloadStoreCrx(id, signal),
					);
				} catch {
					return false;
				}
				const version = String(prepared.manifest.version ?? "");
				const baseline = entry.pendingVersion ?? entry.version;
				if (!isStrictUpgrade(baseline, version) || signal.aborted) {
					await prepared.dispose();
					return false;
				}
				const access = accessOf(prepared.manifest);
				if (entry.consented && accessGrew(entry.consented, access)) {
					await persistStoreCrx(this.hooks.root, id, prepared.crx, "pending");
					await prepared.dispose();
					entry.pendingVersion = version;
					this.save();
					this.hooks.changed();
					return false;
				}
				await persistStoreCrx(this.hooks.root, id, prepared.crx);
				entry.version = version;
				entry.name = prepared.name;
				entry.icon = await iconOf(prepared);
				this.save();
				if (entry.enabled) await this.activate(id, prepared, signal);
				else await prepared.dispose();
				return true;
			});
			if (ok) applied++;
		}
		return applied;
	}

	// ---- load + worker readiness ---------------------------------------------

	/** Load a verified extraction and, for an MV3 service worker, wait for the
	 * engine to register and start it (bounded by EXTENSION_STARTUP_DEADLINE_MS).
	 * A load that succeeds but whose worker never starts stays loaded with
	 * `error: "worker"` — the honest state the menu shows — rather than claiming
	 * the extension works. */
	private async activate(
		id: string,
		prepared: PreparedExtension,
		outer: AbortSignal,
	): Promise<void> {
		const runtime = this.runtime(id);
		this.set(id, "loading");
		const scope = `chrome-extension://${id}/`;
		const workers = this.session.serviceWorkers;
		const hasWorker =
			typeof prepared.manifest.background?.service_worker === "string";
		const startedAt = performance.now();
		const deadline = new AbortController();
		const timer = setTimeout(
			() => deadline.abort(),
			EXTENSION_STARTUP_DEADLINE_MS,
		);
		const signal = AbortSignal.any([outer, deadline.signal]);
		let registrationReady = () => {};
		let removeListeners = () => {};
		const registered = new Promise<void>((yes, no) => {
			registrationReady = yes;
			const versions = new Set<number>();
			const cancelled = () => no(new Error("Extension load cancelled"));
			signal.addEventListener("abort", cancelled, { once: true });
			if (signal.aborted) cancelled();
			const completed = (_event: unknown, details: { scope: string }) => {
				if (details.scope === scope) yes();
			};
			const changed = (details: {
				versionId: number;
				runningStatus: string;
			}) => {
				if (details.runningStatus === "starting") {
					try {
						if (workers.getInfoFromVersionID(details.versionId).scope === scope)
							versions.add(details.versionId);
					} catch {
						/* No matching worker. */
					}
					return;
				}
				if (
					details.runningStatus !== "stopping" &&
					details.runningStatus !== "stopped"
				)
					return;
				if (versions.has(details.versionId))
					no(new Error("Extension worker stopped"));
				try {
					if (workers.getInfoFromVersionID(details.versionId).scope === scope)
						no(new Error("Extension worker stopped"));
				} catch {
					/* Removed worker: registration is still awaited. */
				}
			};
			workers.on("registration-completed", completed);
			workers.on("running-status-changed", changed);
			removeListeners = () => {
				workers.removeListener("registration-completed", completed);
				workers.removeListener("running-status-changed", changed);
				signal.removeEventListener("abort", cancelled);
			};
		});
		// Mark handled immediately: a worker can fail during loadExtension itself.
		void registered.catch(() => {});
		let loaded = false;
		try {
			const window = this.windows.get(id);
			if (window && !window.isDestroyed()) window.close();
			this.session.extensions.removeExtension(id);
			const loading = this.session.extensions.loadExtension(prepared.directory);
			// Electron has no cancellable loadExtension. A late completion may only
			// unload its OWN unique directory, never a newer load of the same id.
			void loading
				.then(() => {
					if (
						outer.aborted &&
						this.session.extensions.getExtension(id)?.path ===
							prepared.directory
					)
						this.session.extensions.removeExtension(id);
				})
				.catch(() => {});
			const extension = await withAbort(loading, outer);
			if (extension.id !== id) throw new Error("Extension identity mismatch");
			loaded = true;
			const previous = runtime.prepared;
			runtime.prepared = prepared;
			if (previous && previous !== prepared) await previous.dispose();
			runtime.popupPath = extensionPage(
				id,
				prepared.manifest.action?.default_popup,
			);
			runtime.optionsPath = optionsPageOf(id, prepared.manifest);
			if (hasWorker) {
				// Restart/cached registration can already be running without a new
				// registration event. A snapshot is an engine fact, not a delay.
				if (
					Object.values(workers.getAllRunning()).some(
						(worker) => worker.scope === scope,
					)
				)
					registrationReady();
				await registered;
				await withAbort(workers.startWorkerForScope(scope), signal);
			}
			if (this.disposed) throw new Error("Browser host stopped");
			this.set(id, "enabled");
		} catch {
			if (outer.aborted || !loaded) {
				this.session.extensions.removeExtension(id);
				// The previous version was unloaded above, so its tree must not keep
				// isActive() true for an extension that is no longer loaded.
				const stale = runtime.prepared;
				runtime.prepared = null;
				if (stale && stale !== prepared) await stale.dispose();
				await prepared.dispose();
				runtime.popupPath = null;
				runtime.optionsPath = null;
				if (this.state.extensions[id]?.enabled === false)
					this.set(id, "disabled");
				else this.set(id, "error", "startup");
			} else this.set(id, "error", "worker");
		} finally {
			clearTimeout(timer);
			removeListeners();
			this.hooks.workerStartupMeasured?.({
				elapsedMs: Math.round(performance.now() - startedAt),
				outcome: runtime.status === "enabled" ? "ready" : "error",
			});
		}
	}

	// ---- extension windows -----------------------------------------------------

	/** App-initiated (desktop menu press, sender-checked by IPC). */
	async openPopup(id: string): Promise<boolean> {
		const url = this.runtimes.get(id)?.popupPath;
		if (!url || !this.isActive(id)) return false;
		return this.openPage(url, true).then(
			() => true,
			() => false,
		);
	}

	async openOptions(id: string): Promise<boolean> {
		const url = this.runtimes.get(id)?.optionsPath;
		if (!url || !this.isActive(id)) return false;
		return this.openPage(url, true, true).then(
			() => true,
			() => false,
		);
	}

	/** One extension window per id. Popups and options pages open here, NOT as
	 * registry tabs, keeping chrome-extension:// documents out of TabRegistry
	 * and CDP reach. Navigation is confined to the extension's own origin. */
	private async openPage(
		url: string,
		appUserAction = false,
		large = false,
	): Promise<BrowserWindow> {
		const id = extensionIdOfUrl(url);
		if (this.disposed || !id || !this.isActive(id))
			throw new Error("Unsupported extension UI");
		const existing = this.windows.get(id);
		// A worker's action/open-window request is NOT a human press. Only the
		// sender-checked app command or main-owned FOREGROUND USER-tab context can
		// start UI. This is a focus/ownership policy, not proof of a DOM gesture.
		if (
			!appUserAction &&
			!this.hooks.mayPresentExtensionPopup() &&
			(!existing || existing.isDestroyed() || !existing.isFocused())
		)
			throw new Error("Extension popup requires the app's user action");
		if (existing && !existing.isDestroyed()) {
			if (existing.webContents.getURL() !== url) await existing.loadURL(url);
			presentPopupWindow(existing, this.presentation(id), {
				trigger: "popup-open",
			});
			return existing;
		}
		const window = new BrowserWindow({
			parent: this.hooks.window,
			width: large ? 820 : 480,
			height: large ? 720 : 680,
			show: false,
			autoHideMenuBar: true,
			webPreferences: {
				session: this.session,
				backgroundThrottling: this.hooks.backgroundThrottling,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		this.windows.set(id, window);
		window.on("closed", () => {
			if (this.windows.get(id) === window) this.windows.delete(id);
		});
		const navigate = (event: Electron.Event, target: string) => {
			if (isExtensionPageOf(target, id)) return;
			event.preventDefault();
			void this.hooks.createTab(target, window.isFocused()).catch(() => {});
		};
		window.webContents.on("will-navigate", navigate);
		window.webContents.on("will-redirect", navigate);
		window.webContents.on("will-attach-webview", (event) =>
			event.preventDefault(),
		);
		window.webContents.setWindowOpenHandler(({ url: target }) => {
			if (isExtensionPageOf(target, id))
				void this.openPage(target).catch(() => {});
			else
				void this.hooks.createTab(target, window.isFocused()).catch(() => {});
			return { action: "deny" };
		});
		try {
			await window.loadURL(url);
		} catch (error) {
			window.close();
			throw error;
		}
		presentPopupWindow(window, this.presentation(id), {
			trigger: "popup-open",
		});
		return window;
	}

	private presentation(id: string): WindowShow {
		// Extension startup/background activity never raises a hidden/unfocused
		// app. A real foreground user action retains the app's own launch policy.
		const mainFocused =
			this.hooks.window.isFocused() && this.hooks.window.isVisible();
		const own = this.windows.get(id);
		const ownFocused =
			!!own && !own.isDestroyed() && own.isFocused() && own.isVisible();
		return mainFocused || ownFocused ? this.hooks.show : "never";
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.lifetime.abort();
		for (const window of this.windows.values())
			if (!window.isDestroyed()) window.close();
		this.windows.clear();
		this.binding.hooks = null;
		this.binding.openExtension = null;
		this.binding.isActiveExtension = null;
		this.binding.mayActivateTab = null;
		for (const [id, runtime] of this.runtimes) {
			this.session.extensions.removeExtension(id);
			await runtime.pending?.catch(() => {});
			await runtime.prepared?.dispose();
			runtime.prepared = null;
		}
	}
}
