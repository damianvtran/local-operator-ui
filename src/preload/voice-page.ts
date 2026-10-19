import { contextBridge, ipcRenderer } from "electron";
import type { VoicePageBridge } from "../voice-page/bridge";
import { VOICE_PAGE_CHANNELS as C } from "../voice-page/channels";

/**
 * The voice page's one narrow preload (plan D2): the page may send a take and
 * a VAD event up and receive play / stop / mute down, and can reach nothing
 * else - no `electron`, no generic `invoke`, no listener it names itself.
 * Handlers are registered by channel constant here, never by a string the page
 * supplies.
 */
const bridge: VoicePageBridge = {
	sendTake: (wav) => ipcRenderer.send(C.take, wav),
	sendVad: (kind) => ipcRenderer.send(C.vad, kind),
	onPlay: (handler) =>
		ipcRenderer.on(C.play, (_event, message) => handler(message)),
	onStop: (handler) => ipcRenderer.on(C.stop, () => handler()),
	onMute: (handler) =>
		ipcRenderer.on(C.mute, (_event, muted) => handler(muted === true)),
};

contextBridge.exposeInMainWorld("voicePage", bridge);
