/**
 * Every sentence the mini view says, and nothing else.
 *
 * WHY ONE MODULE (design §E.5): the design's states are copy as much as they
 * are layout, a review reads them in one place, and the desktop suite can
 * snapshot the table rather than scrape JSX. Two rules are load-bearing and
 * stated here because both have bitten this product before:
 *
 * - THE SEAT'S NAME IS RESOLVED, NEVER LITERAL (operator directive, 2026-09-29):
 *   the "To:" line, the placeholder and both failure sentences render
 *   `aida.status`'s `name` through `resolveSeatName`, so a rename lands with no
 *   code change. The pre-restyle "name-free" rule is superseded: the seat has a
 *   user-facing identity now, and these sentences address her.
 * - SENTENCE CASE, no exclamation marks, no emojis (branding § 7). The voice
 *   is the app's: state the fact, then the next move.
 *
 * Everything a state needs is here, including the sentences the SETTINGS row
 * renders for a registration that did not take: they are this feature's copy
 * even though they render on another surface, and the alternative — one
 * sentence per file — is how the two come to disagree about the same state.
 */

import type { MiniViewPlatform } from "../../../shared/mini-view";
import { formatQuickSendDisplay } from "../../../shared/mini-view";

/*
 * The two composer failures the pre-restyle mini used to spell itself — the
 * permission sentence and the no-MediaRecorder arm — are GONE FROM HERE. The
 * shared composer owns the dictation now (`message-input.tsx`), including
 * both sentences, and a second copy here would be the drift this module's own
 * docstring warns about: one machine state reading as two facts depending on
 * the surface.
 */

export const MINI_COPY = {
	/**
	 * The header's reader-facing label for the seat. ROLE-FREE BY THE RENAME
	 * RULE (operator, 2026-09-29): every seat sentence renders the resolved
	 * display name, so a rename lands with no code change. `Aida` is the same
	 * fallback every other display site uses (`sidebar-navigation.tsx`:
	 * `aida.data?.name ?? "Aida"`), kept here as a resolver rather than a
	 * literal so the four sentences below cannot drift from each other.
	 */
	seatLabel: (name: string) => `To: ${name}`,
	/** The composer's placeholder; sentence case, an invitation not an order. */
	placeholder: (name: string) => `Message ${name}`,
	/** The "Sent" flash, before the window puts itself away. */
	sent: "Sent",
	/** The hint row, replacing nothing — it is the resting line of the surface. */
	hint: "Enter sends, Shift+Enter adds a line, Esc hides",
	/** Dictation states. The mic control's own labels are the composer's. */
	recording: "Recording. Press the stop button when you're done.",
	/** The seat could not be resolved. */
	seatMissing: "This build doesn't have a chief-of-staff seat.",
	seatOpenFailed: "Couldn't open the chief-of-staff conversation.",
	seatUnreachable: (name: string) => `Couldn't reach ${name}.`,
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
	postAdmission: (name: string) =>
		`That didn't reach ${name} — check the conversation.`,
	/** The compact sheets' titles (model/effort), driven by the strip's chips. */
	sheetModel: "Model for this conversation",
	sheetEffort: "Reasoning effort",
	/** Shown while a sheet reads the backend's list. */
	sheetLoading: "Reading the list…",
	/** When the backend cannot be asked (a failed `commands.entities`). */
	sheetFailed: "Couldn't read the list. Press to try again.",
	/** The command surface is off, so no chip opens a sheet. */
	sheetUnavailable: "This backend can't switch that here.",
	/** A pick that the owner refused. */
	switchFailed: "That didn't switch:",
	/** The context chip's readout, off the same snapshot the strip reads. */
	contextLine: (used: string, window: string | null, estimated: boolean) =>
		`Context: ${used}${
			window ? ` of ${window}` : ""
		} tokens${estimated ? " (estimated)" : ""}.`,
	contextLineNoReading: "Context: no reading yet.",
	/** A control that reached the mini but has no quick-send presentation. */
	controlUnavailable: "That control isn't available in quick send.",
	/** The cwd chip's read-only reason (quick send never moves a directory). */
	cwdReadOnly: "Quick send follows the conversation's directory.",
} as const;

/**
 * The seat's display name, resolved from the ONE source the app already keeps:
 * `aida.status`'s `name` (`DesktopAidaState.name`), the same read the seat
 * resolution performs, with the same `"Aida"` fallback every other display
 * site uses (see the contract's note at `desktop-control-contract.ts`).
 *
 * THE GUARD IS DELIBERATE: `name ?? "Aida"` at the sibling sites treats an
 * empty string as a name, which would render "To: " and "Message " — a blank
 * where the operator asked for a name. A blank or whitespace value falls back
 * to the default instead; the rename lane owns refusing empty renames, and
 * this side must not depend on that refusal to render a sentence.
 */
export function resolveSeatName(name: string | null | undefined): string {
	const trimmed = typeof name === "string" ? name.trim() : "";
	return trimmed === "" ? "Aida" : trimmed;
}

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
