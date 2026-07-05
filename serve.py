#!/usr/bin/env python3
"""Lokalni server pro web Enjoy Team.

Mapuje cesty bez pripony na .html soubory (napr. /o-nas -> o-nas.html).

Spusteni:
  python3 serve.py              # jen tento pocitac (127.0.0.1)
  python3 serve.py --lan        # i telefon v siti / hotspotu
  python3 serve.py --lan 8080   # vlastni port
"""
from __future__ import annotations

import argparse
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent / "docs"
DEFAULT_PORT = 8000


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_DIR), **kwargs)

    def send_head(self):
        path = self.path.split("?")[0].split("#")[0]
        if path != "/" and "." not in path.rsplit("/", 1)[-1]:
            candidate = SITE_DIR / (path.lstrip("/") + ".html")
            if candidate.exists():
                self.path = path.rstrip("/") + ".html"
        return super().send_head()


def lan_ips() -> list[str]:
    ips: set[str] = set()

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            ips.add(sock.getsockname()[0])
    except OSError:
        pass

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except socket.gaierror:
        pass

    return sorted(ips)


def print_urls(host: str, port: int) -> None:
    print(f"Web bezi na http://127.0.0.1:{port}", flush=True)

    if host != "127.0.0.1":
        print("Test na telefonu (stejna Wi-Fi / hotspot):", flush=True)
        ips = lan_ips()
        for ip in ips:
            print(f"  http://{ip}:{port}", flush=True)
        if not ips:
            print("  (LAN IP se nepodařilo zjistit — zkuste ipconfig getifaddr en0)", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lokalni server pro web Enjoy Team.")
    parser.add_argument(
        "--lan",
        action="store_true",
        help="naslouchat v cele siti (0.0.0.0) — pro test na telefonu",
    )
    parser.add_argument(
        "port",
        nargs="?",
        type=int,
        default=DEFAULT_PORT,
        help=f"port (vychozi {DEFAULT_PORT})",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    print_urls(host, args.port)

    try:
        ThreadingHTTPServer((host, args.port), Handler).serve_forever()
    except OSError as exc:
        print(f"Server se nespustil: {exc}", file=sys.stderr)
        if args.lan:
            print("Tip: zkontrolujte firewall Macu nebo zkuste jiny port.", file=sys.stderr)
        sys.exit(1)
