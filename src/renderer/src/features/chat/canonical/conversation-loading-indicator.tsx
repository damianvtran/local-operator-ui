import { Spinner } from "@shared/components/common/spinner";
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
 * THE MARK is the app's one indeterminate-progress affordance, `Spinner` at
 * `sm` (16px: a `border-control` ring with an `accent` arc, rotating). It was a
 * pulsing `accent` dot until design review round 1 (D-M1): a small green dot
 * beside a line of text reads as PRESENCE - "online", "connected" - which is
 * the reading the operator had already rejected ("doesn't read as loading").
 * A rotating arc is the one shape this app spends on "working on it", so the
 * slot now says loading in the same word every other wait in the app uses.
 * It is `aria-hidden` (no `label`): the visible text beside it is the
 * announcement, and a labelled spinner would say it twice.
 *
 * A 2px RING AT THE SAME 16px (design review, D-M1 follow-up). `sm`'s own 1px
 * border left the light-theme arc as 2-8 accent pixels: measured from frames
 * at c85b0cc95 it was 2.96-4.22:1 across the rotation, under the 3:1 non-text
 * floor at its weakest angle, and a still frame read as an empty grey circle -
 * the sidebar's idle-session status circle, not work in progress. `border-2`
 * replaces `sm`'s `border` (`cn` merges them as one border-width group, last
 * wins) and the box stays `size-4`: preflight's `box-sizing: border-box` keeps
 * the outer diameter at 16px, so nothing in the row moves. Scoped here rather
 * than in `Spinner`'s `SIZES`: the shared `sm` sits in buttons and captions
 * this measurement did not cover.
 *
 * Reduced motion: the global cap in `styles/index.css` truncates
 * `animate-spin` to one 0.01ms iteration rather than cancelling it, and
 * `spin` ends at `rotate(360deg)` - the identity - so the ring and its arc
 * stay fully painted as a static mark. Forced colours flatten every author
 * border to one system colour, which would draw a plain circle with nothing
 * turning in it; system colours are honoured there, so the ring is
 * `CanvasText` and the arc `Highlight`.
 *
 * THE PILL is the label's own ground: `accent` at `LOADING_PILL_ALPHA`
 * (`bg-accent/10`, pinned in `theme-engine/contract-tables.mjs` and read back
 * from this file by the contrast contract) - a translucent, role-derived tint,
 * so it follows the theme and, over window glass, tints whatever is behind it
 * rather than painting an opaque patch. It is what turns a line of text into
 * an object the eye finds. No border and no shadow - it is a statement in the
 * flow, not a floating surface - and NO VERTICAL PADDING (see "No height").
 *
 * THE SPINNER SITS OUTSIDE THE PILL, on the slot's own ground, and that is
 * measured: on the tint the ring's `border-control` track falls under the 3:1
 * the contract holds it to on every plain ground (2.77:1 on rosePineDawn over
 * `canvas`, 2.99:1 on `localOperatorLight`, eight palettes under on `canvas`),
 * and no alpha restores it - 4 % still leaves rosePineDawn at 2.98:1. Beside the
 * pill, in the same flex row and gap, the spinner keeps every existing contract
 * row while mark and label still read as one unit.
 *
 * THE LABEL is `text-ink-muted text-meta`, one step above the `ink-dim` the old
 * caption sat at; `ink-muted` is the secondary-text role, and on the pill it
 * still clears 4.5:1 in every palette (the contract asserts it on the pill's
 * composite over `canvas`, `surface` and `elevated`). Short, sentence case, trailing ellipsis.
 *
 * NO HEIGHT OF ITS OWN. The row is `text-meta` (12px x 1.45 = 17.4px) and the
 * spinner is 16px centred beside it, and the pill adds only horizontal padding,
 * so the indicator's line box is exactly one
 * `text-meta` line - the same 17.4px as the foot slot's `min-h-[1lh]` reserve
 * (`text-mono-sm`, also 12px x 1.45) and well inside the older-history slot's
 * `h-7`. Mounting it changes what is IN a slot, never the slot.
 *
 * STABLE ACROSS LABELS. A slot that moves from one loading state to another
 * (cold -> remote when the placement fact arrives) re-renders this same element
 * with a new `variant`; callers render it at one tree position with no `key`,
 * so the spinner's rotation does not restart and the label swaps in place.
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
			<span data-lo-loading-mark={true} className="inline-flex shrink-0">
				<Spinner
					size="sm"
					className="border-2 forced-colors:border-[CanvasText] forced-colors:border-t-[Highlight]"
				/>
			</span>
			<span
				data-lo-loading-pill={true}
				// No `py-*` and no height: the pill must stay one `text-meta` line.
				className="min-w-0 truncate rounded-full bg-accent/10 px-2 text-ink-muted text-meta"
			>
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
