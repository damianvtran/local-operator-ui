/**
 * Every sentence the mini view says, and nothing else.
 *
 * WHY ONE MODULE (design §E.5): the design's states are copy as much as they
 * are layout, a review reads them in one place, and the desktop suite can
 * snapshot the table rather than scrape JSX. Two rules are load-bearing and
 * stated here because both have bitten this product before:
 *
 * - NAME-FREE (design D11). No sentence names the seat's persona. The rename
 *   slice is in flight for the main surfaces, and a copy module sitting on the
 *   hot path must not be a document that slice has to find. "The chief of
 *   staff" is a role, not a name — that is the whole point of the seat.
 * - SENTENCE CASE, no exclamation marks, no emojis (branding § 7). The voice
 *   is the app's: state the fact, then the next move.
 *
 * Everything a state needs is here, including the sentences the SETTINGS row
 * renders for a registration that did not take: they are this feature's copy
 * even though they render on another surface, and the alternative — one
 * sentence per file — is how the two come to disagree about the same state.
 */

import { CHIEF_OF_STAFF_COPY } from "../../../shared/chief-of-staff";
import type { MiniViewPlatform } from "../../../shared/mini-view";
import { formatQuickSendDisplay } from "../../../shared/mini-view";

/**
 * The two composer failures the existing surfaces already spell.
 *
 * REUSED VERBATIM rather than re-worded. The permission sentence is the
 * composer's own (`message-input.tsx:5090-5092`, shown there as a toast), and
 * `Dictation is not available on this device.` is its no-MediaRecorder arm;
 * the design asks the mini view to reuse them so one machine state does not
 * read as two different facts depending on the surface. They live here so a
 * later edit finds both copies beside each other.
 */
export const MICROPHONE_DENIED_COPY =
	"Error accessing microphone. Please ensure microphone permissions are granted.";
export const DICTATION_UNAVAILABLE_COPY =
	"Dictation is not available on this device.";

export const MINI_COPY = {
	/** The header's reader-facing label for the seat. Role, never a name. */
	seatLabel: "To: the chief of staff",
	/** The composer's placeholder; sentence case, an invitation not an order. */
	placeholder: "Message your chief of staff",
	/** Send button and its in-flight replacement. */
	send: "Send",
	sent: "Sent",
	retry: "Retry",
	/** The hint row, replacing nothing — it is the resting line of the surface. */
	hint: "Enter sends, Shift+Enter adds a line, Esc hides",
	/** Dictation states. */
	recording: "Recording. Press the stop button when you're done.",
	transcribing: "Transcribing.",
	dictationStart: "Dictate a message",
	dictationStop: "Stop dictation",
	/** The seat could not be resolved. */
	seatMissing: CHIEF_OF_STAFF_COPY.missing,
	seatOpenFailed: CHIEF_OF_STAFF_COPY.openFailed,
	seatUnreachable: CHIEF_OF_STAFF_COPY.unreachable,
	/**
	 * Paired with a pre-admission refusal, so the reader knows the draft was
	 * not the thing that failed.
	 */
	keepText: "Your message is still here.",
	/**
	 * Post-admission failure: the message may be in the conversation, and
	 * retrying could duplicate it — so the copy points at the conversation
	 * rather than offering a control that might send twice.
	 */
	postAdmission:
		"That didn't reach the chief of staff — check the conversation.",
} as const;

/**
 * The macOS registration boundary (design §G.5's honesty clause; QA round 1, Q2).
 *
 * WHY THE APP SAYS THIS ITSELF. On macOS `globalShortcut.register()` returns
 * TRUE for a chord another app or the system already owns (measured on this
 * machine: `Command+Space` = Spotlight and `Command+Tab` both registered),
 * while false is reachable only for a duplicate inside this process. So a
 * conflicting chord on macOS is a SILENT dead key — exactly the class the
 * design forbids while it could not be detected — and the row must not let a
 * "Registered" badge promise a detection the platform cannot deliver. The
 * sentence states the practical path instead ("if the chord does nothing…"),
 * and it is macOS-only: on Windows and Linux a refused chord really does
 * surface through the taken state.
 */
export const MACOS_DETECTION_BOUNDARY_COPY =
	"If the chord does nothing, another app or the system owns it — choose another.";

/**
 * The settings row's scope line (design §H.2) — the one sentence the desktop
 * UI adds to the registry's own help for this row.
 */
export const QUICK_SEND_SCOPE_COPY = "Works even when the app isn't focused.";

/**
 * The refusal shown UNDER the field when a captured chord has no modifier
 * (design §A.5 rule 1). The backend refuses the same shape at the write
 * boundary; this copy exists so the reader hears it at the key press.
 */
export const DESKTOP_HOTKEY_NEEDS_MODIFIER_COPY =
	"A global shortcut needs a modifier — it would otherwise fire while you type.";

/**
 * The alternates sentence (§B.3), spelled with the display keys of the
 * platform the app is running on so the sentence and the field agree. The
 * shipped default is deliberately not one of the alternates: offering the
 * chord the reader already holds would be circular (it was the middle entry
 * until the default moved onto it).
 */
export function alternatesCopy(platform: MiniViewPlatform): string {
	const shown = (value: string) => formatQuickSendDisplay(value, platform);
	return `Try ${shown("primary+shift+space")} or ${shown("primary+f8")} if that one is taken.`;
}

/**
 * The soft prior-art warning for a captured chord (§B.1), or null when the
 * design found no known claimant.
 *
 * A WARNING, NEVER A BLOCK: the registration call is the authoritative
 * conflict signal (an in-app keymap only loses its shortcut while this app
 * runs; a launcher-companion chord is the user's own arrangement), and the
 * design's §A.5 policy is to disclose, not to refuse. Keys are the canonical
 * stored spellings, so the check cannot be fooled by a re-ordered capture.
 */
export function priorArtCopy(
	value: string,
	platform: MiniViewPlatform,
): string | null {
	const shown = (spelling: string) =>
		formatQuickSendDisplay(spelling, platform);
	const canonical = value
		.split("+")
		.map((token) => token.trim().toLowerCase())
		.filter(Boolean)
		.sort()
		.join("+");
	switch (canonical) {
		case "alt+primary+space":
			return macOr(
				platform,
				"Fantastical and Things Quick Entry use Control+Option+Space; both let you rebind it.",
				"Some capture apps reserve their own chord in this family; the settings inside them can rebind it.",
			);
		case "primary+shift+space":
			return `Some editors use ${shown("primary+shift+space")} for parameter hints, and word processors for a non-breaking space.`;
		default:
			return null;
	}
}

/** Pick the macOS sentence or the other-platforms one. */
function macOr(platform: MiniViewPlatform, mac: string, other: string): string {
	return platform === "mac" ? mac : other;
}

/**
 * The settings row's registration badge (design §G.3), one sentence per
 * state, name-free and platform-correct through the display formatter.
 */
export function registrationCopy(
	status: "registered" | "taken" | "invalid" | "unavailable",
	display: string,
): string {
	switch (status) {
		case "registered":
			return `Registered ${display}`;
		case "taken":
			return `Couldn't register ${display} — another app may already use it. Choose another shortcut.`;
		case "invalid":
			return "This key can't be used as a global shortcut on this system.";
		case "unavailable":
			return "Global shortcuts aren't supported on this system.";
	}
}
