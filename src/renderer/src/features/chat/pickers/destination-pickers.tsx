/**
 * Destination adapters: one component per `native_action` destination.
 *
 * Each adapter is the thin layer between the backend's presentation request
 * (fields, sources, submit metadata) and the shared `PickerHost`. Its job is
 * to load real options from the named catalogue, collect the decision, call
 * the REAL backend operation the request named, and show the actual reply.
 * None of them synthesise success; a closed picker with no result strip is a
 * cancel, and a result strip always quotes the backend.
 *
 * Destinations that already have a settings surface (settings, providers,
 * accounts, appearance, MCP, updates, web-search) navigate to it rather than
 * duplicating an editor here. Everything else renders in the host.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import {
	desktopKeys,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type ThemeName, themes } from "@shared/themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import type {
	DesktopLoopState,
	DesktopModelCatalogue,
	NativeDesktopAction,
} from "../../../../../shared/desktop-control-contract";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { messageText } from "../canonical/transcript-reducer";
import type { SlashCommandMeta } from "../components/slash-commands";
import {
	PickerCheck,
	PickerField,
	PickerHost,
	PickerKeyValue,
	type PickerOption,
	type PickerResult,
	PickerSegment,
} from "./picker-host";
import {
	errorText,
	isNativeAction,
	useOperation,
	useSessionCommand,
} from "./use-picker-backend";

/** What the dispatcher hands every adapter. */
export type PickerContext = {
	action: NativeDesktopAction;
	spec: SlashCommandMeta;
	sessionId: string;
	canonical: CanonicalSessionHandle;
	commands: SlashCommandMeta[];
	onClose: () => void;
	/** Post a system line into the transcript area (view-only). */
	note: (text: string, error?: boolean) => void;
	/** Re-dispatch a slash line (help -> pick a command). */
	dispatch: (text: string) => void;
	/** Switch the agent's bound canonical session (resume/fork/new). */
	rebind: (sessionId: string) => void;
};

type Entities<T = Record<string, unknown>> = {
	command: string;
	entities: T[];
	current: unknown;
};

function useEntities<T = Record<string, unknown>>(
	sessionId: string,
	command: string,
	name?: string,
	enabled = true,
) {
	return useQuery({
		queryKey: ["desktop", "entities", sessionId, command, name ?? ""],
		queryFn: () =>
			desktopResult<Entities<T>>({
				op: "commands.entities",
				sessionId,
				command,
				name: name || undefined,
			}),
		enabled,
		staleTime: 15_000,
	});
}

// ------------------------------------------------------------------ model

type CatalogueRow = DesktopModelCatalogue["models"][number] & {
	value?: string;
	routed?: boolean;
};

export const ModelPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const [live, setLive] = useState(false);
	const catalogue = useQuery({
		queryKey: ["desktop", "models", live],
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({ op: "models.catalogue", live }),
		staleTime: live ? 0 : 60_000,
	});
	const command = useSessionCommand(sessionId);
	const persist = useOperation();
	const [persistDefault, setPersistDefault] = useState(false);
	const selected = canonical.frontend?.selected_model;
	const currentSelector = selected
		? `${selected.provider}/${selected.model_id}`
		: null;

	const options = useMemo<PickerOption[]>(() => {
		const rows = (catalogue.data?.models ?? []) as CatalogueRow[];
		return rows.map((row) => ({
			value: row.selector ?? row.value ?? `${row.provider}/${row.model_id}`,
			label: row.label || row.model_id,
			description: `${row.provider}${row.aggregated ? ", aggregated" : ""}${
				row.connected ? "" : ", no credential"
			}`,
			meta: row.context_window
				? `${Math.round(row.context_window / 1000)}k`
				: undefined,
			current: currentSelector === (row.selector ?? row.value),
			group: row.connected ? "Connected" : "Needs sign-in",
			keywords: [row.provider, row.model_id],
		}));
	}, [catalogue.data, currentSelector]);

	const errors = catalogue.data?.errors ?? {};
	const errorNote = Object.keys(errors).length
		? `Listing unavailable for: ${Object.keys(errors).join(", ")}`
		: null;

	const onPick = useCallback(
		async (value: string) => {
			const outcome = await command.run("model", value);
			if (!outcome || isNativeAction(outcome) || outcome.kind === "error")
				return;
			if (persistDefault) {
				// Explicit default scope: the session change above is the owner's;
				// the default is the typed settings key, written only on request.
				const [provider, ...rest] = value.split("/");
				await persist.perform(
					async () => {
						await desktopResult({
							op: "settings.edit",
							key: "hosting",
							value: provider,
						});
						await desktopResult({
							op: "settings.edit",
							key: "model_name",
							value: rest.join("/"),
						});
						return value;
					},
					(model) => ({
						tone: "success",
						text: `Default for new sessions: ${model}`,
					}),
					"The default was not saved",
				);
			}
		},
		[command, persistDefault, persist],
	);

	const combined: PickerResult | null = persist.result
		? {
				...persist.result,
				text: [command.result?.text, persist.result.text]
					.filter(Boolean)
					.join("\n"),
			}
		: command.result;

	return (
		<PickerHost
			open
			onClose={onClose}
			title="Model"
			description={
				currentSelector
					? `This session runs ${currentSelector}. Choosing another applies to this session only unless you also set it as the default.`
					: "Choose the model for this session."
			}
			options={options}
			loading={catalogue.isLoading}
			loadError={catalogue.isError ? errorText(catalogue.error) : errorNote}
			searchPlaceholder="Search models"
			onPick={onPick}
			busy={command.busy || persist.busy}
			result={combined}
			toolbar={
				<div className="flex items-center justify-between gap-3">
					<PickerCheck
						checked={persistDefault}
						onCheckedChange={setPersistDefault}
						tone="muted"
					>
						Also make it the default for new sessions
					</PickerCheck>
					<Button
						variant="ghost"
						size="sm"
						type="button"
						onClick={() => setLive(true)}
						disabled={live && catalogue.isFetching}
					>
						{catalogue.data?.source === "live"
							? "Live list"
							: "Refresh from providers"}
					</Button>
				</div>
			}
		/>
	);
};

// ----------------------------------------------------------------- effort

export const EffortPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const entities = useEntities<{ value: string }>(sessionId, "effort");
	const command = useSessionCommand(sessionId);
	const model = canonical.frontend?.selected_model;
	const options = useMemo<PickerOption[]>(
		() =>
			(entities.data?.entities ?? []).map((row) => ({
				value: row.value,
				label: row.value,
				current: entities.data?.current === row.value,
			})),
		[entities.data],
	);
	const label = model
		? `${model.provider}/${model.model_id}`
		: "the current model";
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Reasoning effort"
			description={
				options.length === 0 && !entities.isLoading
					? `${label} has no adjustable effort. Pick a reasoning model with /model first.`
					: `Effort levels ${label} supports. Applies to this session.`
			}
			options={options}
			loading={entities.isLoading}
			loadError={entities.isError ? errorText(entities.error) : null}
			emptyText="Effort is not adjustable on this model."
			onPick={(value) => void command.run("effort", value)}
			busy={command.busy}
			result={command.result}
		/>
	);
};

