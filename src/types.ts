export type WorkspaceTab = "studio" | "storyboard" | "characters" | "anchors" | "projects" | "settings" | "logs" | "export";

export type EndpointMode = "chat-text" | "images" | "image-edits" | "chat-image";

export type PageStatus = "draft" | "queued" | "generating" | "done" | "failed";

export type ExportRatio = "3:4" | "4:5" | "1:1";

export type ReaderMode = "paged" | "long";

export type WorkflowNodeId = "outline" | "storyboard" | "image";

export type AppLogLevel = "info" | "success" | "warn" | "error";

export type AppLogModule = "app" | "project" | "settings" | "planner" | "image" | "export";

export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
}

export interface ApiProvider {
  id: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  apiKeyRef: string;
  authType: "bearer";
  endpointMode: EndpointMode;
  models: string[];
  timeout: number;
  retryPolicy: RetryPolicy;
}

export interface ModelConfig {
  id: string;
  name: string;
  providerId: string;
  model: string;
  kind: "text" | "image";
  endpointMode: EndpointMode;
  requestAttempts?: number;
  temperature?: number;
  size?: string;
}

export interface PromptTemplates {
  outline: string;
  storyboard: string;
  imagePositive: string;
  imageNegative: string;
  regenerate: string;
}

export interface CharacterTemplate {
  id: string;
  name: string;
  description: string;
  palette: string;
  prompt: string;
  referenceImages?: CharacterReferenceImage[];
  characterSheetUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CharacterReferenceImage {
  id: string;
  label: string;
  url: string;
  createdAt: string;
}

export type VisualAnchorType = "product" | "prop" | "scene" | "logo" | "style";

export interface VisualAnchorImage {
  id: string;
  label: string;
  url: string;
  useAsReference?: boolean;
  createdAt: string;
}

export interface VisualAnchor {
  id: string;
  name: string;
  type: VisualAnchorType;
  description: string;
  usagePrompt: string;
  images: VisualAnchorImage[];
  primaryImageUrl?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PageImageVersion {
  id: string;
  imageUrl: string;
  prompt: string;
  negativePrompt: string;
  modelId: string;
  seed: number;
  createdAt: string;
  label: string;
}

export interface WorkflowNodeConfig {
  id: WorkflowNodeId;
  label: string;
  providerId: string;
  modelId: string;
  promptTemplateId: keyof PromptTemplates;
}

export interface ComicPage {
  id: string;
  pageNumber: number;
  title: string;
  beat: string;
  shot: string;
  character: string;
  characterIds: string[];
  anchorIds?: string[];
  anchorBindingMode?: "auto" | "manual";
  background: string;
  ratio: ExportRatio;
  prompt: string;
  negativePrompt: string;
  modelId: string;
  status: PageStatus;
  progress: number;
  imageUrl?: string;
  error?: string;
  seed: number;
  versions: PageImageVersion[];
  selectedVersionId?: string;
}

export interface ComicProject {
  id: string;
  name: string;
  storyInput: string;
  outline: string;
  pages: ComicPage[];
  selectedPageId?: string;
  selectedCharacterId: string;
  selectedAnchorId?: string;
  castCharacterIds: string[];
  deletedCharacterIds: string[];
  customCharacters: CharacterTemplate[];
  visualAnchors: VisualAnchor[];
  exportRatio: ExportRatio;
  targetPageCount: number;
  concurrency: number;
  readerMode: ReaderMode;
  styleLockPrompt: string;
  longImageUrl?: string;
  updatedAt: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  pageCount: number;
  doneCount: number;
}

export interface ProjectRecord {
  meta: ProjectMeta;
  project: ComicProject;
}

export interface AppLogEntry {
  id: string;
  time: string;
  level: AppLogLevel;
  module: AppLogModule;
  action: string;
  message: string;
  projectId?: string;
  pageId?: string;
  detail?: string;
}

export interface GenerationSettings {
  provider: ApiProvider;
  textModel: ModelConfig;
  imageModel: ModelConfig;
  templates: PromptTemplates;
  workflow: WorkflowNodeConfig[];
}

export interface PlannerResult {
  outline: string;
  pages: ComicPage[];
}
