"""Verify that NotebookFlow's Python artifacts contain a prebuilt JL extension."""

from __future__ import annotations

import argparse
import json
import tarfile
import zipfile
from email.parser import Parser
from pathlib import Path
from typing import TypeVar

PROJECT_NAME = "notebookflow-app"
VERSION = "0.1.0"
EXTENSION_NAME = "@notebookflow/jupyterlab-extension"
PREBUILT_CLASSIFIER = "Framework :: Jupyter :: JupyterLab :: Extensions :: Prebuilt"
T = TypeVar("T")


def _one(paths: list[T], label: str) -> T:
    if len(paths) != 1:
        names = ", ".join(str(path) for path in paths) or "none"
        raise RuntimeError(f"Expected exactly one {label}; found {names}")
    return paths[0]


def _extension_member(names: list[str], suffix: str) -> str:
    expected = f"share/jupyter/labextensions/{EXTENSION_NAME}/{suffix}"
    matches = [name for name in names if name.endswith(expected)]
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected exactly one artifact member ending in {expected}; found {len(matches)}"
        )
    return matches[0]


def _remote_entry_member(names: list[str]) -> str:
    marker = f"share/jupyter/labextensions/{EXTENSION_NAME}/static/remoteEntry"
    matches = [name for name in names if marker in name and name.endswith(".js")]
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected exactly one prebuilt extension remote entry; found {len(matches)}"
        )
    return matches[0]


def verify_wheel(wheel: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        metadata_name = _one(
            [name for name in names if name.endswith(".dist-info/METADATA")],
            "wheel METADATA file",
        )
        metadata = Parser().parsestr(archive.read(metadata_name).decode())

        if metadata["Name"] != PROJECT_NAME:
            raise RuntimeError(
                f"Wheel project name is {metadata['Name']!r}, expected {PROJECT_NAME!r}"
            )
        if metadata["Version"] != VERSION:
            raise RuntimeError(f"Wheel version is {metadata['Version']!r}, expected {VERSION!r}")
        if PREBUILT_CLASSIFIER not in metadata.get_all("Classifier", []):
            raise RuntimeError("Wheel is missing JupyterLab's prebuilt classifier")

        requirements = metadata.get_all("Requires-Dist", [])
        if not any(req.startswith("jupyter-server-proxy") for req in requirements):
            raise RuntimeError("Wheel does not depend on jupyter-server-proxy")

        package_json_name = _extension_member(names, "package.json")
        install_json_name = _extension_member(names, "install.json")
        _extension_member(
            names,
            f"schemas/{EXTENSION_NAME}/plugin.json",
        )
        _remote_entry_member(names)
        if "notebookflow/server.py" not in names:
            raise RuntimeError("Wheel does not contain the NotebookFlow engine")

        package_json = json.loads(archive.read(package_json_name))
        if package_json.get("name") != EXTENSION_NAME:
            raise RuntimeError("Prebuilt extension package.json has the wrong name")
        if package_json.get("version") != VERSION:
            raise RuntimeError("Prebuilt extension package.json has the wrong version")

        install_json = json.loads(archive.read(install_json_name))
        if install_json.get("packageManager") != "python":
            raise RuntimeError("install.json does not declare the Python package manager")
        if install_json.get("packageName") != PROJECT_NAME:
            raise RuntimeError("install.json points at the wrong PyPI distribution")


def verify_sdist(sdist: Path) -> None:
    with tarfile.open(sdist, "r:gz") as archive:
        names = archive.getnames()
        required_suffixes = (
            "/pyproject.toml",
            "/LICENSE",
            "/README.md",
            "/notebookflow/server.py",
            "/notebookflow/labextension/package.json",
            "/notebookflow/labextension/install.json",
            f"/notebookflow/labextension/schemas/{EXTENSION_NAME}/plugin.json",
        )
        for suffix in required_suffixes:
            if not any(name.endswith(suffix) for name in names):
                raise RuntimeError(f"Source distribution is missing *{suffix}")
        if not any(
            "/notebookflow/labextension/static/remoteEntry" in name and name.endswith(".js")
            for name in names
        ):
            raise RuntimeError("Source distribution is missing the prebuilt remote entry")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "dist",
        type=Path,
        help="Directory containing one NotebookFlow wheel and one source archive",
    )
    args = parser.parse_args()

    wheel = _one(sorted(args.dist.glob("*.whl")), "wheel")
    sdist = _one(sorted(args.dist.glob("*.tar.gz")), "source distribution")
    verify_wheel(wheel)
    verify_sdist(sdist)
    print(f"Verified {wheel.name} and {sdist.name}")


if __name__ == "__main__":
    main()