// ------------------------------------------------------------------ theme

export const ThemePicker: FC<PickerContext> = ({ onClose, action }) => {
	const themeName = useUiPreferencesStore((state) => state.themeName);
	const setTheme = useUiPreferencesStore((state) => state.setTheme);
	const [result, setResult] = useState<PickerResult | null>(null);
	const options = useMemo<PickerOption[]>(
		() =>
			Object.values(themes).map((theme) => ({
				value: theme.id,
				label: theme.name,
				description: theme.description,
				current: theme.id === themeName,
				group: theme.id.startsWith("localOperator")
					? "Local Operator"
					: "Ports",
			})),
		[themeName],
	);
	// A typed argument (`/theme dracula`) is a direct pick when it names a theme.
	useEffect(() => {
		const wanted = action.args.trim();
		if (!wanted) return;
		const match = Object.values(themes).find(
			(theme) =>
				theme.id.toLowerCase() === wanted.toLowerCase() ||
				theme.name.toLowerCase() === wanted.toLowerCase(),
		);
		if (match) {
			setTheme(match.id as ThemeName);
			setResult({ tone: "success", text: `Theme: ${match.name}` });
		} else {
			setResult({
				tone: "warning",
				text: `No desktop theme named "${wanted}".`,
			});
		}
	}, [action.args, setTheme]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Theme"
			description="Desktop theme. The terminal keeps its own tui.theme setting."
			options={options}
			onPick={(value, option) => {
				setTheme(value as ThemeName);
				setResult({ tone: "success", text: `Theme: ${option.label}` });
			}}
			result={result}
		/>
	);
};

// ------------------------------------------------------------- team/agent

type ProfileRow = {
	value: string;
	name?: string;
	kind?: string;
	description?: string;
	profile?: Record<string, unknown> | null;
	instructions?: string | null;
};

export const ProfilePicker: FC<PickerContext & { which: "team" | "agent" }> = ({
	sessionId,
	which,
	spec,
	onClose,
	canonical,
	action,
}) => {
	const [selected, setSelected] = useState<string | null>(null);
	const list = useEntities<ProfileRow>(sessionId, which);
	const detail = useEntities<ProfileRow>(
		sessionId,
		which,
		selected ?? undefined,
		!!selected,
	);
	const command = useSessionCommand(sessionId);
	const [request, setRequest] = useState("");
	const active =
		which === "team"
			? canonical.frontend?.active_team
			: canonical.frontend?.active_agent;
	const chartMode = (action.data as { mode?: string }).mode === "chart";

	const options = useMemo<PickerOption[]>(
		() =>
			(list.data?.entities ?? []).map((row) => ({
				value: row.value,
				label: row.name ?? row.value,
				description: row.description,
				meta: row.kind,
				current: active === row.value,
			})),
		[list.data, active],
	);
	const selectedRow = (detail.data?.entities ?? []).find(
		(row) => row.value === selected,
	);
	const chart = detail.data?.current as
		| Record<string, unknown>
		| null
		| undefined;

	const submit = useCallback(async () => {
		if (!selected) return;
		// The owner admits `data.request` ONCE on attachment; the renderer must
		// not re-send it. The receipt's admission field records that fact.
		const outcome = await command.run(
			which,
			request ? `${selected} ${request}` : selected,
		);
		if (!outcome || isNativeAction(outcome)) return;
	}, [command, which, selected, request]);

	const admission =
		command.outcome && !isNativeAction(command.outcome)
			? (
					command.outcome as {
						admission?: { detail?: string; duplicate?: boolean } | null;
					}
				).admission
			: null;
	const result: PickerResult | null = command.result
		? admission
			? {
					...command.result,
					text: `${command.result.text}\nRequest admitted once${admission.duplicate ? " (already admitted)" : ""}.`,
				}
			: command.result
		: null;

	return (
		<PickerHost
			open
			onClose={onClose}
			title={
				chartMode ? "Team chart" : which === "team" ? "Team" : "Agent profile"
			}
			description={
				chartMode
					? "Pick a team to see how it resolves."
					: `${spec.description}. ${active ? `Active: ${active}.` : ""}`
			}
			options={options}
			loading={list.isLoading}
			loadError={list.isError ? errorText(list.error) : null}
			emptyText={
				which === "team" ? "No teams are registered." : "No profiles found."
			}
			onPick={(value) => setSelected(value)}
			busy={command.busy}
			result={result}
			form={
				selected ? (
					<div className="flex flex-col gap-3">
						<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
							<p className="text-body-sm text-ink">
								{selectedRow?.name ?? selected}
							</p>
							{selectedRow?.description && (
								<p className="text-ink-muted text-meta">
									{selectedRow.description}
								</p>
							)}
							{detail.isLoading && (
								<p className="text-ink-dim text-meta">Loading detail</p>
							)}
							{selectedRow?.instructions && (
								<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-ink-muted text-mono-sm">
									{selectedRow.instructions}
								</pre>
							)}
							{chart && (
								<pre className="mt-2 max-h-48 overflow-auto font-mono text-ink-muted text-mono-sm">
									{JSON.stringify(chart, null, 2)}
								</pre>
							)}
						</div>
						{!chartMode && (
							<PickerField
								label="Request (optional)"
								hint="Sent once with the attachment; it becomes the first turn."
							>
								<Textarea
									value={request}
									onChange={(event) => setRequest(event.target.value)}
									placeholder={`What should ${selectedRow?.name ?? selected} do?`}
									rows={3}
								/>
							</PickerField>
						)}
					</div>
				) : undefined
			}
			onSubmit={!chartMode && selected ? submit : undefined}
			submitLabel={which === "team" ? "Attach team" : "Use profile"}
			submitDisabled={!selected}
		/>
	);
};

// ------------------------------------------------------------------ skills

type SkillRow = {
	name: string;
	description?: string;
	source?: string;
	path?: string;
	[key: string]: unknown;
};
type SkillsResult = {
	data: {
		skills: SkillRow[];
		scope: string;
		detail: { name?: string; body?: string; text?: string } | null;
		warning_count: number;
	};
};

