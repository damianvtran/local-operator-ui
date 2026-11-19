/**
 * The quiet 44px icon button the audio surfaces share.
 *
 * Extracted from `features/chat/canonical/sound-player.tsx` when the
 * notification-sound list became its second user (settings spec §3.1): two
 * copies of one class string drift, and the two surfaces are meant to read as
 * the same control (a circle-play in `ink-muted`, quiet chrome).
 *
 * `min-h-11 min-w-11` is the 44px target the preview needs; disabled is a
 * colour step, never opacity (docs/branding.md § 6).
 */
export const ICON_BUTTON_CLASS =
	"flex min-h-11 min-w-11 shrink-0 items-center justify-center text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink disabled:pointer-events-none disabled:text-ink-disabled";
