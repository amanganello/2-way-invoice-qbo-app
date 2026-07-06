import pino from "pino";
import { createRequire } from "node:module";
import { env } from "@/config/env.js";

const isDevelopment = env.NODE_ENV === "development";
const require = createRequire(import.meta.url);

function canResolvePackage(packageName: string): boolean {
  try {
    require.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

const usePrettyTransport = isDevelopment && canResolvePackage("pino-pretty");

const logger = pino(
  usePrettyTransport
    ? {
        level: "debug",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {
        level: "info",
      }
);

export { logger };
export default logger;
