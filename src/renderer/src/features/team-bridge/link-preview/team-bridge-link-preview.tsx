import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Globe, RotateCw } from "lucide-react";
import type { CSSProperties, FC } from "react";
import type { LinkPreviewBridge } from "../../../../../shared/link-preview";
import { EXTERNAL_HREF } from "../team-bridge-external-href";
import {
	LINK_PREVIEW_IMAGE_UNKNOWN_HEIGHT_PX,
	type LinkPreviewCard as LinkPreviewCardContent,
	type LinkPreviewCardView,
	linkPreviewDrawsCard,
	linkPreviewImageAlt,
	linkPreviewSiteLabel,
} from "./link-preview-model";
import {
	useLinkPreviewArtifact,
	useTeamBridgeLinkPreview,
} from "./use-link-preview";

/**
 * The Team Bridge link-preview card: the thing a link in a teammate's message
 * becomes once core has looked at it.
 *
 * WHAT THIS FILE DOES NOT DO, and must not start doing. It does not fetch the
 * linked page, it does not keep a metadata cache, and it never points an `<img>`
 * at a third-party address: the text arrives from core through main's proxy and
 * the picture's bytes come from main's own cache as a `blob:` URL. That is what
 * makes a preview card safe to draw on arrival — the reader's app must not tell
 * the previewed site that the message was read.
 *
 * TWO RULES THE MODULE HEADER OF `link-preview-model.ts` STATES IN FULL, repeated
 * here because a future simplification will be made by someone reading THIS
 * file: (1) core never consults `web_fetch.enabled` on the read route and has no
 * delete for an artifact; main drops the bytes it cached when a resolve answers
 * `disabled`, but that is best-effort, so the stop when the operator's switch is
 * off comes from the renderer — the `disabled` state draws plain text, never a
 * cached card and never another ask; (2) a required `expectedAccountId` is the same discipline as
 * the paste fix — a value with two meanings crossing a boundary caused that bug,
 * and an optional receipt would reintroduce the same ambiguity, so this card
 * refuses to ask without one rather than defaulting it.
 *
 * EVERY STATE IS DRAWN, NOT THROWN. `absent` and `disabled` draw nothing, a
 * delayed retry draws nothing while it waits, and the only two states with
 * pixels are a resolved card and a quiet manual-retry control. A refusal is a
 * state, and an error card for a link core declined would be a card nobody can
 * act on.
 */

/*
 * A card's boundary is its ground, not an edge (branding §5), so this is the
 * `plain` card on `surface` with no border at rest; the anchor inside it is the
 * affordance, and its hover is a colour step, never a lift.
 *
 * THE CARD DRAWS THE FOCUS RING, INSET, and every part of that is load-bearing.
 * The anchor's box IS the card's box, and `styles/index.css` pins
 * `html :focus-visible { outline-offset: 2px }` in an UNLAYERED rule. That is
 * why no utility can move it, and it is not specificity:
 * `focus-visible:-outline-offset-2` is (0,2,0) and would beat the rule's (0,1,1),
 * but every utility lives in `@layer utilities` and an unlayered declaration
 * outranks a layered one whatever its specificity (#1722 review round 2, R2-n1).
 * So the anchor's ring lands outside the card — where this `overflow-hidden` clips
 * it to nothing, since an outline is ink overflow and an ancestor's clip takes
 * it. The card therefore draws the ring inside its own box, which is also the
 * honest a11y model: the whole card is one target, so the whole card is what
 * shows focus. `thread-search-overlay.tsx` established this shape for a
 * composite whose inner field must not paint its own ring, and the same note in
 * `styles/index.css` makes suppressing that inner ring legal only because a
 * wrapper draws the replacement. The anchor's `focus-visible:outline-none` works
 * at all only because the global rule reads its style from `--tw-outline-style`
 * rather than hardcoding `solid`; the same unlayered rule would otherwise win
 * that one too.
 *
 * The offset is negative for the ring to paint over the picture instead of
 * outside it; `outline-accent` is the token the global rule itself uses (there
 * is no `--color-focus`, so `outline-focus` would be a silent no-op).
 *
 * THE RING IS TWO-TONE because the inset half of it crosses the picture, and a
 * picture is arbitrary page content: over the fixture image the accent alone
 * measured 2.57:1 in `localOperatorLight` and 1.82:1 in `highContrastLight`,
 * under the 3:1 change-of-state contrast (#1722 design round 2, D3). A 1px line
 * in the card's own `surface` ground just inside the accent gives the ring an
 * edge it controls whatever is beneath it, the same way a two-tone ring holds
 * over a photo anywhere else.
 *
 * That line is a positioned `::after`, NOT an inset `box-shadow` on the card.
 * A shadow paints with the card's own background, BELOW its children, so the
 * picture would cover exactly the segment it exists for; a positioned
 * pseudo-element paints after the in-flow content, and the outline paints after
 * both, so the stack reads accent, surface line, picture. It is inset by the
 * ring's 2px so the two abut rather than overlap, its radius follows the card's
 * minus that inset, and it ignores the pointer so the whole card stays one
 * target. It exists only while the card holds focus. This is still a focus
 * OUTLINE in the sense `docs/branding.md` means: the ring is the outline, and
 * the line is a 1px border on a box drawn inside the card's own clip, which
 * `overflow-hidden` therefore cannot take.
 */
