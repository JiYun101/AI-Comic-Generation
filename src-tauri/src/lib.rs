use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fs;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
struct SaveProjectRequest {
    name: String,
    payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveLongImageRequest {
    filename: String,
    data_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchModelsRequest {
    base_url: String,
    api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiJsonRequest {
    url: String,
    api_key: String,
    body: serde_json::Value,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiMultipartImage {
    filename: String,
    mime_type: String,
    data_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiMultipartRequest {
    url: String,
    api_key: String,
    fields: serde_json::Map<String, serde_json::Value>,
    images: Vec<ApiMultipartImage>,
    timeout_ms: Option<u64>,
}

#[tauri::command]
fn app_ready() -> String {
    "AI Comic Studio native shell ready".to_string()
}

#[tauri::command]
fn save_project_snapshot(request: SaveProjectRequest) -> Result<String, String> {
    // MVP placeholder for the native persistence boundary. The frontend keeps a
    // local draft so the app remains usable before SQLite plugins are wired.
    if request.name.trim().is_empty() {
        return Err("Project name is required".to_string());
    }

    Ok(format!("snapshot:{}:{}", request.name, request.payload))
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4];
    let mut chunk_len = 0usize;

    for byte in input.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => 64,
            _ => return Err("Invalid base64 data".to_string()),
        };
        chunk[chunk_len] = value;
        chunk_len += 1;

        if chunk_len == 4 {
            if chunk[0] == 64 || chunk[1] == 64 {
                return Err("Invalid base64 padding".to_string());
            }
            buffer.push((chunk[0] << 2) | (chunk[1] >> 4));
            if chunk[2] != 64 {
                buffer.push((chunk[1] << 4) | (chunk[2] >> 2));
            }
            if chunk[3] != 64 {
                buffer.push((chunk[2] << 6) | chunk[3]);
            }
            chunk_len = 0;
        }
    }

    if chunk_len != 0 {
        return Err("Incomplete base64 data".to_string());
    }

    Ok(buffer)
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let (_, data) = data_url
        .split_once(',')
        .ok_or_else(|| "参考图 data URL 格式不正确。".to_string())?;
    decode_base64(data)
}

fn error_chain(error: &(dyn Error + 'static)) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(next) = source {
        message.push_str("；原因：");
        message.push_str(&next.to_string());
        source = next.source();
    }
    message
}

fn api_client(timeout_ms: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI Comic Studio/0.1")
        .http1_only()
        .pool_max_idle_per_host(0)
        .build()
        .map_err(|error| format!("创建 API 客户端失败：{}", error_chain(&error)))
}

#[tauri::command]
fn save_long_image(app: tauri::AppHandle, request: SaveLongImageRequest) -> Result<String, String> {
    let safe_filename = request
        .filename
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>();
    let data = request
        .data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "Expected a PNG data URL".to_string())?;
    let bytes = decode_base64(data)?;
    let export_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("exports");
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
    let path = export_dir.join(safe_filename);
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn fetch_provider_models_native(request: FetchModelsRequest) -> Result<serde_json::Value, String> {
    if request.base_url.trim().is_empty() {
        return Err("请先填写渠道 Base URL。".to_string());
    }
    if request.api_key.trim().is_empty() {
        return Err("请先填写渠道 API Key。".to_string());
    }

    let url = format!("{}/models", request.base_url.trim().trim_end_matches('/'));
    let response = api_client(60_000)?
        .get(url)
        .bearer_auth(request.api_key.trim())
        .send()
        .await
        .map_err(|error| format!("模型请求失败：{}", error_chain(&error)))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取模型响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("获取模型失败 {status}: {}", text.chars().take(300).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|_| {
        let preview = text.trim().chars().take(120).collect::<String>();
        format!("渠道没有返回 JSON。请检查 Base URL 是否为 API 地址，例如 /v1；当前返回内容：{preview}")
    })
}

#[tauri::command]
async fn post_api_json_native(request: ApiJsonRequest) -> Result<serde_json::Value, String> {
    if request.url.trim().is_empty() {
        return Err("API 地址为空。".to_string());
    }
    if request.api_key.trim().is_empty() {
        return Err("请先配置 API Key，或使用 Mock 生成。".to_string());
    }

    let client = api_client(request.timeout_ms.unwrap_or(300_000))?;
    let response = client
        .post(request.url.trim())
        .bearer_auth(request.api_key.trim())
        .json(&request.body)
        .send()
        .await
        .map_err(|error| format!("API 请求失败：{}", error_chain(&error)))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 API 响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("API {status}: {}", text.chars().take(500).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|_| {
        let preview = text.trim().chars().take(160).collect::<String>();
        format!("API 没有返回 JSON：{preview}")
    })
}

#[tauri::command]
async fn post_api_multipart_native(request: ApiMultipartRequest) -> Result<serde_json::Value, String> {
    if request.url.trim().is_empty() {
        return Err("API 地址为空。".to_string());
    }
    if request.api_key.trim().is_empty() {
        return Err("请先配置 API Key，或使用 Mock 生成。".to_string());
    }

    let mut form = reqwest::multipart::Form::new();
    for (key, value) in request.fields {
        let text = match value {
            serde_json::Value::String(text) => text,
            other => other.to_string(),
        };
        form = form.text(key, text);
    }
    for image in request.images {
        let bytes = decode_data_url(&image.data_url)?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(image.filename)
            .mime_str(&image.mime_type)
            .map_err(|error| format!("参考图 MIME 类型无效：{error}"))?;
        form = form.part("image", part);
    }

    let client = api_client(request.timeout_ms.unwrap_or(300_000))?;
    let response = client
        .post(request.url.trim())
        .bearer_auth(request.api_key.trim())
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("API 参考图请求失败：{}", error_chain(&error)))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 API 响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("API {status}: {}", text.chars().take(500).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|_| {
        let preview = text.trim().chars().take(160).collect::<String>();
        format!("API 没有返回 JSON：{preview}")
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path")
                .join("stronghold-salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            save_project_snapshot,
            save_long_image,
            fetch_provider_models_native,
            post_api_json_native,
            post_api_multipart_native
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
