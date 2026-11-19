import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE ASK CARD AND THE REPLY CHIP ARE FOUND BY MACHINE, NOT BY THEIR ENGLISH NAME.
 *
 * Both surfaces carry a TRANSLATED accessible name (`ui.chat.asks.answer_options`,
 * `ui.chat.reply.remove`) and both keyboard paths used to query that name as a
 * literal selector. In `en` the catalogue value happens to equal the literal, so
 * every test that ran in `en` was green; after `fr` the attribute is translated,
 * the query matches nothing and the failure is silent - Enter stops answering the
 * focused option (i18n flowmap, C2) and focus falls out of the reply strip
 * (C3). The audit could only see it by reading the DOM under a non-English label,
 * which is exactly what this file does.
 *
 * Two halves, and neither is sufficient alone:
 *
 *  - the DOM half drives the PRODUCTION selector constants (exported from
 *    `composer-field.ts`, the leaf module that names elements for the surfaces
 *    that must find them without being handed them) against a French document,
 *    and pairs every positive with the negative that makes it meaningful - the
 *    label-derived query must MISS, or the fixture is not proving anything;
 *  - the SOURCE half asserts the components still carry the translated label and
 *    now carry the machine anchor, because a selector constant no component emits
 *    would pass the DOM half against this file's own markup and nothing else.
 *
 * What this proves: the anchors resolve under a non-English accessible name, the
 * keyboard probe (`activeElement.closest`) and the focus-restoration query find
 * the right nodes, and the components emit the anchors while keeping the label
 * translated. What it does NOT prove: that the app renders the composer, answers
 * an ask or removes a chip end to end - that is the real-app QA round's job.
 */

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/composer-field";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
assert.ok(bundle.outputFiles[0], "the composer anchor bundle did not compile");
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** French on purpose: the label must be one no English literal could match. */
const ANSWER_OPTIONS_FR = "Options de réponse";
const REMOVE_REPLY_FR = "Retirer la réponse";
const ENGLISH_ANSWER_OPTIONS = '[aria-label="Answer options"]';
const ENGLISH_REMOVE_REPLY = '[aria-label="Remove reply"]';

const source = (path) => readFileSync(join(ROOT, path), "utf8");

function documentFrom(body) {
	return new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window
		.document;
}

function askCard(label) {
	return `
		<fieldset aria-label="${label}" data-ask-options>
			<button type="button" data-ask-option>Oui</button>
			<button type="button" data-ask-option disabled>Non</button>
			<button type="button" data-ask-option>Peut-être</button>
		</fieldset>`;
}

function replyChips(label, count) {
	return `<div>${Array.from(
		{ length: count },
		(_, index) =>
			`<button type="button" data-reply-chip-remove aria-label="${label}">Retirer ${index}</button>`,
	).join("")}</div>`;
}

test("the ask-options anchor resolves a card whose label is translated", () => {
	const { ASK_OPTIONS_SELECTOR } = mod;
	assert.equal(
		typeof ASK_OPTIONS_SELECTOR,
		"string",
		"composer-field must export ASK_OPTIONS_SELECTOR so every surface queries one handle",
	);
	const document = documentFrom(askCard(ANSWER_OPTIONS_FR));

	const card = document.querySelector(ASK_OPTIONS_SELECTOR);
	assert.ok(
		card,
		`the anchor must find the card labelled "${ANSWER_OPTIONS_FR}"`,
	);
	assert.equal(
		card.getAttribute("aria-label"),
		ANSWER_OPTIONS_FR,
		"the accessible name stays translated - the anchor must not replace it",
	);
	// The negative control: this is the query that made the defect silent in fr.
	assert.equal(document.querySelector(ENGLISH_ANSWER_OPTIONS), null);

	// `firstLiveAnswerOption`'s query: the first option a user could reach.
	const first = document.querySelector(
		`${ASK_OPTIONS_SELECTOR} button:not([disabled])`,
	);
	assert.ok(first, "the live-option query must find the enabled option");
	assert.equal(first.textContent, "Oui");

	// C2's keyboard probe: `document.activeElement.closest(...)`.
	first.focus();
	assert.equal(document.activeElement, first);
	assert.ok(
		document.activeElement.closest(ASK_OPTIONS_SELECTOR),
		"pressing a focused option must still read as a keyboard press under fr",
	);
	assert.equal(document.activeElement.closest(ENGLISH_ANSWER_OPTIONS), null);

	// The focus-restoration and cardOnScreen queries read BOTH answer surfaces.
	assert.ok(
		document.querySelector(`${ASK_OPTIONS_SELECTOR}, [data-ask-secret]`),
		"the on-screen probe must see an options card",
	);
});

test("the reply-chip remove anchor resolves under fr and restores focus by index", () => {
	const { REPLY_CHIP_REMOVE_SELECTOR } = mod;
	assert.equal(
		typeof REPLY_CHIP_REMOVE_SELECTOR,
		"string",
		"composer-field must export REPLY_CHIP_REMOVE_SELECTOR so the chip and its reader share one handle",
	);
	const document = documentFrom(replyChips(REMOVE_REPLY_FR, 3));

	assert.equal(document.querySelectorAll(ENGLISH_REMOVE_REPLY).length, 0);
	const chips = document.querySelectorAll(REPLY_CHIP_REMOVE_SELECTOR);
	assert.equal(
		chips.length,
		3,
		"every chip's remove control carries the anchor",
	);
	assert.equal(chips[0].getAttribute("aria-label"), REMOVE_REPLY_FR);

	// The removal's own hand-off (message-input): the removed chip's index, then
	// focus lands on the chip that takes its place, clamped to the last one.
	const removed = 1;
	chips[removed].remove();
	const remaining = document.querySelectorAll(REPLY_CHIP_REMOVE_SELECTOR);
	const next = remaining[Math.min(removed, remaining.length - 1)];
	assert.ok(next, "removing a middle chip must leave a focus target");
	next.focus();
	assert.equal(
		document.activeElement,
		next,
		"focus must land on a chip, not fall out of the strip to the body",
	);
});

test("the components emit the anchors and keep the translated labels", () => {
	const askOptions = source(
		"src/renderer/src/features/chat/components/trace/ask-options.tsx",
	);
	assert.ok(
		askOptions.includes("data-ask-options"),
		"the options band must emit the machine anchor",
	);
	assert.ok(
		askOptions.includes('t("ui.chat.asks.answer_options")'),
		"the band's accessible name must stay catalogue-backed",
	);

	const replyPreview = source(
		"src/renderer/src/features/chat/components/reply-preview.tsx",
	);
	assert.ok(
		replyPreview.includes("data-reply-chip-remove"),
		"the chip's remove control must emit the machine anchor",
	);
	assert.ok(
		replyPreview.includes('t("ui.chat.reply.remove")'),
		"the control's accessible name must stay catalogue-backed",
	);

	for (const path of [
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"src/renderer/src/shared/components/composer/message-input.tsx",
	]) {
		const text = source(path);
		assert.ok(
			!text.includes(ENGLISH_ANSWER_OPTIONS),
			`${path} must not select the ask card by its English label`,
		);
		assert.ok(
			!text.includes(ENGLISH_REMOVE_REPLY),
			`${path} must not select the chip's control by its English label`,
		);
	}
});
