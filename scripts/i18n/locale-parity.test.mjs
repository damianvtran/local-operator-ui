import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TYPE, parse } from "@formatjs/icu-messageformat-parser";

/*
 * FRENCH PARITY GUARD — the checks that make a shipped locale honest.
 *
 * Applied to every locale the repository actually ships (`catalogues/<locale>/`),
 * this asserts the three properties a translated catalogue must hold, and — just
 * as important — that it is REAL:
 *
 *  1. NO UNKNOWN KEYS. Every key in a locale file must exist in `en`. A key that
 *     is not in `en` is dead weight (nothing can look it up) and a sign of a
 *     rename that left the old id behind.
 *  2. PLACEHOLDER INTEGRITY. Every ICU argument (`{name}`, `{count}`, a plural,
 *     a select, a date) present in the English message must be present in the
 *     translation with the SAME name. A dropped `{count}` renders "files" with no
 *     number; a renamed one throws at format time. This parses BOTH sides with the
 *     real ICU parser rather than matching braces by hand.
 *  3. NOT AN ENGLISH STUB. A locale file whose values are byte-identical to `en`
 *     for a key is not a translation. Some values are legitimately identical
 *     (a proper noun, a token) — those are listed in `IDENTICAL_OK` with a reason,
 *     so an accidental English copy is caught while an intentional one passes.
 *
 * WHY A GUARD AND NOT A REVIEW NOTE: the operator's bug was a locale that LOOKED
 * shipped (the picker offered it, the store reported it) with nothing behind it.
 * These assertions are what stop an empty or English-only file from counting as a
 * translation, and they run per shipped locale so a second locale cannot skip them.
 */

const REPO = join(import.meta.dirname, "..", "..");
const CATALOGUES = join(REPO, "src", "i18n", "catalogues");
const SOURCE_LOCALE = "en";

/*
 * Values that are legitimately identical to English in a translation, with the
 * reason. Keep this EMPTY unless a string truly must not change: a proper noun or
 * a UI token. An entry here is a claim that gets reviewed, not a silencer.
 */
