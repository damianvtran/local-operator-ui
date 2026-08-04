import { BaseDialog } from "@shared/components/common/base-dialog";
import { Button, Input, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { useEffect, useId, useState } from "react";

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

/**
 * The invalid state rides on `aria-invalid` rather than a styling prop, so the
 * red border and the announced state come from the same attribute.
 */
export const InsertLinkDialog: FC<InsertLinkDialogProps> = ({
	open,
	onClose,
	onInsert,
	initialData,
}) => {
	const baseId = useId();
	const urlId = `${baseId}-url`;
	const textId = `${baseId}-text`;
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
			<Button variant="outline" onClick={onClose}>
				Cancel
			</Button>
			<Button variant="primary" onClick={handleInsert} disabled={!isUrlValid}>
				Insert
			</Button>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title="Insert link"
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
		>
			<div className={cn("flex flex-col gap-4 pt-2")}>
				<div className={cn("flex flex-col gap-1.5")}>
					<Label htmlFor={urlId}>
						URL <span className={cn("text-danger")}>*</span>
					</Label>
					<Input
						autoFocus
						id={urlId}
						type="url"
						placeholder="https://example.com"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						onKeyDown={handleKeyDown}
						required
						aria-invalid={url.length > 0 && !isUrlValid ? true : undefined}
					/>
				</div>
				<div className={cn("flex flex-col gap-1.5")}>
					<Label htmlFor={textId}>Text to display</Label>
					<Input
						id={textId}
						type="text"
						placeholder="Link text (optional)"
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
				</div>
			</div>
		</BaseDialog>
	);
};
