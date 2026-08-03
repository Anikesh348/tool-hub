import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        raspberryPiPersonalCloud: resolve(__dirname, 'blog-raspberry-pi-5-personal-cloud.html'),
        homelabPublicAccess: resolve(__dirname, 'blog-how-i-put-my-homelab-on-the-internet.html'),
        movieHubJellyfinRequestPath: resolve(__dirname, 'blog-moviehub-jellyfin-request-path.html'),
      },
    },
  },
  server: {
    proxy: {
      '/search': 'http://localhost:8000'
    },
  },
})
