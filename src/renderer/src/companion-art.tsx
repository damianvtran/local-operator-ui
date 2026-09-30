import { cn } from "@shared/lib/utils";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { BuiltinCompanionCharacter } from "../../shared/companion-skin";
import type { CompanionMood } from "../../shared/desktop-companion";
import hoodieMotion from "./assets/companions/hoodie-motion.webp";
import hoodie from "./assets/companions/hoodie.webp";
import inkyMotion from "./assets/companions/inky-motion.webp";
import inky from "./assets/companions/inky.webp";
import pixel from "./assets/companions/pixel.webp";
import sprout from "./assets/companions/sprout.webp";
import {
	type CompanionScene,
	getCompanionReactionDuration,
	getCompanionScene,
} from "./companion-scenes";
import {
	CompanionSprite,
	type CompanionSpriteAction,
} from "./companion-sprites";
import "./companion-art.css";

export type { BuiltinCompanionCharacter } from "../../shared/companion-skin";
export type CompanionReaction =
	| "rest"
	| "curious"
	| "pressed"
	| "grabbed"
	| "dragging"
	| "struggling"
	| "falling"
	| "happy"
	| "loved"
	| "waking"
	| "listening"
	| "landing"
	| "dozing"
	| "stretching"
	| "yawning"
	| "daydream"
	| "starstruck"
	| "peekaboo"
	| "peeking"
	| "found"
	| "playful"
	| CompanionScene;

const artwork: Record<BuiltinCompanionCharacter, string> = {
	sprout,
	hoodie,
	pixel,
	inky,
};

const physicalReactions = new Set<CompanionReaction>([
	"grabbed",
	"dragging",
	"struggling",
	"falling",
	"landing",
]);

interface CompanionArtProps {
	character: BuiltinCompanionCharacter;
	mood: CompanionMood;
	gaze: { x: number; y: number };
	reaction: CompanionReaction;
}

interface ExpressionProps {
	mood: CompanionMood;
	pixels: boolean;
	reaction: CompanionReaction;
}

type EyeShape =
	| "round"
	| "small"
	| "line"
	| "caret"
	| "arch"
	| "closed"
	| "heart"
	| "star"
	| "ring"
	| "squeeze"
	| "crossed";
type MouthShape =
	| "smile"
	| "grin"
	| "cat"
	| "oh"
	| "pout"
	| "none"
	| "flat"
	| "slight smile"
	| "slight frown"
	| "whistle"
	| "tongue"
	| "side tongue"
	| "puff"
	| "bite";
interface FaceBeat {
	name: string;
	eyes: [EyeShape, EyeShape];
	mouth: MouthShape;
	openness?: [number, number];
	brows?: [number, number];
	glance?: [number, number];
	cheeks?: boolean | "puffed";
	duration?: number;
	weight?: number;
	attentive?: boolean;
	settle?: boolean;
}

