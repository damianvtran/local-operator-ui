/**
 * Settings -> Notifications -> "Send test notification".
 *
 * WHY A REAL BANNER, AND NOT A SECOND PREVIEW. The Settings preview plays
 * through the renderer at the OUTPUT volume; a macOS banner played by
 * `UNNotificationSound` may follow the system ALERT volume instead, and Focus /
 * Do Not Disturb can silence it entirely (settings spec §4.3, C11). The only
 * honest way for a user to hear what a notification will actually sound like is
 * to raise one through the same path every banner takes: `new Notification`
 * with `notificationSoundOptions()` (`notification-sound.ts`), so the test obeys
 * exactly the plan the next real banner will.
 *
 * FRESH PLAN FIRST. The sound service re-reads on a `config` feed frame, but a
 * user who has just picked a sound and immediately presses Test would race that
 * frame. The banner therefore waits for one `refresh()` (bounded), so the test
 * plays the sound that is selected NOW, not the one selected a second ago.
 *
 * HEADLESS RAISES NOTHING. An agent-driven run (`--window-mode=headless`) must
 * not put a banner in front of whoever is at the screen (AGENTS.md "An
 * agent-driven run does not banner either"), so that mode answers
 * `{ shown: false, reason: "suppressed" }` and constructs no `Notification`.
 *
 * The banner is RETAINED by a `NotificationLifetime` like every other banner in
 * this app (a collected wrapper is how clicks used to vanish); its click does
 * nothing beyond closing it, since it names no conversation.
 */

import { Notification } from "electron";
import { t } from "../i18n";
import { NotificationLifetime } from "./notification-lifetime";
import {
	type NotificationSoundService,
	notificationSoundOptions,
} from "./notification-sound";
import type { WindowShow } from "./window-mode";

export { NOTIFICATION_TEST_CHANNEL } from "../shared/notification-sound";

/** How long the banner waits for a fresh sound plan before going out anyway. */
const REFRESH_BOUND_MS = 1500;

export type NotificationTestResult =
	| { shown: true }
	| { shown: false; reason: "unsupported" | "suppressed" };

export type NotificationTestDeps = {
	/** The resolved launch plan's show policy; `never` is `headless`. */
	windowRaise: WindowShow;
	/** The configured sound service, or null when sounds were never configured. */
	sound: () => NotificationSoundService | null;
	/** Test seam: Electron's `Notification`. */
	create?: (options: ConstructorParameters<typeof Notification>[0]) => {
		show: () => void;
		once: (
			event: "click" | "close" | "failed",
			listener: () => void,
		) => unknown;
	};
	/** Test seam for `Notification.isSupported()`. */
	isSupported?: () => boolean;
};

const lifetime = new NotificationLifetime();

export async function sendTestNotification(
	deps: NotificationTestDeps,
): Promise<NotificationTestResult> {
	if (deps.windowRaise === "never")
		return { shown: false, reason: "suppressed" };
	const supported = deps.isSupported ?? (() => Notification.isSupported());
	if (!supported()) return { shown: false, reason: "unsupported" };
	const service = deps.sound();
	if (service) {
		await Promise.race([
			service.refresh(),
			new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, REFRESH_BOUND_MS);
				timer.unref?.();
			}),
		]);
	}
	const create = deps.create ?? ((options) => new Notification(options));
	const notification = create({
		title: t("ui.settings.notifications.test.banner_title"),
		body: t("ui.settings.notifications.test.banner_body"),
		// The configured sound (or none): the whole point of the test.
		...notificationSoundOptions(),
	});
	lifetime.retain(notification, () => {});
	notification.show();
	return { shown: true };
}
