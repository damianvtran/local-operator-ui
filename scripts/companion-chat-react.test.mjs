import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.HTMLElement = undefined;
	globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

const bundle = await build({
	entryPoints: ["src/renderer/src/companion-chat.tsx"],
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_companion-chat-react-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CompanionChat } = await import(bundlePath.href);
await unlink(bundlePath);

const idle = {
	sessionId: "session-one",
	title: "Local Operator",
	messages: [],
	status: "idle",
	error: null,
	canSend: true,
};

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function mount(t, overrides = {}) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	t.after(async () => {
		await act(async () => root.unmount());
		host.remove();
	});
	let props = {
		snapshot: idle,
		open: true,
		onSend: async () => true,
		onNewChat: () => {},
		onCollapse: () => {},
		onExpand: () => {},
		...overrides,
	};
	const render = async (next = {}) => {
		props = { ...props, ...next };
		await act(async () =>
			root.render(React.createElement(CompanionChat, props)),
		);
	};
	await render();
	const input = host.querySelector("textarea");
	const button = (label) => host.querySelector(`[aria-label="${label}"]`);
	const type = (value) =>
		act(async () => {
			Object.getOwnPropertyDescriptor(
				dom.window.HTMLTextAreaElement.prototype,
				"value",
			).set.call(input, value);
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
	const submit = () =>
		host
			.querySelector("form")
			.dispatchEvent(
				new dom.window.Event("submit", { bubbles: true, cancelable: true }),
			);
	const key = (options = {}) =>
		act(async () =>
			input.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
					...options,
				}),
			),
		);
	return { host, render, input, button, type, submit, key };
}

test("collapse preserves drafts and pending sends cannot be duplicated", async (t) => {
	const pending = deferred();
	const sent = [];
	const { host, render, input, button, type, submit } = await mount(t, {
		onSend: (text) => {
			sent.push(text);
			return pending.promise;
		},
	});
	assert.equal(document.activeElement, input);
	await type("  Help me plan this  ");
	await render({ open: false });
	assert.equal(host.querySelector("section").hidden, true);
	await render({ open: true });
	assert.equal(input.value, "  Help me plan this  ");
	await act(async () => {
		submit();
		submit();
	});
	assert.deepEqual(sent, ["Help me plan this"]);
	assert.equal(input.readOnly, true);
	assert.equal(button("New chat").disabled, true);
	assert.equal(button("Send message").disabled, true);
	await act(async () => pending.resolve(true));
	await render({ snapshot: { ...idle, status: "working", canSend: false } });
	assert.equal(input.value, "");
	assert.equal(input.readOnly, false);
	await type("My next thought");
	assert.equal(input.value, "My next thought");
});

for (const moveFocus of [false, true]) {
	test(`send ${moveFocus ? "preserves later focus changes" : "focuses the input before disabling its button"}`, async (t) => {
		const pending = deferred();
		const { input, button, type, submit } = await mount(t, {
			onSend: () => pending.promise,
		});
		await type("One message");
		button("Send message").focus();
		await act(async () => submit());
		assert.equal(document.activeElement, input);
		assert.equal(button("Send message").disabled, true);
		const expand = button("Open chat in the full app");
		if (moveFocus) expand.focus();
		await act(async () => pending.resolve(true));
		assert.equal(document.activeElement, moveFocus ? expand : input);
	});
}

test("failed delivery retains the draft and displays the service error", async (t) => {
	const { host, render, input, button, type, submit } = await mount(t, {
		onSend: async () => {
			throw new Error("Disconnected");
		},
	});
	await type("Keep this safe");
	await act(async () => submit());
	assert.equal(input.value, "Keep this safe");
	assert.ok(
		host
			.querySelector('[role="alert"]')
			.textContent.includes("could not be confirmed"),
	);
	await render({
		snapshot: {
			...idle,
			status: "error",
			error: "Check chat before trying again.",
			canSend: false,
		},
	});
	assert.equal(
		host.querySelector('[role="alert"]').textContent,
		"Check chat before trying again.",
	);
	assert.equal(button("Send message").disabled, true);
});

test("retrying the original preserves edits and cannot send them or duplicate the retry", async (t) => {
	const pending = deferred();
	const sent = [];
	const { render, input, button, type, key, submit } = await mount(t, {
		snapshot: {
			...idle,
			status: "error",
			error: "Send unconfirmed. Retry original to check; your draft is saved.",
			pendingText: "The original task",
		},
		onSend: (text) => {
			sent.push(text);
			return pending.promise;
		},
	});
	await type("An edited draft I want to keep");
	assert.equal(button("Send message").disabled, true);
	await key();
	await act(async () => submit());
	assert.deepEqual(sent, []);
	const retry = button("Retry original message");
	retry.focus();
	await act(async () => {
		retry.click();
		retry.click();
	});
	assert.deepEqual(sent, ["The original task"]);
	assert.equal(document.activeElement, input);
	assert.equal(retry.disabled, true);
	assert.equal(input.readOnly, true);
	const expand = button("Open chat in the full app");
	expand.focus();
	await act(async () => pending.resolve(true));
	await render({ snapshot: { ...idle, status: "working", canSend: false } });
	assert.equal(button("Retry original message"), null);
	assert.equal(input.value, "An edited draft I want to keep");
	assert.equal(document.activeElement, expand);
	await render({ snapshot: idle });
	assert.equal(button("Send message").disabled, false);
	await key();
	assert.deepEqual(sent, [
		"The original task",
		"An edited draft I want to keep",
	]);
});

