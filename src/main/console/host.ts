import { homedir } from "node:os";
import { basename, isAbsolute } from "node:path";
import type { BrowserWindow, NativeImage } from "electron";
import { ByteLog, type ByteLogSlice } from "./byte-log";
import {
	type ConsoleEmulator,
	type ConsoleReadMode,
	createXtermEmulator,
} from "./emulator";
import { ConsoleError } from "./errors";
import type { ConsoleHistory, ConsoleHistoryMeta } from "./history";
import { NAMED_KEYS, encodeNamedKey } from "./keys";
import { type Osc133Mark, Osc133Scanner } from "./osc133";
import type {
	ConsoleReveal,
	ConsoleSurfaceListing,
	SurfaceOrigin,
} from "./protocol";
import {
	type ConsoleRegistry,
	type ConsoleRegistryEntry,
	redactSurface,
} from "./registry";

/**
 * `ConsoleHost`: the surface itself, and the eleven commands that drive it.
 *
 * Design: docs/design/ui-console-tab.md 3(a) (the topology this implements),
 * 6.4 (what "keeps running" means), 6.6 (a surface's environment), 7 (retention),
 * 8 (sizing), 10.2 (the vocabulary), 10.4 (`reveal`), 10.5 (the key encoder),
 * 10.6/15 (typed failures), 13 (the capture contract), 19.1 (P2/P5/P11/P13).
 *
 * THE THREE RULES THIS CLASS IS THE ONE PLACE FOR:
 *
 *  1. **Main owns the grid.** `cols`/`rows` are surface state; a view reports its
 *     rect and main decides (§8.1). A hidden or undisplayed surface is never
 *     resized, because nothing reports a rect for it — there is no synthetic
 *     "background viewport" here on purpose, since a terminal's size *is* its grid
 *     and a program acts on the resulting SIGWINCH (§8.3).
 *  2. **The pty's lifetime is the surface's, never the pane's.** Nothing in this
 *     file knows a pane exists except `setContentRect`/`captureFrame`, and neither
 *     can signal or resize a surface except through the grid rule above. Closing a
 *     pane is a renderer unmount that reaches main as at most a forgotten rect.
 *  3. **One emulator, in main.** The record is authoritative: `console_read`
 *     answers from it with no view present, which is R7.
 */

/** The grid a surface is born with (§6.1: the project's own evidence is produced
 * at 100x30). */
export const DEFAULT_COLS = 100;
export const DEFAULT_ROWS = 30;

/** The floor and the ceiling. §8.5: at the floor the pane crops rather than
 * shrinking the grid further, and at the ceiling it letterboxes. The ceiling is a
 * resource bound, not a UI one. */
export const MIN_COLS = 40;
export const MIN_ROWS = 10;
export const MAX_COLS = 500;
export const MAX_ROWS = 200;

/** xterm's scrollback for a surface, per §7.2. */
export const SCROLLBACK_LINES = 5000;

/** The largest single input payload a caller may hand a surface.
 *
 * node-pty's `write` is synchronous into the pty's fd, so an unbounded payload blocks
 * the app's main thread for as long as it takes to push the bytes — the same
 * starvation risk a byte flood runs in the other direction (§18.3).
 *
 * WHY 256 KiB AND NOT THE TRANSPORT'S FULL MIB: this has to sit COMFORTABLY INSIDE
 * `MAX_BODY_BYTES` (1 MiB) or the typed refusal is unreachable — a payload past the
 * transport's own cap is answered by a dropped request rather than by an error a
 * caller can read (measured: the socket closes with no response). A quarter of the
 * body cap leaves room for the JSON envelope and keeps `input_queue_full` the thing a
 * caller actually sees, which is what a typed taxonomy is for. 256 KiB is still three
 * orders of magnitude above anything typed, so a payload past it is a mistake or a
 * dump. */
export const MAX_INPUT_BYTES = 1 << 18;

/** How long output frames are coalesced before delivery (§10.3). Coalescing is a
 * view concern: the log is append-per-read and never batched, and this timer only
 * bounds how many IPC frames a fast producer creates. */
export const OUTPUT_COALESCE_MS = 16;

/**
 * How long a retained surface's newest bytes may sit in memory before they reach
 * disk, and the byte count that forces the write sooner (§7.2/§7.4).
 *
 * WHY NOT ONE WRITE PER CHUNK, which is what this was: persisting a chunk is
 * `appendFileSync` + `statSync` + two `chmodSync` for the log and
 * `writeFileSync` + `renameSync` + two more `chmodSync` for the sidecar, and it
 * ran on the main thread for EVERY pty read. Measured on this tree (400 × 8 KiB
 * chunks, fake pty, real `ConsoleHistory`): 2454 ms and 2909 ms retained against
 * 146 ms unretained — ~6-7 ms of synchronous I/O per chunk, a ~20x slower
 * producer paid by whichever process is drawing the app's windows. Retain is ON
 * by default for a user's surface (§7.2), so that was the default case.
 *
 * The bound is a timer AND a byte count, because each covers a case the other
 * does not: the timer keeps a slow trickle durable (a shell prompt must survive a
 * crash within a quarter of a second), and the byte count stops a flood from
 * holding megabytes in memory while it waits for the timer. `flush` is also
 * called outright at every point the bytes must be durable NOW — `close`,
 * `dispose`, an exit, a secure toggle — so the coalescing is a bound on the
 * ordinary path and never a hole in the durability boundary.
 */
export const PERSIST_FLUSH_MS = 250;
export const PERSIST_FLUSH_BYTES = 256 * 1024;

/** The shortest a frame may be before it is treated as the blank first frame a
 * hidden window returns. Measured in the compatibility spike: a stale/blank first
 * capture came back 9,866 B against 27,869 B for the settled frame at the same
 * size. The threshold sits well under the small end and well above "empty", so it
 * catches a blank frame without re-capturing a legitimately tiny one. */
export const MIN_FRAME_BYTES = 2_000;

/** How long to wait before the single retry. The spike's stale frame was the
 * *first* capture of a hidden window; one compositor beat later it was correct. */
export const FRAME_RETRY_DELAY_MS = 120;

/** How long a closing surface's process is given to honour SIGTERM before it is
 * killed outright (§6.7). */
export const CLOSE_GRACE_MS = 1_500;

/** The environment markers a program can read to tell which console it is in
 * (§6.5), and the two variables a driven surface must not lose (§6.6). */
export const SURFACE_ENV_MARKER = "LOCAL_OPERATOR_CONSOLE_SURFACE";
export const SESSION_ENV_MARKER = "LOCAL_OPERATOR_CONSOLE_SESSION";
export const SURFACE_TERM = "xterm-256color";
export const SURFACE_COLORTERM = "truecolor";

/** The families stripped from a driven surface's environment (§6.6). `CMUX_*` is
 * always stripped — an inherited workspace id has already renamed the operator's
 * real cmux workspaces from a test run. `LOP_*` is stripped from the default and
 * may be set explicitly by the creator. */
export const STRIPPED_ENV_PREFIXES = ["CMUX_", "LOP_"];

/** What the pane reports about the box it is drawing into (§8.2), and the theme
 * it is drawing with (§9.1). The theme is the renderer's, echoed back rather than
 * decided here. */
export interface ConsoleContentRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ConsoleContentReport {
	contentRect: ConsoleContentRect;
	/** The mirror's own measured cell metrics. */
	cellWidth: number;
	cellHeight: number;
	/** Whether the pane is actually on screen. A pane that is mounted but hidden
	 * reports false and no grid is derived from it (a rect nobody can see must not
	 * resize a program). */
	visible: boolean;
	theme?: string | null;
}

