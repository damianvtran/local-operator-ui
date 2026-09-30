const scenes = {
	suction: { character: "inky", duration: 4800 },
	camouflage: { character: "inky", duration: 6000 },
	paperboat: { character: "hoodie", duration: 5200 },
	scarf: { character: "hoodie", duration: 5600 },
	lens: { character: "pixel", duration: 4800 },
	firefly: { character: "pixel", duration: 5200 },
	dew: { character: "sprout", duration: 4800 },
	bloom: { character: "sprout", duration: 5600 },
	relax: { character: "hoodie", duration: 6200 },
	balance: { character: "pixel", duration: 4800 },
	spin: { character: "sprout", duration: 3600 },
	juggle: { character: "inky", duration: 5200 },
	bubbles: { character: "inky", duration: 4000 },
	leafplay: { character: "inky", duration: 4000 },
	shell: { character: "inky", duration: 4000 },
	cuddle: { character: "inky", duration: 4000 },
};

export type CompanionScene = keyof typeof scenes;

const reactionDurations = {
	happy: 1200,
	loved: 1200,
	waking: 800,
	landing: 900,
	stretching: 2600,
	yawning: 2600,
	daydream: 2600,
	starstruck: 1700,
	peekaboo: 4800,
	peeking: 2400,
	found: 1200,
	playful: 4000,
};

export type CompanionTimedReaction =
	| CompanionScene
	| keyof typeof reactionDurations;

export function getCompanionReactionDuration(
	character: string,
	reaction: string,
): number | undefined {
	return Object.prototype.hasOwnProperty.call(reactionDurations, reaction)
		? reactionDurations[reaction as keyof typeof reactionDurations]
		: getCompanionScene(character, reaction)?.duration;
}

const idleScenes = {
	hoodie: ["paperboat", "relax", "scarf"],
	pixel: ["lens", "balance", "firefly"],
	sprout: ["dew", "spin", "bloom"],
	inky: ["bubbles", "leafplay", "shell", "juggle", "suction", "camouflage"],
} satisfies Record<string, CompanionScene[]>;

export function getCompanionIdleScenes(character: string): CompanionScene[] {
	return Object.prototype.hasOwnProperty.call(idleScenes, character)
		? idleScenes[character as keyof typeof idleScenes]
		: [];
}

export function getCompanionScene(character: string, action: string) {
	const scene = action in scenes ? scenes[action as CompanionScene] : undefined;
	return scene?.character === character ? scene : undefined;
}
