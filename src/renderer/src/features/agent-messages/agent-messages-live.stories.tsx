import { useRadientUserQuery } from "@shared/hooks/use-radient-user-query";
import { useAgentMessagesOnboardingStore } from "@shared/store/agent-messages-onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { AgentMessagesOnboarding } from "./agent-messages-onboarding";
import {
	checkAgentMessagesSurface,
	useAgentMessages,
} from "./use-agent-messages";

/** This story is a LOCAL QA fixture, never an app route or a source of auth.
 * It mounts the actual account/status hooks, controller and dialog. Requests
 * use the repository's typed Node desktop proxy with no renderer bearer/JWT.
 * Native IPC, issuer OAuth and daemon lifespan are deliberately not claimed.
 */
interface LiveProps {
	scenario: string;
	mode: string;
	theme?: string;
}
async function fixtureControl(
	action: string,
	fields: Record<string, string> = {},
) {
	const response = await fetch("/__u1/control", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action, ...fields }),
	});
	if (!response.ok) throw new Error("Isolated fixture setup unavailable");
	return response.json() as Promise<{
		account_id: string;
		session_id: string | null;
	}>;
}
function ActualController({
	scenario,
	sessionId,
}: { scenario: string; sessionId: string | null }) {
	const { accountId, snapshot } = useAgentMessages();
	const { refreshUser } = useRadientUserQuery();
	const seen = useAgentMessagesOnboardingStore((state) => state.seen);
	const [blocked, setBlocked] = useState(scenario === "overlay");
	const [evidence, setEvidence] = useState<unknown>(null);
	useEffect(() => {
		// Fixture-auth notification only; no eligibility, connector or inbox poll.
		// The identity still comes from the real supported account read afterward.
		const events = new EventSource("/__u1/events");
		events.onmessage = () => {
			void refreshUser();
		};
		return () => events.close();
	}, [refreshUser]);
	useEffect(() => {
		void fetch("/__u1/evidence")
			.then((response) => response.json())
			.then((server) =>
				setEvidence({
					server,
					client: { seen, confirmed: snapshot.confirmed },
				}),
			);
	}, [seen, snapshot.confirmed]);
	useEffect(() => {
		// Observe rendered geometry, not a planned stylesheet box. No interaction
		// is scripted here; Enable and dismissal are driven by the browser tool.
		let previous = "";
		const measure = () => {
			const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
			const consent = document.querySelector<HTMLElement>(
				"[data-agent-messages-consent-version]",
			);
			const rect = (element: HTMLElement | null) => {
				if (!element) return null;
				const box = element.getBoundingClientRect();
				return {
					x: box.x,
					y: box.y,
					width: box.width,
					height: box.height,
					bottom: box.bottom,
				};
			};
			const data = {
				accountId,
				pending: snapshot.pending,
				confirmed: snapshot.confirmed,
				viewport: {
					width: innerWidth,
					height: innerHeight,
					reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
				},
				dialog: rect(dialog),
				dialogClientHeight: dialog?.clientHeight ?? null,
				dialogScrollHeight: dialog?.scrollHeight ?? null,
				consent: rect(consent),
				consentVersion: consent?.dataset.agentMessagesConsentVersion ?? null,
				linksInConsent: consent?.querySelectorAll("a,iframe,img").length ?? 0,
				buttons: dialog
					? [...dialog.querySelectorAll<HTMLButtonElement>("button")].map(
							(button) => ({
								text: button.textContent,
								disabled: button.disabled,
								rect: rect(button),
							}),
						)
					: [],
			};
			const serialized = JSON.stringify(data);
			if (serialized === previous) return;
			previous = serialized;
			void fetch("/__u1/geometry", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: serialized,
			});
		};
		const observer = new MutationObserver(measure);
		observer.observe(document.body, { childList: true, subtree: true });
		measure();
		return () => observer.disconnect();
	}, [accountId, snapshot.pending, snapshot.confirmed]);
	return (
		<div className="min-h-screen bg-surface p-6 text-text-primary">
			<h1 className="text-base">Local U1 consent fixture</h1>
			<p className="text-sm text-text-secondary">
				Actual controller and local HTTP. Synthetic identity. No native IPC or
				issuer OAuth.
			</p>
			<output data-u1-account>{accountId ?? "Account not ready"}</output>
			<pre data-u1-state className="text-xs">
				{JSON.stringify(
					{
						checking: snapshot.checking,
						pending: snapshot.pending,
						confirmed: snapshot.confirmed,
						surface: snapshot.status?.surface_state,
						seen,
					},
					null,
					2,
				)}
			</pre>
			<div className="flex gap-2">
				<button type="button" onClick={() => void checkAgentMessagesSurface()}>
					Open surface again
				</button>
				<button type="button" onClick={() => setBlocked(!blocked)}>
					Toggle existing overlay priority
				</button>
				<button type="button" onClick={() => void fixtureControl("hold")}>
					Hold genuine response for auth-switch fixture
				</button>
			</div>
			<details>
				<summary>Content-free persistence evidence</summary>
				<pre>{JSON.stringify(evidence, null, 2)}</pre>
			</details>
			<AgentMessagesOnboarding blocked={blocked} sessionId={sessionId} />
		</div>
	);
}
function LiveGallery({ scenario, mode }: LiveProps) {
	const [ready, setReady] = useState<{
		account_id: string;
		session_id: string | null;
	} | null>(null);
	const [failure, setFailure] = useState(false);
	useEffect(() => {
		let current = true;
		if (import.meta.env.VITE_U1_LIVE_GALLERY !== "true") return;
		// Preserve already-proven native PKCE credentials for the initial cohort;
		// fixture selection is only needed for a different case or explicit fault.
		const bootstrap = async () => {
			const currentEvidence = await fetch("/__u1/evidence").then((response) =>
				response.json(),
			);
			if (mode === "normal" && currentEvidence.scenario === scenario) {
				return {
					account_id: currentEvidence.account_id as string,
					session_id: scenario === "enable-draft" ? "draft:u1-synthetic" : null,
				};
			}
			return fixtureControl("select", { scenario, mode });
		};
		void bootstrap()
			.then((value) => {
				if (current) setReady(value);
			})
			.catch(() => {
				if (current) setFailure(true);
			});
		return () => {
			current = false;
		};
	}, [scenario, mode]);
	if (import.meta.env.VITE_U1_LIVE_GALLERY !== "true")
		return <p>Isolated live fixture is not running.</p>;
	if (failure)
		return <p>Isolated fixture setup failed. No consent operation was sent.</p>;
	if (!ready) return null;
	return <ActualController scenario={scenario} sessionId={ready.session_id} />;
}
const meta = {
	title: "Agent messages/Live consent",
	component: LiveGallery,
	parameters: {
		layout: "fullscreen",
		viewport: {
			defaultViewport: "bridgeFit",
			viewports: {
				bridgeFit: {
					name: "Consent fit 1024 × 673",
					styles: { width: "1024px", height: "673px" },
				},
			},
		},
	},
	args: { scenario: "enable-offchat", mode: "normal" },
} satisfies Meta<typeof LiveGallery>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RealLocalFlow: Story = {};
