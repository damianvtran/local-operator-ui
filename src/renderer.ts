// This file is loaded by index.html and runs in the renderer process
// It cannot use Node.js APIs directly, but can use the exposed API from preload.js

// Make this a module to enable global augmentation
export {};

// Declare the API interface to match what's exposed in preload.ts
interface ElectronAPI {
  send: (channel: string, data: unknown) => void;
  receive: (channel: string, func: (...args: unknown[]) => void) => void;
}

// Augment the Window interface
declare global {
  interface Window {
    api: ElectronAPI;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('Renderer process loaded.');
  
  // Example of sending a message to the main process
  const sendMessageButton = document.getElementById('send-message');
  if (sendMessageButton) {
    sendMessageButton.addEventListener('click', () => {
      window.api.send('toMain', 'Hello from renderer!');
    });
  }
  
  // Example of receiving a message from the main process
  window.api.receive('fromMain', (message: unknown) => {
    console.log('Received from main process:', message);
    const messageElement = document.getElementById('received-message');
    if (messageElement) {
      messageElement.textContent = message as string;
    }
  });
});
