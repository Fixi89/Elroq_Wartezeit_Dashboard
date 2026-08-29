"""
Konsistenz-Test: Python predict_delivery() vs. JS predict() (Was-wäre-wenn).

Beide Implementierungen muessen fuer dieselbe Konfiguration dieselbe Prognose
liefern -- genau dieses Auseinanderdriften hat schon einmal zu
unterschiedlichen Anzeigen fuer "Eigene Bestellung nachschlagen" und den
Was-wäre-wenn-Rechner gefuehrt. Kein Teil der automatisierten GitHub-Actions-
Pipeline (braucht Playwright/einen Browser, das haelt den taeglichen Build
unnoetig schwer) -- von Hand nach jeder Aenderung an predict_delivery() oder
dem JS-Spiegel ausfuehren:

    pip install playwright --break-system-packages
    playwright install chromium
    python3 consistency_test.py

Erwartet Elroq_Wartezeit_Dashboard.html (oder ein per --html angegebenes
Dashboard) als Datenquelle im selben Ordner.
"""
import argparse
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

TEST_ORDERS = [
    {"Modell": "Skoda Elroq 85 Selection", "Modellgruppe": "Elroq 85",
     "Farbe": "Smokey Diamond-Silber Metallic", "Innenausstattung_DesignSelection": "Lodge",
     "Felgenname": "Proteus", "Land": "Deutschland", "Bestelldatum": "8. Juni 2026",
     "Paket_Jubilaeum130Jahre": "Nein", "Waermepumpe": "Nein"},
    {"Modell": "Skoda Elroq RS", "Modellgruppe": "Elroq RS",
     "Farbe": "Race-Blau Metallic", "Innenausstattung_DesignSelection": None,
     "Felgenname": None, "Land": "Deutschland", "Bestelldatum": "15. März 2026",
     "Paket_Jubilaeum130Jahre": "Nein", "Waermepumpe": "Ja"},
    {"Modell": "Skoda Elroq 60 Sportline", "Modellgruppe": "Elroq 60",
     "Farbe": "Graphite-Grau Metallic", "Innenausstattung_DesignSelection": "Loft",
     "Felgenname": "Vega", "Land": "Österreich", "Bestelldatum": "1. November 2025",
     "Paket_Jubilaeum130Jahre": "Nein", "Waermepumpe": "Nein"},
    {"Modell": "Skoda Elroq 85x Sportline", "Modellgruppe": "Elroq 85x",
     "Farbe": "Velvet-Rot Metallic", "Innenausstattung_DesignSelection": "Suite",
     "Felgenname": "Supernova", "Land": "Schweiz", "Bestelldatum": "20. Januar 2026",
     "Paket_Jubilaeum130Jahre": "Nein", "Waermepumpe": "Ja"},
    {"Modell": "Skoda Elroq 50 Tour", "Modellgruppe": "Elroq 50",
     "Farbe": "Moon-Weiß Perleffekt", "Innenausstattung_DesignSelection": None,
     "Felgenname": None, "Land": "Deutschland", "Bestelldatum": "5. September 2025",
     "Paket_Jubilaeum130Jahre": "Nein", "Waermepumpe": "Nein"},
]

TOLERANCE_DAYS = 2  # unabhaengiges Runden auf beiden Seiten darf leicht abweichen


def load_data(html_path):
    html = html_path.read_text(encoding="utf-8")
    m = re.search(r'<script id="dashboard-data" type="application/json">\s*(.*?)\s*</script>',
                  html, re.S)
    return json.loads(m.group(1))


