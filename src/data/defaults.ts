import { ApiProvider, CharacterTemplate, ComicProject, ModelConfig, PromptTemplates, WorkflowNodeConfig } from "../types";

export const characterTemplates: CharacterTemplate[] = [
];

export const promptTemplates: PromptTemplates = {
  outline: `你是漫画编剧。根据用户故事生成适合短图集漫画的大纲。
输出中文，包含：主题、角色、冲突、转折、结尾情绪。`,
  storyboard: `你是分镜师。把漫画大纲拆成指定页数的图集。
每页包含：页标题、剧情片段、画面构图、角色、背景、图片提示词。`,
  imagePositive: `生成一张适合社交平台翻页图集的漫画页。
角色模板：{{character}}
剧情：{{beat}}
画面：{{shot}}
背景：{{background}}
要求：干净构图、主体明确、中文文字区域留白、连续漫画感、专业插画质量。`,
  imageNegative: "low quality, blurry, watermark, distorted hands, unreadable text, messy layout, duplicate character",
  regenerate: `保留这一页的剧情目的，但根据用户修改重写图片提示词。
当前页：{{beat}}
修改要求：{{edit}}`
};

export const defaultProvider: ApiProvider = {
  id: "new-api-main",
  providerName: "New API 中转站",
  baseUrl: "https://api.example.com/v1",
  apiKey: "",
  apiKeyRef: "local-secret:new-api-main",
  authType: "bearer",
  endpointMode: "images",
  models: ["gpt-image-2", "image2.0", "gpt-4o-mini"],
  timeout: 300000,
  retryPolicy: {
    maxRetries: 2,
    retryDelayMs: 1200
  }
};

export const defaultModels: ModelConfig[] = [
  {
    id: "text-router",
    name: "大纲/分页模型",
    providerId: "new-api-main",
    model: "gpt-4o-mini",
    kind: "text",
    endpointMode: "chat-text",
    requestAttempts: 1,
    temperature: 0.8
  },
  {
    id: "image-router",
    name: "图片生成模型",
    providerId: "new-api-main",
    model: "image2.0",
    kind: "image",
    endpointMode: "images",
    requestAttempts: 1,
    size: "1024x1536"
  }
];

export const defaultWorkflow: WorkflowNodeConfig[] = [
  {
    id: "outline",
    label: "剧情/大纲生成",
    providerId: "new-api-main",
    modelId: "text-router",
    promptTemplateId: "outline"
  },
  {
    id: "storyboard",
    label: "分页分镜生成",
    providerId: "new-api-main",
    modelId: "text-router",
    promptTemplateId: "storyboard"
  },
  {
    id: "image",
    label: "图片生成",
    providerId: "new-api-main",
    modelId: "image-router",
    promptTemplateId: "imagePositive"
  }
];

export const defaultProject: ComicProject = {
  id: "project-demo",
  name: "新漫画项目",
  storyInput:
    "一个总是加班的年轻人捡到一只会写便签的小狗。小狗每天只写一句话，却慢慢帮他找回生活的节奏。最后他发现，小狗其实是在替未来的自己提醒现在的自己。",
  outline: "",
  pages: [],
  selectedCharacterId: "",
  castCharacterIds: [],
  deletedCharacterIds: [],
  customCharacters: [],
  exportRatio: "3:4",
  targetPageCount: 0,
  concurrency: 4,
  readerMode: "paged",
  styleLockPrompt: "consistent original vertical webcomic style, same line weight, same color palette, same character proportions, clean readable composition, coherent lighting across all pages",
  updatedAt: new Date().toISOString()
};
