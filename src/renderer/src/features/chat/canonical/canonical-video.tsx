/**
 * One video on a canonical transcript row — the digest-fed player seam.
 *
 * WHY IT EXISTS. A video artifact rides the same record media every picture
 * does (`TranscriptImage` with `kind: "video"`, `attachments.py`'s
 * `cache_media(kind="video", duration_s=…)` block as the tool result), and the
 * bytes resolve through the same store route — the attachment route serves the
 * video MIME set already (`desktop_sessions.py`'s `ATTACHMENT_SERVABLE_MIME_TYPES`).
 * What no existing component can do is PLAY them: `CanonicalImage` would hand a
 * video's bytes to an `<img>`, which fails decode and paints a false
 * "unavailable" receipt — the exact class of lie the reducer's kind filter
 * guarded against until a player existed (`transcript-reducer.ts`'s comment).
 * This is the player, and the card's done body is its mount seat (design spec
 * §3.3); the job_result row's media slot is a named later seat.
 *
 * ONE RESOLVER, TWO MEDIA KINDS. The bytes come from `useAttachmentSource` —
 * the same hook the image path uses — so the blob lifecycle (module-wide
 * refcounted cache, revoke on last release, `abandonFetch` for a result nobody
 * is left to hold) is shared rather than re-implemented. What differs here is
 * only what renders: a reserved box while the bytes are on their way (no
 * spinner — `AttachmentFrame`'s rule), the `<video>` player once they land, and
 * `BrokenAttachment` when they never do.
 *
 * THE THREE FAILURES ARE ONE RECEIPT. A digest that resolves to nothing and a
 * resolved blob that will not DECODE are the same fact to the reader — this
 * copy cannot be played — so both render the same `BrokenAttachment`-class
 * receipt with `VIDEO_UNAVAILABLE_COPY`; only the trigger differs (the
 * resolver's `missing` state, or the element's own `onError`).
 *
 * SIZING follows the image ledger's rule: a shared height ceiling
 * (`max-h-[240px]`, the same number `ImageAttachment` uses, so a column of
 * mixed media reads as rows rather than a scrapbook) with the width following
 * the clip's own aspect once metadata lands. The ceiling is what keeps a 9:16
 * clip sane; `max-w-full` is what keeps a wide one inside the column, and
 * `object-contain` letterboxes the difference on the `sunken` ground the frame
 * already paints.
 */

import { cn } from "@shared/lib/utils";
import { useState } from "react";
import { t } from "../../../../../i18n/messages";
import {
	AttachmentFrame,
	BrokenAttachment,
} from "../components/message-item/attachment-frame";
import type { TranscriptImage } from "./transcript-reducer";
import {
	type AttachmentScope,
	useAttachmentSource,
} from "./use-attachment-url";

export type CanonicalVideoProps = {
	/** The video ref, from the record's media extraction (`kind: "video"`). */
	video: TranscriptImage;
	/**
	 * The conversation the row was read from, as `{ sessionId, childId }` — the
	 * same scope every canonical attachment resolves through (see
	 * `AttachmentScope`).
	 */
	scope: AttachmentScope | null;
	/**
	 * What to call this video when it cannot be played ("Generated video"). The
	 * row above already names the action, so this is a position rather than a
	 * filename — a canonical artifact has no filename to give.
	 */
	label: string;
};

export const CanonicalVideo = ({
	video,
	scope,
	label,
}: CanonicalVideoProps) => {
	const source = useAttachmentSource(video, scope);
	/*
	 * The element's own decode verdict, owned per mount: a blob that loaded (the
	 * resolver answered `ready`) but will not decode is the second trigger for
	 * the one receipt below.
	 */
	const [decodeFailed, setDecodeFailed] = useState(false);
	if (source.state === "missing" || decodeFailed) {
		return (
			<BrokenAttachment
				name={label}
				detail={t(
					"ui.chat.message.attachment_frame.could_not_be_played_its_stored_copy_is_not_available",
				)}
			/>
		);
	}
	if (source.state === "resolving") {
		/*
		 * A RESERVED BOX, not a receipt (the image path's own rule): the frame's
		 * floor holds the slot while the bytes travel, so the row does not grow a
		 * sentence-shaped block that reflows into a player a frame later.
		 * `aria-hidden` because there is nothing to announce yet — the player's
		 * own name lands with it. The marker states the STATE for the rigs, the
		 * same hook `canonical-image.tsx`'s reserved box carries.
		 */
		return (
			<div
				className={cn("inline-block max-w-full self-start")}
				aria-hidden={true}
			>
				<AttachmentFrame data-attachment-reserved="" />
			</div>
		);
	}
	/*
	 * `self-start` IS LOAD-BEARING, not tidiness: the card body is a flex
	 * column, where a plain flex item stretches to the column's whole width -
	 * so the frame drew a column-wide well with the small clip floating in it
	 * (captured 55c3bc879) instead of the hugging letterbox the image row
	 * reads as. `align-self: flex-start` sizes this item to its content, and
	 * the frame inside then shrink-wraps the video exactly as the picture
	 * path's own `inline-block` does. The reserved box takes the same rule so
	 * the arrival swaps a small box for a small box, never a column for one.
	 */
	return (
		<div className={cn("inline-block max-w-full self-start")}>
			<AttachmentFrame>
				{/* biome-ignore lint/a11y/useMediaCaption: a generated clip carries no caption track; the bytes are the provider's. */}
				<video
					controls={true}
					preload="metadata"
					src={source.url}
					/* The element's accessible name: like a picture's alt, left to
					   derive itself it would announce a blob URL. */
					aria-label={label}
					className={cn("max-h-[240px] max-w-full object-contain")}
					onError={() => setDecodeFailed(true)}
				/>
			</AttachmentFrame>
		</div>
	);
};
