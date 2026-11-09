from __future__ import annotations

import math
import re
import unicodedata

_CJK = "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
_TOKEN_RE = re.compile(rf"[A-Za-z_][A-Za-z0-9_]*|[{_CJK}]+|\d+")
_CJK_RE = re.compile(rf"[{_CJK}]+")
_CAMEL_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def split_identifier(value: str) -> list[str]:
    parts: list[str] = []
    for chunk in re.split(r"[_\-\s]+", value):
        if not chunk:
            continue
        parts.extend(match.group(0).lower() for match in _CAMEL_RE.finditer(chunk))
    return parts


def cjk_grams(value: str, include_unigrams: bool = True) -> list[str]:
    grams: list[str] = []
    for run in _CJK_RE.findall(value):
        if include_unigrams:
            grams.extend(run)
        if len(run) > 1:
            grams.extend(run[index : index + 2] for index in range(len(run) - 1))
    return grams


def tokenize_for_search(value: str, max_chars: int = 200_000) -> str:
    text = unicodedata.normalize("NFKC", value[:max_chars])
    tokens: list[str] = []
    seen: set[str] = set()

    def add(token: str) -> None:
        token = token.strip().lower()
        if token and token not in seen:
            seen.add(token)
            tokens.append(token)

    for match in _TOKEN_RE.finditer(text):
        raw = match.group(0)
        if _CJK_RE.fullmatch(raw):
            for gram in cjk_grams(raw, include_unigrams=True):
                add(gram)
        elif raw[0].isdigit():
            add(raw)
        else:
            add(raw)
            for part in split_identifier(raw):
                add(part)
    return " ".join(tokens)


def build_fts_query(query: str, max_terms: int = 12) -> str | None:
    text = unicodedata.normalize("NFKC", query)
    terms: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        if term and term not in seen:
            seen.add(term)
            terms.append(term)

    for match in _TOKEN_RE.finditer(text):
        raw = match.group(0)
        if _CJK_RE.fullmatch(raw):
            if len(raw) == 1:
                add(raw)
            else:
                for gram in cjk_grams(raw, include_unigrams=False):
                    add(gram)
        else:
            for part in split_identifier(raw) or [raw.lower()]:
                add(part)

    if not terms:
        return None
    joins_with_or = len(terms) > 6
    encoded = [f'"{term}"' for term in terms[:max_terms]]
    separator = " OR " if joins_with_or else " AND "
    return separator.join(encoded)


def normalize_qualified_name(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip().lower()


def slugify(value: str) -> str:
    slug = _SLUG_RE.sub("-", value.strip().lower()).strip("-")
    return slug


def estimate_tokens(value: str) -> int:
    if not value:
        return 0
    return max(1, math.ceil(len(value) / 3))
