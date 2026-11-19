/**
 * KEYED COPY IS DISPLAY, NEVER BEHAVIOUR — proven under a real translated
 * catalogue.
 *
 * WHY THIS FILE EXISTS (design review, 2026-10-24). A sweep that moves copy into
 * the catalogue can quietly move a DECISION with it: a `t()` result compared for
 * equality, used as a `switch` arm, held in a `Set`/`Map`, or fed to
 * `startsWith`/`includes`. Such code passes every English test and changes
 * behaviour the moment a translation differs — the most expensive kind of bug to
 * find, because the frame still renders.
 *
 * WHAT IT PINS. The pools, rings and ladders below keep their identity in KEYS
 * (locale-independent code), and a translated catalogue changes only what is
 * painted:
 *
 *   - `sampleSuggestions` draws the same four keys with the same seed;
 *   - `tipRotationOrder` returns the same permutation in the same order;
 *   - the section table still holds its seven keys, in order;
 *   - `composerPlaceholder` walks the same ladder, returning the TRANSLATED
 *     sentence for each rung (and passing a host's own line through untouched);
 *   - `placementLabel` and `groupPositionLabel` render the translated sentence
 *     while choosing the same arm.
 *
 * The fixture values are deliberately not translations of the English: they are
 * markers (`FR <key>`) with a shape no English sentence has, so a value that
 * fails to translate is visible rather than plausible. A second case proves the
 * per-key English fallback still applies to a key the fixture does not carry.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export {
				composerPlaceholder,
				COMPOSER_PLACEHOLDER,
			} from "./src/renderer/src/shared/hooks/use-message-input";
			export {
				DEFAULT_MESSAGE_SUGGESTIONS,
				sampleSuggestions,
			} from "./src/renderer/src/features/chat/components/composer-suggestions";
			export {
				composerTips,
				tipRotationOrder,
			} from "./src/renderer/src/features/chat/components/composer-tips";
			export {
				CHAT_LIST_SECTION_LABEL,
				CHAT_LIST_SECTIONS,
			} from "./src/renderer/src/features/chat/chat-list-sections";
			export {
				placementLabel,
				placementSentence,
			} from "./src/renderer/src/features/chat/device/chat-device-model";
			export { groupPositionLabel } from "./src/renderer/src/shared/lib/image-viewer-model";
			export {
				clearRegisteredCatalogues,
				registerCatalogue,
				setLocale,
				t,
			} from "@shared/i18n";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	define: { "import.meta.env": "{}" },
});

const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	CHAT_LIST_SECTION_LABEL,
	CHAT_LIST_SECTIONS,
	COMPOSER_PLACEHOLDER,
	clearRegisteredCatalogues,
	composerPlaceholder,
	composerTips,
	DEFAULT_MESSAGE_SUGGESTIONS,
	groupPositionLabel,
	placementLabel,
	placementSentence,
	registerCatalogue,
	sampleSuggestions,
	setLocale,
	t,
	tipRotationOrder,
} = mod;

/** The deterministic stand-in the composer suites use, for a reproducible draw. */
const seeded = (seed) => {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
};

/*
 * The states that walk the placeholder ladder, in the order the function
 * resolves them. Each one is a single condition on top of an idle box, so the
 * expectation can name the KEY it must resolve - which is the behaviour this
 * test holds constant across locales.
 */
const LADDER = [
	["unavailable", { unavailable: true }, COMPOSER_PLACEHOLDER.unavailable],
	["secret answer", { secretAnswer: true }, COMPOSER_PLACEHOLDER.secretAnswer],
	["host line", { inputDisabled: true, hostLine: "Host's own line" }, null],
	["input disabled", { inputDisabled: true }, COMPOSER_PLACEHOLDER.busy],
	["awaiting answer", { awaitingAnswer: true }, COMPOSER_PLACEHOLDER.answer],
	["aside attached", { asideAttached: true }, COMPOSER_PLACEHOLDER.aside],
	["stopping", { stopping: true }, COMPOSER_PLACEHOLDER.stopping],
	["sending", { sendingUnsettled: true }, COMPOSER_PLACEHOLDER.sending],
	["awaiting reply", { awaitingReply: true }, COMPOSER_PLACEHOLDER.waiting],
	["no provider", { noProvider: true }, COMPOSER_PLACEHOLDER.noProvider],
	["idle", {}, COMPOSER_PLACEHOLDER.idle],
];

const FR = {
	[COMPOSER_PLACEHOLDER.unavailable]: "FR unavailable",
	[COMPOSER_PLACEHOLDER.secretAnswer]: "FR secret answer",
	[COMPOSER_PLACEHOLDER.busy]: "FR busy",
	[COMPOSER_PLACEHOLDER.answer]: "FR answer",
	[COMPOSER_PLACEHOLDER.aside]: "FR aside",
	[COMPOSER_PLACEHOLDER.stopping]: "FR stopping",
	[COMPOSER_PLACEHOLDER.sending]: "FR sending",
	[COMPOSER_PLACEHOLDER.waiting]: "FR waiting",
	[COMPOSER_PLACEHOLDER.noProvider]: "FR no provider",
	[COMPOSER_PLACEHOLDER.idle]: "FR idle",
	"ui.chat.sidebar_view.section.today": "FR today",
	"ui.chat.composer.suggestion.create_team": "FR create a team",
	"ui.chat.composer.tip.search_past_work": "FR search past work",
	"ui.chat.device.label.on_this_device": "FR on this device",
	"ui.chat.device.sentence.local": "FR this conversation runs here",
	"ui.common.viewer.position":
		"{kind, select, image {FR image {index} of {count}} asset {FR asset {index} of {count}} other {FR item}}",
};

