/**
 * This file is kept for backward compatibility.
 * New code should import from the themes directory instead.
 *
 * @deprecated Use imports from src/renderer/src/themes instead
 */
import darkTheme from "./themes/dark-theme";
import draculaTheme from "./themes/dracula-theme";
import lightTheme from "./themes/light-theme";
import sageTheme from "./themes/sage-theme";
import { themes, getTheme } from "./themes";
import type { ThemeName, ThemeOption } from "./themes";

// Export all theme-related items for backward compatibility
export { darkTheme, draculaTheme, lightTheme, sageTheme, themes, getTheme };
export type { ThemeName, ThemeOption };

// Export the dark theme as the default theme for backward compatibility
export default darkTheme;
