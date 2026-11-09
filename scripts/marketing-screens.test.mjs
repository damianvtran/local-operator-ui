import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	QUALITY,
	derive,
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

const chatLayout = readFileSync(
	new URL(
		"../src/renderer/src/shared/components/common/chat-layout.tsx",
		import.meta.url,
	),
	"utf8",
);
const configRun = readFileSync(
	new URL(
		"../src/renderer/src/features/agents/config-run/use-config-run.ts",
		import.meta.url,
	),
	"utf8",
);

test("Team Bridge masters that are not 16:9 are refused before any output is planned", () => {
	// The rig's old default (1280x900 @2x) and its old documented example
	// (1440x900 @2x): both used to plan wrong-region crops with a green exit.
	for (const [width, height] of [
		[2560, 1800],
		[2880, 1800],
	]) {
		for (const scene of ["channel", "thread", "approval", "mention", "launch"])
			assert.throws(
				() => planDerivatives(`bridge-${scene}-dark.png`, { width, height }),
				/calibrated to 16:9.*--viewport=1280x720/,
			);
	}
	// Control: the full-frame scenario set carries no crops and keeps any aspect.
	assert.equal(
		planDerivatives("teams-dark.png", { width: 2560, height: 1800 }).outputs
			.length,
		2,
	);
	// The capture rig's own default and usage text now produce a 16:9 master.
	assert.match(capture, /VIEWPORT\?\.\[1\] \?\? 1280\)/);
	assert.match(capture, /VIEWPORT\?\.\[2\] \?\? 720\)/);
	assert.match(capture, /\[--viewport=1280x720\]/);
	assert.match(capture, /WIDTHxHEIGHT, e\.g\. 1280x720/);
	assert.doesNotMatch(capture, /1440x900/);
});

test("an edge-touching crop is clamped to an odd-sized source instead of overrunning it", () => {
	// 0.74 and 0.26 of 1275 both round up (944 + 332 = 1276): unclamped, the
	// thread crop asked cwebp for a column one pixel past the source.
	const plan = planDerivatives("bridge-thread-dark.png", {
		width: 1275,
		height: 717,
	});
	const crops = plan.outputs.filter((item) => item.crop);
	assert.equal(crops.length, 1);
	for (const item of crops) {
		const [x, y, w, h] = item.crop;
		assert.deepEqual([x, y, w, h], [944, 0, 331, 717]);
		assert.ok(item.width <= w && item.height <= h);
	}
	for (const scene of ["channel", "approval", "mention"])
		for (const item of planDerivatives(`bridge-${scene}-light.png`, {
			width: 1275,
			height: 717,
		}).outputs) {
			const [x, y, w, h] = item.crop ?? [0, 0, 1275, 717];
			assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0);
			assert.ok(x + w <= 1275 && y + h <= 717);
		}
});

