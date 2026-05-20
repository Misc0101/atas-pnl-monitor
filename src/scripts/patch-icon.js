/**
 * patch-icon.js
 * 构建完成后，用 rcedit 把自定义图标写入 portable EXE
 * (electron-builder 的 NSIS portable 包装层不会自动继承 win.icon)
 * Run: node scripts/patch-icon.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ICO      = path.join(__dirname, '..', 'build', 'icon.ico');
const PORTABLE = path.join(__dirname, '..', 'dist', 'ATAS-PnL-Monitor-portable.exe');

// 从 electron-builder 缓存中找 rcedit-x64.exe
function findRcedit() {
  const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(cacheDir)) return null;
  for (const dir of fs.readdirSync(cacheDir)) {
    const candidate = path.join(cacheDir, dir, 'rcedit-x64.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

if (!fs.existsSync(PORTABLE)) {
  console.log('portable EXE not found, skipping icon patch');
  process.exit(0);
}

const rcedit = findRcedit();
if (!rcedit) {
  console.warn('rcedit not found in electron-builder cache, skipping icon patch');
  process.exit(0);
}

console.log('Patching icon in portable EXE...');
execSync(`"${rcedit}" "${PORTABLE}" --set-icon "${ICO}"`, { stdio: 'inherit' });
console.log('Done.');
