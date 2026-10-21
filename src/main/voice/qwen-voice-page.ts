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

import { VOICE_PAGE_CHANNELS } from "../../voice-page/channels";
import {
	type PermissionQuery,
	appVoicePagePermissionVerdict,
	voicePagePermissionVerdict,
} from "../window-guards";

/** The partition name; `qwen-voice` without `persist:` is memory-only. */
export const QWEN_VOICE_PARTITION = "qwen-voice";

/**
 * What the macOS privacy (TCC) check found, as far as this app can tell.
 * `prompting` is the bounded-wait outcome (review M3): the OS dialog went up and
 * is still unanswered, so nothing can be decided yet.
 */
export type QwenMicAccess = "granted" | "denied" | "prompting" | "unknown";

/** The two answers the OS can still give after `prompting` was reported. */
export type QwenMicSettled = "granted" | "denied";

/**
 * How the microphone is asked for. `timeoutMs` bounds the wait (`0` waits
 * forever, the old behaviour); after it, the caller gets `prompting` and
 * `onSettled` fires once when the dialog is finally answered.
 */
export type MicrophonePreflight = {
	timeoutMs?: number;
	onSettled?: (settled: QwenMicSettled) => void;
};

/**
 * The coordinator's view of the page: `qwen-voice.ts` owns the rig and calls
 * this; the Electron adapter below implements it. Defined here so the
 * coordinator imports a type, never Electron.
 */
export interface QwenVoicePagePort {
	/**
	 * Whether this run may create a page at all (review round 2, minor 1).
	 * False means nothing can hear the rig, so `QwenVoice.start` refuses before
	 * it spawns ~5.5 GB for a window that is not there.
	 */
	readonly allowed: boolean;
	/** Create the hidden page at the Gateway's WebUI URL; idempotent. */
	open(webuiUrl: string): void;
	/** Destroy it. Idempotent. */
	close(): void;
	/**
	 * Silence the page's OWN playback without touching this app or the rig.
	 * Remembered here rather than by the caller because the page is destroyed and
	 * recreated on a pause, a retry and a crash: a mute that only lived on the
	 * view would come back talking after every one of those.
	 */
	setMuted(muted: boolean): void;
	/** Ask the OS for the microphone before a page is created (§2). */
	prepareMicrophone(options?: MicrophonePreflight): Promise<QwenMicAccess>;
	/**
	 * Local provider (S3): create the app's own `voice-page.html` at `pageUrl`
	 * (from `appVoicePageUrl`), with the narrow preload. Idempotent.
	 */
	openApp(pageUrl: string, onLoadFailed?: () => void): boolean;
	/** Local provider: send a reply's sentences to the page to synthesize. */
	speak(message: { replyId: string; segments: string[] }): boolean;
	/** Local provider: stop the page's speech now. */
	stopSpeech(): void;
}

/**
 * The page port for a run that must not create one (`LOP_QWEN_NO_WEBUI=1`):
 * agent-driven runs and probes. Nothing hears, and nothing pretends to.
 */
export function noQwenVoicePage(): QwenVoicePagePort {
	return {
		allowed: false,
		open: () => {},
		close: () => {},
		setMuted: () => {},
		prepareMicrophone: async () => "unknown",
		openApp: () => false,
		speak: () => false,
		stopSpeech: () => {},
	};
}

/**
 * The header's sentence for a run that may not create a page: a mode that is
 * not `normal` or `LOP_QWEN_NO_WEBUI=1`. Nobody is at that window by
 * definition, so this usually reaches a log; it exists so the refusal is a
 * sentence like R1's machine-size one, not a silent no-op.
 */
export const QWEN_NO_VOICE_WINDOW =
	"Voice needs a normal app window to hear you.";

/**
 * Whether this launch may create the page at all (review R2): a normal window
 * only, and never when the run opted out with `LOP_QWEN_NO_WEBUI=1`.
 *
 * WHY THE MODE MATTERS: a headless or inactive run has nobody at the screen, and
 * creating the page there makes the OS ask for a microphone against the process
 * the launch belongs to - QA saw the prompt land on the session host and voice
 * sit on "Starting voice" for four minutes. Those runs create no page and ask
 * for nothing.
 */
