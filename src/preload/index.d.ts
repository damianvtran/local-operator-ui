import type { ElectronAPI } from "@electron-toolkit/preload";

declare global {
	interface Window {
		electron: ElectronAPI;
		api: {
			openFile: (filePath: string) => Promise<void>;
			openExternal: (url: string) => Promise<void>;
		};
	}
}
