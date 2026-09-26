import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dist = path.resolve(root, 'dist');

if (!fs.existsSync(dist)) {
  fs.mkdirSync(dist, { recursive: true });
}

const foldersToCopy = ['js', 'css', 'src', 'supabase'];
for (const folder of foldersToCopy) {
  const src = path.resolve(root, folder);
  const dest = path.resolve(dist, folder);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log(`[copy-assets] Copied ${folder} -> dist/${folder}`);
  }
}

// Ensure 404.html exists in dist so Vercel doesn't show standard 404 page
const indexHtml = path.resolve(dist, 'index.html');
const notFoundHtml = path.resolve(dist, '404.html');
if (fs.existsSync(indexHtml) && !fs.existsSync(notFoundHtml)) {
  fs.copyFileSync(indexHtml, notFoundHtml);
  console.log('[copy-assets] Created dist/404.html fallback for client-side routing');
}
