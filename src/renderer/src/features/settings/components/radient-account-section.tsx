/**
 * @file radient-account-section.tsx
 * @description
 * Body of the Radient account settings section: sign-in prompt when signed out,
 * account details and a sign-out action when signed in. The heading, icon and
 * tour tag belong to the section wrapper the settings page renders around this.
 */

import { RadientAuthButtons } from "@shared/components/auth";
import { Spinner } from "@shared/components/common/spinner";
import { Badge, Button } from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks";
import { isRadientAccountFailure } from "@shared/hooks/use-radient-user-query";
import { useUserStore } from "@shared/store/user-store";
import { formatCalendarDate } from "@shared/utils/date-utils";
import { LogOut } from "lucide-react";
import { type FC, useCallback, useMemo } from "react";
import { InfoGrid, InfoItem } from "./settings-section";

type RadientAccountSectionProps = {
	onAfterCredentialUpdate?: () => void;
};

export const RadientAccountSection: FC<RadientAccountSectionProps> = ({
	onAfterCredentialUpdate,
}) => {
	const { isAuthenticated, user, isLoading, accountRead, signOut } =
		useRadientAuth();
	const isSigningOut = useUserStore((state) => state.isSigningOut);

	const handleSignOut = useCallback(async () => {
		try {
			await signOut();
		} catch (err) {
			console.error("Error signing out:", err);
		}
	}, [signOut]);

	const accountInfoSection = useMemo(() => {
		if (!isAuthenticated || !user?.radientUser) return null;

		const { account, identity } = user.radientUser;

		return (
			<>
				<InfoGrid>
					<InfoItem
						label="Status"
						value={
							<span className="inline-flex items-center gap-2">
								Connected
								{/* The status string arrives lowercase from the API. */}
								<Badge variant="success" className="capitalize">
									{account.status}
								</Badge>
							</span>
						}
					/>
					<InfoItem label="Name" value={account.name || "Not provided"} />
					<InfoItem label="Email" value={account.email} />
					{/* Identifiers are machine voice, so they take the mono step. */}
					<InfoItem
						label="Account ID"
						value={<span className="text-mono-sm">{account.id}</span>}
					/>
					<InfoItem
						label="Tenant ID"
						value={<span className="text-mono-sm">{account.tenant_id}</span>}
					/>
					<InfoItem
						label="Provider"
						value={<span className="capitalize">{identity.provider}</span>}
					/>
					<InfoItem
						label="Created"
						value={formatCalendarDate(account.created_at)}
					/>
				</InfoGrid>

				{/*
				 * A section-tier gap replaces the rule that used to sit here: the
				 * details are a grid and this is a sentence plus a button, so the
				 * space already says they are different things.
				 */}
				<div className="mt-8">
					<p className="text-body-sm text-ink-muted">
						Need to sign out or switch accounts?
					</p>
					<Button variant="danger" className="mt-3" onClick={handleSignOut}>
						<LogOut />
						Sign out from Radient
					</Button>
				</div>
			</>
		);
	}, [isAuthenticated, user?.radientUser, handleSignOut]);

	/*
	 * The section's opening sentence, which is the only place this section says
	 * anything about a failed read.
	 *
	 * WHY NOT A SECOND WARNING. One fault used to render two `warning` alerts with
	 * two Retry buttons 3173px apart, and - 16px above this paragraph - the
	 * section's own claim ("Radient refused the account this app is signed in
	 * with") directly above the ordinary signed-out sentence, two opposite
	 * statements in one viewport with nothing saying which to believe (design
	 * round 1, D1, which decided: one alert, and that one in the settings page
	 * where the placeholder data is visible, with its Retry). So the sentence here
	 * is STATE-DEPENDENT rather than additional: the section renders the ordinary
	 * signed-out sentence, or what the failed read means for it, never both, and
	 * its remedy - the sign-in control directly below - stays where it is.
	 *
	 * WHY THE REFUSAL IS ITS OWN SENTENCE, and only for the class that carries
	 * it: a sentence about the ACCOUNT's credential is only true when the backend
	 * said so (`radient_credential_refused`). Every other failure keeps to what
	 * was observed, because a bare 401/403 on this read also means this app's own
	 * bearer was refused - whose remedy is a restart or a re-pair, not a new
	 * Radient sign-in - and only the typed code separates the two. The
	 * classification is the settings page's own (`accountRead`), so the two
	 * surfaces cannot read one answer differently.
	 *
	 * WHY NOT THE RAW MESSAGE, which is what used to render here ("Error checking
	 * account status: Get radient.request request failed: 401"): it names a
	 * transport verb and an HTTP integer, and neither changes what the person
	 * does next - the rule `backend-error.ts` records for the same mistake on the
	 * settings surface.
	 */
	const signInLead = useMemo(() => {
		if (accountRead === "refused") {
			return "Radient refused the sign-in this app is holding, so your account details could not be read. Signing in again below replaces it.";
		}
		if (isRadientAccountFailure(accountRead)) {
			return "Your Radient account could not be read, so this app cannot show your account details.";
		}
		return "You are not currently signed in to Radient.";
	}, [accountRead]);

	const signInSection = useMemo(() => {
		if (isAuthenticated && user) return null;

		return (
			<div>
				<p className="text-body-sm text-ink-muted">
					{signInLead} Sign in to access your account details or sign up to get
					free credits and unified access to models, tools, and more with
					Radient Pass. Radient's automatic model router will automatically
					select the best model for your agents to balance cost and performance.
					It is often cheaper to use Radient Pass than to use single AI
					providers due to automatic cost optimization.
				</p>
				<div className="mt-6">
					<RadientAuthButtons
						titleText=""
						onAfterCredentialUpdate={onAfterCredentialUpdate}
						descriptionText=""
						onSignInSuccess={() => {
							// Nothing to do here: the refresh of models and credentials
							// already runs through onAfterCredentialUpdate.
						}}
					/>
				</div>
			</div>
		);
	}, [isAuthenticated, user, signInLead, onAfterCredentialUpdate]);

	if (isLoading || isSigningOut) {
		return (
			<div className="flex min-h-36 flex-col items-center justify-center gap-3">
				<Spinner size="lg" label="Loading account" />
				{/*
				 * A caption as well as the ring, in the app's one register for "not
				 * authoritative yet" (`branding.md` section 8: `text-meta text-ink-dim`,
				 * sentence case, no spinner of its own, no icon, no border). The
				 * Spinner's label is `sr-only` by its own contract, so without this a
				 * sighted reader got a bare ring, indefinitely, in a 144px box - the
				 * same ambiguity the page above answers after 4s with a visible
				 * caption, and this is a smaller scope than that one: one query with a
				 * bounded resolution, and the reader already has the page's own
				 * sentence above for the page-wide case. From the first painted frame
				 * rather than on a deadline, because the question here ("whose account
				 * is this?") is open from the first frame, not only after 4s.
				 *
				 * Not rendered while SIGNING OUT: that is not a read in flight, and the
				 * caption would name the wrong state.
				 */}
				{!isSigningOut && (
					<p className="text-meta text-ink-dim">
						Checking your Radient account…
					</p>
				)}
			</div>
		);
	}

	if (isAuthenticated && user?.radientUser) {
		return accountInfoSection;
	}

	/*
	 * Not loading and not signed in (or the account payload is missing): the
	 * sign-in prompt, whose opening sentence is what this section says about a
	 * failed read. No alert and no second Retry here by design (D1): one fault
	 * gets one explanation, and it is the settings page's, where the placeholder
	 * data that lies to the reader is on screen with a retry beside it.
	 */
	return <div className="flex flex-col gap-4">{signInSection}</div>;
};
