import { defaultWorkflow } from "../data/defaults";
import { ApiProvider, AppLogEntry, CharacterTemplate, ComicProject, ModelConfig, ProjectMeta, ProjectRecord, PromptTemplates, WorkflowNodeConfig } from "../types";

const storageKey = "ai-comic-studio:draft:v1";
const projectLogKeyPrefix = "ai-comic-studio:project-logs:v1:";
const apiKeyCachePrefix = "ai-comic-studio:api-key-cache:";
const dbUrl = "sqlite:ai-comic-studio.db";
const defaultProjectId = "default-project";
const secretClient = "ai-comic-studio";
const validImageSizes = new Set(["1024x1536", "1024x1280", "1024x1024", "2048x3072", "2048x2560", "2048x2048", "3072x4608", "3072x3840", "3072x3072"]);
const maxProjectLogs = 300;

export interface DraftPayload {
  project: ComicProject;
  projects: ProjectRecord[];
  activeProjectId: string;
  provider: Omit<ApiProvider, "apiKey">;
  providers?: Array<Omit<ApiProvider, "apiKey">>;
  activeProviderId?: string;
  models: ModelConfig[];
  templates: PromptTemplates;
  workflow: WorkflowNodeConfig[];
  savedAt: string;
}

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function getAllDraftCharacters(project: ComicProject) {
  const deletedIds = new Set(project.deletedCharacterIds ?? []);
  return (project.customCharacters ?? []).filter((character) => !deletedIds.has(character.id));
}

function defaultStyleLockPrompt(project: Partial<ComicProject>) {
  return [
    "consistent original vertical webcomic style",
    "same line weight, same color palette, same character proportions",
    `target ratio ${project.exportRatio ?? "3:4"}`,
    "clean readable composition, coherent lighting across all pages"
  ].join(", ");
}

function normalizeCastCharacterIds(project: ComicProject, characters: CharacterTemplate[]) {
  const knownIds = new Set(characters.map((character) => character.id));
  const rawCastIds = (project as Partial<ComicProject> & { castCharacterIds?: unknown }).castCharacterIds;
  if (Array.isArray(rawCastIds)) {
    return Array.from(new Set(rawCastIds.filter((id): id is string => typeof id === "string" && knownIds.has(id))));
  }
  if (project.selectedCharacterId && knownIds.has(project.selectedCharacterId)) return [project.selectedCharacterId];
  return characters[0]?.id ? [characters[0].id] : [];
}

function normalizePageCharacterIds(page: ComicProject["pages"][number], castCharacterIds: string[], characters: CharacterTemplate[]) {
  const knownIds = new Set(characters.map((character) => character.id));
  const rawPageIds = (page as Partial<ComicProject["pages"][number]> & { characterIds?: unknown }).characterIds;
  if (Array.isArray(rawPageIds)) {
    return Array.from(new Set(rawPageIds.filter((id): id is string => typeof id === "string" && knownIds.has(id))));
  }

  const legacyCharacterText = page.character ?? "";
  const matchedIds = characters
    .filter((character) => legacyCharacterText.includes(character.name))
    .map((character) => character.id);
  if (matchedIds.length) return Array.from(new Set(matchedIds));

  return castCharacterIds[0] ? [castCharacterIds[0]] : characters[0]?.id ? [characters[0].id] : [];
}

function normalizePage(page: ComicProject["pages"][number], castCharacterIds: string[], characters: CharacterTemplate[]): ComicProject["pages"][number] {
  const characterIds = normalizePageCharacterIds(page, castCharacterIds, characters);
  const characterNames = characterIds
    .map((id) => characters.find((character) => character.id === id)?.name)
    .filter(Boolean)
    .join("、");
  return {
    ...page,
    characterIds,
    character: page.character || characterNames,
    versions: page.versions ?? [],
    selectedVersionId: page.selectedVersionId ?? page.versions?.[0]?.id
  };
}

