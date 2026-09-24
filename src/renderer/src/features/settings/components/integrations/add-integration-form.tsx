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
import {
	Button,
	Input,
	Label,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	type FC,
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
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

/**
 * One line on which transport to pick, because the pair does not explain itself
 * (N2): a user who has an `npx` line from a README has no way to know whether
 * that is "Local command" or a URL.
 */
export const TRANSPORT_HINT =
	"Most services give you a URL. Use Local command when their setup says npx or uvx.";

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

	/*
	 * Focus follows the form (U5): opening it puts the caret in Name, and a
	 * refused submit goes to the field that is actually wrong rather than
	 * leaving the reader on the button with a sentence somewhere above it.
	 */
	const nameRef = useRef<HTMLInputElement>(null);
	const commandRef = useRef<HTMLInputElement>(null);
	const urlRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		nameRef.current?.focus();
	}, []);

	const nameProblem = integrationNameProblem(name, existingNames);
	const commandProblem =
		mode === "command" && !command.trim() ? "Enter the command to run." : null;
	const urlProblem = mode === "url" ? integrationUrlProblem(url) : null;
	const show = (field: string) => submitted || touched[field];

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitted(true);
		if (nameProblem || commandProblem || urlProblem) {
			if (nameProblem) nameRef.current?.focus();
			else if (commandProblem) commandRef.current?.focus();
			else urlRef.current?.focus();
			return;
		}
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
			/*
			 * Escape cancels, the same way it closes the dialogs and the inline
			 * confirms (U5). Claimed on the form itself, so the key is only
			 * swallowed while the form has focus.
			 */
			onKeyDown={(event: KeyboardEvent<HTMLFormElement>) => {
				if (event.key !== "Escape") return;
				event.stopPropagation();
				onCancel();
			}}
		>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="integration-add-name">Name</Label>
				<Input
					ref={nameRef}
					id="integration-add-name"
					value={name}
					placeholder="e.g. notion"
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
			{/*
			 * The two pickers are the app's SHARED segmented control (D4): as two
			 * independent buttons with `aria-pressed`, the unselected one read as
			 * a bare link beside a button rather than the other half of a
			 * mutually exclusive pair. The `data-integration-*` hooks stay, because
			 * the live scene drives this axis the way a user does.
			 */}
			{/*
			 * ONE segmented control per axis, and the panels belong to it (D4):
			 * as two independent buttons with `aria-pressed`, the unselected one
			 * read as a bare link beside a button rather than the other half of a
			 * mutually exclusive pair. The `data-integration-*` hooks stay,
			 * because the live scene drives this axis the way a user does.
			 */}
			<Tabs
				value={mode}
				onValueChange={(value) => setMode(value === "url" ? "url" : "command")}
				className="flex flex-col gap-1.5"
			>
				<span
					id="integration-add-transport-label"
					className="font-medium text-body-sm text-ink"
				>
					How it runs
				</span>
				<TabsList aria-labelledby="integration-add-transport-label">
					<TabsTrigger value="command" data-integration-transport="command">
						Local command
					</TabsTrigger>
					<TabsTrigger value="url" data-integration-transport="url">
						Remote URL
					</TabsTrigger>
				</TabsList>
				<p className="text-ink-dim text-meta">{TRANSPORT_HINT}</p>
				<TabsContent value="command" className="mt-0 flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="integration-add-command">Command</Label>
						<Input
							ref={commandRef}
							id="integration-add-command"
							value={command}
							placeholder="e.g. npx"
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
				</TabsContent>
				<TabsContent value="url" className="mt-0 flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="integration-add-url">URL</Label>
						<Input
							ref={urlRef}
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
							<p
								id="integration-add-url-help"
								className="text-ink-dim text-meta"
							>
								If it needs a sign-in or a key, you'll be asked after it's
								added.
							</p>
						)}
					</div>
				</TabsContent>
			</Tabs>
			{projectScopeAvailable ? (
				<Tabs
					value={scope}
					onValueChange={(value) =>
						setScope(value === "project" ? "project" : "global")
					}
					className="flex flex-col gap-1.5"
				>
					<span
						id="integration-add-scope-label"
						className="font-medium text-body-sm text-ink"
					>
						Available in
					</span>
					<TabsList aria-labelledby="integration-add-scope-label">
						<TabsTrigger value="global" data-integration-scope="global">
							All chats
						</TabsTrigger>
						<TabsTrigger value="project" data-integration-scope="project">
							This project
						</TabsTrigger>
					</TabsList>
					{projectLabel ? (
						<p className="text-ink-dim text-meta">
							{scope === "project"
								? `Only chats working in ${projectLabel}.`
								: "Every chat, in any folder."}
						</p>
					) : null}
				</Tabs>
			) : null}
			{error ? (
				<p className="text-body-sm text-danger" role="alert">
					{error}
				</p>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className={cn("text-body-sm text-ink-dim")}>
					New chats can use it right away. A chat that's already open picks it
					up after <span className="font-mono text-mono-sm">/mcp reload</span>.
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
