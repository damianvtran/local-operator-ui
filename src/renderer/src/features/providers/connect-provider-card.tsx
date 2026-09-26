/**
 * @file connect-provider-card.tsx
 * @description
 * What an empty chat says when no model provider is connected (design audit
 * § 6, UX U2/U9).
 *
 * The empty chat used to look identical whether or not anything could answer:
 * a greeting, an enabled composer and four suggestion chips, with the truth
 * arriving only after a send, as a sentence naming a Settings path to type
 * out. This card replaces the chips in exactly that state, and its action
 * opens the provider list in a dialog over the chat -- the user never leaves
 * the conversation they were about to start.
 *
 * Presentational only (no hooks beyond the store's setter), so the composer's
 * Node-rendered tests can mount it without a query client.
 */

import { Button } from "@shared/components/ui";
import { Plug } from "lucide-react";
import type { FC } from "react";
import { useConnectProviderStore } from "./connect-provider-store";

export const ConnectProviderCard: FC = () => {
	const openConnect = useConnectProviderStore((state) => state.openConnect);
	return (
		<section
			aria-labelledby="connect-provider-card-title"
			className="flex w-full flex-col gap-3 rounded-[14px] bg-surface p-6"
			data-connect-provider-card=""
		>
			<Plug size={20} className="text-ink-muted" aria-hidden="true" />
			<div className="flex flex-col gap-1">
				<h3 id="connect-provider-card-title" className="text-heading text-ink">
					Connect a model provider to start
				</h3>
				<p className="text-body-sm text-ink-muted">
					Sign in with Claude, ChatGPT or Radient, or add an API key. It takes
					about a minute.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="primary" size="md" onClick={() => openConnect()}>
					Connect a provider
				</Button>
				<Button
					variant="ghost"
					size="md"
					onClick={() => openConnect({ group: "local" })}
				>
					Use a model on this computer
				</Button>
			</div>
		</section>
	);
};

/**
 * The composer's status line in the same state: one quiet sentence and a
 * link-weight action, so the reason Send will not work is on screen before
 * the user types, not after.
 */
export const NoProviderLine: FC = () => {
	const openConnect = useConnectProviderStore((state) => state.openConnect);
	return (
		<p
			className="flex items-center gap-1 text-ink-dim text-meta"
			data-no-provider-line=""
		>
			No model provider connected ·
			<Button variant="link" size="sm" onClick={() => openConnect()}>
				Connect
			</Button>
		</p>
	);
};
