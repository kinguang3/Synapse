from synapse.core.text import build_fts_query, split_identifier, tokenize_for_search


def test_split_identifier() -> None:
    assert split_identifier("BookRecommender") == ["book", "recommender"]
    assert split_identifier("HTTPClient") == ["http", "client"]


def test_cjk_bigram_tokenization() -> None:
    tokens = tokenize_for_search("推荐算法")
    assert "推荐" in tokens
    assert "荐算" in tokens
    assert "算法" in tokens


def test_fts_query_for_mixed_text() -> None:
    query = build_fts_query("推荐算法 BookRecommender")
    assert query
    assert '"推荐"' in query
    assert '"book"' in query
    assert "AND" in query
