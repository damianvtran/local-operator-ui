import { randomUUID } from "node:crypto";
import {
	ChiefOfStaffUnavailable,
	resolveChiefOfStaff,
} from "../shared/chief-of-staff";
import {
	COMPANION_CHAT_MAX_CHARS,
	type CompanionChatMessage,
	type CompanionChatSendResult,
	type CompanionChatSnapshot,
} from "../shared/companion-chat";
import type { DesktopResponse } from "../shared/desktop-contract";

interface CompanionChatOptions {
	requestDesktop(input: unknown): Promise<DesktopResponse>;
	onChange(snapshot: CompanionChatSnapshot): void;
	cwd: string;
}

interface TurnPosition {
	epoch: string;
	generation: number;
}

interface PendingSend extends TurnPosition {
	requestId: string;
	text: string;
}

interface TurnWait extends PendingSend {
	sawWorking: boolean;
}

const SESSION_ID = /^[a-f0-9]{12}$/;
const initial = (chiefOfStaff = false): CompanionChatSnapshot => ({
	destination: chiefOfStaff ? "chief-of-staff" : undefined,
	sessionId: null,
	title: chiefOfStaff ? "Chief of staff" : "Companion chat",
	messages: [],
	status: "idle",
	error: null,
	canSend: true,
});

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function result(reply: DesktopResponse): Record<string, unknown> {
	const body = record(reply.body);
	const value = record(body?.result);
	if (reply.status < 200 || reply.status >= 300 || !value) {
		throw Object.assign(
			new Error(
				"The request could not be confirmed. Open the app for details.",
			),
			{ code: record(body?.detail)?.code },
		);
	}
	return value;
}

function message(id: unknown, value: unknown): CompanionChatMessage | null {
	const payload = record(value);
	if (
		typeof id !== "string" ||
		!id ||
		!payload ||
		(payload.kind !== undefined && payload.kind !== "message") ||
		(payload.role !== "user" && payload.role !== "assistant") ||
		!Array.isArray(payload.content)
	)
		return null;
	const text = payload.content
		.map((value) => {
			const block = record(value);
			return block &&
				(block.type === undefined || block.type === "text") &&
				!block.attachment &&
				!block.data &&
				typeof block.text === "string"
				? block.text
				: "";
		})
		.join("");
	if (!text.trim() || text.startsWith("Harness recovery notice:")) return null;
	return {
		id,
		role: payload.role,
		text:
			text.length > 24_000
				? `${text.slice(0, 24_000)}\n\n[Open the app for the full message.]`
				: text,
	};
}

/** Only durable prose and complete message events leave main; no reasoning/tool payloads. */
function transcript(
	history: unknown[],
	liveEvents: unknown[],
): CompanionChatMessage[] {
	const messages = new Map<string, CompanionChatMessage>();
	for (const value of history) {
		const entry = record(value);
		const row =
			entry?.type === "message" ? message(entry.id, entry.payload) : null;
		if (row) messages.set(row.id, row);
	}
	for (const value of liveEvents) {
		const event = record(value);
		const payload = record(event?.message);
		if (
			event?.type !== "message_end" &&
			!(event?.type === "message_start" && payload?.role === "user")
		)
			continue;
		const row = message(payload?.id, payload);
		if (row && !messages.has(row.id)) messages.set(row.id, row);
	}
	return Array.from(messages.values()).slice(-60);
}

export class CompanionChatService {
	private state = initial(true);
	private generation = 0;
	private readId = 0;
	private disposed = false;
	private sending = false;
	private refreshing: Promise<void> | null = null;
	private createRequestId = randomUUID();
	private pending: PendingSend | null = null;
	private waiting: TurnWait | null = null;

	constructor(private readonly options: CompanionChatOptions) {}

	get snapshot(): CompanionChatSnapshot {
		return {
			...this.state,
			messages: this.state.messages.map((row) => ({ ...row })),
			pendingText: this.pending?.text,
			activeQuestion: this.waiting
				? { id: this.waiting.requestId, text: this.waiting.text }
				: undefined,
		};
	}

	private get chiefOfStaff(): boolean {
		return this.state.destination === "chief-of-staff";
	}

	private current(generation: number): boolean {
		return !this.disposed && generation === this.generation;
	}

	private update(changes: Partial<CompanionChatSnapshot>): void {
		if (this.disposed) return;
		this.state = { ...this.state, ...changes };
		this.options.onChange(this.snapshot);
	}

	get canChangeConversation(): boolean {
		return (
			!this.disposed &&
			!this.sending &&
			!this.pending &&
			!this.waiting &&
			this.state.status !== "loading" &&
			this.state.status !== "working"
		);
	}