def build_test_html(data, template_dir, out_path):
    sys.path.insert(0, str(template_dir))
    import elroq_dashboard_update as elroq
    import backtest

    def strip(obj):
        if isinstance(obj, dict):
            obj.pop("Benutzername", None); obj.pop("ProfilURL", None)
            for v in obj.values():
                strip(v)
        elif isinstance(obj, list):
            for v in obj:
                strip(v)
    strip(data)

    delivered = [r for r in data if r.get("Ausgeliefert") and r.get("WartezeitTage") is not None]
    open_orders = [r for r in data if r.get("Ausgeliefert") is False]

    def factory(enabled):
        def fn(order, pd_, po_, ts):
            prev = elroq._CENSORING_CORRECTION
            elroq._CENSORING_CORRECTION = enabled
            try:
                return elroq.predict_delivery(order, pd_, po_, ts)
            finally:
                elroq._CENSORING_CORRECTION = prev
        return fn

    enabled, report = backtest.evaluate_censoring_correction(delivered, open_orders, factory)
    elroq._CENSORING_CORRECTION = enabled
    print(f"Survivorship-Korrektur: {'an' if enabled else 'aus'}")

    band_factors, band_report = backtest.calibrate_confidence_bands(delivered, open_orders, elroq.predict_delivery)
    elroq._BAND_CALIBRATION = band_factors
    print(f"Band-Kalibrierung: {band_factors}")

    methodology = {"censoring_correction": {"decision": "an" if enabled else "aus"},
                   "band_calibration": {"factors": band_factors, "report": band_report}}

    tpl = (template_dir / "template_dashboard.html").read_text(encoding="utf-8")
    app_js = (template_dir / "template_app.js").read_text(encoding="utf-8")
    tpl = (tpl.replace("__BRAND_NAME__", "Elroq").replace("__BRAND_FORUM__", "Elroq-Forum")
              .replace("__COUNT__", str(len(data))).replace("__DATA_STAND__", "Konsistenztest")
              .replace("__SWITCH_ELROQ_HREF__", "./").replace("__SWITCH_ELROQ_ACTIVE__", "active")
              .replace("__METHODOLOGY_JSON__", json.dumps(methodology, ensure_ascii=False)))
    out = (tpl.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False))
              .replace("__APP_JS__", app_js))
    out_path.write_text(out, encoding="utf-8")
    return elroq, delivered, open_orders, out_path


def python_predict(elroq, delivered, open_orders, order_spec, now_ts):
    order_ts = elroq.parse_de_date(order_spec["Bestelldatum"])
    order_ts_ms = int(__import__("datetime").datetime(
        order_ts.year, order_ts.month, order_ts.day).timestamp() * 1000)
    order = dict(order_spec)
    order["BestelldatumTS"] = order_ts_ms
    return elroq.predict_delivery(order, delivered, open_orders, now_ts)


