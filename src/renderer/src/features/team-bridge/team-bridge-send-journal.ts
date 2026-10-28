import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";

/** Upload snapshots belong to the adapter, never to a mounted composer. No
 * File, object URL owner, callback, or UI chip is required by the journal. */
export type TeamBridgeSendAttachmentSnapshot =
	| null
	| boolean
	| number
	| string
	| TeamBridgeSendAttachmentSnapshot[]
	| { [key: string]: TeamBridgeSendAttachmentSnapshot };

export type TeamBridgeSendAuthority = {
	accountId: string;
	tenantId: string;
	epoch: string | number;
};
export type TeamBridgeSendConversation = {
	id: string;
	tenant_id: string;
	[key: string]: unknown;
};
export type TeamBridgeSendState =
	| "queued"
	| "creating"
	| "staging"
	| "posting"
	| "confirmed"
	| "failed";
export type TeamBridgeSendError = {
	kind: "authority" | "create" | "stage" | "post";
	message: string;
};
export type TeamBridgeSendRow<A = TeamBridgeSendAttachmentSnapshot> = {
	clientRef: string;
	accountId: string;
	tenantId: string;
	targetKey: string;
	epoch: string | number;
	conversationId: string | null;
	body: string;
	attachments: A;
	message: TeamBridgeMessage;
	state: TeamBridgeSendState;
	serverId: string | null;
	serverMessage: TeamBridgeMessage | null;
	error: TeamBridgeSendError | null;
	attempt: number;
	enqueuedAt: number;
	startedAt: number | null;
	settledAt: number | null;
};
export type TeamBridgeSendInput<A = TeamBridgeSendAttachmentSnapshot> = {
	authority: TeamBridgeSendAuthority;
	targetKey: string;
	conversationId?: string;
	clientRef?: string;
	body: string;
	attachments: A;
	sender: TeamBridgeMessage["sender"];
	createdAt?: string;
};
export type TeamBridgeSendEffects<A = TeamBridgeSendAttachmentSnapshot> = {
	/** Capture an auth epoch, not a view mount or the current selection. Each
	 * upload inside stage and each async callback must fence its own awaits. */
	assertCurrent(): void;
	create?(): Promise<TeamBridgeSendConversation>;
	stage?(
		conversation: TeamBridgeSendConversation,
		row: TeamBridgeSendRow<A>,
	): Promise<A | void>;
	post(
		conversation: TeamBridgeSendConversation,
		row: TeamBridgeSendRow<A>,
	): Promise<unknown>;
	onCreated?(
		conversation: TeamBridgeSendConversation,
		row: TeamBridgeSendRow<A>,
	): void;
	onConfirmed?(row: TeamBridgeSendRow<A>, result: unknown): void;
	/** Cleanup only, including stale/cleared attempts. Never publish caches or
	 * UI state under a newly observed owner from this callback. */
	onSettled?(row: TeamBridgeSendRow<A>): void;
};
export type TeamBridgeSendProjectedItem<A = TeamBridgeSendAttachmentSnapshot> = {
	key: string;
	message: TeamBridgeMessage;
	row: TeamBridgeSendRow<A> | null;
};

type Attempt<A> = {
	row: TeamBridgeSendRow<A>;
	effects: TeamBridgeSendEffects<A>;
	lane: Lane<A>;
	valid: boolean;
	order: number;
};
type DisplaySlot = { key: string; seq?: number };
const localSlotKey = (clientRef: string) => JSON.stringify(["local", clientRef]);
const canonicalSlotKey = (id: string) => JSON.stringify(["canonical", id]);
type Lane<A> = {
	accountId: string;
	tenantId: string;
	receipt: TeamBridgeSendConversation | null;
	created: boolean;
	announcedEpoch: string | number | null;
	creating: Promise<TeamBridgeSendConversation> | null;
	queue: Attempt<A>[];
	active: Promise<void> | null;
	redirect: Lane<A> | null;
	cleared: boolean;
	display: DisplaySlot[];
	observed: boolean;
};

export const teamBridgeConversationTargetKey = (id: string) =>
	`conversation:${id}`;
const laneKey = (accountId: string, tenantId: string, targetKey: string) =>
	JSON.stringify([accountId, tenantId, targetKey]);
const rowKey = (accountId: string, tenantId: string, clientRef: string) =>
	JSON.stringify([accountId, tenantId, clientRef]);
