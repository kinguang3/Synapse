from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import anyio
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp_types.version import LATEST_HANDSHAKE_VERSION

from synapse.bootstrap import build_application
from synapse.config import Settings

SERVER_ARGS = ["-m", "synapse.integrations.mcp"]
EXPECTED_TOOLS = {
    "synapse_projects_list",
    "synapse_project_status",
    "synapse_search",
    "synapse_related",
    "synapse_explore_graph",
    "synapse_context",
    "synapse_remember",
    "synapse_recall",
    "synapse_memory_get",
}


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _server_params(home: Path, cwd: Path) -> StdioServerParameters:
    return StdioServerParameters(
        command=sys.executable,
        args=SERVER_ARGS,
        env={
            "SYNAPSE_HOME": str(home),
            "PYTHONIOENCODING": "utf-8",
        },
        cwd=str(cwd),
    )


def _seed_project(tmp_path: Path) -> tuple[Path, Path, str]:
    root = tmp_path / "project"
    _write(
        root / "app.py",
        "def build_widget() -> str:\n"
        "    return 'widget'\n"
        "\n"
        "def use_widget() -> str:\n"
        "    return build_widget()\n",
    )
    _write(root / "README.md", "# Sample\n\nWidget documentation.\n")
    home = tmp_path / "home"
    with build_application(Settings(home=home)) as application:
        project_id = application.project_tools.register(str(root))["id"]
        application.project_tools.index(project_id)
    return root, home, project_id


