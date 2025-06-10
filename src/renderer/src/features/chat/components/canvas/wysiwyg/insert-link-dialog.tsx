import {
	Button,
	DialogActions,
	DialogContent,
	TextField,
} from "@mui/material";
import type { FC } from "react";
import { useState } from "react";
import { BaseDialog } from "@shared/components/common/base-dialog";

type InsertLinkDialogProps = {
	open: boolean;
	onClose: () => void;
	onInsert: (url: string, text: string) => void;
};

export const InsertLinkDialog: FC<InsertLinkDialogProps> = ({
	open,
	onClose,
	onInsert,
}) => {
	const [url, setUrl] = useState("");
	const [text, setText] = useState("");

	const handleInsert = () => {
		if (url) {
			onInsert(url, text || url);
			onClose();
			setUrl("");
			setText("");
		}
	};

	return (
		<BaseDialog open={open} onClose={onClose} title="Insert Link">
			<DialogContent>
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
					label="Text to display (optional)"
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
