/**
 * Ventuz Stream Player
 * Copyright (c) 2025 Ventuz Technology, all rights reserved.
 */

export const logger = {
    log: (...args: unknown[]) => {
        if (import.meta.env.MODE === "development") {
            console.log(...args);
        }
    },
    error: (...args: unknown[]) => {
        console.error(...args);
    },
    warn: (...args: unknown[]) => {
        console.warn(...args);
    },
};
