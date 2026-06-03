import { defaultModels, promptTemplates } from "../data/defaults";
import { nowId } from "../lib/utils";
import { CharacterTemplate, ComicPage, PlannerResult, PromptTemplates } from "../types";
import { renderPromptTemplate } from "./promptVariables";

const defaultBeats = [
  "主角被日常压力困住，故事从一个具体的小麻烦开始。",
  "关键角色出现，带来一个看似不起眼但很特别的提示。",
  "主角第一次照着提示行动，事情没有立刻变好，却出现微小变化。",
  "误会或阻力升级，主角开始怀疑这个办法是否有用。",
  "角色之间产生真诚连接，故事的真实主题浮出水面。",
  "主角主动做出选择，不再只是被生活推着走。",
  "最后的反转揭示提示的来源，情绪落在温暖或会心一笑上。"
];

const stageTitles = ["开场", "出现", "靠近", "试探", "阻力", "连接", "选择", "反转", "余韵", "继续"];
const stageActions = [
  "建立故事处境和主角状态",
  "让关键人物或物件进入画面",
  "推进第一次互动",
  "展示主角尝试改变",
  "制造误会、阻力或情绪低点",
  "让人物关系产生新的理解",
  "让主角做出主动选择",
  "揭示故事背后的真正含义",
  "用安静画面承接情绪",
  "留下适合继续连载的收束"
];
const shotTypes = [
  "远景建立环境，主体在画面下三分之一处，顶部留出文字区。",
  "中景表现人物互动，动作清楚，视线引导到关键物件。",
  "近景突出表情和情绪变化，背景简化。",
  "俯视构图展示桌面、手机、便签或生活细节。",
  "左右分割构图，对比行动前后的变化。",
  "特写关键物件，让故事信息一眼可读。",
  "低机位或背影构图，表现角色做出决定。",
  "留白构图，适合一句短文案或情绪收尾。"
];
const backgroundHints = ["家中", "办公桌", "街边", "地铁/公交", "便利店", "窗边", "手机屏幕旁", "白色留白背景", "清晨街道", "夜晚房间"];

function sentenceChunks(story: string) {
  return story
    .split(/[。！？!?；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function storySegment(storySentences: string[], index: number, pageCount: number) {
  if (!storySentences.length) return "";
  if (storySentences.length === 1) return storySentences[0];
  const mappedIndex = Math.min(storySentences.length - 1, Math.floor((index / Math.max(pageCount - 1, 1)) * storySentences.length));
  return storySentences[mappedIndex];
}

function buildBeat(storySentences: string[], index: number, pageCount: number) {
  const source = storySegment(storySentences, index, pageCount);
  const fallback = defaultBeats[index] ?? defaultBeats[defaultBeats.length - 1];
  const stage = stageActions[Math.min(stageActions.length - 1, Math.floor((index / Math.max(pageCount - 1, 1)) * stageActions.length))];
  return source ? `${stage}：${source}` : fallback;
}

function decidePageCount(storySentences: string[], targetPageCount: number) {
  if (targetPageCount > 0) return Math.min(30, Math.max(1, Math.round(targetPageCount)));
  if (!storySentences.length) return 8;
  return Math.min(12, Math.max(6, storySentences.length + 3));
}

export function buildCharacterPrompt(character: CharacterTemplate, index = 0) {
  const referenceText = character.referenceImages?.length
    ? ` Visual reference labels: ${character.referenceImages.map((image) => image.label).join(", ")}. Use references only for identity and appearance; never draw reference sheet layout, labels, notes, UI frame, or multi-view comparison into comic pages.`
    : "";
  const role = String.fromCharCode(65 + index);
  return `Character ${role} / ${character.name}: ${character.description}. ${character.prompt}. Palette: ${character.palette}. Keep identity, gender, face, outfit, age impression and silhouette consistent across every page.${referenceText}`;
}

export function buildCastPrompt(characters: CharacterTemplate[]) {
  return characters.map((character, index) => buildCharacterPrompt(character, index)).join("\n");
}

function pickPageCharacters(characters: CharacterTemplate[], story: string, index: number, pageCount: number) {
  const primary = characters[0];
  if (!primary) return [];
  if (characters.length <= 1) return [primary];

  const cleanStory = story.toLowerCase();
  const matched = characters.filter((character) => cleanStory.includes(character.name.toLowerCase()));
  if (matched.length > 1) return Array.from(new Map(matched.map((character) => [character.id, character])).values());

  const selected = [primary];
  const secondary = characters[(index % (characters.length - 1)) + 1];
  const shouldAddSecondary = index > 0 && (index >= pageCount - 2 || index % 2 === 1);
  if (secondary && shouldAddSecondary) selected.push(secondary);
  return selected;
}

export function planComicFromStory(
  story: string,
  characters: CharacterTemplate[] = [],
  ratio = "3:4",
  targetPageCount = 8,
  templates: PromptTemplates = promptTemplates
): PlannerResult {
  const cast = characters.filter(Boolean);
  const cleanStory = story.trim() || "一个普通人遇见一只会写便签的小狗，逐渐找回生活节奏。";
  const storySentences = sentenceChunks(cleanStory);
  const pageCount = decidePageCount(storySentences, targetPageCount);
  const castNames = cast.map((character) => character.name).join("、");
  const castOutline = castNames
    ? `角色：项目演员表包含 ${castNames}，每页根据剧情分配出场角色，并保持角色身份一致。`
    : "角色：当前项目还没有固定人设，先按故事内容生成临时角色；添加人设后可在分镜页为每页绑定角色。";

  const outline = [
    "主题：用轻巧的奇遇讲一个关于找回节奏和自我提醒的故事。",
    castOutline,
    "冲突：主角想快速解决现实压力，但真正需要改变的是看待生活的方式。",
    "转折：每一页都用一个小动作推进情绪，从疑惑、试探到主动选择。",
    "结尾：用温暖反转收束，让读者愿意保存或转发。"
  ].join("\n");

  const pages: ComicPage[] = Array.from({ length: pageCount }).map((_, index) => {
    const pageNumber = index + 1;
    const pageCharacters = pickPageCharacters(cast, cleanStory, index, pageCount);
    const pageCharacterText = pageCharacters.map((character) => character.name).join("、");
    const source = storySegment(storySentences, index, pageCount);
    const beat = buildBeat(storySentences, index, pageCount);
    const title = source ? `${stageTitles[index % stageTitles.length]}：${source.slice(0, 12)}` : `第 ${pageNumber} 页`;
    const shot = `${shotTypes[index % shotTypes.length]} 画面重点：${source || beat}`;
    const background = backgroundHints[index % backgroundHints.length];
    const prompt = renderPromptTemplate(templates.imagePositive, {
      character: buildCastPrompt(pageCharacters) || "No fixed character sheet is selected. Design characters directly from the story while keeping a clean original comic style.",
      beat,
      shot,
      background
    });

    return {
      id: nowId("page"),
      pageNumber,
      title,
      beat,
      shot,
      character: pageCharacterText,
      characterIds: pageCharacters.map((character) => character.id),
      background,
      ratio: ratio as ComicPage["ratio"],
      prompt,
      negativePrompt: templates.imageNegative,
      modelId: defaultModels[1].id,
      status: "draft",
      progress: 0,
      seed: Math.floor(Math.random() * 100000),
      versions: []
    };
  });

  return { outline, pages };
}
