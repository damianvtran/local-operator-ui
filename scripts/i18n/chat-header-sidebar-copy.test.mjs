/**
 * The chat header, message-row, transcript-region and sidebar labels resolved
 * through the catalogue — proven per call site, not by a green suite elsewhere.
 *
 * WHY THIS FILE EXISTS. The whole-UI French census found English left in a
 * French session through two holes: model constants holding English strings
 * (`NO_TEAM_LABEL`, `ANSWER_ACTIONS_LABEL`, `CHAT_REGION_LABEL`) and call sites
 * spelling English inline (`Pin conversation`, `New chat with …`,
 * `Expand … chats`, `Rename conversation`). Converting them once is not the
 * property worth holding: the property is that each site KEEPS reading its key,
 * so a later edit cannot quietly put the English back.
 *
 * TWO HALVES, because either alone is too easy to satisfy by accident.
 *
 *   1. RUNTIME. A marker catalogue is registered over English, and every
 *      accessor this change introduced is read back from it. A hardcoded
 *      string cannot return a marker, and an argument the call forgot (a
 *      `{name}`, a turn number) shows up as a blank in the rendered form.
 *   2. SOURCE. Each call-site file must name its key and must no longer
 *      contain the English literal it replaced. Comments are stripped before
 *      that check because this codebase documents the old strings on purpose
 *      ("the button no longer says `All chats`"); the check is about code.
 *
 * The English control runs after the marker half: with the marker locale
 * released, the same accessors must return the shipped catalogue values, so a
 * break in the wiring cannot hide behind a coincidentally matching string.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export {
				answerActionsLabel,
				userActionsLabel,
			} from "./src/renderer/src/features/chat/canonical/message-actions";
			export { chatRegionLabel } from "./src/renderer/src/features/chat/chat-regions";
			export {
				noAgentLabel,
				noTeamLabel,
			} from "./src/renderer/src/features/chat/components/chat-header-identity-model";
			export {
				checkpointAriaLabel,
				checkpointGeneratingName,
				checkpointTurnLabel,
			} from "./src/renderer/src/features/chat/canonical/checkpoint-model";
			export {
				clearRegisteredCatalogues,
				registerCatalogue,
				setLocale,
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

/*
 * The marker values. Each one names its own key and, where the message takes
 * placeholders, dumps them: a value that arrives translated is therefore
 * unambiguous, and an argument the call stopped passing is visible in the
 * assertion rather than silently absorbed by English.
 */
const MARKERS = {
	"ui.chat.response_actions.answer_label": "M answer_label",
	"ui.chat.response_actions.yours_label": "M yours_label",
	"ui.chat.sidebar.nav.chats": "M chats",
	"ui.chat.region.composer": "M composer",
	"ui.chat.region.conversation": "M conversation",
	"ui.chat.header_identity.no_agent": "M no_agent",
	"ui.chat.header_identity.no_team": "M no_team",
	"ui.chat.checkpoint.generating_name": "M generating_name",
	"ui.chat.checkpoint.turn": "M turn={turn} total={total}",
	"ui.chat.checkpoint.jump_agent": "M jump_agent name={name}",
	"ui.chat.checkpoint.jump_agent_unnamed": "M jump_agent_unnamed",
	"ui.chat.checkpoint.jump_user": "M jump_user clock={clock}",
	"ui.chat.checkpoint.jump_user_no_clock": "M jump_user_no_clock",
};

/** One checkpoint row, in the shape the rail builds from the journal. */
const checkpoint = (overrides = {}) => ({
	id: "u1",
	kind: "user",
	turn: 1,
	ts: new Date(2026, 8, 28, 14, 32).getTime() / 1000,
	naming: null,
	...overrides,
});

