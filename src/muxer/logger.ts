export const logger = {
    log: (...args: any[]) => {
        if (import.meta.env.MODE === "development") {
            console.log(...args);
        }
    },
    error: (...args: any[]) => {
        console.error(...args);
    },
    warn: (...args: any[]) => {
        console.warn(...args);
    },
};
