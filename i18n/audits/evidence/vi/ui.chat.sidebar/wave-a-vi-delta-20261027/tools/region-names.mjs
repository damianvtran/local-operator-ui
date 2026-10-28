#!/usr/bin/env node
/**
 * Region-name distinctness probe — wave A / vi delta, head 80ee119bbd.
 *
 * WHAT IT PROVES, and what it does not. `chat-regions.ts` (lines 80-90 at this
 * head) maps the F6 walk's four regions onto exactly three catalogue keys:
 *   sidebar    -> ui.chat.sidebar.nav.chats
 *   composer   -> ui.chat.region.composer
 *   header     -> ui.chat.region.conversation
 *   transcript -> ui.chat.region.conversation
 * This script reads those three keys for `en` and each requested locale and
 * prints the four announced names in the walk's order, so a reader can see
 * whether the walk announces DISTINCT names for the nav and the transcript.
 * It is a catalogue read, not a render: the mapping is asserted against the
 * source file's switch statement by eye in the audit, never by this script.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2];
const LOCALES = process.argv.slice(3);
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const KEYMAP = {
	sidebar: ["ui.chat.sidebar", "ui.chat.sidebar.nav.chats"],
	header: ["ui.chat", "ui.chat.region.conversation"],
	transcript: ["ui.chat", "ui.chat.region.conversation"],
	composer: ["ui.chat", "ui.chat.region.composer"],
};

for (const locale of LOCALES) {
	const files = new Map();
	const get = (ns, key) => {
		if (!files.has(ns)) {
			files.set(ns, read(`src/i18n/catalogues/${locale}/${ns}.json`));
		}
		return files.get(ns)[key];
	};
	const names = Object.fromEntries(
		Object.entries(KEYMAP).map(([region, [ns, key]]) => [region, get(ns, key)]),
	);
	const announced = [names.sidebar, names.header, names.transcript, names.composer];
	const distinct = new Set(announced).size;
	console.log(
		`${locale}: sidebar=${JSON.stringify(names.sidebar)} header=${JSON.stringify(names.header)} transcript=${JSON.stringify(names.transcript)} composer=${JSON.stringify(names.composer)}`,
	);
	console.log(
		`${locale}: nav-vs-transcript distinct=${names.sidebar !== names.transcript}; distinct names in the walk=${distinct}/4`,
	);
}
