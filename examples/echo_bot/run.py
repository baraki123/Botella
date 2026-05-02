"""Run the toy bot locally:  python -m examples.echo_bot.run"""

from __future__ import annotations

import uvicorn

from botella import create_app
from examples.echo_bot.manifest import build_manifest

app = create_app(build_manifest())


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
