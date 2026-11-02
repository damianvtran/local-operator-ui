import {
	type CompletionAttentionRow,
	isUnreadAckableCompletion,
} from "../shared/completion-attention";
import type {
	CompletionAttention,
	DesktopFeedFrame,
} from "../shared/desktop-session-contract";
import type { AppIconBadgeSnapshot } from "./app-icon-badge";

interface InboxLevel {
	revision: number;
	unread_count: number;
	waiting_count: number;
	waiting_unread_count: number;
}
interface SessionLevel extends CompletionAttentionRow {
	attention?: CompletionAttention;
	status?: { code: string; revision: number };
}

/** App-main's small projection of existing authorities. No banner sequence,
 * top-N list, rail total, text/title alias or persisted guessed count enters it.
 * Per-session storage contains only the latest receipt/status, never history.
 * Changes update two scalar contributions instead of scanning rows on render.
 */
export class AppAttentionProjection {
	private readonly sessions = new Map<string, SessionLevel>();
	private inbox: InboxLevel | undefined;
	private completions = 0;
	private gates = 0;
	private bridgeUnread = 0;
	private browserPending = false;
	private meshPending = false;
	private epoch: string | undefined;
	private sequence = -1;
	private generation = 0;
	private enabled = true;
	private inboxVersion = 0;
	private meshVersion = 0;

	constructor(
		private readonly publish: (
			snapshot: AppIconBadgeSnapshot,
			enabled: boolean,
		) => void,
	) {}

	/** Fence outstanding HTTP authority reads before reconnect/backend/account reset. */
	reset(publish = true): number {
		this.generation++;
		this.sessions.clear();
		this.inbox = undefined;
		this.completions = this.gates = this.bridgeUnread = 0;
		// Browser consent belongs to this app host, not the backend feed epoch.
		this.meshPending = false;
		this.epoch = undefined;
		this.sequence = -1;
		if (publish) this.emit();
		return this.generation;
	}

	refresh(): void {
		this.emit();
	}

	get currentGeneration(): number {
		return this.generation;
	}
	get currentInboxVersion(): number {
		return this.inboxVersion;
	}
	get currentMeshVersion(): number {
		return this.meshVersion;
	}

	/** A newer approval feed level wins over an in-flight HTTP snapshot. */
	setMeshSnapshot(pending: boolean, version: number, generation: number): void {
		if (version !== this.meshVersion) return;
		this.setMeshPending(pending, generation);
	}

	/** A count API snapshot has no feed revision. Do not let an older HTTP
	 * response overwrite a newer feed level that arrived during the request. */
	setInboxSnapshot(
		level: Omit<InboxLevel, "revision">,
		version: number,
		generation: number,
	): void {
		if (version !== this.inboxVersion) return;
		this.setInbox(
			{ ...level, revision: this.inbox?.revision ?? 0 },
			generation,
		);
	}

	setEnabled(enabled: boolean | undefined, generation = this.generation): void {
		if (generation !== this.generation) return;
		this.enabled = enabled !== false;
		this.emit();
	}

	setInbox(level: InboxLevel, generation = this.generation): void {
		if (generation !== this.generation || !this.validInbox(level)) return;
		if (this.inbox && level.revision < this.inbox.revision) return;
		this.inbox = level;
		this.inboxVersion++;
		this.emit();
	}

	setBridgeUnread(count: number, generation: number): void {
		if (
			generation !== this.generation ||
			!Number.isSafeInteger(count) ||
			count < 0
		)
			return;
		this.bridgeUnread = count;
		this.emit();
	}

	setBrowserPending(pending: boolean): void {
		this.browserPending = pending;
		this.emit();
	}

	setMeshPending(pending: boolean, generation: number): void {
		if (generation !== this.generation) return;
		this.meshPending = pending;
		this.meshVersion++;
		this.emit();
	}

	observe(frame: DesktopFeedFrame): void {
		if (frame.type === "open") {
			// The open snapshot replaces the previous epoch's receipt universe.
			// It is not a batch of completion banners and replays no delivery.
			// Replace the open level atomically; no zero-then-set native flash.
			this.reset(false);
			this.epoch = frame.epoch;
			this.sequence = frame.seq;
			const statuses = frame.payload.attention_status ?? {};
			for (const [identity, attention] of Object.entries(
				frame.payload.attention ?? {},
			)) {
				const id = identity.startsWith("session/")
					? identity.slice(8)
					: identity;
				this.replaceSession(id, { attention, status: statuses[identity] });
			}
			if (
				frame.payload.notifications &&
				this.validInbox(frame.payload.notifications)
			) {
				this.inbox = frame.payload.notifications;
			}
			if (typeof frame.payload.approvals_pending === "boolean")
				this.meshPending = frame.payload.approvals_pending;
			this.emit();
			return;
		}
		if (frame.epoch !== this.epoch || frame.seq <= this.sequence) return;
		this.sequence = frame.seq;
		if (frame.type === "approvals")
			this.setMeshPending(frame.payload.pending, this.generation);
		else if (frame.type === "notifications") this.setInbox(frame.payload);
		else if (frame.type === "attention") {
			const previous = this.sessions.get(frame.session_id) ?? {};
			const old = previous.attention?.revision;
			const next = frame.payload.revision;
			if (old && (next[0] < old[0] || (next[0] === old[0] && next[1] < old[1])))
				return;
			// Retire-for-build is a real completion receipt whose derived status
			// is interrupted. Only the shared predicate decides acknowledgement;
			// no completion kind is a session-removal signal.
			this.replaceSession(frame.session_id, {
				...previous,
				attention: frame.payload,
			});
			this.emit();
		} else if (frame.type === "session_status") {
			const previous = this.sessions.get(frame.session_id) ?? {};
			if (previous.status && frame.payload.revision < previous.status.revision)
				return;
			this.replaceSession(frame.session_id, {
				...previous,
				status: frame.payload,
			});
			this.emit();
		}
		// notification/legacy mirror/Aida presentations have no contribution.
	}

	private replaceSession(id: string, next: SessionLevel): void {
		const old = this.sessions.get(id);
		this.completions +=
			Number(isUnreadAckableCompletion(next)) -
			Number(old ? isUnreadAckableCompletion(old) : false);
		this.gates +=
			Number(this.isGate(next)) - Number(old ? this.isGate(old) : false);
		this.sessions.set(id, next);
	}

	private isGate(row: SessionLevel): boolean {
		// Backend-derived actionable status, not an inferred numeric read receipt.
		return row.status?.code === "approval" || row.status?.code === "answer";
	}

	private validInbox(level: InboxLevel): boolean {
		return [
			level.revision,
			level.unread_count,
			level.waiting_count,
			level.waiting_unread_count,
		].every((value) => Number.isSafeInteger(value) && value >= 0);
	}

	private emit(): void {
		this.publish(
			{
				unreadCount:
					(this.inbox?.unread_count ?? 0) +
					(this.inbox?.waiting_unread_count ?? 0) +
					this.completions +
					this.bridgeUnread,
				pending:
					(this.inbox?.waiting_count ?? 0) > 0 ||
					this.gates > 0 ||
					this.browserPending ||
					this.meshPending,
			},
			this.enabled,
		);
	}
}
