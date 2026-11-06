import { randomBytes } from "node:crypto";

/**
 * The page-side clipboard WRITE, installed by the host into a driven view's main
 * world.
 *
 * THE PROBLEM THIS SOLVES, measured rather than assumed (2026-11-06, Electron
 * 45.1.0, built dev app, a real driven tab on a loopback page):
 *
 * - A page's own Copy button calls `navigator.clipboard.writeText`, and in this
 *   runtime Chromium gates that write on ONE content setting
 *   (`CLIPBOARD_READ_WRITE`), which Electron surfaces to
 *   `setPermissionRequestHandler` as **`clipboard-read`**. No
 *   `clipboard-sanitized-write` ask is ever made, so granting that permission
 *   fixes nothing (measured: refused with it granted).
 * - Granting `clipboard-read` DOES make the write work — and it also lets the page
 *   call `navigator.clipboard.readText()` after its own click and read whatever
 *   the user last copied (measured: the page read back the text it had written).
 *   That is exactly the capability the operator ruled out, so the permission
 *   system cannot be the mechanism.
 *
 * SO: the permission handlers stay DEFAULT-DENY (both of them, every permission),
 * `clipboard-read` stays denied and `readText()` keeps rejecting as a
 * PERMISSION-level fact rather than a shim, and the WRITE is served by this
 * host-authored program instead. It adds exactly the capability a
 * `clipboard-sanitized-write` grant would have added — write text to the OS
 * clipboard — and none of the read half that made the grant unacceptable.
 *
 * WHY THE MAIN WORLD, AND WHY THAT IS NOT THE USUAL PROHIBITION: the isolated
 * world is where this host reads pages, because a page cannot observe or patch
 * it. A page's OWN API cannot be replaced from there (worlds share the DOM, not
 * the JavaScript heap), so the one thing that must change about the page's own
 * surface — its clipboard write — can only be done in the main world. What makes
 * that safe is scope: this program is HOST-AUTHORED source (a committed string,
 * never agent-supplied), it exposes no transport to the harness, no file access
 * and no navigation, and the only thing it can do is put bounded text on the OS
 * clipboard through the host's ack protocol. A page that ignores or replaces it
 * simply has the behaviour it has today.
 *
 * THE ACK PROTOCOL exists so the page's promise is truthful. `writeText` must
 * resolve only when the byte actually reached the clipboard: the shim sends
 * `(nonce, requestId, text)` over a CDP binding, the host writes with Electron's
 * `clipboard.writeText` and then evaluates `ack(nonce, requestId, ok)` in the
 * SAME execution context, and the shim resolves or rejects on that. A per-tab
 * NONCE is what stops a page from driving the binding or the ack directly: both
 * are page-visible globals (an injected binding has to be), and a page that
 * could call them would be able to write the clipboard without a gesture and
 * confirm its own writes. The nonce lives in this closure and in the host only.
 *
 * WHY A COMMITTED SOURCE STRING, and not a function stringified at runtime: a
 * bytecode build turns anything handed to `Function.prototype.toString()` into a
 * dummy zero-width source, so the host would install nothing and report success
 * (the trap that already broke `select`). The string below is the program.
 */

/** The CDP binding the page calls; also the page-visible global's name. */
export const CLIPBOARD_BINDING = "__localOperatorClipboardWrite";

/** The global the host calls back with the write's outcome. */
export const CLIPBOARD_ACK = "__localOperatorClipboardAck";

/**
 * The largest text one page write may carry, in UTF-8 bytes.
 *
 * 1 MiB because the clipboard is a legitimate transport for a document, and a
 * "copy" of something larger is a mistake rather than a use case: the bound is
 * enforced on BOTH sides (the shim rejects, and the host re-checks) so a page
 * that patches its way past the first check still cannot push an unbounded string
 * through the binding.
 */
export const CLIPBOARD_SHIM_MAX_BYTES = 1_048_576;

/** How long the shim waits for the host's ack before failing the page's promise.
 * Long enough for a slow clipboard, short enough that a page's spinner ends. */
