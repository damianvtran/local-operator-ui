import type { PlayMessage, VadEventKind } from "./channels";

/**
 * What the preload exposes to the page as `window.voicePage`. A type-only file
 * so the DOM-side entry and the node-side preload agree without either
 * importing the other's environment.
 */
export interface VoicePageBridge {
	sendTake(wav: Uint8Array): void;
	sendVad(kind: VadEventKind): void;
	onPlay(handler: (message: PlayMessage) => void): void;
	onStop(handler: () => void): void;
	/** Verified bytes of a manifest file; main refuses any other name. */
	loadModel(name: string): Promise<Uint8Array>;
	sendTranscript(text: string): void;
	onMute(handler: (muted: boolean) => void): void;
}
