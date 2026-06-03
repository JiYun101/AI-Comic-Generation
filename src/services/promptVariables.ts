import { PromptTemplates } from "../types";

export type PromptTemplateKey = keyof PromptTemplates;

export interface PromptVariable {
  name: string;
  label: string;
  source: string;
  description: string;
}

export const promptTemplateLabel: Record<PromptTemplateKey, string> = {
  outline: "大纲生成提示词",
  storyboard: "分镜生成提示词",
  imagePositive: "图片正向提示词",
  imageNegative: "图片负向提示词",
  regenerate: "单页重绘提示词"
};

export const promptTemplateNodeLabel: Record<PromptTemplateKey, string> = {
  outline: "文本规划 / 大纲节点",
  storyboard: "文本规划 / 分镜节点",
  imagePositive: "图片生成节点",
  imageNegative: "图片生成节点",
  regenerate: "单页重绘节点"
};

const storyVariables: PromptVariable[] = [
  { name: "input", label: "主题 / 故事输入", source: "创作台", description: "创作台里输入的故事、主题或梗概。" },
  { name: "story", label: "故事输入", source: "创作台", description: "和 input 相同，作为英文别名保留。" },
  { name: "character", label: "角色模板", source: "人设 / 演员表", description: "当前项目演员表的角色设定文本。" },
  { name: "cast", label: "演员表", source: "人设 / 演员表", description: "当前项目演员表，包含角色 id、名称和描述。" },
  { name: "ratio", label: "画面比例", source: "项目设置", description: "当前项目比例，例如 3:4、4:5、1:1。" },
  { name: "targetPageCount", label: "目标页数", source: "创作台", description: "手动页数或 AI 自动页数。" }
];

export const promptTemplateVariables: Record<PromptTemplateKey, PromptVariable[]> = {
  outline: storyVariables,
  storyboard: [
    { name: "outline", label: "大纲内容", source: "大纲节点输出", description: "大纲生成结果；当前合并规划模式下会提示模型使用上方大纲。" },
    ...storyVariables
  ],
  imagePositive: [
    { name: "character", label: "角色模板", source: "分镜页 / 人设", description: "当前页出场角色的完整外观与一致性设定。" },
    { name: "beat", label: "剧情", source: "分镜页", description: "当前页剧情节拍。" },
    { name: "shot", label: "画面", source: "分镜页", description: "当前页镜头、构图与动作描述。" },
    { name: "background", label: "背景", source: "分镜页", description: "当前页场景与环境。" }
  ],
  imageNegative: [],
  regenerate: [
    { name: "beat", label: "当前页剧情", source: "分镜页", description: "正在重绘的页面剧情。" },
    { name: "edit", label: "修改要求", source: "单页重绘", description: "你输入的重绘修改要求。" },
    { name: "character", label: "角色模板", source: "分镜页 / 人设", description: "当前页角色设定。" },
    { name: "shot", label: "画面", source: "分镜页", description: "当前页原镜头描述。" },
    { name: "background", label: "背景", source: "分镜页", description: "当前页场景。" }
  ]
};

export const recommendedPromptTemplates: PromptTemplates = {
  outline: `你是一个专业的故事策划与视觉分镜编剧系统。

你的任务是：根据用户输入，生成适合AI图像生成与漫画分镜的结构化大纲。

【输入】
主题：{{input}}

【要求】
请输出结构化故事大纲，必须包含：

1. 故事核心概念（1-2句话）
2. 主角设定（外貌 + 性格 + 视觉标签）
3. 世界观设定（时间 / 地点 / 风格）
4. 情绪基调（例如：压抑 / 治愈 / 科幻冷感）
5. 关键剧情节点（3-6个 beat，每个一句话）
6. 视觉风格关键词（用于AI绘图）

【约束】
- 必须适合“视觉叙事”
- 必须可拆分成分镜
- 禁止抽象文学表达
- 必须偏“画面驱动”而不是“文字小说”`,
  storyboard: `你是专业电影分镜导演 + AI视觉设计师。

根据以下故事结构，生成标准分镜脚本。

【输入大纲】
{{outline}}

【输出要求】
请生成 6~12 个分镜（shot），每个包含：

- shot_id
- 画面描述（必须可视化）
- 镜头类型（远景 / 中景 / 特写 / 跟拍）
- 镜头运动（静止 / 推 / 拉 / 摇 / 跟）
- 人物动作
- 情绪表达
- 光影描述
- 画面重点（AI绘图重点提示）

【强制规则】
- 必须保证人物一致性
- 必须保持视觉连续性
- 每一镜头必须“可画出来”
- 禁止抽象描述（如“他很感动”→必须转为画面行为）`,
  imagePositive: `生成一张适合社交平台翻页图集的漫画页。

【角色模板】
{{character}}

【剧情】
{{beat}}

【画面】
{{shot}}

【背景】
{{background}}

【强化要求（非常重要）】
你是专业电影级插画AI提示词工程师，请将以上内容转化为高质量图像生成提示词。

必须满足：
- 干净构图
- 主体明确
- 连续漫画感（不是单张海报）
- 专业插画质量
- 电影级光影
- 明确镜头语言（远景/中景/特写）
- 空出对话框 / 旁白区域
- 人物保持一致性
- 画面具有叙事性

【输出】
输出一段可直接用于 Midjourney / Stable Diffusion / Flux 的英文Prompt`,
  imageNegative: `low quality, low resolution, blurry, jpeg artifacts, bad anatomy, deformed hands, extra fingers, missing fingers, poorly drawn face, distorted face, disfigured, duplicate body, bad proportions, unnatural pose, messy composition, cluttered background, text artifacts, watermark, logo, oversaturated, overexposed, underexposed, noisy image, cartoonish, flat lighting, inconsistent style`,
  regenerate: `你是专业漫画修图与AI重绘提示词工程师。

你的任务是：在不改变剧情目的的前提下，根据用户修改要求，重新生成图像生成Prompt。

【当前页剧情】
{{beat}}

【修改要求】
{{edit}}

【任务】
请重新生成优化后的图像生成Prompt，使其：

- 保持原剧情不变
- 只优化视觉表现
- 增强画面表现力
- 保持人物一致性
- 优化构图、镜头与光影
- 提升AI可生成质量

【输出要求】
输出：
1. 新正向Prompt（英文）
2. 可选优化说明（1-3条）`
};

export function renderPromptTemplate(template: string, values: Record<string, string | number | undefined>) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === "" ? match : String(value);
  });
}

