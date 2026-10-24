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
		"ui.common.layout.chat_layout.mac",
		"platform-detection token: the value is compared against navigator.platform",
	],
	[
		"ui.settings.shortcuts.row.canvas",
		"product surface name: Canvas is preserved verbatim by the glossary",
	],
]);

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
				if (message === source && !IDENTICAL_OK.has(key)) {
					stubs.push(`${file}: ${key}`);
				}
			}
		}
		assert.deepEqual(stubs, [], `values identical to English in ${locale}`);
	});
}