def js_predict(page, order_spec, elroq_module):
    def pick(select_id, label_text):
        trigger = page.evaluate_handle(
            f"document.getElementById('{select_id}').closest('.csel').querySelector('.csel-trigger')")
        el = trigger.as_element()
        el.scroll_into_view_if_needed()
        el.click()
        page.wait_for_timeout(200)
        page.get_by_role("option", name=label_text, exact=True).click(timeout=10000)
        page.wait_for_timeout(150)

    model_label = order_spec["Modell"].replace("Skoda ", "")
    pick("wiModell", model_label)
    order_ts = elroq_module.parse_de_date(order_spec["Bestelldatum"])
    page.fill("#wiDate", order_ts.strftime("%Y-%m-%d"))
    # Immer explizit setzen -- auch auf "Keine Angabe" -- statt das Feld bei
    # einem leeren Wert unangetastet zu lassen. Sonst bleibt der Zustand vom
    # VORHERIGEN Testfall stehen (dasselbe Problem wie beim Wärmepumpe-
    # Häkchen weiter unten), da mehrere Faelle nacheinander in derselben
    # Seite laufen.
    if order_spec.get("Land"):
        pick("wiLand", order_spec["Land"])
    pick("wiFarbe", order_spec.get("Farbe") or "Keine Angabe")
    pick("wiInnen", order_spec.get("Innenausstattung_DesignSelection") or "Keine Angabe")
    pick("wiFelgen", order_spec.get("Felgenname") or "Keine Angabe")
    checkbox = page.query_selector("#whatIfBools input[type=checkbox]")
    if checkbox:
        is_checked = checkbox.is_checked()
        wants_checked = order_spec.get("Waermepumpe") == "Ja"
        if is_checked != wants_checked:
            checkbox.click()

    page.click('#whatIfForm button:has-text("Prognose berechnen")')
    page.wait_for_timeout(400)

    has_result = page.evaluate("document.querySelectorAll('#whatIfResult .confidence-fan').length > 0")
    if not has_result:
        return None, None
    text = page.evaluate("document.querySelector('#whatIfResult').innerText")
    # 95%-Bandgrenzen direkt aus den Segment-Daten lesen (data-from-days/
    # data-to-days), nicht nur den Median -- der bleibt von der
    # Kalibrierung unberuehrt, nur die Bandbreite aendert sich, also ist der
    # Median allein kein Test dafuer, ob die Kalibrierung auch im JS-Spiegel
    # wirkt.
    band95 = page.evaluate("""() => {
        const segs = Array.from(document.querySelectorAll('#whatIfResult .fan-segment'))
            .filter(s => s.dataset.band.startsWith('95'));
        if (!segs.length) return null;
        const from = Math.min(...segs.map(s => Number(s.dataset.fromDays)));
        const to = Math.max(...segs.map(s => Number(s.dataset.toDays)));
        return [from, to];
    }""")
    return text, band95


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default="Elroq_Wartezeit_Dashboard.html")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    html_path = SCRIPT_DIR / args.html
    if not html_path.exists():
        sys.exit(f"{html_path} nicht gefunden.")

    data = load_data(html_path)
    test_html = SCRIPT_DIR / "_consistency_test.html"
    elroq, delivered, open_orders, test_html = build_test_html(data, SCRIPT_DIR, test_html)

    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1100, "height": 900})
        page.goto(f"file://{test_html}")
        page.wait_for_timeout(800)
        page.click('a[href="#sec-persoenlich"]')
        page.wait_for_timeout(200)
        page.click('button.tab-btn[data-tab="whatif"]')
        page.wait_for_timeout(200)

        # Beide Seiten muessen dieselbe Vorstellung von "jetzt" verwenden --
        # die Zensierungs- und Warteschlangen-Korrektur haengen direkt an
        # now_ts. JS nutzt live Date.now(); ein einmalig hier eingefrorener
        # Zeitstempel (statt z.B. faelschlich dem Bestelldatum) haelt beide
        # Seiten im selben Sekundenbereich synchron.
        now_ts = int(page.evaluate("Date.now()"))

        for spec in TEST_ORDERS:
            py = python_predict(elroq, delivered, open_orders, spec, now_ts)
            if py is None:
                print(f"SKIP (zu wenig Daten): {spec['Modell']}")
                continue

            js_text, js_band95 = js_predict(page, spec, elroq)
            m = re.search(r"(\d+)\s*Tage Wartezeit \(Median\)", js_text or "")
            js_median = int(m.group(1)) if m else None

            label = f"{spec['Modell']} · {spec['Bestelldatum']}"
            if js_median is None:
                print(f"FEHLER  {label}: kein JS-Ergebnis gefunden")
                failures += 1
                continue

            diff = abs(py["median"] - js_median)
            status = "OK    " if diff <= TOLERANCE_DAYS else "ABWEICHUNG"
            print(f"{status}  {label}: Python={py['median']}d  JS={js_median}d  (Diff={diff}d)")
            if diff > TOLERANCE_DAYS:
                failures += 1

            # 95%-Band getrennt pruefen -- das ist genau das, was die
            # Kalibrierung (Punkt 4) veraendert; der Median bleibt davon
            # unberuehrt und waere allein kein aussagekraeftiger Test dafuer.
            if js_band95 is not None:
                py_band95 = (py["p2_5"], py["p97_5"])
                diff95 = max(abs(py_band95[0] - js_band95[0]), abs(py_band95[1] - js_band95[1]))
                status95 = "OK    " if diff95 <= TOLERANCE_DAYS else "ABWEICHUNG"
                print(f"{status95}  {label} [95%-Band]: Python={py_band95}  JS={tuple(js_band95)}  (Diff={diff95}d)")
                if diff95 > TOLERANCE_DAYS:
                    failures += 1

        browser.close()

    test_html.unlink(missing_ok=True)

    print()
    if failures:
        print(f"{failures} Abweichung(en) über {TOLERANCE_DAYS} Tage gefunden.")
        sys.exit(1)
    print("Alle getesteten Konfigurationen stimmen überein.")


if __name__ == "__main__":
    main()
