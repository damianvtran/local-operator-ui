import { textDirectionFor } from "../../../../i18n/direction";
import { currentLocale } from "../../../../i18n/locale";

/**
 * Keep a shortcut glyph run in its own left-to-right order inside a sentence
 * the catalogue sets right-to-left.
 *
 * THE FAULT THIS REMOVES (native census, QA tier 2, Q-T2-1). Urdu's reload
 * tooltip is `دوبارہ لوڈ کریں (⌘R)`. The DOM text is right, but `⌘` is a neutral
 * (ON) character sitting between the RTL sentence and the Latin `R`, so the
 * bidi algorithm resolves it to the paragraph's direction and paints the pair
 * reversed: `(R⌘)`. `Ctrl+[` is worse (`(]+Ctrl)`). A chord is a LEFT-TO-RIGHT
 * unit whatever language wraps it.
 *
 * Unicode isolates belong only in plain-text attributes such as title and
 * aria-label. A sentence shared with a JSX tooltip is passed through
 * `ShortcutText`, which converts the marked run to <bdi dir="ltr"> and removes
 * the controls. Keyed placeholders keep translation-owned punctuation outside
 * the run; controls are applied here in code, never in a catalogue. LRI, not
 * FSI: a shortcut is always LTR, even a modifier-only run of neutral glyphs.
 *
 * WHY ONLY UNDER AN RTL LOCALE. The catalogues must never carry bidi controls
 * (`scripts/i18n/ur-activation.test.mjs` enforces it), so the controls live
 * here, in code - and they are added only where they change something. An LTR
 * locale gets the glyphs byte for byte, which keeps every English string, test
 * fixture and accessible name exactly what it was, and keeps a screen reader
 * from announcing two stray format characters.
 *
 * The locale is READ from the one store at call time, like `t()`, so the call
 * sites that already subscribe through `useI18nLocale()` re-run this with the
 * rest of the sentence when the language moves.
 */
export const isolateLtr = (value: string): string =>
	value !== "" && textDirectionFor(currentLocale()) === "rtl"
		? `\u2066${value}\u2069`
		: value;
