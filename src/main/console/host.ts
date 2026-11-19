import { randomUUID } from "node:crypto";
import { homedir, constants as osConstants } from "node:os";
import { basename, isAbsolute } from "node:path";
import type { BrowserWindow, NativeImage } from "electron";
import { defaultShell } from "../shell-path";
import { ByteLog, type ByteLogSlice } from "./byte-log";
import { hasTerminalContent } from "./capture";
import {
	type ConsoleEmulator,
	type ConsoleGridState,
	type ConsoleReadMode,
	createXtermEmulator,
} from "./emulator";
import { ConsoleError } from "./errors";
import type { ConsoleHistory, ConsoleHistoryMeta } from "./history";
import { NAMED_KEYS, encodeNamedKey } from "./keys";
import type { NativeCapacity } from "./native-capacity";
import { type Osc133Mark, Osc133Scanner } from "./osc133";
import {
	CELL_BUDGET,
	CELL_RESERVATION_BYTES,
	EXIT_ACK_GRACE_MS,
	HISTORY_CACHE_ENTRIES,
	LOG_BUDGET_BYTES,
	LOG_RESERVATION_BYTES,
	MANAGED_BUDGET_BYTES,
	PENDING_BUDGET_BYTES,
} from "./policy";
import type {
	ConsoleReveal,
	ConsoleSurfaceListing,
	SurfaceOrigin,
} from "./protocol";
import {
	type ConsoleActor,
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
 * THE LIVE VIEW'S CEILING, in bytes of coalesced-but-undelivered output per surface.
 *
 * WHY IT EXISTS (memory-bounding round). `broadcast` pushes every chunk into a per-surface
 * `pending` array and delivers it on a 16 ms timer. Every other structure on this path is
 * bounded — the byte log is a ring, the sidecar is staged and flushed, the emulator has a
 * scrollback — but `pending` had no cap at all, so its size was a function of how far behind
 * a subscriber had fallen: a renderer that stopped draining, or a main thread blocked long
 * enough that the coalescing timer could not run, grew it without limit while the pty kept
 * producing at whatever rate the host allowed.
 *
 * WHY THE POLICY IS DROP-OLDEST-RATHER-THAN-PAUSE-THE-PTY. The design's own mitigation for
 * this risk (§19.1 P3) names backpressure on the pty read side, and pausing the pty is not
 * available here: `consume` is the pty's only reader, so a paused pty stops the byte log,
 * the sidecar flush and the emulator too — the RECORD would fall out of step with the pane,
 * which is the single-authority rule (§10) that the pane is a mirror of main's grid. So the
 * one thing that may be dropped is the thing that is already a copy: this buffer feeds a
 * live view, and the durable record is the byte log and its sidecar, which keep receiving
 * every byte. A drop here costs the pane a frame and a re-attach, never the log of record.
 *
 * 1 MiB, against a 16 ms coalescing window: a subscriber that has a megabyte of undelivered
 * output queued is not going to be saved by the next megabyte, and the newest bytes are what
 * a viewer needs (the prompt a program just printed, not the scrollback it printed before).
 * The floor is one chunk, so a single frame larger than the ceiling is still delivered rather
 * than silently vanishing.
 */
export const LIVE_PENDING_MAX_BYTES = 1 << 20;

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

/** How long to wait before the single retry. The spike's stale frame was the
 * *first* capture of a hidden window; one compositor beat later it was correct. */
export const FRAME_RETRY_DELAY_MS = 120;

/** How long a closing surface's process is given to honour SIGTERM before it is
 * killed outright (§6.7). */
export const CLOSE_GRACE_MS = 1_500;

/**
 * How long the QUIT path waits for an exit after SIGKILL.
 *
 * A killed process is gone; this only bounds the event loop's delivery of
 * `onExit`, which is why it is far shorter than the SIGTERM grace. The two
 * bounds together are the most a quit may spend per surface, and they run
 * ACROSS surfaces rather than one after another (`dispose`), so ten terminals
 * cost one bound rather than ten.
 */
export const QUIT_EXIT_CAPTURE_MS = 400;

/**
 * node-pty's exit signal as a POSIX name (Q-3), or null.
 *
 * `onExit` reports `{exitCode, signal}`; a killed pty reports code 0, so without
 * this field a SIGKILL is indistinguishable from a clean exit. The number is
 * mapped through the platform's own table rather than a second hard-coded list,
 * and an unknown number still gets a token (`SIG9`) instead of being dropped.
 */
function signalName(signal: number | string | undefined): string | null {
	if (typeof signal === "string") {
		if (signal.length === 0) return null;
		return signal.startsWith("SIG") ? signal : `SIG${signal}`;
	}
	if (typeof signal !== "number" || signal <= 0) return null;
	for (const [name, number] of Object.entries(osConstants.signals))
		if (number === signal) return name;
	return `SIG${signal}`;
}

/** The SIGTERM grace inside the AWAITED quit budget (m-1).
 *
 * The app holds quit for ~1.5 s (the session-cookie hold). The close path's own
 * grace plus the capture window added up to 2 s, so the final persist could land
 * after the app had finished waiting. This pair fits the whole quit inside 1.3 s:
 * 0.9 s for the signal, then 0.4 s for `onExit` to arrive.
 */
export const QUIT_SIGNAL_GRACE_MS = 900;

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
	exit(frame: {
		surface: string;
		exitCode: number;
		exitSignal?: string | null;
	}): void;
}

export interface ConsoleHostOptions {
	/** The app's window, for `capturePage`. A getter, because the host outlives
	 * neither the window nor the app's quit path. */
	window: () => BrowserWindow | null;
	log: (message: string) => void;
	/** Persistence, or null when the app has no config root to write into. */
	history: ConsoleHistory | null;
	/**
	 * How to photograph a surface with no displayed pane (§13.2's second and third
	 * rows): the capture view, which PR B owns.
	 *
	 * Injected rather than imported because the capture view is a hidden RENDERER —
	 * a second process with its own lifecycle, its own one-at-a-time rule and its
	 * own teardown — and a host that constructed one would make `console_screenshot`
	 * a different kind of operation from every other method here. A host with no
	 * capture view answers the honest typed refusal instead, which is what the pane's
	 * own tests do.
	 */
	captureOffscreen?: (request: {
		surface: string;
		cols: number;
		rows: number;
		theme: string | null;
		bytes: Uint8Array;
	}) => Promise<{ png: Buffer; renderer: string; attempts: number }>;
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
	/** Production probes THIS app's native limits; fake-PTY tests inject facts. */
	nativeCapacity?: () => NativeCapacity;
	/** Called for each OSC 133 mark (§12.1 rung 2). PR B's blip and notifier are
	 * its consumers; nothing in this file acts on a mark itself. */
	onMark?: (surface: string, mark: Osc133Mark) => void;
	/**
	 * Called once per surface when its process exits (§12.1 rung 1), which is the
	 * one completion signal that is always available.
	 *
	 * SEPARATE FROM `onChanged`, WHICH ALSO FIRES HERE, and that is the whole
	 * reason it exists: the app's banner needs the exit's own facts — which
	 * surface, which session, which code — and a consumer that had to recover them
	 * by diffing two listings would be a second reader of state this call already
	 * holds, wrong for exactly one frame in the case where the surface is dropped
	 * between the two reads. It is delivered after the record is updated and after
	 * the subscribers have been told, so every reader of the surface sees the same
	 * exit. */
	onExit?: (event: {
		surface: string;
		sessionId: string;
		exitCode: number;
		exitSignal: string | null;
	}) => void;
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
	/** `pending`'s own byte count, maintained as it is appended and trimmed so the
	 * ceiling is a comparison rather than a sum over the array on every chunk. */
	pendingBytes: number;
	/** Bytes dropped from `pending` because a subscriber fell behind. Reported by
	 * `console_status` beside the log's `truncated`, so a lossy live view is a fact a
	 * caller can read rather than a frame that quietly never arrived.
	 *
	 * MONOTONIC: it accumulates for the life of the surface and is never reset, so a
	 * reader compares two readings rather than treating a number as "how far behind the
	 * pane is right now" — a pane that caught up still reports the bytes it missed. */
	droppedLiveBytes: number;
	droppedGridBytes: number;
	activeReaders: number;
	archivedReplay: boolean;
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
	onExit(
		listener: (event: { exitCode: number; signal?: number | string }) => void,
	): void;
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
	private rollbackDisposals: ConsoleRegistryEntry<SurfaceRuntime>[] = [];
	// Acquisition precedes runtime construction/registry adoption. Keep the exact
	// emulator until adoption succeeds; startup rollback must also own that gap.
	private readonly unboundRestoreEmulators = new Set<ConsoleEmulator>();
	/** Unlike the app-process instance ID, this changes for each console host. */
	private readonly hostEpoch = randomUUID();
	private readonly startedAt: number;
	// Keep failed releases owned and fail closed on further admission. Losing a
	// thrown cleanup reference would make its native usage invisible to the cap.
	private readonly failedAllocations = new Set<{
		pty: PtyHandle | null;
		emulator: ConsoleEmulator | null;
	}>();