export const SkillsPicker: FC<PickerContext> = ({ sessionId, onClose }) => {
	const [selected, setSelected] = useState<string | null>(null);
	const list = useQuery({
		queryKey: ["desktop", "skills", sessionId],
		queryFn: () =>
			desktopResult<SkillsResult>({ op: "skills.list", sessionId }),
		staleTime: 30_000,
	});
	const detail = useQuery({
		queryKey: ["desktop", "skills", sessionId, selected],
		queryFn: () =>
			desktopResult<SkillsResult>({
				op: "skills.list",
				sessionId,
				name: selected ?? undefined,
			}),
		enabled: !!selected,
	});
	const options = useMemo<PickerOption[]>(
		() =>
			(list.data?.data.skills ?? []).map((row) => ({
				value: row.name,
				label: row.name,
				description: row.description,
				meta: row.source,
				current: row.name === selected,
			})),
		[list.data, selected],
	);
	const body = detail.data?.data.detail;
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Skills"
			description={`Skills discoverable from this session's working directory (${
				list.data?.data.scope ?? "discoverable"
			} scope). Listed is not the same as selected into the prompt.`}
			options={options}
			loading={list.isLoading}
			loadError={list.isError ? errorText(list.error) : null}
			emptyText="No skills are discoverable from this session's directory."
			onPick={(value) => setSelected(value)}
			form={
				selected ? (
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<p className="font-mono text-ink text-mono-sm">
							skill://{selected}
						</p>
						{detail.isLoading ? (
							<p className="text-ink-dim text-meta">Loading</p>
						) : (
							<pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-ink-muted text-mono-sm">
								{body?.body ?? body?.text ?? "No detail returned."}
							</pre>
						)}
					</div>
				) : undefined
			}
		/>
	);
};

// -------------------------------------------------------------------- fork