const faceBeats: FaceBeat[] = [
	{
		name: "warm",
		eyes: ["round", "round"],
		mouth: "smile",
		attentive: true,
		duration: 4200,
	},
	{
		name: "caret joy",
		eyes: ["caret", "caret"],
		mouth: "grin",
		duration: 2300,
	},
	{
		name: "left wink",
		eyes: ["arch", "round"],
		mouth: "slight smile",
		duration: 1200,
		weight: 1.25,
		settle: true,
	},
	{
		name: "content",
		eyes: ["closed", "closed"],
		mouth: "slight smile",
		duration: 3800,
		attentive: true,
	},
	{
		name: "adoring",
		eyes: ["heart", "heart"],
		mouth: "cat",
		cheeks: true,
		duration: 2100,
		weight: 2,
	},
	{
		name: "curious",
		eyes: ["round", "round"],
		mouth: "slight smile",
		openness: [1.08, 1],
		brows: [-1, 0],
		glance: [-1, -0.5],
		attentive: true,
		duration: 3600,
	},
	{
		name: "beaming",
		eyes: ["arch", "arch"],
		mouth: "grin",
		cheeks: true,
		duration: 2500,
	},
	{
		name: "right wink",
		eyes: ["round", "arch"],
		mouth: "slight smile",
		duration: 1200,
		weight: 1.25,
		settle: true,
	},
	{
		name: "starry",
		eyes: ["star", "star"],
		mouth: "grin",
		duration: 1800,
		weight: 2,
	},
	{
		name: "tiny happy",
		eyes: ["small", "small"],
		mouth: "cat",
		cheeks: true,
		glance: [0, 2],
		duration: 2500,
	},
	{
		name: "skeptical",
		eyes: ["round", "round"],
		mouth: "none",
		brows: [0, -1],
		glance: [1, 0],
		duration: 1500,
		weight: 1,
		settle: true,
	},
	{
		name: "cat smile",
		eyes: ["caret", "caret"],
		mouth: "cat",
		attentive: true,
	},
	{
		name: "smitten",
		eyes: ["heart", "caret"],
		mouth: "smile",
		cheeks: true,
		duration: 1900,
		weight: 2,
	},
	{
		name: "bashful",
		eyes: ["small", "arch"],
		mouth: "cat",
		glance: [-2, 2],
		cheeks: true,
		duration: 2400,
	},
	{
		name: "amazed",
		eyes: ["ring", "ring"],
		mouth: "oh",
		brows: [-3, -3],
		duration: 1400,
		weight: 1,
	},
	{
		name: "goofy",
		eyes: ["round", "small"],
		mouth: "smile",
		glance: [1, 0],
		duration: 1400,
		weight: 1,
		settle: true,
	},
	{
		name: "giggle",
		eyes: ["squeeze", "squeeze"],
		mouth: "grin",
		cheeks: true,
		duration: 1800,
		weight: 2,
	},
	{
		name: "dreamy",
		eyes: ["closed", "closed"],
		mouth: "smile",
		duration: 2600,
	},
	{
		name: "twinkle",
		eyes: ["star", "round"],
		mouth: "slight smile",
		duration: 1900,
		weight: 2,
		settle: true,
	},
	{
		name: "proud",
		eyes: ["round", "round"],
		mouth: "slight smile",
		openness: [1, 1],
		attentive: true,
		cheeks: true,
		duration: 3800,
	},
	{
		name: "puzzled",
		eyes: ["small", "ring"],
		mouth: "oh",
		brows: [1, -3],
		glance: [2, -1],
		duration: 1400,
		weight: 1,
	},
	{
		name: "soft smile",
		eyes: ["round", "round"],
		mouth: "slight smile",
		openness: [0.95, 0.95],
		duration: 4200,
		attentive: true,
	},
	{
		name: "little pout",
		eyes: ["small", "small"],
		mouth: "pout",
		brows: [2, 2],
		duration: 1000,
		weight: 0.5,
	},
	{
		name: "sheepish",
		eyes: ["line", "small"],
		mouth: "cat",
		cheeks: true,
		brows: [0, -2],
		duration: 2200,
	},
	{
		name: "wistful",
		eyes: ["round", "round"],
		mouth: "pout",
		openness: [0.65, 0.8],
		brows: [2, -1],
		glance: [-2, 1],
		duration: 1100,
		weight: 0.5,
	},
	{
		name: "mischievous",
		eyes: ["caret", "round"],
		mouth: "smile",
		duration: 1400,
		weight: 1,
		settle: true,
	},
	{
		name: "quiet",
		eyes: ["round", "round"],
		mouth: "none",
		openness: [1, 1],
		duration: 4600,
		attentive: true,
	},
	{
		name: "neutral",
		eyes: ["round", "round"],
		mouth: "flat",
		openness: [1, 1],
		duration: 4000,
		attentive: true,
	},
	{
		name: "little smile",
		eyes: ["round", "round"],
		mouth: "slight smile",
		openness: [1, 1],
		duration: 4400,
		attentive: true,
	},
	{
		name: "hmm",
		eyes: ["round", "small"],
		mouth: "slight frown",
		brows: [0, -2],
		glance: [2, 0],
		duration: 1600,
		weight: 1,
	},
	{
		name: "whistling",
		eyes: ["closed", "closed"],
		mouth: "whistle",
		glance: [1, 0],
		duration: 2700,
		weight: 2,
	},
	{
		name: "blep",
		eyes: ["round", "small"],
		mouth: "tongue",
		openness: [0.9, 1],
		duration: 1200,
		weight: 0.75,
		settle: true,
	},
	{
		name: "cross-eyed glance",
		eyes: ["crossed", "crossed"],
		mouth: "slight smile",
		brows: [-1, -1],
		duration: 1000,
		weight: 0.5,
		settle: true,
	},
	{
		name: "cheeky wink",
		eyes: ["arch", "round"],
		mouth: "side tongue",
		cheeks: true,
		duration: 1400,
		weight: 0.75,
		settle: true,
	},
	{
		name: "puffed cheeks",
		eyes: ["round", "round"],
		mouth: "puff",
		openness: [0.75, 0.75],
		cheeks: "puffed",
		duration: 1500,
		weight: 1,
		settle: true,
	},
	{
		name: "one brow up",
		eyes: ["round", "round"],
		mouth: "slight smile",
		openness: [1, 1.05],
		brows: [0, -2],
		glance: [-1, 0],
		duration: 1600,
		weight: 1,
		settle: true,
	},
	{
		name: "shy nibble",
		eyes: ["small", "closed"],
		mouth: "bite",
		glance: [-2, 1],
		cheeks: true,
		duration: 1500,
		weight: 1,
		settle: true,
	},
];

const faceHabits: Record<
	BuiltinCompanionCharacter,
	{ favorites: string[]; after: Record<string, string[]> }
