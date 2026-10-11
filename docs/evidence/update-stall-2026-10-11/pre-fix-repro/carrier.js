const { app } = require("electron");
const fs = require("fs");
try { app.dock?.hide?.(); } catch (e) {}
app.on("window-all-closed", () => {});
app.whenReady().then(() => {
  try { app.dock?.hide?.(); } catch (e) {}
  fs.appendFileSync(process.env.CARRIER_LOG, `carrier ready pid=${process.pid} at ${new Date().toISOString()}\n`);
});
