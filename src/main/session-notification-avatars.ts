/**
 * The agent's face on a session's OS banner - best-effort enrichment, never a
 * delivery dependency.
 *
 * Operator request (2026-11-23): "when notifications arrive from agents with
 * profile/avatar pictures, they use the profile avatar with the local operator
 * icon in the corner instead of just the local operator icon". Core renders
 * that composite (`GET /v1/desktop/sessions/{id}/notification-avatar`, behind
 * the `desktop_session_notification_avatar` capability): the agent's stored
 * picture circle-cropped with the LO mark in a bottom-right badge, the same
 * visual language Team Bridge banners use. A session with no bound agent, or an
 * agent with no picture, answers 404 and its banner stays exactly as it was.
 *
 * This module is the Team Bridge banner cache's sibling
 * (`team-bridge-notification-images.ts`), deliberately much smaller: the
 * picture is LOCAL data (no hub, no tenant, no sign-in epoch, nothing private
 * to another account), so there is no roster to warm, no initials fallback and
 * no revocation boundary beyond a backend restart. What it keeps from that
 * design, and why:
 *
 * - The banner's wait is bounded by the notifier (250 ms, the operator-approved
 *   Team Bridge budget), not here; a late composite only warms the next banner
 *   and never re-posts or mutates one already on screen.
 * - Memory only, bounded by entries and bytes. No files, no URLs handed to the
 *   OS, no bearer: the bytes come through main's authenticated media relay.
 * - A refusal is negatively cached for 30 s so a session with no picture does
 *   not pay a round trip on every banner of a burst; `renderer_busy` (transient
 *   core overload) is not.
 *
 * KEYING. Core's ETag is derived from the agent picture's sha256 + size + theme,
 * so decoded images are stored by `[etag, size, theme]`: every session bound to
 * one agent shares one image, and a replaced picture is a different key rather
 * than a stale hit. Which ETag a session currently maps to is only learnt by
 * asking, so that mapping has a short lease (`SESSION_NOTIFICATION_AVATAR_
 * SESSION_TTL_MS`): a turn's burst of banners costs one request, and a
 * re-bound agent or a new picture shows within a minute.
 */
import type { NativeImage } from "electron";
import type {
	DesktopMediaRequest,
	DesktopMediaResponse,
} from "./desktop-media";
import {
	TEAM_BRIDGE_IMAGE_SIZE,
	validNotificationPng,
} from "./team-bridge-notification-images";

/** What `DesktopNotifier` needs from an image provider; injected so the
 * notifier's own tests stay hermetic (no Electron image decoder, no backend). */
export interface SessionNotificationImageSource {
	/** Whether the connected core serves the composite at all. A false answer
	 * means the banner posts synchronously, exactly as before this feature. */
	enabled(): boolean;
	/** The composite for this session's banner, or nothing. Never rejects.
	 * Resolves no later than `deadline` ms when it has to ask core. */
	read(sessionId: string, deadline: number): Promise<NativeImage | undefined>;
	/** What is already in memory for this session, with no request. */
	peek(sessionId: string): NativeImage | undefined;
	clear(): void;
}

/**
 * The banner's post-path budget. The SAME 250 ms the operator approved for
 * Team Bridge banners (decision a-a06c, `TEAM_BRIDGE_IMAGE_WAIT_MS`); kept as a
 * separate constant only so `desktop-notifier.ts` does not bundle the Team
 * Bridge notifier to read one number. A test pins the two equal.
 */
export const SESSION_NOTIFICATION_IMAGE_WAIT_MS = 250;
/**
 * 256 px for the same reason as Team Bridge (operator report 2026-11-03): the
 * macOS banner thumbnail is ~80 device px on a 2x panel and Windows draws up to
 * 96, so a 64 px composite is upscaled and soft. Core offers 64 or 256.
 */
export const SESSION_NOTIFICATION_AVATAR_SIZE = TEAM_BRIDGE_IMAGE_SIZE;
/** How long "this session currently shows image X (or none)" is trusted. */
export const SESSION_NOTIFICATION_AVATAR_SESSION_TTL_MS = 60_000;
/** Same failure lease as Team Bridge: long enough to absorb a burst, short
 * enough that a picture added a moment ago is tried again soon. */
export const SESSION_NOTIFICATION_AVATAR_NEGATIVE_TTL_MS = 30_000;
/** A decoded composite outlives its session lease so a re-ask that answers the
 * same ETag reuses it; the ETag itself is what makes that safe. */