export const ForkPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	rebind,
	action,
}) => {
	const [message, setMessage] = useState(action.args ?? "");
	const op = useOperation();
	const submit = useCallback(async () => {
		const value = await op.perform(
			() =>
				desktopResult<{
					data: {
						session_id: string;
						parent_id: string;
						boundary: string;
						admission?: { detail: string; duplicate: boolean };
					};
				}>({
					op: "sessions.fork",
					sessionId,
					requestId: uuidv4(),
					message: message.trim() || undefined,
					boundary: "next_safe",
				}),
			(result) => ({
				tone: "success",
				text: `Forked at the next safe boundary into ${result.data.session_id}. The original conversation is unchanged.${
					result.data.admission
						? `\nYour message was admitted once: ${result.data.admission.detail}.`
						: ""
				}`,
			}),
			"The fork was not created",
		);
		if (value) rebind(value.data.session_id);
	}, [op, sessionId, message, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Fork this conversation"
			description="Copies the complete history into a new conversation at the next safe boundary (after the current assistant step and its tool results). The original keeps running and is not modified."
			form={
				<PickerField
					label="First message in the fork (optional)"
					hint="Delivered exactly once to the new conversation."
				>
					<Textarea
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						rows={3}
						placeholder="Try a different approach..."
					/>
				</PickerField>
			}
			onSubmit={submit}
			submitLabel="Fork"
			busy={op.busy}
			result={op.result}
		/>
	);
};

// -------------------------------------------------------------------- stop

type SessionRow = {
	id: string;
	name: string;
	mtime: number;
	live_state?: string;
	pending?: unknown;
};

function useSessionRows() {
	return useQuery({
		queryKey: ["desktop", "sessions", "rows"],
		queryFn: () =>
			desktopResult<{ sessions: SessionRow[] }>({
				op: "sessions.list",
				limit: 200,
			}).then((result) => result.sessions ?? []),
		staleTime: 5_000,
	});
}

function sessionLabel(row: SessionRow) {
	return row.name?.trim() || `Untitled ${row.id}`;
}

export const StopPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	const rows = useSessionRows();
	const [targets, setTargets] = useState<Set<string>>(
		() => new Set(action.args.trim() === "all" ? [] : [sessionId]),
	);
	const [all, setAll] = useState(action.args.trim() === "all");
	const [confirmed, setConfirmed] = useState(false);
	const op = useOperation();
	const options = useMemo<PickerOption[]>(
		() =>
			(rows.data ?? []).map((row) => ({
				value: row.id,
				label: sessionLabel(row),
				description: row.live_state
					? `live: ${row.live_state}`
					: "cold (no owner running)",
				meta: row.id,
				current: targets.has(row.id) || all,
			})),
		[rows.data, targets, all],
	);
	const chosen = all ? (rows.data ?? []).map((row) => row.id) : [...targets];
	const submit = useCallback(async () => {
		if (chosen.length === 0 || !confirmed) return;
		await op.perform(
			() =>
				desktopResult<{
					data: {
						results: { session_id: string; status: string; detail?: string }[];
					};
				}>({
					op: "sessions.stop",
					requestId: uuidv4(),
					targets: chosen.slice(0, 100),
					confirmed: true,
				}),
			(result) => ({
				tone: "success",
				text: result.data.results
					.map(
						(row) =>
							`${row.session_id}: ${
								row.status === "already_stopped"
									? "nothing was running"
									: "stop requested (acknowledged, not a completed exit)"
							}`,
					)
					.join("\n"),
			}),
			"Stop was not accepted",
		);
	}, [op, chosen, confirmed]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Stop"
			description="Ends the chosen sessions' current work through the runtime's own stop protocol. /resume reopens a stopped conversation."
			options={options}
			loading={rows.isLoading}
			loadError={rows.isError ? errorText(rows.error) : null}
			onPick={(value) => {
				setAll(false);
				setTargets((current) => {
					const next = new Set(current);
					if (next.has(value)) next.delete(value);
					else next.add(value);
					return next;
				});
			}}
			toolbar={
				<PickerCheck checked={all} onCheckedChange={setAll} tone="muted">
					All sessions ({rows.data?.length ?? 0})
				</PickerCheck>
			}
			form={
				<PickerCheck
					checked={confirmed}
					onCheckedChange={setConfirmed}
					tone="ink"
				>
					Stop{" "}
					{chosen.length === 1 ? "this session" : `${chosen.length} sessions`}{" "}
					now
				</PickerCheck>
			}
			onSubmit={submit}
			submitLabel="Stop"
			submitDisabled={!confirmed || chosen.length === 0}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// -------------------------------------------------------------------- copy

export const CopyPicker: FC<PickerContext> = ({ canonical, onClose }) => {
	const [result, setResult] = useState<PickerResult | null>(null);
	const options = useMemo<PickerOption[]>(() => {
		const rows: PickerOption[] = [];
		const records = canonical.transcript.records;
		for (let i = records.length - 1; i >= 0 && rows.length < 60; i--) {
			const record = records[i];
			if (record.kind === "assistant" && record.text) {
				rows.push({
					value: `message:${record.id}`,
					label: record.text.replace(/\s+/g, " ").slice(0, 80),
					group: "Messages",
					meta: "message",
				});
				const fences = record.text.match(/```[\w-]*\n[\s\S]*?```/g) ?? [];
				fences.forEach((fence, index) => {
					const code = fence.replace(/^```[\w-]*\n/, "").replace(/```$/, "");
					rows.push({
						value: `code:${record.id}:${index}`,
						label: code.split("\n")[0].slice(0, 80) || "(code)",
						group: "Code blocks",
						meta: `${code.split("\n").length} lines`,
					});
				});
				rows.push({
					value: `quote:${record.id}`,
					label: `> ${record.text.replace(/\s+/g, " ").slice(0, 70)}`,
					group: "As quote",
					meta: "quote",
				});
			}
			if (record.kind === "tool" && record.output) {
				rows.push({
					value: `output:${record.id}`,
					label: `${record.toolName} output`,
					group: "Tool output",
					meta: `${record.output.length} chars`,
				});
			}
		}
		return rows;
	}, [canonical.transcript.records]);

	const onPick = useCallback(
		async (value: string) => {
			const [kind, id, index] = value.split(":");
			const record = canonical.transcript.records.find((row) => row.id === id);
			let text = "";
			if (record?.kind === "assistant") {
				if (kind === "message") text = record.text;
				else if (kind === "quote")
					text = record.text
						.split("\n")
						.map((line) => `> ${line}`)
						.join("\n");
				else if (kind === "code") {
					const fences = record.text.match(/```[\w-]*\n[\s\S]*?```/g) ?? [];
					text = (fences[Number(index)] ?? "")
						.replace(/^```[\w-]*\n/, "")
						.replace(/```$/, "");
				}
			} else if (record?.kind === "tool" && kind === "output") {
				text = record.output ?? "";
			}
			try {
				await navigator.clipboard.writeText(text);
				setResult({
					tone: "success",
					text: `Copied ${text.length} characters.`,
				});
			} catch (error) {
				setResult({
					tone: "error",
					text: `Clipboard refused: ${errorText(error)}`,
				});
			}
		},
		[canonical.transcript.records],
	);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Copy"
			description="Pick a message, a code block, or a quoted excerpt. It goes to the clipboard."
			options={options}
			emptyText="Nothing to copy yet."
			onPick={onPick}
			result={result}
		/>
	);
};

// ------------------------------------------------------------- resume/new

export const ResumePicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	rebind,
	action,
}) => {
	const rows = useSessionRows();
	const [result, setResult] = useState<PickerResult | null>(null);
	const options = useMemo<PickerOption[]>(
		() =>
			(rows.data ?? [])
				.slice()
				.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
				.map((row) => ({
					value: row.id,
					label: sessionLabel(row),
					description: row.live_state
						? `live: ${row.live_state}`
						: "cold, reopens on the next message",
					meta: new Date((row.mtime ?? 0) * 1000).toLocaleString(),
					current: row.id === sessionId,
					keywords: [row.id],
				})),
		[rows.data, sessionId],
	);
	// `/resume <id>` with a known id is a direct pick.
	useEffect(() => {
		const wanted = action.args.trim();
		if (!wanted || !rows.data) return;
		const hit = rows.data.find(
			(row) => row.id === wanted || sessionLabel(row) === wanted,
		);
		if (hit) {
			rebind(hit.id);
			setResult({ tone: "success", text: `Resumed ${sessionLabel(hit)}.` });
		}
	}, [action.args, rows.data, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Resume a conversation"
			description="Every canonical session, live or cold. Picking one attaches this window to it; nothing is restarted until you send a message."
			options={options}
			loading={rows.isLoading}
			loadError={rows.isError ? errorText(rows.error) : null}
			searchPlaceholder="Search by title or id"
			onPick={(value, option) => {
				rebind(value);
				setResult({ tone: "success", text: `Resumed ${option.label}.` });
			}}
			result={result}
		/>
	);
};

export const NewSessionPicker: FC<PickerContext> = ({
	canonical,
	onClose,
	rebind,
}) => {
	const [cwd, setCwd] = useState(canonical.frontend?.cwd ?? "");
	const op = useOperation();
	const createSession = useCanonicalSessionsStore(
		(state) => state.createSession,
	);
	const submit = useCallback(async () => {
		const value = await op.perform(
			async () => {
				const id = await createSession(
					cwd.trim() || (canonical.frontend?.cwd ?? "~"),
				);
				if (!id) throw new Error("the backend did not return a session id");
				return id;
			},
			(id) => ({
				tone: "success",
				text: `New conversation ${id}. The previous one keeps running.`,
			}),
			"The conversation was not created",
		);
		if (value) rebind(value);
	}, [op, createSession, cwd, canonical.frontend?.cwd, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="New conversation"
			description="Starts a fresh canonical session. Work in the current one continues."
			form={
				<PickerField
					label="Working directory"
					hint="Must exist on this machine."
				>
					<Input value={cwd} onChange={(event) => setCwd(event.target.value)} />
				</PickerField>
			}
			onSubmit={submit}
			submitLabel="Create"
			submitDisabled={!cwd.trim()}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// --------------------------------------------------------------- forms

export const GoalPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const current = canonical.frontend?.goal ?? "";
	const [goal, setGoal] = useState(current);
	const command = useSessionCommand(sessionId);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Session goal"
			description={
				current
					? "The standing goal is prepended to every turn. Clear it to remove it."
					: "A standing goal the agent keeps in view on every turn."
			}
			form={
				<PickerField label="Goal">
					<Textarea
						value={goal}
						onChange={(event) => setGoal(event.target.value)}
						rows={3}
						placeholder="Ship the release with green gates"
					/>
				</PickerField>
			}
			onSubmit={() => void command.run("goal", goal.trim())}
			submitLabel="Set goal"
			submitDisabled={!goal.trim()}
			actions={
				current ? (
					<Button
						variant="danger"
						size="sm"
						type="button"
						onClick={() => void command.run("goal", "clear")}
						disabled={command.busy}
					>
						Clear goal
					</Button>
				) : undefined
			}
			busy={command.busy}
			result={command.result}
		/>
	);
};

const APPROVAL_DESCRIPTIONS: Record<string, string> = {
	ask: "write and command tools prompt before running",
	auto: "tools run without asking",
};

export const ApprovalsPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	const defaultScope = (action.data as { scope?: string }).scope === "default";
	const [scope, setScope] = useState<"session" | "default">(
		defaultScope ? "default" : "session",
	);
	const entities = useEntities<{ value: string }>(sessionId, "approvals");
	const command = useSessionCommand(sessionId);
	const settingsOp = useOperation();
	const defaults = useQuery({
		queryKey: ["desktop", "settings", "tool_approval_mode"],
		queryFn: () =>
			desktopResult<{ settings: { key: string; value: unknown }[] }>({
				op: "settings.list",
			}).then((result) =>
				result.settings.find((row) => row.key === "tool_approval_mode"),
			),
		staleTime: 10_000,
	});
	const options = useMemo<PickerOption[]>(
		() =>
			(entities.data?.entities ?? [{ value: "ask" }, { value: "auto" }]).map(
				(row) => ({
					value: row.value,
					label: row.value,
					description: APPROVAL_DESCRIPTIONS[row.value],
					current:
						scope === "default"
							? defaults.data?.value === row.value
							: entities.data?.current === row.value,
				}),
			),
		[entities.data, defaults.data, scope],
	);
	const onPick = useCallback(
		async (value: string) => {
			if (scope === "session") {
				await command.run("approvals", value);
				return;
			}
			// Default scope writes the typed settings key and leaves the current
			// session's mode alone, exactly as `/approvals default` does.
			await settingsOp.perform(
				() =>
					desktopResult<{ key: string; value: unknown }>({
						op: "settings.edit",
						key: "tool_approval_mode",
						value,
					}),
				(row) => ({
					tone: "success",
					text: `Default approvals for new sessions: ${String(row?.value ?? value)}. This session is unchanged.`,
				}),
				"The default was not saved",
			);
			await defaults.refetch();
		},
		[scope, command, settingsOp, defaults],
	);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Tool approvals"
			description="Whether write and command tools ask before running."
			options={options}
			loading={entities.isLoading}
			onPick={onPick}
			toolbar={
				<PickerSegment
					label="Scope"
					value={scope}
					onChange={setScope}
					options={[
						{ value: "session", label: "This session" },
						{ value: "default", label: "Default for new sessions" },
					]}
				/>
			}
			busy={command.busy || settingsOp.busy}
			result={settingsOp.result ?? command.result}
		/>
	);
};

