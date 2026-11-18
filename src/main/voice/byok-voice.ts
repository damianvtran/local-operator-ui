/**
 * BRING-YOUR-OWN-KEY VOICE IN MAIN (design: the backend's
 * docs/design/session-voice-groq.md, D2, D3, D7 U2): the app-owned voice page
 * hears, the daemon's ElevenLabs path transcribes and speaks, and this file is
 * the relay between them. It owns no rig and loads no model.
 *
 * Electron-free on purpose: the page, the media relay and the renderer are
 * injected from `index.ts`, so the rules are tested as plain code
 * (`scripts/byok-voice-main.test.mjs`).
 *
 * THE RULES
 *
 * - LISTEN only while the coordinator says so (`apply`): voice on, this engine,
 *   a slot holder, not paused. The microphone is asked for BEFORE the page is
 *   created, and a missing key opens no page at all (nothing listens for voice
 *   that cannot answer).
 * - NOTHING LISTENS WITHOUT A HOLDER (privacy): an empty slot or voice off
 *   closes the page at once, and a take that arrives anyway is dropped here -
 *   no request, nothing relayed.
 * - A TAKE is the page's WAV. It goes to `voice.utterance` pinned to
 *   ElevenLabs with a fresh dashed id; the renderer is told BEFORE it is sent
 *   (so it can arm the V14 binding first, as the rig path does) and after.
 *   Main never decides what the words mean and has no path to a gate answer
 *   (V7): the route admits them as an ordinary prompt or steer, or refuses.
 * - SPEAKING is a SOURCE REFERENCE plus a segment index (V8): main never holds
 *   words it could be handed. `QwenVoice.speak` hands over only a text main
 *   relayed from a 200 `voice.text`, with its source and segment count. One
 *   segment ahead, never more: segment i+1 is fetched when the page reports i
 *   has STARTED, so an interrupted reply wastes at most one request of quota.
 * - BARGE-IN: the page stops its own audio at once; main stops fetching and
 *   tells the renderer the playback was cancelled.
 */

import type { PlayMessage } from "../../voice-page/channels";
import type { DesktopMediaResponse } from "../desktop-media";
import { QWEN_CHANNEL } from "./qwen-voice";
import type {
	MicrophonePreflight,
	QwenMicAccess,
	QwenMicSettled,
} from "./qwen-voice-page";

/** The channel main pushes a take's or a reply's progress to the renderer on. */
export const BYOK_CHANNEL = "voice.qwen.byok";

/** The one provider this path is pinned to. */
export const BYOK_PROVIDER = "elevenlabs";

/** The route's own ceiling; a larger take is dropped here, not as its 413. */
const MAX_TAKE_BYTES = 16 * 1024 * 1024;
/** A WAV header is 44 bytes; anything shorter holds no audio. */
const MIN_TAKE_BYTES = 44;
/** How long a first-run microphone prompt may hold listening (as the rig's). */
const MIC_PROMPT_BUDGET_MS = 5_000;

export type ByokState =
	| "idle"
	| "listening"
	| "key_missing"
	| "mic_denied"
	| "mic_prompting"
	| "page_failed"
	| "no_window";

/** What the renderer is told about a take or a reply, on `BYOK_CHANNEL`. */
export type ByokMessage =
	| { kind: "take_start"; sessionId: string; requestId: string }
	| { kind: "take_done"; sessionId: string; requestId: string; text: string }
	| {
			kind: "take_failed";
			sessionId: string;
			requestId: string;
			status: number;
			code: string;
	  }
	| { kind: "speech_failed"; sessionId: string; code: string };

/** The app-owned voice page, as this file sees it (`byok-voice-page.ts`). */
export interface ByokPagePort {
	readonly allowed: boolean;
	open(): void;
	close(): void;
	play(message: PlayMessage): void;
	stop(): void;
	setMuted(muted: boolean): void;
	prepareMicrophone(options?: MicrophonePreflight): Promise<QwenMicAccess>;
}

export type ByokSpeakEntry = {
	sessionId: string;
	kind: "reply" | "gate";
	source:
		| { kind: "message"; messageId: string }
		| { kind: "gate"; requestId: string };
	/** How many segments `voice.text` said the reply has. */
	segments: number;
};

