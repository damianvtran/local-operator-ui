/**
 * Evidence harness for R2 (review round 3, PR #102).
 *
 * See `r2-system-prompt.html` for why this exists. The short version: the
 * refusal, the swallow and the edit state live in three different files, and
 * only a mounted render proves the three agree. This mounts the SHIPPED
 * `SystemPromptSettings` -- not a copy of it -- behind an injected
 * `window.api.desktop`, so the renderer takes the Electron IPC branch that
 * ships and the pre-flight in `useUpdateAgentSystemPrompt` is the real one.
 *
 * The bridge answers `legacy.agent.systemPrompt.update` with a 200, so nothing
 * on the server side can be credited for the refusal: if the editor keeps the
 * user's text, it is the client pre-flight that refused it. Every request the
 * bridge sees is recorded on `window.__r2` so the driver can assert that an
 * oversize prompt produced NO update call at all.
 */

import { SystemPromptSettings } from "@features/agents/components/system-prompt-settings";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "@renderer/styles/index.css";

/** The prompt the fake agent starts with, and the value a refusal must restore to. */
const ORIGINAL_PROMPT = "You are a helpful agent.";

/** Every op the bridge answered, so the driver can prove no request was made. */
const seen: { op: string; chars: number }[] = [];
(window as unknown as { __r2: unknown }).__r2 = {
	requests: seen,
	originalPrompt: ORIGINAL_PROMPT,
};

// Installed before any surface mounts: `window.api.desktop` existing is what
// routes the renderer down the IPC branch instead of the browser-dev HTTP one.
(window as unknown as { api: unknown }).api = {
	desktop: {
		request: async (request: { op: string; systemPrompt?: string }) => {
			seen.push({ op: request.op, chars: request.systemPrompt?.length ?? 0 });
			if (request.op === "legacy.agent.systemPrompt.get") {
				return {
					status: 200,
					body: { status: 200, result: { system_prompt: ORIGINAL_PROMPT } },
				};
			}
			// `useAgentSystemPrompt` runs behind `useConnectivityGate`, which reads
			// `config.values.hosting`. An envelope without `values` crashes the
			// component before it renders - and an unmounted surface would read as
			// "the editor kept nothing", the exact false pass this harness exists to
			// avoid. `ollama` so the gate does not additionally demand internet.
			if (request.op === "config.get") {
				return {
					status: 200,
					body: {
						status: 200,
						result: {
							values: { hosting: "ollama", model_name: "llama3" },
						},
					},
				};
			}
			// Deliberately a SUCCESS. A refusal that still reaches this point would
			// be reported as saved, so the harness cannot be accused of staging the
			// failure it is meant to detect.
			return { status: 200, body: { status: 200, result: {} } };
		},
	},
};

// React Query pauses refetching in a hidden tab, which would silently defeat a
// headless capture run.
Object.defineProperty(document, "visibilityState", {
	configurable: true,
	get: () => "visible",
});
Object.defineProperty(document, "hidden", {
	configurable: true,
	get: () => false,
});

const client = new QueryClient({
	defaultOptions: {
		queries: { retry: false, refetchOnWindowFocus: false, retryOnMount: false },
	},
});

const agent = {
	id: "r2-agent",
	name: "R2 fixture agent",
	created_date: new Date(0).toISOString(),
	version: "1.0.0",
	security_prompt: "",
	hosting: "openrouter",
	model: "openai/gpt-4o-mini",
	description: "Fixture for the R2 refusal cycle.",
} as AgentDetails;

const Harness = () => {
	const [savingField, setSavingField] = useState<string | null>(null);
	return (
		<div className="p-8">
			<SystemPromptSettings
				selectedAgent={agent}
				savingField={savingField}
				setSavingField={setSavingField}
				initialSelectedAgentId={agent.id}
			/>
		</div>
	);
};

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={client}>
			<Harness />
		</QueryClientProvider>
	</StrictMode>,
);
