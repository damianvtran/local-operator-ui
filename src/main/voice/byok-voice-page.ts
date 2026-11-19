/**
 * THE APP-OWNED VOICE PAGE'S ADAPTER (Groq plan D2/U2): `voice-page.html`, the
 * document this app ships, in an unattached `WebContentsView`, for the
 * bring-your-own-key engine. The Gateway's page (`qwen-voice-page.ts`) is a
 * different thing - third-party code with no preload - and keeps its own class.
 *
 * Unlike that page this one has a PRELOAD (`preload/voice-page.ts`): the
 * narrow bridge that carries a take and a VAD event up and play / stop / mute
 * down, and nothing else. It still gets the smallest surface that can hear: its
 * own in-memory partition (never the Gateway page's, whose permission handlers
 * grant a different origin), sandbox, one permission - audio, main frame, its
 * own document - and no navigation, window.open or download.
 *
 * Electron-free on purpose, like `qwen-voice-page.ts`: every facility is
 * injected from `index.ts`, so the rules are tested as plain code.
 */

import {
	VOICE_PAGE_CHANNELS as C,
	type PlayMessage,
} from "../../voice-page/channels";
import type { PermissionQuery } from "../window-guards";
import type { ByokPagePort } from "./byok-voice";
import {
	type MicrophonePreflight,
	PAGE_CRASH_WINDOW_MS,
	type PageEvent,
	type QwenMicAccess,
	type VoicePageSession,
	type VoicePageView,
	type VoicePageWebContents,
	appVoicePageUrl,
	appVoicePageVerdict,
	isAppVoicePageUrl,
	prepareMicrophoneAccess,
} from "./qwen-voice-page";

/** Memory only (no `persist:`), and not the Gateway page's `qwen-voice`. */
export const BYOK_VOICE_PARTITION = "byok-voice";

/** The subset of the page's WebContents this adapter uses (a test seam). */
export type ByokPageWebContents = VoicePageWebContents & {
	send(channel: string, payload?: unknown): void;
};
export type ByokPageView = { webContents: ByokPageWebContents };

export type ByokVoicePageDeps = {
	/** The in-memory partition's session (`session.fromPartition`). */
	session: VoicePageSession;
	/** `new WebContentsView(...)` from Electron. */
	createView: (options: {
		webPreferences: Record<string, unknown>;
	}) => ByokPageView;
	/** The main renderer's URL; the page is its sibling document. */
	rendererUrl: string;
	/** The built `voice-page` preload. */
	preloadPath: string;
	/** `systemPreferences`: the TCC preflight. */
	mediaAccess: {
		status: () => string;
		ask: () => Promise<boolean>;
	};
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	log?: (message: string) => void;
	/** A page that cannot be brought back; listening cannot continue. */
	onStopped: (reason: string) => void;
	/** A crashed page was rebuilt: the new document is unproven until it says ready. */
	onRestarted?: () => void;
	now?: () => number;
};

export class ByokVoicePage implements ByokPagePort {
	readonly allowed = true;
	private view: ByokPageView | null = null;
	/** The person's mute, remembered across a recreate. */
	private muted = false;
	private lastCrashAt: number | null = null;
	private readonly pageUrl: string;
	private readonly log: (message: string) => void;
	private readonly now: () => number;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;

	constructor(private readonly deps: ByokVoicePageDeps) {
		this.pageUrl = appVoicePageUrl(deps.rendererUrl);
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
		// `will-download` is a Session event, not a WebContents one.
		deps.session.on?.("will-download", (event) => event?.preventDefault?.());
	}

	get isOpen(): boolean {
		return this.view !== null;
	}

	/**
	 * Whether `sender` is THIS page's own contents. The page's IPC is accepted
	 * from nothing else: the main window's renderer must not be able to inject a
	 * take or a progress report.
	 */
	owns(sender: unknown): boolean {
		return (
			this.view !== null &&
			sender !== null &&
			typeof sender === "object" &&
			sender === this.view.webContents
		);
	}

