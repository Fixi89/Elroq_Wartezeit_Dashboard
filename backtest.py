"""
Rueckblick-Test (Backtesting) fuer die Liefer-Prognose.

Simuliert fuer jede bereits ausgelieferte Bestellung, dass sie an ihrem
eigenen Bestelldatum noch offen gewesen waere, und prognostiziert NUR mit
Daten, die zu diesem Zeitpunkt tatsaechlich verfuegbar waren (andere zu dem
Zeitpunkt bereits ausgelieferte Bestellungen als Vergleichs-Pool, andere zu
dem Zeitpunkt noch offene als Warteschlangen-Signal -- exakt dieselbe
Rekonstruktion, die auch die produktive Warteschlangen-Schaetzung nutzt).
Der tatsaechliche Ausgang ist ja bekannt, also laesst sich die Prognose
direkt gegen die Realitaet pruefen -- ohne Monate auf neue echte
Aufloesungen warten zu muessen.

Wird von elroq_dashboard_update.py und enyaq_dashboard_update.py importiert,
damit die Logik nicht doppelt gepflegt wird.
"""
from datetime import datetime

DAY_MS = 86400000
MIN_BACKTEST_POOL = 5
MIN_SEGMENT_N = 12  # unterhalb dieser Groesse wird ein Segment nicht einzeln ausgewiesen (zu verrauscht)


# ---------------------------------------------------------------------------
# Alte Baseline (Stand vor den vier Optimierungen), fuer den Vorher/Nachher-
# Vergleich originalgetreu nachgebaut: feste Aehnlichkeits-Tiers, hartes
# 180-Bestellungen-Zeitfenster, harter Landes-Cutoff bei 15 Bestellungen,
# keine Trend-Korrektur, keine Warteschlangen-Schaetzung.
# ---------------------------------------------------------------------------