/** A subscriber to one surface's byte stream (§10.3). */
export interface ConsoleSubscriber {
	output(frame: { surface: string; seq: number; bytes: Uint8Array }): void;
	exit(frame: { surface: string; exitCode: number }): void;
}

export interface ConsoleHostOptions {
	/** The app's window, for `capturePage`. A getter, because the host outlives
	 * neither the window nor the app's quit path. */
	window: () => BrowserWindow | null;
	log: (message: string) => void;
	/** Persistence, or null when the app has no config root to write into. */
	history: ConsoleHistory | null;
	/**
	 * How to start a surface's process.
	 *
	 * Injected so this class never imports node-pty: the native load and the
	 * spawn-helper heal live in `pty.ts`, and a test injects a fake process instead
	 * of spawning a real shell for every assertion about the registry or the grid.
	 */
	spawn: (options: SpawnOptions) => PtyHandle;
	/** The environment a surface inherits from, defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	/** Called for each OSC 133 mark (§12.1 rung 2). PR B's blip and notifier are
	 * its consumers; nothing in this file acts on a mark itself. */
	onMark?: (surface: string, mark: Osc133Mark) => void;
	/** Called whenever something a listing or the record reports has changed. */
	onChanged?: () => void;
	/**
	 * Called when a create asked for a pane (`reveal`), so the app can push the
	 * request to its own renderer (design 10.4).
	 *
	 * A callback rather than a direct `webContents.send` because the decision this
	 * host *can* make (may the window be focused? no — it may not) is not the
	 * decision the renderer makes (is that session the one on screen?). The host
	 * resolves the half it owns and reports the effective intent; the renderer
	 * applies the half it owns and never raises the OS window either way.
	 */
	onReveal?: (request: {
		surface: string;
		sessionId: string;
		mode: ConsoleReveal;
	}) => void;
}

/** The pieces one surface owns. Exported because the registry that holds them is
 * built by the startup path, and a private type there would make the two halves of
 * one structure disagree the day a field is added. */
export interface SurfaceRuntime {
	/** The process handle, or null for a surface reconstructed from history: it
	 * has no pty and never gets one (§7.3). */
	pty: PtyHandle | null;
	log: ByteLog;
	emulator: ConsoleEmulator;
	scanner: Osc133Scanner;
	subscribers: Set<ConsoleSubscriber>;
	/** Output waiting to be coalesced into one frame per subscriber. */
	pending: Uint8Array[];
	pendingTimer: NodeJS.Timeout | null;
	/** The armed flush of this surface's retained bytes (§7.2). One timer per
	 * surface, so a second chunk joins the pending write instead of adding one. */
	persistTimer: NodeJS.Timeout | null;
	/** The sequence number the next output frame carries. */
	seq: number;
	/** The pane's last report, and where `console_screenshot` crops. */
	rect: ConsoleContentReport | null;
	/** The theme the pane last reported, echoed by `console_screenshot`. */
	theme: string | null;
	/** The most recent completion mark, for the blip the pane renders. */
	lastMark: Osc133Mark | null;
	/** Set once the exit has been delivered, so one exit produces one frame. */
	exitDelivered: boolean;
	/** Settled by the exit handler, so a close can report the exit code it
	 * caused rather than always answering without one. */
	exitWaiters: Array<(exitCode: number) => void>;
}

/** The slice of node-pty this host uses, structurally typed so a test can drive
 * the host with a fake pty and no native module. */
export interface PtyHandle {
	readonly pid: number;
	onData(listener: (data: string) => void): void;
	onExit(listener: (event: { exitCode: number }) => void): void;
	/**
	 * A string node-pty encodes as UTF-8, or raw bytes it copies through.
	 *
	 * BYTES FOR ANYTHING THAT ARRIVED AS BYTES: a caller's payload is decoded to a
	 * string and re-encoded by node-pty on the way to the pty, and that round trip
	 * is lossy for anything that is not valid UTF-8 (the same defect this seam had
	 * in the other direction). A terminal is not a place to lose bytes, so the
	 * byte-shaped callers hand over a buffer and nothing re-encodes it.
	 */
	write(data: string | Uint8Array): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
}

export interface CreateSurfaceOptions {
	sessionId: string;
	origin: SurfaceOrigin;
	cwd?: string;
	command?: string;
	args?: string[];
	input?: string;
	env?: Record<string, string>;
	cols?: number;
	rows?: number;
	reveal?: ConsoleReveal;
	retain?: boolean;
	sizing?: "auto" | "fixed";
}

/** What the spawn seam is handed. `PtyHandle` is what it must return. */
export interface SpawnOptions {
	file: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
	cols: number;
	rows: number;
}

export interface CreateSurfaceResult {
	surface: string;
	cols: number;
	rows: number;
	pid: number;
	live: boolean;
	revealed: boolean;
	reveal: ConsoleReveal;
}

export class ConsoleHost {
	private readonly registry: ConsoleRegistry<SurfaceRuntime>;
	private readonly options: ConsoleHostOptions;
	private readonly now: () => number;
	private readonly env: NodeJS.ProcessEnv;

	constructor(
		registry: ConsoleRegistry<SurfaceRuntime>,
		options: ConsoleHostOptions,
	) {
		this.registry = registry;
		this.options = options;
		this.now = options.now ?? (() => Date.now() / 1000);
		this.env = options.env ?? process.env;
	}

	/** How many surfaces exist, and how many of them an agent made. The record's
	 * own two numbers (§10.1). */
	counts(): { total: number; agent: number } {
		const all = this.registry.list();
		return {
			total: all.length,
			agent: all.filter((entry) => entry.record.origin === "agent").length,
		};
	}

