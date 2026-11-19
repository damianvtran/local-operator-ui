/**
 * The page-side clipboard WRITE: a dumb transport installed by the host into a
 * driven view's main world, and the HOST-side gate that decides every write.
 *
 * THE WORST CASE, stated once so no later reader has to infer it: **a page in a
 * driven view cannot write the clipboard without either a genuine user activation
 * in its own frame or a 2 s host-issued arm from an agent click; it can never
 * read it.**
 *
 * WHAT THIS REPLACED, and why the first design was wrong rather than incomplete.
 * A page's own Copy button needs `navigator.clipboard.writeText` to resolve, and
 * on this runtime (Electron 45.1.0; measured 2026-11-06, built dev app, headless,
 * a real driven tab) Chromium gates that write on ONE content setting that
 * Electron reports as `clipboard-read` — so the permission system cannot buy the
 * write without also letting every page READ the user's clipboard (measured: the
 * page read back the text it had written). The write is therefore served by the
 * host. The first attempt put the whole mechanism in the page's MAIN WORLD: a
 * per-tab nonce in a page-visible global, a gesture check reading
 * `navigator.userActivation` from a world page script can patch, and an arm
 * window measured with the page's own `Date.now`. Every one of those is
 * page-controllable, so a hostile page could mint its own credential, freeze the
 * clock, or patch the activation getter — review round 1 reproduced exactly that
 * (`BEFORE` → `HOSTILE-PAGE-DROVE-THE-BINDING`).
 *
 * THE RULE THAT FALLS OUT: **the main world is a transport, never an authority.**
 * It holds no credential, judges nothing, and its only job is to carry `(id,
 * text)` to the host and settle the page's promise on the host's answer. Every
 * decision — is there real user activation, is there a live host arm — is made in
 * the MAIN PROCESS against the ISOLATED world, which page script cannot patch.
 *
 * WHERE THE AUTHORITY LIVES, concretely, on one binding event:
 *
 * 1. `Runtime.bindingCalled` names the `executionContextId` the call came from.
 * 2. That id maps to a frame from this host's own `Runtime.executionContextCreated`
 *    bookkeeping — so the frame is the host's fact, not the page's claim.
 * 3. `Page.createIsolatedWorld` for that frame, then `Runtime.evaluate`
 *    `navigator.userActivation.isActive` **with that isolated context's id**. An
 *    isolated world shares the DOM but not the JavaScript heap, so page script
 *    cannot have replaced that `Navigator`, and the activation state it reads is
 *    the frame's own.
 * 4. If that is false, a live host-minted ARM for that frame (an agent's `click`,
 *    see `armHostClipboardWrite`) admits the write. The arm is a
 *    `{frameId, expiresAt}` record in main memory, timed by the host's monotonic
 *    clock, single-use, and cleared when the click returns.
 * 5. Only then is the text written with Electron's `clipboard.writeText`, and only
 *    then does the page hear `ok`.
 *
 * WHAT A PAGE CAN STILL DO TO ITSELF: call the binding directly (it is a
 * page-visible function — an injected binding has to be), call the ack with any
 * id, or patch its own `userActivation`/`Date.now`/`JSON.stringify`. None of it
 * helps: the gate is host-side, so a direct call is judged by the same
 * activation-or-arm rule and refused, and forging an ack lies to the page's own
 * promise and to nothing else.
 *
 * COVERAGE, stated rather than implied: the program is INSTALLED into the main
 * frame and every same-process child frame of the driven target (a document is
 * covered wherever its context appears), but a WRITE is admitted from the MAIN
 * frame only. The reason is measured, not cautious: on this runtime a same-process
 * child frame's isolated-world activation reading reported the TOP frame's
 * activation (2026-11-06: after a trusted press in the main document, the child's
 * write was admitted on "user activation" while the child itself had none), and an
 * ambiguous reading is not a control. A child frame is therefore refused, named in
 * the app log, and the page sees the native `NotAllowedError`. An out-of-process
 * iframe is a separate target with its own session, which this install never
 * enters.
 *
 * WHAT IT NEVER DOES: log, echo or measure the payload. The text is validated,
 * written and dropped; the host logs a refusal REASON and a size, never bytes.
 */

/** The CDP binding the page calls; also the page-visible global's name. */
export const CLIPBOARD_BINDING = "__localOperatorClipboardWrite";

