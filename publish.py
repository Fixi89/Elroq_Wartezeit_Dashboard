#!/usr/bin/env python3
"""
Elroq/Enyaq Dashboard — Build + Veröffentlichung auf GitHub Pages

Baut eines oder beide Wartezeit-Dashboards (ruft elroq_dashboard_update.py
und/oder enyaq_dashboard_update.py auf), legt sie an ihrem jeweiligen Zielort
ab und committed + pusht die Änderungen ins Git-Repository. Gedacht für den
Einsatz mit einem Cronjob / Task-Scheduler, damit die Dashboards sich
automatisch aktuell halten — siehe LIESMICH.md, Abschnitt "Automatisch
veröffentlichen (GitHub Pages)".

Beide Fahrzeuge landen im selben Repository, aber in getrennten Pfaden, damit
sie nie vermischt werden:
    index.html        <- Elroq-Dashboard  (GitHub-Pages-Startseite)
    enyaq/index.html   <- Enyaq-Dashboard  (eigene Unterseite .../enyaq/)

Zusätzlich wird jedes Dashboard unter seinen "Mirror"-Dateinamen identisch
mitgespeichert — praktisch, wenn irgendwo bereits ein Link oder ein Embed auf
einen bestimmten Dateinamen zeigt und dieser Link weiter funktionieren soll.

Voraussetzung: Dieser Ordner ist bereits ein Git-Repository mit eingerichtetem
'origin'-Remote (z.B. ein GitHub-Repo, für das Pages aktiviert ist).

Aufruf:
    python3 publish.py                  # nur Elroq (Standard, wie bisher)
    python3 publish.py --vehicle enyaq  # nur Enyaq
    python3 publish.py --vehicle both   # beide, ein gemeinsamer Commit

Optionen:
    --vehicle {elroq,enyaq,both}
                     welches Dashboard gebaut wird (Standard: elroq)
    --no-push        nur bauen + committen, nicht pushen (zum Testen)
    --message TEXT   eigene Commit-Message statt der automatischen
    --out DATEI      anderer Dateiname als der Standard (nur bei einzelnem
                     Fahrzeug sinnvoll, nicht bei --vehicle both)
    --also-copy-to DATEI
                     zusätzlicher Dateiname für eine 1:1-Kopie (mehrfach
                     angebbar, nur bei einzelnem Fahrzeug)
    --no-mirror      keine Kopien unter alten Dateinamen erzeugen

Alle unbekannten Optionen (z.B. --delay 3) werden an die jeweiligen
*_dashboard_update.py-Skripte durchgereicht (bei --vehicle both an beide).
"""

import argparse
import datetime
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

# Vehicle-Konfiguration: welches Skript baut was, wohin, mit welchem Log,
# und welche alten Dateinamen zusätzlich als 1:1-Kopie gepflegt werden.
VEHICLES = {
    "elroq": {
        "label": "Elroq",
        "script": SCRIPT_DIR / "elroq_dashboard_update.py",
        "default_out": "index.html",
        "log": "predictions_log.json",
        "default_mirrors": ["Elroq_Wartezeit_Dashboard.html"],
    },
    "enyaq": {
        "label": "Enyaq",
        "script": SCRIPT_DIR / "enyaq_dashboard_update.py",
        "default_out": "enyaq/index.html",
        "log": "predictions_log_enyaq.json",
        "default_mirrors": ["enyaq/Enyaq_Wartezeit_Dashboard.html"],
    },
}


def run(cmd, **kwargs):
    print("$", " ".join(cmd))
    return subprocess.run(cmd, cwd=SCRIPT_DIR, **kwargs)