	/**
	 * Create a surface.
	 *
	 * THE ORDER OF THE FIVE STEPS MATTERS and is why this is one method: the record
	 * exists before the spawn (so a failed spawn still has a handle to report), the
	 * runtime is attached only after the spawn succeeded, and a spawn failure
	 * removes the record rather than leaving a surface that lists as running.
	 */
	create(options: CreateSurfaceOptions): CreateSurfaceResult {
		const cols = options.cols ?? DEFAULT_COLS;
		const rows = options.rows ?? DEFAULT_ROWS;
		// The clamp is the internal safety net, not the caller's feedback: the wire
		// refuses an out-of-range grid with `invalid_grid` and the clamp it would have
		// applied, so a caller is told rather than quietly given something else.
		const grid = clampGrid(cols, rows);
		const command = options.command?.trim() || defaultShell(this.env);
		const args = options.args ?? [];
		const cwd = resolveCwd(options.cwd);
		const entry = this.registry.create({
			sessionId: options.sessionId,
			origin: options.origin,
			command: basename(command),
			argvTail: args.join(" "),
			cwd,
			cols: grid.cols,
			rows: grid.rows,
			// The design's default (§7.2): a user's surface is retained, an agent's is
			// not — an agent that floods a surface should not fill the disk by default,
			// and a user who opened one wants it next launch.
			retain: options.retain ?? options.origin === "user",
			sizing: options.sizing ?? "auto",
		});
		const surface = entry.record.surface;
		const env = surfaceEnvironment({
			base: this.env,
			sessionId: options.sessionId,
			surface,
			overrides: options.env,
		});
		// The spawn is wrapped so a refusal is TYPED and so the record this method
		// just wrote is removed: a surface that lists as running while nothing is
		// running is the defect this ordering exists to prevent. A helper rather than
		// a `try` around a `let`, because the value is assigned exactly once.
		const startProcess = (): PtyHandle => {
			try {
				return this.options.spawn({
					file: command,
					args,
					cwd,
					env,
					cols: grid.cols,
					rows: grid.rows,
				});
			} catch (error) {
				this.registry.remove(surface);
				throw new ConsoleError(
					"console_unavailable",
					`the surface's process could not start: ${error instanceof Error ? error.message : String(error)}`,
					{ reason: "spawn_failed" },
				);
			}
		};
		const pty = startProcess();
		const runtime: SurfaceRuntime = {
			pty,
			log: new ByteLog(),
			emulator: createXtermEmulator({
				cols: grid.cols,
				rows: grid.rows,
				scrollback: SCROLLBACK_LINES,
			}),
			scanner: new Osc133Scanner(),
			subscribers: new Set(),
			pending: [],
			pendingTimer: null,
			persistTimer: null,
			seq: 0,
			rect: null,
			theme: null,
			lastMark: null,
			exitDelivered: false,
			exitWaiters: [],
		};
		this.registry.attach(surface, runtime);

		pty.onData((data) => this.consume(surface, data));
		pty.onExit((event) => this.exited(surface, event.exitCode));

		// The initial input is written after the listeners exist, so a program that
		// answers immediately cannot beat the record.
		if (options.input) pty.write(options.input);

		if (entry.record.retain) this.flush(surface);
		this.options.log(
			`[console] surface ${redactSurface(surface)} started: ${basename(command)} in ${cwd} at ${grid.cols}x${grid.rows} (${options.origin})`,
		);
		this.options.onChanged?.();

		const reveal = this.resolveReveal(options.reveal ?? "none");
		if (reveal !== "none") {
			this.options.onReveal?.({
				surface,
				sessionId: options.sessionId,
				mode: reveal,
			});
		}
		return {
			surface,
			cols: grid.cols,
			rows: grid.rows,
			pid: pty.pid,
			live: true,
			// `reveal` is the intent after the focus rule; `revealed` says whether a
			// pane was asked for at all. They differ exactly when `reveal: "open"` was
			// downgraded because raising the window is not something this app does
			// (design 10.4), and a caller that cannot tell the two apart would believe
			// the user was shown something they were not.
			reveal,
			revealed: reveal !== "none",
		};
	}

	/**
	 * The half of `reveal` this process owns: whether the app's window is already
	 * focused (design 10.4).
	 *
	 * `show`/`showInactive`/`focus` live in `window-raise.ts` alone, and
	 * `scripts/window-mode.test.mjs` asserts it — so a `reveal: "open"` that would
	 * have to raise the window is downgraded here rather than at the renderer. The
	 * renderer's half (is the wanted session the one on screen?) is not a question
	 * main can answer, and it is exactly why `reveal: "session"` is forwarded rather
	 * than resolved.
	 */
	private resolveReveal(mode: ConsoleReveal): ConsoleReveal {
		if (mode !== "open") return mode;
		const window = this.options.window();
		if (window && !window.isDestroyed() && window.isFocused()) return "open";
		return "none";
	}

	/**
	 * Adopt a surface reconstructed from persisted history (§7.3).
	 *
	 * It is `live: false` from birth, has no pty and never gets one, and its bytes
	 * are replayed into a fresh record so `console_read` and the pane both show what
	 * the surface printed. The listing says so, which is the whole honesty
	 * requirement: nothing here pretends a process is running.
	 */
	restore(meta: ConsoleHistoryMeta, bytes: Uint8Array): void {
		const existing = this.registry.list(meta.session_id);
		if (existing.some((entry) => entry.record.surface === meta.surface)) return;
		const grid = clampGrid(meta.cols, meta.rows);
		const entry = this.registry.create({
			// The handle the history recorded, so a caller holding one across a relaunch
			// finds the same surface rather than a lookalike with a new nonce.
			surface: meta.surface,
			sessionId: meta.session_id,
			origin: meta.origin,
			command: meta.command,
			argvTail: meta.argv.join(" "),
			cwd: meta.cwd,
			cols: grid.cols,
			rows: grid.rows,
			retain: true,
			sizing: "auto",
		});
		// THE TWO FACTS THE SIDECAR OWNS AND A FRESH RECORD DOES NOT, seeded before
		// anything can rewrite them (§7.3). `created_at` is the one durable record of
		// when this surface was made, and `persist()` writes "now" when it does not
		// know better, so a close after a relaunch used to overwrite the original
		// create's timestamp. `exit_epoch` is the exit generation, and a relaunch
		// that restarted it at 1 would collide the second exit with the first in
		// §12.3's `(surface, exit_epoch)` key.
		this.createdAt.set(
			meta.surface,
			Number.isFinite(meta.created_at) ? meta.created_at : this.now(),
		);
		this.exitEpoch.set(
			meta.surface,
			Number.isFinite(meta.exit_epoch) ? meta.exit_epoch : 0,
		);
		const emulator = createXtermEmulator({
			cols: grid.cols,
			rows: grid.rows,
			scrollback: SCROLLBACK_LINES,
		});
		// Replay, not deserialize: the headless build ships no `addon-serialize`, and
		// the design does not need one (§5.4/§7.1). The retained window is 4 MiB, so
		// the parse is bounded and paid once.
		emulator.write(bytes);
		const runtime: SurfaceRuntime = {
			// A reconstructed surface has no pty. `null` rather than a fake process:
			// every path that would signal one checks `running` first, and the record
			// says `running: false` for this surface forever.
			pty: null,
			log: new ByteLog(),
			emulator,
			scanner: new Osc133Scanner(),
			subscribers: new Set(),
			pending: [],
			pendingTimer: null,
			persistTimer: null,
			seq: 0,
			rect: null,
			theme: null,
			lastMark: null,
			exitDelivered: true,
			exitWaiters: [],
		};
		runtime.log.append(bytes);
		this.registry.attach(entry.record.surface, runtime);
		this.registry.update(entry.record.surface, {
			running: false,
			exitCode: meta.exit_code,
			live: false,
			lastActivity: meta.last_seen_at,
		});
	}

	/** Every surface, optionally one session's, as the wire reports it. */
	list(sessionId?: string): ConsoleSurfaceListing[] {
		return this.registry.list(sessionId).map((entry) => this.listing(entry));
	}

	private listing(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
	): ConsoleSurfaceListing {
		const record = entry.record;
		return {
			surface: record.surface,
			session_id: record.sessionId,
			origin: record.origin,
			command: record.command,
			argv_tail: record.argvTail,
			cwd: record.cwd,
			cols: record.cols,
			rows: record.rows,
			running: record.running,
			exit_code: record.exitCode,
			last_activity: record.lastActivity,
			live: record.live,
			agent_owned: record.origin === "agent",
		};
	}

