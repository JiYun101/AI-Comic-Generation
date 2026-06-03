import { ApiProvider, CharacterTemplate, ComicPage, EndpointMode, ModelConfig, VisualAnchor } from "../types";

type ImageGenerationPurpose = "comic-page" | "character-sheet";

interface ImageGenerationInput {
  provider: ApiProvider;
  model: ModelConfig;
  page: ComicPage;
  characters?: CharacterTemplate[];
  anchors?: VisualAnchor[];
  purpose?: ImageGenerationPurpose;
  signal?: AbortSignal;
}

interface ProviderModelPayload {
  data?: Array<{ id?: string; object?: string }>;
  models?: Array<string | { id?: string; name?: string }>;
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function dataUrlMime(dataUrl: string) {
  return dataUrl.match(/data:(.*?);base64/)?.[1] || "image/png";
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, base64 = ""] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mime });
}

async function imageUrlToDataUrl(url: string) {
  if (url.startsWith("data:image")) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取参考图失败 ${response.status}: ${url}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("参考图读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlExtension(dataUrl: string) {
  const mime = dataUrlMime(dataUrl);
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function friendlyApiError(message: string, url = "") {
  const isChatCompletions = /\/chat\/completions/i.test(url);
  const isImagesGenerations = /\/images\/generations/i.test(url);
  if (/\b524\b|unknown status code.*524|error code:\s*524/i.test(message)) {
    return [
      "上游网关超时（524）。",
      "这表示请求已经到达渠道或中转，但它没有在网关允许的时间内把最终图片响应返回给客户端。",
      "上游后台仍可能继续生成并计费，所以你会在上游日志里看到生成成功；但客户端这条 HTTP 连接已经断开，拿不到图片 URL 或 base64。",
      "处理方法：把项目并发数先降到 1，确认单张稳定后再调到 2；同时把渠道超时设到 300-600 秒。若仍频繁出现，只能换更稳定的图片渠道或让上游支持任务轮询/异步取图。",
      `原始错误：${message}`
    ].join("\n");
  }
  if (/invalid_input_fidelity_model|input_fidelity/i.test(message)) {
    return [
      "图片编辑接口参数不兼容。",
      "当前模型不支持 input_fidelity 参数。客户端已移除该参数，请重新生成。",
      `原始错误：${message}`
    ].join("\n");
  }
  if (/body-read-failed|error decoding response body|读取 API 响应失败|failed to read API response body/i.test(message)) {
    return [
      "客户端读取图片响应体失败。",
      "这通常发生在上游已经生成完成，但返回体编码、压缩或连接分块异常，客户端没能把最终响应读出来。",
      "你在上游日志里看到消费成功是合理的；这类错误不适合自动重试，否则可能重复扣费。",
      "处理方法：先把该图片模型的请求超时调到 600 秒；如果仍出现，建议让渠道返回标准 JSON 图片 URL/base64，或更换更稳定的图片渠道。",
      `原始错误：${message}`
    ].join("\n");
  }
  if (/operation timed out|timed out|timeout|aborted/i.test(message)) {
    return [
      "客户端等待图片结果超时。",
      "这不一定代表上游没有生成成功：有些上游会先接收任务，随后才返回图片；客户端超时断开后，上游日志里仍可能显示已生成。",
      "处理方法：到「模型」页把当前渠道的请求超时调到 300-600 秒，并把项目并发数先降到 1-2 后重试。",
      `原始错误：${message}`
    ].join("\n");
  }
  if (/gpt-image-2/i.test(message) && /not supported|unsupported|invalid_request/i.test(message)) {
    if (isChatCompletions) {
      return [
        "当前模型 gpt-image-2 在 /chat/completions 图片模式不可用。",
        "你这个渠道在 /images/generations 可以用，所以请到「模型配置」把图片模型的「调用端点」改成 /images/generations。",
        "说明：/chat/completions 图片模式会把图片当聊天消息处理，部分上游会按 ChatGPT/Codex 账号限制拦截；/images/generations 是专门的生图接口。",
        `原始错误：${message}`
      ].join("\n");
    }
    if (isImagesGenerations) {
      return [
        "当前账号或渠道在 /images/generations 不支持 gpt-image-2。",
        "请在「模型配置」里换成当前渠道实际可用的图片模型。",
        `原始错误：${message}`
      ].join("\n");
    }
    return [
      "当前账号或渠道不支持 gpt-image-2。",
      "如果 /images/generations 可以用，请优先把图片模型的调用端点改成 /images/generations；否则再更换模型 ID。",
      `原始错误：${message}`
    ].join("\n");
  }
  if (/model.*not supported|model_not_found|does not exist/i.test(message)) {
    return `当前图片模型不可用，请在「模型配置」中改用渠道返回的可用模型。\n原始错误：${message}`;
  }
  return message;
}

function toError(error: unknown, url = "") {
  if (error instanceof Error) return new Error(friendlyApiError(error.message, url));
  if (typeof error === "string") return new Error(friendlyApiError(error, url));
  return new Error("API 请求失败。");
}

function payloadPreview(value: unknown): string {
  function sanitize(item: unknown, depth = 0): unknown {
    if (depth > 5) return "[Nested payload]";
    if (typeof item === "string") {
      if (item.startsWith("data:image")) return `${item.slice(0, 96)}... (${item.length} chars)`;
      if (/^[A-Za-z0-9+/_=-]{500,}$/.test(item.trim())) return `${item.slice(0, 96)}... (${item.length} chars)`;
      return item.length > 1200 ? `${item.slice(0, 1200)}... (${item.length} chars)` : item;
    }
    if (Array.isArray(item)) {
      const preview = item.slice(0, 8).map((child) => sanitize(child, depth + 1));
      return item.length > 8 ? [...preview, `... ${item.length - 8} more items`] : preview;
    }
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .slice(0, 30)
          .map(([key, child]) => [key, sanitize(child, depth + 1)])
      );
    }
    return item;
  }

  try {
    return JSON.stringify(sanitize(value), null, 2).slice(0, 2200);
  } catch {
    return String(value).slice(0, 2200);
  }
}

