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
	HelpCircle,
	List,
	LoaderCircle,
	MessageSquare,
	MoreHorizontal,
	Pause,
	Plus,
	Users,
} from "lucide-react";
import {
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";

type Props = {
	selectedConversation?: string;
	onSelectConversation: (id: string) => void;
	onStageDraft: (target?: ChatTarget, fresh?: boolean) => void;
};
const rowStyle =
	"flex h-8 min-w-0 items-center gap-1 rounded-md px-1 text-body-sm leading-5 hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

/** Resting codes that legitimately render as a plain ring; see `Status`. */
const KNOWN_RESTING = new Set(["idle", "recent"]);

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
								: // `idle`/`recent` are ordinary resting states and keep the plain
									// ring. Anything else is a code this build does not know, so it
									// must not be normalised into looking like "Recent" — a backend
									// newer than the UI would silently misreport state. An ABSENT
									// status is a different case: a locally created row carries none
									// until the next fetch, and the label already reads "Recent", so
									// treating it as unknown made the icon contradict the label.
									KNOWN_RESTING.has(code ?? "recent")
									? Circle
									: HelpCircle;
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
	// Losing the backend mid-session must not look like an empty catalogue. Once
	// the sidebar has been ready we keep its structure and last-known rows
	// mounted through a capability error, marked stale, instead of replacing the
	// whole list with a bare error paragraph the user cannot act on.
	const searchRef = useRef<HTMLInputElement>(null);
	const wasReady = useRef(false);
	if (ready) wasReady.current = true;
	const stale = Boolean(capabilities.error) && wasReady.current;
	const showList = ready || stale;
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
	const bindingName = (row: CanonicalSessionRow) =>
		row.binding?.team || row.binding?.agent || "";
	// A first send that failed after allocation but before admission leaves a real
	// but empty session. It is NOT hidden — it exists on the backend and hiding it
	// would make the list lie — but an unfinished draft still holding its id is
	// proof it never carried a message, so say so instead of showing it as an
	// ordinary untitled chat.
	const unstarted = useMemo(
		() =>
			new Set(
				Object.values(drafts)
					.filter((item) => item.sessionId)
					.map((item) => item.sessionId as string),
			),
		[drafts],
	);
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
			title={`${row.title || "Untitled chat"}${bindingName(row) ? ` (${bindingName(row)})` : ""}: ${row.status?.label ?? "Recent"}${row.attention?.unseen ? ", unread" : ""}`}
			onClick={() => onSelectConversation(row.session_id)}
		>
			<Status row={row} />
			<span className="min-w-0 flex-1 truncate">
				{row.title || "Untitled chat"}
				{/* In a flat list nothing else names the profile answering, so two
				    untitled chats on different agents were indistinguishable. Nested
				    rows already inherit the identity from their parent. */}
				{!nested && bindingName(row) && (
					<span className="ml-1 text-meta text-ink-muted">
						· {bindingName(row)}
					</span>
				)}
				{unstarted.has(row.session_id) && (
					<span className="ml-1 text-meta text-ink-muted">· Not sent yet</span>
				)}
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
			{/* A zero badge next to a group that already says it is empty is the
			    same fact twice; only a non-zero count carries information. */}
			{Boolean(count) && (
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
		// Arrow navigation was a one-way trip: nothing returned focus to the
		// search field, so a keyboard user who entered the list was stranded there.
		if (event.key === "Escape") {
			event.preventDefault();
			searchRef.current?.focus();
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
				ref={searchRef}
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
					<div role="alert" className="space-y-1 text-body-sm text-danger">
						<p>
							{capabilities.error.message}
							{stale ? " Showing the last chats loaded." : ""}
						</p>
						<button
							type="button"
							className="underline"
							onClick={() => void capabilities.refetch()}
						>
							Retry
						</button>
					</div>
				)}
				{capabilities.data && !ready && !capabilities.error && (
					<p role="alert" className="text-body-sm text-warning">
						Update the backend to use canonical chats. Existing histories are
						unchanged.
					</p>
				)}
				{showList && (
					<div className={cn("space-y-4 pb-2", stale && "opacity-60")}>
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
					</div>
				)}
			</div>
			{/* The global partition is NAVIGATION, not a peer of the entity lists.
			    Sharing one scroll flow pushed Previous below the fold at 16+ sessions
			    and its disclosure became easy to miss, so it is pinned below the
			    scrolling entity region and owns its own scroll area. */}
			{showList && (
				<div
					className={cn(
						"mt-2 max-h-[45%] shrink-0 space-y-4 overflow-y-auto border-t border-hairline pt-2",
						stale && "opacity-60",
					)}
				>
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
							{/* The three global counts read as one set, so this must honour
							    the active filter exactly as Active/Previous do. A zero badge
							    beside the "No chats yet" sentence just repeats it. */}
							{matching.length > 0 && (
								<span className="text-meta tabular-nums">
									{matching.length}
								</span>
							)}
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
									(matching.some((row) => row.active) ? (
										matching
											.filter((row) => row.active)
											.map((row) => sessionRow(row))
									) : (
										<p className="px-2 text-meta text-ink-muted">
											Nothing running right now.
										</p>
									))}
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
				</div>
			)}
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
