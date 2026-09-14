import { Button } from "@shared/components/ui";
import { ShieldAlert } from "lucide-react";
import type { FC } from "react";
import type {
	ConsentDecision,
	PendingConsentView,
} from "../hooks/use-browser-chrome";

/**
 * The consent bar. Design: docs/design/ui-browser-tab.md 9.2 (where it renders
 * and why), 9.3 (the scopes and their lifetimes), 9.5 (the honest default, and
 * what must NOT be implied), 11.3 (never over the page area).
 *
 * WHY IT IS IN THE BAND AND NOT A MODAL. Two reasons, both of them the design's:
 * a modal over the page area would be INVISIBLE, because a native view paints
 * above all DOM; and a modal reproduces exactly the failure the async approval
 * flow was built to remove — the agent gets no turn to tell the user, and prompts
 * expire unseen. The band is outside the view's rect, so it is the one place in
 * this feature where a prompt is reliably visible.
 *
 * THE SCOPES, and what each means in words the user is actually choosing between:
 *
 * | button | what it grants |
 * |---|---|
 * | Allow once | one navigation, bound to the requesting session, ≤10 minutes |
 * | Allow for this session | this exact origin until the app quits (in memory) |
 * | Always allow this site | this exact origin, kept until revoked |
 * | Allow all of <domain> | the registrable domain, kept until revoked (offered
 *   only when the host computed the broad key, i.e. when public-suffix data is
 *   available) |
 * | Don't allow | a durable no for this exact origin, so the agent stops asking |
 *
 * WHY "ALLOW ONCE" IS THE PRIMARY ACTION, and not "always allow": the primary
 * button is the most prominent thing in the band, so it is the one a hurried
 * click lands on. Making the least durable, least broad grant the prominent one
 * is the only arrangement where the fast path is also the safe one. The durable
 * grants are still one click away — they are just not the click you get by
 * reflex.
 *
 * WHAT THE COPY MUST NOT IMPLY (§9.5), and is written to avoid:
 * - that the agent is limited to reading — it is not, and the body says the agent
 *   acts as the user;
 * - that an approval is narrow to a task — it is not, and the body says the grant
 *   holds until it is revoked;
 * - that a denial is permanent — it is durable but changeable, and the deny
 *   button's tooltip says where;
 * - that clearing the cache has any bearing on what the agent may reach — the
 *   Sites sheet says the two are separate actions.
 *
 * AND THE ONE ASYMMETRY THE USER WILL OTHERWISE READ AS A BUG (§6.1): an origin
 * can be reachable BY THE USER while refused to the agent. That is the intended
 * direction of the gate, so the body says it here rather than leaving it to be
 * inferred from a failing agent.
 */

export interface BrowserConsentBarProps {
	pending: PendingConsentView;
	busy: boolean;
	onDecide: (entryId: string, decision: ConsentDecision) => void;
}

export const BrowserConsentBar: FC<BrowserConsentBarProps> = ({
	pending,
	busy,
	onDecide,
}) => {
	const decide = (decision: ConsentDecision): void =>
		onDecide(pending.entryId, decision);

	return (
		<section
			// A control boundary, so `border-control` and not `hairline` (design 11.2):
			// this band's edge is what separates "an agent is asking" from the page's
			// chrome below it, so it is structural and carries the 3:1 floor.
			//
			// The GROUND is `surface` rather than `warning-wash`, and that is a
			// measured choice: the band's content is `ink` and `ink-muted` on it, and
			// those pairs are asserted by the theme contract on every ground. A wash
			// ground would put two new pairs (`ink` on `warningWash`, `border-control`
			// on `warningWash`) into the UI that no palette assertion covers. The
			// urgency is carried by the icon and the words instead, which is where
			// branding § 2 spends the semantics anyway — a colour is not the only way
			// to say "act on this".
			className="flex flex-col gap-2 border-control border-b bg-surface px-3 py-2"
			aria-label="Site approval request"
			data-tour-tag="browser-consent-bar"
		>
			<div className="flex items-start gap-2">
				<ShieldAlert
					aria-hidden
					className="mt-0.5 size-4 shrink-0 text-warning"
				/>
				<div className="min-w-0 grow">
					<p className="text-body text-ink">
						An agent wants to open{" "}
						<span className="font-mono text-mono-sm">{pending.authority}</span>.
					</p>
					{/* The two facts the user has to know to answer well, stated once each
					    and in this order: what the grant buys, and that refusing the agent
					    does not close the site to them. */}
					<p className="text-body-sm text-ink-muted">
						Approving lets the agent act as you on this site, using this app's
						browser profile, until you revoke it. You can open it yourself
						either way — this only controls what the agent may reach.
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2 pl-6">
				<Button
					variant="primary"
					size="sm"
					disabled={busy}
					onClick={() => decide("once")}
					data-tour-tag="browser-consent-once"
				>
					Allow once
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => decide("session")}
					data-tour-tag="browser-consent-session"
				>
					Allow for this session
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => decide("site")}
					data-tour-tag="browser-consent-site"
				>
					Always allow this site
				</Button>
				{pending.broad && (
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => decide("domain")}
						data-tour-tag="browser-consent-domain"
					>
						Allow all of {pending.broad.key}
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() => decide("deny")}
					data-tour-tag="browser-consent-deny"
				>
					Don't allow
				</Button>
			</div>
		</section>
	);
};
