import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// حالت پرتیبل: npm run build -- --mode portable
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __PORTABLE__: mode === 'portable',
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: mode === 'portable' ? { output: { inlineDynamicImports: true } } : {},
  },
}))
