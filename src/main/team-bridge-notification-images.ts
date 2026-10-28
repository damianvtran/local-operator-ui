/** Best-effort sender enrichment, never a notification delivery dependency.
 *
 * Operator decision a-a06c (2026-10-28) explicitly permits a 15-minute display
 * cache and a bounded 250 ms wait; native Communication Notifications are out
 * of scope. Core's `private, no-store` prevents HTTP/browser persistence, not
 * this explicitly authorized in-memory display lease. Photos are memory-only:
 * a sign-out or account switch must not leave private image bytes on disk or
 * available to another login epoch. No files, URLs, previews or desktop
 * bearers live here, and no completion owns a banner to re-post.
 */
import type { NativeImage } from "electron";
import {
	type TeamBridgeNotificationSender,
	type TeamBridgeNotifyOwner,
	type TeamBridgeNotifyRequest,
	parseTeamBridgeNotificationSender,
} from "../shared/team-bridge-notify";
import type {
	DesktopMediaRequest,
	DesktopMediaResponse,
} from "./desktop-media";

export interface TeamBridgeNotificationImageSource {
	/** Await a warm hit, or resolve with no photo at the supplied deadline. */
	read(
		request: TeamBridgeNotifyRequest,
		deadline: number,
	): Promise<NativeImage | string | undefined>;
	syncDirectory(directory: TeamBridgeNotificationDirectory): void;
	clear(): void;
}

export const TEAM_BRIDGE_IMAGE_TTL_MS = 15 * 60_000;
export const TEAM_BRIDGE_IMAGE_MAX_ENTRIES = 64;
export const TEAM_BRIDGE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** The size the OS banner actually shows. Asking core for 256 px would decode
 * and retain 16x the bitmap only to have the platform scale it back down. */
export const TEAM_BRIDGE_IMAGE_SIZE = 64;
/** Long enough to absorb a broken avatar across a burst, short enough that a
 * repaired hub/photo is tried again without waiting out the positive TTL. */
export const TEAM_BRIDGE_IMAGE_NEGATIVE_TTL_MS = 30_000;

/** The notification IPC never accepts raw hub directory data: it carries only
 * validated sender descriptors needed to key/warm the main-process cache. */
export type TeamBridgeNotificationDirectory = {
	owner: TeamBridgeNotifyOwner;
	tenantId: string;
	members: TeamBridgeNotificationSender[];
};

/** Initials are caller data, not private image bytes. Unicode letters/digits
 * only, at most two code points, matching core's closed query vocabulary. */
export function teamBridgeSenderInitials(name: string): string {
	const words = name.normalize("NFC").trim().split(/\s+/u);
	const selected =
		words.length > 1 ? [words[0], words[words.length - 1]] : words;
	return selected
		.map((word) => [...word].find((ch) => /^[\p{L}\p{N}]$/u.test(ch)) ?? "")
		.join("");
}

/** Check dimensions BEFORE passing bytes to nativeImage's decoder. The private
 * core validates/re-encodes, but a malformed backend answer must still be cheap. */
export function validNotificationPng(data: Uint8Array): boolean {
	if (data.byteLength < 33 || data.byteLength > 256 * 1024) return false;
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (!signature.every((byte, i) => data[i] === byte)) return false;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return (
		view.getUint32(8) === 13 &&
		view.getUint32(12) === 0x49484452 &&
		view.getUint32(16) === 64 &&
		view.getUint32(20) === 64
	);
}

