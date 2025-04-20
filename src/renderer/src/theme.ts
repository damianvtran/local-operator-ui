import { getTheme, themes } from "./shared/themes";
import type { ThemeName, ThemeOption } from "./shared/themes";
/**
 * This file is kept for backward compatibility.
 * New code should import from the themes directory instead.
 *
 * @deprecated Use imports from src/renderer/src/themes instead
 */
import darkTheme from "./shared/themes/dark-theme";
import draculaTheme from "./shared/themes/dracula-theme";
import icebergTheme from "./shared/themes/iceberg-theme";
import lightTheme from "./shared/themes/light-theme";
import sageTheme from "./shared/themes/sage-theme";
import tokyoNightTheme from "./shared/themes/tokyo-night-theme";

// Export all theme-related items for backward compatibility
export {
	darkTheme,
	draculaTheme,
	icebergTheme,
	lightTheme,
	sageTheme,
	tokyoNightTheme,
	themes,
	getTheme,
};

export type { ThemeName, ThemeOption };

// Export the dark theme as the default theme for backward compatibility
export default darkTheme;