> = {
	sprout: {
		favorites: [
			"curious",
			"beaming",
			"content",
			"dreamy",
			"whistling",
			"little smile",
		],
		after: {
			curious: ["beaming", "amazed"],
			beaming: ["content", "soft smile"],
			amazed: ["caret joy"],
			whistling: ["content", "dreamy"],
			"one brow up": ["curious", "content"],
		},
	},
	hoodie: {
		favorites: [
			"bashful",
			"soft smile",
			"warm",
			"content",
			"little smile",
			"shy nibble",
		],
		after: {
			"right wink": ["bashful"],
			bashful: ["soft smile", "smitten"],
			smitten: ["little smile"],
			"little pout": ["sheepish"],
			"shy nibble": ["soft smile", "little smile"],
		},
	},
	inky: {
		favorites: ["curious", "bashful", "smitten", "giggle", "whistling", "blep"],
		after: {
			curious: ["bashful", "amazed"],
			bashful: ["little smile", "smitten"],
			smitten: ["giggle"],
			whistling: ["content", "little smile"],
			blep: ["content", "soft smile"],
		},
	},
	pixel: {
		favorites: [
			"warm",
			"curious",
			"caret joy",
			"tiny happy",
			"little smile",
			"blep",
		],
		after: {
			puzzled: ["goofy"],
			goofy: ["warm", "little smile"],
			mischievous: ["content", "little smile"],
			"left wink": ["cat smile"],
			"cheeky wink": ["proud", "cat smile"],
		},
	},
};

function initialFace(character: BuiltinCompanionCharacter) {
	return faceBeats.findIndex(
		(beat) =>
			beat.name ===
			(character === "hoodie"
				? "little smile"
				: character === "inky"
					? "soft smile"
					: "warm"),
	);
}

function useFaceAnimation(
	enabled: boolean,
	character: BuiltinCompanionCharacter,
	listening: boolean,
) {
	const seed = initialFace(character);
	const [index, setIndex] = useState(seed);
	const [paused, setPaused] = useState(false);
	const [changing, setChanging] = useState(false);
	const cursor = useRef(seed);
	const recent = useRef([seed]);
	useEffect(() => {
		const first = initialFace(character);
		cursor.current = first;
		recent.current = [first];
		setIndex(first);
	}, [character]);
	useEffect(() => {
		const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let timer: number | undefined;
		const schedule = () => {
			timer = window.setTimeout(
				() => {
					const previous = faceBeats[cursor.current];
					const bridge = (previous.weight ?? 4) < 4;
					const choices = faceBeats
						.map((beat, i) => ({ beat, i }))
						.filter(
							({ beat, i }) =>
								!recent.current.includes(i) &&
								(!listening || beat.attentive) &&
								(!previous.settle || beat.attentive) &&
								(!bridge || (beat.weight ?? 4) === 4),
						);
					const habits = faceHabits[character];
					const followups = habits.after[previous.name];
					const phrase = listening
						? []
						: choices.filter(({ beat }) => followups?.includes(beat.name));
					const pool = phrase.length && Math.random() > 0.4 ? phrase : choices;
					const weight = (beat: FaceBeat) =>
						(beat.weight ?? 4) *
						(habits.favorites.includes(beat.name) ? 1.7 : 1) *
						(beat.attentive ? 2 : 1);
					let draw =
						Math.random() *
						pool.reduce((sum, { beat }) => sum + weight(beat), 0);
					const next =
						pool.find(({ beat }) => {
							draw -= weight(beat);
							return draw < 0;
						}) ?? pool[0];
					setChanging(true);
					timer = window.setTimeout(() => {
						cursor.current = next.i;
						recent.current = [...recent.current.slice(-3), next.i];
						setIndex(next.i);
						setChanging(false);
						schedule();
					}, 100);
				},
				(faceBeats[cursor.current].duration ?? 3400) * (listening ? 2 : 1),
			);
		};
		const refresh = () => {
			window.clearTimeout(timer);
			setChanging(false);
			const stopped = document.hidden || motion.matches;
			setPaused(stopped);
			if (
				(listening && !faceBeats[cursor.current].attentive) ||
				(motion.matches && faceBeats[cursor.current].settle)
			) {
				cursor.current = seed;
				recent.current = [...recent.current.slice(-3), seed];
				setIndex(seed);
			}
			if (enabled && !stopped) schedule();
		};
		refresh();
		document.addEventListener("visibilitychange", refresh);
		motion.addEventListener("change", refresh);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("visibilitychange", refresh);
			motion.removeEventListener("change", refresh);
		};
	}, [enabled, listening, seed, character]);
	return { beat: faceBeats[index], index, paused, changing };
}