function requireScope(value: string) {
	if (typeof value !== "string" || !value.trim() || value === "*")
		throw new Error("Team Bridge send requires a concrete owner and tenant");
}
function requireAuthority(authority: TeamBridgeSendAuthority) {
	requireScope(authority.accountId);
	requireScope(authority.tenantId);
	if (
		(typeof authority.epoch !== "number" && typeof authority.epoch !== "string") ||
		(typeof authority.epoch === "number" && !Number.isFinite(authority.epoch)) ||
		authority.epoch === ""
	)
		throw new Error("Team Bridge send requires an auth epoch");
}
function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}
function serverReceipt(result: unknown, conversationId: string) {
	const outer = record(result);
	const candidate = record(outer?.message) ?? outer;
	const id = candidate?.id ?? outer?.message_id;
	const sender = record(candidate?.sender);
	const message =
		candidate?.conversation_id === conversationId &&
		typeof candidate.id === "string" &&
		typeof candidate.seq === "number" &&
		typeof candidate.created_at === "string" &&
		(candidate.body === null || typeof candidate.body === "string") &&
		typeof sender?.account_id === "string" &&
		typeof sender.display_label === "string" &&
		(sender.kind === "human" || sender.kind === "agent") &&
		["human", "agent", "system"].includes(String(candidate.origin))
			? (candidate as TeamBridgeMessage)
			: null;
	return { id: typeof id === "string" && id ? id : null, message };
}

/** In-memory, QueryClient-owned outbox: route teardown must not cancel a send.
 * Every lane and receipt is owner+tenant qualified. Epochs fence attempts, not
 * receipts: a fresh retry can reuse a group created before logout without
 * reviving the old closure or duplicating that group. No cache or UI effects
 * run until the adapter's captured authority has been checked again.
 *
 * Confirmed rows remain for this journal's lifetime. They retain the local
 * position and React key while exact server IDs/client_refs replace content;
 * projection is pure and never prunes or notifies during React render. */
export class TeamBridgeSendJournal<A = TeamBridgeSendAttachmentSnapshot> {
	private readonly lanes = new Map<string, Lane<A>>();
	private readonly attempts = new Map<string, Attempt<A>>();
	private readonly listeners = new Set<() => void>();
	private readonly rowSnapshots = new Map<string, readonly TeamBridgeSendRow<A>[]>();
	private revision = 0;
	private nextOrder = 0;
	private readonly now: () => number;

	constructor(options: { now?: () => number } = {}) {
		this.now = options.now ?? Date.now;
	}
	getRevision = () => this.revision;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private changed() {
		this.revision++;
		this.rowSnapshots.clear();
		for (const listener of this.listeners) listener();
	}
	private root(lane: Lane<A>): Lane<A> {
		return lane.redirect ? this.root(lane.redirect) : lane;
	}
	private lane(accountId: string, tenantId: string, targetKey: string) {
		const key = laneKey(accountId, tenantId, targetKey);
		let lane = this.lanes.get(key);
		if (!lane) {
			lane = { accountId, tenantId, receipt: null, created: false, announcedEpoch: null, creating: null, queue: [], active: null, redirect: null, cleared: false, display: [], observed: false };
			this.lanes.set(key, lane);
		}
		return this.root(lane);
	}
	private isLive(attempt: Attempt<A>) {
		return attempt.valid && this.attempts.get(rowKey(attempt.row.accountId, attempt.row.tenantId, attempt.row.clientRef)) === attempt;
	}
	private assert(attempt: Attempt<A>) {
		if (!this.isLive(attempt)) throw new Error("Team Bridge attempt superseded");
		attempt.effects.assertCurrent();
	}
	private update(attempt: Attempt<A>, patch: Partial<TeamBridgeSendRow<A>>) {
		if (!this.isLive(attempt)) return;
		attempt.row = { ...attempt.row, ...patch };
		this.changed();
	}