export const CLIPBOARD_ACK_TIMEOUT_MS = 5_000;

/** The global the HOST calls to arm one write (see `armHostClipboardWrite`). */
export const CLIPBOARD_ARM = "__localOperatorClipboardArm";

/**
 * How long a host-minted arm survives, in milliseconds.
 *
 * SHORTER THAN A BROWSER'S OWN transient-activation window (5 s) on purpose: the
 * arm exists to carry ONE host-dispatched click into the page's own handler, and
 * two seconds is already longer than any handler that copies synchronously — or
 * even after one `await`. A wider window would turn a click into a blanket
 * permission for anything the page schedules afterwards.
 */
export const CLIPBOARD_ARM_WINDOW_MS = 2_000;

/**
 * The program, as one committed string.
 *
 * `nonce` is interpolated as a JSON literal; nothing else is interpolated. Every
 * member the program relies on (`userActivation`, `writeText`, `write`,
 * `permissions.query`) is captured at document start, before any page script can
 * redefine it, so a page that patches `navigator.userActivation` cannot turn its
 * own gesture requirement off.
 */
export function clipboardShimSource(nonce: string): string {
	const config = JSON.stringify({
		binding: CLIPBOARD_BINDING,
		ack: CLIPBOARD_ACK,
		arm: CLIPBOARD_ARM,
		nonce,
		maxBytes: CLIPBOARD_SHIM_MAX_BYTES,
		timeoutMs: CLIPBOARD_ACK_TIMEOUT_MS,
	});
	return `(function (config) {
  "use strict";
  var clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return;
  if (window.__localOperatorClipboardShim === config.nonce) return;
  window.__localOperatorClipboardShim = config.nonce;

  // Captured BEFORE any page script runs: the gesture question must be answered
  // by Chromium's own answer, not by whatever the page left on Navigator.
  var userActivationGetter = (function () {
    var descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "userActivation");
    return descriptor && typeof descriptor.get === "function" ? descriptor.get : null;
  })();
  var nativeWriteText = clipboard.writeText.bind(clipboard);
  var nativeWrite = typeof clipboard.write === "function" ? clipboard.write.bind(clipboard) : null;
  var nativeQuery = typeof navigator.permissions?.query === "function" ? navigator.permissions.query.bind(navigator.permissions) : null;
  var pending = new Map();
  var nextId = 1;

  function refuses(message, name) {
    return Promise.reject(new DOMException(message, name || "NotAllowedError"));
  }

  var armUntil = 0;

  function userGestureActive() {
    try {
      var activation = userActivationGetter ? userActivationGetter.call(navigator) : navigator.userActivation;
      return !!(activation && activation.isActive);
    } catch (error) {
      return false;
    }
  }

  // "arm" is a HOST-dispatched click (see the host's 'armHostClipboardWrite'): the
  // host's own 'click' dispatches in-page rather than through Chromium's input
  // pipeline, so it carries no user activation. Everything this grants is what a
  // REAL click in the same place would have granted the page — one clipboard WRITE
  // inside the window, never a read (the read path is Chromium's, untouched) —
  // which is why the arm is a nonce-carrying, single-use, short-lived flag rather
  // than a mode.
  function activationState() {
    if (Date.now() < armUntil) return "arm";
    return userGestureActive() ? "gesture" : "none";
  }

  // Host-only. A page cannot mint this: the nonce never leaves this closure, and a
  // page calling it with a guessed value returns false without arming anything.
  window[config.arm] = function (nonce, windowMs) {
    if (nonce !== windowsNonce) return false;
    var span = Number(windowMs);
    if (!isFinite(span) || span <= 0) {
      armUntil = 0;
      return false;
    }
    armUntil = Date.now() + span;
    return true;
  };

  // UTF-8 length WITHOUT TextEncoder: the shim has to be dependency-free (it runs
  // in whatever the page's world provides) and the host re-measures with
  // Buffer.byteLength before it writes, so this is the fast pre-check.
  function sizeOf(text) {
    var bytes = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i += 1; } else bytes += 3;
      } else bytes += 3;
    }
    return bytes;
  }

  var windowsNonce = config.nonce;

  // Called by the host through CDP only, and only for an id it issued: the nonce
  // is the credential, because anything a page can call, a page can fake.
  window[config.ack] = function (nonce, id, ok) {
    if (nonce !== windowsNonce) return;
    const settled = pending.get(id);
    if (!settled) return;
    pending.delete(id);
    clearTimeout(settled.timer);
    if (ok) settled.resolve();
    else settled.reject(new DOMException("the host could not write to the clipboard", "NotAllowedError"));
  };

  function writeThroughHost(text) {
    var activation = activationState();
    if (activation === "none") {
      return refuses("The clipboard write requires a user gesture");
    }
    // Consumed by the FIRST write, so one click can never authorize a second copy
    // the page schedules for later.
    if (activation === "arm") armUntil = 0;
    const size = sizeOf(text);
    if (size > config.maxBytes) {
      return refuses("the text is too large to copy (" + size + " bytes)", "QuotaExceededError");
    }
    const send = window[config.binding];
    if (typeof send !== "function") {
      // The binding is the only path to the host; without it this program must not
      // pretend, and the page keeps the native behaviour (a refusal, today).
      return nativeWriteText(text);
    }
    return new Promise(function (resolve, reject) {
      const id = nextId++;
      const timer = setTimeout(function () {
        pending.delete(id);
        reject(new DOMException("the host did not confirm the clipboard write", "NotAllowedError"));
      }, config.timeoutMs);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        // ONE argument, as a JSON string: CDP's bindingCalled event carries a
        // single payload, so a multi-argument call would silently lose the text.
        send(JSON.stringify({ nonce: config.nonce, id: id, text: text }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new DOMException("the host refused the clipboard write", "NotAllowedError"));
      }
    });
  }

  function installWriteText() {
    try {
      Object.defineProperty(clipboard, "writeText", {
        value: function writeText(text) {
          return writeThroughHost(String(text === null || text === undefined ? "" : text));
        },
        configurable: true,
        writable: true,
      });
    } catch (error) {
      /* an unwritable clipboard keeps the native behaviour */
    }
  }

  function installWrite() {
    if (!nativeWrite) return;
    try {
      Object.defineProperty(clipboard, "write", {
        value: function write(items) {
          const list = Array.isArray(items) ? items : [items];
          const first = list[0];
          // TEXT ONLY. Anything else (an image, an unknown type) falls through to
          // the native path, which fails exactly as it does today — the host will
          // not be talked into copying bytes it never inspected.
          if (list.length !== 1 || !first || typeof first.getType !== "function") {
            return nativeWrite(items);
          }
          const types = first.types;
          if (!types || Array.prototype.indexOf.call(types, "text/plain") === -1) {
            return nativeWrite(items);
          }
          return Promise.resolve(first.getType("text/plain"))
            .then(function (blob) { return blob.text(); })
            .then(function (text) { return writeThroughHost(String(text)); });
        },
        configurable: true,
        writable: true,
      });
    } catch (error) {
      /* as above */
    }
  }

  function statusFor(state) {
    return {
      state: state,
      onchange: null,
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return true; },
    };
  }

  function installPermissionQuery() {
    if (!nativeQuery) return;
    try {
      Object.defineProperty(navigator.permissions, "query", {
        value: function query(descriptor) {
          const name = descriptor && descriptor.name;
          // REPORTED CAPABILITY, NOT A CHROMIUM PERMISSION: pages feature-detect a
          // write with this name before attempting one, and the honest answer for a
          // document where the write above is installed is "granted". The READ name
          // is deliberately untouched, so it keeps answering the truth (denied).
          if (name === "clipboard-write") return Promise.resolve(statusFor("granted"));
          return nativeQuery(descriptor);
        },
        configurable: true,
        writable: true,
      });
    } catch (error) {
      /* as above */
    }
  }

  installWriteText();
  installWrite();
  installPermissionQuery();
})(${config});`;
}

