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

import type { GatewayDownMessage, GatewayUpMessage } from "./qwen-gateway";
import type { QwenMicAccess, QwenVoicePagePort } from "./qwen-voice-page";

export type QwenRigState = "stopped" | "starting" | "ready" | "error";

/** `voice.qwen.event`, one allowlisted thing the voice did (plan §10). */
export type QwenVoiceEvent = { type: string; at: string; reason?: string };

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
	 * The macOS microphone verdict for this app's identity (plan §2/§4). Additive
	 * to the frozen status: `denied` is what turns "unheard" from a step into
	 * "Microphone blocked - Open Settings".
	 */
	mic?: QwenMicAccess;
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
	killNow(): void;
	readonly running: boolean;
}

export type QwenVoiceDeps = {
	gateway: QwenGatewayPort;
	speech: QwenSpeechPort;
	/** Push to the renderer; false when there is no window to receive it. */
	toRenderer: (channel: string, payload: unknown) => boolean;
	/** The hidden voice page (plan §1-§3); a no-op in agent-driven runs. */
	page: QwenVoicePagePort;
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
	private status: QwenVoiceStatus = { rig: "stopped", webui_url: null };
	private slot: string | null = null;
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
	private starting: Promise<QwenVoiceStatus> | null = null;
	private readonly log: (message: string) => void;
	private readonly now: () => number;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;

	constructor(private readonly deps: QwenVoiceDeps) {
		this.log = deps.log ?? (() => {});
		this.now = deps.now ?? Date.now;
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
		this.status = next;
		this.deps.toRenderer(QWEN_CHANNEL.status, this.getStatus());
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
		}
		if (next === null) {
			if (previous !== null || this.idleTimer === null) this.armIdleStop();
			return;
		}
		this.disarmIdleStop();
		if (start) void this.start("enable");
	}

	/**
	 * Start the rig (Gateway, then s2s: s2s warms up against the Gateway's relay
	 * LLM). Idempotent; concurrent calls share one start.
	 */
	start(reason: "enable" | "renderer"): Promise<QwenVoiceStatus> {
		if (this.rigUp()) return this.readyAgain(reason);
		if (this.starting) return this.starting;
		this.disarmIdleStop();
		this.budgetReason = null;
		this.setStatus({ rig: "starting", webui_url: null });
		this.starting = (async () => {
			try {
				const webuiUrl = await this.deps.gateway.start();
				await this.deps.speech.start();
				/*
				 * The Gateway can die while s2s loads (the 8-minute leg). Reporting
				 * "ready" over a dead launcher would say Listening with nothing to
				 * hear (review round 2, minor 1).
				 */
				if (!this.deps.gateway.running)
					throw new Error("The voice Gateway stopped while the models loaded");
				/*
				 * THE MICROPHONE FIRST (plan §2): the prompt belongs to the moment
				 * voice is turned on, and a denial must become a state the header
				 * shows. A denied page is not created at all - one that loaded
				 * would report a client and hear nothing, which reads as Listening.
				 */
				const mic = await this.deps.page.prepareMicrophone();
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
				if (mic !== "denied") this.deps.page.open(webuiUrl);
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
			this.deps.page.close();
			this.deps.page.open(webuiUrl);
			return this.getStatus();
		}
		if (this.status.mic !== "granted") {
			const mic = await this.deps.page.prepareMicrophone();
			this.setStatus({ ...this.status, mic });
			if (mic !== "denied") this.deps.page.open(webuiUrl);
		}
		return this.getStatus();
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
		this.disarmIdleStop();
		await this.stopProcesses();
		if (this.status.rig !== "stopped")
			this.setStatus({ rig: "stopped", webui_url: null });
	}

	private async stopProcesses(): Promise<void> {
		this.clients = 0;
		this.deps.page.close();
		this.deps.gateway.stop();
		await this.deps.speech.stop();
	}

	/**
	 * `will-quit` and `process.on("exit")`: nothing may be awaited, and no model
	 * process may outlive us. Synchronous and idempotent, so the two quit paths
	 * can both call it.
	 */
	stopNow(): void {
		this.clients = 0;
		this.disarmIdleStop();
		this.deps.page.close();
		this.deps.gateway.stop();
		this.deps.speech.killNow();
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
		} | null;
		if (!value || typeof value.type !== "string") return null;
		if (!(VOICE_EVENT_TYPES as readonly string[]).includes(value.type))
			return null;
		if (typeof value.at !== "string" || value.at.length === 0) return null;
		const event: QwenVoiceEvent = {
			type: value.type,
			at: value.at.slice(0, 40),
		};
		if (typeof value.reason === "string" && EVENT_REASON.test(value.reason))
			event.reason = value.reason;
		return event;
	}

	/** One message up from the Gateway launcher. */
	onGatewayMessage(message: GatewayUpMessage): void {
		if (message?.type === "event") {
			const event = this.voiceEvent(message.event);
			if (event) this.deps.toRenderer(QWEN_CHANNEL.event, event);
			return;
		}
		if (message?.type === "take") {
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
