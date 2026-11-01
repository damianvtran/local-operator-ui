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
	type ObservationRect,
	TRANSCRIPT_OBSERVE_ARG,
	TRANSCRIPT_OBSERVE_CHANNEL,
	TRANSCRIPT_OBSERVE_LIMITS,
	type TranscriptObservationSample,
	readDevDriverArgument,
	validTranscriptObservation,
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
	// Observation grants NO world bridge or general scene/call verbs. Main
	// issued both argv entries; its independently gated IPC validates each sample.
	if (process.argv.includes(TRANSCRIPT_OBSERVE_ARG)) {
		installTranscriptObservation();
		return true;
	}

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

/**
 * Passive, fixed-seat geometry only. Install in preload, BEFORE app scripts,
 * not from a later general driver call. Mutation callbacks detect content but
 * leave layout reads to rAF; these are qualifying layout samples, NOT proof of
 * the first compositor paint. No DOM writes, input, navigation or store access.
 */
function installTranscriptObservation(): void {
	const limits = TRANSCRIPT_OBSERVE_LIMITS;
	const started = performance.now();
	let seq = 0;
	let generation = 0;
	let previousRoot: Element | null | undefined;
	let nextOrdinal = 0;
	let frame = 0;
	let lastLayout = Number.NEGATIVE_INFINITY;
	let stopped = false;
	let sending = false;
	const ordinals = new WeakMap<Element, number>();
	const late =
		document.querySelector(
			'[data-chat-region="transcript"] [data-lo-transcript-content]',
		) !== null;
	const rectangle = (element: Element): ObservationRect => {
		const r = element.getBoundingClientRect();
		return [r.x, r.y, r.width, r.height];
	};
	const base = (
		phase: TranscriptObservationSample["phase"],
	): TranscriptObservationSample => ({
		seq,
		documentGeneration: 0,
		generation,
		t: performance.now(),
		phase,
		late,
		rootCount: 0,
		viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
		scroll: [0, 0],
		rows: [],
	});
	const emit = (sample: TranscriptObservationSample): void => {
		if (
			stopped ||
			seq >= limits.samples ||
			!validTranscriptObservation(sample)
		) {
			stop();
			return;
		}
		seq++;
		// Startup phase messages are small and ordered. Geometry is one in flight
		// and never queued without bound behind a slow main process.
		if (sample.phase === "layout") sending = true;
		void ipcRenderer
			.invoke(TRANSCRIPT_OBSERVE_CHANNEL, sample)
			.catch(() => stop())
			.finally(() => {
				if (sample.phase === "layout") sending = false;
			});
	};
	const mutation = new MutationObserver(() => {
		if (stopped) return;
		if (
			!detected &&
			document.querySelector(
				'[data-chat-region="transcript"] [data-lo-transcript-content]',
			)
		) {
			detected = true;
			emit(base("transcript-detected"));
		}
	});
	let detected = false;
	const stop = (): void => {
		if (stopped) return;
		stopped = true;
		mutation.disconnect();
		cancelAnimationFrame(frame);
		clearTimeout(deadline);
		window.removeEventListener("pagehide", stop);
	};
	// Install before startup messages so every subsequent app commit is covered.
	mutation.observe(document, { childList: true, subtree: true });
	const deadline = setTimeout(stop, limits.ttlMs);
	window.addEventListener("pagehide", stop, { once: true });
	emit(base("preload-start"));
	emit(base("observer-installed"));
	if (
		document.querySelector(
			'[data-chat-region="transcript"] [data-lo-transcript-content]',
		)
	) {
		detected = true;
		emit(base("transcript-detected"));
	}
	const sampleFrame = (): void => {
		if (stopped) return;
		if (performance.now() - started >= limits.ttlMs || seq >= limits.samples) {
			stop();
			return;
		}
		if (!sending && performance.now() - lastLayout >= 16) {
			lastLayout = performance.now();
			const roots = document.querySelectorAll<HTMLElement>(
				'[data-chat-region="transcript"]',
			);
			const root = roots.length === 1 ? roots[0] : null;
			if (previousRoot !== undefined && previousRoot !== root) generation++;
			previousRoot = root;
			const sample = base("layout");
			sample.rootCount = roots.length;
			if (root) {
				sample.scroll = [root.scrollLeft, root.scrollTop];
				const rows = root.querySelectorAll<HTMLElement>(
					'[data-lo-transcript-content] [data-record-kind="user"]',
				);
				// An oversized seat is a refusal, not a truncated full-coverage claim.
				if (rows.length > limits.rows) {
					stop();
					return;
				}
				for (const row of rows) {
					if (!ordinals.has(row)) ordinals.set(row, nextOrdinal++);
					const intrinsic = row.querySelector<HTMLElement>(
						"[data-lo-user-turn-intrinsic]",
					);
					const body =
						intrinsic?.parentElement ??
						(row.querySelector<HTMLElement>(".bg-message-surface")
							?.firstElementChild as HTMLElement | null);
					const sibling = body?.nextElementSibling;
					const control = sibling?.matches("button[aria-expanded]")
						? sibling
						: null;
					const cap = body
						? Number.parseFloat(getComputedStyle(body).maxHeight)
						: Number.NaN;
					sample.rows.push({
						ordinal: ordinals.get(row) ?? 0,
						row: rectangle(row),
						body: body ? rectangle(body) : null,
						control: control ? rectangle(control) : null,
						clientHeight: body?.clientHeight ?? 0,
						scrollHeight: body?.scrollHeight ?? 0,
						maxHeight: Number.isFinite(cap) ? cap : null,
						expanded: control
							? control.getAttribute("aria-expanded") === "true"
							: null,
					});
				}
			}
			emit(sample);
		}
		if (!stopped) frame = requestAnimationFrame(sampleFrame);
	};
	frame = requestAnimationFrame(sampleFrame);
}
