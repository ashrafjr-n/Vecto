import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // /api/* is the Cloudflare Worker (worker/index.js). In dev, run `npx wrangler dev`
  // beside `npm run dev`; wrangler's default port is 8787.
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})