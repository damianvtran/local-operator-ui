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
	/** What a banner can post RIGHT NOW with no request: the cached photo, else
	 * the cached initials, else nothing. The post path's fallback once its
	 * deadline wins, so the fallback never costs a network call. */
	peek(request: TeamBridgeNotifyRequest): NativeImage | string | undefined;
	syncDirectory(directory: TeamBridgeNotificationDirectory): void;
	/** A true transition replays rosters once; repeats are zero-request no-ops. */
	replayDirectory(directories: TeamBridgeNotificationDirectory[]): void;
	clear(): void;
}

export const TEAM_BRIDGE_IMAGE_TTL_MS = 15 * 60_000;
/**
 * Initials composites live longer than photos, deliberately.
 *
 * They are the FALLBACK the bounded wait posts (operator plan a-a06c: "<=250 ms,
 * else initials"), so they must already be in memory when a photo misses: the
 * post path never spends a second request on them. Their pixels are a pure
 * function of (hub origin, account, display-name initials, kind, theme) - core
 * draws them without touching the hub - and every one of those inputs is in the
 * key or is fenced by the auth-transition clear. No private photo bytes are
 * involved. The renderer re-sends a roster only when an id/hash changes, so a
 * 15-minute lease would quietly turn a quiet afternoon into app-icon banners.
 * Roster revocation and every auth transition still drop them immediately; the
 * TTL is only a ceiling for a session that never changes.
 */
export const TEAM_BRIDGE_INITIALS_TTL_MS = 12 * 60 * 60_000;
/** Two variants (initials + photo) per sender and kind; the byte budget below
 * is the real ceiling (~21 KiB charged per entry, so ~390 fit in 8 MiB). */
export const TEAM_BRIDGE_IMAGE_MAX_ENTRIES = 128;
export const TEAM_BRIDGE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** The size the OS banner actually shows. Asking core for 256 px would decode
 * and retain 16x the bitmap only to have the platform scale it back down. */
export const TEAM_BRIDGE_IMAGE_SIZE = 64;
/**
 * A capability flip replays at most this many tenant rosters, in map insertion
 * order - the first tenants synced this session.
 *
 * The input is genuinely unbounded: the renderer publishes every tenant it can
 * see (no renderer-side cap exists), and a replay costs one request per member
 * variant, so it needs a ceiling of its own. The binding one is really the
 * cache's 128 entries, and that is why this is a tenant count rather than a
 * queue length.
 *
 * WHAT A USER LOSES at the cap: senders in the 17th and later tenant lose only
 * the PRE-WARM. Their banners fetch on the post lane inside the same 250 ms
 * budget, which is the Q-4/Q-1 path, and reach the app icon only if that misses
 * too. RECOVERY: the next capability transition replays the same first tenants,
 * so a heavy member stays capped there; any roster content change re-warms that
 * tenant immediately, and a banner works regardless. Revocation is unaffected:
 * every auth transition still drops the whole map.
 */
export const TEAM_BRIDGE_DIRECTORY_REPLAY_MAX = 16;
/** Long enough to absorb a broken avatar across a burst, short enough that a
 * repaired hub/photo is tried again without waiting out the positive TTL. */
export const TEAM_BRIDGE_IMAGE_NEGATIVE_TTL_MS = 30_000;
/**
 * Concurrency, sized against core's renderer (#3101 `notification_avatar.py`):
 * two render slots and eight pending before it answers `503 renderer_busy`.
 *
 * - Warm traffic is a background lane of TWO, one per render slot, so roster
 *   warming alone never queues inside core and never earns a renderer_busy.
 * - Banner misses have their OWN lane of four. Warm work can therefore never
 *   starve a banner's fetch, and 2 + 4 = 6 stays under core's 8 pending.
 * - Overflow warm work waits in a FIFO instead of being dropped; it is bounded
 *   by the cache's own entry cap, because warming more than the cache can hold
 *   would only evict what it just warmed.
 */
export const TEAM_BRIDGE_IMAGE_WARM_CONCURRENCY = 2;
export const TEAM_BRIDGE_IMAGE_POST_CONCURRENCY = 4;
export const TEAM_BRIDGE_IMAGE_WARM_QUEUE_MAX = TEAM_BRIDGE_IMAGE_MAX_ENTRIES;