const IDENTICAL_OK = new Map([
	[
		"ui.phone_pairing.platform.ios",
		"Product name (Apple's iPhone), kept as the brand in every locale; the phone-pairing card labels the phone type with it (local-operator-ui #1912).",
	],
	[
		"fr:ui.phone_pairing.popup.code_label",
		"French cognate « Code », the label above the pairing card's six digits; the French word, not an English fallback (local-operator-ui #1912, for the i18n auditor's confirmation).",
	],
	[
		"ui.phone_pairing.platform.android",
		"Product name (Google's Android), kept as the brand in every locale; the phone-pairing card labels the phone type with it (local-operator-ui #1912).",
	],
	[
		"fr:ui.settings.notifications.section.title",
		"French cognate « Notifications »; independently audited in D2 r2 (b5bf3a7c1761). This exact French heading is not an English fallback.",
	],
	[
		"fr:ui.settings.notifications.volume.label",
		"French cognate « Volume »; independently audited in D2 r2 (b5bf3a7c1761). This exact French label is not an English fallback.",
	],
	[
		"hi:ui.settings.notifications.volume.readout",
		"The percent readout is the locale-formatted ICU token {value, number}%, with no lexical English to translate; independently audited in D2 r2 (b5bf3a7c1761). Scoped to this locale/key only.",
	],
	[
		"ur:ui.settings.notifications.volume.readout",
		"The percent readout is the locale-formatted ICU token {value, number}%, with no lexical English to translate; independently audited in D2 r2 (b5bf3a7c1761). Scoped to this locale/key only.",
	],
	[
		"vi:ui.settings.notifications.volume.readout",
		"The percent readout is the locale-formatted ICU token {value, number}%, with no lexical English to translate; independently audited in D2 r2 (b5bf3a7c1761). Scoped to this locale/key only.",
	],
	[
		"zh-CN:ui.settings.notifications.volume.readout",
		"The percent readout is the locale-formatted ICU token {value, number}%, with no lexical English to translate; independently audited in D2 r2 (b5bf3a7c1761). Scoped to this locale/key only.",
	],
	// Mark-all-read tooltip (PR #1836): the joiner between the two translated sentences.
	[
		"es:ui.chat.sidebar.mark_all_read.scope_joined",
		"Pure joiner: two already-translated sentences separated by one space, no lexical English (zh-CN differs because it uses no separator). Each locale's independent auditor is to confirm the space is the right separator; scoped to this locale/key only.",
	],
	[
		"fr:ui.chat.sidebar.mark_all_read.scope_joined",
		"Pure joiner: two already-translated sentences separated by one space, no lexical English (zh-CN differs because it uses no separator). Each locale's independent auditor is to confirm the space is the right separator; scoped to this locale/key only.",
	],
	[
		"hi:ui.chat.sidebar.mark_all_read.scope_joined",
		"Pure joiner: two already-translated sentences separated by one space, no lexical English (zh-CN differs because it uses no separator). Each locale's independent auditor is to confirm the space is the right separator; scoped to this locale/key only.",
	],
	[
		"ru:ui.chat.sidebar.mark_all_read.scope_joined",
		"Pure joiner: two already-translated sentences separated by one space, no lexical English (zh-CN differs because it uses no separator). Each locale's independent auditor is to confirm the space is the right separator; scoped to this locale/key only.",
	],
	[
		"ur:ui.chat.sidebar.mark_all_read.scope_joined",
		"Pure joiner: two already-translated sentences separated by one space, no lexical English (zh-CN differs because it uses no separator). Each locale's independent auditor is to confirm the space is the right separator; scoped to this locale/key only.",
	],
	[
		"vi:ui.chat.sidebar.mark_all_read.scope_joined",
		"Pure joiner: two already-translated sentences separated by one space, no lexical English (zh-CN differs because it uses no separator). Each locale's independent auditor is to confirm the space is the right separator; scoped to this locale/key only.",
	],
	// Browser extensions manager (PR #1821): proper nouns and French cognates.
	[
		"ui.browser.extensions.menu_store",
		"« Chrome Web Store » is Google's product name, which Chrome shows untranslated in every locale; identical in every locale by design, audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790).",
	],
	[
		"ui.browser.extensions.source_store",
		"« Chrome Web Store » is Google's product name, which Chrome shows untranslated in every locale; identical in every locale by design, audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790).",
	],
	[
		"ui.browser.extensions.details_id",
		"« ID » is the extension identifier label, the universal abbreviation Chrome's own extension details use in every shipped locale; identical by design, audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790).",
	],
	[
		"fr:ui.browser.extensions.menu_extensions",
		"French cognate « Extensions » (Chrome's own French label); audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790). Scoped to French only.",
	],
	[
		"fr:ui.browser.extensions.manage_title",
		"French cognate « Extensions » (Chrome's own French label); audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790). Scoped to French only.",
	],
	[
		"fr:ui.browser.extensions.page_title",
		"French cognate « Extensions » (Chrome's own French label); audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790). Scoped to French only.",
	],
	[
		"fr:ui.browser.extensions.action_options",
		"French cognate « Options » (Chrome's own French label); audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790). Scoped to French only.",
	],
	[
		"fr:ui.browser.extensions.details_description",
		"French cognate « Description » (Chrome's own French label); audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790). Scoped to French only.",
	],
	[
		"fr:ui.browser.extensions.details_version",
		"French cognate « Version » (Chrome's own French label); audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790). Scoped to French only.",
	],
	[
		"fr:ui.browser.extensions.blocked_notifications",
		"French cognate « Notifications » (Chrome's own French label); audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790). Scoped to French only.",
	],
	[
		"fr:ui.browser.extensions.details_source",
		"French cognate « Source » (Chrome's own French label); audited in the ui.browser.extensions copy audit (receipt 78bf270248b6, r3 at 1312d42a790). Scoped to French only.",
	],

	[
		"ui.settings.appearance.editor.copy_name",
		"Audited custom-editor literal: placeholders/punctuation, standard colour-space acronym, or product name; identical in every locale by design (I18N-C1).",
	],
	[
		"ui.settings.appearance.editor.ratio",
		"Audited custom-editor literal: placeholders/punctuation, standard colour-space acronym, or product name; identical in every locale by design (I18N-C1).",
	],
	[
		"ui.settings.appearance.editor.picker.rgb",
		"Audited custom-editor literal: placeholders/punctuation, standard colour-space acronym, or product name; identical in every locale by design (I18N-C1).",
	],
	[
		"ui.settings.appearance.editor.picker.oklch",
		"Audited custom-editor literal: placeholders/punctuation, standard colour-space acronym, or product name; identical in every locale by design (I18N-C1).",
	],
	[
		"ui.settings.appearance.editor.preview.bridge",
		"Audited custom-editor literal: placeholders/punctuation, standard colour-space acronym, or product name; identical in every locale by design (I18N-C1).",
	],
	[
		"fr:ui.settings.appearance.editor.floor",
		"Independently audited French custom-editor terminology/cognate or ratio notation; exact locale/key only, not an English fallback (I18N-C1).",
	],
	[
		"fr:ui.settings.appearance.editor.picker.chroma",
		"Independently audited French custom-editor terminology/cognate or ratio notation; exact locale/key only, not an English fallback (I18N-C1).",
	],
	[
		"fr:ui.settings.appearance.editor.group.accent",
		"Independently audited French custom-editor terminology/cognate or ratio notation; exact locale/key only, not an English fallback (I18N-C1).",
	],
	[
		"fr:ui.settings.appearance.editor.role.accent",
		"Independently audited French custom-editor terminology/cognate or ratio notation; exact locale/key only, not an English fallback (I18N-C1).",
	],
	[
		"fr:ui.settings.appearance.editor.role.accentAlt",
		"Independently audited French custom-editor terminology/cognate or ratio notation; exact locale/key only, not an English fallback (I18N-C1).",
	],
	[
		"fr:ui.settings.appearance.editor.role.danger",
		"Independently audited French custom-editor terminology/cognate or ratio notation; exact locale/key only, not an English fallback (I18N-C1).",
	],
	[
		"fr:ui.settings.appearance.editor.preview.sidebar",
		"Independently audited French custom-editor terminology/cognate or ratio notation; exact locale/key only, not an English fallback (I18N-C1).",
	],
	[
		"es:ui.teamBridge.attachmentCard.bytes",
		"Spanish standard unit copy is {size, number} bytes; independently audited by f93eb129057e (S3 receipt). Exact locale/key only, not an English fallback.",
	],
	[
		"fr:ui.chat.thread_search.role.agent",
		"French cognate: the role name for an agent turn is « Agent », same spelling; scoped to fr so other locales still translate it",
	],
	/*
	 * The slash-argument headings the C1/C4 change added (i18n programme). The
	 * three French words ARE the French UI nouns - « Effort », « Agents »,
	 * « Options » - and the fr `ui.chat.pickers` audit passed them as-is
	 * (instance 116e76eaea2c, whose reviewed_keys name all three; 0 blocker /
	 * 0 major). The composer merge-delta audit 9a8cf2fffd64-cmpmrg1-fr is a
	 * different namespace and is not the provenance for these keys. Editing them to differ would only make the gate happy at the
	 * cost of the audited bytes, so they are named here, fr-scoped, and every other
	 * locale still has to translate them.
	 */
	[
		"fr:ui.chat.pickers.slash.source.effort",
		"French UI noun: Effort, same spelling as English; audited as-is (fr pickers, 116e76eaea2c)",
	],
	[
		"fr:ui.chat.pickers.slash.source.agent",
		"French plural: Agents, same spelling as English; audited as-is (fr pickers, 116e76eaea2c)",
	],
	[
		"fr:ui.chat.pickers.slash.source.title_refresh",
		"French plural: Options, same spelling as English; audited as-is (fr pickers, 116e76eaea2c)",
	],
	// French cognates only: these are the normal French UI nouns, not English
	// fallbacks. Scope to fr so untranslated nouns in other languages still fail.
	[
		"fr:ui.chat.canonical.image_label",
		"French UI noun: Image, same spelling as English; scoped to fr so other locales still translate it",
	],
	[
		"fr:ui.chat.canonical.media.image_label",
		"French UI noun: Image, same spelling as English; scoped to fr so other locales still translate it",
	],
	["fr:ui.notifications.nav.label", "French UI noun: Notifications"],
	["fr:ui.notifications.page.title", "French UI noun: Notifications"],
	[
		"fr:ui.notifications.filter.group_conversation",
		"French cognate: Conversation",
	],
	[
		"fr:ui.teamBridge.members.group.agents_v2",
		"French glossary plural « Agents » — same spelling as English; scoped to fr so other locales still translate it",
	],
	[
		"fr:ui.teamBridge.profile.agent_badge",
		"French glossary term for agent is « agent » — same spelling as English; scoped to fr so other locales still translate it",
	],
	[
		"fr:ui.teamBridge.invitations.title",
		"Shared UI term: the French noun is spelled identically (« Invitations »); scoped to fr so other locales still translate it",
	],
	[
		"ui.notifications.row.chip.repeat",
		// `×{count}`: the repeat chip on a collapsed reel row (notifications design
		// section 4). A multiplication sign and a placeholder, no words; its context
		// note requires every locale to keep it identical, so a differing value
		// would be invented punctuation rather than a translation.
		"language-neutral counter: only '×' and a placeholder, no words",
	],
	[
		"ui.notifications.filter.chip",
		// `{label}: {value}`: a filter chip's "Kind: All", two placeholders and a
		// colon. It is ONE message so a locale owns its punctuation (French puts a
		// space before the colon, Chinese uses a full-width one), which is why a
		// locale MAY differ; where the locale's punctuation is the same as
		// English, identical is the correct translation, not a stub.
		"format string: two placeholders and a colon, punctuation only",
	],
	[
		"ui.console.pane.label",
		// A shared UI term, not a copy of untranslated English: French uses
		// « Console » for this surface verbatim, and the English string IS that same
		// common noun. The translation is correct as identical — the exemption is
		// about the WORD, not about skipping work. Naming the key here is the claim;
		// the reason is what makes it reviewable.
		"shared UI term: the French word for this pane is the same common noun",
	],
	[
		"ui.console.capacity.summary_compact_bare",
		// `{live, number}/{limit, number}`: placeholders and a slash, no words. There
		// is nothing to translate, and a French value that differed would only be
		// invented punctuation. Identical is the correct translation here.
		"language-neutral counter: only placeholders and '/', no words to translate",
	],
	[
		"ui.chat.attachments.file_meta",
		// `{type} · {size}`: placeholders and a middle dot, no words. The type is a
		// filename-derived token (PDF, PNG) and the size is formatted by the caller;
		// there is nothing for a locale to translate, and a differing value would
		// only invent punctuation per language.
		"language-neutral format string: only placeholders and '·', no words",
	],
	[
		// The screen-reader name of an ineligible invite row: "{name}, {reason}".
		// Locales whose list comma is "," keep it byte-identical; zh-CN and ur
		// own their punctuation, which is why this is not a locale-scoped row.
		"ui.teamBridge.members.ineligible_label",
		"language-neutral format string: only placeholders and ',', no words",
	],
	[
		"ui.teamBridge.delivery.summary.separator",
		// " · " joins the one-line delivery summary's segments ("Delivered to 3 ·
		// 2 screening"). Each segment is its own translated message; the separator
		// carries no words, and every shipped locale keeps the middle dot, as
		// ui.chat.attachments.file_meta does. The key exists so a locale CAN own
		// the separator; identical is the audited translation (PR #1832 i18n audit).
		"language-neutral separator: a middle dot with spaces, no words",
	],
	[
		"ui.canvas.files.attachmentMeta",
		// `{size} · {when}`: the Canvas attachment row's note, placeholders and a
		// middle dot, no words. The size and the date arrive already localised
		// (`attachmentSizeLabel`, `formatDate`); the message exists only so a locale
		// CAN own the separator, so identical is the correct translation in every
		// shipped locale - the same shape as `ui.chat.attachments.file_meta`.
		"language-neutral format string: only placeholders and '·', no words",
	],
	[
		"ui.settings.account.settings_page.radient_pass",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.account.settings_page.tokens",
		"French technical term kept English by the French style guide (token).",
	],
	[
		"ui.browser.browser_url_bar.address_suggestions_label_mixed",
		// French uses « Suggestions » for this list heading, the same word as the
		// English source. The other six targets differ; this is a cognate, not a
		// skipped string. The key is named here so the exemption is reviewable.
		"French cognate: « Suggestions » has the same spelling",
	],
	[
		"ui.settings.configuration.settings_page.version",
		"French cognate: « version » has the same spelling.",
	],
	[
		"ui.settings.configuration.settings_page.description",
		"French cognate: « description » has the same spelling.",
	],
	[
		"ui.settings.integrations.add_integration_form.arguments",
		"French command-line term: « arguments » has the same spelling.",
	],
	[
		"ui.settings.integrations.add_integration_form.url",
		"Standard technical abbreviation, unchanged in French.",
	],
	[
		"ui.settings.integrations.add_integration_form.https_mcp_example_com_mcp",
		"Literal sample URL; context requires it to remain byte-identical.",
	],
	[
		"ui.settings.integrations.integration_model.claude_code",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.integrations.integration_model.vs_code",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.integrations.integration_model.codex_cli",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.integrations.integration_model.global",
		"French scope adjective: « global » has the same spelling.",
	],
	[
		"es:ui.mesh.mesh_approvals.profile_scope_global",
		"Spanish scope adjective: « global » is the normal spelling for account-wide scope; this audited label is a cognate, not an English stub.",
	],
	[
		"fr:ui.mesh.mesh_approvals.profile_scope_global",
		"French scope adjective: « global » is the normal masculine label for account-wide scope; this audited label is a cognate, not an English stub.",
	],
	[
		"ui.settings.model.system_prompt.instructions",
		"French cognate: « instructions » has the same spelling.",
	],
	[
		"ui.settings.speech.speech_settings_model.radient_pass",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.shell.collapsible_app_logo.local_operator",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.shell.sidebar_navigation.mesh",
		// The lop Mesh feature is a named product destination in the audited
		// Spanish copy: ui.mesh prose says «no hay ningún Mesh» and the store error
		// names it the same way. «Malla» here would make the sidebar contradict the
		// page it opens, so the name is kept and this entry records that decision.
		"Named product destination: the audited es copy keeps the lop Mesh feature name throughout ui.mesh",
	],
	[
		"ui.command_palette.use_palette_sources.mesh",
		"Named product destination: same lop Mesh feature name as the sidebar row, kept for consistency with the audited ui.mesh copy.",
	],
	[
		"ui.shell.rail.canvas.aria",
		// Canvas is a named product destination; the only translatable content is
		// the {chord} placeholder, so the Spanish accessible name is identical.
		"Named product destination plus a placeholder: Canvas is kept, only {chord} is appended.",
	],
	[
		"ui.command_palette.palette_search.chats",
		"Spanish loanword, not untranslated English: «chats» is the plural used by the audited es house voice.",
	],
	[
		"ui.command_palette.use_palette_sources.chat",
		"Spanish loanword, not untranslated English: «chat» is the established noun in the audited es house voice.",
	],
	[
		"ui.agents.navigation.legacy.chat",
		"Spanish loanword, not untranslated English: «chat» is the established noun in the audited es house voice.",
	],
	[
		"ui.shell.rail.console.aria",
		"French common noun: « Console » has the same spelling.",
	],
	[
		"ui.command_palette.palette_search.actions",
		"French cognate: « actions » has the same spelling.",
	],
	[
		"ui.command_palette.palette_search.agents",
		"French cognate: « agents » has the same spelling.",
	],
	[
		"ui.command_palette.use_palette_sources.session",
		"French cognate: « session » has the same spelling.",
	],
	[
		"ui.shell.sidebar_navigation.agents",
		"French cognate: « agents » has the same spelling.",
	],
	[
		"ui.chat.sidebar_view.sections",
		"French cognate: « sections » has the same spelling.",
	],
	[
		"ui.chat.sidebar_view.section.agents",
		"French cognate: « agents » has the same spelling.",
	],
	[
		"ui.chat.composer.message",
		"French cognate: « message » has the same spelling.",
	],
	// --- ui.chat.tabs. `Chat` is the audited es house voice's established noun
	// for the conversation, not a skipped string: the rest of the es catalogue
	// translates around it. Scoped to `es:` because the other six locales must
	// translate it (fr already does), and a global row would exempt all of them.
	[
		"es:ui.chat.tabs.chat",
		"Spanish loanword, not untranslated English: «chat» is the established noun in the audited es house voice.",
	],
	[
		"ui.agents.navigation.sidebar.title",
		"French cognate: « agents » has the same spelling.",
	],
	[
		"ui.agentMessages.dialog.validation_detail",
		"Placeholders and punctuation only ({field}: {rule}); no words to translate.",
	],
	[
		"ui.agents.models.reading.effort_clamped",
		"Language-neutral: placeholders and an arrow only.",
	],
	[
		"ui.agents.starters.summary.sentence",
		"Placeholder and final punctuation only ({parts}.); the sentence body is translated.",
	],
	[
		"ui.agents.starters.summary.separator",
		"Language-neutral list separator (comma and space), identical across shipped locales.",
	],
	[
		"ui.chat.canonical.supplement.withheld.reason_separator",
		"List separator (comma and space) for the withheld reasons; zh-CN and ur carry their own commas, the rest share English's.",
	],
	[
		"ui.agents.settings.chat.top_k",
		"Model sampling parameter name kept English by the fr, ru and es style guides.",
	],
	[
		"ui.agents.settings.chat.top_p",
		"Model sampling parameter name kept English by the fr, ru and es style guides.",
	],
	[
		"ui.agents.settings.general.id",
		"Standard technical abbreviation, unchanged across shipped locales.",
	],
	[
		"ui.common.account.low_credits_dialog.detail",
		"Language-neutral currency amount: placeholder plus the USD token.",
	],
	[
		"ui.mesh.mesh_approvals.approval_title",
		"Language-neutral: only {head} and a full stop.",
	],
	[
		"ui.mesh.mesh_approvals.approval_title_with_clauses",
		"Language-neutral: placeholders and punctuation only.",
	],
	[
		"ui.mesh.mesh_approvals.join_clauses",
		"Language-neutral: placeholders and punctuation only.",
	],
	[
		"ui.projects.project_model.clause",
		"Language-neutral: a parenthesised {clause} placeholder.",
	],
	[
		"ui.projects.project_model.completed_total",
		"Language-neutral counter: placeholders and a slash.",
	],
	[
		"ui.projects.project_model.count_live",
		"Language-neutral counter: placeholders and a middle dot.",
	],
	[
		"ui.projects.project_model.value_d",
		"Language-neutral unit: {value} plus the day suffix d.",
	],
	[
		"ui.projects.project_model.value_pt",
		"Language-neutral unit: {value} plus the points abbreviation pt.",
	],
	[
		"ui.projects.projects_toolbar.facet_labels_facet_first",
		"Language-neutral: placeholders and a middle dot.",
	],
	[
		"ui.projects.projects_toolbar.facet_labels_facet_first_length_1",
		"Language-neutral: placeholders and punctuation only.",
	],
	[
		"ui.providers.provider_grid.row_action",
		"Language-neutral: {action} and {brand} with a colon.",
	],
	[
		"ui.schedules.scheduled_task_dialog.value1_message",
		"Language-neutral: {value1} and {message} with a colon.",
	],
	[
		"ui.settings.updates.update_following.surface_choice",
		"Language-neutral: {surface} and {choice} with a colon.",
	],
	[
		"ui.browser.browser_new_tab.wordmark",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.installer.installer_panel.local_operator",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.common.account.low_credits_dialog.radient_pass",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.browser.browser_new_tab.address_placeholder",
		"Literal sample host (example.com); context requires it byte-identical.",
	],
	[
		"ui.projects.examples.owner",
		"Literal example owner handle (atlas), not prose to translate.",
	],
	[
		"ui.mesh.mesh_page.canvas",
		"Named product destination Canvas, kept as the feature name.",
	],
	[
		"ui.mesh.mesh_page.mesh",
		"Named product destination: the lop Mesh feature, consistent with the audited ui.mesh copy.",
	],
	[
		"ui.projects.project_model.qa",
		"Standard QA abbreviation, unchanged across shipped locales.",
	],
	[
		"ui.schedules.schedule_form_dialog.prompt",
		"Technical term kept English by the fr and es style guides; trailing space is part of the fragment.",
	],
	[
		"ui.schedules.scheduled_task_dialog.prompt",
		"Technical term kept English by the fr and es style guides; trailing space is part of the fragment.",
	],
	[
		"ui.agents.models.reading.effort_auto",
		"Wire vocabulary token (auto) deliberately printed untranslated, per the en sidecar.",
	],
	[
		"ui.code_review.lane.state.terminal",
		"Cognate: « terminal » has the same spelling in fr and es.",
	],
	[
		"ui.common.models.model_select.general",
		"Spanish cognate: «General» has the same spelling.",
	],
	[
		"ui.hub.taxonomy.category.legal",
		"Spanish cognate: «Legal» has the same spelling.",
	],
	[
		"ui.hub.taxonomy.category.software",
		"Loanword Software, settled in Spanish UI usage.",
	],
	[
		"ui.hub.taxonomy.category.marketing",
		"Loanword Marketing, settled in fr and es UI usage.",
	],
	[
		"ui.providers.provider_labels.local",
		"Cognate: « local » has the same spelling in fr and es.",
	],
	[
		"ui.settings.appearance.window_glass.material_label",
		"Spanish cognate: «Material» has the same spelling.",
	],
	[
		"ui.settings.appearance.window_glass.material_popover",
		"Apple material name (Popover), kept verbatim per the en sidecar.",
	],
	[
		"ui.settings.appearance.window_glass.material_mica",
		"Microsoft product name (Mica), kept verbatim per the en sidecar.",
	],
	[
		"ui.settings.appearance.window_glass.material_acrylic",
		"Microsoft product name (Acrylic), kept verbatim per the en sidecar.",
	],
	[
		"ui.settings.appearance.window_glass.material_tabbed",
		"Microsoft material name (Tabbed Mica), kept verbatim per the en sidecar.",
	],
	[
		"ui.settings.appearance.layers.preview.code",
		/*
		 * `pnpm test`: the appearance preview strip's code line, rendered in a
		 * monospace block beside the agent reply. It is a COMMAND, not copy - the
		 * English value carries no verb to translate, so any non-identical value
		 * would be a locale inventing one and printing a command that no longer
		 * matches what the reader would type. The English side's context note says
		 * the same, and like the sample URL above this is global: every locale shows
		 * the literal.
		 */
		"sample command: the literal must stay byte-identical in every locale",
	],
	[
		"ui.settings.navigation.settings_sidebar.general",
		"Spanish cognate: «General» has the same spelling.",
	],
	[
		"ui.settings.navigation.settings_sidebar.backend",
		"Established es loanword: the audited house voice uses «backend» throughout.",
	],
	[
		"ui.projects.project_editors.description",
		"French cognate: « description » has the same spelling.",
	],
	[
		"ui.projects.project_form_dialog.description",
		"French cognate: « description » has the same spelling.",
	],
	[
		"ui.projects.project_editors.points",
		"French cognate: « points » has the same spelling.",
	],
	[
		"ui.projects.project_filters.points",
		"French cognate: « points » has the same spelling.",
	],
	[
		"ui.projects.project_form_dialog.points",
		"French cognate: « points » has the same spelling.",
	],
	[
		"ui.projects.project_links.session",
		"French cognate: « session » has the same spelling.",
	],
	[
		"ui.projects.project_model.agent_name",
		"French cognate plus placeholder: « agent » is unchanged and {name} is preserved.",
	],
	[
		"ui.projects.project_model.session_reportedby",
		"French cognate plus placeholder: « session » is unchanged and {reportedBy} is preserved.",
	],
	[
		"ui.projects.project_model.validation",
		"French cognate: « validation » has the same spelling.",
	],
	[
		"ui.projects.project_start_session.agents",
		"French cognate: « agents » has the same spelling.",
	],
	[
		"ui.schedules.schedule_form_dialog.agent",
		"French cognate: « agent » has the same spelling; trailing space is layout.",
	],
	[
		"ui.schedules.schedule_form_dialog.minutes",
		"French cognate: « minutes » has the same spelling.",
	],
	[
		"ui.schedules.scheduled_task_dialog.conversation",
		"French cognate: « conversation » has the same spelling.",
	],
	[
		"ui.schedules.scheduled_task_dialog.minutes",
		"French cognate: « minutes » has the same spelling.",
	],
	[
		"ui.hub.links.source_public",
		"French cognate: « public » has the same spelling.",
	],
	[
		"ui.hub.links.scope_public",
		"French cognate: « public » has the same spelling.",
	],
	[
		"ui.browser.browser_hand_over_dialog.session",
		"French cognate: « session » has the same spelling.",
	],
	[
		"ui.mesh.mesh_approvals.via_transport",
		"French preposition « via » has the same spelling; {transport} is preserved.",
	],
	[
		"ui.mesh.mesh_approvals.session_suffix",
		"French cognate plus placeholder: « session » is unchanged.",
	],
	[
		"ui.mesh.mesh_card.conversations",
		"French cognate: « conversations » has the same spelling.",
	],
	[
		"ui.mesh.mesh_list.sort_conversations",
		"French cognate: « conversations » has the same spelling.",
	],
	[
		"ui.canvas.files.images",
		"French cognate: « images » has the same spelling.",
	],
	[
		"ui.canvas.files.documents",
		"French cognate: « documents » has the same spelling.",
	],
	[
		"ui.canvas.files.archives",
		"French cognate: « archives » has the same spelling.",
	],
	[
		"ui.code_review.code_review_model.code",
		"French cognate: « code » has the same spelling.",
	],
	[
		"ui.common.updates.update_notification.version",
		"French cognate: « Version » has the same spelling; trailing space is layout.",
	],
	[
		"ui.settings.appearance.window_glass.material_menu",
		"French cognate: « Menu » has the same spelling.",
	],
	[
		"ui.settings.imports.source_heading",
		"French cognate: « Sources » has the same spelling.",
	],
	[
		"ui.agents.models.reading.effort_col",
		"French cognate: « Effort » has the same spelling.",
	],
	[
		"ui.agents.settings.general.description",
		"French cognate: « Description » has the same spelling.",
	],
	[
		"ui.agents.settings.general.version",
		"French cognate: « Version » has the same spelling.",
	],
	[
		"ui.projects.examples.owner",
		"Sample owner handle in a placeholder; an example identifier, not prose.",
	],
	[
		"ui.projects.examples.team",
		"Sample team handle in a placeholder; an example identifier, not prose.",
	],
	[
		"ui.projects.project_model.clause",
		"Parentheses and a placeholder only ({clause}); no words to translate.",
	],
	[
		"ui.projects.project_model.completed_total",
		"Placeholders and a slash only ({completed}/{total}); no words to translate.",
	],
	[
		"ui.projects.project_model.count_live",
		"Placeholders and a middle dot only ({count} · {live}); no words to translate.",
	],
	[
		"ui.projects.project_model.qa",
		"Standard QA abbreviation, unchanged in Russian.",
	],
	[
		"ui.projects.projects_toolbar.facet_labels_facet_first",
		"Placeholders and a middle dot only ({FACET_LABELS_facet} · {first}); no words to translate.",
	],
	[
		"ui.projects.projects_toolbar.facet_labels_facet_first_length_1",
		"Placeholders and separators only; no words to translate.",
	],

	[
		"ui.schedules.scheduled_task_dialog.value1_message",
		"Placeholders and a colon only ({value1}: {message}); no words to translate.",
	],

	[
		"ui.browser.browser_new_tab.address_placeholder",
		"Sample domain in an address placeholder; an example, not prose.",
	],
	[
		"ui.browser.browser_new_tab.wordmark",
		"Product name, preserved verbatim by the programme glossary.",
	],

	[
		"ui.mesh.mesh_approvals.approval_title",
		"Placeholder and final punctuation only ({head}.); no words to translate.",
	],
	[
		"ui.mesh.mesh_approvals.approval_title_with_clauses",
		"Placeholders, colon and final punctuation only; no words to translate.",
	],
	[
		"ui.mesh.mesh_approvals.join_clauses",
		"Placeholders and punctuation only ({clauses}; {last}); no words to translate.",
	],

	[
		"ui.providers.provider_grid.row_action",
		"Placeholders and a colon only ({action}: {brand}); no words to translate.",
	],

	[
		"ui.common.account.low_credits_dialog.detail",
		"Currency placeholder and ISO code only (${detail} USD); no words to translate.",
	],
	[
		"ui.common.account.low_credits_dialog.radient_pass",
		"Product name, preserved verbatim by the programme glossary.",
	],

	[
		"ui.installer.installer_panel.local_operator",
		"Product name, preserved verbatim by the programme glossary.",
	],
	[
		"ui.settings.appearance.window_glass.material_acrylic",
		"System material name kept English: Acrylic is the Windows compositor material.",
	],
	[
		"ui.settings.appearance.window_glass.material_mica",
		"System material name kept English: Mica is the Windows compositor material.",
	],
	[
		"ui.settings.updates.update_following.surface_choice",
		"Placeholders and a colon only ({surface}: {choice}); no words to translate.",
	],
	["ui.canvas.files.code", "French cognate: « code » has the same spelling."],
	[
		"ui.projects.project_editors.q4_payments",
		"Sample tag identifier (q4_payments), not prose; it is rendered verbatim as an example handle.",
	],
	[
		"ui.projects.project_form_dialog.q4_payments",
		"Sample tag identifier (q4_payments), not prose; it is rendered verbatim as an example handle.",
	],
	[
		"ui.settings.appearance.window_glass.material_window",
		"System material name kept English: Window is the window-region material in the glass picker.",
	],
	[
		"ui.agents.settings.chat.temperature",
		"Model sampling parameter name kept English by the vi style guide: it names the API parameter `temperature` verbatim.",
	],
	[
		"ui.agents.settings.chat.seed",
		"Model sampling parameter name kept English by the vi style guide: it names the API parameter `seed` verbatim.",
	],
	[
		"ui.agents.settings.chat.frequency_penalty",
		"Model sampling parameter name kept English by the vi style guide: it names the API parameter `frequency_penalty` verbatim.",
	],
	[
		"ui.agents.settings.chat.presence_penalty",
		"Model sampling parameter name kept English by the vi style guide: it names the API parameter `presence_penalty` verbatim.",
	],
	[
		"ui.settings.account.radient_account_section.email",
		"Vietnamese uses the standard loanword «Email» for the address field; every diacritic alternative is unidiomatic.",
	],
	// --- ui.library category/filter nouns. The es and fr translations of the
	// file-kind labels are the same words as English because they are cognates or
	// settled loanwords, not because a translator left the source in place: the
	// surrounding ui.library prose in both locales is translated. Each entry is a
	// claim a reviewer can check against the target language, not a silencer.
	[
		"ui.library.category.code",
		"French cognate: « code » has the same spelling.",
	],
	[
		"ui.library.category.documents",
		"French cognate: « documents » has the same spelling.",
	],
	[
		"ui.library.category.images",
		"French cognate: « images » has the same spelling.",
	],
	[
		"ui.notices.chat.archive_offered_title",
		// The value is the locale's quotation marks around a user-data placeholder —
		// there is no prose to translate. hi, vi, zh-CN and es legitimately use the
		// same “ ” pair as English; fr uses « » with narrow no-break spaces and ru
		// « » closed up. An identical value here is the locale's own typography,
		// not an untranslated string.
		"quotation marks around an untranslated user-data placeholder",
	],
	[
		"ui.notices.chat.archive_offered_no_name",
		// Fallback noun used when the archived conversation has to be shown without
		// its title. French spells it the same way and it is the correct French noun,
		// so the identical value is the translation rather than an English copy.
		"French cognate: « Conversation » has the same spelling.",
	],
	[
		"ui.library.category.video",
		// es writes the unaccented « video » (Latin American usage; Spain accents
		// « vídeo »). The identical value is the es spelling, not an English copy,
		// and the accent variant is a regional preference rather than a correction.
		"es spelling of the noun (Latin American usage; Spain writes « vídeo »).",
	],
	[
		"ui.library.filter.source",
		"French cognate: « source » has the same spelling.",
	],
	[
		"ui.library.preview.description",
		"French cognate: « description » has the same spelling.",
	],
	// --- ui.teamBridge. The feature name is a product name; the placeholder and
	// the example account id carry no prose. One entry covers every locale that
	// keeps the value identical.
	[
		"ui.teamBridge.page.title",
		"Product name (Team Bridge), preserved verbatim by the programme glossary.",
	],
	[
		"ui.teamBridge.nav.label",
		"Product name (Team Bridge), preserved verbatim by the programme glossary.",
	],
	[
		"ui.teamBridge.chief.label",
		"Placeholders and brackets only ({agent} ({person})); both names are inserted verbatim. Locales with full-width brackets (zh-CN) differ, the rest are identical by design.",
	],
	[
		"ui.teamBridge.notify.title",
		"Placeholders and brackets only ({conversation} ({organization})); the notification title is assembled from already-translated parts.",
	],
	[
		"ui.teamBridge.notify.channel",
		"Opaque channel name with the conventional # marker; no prose to translate. Independently validated for all seven locales in os1298-r1 receipts.",
	],
	[
		"ui.teamBridge.notify.subtitle",
		"Language-neutral place and organization composition; both values remain verbatim and place-first order is required for disambiguation. Independently validated in os1298-r1 receipts.",
	],
	[
		"ui.teamBridge.member.agent",
		"French cognate: « agent » has the same spelling.",
	],
	[
		"ui.teamBridge.create.member_agent",
		"French cognate: « agent » has the same spelling.",
	],
	[
		"ui.teamBridge.notify.mention",
		"French cognate: « mentions » has the same spelling.",
	],
	[
		"ui.agentMessages.settings.allowlist.kind_agent",
		"French cognate: « agent » has the same spelling.",
	],
	// --- ui.shell / ui.command_palette. "Agent Hub" is the product surface's
	// established name; ur keeps the Latin proper name (the programme glossary
	// already does this for `hub.skills.public_hub`), so the value is correctly
	// identical to English rather than a stub.
	[
		"ui.command_palette.use_palette_sources.agent_hub",
		"Product name (Agent Hub), preserved verbatim by the programme glossary.",
	],
	[
		"ui.shell.sidebar_navigation.agent_hub",
		"Product name (Agent Hub), preserved verbatim by the programme glossary.",
	],
	// The browse page's own title, same product name as the sidebar entry above.
	// The ur agents-surfaces audit ruled MAJOR that it must read Latin 'Agent Hub'
	// so the page title matches the sidebar that opens it (receipt
	// i18n/receipts/74bd1d94a511.json, finding H1). Scoped to ur: only Urdu uses
	// the Latin product name here — the other six locales carry their own
	// rendering of the hub's title and must keep being checked for it.
	[
		"ur:ui.hub.pages.header.title",
		"Product name (Agent Hub); Urdu keeps the Latin name so the page title matches the sidebar that opens it.",
	],
	// --- Audit-classified identical values: canvas and surfaces batches --------
	// Seven independent auditors classified every value below as legitimately
	// identical to English at canvas head 936e3a48 / surfaces head 7a1fdf20; the
	// receipts are i18n/receipts/*-canvas*.json and *-surfaces*.json, and none of
	// these keys was classified as an untranslated stub. One entry serves every
	// locale that keeps the value byte-identical; the reason names the class that
	// makes identical the correct translation rather than a skipped string.
	[
		"ui.canvas.create_file_dialog.c_c",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.c_cpp",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.c_cs",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.configuration",
		"French cognate: « configuration » has the same spelling",
	],
	[
		"ui.canvas.create_file_dialog.css_css",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.dockerfile",
		"file-name token: the conventional file name is not translated",
	],
	[
		"ui.canvas.create_file_dialog.env",
		"file-name token: the dot-file name is not translated",
	],
	[
		"ui.canvas.create_file_dialog.general",
		"same form in Spanish: the word is spelled identically",
	],
	[
		"ui.canvas.create_file_dialog.go_go",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.html_html",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.ini_ini",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.java_java",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.javascript_js",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.json_json",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.jsx_jsx",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.kotlin_kt",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.markdown_md",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.php_php",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.python_py",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.ruby_rb",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.rust_rs",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.scala_scala",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.swift_swift",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.toml_toml",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.tsx_tsx",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.typescript_ts",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.xml_xml",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.yaml_yaml",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.create_file_dialog.yaml_yml",
		"file-type label: the technology name and its extension are not translated",
	],
	[
		"ui.canvas.file_rows.archives",
		"French cognate: « archives » has the same spelling",
	],
	[
		"ui.canvas.file_rows.code",
		"French cognate: « code » has the same spelling",
	],
	[
		"ui.canvas.file_rows.documents",
		"French cognate: « documents » has the same spelling",
	],
	[
		"ui.canvas.file_rows.images",
		"French cognate: « images » has the same spelling",
	],
	[
		"ui.canvas.file_rows.video",
		"Vietnamese loanword: « Video » is the standard media-kind label",
	],
	[
		"ui.canvas.insert_image_dialog.users_eren_documents_image_png",
		"sample path: a literal filesystem path stays byte-identical",
	],
	[
		"ui.canvas.insert_link_dialog.https_example_com",
		"sample URL: the literal example must stay byte-identical",
	],
	[
		"ui.canvas.insert_link_dialog.url",
		"technical abbreviation: URL is not translated",
	],
	[
		"ui.canvas.pdf_preview.pdf",
		"format acronym plus placeholder: PDF is not translated",
	],
	[
		"ui.canvas.shell.canvas",
		"product surface name: Canvas is preserved verbatim by the glossary",
	],
	[
		"ui.canvas.shell.documents",
		"French cognate: « documents » has the same spelling",
	],
	[
		"ui.canvas.shell.variables",
		"French and Spanish cognate: « variables » has the same spelling in both",
	],
	[
		"ui.canvas.variable_form_dialog.example_key_example_value",
		"format example: JSON syntax must stay byte-identical",
	],
	[
		"ui.canvas.variable_form_dialog.item1_item2",
		"format example: JSON array syntax must stay byte-identical",
	],
	[
		"ui.canvas.variable_form_dialog.type",
		"French cognate: « type » has the same spelling",
	],
	[
		"ui.chat.pickers.analytics_model.tokens",
		"kept-English technical term: the style guides keep « token » in English",
	],
	[
		"ui.chat.pickers.analytics_panel.session",
		"French cognate: « session » has the same spelling",
	],
	[
		"ui.chat.pickers.analytics_panel.sessionf7f199",
		"French cognate: « session » has the same spelling",
	],
	[
		"ui.chat.pickers.analytics_panel.sessions",
		"French cognate: « sessions » has the same spelling",
	],
	[
		"ui.chat.pickers.analytics_panel.tokens",
		"kept-English technical term: the style guides keep « token » in English",
	],
	[
		"ui.chat.pickers.analytics_session_state.session",
		"French cognate: « session » has the same spelling",
	],
	[
		"ui.chat.pickers.analytics_session_state.tokens",
		"kept-English technical term: the style guides keep « token » in English",
	],
	[
		"ui.chat.pickers.context_model.instructions",
		"French cognate: « instructions » has the same spelling",
	],
	[
		"ui.chat.pickers.context_model.messages",
		"French cognate: « messages » has the same spelling",
	],
	[
		"ui.chat.pickers.context_panel.tokens",
		"kept-English technical term: the style guides keep « token » in English",
	],
	[
		"ui.chat.pickers.context_panel.total",
		"French and Spanish cognate: « total » has the same spelling in both",
	],
	[
		"ui.chat.pickers.destination_pickers.code",
		"French cognate: « (code) » has the same spelling",
	],
	[
		"ui.chat.pickers.destination_pickers.completed_only",
		"language-neutral counter: only a formatted number, no words",
	],
	[
		"ui.chat.pickers.destination_pickers.desktop",
		"Vietnamese loanword: « desktop » is the established platform label",
	],
	[
		"ui.chat.pickers.destination_pickers.k",
		"unit suffix: « k » is a compact counter marker, not prose",
	],
	[
		"ui.chat.pickers.destination_pickers.message",
		"French cognate: « message » has the same spelling",
	],
	[
		"ui.chat.pickers.destination_pickers.messages",
		"French cognate: « messages » has the same spelling",
	],
	[
		"ui.chat.pickers.destination_pickers.my_api_key",
		"identifier literal: credential names stay verbatim",
	],
	[
		"ui.chat.pickers.destination_pickers.ports",
		"French cognate: « ports » has the same spelling",
	],
	[
		"ui.chat.pickers.destination_pickers.skill",
		"URI scheme token: a machine value, never translated",
	],
	[
		"ui.chat.pickers.info_model.agent",
		"kept-English term: the French glossary renders « agent » as « agent »",
	],
	[
		"ui.chat.pickers.info_model.colorterm",
		"environment-variable name: identifiers are never translated",
	],
	[
		"ui.chat.pickers.info_model.conversation",
		"French cognate: « conversation » has the same spelling",
	],
	[
		"ui.chat.pickers.info_model.count_noun",
		"language-neutral ICU skeleton: caller-supplied nouns, no prose",
	],
	[
		"ui.chat.pickers.info_model.no",
		"same form in Spanish: « no » is spelled identically",
	],
	[
		"ui.chat.pickers.info_model.pid",
		"technical identifier: « pid » is a token; only the number is formatted",
	],
	[
		"ui.chat.pickers.info_model.pid_7837d5",
		"technical identifier: « pid » is a token; only the number is formatted",
	],
	[
		"ui.chat.pickers.info_model.python",
		"product name plus placeholder: the language name is kept verbatim",
	],
	[
		"ui.chat.pickers.info_model.runtime",
		"kept-English technical term: « runtime » stays English by the style guides",
	],
	[
		"ui.chat.pickers.info_model.runtime_trajectories",
		"language-neutral composition: placeholders and a separator only",
	],
	[
		"ui.chat.pickers.info_model.runtimes",
		"kept-English technical term: « runtime » stays English by the style guides",
	],
	[
		"ui.chat.pickers.info_model.session",
		"French cognate: « session » has the same spelling",
	],
	[
		"ui.chat.pickers.info_model.sessionfcbdc4",
		"French cognate: « session » has the same spelling",
	],
	[
		"ui.chat.pickers.info_model.sessions",
		"French cognate: « sessions » has the same spelling",
	],
	[
		"ui.chat.pickers.info_model.term",
		"environment-variable name: identifiers are never translated",
	],
	[
		"ui.chat.pickers.info_panel.session",
		"French cognate: « session » has the same spelling",
	],
	[
		"ui.chat.pickers.info_panel.version",
		"French cognate: « version » has the same spelling",
	],
	[
		"ui.chat.pickers.session_panel.ok",
		"status token / interjection: « ok » is conventional in French and Vietnamese",
	],
	[
		"ui.chat.pickers.session_panel.phase",
		"French cognate: « phase » has the same spelling",
	],
	[
		"ui.chat.pickers.session_panel.session",
		"French cognate: « session » has the same spelling",
	],
	[
		"ui.chat.pickers.session_panel.tokens",
		"kept-English technical term: the style guides keep « token » in English",
	],
	[
		"ui.chat.pickers.session_report_model.conversation",
		"French cognate: « conversation » has the same spelling",
	],
	[
		"ui.chat.pickers.session_report_model.images_est",
		"French cognate: « Images » and the « est. » abbreviation are unchanged",
	],
	[
		"ui.chat.pickers.session_report_model.tokens",
		"kept-English technical term: the style guides keep « token » in English",
	],
	[
		"ui.chat.pickers.usage_view_model.note_with_period",
		"language-neutral composition: a placeholder and a full stop",
	],
	[
		"ui.chat.pickers.usage_view_model.tokens",
		"kept-English technical term: the style guides keep « token » in English",
	],
	[
		"ui.settings.shortcuts.row.canvas",
		"product surface name: Canvas is preserved verbatim by the glossary",
	],
	// --- ui.chat.directory folder labels. The working-directory menu offers
	// conventional folder names beside their own paths. Two kinds are identical
	// in EVERY locale and are named here once, globally: the bare path segments
	// (the context sidecar records them as untranslatable) and `ProgramData`,
	// whose Explorer display name is the same under every UI language. The three
	// French cognates and the Windows `Program Files` rows are scoped per locale
	// below instead: hi/zh-CN/ru/ur/vi must translate the cognates, and only a
	// locale whose Explorer shows `Program Files` in English may claim it
	// verbatim (fr shows `Programmes`; es translates it).
	[
		"ui.chat.directory.folder.etc",
		"filesystem identifier, not copy: the path segment `/etc` is identical in every locale",
	],
	[
		"ui.chat.directory.folder.media",
		"filesystem identifier, not copy: the path segment `/media` is identical in every locale",
	],
	[
		"ui.chat.directory.folder.mnt",
		"filesystem identifier, not copy: the path segment `/mnt` is identical in every locale",
	],
	[
		"ui.chat.directory.folder.opt",
		"filesystem identifier, not copy: the path segment `/opt` is identical in every locale",
	],
	[
		"ui.chat.directory.folder.srv",
		"filesystem identifier, not copy: the path segment `/srv` is identical in every locale",
	],
	[
		"ui.chat.directory.folder.usr",
		"filesystem identifier, not copy: the path segment `/usr` is identical in every locale",
	],
	[
		"ui.chat.directory.folder.var",
		"filesystem identifier, not copy: the path segment `/var` is identical in every locale",
	],
	[
		"ui.chat.directory.folder.program_data",
		"Windows system folder name Explorer shows in English under every UI language",
	],
	[
		"fr:ui.chat.directory.folder.applications",
		"French cognate: « Applications » has the same spelling; scoped to fr so the other locales still translate it",
	],
	[
		"fr:ui.chat.directory.folder.documents",
		"French cognate: « Documents » has the same spelling; scoped to fr so the other locales still translate it",
	],
	[
		"fr:ui.chat.directory.folder.volumes",
		"French cognate: « Volumes » has the same spelling; scoped to fr so the other locales still translate it",
	],
	[
		"hi:ui.chat.directory.folder.program_files",
		"Hindi Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"hi:ui.chat.directory.folder.program_files_x86",
		"Hindi Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"ru:ui.chat.directory.folder.program_files",
		"Russian Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"ru:ui.chat.directory.folder.program_files_x86",
		"Russian Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"vi:ui.chat.directory.folder.program_files",
		"Vietnamese Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"vi:ui.chat.directory.folder.program_files_x86",
		"Vietnamese Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"ur:ui.chat.directory.folder.program_files",
		"Urdu Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"ur:ui.chat.directory.folder.program_files_x86",
		"Urdu Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"zh-CN:ui.chat.directory.folder.program_files",
		"Chinese Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	[
		"zh-CN:ui.chat.directory.folder.program_files_x86",
		"Chinese Windows shows this folder name verbatim; the path beside it is never translated.",
	],
	// --- The agents/hub surfaces. Eleven French words that ARE the translation,
	// not skipped copy: each is a French common noun (or the French plural of one)
	// whose spelling coincides with the English source, so the translated value is
	// byte-identical without anything being left untranslated. Scoped to `fr` for
	// the same reason as the folder labels above: hi/zh-CN/ru/ur/vi must translate
	// these, and a global row would let an English copy pass there. The reasons
	// name the part of the string that is language-neutral and where it renders.
	[
		"fr:ui.agents.detail.origin.source",
		"French common noun « source » has the same spelling; labels the packaged-seed origin under the « Provenance » heading",
	],
	[
		"fr:ui.agents.detail.section.instructions",
		"French plural « instructions » has the same spelling; shipped fr already uses « Instructions » in ui.settings.model.system_prompt.instructions",
	],
	[
		"fr:ui.agents.pages.tab.agents",
		"French plural of « agent » is « agents »; a bare noun beside its live count",
	],
	[
		"fr:ui.agents.publication.invalid.field.description",
		"French noun « description » has the same spelling, plus the French-attached full stop; the sibling description_with_rule reads « Description : {rule}. »",
	],
	[
		"fr:ui.agents.teams.col.type",
		"French noun « type » has the same spelling; the column's values are agent vs team, so « Rôle » would misdescribe them",
	],
	[
		"fr:ui.agents.teams.kind.agent",
		"French noun « agent » has the same spelling; option and Type-column value, paired with the translated « Équipe »",
	],
	[
		"fr:ui.agents.teams.section.description",
		"French noun « description » has the same spelling; section heading",
	],
	// The Skills tab's read-only details (#1443). Each row below is scoped to ONE
	// locale and cites the shipped, audited value it matches, so none of them
	// silences a stub in another language.
	[
		"es:ui.agents.skills.source.local",
		"Spanish « Local » has the same spelling; the identical cognate is already shipped in es ui.providers.provider_labels.local (exempted above) and the audit receipts for ui.agents.skills (17d1ca9bf58a-es, aa44e837c157-es) pass it with no finding on this key",
	],
	// The Skills roster's short scope segment (#1458, i18n audit fit finding):
	// the same word as the ur source label exempted beside it, so this row
	// silences no stub in another language. es needs no row: its delta audit
	// (32ed16b45687-es) pluralised the segment to « Locales », which differs.
	[
		"ur:ui.agents.skills.scope.hub",
		"Product name (Agent Hub), kept in Latin; byte-identical to ur:ui.agents.skills.source.hub (exempted here) and ur:ui.hub.pages.header.title; the #1458 scope-key delta audit (32ed16b45687-ur) passes it clean",
	],
	[
		"ur:ui.agents.skills.source.hub",
		"Product name (Agent Hub), kept in Latin like ur:ui.hub.pages.header.title and ui.shell.sidebar_navigation.agent_hub (both exempted); the ur audit receipts (17d1ca9bf58a-ur, aa44e837c157-ur) pass it clean with no finding",
	],
	[
		"fr:ui.agents.config.kind.agent",
		"French noun « agent » has the same spelling and is the glossary term (agent -> agent); it is the bare kind word of the config composer's About line and summary suffix, and the seven-locale union audit read it in context",
	],
	[
		"fr:ui.hub.pages.search_field.description",
		"French noun « description » has the same spelling; search option paired with the translated « Nom »",
	],
	[
		"fr:ui.hub.pages.status.agents_scope",
		"Only the French plural « Agents » plus {scope} is identical; the scope phrases are translated (« dans le hub public »)",
	],
	[
		"fr:ui.hub.pages.tab.agents",
		"French plural « agents » has the same spelling; the hub tab has the same shape as the agents-page tab",
	],
	[
		"fr:ui.hub.teams.brief.trigger",
		"French noun « brief » has the same spelling; the namespace's long forms are « Brief de collaboration » / « Brief de projet » and its aria is « Voir le brief de {name} »",
	],
	[
		"fr:ui.chat.pickers.slash.phase.arguments",
		"French command-line term « Arguments » has the same spelling; it labels the slash command's argument phase",
	],
	[
		"fr:ui.common.layout.toasts.notifications",
		"French plural « Notifications » has the same spelling; the toast region's own accessible name",
	],
	[
		"ui.chat.attachments.playback_rate_option",
		// `{rate}x`: a numeral and the letter x, no words to translate. Identical in
		// every locale is the correct value; a differing one would be invented
		// punctuation or a translated multiplication sign the format does not use.
		"language-neutral format: only a {rate} placeholder and 'x', no words",
	],
	[
		"ui.chat.canonical.tool_row.bridge.summary.count",
		// `({count})`: a number in parentheses, after `Listed conversations`. No
		// words to translate - the noun lives in the verb phrase - so identical in
		// every locale is correct, the `playback_rate_option` rule.
		"language-neutral format: only a {count} placeholder and parentheses, no words",
	],
	[
		"ui.chat.canonical.tool_row.bridge.detail.headline.target",
		// `{verb} {target}`: the expansion's labelled first line (`Posted in
		// #release`). Both slots are already-translated phrases; the message
		// exists so a locale can reorder them (ur does). Verb-then-object is the
		// natural order in most shipped locales, where identical is correct.
		"format string: two placeholders and a space, no words",
	],
	[
		"ui.agents.avatar.editor.zoom_value",
		// `{value}×`: the crop editor's zoom readout (`2.5×`), a numeral and the
		// multiplication sign, no words. Identical in every locale is correct, the
		// `playback_rate_option` rule; no catalogue value changed to satisfy this.
		"language-neutral format: only a {value} placeholder and '×', no words",
	],
	[
		"es:ui.agents.avatar.editor.zoom",
		"Spanish cognate: « Zoom » is the Spanish noun for the control, same spelling, and the sibling zoom_in/zoom_out values are translated (Acercar/Alejar); scoped to es so the other locales still translate it",
	],
	[
		"fr:ui.agents.avatar.editor.zoom",
		"French cognate: « Zoom » is the French noun for the control, same spelling, and the sibling zoom_in/zoom_out values are translated; scoped to fr so the other locales still translate it",
	],
	[
		"ui.settings.personal_profile.zoom_value",
		// The human photo cropper's readout reuses the agent cropper's exact
		// `{value}×` format through the shared identity-neutral cropper; same
		// rule as `ui.agents.avatar.editor.zoom_value` above.
		"language-neutral format: only a {value} placeholder and '×', no words",
	],
	[
		"es:ui.settings.personal_profile.zoom",
		"Spanish cognate: « Zoom » is the Spanish noun for the control, same spelling, matching the audited agent cropper's es value; zoom_in/zoom_out are translated; scoped to es so the other locales still translate it",
	],
	[
		"fr:ui.settings.personal_profile.zoom",
		"French cognate: « Zoom » is the French noun for the control, same spelling, matching the audited agent cropper's fr value; zoom_in/zoom_out are translated; scoped to fr so the other locales still translate it",
	],
	[
		"fr:ui.chat.attachments.volume",
		"French cognate: the French noun for this control is « Volume », same spelling; scoped to fr so other locales still translate it",
	],
	[
		"fr:ui.chat.pickers.slash.action_kind",
		"French cognate: « Action » is the French noun, same spelling; scoped to fr so other locales still translate it",
	],
	[
		"fr:ui.chat.transcript_copy.role.assistant",
		"French cognate: the French role name is « Assistant », same spelling; scoped to fr so other locales still translate it",
	],
	[
		"fr:ui.chat.asks.scope_line",
		"The row joins two keyed phrases with a middle dot; no lexical content, so the correct value equals English. Scoped to this locale/key only.",
	],
	[
		"fr:ui.chat.canonical.fold.count.named",
		"`{count} {name}` is a number and a tool name with a space; the tool name is a machine token, so there is no wording to translate. Scoped to this locale/key only.",
	],
	[
		"fr:ui.chat.canonical.fold.unit_separator",
		"The unit separator is a spaced middle dot, punctuation only. Scoped to this locale/key only.",
	],
	[
		"fr:ui.chat.canonical.fold.sentence.join",
		"The joiner is `{first}, {second}`: an ICU skeleton with a comma, which is also the correct punctuation in this locale. Scoped to this locale/key only.",
	],
	[
		"es:ui.chat.asks.scope_line",
		"The row joins two keyed phrases with a middle dot; no lexical content, so the correct value equals English. Scoped to this locale/key only.",
	],
	[
		"es:ui.chat.canonical.fold.count.named",
		"`{count} {name}` is a number and a tool name with a space; the tool name is a machine token, so there is no wording to translate. Scoped to this locale/key only.",
	],
	[
		"es:ui.chat.canonical.fold.unit_separator",
		"The unit separator is a spaced middle dot, punctuation only. Scoped to this locale/key only.",
	],
	[
		"es:ui.chat.canonical.fold.sentence.join",
		"The joiner is `{first}, {second}`: an ICU skeleton with a comma, which is also the correct punctuation in this locale. Scoped to this locale/key only.",
	],
	[
		"zh-CN:ui.chat.asks.scope_line",
		"The row joins two keyed phrases with a middle dot; no lexical content, so the correct value equals English. Scoped to this locale/key only.",
	],
	[
		"zh-CN:ui.chat.canonical.fold.unit_separator",
		"The unit separator is a spaced middle dot, punctuation only. Scoped to this locale/key only.",
	],
	[
		"ru:ui.chat.asks.scope_line",
		"The row joins two keyed phrases with a middle dot; no lexical content, so the correct value equals English. Scoped to this locale/key only.",
	],
	[
		"ru:ui.chat.canonical.fold.count.named",
		"`{count} {name}` is a number and a tool name with a space; the tool name is a machine token, so there is no wording to translate. Scoped to this locale/key only.",
	],
	[
		"ru:ui.chat.canonical.fold.unit_separator",
		"The unit separator is a spaced middle dot, punctuation only. Scoped to this locale/key only.",
	],
	[
		"ru:ui.chat.canonical.fold.sentence.join",
		"The joiner is `{first}, {second}`: an ICU skeleton with a comma, which is also the correct punctuation in this locale. Scoped to this locale/key only.",
	],
	[
		"vi:ui.chat.asks.scope_line",
		"The row joins two keyed phrases with a middle dot; no lexical content, so the correct value equals English. Scoped to this locale/key only.",
	],
	[
		"vi:ui.chat.canonical.fold.count.named",
		"`{count} {name}` is a number and a tool name with a space; the tool name is a machine token, so there is no wording to translate. Scoped to this locale/key only.",
	],
	[
		"vi:ui.chat.canonical.fold.unit_separator",
		"The unit separator is a spaced middle dot, punctuation only. Scoped to this locale/key only.",
	],
	[
		"vi:ui.chat.canonical.fold.sentence.join",
		"The joiner is `{first}, {second}`: an ICU skeleton with a comma, which is also the correct punctuation in this locale. Scoped to this locale/key only.",
	],
	[
		"hi:ui.chat.asks.scope_line",
		"The row joins two keyed phrases with a middle dot; no lexical content, so the correct value equals English. Scoped to this locale/key only.",
	],
	[
		"hi:ui.chat.canonical.fold.count.named",
		"`{count} {name}` is a number and a tool name with a space; the tool name is a machine token, so there is no wording to translate. Scoped to this locale/key only.",
	],
	[
		"hi:ui.chat.canonical.fold.unit_separator",
		"The unit separator is a spaced middle dot, punctuation only. Scoped to this locale/key only.",
	],
	[
		"hi:ui.chat.canonical.fold.sentence.join",
		"The joiner is `{first}, {second}`: an ICU skeleton with a comma, which is also the correct punctuation in this locale. Scoped to this locale/key only.",
	],
	[
		"ur:ui.chat.asks.scope_line",
		"The row joins two keyed phrases with a middle dot; no lexical content, so the correct value equals English. Scoped to this locale/key only.",
	],
	[
		"ur:ui.chat.canonical.fold.count.named",
		"`{count} {name}` is a number and a tool name with a space; the tool name is a machine token, so there is no wording to translate. Scoped to this locale/key only.",
	],
	[
		"ur:ui.chat.canonical.fold.unit_separator",
		"The unit separator is a spaced middle dot, punctuation only. Scoped to this locale/key only.",
	],
	// Composer keying (batch A + B1). Global rows first: placeholder-only
	// skeletons with no words, like `ui.chat.attachments.file_meta`.
	[
		"ui.chat.ask_queue.deadline.with_subject",
		// `{subject} {deadline}`: two caller-supplied fragments joined by a space; the
		// words live in the keyed subject and deadline phrases, not here, so a
		// differing value would only invent punctuation per language.
		"language-neutral composition: two placeholders and a space, no words",
	],
	[
		"ui.chat.session_spend.summary.basis_amount",
		// `{label} {amount}`: a keyed basis label plus a formatted currency amount;
		// nothing in the string itself is translatable.
		"language-neutral composition: two placeholders and a space, no words",
	],
	[
		"ui.chat.ask_panel.filter.chip",
		// `{label} · {count, number}`: a keyed filter label, a middle-dot separator
		// and a locale-formatted count; same shape as `ui.chat.asks.scope_line`.
		"language-neutral composition: placeholders joined by a middle dot, no words",
	],
	[
		"ui.chat.ask_answer.unconfirmed",
		// `{lead} {reason}`: two caller-supplied, already-translated fragments joined
		// by a space; zh-CN differs only because CJK joins with no space (`{lead}{reason}`).
		"language-neutral composition: two placeholders and a space, no words",
	],
	// Locale-scoped rows: genuine words/unit symbols whose spelling coincides with
	// English in that language only; every other locale must still translate them.
	[
		"es:ui.chat.ask_queue.response.surface_terminal",
		"Spanish « terminal » (the text interface) has the same spelling as English; a common noun, not skipped copy.",
	],
	[
		"fr:ui.chat.ask_queue.response.surface_terminal",
		"French « terminal » (the text interface) has the same spelling as English; a common noun, not skipped copy.",
	],
	[
		"fr:ui.chat.ask_queue.duration.hours",
		"`{count, number}h`: « h » is the French symbol for heures, so the unit suffix is the correct French value.",
	],
	[
		"fr:ui.chat.ask_queue.duration.seconds",
		"`{count, number}s`: « s » is the French symbol for secondes, so the unit suffix is the correct French value.",
	],
	[
		"fr:ui.chat.session_readout.effort.level.auto",
		"French « Auto » is the ordinary short label for an automatic mode (cf. « auto » in French UIs); same spelling as English, not skipped copy.",
	],
	[
		"fr:ui.chat.session_readout.effort.level.max",
		"French « Max » is the standard abbreviation of « maximum » used as a level label; same spelling as English.",
	],
	[
		"fr:ui.chat.session_readout.effort.level.minimal",
		"French adjective « minimal » has the same spelling as English; used as a bare level label beside « Max ».",
	],
	[
		"fr:ui.chat.session_readout.model.router_auto",
		"French « Auto » is the ordinary short label for an automatically routed choice; same spelling as English.",
	],
	[
		"es:ui.chat.approval.mode.auto",
		"Spanish « Auto » is the ordinary short label for the automatic approval mode (beside « Preguntar »); same spelling as English, not skipped copy.",
	],
	[
		"fr:ui.chat.approval.mode.auto",
		"French « Auto » is the ordinary short label for the automatic approval mode (beside « Demander »); same spelling as English, not skipped copy.",
	],
	[
		"es:ui.chat.session_readout.effort.level.auto",
		"Spanish « Auto » is the ordinary short label for an automatic effort level (beside « Máximo », « Mínimo »); same spelling as English, not skipped copy.",
	],
	[
		"es:ui.chat.session_readout.model.router_auto",
		"Spanish « Auto » is the ordinary short label for an automatically routed model; same spelling as English, not skipped copy.",
	],
	[
		"fr:ui.chat.session_spend.summary.total",
		"`Total {total}`: « total » is the French noun/word for a sum, spelled as in English; the amount is a placeholder.",
	],
	// Library kind and tag-category labels (PR #1851): format names and cognates.
	[
		"ui.library.kind.docx",
		"File-format acronym/proper name (DOCX, HTML, Markdown, PDF, PPTX) kept Latin in every locale; the existing catalogues already render HTML/PDF/Markdown Latin; judged retained by 14 independent audits of PR #1851.",
	],
	[
		"ui.library.kind.html",
		"File-format acronym/proper name (DOCX, HTML, Markdown, PDF, PPTX) kept Latin in every locale; the existing catalogues already render HTML/PDF/Markdown Latin; judged retained by 14 independent audits of PR #1851.",
	],
	[
		"ui.library.kind.markdown",
		"File-format acronym/proper name (DOCX, HTML, Markdown, PDF, PPTX) kept Latin in every locale; the existing catalogues already render HTML/PDF/Markdown Latin; judged retained by 14 independent audits of PR #1851.",
	],
	[
		"ui.library.kind.pdf",
		"File-format acronym/proper name (DOCX, HTML, Markdown, PDF, PPTX) kept Latin in every locale; the existing catalogues already render HTML/PDF/Markdown Latin; judged retained by 14 independent audits of PR #1851.",
	],
	[
		"ui.library.kind.pptx",
		"File-format acronym/proper name (DOCX, HTML, Markdown, PDF, PPTX) kept Latin in every locale; the existing catalogues already render HTML/PDF/Markdown Latin; judged retained by 14 independent audits of PR #1851.",
	],
	[
		"es:ui.library.kind.audio",
		"Spanish: Audio is the ordinary Spanish noun, spelled as in English; judged retained by the independent audits of PR #1851. Scoped to Spanish only.",
	],
	[
		"es:ui.library.kind.video",
		"Spanish: Video is the ordinary Spanish noun, spelled as in English; judged retained by the independent audits of PR #1851. Scoped to Spanish only.",
	],
	[
		"vi:ui.library.kind.video",
		"Vietnamese loanword « Video » matches the existing ui.library.category.video; judged retained by the independent audits of PR #1851. Scoped to Vietnamese only.",
	],
	[
		"fr:ui.library.kind.audio",
		"French: same spelling as English, ordinary French noun; matches the existing category/filter vocabulary; judged retained by the independent audits of PR #1851. Scoped to French only.",
	],
	[
		"fr:ui.library.kind.code",
		"French: same spelling as English, ordinary French noun; matches the existing category/filter vocabulary; judged retained by the independent audits of PR #1851. Scoped to French only.",
	],
	[
		"fr:ui.library.kind.image",
		"French: same spelling as English, ordinary French noun; matches the existing category/filter vocabulary; judged retained by the independent audits of PR #1851. Scoped to French only.",
	],
	[
		"fr:ui.library.tag_category.format",
		"French: same spelling as English, ordinary French noun; matches the existing category/filter vocabulary; judged retained by the independent audits of PR #1851. Scoped to French only.",
	],
	[
		"fr:ui.library.tag_category.source",
		"French: same spelling as English, ordinary French noun; matches the existing category/filter vocabulary; judged retained by the independent audits of PR #1851. Scoped to French only.",
	],
	[
		"fr:ui.library.tag_category.type",
		"French: same spelling as English, ordinary French noun; matches the existing category/filter vocabulary; judged retained by the independent audits of PR #1851. Scoped to French only.",
	],
	[
		"es:ui.common.time.date_at",
		"Spanish long date + clock joined by the same comma as English; pure placeholder pattern, no words",
	],
	[
		"ur:ui.common.time.weekday_at",
		"pure placeholder join of weekday and clock, same order as English; ICU supplies the Urdu weekday and Latin clock",
	],
]);

