import { contextBridge, ipcRenderer } from "electron";
import type { CompanionAppearance } from "../shared/companion-skin";
import type {
	CompanionBridge,
	CompanionChatView,
	CompanionMotion,
	CompanionState,
} from "../shared/desktop-companion";

const companion: CompanionBridge = {
	onMotion: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			motion: CompanionMotion,
		) => listener(motion);
		ipcRenderer.on("companion:motion", receive);
		return () => ipcRenderer.removeListener("companion:motion", receive);
	},
	setReducedMotion: (reduced) =>
		ipcRenderer.send("companion:action", "reduced-motion", reduced),
	showMenu: () => ipcRenderer.send("companion:action", "menu"),
	showNotifications: () =>
		ipcRenderer.send("companion:action", "notifications"),
	resizeChat: (height) =>
		ipcRenderer.send("companion:action", "chat-size", height),
	getChat: () => ipcRenderer.invoke("companion:get-chat"),
	onChat: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			view: CompanionChatView,
		) => listener(view);
		ipcRenderer.on("companion:chat", receive);
		return () => ipcRenderer.removeListener("companion:chat", receive);
	},
	sendMessage: (text) => ipcRenderer.invoke("companion:send", text),
	showChatMenu: (position) =>
		ipcRenderer.invoke("companion:chat-menu", position),
	collapseChat: () => ipcRenderer.send("companion:action", "collapse-chat"),
	expandChat: () => ipcRenderer.send("companion:action", "expand-chat"),
	openTask: () => ipcRenderer.send("companion:action", "open-task"),
	getAppearance: () => ipcRenderer.invoke("companion:get-appearance"),
	onAppearance: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			appearance: CompanionAppearance,
		) => listener(appearance);
		ipcRenderer.on("companion:appearance", receive);
		return () => ipcRenderer.removeListener("companion:appearance", receive);
	},
	getState: () => ipcRenderer.invoke("companion:get-state"),
	onState: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			state: CompanionState,
		) => listener(state);
		ipcRenderer.on("companion:state", receive);
		return () => ipcRenderer.removeListener("companion:state", receive);
	},
	openChat: () => ipcRenderer.send("companion:action", "open"),
	hide: () => ipcRenderer.send("companion:action", "hide"),
	setInteractive: (value) =>
		ipcRenderer.send("companion:action", "interactive", value),
	drag: (phase) => ipcRenderer.send("companion:action", "drag", phase),
	nudge: (direction) =>
		ipcRenderer.send("companion:action", "nudge", direction),
};

contextBridge.exposeInMainWorld("companion", companion);
