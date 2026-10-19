/**
 * QWEN VOICE IN MAIN (design: the backend's docs/design/qwen-voice.md, Q4, Q5,
 * Q9): the one owner of the rig's two processes, the relay between the Gateway
 * and the renderer, and the guard on what the rig may say.
 *
 * Electron-free on purpose: every Electron facility (the utility-process fork,
 * opening the WebUI, the window) is injected from `index.ts`, so the rules here
 * are tested as plain code (`scripts/qwen-voice-main.test.mjs`).
 *
 * THE RULES
 *
 * - START: on a feed `voice` frame naming a session (the backend publishes the
 *   frame only on a CHANGE, so every non-null frame is an enable or a switch), or
 *   on the renderer's `voice.qwen.start` (the "Start voice" action shown while the
 *   slot is held and the rig is stopped, e.g. after an app relaunch). Never at
 *   app launch on its own: that loads gigabytes of models nobody asked for.
 * - STOP: 10 minutes after the slot goes empty, and at quit. Start and stop are
 *   idempotent. The idle timer is ARMED by the slot becoming empty (or a start
 *   with no slot), never RE-armed by a repeat of the same empty answer: the
 *   renderer re-reads the slot every 60 s, and re-arming on each read meant the
 *   timer never fired (QA round 1, Q3).
 * - TRUTH: "ready" says both processes are up; `clients` says whether a voice
 *   page is connected to hear anything; a process dying under a ready rig is
 *   `error` with `cause: unexpected_exit`, never a silent "ready".
 * - THE SLOT MOVING silences the old session: `cancel_all` to the Gateway, and
 *   every reply/gate text relayed for it is forgotten, so it can no longer be
 *   spoken.
 * - THE SPEAK GUARD: `voice.qwen.speak {text, kind}` is honoured only for a text
 *   main itself relayed as a 200 `/v1/desktop/voice/text` answer (`voice.text`
 *   op) in the last 10 minutes, with the same kind (message -> reply, gate ->
 *   gate). A renderer bug or a compromised renderer cannot make the rig say words
 *   the agent never wrote. Q7 phrases never cross from the renderer at all: the
 *   launcher owns them.
 * - THE BEARER STAYS HERE. The Gateway gets an allowlisted environment
 *   (`qwen-gateway.ts`) and talks to the daemon only through the renderer's own
 *   desktop transport, which this file never sees a credential of.
 */

import { totalmem } from "node:os";
import type { GatewayDownMessage, GatewayUpMessage } from "./qwen-gateway";
import { qwenMachineTooSmall } from "./qwen-rig";
import {
	QWEN_NO_VOICE_WINDOW,
	type QwenMicAccess,
	type QwenMicSettled,
	type QwenVoicePagePort,
} from "./qwen-voice-page";

export type QwenRigState = "stopped" | "starting" | "ready" | "error";

/** `voice.qwen.event`, one allowlisted thing the voice did (plan §10). */
export type QwenVoiceEvent = {
	type: string;
	at: string;
	reason?: string;
	/**
	 * The Gateway's own `accepted` on a playback receipt (review M1): `false`
	 * means the page reported an end for a response this connection was not
	 * playing, so the renderer must not announce it.
	 */
	accepted?: boolean;
};

/** `voice.qwen.status`, the frozen main <-> renderer status shape. */
export type QwenVoiceStatus = {
	rig: QwenRigState;
	webui_url: string | null;
	/** Why the rig is in `error`, as one sentence; null otherwise. */
	reason?: string | null;
	/** Voice pages connected to the Gateway right now. */
	clients?: number;
	/** `unexpected_exit`: a rig process died while the rig was ready. */
	cause?: "unexpected_exit" | null;
	/**
	 * The macOS microphone verdict for this app's identity (plan §2/§4, review
	 * M3). Additive to the frozen status: `denied` is "Microphone blocked - Open
	 * Settings", and `prompting` is the bounded wait going on right now.
	 */
	mic?: QwenMicAccess;
	/**
	 * PAUSED: the hidden page is closed, so the microphone is released, while the
	 * Gateway and the speech models stay warm. Nothing is heard and nothing is
	 * spoken; a take cannot arrive, and a playback event cannot be true.
	 *
	 * Main owns this rather than the window because the page belongs to main: a
	 * reloaded renderer that forgot a pause would paint "Listening" over a closed
	 * page.
	 */
	paused?: boolean;
	/** The page's own playback is silenced (`webContents.setAudioMuted`). */
	muted?: boolean;
};

