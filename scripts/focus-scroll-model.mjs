/**
 * The focusing steps' SCROLL half, modelled for a document with no layout engine.
 *
 * WHY THIS EXISTS. `HTMLElement.focus()` is specified to move focus AND to scroll
 * the element into view unless `preventScroll` is set - "If
 * options['preventScroll'] is false, then scroll a target into view given this,
 * 'auto', 'center', and 'center'" (HTML Standard, `focus()`, emphasis on the
 * centres) - and jsdom implements the MOVE with no layout at all: its `focus()`
 * never scrolls, so a plain `focus()` and a `focus({preventScroll: true})` are
 * indistinguishable there. That pair is the whole difference the projects
 * quick-send strip's fix turns on ("opening a project scrolls the page down to
 * its composer"), so a suite that asserts about it without a model is asserting
 * nothing: the assertion passes on both spellings and would keep passing if the
 * fix were reverted.
 *
 * WHAT IT MODELS, AND WHAT IT CANNOT. Every call is recorded with the element,
 * the options dictionary the call actually carried, the container it would move
 * and whether the scroll was prevented; and a non-prevented call moves that
 * container's `scrollTop`. It does NOT model the geometry: with no layout engine
 * the "center" the spec asks for cannot be computed, so a plain focus moves the
 * container by a FIXED NON-ZERO delta instead of to a centred offset. That is
 * enough for the property these suites assert - movement versus no movement - and
 * it is a delta rather than a fixed target on purpose: a container that is
 * ALREADY scrolled still moves, which is what lets a case discriminate where the
 * regression would be a plain focus landing on an already-scrolled page (the
 * post-send handback). It also models the NEAREST scroll container rather than
 * the spec's whole ancestor chain, and a container is recognised by its computed
 * `overflow-x`/`overflow-y` - so a jsdom document, which applies no stylesheet,
 * sees a Tailwind `overflow-y-auto` class as no overflow at all: pass the
 * container as `scrollHost` when the rig knows which one it means, or give it the
 * inline style.
 *
 * The live Chromium geometry - that the composer is below the fold, that a
 * centre actually moves the page, and by how much - is the harness slice's
 * half (frames plus measured scroll offsets); this file only makes the
 * difference between the two spellings answerable inside jsdom.
 */

/** How far a non-prevented focus moves the nearest scroll container. */
const FOCUS_SCROLL_DELTA = 40;

const isScrollContainer = (window, node) => {
	const style = window.getComputedStyle(node);
	return (
		/^(auto|scroll|overlay)$/.test(style.overflowY) ||
		/^(auto|scroll|overlay)$/.test(style.overflowX)
	);
};

/**
 * Install the model over `window`'s element prototype.
 *
 * `scrollHost` is the container a call is attributed to when no ancestor
 * declares overflow - Tailwind's `overflow-y-auto` is a class, and a document
 * with no stylesheet resolves no classes, so most rigs need this. The returned
 * `calls` records `{ element, options, scroller, prevented, scrollTop }` per
 * call, in order; `restore` puts the prototype back (call it from `after`, or a
 * later file that shares the realm inherits a lying `focus`).
 */
export function installFocusScrollModel(window, { scrollHost = null } = {}) {
	const proto = window.HTMLElement.prototype;
	const original = proto.focus;
	const calls = [];
	const nearestScroller = (element) => {
		for (let node = element.parentElement; node; node = node.parentElement) {
			if (isScrollContainer(window, node)) return node;
		}
		return null;
	};
	proto.focus = function focus(options) {
		/*
		 * `undefined`/`null` are the default dictionary, and WebIDL accepts any
		 * object; the one member the focusing steps read is `preventScroll`, and it
		 * reads it as `PREVENT false` unless the member is present and true - so
		 * `focus(undefined)` and `focus({})` must model the SAME behaviour.
		 */
		const dictionary =
			options === undefined || options === null ? {} : Object(options);
		/*
		 * The container is resolved BEFORE the focus lands, because the steps read
		 * the tree at call time and a later re-parent must not re-attribute a call.
		 */
		const scroller = nearestScroller(this) ?? scrollHost;
		original.call(this, options);
		const prevented = dictionary.preventScroll === true;
		if (scroller && !prevented) {
			scroller.scrollTop = (scroller.scrollTop || 0) + FOCUS_SCROLL_DELTA;
		}
		calls.push({
			element: this,
			options: dictionary,
			scroller,
			prevented,
			scrollTop: scroller ? scroller.scrollTop : null,
		});
	};
	return {
		calls,
		restore: () => {
			proto.focus = original;
		},
	};
}
