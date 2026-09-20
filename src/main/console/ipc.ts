import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { trustedDesktopFrame } from "../desktop-transport";
import type { ConsoleHost } from "./host";
import type { ConsoleSubscriber } from "./host";

/**
 * The renderer IPC surface for the console feature, and its one push channel.
 *
 * Design: docs/design/ui-console-tab.md 10.2 (the renderer-facing ops), 10.3 (the
 * data plane: a surface-keyed subscription), 8.2 (the renderer measures, main
 * decides), 2.6 (why a pty needs a fourth noun).
 *
 * THE THREE RULES ARE THE BROWSER NAMESPACE'S, VERBATIM (design 2.4/11.7, and the
 * design says the console inherits them rather than restating them):
 *
 *  1. Every handler authorizes the sender: the main window's own webContents, its
 *     main frame, and a trusted renderer URL.
 *  2. This namespace is NOT routed through `desktop-request`. That vocabulary
 *     maps to backend HTTP paths.
 *  3. The renderer never receives a session key or a capability nonce. A surface
 *     handle reaches the renderer only through a listing, and a handle is not a
 *     capability: the socket's key is what authorizes an agent, and the renderer
 *     never sees it.
 *
 * WHY A PUSH CHANNEL AT ALL (§2.6): a pty is a high-rate byte stream with a
 * request/response control plane on top, which is none of the app's three existing
 * transports. The control plane rides this namespace as invokes; the data plane is
 * one surface-keyed subscription whose frames carry the surface and a sequence
 * number, so a late frame from a stream nobody is watching cannot land on a
 * different surface's consumer.
 *
 * ONE SUBSCRIPTION PER SURFACE, held in main. `console-subscribe` answers with the
 * bytes to replay first and the offset to resume from, so the replay-then-stream
 * step is one call rather than a read that races the subscribe.
 */

export interface RegisterConsoleIpcOptions {
	window: () => BrowserWindow | null;
	/** The trusted renderer URL: the dev server during development, the packaged
	 * `index.html` otherwise. The same value the desktop transport is given. */
	expectedUrl: string;
	/** The host, or null when the console feature is off or failed to start. */
	host: () => ConsoleHost | null;
	log: (message: string) => void;
}

/** The channels this namespace owns, in one place so a test can enumerate them.
 * The first group is invoked by the renderer; the second is pushed by main. */
export const CONSOLE_IPC_CHANNELS = [
	"console-state",
	"console-create-surface",
	"console-open-pane",
	"console-close-pane",
	"console-select-surface",
	"console-input",
	"console-keys",
	"console-content-rect",
	"console-secure-toggle",
	"console-subscribe",
	"console-unsubscribe",
] as const;

/** The frames main sends to the renderer. Named separately because they are a
 * different direction: a test that enumerated them together could not tell an
 * unhandled request from an unhandled push. */
export const CONSOLE_PUSH_CHANNELS = [
	"console-output",
	"console-exit",
	"console-reveal",
	"console-state-changed",
] as const;