	/** `console_status`. */
	status(surface: string): Record<string, unknown> {
		const entry = this.registry.require(surface);
		const runtime = entry.runtime;
		const grid = runtime?.emulator.grid;
		return {
			running: entry.record.running,
			exit_code: entry.record.exitCode,
			// The retention layer's counter, bumped once per `process_exited` (§7.3,
			// §10.2). Read from the host's live view of it: the sidecar is what makes
			// it survive a relaunch, and this is what the running process reports.
			exit_epoch: this.exitEpoch.get(surface) ?? 0,
			cols: entry.record.cols,
			rows: entry.record.rows,
			live: entry.record.live,
			truncated: runtime?.log.truncated ?? false,
			modes: grid?.modes ?? null,
			cursor: grid?.cursor ?? null,
			last_activity: entry.record.lastActivity,
			retain: entry.record.retain,
			secure: entry.record.secure,
			// §6.6 asks `console_status` to report "the marker it set and the glyph
			// decision, so the behaviour is observable rather than inferred". The
			// marker is this process's own (§6.6's env table, set in
			// `surfaceEnvironment`); the glyph DECISION is the Python side's predicate
			// (`is_local_operator_console` → `_nerd_capable_terminal`, §6.6), which
			// runs in the session that reads this record rather than here, so it is
			// reported by PR C's side and named there.
			env_marker: { name: SURFACE_ENV_MARKER, value: surface },
		};
	}

