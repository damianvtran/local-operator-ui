/**
 * Welcome Step Component
 *
 * First step in the onboarding process. Says what the next few minutes cover,
 * in the order they happen, and nothing else.
 */

import { Bot, KeyRound, Search, Sparkles, UserRound } from "lucide-react";
import type { FC } from "react";

const SETUP_STEPS = [
	{ icon: UserRound, label: "Set up your profile" },
	{ icon: KeyRound, label: "Add a model provider credential" },
	{ icon: Search, label: "Turn on web search" },
	{ icon: Bot, label: "Pick a default model" },
	{ icon: Sparkles, label: "Create your first assistant" },
] as const;

/**
 * Welcome step in the onboarding process
 */
export const WelcomeStep: FC = () => {
	return (
		<div className="flex flex-col gap-6">
			<p className="text-body text-ink">
				Let's set up your AI environment so your agents have what they need to
				work.
			</p>

			<div className="flex flex-col gap-4">
				<h3 className="text-heading text-ink">This setup covers</h3>
				{/* A list, so it is announced as one and its length is known up front.
				    No icon plates: the glyph is a marker beside the line, not an
				    object of its own. */}
				<ul className="flex flex-col gap-3">
					{SETUP_STEPS.map(({ icon: Icon, label }) => (
						<li key={label} className="flex items-center gap-3 text-body">
							<Icon
								size={16}
								className="shrink-0 text-ink-dim"
								aria-hidden="true"
							/>
							{label}
						</li>
					))}
				</ul>
			</div>

			<p className="text-body-sm text-ink-muted">
				You can change any of this later in Settings.
			</p>
		</div>
	);
};
