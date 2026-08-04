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
import { useAgents } from "@shared/hooks/use-agents";
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
	agentId: string;
};

export const CreateFileDialog: FC<CreateFileDialogProps> = ({
	open,
	onClose,
	onSave,
	isSaving,
	agentId,
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

	const { data: agentListResult } = useAgents();
	const agent = useMemo(
		() => agentListResult?.agents.find((a) => a.id === agentId),
		[agentListResult, agentId],
	);
	const currentWorkingDirectory = agent?.current_working_directory ?? "~";

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
							agentId={agentId}
							currentWorkingDirectory={currentWorkingDirectory}
						/>
						<p className={cn("mt-2 text-ink-muted text-meta")}>
							The file will be created in the selected working directory.
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