/**
 * The events that may cross to the renderer: the twin of `VOICE_EVENTS` in
 * `resources/qwen-voice/relay-core.mjs`, which is the launcher's side of the
 * same whitelist (a test asserts the two lists are equal).
 */
export const VOICE_EVENT_TYPES = [
	"realtime.provider.speech_started",
	"realtime.provider.speech_stopped",
	"realtime.playback.started",
	"realtime.playback.ended",
	"realtime.playback.cancelled",
	"realtime.response.done",
	"task.running",
	"task.completed",
] as const;

/** A reason worth crossing: a word, never a sentence. */
const EVENT_REASON = /^[a-z_]{1,32}$/;

/** The Gateway writes ISO-8601; anything else is not a time this app trusts. */
const EVENT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

/**
 * How long a first-run microphone prompt may hold a start (review M3). QA saw
 * the dialog sit unanswered for over four minutes with nobody at the screen;
 * past this the header says "Waiting for microphone permission…" and the start
 * stops until the OS answers.
 */
export const MIC_PROMPT_BUDGET_MS = 5_000;

export const QWEN_IDLE_STOP_MS = 10 * 60_000;
export const QWEN_SPEAK_GUARD_MS = 10 * 60_000;
const RELAYED_LIMIT = 64;
/** A refusal code main forwards to the launcher: a word, never free text. */
const OUTCOME_CODE = /^[a-z_]{1,64}$/;

/** The IPC channel names, exactly the contract's verbs. */
export const QWEN_CHANNEL = {
	take: "voice.qwen.take",
	result: "voice.qwen.result",
	speak: "voice.qwen.speak",
	start: "voice.qwen.start",
	status: "voice.qwen.status",
	statusGet: "voice.qwen.status.get",
	/** Pushed: one allowlisted voice event, `{type, at, reason?}`. */
	event: "voice.qwen.event",
	/** The strip's two controls; both answer the new status. */
	pause: "voice.qwen.pause",
	resume: "voice.qwen.resume",
	mute: "voice.qwen.mute",
	/** Open the OS microphone pane; a main-only path, no renderer URL. */
	openMicSettings: "voice.qwen.open-mic-settings",
} as const;

export interface QwenGatewayPort {
	start(): Promise<string>;
	stop(): void;
	send(message: GatewayDownMessage): boolean;
	readonly running: boolean;
}

export interface QwenSpeechPort {
	start(): Promise<void>;
	stop(): Promise<void>;
	killNow(clearRecord?: boolean): void;
	readonly running: boolean;
}

export type QwenVoiceDeps = {
	gateway: QwenGatewayPort;
	speech: QwenSpeechPort;
	/** Push to the renderer; false when there is no window to receive it. */
	toRenderer: (channel: string, payload: unknown) => boolean;
	/** The hidden voice page (plan §1-§3); a no-op in agent-driven runs. */
	page: QwenVoicePagePort;
	/**
	 * Physical memory in bytes. A machine under 16 GB cannot hold the rig, and
	 * the header says so before anything spawns (review R1).
	 */
	machineBytes?: () => number;
	log?: (message: string) => void;
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
};

type Relayed = { text: string; kind: "reply" | "gate"; at: number };

/** The slot's session id from a `{active}` payload, or null. */
function slotOf(payload: unknown): string | null {
	const active = (
		payload as { active?: { session_id?: unknown } | null } | null
	)?.active;
	return typeof active?.session_id === "string" ? active.session_id : null;
}

