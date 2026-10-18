/**
 * THE HIDDEN VOICE PAGE (plan §1-§3): Qwen's own WebUI, unchanged, in an
 * unattached `WebContentsView` inside this app.
 *
 * WHY A VIEW AND NOT A BROWSER TAB: the page is where the microphone and the
 * playback live, and a browser tab cannot be told anything by main - the tab
 * was Ben's manual step, and its "Enable microphone" click and permission
 * prompt were the only reason voice needed a person at all. In desktop mode
 * (`?desktop=orb`) the page starts capture on load with no gesture, and
 * `autoHideSeconds=0` turns off its idle-sleep timer.
 *
 * WHY NOT A HIDDEN `BrowserWindow`: it would be counted by
 * `BrowserWindow.getAllWindows().length === 0` on Dock activate, and appear in
 * the mini view's "anyOtherVisible". An unattached view is the same shape as
 * the hidden cookie-jar view in `browser/index.ts`, and it leaks its renderer
 * unless it is closed with `webContents.close()`.
 *
 * THE PAGE IS THIRD-PARTY CODE IN OUR PROCESS TREE, so it gets the smallest
 * surface that can still hear: its own in-memory partition (no `persist:`), no
 * preload, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
 * throttling off (a hidden page whose timers are throttled drops audio), one
 * permission - audio - and one origin - the Gateway's. It navigates nowhere,
 * opens nothing, downloads nothing.
 *
 * Electron-free on purpose, like `qwen-gateway.ts`: every facility is injected
 * from `index.ts`, so the rules here are tested as plain code.
 */

import {
	type PermissionQuery,
	voicePagePermissionVerdict,
} from "../window-guards";

/** The partition name; `qwen-voice` without `persist:` is memory-only. */
export const QWEN_VOICE_PARTITION = "qwen-voice";

/** What the macOS privacy (TCC) check found, as far as this app can tell. */
export type QwenMicAccess = "granted" | "denied" | "unknown";

/**
 * The coordinator's view of the page: `qwen-voice.ts` owns the rig and calls
 * this; the Electron adapter below implements it. Defined here so the
 * coordinator imports a type, never Electron.
 */
export interface QwenVoicePagePort {
	/** Create the hidden page at the Gateway's WebUI URL; idempotent. */
	open(webuiUrl: string): void;
	/** Destroy it. Idempotent. */
	close(): void;
	/** Ask the OS for the microphone before a page is created (§2). */
	prepareMicrophone(): Promise<QwenMicAccess>;
}

/**
 * The page port for a run that must not create one (`LOP_QWEN_NO_WEBUI=1`):
 * agent-driven runs and probes. Nothing hears, and nothing pretends to.
 */
export function noQwenVoicePage(): QwenVoicePagePort {
	return {
		open: () => {},
		close: () => {},
		prepareMicrophone: async () => "unknown",
	};
}

/** The URL main loads: the WebUI in desktop-orb mode, with no idle sleep. */
export function voicePageUrl(webuiUrl: string): string {
	const url = new URL(webuiUrl);
	url.search = "?desktop=orb&autoHideSeconds=0";
	url.hash = "";
	return url.toString();
}

/** The Electron event object every listener here uses (only this method). */
export type PageEvent = { preventDefault?: () => void };

/** The subset of Electron's WebContents this page uses (a test seam). */
export type VoicePageWebContents = {
	loadURL(url: string): Promise<void> | void;
	close(): void;
	on(
		event: string,
		listener: (event: PageEvent, ...rest: unknown[]) => void,
	): unknown;
	setWindowOpenHandler?: (
		handler: (details: { url: string }) => { action: "deny" },
	) => void;
	openDevTools?: (options: { mode: "detach" }) => void;
};

export type VoicePageView = { webContents: VoicePageWebContents };

export type PermissionDetails = {
	mediaTypes?: readonly string[];
	mediaType?: string;
	isMainFrame?: boolean;
	requestingUrl?: string;
};

/** The subset of Electron's Session this page uses (a test seam). */
export type VoicePageSession = {
	setPermissionRequestHandler: (
		handler:
			| ((
					contents: unknown,
					permission: string,
					callback: (granted: boolean) => void,
					details: PermissionDetails,
			  ) => void)
			| null,
	) => void;
	setPermissionCheckHandler: (
		handler:
			| ((
					contents: unknown,
					permission: string,
					origin: string,
					details: PermissionDetails,
			  ) => boolean)
			| null,
	) => void;
	on?: (event: string, listener: (event: PageEvent) => void) => unknown;
};

/**
 * A second crash inside this window is not a flake: it puts the rig in `error`
 * with "The voice page stopped" rather than recreating a renderer that will
 * crash again.
 */
export const PAGE_CRASH_WINDOW_MS = 60_000;

export type QwenVoicePageDeps = {
	/** The in-memory partition's session (`session.fromPartition`). */
	session: VoicePageSession;
	/** `new WebContentsView(...)` from Electron. */
	createView: (options: {
		webPreferences: Record<string, unknown>;
	}) => VoicePageView;
	/** `systemPreferences`: the TCC preflight. */
	mediaAccess: {
		status: () => string;
		ask: () => Promise<boolean>;
	};
	/** `http://127.0.0.1:<Gateway port>`, the only origin the page may be. */
	gatewayOrigin: string;
	/** `LOP_QWEN_VOICE_DEBUG=1`: the view's own DevTools, detached. */
	devTools?: boolean;
	log?: (message: string) => void;
	/** A page that cannot be brought back; the rig cannot hear, so say so. */
	onStopped: (reason: string) => void;
	now?: () => number;
};

