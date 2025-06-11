import {
	Button,
	TextField,
	Box,
	styled,
	useTheme,
} from "@mui/material";
import type { FC } from "react";
import { useEffect, useState } from "react";
import { BaseDialog } from "@shared/components/common/base-dialog";

export type LinkDialogData = {
	url: string;
	text: string;
};

type InsertLinkDialogProps = {
	open: boolean;
	onClose: () => void;
	onInsert: (url: string, text: string) => void;
	initialData: LinkDialogData;
};

const FieldContainer = styled(Box)({
	marginBottom: 16,
});

const FieldLabel = styled("label")(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginBottom: 6,
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: "0.875rem",
	fontFamily: theme.typography.fontFamily,
	lineHeight: theme.typography.body2.lineHeight,
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: 6,
		backgroundColor: theme.palette.background.paper,
		border: `1px solid ${theme.palette.divider}`,
		padding: 0,
		minHeight: "36px",
		height: "36px",
		alignItems: "center",
		transition: "border-color 0.2s ease, box-shadow 0.2s ease",
		"&:hover": {
			borderColor: theme.palette.text.secondary,
			backgroundColor: theme.palette.background.paper,
		},
		"&.Mui-focused": {
			backgroundColor: theme.palette.background.paper,
			borderColor: theme.palette.primary.main,
			boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
		},
		"& .MuiOutlinedInput-notchedOutline": {
			border: "none",
		},
	},
	"& .MuiInputBase-input": {
		padding: "4px 12px",
		fontSize: "0.875rem",
		lineHeight: 1.5,
		fontFamily: "inherit",
		height: "calc(36px - 8px)",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		wordBreak: "break-word",
		alignSelf: "center",
	},
	"& .MuiInputBase-input::placeholder": {
		color: theme.palette.text.disabled,
		opacity: 1,
	},
}));

export const InsertLinkDialog: FC<InsertLinkDialogProps> = ({
	open,
	onClose,
	onInsert,
	initialData,
}) => {
	const theme = useTheme();
	const [url, setUrl] = useState("");
	const [text, setText] = useState("");

	useEffect(() => {
		if (open) {
			setUrl(initialData.url);
			setText(initialData.text);
		}
	}, [open, initialData]);

	const isUrlValid = url.trim().length > 0;

	const handleInsert = () => {
		if (isUrlValid) {
			onInsert(url.trim(), text.trim() || url.trim());
			onClose();
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (isUrlValid) {
				handleInsert();
			}
		}
	};

	const dialogActions = (
		<>
			<Button
				onClick={onClose}
				variant="outlined" // Secondary action
				size="small"
				sx={{
					borderColor: theme.palette.divider,
					color: theme.palette.text.secondary,
					textTransform: "none",
					fontSize: "0.8125rem",
					padding: theme.spacing(0.75, 2),
					borderRadius: theme.shape.borderRadius * 0.75,
					"&:hover": {
						backgroundColor: theme.palette.action.hover,
						borderColor: theme.palette.divider,
					},
				}}
			>
				Cancel
			</Button>
			<Button
				onClick={handleInsert}
				variant="contained" // Primary action
				color="primary"
				size="small"
				disabled={!isUrlValid}
				sx={{
					textTransform: "none",
					fontSize: "0.8125rem",
					padding: theme.spacing(0.75, 2),
					borderRadius: theme.shape.borderRadius * 0.75,
					boxShadow: "none",
					"&:hover": {
						boxShadow: "none",
						opacity: 0.9,
					},
				}}
			>
				Insert
			</Button>
		</>
	);

	return (
		<BaseDialog 
			open={open} 
			onClose={onClose} 
			title="Insert Link"
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
		>
			<Box sx={{ pt: 2 }}>
				<FieldContainer>
					<FieldLabel>URL *</FieldLabel>
					<StyledTextField
						autoFocus
						fullWidth
						variant="outlined"
						type="url"
						placeholder="https://example.com"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						onKeyDown={handleKeyDown}
						required
						error={url.length > 0 && !isUrlValid}
					/>
				</FieldContainer>
				<FieldContainer>
					<FieldLabel>Text to display</FieldLabel>
					<StyledTextField
						fullWidth
						variant="outlined"
						type="text"
						placeholder="Link text (optional)"
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
				</FieldContainer>
			</Box>
		</BaseDialog>
	);
};