export class QwenVoice {
	private status: QwenVoiceStatus = {
		rig: "stopped",
		webui_url: null,
		paused: false,
		muted: false,
	};
	private slot: string | null = null;
	/**
	 * The two controls of the strip that main owns, mirrored into `status` so the
	 * renderer never holds a second copy that can disagree (see `QwenVoiceStatus`).
	 */
	private paused = false;
	private muted = false;
	/**
	 * Whether the page is playing a reply right now, as the Gateway's own events
	 * say. The ONLY thing a move uses it for is deciding whether there is sound
	 * to stop (UX round 1, U3): recreating the page is a real cost and kills the
	 * "Switched." phrase, so a move while nothing plays leaves the page alone.
	 */
	private playing = false;
	/** Voice pages connected to the CURRENT launcher; reset when it stops. */
	private clients = 0;
	private relayed: Relayed[] = [];
	private idleTimer: unknown = null;
	/**
	 * The sentence a start's catch must report instead of its own, set when the
	 * memory guard stops the rig mid-warmup: the guard knows WHY, and the start
	 * path only sees "exited during start".
	 */
	private budgetReason: string | null = null;
	/**
	 * A start stopped on an unanswered microphone prompt, waiting for the OS to
	 * answer so it can resume (review M3). Cleared by the answer either way.
	 */
	private awaitingMic = false;
	private starting: Promise<QwenVoiceStatus> | null = null;
	private readonly log: (message: string) => void;
	private readonly now: () => number;
	private readonly machineBytes: () => number;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;

	constructor(private readonly deps: QwenVoiceDeps) {
		this.log = deps.log ?? (() => {});
		this.now = deps.now ?? Date.now;
		this.machineBytes = deps.machineBytes ?? totalmem;
		this.setTimer =
			deps.setTimer ??
			((fn, ms) => {
				const handle = setTimeout(fn, ms);
				handle.unref?.();
				return handle;
			});
		this.clearTimer =
			deps.clearTimer ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	}

	getStatus(): QwenVoiceStatus {
		return { ...this.status };
	}

	private setStatus(next: QwenVoiceStatus): void {
		/*
		 * THE TWO CONTROLS SURVIVE EVERY STATUS THAT DOES NOT NAME THEM (a start's
		 * "starting", an error's sentence, a client count). They move only through
		 * `pause`/`resume`/`setMuted` - and the places that must CLEAR a pause say
		 * so by clearing the field first, so a rig that stops is never left paused.
		 */
		this.status = {
			...next,
			paused: next.paused ?? this.paused,
			muted: next.muted ?? this.muted,
		};
		this.deps.toRenderer(QWEN_CHANNEL.status, this.getStatus());
	}

	/**
	 * PAUSE: close the hidden page and keep the rig warm.
	 *
	 * The page is where the microphone and the playback live, so closing it
	 * releases the microphone (and lets this app's dictation use it) without
	 * unloading ~5 GB of models: the Gateway and s2s are untouched. That is the
	 * whole of the behaviour, because `open`/`close` already have exactly this
	 * shape - no new work in the rig, and no timeout re-armed: a paused person
	 * must not pay a fresh model load.
	 *
	 * Only a READY rig can be paused; before that there is no page to close.
	 */
	pause(): QwenVoiceStatus {
		if (this.status.rig !== "ready" || this.paused) return this.getStatus();
		this.paused = true;
		this.playing = false;
		this.deps.page.close();
		/* No page, so no client: the count is not a guess, it is a fact - and the
		   private counter moves with it, so a stale `client_attached` cannot put a
		   page back into a count that has none. */
		this.clients = 0;
		this.setStatus({ ...this.status, paused: true, clients: 0 });
		this.log("qwen-voice: paused; the page is closed and the rig stays up");
		return this.getStatus();
	}

	/**
	 * RESUME: recreate the page through the same path as Retry (close, then
	 * open), which re-applies the mute the page remembers.
	 */
	resume(): QwenVoiceStatus {
		if (!this.paused) return this.getStatus();
		this.paused = false;
		const webuiUrl = this.status.webui_url;
		if (this.status.rig === "ready" && webuiUrl) {
			/* `open` is idempotent, so a page that exists is closed first - the
			   Retry path's own reason for doing it in this order. */
			this.deps.page.close();
			this.openPage(webuiUrl);
		}
		this.setStatus({ ...this.status, paused: false });
		this.log("qwen-voice: resumed; the page is being recreated");
		return this.getStatus();
	}

	/**
	 * SILENCE THE VOICE'S OWN SPEECH, not the app and not the rig:
	 * `webContents.setAudioMuted` on the hidden page. Remembered by the page too,
	 * so a recreate comes back muted; the status carries it so the strip and
	 * main cannot disagree.
	 */
	setMuted(muted: boolean): QwenVoiceStatus {
		this.muted = muted;
		this.deps.page.setMuted(muted);
		this.setStatus({ ...this.status, muted });
		return this.getStatus();
	}

