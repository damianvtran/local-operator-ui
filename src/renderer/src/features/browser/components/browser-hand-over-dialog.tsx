import { BaseDialog } from "@shared/components/common/base-dialog";
import {
	Button,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type { BrowserTabView } from "../hooks/use-browser-chrome";

/**
 * Handing a tab the USER opened to a session. Design: docs/design/ui-browser-tab.md
 * 6.3 (the R2 superset), 9.3 (two independent gates).
 *
 * WHY THIS IS THE ONE PLACE RENDERER AUTHORITY MOVES, and why it is safe: the
 * renderer never receives a surface nonce. It names a TAB and a SESSION, main
 * mints the capability, and the nonce reaches the session through `tabs` (design
 * 11.7). So the renderer can hand over a tab it is showing without ever holding
 * the thing that drives it — which is what keeps "a tab the user opened is not
 * reachable by guessing" true even though the page can name tabs.
 *
 * WHY IT NAMES A SESSION AND NOT "THE AGENT": handing a tab to the wrong session
 * is not recoverable by the user (the session they did not mean now holds a
 * capability, and revocation is a separate click). The picker therefore lists the
 * live sessions the way the app already speaks them (`sessions.list` through the
 * desktop transport, the same vocabulary the chat pickers use).
 *
 * THE COPY SAYS THE TWO-GATES FACT (design 6.3): handing over a tab that sits on
 * an unapproved origin lets the agent SEE the tab and not navigate it. A user who
 * handed a tab over and then watched the agent fail with `origin_not_allowed`
 * would reasonably read it as broken, so the sentence is here rather than in a
 * doc.
 */

export interface BrowserHandOverDialogProps {
	open: boolean;
	tab: BrowserTabView | null;
	busy: boolean;
	onClose: () => void;
	onConfirm: (tabId: number, sessionId: string) => void;
}

export const BrowserHandOverDialog: FC<BrowserHandOverDialogProps> = ({
	open,
	tab,
	busy,
	onClose,
	onConfirm,
}) => {
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const fetchSessions = useCanonicalSessionsStore(
		(state) => state.fetchSessions,
	);
	const [sessionId, setSessionId] = useState("");

	// Loaded when the dialog opens rather than at mount: the list is only needed
	// here, and a route that fetched the session catalogue on every visit would
	// make the browser feature depend on the backend being up.
	useEffect(() => {
		if (open) void fetchSessions();
	}, [open, fetchSessions]);

	useEffect(() => {
		if (!open) setSessionId("");
	}, [open]);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title="Let an agent use this tab"
			dataTourTag="browser-hand-over-dialog"
			actions={
				<>
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="sm"
						disabled={busy || !sessionId || !tab}
						onClick={() => {
							if (tab && sessionId) onConfirm(tab.tabId, sessionId);
						}}
						data-tour-tag="browser-hand-over-confirm"
					>
						Hand over
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-3">
				<p className="text-body text-ink-muted">
					The agent can use this tab — and only reach sites you have approved.
					Both gates apply, so handing this tab over does not approve the site
					it is showing.
				</p>
				{tab && (
					<p className="truncate font-mono text-mono-sm text-ink-dim">
						{tab.title}
					</p>
				)}
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="browser-hand-over-session">Session</Label>
					<Select value={sessionId} onValueChange={setSessionId}>
						<SelectTrigger
							id="browser-hand-over-session"
							data-tour-tag="browser-hand-over-session"
						>
							<SelectValue placeholder="Choose a session" />
						</SelectTrigger>
						<SelectContent>
							{sessions.map((session) => (
								<SelectItem key={session.session_id} value={session.session_id}>
									{session.title || session.session_id}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{sessions.length === 0 && (
						<p className="text-meta text-ink-dim">
							No session is available yet. Start one in chat, then hand the tab
							over.
						</p>
					)}
				</div>
			</div>
		</BaseDialog>
	);
};
