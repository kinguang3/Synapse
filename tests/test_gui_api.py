from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from filelock import FileLock

from synapse.bootstrap import build_application
from synapse.config import Settings
from synapse.ingestion.locking import index_lock_path
from synapse.integrations.gui.app import create_app

TOKEN = "test-gui-token"


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.fixture(scope="module")
def gui(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, object]]:
    base = tmp_path_factory.mktemp("gui-api")
    root = base / "project"
    _write(
        root / "app.py",
        "def build_widget() -> str:\n"
        "    return 'widget'\n"
        "\n"
        "def use_widget() -> str:\n"
        "    return build_widget()\n",
    )
    _write(root / "README.md", "# Sample\n\nWidget documentation.\n")
    home = base / "home"
    settings = Settings(
        home=home,
        indexing={"lock_timeout_seconds": 0.05},
    )

    with build_application(settings) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
        file_node = application.nodes.find_by_path(project_id, "app.py")
        assert file_node is not None
        fact_ids = []
        for index in range(60):
            payload = application.memory_tools.remember(
                project_id,
                f"fact content {index}",
                title=f"Fact {index:03d}",
                memory_type="fact",
            )
            fact_ids.append(payload["node"]["node_id"])
        decision_ids = []
        for index in range(5):
            payload = application.memory_tools.remember(
                project_id,
                f"decision content {index}",
                title=f"Decision {index:03d}",
                memory_type="decision",
            )
            decision_ids.append(payload["node"]["node_id"])

    app = create_app(settings, token=TOKEN)
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(app) as client:
        yield {
            "client": client,
            "headers": headers,
            "settings": settings,
            "project_id": project_id,
            "file_node_id": file_node.id,
            "fact_ids": fact_ids,
            "decision_ids": decision_ids,
        }


def _get(gui: dict[str, object], path: str, **params: object):
    client = gui["client"]
    assert isinstance(client, TestClient)
    headers = gui["headers"]
    assert isinstance(headers, dict)
    return client.get(path, headers=headers, params=params)


def test_all_gui_api_routes_return_core_payloads(gui: dict[str, object]) -> None:
    client = gui["client"]
    assert isinstance(client, TestClient)
    headers = gui["headers"]
    assert isinstance(headers, dict)
    project_id = str(gui["project_id"])
    node_id = str(gui["file_node_id"])
    memory_id = str(gui["fact_ids"][0])  # type: ignore[index]

    health = client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    projects = _get(gui, "/api/v1/projects")
    assert projects.status_code == 200
    assert any(item["id"] == project_id for item in projects.json()["projects"])

    project = _get(gui, f"/api/v1/projects/{project_id}")
    assert project.status_code == 200
    assert project.json()["project"]["id"] == project_id

    status = _get(gui, f"/api/v1/projects/{project_id}/status")
    assert status.status_code == 200
    assert status.json()["project"]["id"] == project_id
    assert "stats" in status.json()
    assert "tasks" in status.json()

    index = client.post(
        f"/api/v1/projects/{project_id}/index",
        headers=headers,
    )
    assert index.status_code == 200
    assert "stats" in index.json()

    overview = _get(gui, f"/api/v1/projects/{project_id}/overview")
    assert overview.status_code == 200
    assert overview.json()["project"]["id"] == project_id

    search = _get(
        gui,
        f"/api/v1/projects/{project_id}/search",
        q="widget",
        limit=5,
    )
    assert search.status_code == 200
    assert "results" in search.json()
    assert "meta" in search.json()

    graph = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/overview",
        max_nodes=20,
    )
    assert graph.status_code == 200
    assert "nodes" in graph.json()
    assert "edges" in graph.json()
    assert "meta" in graph.json()

    node = _get(gui, f"/api/v1/projects/{project_id}/nodes/{node_id}")
    assert node.status_code == 200
    assert node.json()["node"]["node_id"] == node_id
    assert "related" in node.json()

    memories = _get(gui, f"/api/v1/projects/{project_id}/memories")
    assert memories.status_code == 200
    assert memories.json()["total"] == 65
    assert len(memories.json()["memories"]) == 50

    memory = _get(
        gui,
        f"/api/v1/projects/{project_id}/memories/{memory_id}",
    )
    assert memory.status_code == 200
    assert memory.json()["node_id"] == memory_id
    assert memory.json()["content"]

    context = _get(
        gui,
        f"/api/v1/projects/{project_id}/context",
        q="widget",
        max_tokens=500,
    )
    assert context.status_code == 200
    assert "token_estimate" in context.json()

    neighbors = _get(
        gui,
        f"/api/v1/projects/{project_id}/graph/{node_id}/neighbors",
        depth=1,
        limit=10,
    )
    assert neighbors.status_code == 200
    assert neighbors.json()["start_node_id"] == node_id
    assert "nodes" in neighbors.json()
    assert "edges" in neighbors.json()


