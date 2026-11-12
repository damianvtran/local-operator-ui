import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/*
 * THE ONE WAY A CONVERSATION SAYS "STILL LOADING", in every slot that can be
 * waiting on one (operator, 2026-11-11: "Give every conversation-loading case …
 * one consistent, clearly visible loading indicator").
 *
 * Four cases, one component, four labels:
 *
 *   - `cold`         - nothing painted yet, the first page is owed. Rendered by
 *                      the transcript in the content column, where the rows will
 *                      land (`transcriptPaneHoldsPlaceholder`).
 *   - `revalidating` - rows painted from this window's cache while the owner's
 *                      page is still owed (`stale`). Rendered in the transcript's
 *                      FOOT slot, the row reserved for the working line.
 *   - `older`        - an earlier page is being fetched. Rendered inside the
 *                      older-history slot's busy Button.
 *   - `remote`       - the conversation is owned by another device and this one
 *                      has not yet been able to read it (cold facade, hydration
 *                      unproven). Takes the place of `cold`, `revalidating` or
 *                      `older` in their own slots, because for a peer's
 *                      conversation the wait IS the sync, and naming it is the
 *                      only thing that tells the reader why it takes longer.
 *
 * Replaced: a faint `text-ink-dim` sentence in the foot slot ("Showing the last
 * saved view - checking for newer messages."), which the operator reported as
 * easy to miss and not reading as loading at all, plus a separate spinner idiom
 * in the older-history slot and an `elevated` dot under the cold placeholder.
 * Three shapes for one condition is what branding.md § 7 asks us not to ship.
 *
 * THE MARK. One `rounded-full` dot (the contract's word for a status dot) on
 * `accent`, the role branding.md § 2 reserves for liveness marks - the one state
 * vocabulary this app has. It replaces `elevated`, which is a GROUND: it cleared
 * the perceptual threshold against `canvas` but was, by construction, the
 * quietest mark that could. Over window glass the dot still reads, because
 * `accent` is an ink-strength role and the pane's translucency changes only the
 * ground under it, not the dot. No pill, no border, no shadow: this is a
 * statement in the flow, not a floating surface.
 *
 * THE PULSE is `lo-intent-pulse` (styles/index.css), not the skeleton's
 * `animate-pulse-visible`: same 2s opacity-only curve, but its trough is 0.75
 * rather than 0.7, and that 0.05 is the difference between `accent` clearing
 * branding.md § 3's 3:1 floor for a meaningful mark on every palette and
 * dipping to 2.77-2.99:1 on eight light ones, the default among them (design
 * review round 1, D1). Under reduced motion it sets `animation: none`, which
 * leaves the dot still at full opacity (branding.md § 3, the
 * indeterminate-liveness rule: one such element per surface, never a layout
 * property). Forced colours paint it `CanvasText`, like every other accent
 * status dot, since a background colour is otherwise dropped there. It is
 * `aria-hidden` - the label beside it is the announcement.
 *
 * THE LABEL is `text-ink-muted text-meta`, one step above the `ink-dim` the old
 * caption sat at; `ink-muted` is the secondary-text role and clears 4.5:1 on
 * every ground. Short, sentence case, trailing ellipsis.
 *
 * NO HEIGHT OF ITS OWN. The row is `text-meta` (12px x 1.45 = 17.4px) and the
 * dot is 8px centred inside it, so the indicator's line box is exactly one
 * `text-meta` line - the same 17.4px as the foot slot's `min-h-[1lh]` reserve
 * (`text-mono-sm`, also 12px x 1.45) and well inside the older-history slot's
 * `h-7`. Mounting it changes what is IN a slot, never the slot.
 *
 * STABLE ACROSS LABELS. A slot that moves from one loading state to another
 * (cold -> remote when the placement fact arrives) re-renders this same element
 * with a new `variant`; callers render it at one tree position with no `key`,
 * so the dot's animation does not restart and the label swaps in place.
 */

export type ConversationLoadingVariant =
	| "cold"
	| "revalidating"
	| "older"
	| "remote";

const LABEL_KEY = {
	cold: "ui.chat.canonical.loading.cold",
	revalidating: "ui.chat.canonical.loading.revalidating",
	older: "ui.chat.canonical.loading.older",
	remote: "ui.chat.canonical.loading.remote",
} as const satisfies Record<ConversationLoadingVariant, string>;

/** The visible label for a variant; exported so a slot's own sr-only announcer says the same words. */
export function conversationLoadingLabel(
	variant: ConversationLoadingVariant,
): string {
	return t(LABEL_KEY[variant]);
}

type ConversationLoadingIndicatorProps = {
	variant: ConversationLoadingVariant;
	/**
	 * Whether this element is its own live region. True (the default) renders an
	 * `<output>` (named by `region_label` only for `cold`; see below). False renders a plain `<span>`, for a
	 * host that already announces the state itself and must not be given a
	 * nested status region - the older-history slot's Button, whose slot owns an
	 * sr-only announcer.
	 */
	announce?: boolean;
	/** Compact spacing below the small-view breakpoint, like the rows it stands in for. */
	isSmallView?: boolean;
	className?: string;
};

export const ConversationLoadingIndicator: FC<
	ConversationLoadingIndicatorProps
> = ({ variant, announce = true, isSmallView = false, className }) => {
	// `t()` reads the locale at call time; this subscription is what re-renders a
	// mounted indicator when the interface language changes.
	useI18nLocale();

	const content = (
		<>
			<span
				aria-hidden="true"
				data-lo-loading-dot={true}
				className="lo-intent-pulse size-2 shrink-0 rounded-full bg-accent forced-colors:bg-[CanvasText]"
			/>
			<span className="min-w-0 truncate text-ink-muted text-meta">
				{conversationLoadingLabel(variant)}
			</span>
		</>
	);
	const classes = cn(
		"flex min-w-0 items-center gap-2 font-sans",
		isSmallView && "gap-1.5",
		className,
	);

	return announce ? (
		/*
		 * `<output>` rather than a div with role="status": the same implicit
		 * live-region semantics from a native element (the a11y lint's ask). The
		 * label lives INSIDE it, so the whole indicator is one subtree - a label
		 * outside it would read as a transcript row.
		 *
		 * NAMED ONLY WHEN COLD. "Loading conversation" is true while nothing is
		 * painted; under rows that are already readable (`revalidating`, `remote`)
		 * it contradicts the screen, so those regions go unnamed and the visible
		 * label - the status content a live region reads - is the whole statement
		 * (code review round 1, C3). The cold name is also the selector the
		 * session-switch and draft-splash rigs read the placeholder by.
		 */
		<output
			aria-label={
				variant === "cold"
					? t("ui.chat.canonical.loading.region_label")
					: undefined
			}
			data-lo-conversation-loading={variant}
			className={classes}
		>
			{content}
		</output>
	) : (
		<span data-lo-conversation-loading={variant} className={classes}>
			{content}
		</span>
	);
};
