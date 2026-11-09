from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from markdown_it import MarkdownIt
from mdit_py_plugins.front_matter import front_matter_plugin

from synapse.parsers.base import RawFile, RawNode, RawRef, RawRelation

_FRONT_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$")


def _make_markdown() -> MarkdownIt:
    return MarkdownIt("commonmark", {"html": False, "linkify": False}).use(front_matter_plugin)


def _parse_front_matter(content: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for line in content.splitlines():
        match = _FRONT_KEY_RE.match(line.strip())
        if not match:
            continue
        key, value = match.group(1).lower(), match.group(2).strip()
        if key in {"tag", "tags"}:
            cleaned = value.strip("[]")
            result["tags"] = [
                item.strip().strip("\"'") for item in cleaned.split(",") if item.strip()
            ]
        else:
            result[key] = value.strip("\"'")
    return result


class MarkdownParser:
    name = "markdown-it"
    version = "1"

    def supports(self, path: Path, language: str | None) -> bool:
        return language == "markdown" or path.suffix.lower() in {".md", ".markdown"}

    def parse(self, path: Path, relative_path: str, data: bytes) -> RawFile:
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines(keepends=True)
        total_lines = max(1, len(lines))
        tokens = _make_markdown().parse(text)

        metadata: dict[str, Any] = {}
        tags: list[str] = []
        headings: list[dict[str, Any]] = []
        current_heading: dict[str, Any] | None = None
        for index, token in enumerate(tokens):
            if token.type == "front_matter":
                metadata = _parse_front_matter(token.content)
                tags = [str(item) for item in metadata.get("tags", [])]
            elif token.type == "heading_open":
                inline = tokens[index + 1] if index + 1 < len(tokens) else None
                title = (inline.content if inline is not None else "").strip()
                start = token.map[0] if token.map else 0
                end = token.map[1] if token.map else start + 1
                current_heading = {
                    "level": int(token.tag[1:]) if token.tag.startswith("h") else 1,
                    "title": title or "untitled",
                    "start": start,
                    "end": end,
                }
                headings.append(current_heading)
            elif token.type == "inline" and current_heading is not None:
                current_heading["inline"] = token

        document_title = str(metadata.get("title") or relative_path)
        nodes: list[RawNode] = [
            RawNode(
                local_key="doc",
                node_type="document",
                title=document_title,
                content="",
                start_line=1,
                end_line=total_lines,
                symbol_kind="document",
                qualified_name=relative_path,
                tags=["markdown", *tags],
                metadata={"language": "markdown", "front_matter": metadata, "path": relative_path},
            )
        ]
        relations: list[RawRelation] = []
        unresolved: list[RawRef] = []
        used_keys: dict[str, int] = {}
        section_ranges: list[tuple[int, int, str]] = []

        def alloc_key(qualified: str) -> str:
            count = used_keys.get(qualified, 0) + 1
            used_keys[qualified] = count
            return qualified if count == 1 else f"{qualified}#{count}"

        def add_section(
            qualified: str,
            title: str,
            level: int,
            start: int,
            end: int,
            *,
            parent_key: str,
            body: str,
        ) -> str:
            key = alloc_key(qualified)
            nodes.append(
                RawNode(
                    local_key=key,
                    node_type="doc_section",
                    title=title,
                    content=body,
                    start_line=start + 1,
                    end_line=max(start + 1, end),
                    symbol_kind="section",
                    qualified_name=qualified,
                    tags=["markdown", "section", *tags],
                    metadata={"language": "markdown", "level": level},
                )
            )
            relations.append(
                RawRelation(
                    from_local_key=parent_key,
                    to_local_key=key,
                    relation_type="CONTAINS",
                    confidence=1.0,
                    provenance="explicit_ref",
                    evidence={"detail": "markdown_heading"},
                )
            )
            section_ranges.append((start, end, key))
            return key

        first_heading_start = headings[0]["start"] if headings else total_lines
        if first_heading_start > 0 and text.strip():
            root_body = "".join(lines[:first_heading_start])
            if root_body.strip():
                add_section(
                    "root",
                    str(metadata.get("title") or "root"),
                    0,
                    0,
                    first_heading_start,
                    parent_key="doc",
                    body=root_body,
                )

        stack: list[tuple[int, str]] = []
        for index, heading in enumerate(headings):
            next_start = (
                headings[index + 1]["start"] if index + 1 < len(headings) else total_lines
            )
            while stack and stack[-1][0] >= heading["level"]:
                stack.pop()
            parent_key = stack[-1][1] if stack else "doc"
            qualified = heading["title"]
            if stack:
                qualified = f"{stack[-1][1]}/{heading['title']}"
            body = "".join(lines[heading["start"] : next_start])
            key = add_section(
                qualified,
                heading["title"],
                heading["level"],
                heading["start"],
                next_start,
                parent_key=parent_key,
                body=body,
            )
            stack.append((heading["level"], key))

        if not headings and text.strip() and not any(node.local_key == "root" for node in nodes):
            add_section(
                "root",
                document_title,
                0,
                0,
                total_lines,
                parent_key="doc",
                body=text,
            )

        seen_links: set[tuple[str, str]] = set()
        for token in tokens:
            if token.type != "inline" or not token.map:
                continue
            line_number = token.map[0]
            candidates = [
                (end - start, key)
                for start, end, key in section_ranges
                if start <= line_number < end
            ]
            if not candidates:
                continue
            section_key = min(candidates)[1]
            for child in token.children or []:
                if child.type != "link_open":
                    continue
                raw_href = child.attrs.get("href") if child.attrs else None
                if not isinstance(raw_href, str) or not raw_href:
                    continue
                if raw_href.startswith(("#", "http://", "https://", "mailto:")):
                    continue
                href = raw_href
                link_key = (section_key, href)
                if link_key in seen_links:
                    continue
                seen_links.add(link_key)
                unresolved.append(
                    RawRef(
                        from_local_key=section_key,
                        ref_kind="link",
                        target_path=href,
                        target_text=href,
                        line=line_number + 1,
                        confidence=1.0,
                        provenance="explicit_ref",
                    )
                )

        return RawFile(
            path=relative_path,
            language="markdown",
            nodes=nodes,
            relations=relations,
            unresolved=unresolved,
        )
