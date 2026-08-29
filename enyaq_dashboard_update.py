#!/usr/bin/env python3
"""
Enyaq Wartezeit-Dashboard — automatischer Datenabruf

Holt die Fahrzeugbestellungen direkt von https://www.enyaq-forum.de/car-order-list/,
trennt ausgelieferte von offenen Bestellungen, harmonisiert die Freitext-
Ausstattung, entfernt Ausreisser bei den ausgelieferten Fahrzeugen, erstellt
fuer jede offene Bestellung eine Liefer-Prognose und baut daraus das fertige
Dashboard-HTML.

Schwesterskript von elroq_dashboard_update.py — beide teilen sich Vorlagen
(template_dashboard.html/template_app.js) und die komplette Auswertungslogik,
haben aber eigene, komplett getrennte Log- und Ausgabedateien, damit die
Daten der beiden Fahrzeuge nie vermischt werden.

Prognosen werden dauerhaft in predictions_log_enyaq.json protokolliert:
Sobald eine Bestellung, fuer die zuvor eine Prognose geloggt wurde, als
ausgeliefert erkannt wird, traegt das Skript automatisch das tatsaechliche
Lieferdatum und die Abweichung zur Prognose nach. Die Log-Datei bleibt
zwischen Laeufen erhalten — bitte nicht loeschen, sonst geht die Historie
verloren.

Aufruf:
    python3 enyaq_dashboard_update.py

Optionen:
    --out DATEI      Zieldatei (Standard: enyaq/index.html)
    --csv DATEI      Zusaetzlich die bereinigten Daten als CSV speichern
    --delay SEK      Wartezeit zwischen den Seitenabrufen (Standard: 1.5)
    --keep-outliers  Ausreisser NICHT entfernen
    --max-pages N    Sicherheitslimit fuer die Seitenzahl (Standard: 50, reicht
                     fuer den Enyaq mit aktuell rund 18 Seiten komfortabel)

Benoetigt: requests, beautifulsoup4
    pip install requests beautifulsoup4
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

import backtest

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit(
        "Fehlende Pakete. Bitte installieren mit:\n"
        "    pip install requests beautifulsoup4"
    )

BASE_URL = "https://www.enyaq-forum.de/car-order-list/"
SCRIPT_DIR = Path(__file__).resolve().parent
TEMPLATE_HTML = SCRIPT_DIR / "template_dashboard.html"
TEMPLATE_JS = SCRIPT_DIR / "template_app.js"
LOG_PATH = SCRIPT_DIR / "predictions_log_enyaq.json"

# Marken-Angaben fuer den Header und den Elroq/Enyaq-Umschalter im Dashboard.
# Die Gegenstelle (elroq_dashboard_update.py) hat hier die gespiegelten Werte.
VEHICLE_NAME = "Enyaq"
VEHICLE_FORUM_LABEL = "Enyaq-Forum"
SWITCH_SELF_HREF = "./"
SWITCH_OTHER_HREF = "../"

DAY_MS = 86400000

# Freundlicher User-Agent: das Forum soll erkennen koennen, wer da anfragt.
HEADERS = {
    "User-Agent": (
        "EnyaqWartezeitDashboard/1.0 (privates Auswertungsskript; "
        "Python requests)"
    ),
    "Accept-Language": "de-DE,de;q=0.9",
}

MONTHS = {
    "januar": 1, "februar": 2, "märz": 3, "maerz": 3, "april": 4, "mai": 5,
    "juni": 6, "juli": 7, "august": 8, "september": 9, "oktober": 10,
    "november": 11, "dezember": 12,
}


# --------------------------------------------------------------------------
# 1. Abruf
# --------------------------------------------------------------------------

def fetch_page(session, page_no, delay):
    """Laedt eine Ergebnisseite und gibt das geparste HTML zurueck."""
    params = {"pageNo": page_no, "sortField": "orderDate", "sortOrder": "DESC"}
    resp = session.get(BASE_URL, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    time.sleep(delay)  # das Forum nicht ueberrennen
    return BeautifulSoup(resp.text, "html.parser")


def detect_total_pages(soup):
    """Liest die hoechste Seitenzahl aus der Blaetter-Navigation."""
    pages = set()
    for a in soup.select('a[href*="pageNo="]'):
        m = re.search(r"pageNo=(\d+)", a.get("href", ""))
        if m:
            pages.add(int(m.group(1)))
    return max(pages) if pages else 1


# --------------------------------------------------------------------------
# 2. Parsing
# --------------------------------------------------------------------------

def clean(text):
    """Normalisiert Whitespace inkl. der Tabs aus dem Forums-Markup."""
    return re.sub(r"\s+", " ", (text or "")).strip()


# --------------------------------------------------------------------------
# ID-Hashing (Datenschutz)
# --------------------------------------------------------------------------

# Die interne Forums-Objekt-ID (data-object-id) landete bisher im Klartext im
# veroeffentlichten JSON/CSV. Falls sich daraus eine Post-URL ableiten laesst,
# fuehrt sie zurueck zum Originalpost samt Benutzername -- das wuerde die
# Anonymisierung (kein Benutzername/Profil-Link wird gespeichert, siehe
# parse_rows) aushebeln.
#
# WICHTIG: Ein Hash allein ist nur ein halber Schutz, wenn die IDs kleine,
# fortlaufende Ganzzahlen sind (typisch fuer Forums-Objekt-IDs) -- ohne
# geheimes Salt koennte jemand einfach alle plausiblen IDs (z.B. 1 bis
# 1.000.000) durchhashen und mit den veroeffentlichten Hashes abgleichen
# ("Rainbow Table" fuer einen kleinen Zahlenraum ist trivial). Deshalb wird
# hier ein Salt aus der Umgebungsvariable ID_HASH_SALT gelesen -- als
# GitHub-Actions-Repository-Secret gesetzt, taucht es NIE im oeffentlichen
# Repo auf (siehe publish.yml). Ohne gesetztes Secret greift ein fester
# Standard-Salt: besser als Klartext (verhindert zufaelliges Wiedererkennen/
# Verlinken), schuetzt aber nicht vor einem gezielten Angriff. Fuer echten
# Schutz das Secret in den Repo-Einstellungen anlegen.
_ID_SALT = os.environ.get("ID_HASH_SALT") or "elroq-enyaq-dashboard-bitte-eigenes-secret-setzen"


def hash_id(raw_id):
    """Verwandelt eine rohe Forums-ID in einen nicht umkehrbaren Bezeichner.
    Deterministisch -- interne Vergleiche (Duplikat-Erkennung, Selbst-
    Ausschluss in der Aehnlichkeitsberechnung) funktionieren unveraendert
    weiter, da dieselbe rohe ID immer denselben Hash ergibt."""
    if not raw_id:
        return raw_id
    return hashlib.sha256(f"{_ID_SALT}:{raw_id}".encode("utf-8")).hexdigest()[:16]


def parse_rows(soup):
    """
    Liest die Bestellzeilen einer Seite.

    Zeilen mit der Klasse 'carOrderDeliveryDone' gelten als ausgeliefert
    (entspricht dem Forums-Filter 'Auslieferung erfolgt'), alle uebrigen als
    offen. Stornierte Bestellungen (Klasse 'carOrderCanceled') wurden frueher
    komplett verworfen -- dabei markiert das Forum sie bereits explizit als
    solche. Sie werden jetzt mit erfasst (als eigener Status, siehe main()),
    damit die Stornierungsquote im Methodik-Panel auf einer echten Beobachtung
    beruht statt auf der Vermutung "aus dem Log verschwunden = wahrscheinlich
    storniert". Als Nebeneffekt laesst sich damit spaeter pruefen, ob
    besonders lange Wartezeiten das Stornierungsrisiko erhoehen -- bisher nur
    eine Annahme in der Datenqualitaets-Warnung, nie an echten Daten geprueft.

    Die ausgelieferten Bestellungen bilden die statistische Basis; die offenen
    werden gebraucht, damit Nutzer ihre eigene laufende Bestellung
    nachschlagen koennen.
    """
    out = []
    for tr in soup.select("tbody tr[data-object-id]"):
        classes = tr.get("class", [])
        storniert = "carOrderCanceled" in classes
        delivered = "carOrderDeliveryDone" in classes

        tds = tr.find_all("td")
        if len(tds) < 10:
            continue

        def first_date(cell):
            txt = clean(cell.get_text(" "))
            m = re.search(r"\d{1,2}\.\s*[A-Za-zÄäÖöÜü]+\s*\d{4}", txt)
            return m.group(0) if m else ""

        # Das Bestelldatum-Feld kann zusaetzlich ein "Neu"-Badge enthalten.
        bestelldatum = first_date(tds[1])
        lieferdatum = first_date(tds[2])
        voraus = first_date(tds[8])

        # Das Land steckt im alt-Attribut der Flaggengrafik.
        img = tds[3].find("img")
        land = img.get("alt", "") if img else clean(tds[3].get_text())

        # Datenminimierung (DSGVO Art. 5 Abs. 1 lit. c): Der Benutzername und
        # der Profil-Link stehen zwar in der Forumstabelle, werden hier aber
        # bewusst NICHT erfasst. Sie sind fuer Statistik und Prognose nicht
        # erforderlich, wuerden aber personenbezogene Daten in einem oeffentlich
        # publizierten Dashboard erzeugen. tds[4] wird daher komplett ignoriert.

        out.append({
            "ID": hash_id(tr.get("data-object-id", "")),
            "Ausgeliefert": delivered,
            "Storniert": storniert,
            "Bestelldatum": bestelldatum,
            "Lieferdatum": lieferdatum,
            "Land": land,
            "Modell": clean(tds[5].get_text()),
            "Farbe": clean(tds[6].get_text()),
            "Ausstattung": clean(tds[7].get_text(" ")),
            "VorausLieferdatum": voraus,
            "Wartezeit": clean(tds[9].get_text(" ")),
        })
    return out


def parse_de_date(s):
    """'28. Mai 2026' -> date. Gibt None zurueck, wenn nicht lesbar."""
    if not s:
        return None
    m = re.match(r"\s*(\d{1,2})\.\s*([A-Za-zÄäÖöÜü]+)\s*(\d{4})", s)
    if not m:
        return None
    day, month_name, year = m.groups()
    month = MONTHS.get(month_name.lower())
    if not month:
        return None
    try:
        return date(int(year), month, int(day))
    except ValueError:
        return None


def waiting_days(s):
    m = re.search(r"(\d+)", s or "")
    return int(m.group(1)) if m else None


# --------------------------------------------------------------------------
# 2b. Modellnamen vereinheitlichen
# --------------------------------------------------------------------------
# Der Enyaq hat eine deutlich groessere Modellpalette als der Elroq: zwei
# Karosserieformen (normal / Coupe), mehrere Akku-/Antriebsstufen (50, 60,
# 80, 80x, 85, 85x), die Topversion RS (auch als Coupe), dazu Sondermodelle
# wie "Founders Edition". Ausstattungslinien sind Essence, Selection,
# Sportline und L&K (Laurin & Klement) — letztere gibt es beim Elroq nicht.
#
# Gruppierung erfolgt nach Karosserie + Akku-/Antriebsstufe, weil das den
# groessten Einfluss auf die Produktionsplanung hat:
#   Enyaq 50 / 60 / 80 / 80x / 85 / 85x / RS
#   Enyaq Coupe 60 / 80 / 80x / 85 / 85x / RS
#   Enyaq Founders Edition (eigene Gruppe, kein Akku-Suffix im Namen)

def model_group(modell):
    """Leitet Karosserie + Antriebsvariante aus dem Modellnamen ab."""
    t = (modell or "").lower()
    prefix = "Enyaq Coupe" if "coupe" in t else "Enyaq"
    if "founders edition" in t:
        return "Enyaq Founders Edition"
    if re.search(r"\brs\b", t):
        return f"{prefix} RS"
    m = re.search(r"\b(50|60|80|85)(x)?\b", t)
    if m:
        return f"{prefix} {m.group(1)}{m.group(2) or ''}"
    return f"{prefix} Sonstige"


def trim_line(modell):
    """Leitet die Ausstattungslinie aus dem Modellnamen ab."""
    t = (modell or "").lower()
    if "founders edition" in t:
        return "Founders Edition"
    if "l&k" in t or "laurin" in t:
        return "L&K"
    if "sportline" in t:
        return "Sportline"
    if "selection" in t:
        return "Selection"
    if "essence" in t:
        return "Essence"
    if re.search(r"\brs\b", t):
        return "RS"
    return "ohne Linienangabe"


# --------------------------------------------------------------------------
# 3. Harmonisierung der Freitext-Ausstattung
# --------------------------------------------------------------------------

DESIGN_SELECTIONS = [
    ("RS Lounge", r"rs\s*lounge"),
    ("RS Suite", r"rs\s*suite"),
    ("L&K Shell", r"l\s*&\s*k\s*shell"),
    ("ecoSuite", r"eco[\s-]?suite"),
    ("Suite", r"\bsuite\b"),
    ("Lodge", r"\blodge\b"),
    ("Loft", r"\bloft\b"),
    ("Studio", r"\bstudio\b"),
]

BOOL_PATTERNS = {
    "Paket_Smart": r"\bsmart\b",
    "Paket_Clever": r"clever",
    "Paket_Advanced": r"advance",
    "Paket_Maxx": r"\bmaxx?\b",
    "Paket_Plus": r"\bplus\b",
    # Wortgrenze vorn, damit "Transportpaket" nicht als Sport zaehlt.
    "Paket_Sport": r"\bsport(?!line)",
    "Paket_Winter": r"winter",
    "Paket_Transport": r"transport",
    "Paket_Drive": r"\bdrive\b",
    "Paket_Jubilaeum130Jahre": r"jubil[aä]um|130\s*jahre",
    "Anhaengerkupplung_AHK": r"\bahk\b|anh[aä]nger(kupplung|zugvorrichtung)|anh[aä]ngekupplung|\bazv\b",
    "Waermepumpe": r"w[aä]rmepumpe|\bwp\b",
    "DCC_AdaptivesFahrwerk": r"\bdcc\b|adaptive[sn]?\s*fahrwerk",
    "Dachkontrastlackierung": r"dachkontrast",
    "Gepaecknetztrennwand": r"gep[aä]ck\s*netz|netztrennwand|gep[aä]cktrennwand",
    "Ganzjahresreifen": r"ganzjahresreifen",
    "MatrixLED": r"matrix",
    "Garantieverlaengerung": r"garantie",
    "Vollausstattung_Selbstangabe": r"vollausstattung|volle h[uü]tte|mit allem",
}

WHEEL_NAMES = ["proteus", "vega", "neptune", "draconis", "regulus",
               "supernova", "vision"]

# Erkennt Verneinungen wie "Keine Wärmepumpe!" oder "AHK, aber ohne Winterpaket",
# damit solche Formulierungen nicht faelschlich als "Ja" gewertet werden. Nur
# der Text seit dem letzten Trennzeichen (Komma, Punkt, Klammer, ...) zaehlt
# als "gleiche Klausel" — so bleibt z.B. "Maxx, keine Wärmepumpe" bei Maxx=Ja.
_NEGATION_WORDS = ("kein", "keine", "keinen", "keiner", "keinem", "nicht", "ohne")
_CLAUSE_DELIMS = (",", ";", ".", "(", ")", "\n", "/", "|", "-", "–")


def _is_negated(text, start, end):
    window_start = max(0, start - 30)
    preceding = text[window_start:start]
    for delim in _CLAUSE_DELIMS:
        idx = preceding.rfind(delim)
        if idx != -1:
            preceding = preceding[idx + 1:]
    if any(re.search(rf"\b{w}\b", preceding) for w in _NEGATION_WORDS):
        return True

    following = text[end:end + 12]
    if re.match(r"\s*[:\-–]?\s*nein\b", following):
        return True

    return False


def harmonize(text):
    """Zerlegt den Ausstattungs-Freitext in strukturierte Merkmale."""
    result = {"Innenausstattung_DesignSelection": "",
              "Felgengroesse_Zoll": "", "Felgenname": ""}
    result.update({k: "Nein" for k in BOOL_PATTERNS})

    if not text:
        return result

    t = text.lower()

    for name, pattern in DESIGN_SELECTIONS:
        if re.search(pattern, t):
            result["Innenausstattung_DesignSelection"] = name
            break

    for key, pattern in BOOL_PATTERNS.items():
        m = re.search(pattern, t)
        if m and not _is_negated(t, m.start(), m.end()):
            result[key] = "Ja"

    m = re.search(r"\b(1[6-9]|2[0-1])\s*(?:\"|''|zoll|“|″|')", t)
    if m:
        result["Felgengroesse_Zoll"] = m.group(1)

    for w in WHEEL_NAMES:
        if w in t:
            result["Felgenname"] = w.capitalize()
            break

    return result


# --------------------------------------------------------------------------
# 4. Ausreisser
# --------------------------------------------------------------------------

def quantile(sorted_vals, q):
    """Lineare Interpolation, entspricht dem Standardverfahren von pandas."""
    if not sorted_vals:
        return 0.0
    pos = (len(sorted_vals) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def outlier_bounds(values):
    """
    Untere Grenze: 5. Perzentil (die Verteilung hat unten einen langen,
    duennen Auslaeufer, den die IQR-Regel nicht erfasst).
    Obere Grenze: klassische IQR-Regel (Q3 + 1.5 * IQR).
    """
    vals = sorted(values)
    q1, q3 = quantile(vals, 0.25), quantile(vals, 0.75)
    return quantile(vals, 0.05), q3 + 1.5 * (q3 - q1)


# --------------------------------------------------------------------------
# 4b. Liefer-Prognose (Python-Gegenstueck zur Live-Berechnung im Dashboard)
# --------------------------------------------------------------------------
# Diese Funktion muss dieselbe Logik verwenden wie predict() in app.js, damit
# eine geloggte Prognose spaeter nachvollziehbar bleibt.

def weighted_quantile(pairs, q):
    """
    Gewichtetes Perzentil nach der Midpoint-/Hazen-Methode: jeder Punkt
    repraesentiert sein Gewicht, zentriert auf die Mitte seiner kumulativen
    Gewichtsmasse. Bei gleichen Gewichten entspricht das Ergebnis exakt der
    normalen (ungewichteten) Quantilberechnung von quantile() oben.
    """
    pairs = sorted(pairs, key=lambda p: p[0])
    total = sum(w for _, w in pairs)
    if total <= 0:
        return 0.0
    target = q * total
    running = 0.0
    midpoints = []
    for v, w in pairs:
        midpoints.append((running + w / 2, v))
        running += w
    if target <= midpoints[0][0]:
        return midpoints[0][1]
    if target >= midpoints[-1][0]:
        return midpoints[-1][1]
    for i in range(1, len(midpoints)):
        m_prev, v_prev = midpoints[i - 1]
        m_cur, v_cur = midpoints[i]
        if target <= m_cur:
            span = m_cur - m_prev
            frac = (target - m_prev) / span if span > 0 else 0
            return v_prev + (v_cur - v_prev) * frac
    return midpoints[-1][1]


_BOOL_KEYS = list(BOOL_PATTERNS.keys())

# See elroq_dashboard_update.py for the full rationale: a statistical pass
# (t-test on delivered orders) found that only Waermepumpe clears both a
# significance and a minimum-sample bar; the other 17 (now 18, see below)
# add noise rather than signal to the similarity/backtest match, so they're
# excluded here even though BOOL_PATTERNS keeps parsing all 19 for data
# completeness. Paket_Jubilaeum130Jahre was kept here too until now (it did
# clear the bar), but the package has since been discontinued by Skoda, so
# matching on it no longer means anything for current/future orders. The
# same key is used for Elroq to keep the shared frontend (template_app.js)
# and the two vehicles' prediction logic consistent.
_SIMILARITY_BOOL_KEYS = ["Waermepumpe"]

# Wird bei jedem Build von backtest.evaluate_censoring_correction() gesetzt:
# schaltet die Kaplan-Meier-Korrektur der Survivorship-Verzerrung nur dann
# ein, wenn sie fuer den aktuellen Datenbestand nachweislich hilft
# (Details siehe predict_delivery() und backtest.py).
_CENSORING_CORRECTION = False

# Wird bei jedem Build von backtest.calibrate_confidence_bands() gesetzt:
# Aufweitungsfaktor je Konfidenzband (50/80/95%), nur wenn per Rueckblick-Test
# auf nie gesehenen Daten bestaetigt (siehe predict_delivery()). 1.0 = keine
# Aenderung. Als Dict statt Einzelwert, da jedes Band unabhaengig getestet
# und aktiviert/verworfen wird.
_BAND_CALIBRATION = {"50": 1.0, "80": 1.0, "95": 1.0}


def _base_similarity(a, b):
    """
    0..1 Aehnlichkeit zweier Konfigurationen INNERHALB derselben Modellgruppe
    (die wird in predict_delivery() als harter Vorfilter behandelt, da
    Wartezeiten zwischen z.B. Elroq 60 und Elroq RS kaum vergleichbar sind).
    Land ist hier bewusst NICHT enthalten: das wird als eigener,
    datenmengen-abhaengiger Gewichtungsfaktor behandelt, siehe
    _country_weight() -- vorher war der Land-Abgleich ein harter Vorfilter
    mit Cutoff bei 15 Bestellungen, was bei 14 vs. 15 Datenpunkten zu einem
    abrupten Sprung in der Prognosebasis fuehrte (Optimierung 4).
    """
    score = max_score = 0.0

    def add(weight, ok):
        nonlocal score, max_score
        max_score += weight
        if ok:
            score += weight

    add(3, a.get("Modell") == b.get("Modell"))
    add(1, (a.get("Innenausstattung_DesignSelection") or "") ==
           (b.get("Innenausstattung_DesignSelection") or ""))
    add(1, (a.get("Felgenname") or "") == (b.get("Felgenname") or ""))
    for k in _SIMILARITY_BOOL_KEYS:
        add(0.6, a.get(k) == b.get(k))
    return score / max_score if max_score else 0.0


# Exponentieller Zerfall statt hartem 180-Bestellungen-Fenster (Optimierung 3):
# eine Referenz von vor 120 Tagen zaehlt nur noch halb so stark wie eine von
# heute, statt ab einer festen Position abrupt auf 0 zu fallen. Das macht die
# Prognose weniger abhaengig davon, ob das Bestellvolumen gerade hoch oder
# niedrig war (bei niedrigem Volumen deckte das alte 180er-Fenster teils
# ueber ein Jahr ab, bei hohem Volumen nur wenige Wochen).
_RECENCY_HALFLIFE_DAYS = 120.0


def _recency_weight(delta_days):
    return 0.5 ** (abs(delta_days) / _RECENCY_HALFLIFE_DAYS)


# Weicher Shrinkage-Faktor statt hartem Cutoff bei 15 Bestellungen
# (Optimierung 4): der Bonus fuer eine Landes-Uebereinstimmung waechst
# graduell mit der verfuegbaren Datenmenge fuer dieses Land. Bei wenigen
# Bestellungen aus einem Land ist der Bonus klein (zu wenig Beweiskraft),
# bei vielen naehert er sich dem vollen Boost an -- kein Sprung mehr zwischen
# 14 und 15 Bestellungen.
_COUNTRY_CREDIBILITY_K = 15.0
_COUNTRY_BOOST = 1.8


def _country_weight(same_country, country_pool_size):
    if not same_country:
        return 1.0
    credibility = country_pool_size / (country_pool_size + _COUNTRY_CREDIBILITY_K)
    return 1.0 + credibility * _COUNTRY_BOOST


# Frueher stand hier _trend_slope_per_day() fuer eine lineare Trend-
# Korrektur ("Optimierung 1"). Der Rueckblick-Test (backtest.py) zeigte,
# dass sie die Prognose ueber die volle Historie systematisch verschlechtert
# (Boom-Bust-Verlauf der Wartezeit, siehe Kommentar in predict_delivery()) --
# daher entfernt, nicht nur deaktiviert.


def _queue_estimate(order, delivered, open_orders, now_ts,
                     min_throughput_samples=6, throughput_window_days=60):
    """
    Warteschlangen-Tiefe / Durchsatz-Schaetzung (Optimierung 2): wie viele
    Bestellungen derselben Modellgruppe waren zum Bestelldatum noch nicht
    ausgeliefert ("vor" dieser Bestellung in der Schlange), und wie schnell
    wird diese Schlange aktuell abgearbeitet? ETA = Tiefe / Durchsatz. Das
    reagiert sofort auf Produktionsaenderungen, waehrend der Vergangenheits-
    vergleich erst nachzieht, sobald genug neue Auslieferungen durch sind.
    Gibt (eta_days, confidence) zurueck; confidence ist 0, wenn zu wenige
    aktuelle Auslieferungen fuer eine verlaessliche Durchsatz-Schaetzung
    vorliegen. confidence ist bewusst niedrig gedeckelt (siehe
    predict_delivery()): Fahrzeugproduktion laeuft nicht strikt nach dem
    Prinzip "frueher bestellt = frueher geliefert", daher ist dies nur ein
    unterstuetzender Signal, kein Ersatz fuer den Vergleichsansatz.
    """
    order_ts = order["BestelldatumTS"]
    group = order.get("Modellgruppe")
    order_id = order.get("ID")

    segment_delivered = [r for r in delivered if r.get("Modellgruppe") == group]
    segment_open = [r for r in open_orders if r.get("Modellgruppe") == group]

    queue_depth = 0
    for r in segment_delivered:
        if r.get("ID") == order_id:
            continue
        if r["BestelldatumTS"] >= order_ts:
            continue
        clear_ts = r["BestelldatumTS"] + r["WartezeitTage"] * DAY_MS
        if clear_ts > order_ts:
            queue_depth += 1
    for r in segment_open:
        if r.get("ID") == order_id:
            continue
        if r["BestelldatumTS"] < order_ts:
            queue_depth += 1

    window_start = now_ts - throughput_window_days * DAY_MS
    recent_deliveries = [
        r for r in segment_delivered
        if window_start <= (r["BestelldatumTS"] + r["WartezeitTage"] * DAY_MS) <= now_ts
    ]
    n_recent = len(recent_deliveries)
    if n_recent < min_throughput_samples:
        return None, 0.0

    throughput_per_day = n_recent / throughput_window_days
    if throughput_per_day <= 0:
        return None, 0.0

    eta_days = queue_depth / throughput_per_day
    confidence = min(0.25, n_recent / 60.0)
    return eta_days, confidence


def predict_delivery(order, delivered, open_orders, now_ts):
    """
    Schaetzt die Wartezeit einer offenen Bestellung. Kombiniert vier
    Bausteine:
      1. Gewichteter Quantil-Vergleich gegen aehnliche, ausgelieferte
         Bestellungen derselben Modellgruppe (Gewicht = Konfigurations-
         aehnlichkeit x Aktualitaet x Landes-Bonus, siehe _base_similarity/
         _recency_weight/_country_weight) statt fester Tiers und hartem
         Cutoff.
      2. Trend-Korrektur auf Basis der linearen Regression der monatlichen
         Ø-Wartezeit (Optimierung 1).
      3. Weiche Aktualitaets-Gewichtung statt hartem 180er-Fenster
         (Optimierung 3).
      4. Weicher Landes-Bonus statt hartem Cutoff bei 15 Bestellungen
         (Optimierung 4).
      Plus als unterstuetzendes Signal: eine Warteschlangen-Schaetzung
      (Optimierung 2), die nur eingemischt wird, wenn sie nicht drastisch
      vom Vergleichswert abweicht (Produktion laeuft nicht strikt FIFO).
    Gibt None zurueck, wenn selbst der Modellgruppen-Pool zu klein ist.
    """
    order_ts = order["BestelldatumTS"]
    group = order.get("Modellgruppe")
    order_land = order.get("Land") or ""

    pool = [r for r in delivered if r.get("Modellgruppe") == group]
    if len(pool) < 5:
        return None

    country_pool_size = sum(1 for r in pool if (r.get("Land") or "") == order_land)

    weighted = []
    for r in pool:
        base = _base_similarity(order, r)
        same_country = (r.get("Land") or "") == order_land
        if base <= 0 and not same_country:
            continue  # komplett unaehnliche Konfiguration UND anderes Land
        rec_w = _recency_weight((order_ts - r["BestelldatumTS"]) / DAY_MS)
        country_w = _country_weight(same_country, country_pool_size)
        # Bodenwert 0.05: Modellgruppen-Zugehoerigkeit allein zaehlt schon
        # etwas, auch wenn sonst nichts uebereinstimmt.
        w = max(base, 0.05) * rec_w * country_w
        weighted.append((r["WartezeitTage"], w, r))

    if not weighted:
        return None

    vals_weights = [(v, w) for v, w, _ in weighted]
    total_weight = sum(w for _, w in vals_weights)
    eff_n = (total_weight ** 2) / sum(w * w for _, w in vals_weights) if vals_weights else 0

    median = weighted_quantile(vals_weights, 0.5)
    p25 = weighted_quantile(vals_weights, 0.25)
    p75 = weighted_quantile(vals_weights, 0.75)
    p10 = weighted_quantile(vals_weights, 0.10)
    p90 = weighted_quantile(vals_weights, 0.90)
    p2_5 = weighted_quantile(vals_weights, 0.025)
    p97_5 = weighted_quantile(vals_weights, 0.975)

    # ---- "Optimierung 1" (Trend-Korrektur) -- per Rueckblick-Test verworfen ----
    # Eine fruehere Version dieser Funktion korrigierte den gewichteten Median
    # um eine lineare Regression der monatlichen Ø-Wartezeit, um den Trend
    # nachzuziehen. Der Rueckblick-Test (siehe backtest.py, run_backtest())
    # zeigt aber eindeutig: ueber die volle Historie betrachtet macht JEDE
    # Staerke dieser Korrektur die Prognose schlechter, nicht besser (MAE
    # stieg von 63.9 auf bis zu 95.2 Tage, selbst mit Daempfung und Kappung).
    # Grund: Die Wartezeit durchlief einen Boom-Bust-Zyklus (kurze Wartezeit
    # zu Beginn -> Rueckstau-Aufbau -> Kapazitaets-Aufholung); eine rueckwaerts
    # geschaetzte lineare Steigung liegt an solchen Trendwenden systematisch
    # falsch, und diese Wenden lassen sich aus der Historie allein nicht
    # zuverlaessig vorhersehen. Isoliert getestet lieferten Rezenz-Gewichtung
    # + Land-Shrinkage + Warteschlangen-Schaetzung dagegen zuverlaessig gute
    # bis leicht bessere Werte als der alte, hart geschnittene Ansatz. Die
    # Trend-Korrektur bleibt deshalb bewusst ausgeschaltet.
    median_tc = median
    p25_tc, p75_tc = p25, p75
    p10_tc, p90_tc = p10, p90
    p2_5_tc, p97_5_tc = p2_5, p97_5

    # ---- Optimierung 5: Korrektur der Survivorship-Verzerrung ----
    # Der Vergleichs-Pool enthaelt nur BEREITS ausgelieferte Bestellungen.
    # Die langsamen sind zum Vorhersage-Zeitpunkt noch offen und fehlen damit
    # systematisch, wodurch der Pool schneller aussieht als die Wirklichkeit.
    # Empirisch gemessen betrug diese Luecke im Median 54 Tage -- und deckte
    # sich damit fast exakt mit der zuvor unerklaerten systematischen
    # Unterschaetzung von rund +40 Tagen im Rueckblick-Test.
    # Kaplan-Meier rechnet die noch offenen Bestellungen korrekt als
    # rechtszensierte Beobachtungen mit ("wartet bereits N Tage, dauert also
    # laenger als N") und liefert daraus einen erwartungstreuen Median.
    # Out-of-sample geprueft (juengere 40% der Historie, Elroq):
    #   ohne Korrektur : MAE 60.3, Bias +38.3, 10.0% innerhalb 14 Tagen
    #   mit Korrektur  : MAE 45.6, Bias  +5.6, 15.9% innerhalb 14 Tagen
    # Bewusst ohne jeden angepassten Faktor -- die Verschiebung ergibt sich
    # allein aus den Daten. Eine fest eingestellte Konstante (+40 Tage) schnitt
    # out-of-sample sogar schlechter ab (MAE 46.9) und waere zudem an genau
    # eine Marktphase angepasst gewesen.
    # Ob die Korrektur aktiv ist, entscheidet _CENSORING_CORRECTION -- gesetzt
    # bei jedem Build von backtest.evaluate_censoring_correction(), da sie
    # nicht fuer jeden Datenbestand ein Gewinn ist (siehe dortiger Kommentar).
    if _CENSORING_CORRECTION and open_orders:
        shift = backtest.censoring_shift(delivered, open_orders, now_ts)
        if shift:
            median_tc += shift
            p25_tc += shift; p75_tc += shift
            p10_tc += shift; p90_tc += shift
            p2_5_tc += shift; p97_5_tc += shift

    # ---- Optimierung 2: Warteschlangen-Schaetzung als gedaempftes Zusatzsignal ----
    queue_eta, queue_conf = _queue_estimate(order, delivered, open_orders, now_ts)
    if queue_eta is not None and queue_conf > 0:
        relative_divergence = abs(queue_eta - median_tc) / max(median_tc, 1)
        damped_conf = queue_conf / (1 + relative_divergence ** 2)
        blend_delta = damped_conf * (queue_eta - median_tc)
        median_tc += blend_delta
        p25_tc += blend_delta; p75_tc += blend_delta
        p10_tc += blend_delta; p90_tc += blend_delta
        p2_5_tc += blend_delta; p97_5_tc += blend_delta

    # ---- Konfidenzband-Kalibrierung ----
    # Per Rueckblick-Test gemessen: das 50%-Band traf die tatsaechliche
    # Wartezeit nur in ~34-45% statt der versprochenen 50% -- unabhaengig
    # vom Median-Fehler, ein eigenstaendiges Genauigkeitsproblem (falsche
    # Sicherheit statt falscher Punktwert). _BAND_CALIBRATION wird bei jedem
    # Build von backtest.calibrate_confidence_bands() neu bestimmt und nur
    # je Band aktiviert, wenn die Aufweitung sich auf nie gesehenen Daten
    # nachweislich verbessert (siehe dortiger Kommentar) -- bei einer
    # Bisektion auf der aelteren Historie zeigte sich fuer 50%/80% echte
    # zeitliche Instabilitaet: der gefittete Faktor verschlechterte die
    # Kalibrierung auf juengeren Daten, wurde also zurecht verworfen.
    def _widen(median, lo, hi, band_key):
        scale = _BAND_CALIBRATION.get(band_key, 1.0)
        if scale == 1.0:
            return lo, hi
        return median - (median - lo) * scale, median + (hi - median) * scale

    p25_tc, p75_tc = _widen(median_tc, p25_tc, p75_tc, "50")
    p10_tc, p90_tc = _widen(median_tc, p10_tc, p90_tc, "80")
    p2_5_tc, p97_5_tc = _widen(median_tc, p2_5_tc, p97_5_tc, "95")

    median_tc = max(0, median_tc)

    def date_for(d):
        return order_ts + d * DAY_MS

    if country_pool_size >= _COUNTRY_CREDIBILITY_K:
        tier_label = "gewichtete Referenzen (Land stark einbezogen)"
    elif eff_n >= 20:
        tier_label = "viele gewichtete Referenzen"
    elif eff_n >= 8:
        tier_label = "einige gewichtete Referenzen"
    else:
        tier_label = "wenige gewichtete Referenzen"

    era_from = min(r["BestelldatumTS"] for _, _, r in weighted)
    era_to = max(r["BestelldatumTS"] for _, _, r in weighted)
    top_refs = sorted(weighted, key=lambda x: -x[1])[:12]

    return {
        "median": round(median_tc), "p25": round(max(0, p25_tc)), "p75": round(max(0, p75_tc)),
        "p10": round(max(0, p10_tc)), "p90": round(max(0, p90_tc)),
        "p2_5": round(max(0, p2_5_tc)), "p97_5": round(max(0, p97_5_tc)),
        "count": len(weighted),
        "tier_label": tier_label,
        "era_from": era_from, "era_to": era_to,
        "date_median": date_for(median_tc),
        "date_early": date_for(p25_tc), "date_late": date_for(p75_tc),
        "date_p10": date_for(p10_tc), "date_p90": date_for(p90_tc),
        "date_p2_5": date_for(p2_5_tc), "date_p97_5": date_for(p97_5_tc),
        "refs": [{"Land": r.get("Land", ""), "WartezeitTage": r["WartezeitTage"]} for _, _, r in top_refs],
        "country_scoped": country_pool_size >= _COUNTRY_CREDIBILITY_K,
    }


def load_log():
    if not LOG_PATH.exists():
        return {}
    try:
        return json.loads(LOG_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        print(f"Warnung: {LOG_PATH.name} konnte nicht gelesen werden — starte neues Log.")
        return {}


def save_log(log):
    LOG_PATH.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")


def _apply_prediction(entry, p, prefix=""):
    """
    Schreibt eine Prognose in einen Log-Eintrag. Mit prefix="" landet sie in
    den "Predicted*"-Feldern (aktueller Stand, wird bei offenen Bestellungen
    jeden Lauf neu berechnet). Mit prefix="Original" landet sie in den
    "OriginalPredicted*"-Feldern (einmalig beim ersten Erfassen eingefroren,
    danach nie wieder veraendert — Basis fuer die Genauigkeits-Messung und
    die "Prognose-Historie"-Anzeige bei ausgelieferten Bestellungen).
    """
    if p:
        entry[f"{prefix}PredictedDate"] = p["date_median"]
        entry[f"{prefix}PredictedRangeLowDate"] = p["date_early"]
        entry[f"{prefix}PredictedRangeHighDate"] = p["date_late"]
        entry[f"{prefix}PredictedP10Date"] = p.get("date_p10")
        entry[f"{prefix}PredictedP90Date"] = p.get("date_p90")
        entry[f"{prefix}PredictedP2_5Date"] = p.get("date_p2_5")
        entry[f"{prefix}PredictedP97_5Date"] = p.get("date_p97_5")
        entry[f"{prefix}PredictedMedianDays"] = p["median"]
        entry[f"{prefix}PredictedRangeLowDays"] = p["p25"]
        entry[f"{prefix}PredictedRangeHighDays"] = p["p75"]
        entry[f"{prefix}PredictedP10Days"] = p.get("p10")
        entry[f"{prefix}PredictedP90Days"] = p.get("p90")
        entry[f"{prefix}PredictedP2_5Days"] = p.get("p2_5")
        entry[f"{prefix}PredictedP97_5Days"] = p.get("p97_5")
        entry[f"{prefix}ReferenceCount"] = p["count"]
        entry[f"{prefix}ReferenceQualityLabel"] = p["tier_label"]
        entry[f"{prefix}ReferenceEraFrom"] = p["era_from"]
        entry[f"{prefix}ReferenceEraTo"] = p["era_to"]
        entry[f"{prefix}References"] = p["refs"]
        entry[f"{prefix}CountryScoped"] = p.get("country_scoped", True)
    else:
        entry[f"{prefix}PredictedDate"] = None
        entry[f"{prefix}PredictedMedianDays"] = None
        entry[f"{prefix}ReferenceCount"] = 0
        entry[f"{prefix}References"] = []
        entry[f"{prefix}CountryScoped"] = None


_PREDICTION_FIELD_KEYS = (
    "PredictedDate", "PredictedRangeLowDate", "PredictedRangeHighDate",
    "PredictedP10Date", "PredictedP90Date", "PredictedP2_5Date", "PredictedP97_5Date",
    "PredictedMedianDays", "PredictedRangeLowDays", "PredictedRangeHighDays",
    "PredictedP10Days", "PredictedP90Days", "PredictedP2_5Days", "PredictedP97_5Days",
    "ReferenceCount", "ReferenceQualityLabel", "ReferenceEraFrom",
    "ReferenceEraTo", "References", "CountryScoped",
)


def update_prediction_log(log, delivered, open_orders, cancelled, now_ts):
    """
    Aktualisiert das Prognose-Log:
      - neue offene Bestellungen bekommen eine Erstprognose, die zusaetzlich
        als "Original*"-Version dauerhaft eingefroren wird
      - ALLE noch offenen Bestellungen bekommen bei jedem Lauf eine frisch
        berechnete Prognose ("Predicted*"), die mit wachsendem Datenbestand
        praeziser wird — die eingefrorene "Original*"-Prognose bleibt davon
        unberuehrt
      - offene Bestellungen, die inzwischen ausgeliefert wurden, werden mit
        dem tatsaechlichen Ergebnis aufgeloest; die Abweichung wird gegen die
        eingefrorene ORIGINAL-Prognose gemessen, nicht gegen die zuletzt
        berechnete — sonst waere die Genauigkeits-Messung nicht mehr fair
      - offene Bestellungen, die inzwischen als storniert erkannt wurden
        (Forums-Klasse carOrderCanceled), werden als "storniert" aufgeloest —
        vorher gab es dafuer keine eigene Kategorie, eine stornierte
        Bestellung landete ununterscheidbar im Topf "entfernt" (Grund
        unbekannt). Weil LoggedAt (erstes Sichten als offen) und ResolvedAt
        (Sichten als storniert) beide vorhanden sind, ergibt sich daraus mit
        der Zeit ganz nebenbei ein echter Datensatz "wie lange gewartet, bevor
        storniert wurde" -- bisher nur eine unbelegte Vermutung im
        Datenqualitaets-Hinweis.
      - offene Bestellungen, die aus anderem Grund verschwunden sind (z.B.
        Forums-Bereinigung, Darstellungsfehler), werden weiterhin als
        "entfernt" (Grund unbekannt) markiert -- dieser Topf sollte durch die
        obige Praezisierung nun deutlich kleiner werden
      - Log-Eintraege von VOR diesem Update (denen die "Original*"-Felder
        noch fehlen) werden einmalig migriert, siehe
        _migrate_add_original_snapshot unten
    Gibt (neu_geloggt, neu_aufgeloest, neu_berechnet, original_migriert) zurueck.
    """
    delivered_by_id = {r["ID"]: r for r in delivered}
    open_by_id = {r["ID"]: r for r in open_orders}
    cancelled_by_id = {r["ID"]: r for r in cancelled}

    new_logged = resolved_now = 0

    # Einmalige Migrationen: rohe IDs auf den gehashten Schluessel umziehen
    # (siehe hash_id()), danach alten Eintraegen die "Original*"-Felder
    # nachtragen.
    ids_migrated = _migrate_hash_ids(log)
    original_migrated = _migrate_add_original_snapshot(log)

    # Bereits offene Log-Eintraege pruefen: ausgeliefert, storniert oder
    # anderweitig verschwunden?
    for lid, entry in log.items():
        if entry.get("Status") != "offen":
            continue
        if lid in delivered_by_id:
            d = delivered_by_id[lid]
            entry["Status"] = "eingetroffen"
            entry["ResolvedAt"] = now_ts
            entry["ActualDate"] = d.get("Lieferdatum", "")
            entry["ActualWaitDays"] = d["WartezeitTage"]
            baseline = entry.get("OriginalPredictedMedianDays")
            if baseline is not None:
                entry["DeviationDays"] = d["WartezeitTage"] - baseline
            community_days = entry.get("CommunityEstimateDays")
            if community_days is not None:
                entry["CommunityEstimateDeviationDays"] = d["WartezeitTage"] - community_days
            resolved_now += 1
        elif lid in cancelled_by_id:
            entry["Status"] = "storniert"
            entry["ResolvedAt"] = now_ts
        elif lid not in open_by_id:
            entry["Status"] = "entfernt"
            entry["ResolvedAt"] = now_ts

    # Fuer ALLE noch offenen Bestellungen die Prognose neu berechnen (neue wie
    # bereits bekannte) — je mehr ausgelieferte Bestellungen vorliegen, desto
    # praeziser wird die Schaetzung. Neue Bestellungen bekommen zusaetzlich
    # eine eingefrorene "Original*"-Kopie ihrer allerersten Prognose.
    recalculated = 0
    for oid, order in open_by_id.items():
        is_new = oid not in log
        if is_new:
            # The forum's own "voraussichtliches Lieferdatum" field (shown in
            # the UI as "Eigene Angabe im Forum") is only populated while an
            # order is open -- it gets cleared once delivered, so there is
            # currently no historical case where both this estimate AND the
            # real outcome are known, which means it can't be backtested yet.
            # Freezing it now (the same way OriginalPredicted* is frozen)
            # means that once enough of today's open orders resolve, we will
            # have a genuine paired dataset to test whether the community's
            # own estimate carries any signal our model doesn't already have
            # -- rather than guessing either way.
            community_days = None
            voraus_ts = parse_de_date(order.get("VorausLieferdatum", ""))
            if voraus_ts is not None and order.get("BestelldatumTS") is not None:
                voraus_ts_ms = int(datetime(voraus_ts.year, voraus_ts.month,
                                            voraus_ts.day).timestamp() * 1000)
                community_days = round((voraus_ts_ms - order["BestelldatumTS"]) / DAY_MS)
            log[oid] = {
                "ID": oid,
                "Modell": order.get("Modell", ""),
                "Modellgruppe": order.get("Modellgruppe", ""),
                "Bestelldatum": order.get("Bestelldatum", ""),
                "BestelldatumTS": order.get("BestelldatumTS"),
                "Status": "offen",
                "LoggedAt": now_ts,
                "ResolvedAt": None,
                "ActualDate": None,
                "ActualWaitDays": None,
                "DeviationDays": None,
                "CommunityEstimateDays": community_days,
                "CommunityEstimateDeviationDays": None,
            }
            new_logged += 1
        entry = log[oid]

        p = predict_delivery(order, delivered, open_orders, now_ts)
        _apply_prediction(entry, p, prefix="")
        if is_new:
            _apply_prediction(entry, p, prefix="Original")
        else:
            recalculated += 1

    personal_data_stripped = _migrate_strip_personal_data(log)
    return new_logged, resolved_now, recalculated, original_migrated, personal_data_stripped, ids_migrated


def _migrate_add_original_snapshot(log):
    """
    Einmalige Migration fuer Log-Eintraege von VOR diesem Update: ihnen fehlt
    die eingefrorene "Original*"-Prognose, weil es die Unterscheidung
    zwischen "aktueller" und "urspruenglicher" Prognose vorher nicht gab.

    Bis zu diesem Update wurde eine Prognose nach der Ersterfassung nie mehr
    veraendert — der zu diesem Zeitpunkt gespeicherte "Predicted*"-Wert
    entspricht also exakt der damaligen Erstprognose und kann 1:1 als
    "Original*"-Wert uebernommen werden, bevor die naechste Neuberechnung die
    "Predicted*"-Felder ueberschreibt.
    """
    migrated = 0
    for entry in log.values():
        if "OriginalPredictedMedianDays" in entry:
            continue
        for key in _PREDICTION_FIELD_KEYS:
            entry[f"Original{key}"] = entry.get(key)
        migrated += 1
    return migrated


def _migrate_strip_personal_data(log):
    """
    Einmalige Migration (DSGVO-Nachbesserung): entfernt Benutzername und
    Profil-Link aus alten Log-Eintraegen, die vor der Umstellung auf
    Datenminimierung erfasst wurden — sowohl auf oberster Ebene als auch aus
    den mitgeloggten Referenz-Bestellungen ("References"/"OriginalReferences").
    Wird bei jedem Lauf aufgerufen, ist danach ein No-Op sobald alles bereinigt ist.
    """
    stripped = 0
    personal_keys = ("Benutzername", "ProfilURL")
    ref_list_keys = ("References", "OriginalReferences")
    for entry in log.values():
        hit = False
        for key in personal_keys:
            if key in entry:
                del entry[key]
                hit = True
        for rk in ref_list_keys:
            for ref in entry.get(rk) or []:
                for key in personal_keys:
                    if key in ref:
                        del ref[key]
                        hit = True
        if hit:
            stripped += 1
    return stripped


def _migrate_hash_ids(log):
    """
    Einmalige Migration: bestehende Log-Eintraege waren unter der rohen
    Forums-ID (z.B. "12345") indiziert, da hash_id() erst nachtraeglich
    eingefuehrt wurde. Ordnet sie auf den gehashten Schluessel um, ohne
    Historie (eingefrorene Original-Prognosen, Aufloesungs-Status) zu
    verlieren. Heuristik: eine rohe Forums-ID besteht nur aus Ziffern, ein
    Hash (Hex-String) enthaelt mit hoher Wahrscheinlichkeit auch Buchstaben
    -- daher ist diese Migration nach einmaligem Durchlauf ein No-Op.
    """
    migrated = 0
    for old_key in list(log.keys()):
        if not old_key.isdigit():
            continue
        new_key = hash_id(old_key)
        if new_key == old_key or new_key in log:
            continue
        entry = log.pop(old_key)
        entry["ID"] = new_key
        log[new_key] = entry
        migrated += 1
    return migrated


def merge_log_into_records(log, delivered, open_orders):
    """
    Reichert die Ausgabe-Datensaetze mit den geloggten Prognosefeldern an.

    Bei noch offenen Bestellungen zeigt das Dashboard die AKTUELLE, bei jedem
    Lauf neu berechnete Prognose ("Predicted*") — die wird mit wachsendem
    Datenbestand praeziser. Bei bereits ausgelieferten Bestellungen zeigt es
    stattdessen die URSPRUENGLICHE, beim ersten Erfassen eingefrorene
    Prognose ("Original*"), denn nur gegen die laesst sich die tatsaechliche
    Wartezeit fair messen (Prognose-Historie + Genauigkeits-Auswertung im
    Dashboard). Die Feldnamen im Ausgabe-Datensatz bleiben in beiden Faellen
    gleich ("PredictedDate" usw.), damit das Frontend nicht unterscheiden
    muss, woher der Wert kommt.
    """
    for r in open_orders:
        entry = log.get(r["ID"])
        if not entry:
            continue
        for k in _PREDICTION_FIELD_KEYS:
            if k in entry:
                r[k] = entry[k]
        if "LoggedAt" in entry:
            r["LoggedAt"] = entry["LoggedAt"]

    resolved_extra = ("DeviationDays", "ResolvedAt", "ActualDate", "ActualWaitDays")
    for r in delivered:
        entry = log.get(r["ID"])
        if not entry or entry.get("Status") != "eingetroffen":
            continue
        for k in _PREDICTION_FIELD_KEYS:
            orig_key = f"Original{k}"
            if orig_key in entry:
                r[k] = entry[orig_key]
        if "LoggedAt" in entry:
            r["LoggedAt"] = entry["LoggedAt"]
        for k in resolved_extra:
            if k in entry:
                r[k] = entry[k]


# --------------------------------------------------------------------------
# 5. Dashboard bauen
# --------------------------------------------------------------------------

def build_dashboard(records, out_path, data_stand, delivered_count=None, methodology=None):
    if not TEMPLATE_HTML.exists() or not TEMPLATE_JS.exists():
        sys.exit(
            f"Vorlagen fehlen. Erwartet werden:\n"
            f"  {TEMPLATE_HTML}\n  {TEMPLATE_JS}\n"
            f"Sie muessen im selben Ordner wie dieses Skript liegen."
        )

    html = TEMPLATE_HTML.read_text(encoding="utf-8")
    app_js = TEMPLATE_JS.read_text(encoding="utf-8")
    data_json = json.dumps(records, ensure_ascii=False)
    methodology_json = json.dumps(methodology or {}, ensure_ascii=False)

    count = delivered_count if delivered_count is not None else len(records)
    html = (html
            .replace("__DATA_JSON__", data_json)
            .replace("__METHODOLOGY_JSON__", methodology_json)
            .replace("__APP_JS__", app_js)
            .replace("__DATA_STAND__", data_stand)
            .replace("__COUNT__", str(count))
            .replace("__BRAND_FORUM__", VEHICLE_FORUM_LABEL)
            .replace("__BRAND_NAME__", VEHICLE_NAME)
            .replace("__SWITCH_ELROQ_HREF__", SWITCH_SELF_HREF if VEHICLE_NAME == "Elroq" else SWITCH_OTHER_HREF)
            .replace("__SWITCH_ENYAQ_HREF__", SWITCH_SELF_HREF if VEHICLE_NAME == "Enyaq" else SWITCH_OTHER_HREF)
            .replace("__SWITCH_ELROQ_ACTIVE__", "active" if VEHICLE_NAME == "Elroq" else "")
            .replace("__SWITCH_ENYAQ_ACTIVE__", "active" if VEHICLE_NAME == "Enyaq" else ""))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")


def write_csv(records, path):
    import csv
    if not records:
        return
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(records[0].keys()))
        writer.writeheader()
        writer.writerows(records)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Baut das Enyaq Wartezeit-Dashboard aus Live-Forumsdaten.")
    ap.add_argument("--out", default="Enyaq_Wartezeit_Dashboard.html")
    ap.add_argument("--csv", default=None)
    ap.add_argument("--delay", type=float, default=1.5)
    ap.add_argument("--keep-outliers", action="store_true")
    ap.add_argument("--max-pages", type=int, default=50)
    args = ap.parse_args()

    session = requests.Session()

    print(f"Rufe {BASE_URL} ab ...")
    try:
        first = fetch_page(session, 1, args.delay)
    except requests.RequestException as e:
        sys.exit(f"Abruf fehlgeschlagen: {e}")

    total_pages = min(detect_total_pages(first), args.max_pages)
    print(f"{total_pages} Seiten gefunden.")

    by_id, rows = {}, parse_rows(first)
    for r in rows:
        by_id[r["ID"]] = r
    def page_note(rows):
        done = sum(1 for r in rows if r["Ausgeliefert"])
        storniert = sum(1 for r in rows if r["Storniert"])
        return f"{done:3d} ausgeliefert, {len(rows) - done - storniert:3d} offen, {storniert:3d} storniert"

    print(f"  Seite  1/{total_pages}: {page_note(rows)}")

    for page in range(2, total_pages + 1):
        try:
            soup = fetch_page(session, page, args.delay)
        except requests.RequestException as e:
            print(f"  Seite {page} fehlgeschlagen ({e}) — wird uebersprungen.")
            continue
        rows = parse_rows(soup)
        for r in rows:
            by_id[r["ID"]] = r  # ID-basiert, verhindert Doppelungen
        print(f"  Seite {page:2d}/{total_pages}: {page_note(rows)}")

    records = list(by_id.values())
    n_done = sum(1 for r in records if r["Ausgeliefert"])
    n_storniert = sum(1 for r in records if r["Storniert"])
    print(f"\n{len(records)} eindeutige Bestellungen "
          f"({n_done} ausgeliefert, {len(records) - n_done - n_storniert} offen, "
          f"{n_storniert} storniert).")

    # Aufbereiten
    delivered, open_orders, cancelled = [], [], []
    skipped = 0
    for r in records:
        order_date = parse_de_date(r["Bestelldatum"])
        if order_date is None:
            skipped += 1
            continue

        rec = {
            "ID": r["ID"],
            "Ausgeliefert": r["Ausgeliefert"],
            "Bestelldatum": r["Bestelldatum"],
            "BestelldatumTS": int(datetime(order_date.year, order_date.month,
                                           order_date.day).timestamp() * 1000),
            "Land": r["Land"],
            "Modell": r["Modell"],
            "Modellgruppe": model_group(r["Modell"]),
            "Ausstattungslinie": trim_line(r["Modell"]),
            "Farbe": r["Farbe"],
        }
        rec.update(harmonize(r["Ausstattung"]))

        if r["Storniert"]:
            # Nicht in delivered/open_orders: eine stornierte Bestellung ist
            # weder Teil der statistischen Vergleichsbasis noch eine aktive
            # Bestellung, die noch in der Warteschlange steht (faelschlich in
            # open_orders mitgezaehlt wuerde sie die Warteschlangen-Schaetzung
            # verfaelschen). Nur fuers Prognose-Log gebraucht, siehe unten.
            cancelled.append(rec)
        elif r["Ausgeliefert"]:
            days = waiting_days(r["Wartezeit"])
            if days is None:
                skipped += 1
                continue
            rec["WartezeitTage"] = days
            rec["Lieferdatum"] = r["Lieferdatum"]
            delivered.append(rec)
        else:
            # Offene Bestellungen liefern keine echte Wartezeit; die Angabe des
            # Forums zum erwarteten Termin wird nur zum Vergleich mitgefuehrt.
            rec["VorausLieferdatum"] = r["VorausLieferdatum"]
            open_orders.append(rec)

    if skipped:
        print(f"{skipped} Eintraege ohne lesbares Datum/Wartezeit uebersprungen.")

    if not delivered:
        sys.exit("Keine auswertbaren Daten gefunden — Seitenstruktur geaendert?")

    # Ausreisser betreffen nur die statistische Basis (ausgelieferte Fahrzeuge).
    if args.keep_outliers:
        print("Ausreisser bleiben enthalten (--keep-outliers).")
    else:
        low, high = outlier_bounds([r["WartezeitTage"] for r in delivered])
        before = len(delivered)
        delivered = [r for r in delivered if low <= r["WartezeitTage"] <= high]
        print(f"Ausreisser entfernt: {before - len(delivered)} "
              f"(gueltiger Bereich {low:.0f}–{high:.0f} Tage)")

    # Prognose-Log: neue offene Bestellungen erhalten eine fixe Erstprognose,
    # inzwischen ausgelieferte werden mit dem tatsaechlichen Ergebnis aufgeloest.
    now_ts = int(datetime.now().timestamp() * 1000)
    log = load_log()
    new_logged, resolved_now, recalculated, original_migrated, personal_data_stripped, ids_migrated = update_prediction_log(
        log, delivered, open_orders, cancelled, now_ts)
    save_log(log)
    merge_log_into_records(log, delivered, open_orders)

    resolved_all = [e for e in log.values() if e.get("Status") == "eingetroffen"
                    and e.get("DeviationDays") is not None]
    print(f"\nPrognose-Log ({LOG_PATH.name}):")
    print(f"  Neu erfasste offene Bestellungen: {new_logged}")
    print(f"  Neu aufgeloest (jetzt ausgeliefert): {resolved_now}")
    print(f"  Neu berechnete Prognosen (weiterhin offen): {recalculated}")
    if original_migrated:
        print(f"  Einmalig migriert (Original-Prognose nachgetragen): {original_migrated}")
    if personal_data_stripped:
        print(f"  Einmalig bereinigt (Benutzername/Profil-Link entfernt, DSGVO): {personal_data_stripped}")
    if ids_migrated:
        print(f"  Einmalig migriert (rohe ID durch Hash ersetzt, Datenschutz): {ids_migrated}")
    if resolved_all:
        mae = sum(abs(e["DeviationDays"]) for e in resolved_all) / len(resolved_all)
        within2w = sum(1 for e in resolved_all if abs(e["DeviationDays"]) <= 14) / len(resolved_all)
        print(f"  Insgesamt aufgeloeste Prognosen: {len(resolved_all)}")
        print(f"  Mittlere Abweichung: {mae:.1f} Tage  ·  "
              f"Anteil innerhalb ±14 Tagen: {within2w*100:.0f}%")

    # Rueckblick-Test: simuliert fuer jede ausgelieferte Bestellung, dass sie
    # am eigenen Bestelldatum noch offen gewesen waere, und prognostiziert
    # nur mit Daten, die zu dem Zeitpunkt verfuegbar waren. Gibt sofort
    # belastbare Genauigkeits-Zahlen zur aktuellen Algorithmus-Version, ohne
    # Monate auf neue echte Aufloesungen warten zu muessen.
    # Zuerst datenbasiert entscheiden, ob die Zensierungs-Korrektur fuer den
    # aktuellen Datenbestand ueberhaupt ein Gewinn ist -- das Ergebnis gilt
    # dann sowohl fuer den Rueckblick-Test als auch fuer alle produktiven
    # Prognosen weiter unten.
    global _CENSORING_CORRECTION
    print("\nPruefe Survivorship-Korrektur gegen die juengere Historie...")

    def _predict_factory(enabled):
        def fn(order, pool_delivered, pool_open, now_ts):
            global _CENSORING_CORRECTION
            prev = _CENSORING_CORRECTION
            _CENSORING_CORRECTION = enabled
            try:
                return predict_delivery(order, pool_delivered, pool_open, now_ts)
            finally:
                _CENSORING_CORRECTION = prev
        return fn

    _CENSORING_CORRECTION, censoring_report = backtest.evaluate_censoring_correction(
        delivered, open_orders, _predict_factory)
    _r_on, _r_off = censoring_report.get("on"), censoring_report.get("off")
    if _r_on and _r_off:
        print(f"  ohne Korrektur: MAE {_r_off['mae']} Tage, Bias {_r_off['bias']:+.1f}")
        print(f"  mit  Korrektur: MAE {_r_on['mae']} Tage, Bias {_r_on['bias']:+.1f}")
    print(f"  -> Korrektur {censoring_report['decision']} "
          f"({censoring_report['reason']})")

    print("\nKalibriere Konfidenzbaender (50/80/95%) gegen nie gesehene Daten...")
    global _BAND_CALIBRATION
    _BAND_CALIBRATION, band_report = backtest.calibrate_confidence_bands(
        delivered, open_orders, predict_delivery)
    for _bk, _bv in band_report.items():
        _status = f"aktiv, x{_bv['scale']}" if _bv["enabled"] else "inaktiv"
        print(f"  {_bk}%-Band: Trefferquote {_bv['coverage_before']*100:.1f}% "
              f"-> {_bv['coverage_after']*100:.1f}% (Ziel {int(_bv['target']*100)}%) — {_status}")

    print("\nRueckblick-Test (simulierte Prognosen fuer bereits ausgelieferte Bestellungen)...")
    bt_results = backtest.run_backtest(delivered, predict_delivery, _SIMILARITY_BOOL_KEYS,
                                       open_orders=open_orders)
    bt_summary = backtest.aggregate_backtest(bt_results)
    if bt_summary["new"]:
        print(f"  Getestet: {bt_summary['n_tested']} Bestellungen "
              f"(davon {bt_summary['new']['n']} mit ausreichend historischem Datenstand)")
        print(f"  Aktueller Algorithmus: MAE {bt_summary['new']['mae']} Tage, "
              f"Bias {bt_summary['new']['bias']:+.1f} Tage, "
              f"{bt_summary['new']['within14']*100:.0f}% innerhalb ±14 Tagen")
        if bt_summary["old"]:
            print(f"  Alte Baseline (Vergleich):  MAE {bt_summary['old']['mae']} Tage, "
                  f"Bias {bt_summary['old']['bias']:+.1f} Tage, "
                  f"{bt_summary['old']['within14']*100:.0f}% innerhalb ±14 Tagen")

    # Daten-Guete: wie viele geloggte offene Bestellungen sind aus der
    # Forumsliste verschwunden, ohne als ausgeliefert aufzutauchen (z.B.
    # Stornos)? Das ist eine mögliche Quelle fuer einen leichten
    # Optimismus-Bias in den Referenzdaten, siehe Methodik-Hinweis im
    # Dashboard.
    # "storniert" ist jetzt eine direkt beobachtete Kategorie (Forums-Klasse
    # carOrderCanceled), keine Vermutung mehr. "entfernt" bleibt als Restgroesse
    # fuer Faelle, die aus unbekanntem Grund verschwinden (z.B. Forums-
    # Bereinigung) -- sollte durch die Praezisierung spuerbar kleiner werden.
    storniert_count = sum(1 for e in log.values() if e.get("Status") == "storniert")
    entfernt_count = sum(1 for e in log.values() if e.get("Status") == "entfernt")
    eingetroffen_count = sum(1 for e in log.values() if e.get("Status") == "eingetroffen")
    tracked_total = storniert_count + entfernt_count + eingetroffen_count
    data_quality = {
        "storniert_count": storniert_count,
        "entfernt_count": entfernt_count,
        "eingetroffen_count": eingetroffen_count,
        "storniert_rate": round(storniert_count / tracked_total, 4) if tracked_total else None,
        "entfernt_rate": round(entfernt_count / tracked_total, 4) if tracked_total else None,
    }
    if tracked_total:
        print(f"\nDaten-Guete: {storniert_count} von {tracked_total} beobachteten offenen "
              f"Bestellungen wurden storniert ({data_quality['storniert_rate']*100:.1f}%); "
              f"{entfernt_count} weitere sind aus unbekanntem Grund verschwunden "
              f"({data_quality['entfernt_rate']*100:.1f}%).")

    methodology = {"backtest": bt_summary, "data_quality": data_quality,
                   "censoring_correction": censoring_report,
                   "band_calibration": {"factors": _BAND_CALIBRATION, "report": band_report}}

    final = delivered + open_orders
    data_stand = date.today().strftime("%d.%m.%Y")
    out_path = Path(args.out).resolve()
    build_dashboard(final, out_path, data_stand, len(delivered), methodology=methodology)

    if args.csv:
        csv_path = Path(args.csv).resolve()
        write_csv(delivered, csv_path)
        print(f"CSV gespeichert: {csv_path}")

    avg = sum(r["WartezeitTage"] for r in delivered) / len(delivered)
    print(f"\nFertig: {len(delivered)} ausgelieferte Bestellungen (Ø {avg:.0f} Tage), "
          f"{len(open_orders)} offene fuer die Prognose.")
    print(f"Dashboard: {out_path}")


if __name__ == "__main__":
    main()
