// Post-build patch: Expo's `expo export -p web` writes a minimal
// index.html with no PWA hooks. We inject the manifest + Apple home-screen
// meta tags so users can "Install Layla" from their browser and launch
// without the address bar (display: standalone).
//
// Runs after `expo export -p web` as part of the Vercel build command.

const fs = require("fs");
const path = require("path");

const indexPath = path.join(__dirname, "..", "dist", "index.html");
if (!fs.existsSync(indexPath)) {
  console.error("[inject-pwa-meta] dist/index.html not found — skipping");
  process.exit(0);
}

let html = fs.readFileSync(indexPath, "utf-8");

const inject = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<meta name="theme-color" content="#0E0B16" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="Layla" />',
  '<link rel="apple-touch-icon" href="/favicon.ico" />',
].join("\n  ");

if (html.includes("manifest.webmanifest")) {
  console.log("[inject-pwa-meta] already patched — skipping");
  process.exit(0);
}

html = html.replace("</head>", `  ${inject}\n</head>`);
fs.writeFileSync(indexPath, html);
console.log("[inject-pwa-meta] PWA meta tags injected into dist/index.html");
