import {
	VOICE_PAGE_CHANNELS as C,
	TRANSCRIPT_MAX_CHARS,
} from "../../voice-page/channels";

/**
 * The app voice page's IPC handlers (S3). Electron-free: `ipc` is injected, so
 * the sender rule is tested as plain code. Every handler first asks
 * `isPageSender`, which is true only for the live voice page's own main frame at
 * its own URL - the main window, the mini view and any other renderer are
 * refused, as is a late message from a page that has been closed.
 *
 * The page is first-party code but it is still a renderer: every value is
 * untrusted and checked here before it reaches the coordinator.
 */
export interface VoicePageIpc {
	on(
		channel: string,
		listener: (event: unknown, ...args: unknown[]) => void,
	): void;
	handle(
		channel: string,
		listener: (event: unknown, ...args: unknown[]) => unknown,
	): void;
}

export type VoicePageIpcDeps = {
	isPageSender: (event: unknown) => boolean;
	/** Verified bytes of a manifest file; rejects for any other name. */
	readModel: (name: string) => Promise<Uint8Array>;
	onTranscript: (text: string) => void;
	onStatus: (code: unknown) => void;
	onPlayback: (kind: unknown) => void;
	onVad: (kind: unknown) => void;
};

/** `<group>/<file>`, e.g. `supertonic/F1.bin`; the manifest is the real list. */
export const MODEL_NAME_SHAPE = /^[a-z]{1,16}\/[A-Za-z0-9_.-]{1,64}$/;

/** One utterance is at most 64 s; its text is far below this. */
export { TRANSCRIPT_MAX_CHARS };

export function registerVoicePageIPC(
	ipc: VoicePageIpc,
	deps: VoicePageIpcDeps,
): void {
	ipc.handle(C.model, async (event, name) => {
		if (!deps.isPageSender(event))
			throw new Error("This window cannot load voice models.");
		if (typeof name !== "string" || !MODEL_NAME_SHAPE.test(name))
			throw new Error("Unknown voice model.");
		// `readModel` refuses any name outside the pinned manifest.
		return deps.readModel(name);
	});
	ipc.on(C.transcript, (event, text) => {
		if (!deps.isPageSender(event)) return;
		if (typeof text !== "string" || text.length > TRANSCRIPT_MAX_CHARS) return;
		deps.onTranscript(text);
	});
	ipc.on(C.status, (event, code) => {
		if (deps.isPageSender(event)) deps.onStatus(code);
	});
	ipc.on(C.playback, (event, kind) => {
		if (deps.isPageSender(event)) deps.onPlayback(kind);
	});
	ipc.on(C.vad, (event, kind) => {
		if (deps.isPageSender(event)) deps.onVad(kind);
	});
}
