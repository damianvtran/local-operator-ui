import { loadConfig } from "./load-config";
import type { AppConfig } from "./env-schema";

/**
 * Application configuration singleton
 */
export const config: AppConfig = loadConfig();
