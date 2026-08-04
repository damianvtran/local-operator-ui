import logo from "@assets/icon.png";
import type React from "react";

/**
 * LogoSection component
 *
 * The product mark and its one-line promise, above the feature carousel.
 *
 * ## Why the mark changed asset
 *
 * This used to render `clear-icon-with-text.png`, which is a white-only glyph
 * on transparency: invisible on all six light themes, and despite its name it
 * carries no wordmark at all. It also has roughly 2000px of empty canvas
 * around a small figure, so at `h-30` the visible glyph was a fraction of the
 * space it reserved — which is where the dead air between the mark and the
 * heading came from.
 *
 * `icon.png` is the app's own icon: a dark figure on its own light disc, so it
 * reads on every ground the way it reads in Finder or the taskbar. Showing the
 * application icon is also what an installer is expected to show, and it is
 * the one image on this screen that is the same in all twelve themes because
 * it brings its own background.
 */
export const LogoSection: React.FC = () => {
	return (
		<>
			{/* Decorative: the heading immediately below is the accessible name,
			    and a splash screen announcing the product twice is noise. */}
			<img
				src={logo}
				alt=""
				aria-hidden="true"
				className="mb-5 size-16 rounded-lg object-contain"
			/>
			<h1 className="text-center text-display text-ink">Local Operator</h1>
			{/* 32px below: the identity block and the rotating feature under it are
			    two different things, not two paragraphs. */}
			<p className="mt-2 mb-8 text-center text-body text-ink-muted">
				Personal AI assistants that turn ideas into action
			</p>
		</>
	);
};
