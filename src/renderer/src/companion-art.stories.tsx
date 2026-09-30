import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { ThemeName } from "@shared/themes";
import type { Meta, StoryObj } from "@storybook/react";
import { type ComponentProps, useState } from "react";
import { BUILTIN_COMPANIONS } from "../../shared/companion-skin";
import type { CompanionMood } from "../../shared/desktop-companion";
import { CompanionArt, type CompanionReaction } from "./companion-art";
import { getCompanionIdleScenes } from "./companion-scenes";

type PreviewProps = ComponentProps<typeof CompanionArt> & { theme?: ThemeName };

const reactions: CompanionReaction[] = [
	"rest",
	"curious",
	"pressed",
	"grabbed",
	"dragging",
	"struggling",
	"falling",
	"landing",
	"happy",
	"loved",
	"waking",
	"listening",
	"dozing",
	"stretching",
	"yawning",
	"daydream",
	"starstruck",
	"peekaboo",
	"peeking",
	"found",
	"playful",
	"cuddle",
	...BUILTIN_COMPANIONS.flatMap(({ id }) => getCompanionIdleScenes(id)),
];

function ArtPreview({ character, mood, reaction, gaze }: PreviewProps) {
	const [replay, setReplay] = useState(0);
	return (
		<div className={cn("flex flex-col gap-6 p-6")}>
			<div className={cn("flex items-center gap-4")}>
				<Button
					variant="secondary"
					onClick={() => setReplay((value) => value + 1)}
				>
					Replay reaction
				</Button>
				<p className={cn("text-body-sm text-ink-muted")}>
					Choose a character, mood and reaction in Controls. Character scenes
					play on their matching character.
				</p>
			</div>
			<div className={cn("flex flex-wrap items-end gap-8")}>
				{[1, 3].map((scale) => (
					<figure key={scale} className={cn("flex flex-col gap-4")}>
						<div style={{ width: 110 * scale, height: 110 * scale }}>
							<div
								className={cn("size-[110px] origin-top-left")}
								style={{ transform: `scale(${scale})` }}
							>
								<CompanionArt
									key={`${character}-${mood}-${reaction}-${replay}`}
									character={character}
									mood={mood}
									reaction={reaction}
									gaze={gaze}
								/>
							</div>
						</div>
						<figcaption className={cn("text-meta text-ink-muted")}>
							{scale === 1 ? "Actual size · 110 px" : "Detail · 3×"}
						</figcaption>
					</figure>
				))}
			</div>
		</div>
	);
}

const meta = {
	title: "Companion/Art",
	component: ArtPreview,
	parameters: { layout: "fullscreen" },
	args: {
		character: BUILTIN_COMPANIONS[0].id,
		mood: "idle",
		reaction: "rest",
		gaze: { x: 0, y: 0 },
	},
	argTypes: {
		character: {
			options: BUILTIN_COMPANIONS.map(({ id }) => id),
			control: {
				type: "select",
				labels: Object.fromEntries(
					BUILTIN_COMPANIONS.map(({ id, name }) => [id, name]),
				),
			},
		},
		mood: {
			control: "select",
			options: [
				"idle",
				"working",
				"attention",
				"complete",
				"error",
				"offline",
			] satisfies CompanionMood[],
		},
		reaction: { control: "select", options: reactions },
		gaze: { control: false, table: { disable: true } },
	},
} satisfies Meta<PreviewProps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = { args: { theme: "localOperatorLight" } };
export const Dark: Story = { args: { theme: "localOperatorDark" } };
