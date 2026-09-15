import { Button } from "@shared/components/ui";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
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
 * WHO IS ASKING, and why the heading names a conversation. In an app with several
 * conversations running at once, "An agent wants to open ..." beside a list of
 * choices is not a decision a user can make: the same workspace can have two
 * agents asking about two different sites, and the user has to know which one they
 * are answering — the whole point of the consent gate is that a human decides who
 * gets what (design 9.2's requester binding, and design round 1, D2). The name comes
 * from the same session list the hand-over dialog reads; the bar does NOT fetch it,
 * because the band has to render with the backend down — a state this feature
 * deliberately supports — so an unresolved requester shows its id, the way an
 * untitled session does everywhere else in this app.
 *
 * THE SCOPES, and what each means in words the user is actually choosing between.
 * Stated per choice, under the buttons, because the one thing the previous copy got
 * wrong was compressing five different lifetimes into one sentence ("until you
 * revoke it") that was false for two of them (design round 1, D3):
 *
 * | button | what it grants |
 * |---|---|
 * | Allow once | one navigation, bound to the requesting conversation, ≤10 minutes |
 * | Allow until the app quits | this exact origin, in memory, for this run — every
 *   conversation, which is why the button does NOT say "for this conversation" |
 * | Always allow this site | this exact origin, kept until revoked, shared with
 *   every conversation |
 * | Allow all of <domain> | the registrable domain, kept until revoked, shared with
 *   every conversation (offered only when the host computed the broad key, i.e.
 *   when public-suffix data is available) |
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
 * - that an approval is narrow to a task or to one conversation — it is not, and
 *   the per-choice lines say which grants are shared with every conversation;
 * - that a denial is permanent — it is durable but changeable, and the deny
 *   button's tooltip says where;
 * - that clearing the cache has any bearing on what the agent may reach — the
 *   Sites sheet says the two are separate actions.
 *
 * AND THE TWO FACTS ABOUT THIS PROFILE that a durable grant is only defensible
 * with, both of which the previous copy left out (§9.3, §9.5 item 3, D3): the jar
 * is this app's, not the user's real browser; and its sign-ins are SHARED — across
 * conversations and across app restarts. A user who reads "keeps sign-ins" without
 * "shared" has been told something true and shown the wrong picture.
 *
 * AND THE ONE ASYMMETRY THE USER WILL OTHERWISE READ AS A BUG (§6.1): an origin
 * can be reachable BY THE USER while refused to the agent. That is the intended
 * direction of the gate, so the body says it here rather than leaving it to be
 * inferred from a failing agent.
 */

export interface BrowserConsentBarProps {
	pending: PendingConsentView;
	/** How many other requests are waiting behind this one. Named because the user
	 * may have arrived here from a notification that named THIS request rather than
	 * the oldest, and "where are the rest" must not be a mystery (review R8). */
	waitingBehind: number;
	busy: boolean;
	onDecide: (entryId: string, decision: ConsentDecision) => void;
}

/**
 * The requester, as something to read.
 *
 * A resolved conversation title when the session list knows the session, and the
 * bare id otherwise — the app's existing treatment for a session the user has not
 * named (`session.title || session.session_id`, the hand-over picker's own rule).
 * A non-session requester gets a phrase rather than an internal id: `requester` is
 * an authority boundary, and a raw request id in front of a user is noise at best.
 */
export function requesterLabel(
	requesterSessionId: string | null,
	sessions: ReadonlyArray<{ session_id: string; title?: string | null }>,
): string {
	if (!requesterSessionId) return "An agent";
	const title = sessions.find(
		(session) => session.session_id === requesterSessionId,
	)?.title;
	if (title?.trim()) return `The agent in '${title.trim()}'`;
	return `The agent in conversation ${requesterSessionId}`;
}

export const BrowserConsentBar: FC<BrowserConsentBarProps> = ({
	pending,
	waitingBehind,
	busy,
	onDecide,
}) => {
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const who = requesterLabel(pending.requesterSessionId, sessions);

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
					<p className="text-body text-ink" data-tour-tag="browser-consent-who">
						{who} wants to open{" "}
						<span className="font-mono text-mono-sm">{pending.authority}</span>.
					</p>
					{/* The two facts the user has to know to answer well, stated once each
					    and in this order: what the grant buys, and that refusing the agent
					    does not close the site to them. */}
					<p className="text-body-sm text-ink-muted">
						This browser keeps sign-ins across conversations and app restarts,
						so an agent you approve here can use those signed-in accounts on the
						sites you allow it. You can open this site yourself either way —
						this only controls what the agent may reach.
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
					Allow until the app quits
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
			{/* What each choice actually persists, next to the choice. A single
			    lifetime sentence cannot be true of five different scopes, and the
			    shared-across-conversations half is the part a user cannot infer from
			    a button's label (D3). */}
			<dl
				className="ml-6 grid gap-x-4 gap-y-0.5 text-meta text-ink-dim"
				data-tour-tag="browser-consent-scopes"
			>
				<div className="flex gap-1.5">
					<dt className="shrink-0 text-ink-muted">Allow once</dt>
					<dd>one navigation, for that conversation, up to ten minutes</dd>
				</div>
				<div className="flex gap-1.5">
					<dt className="shrink-0 text-ink-muted">Allow until the app quits</dt>
					<dd>this site, for this run only, and for every conversation</dd>
				</div>
				<div className="flex gap-1.5">
					<dt className="shrink-0 text-ink-muted">Always allow this site</dt>
					<dd>kept until you revoke it, and shared with every conversation</dd>
				</div>
				{pending.broad && (
					<div className="flex gap-1.5">
						<dt className="shrink-0 text-ink-muted">
							Allow all of {pending.broad.key}
						</dt>
						<dd>
							every site under {pending.broad.key}, kept until you revoke it,
							shared with every conversation
						</dd>
					</div>
				)}
				<div className="flex gap-1.5">
					<dt className="shrink-0 text-ink-muted">Don't allow</dt>
					<dd>
						the agent stops asking about this site until you revoke the denial
						in Sites
					</dd>
				</div>
			</dl>
			{waitingBehind > 0 && (
				<p className="ml-6 text-meta text-ink-dim">
					{waitingBehind === 1
						? "One other request is waiting."
						: `${waitingBehind} other requests are waiting.`}
				</p>
			)}
		</section>
	);
};
