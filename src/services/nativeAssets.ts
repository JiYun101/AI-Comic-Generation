import { CharacterTemplate, ComicPage, ComicProject, ProjectRecord, VisualAnchor } from "../types";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function isDataImage(url?: string) {
  return Boolean(url?.startsWith("data:image"));
}

function isRemoteImage(url?: string) {
  return Boolean(url && /^https?:\/\//i.test(url));
}

function isLocalAssetUrl(url?: string) {
  return Boolean(url && /^(asset:|https?:\/\/asset\.localhost|file:\/\/)/i.test(url));
}

function dataUrlExtension(dataUrl: string) {
  const mime = dataUrl.match(/^data:(.*?);base64/)?.[1] ?? "image/png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function toBase64DataUrl(dataUrl: string) {
  if (/^data:.*?;base64,/i.test(dataUrl)) return dataUrl;
  const [header, data = ""] = dataUrl.split(",");
  const mime = header.match(/^data:(.*?)(;|$)/)?.[1] ?? "image/png";
  return `data:${mime};base64,${btoa(unescape(encodeURIComponent(decodeURIComponent(data))))}`;
}

function safeFilename(value: string, fallback = "image") {
  const safe = value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "")
    .slice(0, 80);
  return safe || fallback;
}

async function toAssetUrl(path: string) {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

export async function persistImageAsset(projectId: string, imageUrl: string | undefined, filenameBase: string, timeoutMs = 240000) {
  if (!imageUrl || !isTauriRuntime() || isLocalAssetUrl(imageUrl)) return imageUrl;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const filename = safeFilename(filenameBase);
    if (isDataImage(imageUrl)) {
      const dataUrl = toBase64DataUrl(imageUrl);
      const path = await invoke<string>("save_image_asset", {
        request: {
          projectId,
          filename: `${filename}.${dataUrlExtension(dataUrl)}`,
          dataUrl
        }
      });
      return await toAssetUrl(path);
    }
    if (isRemoteImage(imageUrl)) {
      const path = await invoke<string>("download_image_asset", {
        request: {
          projectId,
          filename,
          url: imageUrl,
          timeoutMs
        }
      });
      return await toAssetUrl(path);
    }
  } catch (error) {
    console.warn("Could not persist image asset", error);
  }

  return imageUrl;
}

function collectCharacters(project: ComicProject): CharacterTemplate[] {
  return project.customCharacters ?? [];
}

async function persistPageAssets(projectId: string, page: ComicPage) {
  let changed = false;
  const imageUrl = await persistImageAsset(projectId, page.imageUrl, `page-${page.pageNumber}-${page.id}`);
  if (imageUrl !== page.imageUrl) changed = true;

  const versions = await Promise.all(
    (page.versions ?? []).map(async (version, index) => {
      const versionUrl = await persistImageAsset(projectId, version.imageUrl, `page-${page.pageNumber}-${page.id}-version-${index + 1}`);
      if (versionUrl !== version.imageUrl) changed = true;
      return { ...version, imageUrl: versionUrl ?? version.imageUrl };
    })
  );

  return changed ? { ...page, imageUrl, versions } : page;
}

async function persistCharacterAssets(projectId: string, character: CharacterTemplate) {
  let changed = false;
  const characterSheetUrl = await persistImageAsset(projectId, character.characterSheetUrl, `character-${character.id}-sheet`);
  if (characterSheetUrl !== character.characterSheetUrl) changed = true;

  const referenceImages = await Promise.all(
    (character.referenceImages ?? []).map(async (image, index) => {
      const url = await persistImageAsset(projectId, image.url, `character-${character.id}-reference-${index + 1}`);
      if (url !== image.url) changed = true;
      return { ...image, url: url ?? image.url };
    })
  );

  return changed ? { ...character, characterSheetUrl, referenceImages } : character;
}

async function persistAnchorAssets(projectId: string, anchor: VisualAnchor) {
  let changed = false;
  const primaryImageUrl = await persistImageAsset(projectId, anchor.primaryImageUrl, `anchor-${anchor.id}-primary`);
  if (primaryImageUrl !== anchor.primaryImageUrl) changed = true;

  const images = await Promise.all(
    (anchor.images ?? []).map(async (image, index) => {
      const url = await persistImageAsset(projectId, image.url, `anchor-${anchor.id}-image-${index + 1}`);
      if (url !== image.url) changed = true;
      return { ...image, url: url ?? image.url };
    })
  );

  return changed ? { ...anchor, primaryImageUrl, images } : anchor;
}

export async function persistProjectImageAssets(project: ComicProject) {
  let changed = false;
  const pages = await Promise.all(
    (project.pages ?? []).map(async (page) => {
      const nextPage = await persistPageAssets(project.id, page);
      if (nextPage !== page) changed = true;
      return nextPage;
    })
  );
  const customCharacters = await Promise.all(
    collectCharacters(project).map(async (character) => {
      const nextCharacter = await persistCharacterAssets(project.id, character);
      if (nextCharacter !== character) changed = true;
      return nextCharacter;
    })
  );
  const visualAnchors = await Promise.all(
    (project.visualAnchors ?? []).map(async (anchor) => {
      const nextAnchor = await persistAnchorAssets(project.id, anchor);
      if (nextAnchor !== anchor) changed = true;
      return nextAnchor;
    })
  );
  const longImageUrl = await persistImageAsset(project.id, project.longImageUrl, `project-${project.id}-long-preview`);
  if (longImageUrl !== project.longImageUrl) changed = true;

  return changed ? { ...project, pages, customCharacters, visualAnchors, longImageUrl, updatedAt: new Date().toISOString() } : project;
}

export async function persistProjectsImageAssets(records: ProjectRecord[]) {
  let changed = false;
  const projects = await Promise.all(
    records.map(async (record) => {
      const project = await persistProjectImageAssets(record.project);
      const recordChanged = project !== record.project;
      if (recordChanged) changed = true;
      return recordChanged
        ? {
            meta: {
              ...record.meta,
              updatedAt: project.updatedAt,
              doneCount: project.pages.filter((page) => page.status === "done").length
            },
            project
          }
        : record;
    })
  );

  return changed ? projects : records;
}
