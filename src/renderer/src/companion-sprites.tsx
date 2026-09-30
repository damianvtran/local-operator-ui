import { cn } from "@shared/lib/utils";
import { type CSSProperties, useState } from "react";
import hoodieNap from "./assets/companions/hoodie-nap.webp";
import hoodiePaperboat from "./assets/companions/hoodie-paperboat.webp";
import hoodiePeekaboo from "./assets/companions/hoodie-peekaboo.webp";
import hoodiePlay from "./assets/companions/hoodie-play.webp";
import hoodieRelax from "./assets/companions/hoodie-relax.webp";
import hoodieScarf from "./assets/companions/hoodie-scarf.webp";
import inkyBubbles from "./assets/companions/inky-bubbles.webp";
import inkyCamouflage from "./assets/companions/inky-camouflage.webp";
import inkyCuddle from "./assets/companions/inky-cuddle.webp";
import inkyJuggle from "./assets/companions/inky-juggle.webp";
import inkyLeafplay from "./assets/companions/inky-leafplay.webp";
import inkyNap from "./assets/companions/inky-nap.webp";
import inkyPeekaboo from "./assets/companions/inky-peekaboo.webp";
import inkyPlay from "./assets/companions/inky-play.webp";
import inkyShell from "./assets/companions/inky-shell.webp";
import inkySuction from "./assets/companions/inky-suction.webp";
import pixelBalance from "./assets/companions/pixel-balance.webp";
import pixelFirefly from "./assets/companions/pixel-firefly.webp";
import pixelLens from "./assets/companions/pixel-lens.webp";
import pixelNap from "./assets/companions/pixel-nap.webp";
import pixelPeekaboo from "./assets/companions/pixel-peekaboo.webp";
import pixelPlay from "./assets/companions/pixel-play.webp";
import sproutBloom from "./assets/companions/sprout-bloom.webp";
import sproutDew from "./assets/companions/sprout-dew.webp";
import sproutNap from "./assets/companions/sprout-nap.webp";
import sproutPeekaboo from "./assets/companions/sprout-peekaboo.webp";
import sproutPlay from "./assets/companions/sprout-play.webp";
import sproutSpin from "./assets/companions/sprout-spin.webp";
import type { BuiltinCompanionCharacter } from "./companion-art";
import { type CompanionScene, getCompanionScene } from "./companion-scenes";
import "./companion-sprites.css";

export type CompanionSpriteAction =
	| "peekaboo"
	| "peeking"
	| "found"
	| "playful"
	| "dozing"
	| "waking"
	| CompanionScene;

const stories: Record<
	CompanionScene,
	{ source: string; offsets: number[]; x: number | number[]; scale: string }
> = {
	suction: {
		source: inkySuction,
		offsets: [-4.13, -4.13, -4.13, -4.13, -0.77, -1.0, -1.0, -1.0],
		x: [-0.85, -0.85, -0.85, -0.85, 2.67, 2.67, 2.67, 2.67],
		scale: "0.949, 0.992",
	},
	camouflage: {
		source: inkyCamouflage,
		offsets: [-1.29, -1.29, -1.52, -1.52, -1.06, -1.29, -1.29, -1.29],
		x: -0.44,
		scale: "0.978, 1.018",
	},
	bloom: {
		source: sproutBloom,
		offsets: [-3.56, -3.56, -3.56, -3.56, -0.97, -0.97, -0.97, -0.97],
		x: -0.31,
		scale: "0.997, 1.038",
	},
	dew: {
		source: sproutDew,
		offsets: [-2.36, -2.6, -2.6, -2.6, 3.44, 3.44, 3.44, 3.44],
		x: -0.09,
		scale: "1.014, 1.028",
	},
	firefly: {
		source: pixelFirefly,
		offsets: [-0.31, -0.31, -0.31, -0.31, 0.59, 0.59, 0.59, 0.59],
		x: [1.97, 1.97, 1.97, 1.97, -1.77, -1.77, -1.77, -1.77],
		scale: "0.922, 0.995",
	},
	lens: {
		source: pixelLens,
		offsets: [0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12],
		x: 0.0,
		scale: "0.939, 1.002",
	},
	scarf: {
		source: hoodieScarf,
		offsets: [-2.74, -2.74, -2.74, -2.74, -0.27, -0.5, -0.27, -0.27],
		x: 0.07,
		scale: "0.972, 0.991",
	},
	paperboat: {
		source: hoodiePaperboat,
		offsets: [-3.28, -3.28, -3.5, -3.5, -1.98, -1.98, -1.98, -1.98],
		x: [-1.83, -1.83, -1.83, -1.83, 3.55, 3.55, 3.55, 3.55],
		scale: "0.937, 0.963",
	},
	relax: {
		source: hoodieRelax,
		offsets: [-2.7, -2.48, -4.25, -4.25, 3.51, 3.95, 3.51, -0.04],
		x: -1.01,
		scale: "0.958, 0.981",
	},
	balance: {
		source: pixelBalance,
		offsets: [0.86, 0.86, 0.86, 0.86, 0.86, 0.86, 0.86, 0.86],
		x: -0.2,
		scale: "0.910, 0.974",
	},
	spin: {
		source: sproutSpin,
		offsets: [-2.18, -2.18, -2.65, -2.18, 1.85, 2.8, 2.8, 2.8],
		x: -0.08,
		scale: "1.055, 1.047",
	},
	juggle: {
		source: inkyJuggle,
		offsets: [-4.22, -3.99, -4.46, -4.22, 0.52, 0.29, 1.24, -0.9],
		x: 0.78,
		scale: "0.986, 1.052",
	},
	bubbles: {
		source: inkyBubbles,
		offsets: [-0.9, -0.9, -0.66, -0.66, -0.88, -0.88, -0.88, -0.88],
		x: 1.26,
		scale: "1.014, 1.041",
	},
	leafplay: {
		source: inkyLeafplay,
		offsets: [0.25, 0.25, 0.01, 0.01, 1.71, 1.71, 1.71, 1.71],
		x: 0.94,
		scale: "1.04, 1.068",
	},
	shell: {
		source: inkyShell,
		offsets: [-1.48, -1.7, -1.7, -1.7, -1.7, -1.7, -1.7, -1.7],
		x: 0.89,
		scale: "0.989, 1.001",
	},
	cuddle: {
		source: inkyCuddle,
		offsets: [-0.88, -0.65, -0.88, -0.88, -0.41, -0.41, -0.87, -1.11],
		x: -0.11,
		scale: "0.981, 1.039",
	},
};