	private reset(chiefOfStaff = false): void {
		this.generation++;
		this.sending = false;
		this.refreshing = null;
		this.pending = null;
		this.waiting = null;
		this.createRequestId = randomUUID();
		this.update(initial(chiefOfStaff));
	}

	newChat(): boolean {
		return this.chooseConversation("new-chat");
	}

	chooseConversation(destination: "chief-of-staff" | "new-chat"): boolean {
		if (
			!this.canChangeConversation ||
			(destination === "chief-of-staff" && this.chiefOfStaff)
		)
			return false;
		this.reset(destination === "chief-of-staff");
		if (this.chiefOfStaff) void this.refresh();
		return true;
	}

	async open(sessionId?: string | null): Promise<void> {
		if (this.disposed) return;
		if (sessionId && !SESSION_ID.test(sessionId)) {
			this.update({
				error: "This conversation is unavailable.",
				status: "error",
				canSend: false,
			});
			return;
		}
		if (
			sessionId &&
			(sessionId !== this.state.sessionId || this.chiefOfStaff)
		) {
			if (!this.canChangeConversation) return;
			this.reset();
			this.update({ sessionId, status: "loading", canSend: false });
		}
		await this.refresh();
	}

	private async resolveChief(generation: number): Promise<boolean> {
		const readId = this.readId;
		try {
			const { sessionId } = await resolveChiefOfStaff(async (input) =>
				result(await this.options.requestDesktop(input)),
			);
			if (!this.current(generation) || readId !== this.readId) return false;
			if (sessionId !== this.state.sessionId) {
				if (this.pending || this.waiting) {
					this.update({
						status: "error",
						canSend: false,
						error:
							"The chief-of-staff conversation changed. Open the app to check your earlier message.",
					});
					return false;
				}
				this.update({
					...initial(true),
					sessionId,
					status: "loading",
					canSend: false,
				});
			}
			return true;
		} catch (error) {
			if (this.current(generation) && readId === this.readId)
				this.update({
					status: "error",
					canSend: false,
					error:
						error instanceof ChiefOfStaffUnavailable
							? `${error.message} Open the app to continue.`
							: "Could not reach the chief of staff. Open the app to continue.",
				});
			return false;
		}
	}

