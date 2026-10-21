import { contextBridge, ipcRenderer } from "electron";
import type { VoicePageBridge } from "../voice-page/bridge";
import { VOICE_PAGE_CHANNELS as C } from "../voice-page/channels";

/**
 * The voice page's one narrow preload (plan D2): the page may send a take, a
 * transcript and a VAD event up, and ask for a model by name, and receive play / stop / mute down, and can reach nothing
 * else - no `electron`, no generic `invoke`, no listener it names itself.
 * Handlers are registered by channel constant here, never by a string the page
 * supplies.
 */
const bridge: VoicePageBridge = {
	sendTake: (wav) => ipcRenderer.send(C.take, wav),
	sendVad: (kind) => ipcRenderer.send(C.vad, kind),
	loadModel: (name) => ipcRenderer.invoke(C.model, name),
	sendTranscript: (text) => ipcRenderer.send(C.transcript, text),
	onPlay: (handler) =>
		ipcRenderer.on(C.play, (_event, message) => handler(message)),
	onStop: (handler) => ipcRenderer.on(C.stop, () => handler()),
	onMute: (handler) =>
		ipcRenderer.on(C.mute, (_event, muted) => handler(muted === true)),
};

contextBridge.exposeInMainWorld("voicePage", bridge);
