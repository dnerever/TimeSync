import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // @timesync/core is consumed as TypeScript source from the workspace root.
    fs: { allow: ['../..'] },
  },
});
