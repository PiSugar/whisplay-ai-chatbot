/**
 * Whisplay Plugin Registry
 *
 * Central registry for managing plugin registration and activation.
 * Plugins are identified by their type and name (e.g., "asr:openai").
 */

import { Plugin, PluginContext, PluginType, ProviderTypeMap } from "./types";
import { imageDir, ttsDir } from "../utils/dir";

class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private pluginEnvs = new Map<string, Record<string, string>>();
  private activeProviders = new Map<PluginType, any>();
  private activePluginNames = new Map<PluginType, string>();

  /**
   * Register a plugin. If a plugin with the same type:name already exists, it will be overwritten.
   * This allows third-party plugins to override built-in implementations.
   */
  register(plugin: Plugin, pluginEnv?: Record<string, string>): void {
    const key = `${plugin.type}:${plugin.name}`;
    if (this.plugins.has(key)) {
      console.log(
        `[Plugin] Overriding existing plugin: ${key} → ${plugin.displayName} v${plugin.version}`,
      );
    }
    this.plugins.set(key, plugin);
    if (pluginEnv && Object.keys(pluginEnv).length > 0) {
      this.pluginEnvs.set(key, pluginEnv);
    }
  }

  /**
   * Build the PluginContext that is passed to every activate() call.
   * If the plugin registered its own .env, those variables are merged
   * into ctx.env (overriding globals) and exposed via ctx.pluginEnv.
   */
  private buildContext(key: string): PluginContext {
    const scopedEnv = this.pluginEnvs.get(key) || {};
    return {
      env: { ...process.env, ...scopedEnv } as Record<string, string | undefined>,
      pluginEnv: { ...scopedEnv },
      imageDir,
      ttsDir,
    };
  }

  /**
   * Activate a plugin synchronously. The plugin's activate() must return
   * a provider directly (not a Promise).
   */
  activatePluginSync<T extends PluginType>(
    type: T,
    name: string,
  ): ProviderTypeMap[T] {
    const key = `${type}:${name}`;
    const plugin = this.plugins.get(key);
    if (!plugin) {
      const available = this.getPluginsOfType(type)
        .map((p) => p.name)
        .join(", ");
      throw new Error(
        `[Plugin] Plugin not found: ${key}. Available ${type} plugins: ${available || "none"}`,
      );
    }
    const ctx = this.buildContext(key);
    const provider = (plugin as any).activate(ctx);
    if (provider && typeof provider.then === "function") {
      throw new Error(
        `[Plugin] Plugin ${key} returned a Promise. Use activatePlugin() for async plugins.`,
      );
    }
    this.activeProviders.set(type, provider);
    this.activePluginNames.set(type, name);
    console.log(`[Plugin] Activated: ${plugin.displayName} (${key})`);
    return provider as ProviderTypeMap[T];
  }

  /**
   * Activate a plugin asynchronously. Supports both sync and async activate() functions.
   */
  async activatePlugin<T extends PluginType>(
    type: T,
    name: string,
  ): Promise<ProviderTypeMap[T]> {
    const key = `${type}:${name}`;
    const plugin = this.plugins.get(key);
    if (!plugin) {
      const available = this.getPluginsOfType(type)
        .map((p) => p.name)
        .join(", ");
      throw new Error(
        `[Plugin] Plugin not found: ${key}. Available ${type} plugins: ${available || "none"}`,
      );
    }
    const ctx = this.buildContext(key);
    const provider = await (plugin as any).activate(ctx);
    this.activeProviders.set(type, provider);
    this.activePluginNames.set(type, name);
    console.log(`[Plugin] Activated: ${plugin.displayName} (${key})`);
    return provider as ProviderTypeMap[T];
  }

  /** Get the currently active provider for a plugin type */
  getActiveProvider<T extends PluginType>(
    type: T,
  ): ProviderTypeMap[T] | undefined {
    return this.activeProviders.get(type) as ProviderTypeMap[T] | undefined;
  }

  /** Get the name of the currently active plugin for a type */
  getActivePluginName(type: PluginType): string | undefined {
    return this.activePluginNames.get(type);
  }

  /** Get a specific registered plugin */
  getPlugin(type: PluginType, name: string): Plugin | undefined {
    return this.plugins.get(`${type}:${name}`);
  }

  /** Get all registered plugins of a specific type */
  getPluginsOfType(type: PluginType): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.type === type);
  }

  /** Get all registered plugins */
  listPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Activate ALL plugins of a given type synchronously and return their providers.
   * Useful for additive plugin types like "llm-tools" where every registered
   * plugin should contribute.
   */
  activateAllPluginsSync<T extends PluginType>(
    type: T,
  ): { name: string; provider: ProviderTypeMap[T] }[] {
    const plugins = this.getPluginsOfType(type);
    const results: { name: string; provider: ProviderTypeMap[T] }[] = [];

    for (const plugin of plugins) {
      try {
        const key = `${plugin.type}:${plugin.name}`;
        const ctx = this.buildContext(key);
        const provider = (plugin as any).activate(ctx);
        if (provider && typeof provider.then === "function") {
          console.warn(
            `[Plugin] Skipping async plugin ${plugin.type}:${plugin.name} in sync activation`,
          );
          continue;
        }
        results.push({ name: plugin.name, provider: provider as ProviderTypeMap[T] });
        console.log(`[Plugin] Activated: ${plugin.displayName} (${plugin.type}:${plugin.name})`);
      } catch (e: any) {
        console.error(
          `[Plugin] Failed to activate ${plugin.type}:${plugin.name}:`,
          e.message,
        );
      }
    }
    return results;
  }
}

export const pluginRegistry = new PluginRegistry();
