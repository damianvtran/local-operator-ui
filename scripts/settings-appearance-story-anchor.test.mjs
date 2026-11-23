/**
 * The `Shell/App Shell › Settings Appearance` story anchors on its section.
 *
 * WHY THIS EXISTS. The story scrolls Settings to the Appearance section so
 * captures named "Settings Appearance" show it. It used to centre the section's
 * `button[role="switch"]` - the "show agent reasoning" toggle. PR #1983 removed
 * that toggle, the Appearance section was left with no switch, and the story
 * silently stayed at the top of General settings (QA Q1-1, design D1): the
 * observer never matched, so `data-capture-pending` was never cleared either.
 *
 * THE CONTRACT. The scroll target is the section container
 * (`[data-tour-tag="settings-appearance-section"]`, which wraps the heading),
 * never a single control inside it, so removing any one setting cannot strand
 * the story again. A source pin rather than a render: the story's behaviour is
 * the selector it queries, and this runs on every PR without Storybook.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SHELL_STORIES =
	"src/renderer/src/shared/components/navigation/shell.stories.tsx";

const ANCHOR_CONSTANT =
	/const APPEARANCE = '\[data-tour-tag="settings-appearance-section"\]';/;
const QUERIES_SECTION =
	/const section = document\.querySelector\(APPEARANCE\);/;
const SCROLLS_SECTION = /section\.scrollIntoView\(\{ block: "start" \}\)/;
const SWITCH_SELECTOR = /button\[role="switch"\]/;
const INNER_QUERY = /section\?\.querySelector\(/;

const source = readFileSync(`${process.cwd()}/${SHELL_STORIES}`, "utf8");

/** The body of `SettingsAtAppearance`, up to the story export that renders it. */
const storyBody = () => {
	const start = source.indexOf("const SettingsAtAppearance: FC");
	const end = source.indexOf("export const SettingsAppearance: Story");
	assert.ok(
		start >= 0 && end > start,
		"SettingsAtAppearance and its SettingsAppearance story export are both present",
	);
	return source.slice(start, end);
};

test("the anchor constant names the Appearance section container", () => {
	assert.match(source, ANCHOR_CONSTANT);
});

test("the story scrolls the section itself into view", () => {
	const body = storyBody();
	assert.match(body, QUERIES_SECTION);
	assert.match(body, SCROLLS_SECTION);
});

test("the story does not anchor on any one control inside the section", () => {
	const body = storyBody();
	assert.doesNotMatch(
		body,
		SWITCH_SELECTOR,
		"the reasoning switch was removed (PR #1983); anchoring on a control strands the story",
	);
	assert.doesNotMatch(body, INNER_QUERY);
});
