// ─── QuickAdd integration ─────────────────────────────────────────────────────
// Registers People Hub as a QuickAdd script/API consumer.
//
// Two usage patterns:
//
//  Pattern A — "Execute macro" (recommended):
//    User creates a QuickAdd macro named e.g. "New Person".
//    Plugin calls api.executeChoice("New Person").
//    The macro can run a Templater template, ask prompts, etc.
//
//  Pattern B — "Capture to folder" (simpler):
//    Plugin registers a QuickAdd choice that fires the built-in createPerson.
//    QuickAdd is only used to surface the command in its own menu.
//
// This module handles wiring for both patterns.

import { App, Notice } from "obsidian";
import type { PeopleHubPlugin } from "../main";

type QA = {
  api?: { executeChoice: (name: string) => Promise<void> };
  quickAddApi?: { executeChoice: (name: string) => Promise<void> };
};

function getQA(app: App): QA | null {
  return (app as any).plugins?.plugins?.["quickadd"] ?? null;
}

/** Returns true if the QuickAdd plugin is loaded. */
export function isQuickAddAvailable(app: App): boolean {
  return !!getQA(app);
}

/** Executes a named QuickAdd macro/choice. */
export async function runQuickAddMacro(app: App, macroName: string): Promise<boolean> {
  const qa = getQA(app);
  if (!qa) {
    new Notice("QuickAdd is not installed or enabled.");
    return false;
  }
  const api = qa.api ?? qa.quickAddApi;
  if (!api) {
    new Notice("QuickAdd API not accessible. Make sure QuickAdd is up to date.");
    return false;
  }
  try {
    await api.executeChoice(macroName);
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[People Hub] QuickAdd macro failed:", e);
    new Notice(`QuickAdd: "${macroName}" failed — ${msg}`);
    return false;
  }
}

// ── QuickAdd script export (Pattern B) ───────────────────────────────────────
// When a user adds People Hub as a "User script" in QuickAdd, QuickAdd calls
// the default export with (params, settings). This lets the plugin surface a
// lightweight "create person" flow directly inside QuickAdd's menu.
//
// File: export this module as people-hub-qa-script.js in the vault.
// (The main plugin build bundles it; see esbuild.config.mjs for the extra entry.)

export interface QAParams {
  quickAddApi: {
    inputPrompt:  (label: string, placeholder?: string, defaultVal?: string) => Promise<string>;
    suggester:    (displayItems: string[], items: string[], hint?: string) => Promise<string>;
    notify:       (msg: string) => void;
    format:       (tpl: string) => Promise<string>;
  };
  variables: Record<string, string>;
  app: App;
}

/**
 * QuickAdd user-script entry point.
 * Lets users trigger People Hub's "New Person" modal from a QuickAdd macro.
 */
export async function runFromQuickAdd(params: QAParams, _settings: unknown): Promise<void> {
  const { quickAddApi, app } = params;
  const plugin: PeopleHubPlugin | undefined =
    (app as any).plugins?.plugins?.["people-hub"];
  if (!plugin) {
    quickAddApi.notify("People Hub plugin not found.");
    return;
  }
  // Delegate to the plugin's own newPerson flow
  await plugin.newPerson();
}

// QuickAdd requires a default export for user scripts
export default runFromQuickAdd;
