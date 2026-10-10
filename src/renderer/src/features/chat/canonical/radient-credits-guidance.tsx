/**
 * What the chat tells a reader whose Radient run was refused for want of
 * credits, under the incident row that says so.
 *
 * WHY THIS EXISTS. Radient answers an account with no balance as HTTP 402, and
 * the row used to say only that and offer a settings button. A signed-in user
 * who has not verified their email has free credits WAITING behind that step,
 * and one who has verified has a bonus on their first top-up; neither fact was
 * anywhere on the screen at the moment it mattered. This component states the
 * one that applies, from the account read the settings page already uses
 * (`useRadientUserQuery`), with the console page to act on it. The copy and the
 * URLs live in `shared/utils/radient-account-copy.ts`, shared with the settings
 * verify-to-claim callout, so the two surfaces cannot word one fact twice.
 *
 * NEVER CLAIM A STATE IT COULD NOT READ. The account read can be missing for
 * many reasons - signed out, offline, a backend that predates the verification
 * block - and every one of them renders the neutral message with both remedies
 * worded conditionally. While the first read is still in flight the box is
 * simply absent (the "Open Radient account" button is already there): a
 * neutral sentence that is replaced a moment later by the real one is two
 * statements about one fault, which is the defect the account section's own
 * comments record.
 *
 * FRESHNESS. The reader is typically here because they just came back from the
 * console (verified, or topped up), so a cached answer from minutes ago can be
 * exactly the wrong one. The observer asks for a short stale window: a row that
 * mounts, or a window that regains focus, re-reads the account once, and React
 * Query shares that one request between every row on screen. `retryOnMount:
 * false` keeps a FAILING read from being re-commissioned by each row that
 * scrolls in; the focus refetch is how a recovered backend is picked up.
 */

import { useDesktopCapabilities } from "@shared/api/local-operator/desktop-hooks";
import { Button } from "@shared/components/ui";
import { useRadientPricesQuery } from "@shared/hooks/use-radient-prices-query";
import { useRadientUserQuery } from "@shared/hooks/use-radient-user-query";
import {
	openConsolePage,
	outOfCreditsGuidance,
} from "@shared/utils/radient-account-copy";
import { Info } from "lucide-react";
import type { FC } from "react";
import { Link } from "react-router-dom";
import type { ProviderErrorAction } from "./provider-error-guidance";

/** How fresh the account read must be when a refusal row is on screen. */
const GUIDANCE_STALE_MS = 5 * 1000;

export const RadientCreditsGuidance: FC<{
	/** The account-section action the row already earns; kept beside the console one. */
	action: ProviderErrorAction;
}> = ({ action }) => {
	const { user, accountRead } = useRadientUserQuery({
		staleTime: GUIDANCE_STALE_MS,
		retryOnMount: false,
	});
	const capabilities = useDesktopCapabilities();
	/*
	 * The advertised grant, for a pending/expired capture whose own
	 * `grant_amount` the backend left out: the same fallback the settings
	 * callout reads, so the two surfaces cannot put different figures on one
	 * fact (agent review round 1, R1-2). The read is shared and cached; while it
	 * is in flight or absent the amount degrades to the phrase that promises no
	 * number (`grantAmountText`), and it can only refine that phrase - never
	 * flip which state the row claims.
	 */
	const { prices } = useRadientPricesQuery();
	/*
	 * "Not answered yet" is two things: the account read in flight, and the
	 * capability probe that opens the read's gate still in flight (a gated-off
	 * query reads as `signed-out`, and a neutral sentence painted for that first
	 * moment would be replaced by the real one a beat later). Once the probe has
	 * answered, a backend that serves no Radient at all, or one that is down, is
	 * the unreadable case and takes the neutral message.
	 */
	const awaiting = capabilities.isPending || accountRead === "checking";
	const guidance = awaiting
		? null
		: outOfCreditsGuidance(
				accountRead === "ready" ? user?.verification : undefined,
				prices?.default_new_credits,
			);
	return (
		<div className="mt-1 flex flex-col items-start gap-2 pl-6">
			{guidance ? (
				<div
					data-radient-credits-state={guidance.state}
					className="flex max-w-[60ch] items-start gap-3 rounded-sm border border-hairline bg-surface p-3"
				>
					<Info
						className="mt-0.5 size-4 shrink-0 text-ink-muted"
						aria-hidden="true"
					/>
					<div className="min-w-0 text-body-sm text-ink">
						{guidance.lines.map((line) => (
							<p key={line} className="[&:not(:first-child)]:mt-1">
								{line}
							</p>
						))}
					</div>
				</div>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				{guidance?.links.map((link) => (
					<Button
						key={link.url}
						variant="secondary"
						size="sm"
						onClick={() => openConsolePage(link.url)}
					>
						{link.label}
					</Button>
				))}
				<Button variant="ghost" size="sm" asChild>
					<Link to={action.to}>{action.label}</Link>
				</Button>
			</div>
		</div>
	);
};