function FaceEye({
	shape,
	pixels,
	mirrored = false,
}: { shape: EyeShape; pixels: boolean; mirrored?: boolean }) {
	if (shape === "crossed")
		return (
			<>
				<rect x="18" y="15" width="19" height="27" rx={pixels ? 0 : 9.5} />
				<rect
					className={cn("companion-art-eye-fill")}
					x={mirrored ? 21 : 29}
					y="25"
					width="5"
					height="10"
					rx={pixels ? 0 : 2.5}
				/>
			</>
		);
	const paths: Partial<Record<EyeShape, [string, string]>> = {
		line: ["M17 29h21", "M17 29h21"],
		caret: ["M16 32l11-16 11 16", "M16 32v-6h5v-5h4v-5h5v5h4v5h5v6"],
		arch: ["M16 31q11-22 22 0", "M16 31v-7h5v-5h12v5h5v7"],
		closed: ["M17 25q10 14 21 0", "M17 25v5h5v4h11v-4h5v-5"],
		squeeze: ["M18 17l14 11-14 10", "M18 17h5v5h5v6h-5v5h-5"],
		heart: [
			"M27 40 15 27C5 15 21 7 27 18C33 7 49 15 39 27Z",
			"M27 40h-5v-5h-5v-5h-5V18h5v-5h7v5h6v-5h7v5h5v12h-5v5h-5v5Z",
		],
		star: [
			"M27 10l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1Z",
			"M24 10h6v10h11v6h-6v6h3v8h-6v-5H22v5h-6v-8h3v-6h-6v-6h11Z",
		],
	};
	const path = paths[shape];
	if (path)
		return (
			<path
				className={cn(
					(shape === "heart" || shape === "star") && "companion-art-eye-fill",
				)}
				d={path[pixels ? 1 : 0]}
				transform={
					shape === "squeeze" && mirrored
						? "translate(54 0) scale(-1 1)"
						: undefined
				}
			/>
		);
	const small = shape === "small";
	return (
		<rect
			className={cn(shape !== "ring" && "companion-art-eye-fill")}
			x={small ? 22 : 18}
			y={small ? 23 : 15}
			width={small ? 11 : 19}
			height={small ? 14 : 27}
			rx={pixels ? 0 : small ? 5.5 : 9.5}
		/>
	);
}

function LivelyFace({
	beat,
	pixels,
	reaction,
}: { beat: FaceBeat; pixels: boolean; reaction: CompanionReaction }) {
	const glance = reaction === "rest" ? 1 : 0.3;
	const perk = reaction === "curious" ? 1.08 : 1;
	const openness = beat.openness ?? [1, 1];
	const brows = beat.brows ?? [0, 0];
	const look = beat.glance ?? [0, 0];
	const mouths: Record<MouthShape, [string, string]> = {
		none: ["", ""],
		flat: ["M43 55h14", "M43 55h14"],
		"slight smile": ["M41 53q9 5 18 0", "M41 53v2h18v-2"],
		"slight frown": ["M42 56q8-5 16 0", "M42 56v-2h16v2"],
		whistle: ["M51 51a4 4 0 1 0 0 8a4 4 0 1 0 0-8", "M48 51h7v8h-7Z"],
		tongue: ["M39 51q11 5 22 0", "M39 51v2h22v-2"],
		"side tongue": ["M37 52q13 12 27-3", "M37 52v5h13v-3h9v-5h5"],
		puff: ["M45 53q5-5 10 0q-5 5-10 0Z", "M46 51h8v4h-8Z"],
		bite: ["M38 53q9 10 21 0m-10 3v-5h7v5Z", "M38 53v5h11v-7h7v7h3v-5"],
		smile: ["M39 51q11 13 22 0", "M39 51v4h5v3h12v-3h5v-4"],
		grin: ["M35 48h30q-2 17-15 17T35 48Z", "M35 49h30v8h-5v6H40v-6h-5Z"],
		cat: ["M35 50q7 14 15 3q8 11 15-3", "M35 50v6h10v-4h10v4h10v-6"],
		oh: ["M45 56a5 7 0 1 0 10 0a5 7 0 1 0-10 0", "M45 49h10v14H45Z"],
		pout: ["M40 59q10-13 20 0", "M40 59v-5h5v-4h10v4h5v5"],
	};
	const style = {
		"--face-look-x": `${look[0] * glance}px`,
		"--face-look-y": `${look[1] * glance}px`,
		"--face-left-open": openness[0] * perk,
		"--face-right-open": openness[1] * perk,
		"--face-left-brow": `${brows[0]}px`,
		"--face-right-brow": `${brows[1]}px`,
	} as CSSProperties;
	return (
		<g
			className={cn("companion-art-live-face")}
			data-emotion={beat.name}
			data-brows={Boolean(beat.brows) || undefined}
			style={style}
		>
			<g className={cn("companion-art-live-brows")}>
				<path
					className={cn("companion-art-brow-left")}
					d={pixels ? "M17 8h8V5h11" : "M17 9q9-6 19-1"}
				/>
				<path
					className={cn("companion-art-brow-right")}
					d={pixels ? "M64 5h11v3h8" : "M64 8q10-5 19 1"}
				/>
			</g>
			<g className={cn("companion-art-eyes")}>
				<g className={cn("companion-art-face-arrive")}>
					<g className={cn("companion-art-eye-left")}>
						<FaceEye shape={beat.eyes[0]} pixels={pixels} />
					</g>
					<g className={cn("companion-art-eye-right")}>
						<g transform="translate(45 0)">
							<FaceEye shape={beat.eyes[1]} pixels={pixels} mirrored />
						</g>
					</g>
				</g>
			</g>
			{beat.mouth !== "none" && (
				<g className={cn("companion-art-live-mouth")}>
					<path
						className={cn(beat.mouth === "grin" && "companion-art-eye-fill")}
						d={mouths[beat.mouth][pixels ? 1 : 0]}
					/>
					{(beat.mouth === "tongue" || beat.mouth === "side tongue") && (
						<path
							className={cn("companion-art-eye-fill")}
							d={
								beat.mouth === "tongue"
									? pixels
										? "M46 52h8v10h-3v3h-5Z"
										: "M46 52h8v9a4 4 0 0 1-8 0Z"
									: pixels
										? "M56 52h8v9h-3v3h-5Z"
										: "M56 53l7-2 2 7q1 7-5 6Z"
							}
						/>
					)}
				</g>
			)}
			{beat.cheeks && (
				<path
					className={cn("companion-art-cheeks")}
					d={
						beat.cheeks === "puffed"
							? pixels
								? "M13 40H8v10h5m74-10h5v10h-5"
								: "M13 40q-7 5 0 10m74-10q7 5 0 10"
							: "M12 43h7m62 0h7"
					}
				/>
			)}
		</g>
	);
}

