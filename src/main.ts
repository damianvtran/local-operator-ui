import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../public/preload.js')
    }
  });

  win.loadFile('public/index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Handle IPC messages from renderer process
ipcMain.on('toMain', (event, message) => {
  console.log('Received in main process:', message);
  
  // Send a response back to the renderer process
  setTimeout(() => {
    event.sender.send('fromMain', `Response from main process: ${message} (received at ${new Date().toLocaleTimeString()})`);
  }, 1000);
});
