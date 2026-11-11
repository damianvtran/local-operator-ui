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
 * THE PULSE is `animate-pulse-visible`: opacity only, keyframes ending on 1, so
 * under reduced motion the dot is parked fully visible (branding.md § 3, the
 * indeterminate-liveness rule: one such element per surface, never a layout
 * property). It is `aria-hidden` - the label beside it is the announcement.
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
	 * `<output>` named by `region_label`. False renders a plain `<span>`, for a
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
				className="size-2 shrink-0 animate-pulse-visible rounded-full bg-accent"
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
		 * live-region semantics from a native element (the a11y lint's ask), and the
		 * `aria-label` names the region. The label lives INSIDE it, so the whole
		 * indicator is one subtree - the transcript's "is there content yet" reads
		 * exclude this element by that name, and a label outside it would read as a
		 * transcript row.
		 */
		<output
			aria-label={t("ui.chat.canonical.loading.region_label")}
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
