import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

function copyStaticAssetsPlugin() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      const dirs = ['js', 'css', 'src', 'supabase'];
      for (const d of dirs) {
        const src = path.resolve(__dirname, d);
        const dest = path.resolve(__dirname, 'dist', d);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true, force: true });
        }
      }
      const indexHtml = path.resolve(__dirname, 'dist', 'index.html');
      const notFoundHtml = path.resolve(__dirname, 'dist', '404.html');
      if (fs.existsSync(indexHtml) && !fs.existsSync(notFoundHtml)) {
        fs.copyFileSync(indexHtml, notFoundHtml);
      }
    }
  };
}

function cleanEnvStr(val?: string) {
  if (!val) return '';
  let s = String(val).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export default defineConfig(() => {
  const flwPub = cleanEnvStr(
    process.env.FLUTTERWAVE_PUBLIC_KEY ||
    process.env.VITE_FLUTTERWAVE_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY ||
    process.env.FLW_PUBLIC_KEY ||
    process.env.PUBLIC_KEY
  );

  return {
    plugins: [react(), tailwindcss(), copyStaticAssetsPlugin()],
    define: {
      'window.__ENV__': JSON.stringify({
        flutterwavePublicKey: flwPub,
        paystackPublicKey: cleanEnvStr(process.env.PAYSTACK_PUBLIC_KEY) || 'pk_test_2193bfe61dcf7971c220bb9b9a0027d4eb0e2ff3',
        supabaseUrl: cleanEnvStr(process.env.SUPABASE_URL) || 'https://kljnyncmpsewrghkybcd.supabase.co',
        supabaseAnonKey: cleanEnvStr(process.env.SUPABASE_ANON_KEY) || ''
      })
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          version1: path.resolve(__dirname, 'version1.html'),
          admin: path.resolve(__dirname, 'admin.html'),
          history: path.resolve(__dirname, 'history.html'),
          version2: path.resolve(__dirname, 'version2.html'),
          amira: path.resolve(__dirname, 'amira.html'),
          blog: path.resolve(__dirname, 'blog.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
