import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Exercise the shipped mention mount with independently arriving draft props.
// No layout is claimed: the owner schedules browser frames separately.
const bundle = await build({
	stdin: {
		contents: `
			export {useComposerMentions, MentionField} from './src/renderer/src/features/team-bridge/mentions/mention-field';
			export {MentionSourceContext, useMentionSource} from './src/renderer/src/features/team-bridge/mentions/mention-context';
			export {TeamBridgeMentionProvider} from './src/renderer/src/features/team-bridge/mentions/mention-source';
			export {useMentionDraftStore} from './src/renderer/src/features/team-bridge/mentions/mention-draft-store';
			export {stagedMentions} from './src/renderer/src/features/team-bridge/mentions/mention-outbox';
			export {createRoot} from 'react-dom/client';
			export {act, createElement, useRef, StrictMode, Fragment} from 'react';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
});
const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"Event",
	"InputEvent",
	"MouseEvent",
	"KeyboardEvent",
	"HTMLElement",
	"HTMLTextAreaElement",
	"HTMLInputElement",
	"Node",
	"Element",
	"NodeFilter",
	"MutationObserver",
	"navigator",
	"getComputedStyle",
	"localStorage",
	"CSS",
])
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key] ?? dom.window,
	});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
const path = `${process.cwd()}/.mention-restore-test-${process.pid}.mjs`;
await writeFile(path, bundle.outputFiles[0].text);
let m;
try {
	m = await import(path);
} finally {
	await unlink(path);
}
after(() => dom.window.close());
const human = {
	kind: "human",
	accountId: "acct_ben",
	label: "Ben Tran",
	member: true,
	bridgeOff: false,
};
const agent = {
	kind: "agent",
	accountId: "acct_agent",
	endpointId: "bep_aida",
	label: "Aida",
	member: true,
	bridgeOff: false,
};
const draftKey = "thread|bcv_restore|bcmsg_root";
const defaultOwner = { accountId: "acct_owner_A", tenantId: "tnt_restore" };
const scopedKey = (key = draftKey, owner = defaultOwner) =>
	owner
		? JSON.stringify(["mention-draft-v2", owner.accountId, owner.tenantId, key])
		: null;
const setValue = Object.getOwnPropertyDescriptor(
	dom.window.HTMLTextAreaElement.prototype,
	"value",
).set;

async function mount({
	key = draftKey,
	text = "",
	list = [human, agent],
	failSend = false,
	owner = defaultOwner,
	strictMode = false,
} = {}) {
	let storageKey = scopedKey(key, owner);
	const host = document.createElement("div");
	document.body.append(host);
	const root = m.createRoot(host);
	let controller;
	const sent = [];
	const textWrites = [];
	let refuse;
	function acceptText(next) {
		textWrites.push({
			text: next,
			stored: structuredClone(
				m.useMentionDraftStore.getState().drafts[storageKey],
			),
		});
		render(next);
	}
	function Composer({ value }) {
		const fieldRef = m.useRef(null);
		controller = m.useComposerMentions({
			draftKey: key,
			text: value,
			setText: acceptText,
			fieldRef,
		});
		return m.createElement(
			m.MentionField,
			{ mentions: controller, fieldRef, text: value },
			m.createElement("textarea", {
				ref: fieldRef,
				value,
				autoFocus: true,
				onChange: (event) => acceptText(event.target.value),
				...controller.bindField({}),
			}),
			m.createElement(
				"button",
				{
					onClick: () => {
						controller.stage(value);
						sent.push(m.stagedMentions("bcv_restore", value));
						if (failSend) {
							render("");
							new Promise((_, reject) => {
								refuse = reject;
							}).catch(() => render(value));
						}
					},
				},
				"Send",
			),
		);
	}
	function render(value) {
		text = value;
		root.render(
			m.createElement(
				m.MentionSourceContext.Provider,
				{
					value: {
						conversationId: "bcv_restore",
						draftOwner: owner,
						self: owner
							? { accountId: owner.accountId, label: "Draft owner" }
							: null,
						candidates: list,
						conversationKind: "group",
						sendMentions: true,
					},
				},
				m.createElement(
					strictMode ? m.StrictMode : m.Fragment,
					null,
					m.createElement(Composer, { value }),
				),
			),
		);
	}
	await m.act(async () => render(text));
	return {
		host,
		sent,
		textWrites,
		async refuseSend() {
			await m.act(async () => refuse(new Error("send refused")));
		},
		get controller() {
			return controller;
		},
		get text() {
			return text;
		},
		get stored() {
			return m.useMentionDraftStore.getState().drafts[storageKey];
		},
		async restore(value) {
			await m.act(async () => render(value));
		},
		async changeOwner(next) {
			await m.act(async () => {
				owner = next;
				render(text);
			});
		},
		async type(value, caret = value.length, inputType = "insertText") {
			await m.act(async () => {
				const field = host.querySelector("textarea");
				field.focus();
				setValue.call(field, value);
				field.setSelectionRange(caret, caret);
				field.dispatchEvent(
					new InputEvent("input", { bubbles: true, inputType }),
				);
			});
		},
		/*
		 * Type the way a browser delivers a key, not the way jsdom does. A real
		 * user-dispatched `input` gets a microtask checkpoint between listener
		 * callbacks, and React 18 flushes a discrete (SyncLane) setState at that
		 * checkpoint, so a setState from the field's own target-phase listener
		 * committed the OLD controlled value back into the textarea before
		 * React's delegated root `onChange` ran. jsdom has no such checkpoint,
		 * which is how the #1590 regression ("only a repeated key lands") shipped
		 * green. Modelled in ONE task, outside act() so React schedules its real
		 * microtask flush: a non-bubbling input (only the target-phase listener
		 * sees it), a microtask checkpoint, the check that the key is still in
		 * the field, then the bubbling input React turns into onChange. act()
		 * is not used there on purpose: its async flush yields a macrotask, which
		 * lets unrelated timers re-render between the phases - a browser never
		 * does that between two listeners of one event.
		 */
		async keystrokes(chars) {
			const reverted = [];
			for (const ch of chars) {
				const field = host.querySelector("textarea");
				const next = field.value + ch;
				const init = { inputType: "insertText", data: ch };
				globalThis.IS_REACT_ACT_ENVIRONMENT = false;
				try {
					field.focus();
					setValue.call(field, next);
					field.setSelectionRange(next.length, next.length);
					field.dispatchEvent(
						new InputEvent("input", { ...init, bubbles: false }),
					);
					for (let i = 0; i < 3; i += 1) await Promise.resolve();
					if (field.value !== next)
						reverted.push({ key: ch, expected: next, field: field.value });
					field.dispatchEvent(
						new InputEvent("input", { ...init, bubbles: true }),
					);
				} finally {
					globalThis.IS_REACT_ACT_ENVIRONMENT = true;
				}
				// Settle effects/frames between keys, as a browser would.
				await m.act(async () => {});
			}
			return reverted;
		},
		async switchDraft(nextKey, nextText = "") {
			await m.act(async () => {
				key = nextKey;
				storageKey = scopedKey(nextKey, owner);
				render(nextText);
			});
		},
		async pick(candidate) {
			await m.act(async () => controller.pick(candidate));
		},
		async send() {
			await m.act(async () => host.querySelector("button").click());
		},
		async dispose() {
			await m.act(async () => root.unmount());
			host.remove();
		},
	};
}

async function pickPair(c, first = human, second = agent) {
	await c.type("hello @");
	await c.pick(first);
	await c.type(`${c.text}and @`);
	await c.pick(second);
	await c.type(`${c.text}tagging you`);
}

function assertPills(c, tokens) {
	assert.deepEqual(c.controller.tokens, tokens);
	assert.equal(
		c.host.querySelectorAll("[data-mention-pill]").length,
		tokens.length,
	);
	for (const token of tokens)
		assert.equal(c.text.slice(token.start, token.end), `@${token.label}`);
}

test("late draft text after unmount preserves sidecar, both identities, pills and outgoing mentions", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	let c = await mount();
	try {
		await pickPair(c);
		const text = c.text;
		const tokens = structuredClone(c.controller.tokens);
		assert.equal(tokens.length, 2);
		await c.dispose();
		c = await mount();
		assert.ok(
			c.stored,
			"hydration-only empty render must not delete the mention sidecar",
		);
		await c.restore(text);
		assertPills(c, tokens);
		assert.equal(c.controller.open, false);
		assert.equal(
			c.controller.anchorIndex,
			null,
			"no live query over restored mentions",
		);
		assert.equal(c.host.querySelector('[role="listbox"]'), null);
		await c.send();
		assert.deepEqual(c.sent[0], [
			{ kind: "human", account_id: human.accountId },
			{
				kind: "agent",
				account_id: agent.accountId,
				endpoint_id: agent.endpointId,
			},
		]);
		await c.type(`${c.text} @Be`);
		assert.equal(
			c.controller.open,
			true,
			"typing after a restored mention still starts a new query",
		);
		await c.pick(human);
		assert.equal(c.controller.tokens.length, 3);
	} finally {
		await c.dispose();
	}
});

test("duplicate labels keep distinct human account IDs through remount and send", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const other = { ...human, accountId: "acct_other_ben" };
	let c = await mount({ list: [human, other] });
	try {
		await pickPair(c, human, other);
		const text = c.text;
		const tokens = structuredClone(c.controller.tokens);
		assert.deepEqual(
			tokens.map((token) => token.accountId),
			[human.accountId, other.accountId],
		);
		await c.dispose();
		c = await mount({ list: [human, other] });
		await c.restore(text);
		assertPills(c, tokens);
		await c.send();
		assert.deepEqual(
			c.sent[0],
			[human, other].map((row) => ({
				kind: "human",
				account_id: row.accountId,
			})),
		);
	} finally {
		await c.dispose();
	}
});

test("Unicode labels retain exact UTF-16 ranges and original identities", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const first = { ...human, label: "Bén Trần" };
	const second = { ...agent, label: "Élodie \u{1f680}" };
	let c = await mount({ list: [first, second] });
	try {
		await pickPair(c, first, second);
		const text = c.text;
		const tokens = structuredClone(c.controller.tokens);
		await c.dispose();
		c = await mount({ list: [first, second] });
		await c.restore(text);
		assertPills(c, tokens);
		assert.deepEqual(
			tokens.map((token) => token.accountId),
			[first.accountId, second.accountId],
		);
	} finally {
		await c.dispose();
	}
});

test("edits before and between mentions shift untouched pills; an inside edit drops only its identity", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount();
	try {
		await pickPair(c);
		let [first, second] = structuredClone(c.controller.tokens);
		await c.type(`prefix ${c.text}`);
		first = { ...first, start: first.start + 7, end: first.end + 7 };
		second = { ...second, start: second.start + 7, end: second.end + 7 };
		assertPills(c, [first, second]);
		await c.type(
			`${c.text.slice(0, second.start)}between ${c.text.slice(second.start)}`,
		);
		second = { ...second, start: second.start + 8, end: second.end + 8 };
		assertPills(c, [first, second]);
		await c.type(
			`${c.text.slice(0, first.start + 2)}X${c.text.slice(first.start + 3)}`,
		);
		assertPills(c, [second]);
		assert.deepEqual(c.stored.tokens, [second]);
	} finally {
		await c.dispose();
	}
});

test("deleting one mention preserves the other and writes its shifted range before the text setter", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount();
	try {
		await pickPair(c);
		const [first, second] = c.controller.tokens;
		const length = first.end - first.start;
		await c.type(
			c.text.slice(0, first.start) + c.text.slice(first.end),
			first.start,
			"deleteContentBackward",
		);
		const remaining = {
			...second,
			start: second.start - length,
			end: second.end - length,
		};
		assertPills(c, [remaining]);
		const observed = c.textWrites.at(-1);
		assert.equal(observed.stored.text, observed.text);
		assert.deepEqual(observed.stored.tokens, [remaining]);
		await c.type("");
		assert.equal(
			c.stored,
			undefined,
			"a real user clear removes the persisted sidecar",
		);
		assert.equal(c.textWrites.at(-1).stored, undefined);
	} finally {
		await c.dispose();
	}
});

test("committed mentions plus trailing prose never query; typing a fresh @ still works", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount();
	try {
		await pickPair(c);
		assert.equal(c.controller.open, false);
		assert.equal(c.controller.anchorIndex, null);
		await c.type(`${c.text} @Be`);
		assert.equal(c.controller.open, true);
		await c.pick(human);
		assert.equal(c.controller.tokens.length, 3);
		assert.equal(c.controller.open, false);
	} finally {
		await c.dispose();
	}
});

test("optimistic clear then refused send restores known draft identities and never opens a query", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount({ failSend: true });
	try {
		await pickPair(c);
		const text = c.text;
		const tokens = structuredClone(c.controller.tokens);
		await c.send();
		assert.equal(c.text, "");
		assert.equal(
			c.stored,
			undefined,
			"optimistic clear must not leave a stale persisted sidecar",
		);
		await c.refuseSend();
		assert.equal(c.text, text);
		assertPills(c, tokens);
		assert.deepEqual(c.stored.tokens, tokens);
		assert.equal(c.controller.open, false);
		assert.equal(c.controller.anchorIndex, null);
	} finally {
		await c.dispose();
	}
});

test("legacy text-only restore never invents identity from matching display names", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount();
	try {
		await c.restore("@Ben Tran tagging you and @Aida");
		assert.equal(c.text, "@Ben Tran tagging you and @Aida");
		assertPills(c, []);
		assert.equal(c.controller.open, false);
		assert.equal(c.controller.anchorIndex, null);
		await c.send();
		assert.equal(c.sent[0], undefined);
	} finally {
		await c.dispose();
	}
});

test("thread and page keys remain disjoint; mismatched ranges are rejected without inferring identities", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	let c = await mount();
	try {
		await pickPair(c);
		const text = c.text;
		const saved = structuredClone(c.stored);
		await c.dispose();
		c = await mount({
			key: [
				"bridge",
				defaultOwner.accountId,
				defaultOwner.tenantId,
				"bcv_restore",
			].join(":"),
			text,
		});
		assertPills(c, []);
		assert.equal(c.controller.open, false);
		assert.deepEqual(
			m.useMentionDraftStore.getState().drafts[scopedKey()],
			saved,
		);
		await c.dispose();
		m.useMentionDraftStore.setState({
			drafts: {
				[scopedKey()]: {
					...saved,
					tokens: saved.tokens.map((token) => ({
						...token,
						start: token.start + 1,
					})),
				},
			},
		});
		c = await mount({ text });
		assertPills(c, []);
		assert.equal(c.stored, undefined);
	} finally {
		await c.dispose();
	}
});

test("intermediate short hydration preserves the original snapshot until matching text arrives", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	let c = await mount();
	try {
		await pickPair(c);
		const text = c.text;
		const saved = structuredClone(c.stored);
		await c.dispose();
		c = await mount({ text: "hello" });
		assert.deepEqual(c.stored, saved);
		await c.restore("hello @Be");
		assert.deepEqual(c.stored, saved);
		assert.equal(c.controller.open, false);
		await c.restore(text);
		assertPills(c, saved.tokens);
	} finally {
		await c.dispose();
	}
});

test("an actual user edit during hydration retires the snapshot and cannot resurrect its identities", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	let c = await mount();
	try {
		await pickPair(c);
		const oldText = c.text;
		await c.dispose();
		c = await mount();
		await c.type("a different draft");
		assert.equal(c.stored, undefined);
		await c.type(oldText);
		assertPills(c, []);
		await c.send();
		assert.equal(c.sent[0], undefined);
	} finally {
		await c.dispose();
	}
});

// This is the shipped THREAD key through the hook host, with text explicitly
// delivered by the harness. The real thread remount starts with empty local
// state; this does not claim the shipped page has an unscoped draft-text leak.
test("R1: thread-key tokens stay private across owners even when identical text is delivered", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	let c = await mount();
	try {
		await pickPair(c);
		const text = c.text;
		assert.equal(c.controller.tokens.length, 2);
		await c.dispose();
		c = await mount({ owner: { ...defaultOwner, accountId: "acct_owner_B" } });
		await c.restore(text);
		assertPills(c, []);
		await c.send();
		assert.equal(
			c.sent[0],
			undefined,
			"owner B must send no inherited mention rows",
		);
	} finally {
		await c.dispose();
	}
});

test("R1: tenant scope and unresolved ownership cannot read another draft's tokens", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	let c = await mount();
	try {
		await pickPair(c);
		const text = c.text;
		await c.dispose();
		c = await mount({
			text,
			owner: { ...defaultOwner, tenantId: "tnt_other" },
		});
		assertPills(c, []);
		await c.send();
		assert.equal(c.sent[0], undefined);
		await c.dispose();
		c = await mount({ text, owner: null });
		assertPills(c, []);
		await c.type("hello @");
		await c.pick(human);
		assert.equal(
			c.stored,
			undefined,
			"unresolved ownership must not persist tokens",
		);
		assert.equal(
			Object.keys(m.useMentionDraftStore.getState().drafts).length,
			1,
			"only the original owner's scoped sidecar remains",
		);
	} finally {
		await c.dispose();
	}
});

test("R1: legacy unscoped sidecars are never adopted and v1 persistence is discarded", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	let c = await mount();
	try {
		await pickPair(c);
		const text = c.text;
		const saved = structuredClone(c.stored);
		await c.dispose();
		m.useMentionDraftStore.setState({ drafts: { [draftKey]: saved } });
		c = await mount({ text });
		assertPills(c, []);
		await c.send();
		assert.equal(c.sent[0], undefined);
		await c.dispose();
		localStorage.setItem(
			"team-bridge-mention-drafts",
			JSON.stringify({ version: 1, state: { drafts: { [draftKey]: saved } } }),
		);
		await m.act(async () => m.useMentionDraftStore.persist.rehydrate());
		assert.deepEqual(m.useMentionDraftStore.getState().drafts, {});
		c = await mount({ text });
		assertPills(c, []);
	} finally {
		await c.dispose();
	}
});

test("R1: an owner change without unmount retires in-memory tokens and restoration history", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount();
	try {
		await pickPair(c);
		const text = c.text;
		await c.changeOwner({ ...defaultOwner, accountId: "acct_owner_B" });
		assertPills(c, []);
		await c.restore("");
		await c.restore(text);
		assertPills(c, []);
		await c.send();
		assert.equal(c.sent[0], undefined);
	} finally {
		await c.dispose();
	}
});

test("R1: shipped provider derives ownership from IDs even before the directory self row loads", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = m.createRoot(host);
	let source;
	function Reader() {
		source = m.useMentionSource();
		return null;
	}
	try {
		await m.act(async () =>
			root.render(
				m.createElement(
					m.TeamBridgeMentionProvider,
					{
						conversation: {
							id: "bcv_restore",
							tenant_id: defaultOwner.tenantId,
							kind: "group",
							members: [],
						},
						people: [],
						selfAccountId: defaultOwner.accountId,
						sendMentions: true,
					},
					m.createElement(Reader),
				),
			),
		);
		assert.equal(source.self, null);
		assert.deepEqual(source.draftOwner, defaultOwner);
	} finally {
		await m.act(async () => root.unmount());
		host.remove();
	}
});

/*
 * THE #1590 KEYSTROKE REGRESSION. A setState in the field's native `input`
 * listener re-rendered the composer with the previous `text` prop before
 * onChange, so React wrote the old value back and the key was lost; only a key
 * repeating the previous one survived (setState bailed out on an equal
 * string), which is why "hello" came out as "l".
 */
for (const word of ["abc", "aab", "hello"])
	test(`browser-ordered keystrokes land every key: ${JSON.stringify(word)}`, async () => {
		m.useMentionDraftStore.setState({ drafts: {} });
		const c = await mount();
		try {
			const reverted = await c.keystrokes(word);
			assert.deepEqual(reverted, [], "no keystroke may be reverted");
			assert.equal(c.text, word);
			assert.equal(c.host.querySelector("textarea").value, word);
		} finally {
			await c.dispose();
		}
	});

test("browser-ordered burst over a restored scoped draft keeps every key and the pills", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	let c = await mount();
	try {
		await pickPair(c);
		const text = c.text;
		const tokens = structuredClone(c.controller.tokens);
		assert.equal(tokens.length, 2);
		await c.dispose();
		c = await mount();
		await c.restore(text);
		assertPills(c, tokens);
		const reverted = await c.keystrokes(" more");
		assert.deepEqual(reverted, []);
		assert.equal(c.text, `${text} more`);
		assertPills(c, tokens);
		assert.deepEqual(c.stored.tokens, tokens, "persisted pair keeps the pills");
		assert.equal(c.stored.text, `${text} more`);
	} finally {
		await c.dispose();
	}
});

test("browser-ordered typing across a draft switch keeps each draft's own text and tokens", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const other = "thread|bcv_restore|bcmsg_other";
	const c = await mount();
	try {
		await c.type("hi @");
		await c.pick(human);
		assert.deepEqual(await c.keystrokes("ab"), []);
		const textA = c.text;
		const tokensA = structuredClone(c.controller.tokens);
		assert.equal(tokensA.length, 1);
		await c.switchDraft(other, "");
		assertPills(c, []);
		assert.deepEqual(await c.keystrokes("yz"), [], "no key lost after switch");
		assert.equal(c.text, "yz");
		assertPills(c, []);
		// A token-free draft has no sidecar (the store drops empty maps), and
		// it must not have inherited the other draft's pill.
		assert.equal(c.stored, undefined);
		await c.switchDraft(draftKey, textA);
		assertPills(c, tokensA);
		assert.deepEqual(await c.keystrokes("!"), []);
		assert.equal(c.text, `${textA}!`);
		assertPills(c, tokensA);
	} finally {
		await c.dispose();
	}
});

// `:sm`, not a bare `:`: U1 keeps the list closed below two characters, so a
// bare colon now proves key retention but not intent adoption.
for (const word of [":sm", ":smile", "hello :heart"]) {
	test(`emoji browser-ordered StrictMode typing retains every key and adopts intent: ${word}`, async () => {
		m.useMentionDraftStore.setState({ drafts: {} });
		const c = await mount({ strictMode: true });
		try {
			assert.deepEqual(await c.keystrokes(word), []);
			assert.equal(c.text, word);
			assert.equal(c.controller.emoji.open, true);
			assert.notEqual(document.querySelector("[data-emoji-popover]"), null);
		} finally {
			await c.dispose();
		}
	});
}

test("restored shortcode and programmatic dictation never invent emoji intent", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount({ text: ":smile", strictMode: true });
	try {
		assert.equal(c.controller.emoji.open, false);
		await c.restore("dictated :heart");
		assert.equal(c.controller.emoji.open, false);
		assert.equal(document.querySelector("[data-emoji-popover]"), null);
		await c.switchDraft("emoji-other", ":smile");
		assert.equal(c.controller.emoji.open, false);
	} finally {
		await c.dispose();
	}
});

test("optimistic clear and identical refused-send restore cannot resurrect old emoji intent", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount({ strictMode: true });
	try {
		await c.keystrokes(":smile");
		assert.equal(c.controller.emoji.open, true);
		await c.restore("");
		assert.equal(c.controller.emoji.open, false);
		await c.restore(":smile");
		assert.equal(c.controller.emoji.open, false);
	} finally {
		await c.dispose();
	}
});

test("browser-ordered '@' into an empty composer opens the popover on that keystroke", async () => {
	m.useMentionDraftStore.setState({ drafts: {} });
	const c = await mount();
	try {
		assert.deepEqual(await c.keystrokes("@"), []);
		assert.equal(c.text, "@");
		assert.equal(c.controller.open, true, "the very keystroke arms the query");
		// The popover portals to the document body, not into the host.
		assert.notEqual(document.querySelector('[role="listbox"]'), null);
		assert.equal(
			c.host.querySelector("textarea").getAttribute("aria-expanded"),
			"true",
		);
	} finally {
		await c.dispose();
	}
});
