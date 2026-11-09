import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	QUALITY,
	planDerivatives,
	pngDimensions,
} from "./derive-marketing-webp.mjs";

const capture = readFileSync(
	new URL("./capture-docs-library.mjs", import.meta.url),
	"utf8",
);
const library = readFileSync(
	new URL(
		"../src/renderer/src/shared/components/navigation/docs-library.stories.tsx",
		import.meta.url,
	),
	"utf8",
);
const hero = readFileSync(
	new URL(
		"../src/renderer/src/shared/components/navigation/docs-app-hero.stories.tsx",
		import.meta.url,
	),
	"utf8",
);
const bridge = readFileSync(
	new URL(
		"../src/renderer/src/features/team-bridge/team-bridge-marketing.stories.tsx",
		import.meta.url,
	),
	"utf8",
);

test("all new capture scenes have committed stories, current default origin and timezone pin", () => {
	assert.match(hero, /title: "Docs\/App hero"/);
	assert.match(hero, /export const Scene/);
	assert.match(capture, /http:\/\/localhost:6006/);
	assert.doesNotMatch(capture, /6129|not carry/);
	assert.match(capture, /Emulation.setTimezoneOverride/);
	for (const [scene, exported] of [
		["notifications", "Notifications"],
		["asks", "Asks"],
		["review-pane", "ReviewPane"],
	]) {
		assert.ok(capture.includes(`["${scene}", "docs-library--${scene}"]`));
		assert.ok(library.includes(`export const ${exported}`));
	}
	for (const scene of ["channel", "thread", "approval", "mention", "launch"]) {
		assert.ok(
			capture.includes(`["bridge-${scene}", "docs-team-bridge--${scene}"]`),
		);
		assert.ok(
			bridge.includes(
				`export const ${scene[0].toUpperCase()}${scene.slice(1)}`,
			),
		);
	}
});

test("public fixtures advertise current navigation and do not expose operator identity", () => {
	for (const name of ["notifications", "library", "team_bridge_conversations"])
		assert.match(library, new RegExp(`${name}: 1`));
	for (const source of [library, hero, bridge]) {
		assert.doesNotMatch(
			source,
			/Damian|damian|\/Users\/|[\w.+-]+@(?!example\.com\b)[\w.-]+\.[A-Za-z]{2,}/,
		);
	}
	assert.match(library, /studio-mbp/);
	assert.match(bridge, /capturePending/);
	assert.doesNotMatch(bridge, /highlightMessageId/);
});

test("actual 16:9 pixels determine all scenario output heights", () => {
	const plan = planDerivatives("hero-light.png", { width: 2560, height: 1440 });
	assert.deepEqual(
		plan.outputs.map(({ width, height }) => [width, height]),
		[
			[768, 432],
			[1536, 864],
			[2560, 1440],
		],
	);
	assert.equal(QUALITY, 88);
	assert.equal(plan.skipped.length, 0);
});

test("smaller masters omit oversized responsive and historical 2x variants", () => {
	const heroPlan = planDerivatives("hero-dark.png", {
		width: 1920,
		height: 1080,
	});
	assert.equal(heroPlan.outputs.length, 2);
	assert.match(heroPlan.skipped[0].file, /2560/);
	const plan = planDerivatives("bridge-channel-dark.png", {
		width: 2560,
		height: 1440,
	});
	assert.ok(
		plan.outputs.some(
			(item) =>
				item.file.endsWith("channel-dark@1x.webp") && item.width === 1440,
		),
	);
	assert.ok(
		plan.skipped.some((item) => item.file.endsWith("channel-dark@2x.webp")),
	);
	const mention = planDerivatives("bridge-mention-dark.png", {
		width: 2560,
		height: 1440,
	});
	assert.ok(
		mention.skipped.some((item) =>
			item.file.endsWith("composer-mention-dark@2x.webp"),
		),
	);
	assert.ok(!mention.outputs.some((item) => item.file.endsWith("@2x.webp")));
});

test("crops remain within source and never upscale; malformed names and PNGs fail", () => {
	for (const scene of ["channel", "thread", "approval", "mention", "launch"]) {
		const plan = planDerivatives(`bridge-${scene}-dark.png`, {
			width: 2560,
			height: 1440,
		});
		for (const item of plan.outputs) {
			const [x, y, w, h] = item.crop ?? [0, 0, 2560, 1440];
			assert.ok(x >= 0 && y >= 0 && x + w <= 2560 && y + h <= 1440);
			assert.ok(item.width <= w && item.height <= h);
		}
	}
	assert.throws(
		() => planDerivatives("unknown-dark.png", { width: 2560, height: 1440 }),
		/Unknown/,
	);
	assert.throws(
		() => planDerivatives("hero.png", { width: 2560, height: 1440 }),
		/Expected/,
	);
	assert.throws(() => pngDimensions(Buffer.from("not a PNG")), /PNG/);
	const header = Buffer.alloc(24);
	Buffer.from("89504e470d0a1a0a", "hex").copy(header);
	header.writeUInt32BE(2560, 16);
	header.writeUInt32BE(1440, 20);
	assert.deepEqual(pngDimensions(header), { width: 2560, height: 1440 });
});