/** What `QwenVoice` calls; the real class below and a test fake both fit. */
export interface ByokVoicePort {
	apply(state: { active: boolean; slot: string | null; muted: boolean }): void;
	/** `voice.status`'s `byok.ready`; null when the backend says nothing. */
	setKeyReady(ready: boolean | null): void;
	speak(entry: ByokSpeakEntry): { spoken: boolean; reason?: string };
	stop(): void;
}

export type ByokVoiceDeps = {
	page: ByokPagePort;
	/** Main's authenticated media relay; the bearer never crosses this seam. */
	media: (
		request: unknown,
		bytes: Uint8Array<ArrayBuffer> | null,
	) => Promise<DesktopMediaResponse>;
	/** Push to the renderer; false when there is no window to receive it. */
	toRenderer: (channel: string, payload: unknown) => boolean;
	/** The coordinator maps each state onto the strip's own status. */
	report: (state: ByokState) => void;
	newId?: () => string;
	now?: () => number;
	log?: (message: string) => void;
};

type Reply = {
	id: string;
	sessionId: string;
	cancelled: boolean;
	/** Whether the page said the first segment began (Speaking was announced). */
	started: boolean;
	/** Resolvers waiting for a segment to START, by index. */
	waiting: Map<number, () => void>;
};

/** A refusal's declared word, or "failed" for anything undeclared. */
function codeOf(response: DesktopMediaResponse): string {
	return response.kind === "error"
		? (response.voiceCode ?? "failed")
		: "failed";
}

export class ByokVoice implements ByokVoicePort {
	private active = false;
	private slot: string | null = null;
	private muted: boolean | null = null;
	private keyReady: boolean | null = null;
	private pageOpen = false;
	/** A page that could not be brought back; cleared when listening is switched off. */
	private failed = false;
	private preflighting = false;
	/** Bumped by every close, so a microphone answer that outlived it is stale. */
	private generation = 0;
	private reported: ByokState | null = null;
	private reply: Reply | null = null;
	private readonly newId: () => string;
	private readonly now: () => number;
	private readonly log: (message: string) => void;

	constructor(private readonly deps: ByokVoiceDeps) {
		this.newId = deps.newId ?? (() => crypto.randomUUID());
		this.now = deps.now ?? Date.now;
		this.log = deps.log ?? (() => {});
	}

	/**
	 * The coordinator's one input: whether this engine should be listening, for
	 * whom, and the person's mute. Idempotent; called on every change.
	 */
	apply(state: { active: boolean; slot: string | null; muted: boolean }): void {
		const moved = this.slot !== state.slot;
		this.slot = state.slot;
		if (this.muted !== state.muted) {
			this.muted = state.muted;
			this.deps.page.setMuted(state.muted);
		}
		this.active = state.active && state.slot !== null;
		if (!this.active) {
			this.shutdown();
			return;
		}
		// A move between two sessions stops the old one's sound; the page stays.
		if (moved) this.stopReply();
		void this.ensureListening();
	}

	setKeyReady(ready: boolean | null): void {
		if (this.keyReady === ready) return;
		this.keyReady = ready;
		if (!this.active) return;
		if (ready === false) {
			this.closePage();
			this.say("key_missing");
			return;
		}
		void this.ensureListening();
	}

	/** The page cannot be brought back (a second crash inside a minute). */
	pageStopped(reason: string): void {
		this.log(`byok-voice: ${reason}`);
		// The page adapter has already dropped its view; there is nothing to close.
		this.generation += 1;
		this.stopReply();
		this.pageOpen = false;
		this.failed = true;
		this.say("page_failed");
	}

	stop(): void {
		this.active = false;
		this.slot = null;
		this.shutdown();
	}

