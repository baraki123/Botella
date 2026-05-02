"""uvicorn entrypoint for the Layla sketch."""

from __future__ import annotations

from botella import create_app
from examples.layla_sketch.manifest import build_manifest

app = create_app(build_manifest())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
