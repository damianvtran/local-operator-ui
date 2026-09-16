import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { ShieldAlert } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import type { ApprovalRequestInput } from "../model/approval-queue-model";

/**
 * One approval request, as the card that asks the question.
 * Design: docs/design/ui-browser-tab.md 9.2 (where it renders and why), 9.3 (the
 * scopes and their lifetimes), 9.5 (the honest default, and what must NOT be
 * implied); docs/design/browser-approval-ux.md 4.3 (why it is one component
 * rendered by two surfaces).
 *
 * EXTRACTED FROM THE CONSENT BAR, not rewritten: the band's request card and the
 * dock's expanded row are the same question, and two implementations of one
 * question drift (the defect `branding.md:467-471` names). The band keeps the
 * framing around it — the band is the notification, the dock is the archive of it
 * (§4.3) — and this file owns the card.
 *
 * WHY IT IS IN THE BAND AND NOT A MODAL. Two reasons, both of them the design's:
 * a modal over the page area would be INVISIBLE, because a native view paints
 * above all DOM; and a modal reproduces exactly the failure the async approval
 * flow was built to remove — the agent gets no turn to tell the user, and prompts
 * expire unseen. The band is outside the view's rect, so it is the one place in
 * this feature where a prompt is reliably visible. The dock is in flow for the
 * same reason: it narrows the page instead of covering it.
 *
 * WHO IS ASKING, and why the heading names a conversation. In an app with several
 * conversations running at once, "An agent wants to open ..." beside a list of
 * choices is not a decision a user can make: the same workspace can have two
 * agents asking about two different sites, and the user has to know which one they
 * are answering — the whole point of the consent gate is that a human decides who
 * gets what (design 9.2's requester binding, and design round 1, D2). Note that a
 * queue makes this load-bearing in a new way: with several requests live at once,
 * the requester line is what stops a click on request 2 from being read as an
 * answer to request 1. The name comes from the same session list the hand-over
 * dialog reads; the card does NOT fetch it, because the band has to render with
 * the backend down — a state this feature deliberately supports — so an
 * unresolved requester shows its id, the way an untitled session does everywhere
 * else in this app.
 *
 * THE SCOPES, and what each means in words the user is actually choosing between.
 * Stated per choice, under the buttons, because the one thing the previous copy got
 * wrong was compressing five different lifetimes into one sentence ("until you
 * revoke it") that was false for two of them (design round 1, D3). The glosses
 * survive verbatim from the band (§3.5 of this feature's spec: they are the
 * honesty standard that produced them, so they are a constraint on the new
 * surfaces, not a suggestion).
 *
 * WHY "ALLOW ONCE" IS THE PRIMARY ACTION, and not "always allow": the primary
 * button is the most prominent thing in the card, so it is the one a hurried
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
 *   Approvals dock says the two are separate actions.
 */

export type ConsentDecision = "once" | "session" | "site" | "domain" | "deny";

export interface BrowserConsentRequestProps {
	request: ApprovalRequestInput;
	/** "expires in 9 minutes" — how long the AGENT's window stays open (§3.3), or
	 * null when the surface has no clock reading for it. */
	remaining: string | null;
	busy: boolean;
	onDecide: (entryId: string, decision: ConsentDecision) => void;
	/**
	 * How much width the card has, not what it looks like.
	 *
	 * The card is ONE component in two hosts (`spec §4.3`): the band, which is a
	 * 1280px row, and the dock, which is 384px and 320px. The two-column legend is
	 * right for the band and wrong for the dock — measured there, the term column
	 * plus `gap-x-4` left the descriptions a 129px measure and a 96px dead gutter,
	 * so every gloss wrapped to three or four lines and the last one ran past the
	 * panel (design round 2, D2). `"stacked"` puts each term over its own
	 * description and gives the copy ~230-370px instead.
	 */
	layout?: "inline" | "stacked";
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
	/**
	 * The form for a row that has to share its line with the site it is about.
	 *
	 * `The agent in conversation ` is 26 characters of boilerplate, and in the dock's
	 * 349px row it was eating the width the authority needed (design round 2, D14; UX
	 * round 2, U10: the site was clipped to 49px of 108px while the requester held
	 * 121px of a 255px label, so two rows differing by site still rendered the same).
	 * The short form keeps the distinguishing part - the conversation - and drops the
	 * sentence around it. The card and the chip's accessible name keep the full form,
	 * so nothing loses the explanation.
	 */
	options?: { short?: boolean },
): string {
	if (!requesterSessionId) return "An agent";
	const title = sessions.find(
		(session) => session.session_id === requesterSessionId,
	)?.title;
	const name = title?.trim() || requesterSessionId;
	if (options?.short) return name;
	if (title?.trim()) return `The agent in '${title.trim()}'`;
	return `The agent in conversation ${requesterSessionId}`;
}

