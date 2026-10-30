import { randomUUID } from "node:crypto";
import {
	PASSKEY_NOTICE_TTL_MS,
	type PasskeyCall,
	type PasskeyNoticeView,
} from "../../shared/browser-passkey-notice";

/**
 * The "this page asked for a passkey and may be waiting" notice: what raises it,
 * what it may claim, and what it may never do.
 *
 * Design: docs/design/browser-challenges-and-passkeys.md section 3.6.
 *
 * WHY THIS EXISTS. In the shipped app the platform authenticator is off
 * (`webauthn.ts`: no `keychain-access-groups` entitlement), and a page's
 * `navigator.credentials.create()` / `.get()` then stays pending forever - no
 * prompt, no rejection (measured, section 3.1). Electron 44 exposes no
 * request-start signal to the embedder (its only WebAuthn event,
 * `select-webauthn-account`, fires AFTER a request has several credentials to
 * choose from), so a main-process-only timer has nothing to hang off. The one
 * place a request is observable is the page's own JavaScript, hence a small
 * main-world shim that watches the two calls.
 *
 * THE SHIM IS AN OBSERVER, NEVER A PARTICIPANT. It calls the original function
 * with the original arguments and returns the original promise unchanged: it
 * never rejects, never resolves and never fakes a credential. It does attach one
 * no-op reaction to the promise, but only AFTER `PASSKEY_PENDING_MS`, to learn
 * whether the call has settled: a call that rejected quickly (an IP-literal
 * origin, an abort) must not be announced as stuck. Attaching later rather than
 * at call time keeps the page's own `unhandledrejection` behaviour for every
 * call that settles inside the window; the one residue is a call that stays
 * pending for 3 s+ and then rejects with NO handler the page ever attached,
 * which loses that event - and a page that awaits the call has a handler. A failure must not wear
 * a verdict's clothes, so what the notice asserts is only what main can
 * stand behind: "a request is still pending after a few seconds, and the built-in
 * browser has no passkey provider".
 *
 * THE SIGNAL IS ONE-WAY AND CARRIES NO PAGE-CONTROLLED TEXT. The shim writes one
 * `console.debug` line: a fixed sentinel, a per-FRAME nonce and the literal
 * `create` or `get`. Main receives it through `webContents`' `console-message`
 * event.
 *
 * WHY THE NONCE NAMES THE FRAME INSTEAD OF THE EVENT'S `frame` (measured on
 * Electron 44.3.0, same-process iframe): `console-message`'s `frame` is the TOP
 * frame even when the line was logged by a child frame, so attributing by it
 * would blame the address-bar site for an embedded frame's request. Main
 * therefore injects each frame with its OWN nonce and remembers which
 * `WebFrameMain` it injected; when the line arrives, the nonce selects that frame
 * and its browser-side `origin` (and whether it has a parent) is read at that
 * moment. The origin shown to the user is never a string the page supplied, and
 * one frame cannot signal as another without knowing that frame's nonce (a
 * cross-origin frame cannot read it; a same-origin one is the same origin
 * anyway). Nothing is exposed to the page (no preload, no `contextBridge`, no
 * global): the nonce lives in a closure parameter the page cannot reach, because
 * the wrappers' `toString()` shows the identifier, not the value.
 *
 * WHAT A HOSTILE PAGE CAN AND CANNOT DO. The shim is injected from main at the
 * frame's commit, which normally precedes the page's first script but is not a
 * guarantee (it is an IPC to the renderer racing the parser). So: a page could in
 * principle replace `console.debug` before the shim binds it and read the nonce
 * from the line the shim later emits, or replace
 * `CredentialsContainer.prototype.get` afterwards to evade the notice. The
 * worst the first buys is a forged notice about ITS OWN frame, rate limited, whose
 * one action opens the tab's own current URL through the vetted door. Nothing a
 * page does makes main show text the page wrote, name an origin other than the
 * frame's own, or open a URL other than the tab's, which main reads itself. A line
 * without a nonce main issued for this tab is rejected by an exact-match lookup. At most one
 * notice per tab per `PASSKEY_NOTICE_MIN_GAP_MS` is raised.
 *
 * KNOWN LIMITS: (1) calls made before the shim lands (an inline script that runs
 * at parse time) are not observed; (2) the shim is per frame, so a frame in an
 * out-of-process iframe is reached through its `WebFrameMain` and is observed only
 * if Electron lets main execute in it. Both only lose a courtesy; neither changes
 * what the page's call does.
 *
 * ONE SIDE EFFECT: the console line is also a `logs` entry for the tab (the
 * `logs` action reads the same console stream). It carries a per-tab random
 * nonce and no page data.
 *
 * THE AGENT-VERSUS-HUMAN BOUNDARY. The notice carries who owns the tab as the
 * REGISTRY records it. An agent-driven tab is not hidden from the user's notice,
 * and it is not presented as the user's: the copy says an agent-driven tab asked.
 * A notice for a tab that is not on screen is held and shown when the user
 * activates that tab (the projection is scoped to the active tab, like the
 * transfer row), so a background tab never interrupts what the user is doing.
 */

