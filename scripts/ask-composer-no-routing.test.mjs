import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE MAIN COMPOSER NEVER ANSWERS AN ASK (the reversal of design §5.0, the
 * operator's R7 amendment; operator ask, 2026-10-07).
 *
 * WHAT THIS FILE PINS, AND WHY IT IS WRITTEN AS "THE OLD PATH IS GONE".
 *
 * Until this change, while the asks drawer was open the page's one composer was
 * the ANSWER box: `send` branched into `sendToAsk` before any other door, the
 * placeholder read `Answering the agent's question - Esc to collapse`, and the
 * text the user typed was written into the first unanswered question's draft
 * instead of reaching the conversation. The operator's report was that nobody could
 * tell this was how an "other" answer was given, and asked for the opposite: a
 * send from the composer is an ordinary chat message, always, and an explicit
 * `Other` answer lives inside the card.
 *
 * WHY MOST OF THIS IS SOURCE-LEVEL. `chat-page.tsx` cannot be rendered in isolation
 * (it needs the router, the query client, the canonical store and a live stream), so
 * the repo's own pattern for a rule that lives there is a comment-stripped read of
 * the shipped source - `ask-options.test.mjs` does the same for the secret refusal
 * and the approval throw. The pins below therefore assert the ABSENCE of each piece
 * of the routing and the SHAPE of the page's send door; the live half (a real send
 * reaching a real daemon while an ask stays open) is the evidence rig's, under
 * `docs/evidence/ask-other/`. The two functions that CAN be read by value - the
 * placeholder ladder and the queue module's exports - are asserted by value.
 *
 * WHAT STAYS, and is asserted so a future edit cannot remove it by accident:
 * `askComposerHoldsSecret` (a credential-safety rule for the MAIN box when the only
 * open question is secret - it is not routing), the drawer's Escape claim, and the
 * page's draft state (the panel's own controls write it).
 */

const read = (path) => readFileSync(path, "utf8");

/*
 * The assertions' own regex literals, HOISTED to the top level: this tree's
 * `useTopLevelRegex` rule charges a literal built inside a function, and `scripts/`
 * sits outside `pnpm lint`'s path list, so `pnpm lint:scripts` is the only gate that
 * would say so (the same note `btw-aside.test.mjs` carries).
 */