const CARD_CLASS = cn(
	"relative overflow-hidden rounded-lg",
	"has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2",
	"has-[:focus-visible]:outline-accent has-[:focus-visible]:-outline-offset-2",
	"has-[:focus-visible]:after:pointer-events-none has-[:focus-visible]:after:absolute",
	"has-[:focus-visible]:after:inset-0.5 has-[:focus-visible]:after:rounded-[calc(var(--radius-lg)-2px)]",
	"has-[:focus-visible]:after:border has-[:focus-visible]:after:border-surface",
);

const LINK_CLASS = cn(
	"flex min-w-0 flex-col text-inherit hover:bg-row-hover",
	// The card above paints the ring — see CARD_CLASS.
	"focus-visible:outline-none",
);

const PLATE_CLASS = "flex min-w-0 flex-col gap-1 p-3";

const SITE_ROW_CLASS =
	"flex min-w-0 items-center gap-1.5 text-meta text-ink-muted";

/* The reserved picture, whatever its dimensions: a ratio when the byte header
 * carried one, a fixed strip when it did not. Never a `0x0` box. */
const IMAGE_CLASS = "w-full bg-media-surface object-cover";

/**
 * The card's picture box.
 *
 * A ratio is used ONLY when both dimensions are real measurements. An image
 * whose header core could not parse arrives with no `width`/`height` while its
 * bytes still serve 200, so the box is reserved at a fixed height instead — the
 * absence means UNKNOWN, and a card that rendered `0x0` would be inventing a
 * measurement it was never given.
 *
 * THE RATIO IS HONOURED ONLY UP TO THE CAP. `maxHeight: 176` wins once the
 * container is wider than `176 * width/height` — 312.9px for a 16:9 image — so
 * at a 380px container the box measures 2.159:1, not 1.778:1, and `object-cover`
 * centre-crops the difference rather than stretching it. That cap is deliberate
 * (a card in a chat column must not grow without bound), so it is stated here:
 * the ratio is the shape up to 176px, not an unconditional promise.
 */
function imageStyle(card: LinkPreviewCardContent): CSSProperties {
	const box = card.imageBox;
	return box
		? { aspectRatio: `${box.width} / ${box.height}`, maxHeight: 176 }
		: { height: LINK_PREVIEW_IMAGE_UNKNOWN_HEIGHT_PX };
}

export interface TeamBridgeLinkPreviewViewProps {
	/** The state to paint — see `linkPreviewCardView`. */
	view: LinkPreviewCardView;
	/** `blob:` URLs the connected component resolved; stories pass fixtures. */
	imageUrl?: string | null;
	faviconUrl?: string | null;
	/** The manual retry. Required for the `retry` state to draw a control. */
	onRetry?: () => void;
}

/**
 * The card as a pure function of its state and its two byte URLs.
 *
 * Separated from the IPC so every state can be rendered from a story, a test or
 * a design frame with no main process — and so the connected component is the
 * only place that knows a bridge exists.
 */