/**
 * What `installClipboardShim` needs from the CDP pool: send a command, and hear
 * about events for one view. Declared structurally so this module does not import
 * `cdp.ts` (which imports it back).
 */
export interface ClipboardShimCdp {
	send<T = unknown>(
		contents: { id: number; isDestroyed(): boolean },
		method: string,
		params?: Record<string, unknown>,
	): Promise<T>;
	subscribe(
		webContentsId: number,
		handler: (method: string, params: Record<string, unknown>) => void,
	): () => void;
}

/** The per-view subscriber, so a re-attach retires the previous install instead
 * of stacking a second one on the same view. */
const clipboardShimDisposers = new Map<number, () => void>();

/**
 * The credential in force in each armed view: the host's half of the nonce the
 * shim holds. Kept because the ARM a `click` mints has to name the shim instance
 * that is actually installed — a stale nonce would arm nothing, which is the right
 * failure but a silent one.
 */
const clipboardShimNonces = new Map<number, string>();

/**
 * Install the page-side write into one view, and wire the binding it calls back
 * into the main process.
 *
 * CALLED FROM `cdp.attach` — every attach, not once per tab: a re-attach is a
 * fresh debugger session whose `Page.addScriptToEvaluateOnNewDocument`
 * registrations are gone, and `runImmediately: true` is what covers the document
 * that is already loaded (a tab re-driven after DevTools took it, and the first
 * document of a tab opened before its attach).
 *
 * COVERAGE, stated rather than implied: a page-target script reaches the main
 * frame and every SAME-PROCESS child frame of that target. An out-of-process
 * iframe (a cross-site frame) is a separate target with its own session, and this
 * install does not reach it — its `writeText` keeps the native behaviour (a
 * refusal), which is the same state it had before this change.
 *
 * WHAT IT NEVER DOES: log, echo or measure the payload. The text is validated,
 * written and dropped; the only thing that reaches a log line is a failure count
 * and the reason, because a copy that silently stops working has to be visible
 * without the value being.
 */