export const BrowserConsentRequest: FC<BrowserConsentRequestProps> = ({
	request,
	remaining,
	busy,
	onDecide,
	layout = "inline",
}) => {
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const who = requesterLabel(request.requesterSessionId, sessions);
	/** Which control THIS user pressed, so the busy cue can sit next to it rather than
	 * at the far end of the row (design round 3, D12: in a 1280px band the trailing
	 * cue sat ~700px from the button it confirmed). */
	const [pressed, setPressed] = useState<ConsentDecision | null>(null);

	/** The term's ink role, which is what changes between the two layouts: the
	 * stacked form has no column for the eye to run down, so the term carries the
	 * emphasis itself (design round 2, D2). */
	const termClass = layout === "stacked" ? "text-ink" : "text-ink-muted";

	const decide = (decision: ConsentDecision): void => {
		setPressed(decision);
		onDecide(request.entryId, decision);
	};

	/* THE CUE SITS NEXT TO THE CONTROL THAT WAS PRESSED (design round 3, D12). Every
	 * choice is disabled while a decision is in flight, which on its own reads as an
	 * inert card rather than a working one, so something has to say the click landed -
	 * and where it sits is the difference between "the card is working" and "the row
	 * you clicked is working". The words carry it under `prefers-reduced-motion` too,
	 * where the ring is frozen (`spinner.tsx`). */
	const cue = (
		<span
			className="flex items-center gap-1.5 text-meta text-ink-muted"
			data-tour-tag="browser-consent-busy"
		>
			<Spinner size="sm" />
			Recording your choice…
		</span>
	);
	/** The trailing form is kept only for a decision this card did not originate. */
	const cueAfter = (decision: ConsentDecision) =>
		busy && pressed === decision ? cue : null;

	return (
		<div
			className="flex flex-col gap-2"
			data-tour-tag="browser-consent-request"
		>
			<div className="flex items-start gap-2">
				<ShieldAlert
					aria-hidden
					className="mt-0.5 size-4 shrink-0 text-warning"
				/>
				<div className="min-w-0 grow">
					<p className="text-body text-ink" data-tour-tag="browser-consent-who">
						{who} wants to open{" "}
						<span className="font-mono text-mono-sm">{request.authority}</span>.
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
					{remaining && (
						// How long the AGENT is still waiting. A user deciding whether to
						// grant a durable approval should know when the agent's own window
						// closes, and the request disappears by itself at that moment (§3.3).
						<p className="mt-1 text-meta text-ink-dim">{remaining}</p>
					)}
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
				{cueAfter("once")}
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => decide("session")}
					data-tour-tag="browser-consent-session"
				>
					Allow until the app quits
				</Button>
				{cueAfter("session")}
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => decide("site")}
					data-tour-tag="browser-consent-site"
				>
					Always allow this site
				</Button>
				{cueAfter("site")}
				{request.broad && (
					<>
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => decide("domain")}
							data-tour-tag="browser-consent-domain"
						>
							Allow all of {request.broad.key}
						</Button>
						{cueAfter("domain")}
					</>
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
				{cueAfter("deny")}
				{busy && pressed === null && cue}
			</div>
			{/* What each choice actually persists, next to the choice. A single
			    lifetime sentence cannot be true of five different scopes, and the
			    shared-across-conversations half is the part a user cannot infer from
			    a button's label (D3). */}
			{/* Two COLUMNS in the band, with the `dt`/`dd` pairs as direct children: the
			    previous form wrapped each pair in its own flex row, so `gap-x-4` never
			    applied and the five glosses started at five different x positions —
			    ragged in exactly the text whose job is to be compared row against row
			    (review round 2, D7). ONE COLUMN in the dock, where two are what made the
			    legend overflow (design round 2, D2). */}
			<dl
				className={
					layout === "stacked"
						? "ml-6 grid grid-cols-1 gap-y-1.5 text-meta text-ink-dim"
						: "ml-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-meta text-ink-dim"
				}
				data-tour-tag="browser-consent-scopes"
			>
				<dt className={termClass}>Allow once</dt>
				<dd>one navigation, for that conversation, up to ten minutes</dd>
				<dt className={termClass}>Allow until the app quits</dt>
				<dd>this site, for this run only, and for every conversation</dd>
				<dt className={termClass}>Always allow this site</dt>
				<dd>kept until you revoke it, and shared with every conversation</dd>
				{request.broad && (
					<>
						<dt className={termClass}>Allow all of {request.broad.key}</dt>
						<dd>
							every site under {request.broad.key}, kept until you revoke it,
							shared with every conversation
						</dd>
					</>
				)}
				<dt className={termClass}>Don't allow</dt>
				<dd>
					the agent stops asking about this site until you revoke the denial in
					Approvals
				</dd>
			</dl>
		</div>
	);
};
