/**
 * Installation Scripts
 *
 * This module exports installation scripts for different operating systems.
 * Scripts are imported as raw strings from .sh files.
 */

import macosScriptRaw from "./macos-script.sh?raw";
import linuxScriptRaw from "./linux-script.sh?raw";
import windowsScriptRaw from "./windows-script.sh?raw";

export const macosScript = macosScriptRaw;
export const linuxScript = linuxScriptRaw;
export const windowsScript = windowsScriptRaw;