const RE_ASK_DRAFTS_STATE =
	/const \[askDrafts, setAskDrafts\] = useState<Record<string, AskDraft>>\(/;
const RE_DRAFT_CHANGE_PROP =
	/onAskDraftChange: \(askId: string, next: AskDraft\) =>/;
const RE_TOGGLE_PROP = /onAskToggle: toggleAskExpanded/;
const RE_ESCAPE_CLAIM =
	/useEffect\(\(\) => \{\s*if \(!askExpanded\) return;[\s\S]{0,600}askClaimsEscape\(event\)[\s\S]{0,200}toggleAskExpanded\(false\)/;
const RE_ASK_MODE_ATTR = /askMode\s*=/;
const RE_PLACEHOLDER_FROM_CANONICAL = /placeholderOverride=\{canonical/;
const RE_EXPANDED_FORWARD = /askExpanded=\{canonical\?\.askExpanded\}/;
const RE_TOGGLE_FORWARD = /onAskToggle=\{canonical\?\.onAskToggle\}/;
const RE_ASK_MODE_WORD = /\baskMode\b/;
const RE_PLACEHOLDER_OVERRIDE_PROP = /placeholderOverride\?: string;/;
const RE_SOURCE_FILE = /\.(tsx?|mdx)$/;
const RE_ASK_MODE_PROP = /askMode=/;

/** Comments removed, so a sentence that NAMES a retired symbol is not a use of it. */
const code = (path) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PAGE = "src/renderer/src/features/chat/components/chat-page.tsx";
const CONTENT = "src/renderer/src/features/chat/components/chat-content.tsx";
const INPUT = "src/renderer/src/shared/components/composer/message-input.tsx";
const HOOK = "src/renderer/src/shared/hooks/use-message-input.ts";

const queueBundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/chat/ask-queue";`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
	logLevel: "silent",
});
const queuePath = new URL(
	`./_ask-no-routing-queue-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(queuePath, queueBundle.outputFiles[0].text);
let queue;
try {
	queue = await import(queuePath.href);
} finally {
	await unlink(queuePath).catch(() => {});
}

/*
 * The placeholder ladder, built the way `btw-aside.test.mjs` builds it: the hook
 * module reaches the canonical-session hook, so it needs `import.meta.env` defined
 * and the renderer's two aliases. Nothing in it is CALLED, so the transport is never
 * reached.
 */
const hookBundle = await build({
	stdin: {
		contents: `export { composerPlaceholder, COMPOSER_PLACEHOLDER } from "./src/renderer/src/shared/hooks/use-message-input";`,
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
	logLevel: "silent",
});
const { composerPlaceholder, COMPOSER_PLACEHOLDER } = await import(
	`data:text/javascript;base64,${Buffer.from(hookBundle.outputFiles[0].text).toString("base64")}`
);

const TS = 1_760_000_000_000;
const openAsk = (questions) => ({
	ask_id: "a-1",
	created_at: TS,
	expires_at: TS + 3_600_000,
	timeout_s: 3600,
	urgent: false,
	status: "open",
	delivered: false,
	questions,
});

/* ------------------------------------------------------ the placeholder ---- */

test("the main composer has no ask-mode placeholder: an open ask changes nothing it says", () => {
	const idle = {
		unavailable: false,
		inputDisabled: false,
		awaitingAnswer: false,
		asideAttached: false,
		sendingUnsettled: false,
		awaitingReply: false,
	};
	const retired = "Answering the agent's question — Esc to collapse";
	// The shape the page USED to pass while the drawer was open. A ladder with no
	// such rung ignores the key, so the box keeps its own sentence in every state it
	// had before - including the live-turn one that the old rung used to outrank.
	assert.equal(
		composerPlaceholder({ ...idle, askMode: retired }),
		COMPOSER_PLACEHOLDER.idle,
		"an idle box keeps the app's own invitation",
	);
	assert.equal(
		composerPlaceholder({ ...idle, awaitingReply: true, askMode: retired }),
		COMPOSER_PLACEHOLDER.waiting,
		"a box over a running turn still names what Enter does to that turn",
	);
	assert.notEqual(COMPOSER_PLACEHOLDER.idle, retired);
});

test("the queue module no longer offers the answer-mode sentence or the predicate behind it", () => {
	assert.equal(
		"ASK_COMPOSER_PLACEHOLDER" in queue,
		false,
		"the sentence is gone - a host that wants the old promise has nothing to import",
	);
	assert.equal(
		"askComposerAnswers" in queue,
		false,
		"nothing decides that the box answers: it never does",
	);
});

test("a secret-ONLY ask still refuses the MAIN box (a credential-safety rule, not routing)", () => {
	// The refusal exists so a credential is not typed into an ordinary chat message.
	// Removing the routing does not remove that hazard - the box is now ordinary in
	// EVERY state - so the rule stays, and it is stated here so deleting it is a
	// decision rather than collateral.
	const secretOnly = queue.askQueueView({
		asks: [openAsk([{ id: "k", question: "Paste the key", secret: true }])],
	});
	assert.equal(queue.askComposerHoldsSecret(secretOnly), true);

	const fillable = queue.askQueueView({
		asks: [
			openAsk([{ id: "t", question: "Which?", options: [{ label: "a" }] }]),
		],
	});
	assert.equal(
		queue.askComposerHoldsSecret(fillable),
		false,
		"an ordinary question leaves the box ordinary",
	);

	const mixed = queue.askQueueView({
		asks: [
			openAsk([
				{ id: "t", question: "Which?", options: [{ label: "a" }] },
				{ id: "k", question: "Paste the key", secret: true },
			]),
		],
	});
	assert.equal(
		queue.askComposerHoldsSecret(mixed),
		false,
		"a mixed ask leaves the box ordinary: the secret question has its own masked field",
	);
});

/* ---------------------------------------------------------- the send door ---- */

test("the page's send door has no ask branch: a send is an ordinary chat message", () => {
	const page = code(PAGE);
	const signature = page.indexOf("const send = async (");
	assert.ok(signature > -1, "the page's send door is still one function");
	const bodyStart = page.indexOf("): Promise<SendOutcome> => {", signature);
	const firstDoor = page.indexOf(
		"const store = useCanonicalSessionsStore.getState();",
		signature,
	);
	assert.ok(bodyStart > -1 && firstDoor > bodyStart, "the door's shape moved");
	assert.equal(
		page
			.slice(bodyStart + "): Promise<SendOutcome> => {".length, firstDoor)
			.trim(),
		"",
		"nothing runs before the ordinary admission path reads its store - the first statement used to be `if (askAnswering) return await sendToAsk(content)`",
	);
});

test("the page keeps no answer-mode state: no ask buffer, no swap, no router", () => {
	const page = code(PAGE);
	for (const retired of [
		"sendToAsk",
		"askAnswering",
		"askBuffer",
		"chatBuffer",
		"answeringRef",
		"askComposerPlaceholder",
		"ASK_COMPOSER_PLACEHOLDER",
		"askComposerAnswers",
	]) {
		assert.ok(
			!page.includes(retired),
			`chat-page.tsx still names \`${retired}\` outside a comment`,
		);
	}
	// The page never writes the composer's box on an ask's behalf any more: that
	// writer (`setComposerText`) existed for the draft swap and for nothing else on
	// this page.
	assert.ok(
		!page.includes("setComposerText"),
		"the draft swap's writer is gone with the swap",
	);
});

