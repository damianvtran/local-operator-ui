/**
 * The designed states of an image attachment.
 *
 * An `<img>` on its own has three failure modes the conversation surface kept
 * hitting, and none of them was designed:
 *
 *  1. **Broken.** A missing or unreadable source falls back to the browser's
 *     torn-page glyph plus the alt text, drawn at the OS's own colours. It is
 *     the single loudest piece of chrome the app could accidentally render.
 *  2. **Tiny.** A pasted 8x6 image drew at 8x6 physical pixels — a speck at the
 *     top of a message bubble that reads as damage rather than as content.
 *  3. **Reflow.** With no reserved box, the message jumps by the image's height
 *     the moment it decodes, and in a `column-reverse` list that yanks the
 *     text the reader is on.
 *
 * The frame fixes all three the way Slack, Notion and Things do: a reserved
 * box on the recessed ground, the picture contained inside it, a quiet
 * placeholder while it decodes, and a *legible sentence* if it never arrives.
 * The frame never collapses below `min-h-16`, so an 8px image is a small
 * picture centred in a tile rather than a speck.
 *
 * No spinner while loading. A local file decodes in a frame or two and a
 * spinner would flash; the recessed ground already says "something belongs
 * here".
 */

import { cn } from "@shared/lib/utils";
import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";

export type AttachmentFrameProps = {
	children: ReactNode;
	className?: string;
};

/**
 * The reserved box every attachment picture sits in. `sunken` is the ground
 * that means "a well", which is exactly what a media slot is.
 */
export const AttachmentFrame = ({
	children,
	className,
}: AttachmentFrameProps) => (
	<div
		className={cn(
			"flex max-w-full items-center justify-center overflow-hidden",
			"min-h-16 min-w-16 rounded-sm border border-hairline bg-sunken",
			className,
		)}
	>
		{children}
	</div>
);

export type BrokenAttachmentProps = {
	/** Shown so the reader knows *which* attachment failed. */
	name: string;
	className?: string;
};

/**
 * What the reader sees instead of a torn-page glyph.
 *
 * Voice rule: what happened, what it means, what to do. The name says which
 * file, the sentence says the app could not read it and why that usually
 * happens. It is the neutral ground rather than a `danger` wash — a file that
 * moved is not an error the user made, and painting it red would put it above
 * the agent's own output in the § 7 hierarchy.
 */
export const BrokenAttachment = ({
	name,
	className,
}: BrokenAttachmentProps) => (
	<div
		className={cn(
			"flex w-fit max-w-full items-center gap-2.5 rounded-sm border border-hairline bg-sunken px-3 py-2",
			className,
		)}
	>
		<ImageOff className="size-4 shrink-0 text-ink-dim" aria-hidden={true} />
		<span className="min-w-0 text-body-sm text-ink-muted">
			<span className="truncate font-mono text-ink text-mono-sm">{name}</span>
			{" could not be displayed. It may have been moved, renamed, or deleted."}
		</span>
	</div>
);