export function registerConsoleIpc(options: RegisterConsoleIpcOptions): void {
	function authorize(event: IpcMainInvokeEvent): ConsoleHost {
		const owner = options.window();
		if (
			!owner ||
			owner.isDestroyed() ||
			event.sender !== owner.webContents ||
			event.senderFrame !== owner.webContents.mainFrame ||
			!trustedDesktopFrame(event.senderFrame.url, options.expectedUrl)
		) {
			throw new Error("This window cannot use the console.");
		}
		const host = options.host();
		if (!host) throw new Error("The console is not running.");
		return host;
	}

	ipcMain.handle("console-state", (event, sessionId: unknown) =>
		authorize(event).state(optionalString(sessionId, "sessionId")),
	);

	/*
	 * The pane's own lifecycle, which is deliberately three calls rather than one.
	 *
	 * `console-open-pane` and `console-select-surface` tell main WHICH surface a
	 * pane is showing (a fact the app needs for the "displayed" capture case and for
	 * the blip's clearing rule), and `console-close-pane` says no pane is showing
	 * one. None of them resizes a surface: the grid changes only from a reported
	 * rect for a *visible* pane (design 8.3), which is a separate call with the
	 * pane's own measurements in it.
	 */
	/*
	 * Creating a surface from the app's own chrome.
	 *
	 * THE DESIGN'S 10.2 LIST OMITS THIS OP, and it has to exist: §16.3's UX round
	 * walks "creating a surface from the header control", and the renderer cannot
	 * reach the RPC (the session key never leaves main), so a user's surface has no
	 * other way to be born. It is the agent's `console_create` with the two
	 * differences that are the point of having two of them: the origin is `user`,
	 * and the defaults follow a user (`retain` on, §7.2). Recorded in the PR as the
	 * one op this namespace adds beyond the design's table.
	 */
	ipcMain.handle("console-create-surface", (event, request: unknown) => {
		const host = authorize(event);
		const input = request && typeof request === "object" ? request : {};
		const fields = input as Record<string, unknown>;
		const surface = host.create({
			sessionId: stringOrThrow(fields.sessionId, "sessionId"),
			origin: "user",
			cwd: typeof fields.cwd === "string" ? fields.cwd : undefined,
			command:
				typeof fields.command === "string" && fields.command.trim()
					? fields.command.trim()
					: undefined,
			cols: typeof fields.cols === "number" ? fields.cols : undefined,
			rows: typeof fields.rows === "number" ? fields.rows : undefined,
			// A user's own surface is born displayed: they asked for it from the pane
			// they are looking at, and the renderer is the one that opens the pane. No
			// `reveal` is honoured here because a renderer request cannot need to ask
			// for a pane it is already in.
			reveal: "none",
		});
		return { ...surface };
	});

	ipcMain.handle("console-open-pane", (event, surface: unknown) => {
		const host = authorize(event);
		host.setDisplayed(stringOrThrow(surface, "surface"));
		return host.state();
	});

	ipcMain.handle("console-close-pane", (event) => {
		const host = authorize(event);
		host.setDisplayed(null);
		return host.state();
	});

	ipcMain.handle("console-select-surface", (event, surface: unknown) => {
		const host = authorize(event);
		host.setDisplayed(stringOrThrow(surface, "surface"));
		return host.state();
	});

	/** Human typing. Never logged, never persisted, never readable back (design
	 * 11.4): it goes renderer -> here -> the pty master and nowhere else. */
	ipcMain.handle(
		"console-input",
		async (event, surface: unknown, text: unknown) => {
			const host = authorize(event);
			if (typeof text !== "string") {
				throw new Error("Console input must be a string.");
			}
			return host.input(stringOrThrow(surface, "surface"), { text });
		},
	);

	ipcMain.handle(
		"console-keys",
		async (event, surface: unknown, keys: unknown) => {
			const host = authorize(event);
			if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
				throw new Error("Console keys must be a list of names.");
			}
			return host.keys(stringOrThrow(surface, "surface"), keys as string[]);
		},
	);

	ipcMain.handle(
		"console-content-rect",
		(event, surface: unknown, report: unknown) => {
			const host = authorize(event);
			host.setContentRect(
				stringOrThrow(surface, "surface"),
				contentReportOrThrow(report),
			);
			return host.state();
		},
	);

	ipcMain.handle(
		"console-secure-toggle",
		(event, surface: unknown, on: unknown) => {
			const host = authorize(event);
			if (typeof on !== "boolean") {
				throw new Error("The secure toggle takes a boolean.");
			}
			return host.setSecure(stringOrThrow(surface, "surface"), on);
		},
	);

	ipcMain.handle(
		"console-subscribe",
		(event, surface: unknown, fromByte: unknown) => {
			const host = authorize(event);
			const token = stringOrThrow(surface, "surface");
			const from =
				typeof fromByte === "number" && Number.isFinite(fromByte)
					? Math.max(Math.trunc(fromByte), 0)
					: 0;
			const owner = options.window();
			// One subscriber per subscription, and it is dropped by `unsubscribe` or by
			// the pane's unmount. Frames go to the OWNED WINDOW only, and only while it
			// is alive: a frame aimed at a destroyed webContents is an exception inside
			// a timer, which is the shape that takes the app down from a renderer
			// reload.
			const subscriber: ConsoleSubscriber = {
				output: (frame) => {
					const target =
						owner && !owner.isDestroyed() ? owner.webContents : null;
					target?.send("console-output", {
						surface: frame.surface,
						seq: frame.seq,
						// Base64 rather than an array of numbers: a frame can carry a
						// megabyte, and the renderer decodes it once into a Uint8Array.
						bytes_base64: Buffer.from(frame.bytes).toString("base64"),
					});
				},
				exit: (frame) => {
					const target =
						owner && !owner.isDestroyed() ? owner.webContents : null;
					target?.send("console-exit", {
						surface: frame.surface,
						exit_code: frame.exitCode,
					});
				},
			};
			const replay = host.subscribe(token, from, subscriber);
			return {
				surface: token,
				replay_base64: Buffer.from(replay.bytes).toString("base64"),
				from_byte: replay.from,
				to_byte: replay.to,
				truncated: replay.truncated,
			};
		},
	);

	ipcMain.handle("console-unsubscribe", (event, surface: unknown) => {
		const host = authorize(event);
		// A subscription is addressed by its surface, and the pane holds exactly one
		// live subscription at a time, so this needs no id: a second subscriber for the
		// same surface would be the pane remounting, and the remount calls this first.
		host.unsubscribeAll(stringOrThrow(surface, "surface"));
		return { unsubscribed: true };
	});
}

