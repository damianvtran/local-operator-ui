import { Badge, Button, Separator } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { ShieldCheck, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef } from "react";
import type { ApprovalView } from "../hooks/use-browser-chrome";
import {
	type ApprovalRow,
	type ResolvedRow,
	approvalScopeLabel,
} from "../model/approval-queue-model";
import { requesterLabel } from "./browser-consent-request";
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
	/** The session list, so a waiting row can name the conversation that is asking
	 * and not just the site (UX round 1, U2). */
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	useEffect(() => {
		if (!open) return;
		headingRef.current?.focus();
	}, [open]);

	// Escape closes the dock, BOUND ON THE DOCUMENT rather than on the section (UX
	// round 1, U1). The section handler looked equivalent and was not: deciding on
	// the selected request unmounts the row whose button was pressed, the browser
	// then moves focus to `<body>`, and a handler on the section never sees the key
	// again — so the §4.2 contract ("Escape closes it and returns focus to the
	// trigger") stopped holding at exactly the moment the user finished. The dock is
	// not a dialog and has no focus trap, which is precisely why the binding cannot
	// be scoped to it.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			/*
			 * A NEARER CONTROL'S ESCAPE WINS (review round 2, F3). The URL field abandons
			 * its edit on Escape without stopping propagation, so with the dock open one
			 * keypress both reverted the text and closed the panel: the page widened and
			 * focus left the field for a key the user aimed at the input. Anything that
			 * preventDefaults has already handled it; the dock's own heading does not, so
			 * §4.2's contract is unchanged.
			 */
			if (event.defaultPrevented) return;
			event.preventDefault();
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	/*
	 * AND FOCUS COMES BACK when a decision removes the control it was on. Same
	 * cause as the Escape binding: the acted-on row unmounts, focus falls to
	 * `<body>`, and a screen reader user loses the place they were working in. The
	 * heading is the one element this component owns that is always there.
	 *
	 * It fires on a row LEAVING, not on every projection push (that would steal focus
	 * from wherever the user happens to be, which is the failure mode this exists to
	 * avoid), and only when focus is genuinely unowned.
	 */
	const rowCount = rows.length;
	const previousRowCount = useRef(rowCount);
	useEffect(() => {
		const shrank = rowCount < previousRowCount.current;
		previousRowCount.current = rowCount;
		if (!open || !shrank) return;
		if (document.activeElement === document.body) headingRef.current?.focus();
	}, [open, rowCount]);

	// A `deny` record is a durable NO, not a grant: the agent stops asking about
	// that origin. It is listed separately because "what may the agent reach" and
	// "what have I turned off" are two different readings of the same store, and
	// mixing them puts a refusal under a heading that says an agent may act there.
	const granted = approvals.filter((row) => row.scope !== "deny");
	const denied = approvals.filter((row) => row.scope === "deny");

	if (!open) return null;

	return (
		<section
			aria-label="Approvals"
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
					{/* The queue is what this panel opens onto, so its own line says so
					    before the approved count does (design round 2, D8): the dock is where
					    the user reads pending requests, and the only summary it carried was
					    about a different list. */}
					{(rows.length > 0 || granted.length > 0) && (
						<p className="text-meta text-ink-dim">
							{[
								rows.length > 0 ? `${rows.length} waiting` : null,
								granted.length === 1
									? "1 site approved"
									: granted.length > 1
										? `${granted.length} sites approved`
										: null,
							]
								.filter(Boolean)
								.join(" \u00b7 ")}
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

			{/* The persistent statement (design 9.3): a standing notice in the browser
			    feature that agents can drive tabs here, so the capability is never
			    something the user has to remember. FIRST, because its words are "each
			    site BELOW" and it used to be the panel's last child — under Browsing
			    data, pointing at nothing (review round 1, finding 2; design round 2, D6).
			    In the sheet it replaces it sat above the Approved list, which is the
			    position its copy assumes and the one spec §4.2 says it keeps. */}
			<div
				className="flex items-start gap-2 rounded-sm bg-accent-wash px-3 py-2"
				data-tour-tag="browser-agents-notice"
			>
				<ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />
				<p className="text-body-sm text-ink">
					Agents can drive tabs in this app. Sites an agent can reach were
					approved by a click in this window, and none of them can be reached
					without one.
				</p>
			</div>

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
										{/* THE AUTHORITY KEEPS ITS WIDTH and the requester takes what is left
										    (design round 2, D14; UX round 2, U10). Round 1 added the
										    requester to this row to tell two same-site requests apart, and
										    the layout then clipped the SITE - the one field both rows
										    differ by - to 49px of its 108px, so the fix made two rows for
										    one host look identical again. The site is unshrinkable now and
										    the requester is the flexible one, in its short form. */}
										{/* ...and it is BOUNDED (review round 3, MINOR): unshrinkable with no
										    ceiling meant a host wider than the leftover pushed the row past
										    `w-full`, and the panel body's `overflow-y-auto` resolves
										    `overflow-x` to `auto`, so that rendered as a horizontal
										    scrollbar inside the dock rather than as a clipped field.
										    `max-w-[60%]` plus `truncate` keeps D14's ordering - the site is
										    the last thing to give way - while the row stays inside its own
										    width, and the full host is in the element's `title`. */}
										<span
											className="max-w-[60%] shrink-0 truncate font-mono text-mono-sm text-ink"
											title={row.request.authority}
										>
											{row.request.authority}
										</span>
										{/* WHO is asking, on the row rather than only inside the card it
										    expands into (UX round 1, U2). At the dock's 320px width this
										    is the field that yields, and the floor it does not have is
										    DELIBERATE rather than forgotten (design round 3, D21): a
										    floor can only be paid for out of the authority, whose
										    unshrinkable width is D14's invariant - two rows for one host
										    must not read identically - or out of the remaining time,
										    which is the field a durable decision is made on. The full
										    requester is in the card this row expands into, so the state
										    is legible rather than lost; giving it a floor is a layout
										    trade for the design round to settle, not a one-line change. */}
										<span className="min-w-0 grow truncate text-meta text-ink-muted">
											{requesterLabel(
												row.request.requesterSessionId,
												sessions,
												{
													short: true,
												},
											)}
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
												// The dock is 384px and 320px, not 1280: the band's two-column
												// legend left a 96px gutter and a 129px measure here, which
												// wrapped every gloss and ran the last one past the panel
												// (design round 2, D2).
												layout="stacked"
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
						// THE SAME TREATMENT AS `Forget this site` (design round 2, D7). This is
						// the widest-blast-radius control in the panel — it drops every site
						// approval at once — and it was plain body text at the end of a list
						// whose per-row `Revoke` is an outlined control and whose `Forget this
						// site` is a danger-outlined one. One class of action, three
						// affordances, and the loudest action was the quietest.
						variant="danger"
						size="sm"
						className="mt-3 w-full"
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
		</section>
	);
};