function unrecognizedImageError(source: string, payload: unknown) {
  return new Error(`${source}返回成功，但客户端没有找到可用的图片 URL 或 base64。\n响应预览：${payloadPreview(payload)}`);
}

function findImageValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (value.startsWith("data:image")) return value;
    if (/^https?:\/\/\S+/i.test(value) && /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(value)) return value;
    const dataMatch = value.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
    const urlMatch = value.match(/https?:\/\/\S+/);
    if (dataMatch?.[0]) return dataMatch[0];
    if (urlMatch?.[0]) return urlMatch[0];
    const compact = value.trim().replace(/\s/g, "");
    if (/^[A-Za-z0-9+/_=-]{200,}$/.test(compact)) return `data:image/png;base64,${compact.replace(/-/g, "+").replace(/_/g, "/")}`;
    if (/^[\[{]/.test(value.trim())) {
      try {
        return findImageValue(JSON.parse(value));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageValue(item);
      if (found) return found;
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["url", "image_url", "imageUrl", "b64_json", "base64", "data", "content", "output"]) {
      const found = findImageValue(record[key]);
      if (found) return found;
    }
    for (const item of Object.values(record)) {
      const found = findImageValue(item);
      if (found) return found;
    }
  }

  return undefined;
}

function extractImageUrl(payload: unknown): string | undefined {
  const data = payload as {
    data?: Array<{ url?: string; b64_json?: string }>;
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; image_url?: { url?: string }; text?: string }>;
      };
    }>;
  };

  const image = data.data?.[0];
  if (image?.url) return image.url;
  if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;

  const content = data.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.image_url?.url) return item.image_url.url;
      if (item.text?.startsWith("data:image")) return item.text;
      if (item.text?.startsWith("http")) return item.text;
    }
  }
  if (typeof content === "string") {
    const urlMatch = content.match(/https?:\/\/\S+/);
    const dataMatch = content.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
    return dataMatch?.[0] ?? urlMatch?.[0];
  }

  return findImageValue(payload);
}

function buildCharacterText(characters: CharacterTemplate[]) {
  return characters
    .map((character, index) => {
      const role = String.fromCharCode(65 + index);
      return [
        `Character ${role} / ${character.name}`,
        `Description: ${character.description}`,
        `Visual prompt: ${character.prompt}`,
        character.palette ? `Palette: ${character.palette}` : "",
        "Keep identity, gender, face, outfit, age impression and silhouette stable across pages.",
        "Use any attached reference image only as appearance reference. Do not draw the reference sheet, labels, notes, UI frame, thumbnails, turnaround grid, or character-setting text into the comic page."
      ]
        .filter(Boolean)
        .join(". ");
    })
    .join("\n");
}