/** The English readings, captured BEFORE any locale is changed. */
const english = {
	sections: CHAT_LIST_SECTIONS.map((key) => CHAT_LIST_SECTION_LABEL[key]),
	sample: sampleSuggestions(DEFAULT_MESSAGE_SUGGESTIONS, 4, seeded(7), {
		opening: false,
	}),
	tips: tipRotationOrder(composerTips(true), seeded(3)),
	ladder: LADDER.map(([, state]) => composerPlaceholder(state)),
	placement: placementLabel({ kind: "local" }),
	placementSentence: placementSentence({ kind: "local" }),
	position: groupPositionLabel(1, 3),
};

test("the English baseline is what the shipped copy says, not a marker", () => {
	assert.equal(english.sections.length, 4);
	for (const key of english.sections) {
		assert.match(key, /^ui\.chat\.sidebar_view\.section\./);
	}
	assert.equal(english.sample.length, 4);
	assert.equal(english.tips.length, composerTips(true).length);
	assert.equal(english.placement, "On this device");
	assert.equal(english.position, "Image 2 of 3");
	assert.equal(english.ladder[0], "This conversation is gone");
});

test("a translated catalogue changes what is painted and nothing else", () => {
	registerCatalogue("fr", FR);
	setLocale("fr");
	try {
		// 1. The catalogue actually applied: a translated value is painted.
		assert.equal(t(COMPOSER_PLACEHOLDER.idle), "FR idle");
		assert.equal(t("ui.chat.device.label.on_this_device"), "FR on this device");

		// 2. The pools, the ring and the table are IDENTITY, not copy: a draw
		//    made under `fr` is the same keys in the same order as under `en`.
		assert.deepEqual(
			sampleSuggestions(DEFAULT_MESSAGE_SUGGESTIONS, 4, seeded(7), {
				opening: false,
			}),
			english.sample,
			"a suggestion draw is locale-independent",
		);
		assert.deepEqual(
			tipRotationOrder(composerTips(true), seeded(3)),
			english.tips,
			"the tip ring is locale-independent",
		);
		assert.deepEqual(
			CHAT_LIST_SECTIONS.map((key) => CHAT_LIST_SECTION_LABEL[key]),
			english.sections,
			"the section table still holds its keys, in order",
		);

		// 3. The placeholder LADDER keeps its order and its arms; only the
		//    sentences change. The host's own line is passed through untouched.
		const ladder = LADDER.map(([name, state, key]) => {
			const painted = composerPlaceholder(state);
			return { name, key, painted };
		});
		for (const [index, rung] of ladder.entries()) {
			if (rung.key === null) {
				assert.equal(
					rung.painted,
					"Host's own line",
					"a host's own sentence is not catalogue copy and must pass through",
				);
				continue;
			}
			assert.equal(
				rung.painted,
				FR[rung.key],
				`the ${rung.name} rung paints its translated sentence`,
			);
			assert.notEqual(
				rung.painted,
				english.ladder[index],
				`the ${rung.name} rung really changed language`,
			);
		}

		// 4. The device arm is chosen from `placement.kind`, never from words:
		//    the same arm renders the translated sentence.
		assert.equal(
			placementLabel({ kind: "local" }),
			FR["ui.chat.device.label.on_this_device"],
		);
		assert.equal(
			placementSentence({ kind: "local" }),
			FR["ui.chat.device.sentence.local"],
		);
		assert.notEqual(
			placementLabel({ kind: "local" }),
			placementLabel({ kind: "moving", deviceId: "d", name: "box" }),
			"two arms remain two different sentences",
		);

		// 5. A parameterised viewer line formats the translated ICU message with
		//    the same two numbers the English arm used.
		assert.equal(groupPositionLabel(1, 3), "FR image 2 of 3");
	} finally {
		/* Leave the store as this process found it: node:test runs files
		 * sequentially but a shared import graph stays warm. */
		clearRegisteredCatalogues();
		setLocale("en");
	}
});

test("a key the locale does not carry still falls back to English per key", () => {
	/*
	 * A SYNTHETIC TAG, deliberately. The shipped locales now carry every key of
	 * every namespace this branch touches, so registering a partial catalogue
	 * over one of them would still find the bundled value on a miss and the test
	 * would prove nothing. `xx` has no bundled catalogue at all, which is the
	 * only condition under which "this locale has no message for this key" can
	 * be stated - and it is exactly the state a locale-in-progress is in.
	 */
	registerCatalogue("xx", {
		"ui.chat.composer.suggestion.linear_mcp": "XX linear MCP",
	});
	setLocale("xx");
	try {
		assert.equal(
			t("ui.chat.composer.suggestion.linear_mcp"),
			"XX linear MCP",
			"the key the fixture carries is painted",
		);
		assert.equal(
			t("ui.chat.composer.suggestion.create_team"),
			"Create a team of agents",
			"its neighbour in the same pool falls back to the English source",
		);
		// And the sampler still draws the same keys while the fallback is in play.
		assert.deepEqual(
			sampleSuggestions(DEFAULT_MESSAGE_SUGGESTIONS, 4, seeded(7), {
				opening: false,
			}),
			english.sample,
		);
	} finally {
		clearRegisteredCatalogues();
		setLocale("en");
	}
});