export const FastPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	const command = useSessionCommand(sessionId);
	const [acknowledged, setAcknowledged] = useState(false);
	const premium = Boolean(
		(action.data as { premium_pricing?: boolean }).premium_pricing,
	);
	const options: PickerOption[] = [
		{
			value: "on",
			label: "On",
			description:
				"Priority processing. Billed at premium rates where the provider offers it.",
			disabled: premium && !acknowledged,
		},
		{ value: "off", label: "Off", description: "Standard processing." },
	];
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Fast mode"
			description="Applies to this session only."
			options={options}
			onPick={(value) => void command.run("fast", value)}
			toolbar={
				premium ? (
					<PickerCheck
						checked={acknowledged}
						onCheckedChange={setAcknowledged}
						tone="ink"
					>
						I understand fast mode can cost more per token
					</PickerCheck>
				) : undefined
			}
			busy={command.busy}
			result={command.result}
		/>
	);
};

export const RenamePicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	action,
}) => {
	const [name, setName] = useState(
		action.args || canonical.frontend?.conversation_title || "",
	);
	const command = useSessionCommand(sessionId);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Rename conversation"
			description="An explicit name takes precedence over the generated title."
			form={
				<PickerField label="Name">
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						autoFocus
					/>
				</PickerField>
			}
			onSubmit={() => void command.run("rename", name.trim())}
			submitLabel="Rename"
			submitDisabled={!name.trim()}
			busy={command.busy}
			result={command.result}
		/>
	);
};

export const ContextView: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const command = useSessionCommand(sessionId);
	// biome-ignore lint/correctness/useExhaustiveDependencies: fetch once on open
	useEffect(() => {
		void command.run("context", "");
	}, []);
	const block =
		command.outcome &&
		!isNativeAction(command.outcome) &&
		command.outcome.kind === "block"
			? (command.outcome.data as { items?: [string, string][]; title?: string })
			: null;
	const frontend = canonical.frontend;
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Context"
			description={block?.title ?? "What the next request will carry."}
			body={
				<div className="flex flex-col">
					{block?.items?.map(([label, value]) => (
						<PickerKeyValue key={label} label={label} value={value} />
					))}
					{frontend && (
						<>
							<PickerKeyValue
								label="Measured"
								value={
									frontend.context_tokens === null
										? "unknown"
										: `${frontend.context_tokens}${frontend.context_is_estimate ? " (estimate)" : ""}`
								}
							/>
							<PickerKeyValue
								label="Window"
								value={
									frontend.context_window === null
										? "unknown"
										: String(frontend.context_window)
								}
							/>
							<PickerKeyValue
								label="Cost knowledge"
								value={frontend.cost_knowledge}
							/>
						</>
					)}
					{command.busy && (
						<p className="text-ink-dim text-meta">Asking the owner</p>
					)}
				</div>
			}
			result={command.result?.tone === "error" ? command.result : null}
		/>
	);
};

export const LoopPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	action,
}) => {
	const command = useSessionCommand(sessionId);
	const cancel = useSessionCommand(sessionId);
	const [mode, setMode] = useState<"count" | "goal">("count");
	const [count, setCount] = useState("3");
	const [goal, setGoal] = useState(action.args || "");
	const loop = (canonical.frontend?.loop ?? null) as DesktopLoopState | null;
	const running = loop?.status === "running" || loop?.status === "judging";
	const standingGoal = canonical.frontend?.goal ?? "";
	const submit = useCallback(async () => {
		const args = mode === "count" ? count.trim() : goal.trim();
		if (!args) return;
		await command.run("loop", args);
	}, [command, mode, count, goal]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Loop"
			description="Repeats turns toward a goal. Approval and question gates still stop and wait for you; the loop never answers them."
			body={
				loop && loop.status !== "idle" ? (
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<PickerKeyValue label="Status" value={loop.status} />
						<PickerKeyValue
							label="Completed"
							value={`${loop.completed}${loop.iterations ? ` of ${loop.iterations}` : ""}`}
						/>
						{loop.goal && (
							<PickerKeyValue label="Goal" value={loop.goal} mono={false} />
						)}
						{loop.reason && (
							<PickerKeyValue label="Reason" value={loop.reason} mono={false} />
						)}
					</div>
				) : undefined
			}
			form={
				running ? undefined : (
					<div className="flex flex-col gap-3">
						<PickerSegment
							label="Loop mode"
							value={mode}
							onChange={setMode}
							options={[
								{ value: "count", label: "Fixed number of turns" },
								{ value: "goal", label: "Until a goal is met" },
							]}
						/>
						{mode === "count" ? (
							<PickerField
								label="Turns (1 to 25)"
								hint={
									standingGoal
										? `Uses the standing goal: ${standingGoal}`
										: "Set a standing goal with /goal first, or switch to a goal loop."
								}
							>
								<Input
									type="number"
									min={1}
									max={25}
									value={count}
									onChange={(event) => setCount(event.target.value)}
								/>
							</PickerField>
						) : (
							<PickerField label="Goal" hint="A judge decides when it is met.">
								<Textarea
									value={goal}
									onChange={(event) => setGoal(event.target.value)}
									rows={3}
								/>
							</PickerField>
						)}
					</div>
				)
			}
			onSubmit={running ? undefined : submit}
			submitLabel="Start loop"
			submitDisabled={
				mode === "count" ? !count.trim() || !standingGoal : !goal.trim()
			}
			actions={
				running ? (
					<Button
						variant="danger"
						size="sm"
						type="button"
						onClick={() => void cancel.run("loop", "cancel")}
						disabled={cancel.busy}
					>
						Cancel loop
					</Button>
				) : undefined
			}
			busy={command.busy || cancel.busy}
			result={cancel.result ?? command.result}
		/>
	);
};

