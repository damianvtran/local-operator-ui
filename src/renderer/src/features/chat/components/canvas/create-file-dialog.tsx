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
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Code, File, Folder } from "lucide-react";
import { useEffect, useState } from "react";
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
const fileTypeOptions = (): SearchableOption[] => [
	// General
	{
		id: "md",
		name: t("ui.canvas.create_file_dialog.markdown_md"),
		group: t("ui.canvas.create_file_dialog.general"),
	},
	{
		id: "txt",
		name: t("ui.canvas.create_file_dialog.plain_text_txt"),
		group: t("ui.canvas.create_file_dialog.general"),
	},
	// Web development
	{
		id: "html",
		name: t("ui.canvas.create_file_dialog.html_html"),
		group: t("ui.canvas.create_file_dialog.web_development"),
	},
	{
		id: "css",
		name: t("ui.canvas.create_file_dialog.css_css"),
		group: t("ui.canvas.create_file_dialog.web_development"),
	},
	{
		id: "js",
		name: t("ui.canvas.create_file_dialog.javascript_js"),
		group: t("ui.canvas.create_file_dialog.web_development"),
	},
	{
		id: "jsx",
		name: t("ui.canvas.create_file_dialog.jsx_jsx"),
		group: t("ui.canvas.create_file_dialog.web_development"),
	},
	{
		id: "ts",
		name: t("ui.canvas.create_file_dialog.typescript_ts"),
		group: t("ui.canvas.create_file_dialog.web_development"),
	},
	{
		id: "tsx",
		name: t("ui.canvas.create_file_dialog.tsx_tsx"),
		group: t("ui.canvas.create_file_dialog.web_development"),
	},
	// Backend and scripting
	{
		id: "py",
		name: t("ui.canvas.create_file_dialog.python_py"),
		group: t("ui.canvas.create_file_dialog.backend_and_scripting"),
	},
	{
		id: "go",
		name: t("ui.canvas.create_file_dialog.go_go"),
		group: t("ui.canvas.create_file_dialog.backend_and_scripting"),
	},
	{
		id: "java",
		name: t("ui.canvas.create_file_dialog.java_java"),
		group: t("ui.canvas.create_file_dialog.backend_and_scripting"),
	},
	{
		id: "cs",
		name: t("ui.canvas.create_file_dialog.c_cs"),
		group: t("ui.canvas.create_file_dialog.backend_and_scripting"),
	},
	{
		id: "php",
		name: t("ui.canvas.create_file_dialog.php_php"),
		group: t("ui.canvas.create_file_dialog.backend_and_scripting"),
	},
	{
		id: "rb",
		name: t("ui.canvas.create_file_dialog.ruby_rb"),
		group: t("ui.canvas.create_file_dialog.backend_and_scripting"),
	},
	{
		id: "rs",
		name: t("ui.canvas.create_file_dialog.rust_rs"),
		group: t("ui.canvas.create_file_dialog.backend_and_scripting"),
	},
	{
		id: "sh",
		name: t("ui.canvas.create_file_dialog.shell_script_sh"),
		group: t("ui.canvas.create_file_dialog.backend_and_scripting"),
	},
	// Configuration
	{
		id: "json",
		name: t("ui.canvas.create_file_dialog.json_json"),
		group: t("ui.canvas.create_file_dialog.configuration"),
	},
	{
		id: "yaml",
		name: t("ui.canvas.create_file_dialog.yaml_yaml"),
		group: t("ui.canvas.create_file_dialog.configuration"),
	},
	{
		id: "yml",
		name: t("ui.canvas.create_file_dialog.yaml_yml"),
		group: t("ui.canvas.create_file_dialog.configuration"),
	},
	{
		id: "xml",
		name: t("ui.canvas.create_file_dialog.xml_xml"),
		group: t("ui.canvas.create_file_dialog.configuration"),
	},
	{
		id: "toml",
		name: t("ui.canvas.create_file_dialog.toml_toml"),
		group: t("ui.canvas.create_file_dialog.configuration"),
	},
	{
		id: "ini",
		name: t("ui.canvas.create_file_dialog.ini_ini"),
		group: t("ui.canvas.create_file_dialog.configuration"),
	},
	{
		id: "env",
		name: t("ui.canvas.create_file_dialog.env"),
		group: t("ui.canvas.create_file_dialog.configuration"),
	},
	{
		id: "dockerfile",
		name: t("ui.canvas.create_file_dialog.dockerfile"),
		group: t("ui.canvas.create_file_dialog.configuration"),
	},
	// Other languages
	{
		id: "c",
		name: t("ui.canvas.create_file_dialog.c_c"),
		group: t("ui.canvas.create_file_dialog.other_languages"),
	},
	{
		id: "cpp",
		name: t("ui.canvas.create_file_dialog.c_cpp"),
		group: t("ui.canvas.create_file_dialog.other_languages"),
	},
	{
		id: "swift",
		name: t("ui.canvas.create_file_dialog.swift_swift"),
		group: t("ui.canvas.create_file_dialog.other_languages"),
	},
	{
		id: "kt",
		name: t("ui.canvas.create_file_dialog.kotlin_kt"),
		group: t("ui.canvas.create_file_dialog.other_languages"),
	},
	{
		id: "scala",
		name: t("ui.canvas.create_file_dialog.scala_scala"),
		group: t("ui.canvas.create_file_dialog.other_languages"),
	},
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
	useI18nLocale();
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
	const selectedFileType =
		fileTypeOptions().find((option) => option.id === fileType) ??
		(fileType ? { id: fileType, name: fileType } : null);

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
				{t("ui.canvas.create_file_dialog.cancel")}
			</SecondaryButton>
			<PrimaryButton
				onClick={() => void handleSave()}
				disabled={!canSave}
				startIcon={isSaving ? <Spinner /> : null}
			>
				{isSaving
					? t("ui.canvas.create_file_dialog.creating")
					: t("ui.canvas.create_file_dialog.create_file")}
			</PrimaryButton>
		</>
	);

	return (
		<>
			<BaseDialog
				open={open && !isConfirmingOverwrite}
				onClose={onClose}
				title={t("ui.canvas.create_file_dialog.create_new_file")}
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
							{t("ui.canvas.create_file_dialog.file_name")}
						</Label>
						<Input
							id="create-file-name"
							value={fileName}
							onChange={(e) => setFileName(e.target.value)}
							required
							autoFocus
							disabled={isSaving}
							placeholder={t(
								"ui.canvas.create_file_dialog.enter_file_name_e_g_my_new_script",
							)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && canSave) {
									void handleSave();
								}
							}}
						/>
					</div>

					<SearchableSelect
						label={t("ui.canvas.create_file_dialog.file_type")}
						icon={<Code size={16} aria-hidden="true" />}
						labelTooltip={t(
							"ui.canvas.create_file_dialog.pick_an_extension_or_type_one_that_is_not_listed",
						)}
						placeholder={t(
							"ui.canvas.create_file_dialog.select_or_type_an_extension",
						)}
						options={fileTypeOptions()}
						selected={selectedFileType}
						onSelect={(option) => setFileType(option.id)}
						onCustomSubmit={(text) => setFileType(text)}
						busyLabel={t("ui.canvas.create_file_dialog.loading_file_types")}
						disabled={isSaving}
					/>

					<div>
						<p className={cn(FIELD_LABEL_CLASS, "text-body-sm")}>
							<Folder size={16} aria-hidden="true" />
							{t("ui.canvas.create_file_dialog.location")}
						</p>
						{/*
						 * Read-only, and for THIS dialog's own reason rather than a claim about
						 * the backend: the file is about to be created in the session's working
						 * directory, and this dialog has no way to move that directory - the
						 * composer's chip does, and it is one keystroke away.
						 *
						 * It used to say "Working directory is set when the session starts and
						 * cannot be changed afterwards", which a backend advertising
						 * `session_move` makes FALSE - and it was the last place in the renderer
						 * still saying it, so a user could read it here and watch the same
						 * session's chip move the directory a moment later (design review D1,
						 * agent review M2).
						 */}
						<DirectoryIndicator
							currentWorkingDirectory={currentWorkingDirectory}
							readOnlyReason={t(
								"ui.canvas.create_file_dialog.change_the_working_directory_from_the_composer_to_create_the_file_elsewh",
							)}
						/>
						<p className={cn("mt-2 text-ink-muted text-meta")}>
							{t(
								"ui.canvas.create_file_dialog.the_file_will_be_created_in_this_working_directory",
							)}
						</p>
					</div>
				</div>
			</BaseDialog>
			<ConfirmationModal
				open={isConfirmingOverwrite}
				title={t("ui.canvas.create_file_dialog.file_already_exists")}
				message={t(
					"ui.canvas.create_file_dialog.a_file_named_already_exists_do_you_want_to_overwrite_it",
					{ filename: fileName, filetype: fileType },
				)}
				confirmText={t("ui.canvas.create_file_dialog.overwrite")}
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