const eyePaths = {
	offline: ["M19 30q8 8 16 0m30 0q8 8 16 0", "M19 30v4h16v-4M65 30v4h16v-4"],
	complete: [
		"M17 32q10-20 20 0m26 0q10-20 20 0",
		"M17 32v-8h5v-5h10v5h5v8m26 0v-8h5v-5h10v5h5v8",
	],
	pressed: [
		"M18 32q9-12 18 0m28 0q9-12 18 0",
		"M18 32v-5h5v-4h8v4h5v5m28 0v-5h5v-4h8v4h5v5",
	],
};
const eyeRects = {
	working: { x: 19, y: 20, width: 16, height: 20, rx: 8 },
	attention: { x: 19, y: 17, width: 16, height: 24, rx: 8 },
	curious: { x: 18, y: 12, width: 18, height: 29, rx: 8 },
	idle: { x: 19, y: 16, width: 16, height: 25, rx: 8 },
	waking: { x: 19, y: 25, width: 16, height: 12, rx: 6 },
};

function Eyes({ mood, pixels, reaction }: ExpressionProps) {
	const expression =
		mood === "idle" ? (reaction === "peekaboo" ? "complete" : reaction) : mood;
	if (expression === "starstruck")
		return (
			<path
				className={cn("companion-art-eye-fill")}
				d="M27 9l4 9 10 1-7 7 2 11-9-5-9 5 2-11-7-7 10-1Zm46 0 4 9 10 1-7 7 2 11-9-5-9 5 2-11-7-7 10-1Z"
			/>
		);
	if (expression === "loved")
		return (
			<>
				<FaceEye shape="heart" pixels={pixels} />
				<g transform="translate(45 0)">
					<FaceEye shape="heart" pixels={pixels} />
				</g>
				<path className={cn("companion-art-cheeks")} d="M17 44h7m52 0h7" />
			</>
		);
	if (expression === "happy" || expression === "found") {
		return (
			<>
				<FaceEye shape="caret" pixels={pixels} />
				<g transform="translate(45 0)">
					<FaceEye shape="caret" pixels={pixels} />
				</g>
			</>
		);
	}

	if (expression === "dozing") {
		return (
			<path
				d={
					pixels
						? "M18 29v4h18v-4m28 0v4h18v-4"
						: "M18 28q9 10 18 0m28 0q9 10 18 0"
				}
			/>
		);
	}
	if (expression === "grabbed" || expression === "falling") {
		return (
			<>
				{[18, 62].map((x) => (
					<g key={x}>
						<rect x={x} y="11" width="20" height="32" rx={pixels ? 0 : 10} />
						<rect
							className={cn("companion-art-eye-fill")}
							x={x + 7}
							y="24"
							width="6"
							height="12"
							rx={pixels ? 0 : 2.5}
						/>
					</g>
				))}
				<path
					d={pixels ? "M16 5h22m24 0h22" : "M16 5q11-6 22 0m24 0q11-6 22 0"}
				/>
			</>
		);
	}
	if (expression === "struggling") {
		return (
			<>
				<path
					className={cn("companion-art-struggle-effort")}
					d={
						pixels
							? "M18 19h6v5h6v6h-6v5h-6m64-16h-6v5h-6v6h6v5h6"
							: "M19 18l13 10-13 9m62-19L68 28l13 9"
					}
				/>
				<g className={cn("companion-art-struggle-rest")}>
					<FaceEye shape="line" pixels={pixels} />
					<g transform="translate(45 0)">
						<FaceEye shape="small" pixels={pixels} />
					</g>
				</g>
			</>
		);
	}
	if (
		expression === "offline" ||
		expression === "complete" ||
		expression === "pressed" ||
		expression === "landing"
	) {
		return (
			<path
				d={
					eyePaths[expression === "landing" ? "pressed" : expression][
						pixels ? 1 : 0
					]
				}
			/>
		);
	}
	if (mood === "error") {
		return (
			<>
				<path
					className={cn("companion-art-task-brows")}
					d={pixels ? "M17 21h8v-4h11m28 0h11v4h8" : "M17 23l18-6m30 0 18 6"}
				/>
				<path
					className={cn("companion-art-eye-fill", "companion-art-task-eye")}
					d="M20 29h14v7H20zm46 0h14v7H66z"
				/>
			</>
		);
	}
	const shape =
		eyeRects[
			mood === "working" || mood === "attention"
				? mood
				: reaction === "waking"
					? "waking"
					: reaction === "rest" ||
							reaction === "listening" ||
							reaction === "playful"
						? "idle"
						: "curious"
		];
	return (
		<>
			{(mood === "working" || mood === "attention") && (
				<path
					className={cn("companion-art-task-brows")}
					d={
						mood === "working"
							? "M19 12q8-2 16 0m30 0q8-2 16 0"
							: "M17 9q10-7 19 0m28 0q10-7 19 0"
					}
				/>
			)}
			{[0, 46].map((offset) => (
				<rect
					key={offset}
					{...shape}
					x={shape.x + offset}
					rx={pixels ? 0 : shape.rx}
					className={cn(
						mood !== "attention" && "companion-art-eye-fill",
						(mood === "working" || mood === "attention") &&
							"companion-art-task-eye",
					)}
				/>
			))}
		</>
	);
}