export function normalizeProject(project: ComicProject): ComicProject {
  const characters = getAllDraftCharacters(project);
  const castCharacterIds = normalizeCastCharacterIds(project, characters);
  return {
    ...project,
    pages: (project.pages ?? []).map((page) => normalizePage(page, castCharacterIds, characters)),
    castCharacterIds,
    selectedCharacterId: characters.some((character) => character.id === project.selectedCharacterId)
      ? project.selectedCharacterId
      : castCharacterIds[0] ?? characters[0]?.id ?? "",
    customCharacters: project.customCharacters ?? [],
    deletedCharacterIds: project.deletedCharacterIds ?? [],
    readerMode: project.readerMode ?? "paged",
    styleLockPrompt: project.styleLockPrompt?.trim() || defaultStyleLockPrompt(project),
    targetPageCount: project.targetPageCount === 0 ? 0 : Math.min(30, Math.max(1, project.targetPageCount || 0)),
    concurrency: Math.min(10, Math.max(1, project.concurrency || 4)),
    updatedAt: project.updatedAt ?? new Date().toISOString()
  };
}

export function projectMeta(project: ComicProject): ProjectMeta {
  return {
    id: project.id,
    name: project.name || "未命名项目",
    updatedAt: project.updatedAt ?? new Date().toISOString(),
    pageCount: project.pages?.length ?? 0,
    doneCount: project.pages?.filter((page) => page.status === "done").length ?? 0
  };
}

function normalizeProjects(payload: Partial<DraftPayload>) {
  const rawProjects = payload.projects?.length
    ? payload.projects.map((record) => normalizeProject(record.project))
    : payload.project
      ? [normalizeProject(payload.project)]
      : [];
  const unique = new Map<string, ComicProject>();
  for (const project of rawProjects) {
    unique.set(project.id, project);
  }
  const projects = Array.from(unique.values())
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
    .map((project) => ({ meta: projectMeta(project), project }));
  return projects;
}

function normalizeAttempts(value: unknown, fallback = 1) {
  return Math.min(6, Math.max(1, Number(value) || fallback));
}

function normalizeModel(model: ModelConfig, legacyAttempts = 1): ModelConfig {
  const requestAttempts = normalizeAttempts(model.requestAttempts, legacyAttempts);
  return model.kind === "image"
    ? { ...model, requestAttempts, size: validImageSizes.has(model.size ?? "") ? model.size : "1024x1536" }
    : { ...model, requestAttempts };
}

function normalizeProvider<T extends Omit<ApiProvider, "apiKey"> | ApiProvider>(provider: T): T {
  const timeout = provider.timeout && provider.timeout !== 120000 ? provider.timeout : 300000;
  return {
    ...provider,
    timeout: Math.min(600000, Math.max(30000, timeout)),
    retryPolicy: {
      maxRetries: Math.min(5, Math.max(0, provider.retryPolicy?.maxRetries ?? 2)),
      retryDelayMs: Math.min(30000, Math.max(500, provider.retryPolicy?.retryDelayMs ?? 1200))
    }
  };
}

function normalizeDraft(payload: Partial<DraftPayload>): DraftPayload | undefined {
  const providers = (payload.providers ?? (payload.provider ? [payload.provider] : [])).map(normalizeProvider);
  const provider = normalizeProvider(payload.provider ?? providers[0]);
  const projects = normalizeProjects(payload);
  const activeProjectId = payload.activeProjectId && projects.some((record) => record.meta.id === payload.activeProjectId)
    ? payload.activeProjectId
    : projects[0]?.meta.id;
  const project = projects.find((record) => record.meta.id === activeProjectId)?.project ?? projects[0]?.project;
  if (!project || !provider || !payload.models || !payload.templates) return undefined;
  const legacyAttempts = normalizeAttempts(provider.retryPolicy?.maxRetries + 1, 1);
  return {
    project,
    projects,
    activeProjectId: project.id,
    provider,
    providers,
    activeProviderId: payload.activeProviderId ?? provider.id,
    models: payload.models.map((model) => normalizeModel(model, legacyAttempts)),
    templates: payload.templates,
    workflow: payload.workflow ?? defaultWorkflow,
    savedAt: payload.savedAt ?? new Date().toISOString()
  };
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return undefined;
    return normalizeDraft(JSON.parse(raw) as Partial<DraftPayload>);
  } catch {
    return undefined;
  }
}

function projectLogKey(projectId: string) {
  return `${projectLogKeyPrefix}${projectId}`;
}

