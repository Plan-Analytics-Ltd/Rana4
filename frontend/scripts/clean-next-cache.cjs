/**
 * Remove Next.js caches safely on Windows (retries + stop port 3001 first).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const targets = [".next", "node_modules/.cache"];

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function killPort(port) {
  if (process.platform === "win32") {
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$c=Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue; if($c){$c|ForEach-Object{Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue}}`,
      ],
      { stdio: "ignore" }
    );
  } else {
    spawnSync("sh", ["-c", `lsof -ti:${port} | xargs -r kill -9 2>/dev/null || true`], {
      stdio: "ignore",
    });
  }
  sleep(400);
}

function rmRecursive(relPath) {
  const full = path.join(root, relPath);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(full)) {
        fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
      if (!fs.existsSync(full)) return true;
    } catch (err) {
      if (attempt === 9) {
        console.error(`Could not remove ${relPath}: ${err.message}`);
        console.error("Close any Next.js dev server on port 3001, then run: npm run dev:clean");
        return false;
      }
      sleep(300 * (attempt + 1));
    }
  }
  return true;
}

killPort(3001);
let ok = true;
for (const t of targets) {
  if (!rmRecursive(t)) ok = false;
}
if (!ok) process.exit(1);
console.log("Cleared .next and node_modules/.cache");
