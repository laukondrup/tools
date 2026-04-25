import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function contentTypeFor(filename) {
  return MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function createStaticServer(root) {
  return http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const cleanPath = requestPath.replace(/\/+$/, '') || '/';
    const relativePath = cleanPath === '/' ? '/index.md' : cleanPath;
    const fsPath = path.normalize(path.join(root, relativePath));

    if (!fsPath.startsWith(root)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let finalPath = fsPath;
    if (requestPath.endsWith('/')) {
      finalPath = path.join(fsPath, 'index.html');
    }

    createReadStream(finalPath)
      .on('error', () => {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      })
      .once('open', () => {
        res.writeHead(200, { 'Content-Type': contentTypeFor(finalPath) });
      })
      .pipe(res);
  });
}

async function findToolDirs(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const toolDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (
      entry.name.startsWith('.') ||
      entry.name.startsWith('_') ||
      entry.name === 'node_modules' ||
      entry.name === 'scripts'
    ) {
      continue;
    }

    const indexPath = path.join(root, entry.name, 'index.html');
    try {
      const info = await stat(indexPath);
      if (info.isFile()) {
        toolDirs.push(entry.name);
      }
    } catch {
      // Ignore non-tool directories.
    }
  }

  return toolDirs.sort((a, b) => a.localeCompare(b));
}

async function main() {
  const toolDirs = await findToolDirs(rootDir);
  if (toolDirs.length === 0) {
    console.log('No tool directories found.');
    return;
  }

  const server = createStaticServer(rootDir);
  await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  try {
    for (const toolDir of toolDirs) {
      const page = await context.newPage();
      const previewQuery = '?preview=1';
      const url = `http://127.0.0.1:4173/${toolDir}/${previewQuery}`;
      const outputPath = path.join(rootDir, toolDir, 'preview.png');

      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: outputPath, fullPage: false });
      await page.close();
      console.log(`Captured ${toolDir}/preview.png`);
    }
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
