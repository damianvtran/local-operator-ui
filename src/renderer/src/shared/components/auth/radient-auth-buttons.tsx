/**
 * @file radient-auth-buttons.tsx
 * @description
 * Reusable component for Radient authentication buttons.
 * Provides options for users to sign in with Google or Microsoft.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { useOidcAuth } from "@shared/hooks/use-oidc-auth";
import type { FC } from "react";

/**
 * Props for the RadientAuthButtons component
 */
type RadientAuthButtonsProps = {
	/**
	 * Optional callback function to be called after successful sign-in
	 */
	onSignInSuccess?: () => void;
	/**
	 * Optional callback to be called after RADIENT_API_KEY is set/updated.
	 * Use this to force a model refresh and/or credentials refetch after Radient sign-in.
	 */
	onAfterCredentialUpdate?: () => void;
	/**
	 * Optional title text to display above the buttons
	 */
	titleText?: string;
	/**
	 * Optional description text to display above the buttons
	 */
	descriptionText?: string;
};

// lucide ships no brand marks and the FontAwesome brand pack that used to supply
// these is gone, so the two provider logos are inlined. They are decorative:
// each button already carries a text label, hence aria-hidden.
const GoogleMark: FC = () => (
	<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
		<path
			fill="#4285F4"
			d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
		/>
		<path
			fill="#34A853"
			d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
		/>
		<path
			fill="#FBBC05"
			d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
		/>
		<path
			fill="#EA4335"
			d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
		/>
	</svg>
);

const MicrosoftMark: FC = () => (
	<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
		<path fill="#F25022" d="M1 1h10v10H1z" />
		<path fill="#7FBA00" d="M12 1h10v10H12z" />
		<path fill="#00A4EF" d="M1 12h10v10H1z" />
		<path fill="#FFB900" d="M12 12h10v10H12z" />
	</svg>
);

/**
 * RadientAuthButtons component
 *
 * Provides buttons for signing in with Google or Microsoft to access Radient services.
 */
export const RadientAuthButtons: FC<RadientAuthButtonsProps> = ({
	onSignInSuccess,
	onAfterCredentialUpdate,
	titleText = "Sign in to Radient",
	descriptionText = "Choose your preferred sign-in method to access Radient services.",
}) => {
	const { signInWithGoogle, signInWithMicrosoft, loading, error } = useOidcAuth(
		{
			onAfterCredentialUpdate,
			onSuccess: onSignInSuccess,
		},
	);

	return (
		<div className="mx-auto w-full max-w-80">
			{titleText && (
				<p className="mb-2 text-center text-heading text-ink">{titleText}</p>
			)}
			{descriptionText && (
				<p className="mb-6 text-center text-body-sm text-ink-muted">
					{descriptionText}
				</p>
			)}
			<div className="flex w-full flex-col items-center gap-3">
				{/*
				 * Google is the accent, Microsoft is not. Both are the same action, so
				 * a second filled button would spend the accent twice and still give
				 * the reader no hierarchy to read.
				 */}
				<Button
					variant="primary"
					size="lg"
					className="w-full max-w-80"
					onClick={signInWithGoogle}
					disabled={loading}
				>
					{loading ? <Spinner size="sm" /> : <GoogleMark />}
					Sign in with Google
				</Button>

				<Button
					variant="secondary"
					size="lg"
					className="w-full max-w-80"
					onClick={signInWithMicrosoft}
					disabled={loading}
				>
					{loading ? <Spinner size="sm" /> : <MicrosoftMark />}
					Sign in with Microsoft
				</Button>

				{error && (
					<p className="mt-4 text-center text-body-sm text-danger">
						Error signing in: {error}
					</p>
				)}
			</div>
		</div>
	);
};