	enqueue(input: TeamBridgeSendInput<A>, effects: TeamBridgeSendEffects<A>): TeamBridgeSendRow<A> {
		const { accountId, tenantId, epoch } = input.authority;
		requireAuthority(input.authority);
		requireScope(input.targetKey);
		if (input.sender.account_id !== accountId)
			throw new Error("Team Bridge sender does not match owner");
		effects.assertCurrent();
		const clientRef = input.clientRef ?? crypto.randomUUID();
		requireScope(clientRef);
		const key = rowKey(accountId, tenantId, clientRef);
		const existing = this.attempts.get(key);
		// A repeated click cannot mutate a captured payload under an idempotency
		// key. A failed send has an explicit fresh-authority retry instead.
		if (existing) throw new Error("Team Bridge client reference already enqueued");
		let lane = this.lane(accountId, tenantId, input.targetKey);
		if (input.conversationId) {
			requireScope(input.conversationId);
			const alias = this.lanes.get(laneKey(accountId, tenantId, teamBridgeConversationTargetKey(input.conversationId)));
			if (alias) {
				lane = this.root(alias);
				this.lanes.set(laneKey(accountId, tenantId, input.targetKey), lane);
			}
			lane.receipt ??= { id: input.conversationId, tenant_id: tenantId };
			this.lanes.set(laneKey(accountId, tenantId, teamBridgeConversationTargetKey(input.conversationId)), lane);
		}
		const timestamp = this.now();
		const conversationId = lane.receipt?.id ?? null;
		const row: TeamBridgeSendRow<A> = {
			clientRef, accountId, tenantId, targetKey: input.targetKey, epoch,
			conversationId, body: input.body, attachments: input.attachments,
			message: { id: `local:${clientRef}`, conversation_id: conversationId ?? input.targetKey, seq: 0, sender: { ...input.sender }, body: input.body, origin: "human", created_at: input.createdAt ?? new Date().toISOString(), client_ref: clientRef },
			state: "queued", serverId: null, serverMessage: null, error: null,
			attempt: 1, enqueuedAt: timestamp, startedAt: null, settledAt: null,
		};
		const attempt = { row, effects, lane, valid: true, order: this.nextOrder++ };
		this.attempts.set(key, attempt);
		lane.queue.push(attempt);
		lane.display.push({ key: localSlotKey(clientRef) });
		this.changed();
		// The composer can detach its upload snapshot and clear its draft in the
		// same event before any async effect observes it.
		queueMicrotask(() => this.pump(lane));
		return row;
	}

	retry(clientRef: string, authority: TeamBridgeSendAuthority, effects: TeamBridgeSendEffects<A>): TeamBridgeSendRow<A> | null {
		requireAuthority(authority);
		const key = rowKey(authority.accountId, authority.tenantId, clientRef);
		const previous = this.attempts.get(key);
		if (!previous || previous.row.state !== "failed") return null;
		effects.assertCurrent();
		previous.valid = false;
		const lane = this.root(previous.lane);
		const row: TeamBridgeSendRow<A> = { ...previous.row, epoch: authority.epoch, state: "queued", error: null, attempt: previous.row.attempt + 1, startedAt: null, settledAt: null };
		const attempt = { row, effects, lane, valid: true, order: this.nextOrder++ };
		this.attempts.set(key, attempt);
		lane.queue.push(attempt);
		this.changed();
		queueMicrotask(() => this.pump(lane));
		return row;
	}

	/** An explicit owner avoids resolving caller-supplied clientRefs globally. */
	discard(clientRef: string, accountId: string, tenantId: string): boolean {
		const key = rowKey(accountId, tenantId, clientRef);
		const attempt = this.attempts.get(key);
		if (!attempt || attempt.row.state !== "failed") return false;
		attempt.valid = false;
		this.attempts.delete(key);
		for (const lane of this.lanes.values()) {
			if (this.root(lane) === attempt.lane)
				lane.display = lane.display.filter((slot) => slot.key !== localSlotKey(clientRef));
		}
		this.changed();
		return true;
	}

