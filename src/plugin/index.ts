/**
 * Whisplay Plugin System - Entry Point
 *
 * Auto-initializes the plugin system on first import.
 * Built-in plugins are registered, then external plugins are loaded.
 *
 * IMPORTANT: This module must be imported BEFORE any module that
 * depends on plugin activation (e.g., cloud-api/server.ts, cloud-api/llm.ts).
 */

import { registerBuiltinPlugins } from "./builtin";
import { loadExternalPlugins } from "./loader";
import { pluginRegistry } from "./registry";

// ── Auto-initialize on first import ────────────────────────
registerBuiltinPlugins();
loadExternalPlugins();

const pluginsByType = new Map<string, number>();
for (const p of pluginRegistry.listPlugins()) {
  pluginsByType.set(p.type, (pluginsByType.get(p.type) || 0) + 1);
}
const summary = Array.from(pluginsByType.entries())
  .map(([type, count]) => `${type}:${count}`)
  .join(", ");
console.log(`[Plugin] System initialized (${summary})`);

// ── Public API ─────────────────────────────────────────────
export { pluginRegistry } from "./registry";
export { loadExternalPlugins } from "./loader";
export { registerBuiltinPlugins } from "./builtin";
export * from "./types";

// Re-export commonly needed types for third-party plugin developers
export { Message, LLMTool, TTSResult, ToolReturnTag, FunctionCall } from "../type";
export type { PluginContext, LLMToolsProvider } from "./types";