export const TeamBridgeLinkPreviewView: FC<TeamBridgeLinkPreviewViewProps> = ({
	view,
	imageUrl,
	faviconUrl,
	onRetry,
}) => {
	if (view.kind === "retry") {
		return (
			<Button variant="ghost" size="sm" onClick={onRetry}>
				<RotateCw aria-hidden="true" />
				{t("ui.common.actions.retry")}
			</Button>
		);
	}
	// `absent`, `disabled`, `waiting` and `silent` all draw nothing. `disabled`
	// is NOT folded into `absent`: it is the operator's own switch, and the
	// caller renders the link as plain text instead of asking again.
	if (view.kind !== "ready") return null;

	const card = view.card;
	const label = linkPreviewSiteLabel(card);
	const content = (
		<>
			{imageUrl ? (
				<img
					// A new URL is a NEW element: the broken-image handler below hides the
					// node imperatively, and a reused node would stay hidden.
					key={imageUrl}
					src={imageUrl}
					alt={linkPreviewImageAlt(card)}
					className={IMAGE_CLASS}
					style={imageStyle(card)}
					/*
					 * The bytes are already in this document; a decode failure is a
					 * broken cache entry, and a broken box is worse than none.
					 */
					onError={(event) => {
						event.currentTarget.style.display = "none";
					}}
				/>
			) : null}
			<div className={PLATE_CLASS}>
				<div className={SITE_ROW_CLASS}>
					{faviconUrl ? (
						<img
							src={faviconUrl}
							alt=""
							className="size-4 shrink-0 rounded-xs object-cover"
						/>
					) : (
						<Globe aria-hidden="true" className="size-3.5 shrink-0" />
					)}
					<span className="truncate">{label}</span>
				</div>
				{card.title ? (
					<span className="line-clamp-2 font-medium text-body-sm text-ink">
						{card.title}
					</span>
				) : null}
				{card.description ? (
					<span className="line-clamp-2 text-ink-muted text-meta">
						{card.description}
					</span>
				) : null}
			</div>
		</>
	);

	return (
		<Card variant="plain" padding="none" className={CARD_CLASS}>
			{EXTERNAL_HREF.test(card.url) ? (
				/*
				 * The same anchor the message's own markdown links use: the browser
				 * opens it, this app never navigates a window to it, and the card
				 * carries no request of its own. `title` gives the destination a
				 * hover receipt without printing a URL nobody can read.
				 */
				<a
					href={card.url}
					target="_blank"
					rel="noreferrer"
					title={card.url}
					className={LINK_CLASS}
				>
					{content}
				</a>
			) : (
				// A canonical URL that is not http(s) (a redirect into a `file:` or a
				// `javascript:` page) is drawn, never linked.
				<div className={LINK_CLASS}>{content}</div>
			)}
		</Card>
	);
};

export interface TeamBridgeLinkPreviewProps {
	/** The link as the message wrote it. */
	url: string;
	/** The link's 0-based position in its message; core enforces the cap on it. */
	index: number;
	/** Required. The account receipt main cannot invent — see the header. */
	expectedAccountId: string | null | undefined;
	/** The preload surface. Absent in production; a story or a test injects one. */
	bridge?: LinkPreviewBridge;
}

/**
 * The connected card: one resolve per link, then the picture's bytes.
 *
 * The two artifact hooks are called unconditionally, before the state is
 * branched on, because hooks cannot sit behind an early return; each one is
 * handed `null` when there is nothing to fetch and then does nothing at all.
 */
export const TeamBridgeLinkPreview: FC<TeamBridgeLinkPreviewProps> = ({
	url,
	index,
	expectedAccountId,
	bridge,
}) => {
	const { view, retry } = useTeamBridgeLinkPreview({
		url,
		index,
		expectedAccountId,
		bridge,
	});
	const card = view.kind === "ready" ? view.card : null;
	const image = useLinkPreviewArtifact(
		card?.image ?? null,
		expectedAccountId,
		bridge,
	);
	const favicon = useLinkPreviewArtifact(
		card?.favicon ?? null,
		expectedAccountId,
		bridge,
	);

	// THE CARD-OR-PLAIN-TEXT DECISION. The message's own link text is always in
	// the body above (the markdown renders it); this decides whether a card joins
	// it. `absent`, `disabled`, `waiting` and `silent` answer no, so the reader
	// sees the plain link and nothing else - in particular `disabled` never paints
	// a card main may still hold bytes for (rule 1 in `link-preview-model.ts`).
	// Returning nothing here, rather than an empty view, is also what lets the
	// message's preview list collapse when no link drew (`empty:hidden`).
	if (!linkPreviewDrawsCard(view)) return null;
	return (
		<TeamBridgeLinkPreviewView
			view={view}
			imageUrl={image.url}
			faviconUrl={favicon.url}
			onRetry={retry}
		/>
	);
};