export async function installClipboardShim(
	cdp: ClipboardShimCdp,
	contents: { id: number; isDestroyed(): boolean },
	webContentsId: number,
	options: { log?: (message: string) => void } = {},
): Promise<void> {
	const previous = clipboardShimDisposers.get(webContentsId);
	if (previous) {
		previous();
		clipboardShimDisposers.delete(webContentsId);
	}
	const nonce = randomBytes(16).toString("hex");
	const source = clipboardShimSource(nonce);
	let reinstalling = false;
	/**
	 * Install the program in one document.
	 *
	 * `contextId` is the execution context to install into; without it the page
	 * target's default (main-frame) context is used.
	 */
	const apply = async (contextId?: number): Promise<void> => {
		// `Page.enable` first: the domain carries the navigation and context events
		// this install re-arms itself from, and an agent that was never enabled
		// receives none.
		if (contextId === undefined) {
			await cdp.send(contents, "Page.enable", {});
			await cdp.send(contents, "Runtime.addBinding", {
				name: CLIPBOARD_BINDING,
			});
			await cdp.send(contents, "Page.addScriptToEvaluateOnNewDocument", {
				source,
			});
		}
		await cdp.send(contents, "Runtime.evaluate", {
			expression: source,
			returnByValue: true,
			...(contextId === undefined ? {} : { contextId }),
		});
	};
	/*
	 * ARM EVERY DOCUMENT THAT COMMITS, because the registration alone does not.
	 *
	 * MEASURED on this runtime (Electron 45.1.0, the proof rig): `runImmediately`
	 * is inert, and the `Page.addScriptToEvaluateOnNewDocument` registration covered
	 * the document that was loading when it was made and then no later one — a tab
	 * that had been driven and then navigated came up reporting `native` while a
	 * freshly opened view reported `shimmed`. `Page.frameNavigated` fires BEFORE the
	 * new document's execution context exists, so an evaluate there lands in the
	 * document that is being replaced (measured: the reinstall was accepted and had
	 * no effect). The trigger that works is the CONTEXT event: it is the first
	 * moment a main-world context exists for the new document, and evaluating with
	 * that context's id installs the program into exactly that document.
	 *
	 * The same event covers a same-process CHILD frame, whose default context is
	 * created the same way: its own `writeText` is then served by the same binding.
	 * An out-of-process iframe is a separate target with its own session and is NOT
	 * covered — its write keeps the native refusal.
	 */
	const unsubscribe = cdp.subscribe(webContentsId, (method, params) => {
		if (method === "Runtime.bindingCalled") {
			if (String(params.name ?? "") !== CLIPBOARD_BINDING) return;
			void answerBinding(cdp, contents, nonce, params);
			return;
		}
		if (method !== "Runtime.executionContextCreated") return;
		const context = (params.context ?? {}) as {
			id?: unknown;
			auxData?: { isDefault?: unknown };
		};
		if (context.auxData?.isDefault !== true) return;
		if (typeof context.id !== "number") return;
		if (reinstalling || contents.isDestroyed()) return;
		reinstalling = true;
		void apply(context.id)
			.catch((error: unknown) => {
				// A document that could not be armed keeps the native refusal (the state
				// this host shipped before). Logged, because a silent version of this is
				// indistinguishable from a page that never tried to copy.
				options.log?.(
					`[browser] could not arm the page clipboard write on view ${webContentsId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			})
			.finally(() => {
				reinstalling = false;
			});
	});
	clipboardShimDisposers.set(webContentsId, unsubscribe);
	clipboardShimNonces.set(webContentsId, nonce);
	try {
		await apply();
	} catch (error) {
		unsubscribe();
		clipboardShimDisposers.delete(webContentsId);
		throw error;
	}
}

/**
 * ARM ONE WRITE for a click the HOST is about to dispatch, in the same execution
 * context that click will run in.
 *
 * WHY THIS EXISTS: the host's `click` action dispatches IN THE PAGE
 * (`Runtime.callFunctionOn` + `CLICK_FUNCTION`), not through Chromium's input
 * pipeline, so it carries no user activation — and a page's Copy button therefore
 * took the refusal path and showed the operator exactly the symptom this work
 * exists to remove ("Unable to copy to clipboard"), just triggered by an agent
 * rather than by their own mouse. A trusted pointer press cannot be synthesized
 * into the same call without changing what `click` means for every other page
 * (scroll-into-view, frames, the navigation race), so the click instead MINTS an
 * arm the shim consumes.
 *
 * WHAT THE ARM GRANTS, stated so nobody has to infer it: one clipboard WRITE,
 * inside a `CLIPBOARD_ARM_WINDOW_MS` window, consumed by the first write and
 * cleared by the caller when the click completes — the same capability a real
 * click at that spot would have given the page, and nothing else. The READ path is
 * Chromium's and is untouched (the session grants no permission), so a page cannot
 * turn this into a read.
 *
 * `target` is the resolved node's `objectId` (the click's own context, which is the
 * frame's world the click runs in) or a `contextId` when the caller has one.
 * Returns whether the page accepted the arm: a document that was never armed (no
 * shim, an OOPIF, an old host) simply answers false and the click behaves as it
 * did before.
 */
export async function armHostClipboardWrite(
	cdp: ClipboardShimCdp,
	contents: { id: number; isDestroyed(): boolean },
	webContentsId: number,
	target: { objectId?: string; contextId?: number },
	windowMs: number = CLIPBOARD_ARM_WINDOW_MS,
): Promise<boolean> {
	const nonce = clipboardShimNonces.get(webContentsId);
	if (!nonce || contents.isDestroyed()) return false;
	const params: Record<string, unknown> = {
		functionDeclaration: ARM_FUNCTION,
		arguments: [
			{ value: CLIPBOARD_ARM },
			{ value: nonce },
			{ value: windowMs },
		],
		returnByValue: true,
	};
	try {
		if (target.objectId !== undefined) {
			const reply = await cdp.send<{ result?: { value?: unknown } }>(
				contents,
				"Runtime.callFunctionOn",
				{ ...params, objectId: target.objectId },
			);
			return reply?.result?.value === true;
		}
		if (target.contextId === undefined) return false;
		const reply = await cdp.send<{ result?: { value?: unknown } }>(
			contents,
			"Runtime.evaluate",
			{
				expression: `(${ARM_FUNCTION})(${JSON.stringify(CLIPBOARD_ARM)}, ${JSON.stringify(nonce)}, ${windowMs})`,
				contextId: target.contextId,
				returnByValue: true,
			},
		);
		return reply?.result?.value === true;
	} catch {
		// An arm that cannot be minted is not a failed click: the page keeps the
		// behaviour it had, which is a copy button that refuses.
		return false;
	}
}

/**
 * CLEAR the arm, on the click's own completion.
 *
 * Called whether the click worked, threw or navigated: the shim also expires it by
 * time and consumes it on first use, and this is the third lock — a page cannot
 * hoard a window past the call that justified it.
 */
export async function clearHostClipboardArm(
	cdp: ClipboardShimCdp,
	contents: { id: number; isDestroyed(): boolean },
	webContentsId: number,
	target: { objectId?: string; contextId?: number },
): Promise<void> {
	await armHostClipboardWrite(cdp, contents, webContentsId, target, 0).catch(
		() => undefined,
	);
}

/** The call the host evaluates to arm (or, with a zero window, to clear); the
 * nonce and the window ride as ARGUMENTS, never inside the source text. */
const ARM_FUNCTION = `function (name, nonce, windowMs) {
  const arm = window[name];
  if (typeof arm !== "function") return false;
  try { return arm(nonce, windowMs) === true; } catch (error) { return false; }
}`;

/**
 * One page write, from the binding event to the ack.
 *
 * The order is the contract: write FIRST, ack AFTER, because the page resolves its
 * own promise on the ack and a page that says "Copied" while the clipboard still
 * holds the previous value is worse than one that says it failed. A payload this
 * function cannot trust (wrong nonce, unparseable, oversized) is answered with a
 * failed ack so the page's promise settles rather than hanging.
 */
async function answerBinding(
	cdp: ClipboardShimCdp,
	contents: { id: number; isDestroyed(): boolean },
	nonce: string,
	params: Record<string, unknown>,
): Promise<void> {
	const contextId = params.executionContextId;
	const ack = (id: unknown, ok: boolean): void => {
		if (typeof contextId !== "number" || typeof id !== "number") return;
		// The ack is evaluated in the SAME context that called the binding (the main
		// world of that document), so it lands on the shim instance that is waiting.
		void cdp
			.send(contents, "Runtime.evaluate", {
				expression: `${CLIPBOARD_ACK}(${JSON.stringify(nonce)}, ${id}, ${ok ? "true" : "false"})`,
				contextId,
				returnByValue: true,
			})
			.catch(() => undefined);
	};
	let payload: { nonce?: unknown; id?: unknown; text?: unknown };
	try {
		payload = JSON.parse(String(params.payload ?? ""));
	} catch {
		return;
	}
	if (!payload || payload.nonce !== nonce) return;
	if (typeof payload.id !== "number") return;
	if (typeof payload.text !== "string") {
		ack(payload.id, false);
		return;
	}
	// Re-checked here as well as in the page: the page's copy of the cap is code it
	// can patch, and this is the copy that decides what the process writes.
	if (Buffer.byteLength(payload.text, "utf8") > CLIPBOARD_SHIM_MAX_BYTES) {
		ack(payload.id, false);
		return;
	}
	try {
		// Resolved lazily for the reason `actions/page.ts` states: this module is
		// reachable from node-only test bundles, and an electron import at module
		// scope would make them require the electron binary just to load.
		const { clipboard } = await import("electron");
		await clipboard.writeText(payload.text);
		ack(payload.id, true);
	} catch {
		ack(payload.id, false);
	}
}
