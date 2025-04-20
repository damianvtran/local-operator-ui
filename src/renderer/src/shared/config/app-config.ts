import type { AppConfig } from "./env-schema";
import { loadConfig } from "./load-config";

/**
 * Application configuration singleton
 */
export const config: AppConfig = loadConfig();