const sheets = {
	sprout: { peekaboo: sproutPeekaboo, playful: sproutPlay, nap: sproutNap },
	hoodie: { peekaboo: hoodiePeekaboo, playful: hoodiePlay, nap: hoodieNap },
	inky: { peekaboo: inkyPeekaboo, playful: inkyPlay, nap: inkyNap },
	pixel: { peekaboo: pixelPeekaboo, playful: pixelPlay, nap: pixelNap },
};

// Register the generated rows to a shared floor without changing the source art.
const offsets = {
	inky: {
		peekaboo: [-3.1, -4.2, -4, -3.6, -3.6, -3.1, -2.9, -3.1],
		playful: [-3.6, -3.3, -3.3, -3.3, 4.1, 4.1, 3.4, 3.4],
		nap: [-4.2, -2.9, -1.3, -0.4, -0.2, -2.2, -1.1, -3.6],
	},
	sprout: {
		peekaboo: [-4.4, -4.4, -4.4, -4.4, 1.9, 1.9, 1.9, 1.9],
		playful: [-4.4, -4.4, -4.4, -4.4, 3.5, 3.5, 3.5, 3.5],
		nap: [-1.9, -1.9, -1.9, -1.9, 4.6, 4.6, 4.6, 4.6],
	},
	hoodie: {
		peekaboo: [-4, -4, -4, -4, 0, 0, 0, 0],
		playful: [-4, -4, -4, -4, 1, 1, 1, 1],
		nap: [-4, -4, -4, -4, 1.2, 1.2, 1.2, 1.2],
	},
	pixel: {
		peekaboo: [0, 0, 0, 2, 7.5, 7.5, 0, 0],
		playful: [0, 0, 0, 0, 0, 0, 0, 0],
		nap: [-1, -1, -1, 2, 3.8, 3.8, 3.8, 3.8],
	},
};

const restingRegistration = {
	inky: {
		peekaboo: "translate(-0.1%, -2.9%) scale(0.942, 0.981)",
		playful: "translate(-0.65%, 2.5%) scale(1.013, 1.096)",
		nap: "translate(-0.9%, -3.4%) scale(0.957, 0.976)",
	},
	sprout: {
		peekaboo: "translate(0.77%, 4.03%) scale(1.015, 1.076)",
		playful: "translate(-0.38%, 5.65%) scale(1.056, 1.061)",
		nap: "translate(0.98%, 6.59%) scale(1.105, 1.058)",
	},
	hoodie: {
		peekaboo: "translate(0.01%, -0.34%) scale(0.920, 1.013)",
		playful: "translate(-1.30%, -1.63%) scale(0.970, 0.983)",
		nap: "translate(0.64%, 1.03%) scale(0.932, 0.988)",
	},
	pixel: {
		peekaboo: "translate(-0.46%, 0.66%) scale(0.915, 1.013)",
		playful: "translate(0.78%, 0.51%) scale(0.920, 0.982)",
		nap: "translate(-0.05%, 3.87%) scale(0.898, 1.031)",
	},
};

export function CompanionSprite({
	character,
	action,
}: { character: BuiltinCompanionCharacter; action: CompanionSpriteAction }) {
	const [ready, setReady] = useState(false);
	const story = getCompanionScene(character, action)
		? stories[action as CompanionScene]
		: undefined;
	const sheet =
		action === "dozing" || action === "waking"
			? "nap"
			: action === "playful"
				? "playful"
				: "peekaboo";
	const registration = Object.fromEntries(
		(story?.offsets ?? offsets[character][sheet]).map((y, i) => [
			`--sprite-offset-${i}`,
			story
				? `translate(${Array.isArray(story.x) ? story.x[i] : story.x}%, ${y}%) scale(${story.scale})`
				: i === 7
					? restingRegistration[character][sheet]
					: `translate(${sheet === "nap" && i === 4 ? (character === "hoodie" ? -3 : character === "pixel" ? -1.5 : 0) : 0}%, ${y}%)`,
		]),
	) as CSSProperties;
	return (
		<span
			className={cn("companion-sprite")}
			data-action={action}
			data-story={story ? action : undefined}
			data-ready={ready || undefined}
			style={registration}
		>
			<span className={cn("companion-sprite-motion")}>
				<span className={cn("companion-sprite-frame")}>
					<img
						className={cn("companion-sprite-sheet")}
						src={story?.source ?? sheets[character][sheet]}
						alt=""
						draggable={false}
						onLoad={() => setReady(true)}
					/>
				</span>
			</span>
		</span>
	);
}