def _quantile_plain(sorted_vals, q):
    if not sorted_vals:
        return 0.0
    pos = (len(sorted_vals) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def _similarity_baseline(a, b, bool_keys):
    score = max_score = 0.0

    def add(weight, ok):
        nonlocal score, max_score
        max_score += weight
        if ok:
            score += weight

    add(4, a.get("Modellgruppe") == b.get("Modellgruppe"))
    add(2, a.get("Modell") == b.get("Modell"))
    add(3, (a.get("Land") or "") == (b.get("Land") or ""))
    add(1, (a.get("Innenausstattung_DesignSelection") or "") ==
           (b.get("Innenausstattung_DesignSelection") or ""))
    add(1, (a.get("Felgenname") or "") == (b.get("Felgenname") or ""))
    for k in bool_keys:
        add(0.6, a.get(k) == b.get(k))
    return score / max_score if max_score else 0.0


_BASELINE_TIERS = [
    {"min": 0.80, "take": 20, "group_only": False},
    {"min": 0.65, "take": 25, "group_only": False},
    {"min": 0.00, "take": 30, "group_only": True},
]
_BASELINE_ERA_WINDOW = 180
_BASELINE_MIN_COUNTRY_POOL = 15


def _predict_baseline_match(order, pool, bool_keys):
    if len(pool) < 5:
        return None
    era = sorted(pool, key=lambda d: abs(d["BestelldatumTS"] - order["BestelldatumTS"]))
    era = era[:min(_BASELINE_ERA_WINDOW, len(pool))]
    scored = sorted(
        ({"d": d, "sim": _similarity_baseline(order, d, bool_keys)} for d in era),
        key=lambda x: -x["sim"],
    )
    refs = []
    for t in _BASELINE_TIERS:
        if t["group_only"]:
            candidate = [x for x in scored if x["d"]["Modellgruppe"] == order.get("Modellgruppe")]
        else:
            candidate = [x for x in scored if x["sim"] >= t["min"]]
        if len(candidate) >= 5:
            refs = candidate[:t["take"]]
            break
    if len(refs) < 5:
        refs = scored[:30]
    if not refs:
        return None
    days = sorted(x["d"]["WartezeitTage"] for x in refs)
    return round(_quantile_plain(days, 0.5))


def predict_delivery_baseline(order, pool, bool_keys):
    """Alte Logik: harter Landes-Vorfilter (>=15 sonst global), sonst wie
    _predict_baseline_match. Gibt nur den Median zurueck (mehr wird fuer den
    Backtest-Vergleich nicht gebraucht)."""
    order_land = order.get("Land") or ""
    country_pool = [d for d in pool if (d.get("Land") or "") == order_land]
    if len(country_pool) >= _BASELINE_MIN_COUNTRY_POOL:
        result = _predict_baseline_match(order, country_pool, bool_keys)
        if result is not None:
            return result
    return _predict_baseline_match(order, pool, bool_keys)


# ---------------------------------------------------------------------------
# Rueckblick-Simulation
# ---------------------------------------------------------------------------

def _reconstruct_pool_as_of(delivered, order):
    """Baut fuer eine Bestellung den Datenstand nach, der an ihrem eigenen
    Bestelldatum tatsaechlich verfuegbar gewesen waere: andere Bestellungen,
    die zu dem Zeitpunkt schon ausgeliefert waren (= historischer Vergleichs-
    Pool), und andere, die zu dem Zeitpunkt bestellt aber noch nicht
    ausgeliefert waren (= damaliger Warteschlangen-Stand). Beides laesst
    sich aus den heute bekannten tatsaechlichen Lieferterminen exakt
    rekonstruieren."""
    order_ts = order["BestelldatumTS"]
    order_id = order["ID"]
    pool_delivered, pool_open = [], []
    for r in delivered:
        if r["ID"] == order_id:
            continue
        clear_ts = r["BestelldatumTS"] + r["WartezeitTage"] * DAY_MS
        if clear_ts <= order_ts:
            pool_delivered.append(r)
        elif r["BestelldatumTS"] < order_ts:
            pool_open.append(r)
        # sonst: zu dem Zeitpunkt noch gar nicht bestellt -> ausgeschlossen
    return pool_delivered, pool_open


def run_backtest(delivered, predict_fn, bool_keys, min_pool=MIN_BACKTEST_POOL):
    """
    predict_fn: die produktive predict_delivery(order, delivered, open_orders, now_ts)
    Gibt eine Liste von Ergebnis-Dicts zurueck (eines pro getesteter Bestellung).
    """
    results = []
    for order in delivered:
        pool_delivered, pool_open = _reconstruct_pool_as_of(delivered, order)
        if len(pool_delivered) < min_pool:
            continue

        order_ts = order["BestelldatumTS"]
        p_new = predict_fn(order, pool_delivered, pool_open, order_ts)
        p_old = predict_delivery_baseline(order, pool_delivered, bool_keys)
        if p_new is None and p_old is None:
            continue

        actual = order["WartezeitTage"]
        results.append({
            "ID": order["ID"],
            "Modellgruppe": order.get("Modellgruppe"),
            "Land": order.get("Land"),
            "actual": actual,
            "new_pred": p_new["median"] if p_new else None,
            "old_pred": p_old,
        })
    return results


def _agg(devs):
    n = len(devs)
    if n == 0:
        return None
    mae = sum(abs(d) for d in devs) / n
    bias = sum(devs) / n
    within14 = sum(1 for d in devs if abs(d) <= 14) / n
    return {"n": n, "mae": round(mae, 1), "bias": round(bias, 1), "within14": round(within14, 3)}


def aggregate_backtest(results, segment_keys=("Modellgruppe", "Land")):
    """Fasst die rohen Backtest-Ergebnisse zu globalen und Segment-Kennzahlen
    zusammen (neuer Algorithmus + alte Baseline, jeweils separat)."""
    new_devs = [r["actual"] - r["new_pred"] for r in results if r["new_pred"] is not None]
    old_devs = [r["actual"] - r["old_pred"] for r in results if r["old_pred"] is not None]

    out = {
        "generated_at": int(datetime.now().timestamp() * 1000),
        "n_tested": len(results),
        "new": _agg(new_devs),
        "old": _agg(old_devs),
        "segments": {},
    }

    for key in segment_keys:
        groups = {}
        for r in results:
            val = r.get(key) or "Unbekannt"
            groups.setdefault(val, []).append(r)
        rows = []
        for val, rows_g in groups.items():
            ndevs = [r["actual"] - r["new_pred"] for r in rows_g if r["new_pred"] is not None]
            odevs = [r["actual"] - r["old_pred"] for r in rows_g if r["old_pred"] is not None]
            if len(ndevs) < MIN_SEGMENT_N:
                continue
            new_agg = _agg(ndevs)
            old_agg = _agg(odevs)
            rows.append({
                "key": val,
                "n": new_agg["n"],
                "new_mae": new_agg["mae"], "new_bias": new_agg["bias"],
                "old_mae": old_agg["mae"] if old_agg else None,
                "old_bias": old_agg["bias"] if old_agg else None,
            })
        rows.sort(key=lambda r: -r["n"])
        out["segments"][key] = rows

    return out
