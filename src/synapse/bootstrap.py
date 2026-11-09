from __future__ import annotations

from dataclasses import dataclass

from synapse.config import Settings
from synapse.context.builder import ContextBuilder
from synapse.ingestion.pipeline import IngestionService
from synapse.knowledge.service import KnowledgeService
from synapse.normalizer.normalizer import Normalizer
from synapse.normalizer.resolver import ReferenceResolver
from synapse.parsers.registry import ParserRegistry
from synapse.retrieval.service import RetrievalService
from synapse.storage.sqlite.database import Database
from synapse.storage.sqlite.repositories import (
    IndexRunRepository,
    NodeRepository,
    ProjectRepository,
    RefRepository,
    RelationRepository,
    SourceRepository,
    TaskRepository,
)
from synapse.tools.memory_tools import MemoryTools
from synapse.tools.project_tools import ProjectTools
from synapse.tools.search_tools import SearchTools


@dataclass(slots=True)
class Application:
    settings: Settings
    database: Database
    projects: ProjectRepository
    sources: SourceRepository
    nodes: NodeRepository
    relations: RelationRepository
    refs: RefRepository
    tasks: TaskRepository
    runs: IndexRunRepository
    knowledge: KnowledgeService
    retrieval: RetrievalService
    context: ContextBuilder
    ingestion: IngestionService
    project_tools: ProjectTools
    search_tools: SearchTools
    memory_tools: MemoryTools

    def close(self) -> None:
        self.database.close()

    def __enter__(self) -> Application:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def build_application(settings: Settings | None = None) -> Application:
    settings = settings or Settings()
    database = Database(
        settings.resolved_db_path(),
        busy_timeout_ms=settings.storage.busy_timeout_ms,
        wal=settings.storage.wal,
    )
    database.initialize()

    projects = ProjectRepository(database)
    sources = SourceRepository(database)
    nodes = NodeRepository(database)
    relations = RelationRepository(database)
    refs = RefRepository(database)
    tasks = TaskRepository(database)
    runs = IndexRunRepository(database)

    parser_registry = ParserRegistry()
    normalizer = Normalizer()
    knowledge = KnowledgeService(
        database,
        sources,
        nodes,
        relations,
        refs,
        normalizer,
    )
    resolver = ReferenceResolver(nodes, relations, refs)
    ingestion = IngestionService(
        settings=settings,
        projects=projects,
        sources=sources,
        nodes=nodes,
        relations=relations,
        refs=refs,
        tasks=tasks,
        runs=runs,
        knowledge=knowledge,
        resolver=resolver,
        registry=parser_registry,
    )
    retrieval = RetrievalService(
        settings=settings,
        projects=projects,
        nodes=nodes,
        relations=relations,
    )
    context = ContextBuilder(
        projects=projects,
        nodes=nodes,
        relations=relations,
        sources=sources,
    )
    project_tools = ProjectTools(
        projects=projects,
        nodes=nodes,
        sources=sources,
        relations=relations,
        refs=refs,
        runs=runs,
        ingestion=ingestion,
    )
    search_tools = SearchTools(retrieval=retrieval, context=context)
    memory_tools = MemoryTools(
        projects=projects,
        nodes=nodes,
        knowledge=knowledge,
        retrieval=retrieval,
    )
    return Application(
        settings=settings,
        database=database,
        projects=projects,
        sources=sources,
        nodes=nodes,
        relations=relations,
        refs=refs,
        tasks=tasks,
        runs=runs,
        knowledge=knowledge,
        retrieval=retrieval,
        context=context,
        ingestion=ingestion,
        project_tools=project_tools,
        search_tools=search_tools,
        memory_tools=memory_tools,
    )