test("every keyed accessor paints the catalogue's value, not its English", () => {
	mod.registerCatalogue("fr", MARKERS);
	mod.setLocale("fr");

	assert.equal(mod.answerActionsLabel(), "M answer_label");
	assert.equal(mod.userActionsLabel(), "M yours_label");
	assert.equal(mod.noAgentLabel(), "M no_agent");
	assert.equal(mod.noTeamLabel(), "M no_team");
	assert.equal(mod.checkpointGeneratingName(), "M generating_name");

	/*
	 * The four regions resolve through three entries on purpose (the header and
	 * the transcript head the same conversation); naming the exact marker per
	 * region catches a re-pointed label, which an "is not English" check would
	 * not.
	 */
	assert.equal(mod.chatRegionLabel("sidebar"), "M chats");
	assert.equal(mod.chatRegionLabel("header"), "M conversation");
	assert.equal(mod.chatRegionLabel("transcript"), "M conversation");
	assert.equal(mod.chatRegionLabel("composer"), "M composer");
});

test("the turn identity and the tick names carry their arguments", () => {
	mod.registerCatalogue("fr", MARKERS);
	mod.setLocale("fr");

	assert.equal(
		mod.checkpointTurnLabel(3, 7),
		"M turn=3 total=7",
		"the visible identity line takes both counts",
	);
	assert.equal(
		mod.checkpointAriaLabel(
			checkpoint({
				kind: "completion",
				turn: 3,
				naming: { state: "ready", name: "Fix the build", summary: "s" },
			}),
			7,
		),
		"M jump_agent name=Fix the build",
		"a named completion passes its own title through {name}",
	);
	assert.equal(
		mod.checkpointAriaLabel(
			checkpoint({ kind: "completion", turn: 3, naming: null }),
			7,
		),
		"M jump_agent_unnamed",
		"an unnamed completion takes the titleless form",
	);
	/*
	 * The clock half is the locale formatter's own output, so the assertion is
	 * about the SLOT being filled rather than about the digits: a call that
	 * stopped passing `clock` would leave `clock=` empty.
	 */
	assert.match(
		mod.checkpointAriaLabel(checkpoint({}), 2),
		/^M jump_user clock=\S/,
		"a user tick passes the formatted clock",
	);
	assert.equal(
		mod.checkpointAriaLabel(checkpoint({ ts: 0 }), 2),
		"M jump_user_no_clock",
		"and a message with no usable time drops the clock rather than inventing one",
	);
});

test("with the marker released, the same accessors return the shipped English", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");

	assert.equal(mod.answerActionsLabel(), "Answer actions");
	assert.equal(mod.userActionsLabel(), "Your message actions");
	assert.equal(mod.noAgentLabel(), "No agent");
	assert.equal(mod.noTeamLabel(), "No team");
	assert.equal(mod.checkpointGeneratingName(), "Generating name…");
	assert.equal(mod.chatRegionLabel("composer"), "Message composer");
	assert.equal(mod.chatRegionLabel("transcript"), "Conversation");
	assert.equal(mod.checkpointTurnLabel(2, 5), "Turn 2 of 5");
	assert.equal(
		mod
			.checkpointAriaLabel(checkpoint({ turn: 2 }), 5)
			.startsWith("Jump to your message in turn 2 of 5, "),
		true,
	);
});

/* ------------------------------------------------------------ the sites */

const CHAT = "src/renderer/src/features/chat";

/** Block comments, which in this codebase quote the retired strings. */
const stripBlockComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

/*
 * One row per changed call site: the file, the key it must name, and the code
 * shape it must no longer hold. `absent` entries are matched against the
 * comment-stripped source, so a docblock may still explain the old wording.
 */
