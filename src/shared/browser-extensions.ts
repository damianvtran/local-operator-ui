/** Renderer projection only. Paths originate in the native chooser, never IPC input. */
export interface BrowserExtensionRow {
	key: string;
	id: string | null;
	name: string;
	version: string;
	path: string;
	enabled: boolean;
	loaded: boolean;
	error: string | null;
	permissions: string[];
	warnings: string[];
	popup: boolean;
}

export interface BrowserExtensionsState {
	rows: BrowserExtensionRow[];
	error: string | null;
}

export interface BrowserExtensionsApi {
	list: () => Promise<BrowserExtensionsState>;
	install: () => Promise<BrowserExtensionsState>;
	setEnabled: (
		key: string,
		enabled: boolean,
	) => Promise<BrowserExtensionsState>;
	remove: (key: string) => Promise<BrowserExtensionsState>;
	openPopup: (key: string) => Promise<void>;
}