/** The fixed prefix of the shim's one console line. Chosen to be unlikely to
 * collide with a page's own logging; a collision is harmless because the nonce
 * must also match. */
export const PASSKEY_SIGNAL_SENTINEL = "local-operator:passkey-pending:";

/** How long a call must stay unsettled before the shim signals. Short enough to
 * be a notice rather than a post-mortem, long enough that a request that a
 * provider is actually serving (a touch within a couple of seconds) is not
 * announced as stuck. A measured-hanging request never settles, so the exact
 * value only matters to the ones that would have. */
export const PASSKEY_PENDING_MS = 3_000;

/** Minimum gap between two notices for the SAME tab. A page that calls
 * `create()` in a loop produces one notice, not a stream; the dropped ones are
 * counted so the log can say so. */
export const PASSKEY_NOTICE_MIN_GAP_MS = 30_000;

/**
 * The script main runs in each http(s) frame of a driven view.
 *
 * Built as a string because it runs in the PAGE's world, where none of this
 * module's code exists. The nonce is a parameter of the outer function so the
 * wrappers below refer to it by identifier only.
 *
 * IDEMPOTENT: main runs it on a frame's commit AND on its finish-load (the
 * second is the safety net for a commit-time run that raced the document's
 * creation). The marker on the prototype stops the second run from wrapping the
 * wrapper, which would signal twice per call.
 */
export function passkeyShimSource(nonce: string): string {
	return `(function (nonce, sentinel, delay) {
  var container = typeof CredentialsContainer === "function" ? CredentialsContainer.prototype : null;
  if (!container) return;
  var marker = Symbol.for("local-operator.passkey-notice");
  if (container[marker]) return;
  Object.defineProperty(container, marker, { value: true });
  var emit = console.debug.bind(console);
  var later = setTimeout;
  var observe = Promise.prototype.then;
  var settle = Promise.resolve();
  // The signal fires only for a call STILL PENDING after the delay. The observer is
  // attached at that moment and not at call time on purpose: a handler attached at
  // call time would mark a rejection as handled and silence the page's own
  // unhandledrejection for a call it never awaited. After the delay the page has long
  // since attached (or not) its own handlers, and a settled promise is skipped.
  function check(promise, kind) {
    var done = false;
    var mark = function () { done = true; };
    try { observe.call(promise, mark, mark); } catch (e) { return; }
    // Two microtask hops: an already-settled promise runs mark() first (reactions are
    // FIFO), so by the second hop done is true for it and false for a pending one.
    observe.call(settle, function () {
      observe.call(settle, function () {
        if (!done) { try { emit(sentinel + nonce + ":" + kind); } catch (e) {} }
      });
    });
  }
  ["create", "get"].forEach(function (kind) {
    var original = container[kind];
    if (typeof original !== "function") return;
    var wrapper = {
      [kind]: function () {
        var result = original.apply(this, arguments);
        try {
          var options = arguments[0];
          var passkey = options && typeof options === "object" && "publicKey" in options;
          var conditional = kind === "get" && options && options.mediation === "conditional";
          if (passkey && !conditional && result) later(function () { check(result, kind); }, delay);
        } catch (e) {}
        return result;
      }
    }[kind];
    Object.defineProperty(container, kind, { value: wrapper, writable: true, configurable: true, enumerable: true });
  });
})(${JSON.stringify(nonce)}, ${JSON.stringify(PASSKEY_SIGNAL_SENTINEL)}, ${PASSKEY_PENDING_MS});`;
}

/** Frames remembered per tab. A page can create frames without bound, so the
 * oldest entries are evicted; an evicted frame simply stops being able to raise
 * a notice (it is a courtesy, and the cap is what bounds main's memory). */
