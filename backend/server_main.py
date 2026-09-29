"""Entry point of the self-contained Yukti server (yukti-server.exe)."""
import argparse
import multiprocessing
import os
import sys


def main() -> None:
    multiprocessing.freeze_support()
    ap = argparse.ArgumentParser(prog="yukti-server", description="Yukti — Sovereign Industrial AI Workbench server")
    ap.add_argument("--host", default=os.environ.get("YUKTI_HOST", "127.0.0.1"), help="0.0.0.0 to serve desktop clients on the plant LAN")
    ap.add_argument("--port", type=int, default=int(os.environ.get("YUKTI_PORT", "8000")))
    args = ap.parse_args()
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    import uvicorn
    from app.main import app
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    sys.exit(main())