export const SESSION_NOTIFICATION_AVATAR_IMAGE_TTL_MS = 15 * 60_000;
/**
 * A desktop has a handful of agents, not hundreds; 32 composites at 256 px is
 * at most ~16 MiB charged (256 KiB encode cap + 256 KiB RGBA bitmap each), and
 * the byte budget below is the binding ceiling for a pathological mix.
 */
export const SESSION_NOTIFICATION_AVATAR_MAX_ENTRIES = 32;
export const SESSION_NOTIFICATION_AVATAR_MAX_BYTES = 16 * 1024 * 1024;
/** Session leases are tiny (two strings); the cap only stops a long-running
 * app that banners for thousands of sessions from growing without bound. */
export const SESSION_NOTIFICATION_AVATAR_MAX_SESSIONS = 512;
/**
 * At most two requests in flight. Core's composite renderer has two render
 * slots and eight pending before it answers `503 renderer_busy`; Team Bridge
 * already budgets 2 warm + 4 banner = 6 of those, so 2 here keeps the sum
 * inside core's queue. A full lane means "post with what is cached now".
 */
export const SESSION_NOTIFICATION_AVATAR_CONCURRENCY = 2;

type SessionLease = { image: string | null; expires: number };
type ImageEntry = { icon: NativeImage; bytes: number; expires: number };

