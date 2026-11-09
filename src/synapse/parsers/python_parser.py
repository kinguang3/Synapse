from __future__ import annotations

import ast
import builtins
from pathlib import Path
from typing import Any

import tree_sitter_python
from tree_sitter import Language, Parser

from synapse.parsers.base import RawFile, RawNode, RawRef, RawRelation

_LANGUAGE = Language(tree_sitter_python.language())
_BUILTINS = frozenset(dir(builtins))


def _slice(data: bytes, node: Any) -> str:
    if node is None:
        return ""
    return data[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _docstring(data: bytes, body: Any) -> str:
    if body is None:
        return ""
    for child in body.named_children:
        if child.type != "expression_statement":
            break
        text = _slice(data, child).strip()
        if not text:
            continue
        if text[0] in ('"', "'"):
            try:
                value = ast.literal_eval(text)
            except (ValueError, SyntaxError):
                return text[:1000]
            return value if isinstance(value, str) else str(value)
        break
    return ""


class PythonParser:
    name = "tree-sitter-python"
    version = "2"

    def supports(self, path: Path, language: str | None) -> bool:
        return language == "python" or path.suffix.lower() == ".py"

    def parse(self, path: Path, relative_path: str, data: bytes) -> RawFile:
        parser = Parser(_LANGUAGE)
        tree = parser.parse(data)
        root = tree.root_node

        nodes: list[RawNode] = [
            RawNode(
                local_key="file",
                node_type="file",
                title=relative_path,
                content="",
                start_line=1,
                end_line=max(1, data.count(b"\n") + 1),
                symbol_kind="file",
                qualified_name=relative_path,
                tags=["python"],
                metadata={"language": "python"},
            )
        ]
        relations: list[RawRelation] = []
        unresolved: list[RawRef] = []
        symbol_map: dict[str, str] = {}
        used_keys: dict[str, int] = {}
        diagnostics: list[str] = []
        module_aliases: set[str] = set()

        def add_module_alias(target: str) -> None:
            target = target.strip()
            if not target:
                return
            module_aliases.add(target)
            module_aliases.add(target.split(".")[0])

        def collect_import_aliases(node: Any) -> None:
            for child in node.named_children:
                if child.type == "import_statement":
                    for imported in child.named_children:
                        if imported.type == "aliased_import":
                            alias_node = imported.child_by_field_name("alias")
                            name_node = imported.child_by_field_name("name")
                            if alias_node is not None:
                                module_aliases.add(_slice(data, alias_node))
                            add_module_alias(_slice(data, name_node))
                        else:
                            add_module_alias(_slice(data, imported))
                elif child.type == "import_from_statement":
                    module_node = child.child_by_field_name("module_name")
                    add_module_alias(_slice(data, module_node))
                    for imported in child.named_children:
                        if imported is module_node or imported.type == "wildcard_import":
                            continue
                        if imported.type == "aliased_import":
                            alias_node = imported.child_by_field_name("alias")
                            if alias_node is not None:
                                module_aliases.add(_slice(data, alias_node))
                            name_node = imported.child_by_field_name("name")
                            module_aliases.add(_slice(data, name_node).split(".")[0])
                        else:
                            module_aliases.add(_slice(data, imported).split(".")[0])
                collect_import_aliases(child)

        def alloc_key(qualified_name: str) -> str:
            count = used_keys.get(qualified_name, 0) + 1
            used_keys[qualified_name] = count
            return qualified_name if count == 1 else f"{qualified_name}#{count}"

        def add_contains(owner_key: str, target_key: str) -> None:
            relations.append(
                RawRelation(
                    from_local_key=owner_key,
                    to_local_key=target_key,
                    relation_type="CONTAINS",
                    confidence=1.0,
                    provenance="ast",
                    evidence={"detail": "syntax_tree"},
                )
            )

        def walk_definitions(
            node: Any,
            scope: list[str],
            current_class: str | None,
            owner_key: str,
        ) -> None:
            for child in node.named_children:
                if child.type == "class_definition":
                    name_node = child.child_by_field_name("name")
                    name = _slice(data, name_node)
                    if not name:
                        continue
                    qualified = ".".join([*scope, name])
                    key = alloc_key(qualified)
                    body = child.child_by_field_name("body")
                    superclasses = child.child_by_field_name("superclasses")
                    bases: list[str] = []
                    if superclasses is not None:
                        bases = [
                            _slice(data, base).strip()
                            for base in superclasses.named_children
                            if _slice(data, base).strip()
                        ]
                    nodes.append(
                        RawNode(
                            local_key=key,
                            node_type="class",
                            title=name,
                            content=_slice(data, child),
                            start_line=child.start_point[0] + 1,
                            end_line=child.end_point[0] + 1,
                            symbol_kind="class",
                            qualified_name=qualified,
                            docstring=_docstring(data, body),
                            tags=["python", "class"],
                            metadata={"bases": bases, "language": "python"},
                        )
                    )
                    symbol_map.setdefault(qualified, key)
                    add_contains(owner_key, key)
                    if body is not None:
                        walk_definitions(body, [*scope, name], qualified, key)
                elif child.type == "function_definition":
                    name_node = child.child_by_field_name("name")
                    name = _slice(data, name_node)
                    if not name:
                        continue
                    qualified = ".".join([*scope, name])
                    key = alloc_key(qualified)
                    body = child.child_by_field_name("body")
                    is_method = current_class is not None
                    node_type = "method" if is_method else "function"
                    nodes.append(
                        RawNode(
                            local_key=key,
                            node_type=node_type,
                            title=name,
                            content=_slice(data, child),
                            start_line=child.start_point[0] + 1,
                            end_line=child.end_point[0] + 1,
                            symbol_kind=node_type,
                            qualified_name=qualified,
                            docstring=_docstring(data, body),
                            tags=["python", node_type],
                            metadata={"language": "python"},
                        )
                    )
                    symbol_map.setdefault(qualified, key)
                    add_contains(owner_key, key)
                    if body is not None:
                        walk_definitions(body, [*scope, name], None, key)
                else:
                    walk_definitions(child, scope, current_class, owner_key)

        def add_import_ref(owner_key: str, target: str, line: int) -> None:
            target = target.strip()
            if not target:
                return
            unresolved.append(
                RawRef(
                    from_local_key=owner_key,
                    ref_kind="import",
                    target_text=target,
                    line=line,
                    confidence=0.9,
                    provenance="ast",
                )
            )

        def reference_text(function_node: Any) -> str | None:
            if function_node is None:
                return None
            node_type = function_node.type
            text = _slice(data, function_node).strip()
            if node_type == "identifier":
                return None if text in _BUILTINS else text
            if node_type == "attribute":
                obj = function_node.child_by_field_name("object")
                attr = function_node.child_by_field_name("attribute")
                if obj is None or attr is None:
                    return None
                obj_text = _slice(data, obj).strip()
                if obj_text in ("self", "cls"):
                    return text
                root = obj_text.split(".")[0]
                if obj_text in module_aliases or root in module_aliases:
                    return text
            return None

        def resolve_call(function_node: Any, class_qualified: str | None) -> str | None:
            if function_node is None:
                return None
            node_type = function_node.type
            text = _slice(data, function_node).strip()
            if node_type == "identifier":
                if class_qualified:
                    key = symbol_map.get(f"{class_qualified}.{text}")
                    if key:
                        return key
                return symbol_map.get(text)
            if node_type == "attribute":
                attr = function_node.child_by_field_name("attribute")
                obj = function_node.child_by_field_name("object")
                if attr is None:
                    return None
                method = _slice(data, attr).strip()
                if obj is not None:
                    obj_text = _slice(data, obj).strip()
                    if obj_text in ("self", "cls") and class_qualified:
                        return symbol_map.get(f"{class_qualified}.{method}")
                    return symbol_map.get(f"{obj_text}.{method}")
                return symbol_map.get(method)
            return None

        def walk_references(
            node: Any,
            scope: list[str],
            owner_key: str,
            class_qualified: str | None,
        ) -> None:
            for child in node.named_children:
                if child.type == "class_definition":
                    name = _slice(data, child.child_by_field_name("name"))
                    qualified = ".".join([*scope, name])
                    key = symbol_map.get(qualified)
                    if key is None:
                        continue
                    superclasses = child.child_by_field_name("superclasses")
                    if superclasses is not None:
                        for base in superclasses.named_children:
                            target = _slice(data, base).strip()
                            if not target:
                                continue
                            target_key = symbol_map.get(target)
                            if target_key:
                                relations.append(
                                    RawRelation(
                                        from_local_key=key,
                                        to_local_key=target_key,
                                        relation_type="INHERITS",
                                        confidence=0.95,
                                        provenance="ast",
                                        evidence={"detail": "local_class", "base": target},
                                    )
                                )
                            else:
                                unresolved.append(
                                    RawRef(
                                        from_local_key=key,
                                        ref_kind="inherit",
                                        target_text=target,
                                        line=base.start_point[0] + 1,
                                        confidence=0.75,
                                        provenance="ast",
                                    )
                                )
                    body = child.child_by_field_name("body")
                    if body is not None:
                        walk_references(body, [*scope, name], key, qualified)
                elif child.type == "function_definition":
                    name = _slice(data, child.child_by_field_name("name"))
                    qualified = ".".join([*scope, name])
                    key = symbol_map.get(qualified)
                    if key is None:
                        continue
                    is_method = (
                        class_qualified is not None
                        and qualified.startswith(class_qualified + ".")
                        and qualified.count(".") == class_qualified.count(".") + 1
                    )
                    body = child.child_by_field_name("body")
                    if body is not None:
                        walk_references(
                            body,
                            [*scope, name],
                            key,
                            class_qualified if is_method else None,
                        )
                elif child.type in ("import_statement", "import_from_statement"):
                    if child.type == "import_statement":
                        for imported in child.named_children:
                            if imported.type == "aliased_import":
                                name_node = imported.child_by_field_name("name")
                                target = _slice(data, name_node)
                            else:
                                target = _slice(data, imported)
                            add_import_ref(owner_key, target, child.start_point[0] + 1)
                    else:
                        module = child.child_by_field_name("module_name")
                        target = _slice(data, module)
                        add_import_ref(owner_key, target, child.start_point[0] + 1)
                elif child.type == "call":
                    function_node = child.child_by_field_name("function")
                    target_key = resolve_call(function_node, class_qualified)
                    if target_key:
                        relations.append(
                            RawRelation(
                                from_local_key=owner_key,
                                to_local_key=target_key,
                                relation_type="CALLS",
                                confidence=0.95,
                                provenance="ast",
                                evidence={
                                    "detail": "intra_file_call",
                                    "call": _slice(data, function_node).strip(),
                                },
                            )
                        )
                    else:
                        call_text = reference_text(function_node)
                        if call_text:
                            unresolved.append(
                                RawRef(
                                    from_local_key=owner_key,
                                    ref_kind="call",
                                    target_text=call_text,
                                    line=child.start_point[0] + 1,
                                    confidence=0.6,
                                    provenance="heuristic",
                                )
                            )
                    for sub in child.named_children:
                        if sub is not function_node:
                            walk_references(sub, scope, owner_key, class_qualified)
                else:
                    walk_references(child, scope, owner_key, class_qualified)

        try:
            collect_import_aliases(root)
            walk_definitions(root, [], None, "file")
            walk_references(root, [], "file", None)
        except Exception as exc:  # noqa: BLE001
            diagnostics.append(f"Python 解析失败: {exc}")

        return RawFile(
            path=relative_path,
            language="python",
            nodes=nodes,
            relations=relations,
            unresolved=unresolved,
            diagnostics=diagnostics,
        )
