// Global DOM augmentation — Obsidian patches these at runtime.
// This must be outside any `declare module` block to apply globally.

interface HTMLElement {
  createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: {
      text?: string;
      cls?: string | string[];
      href?: string;
      type?: string;
      placeholder?: string;
      value?: string;
      attr?: Record<string, string | number | boolean>;
    }
  ): HTMLElementTagNameMap[K];
  createDiv(opts?: { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean> }): HTMLDivElement;
  createSpan(opts?: {
    cls?: string | string[];
    text?: string;
    attr?: Record<string, string | number | boolean>;
  }): HTMLSpanElement;
  addClass(...cls: string[]): void;
  removeClass(...cls: string[]): void;
  toggleClass(cls: string, val: boolean): void;
  contains(other: Node | null): boolean;
  empty(): void;
  setText(text: string): void;
  setAttr(name: string, value: string | number | boolean): void;
}

interface Element {
  addClass(...cls: string[]): void;
  removeClass(...cls: string[]): void;
}