	private pump(lane: Lane<A>) {
		lane = this.root(lane);
		if (lane.active) return;
		const attempt = lane.queue.shift();
		if (!attempt) return;
		// Set active before run begins: callbacks may synchronously enqueue.
		lane.active = Promise.resolve().then(() => this.run(attempt)).finally(() => {
			lane.active = null;
			this.pump(lane);
		});
	}
	private async run(attempt: Attempt<A>) {
		let phase: TeamBridgeSendError["kind"] = "authority";
		try {
			this.assert(attempt);
			this.update(attempt, { startedAt: this.now() });
			let lane = this.root(attempt.lane);
			let conversation = lane.receipt;
			if (!conversation) {
				this.update(attempt, { state: "creating" });
				phase = "create";
				this.assert(attempt);
				if (!attempt.effects.create) throw new Error("Missing conversation creator");
				lane.creating ??= attempt.effects.create();
				try {
					conversation = await lane.creating;
				} finally {
					lane.creating = null;
				}
				// Explicit receipt clearing fences even the otherwise-retained late
				// create. A shared create settling one await must not continue a
				// subsequent attempt without its own synchronous authority check.
				if (!this.isLive(attempt) || lane.cleared) return;
				requireScope(conversation.id);
				if (conversation.tenant_id !== attempt.row.tenantId) throw new Error("Conversation tenant mismatch");
				// A late create receipt is the sole permitted stale result. Keep it
				// only in its original owner lane, before the epoch check; never call
				// cache/navigation callbacks or stage/post under stale authority.
				lane.receipt = { ...conversation };
				lane.created = true;
				lane.cleared = false;
				const aliasKey = laneKey(lane.accountId, lane.tenantId, teamBridgeConversationTargetKey(conversation.id));
				const alias = this.lanes.get(aliasKey);
				if (alias && this.root(alias) !== lane) {
					const other = this.root(alias);
					const active = other.active;
					other.redirect = lane;
					lane.queue.push(...other.queue.splice(0));
					lane.queue.sort((left, right) => left.order - right.order);
					const slots = new Map([...other.display, ...lane.display].map((slot) => [slot.key, slot]));
					lane.display = [...slots.values()];
					lane.observed ||= other.observed;
					// An already-known conversation may have an active send when a
					// find-or-create resolves to it. Join its queue before posting.
					if (active) await active;
				}
				this.lanes.set(aliasKey, lane);
				this.changed();
				phase = "authority";
				this.assert(attempt);
				this.update(attempt, { conversationId: conversation.id });
			}
			lane = this.root(attempt.lane);
			conversation = lane.receipt ?? conversation;
			this.assert(attempt);
			this.update(attempt, { conversationId: conversation.id });
			if (lane.created && lane.announcedEpoch !== attempt.row.epoch) {
				this.assert(attempt);
				attempt.effects.onCreated?.(conversation, attempt.row);
				this.assert(attempt);
				lane.announcedEpoch = attempt.row.epoch;
			}
			if (attempt.effects.stage) {
				this.update(attempt, { state: "staging" });
				phase = "stage";
				this.assert(attempt);
				const attachments = await attempt.effects.stage(conversation, attempt.row);
				phase = "authority";
				this.assert(attempt);
				if (attachments !== undefined) this.update(attempt, { attachments });
			}
			this.update(attempt, { state: "posting" });
			phase = "post";
			this.assert(attempt);
			const result = await attempt.effects.post(conversation, attempt.row);
			phase = "authority";
			this.assert(attempt);
			const server = serverReceipt(result, conversation.id);
			this.update(attempt, { state: "confirmed", serverId: server.id, serverMessage: server.message, settledAt: this.now() });
			this.assert(attempt);
			attempt.effects.onConfirmed?.(attempt.row, result);
		} catch {
			if (!this.isLive(attempt)) return;
			try { this.assert(attempt); } catch { phase = "authority"; }
			// Exception text can contain a response body or attachment URL. Keep
			// only a stable error category; the view translates it for the user.
			this.update(attempt, { state: "failed", error: { kind: phase, message: `Team Bridge send ${phase} failed` }, settledAt: this.now() });
		} finally {
			attempt.effects.onSettled?.(attempt.row);
		}
	}

	getConversation(accountId: string, tenantId: string, targetKey: string): TeamBridgeSendConversation | null {
		const lane = this.lanes.get(laneKey(accountId, tenantId, targetKey));
		return lane ? this.root(lane).receipt : null;
	}
	rowsFor(accountId: string, tenantId: string, targetKey: string, conversationId?: string): readonly TeamBridgeSendRow<A>[] {
		const key = JSON.stringify([accountId, tenantId, targetKey, conversationId]);
		const cached = this.rowSnapshots.get(key);
		if (cached) return cached;
		const resolved = conversationId ?? this.getConversation(accountId, tenantId, targetKey)?.id;
		const rows = [...this.attempts.values()].map(({ row }) => row).filter((row) =>
			row.accountId === accountId && row.tenantId === tenantId &&
			(row.targetKey === targetKey || Boolean(resolved && (row.conversationId === resolved || this.getConversation(accountId, tenantId, row.targetKey)?.id === resolved))),
		);
		this.rowSnapshots.set(key, rows);
		return rows;
	}
	/** Called by the adapter's layout effect, never during render. ACKs retain
	 * the authored slot; later foreign messages append after it rather than
	 * moving all locally-authored history permanently below incoming messages. */
	observe(accountId: string, tenantId: string, targetKey: string, conversationId: string | undefined, canonical: readonly TeamBridgeMessage[]): void {
		requireScope(accountId);
		requireScope(tenantId);
		const lane = this.getLane(accountId, tenantId, targetKey);
		const projection = this.projection(accountId, tenantId, targetKey, conversationId, canonical);
		if (lane.observed && JSON.stringify(lane.display) === JSON.stringify(projection.display)) return;
		lane.display = projection.display;
		lane.observed = true;
		this.changed();
	}

