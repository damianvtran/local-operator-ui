import { Box, IconButton, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { Reply } from "@shared/store/conversation-input-store";
import { MessageSquareReply, X } from "lucide-react";

const ReplyPreviewContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(1),
	padding: theme.spacing(1),
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
	borderRadius: theme.shape.borderRadius,
	marginBottom: theme.spacing(1),
}));

const ReplyItem = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1),
	padding: theme.spacing(0.5, 1),
	backgroundColor: alpha(theme.palette.background.paper, 0.7),
	borderRadius: theme.shape.borderRadius,
}));

const ReplyText = styled(Typography)(({ theme }) => ({
	flex: 1,
	fontSize: "0.875rem",
	color: theme.palette.text.secondary,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
}));

type ReplyPreviewProps = {
	replies: Reply[];
	onRemoveReply?: (replyId: string) => void;
};

export const ReplyPreview: React.FC<ReplyPreviewProps> = ({
	replies,
	onRemoveReply,
}) => (
	<ReplyPreviewContainer>
		<Box display="flex" alignItems="center" gap={1} mb={0.5}>
			<MessageSquareReply size={14} />
			<Typography variant="caption" color="text.secondary">
				Replying to:
			</Typography>
		</Box>
		{replies.map((reply) => (
			<ReplyItem key={reply.id}>
				<ReplyText>"{reply.text}"</ReplyText>
				{onRemoveReply && (
					<IconButton size="small" onClick={() => onRemoveReply(reply.id)}>
						<X size={16} />
					</IconButton>
				)}
			</ReplyItem>
		))}
	</ReplyPreviewContainer>
);
