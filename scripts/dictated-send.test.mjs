import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * A DICTATED SEND THAT OUTLIVES THE COMPOSER - the record, on its own (bug 2).
 *
 * The behaviour this file pins is the operator's report: "when it's transcribing
 * after you hit the immediate send and switch to another session it actually
 * doesn't send it and stores it in the input box". `dictated-send.ts` is the
 * answer - one live intent per conversation, one deliverer per conversation, and
 * every refusal named - and this suite drives its transitions directly, without a
 * React tree, so a defect in the record cannot hide behind a rig.
 *
 * THE COMPOSER'S HALF IS `shared-composer.test.mjs` (cases 1-13): a press there
 * arms an intent and the transcript lands through real state changes. This file is
 * the store's own contract: who may begin, what happens on each refusal class, and
 * the one check that decides whether the words are safe to send at all - "is the
 * origin's draft still exactly what the press captured?".
 *
 * WHAT IT IS NOT: a claim that any surface renders any of this. The sentence the
 * page states is `dictatedRefusalSentence`, and that function is pure, which is
 * why the copy is checked here too - including the arms that must NOT tell the
 * reader their text is waiting in a draft, because in them it is gone.
 *
 * A jsdom bootstrap rather than a bare node process: the stores are zustand
 * instances the app creates in a renderer, and `conversation-input-store` persists
 * through `localStorage`. Nothing here mounts React.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bundle = await build({
	stdin: {
		contents: `
			export {
				dictatedSends,
				useDictatedSendStore,
				dictatedRefusalSentence,
				dictatedToastId,
				resetDictatedSendsForTests,
			} from "./src/renderer/src/features/chat/dictated-send";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"react/jsx-dev-runtime",
	],
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
	},
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
	logLevel: "silent",
});
const bundlePath = new URL(
	`./_dictated-send-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	dictatedSends,
	useDictatedSendStore,
	dictatedRefusalSentence,
	dictatedToastId,
	resetDictatedSendsForTests,
	useConversationInputStore,
	useCanonicalSessionsStore,
} = await import(bundlePath.href);
await unlink(bundlePath).catch(() => {});

after(() => {
	dom.window.close();
});

const A = "session-a";
const B = "session-b";

/** The view is on `origin`, so a refusal is stated by the pane and NOT toasted. */
const viewOn = (origin) => {
	useCanonicalSessionsStore.setState({
		activeSessionId: origin.startsWith("draft:") ? null : origin,
		activeDraftKey: origin.startsWith("draft:") ? origin : null,
	});
};

const box = () => useConversationInputStore.getState();

beforeEach(() => {
	resetDictatedSendsForTests();
	useConversationInputStore.setState({ inputByConversation: {} });
	useCanonicalSessionsStore.setState({
		sessions: [],
		drafts: {},
		activeSessionId: A,
		activeDraftKey: null,
	});
});

const INTACT = { draftAtPress: "", owner: "composer-1" };

test("a conversation holds ONE dictated send, and it is free again once it ends", () => {
	viewOn(A);
	const first = dictatedSends.begin(A, INTACT);
	assert.equal(typeof first, "string", "the first press arms an intent");
	assert.equal(dictatedSends.has(A), true);
	assert.equal(
		dictatedSends.begin(A, INTACT),
		null,
		"a second press in the same conversation is refused rather than racing the first",
	);
	assert.equal(
		Object.keys(useDictatedSendStore.getState().intents).length,
		1,
		"and nothing was recorded for the refusal",
	);
	dictatedSends.end(first);
	assert.equal(dictatedSends.has(A), false, "ending frees the conversation");
	assert.equal(
		typeof dictatedSends.begin(A, INTACT),
		"string",
		"so the next press begins a new one",
	);
});

test("a transcript that lands intact is written to the origin's draft before it is sent", () => {
	viewOn(A);
	const id = dictatedSends.begin(A, INTACT);
	const delivered = [];
	dictatedSends.register(A, async (text, options) => {
		// The box must ALREADY hold the words when the sender is asked: that
		// ordering is what makes every later failure degrade to "the text is in
		// that chat's draft" instead of to silence.
		assert.equal(box().getCurrentInput(A), text, "the draft was written first");
		delivered.push({ text, options });
		return true;
	});

	return dictatedSends.deliverAway(id, "hello there", "dictated").then(() => {
		assert.deepEqual(
			delivered.map((entry) => entry.text),
			["hello there"],
			"the transcript went to the origin's sender",
		);
		/*
		 * THE ORIGIN TRAVELS WITH THE CALL. The composer that answers may have been
		 * re-pointed at another conversation since the press, so the record states
		 * which row the words belong to rather than letting the sender infer it.
		 */
		assert.deepEqual(delivered[0].options, {
			inputMode: "dictated",
			originId: A,
		});
		assert.equal(
			dictatedSends.has(A),
			false,
			"and the intent ended on acceptance",
		);
		assert.deepEqual(
			useDictatedSendStore.getState().refused,
			{},
			"nothing was refused",
		);
	});
});

test("an edited draft is merged, not sent, and says so", () => {
	viewOn(A);
	const id = dictatedSends.begin(A, INTACT);
	let called = false;
	dictatedSends.register(A, async () => {
		called = true;
		return true;
	});
	// The user typed while the words were being written down.
	box().setCurrentInput(A, "x");

	return dictatedSends.deliverAway(id, "words", "dictated").then(() => {
		assert.equal(called, false, "nothing was posted over an edited draft");
		assert.equal(
			box().getCurrentInput(A),
			"x words",
			"the transcript joined the text the user added",
		);
		const refusal = useDictatedSendStore.getState().refused[A];
		assert.equal(refusal?.reason, "edited");
		assert.match(
			dictatedRefusalSentence(refusal),
			/^Not sent to /,
			"and the page states it in the refusal sentence",
		);
	});
});

test("every refusal class reaches the reader with its own sentence, and names the chat", () => {
	useCanonicalSessionsStore.setState({
		sessions: [{ session_id: A, title: "Fix the composer" }],
	});
	viewOn(A);
	const reasons = [
		"edited",
		"command",
		"gate",
		"secret",
		"no-model",
		"unavailable",
		"not-ready",
	];
	const sentences = new Map();
	for (const reason of reasons) {
		const id = dictatedSends.begin(A, INTACT);
		dictatedSends.register(A, async () => reason);
		// eslint-disable-next-line no-await-in-loop
		return dictatedSends.deliverAway(id, "words", "dictated").then(() => {
			const refusal = useDictatedSendStore.getState().refused[A];
			assert.equal(refusal?.reason, reason, `${reason} is recorded as itself`);
			assert.equal(
				refusal?.title,
				"Fix the composer",
				"with the chat's own name",
			);
			const sentence = dictatedRefusalSentence(refusal);
			assert.match(sentence, /“Fix the composer”/, "which the sentence names");
			sentences.set(reason, sentence);
		});
	}
	assert.equal(
		new Set(sentences.values()).size,
		reasons.length,
		"no two classes share a sentence",
	);
});

test("a text that is gone is not promised to be in a draft", () => {
	useCanonicalSessionsStore.setState({ sessions: [] });
	viewOn(A);
	const id = dictatedSends.begin(A, INTACT);
	dictatedSends.register(A, async () => "origin-gone");
	return dictatedSends.deliverAway(id, "words", "dictated").then(() => {
		const refusal = useDictatedSendStore.getState().refused[A];
		const sentence = dictatedRefusalSentence(refusal);
		assert.match(sentence, /no longer exists/);
		assert.doesNotMatch(
			sentence,
			/is in that chat's draft/,
			"the sentence must not send the reader to a draft that cannot exist",
		);
	});
});

test("a take that could not be transcribed is stated as lost, with no retry promised", () => {
	viewOn(A);
	const id = dictatedSends.begin(A, INTACT);
	dictatedSends.failAway(id, "transcription");
	const refusal = useDictatedSendStore.getState().refused[A];
	assert.equal(refusal.reason, "transcription");
	const sentence = dictatedRefusalSentence(refusal);
	assert.match(sentence, /Couldn't transcribe your dictation/);
	assert.match(sentence, /record it again/);
	assert.doesNotMatch(sentence, /draft/);
	assert.equal(
		dictatedSends.has(A),
		false,
		"and the conversation is free again",
	);
});

test("a sender that throws, and a conversation with no sender at all, are refusals rather than silence", async () => {
	viewOn(A);
	const throwing = dictatedSends.begin(A, INTACT);
	dictatedSends.register(A, async () => {
		throw new Error("the page died mid-call");
	});
	await dictatedSends.deliverAway(throwing, "words", "dictated");
	assert.equal(
		useDictatedSendStore.getState().refused[A]?.reason,
		"unavailable",
	);
	resetDictatedSendsForTests();
	useConversationInputStore.setState({ inputByConversation: {} });

	const orphan = dictatedSends.begin(B, INTACT);
	viewOn(B);
	await dictatedSends.deliverAway(orphan, "words", "dictated");
	assert.equal(
		useDictatedSendStore.getState().refused[B]?.reason,
		"unavailable",
		"no registered sender is a named refusal, not a dropped send",
	);
});

test("a new chat whose draft is gone refuses with origin-gone instead of writing nowhere", async () => {
	const fresh = "draft:11111111-2222-3333-4444-555555555555";
	useCanonicalSessionsStore.setState({ drafts: {} });
	viewOn(fresh);
	const id = dictatedSends.begin(fresh, INTACT);
	let called = false;
	dictatedSends.register(fresh, async () => {
		called = true;
		return true;
	});
	await dictatedSends.deliverAway(id, "words", "dictated");
	assert.equal(
		called,
		false,
		"nothing is posted for a draft that no longer exists",
	);
	assert.equal(
		useDictatedSendStore.getState().refused[fresh]?.reason,
		"origin-gone",
	);
	assert.equal(dictatedSends.has(fresh), false);
});

test("the intact check is about the press's own text, row for row", () => {
	viewOn(A);
	const table = [
		{ draftAtPress: "", current: "", intact: true },
		{ draftAtPress: "typed", current: "typed", intact: true },
		{ draftAtPress: "typed", current: "typed more", intact: false },
		{ draftAtPress: "", current: "x", intact: false },
		{ draftAtPress: "x", current: "", intact: false },
	];
	return table.reduce(
		(chain, row) =>
			chain.then(async () => {
				resetDictatedSendsForTests();
				useConversationInputStore.setState({ inputByConversation: {} });
				box().setCurrentInput(A, row.current);
				let posted = null;
				dictatedSends.register(A, async (text) => {
					posted = text;
					return true;
				});
				const id = dictatedSends.begin(A, {
					draftAtPress: row.draftAtPress,
					owner: "composer-1",
				});
				await dictatedSends.deliverAway(id, "words", "dictated");
				if (row.intact) {
					assert.equal(
						posted,
						`${row.draftAtPress}${row.draftAtPress ? " " : ""}words`,
						`intact: ${JSON.stringify(row)}`,
					);
				} else {
					assert.equal(posted, null, `edited: ${JSON.stringify(row)}`);
					assert.equal(
						useDictatedSendStore.getState().refused[A]?.reason,
						"edited",
					);
				}
			}),
		Promise.resolve(),
	);
});

test("a refusal is tagged with the origin's toast id, one per conversation", () => {
	assert.equal(dictatedToastId(A), "dictated-away:session-a");
	assert.notEqual(dictatedToastId(A), dictatedToastId(B));
});

/*
 * THE PAGE'S OWN GATE, PINNED AT THE SOURCE (case 15's static half).
 *
 * The behaviour needs a built app and a real microphone, which this suite cannot
 * build; what it CAN do is refuse a page whose `send` stops honouring
 * `originBound`. This is the shape `composer-slots.test.mjs` uses for the same
 * class of claim: a rule the type system cannot express, pinned where it lives.
 */
test("the chat page's send is origin-bound: the view gate, the validation hold and the navigation all yield", () => {
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	assert.match(
		page,
		/!originBound &&\s*sessionId &&\s*!viewIsOnThisSession\(/,
		"an origin-bound send skips the 'the user has already left' gate",
	);
	assert.match(
		page,
		/originBound &&\s*sessionId &&\s*isSessionUnvalidated\(/,
		"and refuses, with a sentence, instead of entering the validation hold",
	);
	assert.match(
		page,
		/!originBound &&\s*draftKey &&\s*useCanonicalSessionsStore\.getState\(\)\.activeSessionId === id/,
		"and a successful one never navigates the reader away from the chat they chose",
	);
});