test("an unchanged original clears only after its retry is accepted", async (t) => {
	let accepted = false;
	const { input, button, type } = await mount(t, {
		snapshot: { ...idle, pendingText: "One task" },
		onSend: async () => accepted,
	});
	await type("  One task  ");
	await act(async () => button("Retry original message").click());
	assert.equal(input.value, "  One task  ");
	accepted = true;
	await act(async () => button("Retry original message").click());
	assert.equal(input.value, "");
});

test("a chat creation failure can open the app before a session exists", async (t) => {
	let expanded = 0;
	const { input, button, type } = await mount(t, {
		snapshot: {
			...idle,
			sessionId: null,
			status: "error",
			error: "Chat could not start. Try again or open the app.",
		},
		onExpand: () => expanded++,
	});
	await type("Keep this draft");
	assert.equal(button("New chat"), null);
	assert.equal(button("Open chat in the full app").disabled, false);
	await act(async () => button("Open chat in the full app").click());
	assert.equal(expanded, 1);
	assert.equal(input.value, "Keep this draft");
});

test("Enter sends, Shift+Enter adds a line, and IME ignores Enter and Escape", async (t) => {
	const sent = [];
	let collapsed = 0;
	const { input, type, key } = await mount(t, {
		onSend: async (text) => {
			sent.push(text);
			return true;
		},
		onCollapse: () => collapsed++,
	});
	await type("こんにちは");
	await key({ isComposing: true });
	await key({ keyCode: 229 });
	await key({ shiftKey: true });
	await key({ key: "Escape", isComposing: true });
	assert.deepEqual(sent, []);
	assert.equal(collapsed, 0);
	await key();
	assert.deepEqual(sent, ["こんにちは"]);
	assert.equal(input.value, "");
	await key({ key: "Escape" });
	assert.equal(collapsed, 1);
});

test("reply updates preserve scroll position until the next answer", async (t) => {
	const { host, render } = await mount(t);
	const first = { id: "a", role: "assistant", text: "First answer" };
	await render({ snapshot: { ...idle, messages: [first] } });
	const reply = () => host.querySelector(".companion-chat-reply");
	reply().scrollTop = 70;
	await render({
		snapshot: { ...idle, messages: [{ ...first, text: "Updated answer" }] },
	});
	await render({ open: false });
	await render({ open: true });
	assert.equal(reply().scrollTop, 70);
	reply().focus();
	await render({
		snapshot: {
			...idle,
			messages: [first, { id: "b", role: "assistant", text: "Next answer" }],
		},
	});
	assert.equal(reply().textContent, "Next answer");
	assert.equal(reply().scrollTop, 0);
	assert.equal(document.activeElement, reply());
});

test("streaming replies remain visible while announcements wait for completion", async (t) => {
	const { host, render, input } = await mount(t);
	const announcement = host.querySelector('[aria-live="polite"]');
	assert.equal(announcement.textContent, "");
	const message = { id: "answer", role: "assistant", text: "One" };
	const working = { ...idle, status: "working", canSend: false };
	await render({ snapshot: { ...working, messages: [message] } });
	const reply = host.querySelector(".companion-chat-reply p");
	assert.equal(reply, announcement);
	assert.equal(reply.getAttribute("aria-live"), "polite");
	assert.equal(reply.getAttribute("aria-busy"), "true");
	assert.equal(reply.textContent, "One");
	await render({
		snapshot: {
			...working,
			messages: [{ ...message, text: "One complete answer." }],
		},
	});
	assert.equal(host.querySelector(".companion-chat-reply p"), reply);
	assert.equal(reply.textContent, "One complete answer.");
	assert.equal(reply.getAttribute("aria-busy"), "true");
	await render({
		snapshot: {
			...idle,
			messages: [{ ...message, text: "One complete answer." }],
		},
	});
	assert.equal(reply.getAttribute("aria-busy"), "false");
	assert.equal(reply.getAttribute("aria-atomic"), "true");
	assert.equal(reply.textContent, "One complete answer.");
	assert.equal(document.activeElement, input);
});

test("the first completed answer updates an existing live region", async (t) => {
	const { host, render, input } = await mount(t);
	const announcement = host.querySelector('[aria-live="polite"]');
	assert.equal(announcement.textContent, "");
	assert.equal(announcement.closest("section").hasAttribute("hidden"), false);
	await render({
		snapshot: {
			...idle,
			messages: [{ id: "first", role: "assistant", text: "Already complete." }],
		},
	});
	assert.equal(host.querySelector('[aria-live="polite"]'), announcement);
	assert.equal(announcement.textContent, "Already complete.");
	assert.equal(announcement.getAttribute("aria-busy"), "false");
	assert.equal(document.activeElement, input);
});

