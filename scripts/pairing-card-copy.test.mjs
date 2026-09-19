import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Q-6 / UX U2, PINNED AT THE AUTHORITY. A card that reports a failed read may say the
 * cause main published and may offer a control only where an act exists. Measured
 * before this: the Settings page printed "Your settings could not be loaded. The Local
 * Operator server is not answering." WITH a Retry, over a daemon that was answering,
 * while two bands on the same screen named who held its plane.
 *
 * The bundle is built the way the other renderer-copy tests build one, because these
 * are the shipped modules (`backend-error.ts` and the shared state vocabulary) rather
 * than a copy of their strings.
 */
const bundle = await (async () => {
	const { build } = await import("esbuild");
	return await build({
		stdin: {
			contents: `
				export { pairingCardCopy, BACKEND_PAIRING_CARD_SENTENCE, BACKEND_PAIRING_SENTENCE, backendLoadErrorMessage } from "./src/renderer/src/shared/api/local-operator/backend-error";
				export { pairingHasRemedy } from "./src/shared/backend-status";
			`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		// esbuild takes only an entity name or a JS literal here, and these modules
		// are bundled for node: `import.meta.env` is Vite's, so it is stubbed as an
		// inspector rather than defined as an expression.
		banner: { js: "globalThis.__vite_env = {};" },
	});
})();
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const CAUSES = [
	"successor",
	"governed-elsewhere",
	"pre-handshake",
	"credential-refused",
	"unpaired",
];

test("no-remedy causes state their cause and offer no control", () => {
	for (const cause of CAUSES.filter((c) => !mod.pairingHasRemedy(c))) {
		const { sentence, remedy } = mod.pairingCardCopy(
			cause,
			"Your settings could not be loaded.",
			new Error("Get config request failed: 503"),
		);
		assert.equal(remedy, false, `${cause}: no act exists, so no control`);
		assert.doesNotMatch(
			sentence,
			/not answering|503|may not be running/i,
			`${cause}: names its own cause, never the sentence for a server that is not answering`,
		);
		/*
		 * THE CARD'S OWN LINE, NOT THE BAND'S (design review round 5, D37, and UX round
		 * 5's U13): the card rendered the band's 169-character sentence verbatim - the
		 * same string 380 px below itself - and lost its own lead doing it. So the card
		 * carries a lead of its own and does NOT equal what the band says for the same
		 * cause.
		 */
		assert.match(
			sentence,
			/^Your settings could not be loaded:/,
			`${cause}: the card keeps its own lead`,
		);
		assert.notEqual(
			sentence,
			mod.BACKEND_PAIRING_SENTENCE[cause],
			`${cause}: the card must not render the band's sentence again`,
		);
	}
});

test("a remediable cause keeps its control", () => {
	const remediable = CAUSES.filter((c) => mod.pairingHasRemedy(c));
	assert.ok(remediable.length > 0, "at least one cause has a remedy");
	for (const cause of remediable) {
		const { sentence, remedy } = mod.pairingCardCopy(
			cause,
			"Your settings could not be loaded.",
			new Error("x"),
		);
		assert.equal(remedy, true, `${cause}: an act exists, so the control stays`);
		assert.notEqual(sentence, mod.BACKEND_PAIRING_SENTENCE[cause]);
	}
});

test("no pairing cause at all keeps the transport sentence and its Retry", () => {
	const { sentence, remedy } = mod.pairingCardCopy(
		null,
		"Your settings could not be loaded.",
		new Error("Get config request failed: 503"),
	);
	assert.equal(
		remedy,
		true,
		"a transport failure is something a retry can change",
	);
	assert.match(sentence, /could not be loaded/i);
	assert.doesNotMatch(sentence, /503/, "the integer stays out of the sentence");
});

test("both cards render through the one authority, and the page gates its Retry", () => {
	const page = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	const section = readFileSync(
		"src/renderer/src/features/settings/components/backend-settings-section.tsx",
		"utf8",
	);
	for (const [name, source] of [
		["page", page],
		["section", section],
	]) {
		assert.match(
			source,
			/pairingCardCopy\(/,
			`${name}: the card must take its sentence and its remedy from the shared authority`,
		);
		assert.doesNotMatch(
			source,
			/backendLoadErrorMessage\(/,
			`${name}: and must not compose its own sentence beside that authority`,
		);
	}
	assert.match(
		page,
		/\{loadErrorRemedy && \(/,
		"the page's Retry is gated on a remedy existing",
	);
});

/*
 * EVERY CAUSE, BOTH TABLES, ONE CHECK (D37 residual): the two tables exist precisely
 * because one string cannot serve a band that lists what the APP loses and a card that
 * says what THIS PAGE cannot read. If a future edit points the card back at the band's
 * table, this fails for every cause at once rather than for whichever one a frame
 * happened to show.
 */
test("no card sentence is the band's sentence for any cause", () => {
	for (const cause of CAUSES) {
		assert.notEqual(
			mod.BACKEND_PAIRING_CARD_SENTENCE[cause],
			mod.BACKEND_PAIRING_SENTENCE[cause],
			`${cause}: one condition, two surfaces, two registers - not one string twice`,
		);
		assert.match(
			mod.BACKEND_PAIRING_CARD_SENTENCE[cause],
			/^Your settings could not be loaded:/,
			`${cause}: and the card's line says what the page cannot do`,
		);
	}
});

/*
 * R5-1: the section card's remedy gate was unpinned - reverting it to always render
 * left every test green, including the ones that assert no control appears, because
 * those mount the card in states where no cause exists at all. A source guard is the
 * shape this repository already uses for exactly this (`backend-error-surfaces`), and
 * it fails the moment the gate goes.
 */
test("the section card gates its Retry on a remedy existing", () => {
	const section = readFileSync(
		"src/renderer/src/features/settings/components/backend-settings-section.tsx",
		"utf8",
	);
	assert.match(
		section,
		/\{remedy && \(/,
		"the section's Retry must be gated on the remedy the authority returned",
	);
	assert.match(
		section,
		/const \{ sentence: pairingSentence, remedy \} = pairingCardCopy\(/,
		"and it must take both from the one authority",
	);
});
