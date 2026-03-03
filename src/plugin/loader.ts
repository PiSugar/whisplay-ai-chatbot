/**
 * Whisplay Plugin Loader
 *
 * Discovers and loads third-party plugins from:
 * 1. The `plugins/` directory in the project root (each subdirectory is a plugin)
 * 2. npm packages with the "whisplay-plugin-" prefix
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import { Plugin } from "./types";
import { pluginRegistry } from "./registry";

const PLUGIN_DIR_NAME = "plugins";
const PLUGIN_NPM_PREFIX = "whisplay-plugin-";

/**
 * Load external (third-party) plugins from the plugins/ directory and npm packages.
 * This function is called automatically during plugin system initialization.
 */
export function loadExternalPlugins(): void {
  loadFromPluginsDirectory();
  loadFromNodeModules();
}

/**
 * Parse a plugin's own .env file (if it exists) and return the key-value pairs.
 * These variables are scoped to the plugin and never written to process.env.
 */
function parsePluginEnv(pluginPath: string): Record<string, string> {
  const envPath = path.join(pluginPath, ".env");
  if (!fs.existsSync(envPath)) return {};

  try {
    const envContent = fs.readFileSync(envPath, "utf-8");
    const parsed = dotenv.parse(envContent);
    console.log(
      `[Plugin] Loaded scoped .env for ${path.basename(pluginPath)} (${Object.keys(parsed).length} vars)`,
    );
    return parsed;
  } catch (e: any) {
    console.warn(
      `[Plugin] Failed to parse .env for ${path.basename(pluginPath)}: ${e.message}`,
    );
    return {};
  }
}

function loadFromPluginsDirectory(): void {
  const pluginDir = path.join(process.cwd(), PLUGIN_DIR_NAME);

  if (!fs.existsSync(pluginDir)) {
    return;
  }

  console.log(`[Plugin] Scanning plugins directory: ${pluginDir}`);
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginPath = path.join(pluginDir, entry.name);
    try {
      // Auto-install dependencies if package.json exists
      installPluginDependencies(pluginPath);

      // Parse plugin-scoped .env (never pollutes process.env)
      const pluginEnv = parsePluginEnv(pluginPath);

      const pluginModule = require(pluginPath);
      const plugin: Plugin = pluginModule.default || pluginModule;

      if (!isValidPlugin(plugin)) {
        console.warn(
          `[Plugin] Invalid plugin at ${pluginPath}: must export { name, type, version, displayName, activate }`,
        );
        continue;
      }

      pluginRegistry.register(plugin, pluginEnv);
      console.log(
        `[Plugin] Loaded external plugin: ${plugin.displayName} (${plugin.type}:${plugin.name})`,
      );
    } catch (e: any) {
      console.error(
        `[Plugin] Failed to load plugin from ${pluginPath}:`,
        e.message,
      );
    }
  }
}

function loadFromNodeModules(): void {
  try {
    const nodeModulesDir = path.join(process.cwd(), "node_modules");
    if (!fs.existsSync(nodeModulesDir)) return;

    const entries = fs.readdirSync(nodeModulesDir);

    for (const entry of entries) {
      if (!entry.startsWith(PLUGIN_NPM_PREFIX)) continue;

      try {
        // Resolve plugin path for scoped .env loading
        const npmPluginDir = path.join(nodeModulesDir, entry);
        const pluginEnv = parsePluginEnv(npmPluginDir);

        const pluginModule = require(entry);
        const plugin: Plugin = pluginModule.default || pluginModule;

        if (!isValidPlugin(plugin)) {
          console.warn(
            `[Plugin] Invalid npm plugin ${entry}: must export { name, type, version, displayName, activate }`,
          );
          continue;
        }

        pluginRegistry.register(plugin, pluginEnv);
        console.log(
          `[Plugin] Loaded npm plugin: ${plugin.displayName} (${plugin.type}:${plugin.name})`,
        );
      } catch (e: any) {
        console.error(
          `[Plugin] Failed to load npm plugin ${entry}:`,
          e.message,
        );
      }
    }
  } catch (e: any) {
    // Silently ignore if node_modules doesn't exist or can't be read
  }
}

/**
 * Auto-install plugin dependencies by running `npm install` in the plugin directory
 * if a package.json is present and node_modules is missing or outdated.
 */
function installPluginDependencies(pluginPath: string): void {
  const packageJsonPath = path.join(pluginPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) return;

  const nodeModulesPath = path.join(pluginPath, "node_modules");
  const needsInstall = !fs.existsSync(nodeModulesPath) || isPackageJsonNewer(packageJsonPath, nodeModulesPath);

  if (!needsInstall) return;

  console.log(`[Plugin] Installing dependencies for ${path.basename(pluginPath)}...`);
  try {
    execSync("npm install --production", {
      cwd: pluginPath,
      stdio: "pipe",
      timeout: 120_000, // 2 minutes timeout
    });
    console.log(`[Plugin] Dependencies installed for ${path.basename(pluginPath)}`);
  } catch (e: any) {
    console.error(
      `[Plugin] Failed to install dependencies for ${path.basename(pluginPath)}:`,
      e.stderr?.toString() || e.message,
    );
  }
}

/**
 * Check if package.json is newer than node_modules (i.e., dependencies may have changed).
 */
function isPackageJsonNewer(packageJsonPath: string, nodeModulesPath: string): boolean {
  try {
    const pkgStat = fs.statSync(packageJsonPath);
    const nmStat = fs.statSync(nodeModulesPath);
    return pkgStat.mtimeMs > nmStat.mtimeMs;
  } catch {
    return true;
  }
}

function isValidPlugin(plugin: any): plugin is Plugin {
  return (
    plugin &&
    typeof plugin.name === "string" &&
    typeof plugin.type === "string" &&
    typeof plugin.version === "string" &&
    typeof plugin.displayName === "string" &&
    typeof plugin.activate === "function" &&
    ["asr", "llm", "tts", "image-generation", "vision", "llm-tools"].includes(plugin.type)
  );
}