	/**
	 * `console_read`: text from the record, with no view present (R7).
	 *
	 * `whenIdle` first, because the pinned emulator parses asynchronously: a read
	 * answered from a grid one chunk behind is exactly the staleness an agent-driven
	 * read cannot detect (see `emulator.ts`).
	 */
	async read(
		surface: string,
		mode: ConsoleReadMode,
		window?: { start?: number; count?: number },
	): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry);
		this.refuseWhenSecure(entry);
		await runtime.emulator.whenIdle();
		const grid = runtime.emulator.grid;
		return {
			text: runtime.emulator.text(mode, window),
			cols: grid.cols,
			rows: grid.rows,
			cursor: grid.cursor,
			truncated: runtime.log.truncated,
			live: entry.record.live,
			mode,
		};
	}

	/**
	 * `console_screenshot`: the app's own window, cropped to the pane's reported
	 * rect, photographed with `capturePage` (design 13.2's first row).
	 *
	 * WHAT THIS DOES NOT DO, and it is the design's own first cut item (§17.3): the
	 * offscreen capture view — a hidden renderer replaying the record — is PR B's
	 * (§17.1), so a surface with no displayed pane is refused with
	 * `capture_unavailable` rather than answered with a frame that would not be of
	 * that surface. The `rendered` field is kept so the gap is visible instead of
	 * implied.
	 *
	 * The assert-and-retry is the spike's measured trap and not a hopeful
	 * `setTimeout`: on a hidden window the FIRST `capturePage` came back blank
	 * (9,866 B against 27,869 B for the settled frame), and a headless rig — which
	 * is what every capture in this repo runs in — is exactly that case.
	 */
	async screenshot(surface: string): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry);
		this.refuseWhenSecure(entry);
		const report = runtime.rect;
		if (this.displayed !== surface || !report || !report.visible) {
			throw new ConsoleError(
				"capture_unavailable",
				"no pane is displaying this surface, and this app version cannot reconstruct a frame offscreen",
				{ rendered: null },
			);
		}
		const window = this.options.window();
		if (!window || window.isDestroyed()) {
			throw new ConsoleError(
				"capture_unavailable",
				"this app's window is not available to photograph",
				{ rendered: null },
			);
		}
		const rect = cropToWindow(report.contentRect, window.getContentBounds());
		const png = await this.captureWithRetry(window, rect);
		const grid = runtime.emulator.grid;
		return {
			image_base64: png.toString("base64"),
			cols: grid.cols,
			rows: grid.rows,
			// Named, not implied (13.2): this frame is a photograph of the app's own
			// window, so it is what a person is looking at rather than a
			// reconstruction of the record.
			rendered: "displayed",
			theme: runtime.theme,
			live: entry.record.live,
		};
	}

	private async captureWithRetry(
		window: BrowserWindow,
		rect: ConsoleContentRect,
	): Promise<Buffer> {
		// Encoded once per attempt rather than once per check: the discriminator is
		// the PNG's length, and encoding a frame twice to ask a question about it
		// would cost more than the capture that produced it.
		const first = framePng(await window.webContents.capturePage(rect));
		if (first.length >= MIN_FRAME_BYTES) return first;
		await delay(FRAME_RETRY_DELAY_MS);
		return framePng(await window.webContents.capturePage(rect));
	}

	/**
	 * `console_input`: bytes into the pty.
	 *
	 * `paste` wraps the payload in the bracketed-paste guards **only when the
	 * record's LIVE mode says so** (§10.5), which is why this is a main-side
	 * decision: the mode is read at the moment of the call, from the record.
	 */
	async input(
		surface: string,
		payload: { text?: string; bytes?: Uint8Array; paste?: boolean },
	): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry);
		this.requireRunning(entry);
		const raw = payload.bytes ?? ENCODER.encode(payload.text ?? "");
		if (raw.length > MAX_INPUT_BYTES) {
			// Refused BEFORE anything reaches the pty, so "accepted: 0 bytes" is the
			// truth rather than a partial write the caller cannot reason about.
			//
			// `accepted` is §10.6's key, and it means bytes the host TOOK — the size of
			// the refused payload belongs in the message, not under a key whose name a
			// reader could take for a count of what was written.
			throw new ConsoleError(
				"input_queue_full",
				`that payload is ${raw.length} bytes and this surface accepts ${MAX_INPUT_BYTES} at a time`,
				{ accepted: 0, limit: MAX_INPUT_BYTES },
			);
		}
		const bracketed =
			payload.paste === true && runtime.emulator.grid.modes.bracketedPaste;
		const bytes = bracketed ? wrapBracketedPaste(raw) : raw;
		this.writeToPty(entry, runtime, bytes);
		return { accepted: true, bytes: bytes.length };
	}

	/** `console_keys`: named keys through the one encoder (§10.5). */
	async keys(
		surface: string,
		names: string[],
	): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry);
		this.requireRunning(entry);
		await runtime.emulator.whenIdle();
		const modes = runtime.emulator.grid.modes;
		// Encode the WHOLE list before writing any of it. A refusal halfway through a
		// chord would leave the program in a state the caller did not ask for and
		// cannot undo, and `unknown_key` is a caller mistake rather than a partial
		// success.
		const encoded = names.map((name) =>
			encodeNamedKey(name, {
				applicationCursorKeys: modes.applicationCursorKeys,
				applicationKeypad: false,
			}),
		);
		const unknown = names.find((_name, index) => encoded[index] === null);
		if (unknown !== undefined) {
			throw new ConsoleError(
				"unknown_key",
				`unknown key ${JSON.stringify(unknown)}; accepted: ${NAMED_KEYS.join(", ")}`,
				{ accepted: [...NAMED_KEYS], key: unknown },
			);
		}
		const sequences: string[] = [];
		for (const bytes of encoded) {
			if (!bytes) continue;
			this.writeToPty(entry, runtime, bytes);
			sequences.push(Buffer.from(bytes).toString("latin1"));
		}
		// `encoded` is the SEQUENCES the encoder produced, which is what §10.2's row
		// names — not the names the caller sent back to it. A caller asking for
		// `ctrl+c` gets what this surface's LIVE modes make of it, which is the
		// question a caller who sent a chord cannot answer itself. Latin-1 is the
		// spelling because a named key encodes to escape sequences: one byte per
		// character, so the string the wire carries is exactly the bytes sent.
		return { accepted: true, encoded: sequences };
	}

	/**
	 * `console_resize`: the explicit writer, and the only one besides a displayed
	 * pane's rect (§8.4).
	 */
	resize(surface: string, cols: number, rows: number): Record<string, unknown> {
		const entry = this.registry.require(surface);
		if (entry.record.sizing === "fixed") {
			throw new ConsoleError(
				"invalid_grid",
				"this surface was created with a fixed grid; create another one to resize",
				// §10.6 reads `reason: "fixed"` here and no clamp: there is no clamp
				// to carry for a surface that cannot be resized at all.
				{ reason: "fixed" },
			);
		}
		this.applyGrid(entry, cols, rows);
		return { cols: entry.record.cols, rows: entry.record.rows };
	}

	/** The pane's report: measurement in, grid decision out (§8.2). */
	setContentRect(surface: string, report: ConsoleContentReport): void {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry);
		runtime.rect = report;
		runtime.theme = report.theme ?? null;
		// A pane that is not visible measures a box nobody is looking at. Its rect is
		// still remembered for a capture (the pane IS displaying the surface), but no
		// grid is derived from it — which is what keeps a hidden surface's grid stable
		// (§8.3).
		if (!report.visible) return;
		// AND A REPORT FROM A PANE THAT IS NOT THE DISPLAYED ONE CANNOT MOVE A GRID
		// (§8.3). A rect is a renderer-supplied measurement; §8.3's guarantee
		// ("a hidden or undisplayed surface cannot oscillate") would otherwise rest
		// on the reporter's own honesty about which surface it is showing. The rect
		// and the theme are still remembered — a capture is itself gated on
		// `displayed` — but the grid decision waits for the pane that is on screen.
		if (this.displayed !== surface) return;
		if (entry.record.sizing === "fixed") return;
		if (!(report.cellWidth > 0) || !(report.cellHeight > 0)) return;
		const cols = Math.floor(report.contentRect.width / report.cellWidth);
		const rows = Math.floor(report.contentRect.height / report.cellHeight);
		if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
		this.applyGrid(entry, cols, rows);
	}

	/** The pane unmounted or switched surface: forget the rect, and send no resize
	 * and no signal (§6.4, §8.3). */
	forgetContentRect(surface: string): void {
		const entry = this.registry.require(surface);
		if (entry.runtime) entry.runtime.rect = null;
	}

	/** `console_secure`: the explicit "do not capture this" switch (§11.4.4). */
	setSecure(surface: string, on: boolean): Record<string, unknown> {
		const entry = this.registry.require(surface);
		this.registry.update(surface, { secure: on });
		if (on && entry.runtime) {
			// The span suspends NEW appends; it does not delete what is already there
			// (§11.4.4: "bytes already retained are kept … otherwise turning the
			// toggle on and off would be a way to erase the log, which is the opposite
			// of what it is for"). This used to call `log.clear()`, which dropped the
			// retained bytes, set `truncated` from a SWITCH rather than from the cap,
			// and made a pane remount replay nothing — while the durable file kept the
			// pre-toggle bytes, so the two representations §7.1 promises are the same
			// history disagreed.
			//
			// The residual worth stating: the record still holds what a person can see,
			// and a cooperating agent that reads after the window closes would see it —
			// which is why the refusal is documented as advisory (§11.4.4).
			this.options.log(
				`[console] secure input on for ${redactSurface(surface)}: new bytes are not retained until it is off`,
			);
		}
		this.flush(surface);
		this.options.onChanged?.();
		return { secure: on };
	}

	/**
	 * `console_close`. `kill` signals; without it the surface is only forgotten,
	 * which is what closing a surface whose process already exited means.
	 *
	 * `retain` overrides the record's own default in both directions: a user may
	 * close a surface and keep its history, an agent may close one and drop it.
	 */
	async close(
		surface: string,
		options: { kill?: boolean; retain?: boolean } = {},
	): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		const runtime = entry.runtime;
		if (options.retain !== undefined) {
			this.registry.update(surface, { retain: options.retain });
		}
		let exitCode = entry.record.exitCode;
		if (runtime && entry.record.running) {
			// A RUNNING surface is always signalled, and `kill: false` is refused
			// rather than honoured: the alternative is a pty nobody owns, still
			// writing into a record this call is about to discard. That refusal is the
			// point of honouring the flag at all — silently ignoring it would be worse
			// than either answer.
			if (options.kill === false) {
				throw new ConsoleError(
					"busy",
					`${redactSurface(surface)} is still running; close it with kill: true, or wait for its process to exit`,
					{ running: true },
				);
			}
			exitCode = (await this.terminate(entry)) ?? exitCode;
		}
		if (!entry.record.retain) {
			this.options.history?.remove(entry.record.sessionId, surface);
		} else {
			this.flush(surface);
		}
		this.drop(surface);
		this.options.log(
			`[console] surface ${redactSurface(surface)} closed${exitCode === null ? "" : ` with exit ${exitCode}`}${entry.record.retain ? " (history retained)" : ""}`,
		);
		return exitCode === null
			? { closed: true }
			: { closed: true, exit_code: exitCode };
	}

	/**
	 * Signal a surface and wait for its exit, with the design's bounded grace and a
	 * SIGKILL after it (§6.7, the session-deleted row).
	 *
	 * WHY IT WAITS AT ALL: an exit code is the whole evidence that a close did
	 * something, and a close that returned before the process was gone would report
	 * "closed" while the program was still writing into a pty whose surface had
	 * already been dropped. The bound matters for the same reason — a process that
	 * ignores SIGTERM must not hold the RPC call open, so it is escalated rather
	 * than waited on.
	 */
	private async terminate(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
	): Promise<number | null> {
		const pty = entry.runtime?.pty ?? null;
		// NO PTY, NO WAITER. A surface reconstructed from history has no process, and
		// a surface whose process has already gone has nothing left to signal: arming
		// a resolver here left one nobody settles, and the call then waited out the
		// whole grace before answering null for an exit that had already happened.
		// A close of such a surface reports the exit code the record already carries.
		if (!pty) return null;
		const exit = new Promise<number>((resolve) => {
			entry.runtime?.exitWaiters.push(resolve);
		});
		pty.kill();
		const code = await Promise.race([
			exit,
			delay(CLOSE_GRACE_MS).then(() => null),
		]);
		if (code === null) pty.kill("SIGKILL");
		return code;
	}

	/** Subscribe a pane to one surface's stream, replaying from `fromByte` (§10.3).
	 *
	 * Returns the bytes the subscriber must replay first, and the offset to resume
	 * streaming from, so the two-step is one call rather than a race between a read
	 * and a subscribe. */
	subscribe(
		surface: string,
		fromByte: number,
		subscriber: ConsoleSubscriber,
	): ByteLogSlice {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry);
		const replay = runtime.log.read(fromByte);
		runtime.subscribers.add(subscriber);
		// Replay covers everything up to the log's end, and the frames that follow
		// carry bytes from there — exactly the "next byte the surface emits" the
		// design promises, with no window in which a byte is delivered twice or lost.
		return replay;
	}

	/** Stop delivering to one subscriber. Idempotent. */
	unsubscribe(surface: string, subscriber: ConsoleSubscriber): void {
		this.registry.find(surface)?.runtime?.subscribers.delete(subscriber);
	}

	/** Drop every subscriber of one surface: the pane unmounted or switched away.
	 * `find`, because a pane can unsubscribe while the surface is being closed. */
	unsubscribeAll(surface: string): void {
		this.registry.find(surface)?.runtime?.subscribers.clear();
	}

	/**
	 * Which surface a pane is displaying, or null for none (§10.2's pane ops).
	 *
	 * This is a FACT the app reports, not a lever: it never resizes a surface, and
	 * the pane's own measurements arrive separately. What it buys is the honest
	 * `rendered: "displayed"` value on a capture and the answer to "is anybody
	 * looking at this surface", which is the blip's clearing rule (§12.2).
	 */
	setDisplayed(surface: string | null): void {
		if (surface !== null) this.registry.require(surface);
		this.displayed = surface;
		if (surface === null) {
			// No pane is showing anything, so no surface has a current rect. The
			// forgetting is not a resize: the grid each surface kept is the one it
			// keeps (design 6.4's second invariant).
			for (const entry of this.registry.list()) {
				if (entry.runtime) entry.runtime.rect = null;
			}
		}
		this.options.onChanged?.();
	}

	/** The surface a pane is displaying, or null. */
	get displayedSurface(): string | null {
		return this.displayed;
	}

	private displayed: string | null = null;

	/** The renderer-facing state: what a pane, a blip or a Settings surface reads. */
	state(sessionId?: string): Record<string, unknown> {
		const counts = this.counts();
		return {
			available: true,
			total: counts.total,
			agent: counts.agent,
			displayed_surface: this.displayed,
			surfaces: this.registry.list(sessionId).map((entry) => ({
				...this.listing(entry),
				secure: entry.record.secure,
				retain: entry.record.retain,
				sizing: entry.record.sizing,
				displayed: entry.record.surface === this.displayed,
				last_mark: entry.runtime?.lastMark ?? null,
			})),
		};
	}

	/** Producer of the surface's own output: the pty's data, in order. This is the
	 * ONE place bytes enter the surface, which is why the log, the record, the
	 * scanner and the subscribers cannot disagree about the stream. */
	private consume(surface: string, data: string): void {
		// `find`: bytes in flight when a surface closes arrive here after its entry is
		// gone, and that is a drop rather than an error.
		const entry = this.registry.find(surface);
		const runtime = entry?.runtime;
		if (!entry || !runtime) return;
		// UTF-8, NOT "binary". The pty's own socket is set to decode UTF-8
		// (`node-pty/lib/unixTerminal.js` → `_socket.setEncoding('utf8')`), so `data`
		// is a decoded STRING and every non-ASCII code point is already one character.
		// Reading it as latin1 truncated each one to its low byte: measured on this
		// tree, `printf '日本'` delivered `e6 97 a5 e6 9c ac` from the pty and the log
		// received `e5 2c` — silently, with no error and no `truncated` flag, so all
		// non-ASCII output was lost at the one place bytes enter the surface.
		//
		// The split-sequence half is node-pty's, and it is load-bearing: its decoder is
		// stateful across reads (measured here — `printf '\346\227'; sleep 0.3;
		// printf '\245\346\234\254'` arrives as ONE well-formed "日本"), so a character
		// split across two chunks never reaches this line as two broken halves. A
		// future pty that hands over raw bytes instead must carry a streaming decoder
		// with it; decoding each chunk independently would corrupt exactly there.
		const bytes = Buffer.from(data, "utf8");
		// The record is fed always; only the LOG is skipped while secure, because the
		// log is what is durably retained (§11.4.4). A record that skipped the bytes
		// would put main out of step with the pane, which is the one thing the
		// single-authority rule forbids.
		runtime.emulator.write(new Uint8Array(bytes));
		if (!entry.record.secure) runtime.log.append(new Uint8Array(bytes));
		for (const mark of runtime.scanner.feed(new Uint8Array(bytes))) {
			runtime.lastMark = mark;
			this.options.onMark?.(surface, mark);
		}
		this.registry.update(surface, { lastActivity: this.now() });
		if (entry.record.retain) this.schedulePersist(entry, runtime);
		this.broadcast(entry, runtime, new Uint8Array(bytes));
	}

	/** Coalesce output for one event-loop tick, then deliver one frame per
	 * subscriber (§10.3: batching is a delivery concern, never the log's). */
	private broadcast(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		runtime: SurfaceRuntime,
		bytes: Uint8Array,
	): void {
		if (runtime.subscribers.size === 0) return;
		runtime.pending.push(bytes);
		if (runtime.pendingTimer) return;
		// NOT unref'd, for `delay`'s reason: this timer is what delivers a coalesced
		// frame to subscribers, and an idle loop must not be able to drop it.
		runtime.pendingTimer = setTimeout(() => {
			runtime.pendingTimer = null;
			const pending = runtime.pending;
			runtime.pending = [];
			if (pending.length === 0) return;
			const joined = concat(pending);
			runtime.seq += 1;
			const frame = {
				surface: entry.record.surface,
				seq: runtime.seq,
				bytes: joined,
			};
			for (const subscriber of runtime.subscribers) subscriber.output(frame);
		}, OUTPUT_COALESCE_MS);
		runtime.pendingTimer.unref?.();
	}

	private exited(surface: string, exitCode: number): void {
		// `find`, not `require`: an exit can land after its surface was closed, and
		// an event handler that threw would be an unhandled exception inside a pty
		// callback rather than a refusal anybody could read.
		const entry = this.registry.find(surface);
		if (!entry || !entry.runtime) return;
		this.registry.update(surface, {
			running: false,
			exitCode,
			lastActivity: this.now(),
		});
		// The generation is bumped BEFORE anything is written or delivered, because
		// every consumer of it keys on it: the sidecar stores it (§7.3) and §12.3's
		// notifier dedupes on `(surface, exit_epoch)`. It is the retention layer's
		// counter, so it is bumped through the history's own arithmetic rather than
		// by adding one here.
		this.bumpExitEpoch(entry);
		if (entry.record.retain) this.flush(surface);
		const runtime = entry.runtime;
		for (const waiter of runtime.exitWaiters.splice(0)) waiter(exitCode);
		if (!runtime.exitDelivered) {
			runtime.exitDelivered = true;
			for (const subscriber of runtime.subscribers) {
				subscriber.exit({ surface, exitCode });
			}
		}
		this.options.log(
			`[console] surface ${redactSurface(surface)} exited ${exitCode}`,
		);
		this.options.onChanged?.();
	}

	/** Apply a grid change: clamp, compare, and only then touch the record and the
	 * pty — so one clamp-crossing is one `TIOCSWINSZ` and one `SIGWINCH` (§8.2). */
	private applyGrid(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		cols: number,
		rows: number,
	): void {
		const grid = clampGrid(cols, rows);
		if (grid.cols === entry.record.cols && grid.rows === entry.record.rows)
			return;
		this.registry.update(entry.record.surface, {
			cols: grid.cols,
			rows: grid.rows,
		});
		entry.runtime?.emulator.resize(grid.cols, grid.rows);
		if (entry.record.running) entry.runtime?.pty?.resize(grid.cols, grid.rows);
		this.options.log(
			`[console] surface ${redactSurface(entry.record.surface)} resized ${grid.cols}x${grid.rows}`,
		);
		this.options.onChanged?.();
	}

	private writeToPty(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		runtime: SurfaceRuntime,
		bytes: Uint8Array,
	): void {
		// Bytes, handed over as bytes. This was `Buffer.from(bytes).toString("binary")`,
		// and node-pty then re-encoded that string as UTF-8 — so a payload of
		// `e6 97 a5 0a` (`日` and a newline) reached the program as `c3 a6 c2 97 c2 a5
		// 0a`: every byte above 0x7F doubled into a two-byte sequence, on BOTH the
		// `bytes` and the `text` path, because both funnel through here.
		runtime.pty?.write(bytes);
		this.registry.update(entry.record.surface, { lastActivity: this.now() });
	}

	private requireRuntime(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
	): SurfaceRuntime {
		if (!entry.runtime) {
			throw new ConsoleError(
				"console_unavailable",
				`${redactSurface(entry.record.surface)} has no runtime in this app run`,
				{ reason: "no_runtime" },
			);
		}
		return entry.runtime;
	}

	private requireRunning(entry: ConsoleRegistryEntry<SurfaceRuntime>): void {
		if (!entry.record.running) {
			throw new ConsoleError(
				"process_exited",
				`${redactSurface(entry.record.surface)} has exited${entry.record.exitCode === null ? "" : ` with code ${entry.record.exitCode}`}; its output is still readable`,
				// `retain`, not `live`, is §10.6's key for this code: the consumer's
				// sentence says whether the log is retained, and a caller looking for
				// `retain` would find nothing if this carried `live` instead.
				{ exit_code: entry.record.exitCode, retain: entry.record.retain },
			);
		}
	}

	private refuseWhenSecure(entry: ConsoleRegistryEntry<SurfaceRuntime>): void {
		if (entry.record.secure) {
			throw new ConsoleError(
				"secure_input_active",
				`${redactSurface(entry.record.surface)} is in secure input; reads and captures are refused until it is turned off`,
				{ secure: true },
			);
		}
	}

	/**
	 * Write one retained surface's pending bytes and, when it moved, its sidecar.
	 *
	 * THE BYTES ARE THE SPINE and the sidecar is the exception. Every call appends
	 * whatever the log has that disk does not — one `appendFileSync` for the whole
	 * pending window rather than one per chunk — and the sidecar is rewritten only
	 * when one of its own fields actually changed. It used to be rewritten on every
	 * chunk, which is a staged write, a rename and two `chmod`s per pty read for a
	 * document whose fields move about once a second; the signature below is what
	 * keeps a durable `last_seen_at` without paying that.
	 */
	private persist(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		runtime: SurfaceRuntime,
	): void {
		const history = this.options.history;
		if (!history) return;
		const surface = entry.record.surface;
		const record = entry.record;
		const meta: ConsoleHistoryMeta = {
			surface,
			session_id: record.sessionId,
			origin: record.origin,
			command: record.command,
			argv: record.argvTail ? record.argvTail.split(" ") : [],
			cwd: record.cwd,
			cols: record.cols,
			rows: record.rows,
			// The creation time is the record's own first `last_activity`; a sidecar is
			// rewritten rather than appended, so it carries what is true now. A surface
			// restored from history seeded this from the sidecar it came from, so a
			// relaunch cannot rewrite its own creation time (§7.3).
			created_at: this.createdAt.get(surface) ?? this.now(),
			last_seen_at: record.lastActivity,
			exit_code: record.exitCode,
			truncated: runtime.log.truncated,
			exit_epoch: this.exitEpoch.get(surface) ?? 0,
		};
		if (!this.createdAt.has(surface))
			this.createdAt.set(surface, meta.created_at);
		if (!this.persistedBytes.has(surface)) this.persistedBytes.set(surface, 0);
		const already = this.persistedBytes.get(surface) ?? 0;
		const end = runtime.log.endOffset;
		if (end > already) {
			const slice = runtime.log.read(already);
			// `append` may rotate, which sets `meta.truncated` — so the meta is written
			// AFTER the append and its signature computed from the post-append value.
			history.append(record.sessionId, surface, slice.bytes, meta);
			this.persistedBytes.set(surface, slice.to);
		}
		const signature = metaSignature(meta);
		if (this.metaSignatures.get(surface) === signature) return;
		history.writeMeta(meta);
		this.metaSignatures.set(surface, signature);
	}

	/**
	 * Flush a surface's pending bytes and sidecar NOW.
	 *
	 * Called at every point the coalescing must not be observable: `close`,
	 * `dispose`, a process exit, a secure toggle, and the create that writes the
	 * first sidecar. Also the seam a test drives the durable state through without
	 * waiting a quarter of a second.
	 */
	flush(surface: string): void {
		const entry = this.registry.find(surface);
		const runtime = entry?.runtime;
		if (!entry || !runtime) return;
		if (runtime.persistTimer) {
			clearTimeout(runtime.persistTimer);
			runtime.persistTimer = null;
		}
		// A surface with retain OFF has no history to write, and this check is what
		// keeps the public flush from being a way AROUND §7.2: every internal caller
		// reaches it (a secure toggle, a close), so without this line a non-retained
		// surface would quietly acquire a byte log and a sidecar the moment its
		// secure switch moved.
		if (!entry.record.retain) return;
		this.persist(entry, runtime);
	}

	/**
	 * Hand the newest bytes to the bounded flush (§7.2's cap, §18.3's starvation).
	 *
	 * A threshold crossing flushes immediately and a trickle waits for the timer,
	 * which is the two cases this has to get right: a flood must not hold megabytes
	 * in memory, and a single prompt line must be on disk without waiting for the
	 * next byte to arrive. Neither path writes per chunk, which is the defect this
	 * exists to close.
	 */
	private schedulePersist(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		runtime: SurfaceRuntime,
	): void {
		const surface = entry.record.surface;
		const pending =
			runtime.log.endOffset - (this.persistedBytes.get(surface) ?? 0);
		if (pending >= PERSIST_FLUSH_BYTES) {
			this.flush(surface);
			return;
		}
		if (runtime.persistTimer) return;
		// Deliberately NOT unref'd: a pending window is unsaved history, and the one
		// timer that would write it should keep the loop alive until it has.
		runtime.persistTimer = setTimeout(() => {
			runtime.persistTimer = null;
			this.flush(surface);
		}, PERSIST_FLUSH_MS);
	}

	/**
	 * The surface's next exit generation (§7.3).
	 *
	 * The arithmetic lives in the retention layer (`ConsoleHistory.nextExitEpoch`)
	 * because the sidecar is the only place a generation SURVIVES a relaunch: a
	 * surface replayed under its own handle and run again must report generation 2
	 * on its second exit, and a counter kept here alone would start at 1 again. This
	 * method is the in-process half — the value the running host reports through
	 * `console_status` — and the max() in the history is what keeps the two from
	 * disagreeing when a write was lost.
	 */
	private bumpExitEpoch(entry: ConsoleRegistryEntry<SurfaceRuntime>): number {
		const surface = entry.record.surface;
		const live = this.exitEpoch.get(surface) ?? 0;
		const next =
			this.options.history?.nextExitEpoch(
				entry.record.sessionId,
				surface,
				live,
			) ?? live + 1;
		this.exitEpoch.set(surface, next);
		return next;
	}

	/** Forget a surface: its runtime, its record and its subscribers. The ONE
	 * removal path, so the registry and the runtime map cannot drift. */
	private drop(surface: string): void {
		const entry = this.registry.require(surface);
		const runtime = entry.runtime;
		if (runtime) {
			if (runtime.pendingTimer) clearTimeout(runtime.pendingTimer);
			if (runtime.persistTimer) clearTimeout(runtime.persistTimer);
			runtime.subscribers.clear();
			runtime.emulator.dispose();
			// NO signal here. Every caller that drops a RUNNING surface has already
			// ended its process (`close` terminates, `dispose` kills), and a second
			// kill from this path was measured as a duplicate SIGTERM on a process the
			// close had already escalated to SIGKILL.
		}
		this.registry.remove(surface);
		this.createdAt.delete(surface);
		this.persistedBytes.delete(surface);
		this.metaSignatures.delete(surface);
		this.exitEpoch.delete(surface);
		this.options.onChanged?.();
	}

	/** Stop everything: every pty, every record, every subscriber. */
	dispose(): void {
		for (const entry of this.registry.clear()) {
			const runtime = entry.runtime;
			if (!runtime) continue;
			if (runtime.pendingTimer) clearTimeout(runtime.pendingTimer);
			if (runtime.persistTimer) clearTimeout(runtime.persistTimer);
			runtime.subscribers.clear();
			// THE LAST FLUSH IS THE POINT OF THE FLUSH: bytes still inside the pending
			// window when the app quits are the one thing the coalescing must never
			// lose, and this path used to write the SIDECAR only — so with a bounded
			// flush it would have dropped the last quarter-second of every retained
			// surface. It runs before the kill so the process's final bytes are
			// already in the log either way (a pty that emits after this write lands
			// nothing, which is the durability boundary §7.4 states rather than a
			// promise this makes).
			if (entry.record.retain) this.persist(entry, runtime);
			if (entry.record.running) runtime.pty?.kill();
			runtime.emulator.dispose();
		}
		this.createdAt.clear();
		this.persistedBytes.clear();
		this.metaSignatures.clear();
		this.exitEpoch.clear();
	}

	/** Creation times, kept here rather than on the wire record: nothing outside
	 * this class reads them, and the record is what a listing serialises. */
	private readonly createdAt = new Map<string, number>();

	/** How many bytes of each surface's log have been written to disk, so an append
	 * never re-writes what is already there. */
	private readonly persistedBytes = new Map<string, number>();

	/** The last sidecar content written per surface, so an unchanged document is
	 * not rewritten on every flush. */
	private readonly metaSignatures = new Map<string, string>();

	/** Each surface's exit generation, seeded from the sidecar on restore (§7.3). */
	private readonly exitEpoch = new Map<string, number>();
}

