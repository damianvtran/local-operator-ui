/**
 * The preload side of the renderer dev driver bridge.
 *
 * Called once from `src/preload/index.ts`, deliberately AFTER the app's own
 * namespaces are exposed: it is a test surface, and a failure in it must not be
 * able to take the real bridge (`window.electron`, `window.api`) down with it.
 * It learns whether this launch armed the driver from the renderer process's
 * own `argv` — the `additionalArguments` entry main puts on the window when it
 * armed — and exposes `window.__loDevDriver` only then. When main did not arm
 * (the normal case) this function returns false and the world gets nothing at
 * all: not a disabled object, not an empty namespace, no property. A page cannot
 * use what does not exist, and a test can assert its absence without knowing what
 * shape it would have had.
 *
 * Why argv and not an IPC handshake: `ipcRenderer.sendSync` to a channel with no
 * listener never answers, so the first version of this file hung the renderer in
 * an unarmed launch and the window never painted. Measured on Electron 35.5.1 —
 * see `src/main/dev-driver.ts` for the log lines. The argument is also the half
 * main cannot be handed from outside the process, and it does not weaken the
 * boundary that matters: main registers no `dev-driver-*` channel unless it
 * armed, so a page that somehow had this object would still be refused by
 * Electron.
 *
 * The verb table lives in the RENDERER (`src/renderer/src/dev-driver/install.ts`)
 * and is registered through `install()` rather than being implemented here,
 * because the verbs are the app's own code paths — stores, the router, real DOM
 * controls. Keeping them in the app's world is what stops this bridge from
 * growing into a second, parallel way to drive the UI.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
	type AddressOverlayProbeAction,
	DEV_DRIVER_ADDRESS_OVERLAY,
	DEV_DRIVER_ADDRESS_OVERLAY_EVENT,
	DEV_DRIVER_ADDRESS_OVERLAY_PROJECT,
	DEV_DRIVER_CAPTURE,
	DEV_DRIVER_FACTS,
	DEV_DRIVER_WORLD_KEY,
	readDevDriverArgument,
} from "../main/dev-driver";

/** What a scene verb is: called with an optional payload, may answer with a promise. */
export type DevDriverSceneVerb = (payload: unknown) => unknown;

export interface DevDriverBridge {
	/** Always true when this object exists; the roll-up for a driver that only wants to check. */
	armed: true;
	/** Where `capture()` writes its PNGs. */
	outDir: string;
	/** The verbs the renderer has registered so far. */
	verbs(): string[];
	/** Called by the renderer's install module; returns the full list after registering. */
	install(verbs: Record<string, DevDriverSceneVerb>): string[];
	/** Invoke a registered verb by name. Throws (in the page's world) when there is none. */
	call(name: string, payload?: unknown): unknown;
	/** Capture the app's own painted frame to `outDir` and report where it went. */
	capture(label: string): Promise<unknown>;
	/** Window facts from MAIN: mode, window vs content size, visibility, focus. */
	facts(): Promise<unknown>;
	/**
	 * S1's native overlay probe: show/hide the inert child or read structural
	 * facts. Main accepts only these three exact words and refuses the call
	 * entirely (no handler) unless the launch gate passed; the renderer side
	 * types the vocabulary, it does not grant it.
	 */
	addressOverlay(
		action: AddressOverlayProbeAction,
		argument?: unknown,
	): Promise<unknown>;
	/**
	 * S2's renderer → main projection. The argument is a display model (rows of
	 * text, an anchor rectangle, a seq); main revalidates every field before it
	 * reaches the child, and only `{seq,index}` ever comes back. Rejects with
	 * Electron's "No handler registered" in an S1-only or unarmed launch, which
	 * the renderer's port treats as "not available" and latches off.
	 */
	addressOverlayProject(payload: unknown): Promise<unknown>;
	/** Main → renderer commits and (future) lifecycle notes. Only a validated row
	 * click is sent today; the callback returns its unsubscribe. */
	onAddressOverlayEvent(callback: (event: unknown) => void): () => void;
}

function armedArgument(): { armed: true; outDir: string } | null {
	// The renderer process's own argv: Electron appends the window's
	// `additionalArguments` to it, and main only adds the entry when it armed.
	const parsed = readDevDriverArgument(process.argv);
	return parsed === null ? null : { armed: true, outDir: parsed.outDir };
}

/**
 * Install the bridge, or nothing.
 *
 * @returns true when the world received the bridge — the app's own stdout says
 * so too, and the driver script asserts it from the outside.
 */
export function installDevDriverBridge(): boolean {
	const armed = armedArgument();
	if (!armed) return false;

	const scenes = new Map<string, DevDriverSceneVerb>();

	const bridge: DevDriverBridge = {
		armed: true,
		outDir: armed.outDir,
		verbs: () => [...scenes.keys()].sort(),
		install: (verbs) => {
			const registered: string[] = [];
			for (const [name, fn] of Object.entries(verbs ?? {})) {
				if (typeof fn !== "function") {
					throw new Error(`dev driver verb "${name}" is not a function`);
				}
				scenes.set(name, fn as DevDriverSceneVerb);
				registered.push(name);
			}
			return registered.sort();
		},
		call: (name, payload) => {
			const fn = scenes.get(name);
			if (!fn) {
				throw new Error(
					`no dev driver verb "${name}" (have: ${[...scenes.keys()].sort().join(", ") || "none yet"})`,
				);
			}
			return fn(payload);
		},
		capture: (label) => ipcRenderer.invoke(DEV_DRIVER_CAPTURE, label),
		facts: () => ipcRenderer.invoke(DEV_DRIVER_FACTS),
		addressOverlay: (action, argument) =>
			ipcRenderer.invoke(DEV_DRIVER_ADDRESS_OVERLAY, action, argument),
		addressOverlayProject: (payload) =>
			ipcRenderer.invoke(DEV_DRIVER_ADDRESS_OVERLAY_PROJECT, payload),
		onAddressOverlayEvent: (callback) => {
			const listener = (_event: unknown, payload: unknown): void =>
				callback(payload);
			ipcRenderer.on(DEV_DRIVER_ADDRESS_OVERLAY_EVENT, listener);
			return () => {
				ipcRenderer.removeListener(DEV_DRIVER_ADDRESS_OVERLAY_EVENT, listener);
			};
		},
	};

	contextBridge.exposeInMainWorld(DEV_DRIVER_WORLD_KEY, bridge);
	return true;
}
