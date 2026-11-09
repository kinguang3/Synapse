from __future__ import annotations

import secrets
import time
import uuid

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_id() -> str:
    timestamp_ms = int(time.time() * 1000)
    value = int.from_bytes(timestamp_ms.to_bytes(6, "big") + secrets.token_bytes(10), "big")
    chars: list[str] = []
    for _ in range(26):
        chars.append(_ALPHABET[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def stable_id(*parts: str) -> str:
    name = "synapse://" + "/".join(parts)
    return str(uuid.uuid5(uuid.NAMESPACE_URL, name))
