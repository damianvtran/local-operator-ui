console.log('[popup-preload.ts] Script executing...'); // Debug log

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposes a safe API to the popup window's renderer process for sending hotkey configurations.
 * This avoids needing to enable nodeIntegration in the popup window.
 */
contextBridge.exposeInMainWorld('electronPopupAPI', {
  /**
   * Sends the specified hotkey string to the main process.
   * @param hotkey - The hotkey string to be registered (e.g., 'CommandOrControl+Shift+X').
   */
  sendHotkey: (hotkey: string): void => {
    if (typeof hotkey === 'string') {
      ipcRenderer.send('set-hotkey', hotkey);
    } else {
      console.error('Invalid hotkey provided to sendHotkey:', hotkey);
    }
  },
  /**
   * Sends a message object (content and attachments) from the popup to the main process.
   * @param message - An object containing `content` (string) and `attachments` (string[]).
   */
  sendPopupMessage: (message: { content: string; attachments: string[] }): void => {
    // Basic validation for the message object
    if (
      message &&
      typeof message.content === 'string' &&
      Array.isArray(message.attachments) &&
      message.attachments.every(att => typeof att === 'string')
    ) {
      ipcRenderer.send('popup-send-message', message);
    } else {
      console.error('Invalid message object provided to sendPopupMessage:', message);
    }
  },
  // You can expose other IPC channels or utilities needed by the popup here
});
console.log('[popup-preload.ts] contextBridge.exposeInMainWorld has been called for electronPopupAPI.');

// It's good practice to declare the types for the exposed API for TypeScript users in the renderer.
// This would typically be in a .d.ts file, e.g., index.d.ts or a specific popup.d.ts
// For example:
// Update the global declaration to include the new method
declare global {
  interface Window {
    electronPopupAPI?: { // Make it optional as it's injected
      sendHotkey: (hotkey: string) => void;
      sendPopupMessage?: (message: { content: string; attachments: string[] }) => void;
    };
  }
}
