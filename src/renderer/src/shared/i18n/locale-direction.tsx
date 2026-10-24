/**
 * Radix's direction, resolved from the same locale store as `<html dir>`.
 *
 * WHY A PROVIDER AND NOT JUST THE ROOT ATTRIBUTE: Radix portals a menu's
 * content out of the React tree and derives its own direction from the
 * `DirectionProvider` context (`useDirection` falls back to `ltr` when no
 * provider exists). In Urdu the document root was `dir="rtl"` while a portalled
 * menu measured `direction: ltr`, so every logical inset this app converted
 * (`ps-8`, `ms-auto`, `start-2`) landed on the physical wrong edge. One provider
 * mounted with the app tree gives every portalled menu - tab actions, context
 * menus, selects - the locale direction, from the same single source
 * `useDocumentDirection` writes to the document root.
 *
 * The provider is mounted INSIDE `HashRouter` but around `App`, so a menu opened
 * from any route inherits it; the mini-view window has no menus and keeps its
 * own (toast-only) tree.
 */

import { Direction } from "radix-ui";
import type { FC, ReactNode } from "react";

import { useTextDirection } from "./use-document-direction";

export const LocaleDirectionProvider: FC<{ children: ReactNode }> = ({
	children,
}) => {
	const direction = useTextDirection();
	return <Direction.Provider dir={direction}>{children}</Direction.Provider>;
};
