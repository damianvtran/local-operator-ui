/** Best-effort sender enrichment, never a notification delivery dependency.
 *
 * The current private core route is no-store/zero authorization freshness.
 * Therefore a completed PHOTO fetch cannot authorize using those bytes on a
 * later notification, and none of our desktop platforms has demonstrated a
 * replacement that cannot re-alert/resurrect. We deliberately retain ONLY
 * caller-derived initials composites, never a hub photo. A future positive
 * photo lease needs an explicit authority contract, not a locally invented TTL.
 * No files, URLs, previews or desktop bearers live in this cache.
 */
import type { NativeImage } from "electron";
import type { TeamBridgeNotifyRequest } from "../shared/team-bridge-notify";
import type {
	DesktopMediaRequest,
	DesktopMediaResponse,
} from "./desktop-media";

export interface TeamBridgeNotificationImageSource {
	peek(request: TeamBridgeNotifyRequest): NativeImage | string | undefined;
	warm(request: TeamBridgeNotifyRequest): void;
	clear(): void;
}

export const TEAM_BRIDGE_IMAGE_TTL_MS = 15 * 60_000;
export const TEAM_BRIDGE_IMAGE_MAX_ENTRIES = 64;
export const TEAM_BRIDGE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

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
	private pending = new Set<string>();
	private entries = new Map<
		string,
		{ icon: NativeImage | string; bytes: number; expires: number }
	>();

	constructor(
		private readonly options: {
			enabled: () => boolean;
			request: (input: DesktopMediaRequest) => Promise<DesktopMediaResponse>;
			decode: (data: Uint8Array) => NativeImage | string | undefined;
			theme: () => "light" | "dark";
			now?: () => number;
		},
	) {}

	private key(request: TeamBridgeNotifyRequest): string | undefined {
		const sender = request.sender;
		if (!sender) return;
		return JSON.stringify([
			request.owner.accountId,
			request.owner.epoch,
			request.tenantId,
			sender.account_id,
			sender.kind,
			sender.display_name,
			sender.avatar?.hash,
			this.options.theme(),
		]);
	}

	private drop(key: string): void {
		const entry = this.entries.get(key);
		if (entry) this.bytes -= entry.bytes;
		this.entries.delete(key);
	}

	peek(request: TeamBridgeNotifyRequest): NativeImage | string | undefined {
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
		return entry.icon;
	}

	warm(request: TeamBridgeNotifyRequest): void {
		if (!this.options.enabled() || this.peek(request)) return;
		const key = this.key(request);
		const sender = request.sender;
		if (!key || !sender || this.pending.has(key) || this.pending.size >= 4)
			return;
		const generation = this.generation;
		this.pending.add(key);
		const input: DesktopMediaRequest = {
			op: "team_bridge.notification_avatar",
			expectedAccountId: request.owner.accountId,
			tenantId: request.tenantId,
			accountId: sender.account_id,
			kind: sender.kind,
			theme: this.options.theme(),
			size: 64,
			initials: teamBridgeSenderInitials(sender.display_name),
		};
		// No banner handles/targets are captured: completion cannot call show(),
		// change a click destination, bypass mute, or resurrect a dismissed banner.
		void (async () => {
			try {
				if (sender.avatar) {
					// Fetch on the existing private authority, never an external URL.
					// Core currently answers no-store. Discard the photo; only the
					// separate no-photo render may be retained for a future event.
					await this.options.request({ ...input, avatar: sender.avatar });
				}
				if (generation !== this.generation) return;
				const result = await this.options.request(input);
				if (
					generation !== this.generation ||
					result.kind !== "bytes" ||
					result.status !== 200 ||
					result.mimeType !== "image/png" ||
					!validNotificationPng(result.data)
				)
					return;
				const icon = this.options.decode(result.data);
				if (!icon || generation !== this.generation) return;
				const now = (this.options.now ?? Date.now)();
				for (const [oldKey, entry] of this.entries)
					if (entry.expires <= now) this.drop(oldKey);
				this.drop(key);
				// Charge both encoded bytes and the fixed 64x64 RGBA native bitmap.
				const bytes = result.data.byteLength + 64 * 64 * 4;
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
				if (generation === this.generation) this.pending.delete(key);
			}
		})();
	}

	clear(): void {
		this.generation++;
		this.entries.clear();
		this.bytes = 0;
		this.pending.clear();
	}
}
