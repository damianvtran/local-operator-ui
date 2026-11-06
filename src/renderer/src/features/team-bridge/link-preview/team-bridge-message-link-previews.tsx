import type { FC } from "react";
import { useMemo } from "react";
import {
	LINK_PREVIEW_MAX_CARDS_PER_MESSAGE,
	type LinkPreviewBridge,
} from "../../../../../shared/link-preview";
import { EXTERNAL_HREF } from "../team-bridge-external-href";
import { teamBridgeMessageLinks } from "./message-links";
import { TeamBridgeLinkPreview } from "./team-bridge-link-preview";

/**
 * The link-preview cards beneath one Team Bridge message: the mount that makes
 * the card (`team-bridge-link-preview.tsx`) visible in the product.
 *
 * WHICH LINKS GET A CARD. Each link takes its position in the message as its
 * `index` (`message-links.ts` says why nothing is filtered), and only the first
 * `LINK_PREVIEW_MAX_CARDS_PER_MESSAGE` positions are mounted. That slice is not a
 * second eligibility rule: core answers `cap` for every later index before any
 * fetch, and the model refuses to ask for one, so mounting them would only add
 * components that resolve to nothing. A message whose first link core refuses
 * therefore shows at most two cards - its first three positions are spent in the
 * order core counts them, which is the point.
 *
 * A LINK THE BODY DRAWS AS TEXT GETS NO CARD, AND IS NEVER ASKED ABOUT.
 * `TeamBridgeMarkdown` draws a link whose href fails `EXTERNAL_HREF` (a
 * scheme-less `example.com/login`, a protocol-relative `//host`, a relative
 * `./notes/plan.md`, a `#section`) as inert monospace text: the message refuses
 * to make it a destination. A card for it would make it one anyway, because
 * core normalises a scheme-less target to `https://` and fetches it - an agent
 * citing `[README.md](README.md)` got a card for the third-party site
 * `https://README.md` (#1734 review round 1, R1-M1 / Q-1). So the mount applies
 * the renderer's own `EXTERNAL_HREF` test, the one rule both readers share.
 * It filters HERE, after positions are assigned, and not in `message-links.ts`:
 * the renderer still draws such a link (its `a` override is called for it and
 * answers with a span), so it keeps its position, and a later link's index
 * stays what it was. `mailto:` passes the test and is still asked about; core
 * refuses it as `unsupported-scheme`.
 *
 * WHAT THE READER SEES WHEN THERE IS NO CARD. The plain link, exactly as the
 * message wrote it: this list never touches the body above it, and each card
 * returns nothing unless `linkPreviewDrawsCard` says it draws. When no card draws
 * the list is `:empty` and `empty:hidden` removes its margin, so a message whose
 * links were all refused (or whose operator turned previews off) is laid out
 * exactly as it was before cards existed.
 *
 * THE RECEIPT IS THE ROW'S. `expectedAccountId` is the account the message list
 * was rendered under - the same value the attachment byte route already carries
 * - passed through untouched. A row with no account asks nothing (the card
 * refuses rather than defaulting); this component never substitutes one.
 *
 * KEYED BY POSITION AND URL, so an edit that changes which link sits at a
 * position is a fresh card rather than a reused one carrying the previous link's
 * picture.
 */
export const TeamBridgeMessageLinkPreviews: FC<{
	/** The message body as sent, before any rendering. */
	body: string;
	expectedAccountId: string | null | undefined;
	/** A story or test injects one; production reads the preload. */
	bridge?: LinkPreviewBridge;
}> = ({ body, expectedAccountId, bridge }) => {
	const links = useMemo(
		() =>
			teamBridgeMessageLinks(body)
				.slice(0, LINK_PREVIEW_MAX_CARDS_PER_MESSAGE)
				.map((url, index) => ({ url, index }))
				.filter(({ url }) => EXTERNAL_HREF.test(url)),
		[body],
	);
	if (links.length === 0) return null;
	return (
		/* `max-w-sm` holds a card near the width its picture cap was measured at
		 * (176px of height reached at ~313px for 16:9; see `imageStyle`) instead of
		 * stretching a strip across a wide transcript; the thread pane's narrow
		 * column is smaller still and the card shrinks with it. */
		<div
			data-link-previews=""
			className="mt-1.5 flex max-w-sm flex-col gap-1.5 empty:hidden"
		>
			{links.map(({ url, index }) => (
				<TeamBridgeLinkPreview
					key={`${index}\u0000${url}`}
					url={url}
					index={index}
					expectedAccountId={expectedAccountId}
					bridge={bridge}
				/>
			))}
		</div>
	);
};