/*
 * An exemption is GLOBAL by default — a value no locale may translate, such as a
 * filesystem identifier — and may be scoped to one locale with a `<locale>:<key>`
 * row, for a word that is legitimately identical in that language only. The
 * scoped form exists because a global row for, say, a French cognate also
 * exempts hi/zh-CN/ru/ur/vi, where that word must differ: the guard would then
 * pass on a value nobody translated, which is the failure it is meant to catch.
 */
function allowsIdenticalValue(locale, key, table = IDENTICAL_OK) {
	return table.has(key) || table.has(`${locale}:${key}`);
}

function localeDirs() {
	return readdirSync(CATALOGUES, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name)
		.sort();
}

function messageFiles(locale) {
	const dir = join(CATALOGUES, locale);
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".context.json"))
		.sort();
}

function readCatalogue(locale, file) {
	return JSON.parse(readFileSync(join(CATALOGUES, locale, file), "utf8"));
}

/** Every ICU argument name in a message, plural/select options walked. */
function argumentNames(message) {
	const names = new Set();
	/*
	 * Only ARGUMENT-BEARING node types count, and they are NUMERIC constants
	 * (`TYPE.argument === 1`), not the strings the type names suggest — the first
	 * version compared `node.type` against "argument" and therefore matched
	 * nothing, so a placeholder check passed a fixture missing a real argument.
	 * A `literal` node (TYPE.literal) also carries a `.value` (its text), which is
	 * the other half of why value-presence alone is the wrong test.
	 */
	const ARGUMENT_TYPES = new Set([
		TYPE.argument,
		TYPE.number,
		TYPE.plural,
		TYPE.select,
		TYPE.date,
		TYPE.time,
	]);
	const walk = (nodes) => {
		for (const node of nodes) {
			if (ARGUMENT_TYPES.has(node.type) && typeof node.value === "string") {
				names.add(node.value);
			}
			if (node.options) {
				for (const option of Object.values(node.options)) {
					if (Array.isArray(option?.value)) walk(option.value);
				}
			}
		}
	};
	walk(parse(message));
	return names;
}

