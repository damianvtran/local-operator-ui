/**
 * The detail page's linked-sessions block: one row per linked session, the
 * unlink and per-row message controls, the quick-send strip, and the pickers
 * that link another session or start a new one.
 *
 * WHAT A ROW SAYS, from the composed view's own fields (never re-derived
 * here): the title (or the session id when no title was ever persisted, in the
 * machine voice), the runtime state as a chip, the busy mark beside a live
 * row, and the subagent / todo counts. `null` counts are UNKNOWN and render
 * nothing — `project-model.ts` states the rule; rendering them as 0 is the
 * lie the store's own docstring refuses.
 *
 * CLICK OPENS THE CONVERSATION the way the schedules page opens one: through
 * the canonical store's `openSession` and THEN the route, so the pane's own
 * rules about the URL run for this click too. A row whose session directory is
 * GONE (`exists: false`) is not a link into anything — there is no
 * conversation to open — so it renders as a static row; the unlink control
 * beside it is the way it is cleared.
 *
 * THE ROW'S MESSAGE ACTION AND THE QUICK-SEND STRIP ARE ONE MECHANISM: the
 * button writes the strip's target and hands it the keyboard (the focus tick),
 * and the strip is where the message is typed and sent. Two send affordances
 * would be two ways to do one thing; this is one composer with two doors, and
 * the selection lives here because both doors write it.
 *
 * THE LINK PICKER REUSES THE SESSION CATALOGUE the sidebar shows (`sessions`
 * from the canonical store) rather than a second listing: the picker offers
 * exactly the conversations this window is prepared to open, already current
 * because the store is the same object the sidebar renders. Sessions already
 * linked to this project are excluded from the options — offering a no-op row
 * would be a control that does nothing.
 */

import {
	BaseDialog,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Badge, Button, Label, SearchableSelect } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { Link2, MessageSquare, MessageSquarePlus, Unlink } from "lucide-react";
import type { FC } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopLinkedSession } from "../../../../../shared/desktop-control-contract";
import {
	defaultSendTarget,
	linkStateMeta,
	subagentChipLabel,
	todoChipLabel,
} from "../project-model";
import { ProjectQuickSend } from "./project-quick-send";

type ProjectLinksProps = {
	projectKey: string;
	links: DesktopLinkedSession[];
	busy: boolean;
	onUnlink: (sessionId: string) => void;
	onLink: (sessionId: string) => void;
	/**
	 * Sends one message through the chat's own admission path; resolves `true`
	 * when it is on its way. The detail screen owns the toasts, so the strip
	 * and its doors stay about the act. `attachments` is the strip's own list
	 * (pasted images as data URLs), carried through the seam into the body's
	 * image half and kept as the payload identity the draft row compares.
	 */
	onQuickSend: (
		sessionId: string,
		text: string,
		mode: "prompt" | "steer",
		attachments: string[],
	) => Promise<boolean>;
	/** Opens the start-session dialog (owned by the detail screen). */
	onStartSession: () => void;
};

