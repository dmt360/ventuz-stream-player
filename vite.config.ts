import type { UserConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { promises as fs } from "fs";
import path from "path";

export default {
    server: {
        port: 22444,
        host: true,
    },

    plugins: [cssInjectedByJsPlugin(),
    {
      name: "copy-dts",
      closeBundle: async () => {
        const src = path.resolve(__dirname, "src/ventuz-stream-player.d.ts");
        const dest = path.resolve(__dirname, "dist/ventuz-stream-player.d.ts");
        await fs.copyFile(src, dest);
      }
    }],

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
