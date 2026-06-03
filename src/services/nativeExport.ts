function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export async function saveLongImageNative(filename: string, dataUrl: string) {
  if (!isTauriRuntime()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("save_long_image", { request: { filename, dataUrl } });
  } catch (error) {
    console.warn("Could not save long image through Tauri", error);
    return undefined;
  }
}