def build_vehicle(key, args, extra):
    """
    Baut ein einzelnes Dashboard und legt die Mirror-Kopien an. Gibt die
    Liste der betroffenen (relativen) Dateipfade zurück, oder None bei
    einem Build-Fehler.
    """
    cfg = VEHICLES[key]
    script = cfg["script"]
    if not script.exists():
        print(f"  {script.name} nicht gefunden neben publish.py ({SCRIPT_DIR}) — überspringe {cfg['label']}.")
        return None

    out = args.out or cfg["default_out"]
    mirrors = [] if args.no_mirror else (args.also_copy_to or list(cfg["default_mirrors"]))
    mirrors = [m for m in mirrors if m != out]

    print(f"\n=== {cfg['label']} ===")
    build = run([sys.executable, str(script), "--out", out, *extra])
    if build.returncode != 0:
        print(f"  {cfg['label']}-Build fehlgeschlagen — dieses Dashboard wird NICHT veröffentlicht.")
        return None

    out_path = SCRIPT_DIR / out
    for mirror in mirrors:
        mirror_path = SCRIPT_DIR / mirror
        mirror_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out_path, mirror_path)
        print(f"  Kopiert nach: {mirror}")

    return [out, cfg["log"], *mirrors]


def main():
    ap = argparse.ArgumentParser(description="Baut die Dashboards und veröffentlicht sie via Git.")
    ap.add_argument("--vehicle", choices=["elroq", "enyaq", "both"], default="elroq",
                     help="Welches Dashboard gebaut wird (Standard: elroq)")
    ap.add_argument("--no-push", action="store_true",
                     help="Nur committen, nicht pushen (zum Testen ohne Internet/Zugangsdaten)")
    ap.add_argument("--message", default=None, help="Eigene Commit-Message")
    ap.add_argument("--out", default=None,
                     help="Zieldatei (nur bei einzelnem Fahrzeug; Standard je nach Fahrzeug)")
    ap.add_argument("--also-copy-to", action="append", default=None,
                     help="Zusätzlicher Dateiname für eine 1:1-Kopie (mehrfach angebbar, "
                          "nur bei einzelnem Fahrzeug)")
    ap.add_argument("--no-mirror", action="store_true",
                     help="Keine Kopien unter alten Dateinamen erzeugen")
    args, extra = ap.parse_known_args()

    keys = ["elroq", "enyaq"] if args.vehicle == "both" else [args.vehicle]
    if args.vehicle == "both" and (args.out or args.also_copy_to):
        sys.exit("--out/--also-copy-to funktionieren nicht zusammen mit --vehicle both "
                  "(beide Dashboards brauchen unterschiedliche Dateinamen). "
                  "Bitte einzeln mit --vehicle elroq bzw. --vehicle enyaq aufrufen.")

    all_tracked = []
    any_build_failed = False
    for key in keys:
        tracked = build_vehicle(key, args, extra)
        if tracked is None:
            any_build_failed = True
        else:
            all_tracked.extend(tracked)

    if not all_tracked:
        sys.exit("\nKein Dashboard konnte gebaut werden — es wird nichts veröffentlicht.")

    # Git-Status nur fuer die Dateien pruefen, die tatsaechlich gebaut wurden.
    status = run(["git", "status", "--porcelain", *all_tracked],
                 capture_output=True, text=True)
    if status.returncode != 0:
        sys.exit("\n`git status` fehlgeschlagen — ist dieser Ordner ein Git-Repository? "
                  "Siehe LIESMICH.md.")
    if not status.stdout.strip():
        print("\nKeine Änderungen seit dem letzten Lauf — nichts zu veröffentlichen.")
        return

    msg = args.message or f"Dashboard-Update {datetime.date.today().isoformat()}"
    run(["git", "add", *all_tracked])
    commit = run(["git", "commit", "-m", msg])
    if commit.returncode != 0:
        sys.exit("\ngit commit fehlgeschlagen.")

    if args.no_push:
        print("\n`--no-push` gesetzt: Änderungen sind lokal committed, aber nicht gepusht.")
        return

    push = run(["git", "push"])
    if push.returncode != 0:
        sys.exit(
            "\ngit push fehlgeschlagen. Häufige Ursachen:\n"
            "  - kein 'origin'-Remote eingerichtet (git remote add origin <URL>)\n"
            "  - keine gespeicherten Zugangsdaten (siehe LIESMICH.md)\n"
            "  - keine Internetverbindung"
        )

    print(f"\nVeröffentlicht: {msg}")
    if any_build_failed:
        print("Hinweis: Ein Teil-Build ist fehlgeschlagen und wurde übersprungen (siehe oben).")


if __name__ == "__main__":
    main()
