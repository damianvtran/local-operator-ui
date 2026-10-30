/**
 * The agent's picture at the head of a turn.
 *
 * WHAT CHANGED SINCE D11, and why the deletion was right then and is wrong now.
 * D11 deleted the agent glyph and the 40px gutter it was absolutely positioned
 * in, for a measured reason: every agent row paid that indent so ONE 28px box
 * could sit in it, the glyph repeated once per message, and the fact it marked -
 * "the agent is speaking" - was already carried by the register (a user turn is
 * a filled block, an agent turn is prose on no ground). The picture says
 * something the register CANNOT: WHICH agent this turn belongs to. So it is back,
 * under those constraints: drawn once per turn, as a line of its own above the
 * turn's first line (never beside it, so no row's text measure moves), and at
 * 20px rather than 28-40px, because a photograph is intrinsically louder than a
 * muted glyph and it must not become the loudest thing in the left column.
 *
 * NO PICTURE MEANS NO MARK. There is no placeholder here: the current look - no
 * mark at all - is D11's own answer for an agent without a picture, and a Bot
 * glyph per turn would be exactly the repetition D11 removed. `src` is
 * therefore required, and every caller renders this only when it has one.
 *
 * `rounded-full` is one of the three places § 5 permits it, and the picture
 * keeps no edge: unlike the roster's disc (which sits inside a row STATE that
 * can land on its fill), this one sits on the transcript's ground and the image
 * is its own boundary.
 */

import { Avatar, AvatarImage } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

export type MessageAvatarProps = {
	/** The agent's stored picture. Always present; see the note above. */
	src: string;
	className?: string;
};

export const MessageAvatar: FC<MessageAvatarProps> = ({ src, className }) => {
	useI18nLocale();
	return (
		/*
		 * `mb-1` is the same 4px the row's own meta caption takes from its chunk:
		 * the mark belongs to the line under it, and anything wider would read as
		 * a block of its own. `flex` on the root is what keeps it a line rather
		 * than an inline box that the first paragraph would wrap around.
		 */
		<Avatar className={cn("mb-1 size-5", className)}>
			{/*
			 * `alt` names the SPEAKER, not the picture: the transcript shows no
			 * agent name anywhere, so this label is the only place a screen reader
			 * learns whose turn it is. It reuses the transcript's existing role
			 * copy rather than adding a second string for the same fact.
			 */}
			<AvatarImage
				src={src}
				alt={t("ui.chat.transcript_copy.role.assistant")}
				loading="eager"
			/>
		</Avatar>
	);
};
