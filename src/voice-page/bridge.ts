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
	onMute(handler: (muted: boolean) => void): void;
}
