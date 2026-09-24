/**
 * Adding an integration: a name, how it runs, and where it applies.
 *
 * What changed from the old "Add server" form, and why:
 *
 * - Fields are validated here, in words, beside the field they are about
 *   (`integrationNameProblem`, `integrationUrlProblem`). The backend took a URL
 *   with a second `https://` pasted into its path (UX walk N3); a URL is now an
 *   absolute http(s) URL with no inline credentials, query or fragment before
 *   the form will submit.
 * - Errors show once a field has been left or the form was submitted, never
 *   while the first character is being typed.
 * - "This project" is offered only when the backend says there IS a separate
 *   project file. With the desktop's default cwd of `~` the project file and
 *   the global file are the same file, and the option wrote the global one while
 *   the row then said "This project" (UX walk U8).
 * - The form says what happens next: an open chat does not pick the new
 *   integration up by itself - `/mcp reload` or a new chat does (the backend
 *   deliberately does not tear down every live session's connections on add).
 */

import { Spinner } from "@shared/components/common/spinner";
import { Button, Input, Label, Textarea } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { type FC, type FormEvent, useState } from "react";
import {
	integrationNameProblem,
	integrationUrlProblem,
	parseIntegrationArgs,
} from "./integration-model";

export type AddIntegrationValues = {
	name: string;
	scope: "global" | "project";
} & (
	| { mode: "command"; command: string; args: string[] }
	| { mode: "url"; url: string }
);

export type AddIntegrationFormProps = {
	existingNames: readonly string[];
	projectScopeAvailable: boolean;
	/** The project directory, for the scope option's own label. */
	projectLabel?: string | null;
	/**
	 * Submit the values. Resolves to an error sentence to show, or null when the
	 * integration was added (the caller then closes the form).
	 */
	onSubmit: (values: AddIntegrationValues) => Promise<string | null>;
	onCancel: () => void;
	/** Story seam: start with these values already typed and touched. */
	initial?: Partial<{
		name: string;
		mode: "command" | "url";
		command: string;
		args: string;
		url: string;
		touched: boolean;
	}>;
};

/** The note under the form, saying when an open chat sees the change. */
export const ADD_INTEGRATION_PICKUP_NOTE =
	"New chats can use it right away. A chat that's already open picks it up after /mcp reload.";