def test_static_frontend_is_served(gui: dict[str, object]) -> None:
    client = gui["client"]
    assert isinstance(client, TestClient)
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Synapse" in response.text


def test_all_protected_routes_require_bearer_token(gui: dict[str, object]) -> None:
    client = gui["client"]
    assert isinstance(client, TestClient)
    project_id = str(gui["project_id"])
    node_id = str(gui["file_node_id"])
    memory_id = str(gui["fact_ids"][0])  # type: ignore[index]
    protected = [
        ("GET", "/api/v1/projects"),
        ("GET", f"/api/v1/projects/{project_id}"),
        ("GET", f"/api/v1/projects/{project_id}/status"),
        ("POST", f"/api/v1/projects/{project_id}/index"),
        ("GET", f"/api/v1/projects/{project_id}/overview"),
        ("GET", f"/api/v1/projects/{project_id}/search?q=widget"),
        ("GET", f"/api/v1/projects/{project_id}/graph/overview"),
        ("GET", f"/api/v1/projects/{project_id}/nodes/{node_id}"),
        ("GET", f"/api/v1/projects/{project_id}/memories"),
        ("GET", f"/api/v1/projects/{project_id}/memories/{memory_id}"),
        ("GET", f"/api/v1/projects/{project_id}/context"),
        ("GET", f"/api/v1/projects/{project_id}/graph/{node_id}/neighbors"),
    ]
    for method, path in protected:
        response = client.request(method, path)
        assert response.status_code == 401, (method, path, response.text)
        assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_memory_pagination_type_filter_and_query_total(
    gui: dict[str, object],
) -> None:
    project_id = str(gui["project_id"])

    first = _get(
        gui,
        f"/api/v1/projects/{project_id}/memories",
        limit=10,
        offset=0,
    )
    assert first.status_code == 200
    assert first.json()["total"] == 65
    assert len(first.json()["memories"]) == 10

    late = _get(
        gui,
        f"/api/v1/projects/{project_id}/memories",
        limit=5,
        offset=55,
    )
    assert late.status_code == 200
    assert late.json()["total"] == 65
    assert len(late.json()["memories"]) == 5

    facts = _get(
        gui,
        f"/api/v1/projects/{project_id}/memories",
        memory_type="fact",
        limit=10,
    )
    assert facts.status_code == 200
    assert facts.json()["total"] == 60
    assert {item["memory_type"] for item in facts.json()["memories"]} == {"fact"}

    decisions = _get(
        gui,
        f"/api/v1/projects/{project_id}/memories",
        memory_type="decision",
        limit=10,
    )
    assert decisions.status_code == 200
    assert decisions.json()["total"] == 5
    assert len(decisions.json()["memories"]) == 5

    query_page = _get(
        gui,
        f"/api/v1/projects/{project_id}/memories",
        q="fact",
        memory_type="fact",
        limit=1,
        offset=55,
    )
    assert query_page.status_code == 200
    assert query_page.json()["total"] == 60
    assert len(query_page.json()["memories"]) == 1

    beyond = _get(
        gui,
        f"/api/v1/projects/{project_id}/memories",
        limit=10,
        offset=500,
    )
    assert beyond.status_code == 200
    assert beyond.json()["total"] == 65
    assert beyond.json()["memories"] == []


def test_missing_project_and_node_return_404(gui: dict[str, object]) -> None:
    project_id = str(gui["project_id"])

    missing_project = _get(gui, "/api/v1/projects/not-a-project")
    assert missing_project.status_code == 404
    assert missing_project.json()["error"]["code"] == "PROJECT_NOT_FOUND"

    missing_node = _get(
        gui,
        f"/api/v1/projects/{project_id}/nodes/not-a-node",
    )
    assert missing_node.status_code == 404
    assert missing_node.json()["error"]["code"] == "NODE_NOT_FOUND"

    missing_memory = _get(
        gui,
        f"/api/v1/projects/{project_id}/memories/not-a-memory",
    )
    assert missing_memory.status_code == 404
    assert missing_memory.json()["error"]["code"] == "NODE_NOT_FOUND"


def test_index_returns_423_when_project_lock_is_held(
    gui: dict[str, object],
) -> None:
    client = gui["client"]
    assert isinstance(client, TestClient)
    headers = gui["headers"]
    assert isinstance(headers, dict)
    settings = gui["settings"]
    assert isinstance(settings, Settings)
    project_id = str(gui["project_id"])
    lock_path = index_lock_path(settings, project_id)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(lock_path), timeout=0)
    lock.acquire()
    try:
        response = client.post(
            f"/api/v1/projects/{project_id}/index",
            headers=headers,
        )
    finally:
        lock.release()
    assert response.status_code == 423
    assert response.json()["error"]["code"] == "INDEX_LOCKED"
