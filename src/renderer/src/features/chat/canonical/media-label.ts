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

/**
 * The positional name of a picture the READER attached when it travelled with
 * no file name: "Attached image" / "Attached image 2".
 *
 * THE NOUN IS THE EXISTING KEY `ui.canvas.files.attachmentImage`, the one the
 * canvas Attachments section already names the same nameless picture with, so
 * the transcript and the canvas cannot disagree and no new key is added. The
 * English value is byte-identical to the literal this replaced.
 *
 * THE NUMBER IS CONCATENATED, NOT A SECOND MESSAGE, and that is a judgement
 * rather than a proof: the noun is a free-standing phrase, and a trailing Latin
 * numeral after it ("Image jointe 2", "Imagen adjunta 2", "منسلک تصویر 2") is how
 * every one of the eight locales numbers a named item. It lays out correctly
 * under the RTL locale too: a number is a weak-direction run, so after the
 * Urdu noun it sits on the visual left, i.e. AFTER the noun in reading order -
 * the sibling `image_label` messages place their numeral the same way. One
 * caveat: zh-CN's `image_label` spells its ordinal "第2张图片" (before the
 * noun), so "附件图片 2" is the idiomatic bare form, not the sibling's shape.
 * Compose per locale (a message with a count) the day a locale needs it.
 *
 * Same render-time rule as above: call from a render path that subscribes
 * through `useI18nLocale()`.
 */
export function attachedImageLabel(
	name: string | null | undefined,
	index: number,
	count: number,
): string {
	/* `??`, not `||`: the rule this replaced kept an empty wire name as given. */
	if (name != null) return name;
	const noun = t("ui.canvas.files.attachmentImage");
	return count === 1 ? noun : `${noun} ${index + 1}`;
}