	private projection(accountId: string, tenantId: string, targetKey: string, conversationId: string | undefined, canonical: readonly TeamBridgeMessage[]) {
		const rows = this.rowsFor(accountId, tenantId, targetKey, conversationId);
		const lane = this.lanes.get(laneKey(accountId, tenantId, targetKey));
		const root = lane ? this.root(lane) : undefined;
		const resolved = conversationId ?? root?.receipt?.id;
		const ordered = [...canonical].sort((left, right) => left.seq - right.seq);
		const matches = (row: TeamBridgeSendRow<A>, message: TeamBridgeMessage) =>
			message.conversation_id === (row.conversationId ?? resolved) &&
			(message.id === row.serverId || message.client_ref === row.clientRef);
		const foreign = ordered.filter((message) => !rows.some((row) => matches(row, message)));
		const items = new Map<string, TeamBridgeSendProjectedItem<A>>();
		for (const message of foreign) items.set(canonicalSlotKey(message.id), { key: message.id, message, row: null });
		let seq = ordered.at(-1)?.seq ?? 0;
		const ownSlots: DisplaySlot[] = [];
		for (const row of rows) {
			const server = ordered.find((message) => matches(row, message)) ?? row.serverMessage;
			const key = localSlotKey(row.clientRef);
			ownSlots.push({ key, ...(server ? { seq: server.seq } : {}) });
			items.set(key, { key: row.clientRef, row, message: {
				...(server ?? row.message),
				id: server?.id ?? row.serverId ?? row.message.id,
				conversation_id: row.conversationId ?? row.message.conversation_id,
				created_at: row.message.created_at,
				seq: server?.seq ?? ++seq,
			} });
		}
		const foreignSlots = foreign.map((message) => ({ key: canonicalSlotKey(message.id), seq: message.seq }));
		let display: DisplaySlot[];
		if (!root?.observed) {
			// First observation seeds the already-loaded history before outgoing
			// rows. Newest-first API pages must not invert the visible timeline.
			display = [...foreignSlots, ...ownSlots];
		} else {
			const confirmedIds = new Set(rows.flatMap((row) => [
				...(row.serverId ? [canonicalSlotKey(row.serverId)] : []),
				...ordered.filter((message) => matches(row, message)).map((message) => canonicalSlotKey(message.id)),
			]));
			const own = new Map(ownSlots.map((slot) => [slot.key, slot]));
			display = root.display.filter((slot) => !confirmedIds.has(slot.key)).map((slot) => own.get(slot.key) ?? slot);
			const seen = new Set(display.map((slot) => slot.key));
			const maxSeen = Math.max(-1, ...display.map((slot) => slot.seq ?? -1));
			for (const slot of foreignSlots) {
				if (seen.has(slot.key)) continue;
				// Older pagination fills a historical gap; new stream arrivals go
				// after what was already visible, including pending local rows.
				const before = slot.seq <= maxSeen
					? display.findIndex((known) => known.seq !== undefined && known.seq > slot.seq)
					: -1;
				if (before < 0) display.push(slot);
				else display.splice(before, 0, slot);
				seen.add(slot.key);
			}
			for (const slot of ownSlots) if (!seen.has(slot.key)) display.push(slot);
		}
		return { display, items };
	}

	/** Pure projection: no pruning, notifications, or cache writes during render.
	 * Confirmed metadata lives for the journal lifetime so React keys survive
	 * poll reconciliation, navigation and a later retry's owner epoch. */
	project(accountId: string, tenantId: string, targetKey: string, conversationId: string | undefined, canonical: readonly TeamBridgeMessage[]): TeamBridgeSendProjectedItem<A>[] {
		const { display, items } = this.projection(accountId, tenantId, targetKey, conversationId, canonical);
		return display.flatMap((slot) => {
			const item = items.get(slot.key);
			return item ? [item] : [];
		});
	}
	clearAccount(accountId: string, options: { receipts?: boolean } = {}) {
		for (const [key, attempt] of this.attempts) {
			if (attempt.row.accountId !== accountId) continue;
			attempt.valid = false;
			this.attempts.delete(key);
		}
		for (const [key, lane] of this.lanes) {
			if (lane.accountId !== accountId) continue;
			lane.cleared = true;
			if (options.receipts) {
				lane.receipt = null;
				lane.created = false;
				lane.announcedEpoch = null;
				lane.display = [];
				lane.observed = false;
				this.lanes.delete(key);
			} else {
				lane.display = lane.display.filter((slot) => !slot.key.startsWith('["local",'));
				lane.announcedEpoch = null;
			}
		}
		this.changed();
	}
}
