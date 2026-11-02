import "../../../styles/index.css";
import "../../chat/components/story-electron-shim";
import { GlobalScrollbarStyles } from "@shared/components/common/global-scrollbar-styles";
import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect } from "react";
import {
	CAPABILITIES,
	RouteTo,
	installBridge,
	makeProfile,
} from "./agent-class.stories";
import { AgentsPage } from "./agents-page";

/**
 * Reproduce the census's two French states through the actual page and desktop
 * transport, not a hand-drawn error panel. Only the backend is a fixture. The
 * missing record uses the core's structured not-found envelope; its English
 * fallback is intentionally unchanged so the frame catches accidental echoing.
 */
function Scene({ missing }: { missing: boolean }) {
	useLayoutEffect(() => {
		installBridge(
			missing
				? []
				: [
						makeProfile({
							name: "census-agent",
							source: "custom",
							description: "…",
							instructions: "…",
						}),
					],
			{
				capabilities: {
					...CAPABILITIES,
					language: "fr",
					features: {
						...CAPABILITIES.features,
						i18n: 1,
						agents_config: 1,
						session_interrupt: 1,
					},
				},
			},
		);
		const request = window.api.desktop.request;
		window.api.desktop.request = async (input) => {
			if (
				missing &&
				input.op === "profiles.get" &&
				input.name === "census-agent"
			) {
				return {
					status: 404,
					body: {
						detail: {
							code: "wire.errors.desktop.requested_not_found",
							params: {},
							text: "Requested session, profile, team or subscription not found",
						},
					},
				};
			}
			return request(input);
		};
	}, [missing]);
	return (
		<div className="flex h-screen flex-col overflow-hidden bg-canvas">
			<GlobalScrollbarStyles />
			<RouteTo path="/agents?kind=agent&name=census-agent">
				<AgentsPage />
			</RouteTo>
		</div>
	);
}

const meta = {
	title: "Agents/Detail read-state localization",
	// The shared LocaleFrame owns Storybook language, including capability refreshes.
	args: { locale: "fr" },
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const MissingFrench: Story = {
	render: () => <Scene missing />,
};
export const PopulatedFrench: Story = {
	render: () => <Scene missing={false} />,
};
