import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { Spinner } from "@shared/components/common/spinner";
import {
	type SearchableOption,
	SearchableSelect,
} from "@shared/components/hosting/searchable-select";
import { Input, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Code, File, Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { DirectoryIndicator } from "../directory-indicator";

/**
 * The one label shape this form uses. `SearchableSelect` renders its own
 * label with exactly these classes, so the two fields it does not own have to
 * repeat them rather than take the primitive's default weight and ink.
 */
const FIELD_LABEL_CLASS =
	"mb-1.5 flex w-fit items-center gap-2 font-normal text-ink-muted";

/**
 * Extensions offered by the type field. Ordered by group, because
 * `SearchableSelect` emits a heading whenever the group changes and does not
 * sort.
 */
const fileTypeOptions: SearchableOption[] = [
	// General
	{ id: "md", name: "Markdown (.md)", group: "General" },
	{ id: "txt", name: "Plain text (.txt)", group: "General" },
	// Web development
	{ id: "html", name: "HTML (.html)", group: "Web development" },
	{ id: "css", name: "CSS (.css)", group: "Web development" },
	{ id: "js", name: "JavaScript (.js)", group: "Web development" },
	{ id: "jsx", name: "JSX (.jsx)", group: "Web development" },
	{ id: "ts", name: "TypeScript (.ts)", group: "Web development" },
	{ id: "tsx", name: "TSX (.tsx)", group: "Web development" },
	// Backend and scripting
	{ id: "py", name: "Python (.py)", group: "Backend and scripting" },
	{ id: "go", name: "Go (.go)", group: "Backend and scripting" },
	{ id: "java", name: "Java (.java)", group: "Backend and scripting" },
	{ id: "cs", name: "C# (.cs)", group: "Backend and scripting" },
	{ id: "php", name: "PHP (.php)", group: "Backend and scripting" },
	{ id: "rb", name: "Ruby (.rb)", group: "Backend and scripting" },
	{ id: "rs", name: "Rust (.rs)", group: "Backend and scripting" },
	{ id: "sh", name: "Shell script (.sh)", group: "Backend and scripting" },
	// Configuration
	{ id: "json", name: "JSON (.json)", group: "Configuration" },
	{ id: "yaml", name: "YAML (.yaml)", group: "Configuration" },
	{ id: "yml", name: "YAML (.yml)", group: "Configuration" },
	{ id: "xml", name: "XML (.xml)", group: "Configuration" },
	{ id: "toml", name: "TOML (.toml)", group: "Configuration" },
	{ id: "ini", name: "INI (.ini)", group: "Configuration" },
	{ id: "env", name: ".env", group: "Configuration" },
	{ id: "dockerfile", name: "Dockerfile", group: "Configuration" },
	// Other languages
	{ id: "c", name: "C (.c)", group: "Other languages" },
	{ id: "cpp", name: "C++ (.cpp)", group: "Other languages" },
	{ id: "swift", name: "Swift (.swift)", group: "Other languages" },
	{ id: "kt", name: "Kotlin (.kt)", group: "Other languages" },
	{ id: "scala", name: "Scala (.scala)", group: "Other languages" },
];

export type CreateFileDialogProps = {
	open: boolean;
	onClose: () => void;
	onSave: (
		details: { name: string; type: string; location: string },
		overwrite?: boolean,
	) => void;
	isSaving: boolean;
	/**
	 * Where the file will be created: the session's own working directory,
	 * supplied by the caller from the canonical stream.
	 *
	 * Passed in rather than resolved here because this component has no id it
	 * could resolve it FROM - see the comment in the body. Defaults to `"~"`
	 * only when the caller genuinely has no session.
	 */
	currentWorkingDirectory?: string;
};

export const CreateFileDialog: FC<CreateFileDialogProps> = ({
	open,
	onClose,
	onSave,
	isSaving,
	currentWorkingDirectory = "~",
}) => {
	const [fileName, setFileName] = useState("");
	const [fileType, setFileType] = useState("md");
	const [isConfirmingOverwrite, setConfirmingOverwrite] = useState(false);

	// Reset state when the dialog opens to ensure a fresh form
	useEffect(() => {
		if (open) {
			setFileName("");
			setFileType("md");
		}
	}, [open]);

	/*
	 * The working directory is READ ONLY here, and it is passed in rather than
	 * looked up.
	 *
	 * This mount site does NOT hold an agent UUID, despite an earlier comment
	 * here asserting that it does. `agentId` arrives as `chat-page.tsx`'s
	 * `identity` - `draftKey ?? id`, a draft key or a 12-hex canonical session
	 * id - threaded through `chat-content.tsx` and `canvas/index.tsx`. So
	 * looking the agent up in the legacy agents list could never match, which
	 * is why the Location always rendered the `"~"` fallback while the composer
	 * beside it showed the session's real directory: two chips on one screen
	 * disagreeing about the same folder.
	 *
	 * Worse, the picker's commit PATCHed `/v1/agents/<session-id>`, which 404s
	 * on every use - observed in the backend log - while the UI reported
	 * nothing and the chip snapped back. That is exactly the dead write this
	 * change set removed from the composer, and offering a control whose every
	 * use fails is the thing the work exists to stop. There is no backend route
	 * that moves a live session's directory, so the honest control here is a
	 * read-only one that states where the file will go and why that cannot be
	 * changed from this dialog.
	 */

	/*
	 * A typed extension that matches nothing in the list is still a valid
	 * choice, so it is shown back as its own row rather than clearing the
	 * field.
	 */
	const selectedFileType = useMemo(
		() =>
			fileTypeOptions.find((option) => option.id === fileType) ??
			(fileType ? { id: fileType, name: fileType } : null),
		[fileType],
	);

	const canSave = fileName.trim() !== "" && !isSaving;

	const handleSave = async (overwrite = false) => {
		if (!canSave) return;

		const filePath = `${currentWorkingDirectory}/${fileName}.${fileType}`;
		const exists = await window.api.fileExists(filePath);

		if (exists && !overwrite) {
			setConfirmingOverwrite(true);
			return;
		}

		onSave(
			{
				name: fileName,
				type: fileType,
				location: currentWorkingDirectory,
			},
			overwrite,
		);
	};

	const dialogActions = (
		<>
			<SecondaryButton onClick={onClose} disabled={isSaving}>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				onClick={() => void handleSave()}
				disabled={!canSave}
				startIcon={isSaving ? <Spinner /> : null}
			>
				{isSaving ? "Creating..." : "Create file"}
			</PrimaryButton>
		</>
	);

	return (
		<>
			<BaseDialog
				open={open && !isConfirmingOverwrite}
				onClose={onClose}
				title="Create new file"
				actions={dialogActions}
				maxWidth="sm"
				fullWidth
			>
				{/*
				 * Deliberately not a `form`: `DirectoryIndicator` contains its own
				 * text field, and Enter in a nested field would submit this one.
				 */}
				{/* `gap-4`, not child margins: `SearchableSelect` no longer ships an
				    outer margin, because the container owns the gap. */}
				<div className={cn("flex flex-col gap-4 pt-2")}>
					<div>
						<Label htmlFor="create-file-name" className={cn(FIELD_LABEL_CLASS)}>
							<File size={16} aria-hidden="true" />
							File name
						</Label>
						<Input
							id="create-file-name"
							value={fileName}
							onChange={(e) => setFileName(e.target.value)}
							required
							autoFocus
							disabled={isSaving}
							placeholder="Enter file name (e.g., my-new-script)"
							onKeyDown={(e) => {
								if (e.key === "Enter" && canSave) {
									void handleSave();
								}
							}}
						/>
					</div>

					<SearchableSelect
						label="File type"
						icon={<Code size={16} aria-hidden="true" />}
						labelTooltip="Pick an extension, or type one that is not listed."
						placeholder="Select or type an extension"
						options={fileTypeOptions}
						selected={selectedFileType}
						onSelect={(option) => setFileType(option.id)}
						onCustomSubmit={(text) => setFileType(text)}
						busyLabel="Loading file types"
						disabled={isSaving}
					/>

					<div>
						<p className={cn(FIELD_LABEL_CLASS, "text-body-sm")}>
							<Folder size={16} aria-hidden="true" />
							Location
						</p>
						<DirectoryIndicator
							currentWorkingDirectory={currentWorkingDirectory}
							readOnlyReason="Working directory is set when the session starts and cannot be changed afterwards. Start a new chat to use a different folder."
						/>
						<p className={cn("mt-2 text-ink-muted text-meta")}>
							The file will be created in this working directory.
						</p>
					</div>
				</div>
			</BaseDialog>
			<ConfirmationModal
				open={isConfirmingOverwrite}
				title="File already exists"
				message={`A file named "${fileName}.${fileType}" already exists. Do you want to overwrite it?`}
				confirmText="Overwrite"
				onConfirm={() => {
					setConfirmingOverwrite(false);
					void handleSave(true);
				}}
				onCancel={() => setConfirmingOverwrite(false)}
				isDangerous
			/>
		</>
	);
};