/** `photo` asks core for the sender's photograph (needs the hub); `initials`
 * asks for the placeholder core draws with NO network access. */
type Variant = "photo" | "initials";
type Job = {
	key: string;
	owner: TeamBridgeNotifyOwner;
	tenantId: string;
	sender: TeamBridgeNotificationSender;
	variant: Variant;
};
type Lane = "warm" | "post";

/** The notification IPC never accepts raw hub directory data: it carries only
 * validated sender descriptors needed to key/warm the main-process cache. */
export type TeamBridgeNotificationDirectory = {
	owner: TeamBridgeNotifyOwner;
	tenantId: string;
	members: TeamBridgeNotificationSender[];
};

/**
 * The picture version a sender's "photo" variant is keyed and warmed by: a
 * person's account hash, or an agent's own endpoint picture. The endpoint id is
 * in the version, so a picture moved to another endpoint is a different key.
 * The kind is checked again here (the parser already enforces it) because this
 * is the line that decides which bytes a banner may show.
 */
function photoVersion(
	sender: TeamBridgeNotificationSender,
	endpointAvatars: boolean,
): string | null {
	if (sender.kind === "person") return sender.avatar?.hash ?? null;
	const own = sender.endpoint_avatar;
	return own && endpointAvatars
		? `endpoint:${own.endpoint_id}:${own.hash}`
		: null;
}

const WORD_SEPARATOR = /\s+/u;
const INITIAL_CHARACTER = /^[\p{L}\p{N}]$/u;

/** Initials are caller data, not private image bytes. Unicode letters/digits
 * only, at most two code points, matching core's closed query vocabulary. */