export const AsidePicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	const [text, setText] = useState(action.args || "");
	const [asideId, setAsideId] = useState<string | null>(null);
	const [answer, setAnswer] = useState<string | null>(null);
	const [adopted, setAdopted] = useState(false);
	const ask = useOperation();
	const adopt = useOperation();
	const submit = useCallback(async () => {
		if (!text.trim()) return;
		const value = await ask.perform(
			() =>
				desktopResult<{
					data: { aside_id: string; text: string; off_record: boolean };
				}>({
					op: "sessions.aside",
					sessionId,
					requestId: uuidv4(),
					text: text.trim(),
					asideId: asideId ?? undefined,
				}),
			() => ({
				tone: "info",
				text: "Answered off the record. Nothing entered the conversation.",
			}),
			"The aside was not answered",
		);
		if (value) {
			setAsideId(value.data.aside_id);
			setAnswer(value.data.text);
		}
	}, [ask, sessionId, text, asideId]);
	const doAdopt = useCallback(async () => {
		if (!asideId) return;
		const value = await adopt.perform(
			() =>
				desktopResult<{ data: Record<string, unknown> }>({
					op: "sessions.adopt",
					sessionId,
					requestId: uuidv4(),
					asideId,
					confirmed: true,
				}),
			() => ({
				tone: "success",
				text: "Adopted into the conversation as a real turn.",
			}),
			"The aside was not adopted",
		);
		if (value) setAdopted(true);
	}, [adopt, sessionId, asideId]);
	const close = useCallback(() => {
		// A settled, unadopted panel is closed on the backend so it does not
		// count against the bounded aside pool; the exchange is discarded.
		if (asideId && !adopted) {
			void desktopResult({
				op: "sessions.aside.close",
				sessionId,
				asideId,
			}).catch(() => {});
		}
		onClose();
	}, [asideId, adopted, sessionId, onClose]);
	return (
		<PickerHost
			open
			onClose={close}
			title="Aside (off the record)"
			description="A side question the model answers without it entering the conversation. Adopt it to make it a real turn."
			body={
				answer ? (
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<p className="text-ink-dim text-meta">Q: {text}</p>
						<p className="mt-1 whitespace-pre-wrap text-body-sm text-ink">
							{answer}
						</p>
					</div>
				) : undefined
			}
			form={
				adopted ? undefined : (
					<PickerField label={answer ? "Follow up" : "Question"}>
						<Textarea
							value={answer ? "" : text}
							onChange={(event) => setText(event.target.value)}
							rows={3}
							placeholder="Quick question that should not become part of the history"
						/>
					</PickerField>
				)
			}
			onSubmit={adopted ? undefined : submit}
			submitLabel={answer ? "Ask again" : "Ask"}
			submitDisabled={!text.trim()}
			actions={
				answer && !adopted ? (
					<Button
						variant="secondary"
						size="sm"
						type="button"
						onClick={doAdopt}
						disabled={adopt.busy}
					>
						Adopt into conversation
					</Button>
				) : undefined
			}
			busy={ask.busy || adopt.busy}
			result={adopt.result ?? ask.result}
		/>
	);
};

export const CompactView: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const command = useSessionCommand(sessionId);
	const [startedAt] = useState(() => Date.now());
	// biome-ignore lint/correctness/useExhaustiveDependencies: fire once on open
	useEffect(() => {
		void command.run("compact", "");
	}, []);
	// Completion comes from the canonical stream, not from the command
	// receipt: the owner answers "compacting" immediately and the compaction
	// record lands in the transcript when the pass actually settles.
	const settled = canonical.transcript.records.find(
		(record): record is Extract<typeof record, { kind: "compaction" }> =>
			record.kind === "compaction" && record.ts >= startedAt,
	);
	const state =
		command.result?.tone === "error"
			? "error"
			: settled
				? "complete"
				: "pending";
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Compact context"
			description="Summarises older history so the next request is smaller."
			busy={state === "pending" && !command.busy}
			result={
				state === "complete" && settled
					? { tone: "success", text: settled.text }
					: (command.result ?? null)
			}
			body={
				state === "pending" ? (
					<p className="text-body-sm text-ink-muted">
						{command.result?.text ?? "Asking the owner to compact"}
					</p>
				) : undefined
			}
		/>
	);
};

