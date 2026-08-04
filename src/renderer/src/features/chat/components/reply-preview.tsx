import { Button } from "@shared/components/ui";
import type { Reply } from "@shared/store/conversation-input-store";
import { MessageSquareReply, X } from "lucide-react";
import type { FC } from "react";

type ReplyPreviewProps = {
	replies: Reply[];
	onRemoveReply?: (replyId: string) => void;
};

/**
 * The "replying to" list inside the composer. One quiet accent-tinted block;
 * each reply is a single truncated line with a remove affordance.
 */
export const ReplyPreview: FC<ReplyPreviewProps> = ({
	replies,
	onRemoveReply,
}) => (
	<div className="mb-2 flex flex-col gap-2 rounded-sm bg-accent-wash p-2">
		<div className="mb-0.5 flex items-center gap-1 text-ink-muted">
			<MessageSquareReply size={14} aria-hidden="true" />
			<span className="text-meta text-ink-muted">Replying to:</span>
		</div>
		{replies.map((reply) => (
			<div
				key={reply.id}
				className="flex items-center gap-2 rounded-sm bg-surface/70 px-2 py-1"
			>
				<span className="flex-1 truncate text-body-sm text-ink-muted">
					&ldquo;{reply.text}&rdquo;
				</span>
				{onRemoveReply && (
					<Button
						variant="ghost"
						size="icon-sm"
						className="shrink-0"
						onClick={() => onRemoveReply(reply.id)}
						aria-label="Remove reply"
					>
						<X size={14} aria-hidden="true" />
					</Button>
				)}
			</div>
		))}
	</div>
);