export function teamBridgeSenderInitials(name: string): string {
	const words = name.normalize("NFC").trim().split(WORD_SEPARATOR);
	const selected =
		words.length > 1 ? [words[0], words[words.length - 1]] : words;
	return selected
		.map((word) => [...word].find((ch) => INITIAL_CHARACTER.test(ch)) ?? "")
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
	/** REAL requests outstanding per lane. Never reset by `clear()`: a flight
	 * from a cleared generation still occupies a core render slot until it
	 * answers, and the lane bound exists to respect core's limits. */
	private inFlight: Record<Lane, number> = { warm: 0, post: 0 };
	/** Insertion-ordered warm FIFO; keyed so a job is queued at most once. */
	private queue = new Map<string, Job>();
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
			/**
			 * Core advertises `team_bridge_endpoint_avatar`. Without it an agent has
			 * no "photo" variant at all (the glyph IS its placeholder), so an older
			 * core is never sent a query shape it would refuse with 422.
			 */
			endpointAvatars?: () => boolean;
			request: (input: DesktopMediaRequest) => Promise<DesktopMediaResponse>;
			decode: (data: Uint8Array) => NativeImage | string | undefined;
			theme: () => "light" | "dark";
			now?: () => number;
		},
	) {}

	private endpointAvatars(): boolean {
		return this.options.endpointAvatars?.() === true;
	}

	private stamp(key: string): number {
		return this.stamps.get(key) ?? 0;
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	/**
	 * Viewer + auth epoch + tenant + sender + KIND + variant + version + size +
	 * theme.
	 *
	 * Kind is part of the key because core draws different pixels for it: the
	 * agent marker exists only on `person_agent` (review M2), so a warmed person
	 * composite must never answer an agent banner. The version is the avatar
	 * hash for a photo and the initials text for a placeholder: renaming someone
	 * keeps their photo but changes their initials. `display_name` itself is
	 * absent; only the two letters core actually draws matter.
	 */
	private keyOf(
		owner: TeamBridgeNotifyOwner,
		tenantId: string,
		sender: TeamBridgeNotificationSender,
		variant: Variant,
	): string {
		return JSON.stringify([
			owner.accountId,
			owner.epoch,
			tenantId,
			sender.account_id,
			sender.kind,
			variant,
			variant === "photo"
				? photoVersion(sender, this.endpointAvatars())
				: teamBridgeSenderInitials(sender.display_name),
			TEAM_BRIDGE_IMAGE_SIZE,
			this.options.theme(),
		]);
	}

	private job(
		owner: TeamBridgeNotifyOwner,
		tenantId: string,
		sender: TeamBridgeNotificationSender,
		variant: Variant,
	): Job {
		return {
			key: this.keyOf(owner, tenantId, sender, variant),
			owner,
			tenantId,
			sender,
			variant,
		};
	}

	/** The variants a sender needs: their photo when the roster authorizes one,
	 * and always the initials placeholder that stands in for it. A sender with
	 * no photo needs only the placeholder, which is then also the primary. */
	private jobs(
		owner: TeamBridgeNotifyOwner,
		tenantId: string,
		sender: TeamBridgeNotificationSender,
	): { primary: Job; fallback?: Job } {
		const initials = this.job(owner, tenantId, sender, "initials");
		return photoVersion(sender, this.endpointAvatars())
			? {
					primary: this.job(owner, tenantId, sender, "photo"),
					fallback: initials,
				}
			: { primary: initials };
	}

	private drop(key: string): void {
		const entry = this.entries.get(key);
		if (entry) this.bytes -= entry.bytes;
		this.entries.delete(key);
	}

	/** `undefined` is a miss, `null` is an ACTIVE negative entry, otherwise the
	 * live entry. The distinction is the whole point of a negative cache: an
	 * entry that carries no icon must suppress the next read, not look like a
	 * miss and pay the wait again. */
	private entry(
		key: string,
	): { icon: NativeImage | string | undefined } | null | undefined {
		const entry = this.entries.get(key);
		if (!entry) return;
		if (entry.expires <= this.now()) {
			this.drop(key);
			return;
		}
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.icon ? entry : null;
	}

	/** The icon a banner would post right now, with no request: the photo if
	 * cached, else the cached initials, else nothing (the app icon). */
	peek(request: TeamBridgeNotifyRequest): NativeImage | string | undefined {
		if (!this.options.enabled() || !request.sender) return;
		const { primary, fallback } = this.jobs(
			request.owner,
			request.tenantId,
			request.sender,
		);
		return (
			this.entry(primary.key)?.icon ??
			(fallback ? this.entry(fallback.key)?.icon : undefined)
		);
	}

	/**
	 * Start (or join) the one request for this identity on the given lane.
	 *
	 * Keyed by identity rather than by conversation, so a directory warm and a
	 * banner that arrive together share one hub call. A full lane returns
	 * `undefined`: for a banner that means "post with what is cached now", which
	 * the caller's deadline already makes a non-event.
	 */
	private launch(job: Job, lane: Lane): Promise<void> | undefined {
		const { key, owner, tenantId, sender, variant } = job;
		const existing = this.pending.get(key);
		if (existing) return existing;
		const limit =
			lane === "warm"
				? TEAM_BRIDGE_IMAGE_WARM_CONCURRENCY
				: TEAM_BRIDGE_IMAGE_POST_CONCURRENCY;
		if (this.inFlight[lane] >= limit) return;
		this.queue.delete(key);
		this.inFlight[lane] += 1;
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
			// No avatar reference = core draws initials and touches no network.
			...(variant === "photo" && sender.avatar
				? { avatar: sender.avatar }
				: {}),
			// An agent's own picture: core reads it by endpoint and falls back to
			// the glyph itself when the read fails.
			...(variant === "photo" &&
			sender.kind === "person_agent" &&
			sender.endpoint_avatar &&
			this.endpointAvatars()
				? { endpointAvatar: sender.endpoint_avatar }
				: {}),
		};
		const current = () =>
			generation === this.generation && stamp === this.stamp(key);
		// No banner handles/targets are captured: completion cannot call show(),
		// change a click destination, bypass mute, or resurrect a dismissed banner.
		const flight = (async () => {
			try {
				const result = await this.options.request(input);
				if (!current()) return;
				const now = this.now();
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
				if (!icon || !current()) return;
				for (const [oldKey, entry] of this.entries)
					if (entry.expires <= now) this.drop(oldKey);
				this.drop(key);
				// Charge both encoded bytes and the fixed 64x64 RGBA native bitmap.
				const bytes = result.data.byteLength + TEAM_BRIDGE_IMAGE_SIZE ** 2 * 4;
				this.entries.set(key, {
					icon,
					bytes,
					expires:
						now +
						(variant === "photo"
							? TEAM_BRIDGE_IMAGE_TTL_MS
							: TEAM_BRIDGE_INITIALS_TTL_MS),
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
				this.inFlight[lane] -= 1;
				// Retire THIS flight only. The stamp is what makes that safe: an
				// eviction already bumped it, so this late completion must not delete
				// the pending entry of the replacement flight it was racing.
				if (current()) this.pending.delete(key);
				// A freed slot - in either lane - is the moment queued warm work
				// may proceed; a post-lane completion frees nothing for warming but
				// costs nothing to check.
				this.pump();
			}
		})();
		this.pending.set(key, flight);
		return flight;
	}

	/** Run queued warm work up to the warm lane's bound, in queue order. Jobs
	 * that became live, in flight or stale while waiting are skipped. */
	private pump(): void {
		if (!this.options.enabled()) return;
		for (const [key, job] of this.queue) {
			if (this.inFlight.warm >= TEAM_BRIDGE_IMAGE_WARM_CONCURRENCY) return;
			this.queue.delete(key);
			if (this.pending.has(key) || this.entry(key) !== undefined) continue;
			this.launch(job, "warm");
		}
	}

	/** A refresh is a per-tenant revocation boundary, not merely a warm hint.
	 * Removed members and changed hashes/initials are dropped before new reads
	 * start; only identities with nothing live, pending or queued are warmed. */
	syncDirectory(directory: TeamBridgeNotificationDirectory): void {
		if (!this.options.enabled()) return;
		const members = new Map<string, TeamBridgeNotificationSender>();
		for (const candidate of directory.members) {
			const sender = parseTeamBridgeNotificationSender(candidate);
			// Keyed by account AND kind: a person and their agent are two banners
			// with two different composites (review M2).
			if (sender) members.set(`${sender.account_id}\n${sender.kind}`, sender);
		}
		const stale = (key: string): boolean => {
			const parts = JSON.parse(key) as unknown[];
			if (
				parts[0] !== directory.owner.accountId ||
				parts[1] !== directory.owner.epoch ||
				parts[2] !== directory.tenantId
			)
				return false;
			const member = members.get(`${String(parts[3])}\n${String(parts[4])}`);
			if (!member) return true;
			return parts[5] === "photo"
				? photoVersion(member, this.endpointAvatars()) !== parts[6]
				: teamBridgeSenderInitials(member.display_name) !== parts[6];
		};
		// Cached entries, flights AND queued warms: a member who was removed or
		// changed their photo while their composite was being fetched (or was
		// waiting to be) must not have that result stored when it lands.
		for (const key of new Set([
			...this.entries.keys(),
			...this.pending.keys(),
			...this.queue.keys(),
		])) {
			if (!stale(key)) continue;
			// Invalidate BEFORE dropping: the in-flight completion compares its
			// captured mark against this one and discards its result on a mismatch.
			this.stamps.set(key, this.stamp(key) + 1);
			this.drop(key);
			this.pending.delete(key);
			this.queue.delete(key);
		}
		/*
		 * Warm ONLY what is missing, in a deterministic order (QA Q-2): every
		 * sender's initials first - they are the fallback a banner needs without
		 * a request, and core draws them without the hub - then photos. Within a
		 * pass, account id then kind. A roster re-sent unchanged therefore costs
		 * zero requests, and one avatar change costs one.
		 */
		const ordered = [...members.values()].sort((a, b) =>
			a.account_id === b.account_id
				? a.kind.localeCompare(b.kind)
				: a.account_id.localeCompare(b.account_id),
		);
		const wanted: Job[] = [];
		for (const sender of ordered)
			wanted.push(
				this.job(directory.owner, directory.tenantId, sender, "initials"),
			);
		for (const sender of ordered)
			if (photoVersion(sender, this.endpointAvatars()))
				wanted.push(
					this.job(directory.owner, directory.tenantId, sender, "photo"),
				);
		for (const job of wanted) {
			if (this.queue.size >= TEAM_BRIDGE_IMAGE_WARM_QUEUE_MAX) break;
			if (
				this.queue.has(job.key) ||
				this.pending.has(job.key) ||
				this.entry(job.key) !== undefined
			)
				continue;
			this.queue.set(job.key, job);
		}
		this.pump();
	}

	/** A replay is initiated by the ONE capability transition false -> true, never
	 * by cache completion, so eviction refills are finite and cannot loop. Missing
	 * entries are deduped by syncDirectory; the last accepted tenant roster owns
	 * revocation. The caller passes only rosters of the CURRENT owner (see the
	 * notifier's `replayDirectories`): this layer has no authority check of its
	 * own, so a withdrawn roster handed to it would warm a revoked tenant. */
	replayDirectory(directories: TeamBridgeNotificationDirectory[]): void {
		if (!this.options.enabled()) return;
		for (const directory of directories.slice(
			0,
			TEAM_BRIDGE_DIRECTORY_REPLAY_MAX,
		))
			this.syncDirectory(directory);
	}

	/**
	 * The icon for one banner, within `deadline` ms.
	 *
	 * Order: a cached primary (photo, or initials for a sender without one); else
	 * at most one request per variant on the banner lane. A queued initials warm
	 * is PROMOTED, not duplicated, and runs alongside the photo.
	 *
	 * THE PRIMARY HOLDS THE DEADLINE (QA Q-4). The placeholder renders without
	 * the hub, so when both variants are cold it always answers first; returning
	 * on the first flight to settle therefore handed every banner lane miss its
	 * initials even when the photo was ~40 ms away, and only a banner whose
	 * initials were already cached ever spent the budget on a photo. So await the
	 * PHOTO until the deadline and answer from memory at it. The fallback answers
	 * at the deadline or as soon as the primary fails - never a second budget.
	 * The app icon is reserved for a sender whose variants cannot resolve in
	 * time, not merely a warm queue not reached.
	 */
	async read(
		request: TeamBridgeNotifyRequest,
		deadline: number,
	): Promise<NativeImage | string | undefined> {
		if (!this.options.enabled() || !request.sender) return;
		const { primary, fallback } = this.jobs(
			request.owner,
			request.tenantId,
			request.sender,
		);
		const state = this.entry(primary.key);
		if (state) return state.icon;
		// A live NEGATIVE entry (null) answers without a request, as does a zero
		// budget; both fall straight through to the fallback.
		const flight =
			state === undefined && deadline > 0
				? this.launch(primary, "post")
				: undefined;
		// This is the queued warm's first and ONLY request, moved to the post lane.
		// Do not start a fallback that was never queued: that would be a new retry
		// rather than promotion of work the roster had already authorized.
		const fallbackFlight =
			fallback && deadline > 0
				? (this.pending.get(fallback.key) ??
					(this.queue.has(fallback.key)
						? this.launch(fallback, "post")
						: undefined))
				: undefined;
		const flights = [flight, fallbackFlight].filter(
			(candidate): candidate is Promise<void> => candidate !== undefined,
		);
		if (flights.length > 0) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const expired = new Promise<void>((resolve) => {
					timer = setTimeout(resolve, deadline);
					timer.unref?.();
				});
				// The primary's flight is what the budget is spent on; `flights` is only
				// the fallback when no primary request was started at all (a sender
				// without a photo, a negative entry, a zero budget).
				await Promise.race([flight ?? Promise.all(flights), expired]);
				const ready = this.peek(request);
				if (ready) return ready;
				// The photo failed or missed: a promoted fallback that is still in flight
				// gets whatever is LEFT of the same budget, never a fresh one.
				await Promise.race([Promise.all(flights), expired]);
			} finally {
				if (timer) clearTimeout(timer);
			}
		}
		return this.peek(request);
	}

	clear(): void {
		this.generation += 1;
		this.entries.clear();
		this.stamps.clear();
		this.bytes = 0;
		this.pending.clear();
		this.queue.clear();
	}
}