const english = new Map();
const englishNamespaces = new Set();
for (const file of messageFiles(SOURCE_LOCALE)) {
	englishNamespaces.add(file);
	for (const [key, message] of Object.entries(
		readCatalogue(SOURCE_LOCALE, file),
	)) {
		english.set(key, message);
	}
}

test("the English source is non-empty (the guard would pass vacuously otherwise)", () => {
	assert.ok(english.size > 0, "no English messages found to compare against");
});

for (const locale of localeDirs().filter((name) => name !== SOURCE_LOCALE)) {
	/*
	 * NON-EMPTY FIRST (review round 1, R3). The three checks below are per-key and
	 * per-value, so an EMPTY locale file — or an empty locale directory — violates
	 * none of them and passed all four tests vacuously. A shipped locale is a claim
	 * that there are messages behind it; this is the assertion that makes the rest
	 * non-vacuous.
	 */
	test(`[${locale}] ships at least one message (not an empty claim)`, () => {
		let messages = 0;
		for (const file of messageFiles(locale)) {
			messages += Object.keys(readCatalogue(locale, file)).length;
		}
		assert.ok(
			messages > 0,
			`${locale} has no messages at all — an empty locale directory is not a shipped translation`,
		);
	});

	/*
	 * ONE KEY, ONE FILE (review round 1, R4). Two namespace files in the same
	 * locale defining the same key silently shadow in the generated spread (the
	 * later file wins), and the per-key checks above see only well-formed values.
	 * The generator rejects this too; the guard states it independently so a
	 * hand-added second file cannot slip through the runtime.
	 */
	test(`[${locale}] defines each key in at most one namespace file`, () => {
		const owner = new Map();
		const duplicates = [];
		for (const file of messageFiles(locale)) {
			for (const key of Object.keys(readCatalogue(locale, file))) {
				const previous = owner.get(key);
				if (previous) duplicates.push(`${key}: ${previous} and ${file}`);
				else owner.set(key, file);
			}
		}
		assert.deepEqual(
			duplicates,
			[],
			`keys defined in more than one file in ${locale}`,
		);
	});

	test(`[${locale}] carries EVERY key of each namespace file it ships`, () => {
		/*
		 * COMPLETE, NOT A SUBSET (root acceptance, all-locale rollout). A locale file
		 * present in the tree IS a claim that this locale supports that namespace, and
		 * the runtime would silently fall back to English for any key it omits — a
		 * gap that reads as "translated" on screen. So a shipped locale file must
		 * carry the SAME key set as its English source: no missing key, no extra one.
		 *
		 * This is the check the earlier shape lacked: the per-key checks below can all
		 * pass while a locale drops ten keys, because each surviving value is fine on
		 * its own.
		 */
		const gaps = [];
		for (const file of messageFiles(locale)) {
			if (!englishNamespaces.has(file)) continue; // no English source: the keys test reports it
			const enKeys = Object.keys(readCatalogue(SOURCE_LOCALE, file)).sort();
			const localeKeys = Object.keys(readCatalogue(locale, file)).sort();
			const missing = enKeys.filter((key) => !localeKeys.includes(key));
			const extra = localeKeys.filter((key) => !enKeys.includes(key));
			if (missing.length) {
				gaps.push(
					`${file}: missing ${missing.length} (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""})`,
				);
			}
			if (extra.length) {
				gaps.push(
					`${file}: extra ${extra.length} (${extra.slice(0, 3).join(", ")}…)`,
				);
			}
		}
		assert.deepEqual(
			gaps,
			[],
			`${locale} must carry a complete key set for every namespace file it ships`,
		);
	});

	test(`[${locale}] names only keys the English source defines`, () => {
		const unknown = [];
		for (const file of messageFiles(locale)) {
			for (const key of Object.keys(readCatalogue(locale, file))) {
				if (!english.has(key)) unknown.push(`${file}: ${key}`);
			}
		}
		assert.deepEqual(unknown, [], `unknown keys in ${locale}`);
	});

	test(`[${locale}] preserves every ICU placeholder from the English source`, () => {
		const problems = [];
		for (const file of messageFiles(locale)) {
			const data = readCatalogue(locale, file);
			for (const [key, message] of Object.entries(data)) {
				const source = english.get(key);
				if (source === undefined) continue; // reported by the keys test
				if (typeof message !== "string") {
					problems.push(`${file}: ${key} is not a string`);
					continue;
				}
				let translatedArgs;
				let sourceArgs;
				try {
					translatedArgs = argumentNames(message);
					sourceArgs = argumentNames(source);
				} catch (error) {
					problems.push(`${file}: ${key} is not valid ICU (${error.message})`);
					continue;
				}
				const missing = [...sourceArgs].filter((n) => !translatedArgs.has(n));
				const extra = [...translatedArgs].filter((n) => !sourceArgs.has(n));
				if (missing.length)
					problems.push(
						`${file}: ${key} missing placeholder(s) ${missing.join(", ")}`,
					);
				if (extra.length)
					problems.push(
						`${file}: ${key} has unknown placeholder(s) ${extra.join(", ")}`,
					);
			}
		}
		assert.deepEqual(problems, [], `placeholder problems in ${locale}`);
	});

	test(`[${locale}] is not an English stub (no value identical to the source)`, () => {
		const stubs = [];
		for (const file of messageFiles(locale)) {
			const data = readCatalogue(locale, file);
			for (const [key, message] of Object.entries(data)) {
				const source = english.get(key);
				if (source === undefined || typeof message !== "string") continue;
				if (message === source && !allowsIdenticalValue(locale, key)) {
					stubs.push(`${file}: ${key}`);
				}
			}
		}
		assert.deepEqual(stubs, [], `values identical to English in ${locale}`);
	});
}

/*
 * The scoped-entry guard, proved on its own table: a `<locale>:<key>` row must
 * exempt exactly one language. If it exempted every locale, a translator could
 * silence a real stub in six locales by writing one French cognate — the exact
 * hole this form was added to close — so the property is asserted rather than
 * assumed from the production table.
 */
test("a locale-scoped identical-value exemption does not exempt another locale", () => {
	const table = new Map([
		["fr:ui.example.cognate", "French cognate: same spelling"],
	]);
	assert.equal(allowsIdenticalValue("fr", "ui.example.cognate", table), true);
	assert.equal(allowsIdenticalValue("es", "ui.example.cognate", table), false);
	assert.equal(
		allowsIdenticalValue("zh-CN", "ui.example.cognate", table),
		false,
	);
	assert.equal(allowsIdenticalValue("fr", "ui.example.other", table), false);
});
