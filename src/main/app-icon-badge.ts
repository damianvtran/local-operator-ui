/** Native attention is a projection of authority, never a delivery counter.
 * Ports deliberately exclude banners/window activation and content bodies. The
 * caller owns identity generations and localized descriptions; this module only
 * renders a verified snapshot, so a read ask can remain pending without becoming
 * an invented unread item. It is independent of renderer/window lifetime.
 */
export interface AppIconBadgeSnapshot {
	unreadCount: number;
	pending: boolean;
}

export interface AppIconBadgePorts<Image> {
	platform: string;
	setDockBadge?: (label: string) => void;
	setOverlayIcon?: (image: Image | null, description: string) => void;
	createOverlayImage?: (label: string) => Image;
	setBadgeCount?: (count: number) => boolean;
	/** False until the installed .desktop identity has been established. */
	linuxDesktopIdentity?: boolean;
	/** Must include the uncapped count and pending state using keyed copy. */
	describe: (snapshot: AppIconBadgeSnapshot) => string;
}

/** `applied` means the native API accepted the write, not that the OS painted
 * it. macOS permission/visible-frame evidence belongs to the Electron caller.
 */
export type AppIconBadgeResult =
	| "applied"
	| "unavailable"
	| "pending-unsupported";

export function createAppIconBadge<Image>(ports: AppIconBadgePorts<Image>) {
	// Only twelve visual keys can exist: empty, pending, 1..9 and 9+.
	// Exact counts remain in descriptions, never in the image-cache key.
	const images = new Map<string, Image>();
	let lastWrite: string | undefined;
	let lastResult: AppIconBadgeResult = "unavailable";
	let lastDescription = "";
	let lastSnapshot: AppIconBadgeSnapshot = { unreadCount: 0, pending: false };

	function update(
		snapshot: AppIconBadgeSnapshot,
		notificationsEnabled?: boolean,
	): AppIconBadgeResult {
		// Reject malformed authority rather than displaying a plausible fake count.
		const valid =
			Number.isSafeInteger(snapshot.unreadCount) && snapshot.unreadCount >= 0;
		const state =
			notificationsEnabled === false || !valid
				? { unreadCount: 0, pending: false }
				: snapshot;
		const count = state.unreadCount;
		lastSnapshot = { ...state };
		lastDescription = "";
		try {
			// The same keyed exact description is observable in the headless CI
			// scene even on macOS, whose Dock API accepts only the compact label.
			// This is projection evidence, not a custom Dock accessibility API.
			lastDescription = count > 0 || state.pending ? ports.describe(state) : "";
		} catch {
			// Localization is not badge authority. A failed description must not
			// suppress the numeric/dot native write or retain stale account copy.
			lastDescription = "";
		}
		try {
			if (ports.platform === "darwin" && ports.setDockBadge) {
				const label =
					count > 99
						? "99+"
						: count > 0
							? String(count)
							: state.pending
								? "•"
								: "";
				if (lastWrite !== label) ports.setDockBadge(label);
				lastWrite = label;
				lastResult = "applied";
			} else if (
				ports.platform === "win32" &&
				ports.setOverlayIcon &&
				ports.createOverlayImage
			) {
				const label =
					count > 9
						? "9+"
						: count > 0
							? String(count)
							: state.pending
								? "•"
								: "";
				const description = lastDescription;
				const key = JSON.stringify([label, description]);
				if (lastWrite !== key) {
					let image: Image | null = null;
					if (label) {
						image = images.get(label) ?? ports.createOverlayImage(label);
						images.set(label, image);
					}
					ports.setOverlayIcon(image, description);
				}
				lastWrite = key;
				lastResult = "applied";
			} else if (
				ports.platform === "linux" &&
				ports.linuxDesktopIdentity &&
				ports.setBadgeCount
			) {
				// LauncherEntry is integer-only. Pending is NOT unread=1.
				const key = String(count);
				if (lastWrite !== key) {
					if (!ports.setBadgeCount(count)) {
						lastWrite = undefined;
						lastResult = "unavailable";
						return lastResult;
					}
				}
				lastWrite = key;
				lastResult =
					count === 0 && state.pending ? "pending-unsupported" : "applied";
			} else {
				lastResult = "unavailable";
			}
		} catch {
			// Native capability loss is not success; permit the next reconcile to retry.
			lastWrite = undefined;
			lastResult = "unavailable";
		}
		return lastResult;
	}

	return {
		update,
		/** Read-only scene evidence: main exposes this only to the hosted,
		 * explicitly opted-in headless CI scene. No mutation/read acknowledgement
		 * or native visibility claim is available through this accessor. */
		readForScene() {
			return { ...lastSnapshot, lastDescription, lastResult };
		},
		/** A replacement Windows target needs a write, not a clear on other OSes. */
		invalidateOverlayTarget() {
			if (ports.platform === "win32") lastWrite = undefined;
		},
		/** Clear before switching identity; never retain an unverified old integer. */
		reset() {
			lastWrite = undefined;
			const result = update({ unreadCount: 0, pending: false });
			images.clear();
			return result;
		},
	};
}