export const AddIntegrationForm: FC<AddIntegrationFormProps> = ({
	existingNames,
	projectScopeAvailable,
	projectLabel,
	onSubmit,
	onCancel,
	initial,
}) => {
	const [name, setName] = useState(initial?.name ?? "");
	const [mode, setMode] = useState<"command" | "url">(
		initial?.mode ?? "command",
	);
	const [command, setCommand] = useState(initial?.command ?? "");
	const [args, setArgs] = useState(initial?.args ?? "");
	const [url, setUrl] = useState(initial?.url ?? "");
	const [scope, setScope] = useState<"global" | "project">("global");
	const [touched, setTouched] = useState<Record<string, boolean>>(
		initial?.touched ? { name: true, command: true, url: true } : {},
	);
	const [submitted, setSubmitted] = useState(Boolean(initial?.touched));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const nameProblem = integrationNameProblem(name, existingNames);
	const commandProblem =
		mode === "command" && !command.trim() ? "Enter the command to run." : null;
	const urlProblem = mode === "url" ? integrationUrlProblem(url) : null;
	const show = (field: string) => submitted || touched[field];

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		if (nameProblem || commandProblem || urlProblem) return;
		setSaving(true);
		setError(null);
		const effectiveScope = projectScopeAvailable ? scope : "global";
		const values: AddIntegrationValues =
			mode === "command"
				? {
						name: name.trim(),
						scope: effectiveScope,
						mode,
						command: command.trim(),
						args: parseIntegrationArgs(args),
					}
				: { name: name.trim(), scope: effectiveScope, mode, url: url.trim() };
		const failure = await onSubmit(values);
		setSaving(false);
		setError(failure);
	};

	const fieldError = (id: string, problem: string | null, field: string) =>
		problem && show(field) ? (
			<p id={id} className="text-body-sm text-danger">
				{problem}
			</p>
		) : null;

	return (
		<form
			noValidate
			aria-label="Add integration"
			className="flex flex-col gap-4 rounded-lg bg-surface p-4"
			onSubmit={(event) => void submit(event)}
		>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="integration-add-name">Name</Label>
				<Input
					id="integration-add-name"
					value={name}
					placeholder="notion"
					autoComplete="off"
					aria-invalid={Boolean(nameProblem && show("name"))}
					aria-describedby={
						nameProblem && show("name")
							? "integration-add-name-error"
							: undefined
					}
					onChange={(event) => setName(event.target.value)}
					onBlur={() => setTouched((t) => ({ ...t, name: true }))}
				/>
				{fieldError("integration-add-name-error", nameProblem, "name")}
			</div>
			<fieldset className="flex flex-col gap-1.5">
				<legend className="mb-1.5 font-medium text-body-sm text-ink">
					How it runs
				</legend>
				<div className="flex gap-2">
					<Button
						type="button"
						variant={mode === "command" ? "secondary" : "ghost"}
						size="sm"
						aria-pressed={mode === "command"}
						onClick={() => setMode("command")}
					>
						Local command
					</Button>
					<Button
						type="button"
						variant={mode === "url" ? "secondary" : "ghost"}
						size="sm"
						aria-pressed={mode === "url"}
						onClick={() => setMode("url")}
					>
						Remote URL
					</Button>
				</div>
			</fieldset>
			{mode === "command" ? (
				<>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="integration-add-command">Command</Label>
						<Input
							id="integration-add-command"
							value={command}
							placeholder="npx"
							autoComplete="off"
							className="font-mono"
							aria-invalid={Boolean(commandProblem && show("command"))}
							aria-describedby={
								commandProblem && show("command")
									? "integration-add-command-error"
									: undefined
							}
							onChange={(event) => setCommand(event.target.value)}
							onBlur={() => setTouched((t) => ({ ...t, command: true }))}
						/>
						{fieldError(
							"integration-add-command-error",
							commandProblem,
							"command",
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="integration-add-args">
							Arguments{" "}
							<span className="font-normal text-ink-dim">(one per line)</span>
						</Label>
						<Textarea
							id="integration-add-args"
							value={args}
							rows={2}
							className="font-mono"
							onChange={(event) => setArgs(event.target.value)}
						/>
					</div>
				</>
			) : (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="integration-add-url">URL</Label>
					<Input
						id="integration-add-url"
						type="url"
						value={url}
						placeholder="https://mcp.example.com/mcp"
						autoComplete="off"
						className="font-mono"
						aria-invalid={Boolean(urlProblem && show("url"))}
						aria-describedby={
							urlProblem && show("url")
								? "integration-add-url-error"
								: "integration-add-url-help"
						}
						onChange={(event) => setUrl(event.target.value)}
						onBlur={() => setTouched((t) => ({ ...t, url: true }))}
					/>
					{fieldError("integration-add-url-error", urlProblem, "url") ?? (
						<p id="integration-add-url-help" className="text-ink-dim text-meta">
							If it needs a sign-in or a key, you'll be asked after it's added.
						</p>
					)}
				</div>
			)}
			{projectScopeAvailable ? (
				<fieldset className="flex flex-col gap-1.5">
					<legend className="mb-1.5 font-medium text-body-sm text-ink">
						Available in
					</legend>
					<div className="flex gap-2">
						<Button
							type="button"
							variant={scope === "global" ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={scope === "global"}
							onClick={() => setScope("global")}
						>
							All chats
						</Button>
						<Button
							type="button"
							variant={scope === "project" ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={scope === "project"}
							onClick={() => setScope("project")}
						>
							This project
						</Button>
					</div>
					{projectLabel ? (
						<p className="text-ink-dim text-meta">
							{scope === "project"
								? `Only chats working in ${projectLabel}.`
								: "Every chat, in any folder."}
						</p>
					) : null}
				</fieldset>
			) : null}
			{error ? (
				<p className="text-body-sm text-danger" role="alert">
					{error}
				</p>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className={cn("text-body-sm text-ink-dim")}>
					{ADD_INTEGRATION_PICKUP_NOTE}
				</p>
				<div className="flex gap-2">
					<Button type="button" variant="ghost" size="md" onClick={onCancel}>
						Cancel
					</Button>
					<Button type="submit" variant="primary" size="md" disabled={saving}>
						{saving ? <Spinner size="xs" /> : null}
						Add integration
					</Button>
				</div>
			</div>
		</form>
	);
};