const MAX_FRAMES_PER_TAB = 64;

/**
 * The call a console line announces and the nonce it carries, or null when the
 * line is not shaped like a signal. Exact-match on the whole string (a prefix
 * match would let a page smuggle extra text past the check); WHICH frame the
 * nonce belongs to is the registry's question, not the parser's.
 */
export function parsePasskeySignal(
	message: unknown,
): { nonce: string; kind: PasskeyCall } | null {
	if (typeof message !== "string") return null;
	if (!message.startsWith(PASSKEY_SIGNAL_SENTINEL)) return null;
	const rest = message.slice(PASSKEY_SIGNAL_SENTINEL.length);
	const colon = rest.lastIndexOf(":");
	if (colon <= 0) return null;
	const kind = rest.slice(colon + 1);
	const nonce = rest.slice(0, colon);
	if (kind !== "create" && kind !== "get") return null;
	if (!NONCE_SHAPE.test(nonce)) return null;
	return { nonce, kind };
}

/** A `randomUUID()`, which is all main ever issues. */
const NONCE_SHAPE = /^[0-9a-f-]{36}$/;

/** What main can read about a frame, browser-side, at the moment of a signal. */
export interface PasskeyFrameFacts {
	origin: unknown;
	/** The frame has a parent (it is embedded in another document). */
	embedded: boolean;
}

export interface PasskeyNoticesOptions {
	now: () => number;
	log: (message: string) => void;
	/** The tab's owner from the registry, or null when the tab no longer exists. */
	ownerOf: (tabId: number) => "user" | "agent" | null;
	/** The live facts of the frame behind `frameKey`, or null when it is gone.
	 * Read at signal time, so a frame that navigated is named by where it IS. */
	frameFacts: (frameKey: string) => PasskeyFrameFacts | null;
}

interface TabState {
	/** frameKey -> nonce, in insertion order (oldest first, for eviction). */
	frames: Map<string, string>;
	notice: PasskeyNoticeView | null;
	lastRaisedAt: number | null;
	suppressed: number;
}

/**
 * Per-tab notice state. Pure of Electron: the wiring feeds it the console line
 * and answers frame lookups, and reads a view back.
 */
export class PasskeyNotices {
	private readonly tabs = new Map<number, TabState>();
	/** nonce -> who it was issued to. The one lookup a signal goes through. */
	private readonly issued = new Map<
		string,
		{ tabId: number; frameKey: string }
	>();
	private readonly options: PasskeyNoticesOptions;

	constructor(options: PasskeyNoticesOptions) {
		this.options = options;
	}

	private stateFor(tabId: number): TabState {
		let state = this.tabs.get(tabId);
		if (!state) {
			state = {
				frames: new Map(),
				notice: null,
				lastRaisedAt: null,
				suppressed: 0,
			};
			this.tabs.set(tabId, state);
		}
		return state;
	}

	/** The nonce for one frame of a tab, minted on first use and stable for that
	 * frame (the shim's idempotence marker means a second injection keeps the first
	 * run's nonce, so this must hand back the same one). */
	nonceFor(tabId: number, frameKey: string): string {
		const state = this.stateFor(tabId);
		const existing = state.frames.get(frameKey);
		if (existing) return existing;
		const nonce = randomUUID();
		state.frames.set(frameKey, nonce);
		this.issued.set(nonce, { tabId, frameKey });
		while (state.frames.size > MAX_FRAMES_PER_TAB) {
			const oldest = state.frames.entries().next().value;
			if (!oldest) break;
			state.frames.delete(oldest[0]);
			this.issued.delete(oldest[1]);
		}
		return nonce;
	}