export function voicePageAllowed(
	mode: string,
	env: NodeJS.ProcessEnv,
): boolean {
	return mode === "normal" && env.LOP_QWEN_NO_WEBUI !== "1";
}

/*
 * THE APP-OWNED PAGE (Groq plan D2/U1). Pure parts only: nothing here creates a
 * view, and nothing calls it yet - U2 swaps the coordinator onto it. The rig
 * path above is untouched.
 */

/** The bundled page's file name; the build emits it beside `index.html`. */
export const APP_VOICE_PAGE_DOCUMENT = "voice-page.html";

const INDEX_DOCUMENT_SUFFIX = /\/?index\.html(\?.*)?$/;
const TRAILING_SLASH = /\/$/;

/**
 * The app's own voice page, derived from the main renderer's URL the way the
 * mini view's is: a built run hands over a `file:` URL ending in `index.html`
 * (the page is its sibling), a dev run hands over the dev server's origin (the
 * document is appended). No query: the page takes nothing from its URL.
 */
export function appVoicePageUrl(rendererUrl: string): string {
	const base = INDEX_DOCUMENT_SUFFIX.test(rendererUrl)
		? rendererUrl.replace(INDEX_DOCUMENT_SUFFIX, `/${APP_VOICE_PAGE_DOCUMENT}`)
		: `${rendererUrl.replace(TRAILING_SLASH, "")}/${APP_VOICE_PAGE_DOCUMENT}`;
	const url = new URL(base);
	url.search = "";
	url.hash = "";
	return url.toString();
}

/**
 * Whether a navigation target is the app's voice page. The page navigates
 * nowhere, so the navigation lock admits only a reload of itself.
 */
export function isAppVoicePageUrl(candidate: string, pageUrl: string): boolean {
	try {
		const a = new URL(candidate);
		const b = new URL(pageUrl);
		return a.protocol === b.protocol && a.pathname === b.pathname
			? b.protocol === "file:" || a.origin === b.origin
			: false;
	} catch {
		return false;
	}
}

/** The permission verdict for the app-owned page: audio, main frame, its own URL. */
export function appVoicePageVerdict(
	query: PermissionQuery,
	pageUrl: string,
): boolean {
	return appVoicePagePermissionVerdict(query, pageUrl);
}

/** The URL main loads: the WebUI in desktop-orb mode, with no idle sleep. */
export function voicePageUrl(webuiUrl: string): string {
	const url = new URL(webuiUrl);
	url.search = "?desktop=orb&autoHideSeconds=0";
	url.hash = "";
	return url.toString();
}

/**
 * The Electron event object every navigation listener here uses. `url` is the
 * NEW API (review M2): the positional `(event, url)` form is deprecated, and a
 * handler that read it would miss the event's own field.
 */
export type PageEvent = { preventDefault?: () => void; url?: string };

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
	/**
	 * Electron's `webContents.setAudioMuted`. Mutes the PAGE'S audio - which is
	 * Qwen's speech - without muting this app or the rig, and without the page
	 * cooperating (it is third-party code and is told nothing).
	 */
	setAudioMuted(muted: boolean): void;
	/** Electron's `webContents.send`; main -> page messages (local provider). */
	send?: (channel: string, ...args: unknown[]) => void;
	/** The top frame; IPC from any other frame of the page is refused. */
	readonly mainFrame?: unknown;
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
	/** Timers for the bounded microphone wait (a test seam). */
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	log?: (message: string) => void;
	/** A page that cannot be brought back; the rig cannot hear, so say so. */
	onStopped: (reason: string) => void;
	now?: () => number;
	/** `out/preload/voice-page.js`: the app page's one narrow preload. */
	appPreloadPath?: string;
};

export class QwenVoicePage implements QwenVoicePagePort {
	readonly allowed = true;
	private view: VoicePageView | null = null;
	/** Remembered across a close/reopen; see `setMuted`. */
	private muted = false;
	private lastUrl: string | null = null;
	/** The app-owned page's URL while one is open (permission + navigation lock). */
	private appUrl: string | null = null;
	private lastKind: "webui" | "app" = "webui";
	private lastCrashAt: number | null = null;
	private readonly log: (message: string) => void;
	private readonly now: () => number;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;

