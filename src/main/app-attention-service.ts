import type { DesktopResponse } from "../shared/desktop-contract";
import type { DesktopFeedFrame } from "../shared/desktop-session-contract";
import { AppAttentionProjection } from "./app-attention-projection";
import type { AppIconBadgeSnapshot } from "./app-icon-badge";
import { TEAM_BRIDGE_NOTIFY_POLL_MS } from "../shared/team-bridge-poll";

interface ServicePorts {
	request: (input: unknown) => Promise<DesktopResponse>;
	publish: (snapshot: AppIconBadgeSnapshot, enabled: boolean) => void;
	clear: () => void;
	/** Production verifies the op against the current UI request schema. */
	supportsUnreadEvents?: boolean;
}

/** One app-owned observer, not a renderer hook or a notification counter.
 * Authority reads are serial/coalesced; a write while a read is in flight owes
 * one new read, never an old response overwriting the post-write projection.
 * Long polling invalidates the existing account aggregate; it does not derive
 * a second unread policy or fan out across organizations.
 */
export class AppAttentionService {
	readonly projection: AppAttentionProjection;
	private generation = 0;
	private dirty = false;
	private bridgeDirty = false;
	private running = false;
	private stopped = false;
	private account: string | null = null;
	private cursor: string | undefined;
	private bridgeEvents = false;
	private watching = false;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private poll: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly ports: ServicePorts) {
		this.projection = new AppAttentionProjection((snapshot, enabled) => {
			if (!this.stopped) ports.publish(snapshot, enabled);
		});
		this.armPoll();
	}

	reset(): void {
		if (this.stopped) return;
		this.generation++;
		this.account = null;
		this.cursor = undefined;
		this.bridgeEvents = false;
		if (this.retry) clearTimeout(this.retry);
		this.retry = undefined;
		this.projection.reset();
		this.ports.clear();
		this.invalidate();
	}

	stop(): void {
		this.stopped = true;
		this.generation++;
		if (this.retry) clearTimeout(this.retry);
		if (this.poll) clearInterval(this.poll);
		this.retry = this.poll = undefined;
		this.ports.clear();
	}

	/** Only the existing cancelled-quit release re-arms this observer. */
	resume(): void {
		if (!this.stopped) return;
		this.stopped = false;
		this.armPoll();
		this.projection.refresh();
		this.invalidate();
	}

	private armPoll(): void {
		if (this.poll || this.stopped) return;
		// Interim existing 30 s bound until upstream account invalidation ships.
		// One account aggregate, never per-org. Cross-device immediacy is OPEN.
		this.poll = setInterval(() => { if (!this.bridgeEvents) this.invalidateBridge(); }, TEAM_BRIDGE_NOTIFY_POLL_MS);
		this.poll.unref?.();
	}

	observe(frame: DesktopFeedFrame): void {
		if (this.stopped) return;
		if (frame.type === "open") {
			this.generation++;
			this.cursor = undefined;
		}
		this.projection.observe(frame);
		if (frame.type === "open" || frame.type === "gap" || frame.type === "config") this.invalidate();
	}

	/** Only successful writes invalidate. Merely displaying or delivering an
	 * ask/completion/message never consumes another client's read receipt. */
	observeResponse(input: unknown, response: DesktopResponse): void {
		if (this.stopped) return;
		if (response.status < 200 || response.status >= 300 || !input || typeof input !== "object") return;
		const op = (input as { op?: unknown }).op;
		if (typeof op !== "string") return;
		// Positive allowlist only: directory/history/list traffic must NEVER
		// trigger another settings/status/unread reconciliation.
		const writes = new Set([
			"settings.edit", "settings.reset", "notifications.read", "notifications.dismiss",
			"notifications.seen", "attention.seen", "approvals.approve", "approvals.deny",
			"team_bridge.read", "team_bridge.conversations.notify",
			"team_bridge.conversations.join", "team_bridge.conversations.delete",
			"team_bridge.conversations.lifecycle", "team_bridge.conversations.consent",
			"team_bridge.messages.send",
		]);
		const authWrites = new Set(["auth.start", "auth.input", "auth.cancel", "auth.key", "auth.logout", "accounts.remove",
			"agent_messages.enable", "agent_messages.settings.put", "agent_messages.onboarding.dismiss", "agent_messages.allowlist.put"]);
		const control = (input as { control?: { operation?: unknown } }).control;
		let returnedPrincipal: string | null | undefined;
		if (op === "radient.request" && control?.operation === "account") {
			// radientProxyEnvelope receives desktop result.data, then unwraps the
			// upstream result; UserInfoResult.account.id is the principal (not agents).
			const data = this.body(response)?.data as { result?: unknown; account?: unknown } | undefined;
			const payload = data && typeof data === "object" ? (data.result ?? data) : undefined;
			const account = (payload as { account?: { id?: unknown } } | undefined)?.account;
			if (typeof account?.id === "string") returnedPrincipal = account.id;
		} else if (op === "agent_messages.status" || op === "team_bridge.status") {
			const status = this.body(response);
			if (status?.state === "signed_out" && status.account_id === null) returnedPrincipal = null;
			else if (status?.state === "ready" && typeof status.account_id === "string") returnedPrincipal = status.account_id;
		}
		if (authWrites.has(op) || (returnedPrincipal !== undefined && returnedPrincipal !== this.account)) {
			// Fence the old principal BEFORE any asynchronous refetch may finish.
			this.generation++;
			this.account = null;
			this.cursor = undefined;
			this.projection.setBridgeUnread(0, this.projection.currentGeneration);
			this.invalidate();
		} else if (writes.has(op)) {
			if (op.startsWith("team_bridge.")) this.invalidateBridge();
			else this.invalidate();
		}
	}

	private invalidateBridge(): void {
		if (this.stopped) return;
		this.bridgeDirty = true;
		if (!this.running) void this.reconcile();
	}

	invalidate(): void {
		if (this.stopped) return;
		this.dirty = true;
		if (!this.running) void this.reconcile();
	}

	private body(response: DesktopResponse): Record<string, unknown> | undefined {
		if (response.status !== 200 || !response.body || typeof response.body !== "object") return;
		const result = (response.body as { result?: unknown }).result;
		return result && typeof result === "object" ? result as Record<string, unknown> : undefined;
	}

	private async reconcile(): Promise<void> {
		this.running = true;
		try {
			while ((this.dirty || this.bridgeDirty) && !this.stopped) {
				const full = this.dirty;
				this.dirty = this.bridgeDirty = false;
				const generation = this.generation;
				const projectionGeneration = this.projection.currentGeneration;
				const current = () => !this.stopped && generation === this.generation;
				try {
					if (full) {
						const capabilities = this.body(await this.ports.request({ op: "capabilities" }));
						if (!current()) continue;
						const features = capabilities?.features as Record<string, unknown> | undefined;
						this.bridgeEvents = this.ports.supportsUnreadEvents === true && Number(features?.team_bridge_unread_events ?? 0) >= 1;
						const settings = this.body(await this.ports.request({ op: "settings.list" }));
						if (!current()) continue;
						if (Array.isArray(settings?.settings)) {
							const preference = settings.settings.find((entry) => entry?.key === "display.notifications");
							this.projection.setEnabled(preference?.value !== false, projectionGeneration);
						}
						if (Number(features?.notifications ?? 0) >= 1) {
							const version = this.projection.currentInboxVersion;
							const inbox = this.body(await this.ports.request({ op: "notifications.count" }));
							if (!current()) continue;
							if (inbox) this.projection.setInboxSnapshot(inbox as unknown as Parameters<AppAttentionProjection["setInboxSnapshot"]>[0], version, projectionGeneration);
						}
						if (Number(features?.approvals ?? 0) >= 1) {
							const version = this.projection.currentMeshVersion;
							const approvals = this.body(await this.ports.request({ op: "approvals.list" }));
							if (!current()) continue;
							if (Array.isArray(approvals?.approvals)) this.projection.setMeshSnapshot(approvals.approvals.some((row) => row?.state === "requested"), version, projectionGeneration);
						}
					}
					const status = this.body(await this.ports.request({ op: "team_bridge.status" }));
					if (!current()) continue;
					// agentMessagesStatusSchema owns the flat account_id + state contract.
					// Do not interpret a missing/error envelope as a verified sign-out.
					if (!status) continue;
					// An outage/update requirement is not a principal transition. Keep
					// the last authorized same-account total until verified authority
					// returns; only ready/account or signed_out/null can replace it.
					let account: string | null;
					if (status.state === "ready" && typeof status.account_id === "string") account = status.account_id;
					else if (status.state === "signed_out" && status.account_id === null) account = null;
					else continue;
					if (account !== this.account) {
						this.account = account;
						this.cursor = undefined;
						this.projection.setBridgeUnread(0, projectionGeneration);
					}
					if (!account) continue;
					const unread = this.body(await this.ports.request({ op: "team_bridge.unread", scope: "account" }));
					if (!current()) continue;
					// The authorized aggregate has no account parameter. Verify principal
					// again before accepting a response that raced sign-out/account switch.
					const after = this.body(await this.ports.request({ op: "team_bridge.status" }));
					if (!current()) continue;
					if (!after || !["ready", "signed_out", "unavailable", "update_required"].includes(String(after.state)) ||
						!(after.account_id === null || typeof after.account_id === "string")) continue;
					if (after.state !== "ready" && after.state !== "signed_out") continue;
					if (after.account_id !== account) {
						this.account = null;
						this.cursor = undefined;
						this.projection.setBridgeUnread(0, projectionGeneration);
						this.dirty = true;
						continue;
					}
					if (this.dirty || this.bridgeDirty) continue;
					if (typeof unread?.total === "number") this.projection.setBridgeUnread(unread.total, projectionGeneration);
					if (typeof unread?.cursor === "string" && /^\d+$/.test(unread.cursor)) this.cursor = unread.cursor;
				} catch {
					// Unknown is not an authoritative empty. Reconnect/config/write/feed
					// invalidation retries; no rapid fallback count polling on failure.
				}
			}
		} finally {
			this.running = false;
			if ((this.dirty || this.bridgeDirty) && !this.stopped) void this.reconcile();
			else this.startWatch();
		}
	}

	private startWatch(): void {
		if (this.watching || this.retry || this.stopped || !this.account || !this.cursor || !this.bridgeEvents) return;
		const generation = this.generation;
		let delay = 1_000;
		this.watching = true;
		void this.ports.request({ op: "team_bridge.unread.events", after: this.cursor, wait: 20 }).then((response) => {
			if (generation !== this.generation || this.stopped) return;
			if (response.status === 204) return;
			const event = this.body(response);
			if (!event || typeof event.cursor !== "string" || !/^\d+$/.test(event.cursor)) throw new Error("Unread invalidation unavailable");
			// Opaque decimal int64, never Number/order. A current resync may lower it.
			this.cursor = event.cursor;
			this.invalidateBridge();
		}).catch(() => { delay = 5_000; }).finally(() => {
			this.watching = false;
			if (this.stopped) return;
			// A fast 204 must not spin. The same minimum applies to immediate events.
			if (!this.retry) {
				this.retry = setTimeout(() => { this.retry = undefined; this.startWatch(); }, delay);
				this.retry.unref?.();
			}
		});
	}
}
