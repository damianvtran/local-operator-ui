import { cn } from "@shared/lib/utils";
import type { FC, RefObject } from "react";
import { useLayoutEffect, useRef } from "react";
import { copyTextMetrics } from "./caret-coordinates";
import { useMentionSource } from "./mention-context";
import { type MentionToken, segmentText } from "./tokens";

/**
 * The pills, drawn BEHIND the textarea.
 *
 * The field keeps its real text (selection, IME, undo, spellcheck and
 * accessibility all stay native) and the overlay repeats that text with the
 * same computed metrics, painting only the mention runs: a wash behind them.
 * The overlay's plain runs are transparent, so the field's own glyphs are the
 * only text a reader sees; nothing is drawn twice. Scroll is mirrored on every
 * scroll event so a tall draft's pills stay under their words.
 *
 * A token sent "without notifying" is drawn as a quieter dashed underline,
 * so the reader can still see which names will not ping.
 */
export const MentionHighlightOverlay: FC<{
	fieldRef: RefObject<HTMLTextAreaElement | null>;
	text: string;
	tokens: readonly MentionToken[];
}> = ({ fieldRef, text, tokens }) => {
	const overlay = useRef<HTMLDivElement>(null);
	const source = useMentionSource();
	// biome-ignore lint/correctness/useExhaustiveDependencies: text and tokens are re-measure triggers; the metrics are read from the field itself.
	useLayoutEffect(() => {
		const field = fieldRef.current;
		const node = overlay.current;
		if (!field || !node) return;
		copyTextMetrics(field, node);
		node.style.left = `${field.offsetLeft}px`;
		node.style.top = `${field.offsetTop}px`;
		node.scrollTop = field.scrollTop;
		const sync = () => {
			node.scrollTop = field.scrollTop;
		};
		field.addEventListener("scroll", sync);
		return () => field.removeEventListener("scroll", sync);
	}, [fieldRef, text, tokens]);
	if (tokens.length === 0) return null;
	return (
		<div
			ref={overlay}
			aria-hidden="true"
			data-mention-overlay=""
			className="pointer-events-none absolute overflow-hidden text-transparent"
		>
			{segmentText(text, tokens).map((segment, index) =>
				segment.kind === "text" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: segments are positional by definition.
					<span key={index}>{segment.text}</span>
				) : (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: segments are positional by definition.
						key={index}
						data-mention-pill={segment.token.notify ? "notify" : "silent"}
						className={cn(
							// Equal negative margins cancel the 2px padding advance. Keep
							// native glyphs opaque: this mirror paints BEHIND the textarea,
							// so identity uses washes, never duplicate coloured glyphs.
							// The typed @Name also carries mention-ness; these washes are
							// supplementary, decorative emphasis, not a 3:1 non-text cue.
							// WCAG 1.4.11 concerns UI components/states: the composer's
							// existing focus indicator stays responsible for keyboard focus.
							// The brand washes differ by hue, not luminance contrast; do
							// not claim composer accessibility from fill alone. Messages
							// can additionally use identifying ink because they own the DOM.
							"box-decoration-clone rounded-sm px-0.5 py-px -mx-0.5",
							source?.self?.accountId === segment.token.accountId
								? "bg-warning-wash group-hover/mention-field:bg-[color-mix(in_srgb,var(--color-warning-wash),var(--color-warning)_3%)]"
								: "bg-accent-wash group-hover/mention-field:bg-[color-mix(in_srgb,var(--color-accent-wash),var(--color-accent)_3%)]",
							!segment.token.notify &&
								"underline decoration-dashed decoration-ink-dim",
						)}
					>
						{segment.text}
					</span>
				),
			)}
			{/* A trailing newline needs a glyph after it to take a line. */}
			{text.endsWith("\n") ? " " : null}
		</div>
	);
};
