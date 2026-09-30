// ─── Obsidian ambient shim ─────────────────────────────────────────────────
// DOM augmentation lives in dom-obsidian.d.ts (global scope).
// This file only declares the obsidian module's exports.
declare module "obsidian" {

  interface EventRef {}

  class Events {
    on(name: string, cb: (...args: unknown[]) => unknown): EventRef;
    off(name: string, cb: (...args: unknown[]) => unknown): void;
    trigger(name: string, ...args: unknown[]): void;
  }

  class Component {
    load(): void; unload(): void; onload(): void; onunload(): void;
    registerEvent(ref: EventRef): void;
    registerInterval(id: number): number;
    addChild<T extends Component>(child: T): T;
  }

  class TAbstractFile { path: string; name: string; parent: TFolder | null; }
  class TFile extends TAbstractFile { basename: string; extension: string; stat: { mtime: number; ctime: number; size: number }; }
  class TFolder extends TAbstractFile { children: TAbstractFile[]; }

  class Vault extends Events {
    getMarkdownFiles(): TFile[];
    getAbstractFileByPath(path: string): TAbstractFile | null;
    read(file: TFile): Promise<string>;
    create(path: string, data: string): Promise<TFile>;
    createFolder(path: string): Promise<void>;
    process(file: TFile, fn: (data: string) => string): Promise<string>;
    rename(file: TAbstractFile, newPath: string): Promise<void>;
    on(name: "rename" | "delete" | "create" | "modify", cb: (file: TAbstractFile, oldPath?: string) => unknown): EventRef;
  }

  interface FileManager {
    processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void>;
    /** Rename/move and update links to the file (unlike Vault.rename). Since 0.11.0. */
    renameFile(file: TAbstractFile, newPath: string): Promise<void>;
    /** Trash according to the user's trash preference. Since 1.6.6. */
    trashFile(file: TAbstractFile): Promise<void>;
  }

  interface MetadataCache extends Events {
    getFileCache(file: TFile): { frontmatter?: Record<string, unknown>; links?: unknown[] } | null;
    on(name: "changed" | "deleted" | "resolved", cb: (file: TFile) => unknown): EventRef;
    off(name: "changed" | "deleted" | "resolved", cb: (file: TFile) => unknown): void;
  }

  interface App {
    vault: Vault;
    workspace: Workspace;
    metadataCache: MetadataCache;
    fileManager: FileManager;
    plugins: { plugins: Record<string, unknown> };
  }

  interface WorkspaceLeaf {
    view: View;
    setViewState(state: { type: string; active?: boolean }): Promise<void>;
    openFile(file: TFile, opts?: { active?: boolean }): Promise<void>;
    detach(): void;
  }

  interface Workspace extends Events {
    getLeaf(newLeaf?: boolean | "tab" | "split" | "window"): WorkspaceLeaf;
    getRightLeaf(split: boolean): WorkspaceLeaf | null;
    getLeavesOfType(type: string): WorkspaceLeaf[];
    detachLeavesOfType(type: string): void;
    revealLeaf(leaf: WorkspaceLeaf): void;
    onLayoutReady(cb: () => void): void;
    getActiveFile(): TFile | null;
    on(name: string, cb: (...args: unknown[]) => unknown): EventRef;
  }

  class View extends Component {
    app: App; leaf: WorkspaceLeaf; containerEl: HTMLElement; contentEl: HTMLElement;
    getViewType(): string; getDisplayText(): string; getIcon(): string;
    onOpen(): Promise<void>; onClose(): Promise<void>;
  }
  class ItemView extends View { constructor(leaf: WorkspaceLeaf); }

  class Modal {
    app: App; modalEl: HTMLElement; contentEl: HTMLElement;
    constructor(app: App);
    open(): void; close(): void; onOpen(): void; onClose(): void;
  }

  class FuzzySuggestModal<T> extends Modal {
    constructor(app: App);
    setPlaceholder(text: string): void;
    getItems(): T[];
    getItemText(item: T): string;
    onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;
  }

  class Plugin extends Component {
    app: App; manifest: { id: string; name: string; version: string };
    constructor(app: App, manifest: unknown);
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
    addCommand(cmd: { id: string; name: string; callback?: () => unknown; editorCallback?: (editor: Editor, view: MarkdownView) => unknown }): void;
    addRibbonIcon(icon: string, title: string, cb: (e: MouseEvent) => unknown): HTMLElement;
    addSettingTab(tab: PluginSettingTab): void;
    addStatusBarItem(): HTMLElement;
    registerView(type: string, creator: (leaf: WorkspaceLeaf) => View): void;
    registerMarkdownCodeBlockProcessor(lang: string, handler: (src: string, el: HTMLElement, ctx: unknown) => void | Promise<void>): void;
  }

  class PluginSettingTab {
    app: App; plugin: Plugin; containerEl: HTMLElement;
    constructor(app: App, plugin: any);
    display(): void; hide(): void;
  }

  class Setting {
    settingEl: HTMLElement;
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string | DocumentFragment): this;
    setDisabled(v: boolean): this;
    addText(cb: (t: TextComponent) => unknown): this;
    addTextArea(cb: (t: TextAreaComponent) => unknown): this;
    addToggle(cb: (t: ToggleComponent) => unknown): this;
    addDropdown(cb: (t: DropdownComponent) => unknown): this;
    addButton(cb: (t: ButtonComponent) => unknown): this;
    addExtraButton(cb: (t: ExtraButtonComponent) => unknown): this;
  }

  interface BaseComponent { setDisabled(v: boolean): this; }
  interface TextComponent extends BaseComponent { inputEl: HTMLInputElement; getValue(): string; setValue(v: string): this; setPlaceholder(v: string): this; onChange(cb: (v: string) => unknown): this; }
  interface TextAreaComponent extends BaseComponent { inputEl: HTMLTextAreaElement; getValue(): string; setValue(v: string): this; setPlaceholder(v: string): this; onChange(cb: (v: string) => unknown): this; }
  interface ToggleComponent extends BaseComponent { getValue(): boolean; setValue(v: boolean): this; onChange(cb: (v: boolean) => unknown): this; }
  interface DropdownComponent extends BaseComponent { getValue(): string; setValue(v: string): this; addOption(value: string, display: string): this; onChange(cb: (v: string) => unknown): this; }
  interface ButtonComponent extends BaseComponent { buttonEl: HTMLButtonElement; setButtonText(t: string): this; setText(t: string): this; setCta(): this; setWarning(): this; onClick(cb: (e: MouseEvent) => unknown): this; setAttr(name: string, value: string): this; }
  interface ExtraButtonComponent extends BaseComponent { setIcon(i: string): this; setTooltip(t: string): this; onClick(cb: () => unknown): this; }

  class Editor { getSelection(): string; replaceSelection(text: string): void; getValue(): string; setValue(text: string): void; }
  class MarkdownView extends View { editor: Editor; }

  class Menu {
    addItem(cb: (item: MenuItem) => unknown): this;
    addSeparator(): this;
    showAtMouseEvent(e: MouseEvent): this;
    hide(): void;
  }
  interface MenuItem { setTitle(t: string): this; setIcon(i: string): this; setChecked(v: boolean): this; setDisabled(v: boolean): this; onClick(cb: (e: MouseEvent | KeyboardEvent) => unknown): this; }

  class Notice { constructor(msg: string | DocumentFragment, timeout?: number); hide(): void; }

  function normalizePath(path: string): string;
  function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number, resetTimer?: boolean): T & { cancel(): void };
}
