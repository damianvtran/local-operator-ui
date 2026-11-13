/**
 * The positional name of an artifact a tool row produced, when the wire carried
 * none: "Image" / "Image 2", "Sound" / "Sound 2".
 *
 * WHY ONE MODULE. Three renderers (the lightbox's default tile label, the
 * condensed fold strip, the tool row's own pictures and sounds) each spelled
 * this scheme by hand, with an English `Image ${n}` template. The scheme is one
 * fact - "a lone artifact has no number, a set numbers its members" - so it is
 * one pair of messages the translators inflect themselves.
 *
 * RENDER-TIME ONLY. `t()` reads the live locale on every call, so these must be
 * called from a render path (all three callers subscribe through
 * `useI18nLocale()`), never hoisted into a module constant, which would freeze
 * the boot locale. The label becomes an `<img alt>` and the audio player's
 * play/pause accessible name, so it is plain text with no markup.
 */
import { t } from "@shared/i18n";

/** `position` is 1-based; a `count` of 1 names the lone artifact unnumbered. */
export function imageLabel(position: number, count: number): string {
	return t("ui.chat.canonical.media.image_label", { position, count });
}

/** The audio sibling of `imageLabel`; see there for the numbering rule. */
export function soundLabel(position: number, count: number): string {
	return t("ui.chat.canonical.media.sound_label", { position, count });
}
