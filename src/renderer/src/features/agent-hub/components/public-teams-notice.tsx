import type { MembershipSummary } from "@shared/api/radient/types";
import { Button } from "@shared/components/ui";
import { Building2 } from "lucide-react";
import { type FC, useEffect, useRef } from "react";

/**
 * Why the Teams view has no list in the PUBLIC scope, by who is looking.
 *
 * `orgs` - the viewer has usable organizations: the answer is to pick one.
 * `signed-out` - no credential, so no memberships exist to read.
 * `unavailable` - the backend predates the org operations (the page's alert
 *   above the browse bar carries the remedy; this sentence only defers to it).
 * `unreadable` - the memberships read FAILED, which is not the same fact as
 *   "you belong to none" and must not be reported as it.
 * `none` - signed in, read fine, nothing usable: no org, or no Team plan.
 * `loading` - the capability answer or the memberships read has not settled, so
 *   what the viewer belongs to is not known YET. It must not fall through to
 *   `none`: that reports a pending read as a negative fact about the account
 *   (agent review round 1, M1).
 */
export type PublicTeamsReason =
	| "loading"
	| "orgs"
	| "signed-out"
	| "unavailable"
	| "unreadable"
	| "none";

const SENTENCE: Record<PublicTeamsReason, string> = {
	loading: "The public hub lists agents only. Checking your organizations…",
	orgs: "The public hub lists agents only. Choose an organization to see the teams it has shared with its members.",
	"signed-out":
		"The public hub lists agents only. Sign in to Radient to see the teams shared with the organizations you belong to.",
	unavailable:
		"The public hub lists agents only, and organizations are unavailable on this backend, so no teams can be listed. The notice above says how to fix that.",
	unreadable:
		"The public hub lists agents only, and your organizations could not be read, so no teams can be listed.",
	/*
	 * For a viewer with NO organization as much as for one whose plan lapsed, so
	 * the sentence states the requirement and the person who can meet it rather
	 * than "none of your organizations", which is odd with zero of them (UX round
	 * 1, U8).
	 */
	none: "The public hub lists agents only. Teams are shared with members of an organization on the Team plan, and you are not in one yet. An organization owner can add you or activate the plan in the Radient console.",
};

/**
 * What the Teams view says in the PUBLIC scope.
 *
 * ## Why it is a state and not an empty list
 *
 * Teams are organization-only in v1 (design §8.4, §11 O-7): the hub serves no
 * public team read, so there is nothing to list here and an empty roster ("0
 * teams") would claim a public catalogue that does not exist. The view says what
 * teams ARE and hands the reader the one thing that changes it.
 *
 * ## No dead ends
 *
 * Each viewer gets the action that is real for them and none that would do
 * nothing: an organization button per usable org (the scope chips above do the
 * same; the button is where the eye already is), the settings page for the
 * signed-out viewer (where the Radient sign-in lives), a retry for a failed
 * memberships read, and only the sentence for the states nothing in this app can
 * change.
 */
export const PublicTeamsNotice: FC<{
	reason: PublicTeamsReason;
	orgs: readonly MembershipSummary[];
	onPickOrg: (tenantId: string) => void;
	onOpenSettings: () => void;
	onRetry: () => void;
	retrying: boolean;
}> = ({ reason, orgs, onPickOrg, onOpenSettings, onRetry, retrying }) => {
	/*
	 * FOCUS AFTER THE RETRY (UX round 1, U4). "Try again" is disabled while its
	 * read is in flight and unmounts when the answer changes the reason, and both
	 * drop focus on `<body>`. Once the press settles, focus goes back to the
	 * button if the read failed again (it is still the control that retries), and
	 * to this panel - a labelled region that is programmatically focusable - when
	 * the answer replaced the state under the reader.
	 */
	const sectionRef = useRef<HTMLElement>(null);
	const retryButtonRef = useRef<HTMLButtonElement>(null);
	const retryPressedRef = useRef(false);
	useEffect(() => {
		if (!retryPressedRef.current || retrying) return;
		retryPressedRef.current = false;
		(retryButtonRef.current ?? sectionRef.current)?.focus();
	}, [retrying]);

	return (
		<section
			ref={sectionRef}
			tabIndex={-1}
			className="flex max-w-2xl flex-col items-start gap-2 rounded-md bg-surface px-6 py-8"
			aria-labelledby="agent-hub-teams-public-heading"
			data-testid="agent-hub-teams-public"
		>
			<h2
				id="agent-hub-teams-public-heading"
				className="font-medium text-heading text-ink"
			>
				Teams are shared inside organizations
			</h2>
			<p className="max-w-md text-body-sm text-ink-muted">{SENTENCE[reason]}</p>
			{reason === "orgs" && (
				<div className="mt-2 flex flex-wrap items-center gap-2">
					{orgs.map((org) => (
						<Button
							key={org.tenant_id}
							variant="secondary"
							onClick={() => onPickOrg(org.tenant_id)}
						>
							<Building2 aria-hidden="true" />
							<span className="max-w-48 truncate">
								{org.tenant_name || "Organization"}
							</span>
						</Button>
					))}
				</div>
			)}
			{reason === "signed-out" && (
				<div className="mt-2">
					{/* The label says the act: this navigates to where the sign-in lives, it does not sign in (design round 1, D4). */}
					<Button variant="secondary" onClick={onOpenSettings}>
						Open settings to sign in
					</Button>
				</div>
			)}
			{reason === "unreadable" && (
				<div className="mt-2">
					<Button
						ref={retryButtonRef}
						variant="secondary"
						onClick={() => {
							retryPressedRef.current = true;
							onRetry();
						}}
						disabled={retrying}
						aria-busy={retrying}
					>
						{retrying ? "Trying…" : "Try again"}
					</Button>
				</div>
			)}
		</section>
	);
};