function Mouth({ mood, pixels, reaction }: ExpressionProps) {
	if (mood === "working") {
		return (
			<g className={cn("companion-art-progress")}>
				<rect x="38" y="52" width="5" height="5" rx={pixels ? 0 : 2.5} />
				<rect x="48" y="52" width="5" height="5" rx={pixels ? 0 : 2.5} />
				<rect x="58" y="52" width="5" height="5" rx={pixels ? 0 : 2.5} />
			</g>
		);
	}
	if (mood === "attention") {
		return <rect x="46" y="50" width="8" height="11" rx={pixels ? 0 : 4} />;
	}
	if (mood === "offline") return <path d="M44 54h12" />;
	if (mood === "error") {
		return <path d={pixels ? "M40 58v-5h20v5" : "M40 58q10-10 20 0"} />;
	}
	if (mood === "idle") {
		if (reaction === "loved")
			return (
				<path
					d={
						pixels ? "M35 50v5h10v-3h10v3h10v-5" : "M35 49q8 15 15 5q7 10 15-5"
					}
				/>
			);
		if (reaction === "waking")
			return <rect x="46" y="50" width="8" height="10" rx={pixels ? 0 : 4} />;
		if (reaction === "listening")
			return <path d={pixels ? "M42 51v4h16v-4" : "M42 50q8 10 16 0"} />;
		if (reaction === "grabbed" || reaction === "falling") {
			return <rect x="43" y="48" width="14" height="17" rx={pixels ? 0 : 7} />;
		}
		if (reaction === "struggling") {
			return (
				<path
					d={pixels ? "M37 56v-5h7v5h6v-5h6v5h7" : "M37 55q4-8 8-1t8 0 10 0"}
				/>
			);
		}
		if (reaction === "dozing")
			return <rect x="47" y="50" width="6" height="5" rx={pixels ? 0 : 2.5} />;
		if (reaction === "pressed" || reaction === "landing") {
			return <path d={pixels ? "M42 50v5h16v-5" : "M40 49q10 10 20 0"} />;
		}
		if (reaction === "dragging") {
			return (
				<path
					className={cn("companion-art-eye-fill")}
					d={pixels ? "M37 49h26v6h-5v5H42v-5h-5z" : "M36 48q14 24 28 0Z"}
				/>
			);
		}
		if (
			reaction === "curious" ||
			reaction === "happy" ||
			reaction === "starstruck"
		) {
			return (
				<path d={pixels ? "M34 47v8h7v5h18v-5h7v-8" : "M34 47q16 25 32 0"} />
			);
		}
	}
	return <path d={pixels ? "M38 49v7h6v4h12v-4h6v-7" : "M38 49q12 18 24 0"} />;
}