test("what stays on the page is the panel's: drafts, the toggle and the drawer's Escape claim", () => {
	const page = code(PAGE);
	assert.match(
		page,
		RE_ASK_DRAFTS_STATE,
		"the panel's own controls still write one draft per ask, kept on the page so a collapse does not lose it",
	);
	assert.match(page, RE_DRAFT_CHANGE_PROP);
	assert.match(page, RE_TOGGLE_PROP);
	/*
	 * THE ESCAPE CLAIM IS KEYED ON THE DRAWER BEING OPEN, NOT ON ANY ANSWER MODE.
	 * That is the proof it was never coupled to the routing: with the routing gone
	 * the claim is the same five lines, and Esc still collapses the drawer
	 * (`askClaimsEscape` is pinned in `ask-queue.test.mjs`).
	 */
	assert.match(page, RE_ESCAPE_CLAIM);
});

/* ------------------------------------------------------ what it threads ---- */

test("nothing threads an answer-mode sentence or flag down to the composer", () => {
	const content = code(CONTENT);
	assert.ok(
		!content.includes("askComposerPlaceholder"),
		"the content pane's `canonical` bundle no longer carries the sentence",
	);
	assert.ok(
		!RE_ASK_MODE_ATTR.test(content),
		"and passes no `askMode` to the composer",
	);
	assert.ok(
		!RE_PLACEHOLDER_FROM_CANONICAL.test(content),
		"the main composer's invitation is the app's own, whatever the drawer is doing",
	);
	// The chip and the drawer's door are the status row's, and stay.
	assert.match(content, RE_EXPANDED_FORWARD);
	assert.match(content, RE_TOGGLE_FORWARD);

	assert.ok(
		!RE_ASK_MODE_WORD.test(code(INPUT)),
		"the composer has no ask-mode prop to receive",
	);
	assert.ok(
		!RE_ASK_MODE_WORD.test(code(HOOK)),
		"and the placeholder ladder has no rung for one",
	);
	// `placeholderOverride` itself stays: the mini view and the project strip use it.
	assert.match(code(INPUT), RE_PLACEHOLDER_OVERRIDE_PROP);
});

test("no story or helper still renders the retired answer mode", () => {
	const dir = "src/renderer/src/features/chat/components";
	const files = [];
	const walk = (path) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const full = join(path, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (RE_SOURCE_FILE.test(entry.name)) files.push(full);
		}
	};
	walk(dir);
	for (const file of files) {
		const text = code(file);
		assert.ok(
			!text.includes("ASK_COMPOSER_PLACEHOLDER"),
			`${file} imports the retired sentence`,
		);
		assert.ok(
			!RE_ASK_MODE_PROP.test(text),
			`${file} passes the retired \`askMode\` prop`,
		);
	}
});