	/** `voice-page:take`: one finished utterance's WAV, from the page's own contents. */
	onTake(raw: unknown): void {
		const sessionId = this.slot;
		// PRIVACY: a take with no holder (or voice off) is dropped, not relayed.
		if (!this.active || sessionId === null) return;
		if (!(raw instanceof Uint8Array)) return;
		if (raw.byteLength < MIN_TAKE_BYTES || raw.byteLength > MAX_TAKE_BYTES)
			return;
		// "RIFF....WAVE": the page's encoder writes it; anything else is not ours.
		if (!hasWavHeader(raw)) return;
		// A copy, ArrayBuffer-backed, as the media relay's Blob requires.
		const bytes = new Uint8Array(raw);
		const requestId = this.newId();
		this.send({ kind: "take_start", sessionId, requestId });
		void this.upload(sessionId, requestId, bytes);
	}

	/** `voice-page:vad`: the page's detector, as the strip's hearing events. */
	onVad(raw: unknown): void {
		if (!this.active || this.slot === null) return;
		if (raw !== "speech_start" && raw !== "speech_end") return;
		this.event(
			raw === "speech_start"
				? "realtime.provider.speech_started"
				: "realtime.provider.speech_stopped",
		);
		// The page already stopped its own audio; main stops fetching.
		if (raw === "speech_start") this.stopReply();
	}

	/** `voice-page:progress`: the page's audio clock, which gates "one ahead". */
	onProgress(raw: unknown): void {
		const reply = this.reply;
		if (!reply || reply.cancelled) return;
		const value = raw as {
			kind?: unknown;
			replyId?: unknown;
			index?: unknown;
		} | null;
		if (!value || value.replyId !== reply.id) return;
		if (value.kind === "segment_start") {
			if (
				typeof value.index !== "number" ||
				!Number.isInteger(value.index) ||
				value.index < 0
			)
				return;
			if (value.index === 0 && !reply.started) {
				reply.started = true;
				this.event("realtime.playback.started");
			}
			reply.waiting.get(value.index)?.();
			reply.waiting.delete(value.index);
			return;
		}
		if (value.kind === "drained") {
			reply.cancelled = true;
			this.reply = null;
			this.event("realtime.playback.ended", { accepted: true });
		}
	}

	/** Speak a relayed reply, segment by segment. The words are the server's. */
	speak(entry: ByokSpeakEntry): { spoken: boolean; reason?: string } {
		if (!this.active || this.slot === null || entry.sessionId !== this.slot)
			return { spoken: false, reason: "not_active" };
		if (!this.pageOpen) return { spoken: false, reason: "no_client" };
		if (!(entry.segments > 0)) return { spoken: false, reason: "no_segments" };
		this.stopReply();
		const reply: Reply = {
			id: this.newId(),
			sessionId: entry.sessionId,
			cancelled: false,
			started: false,
			waiting: new Map(),
		};
		this.reply = reply;
		void this.play(reply, entry);
		return { spoken: true };
	}

	/* ---------------------------------------------------------------------- */