test("question context is optional and a follow-up distinguishes the previous reply", async (t) => {
	const messages = [
		{ id: "question", role: "user", text: "What should I do today?" },
		{ id: "answer", role: "assistant", text: "Take a walk." },
	];
	const { host, render, button } = await mount(t, {
		snapshot: { ...idle, messages },
	});
	const reply = host.querySelector(".companion-chat-reply");
	const announcement = reply.querySelector('[aria-live="polite"]');
	assert.equal(reply.textContent, "Take a walk.");
	assert.equal(
		button("Show last question").getAttribute("aria-expanded"),
		"false",
	);
	await act(async () => button("Show last question").click());
	assert.ok(
		reply.textContent.includes("Your last question: What should I do today?"),
	);
	const disclosure = button("Hide last question");
	assert.equal(disclosure.getAttribute("aria-expanded"), "true");
	assert.equal(announcement.textContent, "Take a walk.");
	disclosure.focus();
	const activeQuestion = { id: "follow-up", text: "What if it rains?" };
	await render({
		snapshot: {
			...idle,
			status: "working",
			canSend: false,
			messages,
			activeQuestion,
		},
	});
	assert.equal(reply.getAttribute("aria-label"), "Previous reply");
	assert.ok(reply.textContent.includes("Previous reply"));
	assert.ok(
		reply.textContent.includes("Your last question: What if it rains?"),
	);
	assert.equal(document.activeElement, disclosure);
	await render({
		snapshot: {
			...idle,
			messages: [
				...messages,
				{ ...activeQuestion, role: "user" },
				{ id: "next-answer", role: "assistant", text: "Read a book." },
			],
		},
	});
	assert.equal(reply.getAttribute("aria-label"), "Latest reply");
	assert.equal(reply.textContent.includes("Previous reply"), false);
	assert.equal(reply.querySelector('[aria-live="polite"]'), announcement);
	assert.equal(announcement.textContent, "Read a book.");
	await act(async () => button("Hide last question").click());
	assert.equal(reply.textContent, "Read a book.");
});

test("showing the last question reveals it without moving focus or following reply updates", async (t) => {
	const messages = [
		{ id: "question", role: "user", text: "What should I do today?" },
		{ id: "answer", role: "assistant", text: "Take a walk.\n".repeat(30) },
	];
	const { host, render, button } = await mount(t, {
		snapshot: { ...idle, messages },
	});
	const reply = host.querySelector(".companion-chat-reply");
	reply.scrollTop = 80;
	const disclosure = button("Show last question");
	disclosure.focus();
	await act(async () => disclosure.click());
	assert.equal(reply.scrollTop, 0);
	assert.equal(document.activeElement, disclosure);
	assert.ok(reply.textContent.startsWith("Your last question:"));
	reply.scrollTop = 36;
	await render({
		snapshot: {
			...idle,
			messages: [
				messages[0],
				{ ...messages[1], text: `${messages[1].text}Bring water.` },
			],
		},
	});
	assert.equal(reply.scrollTop, 36);
	assert.equal(document.activeElement, disclosure);
	await act(async () => disclosure.click());
	assert.equal(reply.scrollTop, 36);
});

test("pending approval blocks sending and opens the full app", async (t) => {
	let expanded = false;
	const { host, render, input, button, type } = await mount(t, {
		onExpand: () => {
			expanded = true;
		},
	});
	await render({ snapshot: { ...idle, status: "working", canSend: false } });
	await type("A follow-up");
	assert.equal(button("New chat").disabled, true);
	await render({
		snapshot: {
			...idle,
			status: "attention",
			error: "Approval required",
			canSend: false,
		},
	});
	assert.equal(button("Send message").disabled, true);
	assert.equal(host.querySelector('[role="alert"]'), null);
	await act(async () => host.querySelector(".companion-chat-open").click());
	assert.equal(expanded, true);
	assert.equal(input.value, "A follow-up");
});

test("the shared target is clear and a disabled chief of staff still allows a separate chat", async (t) => {
	let starts = 0;
	const { render, input, button, type } = await mount(t, {
		snapshot: {
			...idle,
			destination: "chief-of-staff",
			sessionId: null,
			status: "error",
			canSend: false,
			error: "The chief of staff is switched off on this install.",
		},
		onNewChat: () => {
			starts++;
		},
	});
	assert.equal(input.placeholder, "Message chief of staff…");
	assert.equal(input.getAttribute("aria-label"), "Message your chief of staff");
	await type("Keep this draft");
	assert.equal(button("Send message").disabled, true);
	assert.equal(button("New chat").disabled, false);
	await act(async () => button("New chat").click());
	assert.equal(starts, 1);
	await render({ snapshot: { ...idle, sessionId: null } });
	assert.equal(input.value, "Keep this draft");
	assert.equal(input.placeholder, "Ask anything…");
	assert.equal(input.getAttribute("aria-label"), "Message Local Operator");
	assert.equal(button("Send message").disabled, false);
});