/** The global the host calls back with the write's outcome. */
export const CLIPBOARD_ACK = "__localOperatorClipboardAck";

/** The idempotency sentinel: set by the program, non-writable by the page. */
export const CLIPBOARD_SENTINEL = "__localOperatorClipboardShim";

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

/** The separator between the ack id and the text in one binding payload.
 *
 * A NEWLINE, because the id is an integer: the host splits on the FIRST one and
 * everything after it is the text verbatim, newlines included. Chosen so the shim
 * can build its one argument with string concatenation alone — no `JSON.stringify`
 * to capture, and therefore nothing in the payload path for a page to swap.
 */
const PAYLOAD_SEPARATOR = "\n";

/**
 * The program, as one committed string (a bytecode build turns anything handed to
 * `Function.prototype.toString()` into a dummy zero-width source, which is the
 * trap that already broke `select`).
 *
 * It interpolates ONE value, and it is data rather than a secret: the names, the
 * cap and the timeout, as a JSON literal emitted by the HOST. `JSON.stringify` is
 * used here, at install time, in main — the program itself never calls it.
 */
export function clipboardShimSource(): string {
	const config = JSON.stringify({
		binding: CLIPBOARD_BINDING,
		ack: CLIPBOARD_ACK,
		sentinel: CLIPBOARD_SENTINEL,
		maxBytes: CLIPBOARD_SHIM_MAX_BYTES,
		timeoutMs: CLIPBOARD_ACK_TIMEOUT_MS,
	});
	return `(function (config) {
  "use strict";
  var clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return;

  // IDEMPOTENT BY A LOCKED SENTINEL: a second install is a no-op, and the page
  // cannot flip the flag to force one (a re-install would wrap the wrapper, and a
  // page that could clear it could make any later install believe this document
  // was never covered).
  if (window[config.sentinel] === true) return;
  try {
    Object.defineProperty(window, config.sentinel, {
      value: true,
      configurable: false,
      writable: false,
      // Not even enumerable: a page walking globalThis keys learns nothing about
      // whether this document is covered.
      enumerable: false,
    });
  } catch (error) {
    // Something non-configurable already owns the name. Leave the document alone
    // rather than install a second wrapper whose sentinel we cannot own.
    return;
  }

  var nativeWriteText = clipboard.writeText.bind(clipboard);
  var nativeWrite = typeof clipboard.write === "function" ? clipboard.write.bind(clipboard) : null;
  var nativeQuery = typeof navigator.permissions?.query === "function" ? navigator.permissions.query.bind(navigator.permissions) : null;
  var pending = new Map();
  var nextId = 1;

  function refuses(message, name) {
    return Promise.reject(new DOMException(message, name || "NotAllowedError"));
  }

  // The host calls this through CDP, in THIS world, with an id it was given. A
  // page may call it too, with any id it likes: that settles the page's own
  // promise and changes nothing else, because whether a write HAPPENED was
  // decided in main before this was ever called.
  window[config.ack] = function (id, ok) {
    var settled = pending.get(id);
    if (!settled) return;
    pending.delete(id);
    clearTimeout(settled.timer);
    if (ok) settled.resolve();
    else settled.reject(new DOMException("the host did not allow the clipboard write", "NotAllowedError"));
  };

  // UTF-8 length without TextEncoder: the host re-measures with Buffer.byteLength
  // before it writes, so this is only the fast pre-check the page sees first.
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

  /*
   * NO GESTURE JUDGEMENT HERE, deliberately. This world's
   * navigator.userActivation, Date.now and JSON.stringify are all page-patchable,
   * so a check made here is not a control. The host asks the ISOLATED world
   * instead; this function's only job is to carry the bytes and settle the
   * promise on the host's answer.
   */
  function writeThroughHost(text) {
    var size = sizeOf(text);
    if (size > config.maxBytes) {
      return refuses("the text is too large to copy (" + size + " bytes)", "QuotaExceededError");
    }
    var send = window[config.binding];
    if (typeof send !== "function") {
      // No binding means no host in this document (an older host, a world the
      // program reached before the binding existed): keep the native behaviour.
      return nativeWriteText(text);
    }
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new DOMException("the host did not confirm the clipboard write", "NotAllowedError"));
      }, config.timeoutMs);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        // ONE argument, by concatenation: the id, a newline, the text. No JSON in
        // the payload path, so there is no captured helper for a page to swap.
        send(id + ${JSON.stringify(PAYLOAD_SEPARATOR)} + String(text));
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
          var list = Array.isArray(items) ? items : [items];
          var first = list[0];
          // TEXT ONLY. Anything else (an image, an unknown type) falls through to
          // the native path, which fails exactly as it does today: the host will
          // not be talked into copying bytes it never inspected.
          if (list.length !== 1 || !first || typeof first.getType !== "function") {
            return nativeWrite(items);
          }
          var types = first.types;
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
          var name = descriptor && descriptor.name;
          // REPORTED CAPABILITY, NOT A CHROMIUM PERMISSION: pages feature-detect a
          // write with this name before attempting one, and the honest answer for a
          // document where the write above is installed is "granted" — the host
          // decides each write. The READ name is deliberately untouched, so it
          // keeps answering the truth (denied).
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

/** One view's host-side bookkeeping. Nothing here is page-reachable. */
interface ViewState {
	dispose: () => void;
	/** `executionContextId` → the frame that context belongs to, from the host's
	 * own `Runtime.executionContextCreated` events. This is what turns a binding
	 * event's context id into a FRAME the host can verify. */
	contexts: Map<number, { frameId: string; isDefault: boolean }>;
	/** frameId → the isolated world's context id, for the activation question.
	 * Cached because `Page.createIsolatedWorld` is per frame and repeated calls
	 * for the same world name are wasted round trips. */
	isolated: Map<string, number>;
	/** The target's main frame, learned from `Page.getFrameTree` and refreshed on
	 * each main-frame commit. */
	mainFrameId?: string;
	/** The live arm: a frame and the monotonic instant it stops counting. */
	arm?: { frameId: string; expiresAt: number };
	log?: (message: string) => void;
}

const views = new Map<number, ViewState>();

/** The host's monotonic clock. `Date.now` is page-patchable in the page's world
 * and irrelevant here; in main it is monotonic time, not wall time, that a window
 * should be measured with — a system clock change must not extend an arm. */
const hostNow = (): number => performance.now();

/**
 * Install the transport into one view and wire its binding to the host gate.
 *
 * CALLED FROM `cdp.attach` — every attach, not once per tab: a re-attach is a
 * fresh debugger session whose `Page.addScriptToEvaluateOnNewDocument`
 * registrations are gone, and the transport has to be in every document the tab
 * loads.
 */
export async function installClipboardShim(
	cdp: ClipboardShimCdp,
	contents: { id: number; isDestroyed(): boolean },
	webContentsId: number,
	options: { log?: (message: string) => void } = {},
): Promise<void> {
	const previous = views.get(webContentsId);
	if (previous) {
		previous.dispose();
		views.delete(webContentsId);
	}
	const source = clipboardShimSource();
	const state: ViewState = {
		dispose: () => undefined,
		contexts: new Map(),
		isolated: new Map(),
		log: options.log,
	};
	views.set(webContentsId, state);

	/** Install the program in one document, by execution context. */
	const apply = async (contextId?: number): Promise<void> => {
		if (contextId === undefined) {
			// `Page.enable` first: the domain carries the navigation and context events
			// this install re-arms itself from, and a target that was never enabled
			// receives none.
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

	/** Learn (or re-learn) the main frame. Best-effort: an arm can also be minted
	 * with an explicit frame id, which is what `click` does when it knows it. */
	const refreshMainFrame = async (): Promise<void> => {
		try {
			const tree = await cdp.send<{
				frameTree?: { frame?: { id?: string } };
			}>(contents, "Page.getFrameTree", {});
			const id = tree?.frameTree?.frame?.id;
			if (typeof id === "string" && id) state.mainFrameId = id;
		} catch {
			// No tree, no main-frame fact; arm calls supply their own frame.
		}
	};

	let reinstalling = false;
	/*
	 * INSTALL IN EVERY DOCUMENT THAT COMMITS, because the registration alone does
	 * not.
	 *
	 * MEASURED on this runtime (Electron 45.1.0, the proof rig):
	 * `runImmediately` is inert, and the `Page.addScriptToEvaluateOnNewDocument`
	 * registration covered the document that was loading when it was made and then
	 * no later one — a tab that had been driven and then navigated came up
	 * reporting `native` while a freshly opened view reported `shimmed`.
	 * `Page.frameNavigated` fires BEFORE the new document's execution context
	 * exists, so an evaluate there lands in the document being replaced (measured:
	 * the reinstall was accepted and had no effect). The trigger that works is the
	 * CONTEXT event: it is the first moment a main-world context exists for the new
	 * document, and evaluating with that context's id installs into exactly that
	 * document. The same event covers a same-process child frame.
	 */
	state.dispose = cdp.subscribe(webContentsId, (method, params) => {
		if (method === "Runtime.bindingCalled") {
			if (String(params.name ?? "") !== CLIPBOARD_BINDING) return;
			void answerBinding(cdp, contents, webContentsId, state, params);
			return;
		}
		if (method === "Runtime.executionContextCreated") {
			const context = (params.context ?? {}) as {
				id?: unknown;
				auxData?: { frameId?: unknown; isDefault?: unknown };
			};
			if (typeof context.id !== "number") return;
			const frameId = context.auxData?.frameId;
			if (typeof frameId === "string") {
				state.contexts.set(context.id, {
					frameId,
					isDefault: context.auxData?.isDefault === true,
				});
			}
			if (context.auxData?.isDefault !== true) return;
			if (reinstalling || contents.isDestroyed()) return;
			reinstalling = true;
			void apply(context.id)
				.catch((error: unknown) => {
					// A document that could not be armed keeps the native refusal (the state
					// this host shipped before). Logged, because a silent version of this is
					// indistinguishable from a page that never tried to copy.
					options.log?.(
						`[browser] could not install the page clipboard write on view ${webContentsId}: ${error instanceof Error ? error.message : String(error)}`,
					);
				})
				.finally(() => {
					reinstalling = false;
				});
			return;
		}
		if (method === "Runtime.executionContextDestroyed") {
			const id = params.executionContextId;
			if (typeof id === "number") {
				const known = state.contexts.get(id);
				state.contexts.delete(id);
				if (known) state.isolated.delete(known.frameId);
			}
			return;
		}
		if (method === "Runtime.executionContextsCleared") {
			state.contexts.clear();
			state.isolated.clear();
			return;
		}
		if (method === "Page.frameNavigated") {
			const frame = (params.frame ?? {}) as {
				id?: unknown;
				parentId?: unknown;
			};
			// The main frame's id is the one a click with no frame of its own arms.
			if (frame.parentId === undefined && typeof frame.id === "string") {
				state.mainFrameId = frame.id;
			}
		}
	});
	try {
		await apply();
		await refreshMainFrame();
	} catch (error) {
		state.dispose();
		views.delete(webContentsId);
		throw error;
	}
}

/**
 * The frame a `click` should arm, when the caller did not name one.
 *
 * `undefined` means this host has no main-frame fact for that view yet — an arm
 * that names no frame is a no-op rather than a wildcard, because an arm for "any
 * frame" is exactly the borrowed activation the per-frame rule forbids.
 */
export function mainFrameOf(webContentsId: number): string | undefined {
	return views.get(webContentsId)?.mainFrameId;
}

/**
 * ARM ONE WRITE for a click the HOST is about to dispatch.
 *
 * WHY THIS EXISTS: the host's `click` dispatches IN THE PAGE
 * (`Runtime.callFunctionOn` + `CLICK_FUNCTION`), not through Chromium's input
 * pipeline, so it carries no user activation — and a page's Copy button therefore
 * took the refusal path and showed the operator exactly the symptom this work
 * exists to remove ("Unable to copy to clipboard"), triggered by an agent rather
 * than by their own mouse.
 *
 * WHAT THE ARM IS: a record in MAIN MEMORY, `{frameId, expiresAt}`, timed by the
 * host's monotonic clock — nothing in the page, so there is no global to read, no
 * clock to freeze and no credential to harvest. It admits ONE write for THAT
 * frame, is consumed by the first accepted write, and is cleared when the click
 * returns. What it grants is what a real click at that spot would have granted:
 * one clipboard WRITE inside the window, never a read (reading is Chromium's
 * permission, which this session denies).
 */
export function armHostClipboardWrite(
	webContentsId: number,
	frameId: string | undefined,
	windowMs: number = CLIPBOARD_ARM_WINDOW_MS,
): boolean {
	const state = views.get(webContentsId);
	if (!state) return false;
	const frame = frameId ?? state.mainFrameId;
	if (!frame) return false;
	state.arm = { frameId: frame, expiresAt: hostNow() + windowMs };
	return true;
}

/** CLEAR the arm, on the click's own completion: a page cannot hoard a window
 * past the call that justified it. */
export function clearHostClipboardArm(webContentsId: number): void {
	const state = views.get(webContentsId);
	if (state) state.arm = undefined;
}

/**
 * Whether this write may proceed, and the reason when it may not.
 *
 * The activation question is asked of the ISOLATED world: `Page.createIsolatedWorld`
 * for the frame the binding event came from, then `Runtime.evaluate` with THAT
 * context's id. Page script cannot patch an isolated world's `Navigator`, so this
 * is the one reading of `userActivation` that is not page-controlled — which is
 * also why the shim itself no longer asks.
 */
async function writeVerdict(
	cdp: ClipboardShimCdp,
	contents: { id: number; isDestroyed(): boolean },
	state: ViewState,
	frameId: string,
): Promise<{ allowed: boolean; reason: string }> {
	let activated = false;
	try {
		const contextId = await isolatedContextFor(cdp, contents, state, frameId);
		const reply = await cdp.send<{ result?: { value?: unknown } }>(
			contents,
			"Runtime.evaluate",
			{
				expression: "navigator.userActivation.isActive === true",
				contextId,
				returnByValue: true,
			},
		);
		activated = reply?.result?.value === true;
	} catch (error) {
		// No isolated reading means no activation FACT, and an unverifiable write is
		// refused rather than waved through.
		return {
			allowed: false,
			reason: `could not verify user activation (${error instanceof Error ? error.message : String(error)})`,
		};
	}
	if (activated) {
		// An accepted write spends the arm too: a click's window must not go on to
		// authorise a later write the page schedules for itself.
		clearHostClipboardArmView(state);
		return { allowed: true, reason: "user activation" };
	}
	const arm = state.arm;
	if (arm && arm.frameId === frameId && arm.expiresAt > hostNow()) {
		clearHostClipboardArmView(state);
		return { allowed: true, reason: "agent click arm" };
	}
	return {
		allowed: false,
		reason: arm
			? arm.frameId === frameId
				? "the agent-click arm has expired"
				: "the agent-click arm was minted for another frame"
			: "no user activation in this frame and no agent-click arm",
	};
}

function clearHostClipboardArmView(state: ViewState): void {
	state.arm = undefined;
}

/** The isolated world's context id for a frame, cached and re-created when the
 * document it belonged to is gone. */
async function isolatedContextFor(
	cdp: ClipboardShimCdp,
	contents: { id: number; isDestroyed(): boolean },
	state: ViewState,
	frameId: string,
): Promise<number> {
	const cached = state.isolated.get(frameId);
	if (cached !== undefined) return cached;
	const created = await cdp.send<{ executionContextId?: number }>(
		contents,
		"Page.createIsolatedWorld",
		{
			frameId,
			// A NAME, not a secret: the world is identified by frame and name, and
			// nothing about this gate depends on the name being unforgeable.
			worldName: "local-operator-clipboard",
		},
	);
	const contextId = created?.executionContextId;
	if (typeof contextId !== "number") {
		throw new Error("Page.createIsolatedWorld returned no executionContextId");
	}
	state.isolated.set(frameId, contextId);
	return contextId;
}

/**
 * One page write, from the binding event to the ack.
 *
 * The order is the contract: DECIDE, WRITE, then ACK — the page resolves its own
 * promise on the ack, and a page that says "Copied" while the clipboard still
 * holds the previous value is worse than one that says it failed. Every refusal
 * settles the page's promise too, so a page never hangs waiting.
 */
async function answerBinding(
	cdp: ClipboardShimCdp,
	contents: { id: number; isDestroyed(): boolean },
	webContentsId: number,
	state: ViewState,
	params: Record<string, unknown>,
): Promise<void> {
	const contextId = params.executionContextId;
	const ack = (id: number, ok: boolean): void => {
		if (typeof contextId !== "number") return;
		// The ack is evaluated in the SAME context that called the binding (the main
		// world of that document), so it lands on the instance that is waiting. It
		// carries no secret: a page forging one lies to itself.
		void cdp
			.send(contents, "Runtime.evaluate", {
				expression: `${CLIPBOARD_ACK}(${id}, ${ok ? "true" : "false"})`,
				contextId,
				returnByValue: true,
			})
			.catch(() => undefined);
	};
	const raw = String(params.payload ?? "");
	const splitAt = raw.indexOf(PAYLOAD_SEPARATOR);
	if (splitAt <= 0) return;
	const id = Number(raw.slice(0, splitAt));
	if (!Number.isSafeInteger(id)) return;
	const text = raw.slice(splitAt + PAYLOAD_SEPARATOR.length);

	// THE FRAME IS THE HOST'S FACT, not the page's claim: it comes from the context
	// bookkeeping built out of `Runtime.executionContextCreated`.
	const known =
		typeof contextId === "number" ? state.contexts.get(contextId) : undefined;
	if (!known) {
		// A context this host never saw created (or one already destroyed). There is
		// no frame to verify, so there is nothing to admit.
		state.log?.(
			`[browser] refused a page clipboard write on view ${webContentsId}: unknown execution context`,
		);
		ack(id, false);
		return;
	}
	// MAIN FRAME ONLY, and this is a MEASURED narrowing rather than caution.
	//
	// The per-frame design asked the isolated world of the frame the binding came
	// from, which is correct in principle — but on this runtime (Electron 45.1.0,
	// measured 2026-11-06 in the proof rig) a SAME-PROCESS CHILD frame's isolated
	// reading reported the TOP frame's activation: after a trusted press in the main
	// document, the child's write was admitted with reason "user activation" while
	// the child itself had none. Reassuring though it would be to call that a
	// propagation rule, an ambiguous reading is not a control, and the constraint is
	// explicit that a child frame must never borrow the top frame's activation. So a
	// non-main frame is refused outright: the host names it in the log and the page
	// gets the same NotAllowedError the native API would give it.
	//
	// WHAT THIS COSTS, stated: a Copy button inside an iframe (a same-process one; an
	// OOPIF was never covered) does not work through the shim. That is a narrowing of
	// the previous behaviour on this host, where no page could write at all, so it is
	// strictly better than what shipped — and a page whose copy lives in a frame
	// still has the `copy` action, which addresses elements by selector.
	if (state.mainFrameId !== undefined && known.frameId !== state.mainFrameId) {
		state.log?.(
			`[browser] refused a page clipboard write on view ${webContentsId}: frame ${known.frameId} is not the main frame (main-frame-only by design)`,
		);
		ack(id, false);
		return;
	}
	const verdict = await writeVerdict(cdp, contents, state, known.frameId);
	if (!verdict.allowed) {
		// The REASON travels to the app log and never the bytes: a copy that stops
		// working has to be visible without the value being.
		state.log?.(
			`[browser] refused a page clipboard write on view ${webContentsId} (frame ${known.frameId}): ${verdict.reason}`,
		);
		ack(id, false);
		return;
	}
	// Re-checked here as well as in the page: the page's copy of the cap is code it
	// can patch, and this is the copy that decides what the process writes.
	if (Buffer.byteLength(text, "utf8") > CLIPBOARD_SHIM_MAX_BYTES) {
		state.log?.(
			`[browser] refused a page clipboard write on view ${webContentsId}: over the ${CLIPBOARD_SHIM_MAX_BYTES}-byte cap`,
		);
		ack(id, false);
		return;
	}
	try {
		// Stay lazy for node-only rigs, but use CommonJS: the packaged bytecode
		// loader has no vm.Script dynamic-import callback (see actions/page.ts).
		const { clipboard } = require("electron") as typeof import("electron");
		await clipboard.writeText(text);
		state.log?.(
			`[browser] wrote a page clipboard copy on view ${webContentsId} (frame ${known.frameId}, ${verdict.reason})`,
		);
		ack(id, true);
	} catch (error) {
		state.log?.(
			`[browser] the clipboard refused a page write on view ${webContentsId}: ${error instanceof Error ? error.message : String(error)}`,
		);
		ack(id, false);
	}
}

/** Drop a view's install. Exported for tests and for a host that stops. */
export function forgetClipboardShim(webContentsId: number): void {
	const state = views.get(webContentsId);
	if (!state) return;
	state.dispose();
	views.delete(webContentsId);
}