	private async upload(
		sessionId: string,
		requestId: string,
		bytes: Uint8Array<ArrayBuffer>,
	): Promise<void> {
		let response: DesktopMediaResponse;
		try {
			response = await this.deps.media(
				{
					op: "voice.utterance",
					sessionId,
					requestId,
					provider: BYOK_PROVIDER,
				},
				bytes,
			);
		} catch (error) {
			this.log(
				`byok-voice: take failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			this.send({
				kind: "take_failed",
				sessionId,
				requestId,
				status: 0,
				code: "failed",
			});
			return;
		}
		if (response.kind === "json" && response.status < 300) {
			const text = (response.body as { result?: { text?: unknown } } | null)
				?.result?.text;
			this.send({
				kind: "take_done",
				sessionId,
				requestId,
				text: typeof text === "string" ? text : "",
			});
			return;
		}
		this.send({
			kind: "take_failed",
			sessionId,
			requestId,
			status: response.status,
			code: codeOf(response),
		});
	}

	private async play(reply: Reply, entry: ByokSpeakEntry): Promise<void> {
		for (let index = 0; index < entry.segments; index += 1) {
			if (reply.cancelled) return;
			let response: DesktopMediaResponse;
			try {
				response = await this.deps.media(
					{
						op: "voice.speech",
						sessionId: entry.sessionId,
						source: entry.source,
						segment: index,
						provider: BYOK_PROVIDER,
					},
					null,
				);
			} catch {
				response = { status: 0, kind: "error", detail: "" };
			}
			if (reply.cancelled) return;
			// ElevenLabs answers MP3; the type is the server's word, so only "is it audio".
			if (
				response.kind !== "bytes" ||
				response.status >= 300 ||
				!response.mimeType.startsWith("audio/")
			) {
				this.failReply(reply, codeOf(response));
				return;
			}
			this.deps.page.play({
				id: { replyId: reply.id, index },
				bytes: response.data,
				...(index === entry.segments - 1 ? { last: true } : {}),
			});
			if (index < entry.segments - 1) {
				// One ahead: the next request waits for this segment to begin.
				await new Promise<void>((resolve) => {
					reply.waiting.set(index, resolve);
				});
			}
		}
	}

	private failReply(reply: Reply, code: string): void {
		if (reply.cancelled) return;
		this.send({ kind: "speech_failed", sessionId: reply.sessionId, code });
		// The audio already pushed plays out; the Speaking state is released now.
		this.cancelReply(reply);
	}

	/** End the current reply: stop the page, release anything waiting. */
	private stopReply(): void {
		const reply = this.reply;
		if (!reply) return;
		this.deps.page.stop();
		this.cancelReply(reply);
	}

	private cancelReply(reply: Reply): void {
		reply.cancelled = true;
		for (const release of reply.waiting.values()) release();
		reply.waiting.clear();
		if (this.reply === reply) this.reply = null;
		if (reply.started) this.event("realtime.playback.cancelled");
	}

	private async ensureListening(): Promise<void> {
		if (!this.active || this.failed) return;
		if (this.keyReady === false) {
			this.closePage();
			this.say("key_missing");
			return;
		}
		if (this.pageOpen) {
			this.say("listening");
			return;
		}
		if (this.deps.page.allowed === false) {
			this.say("no_window");
			return;
		}
		// One question at a time: a repeat apply while the prompt is up must not ask again.
		if (this.preflighting) return;
		this.preflighting = true;
		const generation = this.generation;
		let mic: QwenMicAccess;
		try {
			mic = await this.deps.page.prepareMicrophone({
				timeoutMs: MIC_PROMPT_BUDGET_MS,
				onSettled: (settled) => this.micSettled(generation, settled),
			});
		} catch {
			mic = "unknown";
		} finally {
			this.preflighting = false;
		}
		if (generation !== this.generation || !this.active) return;
		if (mic === "denied") this.say("mic_denied");
		else if (mic === "prompting") this.say("mic_prompting");
		else this.openListening();
	}

	/** The OS answered a prompt that outlived its budget. */
	private micSettled(generation: number, settled: QwenMicSettled): void {
		if (generation !== this.generation || !this.active) return;
		if (settled === "granted") this.openListening();
		else this.say("mic_denied");
	}

	private openListening(): void {
		if (this.pageOpen || this.keyReady === false) return;
		this.deps.page.open();
		this.pageOpen = true;
		this.say("listening");
	}

	/** `always` closes even a page this file thinks is closed (idempotent, and cheap). */
	private closePage(always = false): void {
		this.generation += 1;
		this.stopReply();
		if (this.pageOpen || always) this.deps.page.close();
		this.pageOpen = false;
	}

	/** Listening is over: close the page (releasing the microphone) and say idle. */
	private shutdown(): void {
		this.failed = false;
		this.closePage(true);
		this.say("idle");
	}

	private say(state: ByokState): void {
		if (this.reported === state) return;
		this.reported = state;
		this.deps.report(state);
	}

	private send(message: ByokMessage): void {
		this.deps.toRenderer(BYOK_CHANNEL, message);
	}

	/** An allowlisted voice event in the shape the renderer already parses. */
	private event(type: string, extra: { accepted?: boolean } = {}): void {
		this.deps.toRenderer(QWEN_CHANNEL.event, {
			type,
			at: new Date(this.now()).toISOString(),
			...extra,
		});
	}
}

function hasWavHeader(bytes: Uint8Array): boolean {
	return (
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x41 &&
		bytes[10] === 0x56 &&
		bytes[11] === 0x45
	);
}
