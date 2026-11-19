import { BaseDialog } from "@shared/components/common/base-dialog";
import { Button, Input, Label } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
	useI18nLocale();
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
				{t("ui.canvas.insert_link_dialog.cancel")}
			</Button>
			<Button variant="primary" onClick={handleInsert} disabled={!isUrlValid}>
				{t("ui.canvas.insert_link_dialog.insert")}
			</Button>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={t("ui.canvas.insert_link_dialog.insert_link")}
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
		>
			<div className={cn("flex flex-col gap-4 pt-2")}>
				<div className={cn("flex flex-col gap-1.5")}>
					<Label htmlFor={urlId}>
						{t("ui.canvas.insert_link_dialog.url")}{" "}
						<span className={cn("text-danger")}>*</span>
					</Label>
					<Input
						autoFocus
						id={urlId}
						type="url"
						placeholder={t("ui.canvas.insert_link_dialog.https_example_com")}
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						onKeyDown={handleKeyDown}
						required
						aria-invalid={url.length > 0 && !isUrlValid ? true : undefined}
					/>
				</div>
				<div className={cn("flex flex-col gap-1.5")}>
					<Label htmlFor={textId}>
						{t("ui.canvas.insert_link_dialog.text_to_display")}
					</Label>
					<Input
						id={textId}
						type="text"
						placeholder={t("ui.canvas.insert_link_dialog.link_text_optional")}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
				</div>
			</div>
		</BaseDialog>
	);
};
