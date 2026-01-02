import path from "path";
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3008',
                changeOrigin: true,
            },
            '/socket.io': {
                target: 'http://localhost:3008',
                ws: true,
            }
        }
    }
});
