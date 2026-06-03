import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FileArchive,
  GalleryVerticalEnd,
  ImagePlus,
  KeyRound,
  Layers3,
  ListChecks,
  Loader2,
  PanelsTopLeft,
  Palette,
  PanelRight,
  Play,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  SquareStack,
  Wand2,
  X
} from "lucide-react";
import { defaultModels, defaultProject, defaultProvider, defaultWorkflow, promptTemplates } from "./data/defaults";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Progress } from "./components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { Textarea } from "./components/ui/textarea";
import { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "./components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { ComicImageFrame } from "./components/ComicImageFrame";
import { createLongComicImage, createMockCharacterSheet, createMockComicImage, imageUrlToBlob } from "./services/mockAssets";
import { fetchProviderModels, generateImageWithNewApi } from "./services/newApiClient";
import { saveLongImageNative } from "./services/nativeExport";
import { persistImageAsset, persistProjectsImageAssets } from "./services/nativeAssets";
import { promptTemplateLabel, promptTemplateNodeLabel, promptTemplateVariables, recommendedPromptTemplates, renderPromptTemplate } from "./services/promptVariables";
import {
  clearApiKeySecret,
  cacheApiKeySecrets,
  clearProjectLogs,
  loadApiKeySecret,
  loadApiKeySecrets,
  loadCachedApiKeySecrets,
  loadDraft,
  loadNativeDraft,
  loadProjectLogs,
  saveApiKeySecrets,
  saveNativeDraft,
  saveProjectLogs
} from "./services/persistence";
import { buildCastPrompt, planComicFromStory } from "./services/storyPlanner";
import { runWithConcurrency } from "./services/taskQueue";
import { planComicWithNewApi } from "./services/textPlannerClient";
import { downloadBlob, nowId, sleep } from "./lib/utils";
import {
  AppLogEntry,
  AppLogLevel,
  AppLogModule,
  ApiProvider,
  CharacterTemplate,
  ComicPage,
  ComicProject,
  EndpointMode,
  ExportRatio,
  ModelConfig,
  PageImageVersion,
  PageStatus,
  PlannerResult,
  PromptTemplates,
  ProjectRecord,
  ReaderMode,
  VisualAnchor,
  VisualAnchorType,
  WorkflowNodeConfig,
  WorkspaceTab
} from "./types";

const navItems: Array<{ id: WorkspaceTab; label: string; icon: typeof Wand2 }> = [
  { id: "studio", label: "创作台", icon: Wand2 },
  { id: "storyboard", label: "分镜", icon: SquareStack },
  { id: "characters", label: "人设", icon: Palette },
  { id: "anchors", label: "素材", icon: Layers3 },
  { id: "projects", label: "项目", icon: PanelsTopLeft },
  { id: "settings", label: "模型", icon: Settings2 },
  { id: "logs", label: "日志", icon: ListChecks },
  { id: "export", label: "导出", icon: Download }
];

const statusLabel: Record<PageStatus, string> = {
  draft: "草稿",
  queued: "排队",
  generating: "生成中",
  done: "完成",
  failed: "失败"
};

const ratioLabel: Record<ExportRatio, string> = {
  "3:4": "3:4 小红书翻页",
  "4:5": "4:5 抖音封面",
  "1:1": "1:1 方图"
};

const anchorTypeLabel: Record<VisualAnchorType, string> = {
  product: "产品",
  prop: "道具",
  scene: "场景",
  logo: "品牌/Logo",
  style: "风格"
};

const imageSizeOptions = [
  { value: "1024x1536", label: "1K 竖屏 1024x1536" },
  { value: "1024x1280", label: "1K 4:5 1024x1280" },
  { value: "1024x1024", label: "1K 方图 1024x1024" },
  { value: "2048x3072", label: "2K 竖屏 2048x3072" },
  { value: "2048x2560", label: "2K 4:5 2048x2560" },
  { value: "2048x2048", label: "2K 方图 2048x2048" },
  { value: "3072x4608", label: "3K 竖屏 3072x4608" },
  { value: "3072x3840", label: "3K 4:5 3072x3840" },
  { value: "3072x3072", label: "3K 方图 3072x3072" }
];

const modelPreviewLimit = 80;
const modelSelectLimit = 200;

function normalizeImageSize(size?: string) {
  return imageSizeOptions.some((option) => option.value === size) ? size! : imageSizeOptions[0].value;
}

function pickModelFromProvider(model: ModelConfig, provider?: ApiProvider) {
  const options = provider?.models ?? [];
  if (!options.length) return model.model;
  if (options.includes(model.model)) return model.model;
  if (model.kind === "image") {
    return (
      options.find((option) => /image|dall|flux|stable|sd|midjourney/i.test(option)) ??
      options[0]
    );
  }
  return options.find((option) => /gpt|claude|gemini|deepseek|qwen|glm|llama|yi|kimi/i.test(option)) ?? options[0];
}

function providerSecretSignature(providers: ApiProvider[]) {
  return providers.map((provider) => `${provider.apiKeyRef}:${provider.apiKey}`).join("|");
}

function providerConfigSignature(providers: ApiProvider[]) {
  return providers.map(({ apiKey: _apiKey, ...provider }) => JSON.stringify(provider)).join("|");
}

function hydrateProvidersFromCache<T extends Array<Omit<ApiProvider, "apiKey"> & Partial<Pick<ApiProvider, "apiKey">>>>(providers: T) {
  const cachedKeys = loadCachedApiKeySecrets(providers.map((provider) => provider.apiKeyRef));
  return providers.map((provider) => ({
    ...provider,
    apiKey: provider.apiKey || cachedKeys[provider.apiKeyRef] || ""
  })) as Array<ApiProvider>;
}

function getAllCharacters(project: ComicProject) {
  const deletedIds = new Set(project.deletedCharacterIds ?? []);
  return (project.customCharacters ?? []).filter((character) => !deletedIds.has(character.id));
}

function createCharacterPrompt(character: CharacterTemplate) {
  const referenceText = character.referenceImages?.length
    ? ` Visual reference labels: ${character.referenceImages.map((image) => image.label).join(", ")}. Use them only to keep the same face, clothing, silhouette, palette and proportions; never draw the reference sheet, labels, notes, UI frame, or multi-view layout into comic pages.`
    : "";
  return `${character.name}: ${character.description}. ${character.prompt}. ${character.palette ? `Palette: ${character.palette}.` : ""} Keep identity, gender, face, outfit, age impression and silhouette consistent across every page.${referenceText}`;
}

function createCharacterSheetPrompt(character: CharacterTemplate) {
  const referenceText = character.referenceImages?.length
    ? `Existing reference labels: ${character.referenceImages.map((image) => image.label).join(", ")}.`
    : "No visual reference image is attached; infer the design from the written character setting.";
  return [
    "Create a polished character design sheet for a vertical web comic production workflow.",
    "The sheet should include front view, side view, back view, facial expression variations, and one small action pose.",
    "Use a clean professional layout, readable spacing, consistent proportions, consistent outfit, consistent face, and a neutral light background.",
    `Character name: ${character.name}`,
    `Character description: ${character.description}`,
    `Core visual prompt: ${character.prompt}`,
    `Palette hint: ${character.palette}`,
    referenceText,
    "Do not add random text blocks, watermarks, UI elements, signatures, or messy captions."
  ].join("\n");
}

function getCastCharacters(project: ComicProject) {
  const allCharacters = getAllCharacters(project);
  const knownIds = new Set(allCharacters.map((character) => character.id));
  if (Array.isArray(project.castCharacterIds)) {
    return project.castCharacterIds
      .filter((id) => knownIds.has(id))
      .map((id) => allCharacters.find((character) => character.id === id))
      .filter(Boolean) as CharacterTemplate[];
  }
  const resolvedIds = project.selectedCharacterId && knownIds.has(project.selectedCharacterId)
    ? [project.selectedCharacterId]
    : allCharacters[0]?.id
      ? [allCharacters[0].id]
      : [];
  return resolvedIds
    .map((id) => allCharacters.find((character) => character.id === id))
    .filter(Boolean) as CharacterTemplate[];
}

function getPageCharacters(project: ComicProject, page: ComicPage) {
  const allCharacters = getAllCharacters(project);
  const knownIds = new Set(allCharacters.map((character) => character.id));
  const pageIds = (page.characterIds ?? []).filter((id) => knownIds.has(id));
  const ids = pageIds.length ? pageIds : getCastCharacters(project).slice(0, 1).map((character) => character.id);
  return ids
    .map((id) => allCharacters.find((character) => character.id === id))
    .filter(Boolean) as CharacterTemplate[];
}

function getEnabledAnchors(project: ComicProject) {
  return (project.visualAnchors ?? []).filter((anchor) => anchor.enabled !== false);
}

function getPageAnchors(project: ComicProject, page: ComicPage) {
  const anchors = getEnabledAnchors(project);
  const knownIds = new Set(anchors.map((anchor) => anchor.id));
  return (page.anchorIds ?? [])
    .filter((id) => knownIds.has(id))
    .map((id) => anchors.find((anchor) => anchor.id === id))
    .filter(Boolean) as VisualAnchor[];
}

function getCharacterNames(characters: CharacterTemplate[]) {
  return characters.filter(Boolean).map((character) => character.name).join("、");
}

function buildAnchorPrompt(anchors: VisualAnchor[]) {
  return anchors
    .map((anchor) => {
      const imageText = anchor.images.length
        ? `Reference labels: ${anchor.images.map((image) => image.label).join(", ")}.`
        : "No image reference is attached.";
      return [
        `${anchorTypeLabel[anchor.type]} / ${anchor.name}`,
        anchor.description,
        anchor.usagePrompt,
        imageText,
        "Keep this anchor visually consistent when it appears. Use attached images only as visual reference; never draw reference sheets, labels, UI frames, watermarks, or white-background catalog layout unless explicitly requested."
      ]
        .filter(Boolean)
        .join(". ");
    })
    .join("\n");
}

function createPagePrompt(templates: PromptTemplates, characters: CharacterTemplate[], beat: string, shot: string, background: string) {
  return renderPromptTemplate(templates.imagePositive, {
    character: buildCastPrompt(characters) || "No fixed character sheet is selected. Design characters directly from the story and keep an original consistent comic style.",
    beat,
    shot,
    background
  });
}

function withStyleLock(prompt: string, project: ComicProject) {
  const style = project.styleLockPrompt?.trim();
  return style && !prompt.includes(style) ? `${prompt}\n\nProject style lock: ${style}` : prompt;
}

function suggestCastCharacterIds(story: string, allCharacters: CharacterTemplate[], currentIds: string[]) {
  const cleanStory = story.toLowerCase();
  const matched = allCharacters.filter((character) => cleanStory.includes(character.name.toLowerCase())).map((character) => character.id);
  const merged = [...matched, ...currentIds].filter(Boolean);
  return Array.from(new Set(merged)).slice(0, Math.max(1, Math.min(6, allCharacters.length)));
}

function createProjectRecord(project: ComicProject): ProjectRecord {
  const normalizedProject = normalizeProject(project);
  return {
    meta: {
      id: normalizedProject.id,
      name: normalizedProject.name || "未命名项目",
      updatedAt: normalizedProject.updatedAt,
      pageCount: normalizedProject.pages.length,
      doneCount: normalizedProject.pages.filter((page) => page.status === "done").length
    },
    project: normalizedProject
  };
}

function normalizeProject(project: ComicProject): ComicProject {
  return {
    ...defaultProject,
    ...project,
    pages: (project.pages ?? []).map((page) => ({ ...page, anchorIds: page.anchorIds ?? [] })),
    castCharacterIds: project.castCharacterIds ?? [],
    deletedCharacterIds: project.deletedCharacterIds ?? [],
    customCharacters: project.customCharacters ?? [],
    visualAnchors: (project.visualAnchors ?? []).map((anchor) => ({
      ...anchor,
      images: anchor.images ?? [],
      enabled: anchor.enabled !== false
    }))
  };
}

function normalizeProjectRecords(records: ProjectRecord[]) {
  return records.map((record) => createProjectRecord(record.project));
}

function projectAutosaveSignature(records: ProjectRecord[]) {
  return JSON.stringify(
    records.map((record) => ({
      meta: {
        id: record.meta.id,
        name: record.meta.name,
        pageCount: record.meta.pageCount,
        doneCount: record.meta.doneCount
      },
      project: {
        ...record.project,
        updatedAt: "",
        pages: record.project.pages.map(({ progress: _progress, ...page }) => page)
      }
    }))
  );
}

function touchProject(project: ComicProject, patch: Partial<ComicProject> = {}) {
  return { ...project, ...patch, updatedAt: new Date().toISOString() };
}

function createLogEntry(input: Omit<AppLogEntry, "id" | "time">): AppLogEntry {
  return {
    id: nowId("log"),
    time: new Date().toISOString(),
    ...input
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function useInitialState() {
  return useMemo(() => {
    const draft = loadDraft();
    const savedProvidersWithoutKeys = draft?.providers?.length
      ? draft.providers.map((provider) => ({ ...defaultProvider, ...provider, apiKey: "" }))
      : [draft?.provider ? { ...defaultProvider, ...draft.provider, apiKey: "" } : defaultProvider];
    const savedProviders = hydrateProvidersFromCache(savedProvidersWithoutKeys);
    const project = normalizeProject(draft?.project ?? defaultProject);
    const projects = normalizeProjectRecords(draft?.projects ?? [createProjectRecord(project)]);
    return {
      project,
      projects,
      activeProjectId: draft?.activeProjectId ?? project.id,
      providers: savedProviders,
      activeProviderId: draft?.activeProviderId ?? savedProviders[0].id,
      models: draft?.models ?? defaultModels,
      templates: draft?.templates ?? promptTemplates,
      workflow: draft?.workflow ?? defaultWorkflow
    };
  }, []);
}

function ratioClass(ratio: ExportRatio) {
  if (ratio === "1:1") return "aspect-square";
  if (ratio === "4:5") return "aspect-[4/5]";
  return "aspect-[3/4]";
}

function imageSizeForRatio(ratio: ExportRatio) {
  if (ratio === "1:1") return "1024x1024";
  if (ratio === "4:5") return "1024x1280";
  return "1024x1536";
}

function statusClass(status: PageStatus) {
  const classes: Record<PageStatus, string> = {
    draft: "border-zinc-300 bg-zinc-100 text-zinc-700",
    queued: "border-sky-200 bg-sky-50 text-sky-700",
    generating: "border-teal-200 bg-teal-50 text-teal-700",
    done: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-rose-200 bg-rose-50 text-rose-700"
  };
  return classes[status];
}

function ToolButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function PageStatusPill({ status }: { status: PageStatus }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${statusClass(status)}`}>{statusLabel[status]}</span>;
}

function CharacterMultiSelect({
  characters,
  selectedIds,
  onChange,
  compact = false
}: {
  characters: CharacterTemplate[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  compact?: boolean;
}) {
  function toggle(characterId: string) {
    const next = selectedIds.includes(characterId)
      ? selectedIds.filter((id) => id !== characterId)
      : [...selectedIds, characterId];
    onChange(next);
  }

  if (!characters.length) {
    return (
      <div className="rounded-md border border-dashed bg-[#fbfaf6] p-3 text-xs leading-5 text-muted-foreground">
        当前项目还没有人设。可以在人设页新建，或从其他项目导入。
      </div>
    );
  }

  return (
    <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2"}>
      {characters.map((character, index) => {
        const active = selectedIds.includes(character.id);
        const preview = character.characterSheetUrl ?? character.referenceImages?.[0]?.url;
        return (
          <button
            type="button"
            key={character.id}
            title={`${active ? "移出" : "加入"}角色 ${String.fromCharCode(65 + index)}：${character.name}`}
            className={`flex min-w-0 items-center gap-2 rounded-md border p-2 text-left transition ${
              active ? "border-teal-500 bg-teal-50 text-teal-950" : "border-[#ded8cc] bg-white hover:bg-[#f7f3ea]"
            }`}
            onClick={() => toggle(character.id)}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-white text-[11px] font-semibold">
              {preview ? <img src={preview} alt={character.name} className="h-full w-full object-cover" /> : String.fromCharCode(65 + index)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{character.name}</span>
            {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function AnchorMultiSelect({
  anchors,
  selectedIds,
  onChange,
  compact = false
}: {
  anchors: VisualAnchor[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  compact?: boolean;
}) {
  function toggle(anchorId: string) {
    const next = selectedIds.includes(anchorId)
      ? selectedIds.filter((id) => id !== anchorId)
      : [...selectedIds, anchorId];
    onChange(next);
  }

  if (!anchors.length) {
    return (
      <div className="rounded-md border border-dashed bg-[#fbfaf6] p-3 text-xs leading-5 text-muted-foreground">
        当前项目还没有素材锚点。可以在素材页上传产品白图、道具或固定场景。
      </div>
    );
  }

  return (
    <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2"}>
      {anchors.map((anchor) => {
        const active = selectedIds.includes(anchor.id);
        const preview = anchor.primaryImageUrl ?? anchor.images[0]?.url;
        return (
          <button
            type="button"
            key={anchor.id}
            title={`${active ? "移除" : "添加"}素材锚点：${anchor.name}`}
            className={`flex min-w-0 items-center gap-2 rounded-md border p-2 text-left transition ${
              active ? "border-teal-500 bg-teal-50" : "border-[#ded8cc] bg-white hover:bg-[#f7f3ea]"
            }`}
            onClick={() => toggle(anchor.id)}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">
              {preview ? <img src={preview} alt={anchor.name} className="h-full w-full object-contain" /> : <Layers3 className="h-4 w-4 text-teal-600" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{anchor.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{anchorTypeLabel[anchor.type]}</span>
            </span>
            {active ? <Check className="h-4 w-4 shrink-0 text-teal-600" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function Shell({
  activeTab,
  setActiveTab,
  project,
  projects,
  doneCount,
  provider,
  isBusy,
  isDark,
  setIsDark,
  onPlan,
  onGenerate,
  onSave,
  latestLog,
  openLogs,
  children
}: {
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  project: ComicProject;
  projects: ProjectRecord[];
  doneCount: number;
  provider: ApiProvider;
  isBusy: boolean;
  isDark: boolean;
  setIsDark: (value: boolean) => void;
  onPlan: () => void;
  onGenerate: (mock: boolean) => void;
  onSave: () => void;
  latestLog?: AppLogEntry;
  openLogs: () => void;
  children: React.ReactNode;
}) {
  const activeLabel = navItems.find((item) => item.id === activeTab)?.label ?? "创作台";
  const completion = project.pages.length ? Math.round((doneCount / project.pages.length) * 100) : 0;

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f2ed] text-zinc-950 dark:bg-[#f4f2ed] dark:text-zinc-950">
      <aside className="flex h-screen w-[248px] shrink-0 flex-col border-r border-[#ded8cc] bg-[#fbfaf6] text-zinc-950 shadow-sm">
        <div className="border-b border-[#ded8cc] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#1aa99a] text-white">
              <GalleryVerticalEnd className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">AI Comic Studio</div>
              <div className="truncate text-xs text-zinc-500">桌面漫画生成客户端</div>
            </div>
          </div>
        </div>

        <nav className="space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                type="button"
                key={item.id}
                title={`切换到${item.label}`}
                className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition ${
                  active ? "bg-[#e7f3ef] text-[#0f766e]" : "text-zinc-500 hover:bg-[#f0ebe1] hover:text-zinc-950"
                }`}
                onClick={() => setActiveTab(item.id)}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-[#ded8cc] p-4">
          <div className="rounded-md border border-[#ded8cc] bg-white p-3">
            <div className="text-xs text-zinc-500">当前项目</div>
            <div className="mt-1 truncate text-sm font-medium">{project.name}</div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span>{projects.length} 项目 · {project.pages.length} 页</span>
              <span>{completion}%</span>
            </div>
            <Progress value={completion} className="mt-2 bg-[#eee8dc]" />
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
            <span>{isDark ? "深色模式" : "浅色模式"}</span>
            <Switch checked={isDark} onCheckedChange={setIsDark} aria-label="切换浅色或深色模式" title="切换浅色或深色模式" />
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[#ded8cc] bg-white/80 px-5 backdrop-blur">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">工作区 / {activeLabel}</div>
            <h1 className="mt-0.5 truncate text-lg font-semibold tracking-normal">{project.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge className={provider.apiKey ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
              {provider.apiKey ? "API 已配置" : "Mock 可用"}
            </Badge>
            <ToolButton label="保存草稿" onClick={onSave}>
              <Save className="h-4 w-4" />
            </ToolButton>
            <Button variant="outline" onClick={onPlan} disabled={isBusy}>
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              生成大纲
            </Button>
            <Button variant="secondary" disabled={isBusy || !project.pages.length} onClick={() => onGenerate(true)}>
              <Sparkles className="h-4 w-4" />
              Mock 出图
            </Button>
            <Button disabled={isBusy || !project.pages.length || !provider.apiKey} onClick={() => onGenerate(false)}>
              <Play className="h-4 w-4" />
              API 并发生成
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="min-w-0 flex-1 overflow-hidden">{children}</section>
        </div>
        {latestLog ? (
          <button
            type="button"
            title="打开日志中心"
            className={`flex h-9 shrink-0 items-center gap-3 border-t px-5 text-left text-xs ${
              latestLog.level === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : latestLog.level === "warn"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-[#ded8cc] bg-[#fbfaf6] text-zinc-600"
            }`}
            onClick={openLogs}
          >
            <span className="shrink-0 font-semibold">最近日志</span>
            <span className="min-w-0 flex-1 truncate">{latestLog.message}</span>
            <span className="shrink-0">{latestLog.module} / {latestLog.action}</span>
          </button>
        ) : null}
      </main>
    </div>
  );
}

function StudioView({
  project,
  setProject,
  onPlan,
  onGenerate,
  onSuggestCast,
  regeneratePage,
  canUseApi,
  plannerModeLabel,
  plannerModeDescription,
  onRatioChange,
  openStoryboard
}: {
  project: ComicProject;
  setProject: React.Dispatch<React.SetStateAction<ComicProject>>;
  onPlan: () => void;
  onGenerate: (mock: boolean) => void;
  onSuggestCast: () => void;
  regeneratePage: (pageId: string, mock: boolean) => void;
  canUseApi: boolean;
  plannerModeLabel: string;
  plannerModeDescription: string;
  onRatioChange: (ratio: ExportRatio) => void;
  openStoryboard: () => void;
}) {
  const allCharacters = getAllCharacters(project);
  const castCharacters = getCastCharacters(project);
  const heroPage = project.pages.find((page) => page.id === project.selectedPageId) ?? project.pages.find((page) => page.imageUrl) ?? project.pages[0];
  const heroCharacters = heroPage ? getPageCharacters(project, heroPage) : [];
  const heroRatio = heroPage?.ratio ?? project.exportRatio;

  return (
    <div className="h-full min-w-0 overflow-auto p-5 scrollbar-thin">
      <div className="grid min-h-full grid-cols-[minmax(360px,0.95fr)_minmax(390px,1.05fr)] gap-4 max-[1100px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
            <div className="border-b border-[#ded8cc] bg-[#fbfaf6] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-teal-600">Story Input</div>
                  <h2 className="mt-1 truncate text-lg font-semibold">从故事到漫画分镜</h2>
                  <p className="mt-1 text-sm text-muted-foreground">先写故事，再生成大纲、分镜和竖屏页面。</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge className="max-w-[220px] truncate">{getCharacterNames(castCharacters) || "未选择演员表"}</Badge>
                  <Badge className="max-w-[220px] truncate border border-zinc-200 bg-white text-zinc-700" title={plannerModeDescription}>
                    分镜来源：{plannerModeLabel}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="grid items-start gap-4 p-4 xl:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-2 flex h-11 items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold leading-none">故事输入</div>
                    <p className="mt-1 text-xs text-muted-foreground">输入完整故事或一句梗概。</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{project.storyInput.length} 字</span>
                </div>
                <Textarea
                  className="h-36 resize-none border-zinc-200 bg-[#faf9f5] text-[15px] leading-7"
                  value={project.storyInput}
                  onChange={(event) => setProject((prev) => ({ ...prev, storyInput: event.target.value, updatedAt: new Date().toISOString() }))}
                />
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex h-11 items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold leading-none">漫画大纲</div>
                    <p className="text-xs text-muted-foreground">生成后可直接微调。</p>
                  </div>
                  <Badge className="shrink-0 border border-zinc-200 bg-transparent text-zinc-700">{project.pages.length || 0} 页</Badge>
                </div>
                <Textarea
                  className="h-36 resize-none border-zinc-200 bg-[#faf9f5] leading-6"
                  value={project.outline}
                  placeholder="生成后会显示主题、角色、冲突、转折和结尾。"
                  onChange={(event) => setProject((prev) => ({ ...prev, outline: event.target.value, updatedAt: new Date().toISOString() }))}
                />
              </div>
            </div>

            <div className="border-t border-[#ded8cc] bg-[#fbfaf6] p-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="min-w-0">
                  <Label>画面比例</Label>
                  <Select value={project.exportRatio} onValueChange={(value) => onRatioChange(value as ExportRatio)}>
                    <SelectTrigger className="mt-1 min-w-0 bg-white" title="选择漫画页面比例">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ratioLabel).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <Label>页数模式</Label>
                  <Select
                    value={project.targetPageCount === 0 ? "auto" : "manual"}
                    onValueChange={(value) => setProject((prev) => ({ ...prev, targetPageCount: value === "auto" ? 0 : prev.targetPageCount || 8, updatedAt: new Date().toISOString() }))}
                  >
                    <SelectTrigger className="mt-1 min-w-0 bg-white" title="选择由 AI 自动决定页数，或手动指定页数">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">AI 自动</SelectItem>
                      <SelectItem value="manual">手动页数</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <Label>{project.targetPageCount > 0 ? "目标页数" : "自动范围"}</Label>
                  {project.targetPageCount > 0 ? (
                    <Input
                      className="mt-1 bg-white"
                      min={1}
                      max={30}
                      type="number"
                      value={project.targetPageCount}
                      title="设置大纲和分镜生成的目标页数，范围 1-30 页"
                      onChange={(event) => setProject((prev) => ({ ...prev, targetPageCount: Math.min(30, Math.max(1, Number(event.target.value) || 1)), updatedAt: new Date().toISOString() }))}
                    />
                  ) : (
                    <div className="mt-1 flex h-10 items-center rounded-md border bg-white px-3 text-sm text-zinc-600">6-12 页</div>
                  )}
                </div>
                <div className="min-w-0">
                  <Label>并发数</Label>
                  <Input
                    className="mt-1 bg-white"
                    min={1}
                    max={10}
                    type="number"
                    value={project.concurrency}
                    onChange={(event) => setProject((prev) => ({ ...prev, concurrency: Math.min(10, Math.max(1, Number(event.target.value) || 1)) }))}
                  />
                </div>
              </div>
              <div className="mt-4 grid items-center gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={onPlan} title="根据故事生成漫画大纲和分镜">
                    <Wand2 className="h-4 w-4" />
                    生成大纲和分镜
                  </Button>
                  <Button variant="outline" disabled={!project.pages.length} onClick={() => onGenerate(true)} title="用本地 Mock 生成演示图">
                    <ImagePlus className="h-4 w-4" />
                    生成演示图
                  </Button>
                </div>
                <div className="min-w-0 text-xs leading-5 text-muted-foreground lg:text-right">
                  {plannerModeDescription}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <Label>项目演员表</Label>
                    <p className="mt-1 text-xs text-muted-foreground">只影响当前项目参与剧情和生图的角色。</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={onSuggestCast} title="根据故事自动建议项目演员表">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI 建议
                  </Button>
                </div>
                <div className="max-h-44 overflow-auto pr-1 scrollbar-thin">
                  <CharacterMultiSelect
                    characters={allCharacters}
                    selectedIds={project.castCharacterIds ?? []}
                    onChange={(ids) =>
                      setProject((prev) => ({
                        ...prev,
                        castCharacterIds: ids,
                        selectedCharacterId: ids[0] ?? prev.selectedCharacterId,
                        updatedAt: new Date().toISOString()
                      }))
                    }
                  />
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between">
                  <Label>项目画风锁定</Label>
                  <Badge className="border border-zinc-200 bg-transparent text-zinc-700">Style Lock</Badge>
                </div>
                <Textarea
                  className="h-44 resize-none bg-[#faf9f5] text-xs leading-5"
                  value={project.styleLockPrompt}
                  onChange={(event) => setProject((prev) => ({ ...prev, styleLockPrompt: event.target.value, updatedAt: new Date().toISOString() }))}
                />
                <p className="mt-2 text-xs leading-5 text-muted-foreground">会自动注入分镜、API 生图和单页重绘，用来保持线条、配色、比例和光照一致。</p>
              </div>
            </div>
          </section>
        </div>

        <section className="flex min-h-[560px] min-w-0 flex-col rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-teal-600">Live Preview</div>
              <h2 className="mt-1 truncate text-lg font-semibold">竖屏漫画画布</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {heroPage ? `当前预览 P${heroPage.pageNumber} · ${heroPage.title}` : "先生成大纲和分镜"}
              </p>
            </div>
            {heroPage ? <PageStatusPill status={heroPage.status} /> : null}
          </div>

          <div className="flex min-h-[390px] flex-1 items-center justify-center rounded-md border border-[#ded8cc] bg-[#f7f3ea] p-4">
            {heroPage?.imageUrl ? (
              <motion.div
                key={heroPage.id + heroPage.imageUrl}
                className="w-[min(100%,420px,42vh)]"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <ComicImageFrame src={heroPage.imageUrl} alt={heroPage.title} ratio={heroRatio} fit="contain" className="rounded-md bg-white shadow-2xl" />
              </motion.div>
            ) : heroPage ? (
              <div className={`flex w-[min(100%,420px,42vh)] flex-col items-center justify-center rounded-md border border-[#ded8cc] bg-white p-8 text-center ${ratioClass(heroRatio)}`}>
                <Layers3 className="mb-3 h-10 w-10 text-teal-600" />
                <div className="text-sm font-medium">P{heroPage.pageNumber} {heroPage.title}</div>
                <p className="mt-2 max-w-[260px] text-xs leading-5 text-zinc-500">{heroPage.beat}</p>
                <PageStatusPill status={heroPage.status} />
              </div>
            ) : (
              <div className="text-center text-sm text-zinc-500">
                <Bot className="mx-auto mb-3 h-10 w-10" />
                先生成大纲和分镜
              </div>
            )}
          </div>
          {heroPage ? (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-3 max-lg:grid-cols-1">
              <div className="min-w-0 rounded-md border border-[#ded8cc] bg-[#fbfaf6] p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-sm font-semibold">P{heroPage.pageNumber}</span>
                  <span className="min-w-0 truncate text-sm font-medium">{heroPage.title}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{heroPage.beat}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {heroCharacters.map((character) => (
                    <Badge key={character.id} className="max-w-full border-teal-100 bg-teal-50 text-[10px] text-teal-800">
                      <span className="truncate">{character.name}</span>
                    </Badge>
                  ))}
                </div>
                {heroPage.error ? <p className="mt-2 line-clamp-2 text-xs text-rose-600">{heroPage.error}</p> : null}
              </div>
              <div className="flex flex-wrap content-start gap-2 lg:w-[300px]">
                <Button variant="outline" onClick={openStoryboard} title="进入分镜板编辑当前页面">
                  <PanelRight className="h-4 w-4" />
                  编辑分镜
                </Button>
                <Button variant="outline" onClick={() => regeneratePage(heroPage.id, true)} title="用本地 Mock 重绘当前页">
                  <Sparkles className="h-4 w-4" />
                  Mock 预览
                </Button>
                <Button disabled={!canUseApi} onClick={() => regeneratePage(heroPage.id, false)} title="用当前图片模型重绘当前页">
                  <RefreshCw className="h-4 w-4" />
                  API 重绘
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 border-t border-[#ded8cc] pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">页面胶片条</div>
                <p className="truncate text-xs text-muted-foreground">横向选择页面，画布会立即切换到对应页。</p>
              </div>
              <Badge className="border border-zinc-200 bg-transparent text-zinc-700">{project.pages.length} 页</Badge>
            </div>
            <div className="mt-3 flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
              {project.pages.length ? (
                project.pages.map((page) => (
                  <button
                    type="button"
                    key={page.id}
                    title={`选择第 ${page.pageNumber} 页：${page.title}`}
                    className={`w-32 shrink-0 rounded-md border bg-[#fbfaf6] p-2 text-left text-xs transition ${
                      project.selectedPageId === page.id ? "border-teal-500 bg-teal-50 ring-2 ring-teal-500/15" : "border-[#ded8cc] hover:bg-white"
                    }`}
                    onClick={() => setProject((prev) => ({ ...prev, selectedPageId: page.id, updatedAt: new Date().toISOString() }))}
                  >
                    <div className={`relative overflow-hidden rounded border border-[#ded8cc] bg-white ${ratioClass(page.ratio)}`}>
                      {page.imageUrl ? (
                        <ComicImageFrame src={page.imageUrl} alt={page.title} ratio={page.ratio} fit="cover" className="absolute inset-0 h-full w-full" />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px] text-zinc-500">
                          {page.status === "generating" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                          {statusLabel[page.status]}
                        </div>
                      )}
                      <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                        <Badge className="bg-white/95 px-1.5 py-0 text-[10px] text-zinc-950">P{page.pageNumber}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 flex min-w-0 items-center justify-between gap-1">
                      <span className="min-w-0 flex-1 truncate font-medium">{page.title}</span>
                      <PageStatusPill status={page.status} />
                    </div>
                    <p className="mt-1 line-clamp-2 break-words text-zinc-500">{page.beat}</p>
                  </button>
                ))
              ) : (
                <div className="flex h-28 min-w-full items-center justify-center rounded-md border border-dashed border-[#ded8cc] bg-[#fbfaf6] text-sm text-zinc-500">
                  生成大纲后会显示每页缩略图
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StoryboardView({
  project,
  setProject,
  regeneratePage,
  createNewPage,
  inspectorOpen,
  setInspectorOpen,
  canUseApi,
  templates
}: {
  project: ComicProject;
  setProject: React.Dispatch<React.SetStateAction<ComicProject>>;
  regeneratePage: (pageId: string, mock: boolean) => void;
  createNewPage: () => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  canUseApi: boolean;
  templates: PromptTemplates;
}) {
  const [previewPage, setPreviewPage] = useState<ComicPage | undefined>();

  function editPage(pageId: string) {
    setProject((prev) => ({ ...prev, selectedPageId: pageId }));
    setInspectorOpen(true);
  }

  function movePage(pageId: string, direction: -1 | 1) {
    setProject((prev) => {
      const index = prev.pages.findIndex((page) => page.id === pageId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.pages.length) return prev;
      const pages = [...prev.pages];
      const [page] = pages.splice(index, 1);
      pages.splice(nextIndex, 0, page);
      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        pages: pages.map((item, itemIndex) => ({ ...item, pageNumber: itemIndex + 1 }))
      };
    });
  }

  function deletePage(pageId: string) {
    setProject((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      selectedPageId: prev.selectedPageId === pageId ? prev.pages.find((page) => page.id !== pageId)?.id : prev.selectedPageId,
      pages: prev.pages.filter((page) => page.id !== pageId).map((page, index) => ({ ...page, pageNumber: index + 1 }))
    }));
  }

  return (
    <div className="relative h-full min-w-0 overflow-hidden">
      <div className="h-full min-w-0 overflow-auto p-5 scrollbar-thin">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">分镜板</h2>
            <p className="truncate text-sm text-muted-foreground">点图片看大图；点编辑进入单页调整。</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button onClick={createNewPage}>
              <ImagePlus className="h-4 w-4" />
              新增页面
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {project.pages.map((page, index) => (
            <motion.article
              key={page.id}
              className={`group overflow-hidden rounded-lg border bg-white shadow-sm transition ${
                project.selectedPageId === page.id ? "border-teal-500 ring-2 ring-teal-500/20" : "hover:border-teal-400"
              }`}
              onClick={() => setProject((prev) => ({ ...prev, selectedPageId: page.id }))}
            >
              <button
                type="button"
                title={page.imageUrl ? `查看第 ${page.pageNumber} 页大图` : `编辑第 ${page.pageNumber} 页`}
                className={`relative block w-full bg-[#f7f3ea] text-left ${ratioClass(page.ratio)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setProject((prev) => ({ ...prev, selectedPageId: page.id }));
                  if (page.imageUrl) {
                    setPreviewPage(page);
                  } else {
                    editPage(page.id);
                  }
                }}
              >
                {page.imageUrl ? (
                  <ComicImageFrame src={page.imageUrl} alt={page.title} ratio={page.ratio} fit="cover" className="absolute inset-0 h-full w-full" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    {page.status === "generating" ? <Loader2 className="h-7 w-7 animate-spin" /> : <ImagePlus className="h-7 w-7" />}
                    {statusLabel[page.status]}
                  </div>
                )}
                <div className="absolute left-2 top-2 flex items-center gap-1">
                  <Badge className="bg-white/95 text-zinc-950">P{page.pageNumber}</Badge>
                  <PageStatusPill status={page.status} />
                </div>
              </button>
              <div className="space-y-3 p-3">
                <button
                  type="button"
                  title={`编辑第 ${page.pageNumber} 页`}
                  className="block w-full text-left"
                  onClick={(event) => {
                    event.stopPropagation();
                    editPage(page.id);
                  }}
                >
                  <div className="truncate text-sm font-semibold">{page.title}</div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{page.beat}</p>
                </button>
                <div className="flex flex-wrap gap-1">
                  {getPageCharacters(project, page).map((character) => (
                    <Badge key={character.id} className="max-w-full border-teal-100 bg-teal-50 text-[11px] text-teal-800">
                      <span className="truncate">{character.name}</span>
                    </Badge>
                  ))}
                  {getPageAnchors(project, page).map((anchor) => (
                    <Badge key={anchor.id} className="max-w-full border-amber-100 bg-amber-50 text-[11px] text-amber-800">
                      <span className="truncate">{anchor.name}</span>
                    </Badge>
                  ))}
                </div>
                <Progress value={page.progress} />
                <div className="grid grid-cols-5 gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`编辑第 ${page.pageNumber} 页`}
                    onClick={(event) => { event.stopPropagation(); editPage(page.id); }}
                  >
                    <PanelRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={index === 0}
                    aria-label={`将第 ${page.pageNumber} 页前移`}
                    onClick={(event) => { event.stopPropagation(); movePage(page.id, -1); }}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={index === project.pages.length - 1}
                    aria-label={`将第 ${page.pageNumber} 页后移`}
                    onClick={(event) => { event.stopPropagation(); movePage(page.id, 1); }}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canUseApi}
                    aria-label={`用 API 重新生成第 ${page.pageNumber} 页`}
                    onClick={(event) => { event.stopPropagation(); regeneratePage(page.id, false); }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    aria-label={`删除第 ${page.pageNumber} 页`}
                    onClick={(event) => { event.stopPropagation(); deletePage(page.id); }}
                  >
                    ×
                  </Button>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {inspectorOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="关闭单页编辑"
              title="关闭单页编辑"
              className="absolute inset-0 z-20 bg-zinc-950/20"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setInspectorOpen(false)}
            />
            <Inspector project={project} setProject={setProject} regeneratePage={regeneratePage} onClose={() => setInspectorOpen(false)} canUseApi={canUseApi} templates={templates} />
          </>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {previewPage?.imageUrl ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewPage(undefined)}
          >
            <motion.div
              className="relative max-h-full max-w-5xl overflow-hidden rounded-lg border bg-white shadow-2xl"
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-12 items-center justify-between border-b px-4">
                <div className="min-w-0 truncate text-sm font-semibold">P{previewPage.pageNumber} {previewPage.title}</div>
                <Button size="icon" variant="ghost" onClick={() => setPreviewPage(undefined)} aria-label="关闭图片预览">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex max-h-[calc(100vh-120px)] max-w-[calc(100vw-48px)] items-center justify-center bg-[#f7f3ea] p-3">
                <img src={previewPage.imageUrl} alt={previewPage.title} className="max-h-[calc(100vh-150px)] max-w-full object-contain" />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function CharactersView({
  project,
  projects,
  setProject,
  imageProvider,
  imageModel,
  onToast,
  addLog
}: {
  project: ComicProject;
  projects: ProjectRecord[];
  setProject: React.Dispatch<React.SetStateAction<ComicProject>>;
  imageProvider: ApiProvider;
  imageModel: ModelConfig;
  onToast: (title: string, description: string) => void;
  addLog: (entry: Omit<AppLogEntry, "id" | "time">) => void;
}) {
  const [generatingCharacterIds, setGeneratingCharacterIds] = useState<Set<string>>(() => new Set());
  const generatingCharacterIdsRef = useRef<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | undefined>();
  const allCharacters = getAllCharacters(project);
  const selectedCharacter = allCharacters.find((item) => item.id === project.selectedCharacterId) ?? allCharacters[0];
  const isSelectedCharacterGenerating = selectedCharacter ? generatingCharacterIds.has(selectedCharacter.id) : false;
  const referenceCount = selectedCharacter?.referenceImages?.length ?? 0;
  const mainImageUrl = selectedCharacter?.characterSheetUrl ?? selectedCharacter?.referenceImages?.[0]?.url;
  const importableCharacters = projects
    .filter((record) => record.meta.id !== project.id)
    .flatMap((record) =>
      getAllCharacters(record.project).map((character) => ({
        projectId: record.meta.id,
        projectName: record.meta.name,
        character
      }))
    );

  function uniqueCharacterName(baseName: string) {
    const names = new Set(getAllCharacters(project).map((character) => character.name));
    if (!names.has(baseName)) return baseName;
    let index = 2;
    let candidate = `${baseName}（导入）`;
    while (names.has(candidate)) {
      candidate = `${baseName}（导入${index}）`;
      index += 1;
    }
    return candidate;
  }

  function createCharacter() {
    const createdAt = new Date().toISOString();
    const character: CharacterTemplate = {
      id: nowId("character"),
      name: "新建人设",
      description: "填写角色身份、性格、年龄感、服装、发型、标志物和情绪范围。",
      palette: "#111827,#ffffff,#14b8a6",
      prompt:
        "original comic character, consistent face and outfit, clean silhouette, expressive eyes, readable design, suitable for vertical social comic",
      referenceImages: [],
      createdAt,
      updatedAt: createdAt
    };
              setProject((prev) => ({
                ...prev,
                selectedCharacterId: character.id,
                castCharacterIds: Array.from(new Set([...(prev.castCharacterIds ?? []), character.id])),
                customCharacters: [...(prev.customCharacters ?? []), character],
                updatedAt: createdAt
              }));
  }

  function patchCharacterById(characterId: string, patch: Partial<CharacterTemplate>) {
    const current = findCharacter(characterId);
    if (!current) return;
    setProject((prev) => ({
      ...prev,
      customCharacters: (() => {
        const updated = { ...current, ...patch, id: characterId, updatedAt: new Date().toISOString() };
        const exists = (prev.customCharacters ?? []).some((character) => character.id === characterId);
        return exists
          ? (prev.customCharacters ?? []).map((character) => (character.id === characterId ? updated : character))
          : [...(prev.customCharacters ?? []), updated];
      })(),
      updatedAt: new Date().toISOString()
    }));
  }

  function findCharacter(characterId: string) {
    return getAllCharacters(project).find((character) => character.id === characterId);
  }

  function patchSelectedCharacter(patch: Partial<CharacterTemplate>) {
    if (!selectedCharacter) return;
    patchCharacterById(selectedCharacter.id, patch);
  }

  function setCharacterGenerating(characterId: string, isGenerating: boolean) {
    const next = new Set(generatingCharacterIdsRef.current);
    if (isGenerating) {
      next.add(characterId);
    } else {
      next.delete(characterId);
    }
    generatingCharacterIdsRef.current = next;
    setGeneratingCharacterIds(next);
  }

  function deleteCharacter(characterId: string) {
    setProject((prev) => {
      const deletedIds = new Set([...(prev.deletedCharacterIds ?? []), characterId]);
      const customCharacters = (prev.customCharacters ?? []).filter((character) => character.id !== characterId);
      const nextCharacters = getAllCharacters({
        ...prev,
        customCharacters,
        deletedCharacterIds: Array.from(deletedIds)
      }).filter((character) => character.id !== characterId);
      const nextSelectedId = prev.selectedCharacterId === characterId ? nextCharacters[0]?.id ?? "" : prev.selectedCharacterId;
      return {
        ...prev,
        customCharacters,
        deletedCharacterIds: Array.from(deletedIds),
        selectedCharacterId: nextSelectedId,
        castCharacterIds: (prev.castCharacterIds ?? []).filter((id) => id !== characterId),
        pages: prev.pages.map((page) => ({
          ...page,
          characterIds: (page.characterIds ?? []).filter((id) => id !== characterId)
        })),
        updatedAt: new Date().toISOString()
      };
    });
  }

  function importCharacterFromProject(sourceCharacter: CharacterTemplate, sourceProjectName: string) {
    const createdAt = new Date().toISOString();
    const imported: CharacterTemplate = {
      ...sourceCharacter,
      id: nowId("character"),
      name: uniqueCharacterName(sourceCharacter.name),
      referenceImages: (sourceCharacter.referenceImages ?? []).map((image) => ({
        ...image,
        id: nowId("ref"),
        createdAt
      })),
      createdAt,
      updatedAt: createdAt
    };
    setProject((prev) => ({
      ...prev,
      selectedCharacterId: imported.id,
      castCharacterIds: Array.from(new Set([...(prev.castCharacterIds ?? []), imported.id])),
      customCharacters: [...(prev.customCharacters ?? []), imported],
      deletedCharacterIds: (prev.deletedCharacterIds ?? []).filter((id) => id !== imported.id),
      updatedAt: createdAt
    }));
    onToast("已导入人设", `已从「${sourceProjectName}」导入「${sourceCharacter.name}」。`);
  }

  async function uploadReferenceImages(characterId: string, files: FileList | null) {
    const targetCharacter = findCharacter(characterId);
    if (!targetCharacter || !files?.length) return;
    const createdAt = new Date().toISOString();
    const images = await Promise.all(
      Array.from(files).map(async (file, index) => {
        const rawUrl = await fileToDataUrl(file);
        const url = await persistImageAsset(project.id, rawUrl, `character-${characterId}-reference-${index + 1}-${file.name}`);
        return {
          id: nowId("ref"),
          label: file.name.replace(/\.[^.]+$/, "") || `参考图 ${index + 1}`,
          url: url ?? rawUrl,
          createdAt
        };
      })
    );
    patchCharacterById(characterId, {
      referenceImages: [...(targetCharacter.referenceImages ?? []), ...images]
    });
  }

  function removeReferenceImage(characterId: string, imageId: string) {
    const targetCharacter = findCharacter(characterId);
    if (!targetCharacter) return;
    const removedImage = (targetCharacter.referenceImages ?? []).find((image) => image.id === imageId);
    const referenceImages = (targetCharacter.referenceImages ?? []).filter((image) => image.id !== imageId);
    const characterSheetUrl = removedImage?.url === targetCharacter.characterSheetUrl ? referenceImages[0]?.url : targetCharacter.characterSheetUrl;
    patchCharacterById(characterId, {
      referenceImages,
      characterSheetUrl
    });
  }

  function setPrimaryReferenceImage(characterId: string, imageId: string) {
    const targetCharacter = findCharacter(characterId);
    const image = targetCharacter?.referenceImages?.find((item) => item.id === imageId);
    if (!targetCharacter || !image) return;
    patchCharacterById(characterId, { characterSheetUrl: image.url });
    onToast("已设置主参考", `后续漫画页生成会优先使用「${image.label}」。`);
  }

  async function generateCharacterSheet(characterId: string) {
    const targetCharacter = findCharacter(characterId);
    if (!targetCharacter) return;
    if (generatingCharacterIdsRef.current.has(characterId)) return;
    setCharacterGenerating(characterId, true);
    const projectId = project.id;
    let characterSheetUrl = "";
    let label = "角色设定图";
    addLog({ level: "info", module: "image", action: "character-start", message: `开始生成人设图：${targetCharacter.name}`, projectId, detail: imageModel.model });
    try {
      if (!imageProvider.apiKey.trim()) throw new Error("图片模型渠道还没有配置 API Key。");
      const page: ComicPage = {
        id: nowId("character_page"),
        pageNumber: 1,
        title: `${targetCharacter.name} 角色设定图`,
        beat: targetCharacter.description,
        shot: "character sheet, front view, side view, back view, expressions, action pose",
        character: targetCharacter.name,
        characterIds: [targetCharacter.id],
        background: "neutral clean studio background",
        ratio: "4:5",
        prompt: createCharacterSheetPrompt(targetCharacter),
        negativePrompt: "low quality, blurry, watermark, messy layout, inconsistent character, unreadable text, extra limbs",
        modelId: imageModel.id,
        status: "draft",
        progress: 0,
        seed: Math.floor(Math.random() * 100000),
        versions: []
      };
      characterSheetUrl = await generateImageWithNewApi({ provider: imageProvider, model: imageModel, page, characters: [targetCharacter], purpose: "character-sheet" });
      characterSheetUrl = (await persistImageAsset(projectId, characterSheetUrl, `character-${characterId}-sheet-${nowId("asset")}`)) ?? characterSheetUrl;
      label = "API 角色设定图";
      setProject((prev) => {
        if (prev.id !== projectId) return prev;
        const current = getAllCharacters(prev).find((character) => character.id === characterId);
        if (!current) return prev;
        const createdAt = new Date().toISOString();
        const updated: CharacterTemplate = {
          ...current,
          id: characterId,
          characterSheetUrl,
          referenceImages: [
            ...(current.referenceImages ?? []),
            {
              id: nowId("ref"),
              label,
              url: characterSheetUrl,
              createdAt
            }
          ],
          updatedAt: createdAt
        };
        const exists = (prev.customCharacters ?? []).some((character) => character.id === characterId);
        return {
          ...prev,
          customCharacters: exists
            ? (prev.customCharacters ?? []).map((character) => (character.id === characterId ? updated : character))
            : [...(prev.customCharacters ?? []), updated],
          updatedAt: createdAt
        };
      });
      addLog({ level: "success", module: "image", action: "character-done", message: `人设图生成完成：${targetCharacter.name}`, projectId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片模型生成失败。";
      onToast("人设图生成失败", message);
      addLog({ level: "error", module: "image", action: "character-failed", message: `人设图生成失败：${targetCharacter.name}`, projectId, detail: message });
    } finally {
      setCharacterGenerating(characterId, false);
    }
  }

  return (
    <div className="grid h-full grid-cols-[minmax(280px,340px)_minmax(0,1fr)] gap-4 overflow-hidden p-5">
      <section className="flex min-h-0 flex-col rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">人设库</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">保存角色设定图和你上传的正面、侧面、背面、表情参考。</p>
          </div>
          <Button size="sm" onClick={createCharacter}>
            <ImagePlus className="h-4 w-4" />
            新建
          </Button>
        </div>

        {importableCharacters.length ? (
          <div className="mb-3 rounded-md border border-[#ded8cc] bg-[#fbfaf6] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">从其他项目导入</div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">选择性复制，不会自动同步。</p>
              </div>
              <Badge className="border border-zinc-200 bg-white text-[10px] text-zinc-700">{importableCharacters.length}</Badge>
            </div>
            <div className="max-h-36 space-y-1 overflow-auto pr-1 scrollbar-thin">
              {importableCharacters.map(({ projectId, projectName, character }) => {
                const preview = character.characterSheetUrl ?? character.referenceImages?.[0]?.url;
                return (
                  <button
                    type="button"
                    key={`${projectId}:${character.id}`}
                    title={`从项目「${projectName}」导入人设：${character.name}`}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-[#ded8cc] hover:bg-white"
                    onClick={() => importCharacterFromProject(character, projectName)}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">
                      {preview ? <img src={preview} alt={character.name} className="h-full w-full object-cover" /> : <Palette className="h-4 w-4 text-teal-600" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{character.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{projectName}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1 scrollbar-thin">
          {allCharacters.map((character) => {
            const active = project.selectedCharacterId === character.id;
            const preview = character.characterSheetUrl ?? character.referenceImages?.[0]?.url;
            const isCharacterGenerating = generatingCharacterIds.has(character.id);
            return (
              <button
                type="button"
                key={character.id}
                title={`选择人设：${character.name}`}
                className={`flex w-full min-w-0 gap-3 rounded-md border p-2 text-left transition ${
                  active ? "border-teal-500 bg-teal-50" : "border-[#ded8cc] bg-white hover:bg-[#f7f3ea]"
                }`}
                onClick={() => setProject((prev) => ({ ...prev, selectedCharacterId: character.id, updatedAt: new Date().toISOString() }))}
              >
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded border bg-[#f7f3ea]">
                  {preview ? <img src={preview} alt={character.name} className="h-full w-full object-contain" /> : <Palette className="m-3 h-6 w-6 text-teal-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium">{character.name}</div>
                    {isCharacterGenerating ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-700">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        生成中
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{character.description}</p>
                  <div className="mt-1 text-[11px] text-zinc-500">{character.referenceImages?.length ?? 0} 张参考图</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="min-h-0 overflow-auto rounded-lg border bg-white p-4 shadow-sm scrollbar-thin">
        {selectedCharacter ? (
          <div className="grid min-h-full grid-cols-[minmax(360px,0.95fr)_minmax(360px,1.05fr)] gap-4">
            <div className="min-w-0">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{selectedCharacter.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">修改会自动保存到当前人设。</p>
                </div>
                <Badge className="border border-zinc-200 bg-transparent text-zinc-700">{referenceCount} 张参考图</Badge>
              </div>

              <div className="overflow-hidden rounded-lg border bg-[#f7f3ea]">
                {mainImageUrl ? (
                  <button
                    type="button"
                    title={`放大查看人设图：${selectedCharacter.name}`}
                    className="block aspect-[4/5] w-full bg-white"
                    onClick={() => setPreviewImage({ url: mainImageUrl, title: selectedCharacter.name })}
                  >
                    <img src={mainImageUrl} alt={selectedCharacter.name} className="h-full w-full object-contain" />
                  </button>
                ) : (
                  <div className="flex aspect-[4/5] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                    <Palette className="h-10 w-10 text-teal-600" />
                    <div>暂无角色设定图</div>
                  </div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button onClick={() => generateCharacterSheet(selectedCharacter.id)} disabled={isSelectedCharacterGenerating}>
                  {isSelectedCharacterGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isSelectedCharacterGenerating ? "正在生成" : "生成人设图"}
                </Button>
                <Button variant="outline" asChild>
                  <label className="cursor-pointer" title="上传人设参考图">
                    <ImagePlus className="h-4 w-4" />
                    上传参考图
                    <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => uploadReferenceImages(selectedCharacter.id, event.target.files)} />
                  </label>
                </Button>
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
                <div>
                  <Label>人设名称</Label>
                  <Input className="mt-1" value={selectedCharacter.name} onChange={(event) => patchSelectedCharacter({ name: event.target.value })} />
                </div>
                <div>
                  <Label>配色</Label>
                  <Input className="mt-1 font-mono text-xs" value={selectedCharacter.palette} onChange={(event) => patchSelectedCharacter({ palette: event.target.value })} />
                </div>
              </div>
              <div>
                <Label>人设描述</Label>
                <Textarea
                  className="mt-1 h-28 resize-none leading-6"
                  value={selectedCharacter.description}
                  onChange={(event) => patchSelectedCharacter({ description: event.target.value })}
                />
              </div>
              <div>
                <Label>提示词核心</Label>
                <Textarea
                  className="mt-1 h-32 resize-none font-mono text-xs leading-5"
                  value={selectedCharacter.prompt}
                  onChange={(event) => patchSelectedCharacter({ prompt: event.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">使用 /images/edits 参考图或 chat-image 渠道时会携带参考图；普通 /images/generations 只能使用文字设定。</p>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>参考图列表</Label>
                  <span className="text-xs text-muted-foreground">生成图和上传的三视图都会保存在这里</span>
                </div>
                {selectedCharacter.referenceImages?.length ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
                    {selectedCharacter.referenceImages.map((image) => {
                      const isPrimary = image.url === selectedCharacter.characterSheetUrl;
                      return (
                        <div key={image.id} className="overflow-hidden rounded-md border bg-white">
                          <button
                            type="button"
                            title={`放大查看参考图：${image.label}`}
                            className="relative block aspect-[3/4] w-full bg-[#f7f3ea]"
                            onClick={() => setPreviewImage({ url: image.url, title: image.label })}
                          >
                            <img src={image.url} alt={image.label} className="h-full w-full object-contain" />
                            {isPrimary ? <Badge className="absolute left-2 top-2 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">主参考</Badge> : null}
                          </button>
                          <div className="flex items-center justify-between gap-2 p-2">
                            <span className="min-w-0 truncate text-xs font-medium">{image.label}</span>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`设为主参考：${image.label}`}
                                disabled={isPrimary}
                                onClick={() => setPrimaryReferenceImage(selectedCharacter.id, image.id)}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={`删除参考图：${image.label}`} onClick={() => removeReferenceImage(selectedCharacter.id, image.id)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed bg-[#f7f3ea] p-5 text-sm text-muted-foreground">还没有参考图。可以上传正面/侧面/背面图，或点击“生成人设图”先保存一张设定图。</div>
                )}
              </div>

              {selectedCharacter ? (
                <div className="flex justify-end">
                  <Button variant="destructive" onClick={() => deleteCharacter(selectedCharacter.id)}>
                    删除这个人设
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无人设</div>
        )}
      </section>
      <AnimatePresence>
        {previewImage ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(undefined)}
          >
            <motion.div
              className="relative max-h-full max-w-5xl overflow-hidden rounded-lg border bg-white shadow-2xl"
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-12 items-center justify-between border-b px-4">
                <div className="min-w-0 truncate text-sm font-semibold">{previewImage.title}</div>
                <Button size="icon" variant="ghost" onClick={() => setPreviewImage(undefined)} aria-label="关闭图片预览">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex max-h-[calc(100vh-120px)] max-w-[calc(100vw-48px)] items-center justify-center bg-[#f7f3ea] p-3">
                <img src={previewImage.url} alt={previewImage.title} className="max-h-[calc(100vh-150px)] max-w-full object-contain" />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function AnchorsView({
  project,
  setProject,
  onToast
}: {
  project: ComicProject;
  setProject: React.Dispatch<React.SetStateAction<ComicProject>>;
  onToast: (title: string, description: string) => void;
}) {
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | undefined>();
  const anchors = project.visualAnchors ?? [];
  const selectedAnchor = anchors.find((item) => item.id === project.selectedAnchorId) ?? anchors[0];
  const mainImageUrl = selectedAnchor?.primaryImageUrl ?? selectedAnchor?.images[0]?.url;

  function patchAnchor(anchorId: string, patch: Partial<VisualAnchor>) {
    setProject((prev) => ({
      ...prev,
      visualAnchors: (prev.visualAnchors ?? []).map((anchor) => (
        anchor.id === anchorId ? { ...anchor, ...patch, updatedAt: new Date().toISOString() } : anchor
      )),
      updatedAt: new Date().toISOString()
    }));
  }

  function createAnchor() {
    const createdAt = new Date().toISOString();
    const anchor: VisualAnchor = {
      id: nowId("anchor"),
      name: "新素材锚点",
      type: "product",
      description: "填写这个产品、道具、场景或 Logo 的稳定视觉特征。",
      usagePrompt: "Keep the same shape, color, material, logo placement and proportions across pages.",
      images: [],
      enabled: true,
      createdAt,
      updatedAt: createdAt
    };
    setProject((prev) => ({
      ...prev,
      selectedAnchorId: anchor.id,
      visualAnchors: [...(prev.visualAnchors ?? []), anchor],
      updatedAt: createdAt
    }));
  }

  function deleteAnchor(anchorId: string) {
    setProject((prev) => {
      const visualAnchors = (prev.visualAnchors ?? []).filter((anchor) => anchor.id !== anchorId);
      return {
        ...prev,
        selectedAnchorId: prev.selectedAnchorId === anchorId ? visualAnchors[0]?.id : prev.selectedAnchorId,
        visualAnchors,
        pages: prev.pages.map((page) => ({ ...page, anchorIds: (page.anchorIds ?? []).filter((id) => id !== anchorId) })),
        updatedAt: new Date().toISOString()
      };
    });
  }

  async function uploadAnchorImages(anchorId: string, files: FileList | null) {
    const targetAnchor = anchors.find((anchor) => anchor.id === anchorId);
    if (!targetAnchor || !files?.length) return;
    const createdAt = new Date().toISOString();
    const images = await Promise.all(
      Array.from(files).map(async (file, index) => {
        const rawUrl = await fileToDataUrl(file);
        const url = await persistImageAsset(project.id, rawUrl, `anchor-${anchorId}-image-${index + 1}-${file.name}`);
        return {
          id: nowId("anchor_image"),
          label: file.name.replace(/\.[^.]+$/, "") || `锚点图 ${index + 1}`,
          url: url ?? rawUrl,
          createdAt
        };
      })
    );
    patchAnchor(anchorId, {
      images: [...targetAnchor.images, ...images],
      primaryImageUrl: targetAnchor.primaryImageUrl ?? images[0]?.url
    });
  }

  function setPrimaryAnchorImage(anchorId: string, imageId: string) {
    const targetAnchor = anchors.find((anchor) => anchor.id === anchorId);
    const image = targetAnchor?.images.find((item) => item.id === imageId);
    if (!targetAnchor || !image) return;
    patchAnchor(anchorId, { primaryImageUrl: image.url });
    onToast("已设置主参考", `后续绑定「${targetAnchor.name}」的页面会优先使用「${image.label}」。`);
  }

  function removeAnchorImage(anchorId: string, imageId: string) {
    const targetAnchor = anchors.find((anchor) => anchor.id === anchorId);
    if (!targetAnchor) return;
    const removedImage = targetAnchor.images.find((image) => image.id === imageId);
    const images = targetAnchor.images.filter((image) => image.id !== imageId);
    const primaryImageUrl = removedImage?.url === targetAnchor.primaryImageUrl ? images[0]?.url : targetAnchor.primaryImageUrl;
    patchAnchor(anchorId, { images, primaryImageUrl });
  }

  return (
    <div className="grid h-full grid-cols-[minmax(280px,340px)_minmax(0,1fr)] gap-4 overflow-hidden p-5">
      <section className="flex min-h-0 flex-col rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">素材锚点</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">产品白图、道具、场景和 Logo，用于保持跨页一致。</p>
          </div>
          <Button size="sm" onClick={createAnchor}>
            <ImagePlus className="h-4 w-4" />
            新建
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1 scrollbar-thin">
          {anchors.map((anchor) => {
            const active = selectedAnchor?.id === anchor.id;
            const preview = anchor.primaryImageUrl ?? anchor.images[0]?.url;
            return (
              <button
                type="button"
                key={anchor.id}
                title={`选择素材锚点：${anchor.name}`}
                className={`flex w-full min-w-0 gap-3 rounded-md border p-2 text-left transition ${
                  active ? "border-teal-500 bg-teal-50" : "border-[#ded8cc] bg-white hover:bg-[#f7f3ea]"
                }`}
                onClick={() => setProject((prev) => ({ ...prev, selectedAnchorId: anchor.id, updatedAt: new Date().toISOString() }))}
              >
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded border bg-[#f7f3ea]">
                  {preview ? <img src={preview} alt={anchor.name} className="h-full w-full object-contain" /> : <Layers3 className="m-3 h-6 w-6 text-teal-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium">{anchor.name}</div>
                    <Badge className="shrink-0 border-zinc-200 bg-white text-[10px] text-zinc-700">{anchorTypeLabel[anchor.type]}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{anchor.description}</p>
                  <div className="mt-1 text-[11px] text-zinc-500">{anchor.images.length} 张参考图</div>
                </div>
              </button>
            );
          })}
          {!anchors.length ? (
            <div className="rounded-md border border-dashed bg-[#f7f3ea] p-5 text-sm leading-6 text-muted-foreground">
              还没有素材锚点。先新建一个“产品”锚点，然后上传白底图或参考图。
            </div>
          ) : null}
        </div>
      </section>

      <section className="min-h-0 overflow-auto rounded-lg border bg-white p-4 shadow-sm scrollbar-thin">
        {selectedAnchor ? (
          <div className="grid min-h-full grid-cols-[minmax(360px,0.95fr)_minmax(360px,1.05fr)] gap-4">
            <div className="min-w-0">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{selectedAnchor.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">绑定到分镜页后，参考图会随该页一起传给图片模型。</p>
                </div>
                <Badge className="border border-zinc-200 bg-transparent text-zinc-700">{selectedAnchor.images.length} 张参考图</Badge>
              </div>
              <div className="overflow-hidden rounded-lg border bg-[#f7f3ea]">
                {mainImageUrl ? (
                  <button
                    type="button"
                    title={`放大查看素材：${selectedAnchor.name}`}
                    className="block aspect-[4/5] w-full bg-white"
                    onClick={() => setPreviewImage({ url: mainImageUrl, title: selectedAnchor.name })}
                  >
                    <img src={mainImageUrl} alt={selectedAnchor.name} className="h-full w-full object-contain" />
                  </button>
                ) : (
                  <div className="flex aspect-[4/5] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                    <Layers3 className="h-10 w-10 text-teal-600" />
                    <div>暂无素材参考图</div>
                  </div>
                )}
              </div>
              <div className="mt-4">
                <Button variant="outline" asChild className="w-full">
                  <label className="cursor-pointer" title="上传素材参考图">
                    <ImagePlus className="h-4 w-4" />
                    上传参考图
                    <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => uploadAnchorImages(selectedAnchor.id, event.target.files)} />
                  </label>
                </Button>
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-3">
                <div>
                  <Label>素材名称</Label>
                  <Input className="mt-1" value={selectedAnchor.name} onChange={(event) => patchAnchor(selectedAnchor.id, { name: event.target.value })} />
                </div>
                <div>
                  <Label>类型</Label>
                  <Select value={selectedAnchor.type} onValueChange={(value) => patchAnchor(selectedAnchor.id, { type: value as VisualAnchorType })}>
                    <SelectTrigger className="mt-1" title="选择素材锚点类型">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(anchorTypeLabel).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-[#fbfaf6] p-3">
                <div>
                  <div className="text-xs font-medium">参与生成</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">关闭后即使页面绑定了它，也不会传给图片接口。</div>
                </div>
                <Switch checked={selectedAnchor.enabled !== false} onCheckedChange={(checked) => patchAnchor(selectedAnchor.id, { enabled: checked })} />
              </div>
              <div>
                <Label>稳定视觉描述</Label>
                <Textarea
                  className="mt-1 h-24 resize-none leading-6"
                  value={selectedAnchor.description}
                  onChange={(event) => patchAnchor(selectedAnchor.id, { description: event.target.value })}
                />
              </div>
              <div>
                <Label>使用说明</Label>
                <Textarea
                  className="mt-1 h-24 resize-none font-mono text-xs leading-5"
                  value={selectedAnchor.usagePrompt}
                  onChange={(event) => patchAnchor(selectedAnchor.id, { usagePrompt: event.target.value })}
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>参考图列表</Label>
                  <span className="text-xs text-muted-foreground">白图、实拍图、包装图都可以放这里</span>
                </div>
                {selectedAnchor.images.length ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
                    {selectedAnchor.images.map((image) => {
                      const isPrimary = image.url === selectedAnchor.primaryImageUrl;
                      return (
                        <div key={image.id} className="overflow-hidden rounded-md border bg-white">
                          <button
                            type="button"
                            title={`放大查看参考图：${image.label}`}
                            className="relative block aspect-[3/4] w-full bg-[#f7f3ea]"
                            onClick={() => setPreviewImage({ url: image.url, title: image.label })}
                          >
                            <img src={image.url} alt={image.label} className="h-full w-full object-contain" />
                            {isPrimary ? <Badge className="absolute left-2 top-2 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">主参考</Badge> : null}
                          </button>
                          <div className="flex items-center justify-between gap-2 p-2">
                            <span className="min-w-0 truncate text-xs font-medium">{image.label}</span>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`设为主参考：${image.label}`}
                                disabled={isPrimary}
                                onClick={() => setPrimaryAnchorImage(selectedAnchor.id, image.id)}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={`删除参考图：${image.label}`} onClick={() => removeAnchorImage(selectedAnchor.id, image.id)}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed bg-[#f7f3ea] p-5 text-sm text-muted-foreground">还没有参考图。建议产品先上传白底图或清晰实拍图。</div>
                )}
              </div>
              <div className="flex justify-end">
                <Button variant="destructive" onClick={() => deleteAnchor(selectedAnchor.id)}>
                  删除这个素材
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无素材锚点</div>
        )}
      </section>

      <AnimatePresence>
        {previewImage ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(undefined)}
          >
            <motion.div
              className="relative max-h-full max-w-5xl overflow-hidden rounded-lg border bg-white shadow-2xl"
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-12 items-center justify-between border-b px-4">
                <div className="min-w-0 truncate text-sm font-semibold">{previewImage.title}</div>
                <Button size="icon" variant="ghost" onClick={() => setPreviewImage(undefined)} aria-label="关闭图片预览">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex max-h-[calc(100vh-120px)] max-w-[calc(100vw-48px)] items-center justify-center bg-[#f7f3ea] p-3">
                <img src={previewImage.url} alt={previewImage.title} className="max-h-[calc(100vh-150px)] max-w-full object-contain" />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SettingsView({
  providers,
  setProviders,
  activeProviderId,
  setActiveProviderId,
  models,
  setModels,
  templates,
  setTemplates,
  workflow,
  setWorkflow,
  addLog
}: {
  providers: ApiProvider[];
  setProviders: React.Dispatch<React.SetStateAction<ApiProvider[]>>;
  activeProviderId: string;
  setActiveProviderId: (providerId: string) => void;
  models: ModelConfig[];
  setModels: React.Dispatch<React.SetStateAction<ModelConfig[]>>;
  templates: PromptTemplates;
  setTemplates: React.Dispatch<React.SetStateAction<PromptTemplates>>;
  workflow: WorkflowNodeConfig[];
  setWorkflow: React.Dispatch<React.SetStateAction<WorkflowNodeConfig[]>>;
  addLog: (entry: Omit<AppLogEntry, "id" | "time">) => void;
}) {
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | undefined>();
  const [activeTemplateKey, setActiveTemplateKey] = useState<keyof PromptTemplates>("imagePositive");
  const templateTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const provider = providers.find((item) => item.id === activeProviderId) ?? providers[0] ?? defaultProvider;
  const providerModels = provider.models ?? [];
  const activeTemplateValue = templates[activeTemplateKey];
  const activeTemplateVariables = promptTemplateVariables[activeTemplateKey];

  async function refreshProviderModels() {
    setIsFetchingModels(true);
    setModelFetchError(undefined);
    addLog({ level: "info", module: "settings", action: "fetch-models", message: `开始获取渠道模型：${provider.providerName}`, detail: provider.baseUrl });
    try {
      const fetchedModels = await fetchProviderModels(provider);
      patchProvider(provider.id, { models: fetchedModels });
      addLog({ level: "success", module: "settings", action: "fetch-models", message: `已获取 ${fetchedModels.length} 个模型`, detail: provider.providerName });
    } catch (error) {
      setModelFetchError(error instanceof Error ? error.message : "获取模型失败。");
      addLog({ level: "error", module: "settings", action: "fetch-models", message: "获取模型失败", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsFetchingModels(false);
    }
  }

  function patchProvider(providerId: string, patch: Partial<ApiProvider>) {
    setProviders((prev) => prev.map((item) => (item.id === providerId ? { ...item, ...patch } : item)));
  }

  function selectProvider(providerId: string) {
    setActiveProviderId(providerId);
    setModelFetchError(undefined);
    const nextProvider = providers.find((item) => item.id === providerId);
    if (nextProvider && !nextProvider.apiKey.trim()) {
      void loadApiKeySecret(nextProvider.apiKeyRef).then((apiKey) => {
        if (apiKey) patchProvider(providerId, { apiKey });
      });
    }
  }

  function createProvider() {
    const id = nowId("provider");
    const nextProvider: ApiProvider = {
      ...defaultProvider,
      id,
      providerName: "新渠道",
      baseUrl: "",
      apiKey: "",
      apiKeyRef: `local-secret:${id}`,
      models: []
    };
    setProviders((prev) => [...prev, nextProvider]);
    setActiveProviderId(nextProvider.id);
    setModelFetchError(undefined);
  }

  function deleteProvider(providerId: string) {
    const providerToDelete = providers.find((item) => item.id === providerId);
    if (providerToDelete) {
      void clearApiKeySecret(providerToDelete.apiKeyRef);
    }
    setProviders((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((item) => item.id !== providerId);
      if (providerId === activeProviderId) setActiveProviderId(next[0].id);
      setModels((currentModels) =>
        currentModels.map((model) =>
          model.providerId === providerId
            ? {
                ...model,
                providerId: next[0].id,
                model: next[0].models?.[0] ?? model.model
              }
            : model
        )
      );
      return next;
    });
  }

  function updateModel(modelId: string, patch: Partial<ModelConfig>) {
    setModels((prev) => prev.map((item) => (item.id === modelId ? { ...item, ...patch } : item)));
  }

  function updateTemplate(key: keyof PromptTemplates, value: string) {
    setTemplates((prev) => ({ ...prev, [key]: value }));
  }

  function insertTemplateVariable(name: string) {
    const token = `{{${name}}}`;
    const textarea = templateTextAreaRef.current;
    const start = textarea?.selectionStart ?? activeTemplateValue.length;
    const end = textarea?.selectionEnd ?? activeTemplateValue.length;
    const nextValue = `${activeTemplateValue.slice(0, start)}${token}${activeTemplateValue.slice(end)}`;
    updateTemplate(activeTemplateKey, nextValue);
    window.requestAnimationFrame(() => {
      templateTextAreaRef.current?.focus();
      const nextCursor = start + token.length;
      templateTextAreaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
    <div className="h-full overflow-auto p-5 scrollbar-thin">
      <div className="grid grid-cols-[minmax(320px,380px)_minmax(0,1fr)] gap-4">
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-2">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">渠道管理</h2>
                <p className="mt-1 text-xs text-muted-foreground">先新增渠道，再在渠道下获取模型。</p>
              </div>
            </div>
            <Button size="sm" onClick={createProvider}>
              <ImagePlus className="h-4 w-4" />
              新增
            </Button>
          </div>
          <div className="space-y-3">
            <div className="max-h-44 space-y-2 overflow-auto pr-1 scrollbar-thin">
              {providers.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  title={`切换渠道：${item.providerName}`}
                  className={`w-full rounded-md border p-2 text-left transition ${
                    item.id === provider.id ? "border-teal-500 bg-teal-50" : "border-[#ded8cc] hover:bg-[#f7f3ea]"
                  }`}
                  onClick={() => selectProvider(item.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.providerName}</span>
                    <Badge className="border border-zinc-200 bg-transparent text-[10px] text-zinc-700">{item.models?.length ?? 0}</Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{item.baseUrl || "未填写 Base URL"}</div>
                </button>
              ))}
            </div>
            <div>
              <Label>渠道名称</Label>
              <Input className="mt-1 min-w-0" value={provider.providerName} onChange={(event) => patchProvider(provider.id, { providerName: event.target.value })} />
            </div>
            <div>
              <Label>Base URL</Label>
              <Input className="mt-1 min-w-0" value={provider.baseUrl} onChange={(event) => patchProvider(provider.id, { baseUrl: event.target.value })} />
            </div>
            <div>
              <Label>API Key</Label>
              <Input
                className="mt-1 min-w-0"
                type="password"
                placeholder="sk-..."
                value={provider.apiKey}
                onChange={(event) => patchProvider(provider.id, { apiKey: event.target.value })}
              />
            </div>
            <div>
              <Label>请求超时(秒)</Label>
              <Input
                className="mt-1 min-w-0"
                min={30}
                max={600}
                type="number"
                value={Math.round((provider.timeout || 300000) / 1000)}
                title="等待上游返回的最长时间。上游较慢时建议 300-600 秒。"
                onChange={(event) => patchProvider(provider.id, { timeout: Math.min(600000, Math.max(30000, (Number(event.target.value) || 300) * 1000)) })}
              />
            </div>
            <div className="rounded-md border bg-[#f7f3ea] p-3 text-xs text-zinc-600">
              <div className="font-medium text-zinc-900">当前渠道</div>
              <div className="mt-2 break-all">ID: {provider.id}</div>
              <div className="mt-1 break-all">Key Ref: {provider.apiKeyRef}</div>
              <div className="mt-1 break-all">已获取模型: {providerModels.length}</div>
              <div className="mt-1 break-all">超时: {Math.round((provider.timeout || 300000) / 1000)} 秒</div>
            </div>
            <Button className="w-full" variant="secondary" onClick={refreshProviderModels} disabled={isFetchingModels || !provider.baseUrl || !provider.apiKey}>
              {isFetchingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              获取当前渠道模型
            </Button>
            {modelFetchError ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{modelFetchError}</div> : null}
            {providerModels.length ? (
              <div className="max-h-40 overflow-auto rounded-md border bg-white p-2 text-xs text-zinc-600 scrollbar-thin">
                {providerModels.slice(0, modelPreviewLimit).map((modelId) => (
                  <div key={modelId} className="truncate rounded px-2 py-1 hover:bg-[#f7f3ea]">
                    {modelId}
                  </div>
                ))}
                {providerModels.length > modelPreviewLimit ? (
                  <div className="px-2 py-1 text-zinc-400">还有 {providerModels.length - modelPreviewLimit} 个模型未展示，可在右侧下拉中搜索/选择常用项。</div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">先点击“获取当前渠道模型”，右侧模型 ID 才会使用渠道返回的下拉选项。</div>
            )}
            <Button className="w-full" variant="outline" disabled={providers.length <= 1} onClick={() => deleteProvider(provider.id)}>
              删除当前渠道
            </Button>
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">模型配置</h2>
              <p className="mt-1 text-xs text-muted-foreground">模型必须归属到已配置渠道，节点再选择模型。</p>
            </div>
            <Badge className="border border-zinc-200 bg-transparent text-zinc-700">{models.length} models</Badge>
          </div>
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
            {models.map((model) => {
                const modelProvider = providers.find((item) => item.id === model.providerId) ?? provider;
                const modelOptions = modelProvider.models ?? [];
                const visibleModelOptions = Array.from(new Set([model.model, ...modelOptions.slice(0, modelSelectLimit)].filter(Boolean)));
                return (
                  <div key={model.id} className="min-w-0 rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="min-w-0 truncate text-sm font-medium">{model.name}</span>
                      <Badge className="border border-zinc-200 bg-transparent text-zinc-700">{model.kind}</Badge>
                    </div>
                    <div className="mb-3">
                      <Label>所属渠道</Label>
                      <Select
                        value={model.providerId}
                        onValueChange={(value) => {
                          const nextProvider = providers.find((item) => item.id === value);
                          updateModel(model.id, {
                            providerId: value,
                            model: pickModelFromProvider(model, nextProvider)
                          });
                        }}
                      >
                        <SelectTrigger className="mt-1 min-w-0" title={`选择${model.name}所属渠道`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {providers.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.providerName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="mb-3">
                      <Label>调用端点</Label>
                      <Select value={model.endpointMode} onValueChange={(value) => updateModel(model.id, { endpointMode: value as EndpointMode })}>
                        <SelectTrigger className="mt-1 min-w-0" title={`选择${model.name}调用端点`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {model.kind === "text" ? (
                            <SelectItem value="chat-text">/chat/completions 文本</SelectItem>
                          ) : (
                            <>
                              <SelectItem value="images">/images/generations</SelectItem>
                              <SelectItem value="image-edits">/images/edits 参考图</SelectItem>
                              <SelectItem value="chat-image">/chat/completions 图片</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <Label>模型 ID</Label>
                    {modelOptions.length ? (
                      <>
                        <Select value={model.model} onValueChange={(value) => updateModel(model.id, { model: value })}>
                          <SelectTrigger className="mt-1 min-w-0" title={`选择${model.name}模型 ID`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {visibleModelOptions.map((modelId) => (
                              <SelectItem key={modelId} value={modelId}>
                                {modelId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {modelOptions.length > modelSelectLimit ? (
                          <div className="mt-1 text-[11px] text-zinc-500">模型较多，已显示前 {modelSelectLimit} 个；当前已选模型会始终保留。</div>
                        ) : null}
                      </>
                    ) : (
                      <div className="mt-1 rounded-md border border-dashed bg-[#f7f3ea] px-3 py-2 text-xs text-muted-foreground">请先在左侧选择该渠道并获取模型列表。</div>
                    )}
                    <div className="mt-3">
                      <Label>请求次数</Label>
                      <Input
                        className="mt-1 min-w-0"
                        min={1}
                        max={6}
                        type="number"
                        value={model.requestAttempts ?? 1}
                        title={model.kind === "image" ? "单页图片最多请求几次。524/超时类错误会停止自动重试，避免重复生成和重复扣费。" : "文本规划最多请求几次。"}
                        onChange={(event) => updateModel(model.id, { requestAttempts: Math.min(6, Math.max(1, Number(event.target.value) || 1)) })}
                      />
                    </div>
                    {model.kind === "image" ? (
                      <div className="mt-3">
                        <Label>生成尺寸</Label>
                        <Select value={normalizeImageSize(model.size)} onValueChange={(value) => updateModel(model.id, { size: value })}>
                          <SelectTrigger className="mt-1 min-w-0" title="选择图片生成尺寸">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {imageSizeOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!/image|dall|flux|stable|sd|midjourney/i.test(model.model) ? (
                          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-700">
                            当前模型 ID 不像图片生成模型，可能会导致生图失败。建议从渠道模型里选择 gpt-image、image、flux、stable、sd 等图片模型。
                          </div>
                        ) : null}
                        {/gpt-image/i.test(model.model) && model.endpointMode === "chat-image" ? (
                          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-700">
                            gpt-image 系列建议使用 /images/generations。/chat/completions 图片模式主要用于兼容会在聊天响应里返回图片的上游，部分渠道会拦截 gpt-image。
                          </div>
                        ) : null}
                        {model.endpointMode === "image-edits" ? (
                          <div className="mt-2 rounded-md border border-teal-200 bg-teal-50 p-2 text-xs leading-5 text-teal-800">
                            参考图模式会把本页出场人设的设定图/参考图传给 /images/edits。没有参考图的页面会自动退回 /images/generations。
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            {workflow.map((node) => (
              <div key={node.id} className="min-w-0 rounded-md border bg-[#f7f3ea] p-3">
                <div className="mb-2 truncate text-xs font-semibold">{node.label}</div>
                <Select value={node.modelId} onValueChange={(value) => setWorkflow((prev) => prev.map((item) => (item.id === node.id ? { ...item, modelId: value } : item)))}>
                  <SelectTrigger className="min-w-0" title={`选择${node.label}使用的模型`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">提示词模板</h2>
            <p className="mt-1 text-xs text-muted-foreground">选择模板后，可以像 Dify 一样点变量插入到光标位置。</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTemplates(recommendedPromptTemplates)}>
            套用推荐模板
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(260px,340px)] gap-4">
          <div className="space-y-2">
            {(Object.keys(templates) as Array<keyof PromptTemplates>).map((key) => (
              <button
                type="button"
                key={key}
                className={`w-full rounded-md border p-3 text-left transition ${
                  activeTemplateKey === key ? "border-teal-500 bg-teal-50" : "border-[#ded8cc] bg-white hover:bg-[#f7f3ea]"
                }`}
                onClick={() => setActiveTemplateKey(key)}
              >
                <div className="text-sm font-medium">{promptTemplateLabel[key]}</div>
                <div className="mt-1 text-[11px] text-zinc-500">{promptTemplateNodeLabel[key]}</div>
                <div className="mt-1 font-mono text-[11px] text-zinc-400">{key}</div>
              </button>
            ))}
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <Label>{promptTemplateLabel[activeTemplateKey]}</Label>
                <div className="mt-1 text-[11px] text-zinc-500">{promptTemplateNodeLabel[activeTemplateKey]} · {activeTemplateKey}</div>
              </div>
              <Badge className="border border-zinc-200 bg-transparent text-zinc-700">{activeTemplateVariables.length} 个变量</Badge>
            </div>
            <Textarea
              ref={templateTextAreaRef}
              className="h-[420px] resize-none font-mono text-xs leading-5"
              value={activeTemplateValue}
              onChange={(event) => updateTemplate(activeTemplateKey, event.target.value)}
            />
          </div>
          <aside className="rounded-md border bg-[#fbfaf6] p-3">
            <div className="text-xs font-semibold">可插入内容</div>
            <div className="mt-1 text-[11px] leading-5 text-zinc-500">点击变量会插入 <span className="font-mono text-zinc-700">{"{{变量}}"}</span>，生成时由对应节点自动替换。</div>
            <div className="mt-3 space-y-2">
              {activeTemplateVariables.length ? activeTemplateVariables.map((variable) => (
                <button
                  type="button"
                  key={variable.name}
                  className="w-full rounded-md border border-[#ded8cc] bg-white p-2 text-left transition hover:border-teal-400 hover:bg-teal-50"
                  onClick={() => insertTemplateVariable(variable.name)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{variable.label}</span>
                    <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">{"{{"}{variable.name}{"}}"}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">{variable.source}</div>
                  <p className="mt-1 text-[11px] leading-4 text-zinc-600">{variable.description}</p>
                </button>
              )) : (
                <div className="rounded-md border border-dashed bg-white p-4 text-xs leading-5 text-zinc-500">
                  这个模板通常直接写负向词，不需要动态变量。
                </div>
              )}
            </div>
            <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 p-2 text-[11px] leading-5 text-teal-800">
              大纲/分镜变量来自创作台和文本规划节点；图片变量来自当前分镜页；重绘变量来自当前页和你的修改要求。
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function ReaderPreview({
  project,
  mode,
  setMode,
  longImageUrl
}: {
  project: ComicProject;
  mode: ReaderMode;
  setMode: (mode: ReaderMode) => void;
  longImageUrl?: string;
}) {
  const pages = project.pages.filter((page) => page.imageUrl);
  const [index, setIndex] = useState(0);
  const activePage = pages[Math.min(index, Math.max(0, pages.length - 1))];

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col rounded-lg border bg-white shadow-sm">
      <div className="flex h-14 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold">阅读预览</div>
          <div className="truncate text-xs text-muted-foreground">{pages.length ? `已生成 ${pages.length}/${project.pages.length} 页` : "生成图片后可预览"}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant={mode === "paged" ? "default" : "outline"} onClick={() => setMode("paged")}>
            <BookOpen className="h-4 w-4" />
            翻页
          </Button>
          <Button size="sm" variant={mode === "long" ? "default" : "outline"} onClick={() => setMode("long")}>
            <GalleryVerticalEnd className="h-4 w-4" />
            长图
          </Button>
        </div>
      </div>
      {mode === "paged" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[56px_minmax(0,1fr)_56px] items-center gap-3 overflow-hidden bg-[#f7f3ea] p-4">
          <ToolButton label="上一页" disabled={!pages.length || index === 0} onClick={() => setIndex((prev) => Math.max(0, prev - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </ToolButton>
          <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden">
            {activePage ? (
              <AnimatePresence mode="wait">
                <motion.img
                  key={activePage.id + activePage.imageUrl}
                  src={activePage.imageUrl}
                  alt={activePage.title}
                  className="max-h-full max-w-full rounded-md border bg-white object-contain shadow-xl"
                  initial={{ opacity: 0, y: 22, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -22, scale: 0.98 }}
                />
              </AnimatePresence>
            ) : (
              <div className="flex aspect-[3/4] h-full max-h-[640px] items-center justify-center rounded-md border bg-white text-sm text-muted-foreground">
                暂无页面
              </div>
            )}
          </div>
          <ToolButton label="下一页" disabled={!pages.length || index >= pages.length - 1} onClick={() => setIndex((prev) => Math.min(pages.length - 1, prev + 1))}>
            <ChevronRight className="h-4 w-4" />
          </ToolButton>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-[#f7f3ea] p-4 scrollbar-thin">
          {longImageUrl ? (
            <img src={longImageUrl} alt="long comic" className="mx-auto w-full max-w-[520px] rounded-md border bg-white shadow-xl" />
          ) : pages.length ? (
            <div className="mx-auto max-w-[520px] overflow-hidden rounded-md border bg-white shadow-xl">
              {pages.map((page) => (
                <img key={page.id} src={page.imageUrl} alt={page.title} className="block w-full" />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无可拼接页面</div>
          )}
        </div>
      )}
    </section>
  );
}

function ProjectsView({
  projects,
  activeProjectId,
  setProject,
  setActiveProjectId,
  setProjects,
  addLog
}: {
  projects: ProjectRecord[];
  activeProjectId: string;
  setProject: React.Dispatch<React.SetStateAction<ComicProject>>;
  setActiveProjectId: (projectId: string) => void;
  setProjects: React.Dispatch<React.SetStateAction<ProjectRecord[]>>;
  addLog: (entry: Omit<AppLogEntry, "id" | "time">) => void;
}) {
  function switchProject(record: ProjectRecord) {
    setProject(normalizeProject(record.project));
    setActiveProjectId(record.meta.id);
    addLog({ level: "info", module: "project", action: "switch", message: `已切换到项目：${record.meta.name}`, projectId: record.meta.id });
  }

  function renameProject(record: ProjectRecord, name: string) {
    const nextProject = touchProject(record.project, { name });
    setProjects((prev) => prev.map((item) => (item.meta.id === record.meta.id ? createProjectRecord(nextProject) : item)));
    if (record.meta.id === activeProjectId) setProject(normalizeProject(nextProject));
  }

  function createProject() {
    const now = new Date().toISOString();
    const nextProject: ComicProject = {
      ...defaultProject,
      id: nowId("project"),
      name: "新漫画项目",
      storyInput: "",
      outline: "",
      pages: [],
      selectedPageId: undefined,
      selectedCharacterId: "",
      castCharacterIds: [],
      deletedCharacterIds: [],
      customCharacters: [],
      visualAnchors: [],
      longImageUrl: undefined,
      updatedAt: now
    };
    const record = createProjectRecord(nextProject);
    setProjects((prev) => [record, ...prev]);
    setProject(normalizeProject(nextProject));
    setActiveProjectId(nextProject.id);
    addLog({ level: "success", module: "project", action: "create", message: "已新建项目", projectId: nextProject.id });
  }

  function duplicateProject(record: ProjectRecord) {
    const now = new Date().toISOString();
    const nextProject: ComicProject = {
      ...record.project,
      id: nowId("project"),
      name: `${record.project.name || "未命名项目"} 副本`,
      pages: record.project.pages.map((page) => ({ ...page, id: nowId("page") })),
      selectedPageId: undefined,
      updatedAt: now
    };
    const nextRecord = createProjectRecord(nextProject);
    setProjects((prev) => [nextRecord, ...prev]);
    setProject(normalizeProject(nextProject));
    setActiveProjectId(nextProject.id);
    addLog({ level: "success", module: "project", action: "duplicate", message: "已复制项目", projectId: nextProject.id });
  }

  function deleteProject(record: ProjectRecord) {
    if (projects.length <= 1) return;
    const nextProjects = projects.filter((item) => item.meta.id !== record.meta.id);
    setProjects(nextProjects);
    if (record.meta.id === activeProjectId) {
      setProject(normalizeProject(nextProjects[0].project));
      setActiveProjectId(nextProjects[0].meta.id);
    }
    addLog({ level: "warn", module: "project", action: "delete", message: `已删除项目：${record.meta.name}`, projectId: record.meta.id });
  }

  return (
    <div className="h-full overflow-auto p-5 scrollbar-thin">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">项目管理</h2>
          <p className="text-sm text-muted-foreground">本地项目库。模型、渠道和提示词配置为全局共享。</p>
        </div>
        <Button onClick={createProject}>
          <ImagePlus className="h-4 w-4" />
          新建项目
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {projects.map((record) => {
          const active = record.meta.id === activeProjectId;
          const cover = record.project.pages.find((page) => page.imageUrl)?.imageUrl;
          return (
            <section key={record.meta.id} className={`rounded-lg border bg-white p-3 shadow-sm ${active ? "border-teal-500 ring-2 ring-teal-500/15" : ""}`}>
              <button
                type="button"
                className="block aspect-[4/3] w-full overflow-hidden rounded-md border bg-[#f7f3ea]"
                onClick={() => switchProject(record)}
                title={`切换到项目：${record.meta.name}`}
              >
                {cover ? <img src={cover} alt={record.meta.name} className="h-full w-full object-cover" /> : <PanelsTopLeft className="mx-auto mt-16 h-10 w-10 text-teal-600" />}
              </button>
              <Input className="mt-3" value={record.project.name} onChange={(event) => renameProject(record, event.target.value)} />
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                <span>{record.meta.pageCount} 页 · {record.meta.doneCount} 完成</span>
                <span>{new Date(record.meta.updatedAt).toLocaleString()}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button size="sm" variant={active ? "secondary" : "outline"} onClick={() => switchProject(record)}>打开</Button>
                <Button size="sm" variant="outline" onClick={() => duplicateProject(record)}>复制</Button>
                <Button size="sm" variant="destructive" disabled={projects.length <= 1} onClick={() => deleteProject(record)}>删除</Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LogsView({
  logs,
  project,
  clearLogs
}: {
  logs: AppLogEntry[];
  project: ComicProject;
  clearLogs: () => void;
}) {
  const [level, setLevel] = useState<AppLogLevel | "all">("all");
  const [module, setModule] = useState<AppLogModule | "all">("all");
  const filteredLogs = logs.filter((log) => (level === "all" || log.level === level) && (module === "all" || log.module === module));
  const levelClass: Record<AppLogLevel, string> = {
    info: "border-sky-200 bg-sky-50 text-sky-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    error: "border-rose-200 bg-rose-50 text-rose-700"
  };

  return (
    <div className="h-full overflow-auto p-5 scrollbar-thin">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">日志中心</h2>
          <p className="text-sm text-muted-foreground">{project.name || "当前项目"} · 最近 {logs.length} 条项目日志。</p>
        </div>
        <Button variant="outline" onClick={clearLogs}>清空当前项目日志</Button>
      </div>
      <div className="mb-4 grid max-w-xl grid-cols-2 gap-3">
        <Select value={level} onValueChange={(value) => setLevel(value as AppLogLevel | "all")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部等级</SelectItem>
            <SelectItem value="info">信息</SelectItem>
            <SelectItem value="success">成功</SelectItem>
            <SelectItem value="warn">警告</SelectItem>
            <SelectItem value="error">错误</SelectItem>
          </SelectContent>
        </Select>
        <Select value={module} onValueChange={(value) => setModule(value as AppLogModule | "all")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模块</SelectItem>
            <SelectItem value="app">应用</SelectItem>
            <SelectItem value="project">项目</SelectItem>
            <SelectItem value="settings">模型</SelectItem>
            <SelectItem value="planner">规划</SelectItem>
            <SelectItem value="image">生图</SelectItem>
            <SelectItem value="export">导出</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        {filteredLogs.length ? filteredLogs.map((log) => (
          <div key={log.id} className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Badge className={levelClass[log.level]}>{log.level}</Badge>
                <span className="truncate text-sm font-medium">{log.message}</span>
              </div>
              <span className="shrink-0 text-xs text-zinc-500">{new Date(log.time).toLocaleString()}</span>
            </div>
            <div className="mt-2 text-xs text-zinc-500">{log.module} / {log.action}{log.pageId ? ` / ${log.pageId}` : ""}</div>
            {log.detail ? <pre className="mt-2 whitespace-pre-wrap rounded-md bg-[#f7f3ea] p-2 text-xs text-zinc-700">{log.detail}</pre> : null}
          </div>
        )) : (
          <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">暂无日志</div>
        )}
      </div>
    </div>
  );
}

function ExportView({
  project,
  setProject,
  addLog
}: {
  project: ComicProject;
  setProject: React.Dispatch<React.SetStateAction<ComicProject>>;
  addLog: (entry: Omit<AppLogEntry, "id" | "time">) => void;
}) {
  const [ratio, setRatio] = useState(project.exportRatio);
  const [isExporting, setIsExporting] = useState(false);
  const donePages = project.pages.filter((page) => page.imageUrl);
  const missingCount = Math.max(0, project.pages.length - donePages.length);

  function setReaderMode(mode: ReaderMode) {
    setProject((prev) => ({ ...prev, readerMode: mode, updatedAt: new Date().toISOString() }));
  }

  async function exportZip() {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const page of donePages) {
      if (!page.imageUrl) continue;
      const blob = await imageUrlToBlob(page.imageUrl);
      zip.file(`page-${page.pageNumber.toString().padStart(2, "0")}-${ratio}.png`, blob);
    }
    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `${project.name || "comic"}-${ratio}-pages.zip`);
    addLog({ level: "success", module: "export", action: "zip", message: `已导出 ${donePages.length} 页 ZIP`, projectId: project.id });
  }

  async function exportLongImage(download: boolean) {
    setIsExporting(true);
    try {
      const longImageUrl = await createLongComicImage(donePages);
      if (!longImageUrl) return;
      const savedLongImageUrl = (await persistImageAsset(project.id, longImageUrl, `project-${project.id}-long-${nowId("asset")}`)) ?? longImageUrl;
      setProject((prev) => ({ ...prev, longImageUrl: savedLongImageUrl, readerMode: "long", updatedAt: new Date().toISOString() }));
      if (download) {
        const blob = await imageUrlToBlob(savedLongImageUrl);
        const filename = `${project.name || "comic"}-${ratio}-long.png`;
        downloadBlob(blob, filename);
        await saveLongImageNative(filename, longImageUrl);
        addLog({ level: "success", module: "export", action: "long-image", message: "已导出长图 PNG", projectId: project.id, detail: filename });
      } else {
        addLog({ level: "success", module: "export", action: "long-preview", message: "已生成长图预览", projectId: project.id });
      }
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="grid h-full grid-cols-[minmax(300px,340px)_minmax(0,1fr)] gap-4 overflow-hidden p-5">
      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">导出设置</h2>
        <p className="mt-1 text-xs text-muted-foreground">单页 ZIP 和平台长图都在这里生成。</p>
        <div className="mt-4 space-y-4">
          <div>
            <Label>导出比例</Label>
            <Select value={ratio} onValueChange={(value) => setRatio(value as ExportRatio)}>
              <SelectTrigger className="mt-1" title="选择导出图片比例">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ratioLabel).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border bg-[#f7f3ea] p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">可导出</span>
              <strong>{donePages.length}</strong>
            </div>
            <div className="mt-2 flex justify-between">
              <span className="text-muted-foreground">缺失</span>
              <strong>{missingCount}</strong>
            </div>
          </div>
          {missingCount ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">仍有 {missingCount} 页未生成，导出会跳过。</div>
          ) : null}
          <Button className="w-full" disabled={!donePages.length} onClick={exportZip}>
            <FileArchive className="h-4 w-4" />
            导出 ZIP
          </Button>
          <Button className="w-full" variant="outline" disabled={!donePages.length || isExporting} onClick={() => exportLongImage(true)}>
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            导出长图 PNG
          </Button>
          <Button className="w-full" variant="secondary" disabled={!donePages.length || isExporting} onClick={() => exportLongImage(false)}>
            生成长图预览
          </Button>
        </div>
      </section>
      <ReaderPreview project={project} mode={project.readerMode} setMode={setReaderMode} longImageUrl={project.longImageUrl} />
    </div>
  );
}

function Inspector({
  project,
  setProject,
  regeneratePage,
  onClose,
  canUseApi,
  templates
}: {
  project: ComicProject;
  setProject: React.Dispatch<React.SetStateAction<ComicProject>>;
  regeneratePage: (pageId: string, mock: boolean) => void;
  onClose: () => void;
  canUseApi: boolean;
  templates: PromptTemplates;
}) {
  const selectedPage = project.pages.find((page) => page.id === project.selectedPageId) ?? project.pages[0];
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | undefined>();
  const allCharacters = getAllCharacters(project);
  const enabledAnchors = getEnabledAnchors(project);
  const selectedPageCharacters = selectedPage ? getPageCharacters(project, selectedPage) : [];
  const selectedPageAnchors = selectedPage ? getPageAnchors(project, selectedPage) : [];

  function updateSelectedPage(patch: Partial<ComicPage>) {
    if (!selectedPage) return;
    setProject((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      longImageUrl: undefined,
      pages: prev.pages.map((page) => (page.id === selectedPage.id ? { ...page, ...patch } : page))
    }));
  }

  return (
    <motion.aside
      className="absolute right-0 top-0 z-30 h-full w-[390px] max-w-[calc(100%-24px)] border-l bg-white shadow-2xl"
      initial={{ x: 420 }}
      animate={{ x: 0 }}
      exit={{ x: 420 }}
      transition={{ type: "spring", damping: 28, stiffness: 260 }}
    >
      <div className="flex h-16 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <PanelRight className="h-4 w-4" />
          <span className="text-sm font-semibold">单页编辑</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedPage ? <PageStatusPill status={selectedPage.status} /> : null}
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭单页编辑">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {selectedPage ? (
        <div className="h-[calc(100%-64px)] overflow-auto p-4 scrollbar-thin">
          <div className="mb-4 overflow-hidden rounded-lg border bg-[#f7f3ea]">
            {selectedPage.imageUrl ? (
              <button
                type="button"
                title={`放大查看：${selectedPage.title}`}
                className="block w-full"
                onClick={() => setPreviewImage({ url: selectedPage.imageUrl!, title: `P${selectedPage.pageNumber} ${selectedPage.title}` })}
              >
                <img src={selectedPage.imageUrl} alt={selectedPage.title} className={`${ratioClass(selectedPage.ratio)} w-full object-cover`} />
              </button>
            ) : (
              <div className={`flex w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground ${ratioClass(selectedPage.ratio)}`}>
                <Layers3 className="h-8 w-8" />
                当前页还没有图片
              </div>
            )}
          </div>

          <div className="space-y-3">
            {selectedPage.versions?.length ? (
              <div>
                <Label>历史版本</Label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {selectedPage.versions.map((version) => (
                    <button
                      type="button"
                      key={version.id}
                      title={`选择历史版本：${version.label}`}
                      className={`overflow-hidden rounded-md border p-1 text-left transition ${
                        selectedPage.selectedVersionId === version.id ? "border-teal-500 ring-2 ring-teal-500/20" : "hover:border-teal-400"
                      }`}
                      onClick={() => updateSelectedPage({ imageUrl: version.imageUrl, selectedVersionId: version.id })}
                    >
                      <img src={version.imageUrl} alt={version.label} className="aspect-[3/4] w-full rounded object-cover" />
                      <div className="mt-1 truncate text-[11px] font-medium">{version.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-[82px_1fr] gap-3">
              <div>
                <Label>页码</Label>
                <Input className="mt-1" value={selectedPage.pageNumber} disabled />
              </div>
              <div>
                <Label>标题</Label>
                <Input className="mt-1" value={selectedPage.title} onChange={(event) => updateSelectedPage({ title: event.target.value })} />
              </div>
            </div>
            <div>
              <Label>剧情片段</Label>
              <Textarea className="mt-1 h-24 resize-none" value={selectedPage.beat} onChange={(event) => updateSelectedPage({ beat: event.target.value })} />
            </div>
            <div>
              <Label>画面构图</Label>
              <Textarea className="mt-1 h-20 resize-none" value={selectedPage.shot} onChange={(event) => updateSelectedPage({ shot: event.target.value })} />
            </div>
            <div>
              <Label>本页出场角色</Label>
              <div className="mt-2">
                <CharacterMultiSelect
                  characters={allCharacters}
                  selectedIds={selectedPage.characterIds ?? selectedPageCharacters.map((character) => character.id)}
                  onChange={(ids) => {
                    const characters = allCharacters.filter((character) => ids.includes(character.id));
                    updateSelectedPage({
                      characterIds: ids,
                      character: getCharacterNames(characters),
                      prompt: createPagePrompt(templates, characters, selectedPage.beat, selectedPage.shot, selectedPage.background)
                    });
                  }}
                  compact
                />
              </div>
            </div>
            <div>
              <Label>本页素材锚点</Label>
              <div className="mt-2">
                <AnchorMultiSelect
                  anchors={enabledAnchors}
                  selectedIds={selectedPage.anchorIds ?? selectedPageAnchors.map((anchor) => anchor.id)}
                  onChange={(ids) => updateSelectedPage({ anchorIds: ids })}
                  compact
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">绑定后，参考图模式会把这些素材图和人设图一起传给图片模型。</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label>背景</Label>
                <Input className="mt-1" value={selectedPage.background} onChange={(event) => updateSelectedPage({ background: event.target.value })} />
              </div>
            </div>
            <div>
              <Label>图片提示词</Label>
              <Textarea className="mt-1 h-32 resize-none leading-5" value={selectedPage.prompt} onChange={(event) => updateSelectedPage({ prompt: event.target.value })} />
            </div>
            <div>
              <Label>负向提示词</Label>
              <Textarea
                className="mt-1 h-20 resize-none leading-5"
                value={selectedPage.negativePrompt}
                onChange={(event) => updateSelectedPage({ negativePrompt: event.target.value })}
              />
            </div>
            {selectedPage.error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                <CircleAlert className="mb-1 h-4 w-4" />
                {selectedPage.error}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={!canUseApi} onClick={() => regeneratePage(selectedPage.id, false)}>
                <RefreshCw className="h-4 w-4" />
                API 重新生成
              </Button>
              <Button variant="outline" onClick={() => regeneratePage(selectedPage.id, true)}>
                <Sparkles className="h-4 w-4" />
                Mock 预览
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">生成分镜后可在这里编辑单页。</div>
      )}
      <AnimatePresence>
        {previewImage ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(undefined)}
          >
            <motion.div
              className="relative max-h-full max-w-5xl overflow-hidden rounded-lg border bg-white shadow-2xl"
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-12 items-center justify-between border-b px-4">
                <div className="min-w-0 truncate text-sm font-semibold">{previewImage.title}</div>
                <Button size="icon" variant="ghost" onClick={() => setPreviewImage(undefined)} aria-label="关闭图片预览">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex max-h-[calc(100vh-120px)] max-w-[calc(100vw-48px)] items-center justify-center bg-[#f7f3ea] p-3">
                <img src={previewImage.url} alt={previewImage.title} className="max-h-[calc(100vh-150px)] max-w-full object-contain" />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.aside>
  );
}

export function App() {
  const initial = useInitialState();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("studio");
  const [project, setProject] = useState<ComicProject>(initial.project);
  const [projects, setProjects] = useState<ProjectRecord[]>(initial.projects);
  const [activeProjectId, setActiveProjectId] = useState(initial.activeProjectId);
  const [providers, setProviders] = useState<ApiProvider[]>(initial.providers);
  const [activeProviderId, setActiveProviderId] = useState(initial.activeProviderId);
  const [models, setModels] = useState<ModelConfig[]>(initial.models);
  const [templates, setTemplates] = useState<PromptTemplates>(initial.templates);
  const [workflow, setWorkflow] = useState<WorkflowNodeConfig[]>(initial.workflow);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isRestoringDraft, setIsRestoringDraft] = useState(false);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [hasHydratedKeys, setHasHydratedKeys] = useState(false);
  const [toast, setToast] = useState<{ title: string; description: string } | undefined>();
  const [logs, setLogs] = useState<AppLogEntry[]>(() => loadProjectLogs(initial.activeProjectId));
  const activeProjectIdRef = useRef(activeProjectId);
  const keySaveBaselineRef = useRef<string>();
  const providersRef = useRef(providers);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    if (activeTab !== "storyboard") setInspectorOpen(false);
  }, [activeTab]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
    setLogs(loadProjectLogs(activeProjectId));
  }, [activeProjectId]);

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  function addLog(entry: Omit<AppLogEntry, "id" | "time">) {
    const targetProjectId = entry.projectId ?? activeProjectIdRef.current;
    const nextLog = createLogEntry({ ...entry, projectId: targetProjectId });
    console.info("[AI Comic Studio]", nextLog.level, nextLog.module, nextLog.action, nextLog.message, nextLog.detail ?? "");
    if (targetProjectId === activeProjectIdRef.current) {
      setLogs((prev) => {
        const nextLogs = [nextLog, ...prev].slice(0, 300);
        saveProjectLogs(targetProjectId, nextLogs);
        return nextLogs;
      });
      return;
    }
    saveProjectLogs(targetProjectId, [nextLog, ...loadProjectLogs(targetProjectId)].slice(0, 300));
  }

  function clearLogs() {
    clearProjectLogs(activeProjectId);
    setLogs([]);
  }

  function updateProjectState(updater: React.SetStateAction<ComicProject>) {
    setProject((prevProject) => {
      const nextProject = typeof updater === "function" ? (updater as (prev: ComicProject) => ComicProject)(prevProject) : updater;
      setProjects((prevProjects) => {
        const nextRecord = createProjectRecord(nextProject);
        const exists = prevProjects.some((record) => record.meta.id === nextProject.id);
        const nextProjects = exists
          ? prevProjects.map((record) => (record.meta.id === nextProject.id ? nextRecord : record))
          : [nextRecord, ...prevProjects];
        return nextProjects.sort((left, right) => right.meta.updatedAt.localeCompare(left.meta.updatedAt));
      });
      setActiveProjectId(nextProject.id);
      return nextProject;
    });
  }

  const setCurrentProject = updateProjectState as React.Dispatch<React.SetStateAction<ComicProject>>;

  useEffect(() => {
    let cancelled = false;
    async function hydrateNativeDraft() {
      setIsRestoringDraft(true);
      try {
        const nativeDraft = await loadNativeDraft();
        if (!cancelled && nativeDraft) {
          const restoredProject = normalizeProject(nativeDraft.project);
          const restoredProjects = normalizeProjectRecords(nativeDraft.projects).map((record) => (
            record.meta.id === restoredProject.id ? createProjectRecord(restoredProject) : record
          ));
          setProject(restoredProject);
          setProjects(restoredProjects);
          setActiveProjectId(nativeDraft.activeProjectId);
          const restoredProviders = (nativeDraft.providers?.length ? nativeDraft.providers : [nativeDraft.provider]).map((provider) => ({
            ...defaultProvider,
            ...provider,
            apiKey: ""
          }));
          const cachedProviders = hydrateProvidersFromCache(restoredProviders);
          providersRef.current = cachedProviders;
          setProviders(cachedProviders);
          setActiveProviderId(nativeDraft.activeProviderId ?? restoredProviders[0].id);
          setModels(nativeDraft.models);
          setTemplates(nativeDraft.templates);
          setWorkflow(nativeDraft.workflow);
          persistProjectsImageAssets(restoredProjects)
            .then((migratedProjects) => {
              if (cancelled || migratedProjects === restoredProjects) return;
              const migratedProject = migratedProjects.find((record) => record.meta.id === nativeDraft.activeProjectId)?.project ?? migratedProjects[0]?.project;
              setProjects(migratedProjects);
              if (migratedProject) setProject(migratedProject);
              saveNativeDraft(
                migratedProjects,
                nativeDraft.activeProjectId,
                providersRef.current,
                nativeDraft.activeProviderId ?? restoredProviders[0].id,
                nativeDraft.models,
                nativeDraft.templates,
                nativeDraft.workflow
              ).catch((error) => console.warn("Migrated draft save failed", error));
            })
            .catch((error) => console.warn("Image asset migration failed", error));
        }
      } catch (error) {
        console.warn("Native draft hydration failed", error);
      } finally {
        if (!cancelled) {
          setIsRestoringDraft(false);
          setHasHydratedDraft(true);
        }
      }
      await hydrateApiKeysFor(providersRef.current);
    }
    async function hydrateApiKeysFor(providerList: ApiProvider[]) {
      const keyRefs = Array.from(new Set(providerList.map((provider) => provider.apiKeyRef)));
      try {
        const providerKeys = await loadApiKeySecrets(keyRefs);
        if (!cancelled) {
          setProviders((prev) =>
            prev.map((provider) => ({
              ...provider,
              apiKey: provider.apiKey || providerKeys[provider.apiKeyRef] || ""
            }))
          );
        }
      } catch (error) {
        console.warn("API key hydration failed", error);
      } finally {
        if (!cancelled) setHasHydratedKeys(true);
      }
    }
    hydrateNativeDraft();
    return () => {
      cancelled = true;
    };
  }, []);

  const providerConfigMemoSignature = useMemo(() => providerConfigSignature(providers), [providers]);
  const providerSecretMemoSignature = useMemo(() => providerSecretSignature(providers), [providers]);
  const autosaveProjectSignature = useMemo(() => projectAutosaveSignature(projects), [projects]);

  useEffect(() => {
    if (!hasHydratedDraft) return;
    const timeout = window.setTimeout(() => {
      saveNativeDraft(projects, activeProjectId, providers, activeProviderId, models, templates, workflow).catch((error) => {
        console.warn("Auto save failed", error);
        addLog({ level: "error", module: "app", action: "autosave", message: "自动保存失败", detail: error instanceof Error ? error.message : String(error), projectId: activeProjectId });
      });
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [hasHydratedDraft, autosaveProjectSignature, activeProjectId, providerConfigMemoSignature, activeProviderId, models, templates, workflow]);

  useEffect(() => {
    const secrets = providers.map((item) => ({ keyRef: item.apiKeyRef, apiKey: item.apiKey }));
    const signature = providerSecretMemoSignature;
    if (!hasHydratedKeys) return;
    cacheApiKeySecrets(secrets);
    if (keySaveBaselineRef.current === undefined) {
      keySaveBaselineRef.current = signature;
      return;
    }
    if (keySaveBaselineRef.current === signature) return;
    const timeout = window.setTimeout(() => {
      saveApiKeySecrets(secrets)
        .then(() => {
          keySaveBaselineRef.current = signature;
        })
        .catch((error) => console.warn("API key save failed", error));
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [hasHydratedKeys, providerSecretMemoSignature, providers]);

  const doneCount = useMemo(() => project.pages.filter((page) => page.status === "done").length, [project.pages]);
  const allCharacters = useMemo(() => getAllCharacters(project), [project.customCharacters, project.deletedCharacterIds]);
  const selectedCharacter = useMemo(() => allCharacters.find((item) => item.id === project.selectedCharacterId) ?? allCharacters[0], [allCharacters, project.selectedCharacterId]);
  const castCharacters = useMemo(() => getCastCharacters(project), [project.customCharacters, project.deletedCharacterIds, project.castCharacterIds, project.selectedCharacterId]);
  const outlineNode = useMemo(() => workflow.find((node) => node.id === "outline"), [workflow]);
  const imageNode = useMemo(() => workflow.find((node) => node.id === "image"), [workflow]);
  const textModel = useMemo(() => models.find((model) => model.id === outlineNode?.modelId) ?? models.find((model) => model.kind === "text") ?? defaultModels[0], [models, outlineNode?.modelId]);
  const imageModel = useMemo(() => models.find((model) => model.id === imageNode?.modelId) ?? models.find((model) => model.kind === "image") ?? defaultModels[1], [models, imageNode?.modelId]);
  const provider = useMemo(() => providers.find((item) => item.id === activeProviderId) ?? providers[0] ?? defaultProvider, [providers, activeProviderId]);
  const textProvider = useMemo(() => providers.find((item) => item.id === textModel.providerId) ?? provider, [providers, textModel.providerId, provider]);
  const imageProvider = useMemo(() => providers.find((item) => item.id === imageModel.providerId) ?? provider, [providers, imageModel.providerId, provider]);
  const isApiPlannerReady = Boolean(textProvider.apiKey?.trim());
  const plannerModeLabel = isApiPlannerReady ? `API · ${textModel.model}` : "本地规则";
  const plannerModeDescription = isApiPlannerReady
    ? `将调用 ${textProvider.providerName} / ${textModel.model} 生成大纲和分镜。`
    : "当前文本模型渠道没有可用 API Key，会使用本地规则规划；速度很快，但内容会更像模板。";

  function showToast(title: string, description: string) {
    setToast({ title, description });
  }

  function handleRatioChange(ratio: ExportRatio) {
    updateProjectState((prev) => ({
      ...prev,
      exportRatio: ratio,
      pages: prev.pages.map((page) => (page.imageUrl ? page : { ...page, ratio })),
      updatedAt: new Date().toISOString()
    }));
    setModels((prev) =>
      prev.map((model) => (
        model.kind === "image" && model.id === imageModel.id
          ? { ...model, size: imageSizeForRatio(ratio) }
          : model
      ))
    );
  }

  function handleSuggestCast() {
    const suggestedIds = suggestCastCharacterIds(project.storyInput, allCharacters, project.castCharacterIds ?? []);
    updateProjectState((prev) => ({
      ...prev,
      castCharacterIds: suggestedIds,
      selectedCharacterId: suggestedIds[0] ?? prev.selectedCharacterId,
      updatedAt: new Date().toISOString()
    }));
    const names = suggestedIds
      .map((id) => allCharacters.find((character) => character.id === id)?.name)
      .filter(Boolean)
      .join("、");
    showToast("已建议项目演员表", names || "没有匹配到故事关键词，保留当前选择。");
    addLog({ level: "info", module: "project", action: "suggest-cast", message: "已根据故事建议演员表", projectId: project.id, detail: names });
  }

  async function handlePlan() {
    setIsPlanning(true);
    addLog({ level: "info", module: "planner", action: "start", message: "开始生成大纲和分镜", projectId: project.id, detail: plannerModeDescription });
    try {
      let result: PlannerResult | undefined;
      if (isApiPlannerReady) {
        const maxAttempts = Math.max(1, Math.min(6, textModel.requestAttempts ?? 1));
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            addLog({
              level: "info",
              module: "planner",
              action: "api-attempt",
              message: `文本模型请求 ${attempt}/${maxAttempts}`,
              projectId: project.id,
              detail: `${textProvider.providerName} / ${textModel.model}`
            });
            result = await planComicWithNewApi({
              story: project.storyInput,
              provider: textProvider,
              model: textModel,
              templates,
              characters: castCharacters,
              ratio: project.exportRatio,
              targetPageCount: project.targetPageCount
            });
            break;
          } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts) break;
            addLog({
              level: "warn",
              module: "planner",
              action: "api-retry",
              message: "文本模型请求失败，准备重试",
              projectId: project.id,
              detail: error instanceof Error ? error.message : String(error)
            });
            await sleep((textProvider.retryPolicy?.retryDelayMs ?? 1200) * attempt);
          }
        }
        if (!result) throw lastError instanceof Error ? lastError : new Error("文本模型规划失败");
      } else {
        result = planComicFromStory(project.storyInput, castCharacters, project.exportRatio, project.targetPageCount, templates);
      }
      updateProjectState((prev) => ({
        ...prev,
        outline: result.outline,
        pages: result.pages.map((page) => ({ ...page, anchorIds: page.anchorIds ?? [], prompt: withStyleLock(page.prompt, prev) })),
        selectedPageId: result.pages[0]?.id,
        longImageUrl: undefined,
        updatedAt: new Date().toISOString()
      }));
      setInspectorOpen(false);
      setActiveTab("storyboard");
      showToast(isApiPlannerReady ? "API 分镜已生成" : "本地规则分镜已生成", `已拆分为 ${result.pages.length} 页。`);
      addLog({ level: "success", module: "planner", action: "done", message: `分镜已生成 ${result.pages.length} 页`, projectId: project.id, detail: plannerModeLabel });
    } catch (error) {
      const result = planComicFromStory(project.storyInput, castCharacters, project.exportRatio, project.targetPageCount, templates);
      updateProjectState((prev) => ({
        ...prev,
        outline: result.outline,
        pages: result.pages.map((page) => ({ ...page, anchorIds: page.anchorIds ?? [], prompt: withStyleLock(page.prompt, prev) })),
        selectedPageId: result.pages[0]?.id,
        longImageUrl: undefined,
        updatedAt: new Date().toISOString()
      }));
      setInspectorOpen(false);
      setActiveTab("storyboard");
      showToast("API 分镜失败，已回退本地规划", error instanceof Error ? error.message : "未知错误");
      addLog({ level: "warn", module: "planner", action: "fallback", message: "API 分镜失败，已回退本地规划", projectId: project.id, detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsPlanning(false);
    }
  }

  function patchPage(pageId: string, patch: Partial<ComicPage>) {
    updateProjectState((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      longImageUrl: undefined,
      pages: prev.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page))
    }));
  }

  function createImageVersion(page: ComicPage, imageUrl: string): PageImageVersion {
    return {
      id: nowId("version"),
      imageUrl,
      prompt: page.prompt,
      negativePrompt: page.negativePrompt,
      modelId: page.modelId,
      seed: page.seed,
      createdAt: new Date().toISOString(),
      label: `V${(page.versions?.length ?? 0) + 1}`
    };
  }

  function getPageCharactersForGeneration(page: ComicPage) {
    return getPageCharacters(project, page).map((character, index) => ({
      ...character,
      prompt: `${String.fromCharCode(65 + index)}. ${createCharacterPrompt(character)}`
    }));
  }

  function getPageAnchorsForGeneration(page: ComicPage) {
    return getPageAnchors(project, page);
  }

  function isAcceptedButUnfinishedImageError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /524|timeout|timed out|aborted|bad_response_status_code|openai_error|gateway|body-read-failed|error decoding response body|读取 API 响应失败|failed to read API response body/i.test(message);
  }

  async function generateOne(page: ComicPage, mock: boolean) {
    const pageAnchors = getPageAnchorsForGeneration(page);
    const anchorPrompt = buildAnchorPrompt(pageAnchors);
    const pageForGeneration = {
      ...page,
      prompt: withStyleLock(anchorPrompt ? `${page.prompt}\n\nVisual anchors:\n${anchorPrompt}` : page.prompt, project)
    };
    addLog({ level: "info", module: "image", action: mock ? "mock-start" : "api-start", message: `开始生成第 ${page.pageNumber} 页`, projectId: project.id, pageId: page.id, detail: mock ? "mock" : imageModel.model });
    patchPage(page.id, { status: "generating", progress: 12, error: undefined, ...(mock ? {} : { imageUrl: undefined }) });
    for (const progress of [28, 44, 63, 78]) {
      await sleep(mock ? 180 + Math.random() * 180 : 80);
      patchPage(page.id, { progress });
    }

    try {
      let imageUrl = "";
      const pageCharacters = getPageCharactersForGeneration(pageForGeneration);
      if (mock) {
        imageUrl = createMockComicImage(pageForGeneration, pageCharacters[0]?.palette.split(",")[2] ?? "#57c7b6");
      } else {
        const maxAttempts = Math.max(1, Math.min(6, imageModel.requestAttempts ?? 1));
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            addLog({
              level: "info",
              module: "image",
              action: "api-attempt",
              message: `第 ${page.pageNumber} 页 API 请求 ${attempt}/${maxAttempts}`,
              projectId: project.id,
              pageId: page.id,
              detail: `${imageProvider.providerName} / ${imageModel.model} / ${imageModel.endpointMode}`
            });
            imageUrl = await generateImageWithNewApi({ provider: imageProvider, model: imageModel, page: pageForGeneration, characters: pageCharacters, anchors: pageAnchors });
            break;
          } catch (error) {
            lastError = error;
            if (isAcceptedButUnfinishedImageError(error)) {
              addLog({
                level: "warn",
                module: "image",
                action: "api-no-retry",
                message: `第 ${page.pageNumber} 页 API 已停止自动重试`,
                projectId: project.id,
                pageId: page.id,
                detail: `${error instanceof Error ? error.message : String(error)}\n\n这类错误可能表示上游已经接收并继续生成。自动重试可能造成重复生成和重复扣费，请先查看上游日志后再手动决定是否重试。`
              });
              break;
            }
            if (attempt >= maxAttempts) break;
            addLog({
              level: "warn",
              module: "image",
              action: "api-retry",
              message: `第 ${page.pageNumber} 页 API 失败，准备重试`,
              projectId: project.id,
              pageId: page.id,
              detail: error instanceof Error ? error.message : String(error)
            });
            await sleep((imageProvider.retryPolicy?.retryDelayMs ?? 1200) * attempt);
          }
        }
        if (!imageUrl) throw lastError instanceof Error ? lastError : new Error("生成失败");
      }
      imageUrl = (await persistImageAsset(project.id, imageUrl, `page-${page.pageNumber}-${page.id}-${nowId("asset")}`)) ?? imageUrl;
      const version = createImageVersion(pageForGeneration, imageUrl);
      patchPage(page.id, {
        status: "done",
        progress: 100,
        imageUrl,
        error: undefined,
        versions: [...(page.versions ?? []), version],
        selectedVersionId: version.id
      });
      addLog({ level: "success", module: "image", action: "done", message: `第 ${page.pageNumber} 页生成完成`, projectId: project.id, pageId: page.id });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      const detail = !mock && /invalid_input_fidelity_model|input_fidelity/i.test(message)
        ? `${message}\n\n处理方法：当前模型不支持 input_fidelity 参数。客户端已移除这个参数，请重新生成。`
        : !mock && /gpt-image-2/i.test(message) && /not supported|unsupported|model_not_found|does not exist/i.test(message)
        ? `${message}\n\n处理方法：如果你确认 /images/generations 可以用，到「模型」页把图片模型的「调用端点」改成 /images/generations；只有 /images/generations 也失败时，才需要换模型 ID。`
        : !mock && /524|timeout|timed out|bad_response_status_code|openai_error/i.test(message)
          ? `${message}\n\n这通常是渠道上游超时或限流。建议把并发数调到 1-2，或换更稳定的图片渠道后重试。`
          : message;
      patchPage(page.id, {
        status: "failed",
        progress: 100,
        error: detail
      });
      if (!mock) {
        showToast(`第 ${page.pageNumber} 页重新生成失败`, detail);
      }
      addLog({ level: "error", module: "image", action: "failed", message: `第 ${page.pageNumber} 页生成失败`, projectId: project.id, pageId: page.id, detail });
      return false;
    }
  }

  async function handleGenerate(mock: boolean) {
    if (!project.pages.length) return;
    setIsGenerating(true);
    const pendingPages = project.pages.filter((page) => page.status !== "done");
    updateProjectState((prev) => ({
      ...prev,
      pages: prev.pages.map((page) => ({ ...page, status: page.status === "done" ? page.status : "queued", progress: page.status === "done" ? 100 : 0 }))
    }));
    addLog({ level: "info", module: "image", action: "queue", message: `已加入 ${pendingPages.length} 个生成任务`, projectId: project.id, detail: mock ? "mock" : imageModel.model });
    try {
      let failedCount = 0;
      await runWithConcurrency(pendingPages, project.concurrency, async (page) => {
        try {
          const success = await generateOne(page, mock);
          if (!success) failedCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "生成任务异常中断";
          patchPage(page.id, { status: "failed", progress: 100, error: message });
          failedCount += 1;
        }
      });
      showToast(
        failedCount ? (mock ? "Mock 部分失败" : "API 部分失败") : (mock ? "Mock 生成完成" : "API 生成完成"),
        failedCount ? `${failedCount} 页失败，可以在分镜页查看错误并单独重试。` : "失败页面可以单独重试。"
      );
      addLog({
        level: failedCount ? "warn" : "success",
        module: "image",
        action: "batch-done",
        message: failedCount ? `${failedCount} 页生成失败` : (mock ? "Mock 生成完成" : "API 并发生成完成"),
        projectId: project.id
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成队列异常中断";
      pendingPages.forEach((page) => {
        patchPage(page.id, { status: "failed", progress: 100, error: message });
      });
      showToast("生成队列异常", message);
      addLog({ level: "error", module: "image", action: "batch-failed", message: "生成队列异常", projectId: project.id, detail: message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function regeneratePage(pageId: string, mock: boolean) {
    const page = project.pages.find((item) => item.id === pageId);
    if (!page) return;
    updateProjectState((prev) => ({ ...prev, selectedPageId: pageId }));
    await generateOne({ ...page, seed: Math.floor(Math.random() * 100000) }, mock);
  }

  async function handleSave() {
    await saveApiKeySecrets(providers.map((item) => ({ keyRef: item.apiKeyRef, apiKey: item.apiKey })));
    await saveNativeDraft(projects, activeProjectId, providers, provider.id, models, templates, workflow);
    showToast("草稿已保存", "项目、配置和提示词已保存到本地，API Key 不写入草稿。");
    addLog({ level: "success", module: "app", action: "save", message: "草稿已手动保存", projectId: project.id });
  }

  function createNewPage() {
    const pageNumber = project.pages.length + 1;
    const beat = "补充一个新的剧情节拍。";
    const shot = "干净漫画构图，主体明确，留出文字区域。";
    const background = "简洁背景";
    const pageCharacters = castCharacters.length ? castCharacters : selectedCharacter ? [selectedCharacter] : [];
    const page: ComicPage = {
      id: nowId("page"),
      pageNumber,
      title: `新增页面 ${pageNumber}`,
      beat,
      shot,
      character: getCharacterNames(pageCharacters),
      characterIds: pageCharacters.map((character) => character.id),
      anchorIds: [],
      background,
      ratio: project.exportRatio,
      prompt: withStyleLock(createPagePrompt(templates, pageCharacters, beat, shot, background), project),
      negativePrompt: templates.imageNegative,
      modelId: imageModel.id,
      status: "draft",
      progress: 0,
      seed: Math.floor(Math.random() * 100000),
      versions: []
    };
    updateProjectState((prev) => ({ ...prev, pages: [...prev.pages, page], selectedPageId: page.id, updatedAt: new Date().toISOString() }));
    addLog({ level: "info", module: "project", action: "add-page", message: `已新增第 ${pageNumber} 页`, projectId: project.id, pageId: page.id });
  }

  let content: React.ReactNode;
  if (activeTab === "studio") {
    content = (
      <StudioView
        project={project}
        setProject={setCurrentProject}
        onPlan={handlePlan}
        onGenerate={handleGenerate}
        onSuggestCast={handleSuggestCast}
        regeneratePage={regeneratePage}
        canUseApi={Boolean(imageProvider.apiKey)}
        plannerModeLabel={plannerModeLabel}
        plannerModeDescription={plannerModeDescription}
        onRatioChange={handleRatioChange}
        openStoryboard={() => setActiveTab("storyboard")}
      />
    );
  } else if (activeTab === "storyboard") {
    content = (
      <StoryboardView
        project={project}
        setProject={setCurrentProject}
        regeneratePage={regeneratePage}
        createNewPage={createNewPage}
        inspectorOpen={inspectorOpen}
        setInspectorOpen={setInspectorOpen}
        canUseApi={Boolean(imageProvider.apiKey)}
        templates={templates}
      />
    );
  } else if (activeTab === "characters") {
    content = <CharactersView project={project} projects={projects} setProject={setCurrentProject} imageProvider={imageProvider} imageModel={imageModel} onToast={showToast} addLog={addLog} />;
  } else if (activeTab === "anchors") {
    content = <AnchorsView project={project} setProject={setCurrentProject} onToast={showToast} />;
  } else if (activeTab === "projects") {
    content = (
      <ProjectsView
        projects={projects}
        activeProjectId={activeProjectId}
        setProject={setCurrentProject}
        setActiveProjectId={setActiveProjectId}
        setProjects={setProjects}
        addLog={addLog}
      />
    );
  } else if (activeTab === "settings") {
    content = (
      <SettingsView
        providers={providers}
        setProviders={setProviders}
        activeProviderId={provider.id}
        setActiveProviderId={setActiveProviderId}
        models={models}
        setModels={setModels}
        templates={templates}
        setTemplates={setTemplates}
        workflow={workflow}
        setWorkflow={setWorkflow}
        addLog={addLog}
      />
    );
  } else if (activeTab === "logs") {
    content = <LogsView logs={logs} project={project} clearLogs={clearLogs} />;
  } else {
    content = <ExportView project={project} setProject={setCurrentProject} addLog={addLog} />;
  }

  return (
    <ToastProvider>
      <TooltipProvider delayDuration={160}>
        <Shell
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          project={project}
          projects={projects}
          doneCount={doneCount}
          provider={imageProvider}
          isBusy={isPlanning || isGenerating}
          isDark={isDark}
          setIsDark={setIsDark}
          onPlan={handlePlan}
          onGenerate={handleGenerate}
          onSave={handleSave}
          latestLog={logs[0]}
          openLogs={() => setActiveTab("logs")}
        >
          {content}
        </Shell>
        {isRestoringDraft ? (
          <div className="pointer-events-none fixed right-4 top-4 z-50 flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
            后台同步本地草稿
          </div>
        ) : null}
      </TooltipProvider>
      {toast ? (
        <Toast open={Boolean(toast)} onOpenChange={(open) => !open && setToast(undefined)}>
          <ToastTitle>{toast.title}</ToastTitle>
          <ToastDescription>{toast.description}</ToastDescription>
        </Toast>
      ) : null}
      <ToastViewport />
    </ToastProvider>
  );
}