function isSheetLikeReference(label: string) {
  return /设定|角色|三视图|多角度|参考|sheet|turnaround|model sheet|reference/i.test(label);
}

function getReferenceImageUrls(characters: CharacterTemplate[], purpose: ImageGenerationPurpose) {
  const urls = new Map<string, string>();
  for (const character of characters) {
    const perCharacter = new Map<string, string>();
    const referenceImages = character.referenceImages ?? [];
    const orderedUrls =
      purpose === "comic-page"
        ? [
            character.characterSheetUrl,
            ...referenceImages.filter((image) => !isSheetLikeReference(image.label)).map((image) => image.url),
            ...referenceImages.filter((image) => isSheetLikeReference(image.label)).map((image) => image.url)
          ]
        : [...referenceImages.map((image) => image.url), character.characterSheetUrl];

    for (const url of orderedUrls) {
      if (url) perCharacter.set(url, url);
    }

    for (const url of Array.from(perCharacter.values()).slice(0, 2)) {
      urls.set(url, url);
    }
  }
  return Array.from(urls.values()).slice(0, 6);
}

function getAnchorReferenceImageUrls(anchors: VisualAnchor[]) {
  const urls = new Map<string, string>();
  for (const anchor of anchors.filter((item) => item.enabled !== false)) {
    const perAnchor = new Map<string, string>();
    const images = anchor.images ?? [];
    const orderedUrls = [
      anchor.primaryImageUrl,
      ...images.map((image) => image.url)
    ];

    for (const url of orderedUrls) {
      if (url) perAnchor.set(url, url);
    }

    for (const url of Array.from(perAnchor.values()).slice(0, 2)) {
      urls.set(url, url);
    }
  }
  return Array.from(urls.values()).slice(0, 8);
}

function referenceGuard(purpose: ImageGenerationPurpose, hasReferences: boolean) {
  if (purpose === "character-sheet") {
    return [
      "Create a new clean character design sheet.",
      hasReferences ? "Use attached images only to preserve appearance; do not copy their text, labels, UI frames, or watermarks." : "",
      "Keep labels minimal and avoid long character-setting paragraphs."
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Final output must be one finished vertical comic page for the story scene, not a character design sheet.",
    hasReferences
      ? "Attached images are visual references only: copy the character identity, face, clothing, palette and proportions, but never reproduce the reference image itself."
      : "",
    "Do not include character-setting text, reference labels, multi-view layout, front/side/back comparison, design notes, UI panels, screenshots, thumbnails, watermarks, or explanatory captions.",
    "If text is needed, leave a clean blank caption area instead of writing character profile text."
  ]
    .filter(Boolean)
    .join("\n");
}

async function requestJson(url: string, provider: ApiProvider, body: unknown, signal?: AbortSignal) {
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke<unknown>("post_api_json_native", {
        request: {
          url,
          apiKey: provider.apiKey,
          body,
          timeoutMs: provider.timeout
        }
      });
    } catch (error) {
      throw toError(error, url);
    }
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), provider.timeout || 300000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body)
    });
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(friendlyApiError(`API ${response.status}: ${text.slice(0, 300)}`, url));
  }

  return response.json();
}

async function requestFormJson(url: string, provider: ApiProvider, form: FormData, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), provider.timeout || 300000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: form
    });
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(friendlyApiError(`API ${response.status}: ${text.slice(0, 300)}`, url));
  }

  return response.json();
}

async function requestImageEditJson(url: string, provider: ApiProvider, model: ModelConfig, prompt: string, referenceUrls: string[], signal?: AbortSignal) {
  const dataUrls = await Promise.all(referenceUrls.map(imageUrlToDataUrl));
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke<unknown>("post_api_multipart_native", {
        request: {
          url,
          apiKey: provider.apiKey,
          timeoutMs: provider.timeout,
          fields: {
            model: model.model,
            prompt,
            n: "1",
            size: model.size ?? "1024x1536"
          },
          images: dataUrls.map((dataUrl, index) => ({
            filename: `reference-${index + 1}.${dataUrlExtension(dataUrl)}`,
            mimeType: dataUrlMime(dataUrl),
            dataUrl
          }))
        }
      });
    } catch (error) {
      throw toError(error, url);
    }
  }

  const form = new FormData();
  form.append("model", model.model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", model.size ?? "1024x1536");
  for (const [index, dataUrl] of dataUrls.entries()) {
    form.append("image", dataUrlToFile(dataUrl, `reference-${index + 1}.${dataUrlExtension(dataUrl)}`));
  }
  return requestFormJson(url, provider, form, signal);
}

