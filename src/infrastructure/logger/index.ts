import pino from "pino";
import { env } from "@/config/env.js";

const isDevelopment = env.NODE_ENV === "development";

const logger = pino(
  isDevelopment
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