	/** One frame off the machine feed (main's own subscription). */
	observeFrame(frame: { type?: string; payload?: unknown }): void {
		if (frame?.type !== "voice") return;
		this.applySlot(slotOf(frame.payload), { start: true });
	}

	/**
	 * Move main's copy of the slot. `start` is true only for a feed frame (an
	 * enable or a switch happened); a slot LEARNED from a status read or a control
	 * answer moves the copy and the idle timer but starts nothing, so an app
	 * relaunched with voice still on does not load the models by itself.
	 */
	private applySlot(next: string | null, { start }: { start: boolean }): void {
		const previous = this.slot;
		this.slot = next;
		if (previous !== next) {
			// Whatever was relayed for the old holder may never be spoken now.
			this.relayed = [];
			this.deps.gateway.send({ type: "cancel_all" });
			this.deps.gateway.send({
				type: "slot",
				active: next ? { session_id: next } : null,
			});
			/*
			 * A MOVE STOPS THE OLD SESSION'S SOUND (UX round 1, U3): `cancel_all`
			 * reaches the Gateway, but audio the hidden page has already queued keeps
			 * playing, and its playback events then arrive attributed to the
			 * conversation the person moved TO. Recreating the page is the only stop
			 * this app owns: it destroys the queued audio, and `openPage` re-applies
			 * the person's mute for the new holder. Only a move between two live
			 * slots - an enable from nothing has no page yet.
			 */
			if (
				previous !== null &&
				next !== null &&
				this.playing &&
				this.status.rig === "ready" &&
				this.status.webui_url
			) {
				this.playing = false;
				this.deps.page.close();
				this.openPage(this.status.webui_url);
			}
		}
		if (next === null) {
			/*
			 * TURNING VOICE OFF ENDS A PAUSE. The page was closed by the pause and
			 * would now stay closed through the next enable - `readyAgain` rightly
			 * refuses to reopen a paused page - so the flag goes with the slot it
			 * describes. Mute is the PERSON's preference and outlives the slot.
			 */
			if (this.paused) {
				this.paused = false;
				this.setStatus({ ...this.status, paused: false });
			}
			/*
			 * NOTHING LISTENS WITHOUT A HOLDER (privacy): the page owns the live
			 * microphone track, so an empty slot closes it at once. The models stay
			 * warm for the idle window, as with Pause. Unconditional (not only on a
			 * change): a learned empty slot must also close a page an earlier path
			 * left open.
			 */
			this.closePageForEmptySlot();
			if (previous !== null || this.idleTimer === null) this.armIdleStop();
			return;
		}
		this.disarmIdleStop();
		/*
		 * A relaunch with voice still on: the renderer's start ran before the slot
		 * was learned, so `openPage` refused (no holder). Open it now the holder
		 * is known; `open` is idempotent for a page that exists.
		 */
		if (!start && previous === null && this.rigUp() && this.status.webui_url)
			this.openPage(this.status.webui_url);
		if (start) void this.start("enable");
	}

