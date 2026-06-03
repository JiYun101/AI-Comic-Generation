#!/usr/bin/env python3
"""
Test an OpenAI-compatible image generation API and save the generated image.

Examples:
  python scripts/test_image_api.py --api-key sk-xxx --base-url https://api2.apiaqi.com/v1 --model gpt-image-2

  # Read the current app provider/key from the local Tauri/WebView cache:
  python scripts/test_image_api.py --from-app-cache

  # Try another model/size:
  python scripts/test_image_api.py --from-app-cache --model image2.0 --size 1024x1024
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import pathlib
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from typing import Any


APP_DIR = pathlib.Path(os.environ["APPDATA"]) / "com.aicomic.studio"
LOCAL_STORAGE_DIR = (
    pathlib.Path(os.environ["LOCALAPPDATA"])
    / "com.aicomic.studio"
    / "EBWebView"
    / "Default"
    / "Local Storage"
    / "leveldb"
)
DRAFT_DB = APP_DIR / "ai-comic-studio.db"


def mask_key(api_key: str) -> str:
    if len(api_key) <= 12:
        return "***"
    return f"{api_key[:6]}...{api_key[-4:]}"


def load_app_payload() -> dict[str, Any]:
    if not DRAFT_DB.exists():
        raise RuntimeError(f"Draft database not found: {DRAFT_DB}")
    con = sqlite3.connect(f"file:{DRAFT_DB}?mode=ro", uri=True)
    try:
        row = con.execute("select payload from drafts limit 1").fetchone()
    finally:
        con.close()
    if not row:
        raise RuntimeError("No draft payload found in local database.")
    return json.loads(row[0])


def read_cached_api_key_candidates(key_ref: str) -> list[str]:
    if not LOCAL_STORAGE_DIR.exists():
        return []

    needle = f"ai-comic-studio:api-key-cache:{key_ref}".encode()
    key_pattern = re.compile(rb"sk-[A-Za-z0-9._\-]{20,}")
    candidates: list[str] = []

    for path in LOCAL_STORAGE_DIR.glob("*"):
        if path.suffix.lower() not in {".log", ".ldb", ".sst"}:
            continue
        data = path.read_bytes()
        pos = data.find(needle)
        if pos < 0:
            continue
        window = data[pos : pos + len(needle) + 1000]
        candidates.extend(match.group(0).decode("ascii", "ignore") for match in key_pattern.finditer(window))

    return sorted(set(candidates), key=lambda item: (-len(item), item))


def can_fetch_models(base_url: str, api_key: str) -> bool:
    request = urllib.request.Request(f"{base_url.rstrip('/')}/models", method="GET")
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI Comic Studio API Test/1.0")
    request.add_header("Origin", "http://localhost:5173")
    request.add_header("Referer", "http://localhost:5173/")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def choose_cached_api_key(base_url: str, key_ref: str) -> str:
    candidates = read_cached_api_key_candidates(key_ref)
    if not candidates:
        return ""

    print(f"Found {len(candidates)} cached key candidate(s); validating with /models...")
    for candidate in candidates:
        if can_fetch_models(base_url, candidate):
            print(f"Using cached key: {mask_key(candidate)}")
            return candidate

    # Fallback for channels that block /models but may still allow generation.
    print("No cached key passed /models validation; using the first candidate.")
    return candidates[0]


def load_current_app_image_config() -> tuple[str, str, str, str]:
    payload = load_app_payload()
    providers = payload.get("providers") or []
    models = payload.get("models") or []
    image_model = next((model for model in models if model.get("kind") == "image"), None)
    if not image_model:
        raise RuntimeError("No image model config found in app draft.")

    provider = next((item for item in providers if item.get("id") == image_model.get("providerId")), None)
    if not provider:
        raise RuntimeError(f"Image provider not found: {image_model.get('providerId')}")

    api_key = choose_cached_api_key(provider["baseUrl"], provider.get("apiKeyRef", ""))
    if not api_key:
        raise RuntimeError(
            f"API key not found in WebView cache for keyRef={provider.get('apiKeyRef')}. "
            "Pass --api-key manually."
        )

    return provider["baseUrl"], api_key, image_model["model"], image_model.get("size") or "1024x1024"


def request_json(url: str, api_key: str, body: dict[str, Any], timeout: int) -> dict[str, Any] | None:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")
    request.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI Comic Studio API Test/1.0")
    request.add_header("Origin", "http://localhost:5173")
    request.add_header("Referer", "http://localhost:5173/")

    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8", "replace")
            print(f"HTTP {response.status} OK, elapsed={time.time() - started:.2f}s")
            return json.loads(text)
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", "replace")
        print(f"HTTP {error.code} failed, elapsed={time.time() - started:.2f}s")
        print(text[:1200])
        return None
    except Exception as error:
        print(f"Request failed, elapsed={time.time() - started:.2f}s")
        print(str(error))
        return None


def find_image_value(value: Any) -> tuple[str, str]:
    if isinstance(value, str):
        if value.startswith("data:image"):
            return "data_url", value
        if value.startswith("http://") or value.startswith("https://"):
            return "url", value
        if re.fullmatch(r"[A-Za-z0-9+/=]{200,}", value):
            return "base64", value
        return "", ""

    if isinstance(value, list):
        for item in value:
            kind, image_value = find_image_value(item)
            if kind:
                return kind, image_value

    if isinstance(value, dict):
        for key in ("url", "image_url", "imageUrl", "b64_json", "base64", "data", "content", "output"):
            kind, image_value = find_image_value(value.get(key))
            if kind:
                return kind, image_value
        for item in value.values():
            kind, image_value = find_image_value(item)
            if kind:
                return kind, image_value

    return "", ""


def save_image(kind: str, image_value: str, output_dir: pathlib.Path) -> pathlib.Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S")

    if kind == "url":
        request = urllib.request.Request(image_value, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=180) as response:
            content_type = response.headers.get("content-type", "image/png").split(";")[0].strip()
            data = response.read()
        extension = mimetypes.guess_extension(content_type) or ".png"
    else:
        if kind == "data_url":
            header, encoded = image_value.split(",", 1)
            mime = re.search(r"data:(.*?);base64", header)
            extension = mimetypes.guess_extension(mime.group(1) if mime else "image/png") or ".png"
            data = base64.b64decode(encoded)
        else:
            extension = ".png"
            data = base64.b64decode(image_value)

    output_path = output_dir / f"image-test-{timestamp}{extension}"
    output_path.write_bytes(data)
    return output_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-app-cache", action="store_true", help="Read base URL/model/key from this Tauri app cache.")
    parser.add_argument("--base-url", default="", help="OpenAI-compatible base URL, e.g. https://api.example.com/v1")
    parser.add_argument("--api-key", default="", help="API key. You can also set IMAGE_API_KEY.")
    parser.add_argument("--model", default="", help="Image model ID.")
    parser.add_argument("--size", default="", help="Image size, e.g. 1024x1024.")
    parser.add_argument("--prompt", default="A clean original comic illustration of a smiling girl holding a notebook, soft daylight, high quality, no text, no watermark.")
    parser.add_argument("--output-dir", default=str(pathlib.Path.cwd() / ".tmp" / "api-tests"))
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()

    base_url = args.base_url
    api_key = args.api_key or os.environ.get("IMAGE_API_KEY", "")
    model = args.model
    size = args.size

    if args.from_app_cache:
        base_url, api_key, model, size = load_current_app_image_config()
        if args.model:
            model = args.model
        if args.size:
            size = args.size

    if not base_url or not api_key or not model:
        parser.error("Need --base-url, --api-key and --model, or use --from-app-cache.")

    size = size or "1024x1024"
    url = f"{base_url.rstrip('/')}/images/generations"
    body = {
        "model": model,
        "prompt": args.prompt,
        "n": 1,
        "size": size,
    }

    print(f"POST {url}")
    print(f"model={model}, size={size}, api_key={mask_key(api_key)}")
    payload = request_json(url, api_key, body, args.timeout)
    if payload is None:
        return 1

    kind, image_value = find_image_value(payload)
    if not kind:
        print("No image URL/base64 found in response:")
        print(json.dumps(payload, ensure_ascii=False, indent=2)[:2000])
        return 2

    output_path = save_image(kind, image_value, pathlib.Path(args.output_dir))
    print(f"Saved image: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