	private async read(generation: number): Promise<TurnPosition | null> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return null;
		const readId = ++this.readId;
		let reply: DesktopResponse;
		try {
			reply = await this.options.requestDesktop({
				op: "sessions.get",
				sessionId,
			});
		} catch (error) {
			if (!this.current(generation) || readId !== this.readId) return null;
			throw error;
		}
		if (!this.current(generation) || readId !== this.readId) return null;
		const frame = result(reply);
		const payload = record(frame.payload);
		const frontend = record(record(payload?.frontend)?.snapshot);
		const history = record(payload?.history)?.entries;
		if (
			frame.session_id !== sessionId ||
			frontend?.session_id !== sessionId ||
			typeof frontend.streaming !== "boolean" ||
			!Array.isArray(history)
		) {
			throw new Error(
				"Conversation status is unavailable. Open the app to continue.",
			);
		}
		const liveEvents = Array.isArray(frontend.live_events)
			? frontend.live_events
			: [];
		const messages = transcript(history, liveEvents);
		const gate =
			frontend.pending_gate !== null && frontend.pending_gate !== undefined;
		const unavailable =
			payload?.cold_reason === "owner-silent" ||
			payload?.cold_reason === "owner-leaving";
		const failed = frontend.last_turn_outcome === "error";
		const turn = {
			epoch: typeof frontend.epoch === "string" ? frontend.epoch : "",
			generation:
				typeof frontend.generation === "number" ? frontend.generation : 0,
		};
		let working = frontend.streaming;
		const waiting = this.waiting;
		if (waiting) {
			waiting.sawWorking ||= working;
			const position = messages.findIndex(
				(row) => row.id === waiting.requestId && row.role === "user",
			);
			const answered =
				position >= 0 &&
				messages.slice(position + 1).some((row) => row.role === "assistant");
			const settled =
				(turn.epoch === waiting.epoch
					? turn.generation > waiting.generation
					: position >= 0) &&
				["completed", "aborted", "error"].includes(
					String(frontend.last_turn_outcome),
				);
			if (!working && (waiting.sawWorking || answered || gate || settled))
				this.waiting = null;
			else working = true;
		}
		const canSend = !unavailable && !gate && !working;
		this.update({
			title:
				typeof frontend.conversation_title === "string" &&
				frontend.conversation_title.trim()
					? frontend.conversation_title.slice(0, 160)
					: this.chiefOfStaff
						? "Chief of staff"
						: "Companion chat",
			messages,
			status: unavailable
				? "error"
				: gate
					? "attention"
					: working
						? "working"
						: failed
							? "error"
							: "idle",
			error: unavailable
				? "This conversation is reconnecting. Open the app to continue."
				: gate
					? "Open the app to answer the pending question or approval."
					: failed
						? "The last turn stopped with an error. Open the app for details."
						: this.pending
							? "The earlier send is unconfirmed. Retry original to check safely."
							: null,
			canSend: canSend && !this.sending,
		});
		return canSend ? turn : null;
	}

	refresh(): Promise<void> {
		if (
			this.disposed ||
			this.sending ||
			(!this.chiefOfStaff && !this.state.sessionId)
		)
			return Promise.resolve();
		if (this.refreshing) return this.refreshing;
		const generation = this.generation;
		if (!this.state.sessionId)
			this.update({ status: "loading", canSend: false });
		const task = (async () => {
			if (this.chiefOfStaff && !(await this.resolveChief(generation))) return;
			await this.read(generation);
		})()
			.catch(() => {
				if (this.current(generation))
					this.update({
						status: "error",
						canSend: false,
						error:
							"Could not refresh this conversation. Open the app or wait for reconnection.",
					});
			})
			.finally(() => {
				if (this.refreshing === task) this.refreshing = null;
			});
		this.refreshing = task;
		return task;
	}

	async send(text: string): Promise<CompanionChatSendResult> {
		const outcome = (accepted: boolean): CompanionChatSendResult => ({
			accepted,
			snapshot: this.snapshot,
		});
		if (this.disposed || this.sending || !this.state.canSend)
			return outcome(false);
		if (
			typeof text !== "string" ||
			!text.trim() ||
			text.length > COMPANION_CHAT_MAX_CHARS
		) {
			this.update({ error: "Write a message of 1 to 16,000 characters." });
			return outcome(false);
		}
		if (this.pending && this.pending.text !== text) {
			this.update({
				status: "error",
				error:
					"The earlier send may have arrived. Retry original or open the app before sending something different.",
			});
			return outcome(false);
		}
		const generation = this.generation;
		this.sending = true;
		this.readId++;
		this.refreshing = null;
		this.update({ status: "loading", error: null, canSend: false });
		let accepted = false;
		let failure =
			"Chat could not start. Your message is still here; try again or open the app.";
		try {
			if (this.chiefOfStaff && !(await this.resolveChief(generation)))
				return outcome(false);
			if (!this.state.sessionId) {
				const created = result(
					await this.options.requestDesktop({
						op: "sessions.create",
						requestId: this.createRequestId,
						cwd: this.options.cwd,
					}),
				);
				if (!this.current(generation)) return outcome(false);
				if (
					typeof created.session_id !== "string" ||
					!SESSION_ID.test(created.session_id)
				)
					throw new Error("Chat could not start.");
				this.update({ sessionId: created.session_id });
			}
			const turn = await this.read(generation);
			if (!this.current(generation) || !turn) return outcome(false);
			const intent = this.pending ?? {
				text,
				requestId: randomUUID(),
				...turn,
			};
			this.pending = intent;
			failure =
				"Send unconfirmed. Retry original to check; your draft is saved.";
			const reply = await this.options.requestDesktop({
				op: "sessions.message",
				sessionId: this.state.sessionId,
				requestId: intent.requestId,
				text: intent.text,
				mode: "prompt",
			});
			if (!this.current(generation)) return outcome(false);
			if (reply.status === 413 || reply.status === 422) {
				this.pending = null;
				failure =
					"The message was not sent. Edit it or open the app for details.";
			}
			const admitted = result(reply);
			if (
				admitted.status !== "admitted" ||
				admitted.command_id !== intent.requestId
			)
				throw new Error("No admission receipt.");
			accepted = true;
			this.pending = null;
			this.waiting = { ...intent, sawWorking: false };
			this.update({ status: "working", error: null, canSend: false });
		} catch {
			if (this.current(generation))
				this.update({
					status: "error",
					canSend: true,
					error: failure,
				});
		} finally {
			if (this.current(generation)) {
				this.sending = false;
				if (this.state.status === "idle") this.update({ canSend: true });
			}
		}
		if (accepted && this.current(generation)) void this.refresh();
		return outcome(accepted && this.current(generation));
	}

	dispose(): void {
		this.disposed = true;
		this.pending = null;
		this.waiting = null;
	}
}