function normalizeLogEntry(entry: unknown, fallbackProjectId: string): AppLogEntry | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const raw = entry as Partial<AppLogEntry>;
  if (!raw.id || !raw.time || !raw.level || !raw.module || !raw.action || !raw.message) return undefined;
  return {
    id: String(raw.id),
    time: String(raw.time),
    level: raw.level,
    module: raw.module,
    action: String(raw.action),
    message: String(raw.message),
    projectId: raw.projectId ? String(raw.projectId) : fallbackProjectId,
    pageId: raw.pageId ? String(raw.pageId) : undefined,
    detail: raw.detail ? String(raw.detail) : undefined
  };
}

export function loadProjectLogs(projectId: string, limit = maxProjectLogs): AppLogEntry[] {
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(projectLogKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeLogEntry(entry, projectId))
      .filter((entry): entry is AppLogEntry => Boolean(entry))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function saveProjectLogs(projectId: string, logs: AppLogEntry[]) {
  if (!projectId) return;
  try {
    localStorage.setItem(projectLogKey(projectId), JSON.stringify(logs.slice(0, maxProjectLogs)));
  } catch {
    // Logs are helpful diagnostics, but should never block the editor.
  }
}

export function clearProjectLogs(projectId: string) {
  if (!projectId) return;
  try {
    localStorage.removeItem(projectLogKey(projectId));
  } catch {
    // Ignore unavailable WebView storage.
  }
}

function apiKeyCacheKey(keyRef: string) {
  return `${apiKeyCachePrefix}${keyRef}`;
}

export function loadCachedApiKeySecrets(keyRefs: string[]) {
  const result: Record<string, string> = {};
  for (const keyRef of Array.from(new Set(keyRefs))) {
    try {
      const cached = localStorage.getItem(apiKeyCacheKey(keyRef)) || sessionStorage.getItem(`secret:${keyRef}`);
      if (cached) result[keyRef] = cached;
    } catch {
      // Ignore unavailable WebView storage.
    }
  }
  return result;
}

export function cacheApiKeySecrets(secrets: Array<{ keyRef: string; apiKey: string }>) {
  for (const { keyRef, apiKey } of secrets) {
    try {
      if (apiKey.trim()) {
        localStorage.setItem(apiKeyCacheKey(keyRef), apiKey);
        sessionStorage.setItem(`secret:${keyRef}`, apiKey);
      } else {
        clearCachedApiKeySecret(keyRef);
      }
    } catch {
      // Stronghold remains the compatibility store when WebView storage is unavailable.
    }
  }
}

export function clearCachedApiKeySecret(keyRef: string) {
  try {
    localStorage.removeItem(apiKeyCacheKey(keyRef));
    sessionStorage.removeItem(`secret:${keyRef}`);
  } catch {
    // Ignore unavailable WebView storage.
  }
}

export async function clearApiKeySecret(keyRef: string) {
  clearCachedApiKeySecret(keyRef);
  try {
    const native = await getStrongholdStore();
    if (!native) return;
    await native.store.remove(keyRef);
    await native.stronghold.save();
  } catch (error) {
    console.warn("Could not clear API key secret", error);
  }
}

function toPayload(
  projects: ProjectRecord[],
  activeProjectId: string,
  providers: ApiProvider[],
  activeProviderId: string,
  models: ModelConfig[],
  templates: PromptTemplates,
  workflow: WorkflowNodeConfig[]
): DraftPayload {
  const normalizedProjects = projects.map((record) => {
    const project = normalizeProject(record.project);
    return { meta: projectMeta(project), project };
  });
  const activeProject = normalizedProjects.find((record) => record.meta.id === activeProjectId)?.project ?? normalizedProjects[0]?.project;
  const safeProviders = providers.map(({ apiKey: _apiKey, ...safeProvider }) => safeProvider);
  const safeProvider = safeProviders.find((item) => item.id === activeProviderId) ?? safeProviders[0];
  return {
    project: activeProject,
    projects: normalizedProjects,
    activeProjectId: activeProject?.id ?? defaultProjectId,
    provider: safeProvider,
    providers: safeProviders,
    activeProviderId: safeProvider.id,
    models: models.map((model) => normalizeModel(model)),
    templates,
    workflow,
    savedAt: new Date().toISOString()
  };
}

export function saveDraft(
  projects: ProjectRecord[],
  activeProjectId: string,
  providers: ApiProvider[],
  activeProviderId: string,
  models: ModelConfig[],
  templates: PromptTemplates,
  workflow: WorkflowNodeConfig[]
) {
  localStorage.setItem(storageKey, JSON.stringify(toPayload(projects, activeProjectId, providers, activeProviderId, models, templates, workflow)));
}

export async function loadNativeDraft() {
  if (!isTauriRuntime()) return undefined;
  try {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    const db = await Database.load(dbUrl);
    await db.execute(
      "CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)"
    );
    const rows = await db.select<Array<{ payload: string }>>("SELECT payload FROM drafts WHERE id = $1 LIMIT 1", [
      defaultProjectId
    ]);
    if (!rows[0]?.payload) return loadDraft();
    return normalizeDraft(JSON.parse(rows[0].payload) as Partial<DraftPayload>);
  } catch (error) {
    console.warn("Falling back to localStorage draft", error);
    return loadDraft();
  }
}

export async function saveNativeDraft(
  projects: ProjectRecord[],
  activeProjectId: string,
  providers: ApiProvider[],
  activeProviderId: string,
  models: ModelConfig[],
  templates: PromptTemplates,
  workflow: WorkflowNodeConfig[]
) {
  saveDraft(projects, activeProjectId, providers, activeProviderId, models, templates, workflow);

  if (!isTauriRuntime()) {
    return;
  }

  try {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    const db = await Database.load(dbUrl);
    await db.execute(
      "CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)"
    );
    const payload = toPayload(projects, activeProjectId, providers, activeProviderId, models, templates, workflow);
    await db.execute(
      "INSERT INTO drafts (id, payload, updated_at) VALUES ($1, $2, $3) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      [defaultProjectId, JSON.stringify(payload), payload.savedAt]
    );
  } catch (error) {
    console.warn("Could not save native draft", error);
  }
}

async function getStrongholdStore() {
  if (!isTauriRuntime()) return undefined;
  const [{ appDataDir }, { Stronghold }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-stronghold")
  ]);
  const vaultPath = `${await appDataDir()}/ai-comic-studio.hold`;
  const stronghold = await Stronghold.load(vaultPath, "ai-comic-studio-local-vault");
  let client;
  try {
    client = await stronghold.loadClient(secretClient);
  } catch {
    client = await stronghold.createClient(secretClient);
  }
  return { stronghold, store: client.getStore() };
}

