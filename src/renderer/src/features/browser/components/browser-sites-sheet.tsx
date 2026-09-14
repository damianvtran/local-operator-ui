import { Button, Separator } from "@shared/components/ui";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@shared/components/ui/sheet";
import { ShieldCheck } from "lucide-react";
import type { FC } from "react";
import type { ApprovalView } from "../hooks/use-browser-chrome";

/**
 * The approvals and revocation surface, and the always-visible statement that
 * agents can drive tabs in this app.
 * Design: docs/design/ui-browser-tab.md 9.3 (what the user sees), 9.4
 * (revocation as easy as granting), 9.5 (what must not be implied).
 *
 * THE QUESTION THIS ANSWERS, in the design's own words: "which sites can an agent
 * act on as me right now?" It is answerable from the UI alone and reachable in
 * one click from the browser feature, because a DURABLE grant against a
 * persistent jar is only defensible if the granted set is visible and revocable.
 * Visibility is the answer the design gives instead of a timer.
 *
 * THREE AFFORDANCES THAT LOOK ALIKE AND ARE NOT (design 9.4):
 * - **Revoke** withdraws an approval. It does not sign the user out, and it does
 *   not delete anything the site stored.
 * - **Forget this site** withdraws the approval AND clears that origin's data.
 * - **Clear browsing data** deletes this app's stored cookies/cache and touches
 *   no approval — which is exactly why a denied origin asks again afterwards, and
 *   the copy below says so rather than letting it read as a bug.
 *
 * The sheet is a `Sheet` and not a dialog because it is a list the user reads
 * while the page stays visible behind it — and because a dialog would hide the
 * native view (design 11.3), which is a heavier consequence than this list
 * deserves.
 */

export interface BrowserSitesSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	approvals: ApprovalView[];
	/** The active tab's origin, for the per-site action. Null when the tab is on
	 * `about:blank` or has no URL yet. */
	currentOrigin: string | null;
	busy: boolean;
	onRevoke: (origin: string) => void;
	onRevokeAll: () => void;
	onForgetSite: (origin: string) => void;
	onClearData: (what: "cookies" | "cache" | "everything") => void;
}

const SCOPE_LABEL: Record<ApprovalView["scope"], string> = {
	origin: "This site",
	domain: "Whole domain",
	host: "This host",
	deny: "Denied",
	session: "This session only",
};

function grantedWhen(grantedAt: number): string {
	if (!grantedAt) return "";
	return new Date(grantedAt).toLocaleString();
}

export const BrowserSitesSheet: FC<BrowserSitesSheetProps> = ({
	open,
	onOpenChange,
	approvals,
	currentOrigin,
	busy,
	onRevoke,
	onRevokeAll,
	onForgetSite,
	onClearData,
}) => {
	// A `deny` record is a durable NO, not a grant: the agent stops asking about
	// that origin. It is listed separately because "what may the agent reach" and
	// "what have I turned off" are two different readings of the same store, and
	// mixing them puts a refusal under a heading that says an agent may act there.
	const granted = approvals.filter((row) => row.scope !== "deny");
	const denied = approvals.filter((row) => row.scope === "deny");

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="w-96 overflow-y-auto"
				data-tour-tag="browser-sites-sheet"
			>
				<SheetHeader>
					<SheetTitle>Sites agents can act on as you</SheetTitle>
					<SheetDescription>
						Approvals are kept per origin and are separate from cookies.
						Revoking one does not sign you out; clearing cookies does not
						restore a denial.
					</SheetDescription>
				</SheetHeader>

				{/* The persistent statement (design 9.3): a standing notice in the browser
				    feature that agents can drive tabs here, so the capability is never
				    something the user has to remember. */}
				<div
					className="mt-4 flex items-start gap-2 rounded-sm bg-accent-wash px-3 py-2"
					data-tour-tag="browser-agents-notice"
				>
					<ShieldCheck
						aria-hidden
						className="mt-0.5 size-4 shrink-0 text-ink"
					/>
					<p className="text-body-sm text-ink">
						Agents can drive tabs in this app. Each site below was approved by a
						click in this window, and none of them can be reached without one.
					</p>
				</div>

				<section className="mt-5" aria-label="Approved sites">
					<h3 className="text-heading text-ink">Approved</h3>
					{granted.length === 0 ? (
						<p className="mt-2 text-body-sm text-ink-muted">
							No site is approved yet. The agent will ask the first time it
							needs one.
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
											{SCOPE_LABEL[row.scope]}
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
					<section className="mt-5" aria-label="Denied sites">
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
					<section className="mt-5" aria-label="Current site">
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
							Revokes any approval for it and clears what this app stored for
							it. It does not touch your real browser's data.
						</p>
					</section>
				)}

				<Separator className="my-5" />

				<section aria-label="Browsing data">
					<h3 className="text-heading text-ink">Browsing data</h3>
					{/* The sentence the design asks for by name: revoking and clearing are
					    different actions with different consequences, and a user who has
					    just revoke-all'd needs to know that clearing cookies will NOT bring
					    the deny state back. */}
					<p className="mt-1 text-body-sm text-ink-muted">
						These clear what this app's browser profile stored. They do not
						change which sites the agent may reach — that is the list above.
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
			</SheetContent>
		</Sheet>
	);
};