async def _call(
    session: ClientSession,
    name: str,
    arguments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = await session.call_tool(name, arguments or {})
    assert not result.is_error, result.content
    assert result.content
    text = result.content[0].text
    return json.loads(text)


def _run(scenario: Callable[[], Awaitable[None]]) -> None:
    anyio.run(scenario, backend="asyncio")


def test_mcp_protocol_initialize_list_tools_and_error_mapping(tmp_path: Path) -> None:
    home = tmp_path / "home"
    params = _server_params(home, tmp_path)
    error_log_path = tmp_path / "server.err"

    async def scenario(errlog: Any) -> None:
        async with (
            stdio_client(params, errlog=errlog) as (read_stream, write_stream),
            ClientSession(read_stream, write_stream) as session,
        ):
            initialized = await session.initialize()
            assert initialized.server_info.name == "synapse"

            listed = await session.list_tools()
            names = {tool.name for tool in listed.tools}
            assert names == EXPECTED_TOOLS

            search_tool = next(
                tool for tool in listed.tools if tool.name == "synapse_search"
            )
            schema = search_tool.input_schema
            assert schema["type"] == "object"
            assert set(schema["required"]) == {"project", "query"}
            mode_schema = schema["properties"]["mode"]
            assert mode_schema["enum"] == ["keyword", "hybrid"]

            remember_tool = next(
                tool for tool in listed.tools if tool.name == "synapse_remember"
            )
            assert remember_tool.annotations is not None
            assert remember_tool.annotations.read_only_hint is False
            assert "Side effect" in (remember_tool.description or "")

            memory_get_tool = next(
                tool for tool in listed.tools if tool.name == "synapse_memory_get"
            )
            assert memory_get_tool.annotations is not None
            assert memory_get_tool.annotations.read_only_hint is True
            assert set(memory_get_tool.input_schema["required"]) == {"project", "node_id"}
            assert "full content" in (memory_get_tool.description or "")

            empty = await _call(session, "synapse_projects_list")
            assert empty == {"projects": []}

            missing = await session.call_tool(
                "synapse_search",
                {"project": "missing", "query": "anything"},
            )
            assert missing.is_error
            assert missing.content
            assert "PROJECT_NOT_FOUND" in missing.content[0].text

            invalid_mode = await session.call_tool(
                "synapse_search",
                {"project": "missing", "query": "anything", "mode": "semantic"},
            )
            assert invalid_mode.is_error
            assert invalid_mode.content
            assert "semantic" in invalid_mode.content[0].text

    with error_log_path.open("w+", encoding="utf-8", errors="replace") as errlog:
        _run(lambda: scenario(errlog))
        errlog.flush()
        errlog.seek(0)
        server_log = errlog.read()
    assert "Synapse MCP server" in server_log


def test_mcp_business_mapping_and_memory_persistence(tmp_path: Path) -> None:
    _root, home, project_id = _seed_project(tmp_path)
    params = _server_params(home, tmp_path)
    memory_node_id: str | None = None

    async def scenario(errlog: Any) -> None:
        nonlocal memory_node_id
        async with (
            stdio_client(params, errlog=errlog) as (read_stream, write_stream),
            ClientSession(read_stream, write_stream) as session,
        ):
            await session.initialize()

            projects = await _call(session, "synapse_projects_list")
            assert [item["id"] for item in projects["projects"]] == [project_id]

            status = await _call(
                session,
                "synapse_project_status",
                {"project": project_id},
            )
            assert status["project"]["id"] == project_id
            assert status["stats"]["nodes"] >= 2

            search = await _call(
                session,
                "synapse_search",
                {
                    "project": project_id,
                    "query": "build_widget",
                    "mode": "keyword",
                    "limit": 5,
                },
            )
            assert search["results"]
            function_node = next(
                item for item in search["results"] if item["node_type"] == "function"
            )

            related = await _call(
                session,
                "synapse_related",
                {"project": project_id, "node_id": function_node["node_id"]},
            )
            assert related["node"]["node_id"] == function_node["node_id"]
            assert related["related"]["code"]

            explored = await _call(
                session,
                "synapse_explore_graph",
                {
                    "project": project_id,
                    "node_id": function_node["node_id"],
                    "depth": 1,
                    "limit": 20,
                },
            )
            assert explored["nodes"]
            assert explored["start_node_id"] == function_node["node_id"]

            context = await _call(
                session,
                "synapse_context",
                {"project": project_id, "max_tokens": 800},
            )
            assert context["project"]["id"] == project_id
            assert context["stats"]["nodes"] >= 2

            memory_content = (
                "Synapse stores retrieval metadata in SQLite FTS5. "
                + "Long memory tail marker 2.2.1. " * 20
            ).strip()
            remembered = await _call(
                session,
                "synapse_remember",
                {
                    "project": project_id,
                    "content": memory_content,
                    "title": "SQLite FTS5 memory",
                    "memory_type": "fact",
                    "tags": ["mcp", "sqlite"],
                },
            )
            memory_node_id = remembered["node"]["node_id"]
            assert remembered["node"]["content"] == memory_content
            assert remembered["node"]["tags"] == "mcp sqlite"

            recalled = await _call(
                session,
                "synapse_recall",
                {
                    "project": project_id,
                    "query": "SQLite",
                    "mode": "keyword",
                },
            )
            recalled_memory = next(
                item for item in recalled["results"] if item["node_id"] == memory_node_id
            )
            assert recalled_memory["summary"] == memory_content[:300]

            fetched = await _call(
                session,
                "synapse_memory_get",
                {"project": project_id, "node_id": memory_node_id},
            )
            assert fetched["node_id"] == memory_node_id
            assert fetched["content"] == memory_content
            assert fetched["content"].endswith("Long memory tail marker 2.2.1.")
            assert fetched["title"] == "SQLite FTS5 memory"
            assert fetched["memory_type"] == "fact"
            assert fetched["tags"] == ["mcp", "sqlite"]
            assert fetched["provenance"] == "user"
            assert fetched["confidence"] == 1.0
            assert fetched["created_at"]
            assert fetched["updated_at"]

            non_memory = await session.call_tool(
                "synapse_memory_get",
                {"project": project_id, "node_id": function_node["node_id"]},
            )
            assert non_memory.is_error
            assert non_memory.content
            assert "INVALID_ARGUMENT" in non_memory.content[0].text
            assert "不是记忆" in non_memory.content[0].text

            missing_memory = await session.call_tool(
                "synapse_memory_get",
                {"project": project_id, "node_id": "missing-memory"},
            )
            assert missing_memory.is_error
            assert missing_memory.content
            assert "NODE_NOT_FOUND" in missing_memory.content[0].text

    with open(os.devnull, "w", encoding="utf-8") as errlog:
        _run(lambda: scenario(errlog))

    with build_application(Settings(home=home)) as application:
        stored = application.nodes.get(memory_node_id or "")
        assert stored is not None
        assert stored.project_id == project_id
        assert "SQLite FTS5" in stored.content
        assert stored.content.endswith("Long memory tail marker 2.2.1.")


def test_mcp_rejects_cross_project_node_access(tmp_path: Path) -> None:
    root_a = tmp_path / "project-a"
    root_b = tmp_path / "project-b"
    _write(root_a / "app.py", "def alpha() -> str:\n    return 'a'\n")
    _write(root_b / "app.py", "def beta() -> str:\n    return 'b'\n")
    home = tmp_path / "home"

    with build_application(Settings(home=home)) as application:
        project_a = application.project_tools.register(str(root_a))["id"]
        project_b = application.project_tools.register(str(root_b))["id"]
        application.project_tools.index(project_a)
        application.project_tools.index(project_b)
        node_b = application.nodes.find_by_path(project_b, "app.py")
        assert node_b is not None
        node_b_id = node_b.id
        memory_b = application.memory_tools.remember(
            project_b,
            "Project B only memory.",
            title="Project B memory",
            memory_type="fact",
        )
        memory_b_id = memory_b["node"]["node_id"]

    params = _server_params(home, tmp_path)

    async def scenario(errlog: Any) -> None:
        async with (
            stdio_client(params, errlog=errlog) as (read_stream, write_stream),
            ClientSession(read_stream, write_stream) as session,
        ):
            await session.initialize()
            result = await session.call_tool(
                "synapse_related",
                {"project": project_a, "node_id": node_b_id},
            )
            assert result.is_error
            assert result.content
            assert "INVALID_ARGUMENT" in result.content[0].text
            assert "不属于指定项目" in result.content[0].text

            memory_result = await session.call_tool(
                "synapse_memory_get",
                {"project": project_a, "node_id": memory_b_id},
            )
            assert memory_result.is_error
            assert memory_result.content
            assert "INVALID_ARGUMENT" in memory_result.content[0].text
            assert "不属于指定项目" in memory_result.content[0].text

    with open(os.devnull, "w", encoding="utf-8") as errlog:
        _run(lambda: scenario(errlog))


def test_mcp_stdout_contains_only_protocol_messages(tmp_path: Path) -> None:
    home = tmp_path / "home"
    request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": LATEST_HANDSHAKE_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "stdout-purity-test", "version": "1.0"},
        },
    }
    env = {
        **os.environ,
        "SYNAPSE_HOME": str(home),
        "PYTHONIOENCODING": "utf-8",
    }
    completed = subprocess.run(
        [sys.executable, *SERVER_ARGS],
        input=json.dumps(request) + "\n",
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(tmp_path),
        env=env,
        timeout=30,
        check=False,
    )

    stdout_lines = [line for line in completed.stdout.splitlines() if line.strip()]
    assert stdout_lines, completed.stderr
    for line in stdout_lines:
        message = json.loads(line)
        assert message["jsonrpc"] == "2.0"
        assert message["id"] == 1
        assert "result" in message
    assert completed.returncode == 0, completed.stderr
    assert "Synapse MCP server" in completed.stderr
