const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PID_FILE = path.join(__dirname, ".worker.pid");
const WORKER_JS = path.join(__dirname, "extract_worker.js");

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (fs.existsSync(PID_FILE)) {
  const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
  if (!isNaN(pid) && isRunning(pid)) {
    process.exit(0);
  }
}

const child = spawn(process.execPath, [WORKER_JS], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  cwd: __dirname,
});
child.unref();

setTimeout(() => {
  if (child.pid) {
    fs.writeFileSync(PID_FILE, String(child.pid));
  }
}, 1000);
