/**
 * @file radient-account-section.tsx
 * @description
 * Body of the Radient account settings section: sign-in prompt when signed out,
 * account details and a sign-out action when signed in. The heading, icon and
 * tour tag belong to the section wrapper the settings page renders around this.
 */

import { RadientAuthButtons } from "@shared/components/auth";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button } from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks";
import { useUserStore } from "@shared/store/user-store";
import { LogOut } from "lucide-react";
import { type FC, useCallback, useMemo } from "react";
import { InfoGrid, InfoItem } from "./settings-section";

type RadientAccountSectionProps = {
	onAfterCredentialUpdate?: () => void;
};

export const RadientAccountSection: FC<RadientAccountSectionProps> = ({
	onAfterCredentialUpdate,
}) => {
	const { isAuthenticated, user, isLoading, error, signOut } = useRadientAuth();
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
						value={new Date(account.created_at).toLocaleString()}
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

	const signInSection = useMemo(() => {
		if (isAuthenticated && user) return null;

		return (
			<div>
				<p className="text-body-sm text-ink-muted">
					You are not currently signed in to Radient. Sign in to access your
					account details or sign up to get free credits and unified access to
					models, tools, and more with Radient Pass. Radient's automatic model
					router will automatically select the best model for your agents to
					balance cost and performance. It is often cheaper to use Radient Pass
					than to use single AI providers due to automatic cost optimization.
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
	}, [isAuthenticated, user, onAfterCredentialUpdate]);

	if (isLoading || isSigningOut) {
		return (
			<div className="flex min-h-36 items-center justify-center">
				<Spinner size="lg" label="Loading account" />
			</div>
		);
	}

	if (isAuthenticated && user?.radientUser) {
		return accountInfoSection;
	}

	// Not loading and not signed in (or the account payload is missing): show the
	// sign-in prompt, with the lookup failure above it when there was one.
	return (
		<div className="flex flex-col gap-4">
			{error && (
				<Alert variant="danger">
					Error checking account status:{" "}
					{error instanceof Error ? error.message : String(error)}
				</Alert>
			)}
			{signInSection}
		</div>
	);
};
