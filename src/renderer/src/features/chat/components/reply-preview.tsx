import { Button } from "@shared/components/ui";
import type { Reply } from "@shared/store/conversation-input-store";
import { MessageSquareReply, X } from "lucide-react";
import type { FC } from "react";

type ReplyPreviewProps = {
	replies: Reply[];
	onRemoveReply?: (replyId: string) => void;
};

/**
 * The "replying to" list inside the composer. One quiet recessed block; each
 * reply is a single truncated line with a remove affordance.
 *
 * The ground is `sunken`, not `accent-wash`. Muted grey text on a tinted
 * ground is both the pairing the contrast contract cannot measure and the one
 * the eye reads worst, and the accent was being spent on a passive quotation —
 * § 2 keeps it for what a reader acts on. The quotation marks are gone too:
 * the recessed ground and the left rule already say "this is quoted".
 */
export const ReplyPreview: FC<ReplyPreviewProps> = ({
	replies,
	onRemoveReply,
}) => (
	<div className="mb-2 flex flex-col gap-1.5 rounded-sm bg-sunken p-2">
		<div className="flex items-center gap-1.5 text-ink-dim">
			<MessageSquareReply size={12} aria-hidden="true" />
			<span className="text-meta">Replying to</span>
		</div>
		{replies.map((reply) => (
			<div
				key={reply.id}
				className="flex items-center gap-2 border-hairline border-l-2 py-0.5 pl-2"
			>
				<span className="flex-1 truncate text-body-sm text-ink-muted">
					{reply.text}
				</span>
				{onRemoveReply && (
					<Button
						variant="ghost"
						size="icon-sm"
						className="shrink-0 text-ink-dim hover:bg-elevated hover:text-ink"
						onClick={() => onRemoveReply(reply.id)}
						aria-label="Remove reply"
					>
						<X aria-hidden="true" />
					</Button>
				)}
			</div>
		))}
	</div>
);
