import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	type ChatTarget,
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { cn } from "@shared/lib/utils";
import {
	type CanonicalSessionRow,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
	Bot,
	Check,
	ChevronDown,
	ChevronRight,
	Circle,
	CircleAlert,
	Clock,
	List,
	LoaderCircle,
	MessageSquare,
	MoreHorizontal,
	Pause,
	Plus,
	Users,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type Props = {
	selectedConversation?: string;
	onSelectConversation: (id: string) => void;
	onStageDraft: (target?: ChatTarget, fresh?: boolean) => void;
};
const rowStyle =
	"flex h-8 min-w-0 items-center gap-1 rounded-md px-1 text-body-sm leading-5 hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

function Status({ row }: { row: CanonicalSessionRow }) {
	const code = row.status?.code;
	const Icon =
		code === "busy"
			? LoaderCircle
			: code === "approval" ||
					code === "answer" ||
					code === "wedged" ||
					code === "error"
				? CircleAlert
				: code === "interrupted" || code === "dormant"
					? Pause
					: code === "complete"
						? Check
						: code === "scheduled"
							? Clock
							: code === "attached"
								? MessageSquare
								: Circle;
	const ink =
		code === "busy"
			? "text-info motion-safe:animate-spin"
			: code === "error" || code === "wedged"
				? "text-danger"
				: code === "approval" || code === "answer" || code === "interrupted"
					? "text-warning"
					: code === "complete"
						? "text-success"
						: "text-ink-dim";
	return (
		<span
			className="flex size-4 shrink-0"
			title={row.status?.label ?? "Recent"}
		>
			<Icon className={cn("size-4", ink)} aria-hidden="true" />
			<span className="sr-only">{row.status?.label ?? "Recent"}</span>
		</span>
	);
}

export function ChatSidebar({
	selectedConversation,
	onSelectConversation,
	onStageDraft,
}: Props) {
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	const ready = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue",
		2,
	);
	const profiles = useProfiles(
		ready && desktopFeatureEnabled(capabilities.data, "profile_catalogue"),
	);
	const teams = useTeams(
		ready && desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
	const sessions = useCanonicalSessionsStore((s) => s.sessions);
	const fetchSessions = useCanonicalSessionsStore((s) => s.fetchSessions);
	const loading = useCanonicalSessionsStore((s) => s.loading);
	const error = useCanonicalSessionsStore((s) => s.error);
	const truncated = useCanonicalSessionsStore((s) => s.truncated);
	const activeDraftKey = useCanonicalSessionsStore((s) => s.activeDraftKey);
	const drafts = useCanonicalSessionsStore((s) => s.drafts);
	const pendingId = useCanonicalSessionsStore((s) => s.pendingSessionId);
	const [query, setQuery] = useState("");
	const [all, setAll] = useState(false);
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		try {
			return JSON.parse(
				localStorage.getItem("chat-sidebar-disclosures") ?? "{}",
			);
		} catch {
			return {};
		}
	});
	const isOpen = (key: string, initial = false) => expanded[key] ?? initial;
	const toggle = (key: string, initial = false) =>
		setExpanded((current) => ({
			...current,
			[key]: !(current[key] ?? initial),
		}));
	useEffect(() => {
		localStorage.setItem("chat-sidebar-disclosures", JSON.stringify(expanded));
	}, [expanded]);
	useEffect(() => {
		if (!ready) return;
		void fetchSessions();
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void fetchSessions();
		}, 5000);
		return () => window.clearInterval(timer);
	}, [ready, fetchSessions]);
	const matching = useMemo(
		() =>
			sessions.filter((row) =>
				`${row.title ?? ""} ${row.binding?.agent ?? ""} ${row.binding?.team ?? ""}`
					.toLocaleLowerCase()
					.includes(query.toLocaleLowerCase()),
			),
		[sessions, query],
	);
	const children = (kind: ChatTarget["kind"], name: string) =>
		matching.filter((row) =>
			kind === "team"
				? row.binding?.team === name
				: !row.binding?.team && row.binding?.agent === name,
		);
	const draft = activeDraftKey ? drafts[activeDraftKey] : undefined;
	const sessionRow = (row: CanonicalSessionRow, nested = false) => (
		<button
			key={row.session_id}
			type="button"
			data-chat-row
			data-child={nested || undefined}
			className={cn(
				rowStyle,
				"w-full text-left",
				nested && "pl-7",
				selectedConversation === row.session_id &&
					!activeDraftKey &&
					"bg-accent-wash text-ink",
				row.attention?.unseen && "font-semibold",
			)}
			aria-current={
				selectedConversation === row.session_id && !activeDraftKey
					? "page"
					: undefined
			}
			title={`${row.title || "Untitled chat"}: ${row.status?.label ?? "Recent"}${row.attention?.unseen ? ", unread" : ""}`}
			onClick={() => onSelectConversation(row.session_id)}
		>
			<Status row={row} />
			<span className="min-w-0 flex-1 truncate">
				{row.title || "Untitled chat"}
			</span>
			{pendingId === row.session_id && (
				<LoaderCircle
					className="size-4 shrink-0 motion-safe:animate-spin"
					aria-label="Opening chat"
				/>
			)}
		</button>
	);
	const entity = (kind: ChatTarget["kind"], name: string) => {
		const rows = children(kind, name);
		const key = `${kind}:${name}`;
		const open = Boolean(query) || isOpen(key);
		if (
			query &&
			!name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
			!rows.length
		)
			return null;
		const Icon = kind === "team" ? Users : Bot;
		return (
			<div key={key} data-entity>
				<div
					className={cn(
						"flex h-8 items-center gap-1 rounded-md",
						draft?.target?.kind === kind &&
							draft.target.name === name &&
							"bg-accent-wash",
					)}
				>
					<button
						type="button"
						data-disclosure
						aria-label={`${open ? "Collapse" : "Expand"} ${name} chats`}
						aria-expanded={open}
						className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-elevated"
						onClick={() => toggle(key)}
					>
						{open ? (
							<ChevronDown className="size-3.5" />
						) : (
							<ChevronRight className="size-3.5" />
						)}
					</button>
					<button
						type="button"
						data-chat-row
						data-entity-name
						className={cn(rowStyle, "flex-1 text-left")}
						onClick={() => onStageDraft({ kind, name })}
						title={`New chat with ${name}`}
					>
						<Icon className="size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate">{name}</span>
						<span className="text-meta tabular-nums text-ink-dim">
							{rows.length || ""}
						</span>
					</button>
					<button
						type="button"
						className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-elevated"
						aria-label={`Manage ${name}`}
						onClick={() =>
							navigate(`/agents?kind=${kind}&name=${encodeURIComponent(name)}`)
						}
					>
						<MoreHorizontal className="size-4" />
					</button>
				</div>
				{open && (
					<div>
						{rows.map((row) => sessionRow(row, true))}
						{!rows.length && (
							<p className="py-1 pl-7 text-meta text-ink-dim">No chats yet</p>
						)}
					</div>
				)}
			</div>
		);
	};
	const heading = (
		key: string,
		label: string,
		initial: boolean,
		count?: number,
	) => (
		<button
			type="button"
			data-chat-row
			className="flex h-7 w-full items-center gap-1 rounded-md px-1 text-body-sm font-medium text-ink-muted hover:bg-elevated"
			aria-expanded={query ? true : isOpen(key, initial)}
			onClick={() => toggle(key, initial)}
		>
			{query || isOpen(key, initial) ? (
				<ChevronDown className="size-3.5" />
			) : (
				<ChevronRight className="size-3.5" />
			)}
			<span className="flex-1 text-left">{label}</span>
			{count !== undefined && (
				<span className="text-meta tabular-nums">{count}</span>
			)}
		</button>
	);
	const keyDown = (event: KeyboardEvent<HTMLElement>) => {
		const target = event.target as HTMLElement;
		if (target.tagName === "INPUT") {
			if (event.key === "Escape") {
				setQuery("");
				target.blur();
			}
			return;
		}
		const rows = [
			...event.currentTarget.querySelectorAll<HTMLElement>("[data-chat-row]"),
		];
		const index = rows.indexOf(target);
		const next =
			event.key === "ArrowDown"
				? Math.min(rows.length - 1, index + 1)
				: event.key === "ArrowUp"
					? Math.max(0, index - 1)
					: event.key === "Home"
						? 0
						: event.key === "End"
							? rows.length - 1
							: -1;
		if (next >= 0) {
			event.preventDefault();
			rows[next]?.focus();
			return;
		}
		const group = target.closest("[data-entity]");
		const disclosure =
			group?.querySelector<HTMLButtonElement>("[data-disclosure]");
		if (event.key === "ArrowRight" && disclosure) {
			event.preventDefault();
			if (disclosure.getAttribute("aria-expanded") === "false")
				disclosure.click();
			else group?.querySelector<HTMLElement>("[data-child]")?.focus();
		}
		if (event.key === "ArrowLeft" && disclosure) {
			event.preventDefault();
			if (target.hasAttribute("data-child"))
				group?.querySelector<HTMLElement>("[data-entity-name]")?.focus();
			else if (disclosure.getAttribute("aria-expanded") === "true")
				disclosure.click();
		}
	};
	return (
		<nav
			aria-label="Chats"
			className="flex h-full min-h-0 flex-col bg-surface p-2 text-ink"
			onKeyDown={keyDown}
		>
			<div className="flex h-8 items-center justify-between px-1">
				<h2 className="text-body-sm font-medium">Chats</h2>
				<button
					type="button"
					className="rounded-md p-1 hover:bg-elevated"
					aria-label="New chat"
					disabled={!ready}
					onClick={() => onStageDraft(undefined, true)}
				>
					<Plus className="size-4" />
				</button>
			</div>
			<input
				aria-label="Search chats and agents"
				placeholder="Search chats and agents"
				className="my-2 h-8 w-full rounded-md border border-control bg-surface px-2 text-body-sm"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
			/>
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-1">
				{capabilities.isLoading && (
					<p aria-live="polite" className="text-meta text-ink-muted">
						Connecting to chats…
					</p>
				)}
				{capabilities.error && (
					<p role="alert" className="text-body-sm text-danger">
						{capabilities.error.message}
					</p>
				)}
				{capabilities.data && !ready && (
					<p role="alert" className="text-body-sm text-warning">
						Update the backend to use canonical chats. Existing histories are
						unchanged.
					</p>
				)}
				{ready && (
					<>
						<section>
							{heading("agents", "Agents", true)}
							{(query || isOpen("agents", true)) && (
								<>
									{profiles.isLoading && (
										<p aria-live="polite" className="text-meta text-ink-muted">
											Loading agents…
										</p>
									)}
									{profiles.data?.map((profile) =>
										entity("agent", profile.name),
									)}
									<button
										type="button"
										className={cn(rowStyle, "w-full text-ink-muted")}
										onClick={() => navigate("/agents?create=agent")}
									>
										<Plus className="size-4" />
										Create agent
									</button>
								</>
							)}
						</section>
						<section>
							{heading("teams", "Teams", true)}
							{(query || isOpen("teams", true)) && (
								<>
									{teams.data?.map((team) => entity("team", team.name))}
									<button
										type="button"
										className={cn(rowStyle, "w-full text-ink-muted")}
										onClick={() => navigate("/agents?create=team")}
									>
										<Plus className="size-4" />
										Create team
									</button>
								</>
							)}
						</section>
						<section>
							<button
								type="button"
								data-chat-row
								className={cn(rowStyle, "w-full", all && "bg-accent-wash")}
								aria-pressed={all}
								onClick={() => setAll((value) => !value)}
							>
								<List className="size-4" />
								<span className="flex-1 text-left">All chats</span>
								<span className="text-meta tabular-nums">
									{sessions.length}
								</span>
							</button>
						</section>
						{all ? (
							<section>{matching.map((row) => sessionRow(row))}</section>
						) : (
							<>
								<section>
									{heading(
										"active",
										"Active chats",
										true,
										matching.filter((row) => row.active).length,
									)}
									{(query || isOpen("active", true)) &&
										matching
											.filter((row) => row.active)
											.map((row) => sessionRow(row))}
								</section>
								<section>
									{heading(
										"previous",
										"Previous chats",
										false,
										matching.filter((row) => !row.active).length,
									)}
									{(query || isOpen("previous")) &&
										matching
											.filter((row) => !row.active)
											.map((row) => sessionRow(row))}
								</section>
							</>
						)}
						{!sessions.length && !loading && (
							<p className="text-meta text-ink-muted">
								No chats yet. Choose an agent, team or New chat.
							</p>
						)}
						{truncated && (
							<p className="text-meta text-ink-muted">
								Showing up to 500 chats. Older chats remain available in the
								terminal.
							</p>
						)}
					</>
				)}
			</div>
			{(error || profiles.error || teams.error) && (
				<div role="alert" className="pt-2 text-meta text-danger">
					<p>{error || profiles.error?.message || teams.error?.message}</p>
					<button
						type="button"
						className="mt-1 underline"
						onClick={() => {
							void fetchSessions();
							void profiles.refetch();
							void teams.refetch();
						}}
					>
						Retry refresh
					</button>
				</div>
			)}
		</nav>
	);
}