export class SessionNotificationAvatars
	implements SessionNotificationImageSource
{
	private generation = 0;
	private bytes = 0;
	private inFlight = 0;
	private readonly sessions = new Map<string, SessionLease>();
	private readonly images = new Map<string, ImageEntry>();
	private readonly pending = new Map<string, Promise<void>>();

	constructor(
		private readonly options: {
			/** Core advertises `desktop_session_notification_avatar`. */
			enabled: () => boolean;
			/** Main's authenticated media relay; never the renderer. */
			request: (input: DesktopMediaRequest) => Promise<DesktopMediaResponse>;
			decode: (data: Uint8Array) => NativeImage | undefined;
			/** From `nativeTheme.shouldUseDarkColors`, read per banner. */
			theme: () => "light" | "dark";
			now?: () => number;
		},
	) {}

	enabled(): boolean {
		return this.options.enabled();
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	/** Theme is part of the key: core draws a different badge ring per theme,
	 * and the OS theme can flip between two banners of one session. */
	private sessionKey(sessionId: string): string {
		return JSON.stringify([
			sessionId,
			SESSION_NOTIFICATION_AVATAR_SIZE,
			this.options.theme(),
		]);
	}

	/** `undefined` = miss, `null` = live negative lease, else the icon. */
	private lookup(sessionKey: string): NativeImage | null | undefined {
		const now = this.now();
		const lease = this.sessions.get(sessionKey);
		if (!lease) return;
		if (lease.expires <= now) {
			this.sessions.delete(sessionKey);
			return;
		}
		if (lease.image === null) return null;
		const entry = this.images.get(lease.image);
		if (!entry || entry.expires <= now) {
			// The image was evicted under the lease: a miss, so the next banner
			// asks again rather than posting the app icon for the rest of it.
			if (entry) this.dropImage(lease.image);
			this.sessions.delete(sessionKey);
			return;
		}
		// Refresh recency for the LRU eviction below.
		this.images.delete(lease.image);
		this.images.set(lease.image, entry);
		return entry.icon;
	}

	peek(sessionId: string): NativeImage | undefined {
		if (!this.options.enabled()) return;
		return this.lookup(this.sessionKey(sessionId)) ?? undefined;
	}

	async read(
		sessionId: string,
		deadline: number,
	): Promise<NativeImage | undefined> {
		if (!this.options.enabled()) return;
		const key = this.sessionKey(sessionId);
		const hit = this.lookup(key);
		if (hit !== undefined) return hit ?? undefined;
		if (deadline <= 0) return;
		const flight = this.launch(sessionId, key);
		if (!flight) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
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
		return this.peek(sessionId);
	}

	/** One request per session key at a time; a second banner joins it. */
	private launch(sessionId: string, key: string): Promise<void> | undefined {
		const existing = this.pending.get(key);
		if (existing) return existing;
		if (this.inFlight >= SESSION_NOTIFICATION_AVATAR_CONCURRENCY) return;
		this.inFlight += 1;
		const generation = this.generation;
		const [, size, theme] = JSON.parse(key) as [string, 64 | 256, string];
		const input: DesktopMediaRequest = {
			op: "sessions.notification_avatar",
			sessionId,
			size,
			theme: theme === "dark" ? "dark" : "light",
		};
		// The entry is recorded BEFORE the request starts: a `request` that throws
		// synchronously runs the body's `finally` (and its `pending.delete`) before
		// an IIFE expression could return, so setting it afterwards would pin a
		// settled flight that every later banner for this key joins - no image
		// until the next `clear()` (round-1 review R1-4).
		let settle!: () => void;
		const flight = new Promise<void>((resolve) => {
			settle = resolve;
		});
		this.pending.set(key, flight);
		void (async () => {
			try {
				const result = await this.options.request(input);
				// A backend restart (capability re-read) cleared the cache while this
				// was in flight: its answer describes a core that may be gone.
				if (generation !== this.generation) return;
				if (result.kind === "error") {
					// Any 503 is "no image NOW", never "no picture": core's renderer
					// answers `renderer_busy` 503 under a banner burst (2 active / 8
					// pending), and a negative lease there would strip the agent's face
					// from the rest of that burst (core review #4506 R1-2).
					if (result.code !== "renderer_busy" && result.status !== 503)
						this.lease(key, null, SESSION_NOTIFICATION_AVATAR_NEGATIVE_TTL_MS);
					return;
				}
				if (
					result.kind !== "bytes" ||
					result.status !== 200 ||
					result.mimeType !== "image/png" ||
					!validNotificationPng(result.data)
				) {
					// A malformed answer is a broken core, not "no picture": lease it
					// negative too so a burst does not re-ask on every banner.
					this.lease(key, null, SESSION_NOTIFICATION_AVATAR_NEGATIVE_TTL_MS);
					return;
				}
				// No ETag (an older or non-conforming core): the image is then only
				// this session's, never shared with another session by accident.
				const imageKey = JSON.stringify([
					result.etag ?? `session:${sessionId}`,
					size,
					theme,
				]);
				const now = this.now();
				// Reuse an already-decoded image only when core vouched for it with an
				// ETag; without one the bytes may differ under the same key.
				const cached = result.etag ? this.images.get(imageKey) : undefined;
				if (!cached || cached.expires <= now) {
					const icon = this.options.decode(result.data);
					if (!icon || generation !== this.generation) return;
					this.storeImage(imageKey, {
						icon,
						// Encoded bytes plus the fixed SIZE x SIZE RGBA native bitmap.
						bytes:
							result.data.byteLength +
							SESSION_NOTIFICATION_AVATAR_SIZE ** 2 * 4,
						expires: now + SESSION_NOTIFICATION_AVATAR_IMAGE_TTL_MS,
					});
				}
				this.lease(key, imageKey, SESSION_NOTIFICATION_AVATAR_SESSION_TTL_MS);
			} catch {
				// Fetch/decode failure never becomes a notification failure.
			} finally {
				this.inFlight -= 1;
				if (generation === this.generation) this.pending.delete(key);
				settle();
			}
		})();
		return flight;
	}

	private lease(key: string, image: string | null, ttl: number): void {
		this.sessions.delete(key);
		this.sessions.set(key, { image, expires: this.now() + ttl });
		while (this.sessions.size > SESSION_NOTIFICATION_AVATAR_MAX_SESSIONS) {
			const oldest = this.sessions.keys().next().value;
			if (oldest === undefined) break;
			this.sessions.delete(oldest);
		}
	}

	private storeImage(key: string, entry: ImageEntry): void {
		const now = this.now();
		for (const [oldKey, old] of this.images)
			if (old.expires <= now) this.dropImage(oldKey);
		this.dropImage(key);
		this.images.set(key, entry);
		this.bytes += entry.bytes;
		while (
			this.images.size > SESSION_NOTIFICATION_AVATAR_MAX_ENTRIES ||
			this.bytes > SESSION_NOTIFICATION_AVATAR_MAX_BYTES
		) {
			const oldest = this.images.keys().next().value;
			if (oldest === undefined) break;
			this.dropImage(oldest);
		}
	}

	private dropImage(key: string): void {
		const entry = this.images.get(key);
		if (entry) this.bytes -= entry.bytes;
		this.images.delete(key);
	}

	/** Every backend-ready: a different (or restarted) core may answer for the
	 * same session ids, so nothing learnt from the old one is reused. In-flight
	 * requests still count against the lane until they settle - they occupy a
	 * core render slot either way. */
	clear(): void {
		this.generation += 1;
		this.sessions.clear();
		this.images.clear();
		this.pending.clear();
		this.bytes = 0;
	}
}
