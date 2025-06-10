import {
	Button,
	DialogActions,
	DialogContent,
	TextField,
	Box,
	Typography,
	InputAdornment,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { UploadCloud, Link } from "lucide-react";
import type { FC, DragEvent } from "react";
import { useState, useCallback } from "react";
import { BaseDialog } from "@shared/components/common/base-dialog";

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

	return (
		<BaseDialog open={open} onClose={onClose} title="Insert Image">
			<DialogContent sx={{ pt: "20px !important" }}>
				<Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
					<TextField
						autoFocus
						margin="dense"
						label="Image URL"
						type="url"
						fullWidth
						variant="outlined"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						InputProps={{
							startAdornment: (
								<InputAdornment position="start">
									<Link size={16} />
								</InputAdornment>
							),
						}}
					/>
					<Button
						onClick={handleInsertFromUrl}
						variant="contained"
						disabled={!url}
						sx={{ height: "40px", mt: "4px" }}
					>
						Insert
					</Button>
				</Box>
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
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose}>Cancel</Button>
			</DialogActions>
		</BaseDialog>
	);
};