export class TeamBridgeNotificationImages
	implements TeamBridgeNotificationImageSource
{
	private generation = 0;
	private bytes = 0;
	private pending = new Map<string, Promise<void>>();
	private entries = new Map<
		string,
		{ icon: NativeImage | string | undefined; bytes: number; expires: number }
	>();
	/** Per-key invalidation marks. A directory refresh that evicts an identity
	 * bumps its mark, so a request already in flight for the OLD hash cannot
	 * store itself when it lands. */
	private stamps = new Map<string, number>();

	constructor(
		private readonly options: {
			enabled: () => boolean;
			request: (input: DesktopMediaRequest) => Promise<DesktopMediaResponse>;
			decode: (data: Uint8Array) => NativeImage | string | undefined;
			theme: () => "light" | "dark";
			now?: () => number;
		},
	) {}

	private stamp(key: string): number {
		return this.stamps.get(key) ?? 0;
	}

	/**
	 * Viewer + auth epoch + tenant + sender + avatar hash + size + theme.
	 *
	 * The role kind is deliberately absent: a sender who becomes an agent keeps
	 * the same photograph. `display_name` is absent for the same reason the key
	 * omits it - renaming someone must not drop their photo. Initials are keyed
	 * separately, because a name IS their content.
	 */
	private keyOf(
		owner: TeamBridgeNotifyOwner,
		tenantId: string,
		sender: TeamBridgeNotificationSender,
	): string {
		return JSON.stringify([
			owner.accountId,
			owner.epoch,
			tenantId,
			sender.account_id,
			sender.avatar?.hash ?? null,
			TEAM_BRIDGE_IMAGE_SIZE,
			this.options.theme(),
		]);
	}

	private key(request: TeamBridgeNotifyRequest): string | undefined {
		const sender = request.sender;
		return sender
			? this.keyOf(request.owner, request.tenantId, sender)
			: undefined;
	}

	private drop(key: string): void {
		const entry = this.entries.get(key);
		if (entry) this.bytes -= entry.bytes;
		this.entries.delete(key);
	}

	/** Null is internal only: an expired NEGATIVE entry must start a fresh read. */
	private peek(
		request: TeamBridgeNotifyRequest,
	): NativeImage | string | undefined | null {
		const state = this.entry(request);
		if (state === null) return null;
		return state?.icon;
	}

	/** `undefined` is a miss, `null` is an ACTIVE negative entry, otherwise the
	 * live entry. The distinction is the whole point of a negative cache: an
	 * entry that carries no icon must suppress the next read, not look like a
	 * miss and pay the wait again. */
	private entry(
		request: TeamBridgeNotifyRequest,
	): { icon: NativeImage | string | undefined } | null | undefined {
		if (!this.options.enabled()) return;
		const key = this.key(request);
		if (!key) return;
		const entry = this.entries.get(key);
		if (!entry) return;
		if (entry.expires <= (this.options.now ?? Date.now)()) {
			this.drop(key);
			return;
		}
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.icon ? entry : null;
	}

	/** Single-flight a read and keep its late result for the next banner. The
	 * returned promise never rejects: enrichment cannot fail notification
	 * delivery. It also never captures a Notification or calls show/replace. */
	private warm(request: TeamBridgeNotifyRequest): Promise<void> | undefined {
		if (!this.options.enabled()) return;
		// A live positive OR negative entry answers the read; only a real miss
		// (or single-flight join) reaches the hub.
		const state = this.entry(request);
		if (state !== undefined) return;
		const sender = request.sender;
		if (!sender) return;
		return this.start(request.owner, request.tenantId, sender);
	}

	/**
	 * Start (or join) the one request for this identity.
	 *
	 * Keyed by identity rather than by conversation, so a directory warm and a
	 * banner that arrive together share one hub call. At most four are in flight:
	 * a burst of banners must not fan out into a decode each, and the caller's
	 * deadline is what makes waiting on an unstarted one a non-event.
	 */
	private start(
		owner: TeamBridgeNotifyOwner,
		tenantId: string,
		sender: TeamBridgeNotificationSender,
	): Promise<void> | undefined {
		const key = this.keyOf(owner, tenantId, sender);
		const existing = this.pending.get(key);
		if (existing) return existing;
		if (this.pending.size >= 4) return;
		const generation = this.generation;
		// Captured now: a directory refresh that evicts this identity bumps the
		// mark, and this completion must then DISCARD its result instead of
		// re-adding the photo that refresh just revoked.
		const stamp = this.stamp(key);
		const input: DesktopMediaRequest = {
			op: "team_bridge.notification_avatar",
			expectedAccountId: owner.accountId,
			tenantId,
			accountId: sender.account_id,
			kind: sender.kind,
			theme: this.options.theme(),
			size: TEAM_BRIDGE_IMAGE_SIZE,
			initials: teamBridgeSenderInitials(sender.display_name),
		};
		// No banner handles/targets are captured: completion cannot call show(),
		// change a click destination, bypass mute, or resurrect a dismissed banner.
		const flight = (async () => {
			try {
				// ONE core composite call: it renders the photo under the supplied
				// avatar version, or initials when no photo is authorized.
				const result = await this.options.request({
					...input,
					...(sender.avatar ? { avatar: sender.avatar } : {}),
				});
				if (generation !== this.generation || stamp !== this.stamp(key)) return;
				const now = (this.options.now ?? Date.now)();
				if (result.kind === "error") {
					// renderer_busy is transient overload: initials now, but NO
					// negative cache. Other errors are negatively cached for 30 s so
					// one broken avatar cannot add 250 ms to every banner in a burst.
					if (result.code !== "renderer_busy") {
						this.drop(key);
						this.entries.set(key, {
							icon: undefined,
							bytes: 0,
							expires: now + TEAM_BRIDGE_IMAGE_NEGATIVE_TTL_MS,
						});
					}
					return;
				}
				if (
					result.kind !== "bytes" ||
					result.status !== 200 ||
					result.mimeType !== "image/png" ||
					!validNotificationPng(result.data)
				)
					return;
				const icon = this.options.decode(result.data);
				if (
					!icon ||
					generation !== this.generation ||
					stamp !== this.stamp(key)
				)
					return;
				for (const [oldKey, entry] of this.entries)
					if (entry.expires <= now) this.drop(oldKey);
				this.drop(key);
				// Charge both encoded bytes and the fixed 64x64 RGBA native bitmap.
				const bytes = result.data.byteLength + TEAM_BRIDGE_IMAGE_SIZE ** 2 * 4;
				this.entries.set(key, {
					icon,
					bytes,
					expires: now + TEAM_BRIDGE_IMAGE_TTL_MS,
				});
				this.bytes += bytes;
				while (
					this.entries.size > TEAM_BRIDGE_IMAGE_MAX_ENTRIES ||
					this.bytes > TEAM_BRIDGE_IMAGE_MAX_BYTES
				) {
					const oldest = this.entries.keys().next().value;
					if (oldest === undefined) break;
					this.drop(oldest);
				}
			} catch {
				// Fetch/decode/timeout never becomes a notification failure or log.
			} finally {
				// Retire THIS flight only. The stamp is what makes that safe: an
				// eviction already bumped it, so this late completion must not delete
				// the pending entry of the replacement flight it was racing.
				if (this.generation === generation && this.stamp(key) === stamp)
					this.pending.delete(key);
			}
		})();
		this.pending.set(key, flight);
		return flight;
	}

	/** A refresh is a per-tenant revocation boundary, not merely a warm hint.
	 * Removed members and changed hashes are dropped before new reads start. */
	syncDirectory(directory: TeamBridgeNotificationDirectory): void {
		if (!this.options.enabled()) return;
		const members = new Map<string, TeamBridgeNotificationSender>();
		for (const candidate of directory.members) {
			const sender = parseTeamBridgeNotificationSender(candidate);
			if (sender) members.set(sender.account_id, sender);
		}
		const stale = (key: string): boolean => {
			const parts = JSON.parse(key) as unknown[];
			if (
				parts[0] !== directory.owner.accountId ||
				parts[1] !== directory.owner.epoch ||
				parts[2] !== directory.tenantId
			)
				return false;
			const member = members.get(String(parts[3]));
			return !(member && (member.avatar?.hash ?? null) === parts[4]);
		};
		// BOTH the cached entries AND the ones still in flight: a member who was
		// removed or changed their photo while their composite was being fetched
		// must not have that result stored when it lands.
		for (const key of new Set([
			...this.entries.keys(),
			...this.pending.keys(),
		])) {
			if (!stale(key)) continue;
			// Invalidate BEFORE dropping: the in-flight completion compares its
			// captured mark against this one and discards its result on a mismatch.
			this.stamps.set(key, this.stamp(key) + 1);
			this.drop(key);
			this.pending.delete(key);
		}
		// Warm what is still listed: by the time a message arrives, its sender's
		// composite is usually decoded, which is what keeps the common banner off
		// the 250 ms wait entirely.
		for (const sender of members.values())
			void this.start(directory.owner, directory.tenantId, sender);
	}

	async read(
		request: TeamBridgeNotifyRequest,
		deadline: number,
	): Promise<NativeImage | string | undefined> {
		if (deadline <= 0) return this.peek(request) ?? undefined;
		const flight = this.warm(request);
		if (!flight) return this.peek(request) ?? undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			// Hard race: the deadline wins even if the hub/decode is still pending.
			// A late completion only fills the cache; it never re-posts this banner.
			await Promise.race([
				flight,
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, deadline);
					timer.unref?.();
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
		return this.peek(request) ?? undefined;
	}

	clear(): void {
		this.generation += 1;
		this.entries.clear();
		this.stamps.clear();
		this.bytes = 0;
		this.pending.clear();
	}
}