	constructor(private readonly deps: QwenVoicePageDeps) {
		this.log = deps.log ?? (() => {});
		this.now = deps.now ?? Date.now;
		this.setTimer =
			deps.setTimer ??
			((fn, ms) => {
				const handle = setTimeout(fn, ms);
				handle.unref?.();
				return handle;
			});
		this.clearTimer =
			deps.clearTimer ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.installPermissions();
		this.installDownloadGuard();
	}

	/** True while a page exists (a crashed one is dropped by its handler). */
	get isOpen(): boolean {
		return this.view !== null;
	}

	/** The page's webContents, for IPC sender checks; null when no page exists. */
	get contents(): VoicePageWebContents | null {
		return this.view?.webContents ?? null;
	}

	/**
	 * The app-owned page (local provider). Same smallest-surface view as the
	 * WebUI page, plus the one narrow preload; the permission verdict and the
	 * navigation lock are for this exact URL only.
	 */
	openApp(pageUrl: string, onLoadFailed?: () => void): boolean {
		if (this.view) return true;
		let url: URL;
		try {
			url = new URL(pageUrl);
		} catch {
			this.log("qwen-page: refusing a malformed app page URL");
			return false;
		}
		if (!this.deps.appPreloadPath) {
			this.log("qwen-page: no preload for the app page; not opening it");
			return false;
		}
		const view = this.deps.createView({
			webPreferences: {
				partition: QWEN_VOICE_PARTITION,
				preload: this.deps.appPreloadPath,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
				autoplayPolicy: "no-user-gesture-required",
				devTools: Boolean(this.deps.devTools),
			},
		});
		this.view = view;
		this.lastUrl = pageUrl;
		this.lastKind = "app";
		this.appUrl = url.toString();
		if (this.muted) view.webContents.setAudioMuted(true);
		this.installNavigationLock(view.webContents);
		this.installCrashRecovery(view.webContents);
		if (this.deps.devTools) view.webContents.openDevTools?.({ mode: "detach" });
		this.log("qwen-page: loading the app voice page");
		void Promise.resolve(view.webContents.loadURL(this.appUrl)).catch(
			(error) => {
				this.log(
					`qwen-page: load failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				// Only while this view is still the current one (a close or crash
				// reopen supersedes it).
				if (this.view?.webContents === view.webContents) onLoadFailed?.();
			},
		);
		return true;
	}

	/** Sentences for the page to say. False when there is no page to say them. */
	speak(message: { replyId: string; segments: string[] }): boolean {
		const contents = this.view?.webContents;
		if (!contents?.send || !this.appUrl) return false;
		contents.send(VOICE_PAGE_CHANNELS.speak, message);
		return true;
	}

	stopSpeech(): void {
		if (this.appUrl) this.view?.webContents.send?.(VOICE_PAGE_CHANNELS.stop);
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
		this.lastKind = "webui";
		this.appUrl = null;
		/*
		 * MUTE IS A PROPERTY OF THE PERSON, NOT OF THE VIEW. Applied here, on
		 * CREATE, so a page recreated by a pause/resume, a Retry or a crash
		 * recovery comes back as quiet as the one it replaced.
		 */
		if (this.muted) view.webContents.setAudioMuted(true);
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

	/** Apply a mute now (when a page exists) and remember it for the next one. */
	setMuted(muted: boolean): void {
		this.muted = muted;
		const view = this.view;
		if (!view) return;
		try {
			view.webContents.setAudioMuted(muted);
		} catch (error) {
			this.log(
				`qwen-page: mute failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	close(): void {
		const view = this.view;
		this.view = null;
		// A closed page grants nothing: the app URL goes with the view (a crash
		// recovery reopens from `lastUrl`, which sets it again).
		this.appUrl = null;
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

	async prepareMicrophone(
		options: MicrophonePreflight = {},
	): Promise<QwenMicAccess> {
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
		 * Ask while voice is being turned ON, not from inside a silent page: a
		 * denial becomes a state the header shows, instead of a page that loads
		 * with `clients: 1` and hears nothing.
		 *
		 * WHERE THE DIALOG IS ATTRIBUTED (QA round 1, Q-4, no code): macOS gives
		 * a prompt to the RESPONSIBLE process, not necessarily the one that asked.
		 * In a dev harness that was the lop session host, so the dev app's prompt
		 * never appeared there. That is a harness artifact - the packaged app is
		 * its own bundle and answers its own prompt - and not something this call
		 * can change. Do not chase it here.
		 */
		const answer = this.askMicrophone();
		const timeoutMs = options.timeoutMs ?? 0;
		if (timeoutMs <= 0) return (await answer) ?? "unknown";
		/*
		 * BOUNDED (review M3/QA): macOS can leave the dialog up indefinitely, and
		 * a start must not hold on it. The wait expires into `prompting`; the
		 * answer, whenever it comes, reaches the caller through `onSettled`.
		 */
		return new Promise<QwenMicAccess>((resolve) => {
			let settled = false;
			const timer = this.setTimer(() => {
				if (settled) return;
				settled = true;
				resolve("prompting");
				void answer.then((value) => {
					if (value) options.onSettled?.(value);
				});
			}, timeoutMs);
			void answer.then((value) => {
				if (settled) return;
				settled = true;
				this.clearTimer(timer);
				resolve(value ?? "unknown");
			});
		});
	}

	/** One `askForMediaAccess`, mapped to the two answers or null on error. */
	private async askMicrophone(): Promise<QwenMicSettled | null> {
		try {
			return (await this.deps.mediaAccess.ask()) ? "granted" : "denied";
		} catch (error) {
			this.log(
				`qwen-page: microphone prompt failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
	}

	/** Grant audio, main frame, the Gateway's origin; deny everything else. */
	private installPermissions(): void {
		const verdict = (query: PermissionQuery): boolean =>
			voicePagePermissionVerdict(query, this.deps.gatewayOrigin) ||
			(this.appUrl !== null && appVoicePageVerdict(query, this.appUrl));
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
		/*
		 * FAIL CLOSED (review M2). The url comes from `event.url`, not the
		 * deprecated positional argument; an event that names no url is a
		 * navigation this page may not take, so it is prevented rather than
		 * allowed through.
		 */
		const block = (event: PageEvent): void => {
			const url = event?.url;
			let origin = "";
			if (typeof url === "string" && url.length > 0) {
				try {
					origin = new URL(url).origin;
				} catch {
					origin = "";
				}
			}
			if (origin === this.deps.gatewayOrigin) return;
			// The app page may only reload itself.
			if (
				this.appUrl !== null &&
				typeof url === "string" &&
				isAppVoicePageUrl(url, this.appUrl)
			)
				return;
			event?.preventDefault?.();
			this.log(
				`qwen-page: blocked navigation to ${(url ?? "<no url>").slice(0, 200)}`,
			);
		};
		contents.on("will-navigate", block);
		contents.on("will-redirect", block);
		// Defence in depth: a sub-frame's navigation is not the page's, but the
		// origin lock is the one rule that must hold for every frame it contains.
		contents.on("will-frame-navigate", block);
		contents.setWindowOpenHandler?.(() => {
			this.log("qwen-page: denied window.open");
			return { action: "deny" };
		});
	}

	private installCrashRecovery(contents: VoicePageWebContents): void {
		contents.on("render-process-gone", () => {
			if (this.view === null) return;
			this.log("qwen-page: the renderer is gone");
			/*
			 * Close the DEAD contents before dropping the reference (review N4):
			 * a crashed WebContents still owns a process and its profile files
			 * until it is closed, and a bare null is how a renderer leaks across a
			 * crash loop.
			 */
			try {
				contents.close();
			} catch {
				// Already gone: nothing to close.
			}
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
		if (!url) return;
		if (this.lastKind === "app") this.openApp(url);
		else this.open(url);
	}
}