function IdleVignette({
	character,
	reaction,
	beat,
}: {
	character: BuiltinCompanionCharacter;
	reaction: CompanionReaction;
	beat: FaceBeat;
}) {
	const pixels = character === "pixel";
	const game = reaction === "daydream" && pixels;
	return (
		<>
			<g className={cn("companion-art-vignette-rest")}>
				<LivelyFace beat={beat} pixels={pixels} reaction="rest" />
			</g>
			<g className={cn("companion-art-vignette-scene")}>
				{game ? (
					<g className={cn("companion-art-eye-fill")}>
						<rect
							className={cn("companion-art-paddle-left")}
							x="16"
							y="16"
							width="5"
							height="18"
						/>
						<rect
							className={cn("companion-art-paddle-right")}
							x="79"
							y="35"
							width="5"
							height="18"
						/>
						<rect
							className={cn("companion-art-game-ball")}
							x="47"
							y="32"
							width="6"
							height="6"
						/>
					</g>
				) : (
					<>
						<g className={cn("companion-art-vignette-eyes")}>
							{reaction === "yawning" ? (
								<path d={eyePaths.offline[pixels ? 1 : 0]} />
							) : (
								[0, 46].map((offset) => (
									<rect
										key={offset}
										className={cn(
											"companion-art-eye-fill",
											offset === 0
												? "companion-art-peek-left"
												: "companion-art-peek-right",
										)}
										x={19 + offset}
										y="15"
										width="16"
										height="27"
										rx={pixels ? 0 : 8}
									/>
								))
							)}
						</g>
						{reaction === "yawning" ? (
							<rect
								className={cn("companion-art-yawn-mouth")}
								x="44"
								y="43"
								width="12"
								height="21"
								rx={pixels ? 0 : 6}
							/>
						) : (
							<path
								d={pixels ? "M35 48v6h8v5h14v-5h8v-6" : "M35 48q15 23 30 0"}
							/>
						)}
					</>
				)}
			</g>
		</>
	);
}

