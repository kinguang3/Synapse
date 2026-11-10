from __future__ import annotations

import argparse
import os
from collections.abc import Sequence

import uvicorn

from synapse.config import load_settings
from synapse.integrations.gui.app import create_app
from synapse.integrations.gui.security import resolve_token


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Synapse local GUI server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--log-level", default="info")
    parser.add_argument("--no-access-log", action="store_true")
    args = parser.parse_args(argv)

    token = resolve_token()
    app = create_app(load_settings(), token=token)
    print(f"Synapse GUI: http://{args.host}:{args.port}/")
    if os.environ.get("SYNAPSE_GUI_TOKEN"):
        print("Token source: SYNAPSE_GUI_TOKEN")
    else:
        print(f"Access token: {token}")
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        access_log=not args.no_access_log,
    )


if __name__ == "__main__":
    main()