	/**
	 * Take one console line from `tabId`'s contents.
	 *
	 * The frame is the one the NONCE was issued to, never the event's own `frame`
	 * (see the header). Its origin must be http(s): an opaque origin (`"null"`, a
	 * sandboxed frame) cannot be named honestly to the user, so the notice is not
	 * raised rather than raised with an invented site. Returns whether a notice
	 * was raised.
	 */
	observe(tabId: number, message: unknown): boolean {
		const signal = parsePasskeySignal(message);
		if (!signal) return false;
		const owner = this.issued.get(signal.nonce);
		if (!owner || owner.tabId !== tabId) return false;
		const state = this.tabs.get(tabId);
		if (!state) return false;
		const frame = this.options.frameFacts(owner.frameKey);
		if (!frame) return false;
		const kind = signal.kind;
		const origin = httpOrigin(frame.origin);
		if (!origin) {
			this.options.log(
				`[browser] tab ${tabId} signalled a pending passkey ${kind} from a frame with no nameable origin; no notice`,
			);
			return false;
		}
		const ownerKind = this.options.ownerOf(tabId);
		if (!ownerKind) return false;
		const now = this.options.now();
		if (
			state.lastRaisedAt !== null &&
			now - state.lastRaisedAt < PASSKEY_NOTICE_MIN_GAP_MS
		) {
			state.suppressed += 1;
			return false;
		}
		state.notice = {
			tabId,
			origin,
			embedded: frame.embedded,
			kind,
			at: now,
			ownerKind,
			suppressed: state.suppressed,
		};
		state.lastRaisedAt = now;
		state.suppressed = 0;
		this.options.log(
			`[browser] ${ownerKind === "agent" ? "agent-driven " : ""}tab ${tabId} has a passkey ${kind} pending from ${frame.embedded ? "an embedded frame at " : ""}${origin}; notice raised`,
		);
		return true;
	}

	/** The notice to show for `tabId` now, or null (none raised, or expired). */
	viewFor(tabId: number): PasskeyNoticeView | null {
		const notice = this.tabs.get(tabId)?.notice ?? null;
		if (!notice) return null;
		if (this.options.now() - notice.at > PASSKEY_NOTICE_TTL_MS) return null;
		return notice;
	}

	/** The user dismissed notice `at`. A stale `at` (the notice was replaced) is
	 * ignored, so a late click cannot clear a newer notice. */
	dismiss(tabId: number, at: number): boolean {
		const state = this.tabs.get(tabId);
		if (!state?.notice || state.notice.at !== at) return false;
		state.notice = null;
		return true;
	}

	/** A new top-level document: what the old one asked is not this page's. The
	 * rate-limit clock is kept, so a page that reloads itself in a loop does not
	 * buy a fresh notice per load. */
	clearNotice(tabId: number): void {
		const state = this.tabs.get(tabId);
		if (state) state.notice = null;
	}

	forget(tabId: number): void {
		const state = this.tabs.get(tabId);
		if (state)
			for (const nonce of state.frames.values()) this.issued.delete(nonce);
		this.tabs.delete(tabId);
	}
}

/** `scheme://host[:port]` for an http(s) origin, else null. */
export function httpOrigin(value: unknown): string | null {
	if (typeof value !== "string") return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	return url.origin;
}

/** What the open-in-system-browser click answers: the door's own outcome, or a
 * refusal that only this module can give (a stale notice, a tab with no page). */
export type PasskeyOpenOutcome = { ok: true } | { ok: false; reason: string };

/**
 * The user's one-click "Open in system browser".
 *
 * WHAT IS OPENED IS READ HERE, NOT SENT: the renderer supplies a tab id and the
 * notice's `at`; the URL is the tab's own current top-level URL, read from the
 * webContents main holds. A compromised or confused renderer therefore cannot
 * point this at an arbitrary URL, and a click on a notice that has since been
 * replaced, dismissed or aged out is refused instead of opening whatever the tab
 * shows now. `openExternal` MUST be the app's vetted door (`openVettedExternal`
 * in `window-guards.ts`: http(s)/mailto only, no credentials, no loopback or
 * private-network host) - this module deliberately does not vet a second time,
 * because a second verdict is a second place for the rules to drift.
 */
export async function openPasskeyNoticeInSystemBrowser(deps: {
	notices: PasskeyNotices;
	tabId: number;
	at: number;
	currentUrl: (tabId: number) => string | null;
	openExternal: (url: string) => Promise<PasskeyOpenOutcome>;
	log: (message: string) => void;
}): Promise<PasskeyOpenOutcome> {
	const notice = deps.notices.viewFor(deps.tabId);
	if (!notice || notice.at !== deps.at) {
		return { ok: false, reason: "that notice is no longer current" };
	}
	const url = deps.currentUrl(deps.tabId);
	if (!url) return { ok: false, reason: "the tab has no page to open" };
	deps.log(
		`[browser] passkey notice on tab ${deps.tabId}: handing ${url} to the system browser at the user's request`,
	);
	return deps.openExternal(url);
}
