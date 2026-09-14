import { BaseDialog } from "@shared/components/common/base-dialog";
import { Button, Input, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { CloudUpload, File as FileIcon } from "lucide-react";
import type { DragEvent, FC } from "react";
import { useCallback, useId, useRef, useState } from "react";

type InsertImageDialogProps = {
	open: boolean;
	onClose: () => void;
	onInsert: (url: string) => void;
};

/**
 * Two ways to get an image into the document: a path typed into the field, or a
 * file dropped on (or picked through) the dropzone.
 *
 * The dropzone is a real `button` that forwards its click to the hidden file
 * input, rather than a `label` wrapping a `div`. That is the one behavioural
 * change here: a label is not focusable and a `display: none` input cannot take
 * the focus either, so the dropzone used to be pointer-only. As a button it
 * tabs, takes Enter and Space, and picks up the base layer's focus ring.
 */
export const InsertImageDialog: FC<InsertImageDialogProps> = ({
	open,
	onClose,
	onInsert,
}) => {
	const pathId = useId();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [path, setPath] = useState("");

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
		(event: DragEvent<HTMLElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const file = event.dataTransfer.files?.[0];
			if (file) {
				handleFile(file);
			}
		},
		[handleFile],
	);

	const handleDragOver = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (file) {
			handleFile(file);
		}
	};

	const handleInsertFromPath = () => {
		if (path) {
			onInsert(path);
			onClose();
			setPath("");
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (path.trim()) {
				handleInsertFromPath();
			}
		}
	};

	const dialogActions = (
		<Button variant="outline" onClick={onClose}>
			Cancel
		</Button>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title="Insert image"
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
		>
			<div className={cn("flex flex-col gap-4 pt-2")}>
				<div className={cn("flex flex-col gap-1.5")}>
					<Label htmlFor={pathId}>Image path on device</Label>
					<div className={cn("flex items-center gap-2")}>
						{/*
						 * The icon sits inside the field rather than beside it, so the
						 * field keeps one boundary instead of gaining a second box for
						 * the adornment.
						 */}
						<div className={cn("relative flex-1")}>
							<FileIcon
								size={16}
								aria-hidden="true"
								className={cn(
									"pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-dim",
								)}
							/>
							<Input
								autoFocus
								id={pathId}
								type="text"
								placeholder="/Users/eren/Documents/image.png"
								value={path}
								onChange={(e) => setPath(e.target.value)}
								onKeyDown={handleKeyDown}
								className={cn("pl-9")}
							/>
						</div>
						<Button
							variant="primary"
							onClick={handleInsertFromPath}
							disabled={!path.trim()}
							className={cn("min-w-20")}
						>
							Insert
						</Button>
					</div>
				</div>
				<p className={cn("text-center text-ink-muted text-meta")}>or</p>
				<input
					ref={fileInputRef}
					accept="image/*"
					className={cn("hidden")}
					type="file"
					onChange={handleFileChange}
				/>
				<button
					type="button"
					onClick={() => fileInputRef.current?.click()}
					onDrop={handleDrop}
					onDragOver={handleDragOver}
					className={cn(
						"flex w-full flex-col items-center gap-2 rounded-lg",
						"border border-hairline border-dashed bg-sunken p-6 text-center",
						"transition-colors duration-fast ease-out-quart hover:bg-accent-wash",
					)}
				>
					<CloudUpload
						size={32}
						aria-hidden="true"
						className={cn("text-ink-dim")}
					/>
					<span className={cn("text-body-sm text-ink-muted")}>
						Drag and drop an image here, or click to select one
					</span>
				</button>
			</div>
		</BaseDialog>
	);
};
