import { Badge, Button, Separator } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ShieldCheck, X } from "lucide-react";
import type { FC, KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import type { ApprovalView } from "../hooks/use-browser-chrome";
import {
	type ApprovalRow,
	type ResolvedRow,
	approvalScopeLabel,
} from "../model/approval-queue-model";
import {
	BrowserConsentRequest,
	type ConsentDecision,
} from "./browser-consent-request";

/**
 * The approvals dock: the request queue, the grants and the denials, in flow
 * beside the page.
 * Design: docs/design/browser-approval-ux.md 4.2 (the dock), 4.5 (what it
 * replaces), 5.2 (the ordinal); docs/design/ui-browser-tab.md 9.3 (what the user
 * sees), 9.4 (revocation as easy as granting), 9.5 (what must not be implied).
 *
 * WHY A DOCK AND NOT THE SHEET IT REPLACES, because the sheet's own docstring
 * said the opposite and the wrong claim was load-bearing: `Sheet` registers
 * suppression exactly like a dialog (`sheet.tsx:52-71`,
 * `useSuppressBrowserView(open === true, "sheet")`), so the page WAS hidden while
 * the sheet was open and the user got the paused note instead. A design decision
 * recorded against a mechanism that behaves the other way round is how the next
 * person picks a Sheet for the wrong reason. This dock is a flex sibling of the
 * content element (`browser-surface.tsx`), so the content element — and therefore
 * the rectangle the host paints the page into — NARROWS by the dock's width. No
 * suppression, no paused note, no `setViewVisible(false)`, and probe P11's
 * unresolved flash does not apply to this feature at all (§2).
 *
 * WHY `border-control` AND NOT `hairline` ON THE LEFT EDGE: this is the sole
 * boundary between the app's own approvals chrome and a live page. Remove it and
 * the two become one surface. The canvas dock's `border-hairline`
 * (`chat-content.tsx:949`) is a boundary between two app surfaces; this is not
 * the same case, and the difference is deliberate (§4.2).
 *
 * WHY IT IS A `<section>` AND NOT A DIALOG: no focus trap and no scrim, because
 * it is a list the user reads while working. Escape closes it and returns focus to
 * the Approvals control that opened it; the tray's chips and the dock's rows are
 * ordinary buttons in the same tab order.
 *
 * THE QUESTION THIS ANSWERS, in the design's own words: "which sites can an agent
 * act on as me right now?" It is answerable from the UI alone and reachable in one
 * click from the browser feature, because a DURABLE grant against a persistent jar
 * is only defensible if the granted set is visible and revocable. Visibility is
 * the answer the design gives instead of a timer.
 *
 * THREE AFFORDANCES THAT LOOK ALIKE AND ARE NOT (design 9.4):
 * - **Revoke** withdraws an approval. It does not sign the user out, and it does
 *   not delete anything the site stored.
 * - **Forget this site** withdraws the approval AND clears that origin's data.
 * - **Clear browsing data** deletes this app's stored cookies/cache and touches
 *   no approval — which is exactly why a denied origin asks again afterwards, and
 *   the copy below says so rather than letting it read as a bug.
 */

export interface BrowserApprovalsDockProps {
	open: boolean;
	rows: ApprovalRow[];
	resolved: ResolvedRow[];
	selectedEntryId: string | null;
	onSelect: (entryId: string) => void;
	busy: boolean;
	onDecide: (entryId: string, decision: ConsentDecision) => void;
	approvals: ApprovalView[];
	/** The active tab's origin, for the per-site action. Null when the tab is on
	 * `about:blank` or has no URL yet. */
	currentOrigin: string | null;
	onRevoke: (origin: string) => void;
	onRevokeAll: () => void;
	onForgetSite: (origin: string) => void;
	onClearData: (what: "cookies" | "cache" | "everything") => void;
	onClose: () => void;
	/**
	 * The evidence tag for this host's dock, as a PROP.
	 *
	 * The two hosts never co-mount, so a single tag would work — but a test that
	 * asserts "the dock opened" has to know which host it is driving, and a tag
	 * baked into this component would make that assertion impossible to aim. PR 2's
	 * pane passes its own.
	 */
	surfaceTag: string;
}

function grantedWhen(grantedAt: number): string {
	if (!grantedAt) return "";
	return new Date(grantedAt).toLocaleString();
}

export const BrowserApprovalsDock: FC<BrowserApprovalsDockProps> = ({
	open,
	rows,
	resolved,
	selectedEntryId,
	onSelect,
	busy,
	onDecide,
	approvals,
	currentOrigin,
	onRevoke,
	onRevokeAll,
	onForgetSite,
	onClearData,
	onClose,
	surfaceTag,
}) => {
	// Opening the dock moves focus to its header, so the next Tab lands inside the
	// list the user just opened rather than back at the top of the page.
	const headingRef = useRef<HTMLHeadingElement | null>(null);
	useEffect(() => {
		if (!open) return;
		headingRef.current?.focus();
	}, [open]);

	// A `deny` record is a durable NO, not a grant: the agent stops asking about
	// that origin. It is listed separately because "what may the agent reach" and
	// "what have I turned off" are two different readings of the same store, and
	// mixing them puts a refusal under a heading that says an agent may act there.
	const granted = approvals.filter((row) => row.scope !== "deny");
	const denied = approvals.filter((row) => row.scope === "deny");

	if (!open) return null;

	const closeOnEscape = (event: KeyboardEvent<HTMLElement>): void => {
		// Escape closes and returns focus to the trigger, which the surface owns —
		// this component cannot know where the control is, and a `document.activeElement`
		// hunt here would be a second implementation of the focus return.
		if (event.key !== "Escape") return;
		event.preventDefault();
		onClose();
	};

	return (
		<section
			aria-label="Approvals"
			onKeyDown={closeOnEscape}
			data-tour-tag={surfaceTag}
			className={cn(
				"flex shrink-0 flex-col gap-4 overflow-y-auto px-3 py-3",
				// The sole boundary between this chrome and a live page (§4.2).
				"border-control border-l bg-surface",
				// A fixed width rather than a drag handle: the canvas dock needs
				// resizing because its content has no natural size, while a list of rows
				// does (§4.2). 24rem at a 1280px surface and above, 20rem below it.
				"w-80 min-[1280px]:w-96",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<h2
						ref={headingRef}
						tabIndex={-1}
						className="text-heading text-ink outline-none"
						data-tour-tag="browser-approvals-dock-title"
					>
						Approvals
					</h2>
					{/* The approved count relocates here rather than sitting on the control:
					    it is not a demand on the user, where the badge's number is (§3.5). */}
					{granted.length > 0 && (
						<p className="text-meta text-ink-dim">
							{granted.length === 1
								? "1 site approved"
								: `${granted.length} sites approved`}
						</p>
					)}
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close approvals"
					onClick={onClose}
					data-tour-tag="browser-approvals-dock-close"
				>
					<X aria-hidden className="size-3.5" />
				</Button>
			</div>

			<p className="text-body-sm text-ink-muted">
				Approvals are kept per origin and are separate from cookies. Revoking
				one does not sign you out; clearing cookies does not restore a denial.
				This app's browser keeps its sign-ins across conversations and app
				restarts, and an approval here applies to every conversation — not only
				the one that asked. Requests wait for ten minutes; after that the agent
				has to ask again.
			</p>

			<section aria-label="Waiting requests">
				<h3 className="text-heading text-ink">Waiting</h3>
				{rows.length === 0 ? (
					<p className="mt-2 text-body-sm text-ink-muted">
						Nothing is waiting. An agent that needs a site appears here and in
						the band above the page.
					</p>
				) : (
					<ol
						className="mt-2 flex flex-col gap-2"
						data-tour-tag="browser-approvals-waiting"
					>
						{rows.map((row) => {
							const selected = row.request.entryId === selectedEntryId;
							return (
								<li
									key={row.request.entryId}
									className={cn(
										"rounded-sm border border-control",
										// The selected row steps up a ground and is the one expanded
										// into its card. It keeps `border-control`: the ground step
										// alone is a depth cue, and this row is the one the user is
										// deciding about.
										selected ? "bg-elevated" : "bg-surface",
									)}
								>
									<button
										type="button"
										onClick={() => onSelect(row.request.entryId)}
										aria-expanded={selected}
										data-tour-tag="browser-approvals-waiting-row"
										className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
									>
										{/* The ordinal the tray's chip and the tab's `Waiting n` chip
										    both carry (§5.2) — the same number, from the same model. */}
										<Badge
											variant="attention"
											shape="pill"
											className="h-4 min-w-4 justify-center px-1 tabular-nums"
										>
											{row.ordinal}
										</Badge>
										<span className="min-w-0 grow truncate font-mono text-mono-sm text-ink">
											{row.request.authority}
										</span>
										{row.remaining && (
											<span className="shrink-0 text-meta text-ink-dim">
												{row.remaining}
											</span>
										)}
									</button>
									{selected && (
										<div className="border-control border-t px-2 py-2">
											<BrowserConsentRequest
												request={row.request}
												remaining={row.remaining}
												busy={busy}
												onDecide={onDecide}
											/>
										</div>
									)}
								</li>
							);
						})}
					</ol>
				)}
				{resolved.length > 0 && (
					<ul className="mt-2 flex flex-col gap-0.5 text-meta text-ink-dim">
						{resolved.map((row) => (
							<li key={row.key}>
								{row.authority} —{" "}
								{row.kind === "expired"
									? "Expired — the agent has to ask again"
									: "Withdrawn by the agent"}
							</li>
						))}
					</ul>
				)}
			</section>

			<section aria-label="Approved sites">
				<h3 className="text-heading text-ink">Approved</h3>
				{granted.length === 0 ? (
					<p className="mt-2 text-body-sm text-ink-muted">
						No site is approved yet. The agent will ask the first time it needs
						one.
					</p>
				) : (
					<ul className="mt-2 flex flex-col gap-2">
						{granted.map((row) => (
							<li
								key={`${row.scope}:${row.origin}`}
								className="flex items-center justify-between gap-2 rounded-sm bg-surface px-2 py-1.5"
							>
								<div className="min-w-0">
									<p className="truncate font-mono text-mono-sm text-ink">
										{row.origin}
									</p>
									<p className="text-meta text-ink-dim">
										{approvalScopeLabel(row.scope)}
										{grantedWhen(row.grantedAt)
											? ` · ${grantedWhen(row.grantedAt)}`
											: ""}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => onRevoke(row.origin)}
									data-tour-tag="browser-revoke-approval"
								>
									Revoke
								</Button>
							</li>
						))}
					</ul>
				)}
				{granted.length > 0 && (
					<Button
						variant="ghost"
						size="sm"
						className="mt-3"
						disabled={busy}
						onClick={onRevokeAll}
						data-tour-tag="browser-revoke-all"
					>
						Revoke all site approvals
					</Button>
				)}
			</section>

			{denied.length > 0 && (
				<section aria-label="Denied sites">
					<h3 className="text-heading text-ink">Denied</h3>
					<p className="mt-1 text-body-sm text-ink-muted">
						The agent stops asking about these. Revoking a denial lets it ask
						again.
					</p>
					<ul className="mt-2 flex flex-col gap-2">
						{denied.map((row) => (
							<li
								key={`${row.scope}:${row.origin}`}
								className="flex items-center justify-between gap-2 rounded-sm bg-surface px-2 py-1.5"
							>
								<p className="min-w-0 truncate font-mono text-mono-sm text-ink">
									{row.origin}
								</p>
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => onRevoke(row.origin)}
								>
									Revoke
								</Button>
							</li>
						))}
					</ul>
				</section>
			)}

			{currentOrigin && (
				<section aria-label="Current site">
					<h3 className="text-heading text-ink">This site</h3>
					<p className="mt-1 text-body-sm text-ink-muted">
						The page the active tab is on right now.
					</p>
					<p className="mt-2 truncate font-mono text-mono-sm text-ink">
						{currentOrigin}
					</p>
					<Button
						variant="danger"
						size="sm"
						className="mt-3"
						disabled={busy}
						onClick={() => onForgetSite(currentOrigin)}
						data-tour-tag="browser-forget-site"
					>
						Forget this site
					</Button>
					<p className="mt-1 text-meta text-ink-dim">
						Revokes any approval for it and clears what this app stored for it.
						It does not touch your real browser's data.
					</p>
				</section>
			)}

			<Separator className="my-1" />

			<section aria-label="Browsing data">
				<h3 className="text-heading text-ink">Browsing data</h3>
				{/* The sentence the design asks for by name: revoking and clearing are
				    different actions with different consequences, and a user who has
				    just revoke-all'd needs to know that clearing cookies will NOT bring
				    the deny state back. */}
				<p className="mt-1 text-body-sm text-ink-muted">
					These clear what this app's browser profile stored. They do not change
					which sites the agent may reach — that is the list above.
				</p>
				<div className="mt-3 flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => onClearData("cookies")}
						data-tour-tag="browser-clear-cookies"
					>
						Clear cookies and site data
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => onClearData("cache")}
					>
						Clear cache
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => onClearData("everything")}
					>
						Clear everything
					</Button>
				</div>
				<p className="mt-2 text-meta text-ink-dim">
					Clearing cookies signs this app out of sites you logged into inside
					it. Your approvals are kept, so the agent will not have to ask again
					for a site you already approved.
				</p>
			</section>

			{/* The persistent statement (design 9.3): a standing notice in the browser
			    feature that agents can drive tabs here, so the capability is never
			    something the user has to remember. Kept in this position and with these
			    words from the sheet it replaces (§4.2). */}
			<div
				className="flex items-start gap-2 rounded-sm bg-accent-wash px-3 py-2"
				data-tour-tag="browser-agents-notice"
			>
				<ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />
				<p className="text-body-sm text-ink">
					Agents can drive tabs in this app. Each site below was approved by a
					click in this window, and none of them can be reached without one.
				</p>
			</div>
		</section>
	);
};
