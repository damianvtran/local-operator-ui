/**
 * Component for displaying error output (stderr), in the danger triple.
 *
 * The suggestion box maps well-known failures to a sentence in the user's
 * terms — what happened, what it means, what to do (§ 8). Its links go
 * through the same react-router Link the rest of the app uses; MuiLink was
 * the only reason this file knew about MUI.
 */

import { Info } from "lucide-react";
import type { FC } from "react";
import { Link } from "react-router-dom";

/**
 * Props for the ErrorBlock component
 */
export type ErrorBlockProps = {
	error: string;
	isUser: boolean;
};

const settingsLink = (label = "settings page") => (
	<Link to="/settings" className="text-accent underline underline-offset-2">
		{label}
	</Link>
);

const errorSuggestions: Record<string, React.ReactNode> = {
	"Hosting platform is not configured": (
		<p>
			You haven't selected an AI provider yet. Go to the {settingsLink()} to
			configure it for all your agents. If you don't have an AI provider, you
			can sign in to Radient to get access for free to start.
		</p>
	),
	"Model name is not configured": (
		<p>
			You haven't selected an AI model yet. Go to the {settingsLink()} to select
			a model for all your agents. If you don't have an AI provider, you can
			sign in to Radient to get access for free to start.
		</p>
	),
	"Rate limit": (
		<p>
			You've hit the rate limit for your AI provider. Please try again later or
			get Radient Pass in the {settingsLink()} to access AI models with no rate
			limits at low prices.
		</p>
	),
	"Rate-limit": (
		<p>
			You've hit the rate limit for your AI provider. Please try again later or
			get Radient Pass in the {settingsLink()} to access all AI models with no
			rate limits at low prices.
		</p>
	),
	"Invalid API key": (
		<p>
			Your API key is invalid. Go to the {settingsLink()} to update your API
			key.
		</p>
	),
	"404 models": (
		<p>
			The model you're trying to use is not available. Go to the{" "}
			{settingsLink()} to select a different model, or use Radient to get access
			to hundreds of models with no rate limits
		</p>
	),
	"Call ListModels": (
		<p>
			The model you're trying to use is not available. Go to the{" "}
			{settingsLink()} to select a different model, or use Radient to get access
			to hundreds of models with no rate limits
		</p>
	),
	"Failed to interpret action": (
		<p>
			The model tried to perform an action but was unable to express its intent
			in the required schema. Typically this happens because the model can't
			follow the complex instructions required for agentic AI.
			<br />
			<br />
			Change your model in the {settingsLink()} to fix this. We recommend using
			Radient Automatic to have the best combo of cheap and smart picked for you
			based on your requests (typically cheaper than bringing your own key), or
			use one of the recommended models with a star icon.
		</p>
	),
};

export const ErrorBlock: FC<ErrorBlockProps> = ({ error }) => {
	if (!error || error === "[No error output]") return null;

	const lowercasedTrimmedError = error.trim().toLowerCase();
	let suggestion: React.ReactNode | undefined;
	for (const key in errorSuggestions) {
		if (lowercasedTrimmedError.includes(key.toLowerCase())) {
			suggestion = errorSuggestions[key];
			break;
		}
	}

	return (
		<div className="mb-4 w-full">
			<span className="mb-1 block text-danger text-meta">Error</span>
			<pre className="flex max-h-[200px] w-full flex-col-reverse overflow-auto whitespace-pre-wrap rounded-sm border border-danger-border bg-danger-wash p-3 font-mono text-danger text-mono-sm">
				{error}
			</pre>
			{suggestion && (
				<div className="mt-3 flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface p-3">
					<Info className="size-4 shrink-0 text-ink-muted" aria-hidden={true} />
					<div className="text-body-sm text-ink">{suggestion}</div>
				</div>
			)}
		</div>
	);
};
