import { MessageCircleQuestion, MessagesSquare } from "lucide-react";
import type { FC } from "react";
import type { AskScope } from "../../ask-queue";

/**
 * The asks door's scope glyph, as ONE pairing (#896): a single question bubble
 * for a conversation's own queue, a stack of them for the fleet's.
 *
 * WHY IT IS A COMPONENT RATHER THAN A TERNARY AT EACH SITE. The scope-to-mark
 * pairing used to be an inline ternary in `chat-header.tsx` while the trigger
 * lived there; #896 put the trigger on the panel rail and gave the header's
 * `...` menu the same mark for its asks entry, which would have been the second
 * copy of the pairing - and a copy is how two surfaces end up drawing the two
 * scopes the same way. The glyph carries the U3 claim ("the scope is legible on
 * the control, not only under the pointer"); the words for the two scopes live
 * in `ask-queue.ts` (`askScopeSubject`), and this is their visual half.
 *
 * `aria-hidden` IS THE CALLER'S, not baked in: at both sites the mark is
 * decorative (the tooltip and the announced name carry the scope in words), but
 * a component that always hid itself would be wrong the moment a caller wants the
 * glyph to speak.
 */
export const AsksScopeIcon: FC<{
	scope: AskScope;
	"aria-hidden"?: boolean;
}> = ({ scope, ...props }) => {
	const Icon = scope === "fleet" ? MessagesSquare : MessageCircleQuestion;
	return <Icon {...props} />;
};