export function CompanionArt({
	character,
	mood,
	gaze,
	reaction,
}: CompanionArtProps) {
	const [motionReadyFor, setMotionReadyFor] =
		useState<BuiltinCompanionCharacter | null>(null);
	const motionSource =
		character === "hoodie"
			? hoodieMotion
			: character === "inky"
				? inkyMotion
				: undefined;
	const previousMood = useRef(mood);
	const [celebrating, setCelebrating] = useState(false);
	useEffect(() => {
		const completed =
			mood === "complete" && previousMood.current !== "complete";
		previousMood.current = mood;
		if (!completed) {
			if (mood !== "complete") setCelebrating(false);
			return;
		}
		setCelebrating(true);
		const timer = window.setTimeout(() => setCelebrating(false), 700);
		return () => window.clearTimeout(timer);
	}, [mood]);
	const pixels = character === "pixel";
	const physical = physicalReactions.has(reaction);
	const expressionMood =
		(mood === "complete" && reaction !== "rest") ||
		(mood === "offline" && physical)
			? "idle"
			: mood;
	const lively =
		(expressionMood === "idle" || expressionMood === "complete") &&
		["rest", "curious", "listening"].includes(reaction);
	const vignette =
		expressionMood === "idle" &&
		["stretching", "yawning", "daydream"].includes(reaction);
	const sleeping = expressionMood === "idle" && reaction === "dozing";
	const story = getCompanionScene(character, reaction);
	const sprite =
		expressionMood === "idle" &&
		(["peekaboo", "peeking", "found", "playful", "dozing", "waking"].includes(
			reaction,
		) ||
			story !== undefined);
	const face = useFaceAnimation(lively, character, reaction === "listening");
	const interacting = reaction !== "rest" && reaction !== "dozing" && !vignette;
	const x = reaction === "listening" ? -0.55 : interacting ? gaze.x : 0;
	const y = reaction === "listening" ? -0.45 : interacting ? gaze.y : 0;
	const tracking = {
		"--companion-story-duration": `${getCompanionReactionDuration(character, reaction) ?? 0}ms`,
		"--companion-art-gaze-x": `${x * 7}px`,
		"--companion-art-gaze-y": `${y * 4}px`,
		"--companion-art-tilt": `${x * 2 + 1.5}deg`,
		"--companion-art-lean": `${x * 6}deg`,
		"--companion-art-sheet": motionSource
			? `url("${motionSource}")`
			: undefined,
	} as CSSProperties;
	return (
		<span
			aria-hidden="true"
			className={cn("companion-art", `companion-art-${character}`)}
			data-mood={mood}
			data-expression={expressionMood}
			data-reaction={reaction}
			data-physical={physical || undefined}
			data-motion-ready={motionReadyFor === character || undefined}
			data-vignette={vignette || undefined}
			data-sleeping={sleeping || undefined}
			data-story={(sprite && story !== undefined) || undefined}
			data-celebrating={celebrating || undefined}
			data-face-beat={lively ? face.index : undefined}
			data-face-changing={(lively && face.changing) || undefined}
			data-paused={face.paused || undefined}
			style={tracking}
		>
			{motionSource && (
				<img
					key={character}
					className={cn("companion-art-motion-source")}
					src={motionSource}
					alt=""
					onLoad={() => setMotionReadyFor(character)}
				/>
			)}
			<span className={cn("companion-art-pose")}>
				<span className={cn("companion-art-visual")}>
					<img
						className={cn("companion-art-body")}
						src={artwork[character]}
						alt=""
						draggable={false}
					/>
					{character === "sprout" && (
						<img
							className={cn("companion-art-leaves")}
							src={sprout}
							alt=""
							draggable={false}
						/>
					)}
					{character === "hoodie" || character === "inky" ? (
						<span className={cn("companion-art-sprite")} />
					) : (
						["left", "right"].map((side) => (
							<img
								key={side}
								className={cn(
									"companion-art-foot",
									`companion-art-foot-${side}`,
								)}
								src={artwork[character]}
								alt=""
								draggable={false}
							/>
						))
					)}
					<svg
						aria-hidden="true"
						className={cn("companion-art-face")}
						viewBox="0 -4 100 74"
						preserveAspectRatio="none"
						focusable="false"
						shapeRendering={pixels ? "crispEdges" : "geometricPrecision"}
					>
						<g className={cn("companion-art-gaze")}>
							<g className={cn("companion-art-expression")}>
								{vignette ? (
									<IdleVignette
										character={character}
										reaction={reaction}
										beat={face.beat}
									/>
								) : lively || (sprite && story) ? (
									<LivelyFace
										beat={face.beat}
										pixels={pixels}
										reaction={reaction}
									/>
								) : (
									<>
										<g className={cn("companion-art-eyes")}>
											<Eyes
												mood={expressionMood}
												pixels={pixels}
												reaction={reaction}
											/>
										</g>
										<g className={cn("companion-art-mouth")}>
											<Mouth
												mood={expressionMood}
												pixels={pixels}
												reaction={reaction}
											/>
										</g>
									</>
								)}
							</g>
						</g>
					</svg>
					<svg
						aria-hidden="true"
						className={cn("companion-art-glints")}
						viewBox="0 0 100 100"
						focusable="false"
					>
						<path d="M17 36v8m-4-4h8M83 25v6m-3-3h6" />
					</svg>
				</span>
				{sprite && (
					<CompanionSprite
						key={`${character}-${reaction === "dozing" || reaction === "waking" ? "nap" : reaction === "peeking" || reaction === "found" ? "peekaboo" : reaction}`}
						character={character}
						action={reaction as CompanionSpriteAction}
					/>
				)}
			</span>
			{lively && reaction === "rest" && face.beat.mouth === "whistle" && (
				<svg
					aria-hidden="true"
					className={cn("companion-art-whistle")}
					viewBox="0 0 100 100"
					focusable="false"
				>
					<path d="M80 33v-9l6-2v8m-6 3c-4-2-5 3-2 3q3 0 2-3m6-3c-4-2-5 3-2 3q3 0 2-3" />
					<path d="M89 21v-8l5 2m-5 6c-4-2-5 3-2 3q3 0 2-3" />
				</svg>
			)}

			{vignette && reaction === "daydream" && character === "sprout" && (
				<svg
					aria-hidden="true"
					className={cn("companion-art-motes")}
					viewBox="0 0 100 100"
					focusable="false"
				>
					<circle cx="23" cy="39" r="1.5" />
					<circle cx="28" cy="34" r="1" />
					<circle cx="20" cy="30" r="1" />
				</svg>
			)}
			<svg
				aria-hidden="true"
				className={cn("companion-art-sleep-marks")}
				viewBox="0 0 100 100"
				focusable="false"
				shapeRendering={pixels ? "crispEdges" : "geometricPrecision"}
			>
				<path d="M77 35h6l-6 6h6" />
				<path className={cn("companion-art-sleep-drift")} d="M84 26h7l-7 7h7" />
			</svg>
			<svg
				aria-hidden="true"
				className={cn("companion-art-hearts")}
				viewBox="0 0 100 100"
				focusable="false"
			>
				<path d="M18 37l-4-4c-4-4 1-8 4-4c3-4 8 0 4 4Z" />
				<path d="M83 29l-3-3c-3-3 1-6 3-3c2-3 6 0 3 3Z" />
			</svg>
			<svg
				aria-hidden="true"
				className={cn("companion-art-impact")}
				viewBox="0 0 100 100"
				focusable="false"
			>
				<path d="M17 91l-5-3m13 5h-8m58 0h8m0-2 5-3M33 94h34" />
			</svg>
		</span>
	);
}
