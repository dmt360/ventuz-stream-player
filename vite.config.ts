import type { UserConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

export default {
    server: {
        port: 22444,
    },

    plugins: [cssInjectedByJsPlugin()],

    build: {
        assetsDir: ".",
        outDir: "dist",
        sourcemap: true,

        rollupOptions: {
            output: {
                entryFileNames: "ventuz-stream-player-min.js",
            },
        },
    },
} satisfies UserConfig;