export const CredentialPicker: FC<PickerContext> = ({ sessionId, onClose }) => {
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const [confirmForget, setConfirmForget] = useState(false);
	const op = useOperation();
	const list = useQuery({
		queryKey: ["desktop", "credentials", sessionId],
		queryFn: () =>
			desktopResult<{ data: { ok: boolean; credentials: string[] } }>({
				op: "sessions.credential",
				sessionId,
				action: "list",
			}),
	});
	const options = useMemo<PickerOption[]>(
		() =>
			(list.data?.data.credentials ?? []).map((name) => ({
				value: name,
				label: name,
				meta: "stored",
				current: name === key,
			})),
		[list.data, key],
	);
	const store = useCallback(async () => {
		if (!key.trim() || !value) return;
		await op.perform(
			() =>
				desktopResult<{ data: Record<string, unknown> }>({
					op: "sessions.credential",
					sessionId,
					action: "store",
					key: key.trim(),
					value,
				}),
			() => ({
				tone: "success",
				text: `Stored ${key.trim()}. The value was not echoed.`,
			}),
			"The credential was not stored",
		);
		// The secret leaves renderer memory as soon as the backend has it.
		setValue("");
		await list.refetch();
	}, [op, sessionId, key, value, list]);
	const forget = useCallback(async () => {
		if (!key.trim() || !confirmForget) return;
		await op.perform(
			() =>
				desktopResult<{ data: Record<string, unknown> }>({
					op: "sessions.credential",
					sessionId,
					action: "forget",
					key: key.trim(),
					confirmed: true,
				}),
			() => ({ tone: "success", text: `Forgot ${key.trim()}.` }),
			"The credential was not removed",
		);
		setConfirmForget(false);
		await list.refetch();
	}, [op, sessionId, key, confirmForget, list]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Credential"
			description="Stores a secret for this session's tools by name. The value never appears in the composer, the transcript, or the command receipt."
			options={options}
			loading={list.isLoading}
			emptyText="No credentials stored yet."
			onPick={(picked) => setKey(picked)}
			form={
				<div className="flex flex-col gap-3">
					<PickerField label="Name">
						<Input
							value={key}
							onChange={(event) => setKey(event.target.value)}
							placeholder="MY_API_KEY"
							autoComplete="off"
						/>
					</PickerField>
					<PickerField label="Value" hint="Masked. Cleared after storing.">
						<Input
							type="password"
							value={value}
							onChange={(event) => setValue(event.target.value)}
							autoComplete="new-password"
						/>
					</PickerField>
					{options.some((option) => option.value === key.trim()) && (
						<PickerCheck
							checked={confirmForget}
							onCheckedChange={setConfirmForget}
							tone="ink"
						>
							Forget {key.trim()} from this session
						</PickerCheck>
					)}
				</div>
			}
			onSubmit={store}
			submitLabel="Store"
			submitDisabled={!key.trim() || !value}
			actions={
				confirmForget ? (
					<Button
						variant="danger"
						size="sm"
						type="button"
						onClick={forget}
						disabled={op.busy}
					>
						Forget
					</Button>
				) : undefined
			}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// ------------------------------------------------------------ auth flows

export const LoginPicker: FC<PickerContext> = ({ onClose, action }) => {
	const navigate = useNavigate();
	const providers = useDesktopProviders(true);
	const options = useMemo<PickerOption[]>(
		() =>
			(providers.data ?? []).map((provider: DesktopProvider) => ({
				value: provider.id,
				label: provider.name,
				description: provider.auth_methods
					.map((method) => method.label)
					.join(", "),
				meta: provider.configured
					? `${provider.stored_credentials} stored`
					: undefined,
				current: provider.configured,
				keywords: provider.search_aliases,
				group: provider.configured ? "Signed in" : "Available",
			})),
		[providers.data],
	);
	// `/login <provider>` opens that provider directly.
	useEffect(() => {
		const wanted = action.args.trim();
		if (!wanted || !providers.data) return;
		const hit = providers.data.find(
			(provider) =>
				provider.id === wanted || provider.search_aliases.includes(wanted),
		);
		if (hit) {
			navigate(
				`/settings?section=providers&provider=${encodeURIComponent(hit.id)}`,
			);
			onClose();
		}
	}, [action.args, providers.data, navigate, onClose]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Sign in to a provider"
			description="Opens the provider's sign-in methods in Settings. Browser and device flows run through the backend; keys are entered in a masked field there."
			options={options}
			loading={providers.isLoading}
			loadError={providers.isError ? errorText(providers.error) : null}
			onPick={(value) => {
				navigate(
					`/settings?section=providers&provider=${encodeURIComponent(value)}`,
				);
				onClose();
			}}
		/>
	);
};

type StoredAccount = {
	id: number;
	provider: string;
	type: string;
	identity_label: string;
	source: string;
	state: string;
};

export const LogoutPicker: FC<PickerContext> = ({ onClose, action }) => {
	const queryClient = useQueryClient();
	const accounts = useQuery({
		queryKey: desktopKeys.accounts,
		queryFn: () =>
			desktopResult<{ accounts: StoredAccount[] }>({
				op: "accounts.list",
			}).then((result) => result.accounts ?? []),
	});
	const [selected, setSelected] = useState<number | null>(null);
	const [confirmed, setConfirmed] = useState(false);
	const op = useOperation();
	const wanted = action.args.trim();
	const options = useMemo<PickerOption[]>(
		() =>
			(accounts.data ?? [])
				.filter((account) => !wanted || account.provider === wanted)
				.map((account) => ({
					value: String(account.id),
					label: `${account.provider}: ${account.identity_label}`,
					description: `${account.type}, ${account.source}`,
					meta: account.state,
					current: account.id === selected,
				})),
		[accounts.data, selected, wanted],
	);
	const submit = useCallback(async () => {
		if (selected === null || !confirmed) return;
		await op.perform(
			() =>
				desktopResult({
					op: "accounts.remove",
					accountId: selected,
					confirmed: true,
				}),
			() => ({
				tone: "success",
				text: "Signed out. Environment variables and other accounts are untouched.",
			}),
			"Sign-out failed",
		);
		setConfirmed(false);
		setSelected(null);
		await queryClient.invalidateQueries({ queryKey: desktopKeys.accounts });
		await queryClient.invalidateQueries({ queryKey: desktopKeys.providers });
	}, [op, selected, confirmed, queryClient]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Sign out"
			description="Removes one stored account. Credentials supplied through environment variables cannot be removed here and keep working."
			options={options}
			loading={accounts.isLoading}
			loadError={accounts.isError ? errorText(accounts.error) : null}
			emptyText={
				wanted ? `No stored account for ${wanted}.` : "No stored accounts."
			}
			onPick={(value) => setSelected(Number(value))}
			form={
				selected !== null ? (
					<PickerCheck
						checked={confirmed}
						onCheckedChange={setConfirmed}
						tone="ink"
					>
						Remove this account's stored credential
					</PickerCheck>
				) : undefined
			}
			onSubmit={selected !== null ? submit : undefined}
			submitLabel="Sign out"
			submitDisabled={!confirmed}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// ------------------------------------------------------------- data views

type UsageReport = Record<string, unknown> & {
	provider?: string;
	state?: string;
	age_seconds?: number;
	error?: string;
};

export const UsageView: FC<PickerContext> = ({ onClose, action }) => {
	const [live, setLive] = useState(false);
	const provider = action.args.trim() || undefined;
	const usage = useQuery({
		queryKey: ["desktop", "usage", provider ?? "", live],
		queryFn: () =>
			desktopResult<{
				reports: UsageReport[];
				source: string;
				fetched_at: number;
			}>({
				op: "usage.get",
				provider,
				live,
				refresh: live,
			}),
	});
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Provider usage"
			wide
			description={
				usage.data
					? `${usage.data.source} report, fetched ${new Date(usage.data.fetched_at).toLocaleTimeString()}.`
					: "Quota and usage as the providers report it."
			}
			toolbar={
				<Button
					variant="ghost"
					size="sm"
					type="button"
					onClick={() => setLive(true)}
				>
					{live ? "Refresh again" : "Fetch live from providers"}
				</Button>
			}
			body={
				usage.isLoading ? (
					<p className="text-ink-dim text-meta">Loading</p>
				) : usage.isError ? (
					<p className="text-body-sm text-danger">{errorText(usage.error)}</p>
				) : (usage.data?.reports.length ?? 0) === 0 ? (
					<p className="text-body-sm text-ink-muted">
						No usage reports. Sign in to a provider that publishes quota, then
						fetch live.
					</p>
				) : (
					<div className="flex flex-col gap-3">
						{usage.data?.reports.map((report, index) => (
							<div
								key={`${report.provider ?? "report"}-${String(index)}`}
								className="rounded-md border border-hairline bg-sunken px-3 py-2"
							>
								<p className="text-body-sm text-ink">
									{String(report.provider ?? "provider")}
								</p>
								<PickerKeyValue
									label="State"
									value={String(report.state ?? "unknown")}
								/>
								{typeof report.age_seconds === "number" && (
									<PickerKeyValue
										label="Age"
										value={`${Math.round(report.age_seconds)}s`}
									/>
								)}
								{report.error && (
									<PickerKeyValue
										label="Error"
										value={String(report.error)}
										mono={false}
									/>
								)}
								<pre className="mt-2 max-h-40 overflow-auto font-mono text-ink-muted text-mono-sm">
									{JSON.stringify(report, null, 2)}
								</pre>
							</div>
						))}
					</div>
				)
			}
		/>
	);
};

export const FailoversView: FC<PickerContext> = ({ sessionId, onClose }) => {
	const data = useQuery({
		queryKey: ["desktop", "failovers", sessionId],
		queryFn: () =>
			desktopResult<{
				data: {
					selected: Record<string, unknown> | null;
					effective: Record<string, unknown> | null;
					chains: Record<string, string[]>;
					scope: string;
					live_model_source: string;
				};
			}>({ op: "sessions.failovers", sessionId }),
	});
	const d = data.data?.data;
	const label = (model: Record<string, unknown> | null | undefined) =>
		model ? `${String(model.provider)}/${String(model.model_id)}` : "none";
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Failovers"
			description="The model this session selected, the one actually serving it, and the configured default fallback chains. Defaults are configuration, not live routing state."
			body={
				data.isLoading ? (
					<p className="text-ink-dim text-meta">Loading</p>
				) : data.isError ? (
					<p className="text-body-sm text-danger">{errorText(data.error)}</p>
				) : (
					<div className="flex flex-col gap-2">
						<PickerKeyValue label="Selected" value={label(d?.selected)} />
						<PickerKeyValue
							label="Effective (serving)"
							value={label(d?.effective)}
						/>
						<p className="pt-2 text-ink-dim text-meta">
							Default chains ({d?.scope})
						</p>
						{Object.keys(d?.chains ?? {}).length === 0 ? (
							<p className="text-body-sm text-ink-muted">
								No fallback chains configured.
							</p>
						) : (
							Object.entries(d?.chains ?? {}).map(([from, to]) => (
								<PickerKeyValue
									key={from}
									label={from}
									value={to.join(" -> ") || "(none)"}
								/>
							))
						)}
					</div>
				)
			}
		/>
	);
};

export const AnalyticsView: FC<PickerContext> = ({ sessionId, onClose }) => {
	const [days, setDays] = useState(7);
	const [thisSession, setThisSession] = useState(false);
	const data = useQuery({
		queryKey: ["desktop", "analytics", days, thisSession ? sessionId : ""],
		queryFn: () =>
			desktopResult<{
				data: {
					aggregate: Record<string, unknown> & {
						by_provider?: Record<string, unknown>;
					};
					daily: Record<string, unknown>[];
					daily_scope?: string;
				};
			}>({
				op: "analytics.get",
				days,
				sessionId: thisSession ? sessionId : undefined,
			}),
	});
	const agg = data.data?.data.aggregate;
	const cost =
		typeof agg?.cost_micro === "number"
			? `$${(agg.cost_micro / 1_000_000).toFixed(4)}`
			: "unknown";
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Analytics"
			wide
			description="Backend analytics store: model calls, tokens and known cost. The daily series always covers all sessions."
			toolbar={
				<div className="flex items-center gap-3">
					<PickerSegment
						label="Window"
						value={String(days) as "1" | "7" | "30"}
						onChange={(value) => setDays(Number(value))}
						options={[
							{ value: "1", label: "Today" },
							{ value: "7", label: "7 days" },
							{ value: "30", label: "30 days" },
						]}
					/>
					<PickerCheck
						checked={thisSession}
						onCheckedChange={setThisSession}
						tone="muted"
					>
						This session only (aggregate)
					</PickerCheck>
				</div>
			}
			body={
				data.isLoading ? (
					<p className="text-ink-dim text-meta">Loading</p>
				) : data.isError ? (
					<p className="text-body-sm text-danger">{errorText(data.error)}</p>
				) : (
					<div className="flex flex-col">
						<PickerKeyValue label="Calls" value={String(agg?.calls ?? 0)} />
						<PickerKeyValue
							label="Input tokens"
							value={String(agg?.input_tokens ?? 0)}
						/>
						<PickerKeyValue
							label="Output tokens"
							value={String(agg?.output_tokens ?? 0)}
						/>
						<PickerKeyValue
							label="Cache read"
							value={String(agg?.cache_read_tokens ?? 0)}
						/>
						<PickerKeyValue
							label="Known cost"
							value={`${cost} (${String(agg?.cost_known_calls ?? 0)} of ${String(agg?.calls ?? 0)} calls priced)`}
						/>
						<p className="pt-2 text-ink-dim text-meta">By provider</p>
						{Object.keys(agg?.by_provider ?? {}).length === 0 ? (
							<p className="text-body-sm text-ink-muted">
								No calls in this window.
							</p>
						) : (
							<pre className="max-h-48 overflow-auto font-mono text-ink-muted text-mono-sm">
								{JSON.stringify(agg?.by_provider, null, 2)}
							</pre>
						)}
					</div>
				)
			}
		/>
	);
};

// -------------------------------------------------------------------- help

export const HelpPalette: FC<PickerContext> = ({
	commands,
	onClose,
	dispatch,
}) => {
	const options = useMemo<PickerOption[]>(
		() =>
			commands.map((command) => ({
				value: command.name,
				label: `/${command.name}${command.aliases.length ? `  (${command.aliases.map((a) => `/${a}`).join(", ")})` : ""}`,
				description: command.description,
				meta: `${command.arguments === "none" ? "" : command.arguments === "required" ? "<arg> " : "[arg] "}${command.destination}`,
				keywords: [...command.aliases, command.destination, command.execution],
				group:
					command.execution === "owner"
						? "Session (runs on the owner)"
						: "Desktop",
			})),
		[commands],
	);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Commands"
			description={`${commands.length} commands. Pick one to run it; commands that take an argument open their picker.`}
			options={options}
			searchPlaceholder="Search commands, aliases, destinations"
			onPick={(value) => {
				onClose();
				dispatch(`/${value}`);
			}}
		/>
	);
};

