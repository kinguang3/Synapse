from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.integrations.gui.app import create_app

TOKEN = "test-graph-token"


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.fixture(scope="module")
def gui(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, object]]:
    base = tmp_path_factory.mktemp("gui-graph")
    root = base / "project"
    _write(
        root / "app.py",
        "def build_widget() -> str:\n"
        "    return 'widget'\n"
        "\n"
        "def use_widget() -> str:\n"
        "    return build_widget()\n",
    )
    _write(
        root / "src" / "pkg" / "core.py",
        "class Engine:\n"
        "    def run(self) -> str:\n"
        "        return helper()\n"
        "\n"
        "def helper() -> str:\n"
        "    return 'x'\n",
    )
    _write(root / "README.md", "# Sample\n\nWidget documentation.\n")
    _write(
        root / "docs" / "guide.md",
        "# Guide\n\n## Setup\n\nText.\n\n### Detail\n\nMore.\n",
    )
    settings = Settings(
        home=base / "home",
        indexing={"lock_timeout_seconds": 0.05},
    )

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
        file_node = application.nodes.find_by_path(project_id, "src/pkg/core.py")
        assert file_node is not None
        memory_ids = []
        for index, memory_type in enumerate(("decision", "fact", "fact")):
            payload = application.memory_tools.remember(
                project_id,
                f"memory content {index}",
                title=f"Memory {index}",
                memory_type=memory_type,
            )
            memory_ids.append(payload["node"]["node_id"])

    app = create_app(settings, token=TOKEN)
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(app) as client:
        yield {
            "client": client,
            "headers": headers,
            "project_id": project_id,
            "file_node_id": file_node.id,
            "memory_ids": memory_ids,
        }


def _get(gui: dict[str, object], path: str, **params: object):
    client = gui["client"]
    assert isinstance(client, TestClient)
    headers = gui["headers"]
    assert isinstance(headers, dict)
    return client.get(path, headers=headers, params=params)


def test_capabilities_report_real_counts(gui: dict[str, object]) -> None:
    project_id = str(gui["project_id"])
    response = _get(gui, f"/api/v1/projects/{project_id}/graph/capabilities")
    assert response.status_code == 200
    body = response.json()
    assert body["project_id"] == project_id
    counts = body["node_counts"]
    assert counts["file"] == 2
    assert counts["document"] == 2
    assert counts["class"] >= 1
    assert counts["function"] >= 2
    assert counts["method"] >= 1
    assert counts["memory"] == 3
    assert body["relation_counts"].get("CONTAINS", 0) >= 1
    views = body["views"]
    assert set(views) == {"architecture", "symbols", "documentation", "memory"}
    assert views["architecture"]["node_types"] == ["file", "document"]
    assert views["symbols"]["node_types"] == ["class", "function", "method"]
    assert views["documentation"]["node_types"] == ["document", "doc_section"]
    assert views["memory"]["node_count"] == 3


def test_structure_lists_one_level_of_real_paths(gui: dict[str, object]) -> None:
    project_id = str(gui["project_id"])
    root = _get(gui, f"/api/v1/projects/{project_id}/graph/structure")
    assert root.status_code == 200
    body = root.json()
    assert body["prefix"] == ""
    directories = {item["path"]: item for item in body["directories"]}
    assert set(directories) == {"src", "docs"}
    assert directories["src"]["name"] == "src"
    assert directories["src"]["files"] == 1
    assert directories["docs"]["documents"] == 1
    files = {item["path"]: item for item in body["files"]}
    assert set(files) == {"app.py", "README.md"}
    assert files["app.py"]["node_type"] == "file"
    assert files["app.py"]["symbols"] >= 2
    assert files["README.md"]["node_type"] == "document"
    assert body["truncated"] is False
    assert body["meta"]["directory_count"] == 2
    assert body["meta"]["file_count"] == 2
    assert body["meta"]["path_rows"] >= 11

    nested = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/structure",
        path_prefix="src",
    ).json()
    assert [item["path"] for item in nested["directories"]] == ["src/pkg"]
    assert nested["files"] == []

    leaf = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/structure",
        path_prefix="src/pkg",
    ).json()
    assert leaf["directories"] == []
    assert [item["path"] for item in leaf["files"]] == ["src/pkg/core.py"]
    assert leaf["files"][0]["node_id"] == str(gui["file_node_id"])
    assert leaf["files"][0]["symbols"] >= 3


def test_structure_rejects_paths_outside_the_project(gui: dict[str, object]) -> None:
    project_id = str(gui["project_id"])
    absolute = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/structure",
        path_prefix="/etc",
    )
    assert absolute.status_code == 400
    assert absolute.json()["error"]["code"] == "INVALID_ARGUMENT"
    escape = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/structure",
        path_prefix="../secrets",
    )
    assert escape.status_code == 400
    assert escape.json()["error"]["code"] == "INVALID_ARGUMENT"


def test_overview_stays_inside_the_requested_layer(gui: dict[str, object]) -> None:
    project_id = str(gui["project_id"])
    memories = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/overview",
        node_types="memory",
        max_nodes=10,
    ).json()
    assert memories["nodes"]
    assert {item["node_type"] for item in memories["nodes"]} == {"memory"}

    documents = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/overview",
        node_types="document",
        max_nodes=10,
    ).json()
    assert {item["node_type"] for item in documents["nodes"]} == {"document"}


def test_container_expansion_returns_real_children_only(gui: dict[str, object]) -> None:
    project_id = str(gui["project_id"])
    node_id = str(gui["file_node_id"])
    response = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/{node_id}/neighbors",
        depth=1,
        direction="out",
        relation_types="CONTAINS",
        limit=50,
    )
    assert response.status_code == 200
    body = response.json()
    types = {item["node_type"] for item in body["nodes"]}
    assert types <= {"file", "class", "function", "method"}
    assert "class" in types
    assert "memory" not in types
    assert "document" not in types
    for edge in body["edges"]:
        assert edge["relation_type"] == "CONTAINS"

def test_structure_paginates_without_losing_meta_counts(gui: dict[str, object]) -> None:
    project_id = str(gui["project_id"])
    page = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/structure",
        limit=1,
    ).json()
    assert len(page["directories"]) == 1
    assert len(page["files"]) == 1
    assert page["truncated"] is True
    assert page["meta"]["directory_count"] == 2
    assert page["meta"]["file_count"] == 2


def test_structure_treats_prefix_as_literal(gui: dict[str, object]) -> None:
    project_id = str(gui["project_id"])
    for value in ("%", "src%"):
        body = _get(
            gui,
            f"/api/v1/projects/{project_id}/graph/structure",
            path_prefix=value,
        ).json()
        assert body["directories"] == []
        assert body["files"] == []
        assert body["meta"]["directory_count"] == 0
        assert body["meta"]["file_count"] == 0
