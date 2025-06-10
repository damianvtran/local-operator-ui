import {
	Button,
	DialogActions,
	DialogContent,
	TextField,
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

export const InsertLinkDialog: FC<InsertLinkDialogProps> = ({
	open,
	onClose,
	onInsert,
	initialData,
}) => {
	const [url, setUrl] = useState("");
	const [text, setText] = useState("");

	useEffect(() => {
		if (open) {
			setUrl(initialData.url);
			setText(initialData.text);
		}
	}, [open, initialData]);

	const handleInsert = () => {
		if (url) {
			onInsert(url, text || url);
			onClose();
		}
	};

	return (
		<BaseDialog open={open} onClose={onClose} title="Insert Link">
			<DialogContent sx={{ pt: "20px !important" }}>
				<TextField
					autoFocus
					margin="dense"
					label="URL"
					type="url"
					fullWidth
					variant="outlined"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
				/>
				<TextField
					margin="dense"
					label="Text to display"
					type="text"
					fullWidth
					variant="outlined"
					value={text}
					onChange={(e) => setText(e.target.value)}
				/>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose}>Cancel</Button>
				<Button onClick={handleInsert} variant="contained">
					Insert
				</Button>
			</DialogActions>
		</BaseDialog>
	);
};