// ---------------------------------------------------------------- reload

export const ReloadPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	rebind,
}) => {
	const [result, setResult] = useState<PickerResult | null>(null);
	const op = useOperation();
	const submit = useCallback(async () => {
		// Reopen the SAME identity: a fresh snapshot from the backend. Nothing
		// is resubmitted; the stream re-subscribes and replays from scratch.
		await op.perform(
			() =>
				desktopResult<{
					payload: { cold: boolean; history: DesktopHistoryPage };
				}>({
					op: "sessions.get",
					sessionId,
				}),
			(snapshot) => ({
				tone: "success",
				text: `Reopened ${sessionId}: ${snapshot.payload.cold ? "cold (no owner running)" : "live owner attached"}, ${
					snapshot.payload.history.entries.length
				} recent rows.`,
			}),
			"The conversation could not be reopened",
		);
		rebind(sessionId);
		setResult(null);
	}, [op, sessionId, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Reload this conversation"
			description="Re-reads the canonical session from the backend and re-attaches the stream. No turn is resubmitted."
			onSubmit={submit}
			submitLabel="Reload"
			busy={op.busy}
			result={op.result ?? result}
		/>
	);
};

/** Assistant text of the newest painted assistant row; used by tests/stories. */
export function latestAssistantText(page: DesktopHistoryPage) {
	for (let i = page.entries.length - 1; i >= 0; i--) {
		const entry = page.entries[i];
		if (entry.payload?.role === "assistant") return messageText(entry.payload);
	}
	return "";
}
