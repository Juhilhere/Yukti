"""Entry point of the self-contained Yukti server (yukti-server.exe)."""
import argparse
import multiprocessing
import os
import socket
import sys
import threading
import time


def _port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _watch_parent(pid: int) -> None:
    """Exit (stopping llama-server) if the desktop app that started this server disappears."""
    import psutil
    while True:
        time.sleep(2)
        if not psutil.pid_exists(pid):
            try:
                from app import engine
                engine.log(f"[server] parent process {pid} is gone - shutting down")
                engine.unload()
            finally:
                os._exit(0)


def main() -> int:
    multiprocessing.freeze_support()
    ap = argparse.ArgumentParser(prog="yukti-server", description="Yukti - Sovereign Industrial AI Workbench server")
    ap.add_argument("--host", default=os.environ.get("YUKTI_HOST", "127.0.0.1"), help="0.0.0.0 to serve desktop clients on the plant LAN")
    ap.add_argument("--port", type=int, default=int(os.environ.get("YUKTI_PORT", "8000")))
    ap.add_argument("--tls-cert", default=os.environ.get("YUKTI_TLS_CERT", ""), help="PEM certificate: serve HTTPS (recommended on the plant LAN)")
    ap.add_argument("--tls-key", default=os.environ.get("YUKTI_TLS_KEY", ""), help="PEM private key for --tls-cert")
    ap.add_argument("--parent-pid", type=int, default=0, help="exit automatically when this process ends (used by the desktop app)")
    args = ap.parse_args()
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    if not _port_free(args.host, args.port):
        print(f"ERROR: port {args.port} on {args.host} is already in use. Stop the other program or start Yukti with --port <free port>.",
              file=sys.stderr, flush=True)
        return 3
    tls = {}
    if args.tls_cert or args.tls_key:
        if not (args.tls_cert and args.tls_key and os.path.isfile(args.tls_cert) and os.path.isfile(args.tls_key)):
            print("ERROR: HTTPS needs both --tls-cert and --tls-key pointing to existing PEM files.", file=sys.stderr, flush=True)
            return 4
        tls = {"ssl_certfile": args.tls_cert, "ssl_keyfile": args.tls_key}
        os.environ["YUKTI_TLS"] = "1"
    os.environ["YUKTI_HOST"] = args.host
    if args.parent_pid:
        threading.Thread(target=_watch_parent, args=(args.parent_pid,), daemon=True).start()
    import uvicorn
    from app.main import app
    uvicorn.run(app, host=args.host, port=args.port, log_level="info", server_header=False, **tls)
    return 0


if __name__ == "__main__":
    sys.exit(main())