const SITES = [
	{
		what: "the agent answer's action row",
		file: `${CHAT}/canonical/message-actions.ts`,
		present: [
			"ui.chat.response_actions.answer_label",
			"ui.chat.response_actions.yours_label",
		],
		absent: ['"Answer actions"', '"Your message actions"'],
	},
	{
		what: "the message row's Copy and Fork controls",
		file: `${CHAT}/canonical/message-actions-row.tsx`,
		present: [
			"ui.chat.response_actions.copy",
			"ui.chat.response_actions.copied",
			"ui.chat.pickers.destination_pickers.fork_from_this_message",
		],
		absent: ['content="Fork from this message"', '"Copied" : "Copy"'],
	},
	{
		what: "the chat regions' accessible names",
		file: `${CHAT}/chat-regions.ts`,
		present: [
			"ui.chat.region.composer",
			"ui.chat.region.conversation",
			"ui.chat.sidebar.nav.chats",
		],
		absent: ['composer: "Message composer"', 'sidebar: "Chats"'],
	},
	{
		what: "the header identity chip's labels and sentences",
		file: `${CHAT}/components/chat-header-identity-model.ts`,
		present: [
			"ui.chat.header_identity.no_agent",
			"ui.chat.header_identity.no_team",
		],
		absent: ['NO_TEAM_LABEL = "No team"', 'NO_AGENT_LABEL = "No agent"'],
	},
	{
		what: "the header chip's accessible name",
		file: `${CHAT}/components/chat-header-identity.tsx`,
		present: [
			"ui.chat.header_identity.aria_agent_assign",
			"ui.chat.header_identity.aria_agent_switch",
			"ui.chat.header_identity.aria_agent_closed",
			"ui.chat.header_identity.aria_team_assign",
			"ui.chat.header_identity.aria_team_switch",
			"ui.chat.header_identity.aria_team_closed",
			"ui.chat.header_identity.assign_agent",
			"ui.chat.header_identity.assign_team",
		],
		absent: ['? "Assign a team"', '? "Assign an agent"', "triggerLabel="],
	},
	{
		what: "the header's rename and archive controls",
		file: `${CHAT}/components/chat-header.tsx`,
		present: [
			"ui.chat.header.rename_conversation",
			"ui.chat.header.cancel_rename",
			"ui.chat.header.saving_conversation_name",
			"ui.chat.header.archive_conversation",
			"ui.chat.header.restore_conversation",
		],
		absent: [
			'"Rename conversation"',
			'"Cancel rename"',
			'"Saving the conversation name"',
			'"Archive conversation"',
			'"Restore conversation"',
		],
	},
	{
		what: "the sidebar row menu's archive and pin items",
		file: `${CHAT}/components/chat-sidebar.tsx`,
		present: [
			"ui.chat.sidebar.row_menu.archive",
			"ui.chat.sidebar.row_menu.unarchive",
			"ui.chat.sidebar.row_menu.pin",
			"ui.chat.sidebar.row_menu.unpin",
			"ui.chat.sidebar.pins.pin_label",
			"ui.chat.sidebar.pins.unpin_label",
			"ui.chat.sidebar.entity.pin",
			"ui.chat.sidebar.entity.unpin",
			"ui.chat.sidebar.entity.manage",
			"ui.chat.sidebar.entity.expand_chats",
			"ui.chat.sidebar.entity.collapse_chats",
			"ui.chat.header.new_chat_with",
		],
		absent: [
			'"Unpin conversation"',
			'"Pin conversation"',
			'"Unarchive conversation"',
			'"Archive conversation"',
			"`New chat with ${displayName}`",
			"`Manage ${displayName}`",
			'`${open ? "Collapse" : "Expand"} ${displayName} chats`',
			"`Pin “${name}”`",
		],
	},
	{
		what: "the run-details rail's turn labels",
		file: `${CHAT}/canonical/checkpoint-model.ts`,
		present: [
			"ui.chat.checkpoint.turn",
			"ui.chat.checkpoint.jump_agent",
			"ui.chat.checkpoint.jump_agent_unnamed",
			"ui.chat.checkpoint.jump_user",
			"ui.chat.checkpoint.jump_user_no_clock",
			"ui.chat.checkpoint.generating_name",
		],
		absent: [
			"`Turn ${turn} of ${turnCount}`",
			'"Generating name…"',
			"`Jump to your message in ${position}",
		],
	},
];

for (const site of SITES) {
	test(`${site.what} reads its catalogue keys and holds no English literal`, () => {
		const source = readFileSync(site.file, "utf8");
		const code = stripBlockComments(source);
		for (const key of site.present) {
			assert.ok(
				source.includes(key),
				`${site.file}: no longer names ${key} - the site must resolve through the catalogue, not through a literal`,
			);
		}
		for (const literal of site.absent) {
			assert.equal(
				code.includes(literal),
				false,
				`${site.file}: the English literal ${literal} is back in the code - key it instead`,
			);
		}
	});
}
