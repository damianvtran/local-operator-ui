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

import { t } from "../../../i18n/messages";
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
	seatLabel: (name: string) => t("ui.miniView.seat_label", { name }),
	/** The composer's placeholder; sentence case, an invitation not an order. */
	placeholder: (name: string) => t("ui.miniView.placeholder", { name }),
	/** The "Sent" flash, before the window puts itself away. */
	get sent() {
		return t("ui.miniView.sent");
	},
	/** The hint row, replacing nothing — it is the resting line of the surface. */
	get hint() {
		return t("ui.miniView.hint");
	},
	/** Dictation states. The mic control's own labels are the composer's. */
	get recording() {
		return t("ui.miniView.recording");
	},
	/** The seat could not be resolved. */
	seatMissing: (name: string) => t("ui.miniView.seat_missing", { name }),
	seatOpenFailed: (name: string) => t("ui.miniView.seat_open_failed", { name }),
	seatUnreachable: (name: string) =>
		t("ui.miniView.seat_unreachable", { name }),
	/**
	 * Paired with a pre-admission refusal, so the reader knows the draft was
	 * not the thing that failed.
	 */
	get keepText() {
		return t("ui.miniView.keep_text");
	},
	/**
	 * Post-admission failure: the message may be in the conversation, and
	 * retrying could duplicate it — so the copy points at the conversation
	 * rather than offering a control that might send twice.
	 */
	postAdmission: (name: string) => t("ui.miniView.post_admission", { name }),
	/** The compact sheets' titles (model/effort), driven by the strip's chips. */
	get sheetModel() {
		return t("ui.miniView.sheet_model");
	},
	get sheetEffort() {
		return t("ui.miniView.sheet_effort");
	},
	/** Shown while a sheet reads the backend's list. */
	get sheetLoading() {
		return t("ui.miniView.sheet_loading");
	},
	/** When the backend cannot be asked (a failed `commands.entities`). */
	get sheetFailed() {
		return t("ui.miniView.sheet_failed");
	},
	/** The command surface is off, so no chip opens a sheet. */
	get sheetUnavailable() {
		return t("ui.miniView.sheet_unavailable");
	},
	/** A pick that the owner refused. */
	get switchFailed() {
		return t("ui.miniView.switch_failed");
	},
	/** The context chip's readout, off the same snapshot the strip reads. */
	contextLine: (used: string, window: string | null, estimated: boolean) => {
		if (window !== null) {
			return estimated
				? t("ui.miniView.context_window_estimated", { used, window })
				: t("ui.miniView.context_window", { used, window });
		}
		return estimated
			? t("ui.miniView.context_estimated", { used })
			: t("ui.miniView.context", { used });
	},
	get contextLineNoReading() {
		return t("ui.miniView.context_no_reading");
	},
	/** A control that reached the mini but has no quick-send presentation. */
	get controlUnavailable() {
		return t("ui.miniView.control_unavailable");
	},
	/** The cwd chip's read-only reason (quick send never moves a directory). */
	get cwdReadOnly() {
		return t("ui.miniView.cwd_read_only");
	},
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
export const macosDetectionBoundaryCopy = (): string =>
	t("ui.miniView.macos_detection_boundary");

/**
 * The settings row's scope line (design §H.2) — the one sentence the desktop
 * UI adds to the registry's own help for this row.
 */
export const quickSendScopeCopy = (): string =>
	t("ui.miniView.quick_send_scope");

/**
 * The refusal shown UNDER the field when a captured chord has no modifier
 * (design §A.5 rule 1). The backend refuses the same shape at the write
 * boundary; this copy exists so the reader hears it at the key press.
 */
export const desktopHotkeyNeedsModifierCopy = (): string =>
	t("ui.miniView.hotkey_needs_modifier");

/**
 * The alternates sentence (§B.3), spelled with the display keys of the
 * platform the app is running on so the sentence and the field agree. The
 * shipped default is deliberately not one of the alternates: offering the
 * chord the reader already holds would be circular (it was the middle entry
 * until the default moved onto it).
 */
export function alternatesCopy(platform: MiniViewPlatform): string {
	const shown = (value: string) => formatQuickSendDisplay(value, platform);
	return t("ui.miniView.alternates", {
		first: shown("primary+shift+space"),
		second: shown("primary+f8"),
	});
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
				t("ui.miniView.prior_art_launchers_mac"),
				t("ui.miniView.prior_art_launchers_other"),
			);
		case "primary+shift+space":
			return t("ui.miniView.prior_art_editors", {
				chord: shown("primary+shift+space"),
			});
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
			return t("ui.miniView.registration_registered", { display });
		case "taken":
			return t("ui.miniView.registration_taken", { display });
		case "invalid":
			return t("ui.miniView.registration_invalid");
		case "unavailable":
			return t("ui.miniView.registration_unavailable");
	}
}
