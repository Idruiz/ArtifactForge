// bootstrap.cjs — kill -> clean (if tight on space) -> ensure deps -> ensure Chrome -> done
const { execSync } = require("child_process");

const sh = (cmd, ignoreFail = false) => {
  try { execSync(cmd, { stdio: "inherit", shell: "/bin/bash" }); }
  catch (e) { if (!ignoreFail) throw e; }
};
const out = (cmd) => {
  try { return execSync(cmd, { encoding: "utf8", shell: "/bin/bash" }).trim(); }
  catch { return ""; }
};
const has = (name) => { try { require.resolve(name); return true; } catch { return false; } };
const log = (m) => console.log(`[bootstrap] ${m}`);

log("BEGIN");
sh("node -v && npm -v", true);

const pct = parseInt(out(`df -P . | awk 'NR==2 {gsub(/%/,"",$5); print $5}'`) || "0", 10) || 0;
log(`disk usage: ${pct}%`);

log("killing stray node/tsx");
sh("pkill -9 -f node || true", true);
sh("pkill -9 -f tsx || true", true);
sh("pkill -9 -f ts-node || true", true);

// If nearly full, free safe space (caches + huge artifacts)
if (pct >= 98) {
  log("disk very full; cleaning caches and large pptx/pdf");
  sh("rm -rf .cache .npm _npx puppeteer .local-chromium", true);
  sh(`find . -type f -name "*.pptx" -size +5M -delete`, true);
  sh(`find . -type f -name "*.pdf"  -size +5M -delete`, true);
}

// Ensure packages from package.json (install only if something’s missing)
const must = ["docx", "pptxgenjs", "puppeteer", "axios", "tsx", "typescript", "@types/node"];
if (must.some((m) => !has(m))) {
  log("installing npm packages (first run may take a few minutes)");
  sh("npm i --no-fund --no-audit");
} else {
  log("npm packages already present");
}

// Ensure Chrome for Puppeteer (idempotent)
log("ensuring Chrome for Puppeteer (first run can take 2–5 min)");
sh("npx puppeteer browsers install chrome", true);

log("bootstrap done");