/**
 * The fields a sidecar rewrite is worth doing for.
 *
 * `last_seen_at` is floored to a whole second on purpose: it moves with every
 * byte, so comparing it exactly would rewrite the document on every flush and put
 * the synchronous cost straight back. The rest are the fields §7.3's sidecar
 * exists to carry — the exit code, the truncation flag, the grid, the generation —
 * and a change in any of them is a change a reader can see.
 */
function metaSignature(meta: ConsoleHistoryMeta): string {
	return [
		meta.exit_code,
		meta.truncated,
		meta.cols,
		meta.rows,
		meta.exit_epoch,
		Math.floor(meta.last_seen_at),
	].join("|");
}

/** Clamp a requested grid to the floor and the ceiling (§8.5). */
export function clampGrid(
	cols: number,
	rows: number,
): { cols: number; rows: number } {
	return {
		cols: clamp(
			Number.isFinite(cols) ? Math.floor(cols) : DEFAULT_COLS,
			MIN_COLS,
			MAX_COLS,
		),
		rows: clamp(
			Number.isFinite(rows) ? Math.floor(rows) : DEFAULT_ROWS,
			MIN_ROWS,
			MAX_ROWS,
		),
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * A surface's environment (§6.6).
 *
 * The two markers are what let a *program* tell which console it is in — the only
 * mechanism that works for a program not talking to us. `TERM` and `COLORTERM`
 * are not decoration: `COLORTERM=truecolor` is the standard signal a TUI reads to
 * decide whether to emit 24-bit colour, and the design deliberately reaches the
 * glyph decision through the console's OWN marker rather than by impersonating
 * ghostty, which would also flip the notifier's protocol for every process in the
 * surface.
 */
export function surfaceEnvironment(input: {
	base: NodeJS.ProcessEnv;
	sessionId: string;
	surface: string;
	overrides?: Record<string, string>;
}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(input.base)) {
		if (value === undefined) continue;
		if (STRIPPED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)))
			continue;
		env[key] = value;
	}
	env.TERM = SURFACE_TERM;
	env.COLORTERM = SURFACE_COLORTERM;
	env[SURFACE_ENV_MARKER] = input.surface;
	env[SESSION_ENV_MARKER] = input.sessionId;
	// The creator's own overrides come last, and may re-add a stripped `LOP_*`:
	// the strip is about what a surface inherits, not about what its creator asked
	// for explicitly. `CMUX_*` is not in that category — nothing about a console
	// surface may carry another multiplexer's workspace identity.
	for (const [key, value] of Object.entries(input.overrides ?? {})) {
		env[key] = value;
	}
	return env;
}