test("an --only typo or an empty selection fails instead of reporting zero sources", () => {
	const dir = mkdtempSync(join(tmpdir(), "marketing-screens-"));
	try {
		const png = Buffer.alloc(24);
		Buffer.from("89504e470d0a1a0a", "hex").copy(png);
		png.writeUInt32BE(640, 16);
		png.writeUInt32BE(360, 20);
		writeFileSync(join(dir, "asks-dark.png"), png);
		// A missing encoder proves these refusals happen before any encode.
		const options = { encoder: join(dir, "no-such-encoder") };
		assert.throws(
			() => derive(dir, join(dir, "out"), { ...options, only: ["heroo"] }),
			/--only names heroo, which is not a marketing scene/,
		);
		assert.throws(
			() => derive(dir, join(dir, "out"), { ...options, only: ["hero"] }),
			/No <scene>-<light\|dark>\.png sources matched.*--only=hero/,
		);
		// Control: a real selection is planned (640x360 upscales nowhere, so
		// every variant is skipped and the absent encoder is never reached).
		const reports = derive(dir, join(dir, "out"), {
			...options,
			only: ["asks"],
		});
		assert.equal(reports.length, 1);
		assert.equal(reports[0].outputs.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the Mention scene drives the composer by its real role and holds the shutter for the picker", () => {
	// The composer is a combobox; a `textbox` query never resolves, so the
	// picker never opened and the frame was never released.
	assert.doesNotMatch(bridge, /findByRole\(\s*"textbox"/);
	assert.match(
		bridge,
		/findByRole\("combobox", \{\s*name: `Message \$\{QA\.name\}`/,
	);
	assert.match(
		bridge,
		/userEvent\.clear\(input\);\s*await userEvent\.type\(input, "@"/,
	);
	const play = bridge.slice(bridge.indexOf("export const Mention"));
	// The picker is portalled: it is looked up on the document, not the canvas.
	assert.doesNotMatch(
		play,
		/canvas\.getBy\w+\([^)]*People in this conversation/,
	);
	const picker = play.indexOf(
		'page.getByRole("group", { name: "People in this conversation" })',
	);
	const release = play.indexOf(
		"delete document.documentElement.dataset.capturePending",
	);
	assert.ok(picker > 0 && release > picker, "released only after the picker");
});

test("the Asks scene mounts the fleet ask drawer once, through ChatLayout", () => {
	// ChatLayout owns the drawer behind the store flag the shell sets; a
	// second mount in the story painted two drawers (10 "Send answer" for 5 asks).
	assert.match(
		chatLayout,
		/fleetAsksOpen = askDrawerOpen && askDrawerScope === "fleet"/,
	);
	assert.equal(chatLayout.match(/<FleetAskDrawer\b/g)?.length, 1);
	assert.match(library, /isAskDrawerOpen: rightPane === "asks"/);
	assert.doesNotMatch(library, /<FleetAskDrawer\b/);
	assert.doesNotMatch(library, /import \{ FleetAskDrawer \}/);
});

test("the Teams world answers the reads its page issues, with one roster", () => {
	// Every capability `configRunEnabled` requires is advertised by the world.
	const gate = configRun.slice(
		configRun.indexOf("export function configRunEnabled"),
		configRun.indexOf("export function configSkillRunEnabled"),
	);
	const required = [
		...gate.matchAll(/desktopFeatureEnabled\(capabilities, "(\w+)"\)/g),
	].map((m) => m[1]);
	assert.deepEqual(required, [
		"agents_config",
		"session_interrupt",
		"profile_catalogue",
		"team_catalogue",
	]);
	for (const key of required)
		assert.match(library, new RegExp(`\\b${key}: \\d`));
	// The effective-models probe and the effort-tier read are answered, and the
	// list row counts the same roster the detail pane renders.
	assert.match(library, /case "teams\.effective":/);
	assert.match(library, /members: hit\.members\.map\(/);
	assert.match(library, /case "settings\.list":/);
	const list = library.slice(
		library.indexOf('case "teams.list":'),
		library.indexOf('case "teams.get":'),
	);
	assert.match(list, /members: team\.members,/);
	assert.doesNotMatch(list, /members: \[\]/);
});

test("a scene never inherits another scene's persisted composer draft", () => {
	// Every scene's world clears the shared conversation's persisted draft
	// before it mounts; without that a full-page navigation from the hero left
	// its draft in the review pane's composer.
	const install = library.slice(
		library.indexOf("const installWorldBridge = () => {"),
		library.indexOf("const rows = roster();"),
	);
	assert.match(install, /clearInheritedDraft\(\);/);
	const clear = library.slice(
		library.indexOf("const clearInheritedDraft"),
		library.indexOf("const installWorldBridge = () => {"),
	);
	assert.match(clear, /setCurrentInput\(CONVERSATION_ID, ""\)/);
	// The hero goes through the same world, then stages its own draft.
	assert.match(hero, /installWorldBridge\(\);/);
	assert.match(hero, /useStagedDraft\(/);
	// The review scene's draft is its own, short enough to show whole.
	const review = library.slice(library.indexOf("const ReviewPaneScene"));
	assert.match(
		review,
		/useStagedDraft\(CONVERSATION_ID, "Merge #212 once QA signs off\."\)/,
	);
	// A pending PR's check total includes its pending runs.
	assert.doesNotMatch(
		library,
		/total: 0, passed: 0, failed: 0, pending: [1-9]/,
	);
});