	open(): void {
		// ONE voice page: a second call is the same page, not a second one.
		if (this.view) return;
		const view = this.deps.createView({
			webPreferences: {
				partition: BYOK_VOICE_PARTITION,
				preload: this.deps.preloadPath,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				// A hidden page must keep its timers and its audio running.
				backgroundThrottling: false,
				// The page resumes its AudioContext on load with no gesture.
				autoplayPolicy: "no-user-gesture-required",
				devTools: false,
			},
		});
		this.view = view;
		const contents = view.webContents;
		this.installNavigationLock(contents);
		/*
		 * MUTE IS A PROPERTY OF THE PERSON, NOT OF THE VIEW: sent once the page's
		 * handlers exist (a message before load has no listener), so a page
		 * recreated by a pause/resume or a crash comes back as quiet as it left.
		 */
		contents.on("did-finish-load", () => {
			if (this.muted) this.send(C.mute, true);
		});
		this.installCrashRecovery(contents);
		this.log(`byok-page: loading ${this.pageUrl}`);
		void Promise.resolve(contents.loadURL(this.pageUrl)).catch((error) =>
			this.log(
				`byok-page: load failed: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}

	close(): void {
		const view = this.view;
		this.view = null;
		if (!view) return;
		try {
			// An unattached view leaks its renderer unless it is closed.
			view.webContents.close();
		} catch (error) {
			this.log(
				`byok-page: close failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	play(message: PlayMessage): void {
		this.send(C.play, message);
	}

	stop(): void {
		this.send(C.stop);
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		this.send(C.mute, muted);
	}

	prepareMicrophone(options: MicrophonePreflight = {}): Promise<QwenMicAccess> {
		return prepareMicrophoneAccess(
			{
				mediaAccess: this.deps.mediaAccess,
				setTimer: this.setTimer,
				clearTimer: this.clearTimer,
				log: this.log,
			},
			options,
		);
	}

	/** Nothing is sent with no page; a mute is remembered and re-applied on load. */
	private send(channel: string, payload?: unknown): void {
		const view = this.view;
		if (!view) return;
		try {
			view.webContents.send(channel, payload);
		} catch (error) {
			this.log(
				`byok-page: send failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/** Audio, main frame, this page's own document; deny everything else. */
	private installPermissions(): void {
		const verdict = (query: PermissionQuery): boolean =>
			appVoicePageVerdict(query, this.pageUrl);
		this.deps.session.setPermissionRequestHandler(
			(_contents, permission, callback, details) => {
				const granted = verdict({
					permission,
					mediaTypes: details?.mediaTypes,
					isMainFrame: details?.isMainFrame ?? false,
					requestingUrl: details?.requestingUrl ?? "",
				});
				if (!granted) this.log(`byok-page: denied a ${permission} request`);
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

	private installNavigationLock(contents: ByokPageWebContents): void {
		// FAIL CLOSED: an event naming no url is a navigation this page may not take.
		const block = (event: PageEvent): void => {
			const url = event?.url;
			if (typeof url === "string" && isAppVoicePageUrl(url, this.pageUrl))
				return;
			event?.preventDefault?.();
			this.log(
				`byok-page: blocked navigation to ${(url ?? "<no url>").slice(0, 200)}`,
			);
		};
		contents.on("will-navigate", block);
		contents.on("will-redirect", block);
		contents.on("will-frame-navigate", block);
		contents.setWindowOpenHandler?.(() => {
			this.log("byok-page: denied window.open");
			return { action: "deny" };
		});
	}

	private installCrashRecovery(contents: ByokPageWebContents): void {
		contents.on("render-process-gone", () => {
			if (this.view === null) return;
			this.log("byok-page: the renderer is gone");
			// A crashed WebContents still owns a process until it is closed.
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
				this.deps.onStopped("The voice page stopped");
				return;
			}
			this.open();
			this.deps.onRestarted?.();
		});
	}
}

export type { VoicePageView };