/** The shell a surface runs when the caller names no command: the user's own,
 * falling back to zsh (what the spike drove). */
export function defaultShell(env: NodeJS.ProcessEnv): string {
	const shell = env.SHELL?.trim();
	// A shell that is not an absolute path is not a shell this app will exec: the
	// value comes from the environment, and a relative one would resolve against
	// whatever directory the app happens to be in.
	if (shell && isAbsolute(shell)) return shell;
	return "/bin/zsh";
}

/** A cwd the caller named, or the user's home. Not the app's own cwd: an app
 * launched from `/` or from a bundle would otherwise open a shell there. */
export function resolveCwd(cwd: string | undefined): string {
	const wanted = cwd?.trim();
	if (wanted && isAbsolute(wanted)) return wanted;
	return homedir();
}

/** Wrap a payload for a program that has enabled bracketed paste (§10.5). */
export function wrapBracketedPaste(bytes: Uint8Array): Uint8Array {
	const start = new TextEncoder().encode("\x1b[200~");
	const end = new TextEncoder().encode("\x1b[201~");
	const out = new Uint8Array(start.length + bytes.length + end.length);
	out.set(start, 0);
	out.set(bytes, start.length);
	out.set(end, start.length + bytes.length);
	return out;
}

/** Crop a rect to a window's content bounds; a rect outside them would make
 * `capturePage` return a frame of nothing. */
