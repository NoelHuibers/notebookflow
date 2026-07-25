"""Validate that a NotebookFlow VSIX is complete and monorepo-independent."""

from __future__ import annotations

import argparse
import json
import re
import struct
import zipfile
from pathlib import Path
from typing import Any

EXPECTED_NAME = "notebookflow-vscode"
EXPECTED_PUBLISHER = "notebookflow"
EXPECTED_VERSION = "0.1.0"
MAX_ARCHIVE_BYTES = 15 * 1024 * 1024
MAX_FILES = 100


def _read_json(archive: zipfile.ZipFile, name: str) -> dict[str, Any]:
    value = json.loads(archive.read(name))
    if not isinstance(value, dict):
        raise AssertionError(f"{name} must contain a JSON object")
    return value


def _png_dimensions(data: bytes) -> tuple[int, int]:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise AssertionError("extension icon is not a valid PNG")
    return struct.unpack(">II", data[16:24])


def verify_vsix(path: Path) -> None:
    if not path.is_file():
        raise AssertionError(f"VSIX does not exist: {path}")
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise AssertionError(f"VSIX is unexpectedly large: {path.stat().st_size} bytes")

    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        extension_files = {name for name in names if name.startswith("extension/")}
        if len(extension_files) > MAX_FILES:
            raise AssertionError(f"VSIX contains too many extension files: {len(extension_files)}")

        required = {
            "extension/package.json",
            "extension/dist/extension.cjs",
            "extension/dist-webview/index.html",
            "extension/media/icon.png",
            "extension/readme.md",
            "extension/changelog.md",
            "extension/LICENSE.txt",
            "extension/SUPPORT.md",
        }
        missing = sorted(required - names)
        if missing:
            raise AssertionError(f"VSIX is missing required files: {', '.join(missing)}")

        forbidden_parts = ("/src/", "/webview/", "/node_modules/")
        forbidden_suffixes = (".ts", ".tsx", ".tsbuildinfo", ".lock", ".env")
        forbidden = sorted(
            name
            for name in extension_files
            if any(part in name for part in forbidden_parts)
            or name.lower().endswith(forbidden_suffixes)
            or name.endswith("pnpm-lock.yaml")
        )
        if forbidden:
            raise AssertionError(f"VSIX contains development files: {', '.join(forbidden)}")

        manifest = _read_json(archive, "extension/package.json")
        identity = (manifest.get("publisher"), manifest.get("name"), manifest.get("version"))
        expected = (EXPECTED_PUBLISHER, EXPECTED_NAME, EXPECTED_VERSION)
        if identity != expected:
            raise AssertionError(f"unexpected extension identity {identity!r}; expected {expected!r}")
        if manifest.get("main") != "./dist/extension.cjs":
            raise AssertionError("manifest main does not point at the bundled extension host")
        if "workspace:*" in json.dumps(manifest, sort_keys=True):
            raise AssertionError("published manifest contains a workspace dependency")

        icon_width, icon_height = _png_dimensions(archive.read("extension/media/icon.png"))
        if icon_width < 128 or icon_height < 128:
            raise AssertionError(f"Marketplace icon is too small: {icon_width}x{icon_height}")

        host = archive.read("extension/dist/extension.cjs").decode("utf-8")
        unresolved_workspace_import = re.compile(
            r"(?:require|import)\s*\(\s*['\"]@notebookflow/(?:app-core|graph-canvas)"
        )
        if unresolved_workspace_import.search(host):
            raise AssertionError("extension host contains an unresolved monorepo import")

        webview_assets = [
            name for name in names if name.startswith("extension/dist-webview/assets/")
        ]
        if not webview_assets:
            raise AssertionError("VSIX does not contain the bundled webview assets")

    print(
        f"verified {path.name}: {EXPECTED_PUBLISHER}.{EXPECTED_NAME} "
        f"v{EXPECTED_VERSION}, {len(extension_files)} files, {path.stat().st_size} bytes"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("vsix", type=Path)
    args = parser.parse_args()
    verify_vsix(args.vsix)


if __name__ == "__main__":
    main()
