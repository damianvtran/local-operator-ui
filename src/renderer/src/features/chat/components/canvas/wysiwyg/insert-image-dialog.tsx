import {
	Button,
	TextField,
	Box,
	Typography,
	InputAdornment,
	styled,
	useTheme,
} from "@mui/material";
import { UploadCloud, Link } from "lucide-react";
import type { FC, DragEvent } from "react";
import { useState, useCallback } from "react";
import { BaseDialog } from "@shared/components/common/base-dialog";

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

const Dropzone = styled(Box)(({ theme }) => ({
	border: `2px dashed ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius,
	padding: theme.spacing(4),
	textAlign: "center",
	cursor: "pointer",
	backgroundColor: theme.palette.action.hover,
	"&:hover": {
		backgroundColor: theme.palette.action.selected,
	},
}));

type InsertImageDialogProps = {
	open: boolean;
	onClose: () => void;
	onInsert: (url: string) => void;
};

export const InsertImageDialog: FC<InsertImageDialogProps> = ({
	open,
	onClose,
	onInsert,
}) => {
	const theme = useTheme();
	const [url, setUrl] = useState("");

	const handleFile = useCallback(
		(file: File) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				if (typeof e.target?.result === "string") {
					onInsert(e.target.result);
					onClose();
				}
			};
			reader.readAsDataURL(file);
		},
		[onInsert, onClose],
	);

	const handleDrop = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const file = event.dataTransfer.files?.[0];
			if (file) {
				handleFile(file);
			}
		},
		[handleFile],
	);

	const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (file) {
			handleFile(file);
		}
	};

	const handleInsertFromUrl = () => {
		if (url) {
			onInsert(url);
			onClose();
			setUrl("");
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (url.trim()) {
				handleInsertFromUrl();
			}
		}
	};

	const dialogActions = (
		<>
			<Button
				onClick={onClose}
				variant="outlined"
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
		</>
	);

	return (
		<BaseDialog 
			open={open} 
			onClose={onClose} 
			title="Insert Image"
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
		>
			<Box sx={{ pt: 2 }}>
				<FieldContainer>
					<FieldLabel>Image URL</FieldLabel>
					<Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
						<StyledTextField
							autoFocus
							fullWidth
							variant="outlined"
							type="url"
							placeholder="https://example.com/image.jpg"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							onKeyDown={handleKeyDown}
							InputProps={{
								startAdornment: (
									<InputAdornment position="start" sx={{ paddingLeft: 1 }}>
										<Link size={16} />
									</InputAdornment>
								),
							}}
						/>
						<Button
							onClick={handleInsertFromUrl}
							variant="contained"
							color="primary"
							size="small"
							disabled={!url.trim()}
							sx={{
								textTransform: "none",
								fontSize: "0.8125rem",
								padding: theme.spacing(0.75, 2),
								borderRadius: theme.shape.borderRadius * 0.75,
								boxShadow: "none",
								height: "36px",
								minWidth: "80px",
								"&:hover": {
									boxShadow: "none",
									opacity: 0.9,
								},
							}}
						>
							Insert
						</Button>
					</Box>
				</FieldContainer>
				<Typography align="center" sx={{ my: 2, fontSize: "0.875rem" }}>
					OR
				</Typography>
				<input
					accept="image/*"
					style={{ display: "none" }}
					id="raised-button-file"
					type="file"
					onChange={handleFileChange}
				/>
				<label htmlFor="raised-button-file">
					<Dropzone onDrop={handleDrop} onDragOver={handleDragOver}>
						<UploadCloud size={32} />
						<Typography sx={{ mt: 1, fontSize: "0.875rem" }}>
							Drag & drop an image here, or click to select one
						</Typography>
					</Dropzone>
				</label>
			</Box>
		</BaseDialog>
	);
};