async function requestGetJson(url: string, provider: ApiProvider, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), provider.timeout || 300000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`
      }
    });
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }

  return response;
}

function extractModelIds(payload: unknown) {
  const data = payload as ProviderModelPayload;
  const ids = new Set<string>();

  for (const item of data.data ?? []) {
    if (item.id?.trim()) ids.add(item.id.trim());
  }

  for (const item of data.models ?? []) {
    if (typeof item === "string" && item.trim()) ids.add(item.trim());
    if (typeof item === "object") {
      const id = item.id?.trim() || item.name?.trim();
      if (id) ids.add(id);
    }
  }

  return Array.from(ids).sort((left, right) => left.localeCompare(right));
}

export async function fetchProviderModels(provider: ApiProvider, signal?: AbortSignal) {
  if (!provider.baseUrl.trim()) {
    throw new Error("请先填写渠道 Base URL。");
  }
  if (!provider.apiKey.trim()) {
    throw new Error("请先填写渠道 API Key。");
  }

  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    let payload: unknown;
    try {
      payload = await invoke<unknown>("fetch_provider_models_native", {
        request: {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey
        }
      });
    } catch (error) {
      throw toError(error);
    }
    const models = extractModelIds(payload);
    if (!models.length) {
      throw new Error("当前渠道没有返回可识别的模型 ID。");
    }
    return models;
  }

  const response = await requestGetJson(endpoint(provider.baseUrl, "/models"), provider, signal);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`获取模型失败 ${response.status}: ${text.slice(0, 300)}`);
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    const preview = text.trim().slice(0, 80);
    throw new Error(`渠道没有返回 JSON。请检查 Base URL 是否为 API 地址，例如 /v1；当前返回内容：${preview}`);
  }

  const models = extractModelIds(payload);
  if (!models.length) {
    throw new Error("当前渠道没有返回可识别的模型 ID。");
  }
  return models;
}

export async function generateImageWithNewApi({ provider, model, page, characters = [], anchors = [], purpose = "comic-page", signal }: ImageGenerationInput) {
  const mode: EndpointMode = model.endpointMode === "chat-text" ? provider.endpointMode : model.endpointMode;
  if (!provider.apiKey.trim()) {
    throw new Error("请先配置 API Key，或使用 Mock 生成。");
  }

  const characterText = characters.length ? `\n\nPage characters:\n${buildCharacterText(characters)}` : "";
  const referenceUrls = mode === "chat-image" || mode === "image-edits"
    ? Array.from(new Set([...getReferenceImageUrls(characters, purpose), ...getAnchorReferenceImageUrls(anchors)])).slice(0, 10)
    : [];
  const prompt = `${page.prompt}${characterText}\n\n${referenceGuard(purpose, referenceUrls.length > 0)}`;

  if (mode === "images" || (mode === "image-edits" && !referenceUrls.length)) {
    const payload = await requestJson(
      endpoint(provider.baseUrl, "/images/generations"),
      provider,
      {
        model: model.model,
        prompt,
        n: 1,
        size: model.size ?? "1024x1536"
      },
      signal
    );
    const imageUrl = extractImageUrl(payload);
    if (!imageUrl) throw unrecognizedImageError("图片接口", payload);
    return imageUrl;
  }

  if (mode === "image-edits") {
    const payload = await requestImageEditJson(endpoint(provider.baseUrl, "/images/edits"), provider, model, prompt, referenceUrls, signal);
    const imageUrl = extractImageUrl(payload);
    if (!imageUrl) throw unrecognizedImageError("图片编辑接口", payload);
    return imageUrl;
  }

  if (mode === "chat-image") {
    const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
      { type: "text", text: `${prompt}\n\n负向提示词：${page.negativePrompt}` }
    ];
    for (const url of referenceUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }
    const payload = await requestJson(
      endpoint(provider.baseUrl, "/chat/completions"),
      provider,
      {
        model: model.model,
        messages: [
          {
            role: "user",
            content
          }
        ]
      },
      signal
    );
    const imageUrl = extractImageUrl(payload);
    if (!imageUrl) throw unrecognizedImageError("Chat 图片接口", payload);
    return imageUrl;
  }

  throw new Error("当前模型不是图片生成端点。");
}