export function cropToWindow(
	rect: ConsoleContentRect,
	bounds: { x: number; y: number; width: number; height: number },
): ConsoleContentRect {
	const x = Math.max(Math.floor(rect.x), 0);
	const y = Math.max(Math.floor(rect.y), 0);
	return {
		x,
		y,
		width: Math.max(Math.min(Math.floor(rect.width), bounds.width - x), 1),
		height: Math.max(Math.min(Math.floor(rect.height), bounds.height - y), 1),
	};
}

/** A frame's PNG bytes, refusing an empty one.
 *
 * The measured trap (design 13.2): on a hidden window the FIRST `capturePage`
 * came back blank at 9,866 B where the settled frame was 27,869 B. An empty image
 * is not a frame at all and is answered as `capture_unavailable` rather than as
 * zero pixels. */
export function framePng(image: NativeImage): Buffer {
	return image.isEmpty() ? Buffer.alloc(0) : image.toPNG();
}

/** One encoder for this module: the input path encodes a string per call, and a
 * payload is small enough that the allocation is the whole cost. */
const ENCODER = new TextEncoder();

/**
 * A delay that KEEPS THE PROCESS ALIVE, which is the whole point of it.
 *
 * The first version `unref()`d the timer, and that is a promise that can be
 * stranded: an awaited unref'd timer does not hold the event loop open, so a
 * process whose only pending work is this delay drains its loop, the await never
 * settles, and node's test runner cancels whatever was waiting on it —
 * measured in CI as `cancelledByParent` with "Promise resolution is still
 * pending but the event loop has already resolved", on the capture retry below.
 * Three call sites depend on it settling: the capture retry, and the close grace
 * that races a pty's exit.
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
