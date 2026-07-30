import path from "path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [react(), tailwindcss(), basicSsl()],
    // HTTPS on the dev server comes from basicSsl() above, which injects a
    // self-signed cert into server.https — needed to test the PWA/push on iOS.
    server: {
        host: true,
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});