export async function saveApiKeySecret(keyRef: string, apiKey: string) {
  return saveApiKeySecrets([{ keyRef, apiKey }]);
}

export async function saveApiKeySecrets(secrets: Array<{ keyRef: string; apiKey: string }>) {
  cacheApiKeySecrets(secrets);

  try {
    const native = await getStrongholdStore();
    if (!native) return;
    for (const { keyRef, apiKey } of secrets) {
      if (apiKey.trim()) {
        const data = Array.from(new TextEncoder().encode(apiKey));
        await native.store.insert(keyRef, data);
      } else {
        await native.store.remove(keyRef);
      }
    }
    await native.stronghold.save();
  } catch (error) {
    console.warn("Could not save API key secrets", error);
  }
}

export async function loadApiKeySecret(keyRef: string) {
  const secrets = await loadApiKeySecrets([keyRef]);
  return secrets[keyRef] ?? "";
}

export async function loadApiKeySecrets(keyRefs: string[]) {
  const result = loadCachedApiKeySecrets(keyRefs);
  const missingRefs = Array.from(new Set(keyRefs)).filter((keyRef) => !result[keyRef]);

  if (!missingRefs.length) return result;

  try {
    const native = await getStrongholdStore();
    if (!native) return result;
    await Promise.all(
      missingRefs.map(async (keyRef) => {
        const data = await native.store.get(keyRef);
        const apiKey = data ? new TextDecoder().decode(new Uint8Array(data)) : "";
        result[keyRef] = apiKey;
        if (apiKey) cacheApiKeySecrets([{ keyRef, apiKey }]);
      })
    );
  } catch {
    for (const keyRef of missingRefs) {
      try {
        result[keyRef] = sessionStorage.getItem(`secret:${keyRef}`) ?? "";
      } catch {
        result[keyRef] = "";
      }
    }
  }

  return result;
}