	/**
	 * Start the rig (Gateway, then s2s: s2s warms up against the Gateway's relay
	 * LLM). Idempotent; concurrent calls share one start.
	 */
	start(reason: "enable" | "renderer"): Promise<QwenVoiceStatus> {
		if (this.rigUp()) return this.readyAgain(reason);
		/*
		 * A MACHINE THAT CANNOT HOLD THE RIG IS TOLD SO, FIRST (review R1): the
		 * models alone are ~4.8 GB and a healthy idle rig ~5.5 GB, so under 16 GB
		 * the honest answer is a sentence in the header, not a rig that swaps the
		 * machine and then trips the memory guard.
		 */
		const tooSmall = qwenMachineTooSmall(this.machineBytes());
		if (tooSmall) {
			this.log(`qwen-voice: refusing to start: ${tooSmall}`);
			this.setStatus({ rig: "error", webui_url: null, reason: tooSmall });
			return Promise.resolve(this.getStatus());
		}
		/*
		 * NO PAGE, NO RIG (review round 2, minor 1): `voicePageAllowed` hands a
		 * non-normal run `noQwenVoicePage()`, whose `prepareMicrophone` answers
		 * "unknown" - so the microphone gate below passed and ~5.5 GB of models
		 * loaded for a page that does not exist. Refuse here, in the same shape as
		 * R1's machine-size refusal.
		 */
		if (this.deps.page.allowed === false) {
			this.log(`qwen-voice: refusing to start: ${QWEN_NO_VOICE_WINDOW}`);
			this.setStatus({
				rig: "error",
				webui_url: null,
				reason: QWEN_NO_VOICE_WINDOW,
			});
			return Promise.resolve(this.getStatus());
		}
		if (this.starting) return this.starting;
		this.disarmIdleStop();
		this.budgetReason = null;
		this.setStatus({ rig: "starting", webui_url: null });
		this.starting = (async () => {
			try {
				/*
				 * THE MICROPHONE BEFORE THE MODELS (review M3): a first-run prompt
				 * must appear in the first second, and a denial or a prompt nobody
				 * answers must cost no memory. `prompting` means the dialog is up
				 * and unanswered; the start stops here and resumes from
				 * `micSettled` when the OS answers.
				 */
				const mic = await this.preflightMic();
				if (mic === "denied" || mic === "prompting") {
					this.awaitingMic = mic === "prompting";
					this.setStatus({ rig: "stopped", webui_url: null, mic });
					return this.getStatus();
				}
				const webuiUrl = await this.deps.gateway.start();
				await this.deps.speech.start();
				/*
				 * The Gateway can die while s2s loads (the 8-minute leg). Reporting
				 * "ready" over a dead launcher would say Listening with nothing to
				 * hear (review round 2, minor 1).
				 */
				if (!this.deps.gateway.running)
					throw new Error("The voice Gateway stopped while the models loaded");
				this.setStatus({
					rig: "ready",
					webui_url: webuiUrl,
					clients: this.clients,
					mic,
				});
				this.log(`qwen-voice: rig ready (${reason}); WebUI ${webuiUrl}`);
				this.deps.gateway.send({
					type: "slot",
					active: this.slot ? { session_id: this.slot } : null,
				});
				// Started with nothing holding the slot: the idle stop still applies.
				if (this.slot === null) this.armIdleStop();
				this.openPage(webuiUrl);
			} catch (error) {
				const message =
					this.budgetReason ??
					(error instanceof Error ? error.message : String(error));
				this.budgetReason = null;
				this.log(`qwen-voice: rig failed to start: ${message}`);
				await this.stopProcesses();
				this.setStatus({ rig: "error", webui_url: null, reason: message });
			}
			return this.getStatus();
		})().finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	/**
	 * The rig is already up and nothing restarts. Two callers mean different
	 * things:
	 *
	 * - the renderer's Retry (shown while no page is connected) RECREATES the
	 *   page - close first, because `open` is idempotent and a page that exists
	 *   but never connected would otherwise be left exactly as it is;
	 * - an enable re-reads the microphone, because a person can have granted it
	 *   in System Settings since the rig started. A page that was never created
	 *   for a denial is created now that the OS says yes.
	 */
	private async readyAgain(
		reason: "enable" | "renderer",
	): Promise<QwenVoiceStatus> {
		const webuiUrl = this.status.webui_url;
		if (!webuiUrl) return this.getStatus();
		if (reason === "renderer") {
			if (this.paused) return this.getStatus();
			this.deps.page.close();
			this.openPage(webuiUrl);
			return this.getStatus();
		}
		/*
		 * EVERY ENABLE RE-READS THE VERDICT, not only a cached denial: a person
		 * can revoke the microphone in System Settings just as easily as grant
		 * it, and the enable is the moment they expect voice to work. A cached
		 * "granted" would otherwise keep a revoked mic looking healthy.
		 */
		const mic = await this.preflightMic();
		this.setStatus({ ...this.status, mic });
		if (mic === "granted") this.openPage(webuiUrl);
		return this.getStatus();
	}

	/** The microphone check, bounded; a pending prompt resumes via `micSettled`. */
	private async preflightMic(): Promise<QwenMicAccess> {
		try {
			return await this.deps.page.prepareMicrophone({
				timeoutMs: MIC_PROMPT_BUDGET_MS,
				onSettled: (settled) => this.micSettled(settled),
			});
		} catch (error) {
			this.log(
				`qwen-voice: microphone preflight failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return "unknown";
		}
	}

	/**
	 * The OS finally answered a prompt that outlived its budget. A grant starts
	 * the rig (or opens the page on one already up); a denial is the header's
	 * "Microphone blocked".
	 */
	private micSettled(mic: QwenMicSettled): void {
		const resume = this.awaitingMic;
		this.awaitingMic = false;
		if (this.status.mic === mic && !resume) return;
		this.setStatus({ ...this.status, mic });
		if (mic !== "granted") return;
		if (this.rigUp() && this.status.webui_url) {
			this.openPage(this.status.webui_url);
			return;
		}
		// Nothing to resume for if the slot went away while the dialog was up.
		if (resume && this.slot !== null) void this.start("enable");
	}

	/**
	 * THE ONE WAY THE PAGE IS CREATED, so the mute cannot be forgotten: the page
	 * remembers a mute set while it existed, but a mute set before the FIRST page
	 * has nothing to remember it yet - this re-applies the coordinator's copy.
	 * A paused rig creates no page (that is what pause means).
	 */
	private closePageForEmptySlot(): void {
		this.playing = false;
		this.deps.page.close();
		if (this.clients !== 0 || this.status.clients !== 0) {
			this.clients = 0;
			this.setStatus({ ...this.status, clients: 0 });
		}
		if (this.status.rig === "ready")
			this.log("qwen-voice: no session holds voice; the page is closed");
	}

	private openPage(webuiUrl: string): void {
		if (this.paused) return;
		// No holder, no microphone: every open path (start, retry, mic grant) stops here.
		if (this.slot === null) return;
		this.deps.page.open(webuiUrl);
		if (this.muted) this.deps.page.setMuted(true);
	}

	/** Both processes are up and the status says so. */
	private rigUp(): boolean {
		return (
			this.status.rig === "ready" &&
			this.deps.gateway.running &&
			this.deps.speech.running
		);
	}

	/**
	 * A rig process exited without being asked to (wired from both process
	 * hosts in `index.ts`). Under a ready rig that is an error the header must
	 * show; during a start the start path reports it itself, and after a stop
	 * it was asked for.
	 */
	processExited(which: "gateway" | "speech", detail: string): void {
		if (this.status.rig !== "ready") return;
		this.log(`qwen-voice: ${which} exited unexpectedly (${detail})`);
		this.paused = false;
		this.disarmIdleStop();
		void this.stopProcesses();
		this.setStatus({
			rig: "error",
			webui_url: null,
			reason: `${which === "gateway" ? "The voice Gateway" : "speech-to-speech"} exited (${detail}); see the voice logs.`,
			cause: "unexpected_exit",
			clients: 0,
		});
	}

	/**
	 * The hidden page cannot be brought back (a second crash inside a minute).
	 * Nothing can hear now, so a "ready" rig would be the Listening lie; the
	 * rig stops and the header says why.
	 */
	pageFailed(reason: string): void {
		if (this.status.rig !== "ready") return;
		this.log(`qwen-voice: ${reason}`);
		this.paused = false;
		this.disarmIdleStop();
		this.deps.page.close();
		void this.stopProcesses();
		this.setStatus({
			rig: "error",
			webui_url: null,
			reason,
			clients: 0,
		});
	}

	/**
	 * §9 layer 3: the speech process's group footprint passed the budget and the
	 * guard stopped it. Reported as the rig's own error, because nothing else is
	 * true and a silent "ready" over a stopped rig is the failure this exists to
	 * prevent.
	 */
	budgetExceeded(limitBytes: number): void {
		const gib = Number((limitBytes / 1024 ** 3).toFixed(1));
		const message = `Voice stopped: it used more than ${gib} GB`;
		this.log(`qwen-voice: ${message}`);
		this.budgetReason = message;
		// Mid-start: the start path is about to throw and will report this.
		if (this.status.rig === "starting") return;
		if (this.status.rig !== "ready") return;
		this.disarmIdleStop();
		void this.stopProcesses();
		this.setStatus({
			rig: "error",
			webui_url: null,
			reason: message,
			clients: 0,
		});
	}

	/** Stop both processes. Idempotent. */
	async stop(): Promise<void> {
		this.paused = false;
		this.disarmIdleStop();
		await this.stopProcesses();
		if (this.status.rig !== "stopped")
			this.setStatus({ rig: "stopped", webui_url: null });
	}

	private async stopProcesses(): Promise<void> {
		this.clients = 0;
		this.playing = false;
		this.deps.page.close();
		this.deps.gateway.stop();
		await this.deps.speech.stop();
	}

	/**
	 * `will-quit` and `process.on("exit")`: nothing may be awaited, and no model
	 * process may outlive us. Synchronous and idempotent, so the two quit paths
	 * can both call it.
	 */
	/**
	 * `will-quit`, `process.on("exit")`, and a terminating SIGNAL. Synchronous
	 * and idempotent. `clearRecord` is passed by the signal path, which nothing
	 * runs behind (review Q-3): see `QwenSpeechProcess.killNow`.
	 */
	stopNow(clearRecord = false): void {
		this.paused = false;
		this.clients = 0;
		this.playing = false;
		this.disarmIdleStop();
		this.deps.page.close();
		this.deps.gateway.stop();
		this.deps.speech.killNow(clearRecord);
	}

	private armIdleStop(): void {
		this.disarmIdleStop();
		if (this.status.rig === "stopped") return;
		this.idleTimer = this.setTimer(() => {
			this.idleTimer = null;
			if (this.slot === null) {
				this.log("qwen-voice: slot empty for 10 minutes; stopping the rig");
				void this.stop();
			}
		}, QWEN_IDLE_STOP_MS);
	}

	private disarmIdleStop(): void {
		if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
		this.idleTimer = null;
	}

	/**
	 * One allowlisted voice event from the launcher, or null. The launcher
	 * shapes it already; this is the second check, because the Gateway is
	 * third-party code and only a type, a time and a one-word reason may cross.
	 */
	private voiceEvent(raw: unknown): QwenVoiceEvent | null {
		const value = raw as {
			type?: unknown;
			at?: unknown;
			reason?: unknown;
			accepted?: unknown;
		} | null;
		if (!value || typeof value.type !== "string") return null;
		if (!(VOICE_EVENT_TYPES as readonly string[]).includes(value.type))
			return null;
		// ISO-8601 only (review N3): the renderer parses this as a time.
		if (typeof value.at !== "string" || !EVENT_AT.test(value.at)) return null;
		const event: QwenVoiceEvent = { type: value.type, at: value.at };
		if (typeof value.reason === "string" && EVENT_REASON.test(value.reason))
			event.reason = value.reason;
		if (typeof value.accepted === "boolean") event.accepted = value.accepted;
		return event;
	}

	/** One message up from the Gateway launcher. */
	onGatewayMessage(message: GatewayUpMessage): void {
		if (message?.type === "event") {
			/* Nothing is hearing or playing while the page is closed; a late frame
			   from before the pause would put "Hearing you" up over a closed page. */
			if (this.paused) return;
			const event = this.voiceEvent(message.event);
			if (event) {
				/* The page's own play state, for a move's stop (U3). */
				if (event.type === "realtime.playback.started") this.playing = true;
				else if (
					event.type === "realtime.playback.ended" ||
					event.type === "realtime.playback.cancelled"
				)
					this.playing = false;
				this.deps.toRenderer(QWEN_CHANNEL.event, event);
			}
			return;
		}
		if (message?.type === "take") {
			/* NOTHING RELAYS WITHOUT A HOLDER (privacy): a take with an empty slot
			   is dropped. `closed` is a SILENT outcome in the launcher, so the
			   task settles without a spoken phrase and never reaches the session. */
			if (this.slot === null) {
				this.log("qwen-voice: dropped a take: no session holds voice");
				this.deps.gateway.send({
					type: "outcome",
					taskId: message.taskId,
					ok: false,
					code: "closed",
				});
				return;
			}
			/* A take cannot be admitted while paused: the page that heard it is
			   closed, so the only honest answer is the refusal the launcher speaks. */
			if (this.paused) {
				this.deps.gateway.send({
					type: "outcome",
					taskId: message.taskId,
					ok: false,
					code: "paused",
				});
				return;
			}
			const delivered = this.deps.toRenderer(QWEN_CHANNEL.take, {
				taskId: message.taskId,
				text: message.text,
			});
			// The binding lives in the renderer (V14); with no window, nobody can
			// admit the take, and the launcher says so with its `failed` phrase.
			if (!delivered)
				this.deps.gateway.send({
					type: "outcome",
					taskId: message.taskId,
					ok: false,
					code: "no_window",
				});
			return;
		}
		if (message?.type === "status") {
			this.log(`qwen-voice: gateway ${String(message.event)}`);
			if (
				message.event === "client_attached" ||
				message.event === "client_detached"
			) {
				/*
				 * Counted whatever the rig's state: a WebUI tab left open from an
				 * earlier run reconnects while s2s is still loading, and that page
				 * must count once the rig is ready.
				 */
				this.clients =
					typeof message.clients === "number" && message.clients >= 0
						? message.clients
						: 0;
				if (this.status.rig === "ready" && this.clients !== this.status.clients)
					this.setStatus({ ...this.status, clients: this.clients });
			}
		}
	}

	/** `voice.qwen.result {taskId, ok | code}` from the renderer. */
	result(input: unknown): boolean {
		const value = input as { taskId?: unknown; ok?: unknown; code?: unknown };
		if (typeof value?.taskId !== "string" || value.taskId.length > 128)
			return false;
		if (value.ok === true)
			return this.deps.gateway.send({
				type: "outcome",
				taskId: value.taskId,
				ok: true,
			});
		const code =
			typeof value.code === "string" && OUTCOME_CODE.test(value.code)
				? value.code
				: "failed";
		return this.deps.gateway.send({
			type: "outcome",
			taskId: value.taskId,
			ok: false,
			code,
		});
	}

	/**
	 * Every desktop-request answer passes here (wired in `index.ts`); a 200
	 * `voice.text` answer is the only thing that makes a text speakable.
	 */
	noteDesktopAnswer(
		input: unknown,
		response: { status: number; body: unknown },
	): void {
		const request = input as {
			op?: unknown;
			action?: unknown;
			sessionId?: unknown;
			source?: { kind?: unknown };
		};
		if (request?.op === "voice.status" || request?.op === "voice.control") {
			if (response.status < 200 || response.status >= 300) return;
			const result = (response.body as { result?: unknown } | null)?.result;
			// An enable's answer also arrives as a feed frame, which is what starts
			// the rig; this read only keeps the copy current between frames.
			this.applySlot(slotOf(result), { start: false });
			return;
		}
		if (request?.op !== "voice.text") return;
		if (response.status < 200 || response.status >= 300) return;
		if (request.sessionId !== this.slot) return;
		const text = (response.body as { result?: { text?: unknown } } | null)
			?.result?.text;
		if (typeof text !== "string" || !text.trim()) return;
		const kind = request.source?.kind === "gate" ? "gate" : "reply";
		this.relayed.push({ text, kind, at: this.now() });
		if (this.relayed.length > RELAYED_LIMIT)
			this.relayed.splice(0, this.relayed.length - RELAYED_LIMIT);
	}

	/**
	 * `voice.qwen.speak {text, kind}` from the renderer. Honoured only for a text
	 * main relayed itself, within the window, with the same kind; consumed once.
	 */
	speak(input: unknown): { spoken: boolean; reason?: string } {
		const value = input as { text?: unknown; kind?: unknown };
		if (value?.kind !== "reply" && value?.kind !== "gate")
			return { spoken: false, reason: "invalid_kind" };
		if (typeof value.text !== "string")
			return { spoken: false, reason: "invalid_text" };
		const cutoff = this.now() - QWEN_SPEAK_GUARD_MS;
		this.relayed = this.relayed.filter((entry) => entry.at >= cutoff);
		const index = this.relayed.findIndex(
			(entry) => entry.text === value.text && entry.kind === value.kind,
		);
		if (index < 0) return { spoken: false, reason: "not_relayed" };
		if (this.paused) return { spoken: false, reason: "paused" };
		if (this.status.rig !== "ready")
			return { spoken: false, reason: "rig_not_ready" };
		// No voice page connected: nothing would be heard, so nothing is claimed.
		if (this.clients === 0) return { spoken: false, reason: "no_client" };
		const [entry] = this.relayed.splice(index, 1);
		const sent = this.deps.gateway.send({
			type: "speak",
			text: entry.text,
			kind: entry.kind,
		});
		return sent ? { spoken: true } : { spoken: false, reason: "rig_not_ready" };
	}
}