	private releaseFailedAllocation(allocation: {
		pty: PtyHandle | null;
		emulator: ConsoleEmulator | null;
	}): unknown[] {
		const failures: unknown[] = [];
		if (allocation.pty) {
			// No usable handle was published for this failed launch. A cooperative
			// TERM could be ignored forever; only this newly acquired PTY is killed.
			try {
				allocation.pty.kill("SIGKILL");
				allocation.pty = null;
			} catch (error) {
				failures.push(error);
			}
		}
		if (allocation.emulator) {
			try {
				allocation.emulator.dispose();
				allocation.emulator = null;
			} catch (error) {
				failures.push(error);
			}
		}
		if (!allocation.pty && !allocation.emulator)
			this.failedAllocations.delete(allocation);
		return failures;
	}
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
		this.startedAt = this.now();
		this.env = options.env ?? process.env;
		registry.refusalMetrics = () => this.resources();
	}

	/** How many surfaces exist, and how many of them an agent made. The record's
	 * own two numbers (§10.1). */
	counts() {
		const all = this.registry.list();
		return {
			total: all.length,
			agent: all.filter((entry) => entry.record.origin === "agent").length,
			live: all.filter((entry) => entry.record.running).length,
			archived: all.filter((entry) => !entry.record.running).length,
			maxLive: this.registry.policy.maxLive,
			hostEpoch: this.hostEpoch,
			startedAt: this.startedAt,
			generation: this.registry.metrics().generation,
			sampledAt: this.now(),
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
		/*
		 * NO CREATE DURING DISPOSAL (m-2). The dispose settle is where a create used
		 * to be silently dropped: the registry was still publishing, the caller got a
		 * handle, and the teardown then cleared it. Refusing by name is the honest
		 * answer and it is what the pane's create-refused state already renders.
		 */
		if (this.disposing)
			throw new ConsoleError(
				"console_unavailable",
				"The console host is shutting down",
				{ reason: "host_disposing" },
			);
		if (this.failedAllocations.size)
			throw new ConsoleError(
				"console_unavailable",
				"A failed console allocation still owns resources pending cleanup",
				{ reason: "allocation_cleanup_pending", metrics: this.resources() },
			);
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
		let pty: PtyHandle | null = null;
		let emulator: ConsoleEmulator | null = null;
		try {
			// Creation provenance is assigned by trusted code at this boundary:
			// RPC hardcodes agent; only authorized renderer/internal code uses user.
			// Existing records' origins NEVER choose a subsequent caller context.
			this.requireResourceBudget(options.origin === "user" ? "user" : "agent");
			const env = surfaceEnvironment({
				base: this.env,
				sessionId: options.sessionId,
				surface,
				overrides: options.env,
			});
			// Preserve the typed spawn refusal; the enclosing rollback owns every
			// reservation and acquired resource, including attach-before/after faults.
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
					throw new ConsoleError(
						"console_unavailable",
						`the surface's process could not start: ${error instanceof Error ? error.message : String(error)}`,
						{ reason: "spawn_failed" },
					);
				}
			};
			pty = startProcess();
			emulator = createXtermEmulator({
				cols: grid.cols,
				rows: grid.rows,
				scrollback: SCROLLBACK_LINES,
			});
			const runtime: SurfaceRuntime = {
				pty,
				log: new ByteLog(),
				emulator,
				scanner: new Osc133Scanner(),
				subscribers: new Set(),
				pending: [],
				pendingBytes: 0,
				droppedLiveBytes: 0,
				droppedGridBytes: 0,
				activeReaders: 0,
				archivedReplay: false,
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
			pty.onExit((event) =>
				this.exited(surface, event.exitCode, signalName(event.signal)),
			);

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
		} catch (error) {
			// One reservation, one removal, even when attach bound the runtime
			// before throwing. Only this allocation's acquired resources are owned.
			const removed = this.registry.remove(surface);
			if (removed?.runtime) {
				if (removed.runtime.pendingTimer)
					clearTimeout(removed.runtime.pendingTimer);
				if (removed.runtime.persistTimer)
					clearTimeout(removed.runtime.persistTimer);
				removed.runtime.subscribers.clear();
			}
			const allocation = { pty, emulator };
			this.failedAllocations.add(allocation);
			const failures = this.releaseFailedAllocation(allocation);
			if (failures.length)
				throw new AggregateError(
					[error, ...failures],
					"Console allocation failed and its cleanup remains pending",
				);
			throw error;
		}
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
	restore(
		meta: ConsoleHistoryMeta,
		bytes?: Uint8Array,
		actor: ConsoleActor = "agent",
	): void {
		const existing = this.registry.find(meta.surface);
		if (existing?.runtime) return;
		this.archives.set(meta.surface, meta);
		const grid = clampGrid(meta.cols, meta.rows);
		const entry =
			existing ??
			this.registry.create({
				// The handle the history recorded, so a caller holding one across a relaunch
				// finds the same surface rather than a lookalike with a new nonce.
				surface: meta.surface,
				live: false,
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
		// The reason the quit path could not observe a code (§7.3), seeded from the
		// sidecar exactly as the epoch is: the pane must be able to say "the app
		// closed it" on the launch after the close.
		if (meta.end_reason === "app_quit")
			this.endReasons.set(meta.surface, "app_quit");
		if (!existing)
			this.registry.update(meta.surface, {
				running: false,
				exitCode: meta.exit_code,
				exitSignal: meta.exit_signal,
				live: false,
				secure: meta.secure === true,
				lastActivity: meta.last_seen_at,
			});
		// Metadata restore has no native/runtime cost. Reads and pane subscriptions
		// hydrate through one cache so history never steals process admission.
		if (bytes === undefined) return;
		this.evictArchiveRuntime();
		this.requireResourceBudget(
			actor,
			grid.cols * (grid.rows + SCROLLBACK_LINES),
			bytes.length,
			bytes.length,
		);
		const emulator = createXtermEmulator({
			cols: grid.cols,
			rows: grid.rows,
			scrollback: SCROLLBACK_LINES,
		});
		this.unboundRestoreEmulators.add(emulator);
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
			pendingBytes: 0,
			droppedLiveBytes: 0,
			droppedGridBytes: 0,
			activeReaders: 0,
			archivedReplay: false,
			pendingTimer: null,
			persistTimer: null,
			seq: 0,
			rect: null,
			theme: null,
			lastMark: null,
			exitDelivered: true,
			exitWaiters: [],
		};
		// Adopt BEFORE replay/log initialization, either of which may throw. If
		// attach itself fails, this allocation still owns the emulator.
		runtime.archivedReplay = true;
		const facts = this.archiveFacts.get(meta.surface);
		runtime.droppedLiveBytes =
			facts?.droppedLiveBytes ?? meta.dropped_live_bytes ?? 0;
		runtime.droppedGridBytes =
			facts?.droppedGridBytes ?? meta.dropped_grid_bytes ?? 0;
		runtime.theme = facts?.theme ?? null;
		runtime.lastMark = facts?.lastMark ?? null;
		// Lazy hydration replaces the old eager startup restore, so this allocation
		// runs on a read, OUTSIDE any startup rollback: attach, replay and log
		// initialization all sit inside ONE ownership boundary this allocation
		// holds itself. Without it, a mid-init throw leaked a native emulator where
		// the cap could not see it.
		try {
			this.registry.attach(entry.record.surface, runtime);
			this.unboundRestoreEmulators.delete(emulator);
			// Replay, not deserialize: the headless build ships no `addon-serialize`,
			// and the retained parse is bounded to 4 MiB and paid once (§5.4/§7.1).
			emulator.write(bytes);
			runtime.log.append(bytes);
			// Replaying disk bytes is not new output to append to that same file.
			this.persistedBytes.set(meta.surface, runtime.log.endOffset);
			if (!existing)
				this.registry.update(entry.record.surface, {
					running: false,
					exitCode: meta.exit_code,
					exitSignal: meta.exit_signal,
					live: false,
					lastActivity: meta.last_seen_at,
				});
		} catch (error) {
			// Detach the half-built runtime so admission counts no ghost, then release
			// only this allocation's emulator. A release that itself throws stays in
			// failedAllocations, so a later stop retries the exact object owner rather
			// than leaking native usage the cap cannot see.
			this.unboundRestoreEmulators.delete(emulator);
			const owned = this.registry.find(entry.record.surface);
			if (owned?.runtime === runtime) owned.runtime = null;
			const allocation = { pty: null, emulator };
			this.failedAllocations.add(allocation);
			const failures = this.releaseFailedAllocation(allocation);
			if (failures.length)
				throw new AggregateError(
					[error, ...failures],
					"Console history hydration failed and its cleanup remains pending",
				);
			throw error;
		}
	}

	/** Keep RPC ownership validation at the host boundary without exposing the
	 * registry or its foreign runtimes. The caller decides whether an owner was
	 * supplied, preserving older nonce-capability clients that omit it. */
	assertOwned(surface: string, owner: string): void {
		this.registry.requireOwned(surface, owner);
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
			exit_signal: record.exitSignal,
			/* Why the end happened when no code was observable (§7.3). Only the quit
			 * path writes one, and it is the difference between "nobody could have
			 * seen this" and main's old silence, which the pane read as an unknown
			 * status. */
			end_reason: this.endReasons.get(record.surface) ?? null,
			last_activity: record.lastActivity,
			live: record.live,
			agent_owned: record.origin === "agent",
			// The co-pilot cell (§13.4): who touched the pty last, which `origin`
			// deliberately does not answer.
			last_actor: record.lastActor,
		};
	}

	/**
	 * Record who drove the pty, and push a change ONLY on a transition.
	 *
	 * The push is what the pane's listing refetches on, and a push per keystroke
	 * would be one IPC frame for every character a user types. The mark only has
	 * two values, so a comparison is the whole of the coalescing it needs.
	 *
	 * A REFUSED OR MISSING ACTOR IS THE AGENT PATH, which is the default rather
	 * than a guess: every caller inside main other than the renderer's own IPC is
	 * the RPC dispatch, and the renderer's path names `"user"` explicitly.
	 */
	private markActor(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		actor: ConsoleActor,
	): void {
		// Co-pilot attribution may change again, but human adoption is ownership
		// intent: later agent input must never make this surface auto-disposable.
		if (actor === "user") this.adoptedSurfaces.add(entry.record.surface);
		if (entry.record.lastActor === actor) return;
		entry.record.lastActor = actor;
		this.options.onChanged?.();
	}

	/** `console_status`. */
	status(surface: string): Record<string, unknown> {
		const entry = this.registry.require(surface);
		const runtime = entry.runtime;
		const facts = this.archiveFacts.get(surface);
		const grid = runtime?.emulator.grid ?? facts?.grid;
		return {
			running: entry.record.running,
			exit_code: entry.record.exitCode,
			exit_signal: entry.record.exitSignal,
			end_reason: this.endReasons.get(surface) ?? null,
			// The retention layer's counter, bumped once per `process_exited` (§7.3,
			// §10.2). Read from the host's live view of it: the sidecar is what makes
			// it survive a relaunch, and this is what the running process reports.
			exit_epoch: this.exitEpoch.get(surface) ?? 0,
			cols: entry.record.cols,
			rows: entry.record.rows,
			live: entry.record.live,
			truncated:
				runtime?.log.truncated ||
				facts?.truncated ||
				this.archives.get(surface)?.truncated ||
				false,
			// The LIVE VIEW's own loss, which is not the log's `truncated`: the ring
			// drops history it was told to bound, this drops frames a subscriber could
			// not take. Two numbers because they answer two different questions, and a
			// caller reasoning about a pane's fidelity needs this one.
			//
			// MONOTONIC for the life of the surface: it accumulates and does not reset,
			// so two readings compare and neither means "how far behind the pane is now".
			dropped_live_bytes:
				runtime?.droppedLiveBytes ?? facts?.droppedLiveBytes ?? 0,
			dropped_grid_bytes:
				runtime?.droppedGridBytes ?? facts?.droppedGridBytes ?? 0,
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
		actor: ConsoleActor = "agent",
	): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		this.refuseWhenSecure(entry);
		return this.withReadRuntime(
			entry,
			async (runtime) => {
				await runtime.emulator.whenIdle();
				const grid = runtime.emulator.grid;
				return {
					text: runtime.emulator.text(mode, window),
					cols: grid.cols,
					rows: grid.rows,
					cursor: grid.cursor,
					truncated:
						runtime.log.truncated ||
						this.archiveFacts.get(surface)?.truncated ||
						this.archives.get(surface)?.truncated ||
						false,
					dropped_grid_bytes: runtime.droppedGridBytes,
					live: entry.record.live,
					mode,
				};
			},
			actor,
		);
	}
	/**
	 * `console_screenshot`: the app's own window, cropped to the pane's reported
	 * rect, photographed with `capturePage` (design 13.2's first row); or, when no
	 * pane is displaying the surface, the capture view's reconstruction from the
	 * record (the second and third rows), which is what makes the `rendered` field a
	 * distinction rather than a label nothing produces.
	 *
	 * The assert-and-retry is the spike's measured trap and not a hopeful
	 * `setTimeout`: on a hidden window the FIRST `capturePage` came back blank
	 * (9,866 B against 27,869 B for the settled frame), and a headless rig — which
	 * is what every capture in this repo runs in — is exactly that case. The
	 * offscreen path repeats the same discipline in its own module.
	 */
	async screenshot(
		surface: string,
		actor: ConsoleActor = "agent",
	): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		this.refuseWhenSecure(entry);
		return this.withReadRuntime(
			entry,
			async (runtime) => {
				const report = runtime.rect;
				if (this.displayed !== surface || !report || !report.visible) {
					/*
					 * No pane is looking at this surface, so there is nothing to photograph: the
					 * honest answer is a faithful reconstruction from the record, and the result
					 * says so (`rendered: "offscreen"`) rather than passing itself off as a
					 * photograph of a screen.
					 *
					 * The BYTES ARE THE RECORD'S OWN retained log, read at the moment of the
					 * call: the capture view replays them into a fresh terminal, which is the
					 * design's "replay, not serialize" (§7.3) and the only representation that
					 * survives a relaunch. What is NOT done here is re-reading a live surface — a
					 * frame has to be a function of the bytes it declares, or two captures of the
					 * same surface are not comparable and cannot be evidence.
					 */
					const capture = this.options.captureOffscreen;
					if (!capture) {
						throw new ConsoleError(
							"capture_unavailable",
							"no pane is displaying this surface, and this host has no capture view to reconstruct a frame with",
							{ rendered: null },
						);
					}
					const grid = runtime.emulator.grid;
					const frame = await capture({
						surface,
						cols: grid.cols,
						rows: grid.rows,
						theme: runtime.theme,
						bytes: runtime.log.read(0).bytes,
					});
					return {
						image_base64: frame.png.toString("base64"),
						cols: grid.cols,
						rows: grid.rows,
						rendered: "offscreen",
						theme: runtime.theme,
						live: entry.record.live,
						// Which renderer painted the reconstruction, reported rather than
						// assumed: the DOM pin is what makes an offscreen frame possible at all.
						renderer: frame.renderer,
						attempts: frame.attempts,
					};
				}
				const window = this.options.window();
				if (!window || window.isDestroyed()) {
					throw new ConsoleError(
						"capture_unavailable",
						"this app's window is not available to photograph",
						{ rendered: null },
					);
				}
				const rect = cropToWindow(
					report.contentRect,
					window.getContentBounds(),
				);
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
			},
			actor,
		);
	}
	/**
	 * A displayed frame, retried once, and REFUSED when it has no content twice (Q-2).
	 *
	 * There is no byte floor any more, here or on the offscreen path, and the two
	 * findings are why: the floor was not a guard (QA round 1's Q-2 — a blank 1600x800
	 * capture is a few kilobytes of one colour, so the cell certifying "a screenshot is
	 * the app's own window, cropped to the pane's rect" was green on a uniform field
	 * while the offscreen frame from the same run had 252 colours) AND it refused real
	 * captures from the other side (QA round 2's Q-7 — a live console that had printed
	 * less than a screenful was answered as blank). `hasTerminalContent` asks the
	 * question both findings reduce to, once, for both paths.
	 *
	 * A FRAME WITH NO CONTENT IS REFUSED RATHER THAN RETURNED, which is the design's own
	 * answer for the offscreen path (§13.2's `capture_unavailable`): one flat field is
	 * not a picture of a terminal, and handing it back would be the class of false
	 * evidence this contract exists to avoid. A real pane is never flat — the DOM
	 * renderer paints antialiased text and a cursor — and the empty-terminal case is the
	 * offscreen path's problem too, so this is not a new ceiling.
	 */
	private async captureWithRetry(
		window: BrowserWindow,
		rect: ConsoleContentRect,
	): Promise<Buffer> {
		let bytes = 0;
		for (let attempt = 1; attempt <= 2; attempt++) {
			const image = await window.webContents.capturePage(rect);
			const png = framePng(image);
			bytes = png.length;
			if (hasTerminalContent(image.toBitmap())) {
				return png;
			}
			this.options.log(
				`[console] displayed capture came back blank (${png.length} B, attempt ${attempt})`,
			);
			if (attempt === 1) await delay(FRAME_RETRY_DELAY_MS);
		}
		throw new ConsoleError(
			"capture_unavailable",
			`the displayed capture of this surface produced a blank frame twice (last ${bytes} B)`,
			{ rendered: "displayed" },
		);
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
		actor: ConsoleActor = "agent",
	): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry, actor);
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
		/*
		 * THE ACTOR IS MARKED WHEN THE BYTES ARE TAKEN, not when they are offered (code
		 * review round 1, B3). `markActor` used to run before the refusals, so a refused
		 * write still flipped `last_actor` and pushed a state change for a keystroke that
		 * never reached the pty — the pane's "who typed this" marker would credit a caller
		 * for a payload the host rejected.
		 */
		this.markActor(entry, actor);
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
		actor: ConsoleActor = "agent",
	): Promise<Record<string, unknown>> {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry, actor);
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
		// Marked here for the same reason `input` is (B3): an unknown key is a refusal,
		// and a refusal is not an actor's keystroke.
		this.markActor(entry, actor);
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
	resize(
		surface: string,
		cols: number,
		rows: number,
		actor: ConsoleActor = "agent",
	): Record<string, unknown> {
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
		this.applyGrid(entry, cols, rows, actor);
		return { cols: entry.record.cols, rows: entry.record.rows };
	}

	/** The pane's report: measurement in, grid decision out (§8.2). */
	setContentRect(surface: string, report: ConsoleContentReport): void {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry, "user");
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
		this.applyGrid(entry, cols, rows, "user");
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
		actor: ConsoleActor = "agent",
	): ByteLogSlice {
		const entry = this.registry.require(surface);
		const runtime = this.requireRuntime(entry, actor);
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
			metrics: this.resources(),
			capacity: {
				live: counts.live,
				archived: counts.archived,
				limit: counts.maxLive,
			},
			displayed_surface:
				sessionId &&
				this.displayed &&
				this.registry.find(this.displayed)?.record.sessionId !== sessionId
					? null
					: this.displayed,
			surfaces: this.registry.list(sessionId).map((entry) => ({
				...this.listing(entry),
				secure: entry.record.secure,
				retain: entry.record.retain,
				sizing: entry.record.sizing,
				displayed: entry.record.surface === this.displayed,
				last_mark:
					entry.runtime?.lastMark ??
					this.archiveFacts.get(entry.record.surface)?.lastMark ??
					null,
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
		// Secure spans suppress durable capture. Resource pressure may also defer
		// parser/delivery input, but observable counters distinguish that bounded
		// degradation from loss of already-retained disk history.
		// Flush agent surplus durably before trimming ONLY replay RAM. Producer
		// output is untrusted, never authorized by stored creator provenance.
		if (!entry.record.secure) {
			runtime.log.append(new Uint8Array(bytes));
			if (!this.projectResources().fits) {
				this.flush(surface);
				if (
					!entry.record.retain ||
					(this.persistedBytes.get(surface) ?? 0) >= runtime.log.endOffset
				)
					runtime.log.trimMemory(LOG_RESERVATION_BYTES);
			}
		}
		if (this.projectResources("agent", 0, 0, bytes.length).fits) {
			runtime.emulator.write(new Uint8Array(bytes));
		} else {
			// Parser degradation is explicit and distinct from durable byte loss.
			runtime.droppedGridBytes += bytes.length;
		}
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
		runtime.pendingBytes += bytes.length;
		while (!this.projectResources().fits && runtime.pending.length > 0) {
			const oldest = runtime.pending.shift();
			if (!oldest) break;
			runtime.pendingBytes -= oldest.length;
			runtime.droppedLiveBytes += oldest.length;
		}
		/*
		 * THE DROP-OLDEST CEILING (see `LIVE_PENDING_MAX_BYTES`). One chunk is kept even
		 * when it alone is over the ceiling: a frame that arrives late is still a frame,
		 * and dropping the only chunk would turn a big paste into a blank pane.
		 */
		while (
			runtime.pendingBytes > LIVE_PENDING_MAX_BYTES &&
			runtime.pending.length > 1
		) {
			// The guard is for the type checker rather than for a case: `length > 1` above
			// means a chunk is always there to take, and it is never a falsy one (a
			// zero-length chunk is still an object).
			const oldest = runtime.pending.shift();
			if (!oldest) break;
			runtime.pendingBytes -= oldest.length;
			runtime.droppedLiveBytes += oldest.length;
			// Logged on the FIRST drop for a surface and not per chunk: a flood would
			// otherwise write one line per dropped frame into the same app log a
			// reader is trying to read.
			if (runtime.droppedLiveBytes === oldest.length) {
				this.options.log(
					`[console] surface ${redactSurface(entry.record.surface)} is behind by more than ${LIVE_PENDING_MAX_BYTES} B; the live view drops its oldest frames (the record keeps every byte)`,
				);
			}
		}
		if (runtime.pendingTimer) return;
		// NOT unref'd, for `delay`'s reason: this timer is what delivers a coalesced
		// frame to subscribers, and an idle loop must not be able to drop it.
		runtime.pendingTimer = setTimeout(() => {
			runtime.pendingTimer = null;
			const pending = runtime.pending;
			runtime.pending = [];
			runtime.pendingBytes = 0;
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

	private exited(
		surface: string,
		exitCode: number,
		exitSignal: string | null = null,
	): void {
		// `find`, not `require`: an exit can land after its surface was closed, and
		// an event handler that threw would be an unhandled exception inside a pty
		// callback rather than a refusal anybody could read.
		const entry = this.registry.find(surface);
		if (!entry || !entry.runtime) return;
		this.registry.update(surface, {
			running: false,
			exitCode,
			exitSignal,
			lastActivity: this.now(),
		});
		// A REAL exit supersedes whatever the quit path recorded: the status exists,
		// so the reason is no longer the honest answer (and a surface replayed under
		// this handle later must not inherit an old one).
		this.endReasons.delete(surface);
		// The generation is bumped BEFORE anything is written or delivered, because
		// every consumer of it keys on it: the sidecar stores it (§7.3) and §12.3's
		// notifier dedupes on `(surface, exit_epoch)`. It is the retention layer's
		// counter, so it is bumped through the history's own arithmetic rather than
		// by adding one here.
		this.bumpExitEpoch(entry);
		if (entry.record.retain) this.flush(surface);
		const runtime = entry.runtime;
		// node-pty owns the closed descriptor after onExit; retaining its JS handle
		// must not be mistaken for native admission or a signal target.
		runtime.pty = null;
		for (const waiter of runtime.exitWaiters.splice(0)) waiter(exitCode);
		if (!runtime.exitDelivered) {
			runtime.exitDelivered = true;
			for (const subscriber of runtime.subscribers) {
				subscriber.exit({ surface, exitCode, exitSignal });
			}
		}
		this.options.log(
			`[console] surface ${redactSurface(surface)} exited ${exitCode}${exitSignal === null ? "" : ` by ${exitSignal}`}`,
		);
		this.options.onChanged?.();
		// The app's own completion seam, after every other reader has the exit. See
		// `ConsoleHostOptions.onExit` for why this is not left to `onChanged`.
		/*
		 * A QUIT IS NOT A COMPLETION (M-1). `dispose` keeps entries registered while
		 * it settles so the exit can be observed and persisted, but the same
		 * registration used to let this seam fire while the app was going away: every
		 * console the quit closed announced "exited with code …" and, on a surface the
		 * pane was not showing, raised a native notification. Nothing is completing
		 * from the user's point of view; the app is closing.
		 */
		if (!this.disposing)
			this.options.onExit?.({
				surface,
				sessionId: entry.record.sessionId,
				exitCode,
				exitSignal,
			});
		// Wait for the final emulator parse before releasing a reloadable runtime.
		// Pane subscribers and secure views remain pinned; no process is killed.
		void runtime.emulator
			.whenIdle()
			.then(() => {
				const current = this.registry.find(surface);
				if (
					!current ||
					current.runtime !== runtime ||
					current.record.running ||
					!current.record.retain ||
					current.record.secure ||
					current.runtime.subscribers.size ||
					surface === this.displayed ||
					!this.options.history
				)
					return;
				this.flush(surface);
				if ((this.persistedBytes.get(surface) ?? 0) < runtime.log.endOffset)
					return;
				if (this.dehydrate(current)) this.options.onChanged?.();
			})
			.catch((error) =>
				this.options.log(
					`[console] history demotion deferred: ${String(error)}`,
				),
			);
	}

	/** Apply a grid change: clamp, compare, and only then touch the record and the
	 * pty — so one clamp-crossing is one `TIOCSWINSZ` and one `SIGWINCH` (§8.2). */
	private applyGrid(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		cols: number,
		rows: number,
		actor: ConsoleActor = "agent",
	): void {
		const grid = clampGrid(cols, rows);
		if (grid.cols === entry.record.cols && grid.rows === entry.record.rows)
			return;
		const previous = { cols: entry.record.cols, rows: entry.record.rows };
		this.registry.update(entry.record.surface, grid);
		try {
			this.requireResourceBudget(actor);
		} catch (error) {
			this.registry.update(entry.record.surface, previous);
			throw error;
		}
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

	private nativeFacts: NativeCapacity = {
		fdLimit: null,
		fdUsed: null,
		ptyMax: null,
		ptyAvailable: null,
	};
	private nativeSampledAt: number | null = null;
	private readonly archives = new Map<string, ConsoleHistoryMeta>();
	private readonly archiveFacts = new Map<
		string,
		{
			grid: ConsoleGridState;
			truncated: boolean;
			droppedLiveBytes: number;
			droppedGridBytes: number;
			lastMark: Osc133Mark | null;
			theme: string | null;
		}
	>();
	private readonly runtimeUse = new Map<string, number>();
	private runtimeClock = 0;
	private readonly exitAckTimers = new Map<string, NodeJS.Timeout>();
	// Restarted histories are already protected by live:false. This lifetime
	// ledger survives runtime dehydration, and is removed only on explicit close.
	private readonly adoptedSurfaces = new Set<string>();

	/** Counts are safe across owners; identifiers and terminal content are not.
	 * Cell charges model reserved storage, never arbitrary child RSS. Unknown OS
	 * FD/PTY availability is honest rather than borrowed from a shell's ulimit. */
	resources() {
		let logBytes = 0;
		let pendingBytes = 0;
		let cells = 0;
		let ptys = 0;
		let protectedCount = 0;
		for (const entry of this.registry.list()) {
			const runtime = entry.runtime;
			logBytes += Math.max(
				runtime?.log.retainedBytes ?? 0,
				entry.record.running ? LOG_RESERVATION_BYTES : 0,
			);
			pendingBytes +=
				(runtime?.pendingBytes ?? 0) + (runtime?.emulator.pendingBytes ?? 0);
			if (runtime || entry.record.running)
				cells += entry.record.cols * (entry.record.rows + SCROLLBACK_LINES);
			if (entry.record.running && runtime?.pty) ptys += 1;
			if (
				entry.record.origin === "user" ||
				this.adoptedSurfaces.has(entry.record.surface) ||
				entry.record.retain ||
				entry.record.secure ||
				!entry.record.live ||
				entry.record.surface === this.displayed ||
				runtime?.subscribers.size ||
				runtime?.activeReaders
			)
				protectedCount += 1;
		}
		// Actual human work/config reductions can already consume credit. These
		// are conservative modeled default-grid units, NEVER an OS/RSS promise.
		const liveUsers = this.registry
			.list()
			.filter(
				(entry) => entry.record.running && entry.record.origin === "user",
			).length;
		const vacant = Math.max(0, this.registry.policy.userReserved - liveUsers);
		const defaultCells = DEFAULT_COLS * (DEFAULT_ROWS + SCROLLBACK_LINES);
		const rawManaged =
			logBytes +
			pendingBytes +
			cells * CELL_RESERVATION_BYTES +
			64 * 1024 * 1024;
		const remaining = Math.max(
			0,
			Math.min(
				vacant,
				this.registry.policy.maxLive - this.registry.liveCount(),
				Math.floor(
					(MANAGED_BUDGET_BYTES - rawManaged) /
						(LOG_RESERVATION_BYTES + defaultCells * CELL_RESERVATION_BYTES),
				),
				Math.floor((LOG_BUDGET_BYTES - logBytes) / LOG_RESERVATION_BYTES),
				Math.floor((CELL_BUDGET - cells) / defaultCells),
			),
		);
		return {
			...this.registry.metrics(),
			host_epoch: this.hostEpoch,
			started_at: this.startedAt,
			resources: {
				user_reserved_vacant: vacant,
				user_remaining_modeled_units:
					pendingBytes > PENDING_BUDGET_BYTES ? 0 : remaining,
				pending_allocations: this.failedAllocations.size,
				ptys,
				log_bytes: logBytes,
				pending_bytes: pendingBytes,
				emulator_cells: cells,
				protected: protectedCount,
				modeled_managed_bytes:
					logBytes +
					pendingBytes +
					cells * CELL_RESERVATION_BYTES +
					64 * 1024 * 1024,
				fd_available:
					this.nativeFacts.fdLimit !== null && this.nativeFacts.fdUsed !== null
						? Math.max(0, this.nativeFacts.fdLimit - this.nativeFacts.fdUsed)
						: null,
				pty_available: this.nativeFacts.ptyAvailable,
				native_sampled_at: this.nativeSampledAt,
				pty_reservations: this.registry.liveCount(),
				os_capacity:
					this.nativeFacts.fdLimit === null ||
					this.nativeFacts.ptyAvailable === null
						? "partly unknown"
						: "known",
				accounting: "modeled managed storage; excludes child RSS",
			},
			resource_caps: {
				log_bytes: LOG_BUDGET_BYTES,
				pending_bytes: PENDING_BUDGET_BYTES,
				emulator_cells: CELL_BUDGET,
				modeled_managed_bytes: MANAGED_BUDGET_BYTES,
				native_ptys:
					this.nativeFacts.ptyMax === null
						? 128
						: Math.max(0, Math.min(128, this.nativeFacts.ptyMax - 64)),
			},
		};
	}

	/** Default/untrusted work includes the vacant user resource credit in EVERY
	 * projected vector. Stored creator provenance is never caller permission.
	 * Only trusted renderer/internal callers may pass user context explicitly. */
	private projectResources(
		actor: ConsoleActor = "agent",
		extraCells = 0,
		extraLogBytes = 0,
		extraPendingBytes = 0,
	) {
		const sample = this.resources();
		const resources = { ...sample.resources };
		const liveUsers = this.registry
			.list()
			.filter(
				(entry) => entry.record.running && entry.record.origin === "user",
			).length;
		const reserved =
			actor === "user"
				? 0
				: Math.max(0, this.registry.policy.userReserved - liveUsers);
		const cells =
			extraCells + reserved * DEFAULT_COLS * (DEFAULT_ROWS + SCROLLBACK_LINES);
		const log = extraLogBytes + reserved * LOG_RESERVATION_BYTES;
		resources.emulator_cells += cells;
		resources.log_bytes += log;
		resources.pending_bytes += extraPendingBytes;
		resources.modeled_managed_bytes +=
			log + extraPendingBytes + cells * CELL_RESERVATION_BYTES;
		const fits =
			resources.log_bytes <= LOG_BUDGET_BYTES &&
			resources.pending_bytes <= PENDING_BUDGET_BYTES &&
			resources.emulator_cells <= CELL_BUDGET &&
			resources.modeled_managed_bytes <= MANAGED_BUDGET_BYTES;
		return { sample, resources, reserved, fits };
	}

	private requireResourceBudget(
		actor: ConsoleActor = "agent",
		extraCells = 0,
		extraLogBytes = 0,
		extraPendingBytes = 0,
	): void {
		if (this.options.nativeCapacity) {
			this.nativeFacts = this.options.nativeCapacity();
			this.nativeSampledAt = this.now();
		}
		const { sample, resources, reserved, fits } = this.projectResources(
			actor,
			extraCells,
			extraLogBytes,
			extraPendingBytes,
		);
		const nativeCeiling =
			this.nativeFacts.ptyMax === null
				? 128
				: Math.max(0, Math.min(128, this.nativeFacts.ptyMax - 64));
		const starting = this.registry
			.list()
			.filter((entry) => entry.record.running && !entry.runtime).length;
		if (
			!fits ||
			(starting > 0 &&
				(this.registry.liveCount() > nativeCeiling ||
					(resources.fd_available !== null &&
						resources.fd_available < 128 + 4 * starting) ||
					(resources.pty_available !== null &&
						resources.pty_available < 64 + starting)))
		) {
			throw new ConsoleError(
				"tab_limit",
				"console managed resource budget reached; completed history can be released without stopping live work",
				{
					scope: "resources",
					metrics: sample,
					proposed_resources: resources,
					reserved_user_slots: reserved,
				},
			);
		}
	}

	/** Acknowledgement is explicit evidence the owner observed completion. An idle
	 * process is never eligible, and every protection is rechecked at timer fire. */
	acknowledgeExit(surface: string): void {
		const entry = this.registry.find(surface);
		if (!entry || entry.record.running || this.exitAckTimers.has(surface))
			return;
		if (
			entry.record.origin !== "agent" ||
			this.adoptedSurfaces.has(entry.record.surface) ||
			entry.record.retain ||
			entry.record.secure ||
			!entry.record.live ||
			surface === this.displayed ||
			entry.runtime?.subscribers.size ||
			entry.runtime?.activeReaders
		)
			return;
		const timer = setTimeout(() => {
			this.exitAckTimers.delete(surface);
			const current = this.registry.find(surface);
			if (
				!current ||
				current.record.running ||
				current.record.origin !== "agent" ||
				this.adoptedSurfaces.has(current.record.surface) ||
				current.record.retain ||
				current.record.secure ||
				!current.record.live ||
				surface === this.displayed ||
				current.runtime?.subscribers.size ||
				current.runtime?.activeReaders
			)
				return;
			void this.close(surface, { retain: false }).catch((error) =>
				this.options.log(
					`[console] completed cleanup refused: ${String(error)}`,
				),
			);
		}, EXIT_ACK_GRACE_MS);
		timer.unref?.();
		this.exitAckTimers.set(surface, timer);
	}

	/** Owner cleanup cannot terminate processes, and preserves retained files.
	 * Counts only are returned so this is safe to expose as a lifecycle hook. */
	async cleanupOwner(
		sessionId: string,
	): Promise<{ released: number; protected: number; running: number }> {
		let released = 0;
		let protectedCount = 0;
		let running = 0;
		for (const entry of this.registry.list(sessionId)) {
			if (entry.record.running) {
				running += 1;
				continue;
			}
			if (
				entry.record.secure ||
				entry.record.origin === "user" ||
				this.adoptedSurfaces.has(entry.record.surface) ||
				!entry.record.live ||
				entry.record.surface === this.displayed ||
				entry.runtime?.subscribers.size ||
				entry.runtime?.activeReaders
			) {
				protectedCount += 1;
				continue;
			}
			if (entry.record.retain) {
				/*
				 * AN ELIGIBLE RETAINED SURFACE THAT IS ALREADY DEHYDRATED COUNTS AS
				 * RELEASED, not protected (QA round 1, Q-2). `dehydrate()` returning
				 * false for a null runtime is about the flush timer - there is nothing
				 * left to drop - but the resource question is already answered: the
				 * surface holds no emulator and no in-memory bytes, so nothing is
				 * "still in use". Reporting it protected made the cleanup-result copy
				 * ("{n} is still in use and was left open") describe a finished,
				 * retained terminal as busy. Every other reason to protect one (secure,
				 * user-origin, adopted, non-live, displayed, subscribed, read) was
				 * already filtered above, so a null runtime here is a release-ready
				 * surface whose bytes are on disk and whose memory is already back.
				 */
				if (!entry.runtime || this.dehydrate(entry)) released += 1;
				else protectedCount += 1;
			} else {
				await this.close(entry.record.surface, { retain: false });
				released += 1;
			}
		}
		return { released, protected: protectedCount, running };
	}

	private requireRuntime(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		actor: ConsoleActor = "agent",
	): SurfaceRuntime {
		this.runtimeUse.set(entry.record.surface, ++this.runtimeClock);
		if (!entry.runtime) {
			const meta = this.archives.get(entry.record.surface);
			if (meta) {
				const loaded = this.options.history?.load(
					meta.session_id,
					meta.surface,
				);
				if (!loaded)
					throw new ConsoleError(
						"surface_unavailable",
						"retained history could not be loaded safely",
					);
				this.restore(meta, loaded.bytes, actor);
			}
		}
		if (!entry.runtime) {
			throw new ConsoleError(
				"console_unavailable",
				`${redactSurface(entry.record.surface)} has no runtime in this app run`,
				{ reason: "no_runtime" },
			);
		}
		return entry.runtime;
	}

	private async withReadRuntime<T>(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		operation: (runtime: SurfaceRuntime) => Promise<T>,
		actor: ConsoleActor = "agent",
	): Promise<T> {
		const runtime = this.requireRuntime(entry, actor);
		runtime.activeReaders += 1;
		try {
			return await operation(runtime);
		} finally {
			runtime.activeReaders -= 1;
			// Exit's first demotion may have been blocked by this reader. Retry
			// when the last pin drains, without throwing away an actual hydrated
			// LRU entry or overriding a successful read with housekeeping failure.
			if (
				!runtime.archivedReplay &&
				entry.runtime === runtime &&
				!entry.record.running &&
				runtime.activeReaders === 0
			) {
				try {
					if (this.dehydrate(entry)) this.options.onChanged?.();
				} catch (error) {
					this.options.log(
						`[console] reader-drained demotion deferred: ${String(error)}`,
					);
				}
			}
		}
	}

	private dehydrate(entry: ConsoleRegistryEntry<SurfaceRuntime>): boolean {
		const runtime = entry.runtime;
		if (
			!runtime ||
			entry.record.running ||
			!entry.record.retain ||
			entry.record.secure ||
			entry.record.surface === this.displayed ||
			runtime.subscribers.size ||
			runtime.activeReaders ||
			runtime.emulator.pendingBytes ||
			!this.options.history
		)
			return false;
		this.flush(entry.record.surface);
		if (
			(this.persistedBytes.get(entry.record.surface) ?? 0) <
			runtime.log.endOffset
		)
			return false;
		this.archiveFacts.set(entry.record.surface, {
			grid: runtime.emulator.grid,
			truncated:
				runtime.log.truncated ||
				this.archives.get(entry.record.surface)?.truncated ||
				false,
			droppedLiveBytes: runtime.droppedLiveBytes,
			droppedGridBytes: runtime.droppedGridBytes,
			lastMark: runtime.lastMark,
			theme: runtime.theme,
		});
		if (runtime.pendingTimer) clearTimeout(runtime.pendingTimer);
		runtime.pending = [];
		runtime.pendingBytes = 0;
		runtime.emulator.dispose();
		entry.runtime = null;
		return true;
	}

	private evictArchiveRuntime(): void {
		const hydrated = this.registry
			.list()
			.filter((item) => !item.record.running && item.runtime?.archivedReplay)
			.sort(
				(a, b) =>
					(this.runtimeUse.get(a.record.surface) ?? 0) -
					(this.runtimeUse.get(b.record.surface) ?? 0),
			);
		if (hydrated.length < HISTORY_CACHE_ENTRIES) return;
		const candidate = hydrated.find(
			(item) =>
				item.record.retain &&
				!item.record.secure &&
				item.record.surface !== this.displayed &&
				item.runtime?.subscribers.size === 0 &&
				item.runtime.activeReaders === 0 &&
				item.runtime.emulator.pendingBytes === 0,
		);
		if (!candidate || !this.dehydrate(candidate))
			throw new ConsoleError(
				"tab_limit",
				"history replay cache is occupied by protected or undrained views",
				{ scope: "history_cache", limit: HISTORY_CACHE_ENTRIES },
			);
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
			exit_signal: record.exitSignal,
			end_reason: this.endReasons.get(surface) ?? null,
			truncated: runtime.log.truncated,
			exit_epoch: this.exitEpoch.get(surface) ?? 0,
			secure: record.secure,
			dropped_live_bytes: runtime.droppedLiveBytes,
			dropped_grid_bytes: runtime.droppedGridBytes,
		};
		this.archives.set(surface, meta);
		if (!this.createdAt.has(surface))
			this.createdAt.set(surface, meta.created_at);
		if (!this.persistedBytes.has(surface)) this.persistedBytes.set(surface, 0);
		const already = this.persistedBytes.get(surface) ?? 0;
		const end = runtime.log.endOffset;
		if (end > already) {
			const slice = runtime.log.read(already);
			// `append` may rotate, which sets `meta.truncated` — so the meta is written
			// AFTER the append and its signature computed from the post-append value.
			const appended = history.append(
				record.sessionId,
				surface,
				slice.bytes,
				meta,
			);
			if (!appended.written) return;
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
		const ackTimer = this.exitAckTimers.get(surface);
		if (ackTimer) clearTimeout(ackTimer);
		this.exitAckTimers.delete(surface);
		this.adoptedSurfaces.delete(surface);
		this.archives.delete(surface);
		this.archiveFacts.delete(surface);
		this.runtimeUse.delete(surface);
		this.createdAt.delete(surface);
		this.persistedBytes.delete(surface);
		this.metaSignatures.delete(surface);
		this.exitEpoch.delete(surface);
		this.endReasons.delete(surface);
		this.options.onChanged?.();
	}

	/**
	 * Let the quit path OBSERVE a surface's exit instead of killing it blind (§7.3).
	 *
	 * THE DEFECT THIS CLOSES: `dispose` used to persist the sidecar (with
	 * `exit_code: null`) and then kill the pty, so the next launch restored "exit
	 * code not observed" for a surface the app itself closed — a status the app
	 * could have had, reported as one nobody could have. The order is now flush,
	 * signal, wait, and let the exit land in the record before the final persist.
	 *
	 * BOUNDED TWICE, AND IN PARALLEL ACROSS SURFACES (`dispose` awaits them all at
	 * once): SIGTERM gets the same grace a user-initiated close does, SIGKILL gets
	 * `QUIT_EXIT_CAPTURE_MS` for the event loop to deliver its `onExit`, and only
	 * after BOTH fail is the end recorded as `app_quit` — the honest sentence for a
	 * status that genuinely could not be observed, and distinguishable from a legacy
	 * sidecar that never looked.
	 */
	private async settleOnQuit(
		entry: ConsoleRegistryEntry<SurfaceRuntime>,
		persistHistory: boolean,
	): Promise<void> {
		const runtime = entry.runtime;
		if (!runtime || !entry.record.running || !runtime.pty) return;
		// THE LAST FLUSH IS THE POINT OF THE FLUSH: bytes still inside the pending
		// window when the app quits are the one thing the coalescing must never lose.
		// It runs before the signal so the process's earlier output is already in the
		// log; output emitted after it lands through `exited`'s own flush when the exit
		// is observed, and is the stated durability boundary when it is not (§7.4).
		if (persistHistory && entry.record.retain) this.persist(entry, runtime);
		const pty = runtime.pty;
		const exit = new Promise<number>((resolve) => {
			runtime.exitWaiters.push(resolve);
		});
		let signalled = true;
		try {
			pty.kill();
		} catch {
			// A pty already gone can throw on a signal; the exit event is still the
			// only thing that answers this wait, so the bounds below decide it.
			signalled = false;
		}
		const observed = await Promise.race([
			exit,
			delay(QUIT_SIGNAL_GRACE_MS).then(() => null),
		]);
		if (observed !== null) return;
		try {
			pty.kill("SIGKILL");
		} catch {
			// Same as above; the second bound is what remains.
		}
		const killed = await Promise.race([
			exit,
			delay(QUIT_EXIT_CAPTURE_MS).then(() => null),
		]);
		if (killed === null) {
			this.endReasons.set(entry.record.surface, "app_quit");
			this.options.log(
				`[console] surface ${redactSurface(entry.record.surface)} did not report an exit within the quit bound${signalled ? "" : " (the signal itself was refused)"}; recording app_quit`,
			);
		}
	}

	/** Stop everything: every pty, every record, every subscriber. */
	async dispose(persistHistory = true): Promise<void> {
		this.disposing = true;
		const allocationFailures = [...this.failedAllocations].flatMap(
			(allocation) => this.releaseFailedAllocation(allocation),
		);
		for (const timer of this.exitAckTimers.values()) clearTimeout(timer);
		this.exitAckTimers.clear();
		// A startup rollback has not read the complete history yet. Persisting its
		// partial emulators would turn a recoverable startup error into data loss.
		if (
			!persistHistory ||
			this.rollbackDisposals.length > 0 ||
			this.unboundRestoreEmulators.size > 0
		) {
			const entries = [...this.rollbackDisposals, ...this.registry.clear()];
			this.rollbackDisposals = [];
			const failures: unknown[] = [];
			// An attach implementation may bind then throw. Registry-owned runtimes
			// are canonical release owners, so that emulator must not be disposed
			// again through the pre-adoption inventory, including on failed release.
			for (const entry of entries) {
				if (entry.runtime)
					this.unboundRestoreEmulators.delete(entry.runtime.emulator);
			}
			for (const entry of entries) {
				const runtime = entry.runtime;
				if (!runtime) continue;
				let incomplete = false;
				// Partial initialization is not a persistence event. Try every exact
				// runtime owner even if one fails, and retain only failed owners for
				// a subsequent stop; never write bytes or metadata during rollback.
				for (const release of [
					() => {
						if (runtime.pendingTimer) clearTimeout(runtime.pendingTimer);
						if (runtime.persistTimer) clearTimeout(runtime.persistTimer);
						runtime.subscribers.clear();
					},
					() => {
						if (entry.record.running) runtime.pty?.kill();
					},
					() => runtime.emulator.dispose(),
				]) {
					try {
						release();
					} catch (error) {
						incomplete = true;
						failures.push(error);
					}
				}
				if (incomplete) this.rollbackDisposals.push(entry);
			}
			for (const emulator of this.unboundRestoreEmulators) {
				try {
					emulator.dispose();
					this.unboundRestoreEmulators.delete(emulator);
				} catch (error) {
					// Keep failed acquisitions for stop's exact-object retry, without
					// a history write, a swallowed error or a second allocation.
					failures.push(error);
				}
			}
			if (failures.length)
				throw new AggregateError(
					failures,
					"Partial console runtime cleanup incomplete.",
				);
		} else {
			/*
			 * THREE PHASES, NOT ONE LOOP: release every surface's timers first, let every
			 * exit settle concurrently, then write what actually happened. The old loop
			 * killed and persisted per surface, which is why the status of the surface it
			 * was closing was always the one before the kill.
			 */
			const entries = this.registry.list();
			for (const entry of entries) {
				const runtime = entry.runtime;
				if (!runtime) continue;
				if (runtime.pendingTimer) clearTimeout(runtime.pendingTimer);
				if (runtime.persistTimer) clearTimeout(runtime.persistTimer);
				runtime.subscribers.clear();
			}
			await Promise.all(
				entries.map((entry) => this.settleOnQuit(entry, persistHistory)),
			);
			for (const entry of entries) {
				const runtime = entry.runtime;
				if (!runtime) continue;
				// The exit's own flush ran if it was observed. This second persist is what
				// records an exit code main only learned about on the way out, and the
				// `app_quit` reason when it did not; `metaSignature` skips an unchanged
				// document, so an already-persisted surface costs no extra write.
				if (persistHistory && entry.record.retain) this.persist(entry, runtime);
				// No second kill here: `settleOnQuit` is the only place this path signals
				// a pty, and it has already either observed the exit or escalated to
				// SIGKILL and bounded its own wait. A kill here was a third signal to a
				// process that never reported one.
				runtime.emulator.dispose();
			}
			this.registry.clear();
		}
		this.createdAt.clear();
		this.persistedBytes.clear();
		this.metaSignatures.clear();
		this.exitEpoch.clear();
		this.endReasons.clear();
		if (allocationFailures.length)
			throw new AggregateError(
				allocationFailures,
				"Failed console allocation cleanup remains incomplete",
			);
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

	/**
	 * Why a surface's end could not be observed, when the quit path itself ended it.
	 *
	 * A SEPARATE MAP FROM THE RECORD, like `exitEpoch`: the reason has to outlive the
	 * process that owns the record (it is persisted into the sidecar and read back on
	 * the next launch), and it is cleared the moment a real exit is observed so a
	 * subsequent run under the same handle cannot inherit the previous ending.
	 */
	private readonly endReasons = new Map<string, "app_quit">();
	/** True from the first line of `dispose`; refuses creates and suppresses the
	 * completion seam for the whole teardown (M-1, m-2). */
	private disposing = false;
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
		meta.end_reason ?? "",
		meta.truncated,
		meta.cols,
		meta.rows,
		meta.exit_epoch,
		meta.secure === true,
		meta.dropped_live_bytes ?? 0,
		meta.dropped_grid_bytes ?? 0,
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

/*
 * `defaultShell` - the shell a surface runs when the caller names no command -
 * lives in `../shell-path` now, and is re-exported here because it is the same
 * question the PATH resolution asks: which shell is the user's own. Two answers
 * to it, one per caller, is the shape that drifts (a relative `$SHELL` is
 * not-a-shell here and must not be one there either).
 */
export { defaultShell };

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