/** Remove every handler this namespace registered.
 *
 * Needed because `ipcMain.handle` throws on a second registration for the same
 * channel, and a console host can be stopped and restarted in one process (the
 * evidence rig does exactly that). */
export function unregisterConsoleIpc(): void {
	for (const channel of CONSOLE_IPC_CHANNELS) ipcMain.removeHandler(channel);
}

function stringOrThrow(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${name} must be a non-empty string.`);
	}
	return value;
}

function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	return stringOrThrow(value, name);
}

/**
 * The pane's report, validated at the boundary.
 *
 * `cellWidth`/`cellHeight` must be positive: they are divisors, and a zero would
 * produce an infinite column count that the clamp would then quietly turn into the
 * ceiling. A rect with a zero or negative side is refused for the same reason —
 * this is untrusted input on a renderer channel, exactly like every other argument
 * on this namespace.
 */
function contentReportOrThrow(value: unknown): {
	contentRect: { x: number; y: number; width: number; height: number };
	cellWidth: number;
	cellHeight: number;
	visible: boolean;
	theme?: string | null;
} {
	if (!value || typeof value !== "object") {
		throw new Error("A console content report is required.");
	}
	const report = value as Record<string, unknown>;
	const rect = report.contentRect as Record<string, unknown> | undefined;
	if (!rect || typeof rect !== "object") {
		throw new Error("A console content report needs a contentRect.");
	}
	const numbers = ["x", "y", "width", "height"].map((key) => {
		const raw = rect[key];
		if (typeof raw !== "number" || !Number.isFinite(raw)) {
			throw new Error(`contentRect.${key} must be a number.`);
		}
		return raw;
	});
	if (numbers[2] <= 0 || numbers[3] <= 0) {
		throw new Error("A console content rect needs a positive size.");
	}
	const cellWidth = positiveNumber(report.cellWidth, "cellWidth");
	const cellHeight = positiveNumber(report.cellHeight, "cellHeight");
	if (typeof report.visible !== "boolean") {
		throw new Error("A console content report says whether it is visible.");
	}
	const theme =
		typeof report.theme === "string" || report.theme === null
			? report.theme
			: null;
	return {
		contentRect: {
			x: numbers[0],
			y: numbers[1],
			width: numbers[2],
			height: numbers[3],
		},
		cellWidth,
		cellHeight,
		visible: report.visible,
		theme,
	};
}

function positiveNumber(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive number.`);
	}
	return value;
}
