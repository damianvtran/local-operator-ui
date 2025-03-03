// This file is loaded by index.html and runs in the renderer process
// It cannot use Node.js APIs directly, but can use the exposed API from preload.js

// Make this a module to enable global augmentation
export {};

document.addEventListener('DOMContentLoaded', () => {
  console.log('Renderer process loaded.');
});
