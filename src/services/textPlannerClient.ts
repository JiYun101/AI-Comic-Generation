import { defaultModels, promptTemplates } from "../data/defaults";
import { nowId } from "../lib/utils";
import { buildCastPrompt } from "./storyPlanner";
import { ApiProvider, CharacterTemplate, ComicPage, ExportRatio, ModelConfig, PlannerResult, PromptTemplates } from "../types";

interface ApiPlannerPage {
  title?: string;
  beat?: string;
  shot?: string;
  character?: string;
  characterIds?: string[];
  characters?: string[];
  background?: string;
  prompt?: string;
}

interface ApiPlannerPayload {
  outline?: string;
  pages?: ApiPlannerPage[];
}

function endpoint(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function extractText(payload: unknown) {
  const data = payload as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) return String((item as { text?: string }).text ?? "");
        return "";
      })
      .join("\n");
  }
  return "";
}

function parseJsonText(text: string): ApiPlannerPayload {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  return JSON.parse(candidate) as ApiPlannerPayload;
}

function resolvePageCharacters(page: ApiPlannerPage, characters: CharacterTemplate[]) {
  const ids = new Set<string>();
  const byId = new Map(characters.map((character) => [character.id, character]));
  const names = [...(page.characterIds ?? []), ...(page.characters ?? [])];
  if (page.character) names.push(...page.character.split(/[、,，/|]/));

  for (const raw of names) {
    const value = raw.trim();
    if (!value) continue;
    if (byId.has(value)) ids.add(value);
    const matched = characters.find((character) => value.includes(character.name) || character.name.includes(value));
    if (matched) ids.add(matched.id);
  }

  if (!ids.size && characters[0]) ids.add(characters[0].id);
  return characters.filter((character) => ids.has(character.id));
}

function pagePrompt(template: PromptTemplates, characters: CharacterTemplate[], page: Required<Omit<ApiPlannerPage, "characterIds" | "characters">>) {
  return (page.prompt?.trim() || template.imagePositive)
    .replace("{{character}}", buildCastPrompt(characters))
    .replace("{{beat}}", page.beat)
    .replace("{{shot}}", page.shot)
    .replace("{{background}}", page.background);
}

export async function planComicWithNewApi({
  story,
  provider,
  model,
  templates,
  characters = [],
  ratio,
  targetPageCount = 8
}: {
  story: string;
  provider: ApiProvider;
  model: ModelConfig;
  templates: PromptTemplates;
  characters?: CharacterTemplate[];
  ratio: ExportRatio;
  targetPageCount?: number;
}): Promise<PlannerResult> {
  const cast = characters.filter(Boolean);
  const manualPageCount = targetPageCount && targetPageCount > 0 ? Math.min(30, Math.max(1, Math.round(targetPageCount))) : undefined;
  const pageCountInstruction = manualPageCount
    ? `目标页数：${manualPageCount}\n要求：必须拆成正好 ${manualPageCount} 页。`
    : "目标页数：AI 自动决定\n要求：请根据故事复杂度自行决定最佳页数，范围 6-12 页；短故事用 6-8 页，转折较多的故事用 9-12 页。";
  if (!provider.apiKey.trim()) {
    throw new Error("请先配置 API Key。");
  }

  const castList = cast
    .map((character, index) => `${String.fromCharCode(65 + index)}. id=${character.id}, name=${character.name}, description=${character.description}`)
    .join("\n") || "（当前项目没有固定人设；请按故事内容生成临时角色，characterIds 返回空数组。）";
  const characterInstruction = cast.length
    ? "每页根据剧情选择一个或多个出场角色，并把角色 id 写入 characterIds。characterIds 只能使用项目演员表里的 id。"
    : "当前没有项目演员表。每页 characterIds 必须返回空数组，不要编造角色 id。";

  const response = await fetch(endpoint(provider.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: model.model,
      temperature: model.temperature ?? 0.8,
      messages: [
        {
          role: "system",
          content:
            "你是专业中文漫画编剧和分镜师。只输出 JSON，不输出 Markdown。字段为 outline:string 和 pages:array。pages 每项必须包含 title, beat, shot, character, characterIds, background, prompt。"
        },
        {
          role: "user",
          content: `${templates.outline}\n\n${templates.storyboard}\n\n项目演员表：\n${castList}\n\n图片比例：${ratio}\n${pageCountInstruction}\n用户故事：${story}\n\n通用要求：适合抖音/小红书翻页图集。${characterInstruction} 只输出 JSON，不要输出 Markdown。`
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`文本模型 ${response.status}: ${text.slice(0, 300)}`);
  }

  const raw = extractText(await response.json());
  const parsed = parseJsonText(raw);
  if (!parsed.outline || !parsed.pages?.length) {
    throw new Error("文本模型没有返回 outline/pages JSON。");
  }

  const pages: ComicPage[] = (manualPageCount ? parsed.pages.slice(0, manualPageCount) : parsed.pages).map((rawPage, index) => {
    const pageCharacters = resolvePageCharacters(rawPage, cast);
    const characterText = pageCharacters.map((character) => character.name).join("、") || rawPage.character?.trim() || "按故事临时生成";
    const page: Required<Omit<ApiPlannerPage, "characterIds" | "characters">> = {
      title: rawPage.title?.trim() || `第 ${index + 1} 页`,
      beat: rawPage.beat?.trim() || "推进一个清晰剧情节拍。",
      shot: rawPage.shot?.trim() || "干净漫画构图，主体明确，留出文字区。",
      character: rawPage.character?.trim() || characterText,
      background: rawPage.background?.trim() || "简洁日常背景",
      prompt: rawPage.prompt?.trim() || promptTemplates.imagePositive
    };

    return {
      id: nowId("page"),
      pageNumber: index + 1,
      title: page.title,
      beat: page.beat,
      shot: page.shot,
      character: characterText,
      characterIds: pageCharacters.map((character) => character.id),
      background: page.background,
      ratio,
      prompt: pagePrompt(templates, pageCharacters, page),
      negativePrompt: templates.imageNegative,
      modelId: defaultModels[1].id,
      status: "draft",
      progress: 0,
      seed: Math.floor(Math.random() * 100000),
      versions: []
    };
  });

  return {
    outline: parsed.outline,
    pages
  };
}