export const ProjectLinks: FC<ProjectLinksProps> = ({
	links,
	busy,
	onUnlink,
	onLink,
	onQuickSend,
	onStartSession,
}) => {
	const navigate = useNavigate();
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const [pickerOpen, setPickerOpen] = useState(false);
	/*
	 * The quick-send target and the focus tick live HERE because two controls
	 * write them (the strip's select and each row's message button) and the
	 * strip reads both. The tick, not a ref: the strip may mount just after the
	 * press, and the effect it drives is the mount's own — see the strip's
	 * note.
	 */
	const [sendTarget, setSendTarget] = useState<string | null>(null);
	const [focusTick, setFocusTick] = useState(0);
	/*
	 * A chosen target that is still sendable wins; anything else falls back to
	 * the default rule. Re-derived per render rather than stored, so an unlink
	 * cannot leave the strip aimed at a session the project no longer links.
	 */
	const resolvedTarget =
		sendTarget &&
		links.some((link) => link.session_id === sendTarget && link.exists)
			? sendTarget
			: defaultSendTarget(links);

	const options = useMemo(() => {
		const linked = new Set(links.map((link) => link.session_id));
		return sessions
			.filter((row) => !linked.has(row.session_id))
			.map((row) => ({
				id: row.session_id,
				name: row.title || row.session_id,
				description: row.cwd ?? undefined,
			}));
	}, [sessions, links]);

	const openConversation = (sessionId: string) => {
		void useCanonicalSessionsStore
			.getState()
			.openSession(sessionId)
			.then((opened) => {
				if (opened) navigate(`/chat/${sessionId}`);
			});
	};

	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-title text-ink">Linked sessions</h2>
				<div className="flex items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						disabled={busy}
						onClick={onStartSession}
						data-tour-tag="project-start-session"
					>
						<MessageSquarePlus />
						New session
					</Button>
					<Button
						variant="secondary"
						size="sm"
						disabled={busy}
						onClick={() => setPickerOpen(true)}
						data-tour-tag="project-link-session"
					>
						<Link2 />
						Link session
					</Button>
				</div>
			</div>

			{links.length === 0 ? (
				<p className="text-body-sm text-ink-muted">
					No sessions linked yet. Link the conversations that are working on
					this project so its progress stays with them.
				</p>
			) : (
				/*
				 * BORDERLESS GROUP (main's card restyle, #608): the `surface` ground
				 * stays at the stepped radius and the border retires - a card drawn
				 * around a list is what the three surfaces' pass removed. The 6px
				 * hover pill on the rows that open something is this branch's.
				 */
				<ul className="flex flex-col divide-y divide-hairline rounded-md bg-surface">
					{links.map((link) => {
						const meta = linkStateMeta(link);
						const subagents = subagentChipLabel(link.subagents);
						const todos = todoChipLabel(link.todos);
						const title = link.title || link.session_id;
						const clickable = link.exists;
						return (
							<li
								key={link.session_id}
								className={cn(
									"flex items-center gap-2 rounded-sm px-2 py-2",
									clickable && "hover:bg-row-hover",
								)}
							>
								<button
									type="button"
									disabled={!clickable}
									onClick={() => {
										if (clickable) openConversation(link.session_id);
									}}
									className={cn(
										"flex min-w-0 flex-1 items-center gap-2 text-left",
										clickable ? "cursor-pointer" : "cursor-default opacity-100",
									)}
								>
									<span
										className={cn(
											"min-w-0 truncate text-body-sm",
											link.title
												? "text-ink"
												: "font-mono text-mono-sm text-ink-muted",
										)}
									>
										{title}
									</span>
								</button>
								{link.runtime?.busy === true && (
									<span className="shrink-0 text-meta text-ink-muted">
										busy
									</span>
								)}
								{subagents && (
									<span className="shrink-0 text-meta text-ink-muted">
										{subagents}
									</span>
								)}
								{todos && (
									<span className="shrink-0 text-meta text-ink-muted">
										{todos}
									</span>
								)}
								<Badge variant={meta.variant}>{meta.label}</Badge>
								{clickable && (
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={busy}
										aria-label={`Message ${title}`}
										title={`Message ${title}`}
										onClick={() => {
											setSendTarget(link.session_id);
											setFocusTick((tick) => tick + 1);
										}}
									>
										<MessageSquare />
									</Button>
								)}
								<Button
									variant="ghost"
									size="icon-sm"
									disabled={busy}
									aria-label={`Unlink ${title}`}
									onClick={() => onUnlink(link.session_id)}
								>
									<Unlink />
								</Button>
							</li>
						);
					})}
				</ul>
			)}

			{links.length > 0 && (
				<ProjectQuickSend
					links={links}
					target={resolvedTarget}
					onTargetChange={setSendTarget}
					onSend={onQuickSend}
					focusTick={focusTick}
				/>
			)}

			<BaseDialog
				open={pickerOpen}
				onClose={() => setPickerOpen(false)}
				title="Link a session"
				maxWidth="sm"
				dataTourTag="project-link-dialog"
				actions={
					<SecondaryButton onClick={() => setPickerOpen(false)}>
						Close
					</SecondaryButton>
				}
			>
				<div className="flex flex-col gap-2 px-1 py-1">
					<Label>Session</Label>
					<SearchableSelect
						showLabel={false}
						ariaLabel="Search sessions"
						busyLabel="Loading sessions"
						placeholder="Search conversations"
						options={options}
						selected={null}
						onSelect={(option) => {
							setPickerOpen(false);
							onLink(option.id);
						}}
					/>
					<p className="text-meta text-ink-muted">
						Conversations already linked to this project are not listed.
					</p>
				</div>
			</BaseDialog>
		</section>
	);
};
