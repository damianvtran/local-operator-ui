import { Spinner } from "@shared/components/common/spinner";
import { Badge, Button, Card, Tooltip } from "@shared/components/ui";
import { useOidcAuth } from "@shared/hooks/use-oidc-auth";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import {
	CalendarDays,
	CheckCircle2,
	HardDrive,
	Link as LinkIcon,
	type LucideIcon,
	Mail,
	Puzzle,
} from "lucide-react";
import type { FC } from "react";
import { SettingsSection } from "./settings-section";

const GMAIL_SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.compose",
];
const CALENDAR_SCOPES = [
	"https://www.googleapis.com/auth/calendar.readonly",
	"https://www.googleapis.com/auth/calendar",
];
const DRIVE_SCOPES = [
	"https://www.googleapis.com/auth/drive.readonly",
	"https://www.googleapis.com/auth/drive",
];

type IntegrationRowProps = {
	serviceName: string;
	icon: LucideIcon;
	scopes: string[];
	grantedScopes: string[] | undefined;
	onConnect: (scopes: string[]) => void;
	isLoading: boolean;
	/** Radient session is signed in *and* the provider is Google. */
	isAuthenticated: boolean;
};

/**
 * One Google service and its connection state.
 *
 * Connected is a fact, not an affordance, so it renders as a success badge
 * rather than as a filled green button that cannot be pressed. The previous
 * version tinted the whole row too, which spent a semantic colour on the
 * background of something the badge already says.
 */
const IntegrationRow: FC<IntegrationRowProps> = ({
	serviceName,
	icon: Icon,
	scopes,
	grantedScopes,
	onConnect,
	isLoading,
	isAuthenticated,
}) => {
	const isConnected =
		grantedScopes && scopes.every((scope) => grantedScopes.includes(scope));

	const handleConnect = () => {
		if (!isConnected && isAuthenticated) {
			onConnect(scopes);
		}
	};

	return (
		<li className="flex items-center justify-between gap-4 px-4 py-3">
			<div className="flex min-w-0 items-center gap-3">
				<Icon
					size={20}
					strokeWidth={1.75}
					className="shrink-0 text-ink-muted"
					aria-hidden="true"
				/>
				<span className="truncate font-medium text-body text-ink">
					{serviceName}
				</span>
			</div>
			{/*
			 * Fixed height so the row does not resize when a connect finishes and
			 * the badge takes the button's place.
			 */}
			<div className="flex h-7 shrink-0 items-center justify-end">
				{isConnected ? (
					<Badge variant="success">
						<CheckCircle2 aria-hidden="true" />
						Connected
					</Badge>
				) : (
					<Tooltip
						content="Log in to Radient with a Google account to connect integrations"
						disabled={isAuthenticated}
					>
						{/*
						 * A disabled button emits no pointer events, so the tooltip
						 * needs a wrapper that still receives them.
						 *
						 * `isConnected` is redundant in the button's disabled condition
						 * on this branch, but the guard stays: it is the same condition
						 * the click handler checks, and it must never be possible to
						 * request a scope that has already been granted.
						 */}
						<span className="inline-flex">
							<Button
								variant="outline"
								size="sm"
								className="min-w-28"
								onClick={handleConnect}
								disabled={isLoading || isConnected || !isAuthenticated}
							>
								{isLoading ? <Spinner size="xs" /> : <LinkIcon />}
								{isLoading ? "Connecting..." : "Connect"}
							</Button>
						</span>
					</Tooltip>
				)}
			</div>
		</li>
	);
};

export const GoogleIntegrationsSection: FC = () => {
	const {
		status: oidcStatus,
		requestAdditionalGoogleScopes,
		loading: oidcLoading,
	} = useOidcAuth();
	const { isAuthenticated: isRadientAuthenticated } = useRadientAuth();

	const handleConnectService = async (scopesToRequest: string[]) => {
		if (isRadientAuthenticated) {
			await requestAdditionalGoogleScopes(scopesToRequest);
		}
	};

	// Google scopes are granted through the Radient session, so a non-Google
	// provider cannot connect any of these even while signed in.
	const canConnect = isRadientAuthenticated && oidcStatus.provider === "google";

	return (
		<SettingsSection
			title="Google integrations"
			icon={Puzzle}
			description="Connect your Google services like Gmail, Calendar, and Drive to enhance Local Operator's capabilities."
			dataTourTag="settings-integrations-section"
		>
			{/*
			 * The section itself is borderless, so this card is the only edge in
			 * view and the hairlines are list separators rather than a second box
			 * drawn around each row.
			 */}
			<Card variant="surface" padding="none">
				<ul className="divide-y divide-hairline">
					<IntegrationRow
						serviceName="Gmail"
						icon={Mail}
						scopes={GMAIL_SCOPES}
						grantedScopes={oidcStatus.grantedScopes}
						onConnect={handleConnectService}
						isLoading={oidcLoading}
						isAuthenticated={canConnect}
					/>
					<IntegrationRow
						serviceName="Calendar"
						icon={CalendarDays}
						scopes={CALENDAR_SCOPES}
						grantedScopes={oidcStatus.grantedScopes}
						onConnect={handleConnectService}
						isLoading={oidcLoading}
						isAuthenticated={canConnect}
					/>
					<IntegrationRow
						serviceName="Drive"
						icon={HardDrive}
						scopes={DRIVE_SCOPES}
						grantedScopes={oidcStatus.grantedScopes}
						onConnect={handleConnectService}
						isLoading={oidcLoading}
						isAuthenticated={canConnect}
					/>
				</ul>
			</Card>
		</SettingsSection>
	);
};
