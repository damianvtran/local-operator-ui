/**
 * The stale-notification sentence, photographed.
 *
 * WHY THIS FRAME EXISTS. The click that can no longer route is answered by a
 * toast whose only job is to stop a banner click reading as a broken app. Design
 * review round 2 asked for it to be seen rather than shown in a transcript, and
 * Urdu is the case that matters: it is written right-to-left in a Perso-Arabic
 * script, so the toast's own direction and wrapping are what a frame can settle
 * and a string dump cannot.
 *
 * WHO MOUNTS THE TOASTER. The preview decorator (`.storybook/preview.tsx`) mounts
 * the app's ONE `ThemedToastContainer` around every story, and passes
 * `context.parameters.toastDuration` into it. This story therefore does NOT mount
 * a second container: an earlier revision did, and the frame carried two
 * notification regions, which would have painted the sentence twice.
 *
 * WHY THE EMISSION IS DELAYED, MEASURED NOT GUESSED. Sonner 2.0.3's observer
 * keeps a toast array, but `useSonner()` starts at `useState([])` and only
 * fills it from `ToastState.subscribe` in an effect - the accumulated toasts are
 * never replayed to a container that mounts later. So a toast raised during
 * React's commit phase is delivered to zero subscribers and is gone for good,
 * which is exactly what two capture attempts produced: a live story, an empty
 * notification region, no toast. The call therefore happens in a PASSIVE effect,
 * after waiting for the container to be in the DOM.
 *
 * THE SHUTTER. `documentElement.dataset.capturePending` holds the shutter from
 * the moment the story mounts until a real `[data-sonner-toast]` is on screen.
 * The wait is bounded: if the toast never arrives the flag is left SET and the
 * sweep fails instead of committing a picture of an empty page. That is a
 * deliberate failure, not a stuck story - an empty frame is worse than none.
 *
 * `locale` is the preview's GLOBAL arg, not a prop: the capture run drives it
 * with `?args=locale:<tag>`, and this story pins nothing, so `en` and `ur` come
 * from the same code path.
 */
import { t } from "@shared/i18n";
import {
	dismissToast,
	resetToastDedup,
	showInfoToast,
} from "@shared/utils/toast-manager";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { useEffect } from "react";

/** The one id this story owns, so teardown takes back exactly its own toast. */
const TOAST_ID = "team-bridge-notify-unavailable";

/** Poll for a condition, bounded. Throws rather than hanging the sweep. */
const waitForDom = async <T,>(
	check: () => T | null | undefined,
	timeoutMs = 8000,
): Promise<T> => {
	const start = Date.now();
	for (;;) {
		const value = check();
		if (value !== null && value !== undefined) return value;
		if (Date.now() - start > timeoutMs) {
			throw new Error("team-bridge-notify-toast: toast never arrived");
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

const UnavailableToast: FC = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		let painted = false;
		const run = async () => {
			try {
				// MEASURED: sonner 2.0.3 renders the toaster element only once a
				// toast exists (`if (!toasts.length) return null`), so waiting for
				// `[data-sonner-toaster]` before speaking deadlocks. The ordering
				// problem is the other direction: the preview's container is mounted
				// by a decorator AROUND this story and subscribes in its own passive
				// effect, and sonner replays nothing to a late subscriber. One
				// macrotask past this effect's flush puts the emission after that
				// subscription - the same beat `transcription-failure.stories.tsx`
				// uses for its own toasts.
				await new Promise((resolve) => setTimeout(resolve, 0));
				showInfoToast(t("ui.teamBridge.notify.unavailable"), {
					id: TOAST_ID,
				});
				await waitForDom(() => document.querySelector("[data-sonner-toast]"));
				// Let the enter transition finish so the frame is the settled toast.
				await new Promise((resolve) => setTimeout(resolve, 250));
				painted = true;
			} catch (error) {
				// Leave `capturePending` set: the sweep must fail loudly rather than
				// photograph an empty page, and this line is what a human reads.
				console.error(error);
			} finally {
				if (!cancelled && painted) {
					delete document.documentElement.dataset.capturePending;
				}
			}
		};
		void run();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
			// A frame after a story switch must not be a suppressed (deduped) toast.
			dismissToast(TOAST_ID);
			resetToastDedup();
		};
	}, []);
	return null;
};

const meta: Meta = {
	title: "Team Bridge/Notification unavailable toast",
	parameters: {
		layout: "fullscreen",
		// The preview container's own duration seam, the same one the dictation
		// stories use: Sonner's production lifetime would expire this toast
		// mid-capture, and a per-toast option cannot override the container.
		toastDuration: Number.POSITIVE_INFINITY,
	},
};
export default meta;

type Story = StoryObj;

/**
 * A banner clicked after the signed-in account changed: the app comes forward
 * and says the notification is no longer available, naming neither the account
 * it belonged to nor the conversation it pointed at.
 */
export const StaleClick: Story = {
	render: () => <UnavailableToast />,
};
