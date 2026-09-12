import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	type ChatTarget,
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { useChatSearch } from "@shared/api/local-operator/session-search";
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
	MessageSquarePlus,
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
import { hitsAnswerQuery, searchChats } from "../chat-search";

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
	// Search is the backend's (`sessions.search`, negotiated as `session_search`),
	// not a filter over titles: a conversation is remembered by what was SAID in
	// it, and the sidebar only holds titles. The backend's answer is used only
	// when it is the answer to what is in the box RIGHT NOW (see
	// `hitsAnswerQuery`), and the local title/agent/team match is applied on top
	// either way — `searchChats` ORs them — so a query the backend cannot answer
	// (an older backend, a failed request) still finds chats by name and label
	// instead of finding nothing.
	const searchSupported = desktopFeatureEnabled(
		capabilities.data,
		"session_search",
	);
	const search = useChatSearch(query, ready && searchSupported);
	const { rows: matching, conversationMatches } = useMemo(
		() =>
			searchChats(
				sessions,
				query,
				hitsAnswerQuery(search.data, query) ? search.data.sessions : null,
			),
		[sessions, query, search.data],
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
			title={`${row.title || "Untitled chat"}${bindingName(row) ? ` (${bindingName(row)})` : ""}: ${row.status?.label ?? "Recent"}${row.attention?.unseen ? ", unread" : ""}${conversationMatches.has(row.session_id) ? ", matched in conversation" : ""}`}
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
				{/* Says WHY a row is in a filtered list when its visible text does
				    not contain the query. Without it the filter reads as returning an
				    arbitrary row, which is worse than no filter: the user cannot tell
				    a real match from a bug. Same `·` idiom as the qualifiers above
				    rather than a new glyph, and the same wording the row's own `title`
				    uses, so the tooltip and the visible mark cannot drift. */}
				{conversationMatches.has(row.session_id) && (
					// The CLI's marker, and deliberately the same mark: `”` reads as
					// "something was said here", it costs one glyph rather than the
					// words (which the row's width truncated to `in conversa…`, i.e.
					// said nothing), and one product showing one meaning for one fact
					// is worth more than either surface's private spelling. The full
					// sentence rides on the row's own `title` and in the accessible
					// name below, so the mark is never the ONLY account of itself.
					<span className="ml-1 text-ink-dim">
						”<span className="sr-only">matched in conversation</span>
					</span>
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
						"group flex h-8 items-center gap-1 rounded-md",
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
					{/* Clicking the name has always staged a draft, but nothing on the
					    row said so, so the primary action of the whole sidebar was
					    invisible and went unused. The glyph is the label for that
					    existing action, NOT a second control: putting it inside the same
					    button keeps one click target for one outcome, adds no tab stop,
					    and leaves the arrow-key traversal in `keyDown` untouched. Its
					    slot is reserved at rest rather than inserted on hover, because a
					    row that reflows under the pointer is worse than no affordance —
					    only `opacity` changes, which is also what keeps this inside
					    § Motion's rule that nothing lifts, scales or translates on hover.
					    `group-focus-within` is what makes it reachable without a mouse. */}
					<button
						type="button"
						data-chat-row
						data-entity-name
						className={cn(rowStyle, "flex-1 text-left")}
						onClick={() => onStageDraft({ kind, name })}
						// The visible label is the bare name, which says who but not what
						// pressing it does. The accessible name states the action and still
						// contains the visible label, so voice control keeps working.
						//
						// `title` carries the same string deliberately: it is the only
						// affordance a SIGHTED pointer user gets for a name the row
						// truncates, and it is what names the action for someone who is
						// not using AT. It duplicates the accessible name for screen
						// reader users, which is redundant but not announced twice —
						// `aria-label` wins and `title` is ignored as a naming source.
						aria-label={`New chat with ${name}`}
						title={`New chat with ${name}`}
					>
						<Icon className="size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate">{name}</span>
						<MessageSquarePlus
							className={cn(
								// `ink`, not `ink-muted`: this glyph names what the row
								// DOES, and it sits 2px from the always-visible `...`. At
								// equal weight the secondary control was the louder mark of
								// the two, so the eye landed on "manage" first.
								"size-4 shrink-0 text-ink opacity-0",
								// The duration governs the transition INTO the current
								// state, so the resting value is the fade-OUT and the
								// hovered value is the fade-in: quick to appear, gentler to
								// leave, which is what stops it reading as a pop.
								"transition-opacity duration-base ease-out-quart",
								"group-hover:opacity-100 group-hover:duration-fast",
								"group-focus-within:opacity-100 group-focus-within:duration-fast",
							)}
							aria-hidden="true"
						/>
						{/* A reserved column, not just `tabular-nums`. Digit width alone
						    still lets an absent or two-digit count shift everything left
						    of it, which moved the glyph across 14px between rows and made
						    the reveal jitter as the pointer ran down the list. */}
						<span className="min-w-4 shrink-0 text-right text-meta tabular-nums text-ink-dim">
							{rows.length || ""}
						</span>
					</button>
					<button
						type="button"
						// Stepped down from `ink` so the row's own action outranks it.
						// This is the secondary control on the row and it is visible at
						// rest, which was enough to make it dominate the reveal.
						className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-dim hover:bg-elevated hover:text-ink-muted"
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
			{/* The header once carried a 16px `Plus` for the same action the "New
			    chat" row below now names in words. Two controls firing one action at
			    two sizes in one panel reads as an accident, and the small one was the
			    reported defect — it was the only entry point and users did not find
			    it. The named row replaces it rather than joining it. */}
			<div className="flex h-8 items-center px-1">
				<h2 className="text-body-sm font-medium">Chats</h2>
			</div>
			<input
				ref={searchRef}
				aria-label="Search chats and agents"
				placeholder="Search chats and agents"
				className="my-2 h-8 w-full rounded-md border border-control bg-surface px-2 text-body-sm"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
			/>
			{/* Says what the search actually LOOKED AT, and only while a query is
			    active, because that is the moment the claim is true and relevant.
			    Both cases are degradations the user cannot see otherwise: the list
			    still narrows, it just narrows by less than the box promises, and a
			    search that quietly stops looking inside conversations is
			    indistinguishable from one that found nothing there. */}
			{query && ready && !searchSupported && (
				<p className="pb-2 text-meta text-ink-muted">
					Searching chat names only. Update the backend to search inside
					conversations.
				</p>
			)}
			{query && searchSupported && search.isError && (
				<p className="pb-2 text-meta text-ink-muted">
					Conversation search is unavailable, so these are name matches.{" "}
					<button
						type="button"
						className="underline"
						onClick={() => void search.refetch()}
					>
						Retry
					</button>
				</p>
			)}
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
						{/* Sits inside the All chats section so it holds the same place
						    — under the toggle, above whatever the toggle reveals — in
						    both the flat list and the Active/Previous split. Deliberately
						    a plain `rowStyle` row and not a `heading()`: a chevron would
						    promise something to expand. Disabled tracks `ready` because
						    staging a draft needs the session catalogue that gate covers.

						    It is the only ACTION in a run of three label-ish rows
						    (All chats / New chat / Active chats) that shared its type
						    step and left inset, so at rest it read as the third heading
						    rather than as a control. A `border-control` edge is the
						    system's existing "outline control" idiom (contrast-contract
						    §CONTROLS), so it reads as a control at rest without spending
						    a fourth accent and without a resting `bg-elevated`, which
						    would have swallowed `rowStyle`'s `hover:bg-elevated` and left
						    the row with no hover feedback at all. The margin breaks the
						    three rows out of one visual block. `MessageSquarePlus` rather than
						    `Plus` because `Plus` means "open a creation form" twice over
						    in this panel (Create agent, Create team), while this stages a
						    chat; it also matches the glyph the entity rows reveal for the
						    same outcome, so one action now has one icon. */}
						<button
							type="button"
							// DEFENSIVE, not currently reachable — and the earlier comment
							// here named the stale state as the case that makes it live,
							// which measurement disproved. `stale` requires
							// `capabilities.error`, and react-query retains the last good
							// `data` across a failed refetch (`retry: false`, no reset), so
							// `ready` is still true there and this row renders enabled.
							// With `showList = ready || stale` there is no state that
							// renders the row while `ready` is false.
							//
							// Kept because the pairing is what makes decoupling them safe:
							// staging a draft needs the session catalogue, so if `showList`
							// ever admits a not-ready state the row must disable rather
							// than stage against an absent catalogue. Only a focusable row
							// is a stop in the arrow ring — `keyDown` moves by calling
							// `.focus()` on the next `[data-chat-row]` and a disabled
							// button silently refuses it — so the attribute has to drop out
							// in exactly the states the button is disabled, or a keyboard
							// user strands here.
							data-chat-row={ready || undefined}
							className={cn(
								rowStyle,
								"mb-1 w-full border border-control disabled:text-ink-disabled disabled:hover:bg-transparent",
								// Marked current on the same terms as an entity row: an
								// untargeted draft is the one THIS row stages. A draft
								// carrying a target belongs to its entity row, which is
								// already highlighting itself, and two rows claiming the
								// same draft would misreport where the user is.
								Boolean(activeDraftKey) && !draft?.target && "bg-accent-wash",
							)}
							aria-current={
								activeDraftKey && !draft?.target ? "page" : undefined
							}
							disabled={!ready}
							onClick={() => onStageDraft(undefined, true)}
						>
							<MessageSquarePlus className="size-4" />
							<span className="flex-1 text-left">New chat</span>
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