export class QwenVoicePage implements QwenVoicePagePort {
	private view: VoicePageView | null = null;
	private lastUrl: string | null = null;
	private lastCrashAt: number | null = null;
	private readonly log: (message: string) => void;
	private readonly now: () => number;

	constructor(private readonly deps: QwenVoicePageDeps) {
		this.log = deps.log ?? (() => {});
		this.now = deps.now ?? Date.now;
		this.installPermissions();
		this.installDownloadGuard();
	}

	/** True while a page exists (a crashed one is dropped by its handler). */
	get isOpen(): boolean {
		return this.view !== null;
	}

	open(webuiUrl: string): void {
		// ONE voice session: a second call is the same page, not a second one.
		if (this.view) return;
		let origin: string;
		try {
			origin = new URL(webuiUrl).origin;
		} catch {
			this.log("qwen-page: refusing a malformed WebUI URL");
			return;
		}
		if (origin !== this.deps.gatewayOrigin) {
			this.log(
				`qwen-page: refusing ${origin}; the page may only be ${this.deps.gatewayOrigin}`,
			);
			return;
		}
		const view = this.deps.createView({
			webPreferences: {
				partition: QWEN_VOICE_PARTITION,
				// No preload: the package's own preload exposes settings, backend
				// install, quit and openExternal IPC, and none of it is wanted.
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				// A hidden page must keep its timers and its audio running.
				backgroundThrottling: false,
				// The page resumes its AudioContext on load with no gesture.
				autoplayPolicy: "no-user-gesture-required",
				devTools: Boolean(this.deps.devTools),
			},
		});
		this.view = view;
		this.lastUrl = webuiUrl;
		this.installNavigationLock(view.webContents);
		this.installCrashRecovery(view.webContents);
		if (this.deps.devTools) view.webContents.openDevTools?.({ mode: "detach" });
		const url = voicePageUrl(webuiUrl);
		this.log(`qwen-page: loading ${url}`);
		void Promise.resolve(view.webContents.loadURL(url)).catch((error) =>
			this.log(
				`qwen-page: load failed: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}

	close(): void {
		const view = this.view;
		this.view = null;
		if (!view) return;
		try {
			// An unattached view leaks its renderer unless it is closed; destroying
			// the view alone is not enough.
			view.webContents.close();
		} catch (error) {
			this.log(
				`qwen-page: close failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async prepareMicrophone(): Promise<QwenMicAccess> {
		let status: string;
		try {
			status = this.deps.mediaAccess.status();
		} catch (error) {
			this.log(
				`qwen-page: microphone status unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
			return "unknown";
		}
		if (status === "granted") return "granted";
		if (status === "denied" || status === "restricted") return "denied";
		if (status !== "not-determined") return "unknown";
		/*
		 * Ask while voice is being turned on, not from inside a silent page: a
		 * denial becomes a state the header shows, instead of a page that loads
		 * with `clients: 1` and hears nothing.
		 */
		try {
			return (await this.deps.mediaAccess.ask()) ? "granted" : "denied";
		} catch (error) {
			this.log(
				`qwen-page: microphone prompt failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return "unknown";
		}
	}

	/** Grant audio, main frame, the Gateway's origin; deny everything else. */
	private installPermissions(): void {
		const verdict = (query: PermissionQuery): boolean =>
			voicePagePermissionVerdict(query, this.deps.gatewayOrigin);
		this.deps.session.setPermissionRequestHandler(
			(_contents, permission, callback, details) => {
				const granted = verdict({
					permission,
					mediaTypes: details?.mediaTypes,
					isMainFrame: details?.isMainFrame ?? false,
					requestingUrl: details?.requestingUrl ?? "",
				});
				if (!granted) this.log(`qwen-page: denied a ${permission} request`);
				callback(granted);
			},
		);
		this.deps.session.setPermissionCheckHandler(
			(_contents, permission, origin, details) =>
				verdict({
					permission,
					mediaType: details?.mediaType,
					isMainFrame: details?.isMainFrame ?? false,
					requestingUrl: details?.requestingUrl ?? origin ?? "",
				}),
		);
	}

	private installDownloadGuard(): void {
		// `will-download` is a Session event, not a WebContents one.
		this.deps.session.on?.("will-download", (event) =>
			event?.preventDefault?.(),
		);
	}

	private installNavigationLock(contents: VoicePageWebContents): void {
		const block = (event: PageEvent, url?: unknown): void => {
			if (typeof url !== "string") return;
			let origin: string;
			try {
				origin = new URL(url).origin;
			} catch {
				origin = "";
			}
			if (origin === this.deps.gatewayOrigin) return;
			event.preventDefault?.();
			this.log(`qwen-page: blocked navigation to ${String(url).slice(0, 200)}`);
		};
		contents.on("will-navigate", block);
		contents.on("will-redirect", block);
		contents.setWindowOpenHandler?.(() => {
			this.log("qwen-page: denied window.open");
			return { action: "deny" };
		});
	}

	private installCrashRecovery(contents: VoicePageWebContents): void {
		contents.on("render-process-gone", () => {
			if (this.view === null) return;
			this.log("qwen-page: the renderer is gone");
			// The renderer is dead; drop the view without pretending to close it.
			this.view = null;
			const at = this.now();
			const recent =
				this.lastCrashAt !== null &&
				at - this.lastCrashAt < PAGE_CRASH_WINDOW_MS;
			this.lastCrashAt = at;
			if (recent) {
				this.close();
				this.deps.onStopped("The voice page stopped");
				return;
			}
			this.reopen();
		});
	}

	/** Recreate once (a fresh view); the crash handler owns the limit. */
	private reopen(): void {
		const url = this.lastUrl;
		if (url) this.open(url);
	}
}
