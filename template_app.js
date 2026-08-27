(function(){
  const ALL_ORDERS = JSON.parse(document.getElementById('dashboard-data').textContent);
  const METHODOLOGY = (() => {
    const el = document.getElementById('methodology-data');
    if (!el) return {};
    try { return JSON.parse(el.textContent) || {}; } catch (e) { return {}; }
  })();

  // Delivered orders are the statistical basis for every chart and filter.
  // Open orders are only used for the personal lookup — their "waiting time"
  // is still running and would distort the averages.
  const DATA = ALL_ORDERS.filter(r => r.Ausgeliefert !== false);
  const OPEN_ORDERS = ALL_ORDERS.filter(r => r.Ausgeliefert === false);

  // Accent colour: static Škoda Electric Green. (A previous version retinted
  // the whole dashboard to match whichever paint colour was selected in a
  // filter/dropdown, but this caused real usability problems and was
  // reverted. Kept simple and predictable instead.)
  const ACCENT = '#78faae';
  const ACCENT_DIM = '#4aa92e';

  // ---- Custom dropdowns (.csel) ----
  // Every <select> in the markup is kept in the DOM purely as a hidden data
  // store (value + options + 'change' event) — all the existing code that
  // reads .value, populates options/optgroups, or listens for 'change' on
  // these elements keeps working completely unchanged. What the person
  // actually sees and clicks is a custom-built trigger + listbox styled to
  // match the dashboard, because native <select> popups can't be reliably
  // reskinned across browsers (color-scheme:dark does NOT fix the open
  // option list in every browser, notably Chrome/Edge on Windows with
  // <optgroup>s, which is what made dropdowns unreadable before).
  const CUSTOM_SELECTS = [];

  function enhanceSelect(selectEl){
    if (!selectEl || selectEl.dataset.cselEnhanced) return;
    selectEl.dataset.cselEnhanced = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'csel';
    selectEl.parentNode.insertBefore(wrapper, selectEl);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'csel-trigger';
    if (selectEl.className) trigger.className += ' ' + selectEl.className;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (selectEl.getAttribute('aria-label')) trigger.setAttribute('aria-label', selectEl.getAttribute('aria-label'));

    const valueSpan = document.createElement('span');
    valueSpan.className = 'csel-value';
    const chevron = document.createElement('span');
    chevron.className = 'csel-chevron';
    chevron.textContent = '▾';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.appendChild(valueSpan);
    trigger.appendChild(chevron);

    const menu = document.createElement('div');
    menu.className = 'csel-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    // Appended to <body> (not the wrapper) and positioned with fixed
    // coordinates computed at open-time: the wrapper often sits inside a
    // scrolling container (e.g. the sticky sidebar), and position:absolute
    // there would get clipped by that container's overflow — position:fixed
    // relative to the viewport, with coordinates read off the trigger's own
    // getBoundingClientRect(), escapes that entirely.
    document.body.appendChild(menu);

    wrapper.appendChild(trigger);
    wrapper.appendChild(selectEl);
    selectEl.style.display = 'none';
    selectEl.setAttribute('tabindex', '-1');

    function syncLabel(){
      const opt = selectEl.options[selectEl.selectedIndex];
      const isPlaceholder = opt && opt.value === '' && selectEl.selectedIndex === 0;
      valueSpan.textContent = opt ? opt.textContent : '';
      valueSpan.classList.toggle('placeholder', !!isPlaceholder);
    }

    function makeOptionEl(opt, indented){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'option');
      btn.className = 'csel-option' + (indented ? ' indented' : '') + (opt.value === selectEl.value ? ' selected' : '');
      btn.textContent = opt.textContent;
      btn.addEventListener('click', () => {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        syncLabel();
        closeMenu();
      });
      return btn;
    }

    function buildMenu(){
      menu.innerHTML = '';
      Array.from(selectEl.children).forEach(child => {
        if (child.tagName === 'OPTGROUP'){
          const label = document.createElement('div');
          label.className = 'csel-optgroup-label';
          label.textContent = child.label;
          menu.appendChild(label);
          Array.from(child.children).forEach(opt => menu.appendChild(makeOptionEl(opt, true)));
        } else if (child.tagName === 'OPTION'){
          menu.appendChild(makeOptionEl(child, false));
        }
      });
    }

    function onDocMouseDown(e){
      if (!wrapper.contains(e.target) && !menu.contains(e.target)) closeMenu();
    }
    function onKeyDown(e){
      if (e.key === 'Escape') closeMenu();
    }
    function onScrollOrResize(e){
      // Capture-phase listener on window sees every scroll in the document,
      // including scrolling *inside* the open menu itself (long option
      // lists use overflow-y:auto) — closing on that made the list
      // unscrollable, since the first scroll attempt immediately closed it.
      // Only close for scrolling that happens outside the menu (page
      // scroll, the sidebar's own scroll container moving the trigger out
      // from under a fixed-position menu, window resize).
      if (e && e.target && menu.contains(e.target)) return;
      closeMenu();
    }
    function positionMenu(){
      const r = trigger.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.width = r.width + 'px';
      menu.style.top = (r.bottom + 6) + 'px';
      menu.style.bottom = '';
      // Flip above the trigger if there isn't enough room below.
      const menuRect = menu.getBoundingClientRect();
      if (r.bottom + menuRect.height + 6 > window.innerHeight && r.top - menuRect.height - 6 > 0){
        menu.style.top = '';
        menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      }
    }
    function openMenu(){
      buildMenu();
      menu.hidden = false;
      positionMenu();
      trigger.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('scroll', onScrollOrResize, true);
      window.addEventListener('resize', onScrollOrResize, true);
    }
    function closeMenu(){
      menu.hidden = true;
      trigger.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize, true);
    }

    trigger.addEventListener('click', () => {
      if (menu.hidden) openMenu(); else closeMenu();
    });

    syncLabel();
    CUSTOM_SELECTS.push({ selectEl, syncLabel });
  }

  // Re-reads every enhanced select's current value into its visible trigger
  // label. Called from render() (see below) so it self-heals after any
  // programmatic `sel.value = ...` assignment anywhere in the app, without
  // needing a MutationObserver on every select (setting .value via JS does
  // not reliably mutate the DOM in a way observers can catch).
  function syncCustomSelectLabels(){
    CUSTOM_SELECTS.forEach(({ syncLabel }) => syncLabel());
  }

  // ---- Filter definitions ----
  // 'Modell' is rendered as a two-level tree (drivetrain group -> variant),
  // but the filter state stays a flat set of full model names.
  const MULTI_FIELDS = [
    { key: 'Land', label: 'Land' },
    { key: 'Modell', label: 'Modell' },
    { key: 'Ausstattungslinie', label: 'Ausstattungslinie' },
    { key: 'Farbe', label: 'Farbe' },
    { key: 'Innenausstattung_DesignSelection', label: 'Innenausstattung (Design Selection)' },
    { key: 'Felgenname', label: 'Felgenname' },
  ];

  // Inline flags keep the file self-contained (no external image requests).
  const FLAGS = {
    'Deutschland': '<svg viewBox="0 0 5 3"><rect width="5" height="1" y="0" fill="#000"/><rect width="5" height="1" y="1" fill="#D00"/><rect width="5" height="1" y="2" fill="#FFCE00"/></svg>',
    'Österreich': '<svg viewBox="0 0 5 3"><rect width="5" height="1" y="0" fill="#ED2939"/><rect width="5" height="1" y="1" fill="#fff"/><rect width="5" height="1" y="2" fill="#ED2939"/></svg>',
    'Schweiz': '<svg viewBox="0 0 5 3"><rect width="5" height="3" fill="#D52B1E"/><rect x="2.15" y="0.6" width="0.7" height="1.8" fill="#fff"/><rect x="1.35" y="1.15" width="2.3" height="0.7" fill="#fff"/></svg>',
    'Belgien': '<svg viewBox="0 0 5 3"><rect width="1.67" height="3" x="0" fill="#000"/><rect width="1.67" height="3" x="1.67" fill="#FAE042"/><rect width="1.67" height="3" x="3.33" fill="#ED2939"/></svg>',
    'Italien': '<svg viewBox="0 0 5 3"><rect width="1.67" height="3" x="0" fill="#009246"/><rect width="1.67" height="3" x="1.67" fill="#fff"/><rect width="1.67" height="3" x="3.33" fill="#CE2B37"/></svg>',
    'Niederlande': '<svg viewBox="0 0 5 3"><rect width="5" height="1" y="0" fill="#AE1C28"/><rect width="5" height="1" y="1" fill="#fff"/><rect width="5" height="1" y="2" fill="#21468B"/></svg>',
    'Dänemark': '<svg viewBox="0 0 5 3"><rect width="5" height="3" fill="#C60C30"/><rect x="1.8" width="0.6" height="3" fill="#fff"/><rect y="1.2" width="5" height="0.6" fill="#fff"/></svg>',
  };

  function flagFor(land){
    const svg = FLAGS[land];
    return svg ? `<span class="flag" role="img" aria-label="${land}">${svg}</span>` : '';
  }

  function landCell(land){
    if (!land) return '–';
    const f = flagFor(land);
    return f ? `<span class="flag-cell">${f}${land}</span>` : land;
  }
  // Boolean filter/option fields shown in the sidebar, as order-row badges,
  // and folded into the prediction similarity score. This list used to carry
  // all 19 parsed config flags, but a statistical pass (see backtest/
  // Methodik) showed that most of them have no measurable effect on wait
  // time in the cleaner Elroq dataset (p >= 0.05, two-sided t-test,
  // delivered orders only) and several occur so rarely (n < 15 of 586) that
  // they can't function as a useful filter anyway. Keeping them inflated the
  // sidebar, diluted the prediction match score with near-tautological
  // "both don't have it" matches, and cluttered every order's badge row
  // without adding signal. Only the field that clears both a significance
  // and a minimum-sample bar stays as a filter/badge/similarity input;
  // everything else remains in the underlying data (visible in the CSV
  // export) but is no longer surfaced as a filter.
  //   kept:    Waermepumpe (n=287, diff=+9.1d, p=0.036)
  //   dropped: Paket_Smart, Paket_Clever, Paket_Advanced, Paket_Maxx,
  //            Paket_Plus, Paket_Sport, Paket_Winter, Paket_Transport,
  //            Paket_Drive, Anhaengerkupplung_AHK, DCC_AdaptivesFahrwerk,
  //            Dachkontrastlackierung, Gepaecknetztrennwand,
  //            Ganzjahresreifen, MatrixLED, Garantieverlaengerung,
  //            Vollausstattung_Selbstangabe (all p >= 0.05 and/or n < 15)
  //   removed: Paket_Jubilaeum130Jahre — had a real, significant effect
  //            (n=37, diff=+35.9d, p<0.0001) but the package itself has
  //            since been discontinued by Škoda, so it's no longer a
  //            meaningful filter/similarity input for current or future
  //            orders. BOOL_PATTERNS in the Python scripts still parses it
  //            for any historical order that mentions it, purely for data
  //            completeness (still visible in the CSV export).
  const BOOL_FIELDS = [
    { key: 'Waermepumpe', label: 'Wärmepumpe' },
  ];

  const BADGE_LABELS = {
    Waermepumpe:'WP',
  };

  // Ausstattungspakete (bundled trim packages) vs. Einzeloptionen (individual
  // add-ons) get a slightly different badge tint so the two are visually
  // distinguishable at a glance, without adding a third clashing hue.
  const PAKET_KEYS = new Set([]);

  function badgeHtml(key){
    const cls = PAKET_KEYS.has(key) ? 'badge on paket' : 'badge on option';
    return `<span class="${cls}">${BADGE_LABELS[key]}</span>`;
  }

  function felgenLabel(r){
    return [r.Felgengroesse_Zoll ? r.Felgengroesse_Zoll + '"' : '', r.Felgenname].filter(Boolean).join(' ') || '–';
  }

  // Empty values are shown (and filtered) as an explicit "unknown" entry.
  const UNKNOWN = '— unbekannt —';
  function normalizedValue(r, key){
    const v = r[key];
    return (v === '' || v === null || v === undefined) ? UNKNOWN : v;
  }

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const DAY_MS = 86400000;
  const dateFmt = new Intl.DateTimeFormat('de-DE', { day:'2-digit', month:'short', year:'numeric' });
  function fmtDate(ts){ return dateFmt.format(new Date(ts)); }

  // state: multi fields -> Set of selected values (empty set = all)
  // bool fields -> 'alle' | 'Ja' | 'Nein'
  const state = {};
  MULTI_FIELDS.forEach(f => state[f.key] = new Set());
  BOOL_FIELDS.forEach(f => state[f.key] = 'alle');

  const allDates = DATA.map(r => r.BestelldatumTS).filter(v => v !== null && v !== undefined);
  const DATE_MIN = Math.min(...allDates);
  const DATE_MAX = Math.max(...allDates);

  // Default start of the order-date filter. The slider still reaches all the
  // way back to DATE_MIN — the full history stays available — but the view
  // opens on September 2025 onwards, because older orders come from a
  // materially different production situation (early-launch backlog for
  // Elroq, the 2021/22 chip-shortage era for Enyaq, where waits ran past 700
  // days). Mixing those into the headline averages makes today's numbers look
  // worse than they are. Guarded with max() so a dataset that only starts
  // later isn't filtered down to nothing.
  const DEFAULT_FROM = Math.max(DATE_MIN, Date.UTC(2025, 8, 1));
  const DEFAULT_RANGE = [DEFAULT_FROM, DATE_MAX];
  state.dateRange = [...DEFAULT_RANGE];

  function distinctValues(key){
    const counts = {};
    DATA.forEach(r => {
      const v = normalizedValue(r, key);
      counts[v] = (counts[v]||0) + 1;
    });
    return Object.entries(counts).sort((a,b)=> b[1]-a[1]);
  }

  // ---- Build filter UI ----
  const filterGroupsEl = document.getElementById('filterGroups');

  // Registry of count <span> elements, keyed by field then value, so filter
  // changes can update the displayed counts in place instead of rebuilding
  // the whole filter list (which would lose scroll position / focus).
  const COUNT_ELS = { __modelGroup__: {} };
  MULTI_FIELDS.forEach(f => { COUNT_ELS[f.key] = {}; });
  const CLEAR_BTNS = {};

  function buildModelTree(container){
    // Group -> variants, both sorted by frequency.
    const groups = {};
    DATA.forEach(r => {
      const g = r.Modellgruppe || 'Sonstige';
      (groups[g] = groups[g] || {})[r.Modell] = (groups[g][r.Modell] || 0) + 1;
    });
    const groupOrder = Object.entries(groups)
      .map(([g, variants]) => [g, variants, Object.values(variants).reduce((a, b) => a + b, 0)])
      .sort((a, b) => b[2] - a[2]);

    const labelRow = document.createElement('div');
    labelRow.className = 'field-label-row';
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = 'Modell (nach Antrieb gruppiert)';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'field-clear';
    clearBtn.textContent = 'Leeren';
    clearBtn.hidden = true;
    clearBtn.addEventListener('click', () => {
      state.Modell.clear();
      document.querySelectorAll('.model-variants input[type=checkbox]').forEach(cb => cb.checked = false);
      syncModelGroupBoxes();
      render();
    });
    labelRow.appendChild(label);
    labelRow.appendChild(clearBtn);
    container.appendChild(labelRow);
    CLEAR_BTNS.Modell = clearBtn;

    groupOrder.forEach(([groupName, variants, total]) => {
      const variantNames = Object.entries(variants).sort((a, b) => b[1] - a[1]);

      const wrap = document.createElement('div');
      wrap.className = 'model-group';

      const head = document.createElement('label');
      head.className = 'model-group-head';

      const gcb = document.createElement('input');
      gcb.type = 'checkbox';
      gcb.dataset.group = groupName;

      const gname = document.createElement('span');
      gname.textContent = groupName;

      const gcount = document.createElement('span');
      gcount.className = 'count';
      gcount.textContent = total;
      COUNT_ELS.__modelGroup__[groupName] = gcount;

      head.appendChild(gcb);
      head.appendChild(gname);

      // Only offer the expander where there is more than one variant.
      const variantsBox = document.createElement('div');
      variantsBox.className = 'model-variants';

      if (variantNames.length > 1){
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'model-group-toggle';
        toggle.textContent = `${variantNames.length} Varianten ▾`;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const open = variantsBox.classList.toggle('open');
          toggle.textContent = `${variantNames.length} Varianten ${open ? '▴' : '▾'}`;
          toggle.setAttribute('aria-expanded', String(open));
        });
        head.appendChild(toggle);
      }

      head.appendChild(gcount);
      wrap.appendChild(head);

      variantNames.forEach(([name, count]) => {
        const id = 'chk_Modell_' + name.replace(/[^a-zA-Z0-9]/g, '');
        const lbl = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = id;
        cb.dataset.field = 'Modell';
        cb.dataset.value = name;
        cb.dataset.group = groupName;
        cb.addEventListener('change', () => {
          if (cb.checked) state.Modell.add(name);
          else state.Modell.delete(name);
          syncModelGroupBoxes();
          render();
        });
        const txt = document.createElement('span');
        txt.textContent = name.replace(/^Skoda\s+/, '');
        const cnt = document.createElement('span');
        cnt.className = 'count';
        cnt.textContent = count;
        COUNT_ELS.Modell[name] = cnt;
        lbl.appendChild(cb);
        lbl.appendChild(txt);
        lbl.appendChild(cnt);
        variantsBox.appendChild(lbl);
      });

      // Ticking the group is a shortcut for ticking every variant inside it.
      gcb.addEventListener('change', () => {
        variantNames.forEach(([name]) => {
          if (gcb.checked) state.Modell.add(name);
          else state.Modell.delete(name);
          const el = document.getElementById('chk_Modell_' + name.replace(/[^a-zA-Z0-9]/g, ''));
          if (el) el.checked = gcb.checked;
        });
        syncModelGroupBoxes();
        render();
      });

      wrap.appendChild(variantsBox);
      container.appendChild(wrap);
    });
  }

  function syncModelGroupBoxes(){
    document.querySelectorAll('.model-group-head input[data-group]').forEach(gcb => {
      const group = gcb.dataset.group;
      const kids = [...document.querySelectorAll(`.model-variants input[data-group="${group}"]`)];
      const checked = kids.filter(k => k.checked).length;
      gcb.checked = checked > 0 && checked === kids.length;
      gcb.indeterminate = checked > 0 && checked < kids.length;
    });
  }

  function buildMultiGroup(){
    const details = document.createElement('details');
    details.className = 'filter-group';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Land, Modell, Farbe & Felgen';
    details.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'filter-group-body';

    MULTI_FIELDS.forEach(f => {
      const wrap = document.createElement('div');

      if (f.key === 'Modell'){
        buildModelTree(wrap);
        body.appendChild(wrap);
        return;
      }

      const labelRow = document.createElement('div');
      labelRow.className = 'field-label-row';
      const label = document.createElement('span');
      label.className = 'field-label';
      label.textContent = f.label;
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'field-clear';
      clearBtn.textContent = 'Leeren';
      clearBtn.hidden = true;
      clearBtn.addEventListener('click', () => {
        state[f.key].clear();
        checkWrap.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
        render();
      });
      labelRow.appendChild(label);
      labelRow.appendChild(clearBtn);
      wrap.appendChild(labelRow);
      CLEAR_BTNS[f.key] = clearBtn;

      const checkWrap = document.createElement('div');
      checkWrap.className = 'multi-check';
      const values = distinctValues(f.key);
      values.forEach(([val, count]) => {
        const id = 'chk_' + f.key + '_' + val.replace(/[^a-zA-Z0-9]/g,'');
        const lbl = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = id;
        cb.dataset.field = f.key;
        cb.dataset.value = val;
        cb.addEventListener('change', () => {
          if (cb.checked) state[f.key].add(val);
          else state[f.key].delete(val);
          render();
        });
        const txt = document.createElement('span');
        // Country rows carry a small flag so they are recognisable at a glance.
        if (f.key === 'Land' && FLAGS[val]){
          txt.className = 'flag-cell';
          txt.innerHTML = flagFor(val) + '<span>' + val + '</span>';
        } else {
          txt.textContent = val;
        }
        const cnt = document.createElement('span');
        cnt.className = 'count';
        cnt.textContent = count;
        COUNT_ELS[f.key][val] = cnt;
        lbl.appendChild(cb);
        lbl.appendChild(txt);
        lbl.appendChild(cnt);
        checkWrap.appendChild(lbl);
      });
      wrap.appendChild(checkWrap);
      body.appendChild(wrap);
    });

    details.appendChild(body);
    filterGroupsEl.appendChild(details);
  }

  function buildBoolGroup(){
    const details = document.createElement('details');
    details.className = 'filter-group';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Pakete & Einzeloptionen';
    details.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'filter-group-body';

    const grid = document.createElement('div');
    grid.className = 'bool-grid';

    BOOL_FIELDS.forEach(f => {
      const wrap = document.createElement('div');
      wrap.className = 'bool-field';
      const label = document.createElement('span');
      label.className = 'field-label';
      label.textContent = f.label;
      wrap.appendChild(label);

      const sel = document.createElement('select');
      sel.className = 'tri-select';
      ['Alle', 'Ja', 'Nein'].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt === 'Alle' ? 'alle' : opt;
        o.textContent = opt;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        state[f.key] = sel.value;
        render();
      });
      sel.dataset.field = f.key;
      wrap.appendChild(sel);
      enhanceSelect(sel);
      grid.appendChild(wrap);
    });

    body.appendChild(grid);
    details.appendChild(body);
    filterGroupsEl.appendChild(details);
  }

  function buildDateRangeGroup(){
    const details = document.createElement('details');
    details.className = 'filter-group';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Bestellzeitraum';
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'filter-group-body';

    const labelsWrap = document.createElement('div');
    labelsWrap.className = 'date-range-labels';
    labelsWrap.innerHTML = `
      <div><span class="lbl">Von</span><span id="dateFromLabel"></span></div>
      <div style="text-align:right;"><span class="lbl">Bis</span><span id="dateToLabel"></span></div>
    `;
    body.appendChild(labelsWrap);

    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'range-slider';
    sliderWrap.innerHTML = `
      <div class="track-bg"></div>
      <div class="track-fill" id="dateTrackFill"></div>
    `;
    const inputFrom = document.createElement('input');
    inputFrom.type = 'range'; inputFrom.id = 'dateFrom';
    // Slider bounds stay at the true data extent so the full history remains
    // reachable; only the initial value reflects the default range.
    inputFrom.min = DATE_MIN; inputFrom.max = DATE_MAX; inputFrom.step = DAY_MS;
    inputFrom.value = state.dateRange[0];

    const inputTo = document.createElement('input');
    inputTo.type = 'range'; inputTo.id = 'dateTo';
    inputTo.min = DATE_MIN; inputTo.max = DATE_MAX; inputTo.step = DAY_MS;
    inputTo.value = state.dateRange[1];

    sliderWrap.appendChild(inputFrom);
    sliderWrap.appendChild(inputTo);
    body.appendChild(sliderWrap);

    function onSlide(){
      let from = parseInt(inputFrom.value, 10);
      let to = parseInt(inputTo.value, 10);
      if (from > to){ [from, to] = [to, from]; }
      state.dateRange = [from, to];
      updateDateUI();
      render();
    }
    inputFrom.addEventListener('input', onSlide);
    inputTo.addEventListener('input', onSlide);

    details.appendChild(body);
    filterGroupsEl.appendChild(details);
  }

  function updateDateUI(){
    const [from, to] = state.dateRange;
    document.getElementById('dateFromLabel').textContent = fmtDate(from);
    document.getElementById('dateToLabel').textContent = fmtDate(to);
    const fromEl = document.getElementById('dateFrom');
    const toEl = document.getElementById('dateTo');
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
    const range = DATE_MAX - DATE_MIN || 1;
    const leftPct = ((from - DATE_MIN) / range) * 100;
    const rightPct = ((to - DATE_MIN) / range) * 100;
    const fill = document.getElementById('dateTrackFill');
    if (fill){
      fill.style.left = leftPct + '%';
      fill.style.width = Math.max(0, rightPct - leftPct) + '%';
    }
  }

  buildDateRangeGroup();
  buildMultiGroup();
  buildBoolGroup();
  updateDateUI();

  // On phones the drawer is long, so start the two big groups collapsed.
  if (window.matchMedia('(max-width: 980px)').matches){
    document.querySelectorAll('#filterGroups details').forEach((d, i) => {
      if (i > 0) d.open = false;
    });
  }

  // ---- Filter search ----
  // With 23 filter fields and some long value lists (models, colors), a
  // quick text search across all of them beats scrolling. Matching rows stay
  // visible, non-matching ones are hidden, and collapsed groups auto-expand
  // just for the duration of the search so results are never hidden behind
  // a closed <details>. Clearing the search restores whatever open/closed
  // state the groups had before.
  function initFilterSearch(){
    const input = document.getElementById('filterSearch');
    const clearBtn = document.getElementById('filterSearchClear');
    const groups = document.querySelectorAll('#filterGroups > details.filter-group');
    let openBeforeSearch = null;

    function applySearch(raw){
      const q = raw.trim().toLowerCase();
      clearBtn.hidden = !q;

      if (q && !openBeforeSearch){
        openBeforeSearch = new Map();
        groups.forEach(d => openBeforeSearch.set(d, d.open));
      } else if (!q && openBeforeSearch){
        groups.forEach(d => { d.open = openBeforeSearch.get(d); });
        openBeforeSearch = null;
      }

      // Tri-state selects (Pakete & Einzeloptionen) — match on their label.
      document.querySelectorAll('.bool-field').forEach(field => {
        const text = (field.querySelector('.field-label')?.textContent || '').toLowerCase();
        field.style.display = (!q || text.includes(q)) ? '' : 'none';
      });

      // Plain checkbox lists (Farbe, Land, Innenausstattung, Felgenname, Ausstattungslinie).
      document.querySelectorAll('.multi-check').forEach(list => {
        let anyVisible = false;
        list.querySelectorAll('label').forEach(lbl => {
          const match = !q || lbl.textContent.toLowerCase().includes(q);
          lbl.style.display = match ? '' : 'none';
          if (match) anyVisible = true;
        });
        // .multi-check IS the div matched by CSS; its field wrapper is the parent.
        if (list.parentElement) list.parentElement.style.display = (anyVisible || !q) ? '' : 'none';
      });

      // Model tree — a match on the group name keeps every variant visible;
      // a match on a variant name keeps just that variant and expands the group.
      document.querySelectorAll('.model-group').forEach(group => {
        const groupName = (group.querySelector('.model-group-head span:not(.count)')?.textContent || '').toLowerCase();
        const groupNameMatches = !q || groupName.includes(q);
        const variantsBox = group.querySelector('.model-variants');
        let anyVariantMatch = false;

        variantsBox?.querySelectorAll('label').forEach(lbl => {
          const match = groupNameMatches || lbl.textContent.toLowerCase().includes(q);
          lbl.style.display = match ? '' : 'none';
          if (match && !groupNameMatches) anyVariantMatch = true;
        });

        group.style.display = (groupNameMatches || anyVariantMatch) ? '' : 'none';
        if (q && anyVariantMatch && variantsBox) variantsBox.classList.add('open');
      });

      // Auto-open any collapsed <details> that still contains a visible match.
      if (q){
        groups.forEach(d => {
          const hasMatch = [...d.querySelectorAll('.multi-check label, .model-group, .bool-field')]
            .some(el => el.style.display !== 'none');
          if (hasMatch) d.open = true;
        });
      }
    }

    input.addEventListener('input', () => applySearch(input.value));
    clearBtn.addEventListener('click', () => {
      input.value = '';
      applySearch('');
      input.focus();
    });
  }
  initFilterSearch();

  // ---- Shareable filter links ----
  // The whole filter state is mirrored into the URL hash (replaceState, so it
  // never spams browser history) and read back on load. That turns any
  // filtered view — "all RS with tow bar" — into a link someone can send.
  function isoDate(ts){
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function parseIsoDate(s){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2]-1, +m[3]);
    return isNaN(d) ? null : d.getTime();
  }

  function stateToHash(){
    const p = new URLSearchParams();
    MULTI_FIELDS.forEach(f => {
      if (state[f.key].size) p.set(f.key, [...state[f.key]].join('|'));
    });
    BOOL_FIELDS.forEach(f => {
      if (state[f.key] !== 'alle') p.set(f.key, state[f.key]);
    });
    if (state.dateRange[0] !== DEFAULT_RANGE[0]) p.set('von', isoDate(state.dateRange[0]));
    if (state.dateRange[1] !== DEFAULT_RANGE[1]) p.set('bis', isoDate(state.dateRange[1]));
    return p.toString();
  }

  function updateUrlHash(){
    // In sandboxed previews without "allow-same-origin" (opaque origin,
    // e.g. many in-app HTML preview panels) history.replaceState() throws a
    // SecurityError. Since URL-syncing is a nice-to-have, not core
    // functionality, failing silently here keeps the rest of the dashboard
    // working instead of aborting the whole render.
    try {
      const hash = stateToHash();
      const url = hash ? `#${hash}` : location.pathname + location.search;
      history.replaceState(null, '', url);
    } catch (e) { /* opaque-origin preview context — no-op */ }
  }

  function applyHashToState(){
    let hash;
    try { hash = location.hash; } catch (e) { return; }
    if (!hash || hash.length < 2) return;
    const p = new URLSearchParams(hash.slice(1));

    MULTI_FIELDS.forEach(f => {
      const raw = p.get(f.key);
      if (!raw) return;
      raw.split('|').forEach(val => {
        if (!val) return;
        state[f.key].add(val);
        const el = document.getElementById('chk_' + f.key + '_' + val.replace(/[^a-zA-Z0-9]/g, ''));
        if (el) el.checked = true;
      });
    });
    syncModelGroupBoxes();

    BOOL_FIELDS.forEach(f => {
      const raw = p.get(f.key);
      if (raw !== 'Ja' && raw !== 'Nein') return;
      state[f.key] = raw;
      const el = document.querySelector(`select[data-field="${f.key}"]`);
      if (el) el.value = raw;
    });

    const von = parseIsoDate(p.get('von'));
    const bis = parseIsoDate(p.get('bis'));
    if (von !== null) state.dateRange[0] = Math.max(DATE_MIN, von);
    if (bis !== null) state.dateRange[1] = Math.min(DATE_MAX, bis);
    if (von !== null || bis !== null) updateDateUI();

    // A shared link about a specific configuration is exactly the case where
    // starting with the filter groups already expanded saves a tap.
    if (window.matchMedia('(max-width: 980px)').matches){
      document.querySelectorAll('#filterGroups details').forEach(d => { d.open = true; });
    }
  }

  function copyShareLink(){
    const btn = document.getElementById('copyLinkBtn');
    const url = location.href;
    const done = ok => {
      const original = btn.innerHTML;
      btn.innerHTML = ok
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Link kopiert'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Kopieren fehlgeschlagen';
      setTimeout(() => { btn.innerHTML = original; }, 1800);
    };
    if (navigator.clipboard && window.isSecureContext !== false){
      navigator.clipboard.writeText(url).then(() => done(true)).catch(() => fallbackCopy(url, done));
    } else {
      fallbackCopy(url, done);
    }
  }
  function fallbackCopy(text, done){
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      done(ok);
    } catch (e){
      done(false);
    }
  }

  applyHashToState();
  document.getElementById('copyLinkBtn').addEventListener('click', copyShareLink);

  // ---- Filtering ----
  function getFiltered(){
    return DATA.filter(r => {
      if (!inDateRange(r)) return false;
      for (const f of MULTI_FIELDS){
        const sel = state[f.key];
        if (sel.size === 0) continue;
        if (!sel.has(normalizedValue(r, f.key))) return false;
      }
      for (const f of BOOL_FIELDS){
        const sel = state[f.key];
        if (sel === 'alle') continue;
        if (r[f.key] !== sel) return false;
      }
      return true;
    });
  }

  // Same as getFiltered(), but ignores one MULTI_FIELDS field's own selection.
  // That's what makes the counts next to each checkbox reflect "how many
  // results if I also pick this value", instead of always showing the count
  // from the full, unfiltered dataset.
  function getFilteredExcept(excludeField){
    return DATA.filter(r => {
      if (!inDateRange(r)) return false;
      for (const f of MULTI_FIELDS){
        if (f.key === excludeField) continue;
        const sel = state[f.key];
        if (sel.size === 0) continue;
        if (!sel.has(normalizedValue(r, f.key))) return false;
      }
      for (const f of BOOL_FIELDS){
        const sel = state[f.key];
        if (sel === 'alle') continue;
        if (r[f.key] !== sel) return false;
      }
      return true;
    });
  }

  function updateFacetCounts(){
    MULTI_FIELDS.forEach(f => {
      const pool = getFilteredExcept(f.key);
      const counts = {};
      pool.forEach(r => {
        const v = normalizedValue(r, f.key);
        counts[v] = (counts[v] || 0) + 1;
      });

      Object.entries(COUNT_ELS[f.key]).forEach(([val, el]) => {
        const n = counts[val] || 0;
        el.textContent = n;
        el.closest('label').classList.toggle('zero', n === 0);
      });

      // The "Leeren" link next to each field only makes sense once something
      // in that field is actually selected.
      if (CLEAR_BTNS[f.key]) CLEAR_BTNS[f.key].hidden = state[f.key].size === 0;

      if (f.key === 'Modell'){
        const groupCounts = {};
        pool.forEach(r => { groupCounts[r.Modellgruppe] = (groupCounts[r.Modellgruppe] || 0) + 1; });
        Object.entries(COUNT_ELS.__modelGroup__).forEach(([grp, el]) => {
          const n = groupCounts[grp] || 0;
          el.textContent = n;
          el.closest('.model-group-head').classList.toggle('zero', n === 0);
        });
      }
    });
  }


  function stats(rows){
    const n = rows.length;
    if (n === 0) return { n:0, avg:0, median:0, min:0, max:0 };
    const times = rows.map(r => r.WartezeitTage).sort((a,b)=>a-b);
    const sum = times.reduce((a,b)=>a+b,0);
    const avg = sum / n;
    const mid = Math.floor(n/2);
    const median = n % 2 === 0 ? (times[mid-1]+times[mid])/2 : times[mid];
    return { n, avg, median, min: times[0], max: times[n-1] };
  }

  const GLOBAL_STATS = stats(DATA);

  // ---- Chips ----
  function fieldLabel(key){
    const all = [...MULTI_FIELDS, ...BOOL_FIELDS];
    const found = all.find(f => f.key === key);
    return found ? found.label : key;
  }

  function renderChips(){
    const chipsRow = document.getElementById('chipsRow');
    chipsRow.innerHTML = '';
    let any = false;

    if (state.dateRange[0] !== DEFAULT_RANGE[0] || state.dateRange[1] !== DEFAULT_RANGE[1]){
      any = true;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `<span>Zeitraum: <strong>${fmtDate(state.dateRange[0])} – ${fmtDate(state.dateRange[1])}</strong></span>`;
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.addEventListener('click', () => {
        state.dateRange = [...DEFAULT_RANGE];
        updateDateUI();
        render();
      });
      chip.appendChild(btn);
      chipsRow.appendChild(chip);
    }

    MULTI_FIELDS.forEach(f => {
      state[f.key].forEach(val => {
        any = true;
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = `<span>${fieldLabel(f.key)}: <strong>${val}</strong></span>`;
        const btn = document.createElement('button');
        btn.textContent = '✕';
        btn.addEventListener('click', () => {
          state[f.key].delete(val);
          const el = document.getElementById('chk_' + f.key + '_' + val.replace(/[^a-zA-Z0-9]/g,''));
          if (el) el.checked = false;
          if (f.key === 'Modell') syncModelGroupBoxes();
          render();
        });
        chip.appendChild(btn);
        chipsRow.appendChild(chip);
      });
    });

    BOOL_FIELDS.forEach(f => {
      if (state[f.key] !== 'alle'){
        any = true;
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = `<span>${fieldLabel(f.key)}: <strong>${state[f.key]}</strong></span>`;
        const btn = document.createElement('button');
        btn.textContent = '✕';
        btn.addEventListener('click', () => {
          state[f.key] = 'alle';
          const sel = document.querySelector(`select[data-field="${f.key}"]`);
          if (sel) sel.value = 'alle';
          render();
        });
        chip.appendChild(btn);
        chipsRow.appendChild(chip);
      }
    });

    const status = document.getElementById('filterStatus');
    if (any){
      status.textContent = 'Filter aktiv — gefilterte Auswertung unten';
      status.classList.add('active');
    } else {
      status.textContent = 'Keine Filter aktiv — Gesamtübersicht';
      status.classList.remove('active');
    }
  }

  // ---- KPI + Gauge ----
  // ---- Smooth number transitions ----
  // KPI cards and the gauge are built ONCE and then only updated in place;
  // rebuilding them from scratch every render (as before) leaves nothing to
  // animate from, since freshly-created DOM nodes have no "previous" value.
  function animateNumber(el, target, formatFn){
    const format = formatFn || (v => Math.round(v).toString());
    if (el._raf) cancelAnimationFrame(el._raf);

    if (target === null || target === undefined || Number.isNaN(target)){
      el.textContent = '–';
      delete el.dataset.val;
      return;
    }

    const prev = parseFloat(el.dataset.val);
    const from = Number.isFinite(prev) ? prev : target;
    el.dataset.val = target;

    if (from === target){ el.textContent = format(target); return; }

    const duration = 450;
    const start = performance.now();
    function tick(now){
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      el.textContent = format(from + (target - from) * eased);
      if (t < 1){ el._raf = requestAnimationFrame(tick); }
      else { el.textContent = format(target); el._raf = null; }
    }
    el._raf = requestAnimationFrame(tick);
  }

  const GAUGE = { cx: 90, cy: 78, r: 58, startAngle: -120, endAngle: 120 };
  let gaugeLastAvg = null;

  function gaugePolar(angDeg, r){
    const a = (angDeg - 90) * Math.PI / 180;
    return [GAUGE.cx + r * Math.cos(a), GAUGE.cy + r * Math.sin(a)];
  }
  function gaugeArcPath(a1, a2, r){
    const [x1, y1] = gaugePolar(a1, r);
    const [x2, y2] = gaugePolar(a2, r);
    const large = (a2 - a1) <= 180 ? 0 : 1;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }
  function gaugeAngleFor(avg){
    const range = GLOBAL_STATS.max - GLOBAL_STATS.min || 1;
    const clamped = Math.max(GLOBAL_STATS.min, Math.min(GLOBAL_STATS.max, avg || GLOBAL_STATS.min));
    const frac = (clamped - GLOBAL_STATS.min) / range;
    return GAUGE.startAngle + frac * (GAUGE.endAngle - GAUGE.startAngle);
  }

  function buildGaugeCard(){
    const card = document.createElement('div');
    card.className = 'kpi-card gauge-card';
    const fullArc = gaugeArcPath(GAUGE.startAngle, GAUGE.endAngle, GAUGE.r);
    const [minX, minY] = gaugePolar(GAUGE.startAngle, GAUGE.r + 15);
    const [maxX, maxY] = gaugePolar(GAUGE.endAngle, GAUGE.r + 15);
    const minAnchor = minX < GAUGE.cx - 4 ? 'end' : (minX > GAUGE.cx + 4 ? 'start' : 'middle');
    const maxAnchor = maxX < GAUGE.cx - 4 ? 'end' : (maxX > GAUGE.cx + 4 ? 'start' : 'middle');
    card.innerHTML = `
      <svg viewBox="0 0 180 150" width="150" height="125" role="img" aria-label="Durchschnittliche Wartezeit als Tacho">
        <defs>
          <linearGradient id="gaugeGrad" x1="${GAUGE.cx-GAUGE.r}" y1="0" x2="${GAUGE.cx+GAUGE.r}" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#d8ecf8"/>
            <stop offset="55%" stop-color="#8fa6c9"/>
            <stop offset="100%" stop-color="#4a5578"/>
          </linearGradient>
        </defs>
        <path d="${fullArc}" fill="none" stroke="${'#0d0f1a'}" stroke-width="13" stroke-linecap="round"/>
        <path d="${fullArc}" fill="none" stroke="url(#gaugeGrad)" stroke-width="9" stroke-linecap="round" opacity="0.92"/>
        <text x="${minX}" y="${minY}" text-anchor="${minAnchor}" class="gauge-tick" id="gaugeMinTick">–</text>
        <text x="${maxX}" y="${maxY}" text-anchor="${maxAnchor}" class="gauge-tick" id="gaugeMaxTick">–</text>
        <line id="gaugeNeedle" x1="${GAUGE.cx}" y1="${GAUGE.cy}" x2="${GAUGE.cx}" y2="${GAUGE.cy}" stroke="${ACCENT}" stroke-width="2.5" stroke-linecap="round" id="gaugeNeedleStroke"/>
        <circle cx="${GAUGE.cx}" cy="${GAUGE.cy}" r="6.5" fill="#05060f" stroke="${ACCENT}" stroke-width="2" id="gaugePivotRing"/>
        <circle cx="${GAUGE.cx}" cy="${GAUGE.cy}" r="2" fill="${ACCENT}" id="gaugePivotDot"/>
        <text id="gaugeValueText" x="${GAUGE.cx}" y="${GAUGE.cy + 34}" text-anchor="middle" class="gauge-value">–</text>
        <text x="${GAUGE.cx}" y="${GAUGE.cy + 50}" text-anchor="middle" class="gauge-unit">Tage Ø</text>
      </svg>
      <div class="kpi-label" style="margin-top:8px;">Ø Wartezeit (gefiltert)</div>
    `;
    return card;
  }

  function updateGauge(avg){
    const svg = document.getElementById('gaugeValArc')?.closest('svg') || document.getElementById('gaugeNeedle')?.closest('svg');
    const needle = document.getElementById('gaugeNeedle');
    const valueText = document.getElementById('gaugeValueText');
    const minTick = document.getElementById('gaugeMinTick');
    const maxTick = document.getElementById('gaugeMaxTick');
    if (!needle) return;
    if (minTick) minTick.textContent = Math.round(GLOBAL_STATS.min);
    if (maxTick) maxTick.textContent = Math.round(GLOBAL_STATS.max);

    const hasValue = avg !== null && avg !== undefined && !Number.isNaN(avg) && avg > 0;
    const fromAvg = gaugeLastAvg === null ? (hasValue ? avg : GLOBAL_STATS.min) : gaugeLastAvg;
    const toAvg = hasValue ? avg : GLOBAL_STATS.min;
    gaugeLastAvg = toAvg;

    svg.setAttribute('aria-label', hasValue
      ? `Durchschnittliche Wartezeit: ${Math.round(avg)} Tage. Skala von ${GLOBAL_STATS.min} bis ${GLOBAL_STATS.max} Tagen.`
      : 'Keine Bestellungen in der aktuellen Filterauswahl.');

    if (needle._raf) cancelAnimationFrame(needle._raf);
    const duration = 450;
    const start = performance.now();
    function tick(now){
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const curAvg = fromAvg + (toAvg - fromAvg) * eased;
      const angle = gaugeAngleFor(curAvg);
      const [nx, ny] = gaugePolar(angle, GAUGE.r - 16);
      needle.setAttribute('x2', nx);
      needle.setAttribute('y2', ny);
      valueText.textContent = hasValue ? Math.round(curAvg) : '–';
      if (t < 1){ needle._raf = requestAnimationFrame(tick); }
      else { needle._raf = null; valueText.textContent = hasValue ? Math.round(avg) : '–'; }
    }
    needle._raf = requestAnimationFrame(tick);
  }

  // Built once on init; renderKPIs() below only updates the numbers inside.
  function initKPIRow(){
    const kpiRow = document.getElementById('kpiRow');
    kpiRow.appendChild(buildGaugeCard());

    const defs = [
      { id: 'kpiOrders', label: 'Bestellungen', unit: `von ${GLOBAL_STATS.n}` },
      { id: 'kpiMedian', label: 'Median Wartezeit', unit: 'Tage' },
      { id: 'kpiMin', label: 'Kürzeste Wartezeit', unit: 'Tage' },
      { id: 'kpiMax', label: 'Längste Wartezeit', unit: 'Tage' },
    ];
    defs.forEach(d => {
      const card = document.createElement('div');
      card.className = 'kpi-card';
      card.innerHTML = `
        <div class="kpi-label">${d.label}</div>
        <div class="kpi-value mono"><span id="${d.id}">–</span><span>${d.unit}</span></div>
      `;
      kpiRow.appendChild(card);
    });
  }

  function renderKPIs(filtered){
    const s = stats(filtered);
    animateNumber(document.getElementById('kpiOrders'), s.n);
    animateNumber(document.getElementById('kpiMedian'), s.n ? s.median : null);
    animateNumber(document.getElementById('kpiMin'), s.n ? s.min : null);
    animateNumber(document.getElementById('kpiMax'), s.n ? s.max : null);
    updateGauge(s.n ? s.avg : null);
  }

  // ---- Histogram ----
  function renderHistogram(filtered){
    const svg = document.getElementById('histChart');
    // Narrower viewBox on phones keeps the chart from rendering as a flat strip,
    // since the SVG now scales proportionally rather than stretching.
    const isNarrow = window.matchMedia('(max-width: 980px)').matches;
    const W = isNarrow ? 420 : 800, H = 190, padL = isNarrow ? 28 : 34, padB = 24, padT = 10;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const binSize = 20;
    const maxDay = GLOBAL_STATS.max;
    const nBins = Math.ceil((maxDay+1) / binSize);
    const bins = new Array(nBins).fill(0);
    filtered.forEach(r => {
      const idx = Math.min(nBins-1, Math.floor(r.WartezeitTage / binSize));
      bins[idx]++;
    });
    const maxCount = Math.max(1, ...bins);
    const plotW = W - padL - 10;
    const plotH = H - padT - padB;
    const bw = plotW / nBins;

    let bars = '';
    bins.forEach((c, i) => {
      const bh = (c / maxCount) * plotH;
      const x = padL + i * bw;
      const y = padT + plotH - bh;
      const rangeFrom = i * binSize, rangeTo = rangeFrom + binSize - 1;
      const label = `${rangeFrom}–${rangeTo} Tage: ${c} Bestellung${c===1?'':'en'}`;
      bars += `<rect class="hist-bar" data-label="${escapeHtml(label)}"
        x="${x+1.5}" y="${y}" width="${Math.max(bw-3,1)}" height="${Math.max(bh,1)}" fill="${ACCENT}" opacity="0.85" rx="4"/>`;
    });

    // axis line
    let axis = `<line x1="${padL}" y1="${padT+plotH}" x2="${W-10}" y2="${padT+plotH}" stroke="rgba(199,211,234,0.09)" stroke-width="1"/>`;
    // y-axis gridlines + labels (0 / half / max) so bar heights read as real
    // counts, not just relative shapes — the biggest legibility gap this
    // chart had before.
    const yTicks = [0, Math.round(maxCount/2), maxCount];
    let yGrid = '';
    [...new Set(yTicks)].forEach(v => {
      const y = padT + plotH - (v / maxCount) * plotH;
      yGrid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-10}" y2="${y.toFixed(1)}" stroke="rgba(199,211,234,0.09)" stroke-width="1" opacity="${v===0?0:0.5}"/>`;
      yGrid += `<text x="${padL-6}" y="${(y+3).toFixed(1)}" font-size="9.5" fill="#9da7ba" text-anchor="end" font-family="JetBrains Mono, monospace">${v}</text>`;
    });
    // x labels, thinned out so they never collide on narrow screens
    let labels = '';
    const step = Math.max(1, Math.round(nBins / (isNarrow ? 5 : 8)));
    const fs = isNarrow ? 11 : 9.5;
    for (let i=0; i<nBins; i+=step){
      const x = padL + i*bw;
      labels += `<text x="${x}" y="${H-6}" font-size="${fs}" fill="#c7d3ea" font-family="JetBrains Mono, monospace">${i*binSize}</text>`;
    }

    // avg marker (global) as reference
    const gAvgX = padL + Math.min(nBins-0.01, GLOBAL_STATS.avg/binSize) * bw;
    const refLine = `<line x1="${gAvgX}" y1="${padT}" x2="${gAvgX}" y2="${padT+plotH}" stroke="#b6d9fc" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.85"/>`;

    svg.innerHTML = yGrid + bars + axis + labels + refLine;
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label',
      filtered.length
        ? `Histogramm der Wartezeit in ${binSize}-Tage-Intervallen. ${filtered.length} Bestellungen in der aktuellen Auswahl, Durchschnitt über alle Bestellungen ${Math.round(GLOBAL_STATS.avg)} Tage.`
        : 'Histogramm der Wartezeit: keine Bestellungen in der aktuellen Filterauswahl.'
    );

    // Custom hover tooltip + bar highlight (native <title> replaced for a
    // more interactive, on-brand hover state).
    const histTooltip = document.getElementById('histTooltip');
    const histWrap = document.getElementById('histChartWrap');
    svg.querySelectorAll('.hist-bar').forEach(bar => {
      bar.addEventListener('mouseenter', () => {
        bar.setAttribute('opacity', '1');
        bar.setAttribute('fill', ACCENT_DIM);
        if (!histTooltip) return;
        histTooltip.hidden = false;
        histTooltip.innerHTML = `<strong>${bar.dataset.label}</strong>`;
        const bx = parseFloat(bar.getAttribute('x')) + parseFloat(bar.getAttribute('width')) / 2;
        const by = parseFloat(bar.getAttribute('y'));
        const svgRect = svg.getBoundingClientRect();
        const wrapRect = histWrap.getBoundingClientRect();
        const px = svgRect.left - wrapRect.left + (bx / W) * svgRect.width;
        const py = svgRect.top - wrapRect.top + (by / H) * svgRect.height;
        histTooltip.style.left = `${px}px`;
        histTooltip.style.top = `${py}px`;
      });
      bar.addEventListener('mouseleave', () => {
        bar.setAttribute('opacity', '0.85');
        bar.setAttribute('fill', ACCENT);
        if (histTooltip) histTooltip.hidden = true;
      });
    });

    document.getElementById('chartLegend').innerHTML = `
      <span><span class="legend-dot" style="background:${ACCENT};"></span>Anzahl Bestellungen je Wartezeit-Bin (${binSize} Tage)</span>
      <span><span class="legend-dot" style="background:#b6d9fc;"></span>Ø Wartezeit gesamt: ${Math.round(GLOBAL_STATS.avg)} Tage</span>
    `;
  }

  // ---- Trend: average waiting time by order month ----
  function monthKey(ts){
    const d = new Date(ts);
    return d.getFullYear() * 100 + (d.getMonth() + 1); // e.g. 202603
  }
  function monthLabel(key){
    const y = Math.floor(key / 100), m = (key % 100) - 1;
    return new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' }).format(new Date(y, m, 1));
  }

  // Simple ordinary-least-squares fit over (index, value) pairs — used to
  // project the trend a few months forward. Returns null if not computable.
  function linearRegression(points){
    const n = points.length;
    if (n < 2) return null;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    points.forEach((p, i) => { sumX += i; sumY += p; sumXY += i * p; sumXX += i * i; });
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const residuals = points.map((p, i) => p - (slope * i + intercept));
    const rmse = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n);
    return { slope, intercept, rmse };
  }

  const FORECAST_MONTHS = 3;

  function renderTrendChart(filtered){
    const svg = document.getElementById('trendChart');
    const isNarrow = window.matchMedia('(max-width: 980px)').matches;
    const W = isNarrow ? 420 : 800, H = 190, padL = isNarrow ? 30 : 36, padR = 10, padB = 26, padT = 14;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const verdictEl = document.getElementById('trendVerdict');
    const tooltip = document.getElementById('trendTooltip');

    const byMonth = {};
    filtered.forEach(r => {
      const k = monthKey(r.BestelldatumTS);
      (byMonth[k] = byMonth[k] || []).push(r.WartezeitTage);
    });
    const keys = Object.keys(byMonth).map(Number).sort((a, b) => a - b);

    if (keys.length < 2){
      svg.innerHTML = '';
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Zu wenige unterschiedliche Bestellmonate für einen Trend in dieser Auswahl.');
      document.getElementById('trendLegend').innerHTML =
        `<span>Zu wenige unterschiedliche Bestellmonate für einen Trend in dieser Auswahl.</span>`;
      if (verdictEl) verdictEl.innerHTML = '';
      if (tooltip) tooltip.hidden = true;
      return;
    }

    const points = keys.map(k => {
      const vals = byMonth[k];
      return { k, avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length };
    });

    // Fit the trend over the actual months, then project it forward — this
    // is the "wird die Wartezeit höher oder niedriger?" answer the chart
    // needs to give, not just a look-back line.
    const reg = linearRegression(points.map(p => p.avg));
    const lastKey = points[points.length - 1].k;
    const forecastPoints = [];
    if (reg){
      for (let i = 1; i <= FORECAST_MONTHS; i++){
        const idx = points.length - 1 + i;
        const y = reg.slope * idx + reg.intercept;
        const [ly, lm] = [Math.floor(lastKey / 100), (lastKey % 100) - 1];
        const d = new Date(ly, lm + i, 1);
        forecastPoints.push({ k: d.getFullYear() * 100 + (d.getMonth() + 1), avg: Math.max(0, y), forecast: true });
      }
    }

    const allForRange = [...points.map(p => p.avg), ...forecastPoints.map(p => p.avg)];
    const maxAvg = Math.max(...allForRange);
    const minAvg = Math.min(...allForRange);
    const range = (maxAvg - minAvg) || 1;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const totalN = points.length + forecastPoints.length;
    const stepX = totalN > 1 ? plotW / (totalN - 1) : 0;

    const toXY = (p, i) => ({
      x: padL + i * stepX,
      y: padT + plotH - ((p.avg - minAvg) / range) * plotH,
      p,
    });
    const xy = points.map(toXY);
    const fxy = forecastPoints.map((p, i) => toXY(p, points.length + i));
    // The forecast line starts from the last real point, so the dashed
    // segment visibly continues the solid one.
    const forecastPath = fxy.length
      ? `M ${xy[xy.length-1].x.toFixed(1)} ${xy[xy.length-1].y.toFixed(1)} ` +
        fxy.map(pt => `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')
      : '';

    const path = xy.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
    const areaPath = `${path} L ${xy[xy.length-1].x.toFixed(1)} ${padT+plotH} L ${xy[0].x.toFixed(1)} ${padT+plotH} Z`;

    // Point radius scales gently with sample size so thin months don't look
    // as authoritative as months backed by many orders.
    const maxN = Math.max(...points.map(p => p.n));
    const dots = xy.map(pt => {
      const r = 2.4 + (pt.p.n / maxN) * 2.6;
      return `<circle class="trend-dot" data-i="${pt.p.__i ?? ''}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${ACCENT}"/>`;
    }).join('');
    const fdots = fxy.map(pt =>
      `<circle class="trend-dot" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.4" fill="#05060f" stroke="#9da7ba" stroke-width="2"/>`
    ).join('');

    const axis = `<line x1="${padL}" y1="${padT+plotH}" x2="${W-padR}" y2="${padT+plotH}" stroke="rgba(199,211,234,0.09)" stroke-width="1"/>`;
    // Divider marking where real data ends and the projection begins.
    const divider = fxy.length
      ? `<line x1="${xy[xy.length-1].x.toFixed(1)}" y1="${padT}" x2="${xy[xy.length-1].x.toFixed(1)}" y2="${padT+plotH}" stroke="#9da7ba" stroke-width="1" stroke-dasharray="2 3" opacity="0.45"/>`
      : '';

    const allPts = [...xy, ...fxy];
    const labelStep = Math.max(1, Math.ceil(allPts.length / (isNarrow ? 4 : 9)));
    const fs = isNarrow ? 10.5 : 9.5;
    // Greedy de-cluttering: always keep the first and last point's label
    // (the last is the most important — it's the forecast horizon), but
    // drop any candidate that would land too close in pixels to the
    // previously kept label, which is what caused overlapping text at the
    // right edge before (a regular-interval tick landing 1-2px from the
    // final, always-shown point).
    const minGapPx = isNarrow ? 34 : 42;
    const candidates = [];
    allPts.forEach((pt, i) => {
      if (i % labelStep === 0 || i === allPts.length - 1) candidates.push({ pt, i });
    });
    const kept = [];
    candidates.forEach(c => {
      const isLast = c.i === allPts.length - 1;
      const prev = kept[kept.length - 1];
      if (isLast && prev && (c.pt.x - prev.pt.x) < minGapPx){
        kept.pop(); // the previous tick is too close to the final one — drop it, not the final one
      }
      kept.push(c);
    });
    let labels = '';
    kept.forEach(({ pt }) => {
      const dim = pt.p.forecast ? ' opacity="0.65"' : '';
      labels += `<text x="${pt.x.toFixed(1)}" y="${H-8}" font-size="${fs}" fill="#c7d3ea" text-anchor="middle" font-family="JetBrains Mono, monospace"${dim}>${monthLabel(pt.p.k)}</text>`;
    });

    const yLabels = `
      <text x="${padL-6}" y="${padT+4}" font-size="9.5" fill="#9da7ba" text-anchor="end" font-family="JetBrains Mono, monospace">${Math.round(maxAvg)}</text>
      <text x="${padL-6}" y="${padT+plotH}" font-size="9.5" fill="#9da7ba" text-anchor="end" font-family="JetBrains Mono, monospace">${Math.round(minAvg)}</text>
    `;

    // Invisible wide hit-columns for mouse/touch interaction — one per real
    // + forecast point, so hovering anywhere near a point shows its tooltip
    // (small dots alone are too fiddly a target).
    const hitW = Math.max(10, stepX);
    const hitCols = allPts.map((pt, i) => {
      const label = pt.p.forecast
        ? `Prognose ${monthLabel(pt.p.k)}: ~${Math.round(pt.p.avg)} Tage`
        : `${monthLabel(pt.p.k)}: Ø ${Math.round(pt.p.avg)} Tage (${pt.p.n} Bestellung${pt.p.n===1?'':'en'})`;
      return `<rect class="trend-hit" data-x="${pt.x.toFixed(1)}" data-y="${pt.y.toFixed(1)}" data-label="${escapeHtml(label)}"
        x="${(pt.x - hitW/2).toFixed(1)}" y="${padT}" width="${hitW.toFixed(1)}" height="${plotH}" fill="transparent"/>`;
    }).join('');

    svg.innerHTML = `
      <path d="${areaPath}" fill="${ACCENT}" opacity="0.08"/>
      <path d="${path}" fill="none" stroke="${ACCENT}" stroke-width="2.2"/>
      ${forecastPath ? `<path d="${forecastPath}" fill="none" stroke="#9da7ba" stroke-width="2.2" stroke-dasharray="5 4"/>` : ''}
      ${divider}
      ${axis}
      ${dots}
      ${fdots}
      ${labels}
      ${yLabels}
      <line id="trendCrosshair" class="chart-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT+plotH}" stroke="#d8ecf8" stroke-width="1" opacity="0" />
      ${hitCols}
    `;
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label',
      `Linienverlauf der durchschnittlichen Wartezeit über ${points.length} Monate, ` +
      `von ${monthLabel(points[0].k)} (${Math.round(points[0].avg)} Tage) bis ` +
      `${monthLabel(points[points.length-1].k)} (${Math.round(points[points.length-1].avg)} Tage).` +
      (forecastPoints.length ? ` Prognose für die nächsten ${forecastPoints.length} Monate auf Basis des linearen Trends.` : '')
    );

    // ---- Interactive crosshair + tooltip ----
    const crosshair = svg.querySelector('#trendCrosshair');
    const wrap = document.getElementById('trendChartWrap');
    svg.querySelectorAll('.trend-hit').forEach(hit => {
      hit.addEventListener('mouseenter', () => {
        const x = parseFloat(hit.dataset.x), y = parseFloat(hit.dataset.y);
        crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x);
        crosshair.setAttribute('opacity', '0.18');
        if (!tooltip) return;
        tooltip.hidden = false;
        tooltip.innerHTML = `<strong>${hit.dataset.label}</strong>`;
        const svgRect = svg.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        let px = svgRect.left - wrapRect.left + (x / W) * svgRect.width;
        const py = svgRect.top - wrapRect.top + (y / H) * svgRect.height;
        px = Math.max(40, Math.min(wrapRect.width - 40, px));
        tooltip.style.left = `${px}px`;
        tooltip.style.top = `${py}px`;
      });
      hit.addEventListener('mouseleave', () => {
        crosshair.setAttribute('opacity', '0');
        if (tooltip) tooltip.hidden = true;
      });
    });

    // ---- Plain-language verdict: is the wait getting longer or shorter? ----
    if (verdictEl){
      if (!reg || points.length < 3){
        verdictEl.className = 'trend-verdict flat';
        verdictEl.innerHTML = `<span class="arrow">→</span><span class="verdict-text">Noch zu wenige Monate für eine verlässliche Trendaussage.</span>`;
      } else {
        const perMonth = reg.slope;
        const flat = Math.abs(perMonth) < 1;
        const dir = flat ? 'flat' : (perMonth > 0 ? 'up' : 'down');
        const arrow = flat ? '→' : (perMonth > 0 ? '↗' : '↘');
        const word = flat ? 'bleibt in etwa stabil' : (perMonth > 0 ? 'steigt' : 'sinkt');
        const projected = Math.round(reg.slope * (points.length - 1 + FORECAST_MONTHS) + reg.intercept);
        verdictEl.className = `trend-verdict ${dir}`;
        verdictEl.innerHTML = flat
          ? `<span class="arrow">${arrow}</span><span class="verdict-text">Die Wartezeit <b>${word}</b> (Trend über die letzten ${points.length} Monate).</span>`
          : `<span class="arrow">${arrow}</span><span class="verdict-text">Die Wartezeit <b>${word}</b> aktuell um ca. <b>${Math.abs(Math.round(perMonth))} Tage pro Monat</b>.
             Bei gleichbleibendem Trend liegt die Ø Wartezeit in ${FORECAST_MONTHS} Monaten bei etwa <b>${Math.max(0, projected)} Tagen</b>.</span>`;
      }
    }

    document.getElementById('trendLegend').innerHTML = `
      <span><span class="legend-dot" style="background:${ACCENT};"></span>Ø Wartezeit je Bestellmonat, Punktgröße = Anzahl Bestellungen</span>
      ${forecastPoints.length ? `<span><span class="legend-dot" style="background:#9da7ba;"></span>Prognose (linearer Trend, nächste ${FORECAST_MONTHS} Monate)</span>` : ''}
      <span>${points.length} Monate im gewählten Zeitraum</span>
    `;
  }

  // ---- Breakdown by Modell ----
  function renderBreakdown(filtered){
    const table = document.getElementById('breakdownTable');
    if (filtered.length === 0){
      table.innerHTML = `<tr><td class="empty-state">Keine Bestellungen für diese Filterkombination.</td></tr>`;
      return;
    }
    const groups = {};
    filtered.forEach(r => {
      const key = r.Modell || 'Unbekannt';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r.WartezeitTage);
    });
    const rows = Object.entries(groups).map(([modell, times]) => {
      const n = times.length;
      const avg = times.reduce((a,b)=>a+b,0)/n;
      return { modell, n, avg };
    }).sort((a,b) => b.avg - a.avg);

    const maxAvg = Math.max(...rows.map(r=>r.avg));

    let html = `<thead><tr><th>Modell</th><th>Anzahl</th><th>Ø Wartezeit</th><th></th></tr></thead><tbody>`;
    rows.forEach(r => {
      html += `<tr>
        <td>${r.modell}</td>
        <td class="mono">${r.n}</td>
        <td class="mono">${Math.round(r.avg)} Tage</td>
        <td>
          <div class="bar-cell">
            <div class="bar-track"><div class="bar-fill" style="width:${(r.avg/maxAvg*100).toFixed(0)}%"></div></div>
          </div>
        </td>
      </tr>`;
    });
    html += `</tbody>`;
    table.innerHTML = html;
  }

  // ---- Feature ranking: which attributes correlate most with wait time ----
  // Compares the average wait of orders WITH a given attribute against all
  // OTHERS, for every boolean option and every category of the relevant
  // categorical fields. This is a correlation view, not a causal model — the
  // intro text next to the panel says so explicitly, and stays visible.
  const RANK_MIN_N = 15;
  const RANK_CAT_FIELDS = [
    { key: 'Modellgruppe', label: 'Modell (Antrieb)' },
    { key: 'Ausstattungslinie', label: 'Ausstattungslinie' },
    { key: 'Land', label: 'Land' },
    { key: 'Innenausstattung_DesignSelection', label: 'Innenausstattung' },
    { key: 'Felgenname', label: 'Felgen' },
  ];

  function avgOf(arr){ return arr.reduce((a, b) => a + b, 0) / arr.length; }

  function computeFeatureRanking(rows){
    if (rows.length < RANK_MIN_N * 2) return [];
    const factors = [];

    BOOL_FIELDS.forEach(f => {
      const withF = rows.filter(r => r[f.key] === 'Ja');
      const withoutF = rows.filter(r => r[f.key] === 'Nein');
      if (withF.length >= RANK_MIN_N && withoutF.length >= RANK_MIN_N){
        const effect = avgOf(withF.map(r => r.WartezeitTage)) - avgOf(withoutF.map(r => r.WartezeitTage));
        factors.push({ label: f.label, effect, nA: withF.length, nB: withoutF.length });
      }
    });

    RANK_CAT_FIELDS.forEach(cf => {
      const groups = {};
      rows.forEach(r => {
        const v = normalizedValue(r, cf.key);
        if (v === UNKNOWN) return;
        (groups[v] = groups[v] || []).push(r);
      });
      Object.entries(groups).forEach(([val, group]) => {
        const rest = rows.filter(r => normalizedValue(r, cf.key) !== val);
        if (group.length < RANK_MIN_N || rest.length < RANK_MIN_N) return;
        const effect = avgOf(group.map(r => r.WartezeitTage)) - avgOf(rest.map(r => r.WartezeitTage));
        factors.push({ label: `${cf.label}: ${val}`, effect, nA: group.length, nB: rest.length });
      });
    });

    factors.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
    return factors.slice(0, 12);
  }

  function renderFeatureRanking(filtered){
    const el = document.getElementById('featureRankPanel');
    const factors = computeFeatureRanking(filtered);

    if (!factors.length){
      el.innerHTML = `<p class="lk-hint" style="color:var(--text-dim);font-size:12.5px;">
        Zu wenig Daten für diese Filterauswahl (mind. ${RANK_MIN_N} Bestellungen je Vergleichsgruppe nötig).</p>`;
      return;
    }

    const maxAbs = Math.max(...factors.map(f => Math.abs(f.effect)));
    const rows = factors.map(f => {
      const pct = (Math.abs(f.effect) / maxAbs) * 50; // half-width = one side of the zero line
      const dir = f.effect >= 0 ? 'slower' : 'faster';
      const barStyle = f.effect >= 0
        ? `left:50%; width:${pct.toFixed(1)}%;`
        : `right:50%; width:${pct.toFixed(1)}%;`;
      const sign = f.effect > 0 ? '+' : (f.effect < 0 ? '−' : '±');
      return `
        <div class="rank-row">
          <div class="rank-label">${escapeHtml(f.label)}<span class="n">${f.nA} vs. ${f.nB}</span></div>
          <div class="rank-track">
            <div class="rank-zero"></div>
            <div class="rank-bar ${dir}" style="${barStyle}"></div>
          </div>
          <div class="rank-value ${dir}">${sign}${Math.round(Math.abs(f.effect))} Tage</div>
        </div>`;
    }).join('');

    el.innerHTML = rows + `
      <div class="rank-legend">
        <span><span class="legend-dot" style="background:var(--danger);"></span>Länger als der Rest</span>
        <span><span class="legend-dot" style="background:var(--accent);"></span>Kürzer als der Rest</span>
      </div>`;
  }

  // ---- Extremes (kürzeste / längste Wartezeit) ----
  const ALL_BOOL_KEYS = BOOL_FIELDS.map(f => f.key);

  function configLines(r){
    const lines = [
      ['Modell', escapeHtml(r.Modell || '–')],
      ['Farbe', escapeHtml(r.Farbe || '–')],
      ['Innenausstattung', escapeHtml(r.Innenausstattung_DesignSelection || '–')],
      ['Felgen', escapeHtml(felgenLabel(r))],
      ['Land', landCell(r.Land)],
      ['Bestelldatum', escapeHtml(r.Bestelldatum || '–')],
    ];
    return lines;
  }

  function extremeCard(r, type){
    const isShort = type === 'short';
    const tag = isShort ? 'Kürzeste Wartezeit' : 'Längste Wartezeit';
    const rowsHtml = configLines(r).map(([k,v]) => `
      <div class="extreme-row"><span class="k">${k}</span><span class="v">${v}</span></div>
    `).join('');
    const activeOptions = ALL_BOOL_KEYS.filter(k => r[k] === 'Ja');
    const badgesHtml = activeOptions.length
      ? activeOptions.map(k => badgeHtml(k)).join('')
      : `<span class="badge">Keine Zusatzoptionen erkannt</span>`;

    return `
      <div class="extreme-card ${isShort?'short':'long'}">
        <span class="extreme-tag">${tag}</span>
        <div class="extreme-days mono">${r.WartezeitTage} Tage</div>
        <div class="extreme-rows">${rowsHtml}</div>
        <div class="extreme-badges">${badgesHtml}</div>
      </div>
    `;
  }

  function renderExtremes(filtered){
    const grid = document.getElementById('extremesGrid');
    if (filtered.length === 0){
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Keine Bestellungen für diese Filterkombination.</div>`;
      return;
    }
    const sorted = [...filtered].sort((a,b)=> a.WartezeitTage - b.WartezeitTage);
    const shortest = sorted[0];
    const longest = sorted[sorted.length-1];
    grid.innerHTML = extremeCard(shortest, 'short') + extremeCard(longest, 'long');
  }

  // ---- "Wer hat so bestellt?" ----
  // Config criteria come from the active filters. Orders are scored by how many
  // of those criteria they meet, so near-misses stay visible instead of being
  // silently filtered away — that is where the useful comparisons usually are.
  const CONFIG_FIELDS = new Set([
    ...MULTI_FIELDS.map(f => f.key),
    ...BOOL_FIELDS.map(f => f.key),
  ]);

  function activeCriteria(){
    const crit = [];
    MULTI_FIELDS.forEach(f => {
      if (state[f.key].size === 0) return;
      const sel = new Set(state[f.key]);
      crit.push({
        label: f.label,
        test: r => sel.has(normalizedValue(r, f.key)),
      });
    });
    BOOL_FIELDS.forEach(f => {
      if (state[f.key] === 'alle') return;
      const want = state[f.key];
      crit.push({
        label: f.label,
        test: r => r[f.key] === want,
      });
    });
    return crit;
  }

  function inDateRange(r){
    if (r.BestelldatumTS === null || r.BestelldatumTS === undefined) return true;
    return r.BestelldatumTS >= state.dateRange[0] && r.BestelldatumTS <= state.dateRange[1];
  }

  function userChip(r, missed){
    // Bewusst anonym: keine Benutzernamen/Profil-Links im Dashboard (Datenschutz).
    // Ein Chip zeigt nur Land + Wartezeit — genug, um die eigene Bestellung im
    // Vergleich einzuordnen, ohne eine andere Person identifizierbar zu machen.
    const diff = missed && missed.length
      ? `<span class="twin-diff">≠ ${missed.map(m => escapeHtml(m.label)).join(', ')}</span>`
      : '';
    const inner = `${flagFor(r.Land)}<span class="days">${r.WartezeitTage} Tage</span>${diff}`;
    return `<span class="twin-user">${inner}</span>`;
  }

  function bucket(title, rows, cls, showDiff){
    if (!rows.length) return '';
    const limit = cls === 'exact' ? 48 : 24;
    const shown = rows.slice(0, limit);
    const rest = rows.length - shown.length;
    const avg = Math.round(rows.reduce((a, s) => a + s.r.WartezeitTage, 0) / rows.length);
    return `
      <div class="twin-bucket ${cls}">
        <div class="twin-bucket-head">
          <span class="twin-bucket-title">${title}</span>
          <span class="twin-count">${rows.length} · Ø ${avg} Tage</span>
        </div>
        <div class="twin-users">
          ${shown.map(s => userChip(s.r, showDiff ? s.missed : null)).join('')}
          ${rest > 0 ? `<span class="twin-more">… und ${rest} weitere</span>` : ''}
        </div>
      </div>`;
  }

  // Fallback view when nothing is filtered: which configurations were ordered
  // more than once, and by whom.
  function renderClusters(el){
    const keyFields = ['Modell', 'Farbe', 'Innenausstattung_DesignSelection',
                       'Felgenname', ...BOOL_FIELDS.map(f => f.key)];
    const clusters = {};
    DATA.filter(inDateRange).forEach(r => {
      const key = keyFields.map(k => r[k] || '').join('|');
      (clusters[key] = clusters[key] || []).push(r);
    });
    const top = Object.values(clusters)
      .filter(g => g.length > 1)
      .sort((a, b) => b.length - a.length)
      .slice(0, 4);

    if (!top.length){
      el.innerHTML = `<p class="twin-hint">Setze links Filter, um Bestellungen mit passender Konfiguration zu finden.</p>`;
      return;
    }

    el.innerHTML = `
      <p class="twin-hint" style="margin:0 0 12px;">
        Setze links Filter, um Bestellungen mit passender Konfiguration zu finden.
        Ohne Filter siehst du hier die Konfigurationen, die mehrfach identisch bestellt wurden.
      </p>
      ${top.map(g => {
        const r = g[0];
        const opts = BOOL_FIELDS.filter(f => r[f.key] === 'Ja')
          .map(f => badgeHtml(f.key)).join('');
        const avg = Math.round(g.reduce((a, x) => a + x.WartezeitTage, 0) / g.length);
        return `
          <div class="twin-cluster">
            <div class="twin-cluster-config">
              <strong>${escapeHtml(r.Modell)}</strong> · ${escapeHtml(r.Farbe || '–')}
              · ${escapeHtml(r.Innenausstattung_DesignSelection || 'Innenausst. unbekannt')}
              ${r.Felgenname ? '· ' + escapeHtml(r.Felgenname) : ''}
              <div style="margin-top:6px;">${opts || '<span class="badge">Keine Zusatzoptionen erkannt</span>'}</div>
            </div>
            <div class="twin-bucket-head" style="margin-bottom:7px;">
              <span class="twin-count">${g.length}× bestellt · Ø ${avg} Tage</span>
            </div>
            <div class="twin-users">${g.slice(0, 20).map(x => userChip(x, null)).join('')}</div>
          </div>`;
      }).join('')}`;
  }

  function renderTwins(){
    const el = document.getElementById('twinPanel');
    const crit = activeCriteria();

    if (crit.length === 0){
      renderClusters(el);
      return;
    }

    const scored = DATA.filter(inDateRange).map(r => ({
      r,
      missed: crit.filter(c => !c.test(r)),
    }));

    // How many deviations still count as "similar" depends on how specific the
    // filter is. With one or two criteria a single deviation already means the
    // order has almost nothing in common, so only exact hits are shown.
    const maxMissed = crit.length <= 2 ? 0 : (crit.length <= 4 ? 1 : 2);

    const byWait = (a, b) => a.r.WartezeitTage - b.r.WartezeitTage;
    const exact = scored.filter(s => s.missed.length === 0).sort(byWait);
    const near1 = maxMissed >= 1 ? scored.filter(s => s.missed.length === 1).sort(byWait) : [];
    const near2 = maxMissed >= 2 ? scored.filter(s => s.missed.length === 2).sort(byWait) : [];

    let html = `<p class="twin-hint" style="margin:0 0 14px;">
      Verglichen wird gegen <strong>${crit.length}</strong> aktive
      ${crit.length === 1 ? 'Filterbedingung' : 'Filterbedingungen'}
      innerhalb des gewählten Bestellzeitraums.
      ${maxMissed === 0 ? ' Für Beinahe-Treffer setze mindestens drei Bedingungen.' : ''}</p>`;

    if (!exact.length && !near1.length && !near2.length){
      html += `<p class="twin-hint">Keine Bestellung passt zu dieser Kombination${maxMissed ? ' — auch nicht annähernd' : ''}.
        Nimm eine Bedingung heraus, um ähnliche Konfigurationen zu sehen.</p>`;
    } else {
      html += bucket('Exakt passend', exact, 'exact', false);
      html += bucket('Fast passend — 1 Abweichung', near1, 'near', true);
      html += bucket('Ähnlich — 2 Abweichungen', near2, 'near', true);
    }

    el.innerHTML = html;
  }

  // ---- Results table ----
  // Mirrors BOOL_FIELDS: only the two flags with a measurable wait-time
  // effect are worth a "Merkmale" badge here.
  const RESULT_BADGE_FIELDS = BOOL_FIELDS.map(f => f.key);

  function renderResults(filtered){
    const wrap = document.getElementById('resultsTable');
    document.getElementById('resultsCount').textContent = `${filtered.length} Treffer`;

    if (filtered.length === 0){
      wrap.innerHTML = `<tr><td class="empty-state">Keine Bestellungen für diese Filterkombination.</td></tr>`;
      return;
    }

    const sorted = [...filtered].sort((a,b)=> a.WartezeitTage - b.WartezeitTage);
    const shown = sorted.slice(0, 150);

    let html = `<thead><tr>
      <th>Modell</th><th>Farbe</th><th>Innenausst.</th><th>Felgen</th><th>Land</th><th>Wartezeit</th><th>Merkmale</th>
    </tr></thead><tbody>`;
    shown.forEach(r => {
      const badges = RESULT_BADGE_FIELDS.filter(k => r[k] === 'Ja')
        .map(k => badgeHtml(k)).join('');
      html += `<tr>
        <td>${escapeHtml(r.Modell||'')}</td>
        <td>${escapeHtml(r.Farbe||'')}</td>
        <td>${escapeHtml(r.Innenausstattung_DesignSelection||'–')}</td>
        <td>${escapeHtml(felgenLabel(r))}</td>
        <td>${landCell(r.Land)}</td>
        <td class="mono">${r.WartezeitTage} Tage</td>
        <td>${badges||'<span class="badge">–</span>'}</td>
      </tr>`;
    });
    html += `</tbody>`;
    wrap.innerHTML = html;
    if (filtered.length > 150){
      wrap.innerHTML += '';
      const note = document.createElement('div');
      note.className = 'empty-state';
      note.textContent = `… und ${filtered.length-150} weitere (nach kürzester Wartezeit sortiert, erste 150 angezeigt)`;
      document.getElementById('resultsTable').parentElement.appendChild(note);
    }

    // Toggle the right-edge fade only when the table actually overflows —
    // otherwise it would hint at hidden content that isn't there.
    const outer = document.getElementById('resultsTableOuter');
    const scroller = wrap.parentElement; // .results-table-wrap
    outer.classList.toggle('has-x-overflow', scroller.scrollWidth > scroller.clientWidth + 1);
  }

  // ---- Reset ----
  document.getElementById('resetBtn').addEventListener('click', () => {
    MULTI_FIELDS.forEach(f => state[f.key].clear());
    BOOL_FIELDS.forEach(f => state[f.key] = 'alle');
    state.dateRange = [...DEFAULT_RANGE];
    updateDateUI();
    document.querySelectorAll('.multi-check input[type=checkbox], .model-variants input[type=checkbox]').forEach(cb => cb.checked = false);
    document.querySelectorAll('select.tri-select').forEach(sel => sel.value = 'alle');
    syncModelGroupBoxes();
    render();
  });

  // ---- Personal lookup & delivery forecast ----
  const longDateFmt = new Intl.DateTimeFormat('de-DE',
    { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtLong = ts => longDateFmt.format(new Date(ts));

  // ---- Prediction algorithm (ported 1:1 from predict_delivery() in
  // elroq_dashboard_update.py / enyaq_dashboard_update.py) ----
  // A previous version of this file had its own, older, simpler tiered-
  // similarity implementation here that never got the refinements the
  // Python backend picked up over several rounds of backtesting (recency
  // weighting, soft country shrinkage, no trend correction, queue
  // estimate). That meant "Eigene Bestellung nachschlagen" (which shows the
  // Python-computed, logged prediction for a real open order) and the
  // "Was-wäre-wenn-Rechner" (which always ran this JS copy fresh, since a
  // hypothetical order was never logged) could show different numbers for
  // the exact same configuration — same underlying data, two different
  // algorithms. This block is now a faithful port of the Python side, kept
  // in sync deliberately (see the matching comment in the .py files).

  // Weight: Modell dominates because drivetrain/trim drives production
  // scheduling far more than any single option. Land is NOT part of this
  // score — it's handled separately as a continuous weighting factor
  // (_countryWeight below), not a similarity component, since a hard
  // cutoff there previously caused a jump in the forecast right at the
  // country-pool-size threshold.
  function _baseSimilarity(a, b){
    let score = 0, max = 0;
    const add = (w, ok) => { max += w; if (ok) score += w; };
    add(3, a.Modell === b.Modell);
    add(1, (a.Innenausstattung_DesignSelection || '') === (b.Innenausstattung_DesignSelection || ''));
    add(1, (a.Felgenname || '') === (b.Felgenname || ''));
    BOOL_FIELDS.forEach(f => add(0.6, a[f.key] === b[f.key]));
    return max ? score / max : 0;
  }

  const _RECENCY_HALFLIFE_DAYS = 120.0;
  function _recencyWeight(deltaDays){
    return Math.pow(0.5, Math.abs(deltaDays) / _RECENCY_HALFLIFE_DAYS);
  }

  // Soft shrinkage instead of a hard cutoff at 15 orders: the country-match
  // bonus grows gradually with how much same-country data exists, rather
  // than jumping abruptly between e.g. 14 and 15 orders.
  const _COUNTRY_CREDIBILITY_K = 15.0;
  const _COUNTRY_BOOST = 1.8;
  function _countryWeight(sameCountry, countryPoolSize){
    if (!sameCountry) return 1.0;
    const credibility = countryPoolSize / (countryPoolSize + _COUNTRY_CREDIBILITY_K);
    return 1.0 + credibility * _COUNTRY_BOOST;
  }

  // Weighted quantile via the midpoint/Hazen method: each point represents
  // its weight, centred on the midpoint of its cumulative weight mass. With
  // equal weights this is identical to the plain (unweighted) quantile.
  function weightedQuantile(pairs, q){
    const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
    const total = sorted.reduce((s, [, w]) => s + w, 0);
    if (total <= 0) return 0;
    const target = q * total;
    let running = 0;
    const midpoints = sorted.map(([v, w]) => {
      const m = running + w / 2;
      running += w;
      return [m, v];
    });
    if (target <= midpoints[0][0]) return midpoints[0][1];
    if (target >= midpoints[midpoints.length - 1][0]) return midpoints[midpoints.length - 1][1];
    for (let i = 1; i < midpoints.length; i++){
      const [mPrev, vPrev] = midpoints[i - 1];
      const [mCur, vCur] = midpoints[i];
      if (target <= mCur){
        const span = mCur - mPrev;
        const frac = span > 0 ? (target - mPrev) / span : 0;
        return vPrev + (vCur - vPrev) * frac;
      }
    }
    return midpoints[midpoints.length - 1][1];
  }

  // Queue-depth / throughput estimate (a supporting signal, not the main
  // comparison): how many same-Modellgruppe orders were still undelivered
  // ("ahead in the queue") as of the order date, and how fast is that queue
  // currently being worked through? ETA = depth / throughput. This reacts
  // immediately to production changes, whereas the historical comparison
  // only catches up once enough new deliveries have happened.
  function _queueEstimate(order, delivered, openOrders, nowTs,
                           minThroughputSamples = 6, throughputWindowDays = 60){
    const orderTs = order.BestelldatumTS;
    const group = order.Modellgruppe;
    const orderId = order.ID;

    const segmentDelivered = delivered.filter(r => r.Modellgruppe === group);
    const segmentOpen = openOrders.filter(r => r.Modellgruppe === group);

    let queueDepth = 0;
    for (const r of segmentDelivered){
      if (orderId != null && r.ID === orderId) continue;
      if (r.BestelldatumTS >= orderTs) continue;
      const clearTs = r.BestelldatumTS + r.WartezeitTage * DAY_MS;
      if (clearTs > orderTs) queueDepth++;
    }
    for (const r of segmentOpen){
      if (orderId != null && r.ID === orderId) continue;
      if (r.BestelldatumTS < orderTs) queueDepth++;
    }

    const windowStart = nowTs - throughputWindowDays * DAY_MS;
    const recentDeliveries = segmentDelivered.filter(r => {
      const deliveredTs = r.BestelldatumTS + r.WartezeitTage * DAY_MS;
      return deliveredTs >= windowStart && deliveredTs <= nowTs;
    });
    const nRecent = recentDeliveries.length;
    if (nRecent < minThroughputSamples) return { eta: null, confidence: 0 };

    const throughputPerDay = nRecent / throughputWindowDays;
    if (throughputPerDay <= 0) return { eta: null, confidence: 0 };

    const eta = queueDepth / throughputPerDay;
    const confidence = Math.min(0.25, nRecent / 60.0);
    return { eta, confidence };
  }

  // Main entry point: combines the weighted quantile comparison (config
  // similarity x recency x country bonus) with the queue-estimate signal.
  // No trend correction (a backtest showed it reliably makes forecasts
  // worse over the boom-bust wait-time history — see Methodik-Panel) and no
  // hard era window or similarity tiers (a backtest showed continuous
  // recency/country weighting outperforms hard cutoffs).
  function predict(order){
    const group = order.Modellgruppe;
    const orderLand = order.Land || '';
    const orderTs = order.BestelldatumTS;

    const pool = DATA.filter(r => r.Modellgruppe === group);
    if (pool.length < 5) return null;

    const countryPoolSize = pool.filter(r => (r.Land || '') === orderLand).length;

    const weighted = [];
    for (const r of pool){
      const base = _baseSimilarity(order, r);
      const sameCountry = (r.Land || '') === orderLand;
      if (base <= 0 && !sameCountry) continue;
      const recW = _recencyWeight((orderTs - r.BestelldatumTS) / DAY_MS);
      const countryW = _countryWeight(sameCountry, countryPoolSize);
      // Floor of 0.05: belonging to the same Modellgruppe counts for
      // something even if nothing else matches.
      const w = Math.max(base, 0.05) * recW * countryW;
      weighted.push([r.WartezeitTage, w, r]);
    }
    if (!weighted.length) return null;

    const valsWeights = weighted.map(([v, w]) => [v, w]);
    const totalWeight = valsWeights.reduce((s, [, w]) => s + w, 0);
    const sumSqWeight = valsWeights.reduce((s, [, w]) => s + w * w, 0);
    const effN = sumSqWeight > 0 ? (totalWeight * totalWeight) / sumSqWeight : 0;

    let median = weightedQuantile(valsWeights, 0.5);
    let p25 = weightedQuantile(valsWeights, 0.25);
    let p75 = weightedQuantile(valsWeights, 0.75);
    let p10 = weightedQuantile(valsWeights, 0.10);
    let p90 = weightedQuantile(valsWeights, 0.90);
    let p2_5 = weightedQuantile(valsWeights, 0.025);
    let p97_5 = weightedQuantile(valsWeights, 0.975);

    // Supporting queue-estimate signal, blended in only when it doesn't
    // diverge wildly from the comparison-based estimate (production isn't
    // strictly FIFO, so this is a nudge, not an override).
    const nowTs = Date.now();
    const { eta: queueEta, confidence: queueConf } = _queueEstimate(order, DATA, OPEN_ORDERS, nowTs);
    if (queueEta !== null && queueConf > 0){
      const relativeDivergence = Math.abs(queueEta - median) / Math.max(median, 1);
      const dampedConf = queueConf / (1 + relativeDivergence * relativeDivergence);
      const blendDelta = dampedConf * (queueEta - median);
      median += blendDelta; p25 += blendDelta; p75 += blendDelta;
      p10 += blendDelta; p90 += blendDelta; p2_5 += blendDelta; p97_5 += blendDelta;
    }
    median = Math.max(0, median);

    let tierLabel;
    if (countryPoolSize >= _COUNTRY_CREDIBILITY_K) tierLabel = 'gewichtete Referenzen (Land stark einbezogen)';
    else if (effN >= 20) tierLabel = 'viele gewichtete Referenzen';
    else if (effN >= 8) tierLabel = 'einige gewichtete Referenzen';
    else tierLabel = 'wenige gewichtete Referenzen';

    const eraFrom = Math.min(...weighted.map(([, , r]) => r.BestelldatumTS));
    const eraTo = Math.max(...weighted.map(([, , r]) => r.BestelldatumTS));
    const topRefs = [...weighted].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const countryScoped = countryPoolSize >= _COUNTRY_CREDIBILITY_K;

    const dateFor = d => orderTs + d * DAY_MS;
    const r25 = Math.max(0, p25), r75 = Math.max(0, p75);
    const r10 = Math.max(0, p10), r90 = Math.max(0, p90);
    const r2_5 = Math.max(0, p2_5), r97_5 = Math.max(0, p97_5);

    return {
      median: Math.round(median), p25: Math.round(r25), p75: Math.round(r75),
      p10: Math.round(r10), p90: Math.round(r90), p2_5: Math.round(r2_5), p97_5: Math.round(r97_5),
      count: weighted.length,
      tier: { label: tierLabel, quality: qualityClass(effN) },
      eraFrom, eraTo,
      dateMedian: dateFor(median),
      dateEarly: dateFor(r25), dateLate: dateFor(r75),
      dateP10: dateFor(r10), dateP90: dateFor(r90),
      dateP2_5: dateFor(r2_5), dateP97_5: dateFor(r97_5),
      refs: topRefs.map(([, , r]) => r),
      logged: false,
      countryScoped,
    };
  }

  // The dashboard-generator (Python) logs and recalculates predictions for open
  // orders at every run, using the growing pool of delivered orders: more data
  // means better accuracy over time. The original first-logged prediction stays
  // frozen (OriginalPredicted*) for accuracy-checking once delivered; the
  // current prediction (Predicted*) shown here updates daily. For delivered
  // orders, we show the original frozen prediction instead, matched against the
  // actual delivery date.
  function predictionFor(order){

    if (order.PredictedDate){
      return {
        median: order.PredictedMedianDays, p25: order.PredictedRangeLowDays,
        p75: order.PredictedRangeHighDays, count: order.ReferenceCount,
        p10: order.PredictedP10Days, p90: order.PredictedP90Days,
        p2_5: order.PredictedP2_5Days, p97_5: order.PredictedP97_5Days,
        tier: { label: order.ReferenceQualityLabel, quality: qualityClass(order.ReferenceCount) },
        eraFrom: order.ReferenceEraFrom, eraTo: order.ReferenceEraTo,
        dateMedian: order.PredictedDate, dateEarly: order.PredictedRangeLowDate,
        dateLate: order.PredictedRangeHighDate,
        dateP10: order.PredictedP10Date, dateP90: order.PredictedP90Date,
        dateP2_5: order.PredictedP2_5Date, dateP97_5: order.PredictedP97_5Date,
        refs: order.References || [],
        logged: true, loggedAt: order.LoggedAt,
        countryScoped: order.CountryScoped !== false,
      };
    }
    return predict(order);
  }

  function qualityClass(count){
    if (count >= 20) return 'q-high';
    if (count >= 10) return 'q-mid';
    return 'q-low';
  }

  // Country turned out to be the single strongest factor in the
  // feature-ranking analysis, so predictions are scoped to same-country
  // orders whenever there's enough data — this note makes that visible
  // instead of leaving it as an invisible implementation detail.
  function countryScopeNote(p, land){
    const landTxt = land ? escapeHtml(land) : 'unbekanntem Land';
    return p.countryScoped
      ? `Grundlage sind ausschließlich Bestellungen aus ${landTxt} — das Land beeinflusst die Wartezeit stärker als jede einzelne Ausstattungsoption.`
      : `Für ${landTxt} gab es zu wenige Vergleichsbestellungen, daher fließen hier alle Länder mit ein.`;
  }

  function configSummary(r){
    const opts = BOOL_FIELDS.filter(f => r[f.key] === 'Ja')
      .map(f => badgeHtml(f.key)).join('');
    return `
      <p class="lk-config">
        <strong>${escapeHtml(r.Modell)}</strong> · ${escapeHtml(r.Farbe || 'Farbe unbekannt')}
        · ${escapeHtml(r.Innenausstattung_DesignSelection || 'Innenausst. unbekannt')}
        ${r.Felgenname ? '· ' + escapeHtml(r.Felgenname) : ''}
        · bestellt am ${escapeHtml(r.Bestelldatum)} ${flagFor(r.Land)}
      </p>
      <div class="lk-badges">${opts || '<span class="badge">Keine Zusatzoptionen erkannt</span>'}</div>`;
  }

  // ---- "Gleiche Konfiguration" — everyone with an identical build, whether
  // their order has arrived yet or not. Land is deliberately NOT part of the
  // match: two people in different countries with the literal same build are
  // still the most relevant comparison, and often the most telling one given
  // how much country alone shifts waiting time.
  const CONFIG_MATCH_FIELDS = [
    'Modell', 'Farbe', 'Innenausstattung_DesignSelection', 'Felgenname',
    ...BOOL_FIELDS.map(f => f.key),
  ];

  function findSameConfigPeople(order){
    return ALL_ORDERS.filter(r => {
      if (order.ID != null && r.ID === order.ID) return false;
      return CONFIG_MATCH_FIELDS.every(k => (r[k] || '') === (order[k] || ''));
    });
  }

  function sameConfigChip(r){
    const isOpen = r.Ausgeliefert === false;
    const status = isOpen
      ? (r.PredictedDate ? `Prognose ${fmtDate(r.PredictedDate)}` : 'offen')
      : `${r.WartezeitTage} Tage`;
    const inner = `${flagFor(r.Land)}<span class="days${isOpen ? ' pending' : ''}">${status}</span>`;
    return `<span class="twin-user">${inner}</span>`;
  }

  function sameConfigBlock(order){
    const matches = findSameConfigPeople(order);
    if (!matches.length){
      return `<div class="lk-samecfg">
        <div class="lk-samecfg-head"><strong>Gleiche Konfiguration</strong></div>
        <p class="lk-sub" style="margin:0;">Bisher niemand sonst mit exakt dieser Konfiguration gefunden.</p>
      </div>`;
    }
    const deliveredN = matches.filter(r => r.Ausgeliefert !== false).length;
    const openN = matches.length - deliveredN;
    const chips = [...matches]
      .sort((a, b) => (a.Ausgeliefert === false) - (b.Ausgeliefert === false))
      .map(sameConfigChip).join('');
    return `
      <div class="lk-samecfg">
        <div class="lk-samecfg-head">
          <strong>Gleiche Konfiguration</strong>
          <span class="twin-count">${matches.length} ${matches.length === 1 ? 'Person' : 'Personen'} · ${deliveredN} ausgeliefert · ${openN} offen</span>
        </div>
        <div class="twin-users">${chips}</div>
      </div>`;
  }

  function deliveredCard(r){
    // If this order was tracked while still open, show the *logged* forecast
    // against what actually happened — that is the real accuracy check.
    // Otherwise fall back to a live comparison against similar orders.
    let historyBlock = '';
    if (r.DeviationDays !== undefined && r.DeviationDays !== null){
      const dev = r.DeviationDays;
      const word = dev < 0 ? 'früher' : (dev > 0 ? 'später' : 'genau pünktlich');
      const devTxt = dev === 0
        ? 'Die Prognose hat exakt gestimmt.'
        : `Tatsächlich <strong>${Math.abs(dev)} Tage ${word}</strong> als prognostiziert.`;
      const scopeTxt = r.CountryScoped === false
        ? ` (Basis: alle Länder, da zu wenige Bestellungen aus ${escapeHtml(r.Land || 'diesem Land')} vorlagen.)`
        : '';
      historyBlock = `
        <div class="lk-range">
          <strong>Prognose-Historie:</strong> Am ${fmtDate(r.LoggedAt)} wurde für diese Bestellung
          ${fmtLong(r.PredictedDate)} vorhergesagt (${r.PredictedMedianDays} Tage,
          auf Basis von ${r.ReferenceCount} ${r.ReferenceQualityLabel || 'Referenzen'}).${scopeTxt}
          ${devTxt}
        </div>`;
    } else {
      const p = predict(r);
      if (p){
        const diff = r.WartezeitTage - p.median;
        const word = diff < 0 ? 'schneller' : 'langsamer';
        const verdict = Math.abs(diff) < 5
          ? `Das entspricht ziemlich genau dem Schnitt vergleichbarer Bestellungen (${p.median} Tage).`
          : `Das ist <strong>${Math.abs(diff)} Tage ${word}</strong> als vergleichbare Bestellungen (${p.median} Tage).`;
        historyBlock = `<p class="lk-sub" style="margin:6px 0 0;">${verdict}
          <span style="color:var(--text-dim);">(Diese Bestellung wurde nicht als offen erfasst, daher nur ein Live-Vergleich statt einer geloggten Prognose.)</span></p>`;
      }
    }
    return `
      <div class="lk-card delivered">
        <div class="lk-head">
          <span class="lk-user">Bestellung vom ${escapeHtml(r.Bestelldatum || '–')}</span>
          <span class="lk-status">Ausgeliefert</span>
        </div>
        <div class="lk-hero">
          <span class="lk-date">${r.Lieferdatum ? escapeHtml(r.Lieferdatum) : fmtLong(r.BestelldatumTS + r.WartezeitTage * DAY_MS)}</span>
          <span class="lk-sub">nach ${r.WartezeitTage} Tagen Wartezeit</span>
        </div>
        ${historyBlock}
        ${configSummary(r)}
        ${sameConfigBlock(r)}
      </div>`;
  }

  // Renders the prediction uncertainty as three nested confidence bands
  // (50/80/95%) around the median — a compact "fan chart", the standard way
  // forecasters visualize widening uncertainty rather than a single number.
  // ---- Confidence distribution curve ----
  // Replaces an earlier flat segmented bar. That version stacked three rows
  // of chrome under a thin block (tick labels, legend, detail box), most of
  // its date ticks were dropped by collision-avoidance anyway, and a bar
  // simply doesn't read as "probability" — it looked like a progress meter.
  // This draws the actual distribution instead: a smooth density curve whose
  // area is shaded by confidence band, so the likely window is visually the
  // tall part and the tails visibly thin out. One chart, one axis, no legend
  // needed — the shading is self-explanatory once you see the shape.
  let _fanSeq = 0;

  function confidenceFanSVG(p){
    const hasWide = p.dateP2_5 != null && p.dateP97_5 != null;
    const hasMid = p.dateP10 != null && p.dateP90 != null;
    const outerFrom = hasWide ? p.dateP2_5 : p.dateEarly;
    const outerTo = hasWide ? p.dateP97_5 : p.dateLate;

    const uid = 'fan' + (++_fanSeq);
    const W = 640, H = 132;
    const padX = 14, baseY = 96, peakY = 20;
    const span = Math.max(DAY_MS, outerTo - outerFrom);
    const xFor = ts => padX + ((ts - outerFrom) / span) * (W - padX * 2);
    const daysFor = ts => Math.round((ts - p.dateMedian) / DAY_MS) + p.median;

    // Known points on the cumulative distribution. Density between any two
    // is simply how much probability mass falls in that span divided by its
    // width — a wide gap holding little probability is a flat tail, a narrow
    // gap holding a lot is the peak.
    const cdf = [];
    const push = (ts, q) => { if (ts != null) cdf.push([ts, q]); };
    push(hasWide ? p.dateP2_5 : null, 0.025);
    push(hasMid ? p.dateP10 : null, 0.10);
    push(p.dateEarly, 0.25);
    push(p.dateMedian, 0.50);
    push(p.dateLate, 0.75);
    push(hasMid ? p.dateP90 : null, 0.90);
    push(hasWide ? p.dateP97_5 : null, 0.975);
    cdf.sort((a, b) => a[0] - b[0]);

    // Density samples at interval midpoints, plus zero at both outer edges so
    // the curve lands softly on the baseline instead of ending mid-air.
    const pts = [[xFor(outerFrom), 0]];
    for (let i = 1; i < cdf.length; i++){
      const [x0, q0] = cdf[i - 1], [x1, q1] = cdf[i];
      const width = Math.max(DAY_MS, x1 - x0);
      pts.push([xFor((x0 + x1) / 2), (q1 - q0) / width]);
    }
    pts.push([xFor(outerTo), 0]);

    const maxD = Math.max(...pts.map(pt => pt[1])) || 1;
    const curve = pts.map(([x, d]) => [x, baseY - (d / maxD) * (baseY - peakY)]);

    // Catmull-Rom through the density samples, converted to cubic beziers —
    // gives a natural distribution silhouette rather than a jagged polyline.
    // Control points are clamped to the span of the two samples they sit
    // between: unclamped Catmull-Rom overshoots wherever the density changes
    // sharply, which showed up as small bumps rising out of the tails just
    // before each end — a curve implying probability the data doesn't have.
    function smoothPath(points){
      if (points.length < 2) return '';
      const clamp = (v, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
      let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
      for (let i = 0; i < points.length - 1; i++){
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1]);
        const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1]);
        d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
      }
      return d;
    }

    const strokeD = smoothPath(curve);
    const areaD = `${strokeD} L ${xFor(outerTo).toFixed(1)} ${baseY} L ${xFor(outerFrom).toFixed(1)} ${baseY} Z`;

    // The same area is painted once per confidence band, each clipped to that
    // band's x-range. Bands therefore differ only in opacity and share one
    // continuous silhouette — no seams, no stacking artefacts.
    const bands = [];
    if (hasWide) bands.push({ band: '95', from: outerFrom, to: hasMid ? p.dateP10 : p.dateEarly, op: 0.18 });
    if (hasMid) bands.push({ band: '80', from: p.dateP10, to: p.dateEarly, op: 0.40 });
    bands.push({ band: '50', from: p.dateEarly, to: p.dateLate, op: 0.92 });
    if (hasMid) bands.push({ band: '80', from: p.dateLate, to: p.dateP90, op: 0.40 });
    if (hasWide) bands.push({ band: '95', from: hasMid ? p.dateP90 : p.dateLate, to: outerTo, op: 0.18 });

    const bandLabels = {
      '50': '50 % — wahrscheinlichster Zeitraum',
      '80': '80 % — realistischer Rahmen',
      '95': '95 % — nahezu sicherer Rahmen',
    };
    // Outer bounds per band, so hovering either tail of a band reports the
    // whole band rather than just the half under the cursor.
    const bandBounds = {};
    bands.forEach(b => {
      const cur = bandBounds[b.band] || [Infinity, -Infinity];
      bandBounds[b.band] = [Math.min(cur[0], b.from), Math.max(cur[1], b.to)];
    });

    let clips = '', fills = '', hits = '';
    bands.forEach((b, i) => {
      const x1 = xFor(b.from), x2 = xFor(b.to);
      const w = Math.max(0.5, x2 - x1);
      clips += `<clipPath id="${uid}c${i}"><rect x="${x1.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}"/></clipPath>`;
      fills += `<path class="fan-fill" data-band="${b.band}" data-base-op="${b.op}" d="${areaD}" fill="#b6d9fc" opacity="${b.op}" clip-path="url(#${uid}c${i})"/>`;
      const [bf, bt] = bandBounds[b.band];
      hits += `<rect class="fan-hit" x="${x1.toFixed(1)}" y="${peakY - 8}" width="${w.toFixed(1)}" height="${baseY - peakY + 20}"
        fill="transparent" tabindex="0" role="button"
        data-band="${b.band}" data-from="${bf}" data-to="${bt}"
        data-from-days="${daysFor(bf)}" data-to-days="${daysFor(bt)}"
        data-label="${escapeHtml(bandLabels[b.band])}"
        aria-label="${escapeHtml(bandLabels[b.band] + ': ' + fmtDate(bf) + ' bis ' + fmtDate(bt))}"><title>${escapeHtml(bandLabels[b.band] + ': ' + fmtDate(bf) + ' – ' + fmtDate(bt))}</title></rect>`;
    });

    // Boundary ticks at the band edges. Only the 50 % edges are labelled by
    // default — the previous version tried to label every boundary and its
    // collision logic then silently dropped most of them, which looked
    // arbitrary. The rest are quietly marked and named on hover instead.
    let ticks = '';
    [p.dateP10, p.dateEarly, p.dateLate, p.dateP90].forEach(ts => {
      if (ts == null) return;
      const x = xFor(ts);
      ticks += `<line x1="${x.toFixed(1)}" y1="${baseY - 4}" x2="${x.toFixed(1)}" y2="${baseY + 4}" stroke="#7e8ba3" stroke-width="1"/>`;
    });

    const medX = xFor(p.dateMedian);
    const medTopY = curve.reduce((best, [x, y]) =>
      Math.abs(x - medX) < Math.abs(best[0] - medX) ? [x, y] : best, curve[0])[1];

    const axis = `<line x1="${padX}" y1="${baseY}" x2="${(W - padX).toFixed(1)}" y2="${baseY}" stroke="#5b6478" stroke-width="1"/>`;

    const edgeLabel = (ts, x, anchor) =>
      `<text x="${x.toFixed(1)}" y="${baseY + 20}" font-size="10.5" fill="#9da7ba" text-anchor="${anchor}" font-family="JetBrains Mono, monospace">${fmtDate(ts)}</text>`;

    const ariaLabel = `Prognose-Verteilung. Wahrscheinlichster Zeitraum ${fmtDate(p.dateEarly)} bis ${fmtDate(p.dateLate)}`
      + (hasWide ? `, äußerer Rahmen ${fmtDate(outerFrom)} bis ${fmtDate(outerTo)}` : '')
      + `. Wahrscheinlichster Einzeltermin ${fmtDate(p.dateMedian)}.`;

    return `
      <svg viewBox="0 0 ${W} ${H}" class="confidence-fan" role="img" aria-label="${ariaLabel}" preserveAspectRatio="xMidYMid meet">
        <defs>${clips}</defs>
        ${fills}
        <path d="${strokeD}" fill="none" stroke="#dceaf9" stroke-width="1.4" opacity="0.65"/>
        ${axis}
        ${ticks}
        <line class="fan-median" x1="${medX.toFixed(1)}" y1="${medTopY.toFixed(1)}" x2="${medX.toFixed(1)}" y2="${baseY}" stroke="#eaf4ff" stroke-width="2"/>
        <circle cx="${medX.toFixed(1)}" cy="${medTopY.toFixed(1)}" r="3.5" fill="#05060f" stroke="#eaf4ff" stroke-width="2"/>
        ${edgeLabel(outerFrom, padX, 'start')}
        ${edgeLabel(outerTo, W - padX, 'end')}
        ${hits}
      </svg>
      <div class="fan-caption">
        <span class="fan-caption-main">Wahrscheinlichster Termin: <strong>${fmtDate(p.dateMedian)}</strong> · ${p.median} Tage</span>
        <span class="fan-caption-hint">Bereich berühren für Details</span>
      </div>`;
  }

  // Wires up hover/focus interactivity for every confidence curve inside
  // `container`. Called right after the containing HTML is inserted, since
  // these charts are built as strings via innerHTML. Hovering or tapping any
  // part of a band reports that band's full range — both tails together, not
  // just the half under the cursor — in the caption line beneath the chart.
  function wireConfidenceFan(container){
    container.querySelectorAll('.confidence-fan-wrap').forEach(wrap => {
      const svg = wrap.querySelector('.confidence-fan');
      const caption = wrap.querySelector('.fan-caption');
      if (!svg || !caption) return;
      const defaultHtml = caption.innerHTML;
      const hitAreas = Array.from(svg.querySelectorAll('.fan-hit'));

      const fills = Array.from(svg.querySelectorAll('.fan-fill'));

      function clearActive(){
        hitAreas.forEach(h => h.classList.remove('active'));
        // Restore each band's own base opacity.
        fills.forEach(f => f.setAttribute('opacity', f.dataset.baseOp));
      }

      function show(hit){
        clearActive();
        const band = hit.dataset.band;
        hitAreas.filter(h => h.dataset.band === band).forEach(h => h.classList.add('active'));
        // Lift the hovered band, mute the others, so the shape being
        // described in the caption is unmistakable.
        fills.forEach(f => {
          const base = Number(f.dataset.baseOp);
          f.setAttribute('opacity', f.dataset.band === band
            ? Math.min(1, base + 0.25).toFixed(2)
            : (base * 0.35).toFixed(2));
        });
        caption.innerHTML =
          `<span class="fan-caption-main"><strong>${escapeHtml(hit.dataset.label)}</strong></span>` +
          `<span class="fan-caption-range">${fmtDate(Number(hit.dataset.from))} – ${fmtDate(Number(hit.dataset.to))}` +
          ` · ${hit.dataset.fromDays}–${hit.dataset.toDays} Tage</span>`;
      }

      hitAreas.forEach(hit => {
        hit.addEventListener('mouseenter', () => show(hit));
        hit.addEventListener('focus', () => show(hit));
        hit.addEventListener('click', () => show(hit));
      });
      svg.addEventListener('mouseleave', () => { clearActive(); caption.innerHTML = defaultHtml; });
      svg.addEventListener('focusout', e => {
        if (!svg.contains(e.relatedTarget)){ clearActive(); caption.innerHTML = defaultHtml; }
      });
    });
  }



  function openCard(r){
    const p = predictionFor(r);
    if (!p){
      return `<div class="lk-card open">
        <div class="lk-head"><span class="lk-user">Bestellung vom ${escapeHtml(r.Bestelldatum || '–')}</span>
        <span class="lk-status">Offen</span></div>
        <p class="lk-sub">Zu wenig Vergleichsdaten für eine Prognose.</p>
        ${configSummary(r)}</div>`;
    }

    const today = Date.now();
    const daysSoFar = Math.round((today - r.BestelldatumTS) / DAY_MS);
    const daysLeft = Math.round((p.dateMedian - today) / DAY_MS);

    let timing;
    if (daysLeft > 0){
      timing = `noch ca. <strong>${daysLeft} Tage</strong> — bisher ${daysSoFar} Tage gewartet`;
    } else {
      timing = `rechnerisch seit <strong>${Math.abs(daysLeft)} Tagen</strong> überfällig — bisher ${daysSoFar} Tage gewartet`;
    }

    // The forum's own expected date is user-entered; showing both side by side
    // is more honest than silently picking one.
    let forumNote = '';
    if (r.VorausLieferdatum){
      forumNote = `<div class="lk-range">Eigene Angabe im Forum: ${escapeHtml(r.VorausLieferdatum)}</div>`;
    }

    const refChips = p.refs.slice(0, 12).map(d => {
      const inner = `${flagFor(d.Land)}<span class="days">${d.WartezeitTage} Tage</span>`;
      return `<span class="twin-user">${inner}</span>`;
    }).join('');

    const loggedNote = p.logged
      ? `Diese Prognose wird täglich neu berechnet, je mehr Fahrzeuge ausgeliefert werden, desto genauer wird die Schätzung. Das Datum wurde zuletzt am ${fmtDate(p.loggedAt)} aktualisiert.`
      : `Live berechnet (für diese Bestellung liegt noch kein geloggter Wert vor).`;

    return `
      <div class="lk-card open">
        <div class="lk-head">
          <span class="lk-user">Bestellung vom ${escapeHtml(r.Bestelldatum || '–')}</span>
          <span class="lk-status">Auslieferung offen</span>
          <span class="lk-quality ${p.tier.quality}">${p.count} Referenzen</span>
        </div>
        <div class="lk-hero">
          <span class="lk-date">${fmtLong(p.dateMedian)}</span>
          <span class="lk-sub">${timing}</span>
        </div>
        <div class="lk-range">
          Wahrscheinlicher Korridor: ${fmtLong(p.dateEarly)} – ${fmtLong(p.dateLate)}
          &nbsp;·&nbsp; ${p.median} Tage Wartezeit (Spanne ${p.p25}–${p.p75})
        </div>
        <div class="confidence-fan-wrap">${confidenceFanSVG(p)}</div>
        ${forumNote}
        ${configSummary(r)}
        ${sameConfigBlock(r)}
        <div class="lk-method">
          <strong>Grundlage:</strong> ${p.count} ${p.tier.label}, bestellt zwischen
          ${fmtDate(p.eraFrom)} und ${fmtDate(p.eraTo)}. Angegeben ist der Median.
          ${countryScopeNote(p, r.Land)}
          ${loggedNote}
          <div class="lk-refs">${refChips}</div>
        </div>
      </div>`;
  }

  const GERMAN_MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli',
    'August','September','Oktober','November','Dezember'];

  function runLookup(){
    const el = document.getElementById('lookupResult');
    const modell = document.getElementById('lkModell').value;
    const dateStr = document.getElementById('lkDate').value;
    const farbe = document.getElementById('lkFarbe').value;

    if (!modell || !dateStr){
      el.innerHTML = `<div class="lk-error">Bitte mindestens Modell und Bestelldatum angeben.</div>`;
      return;
    }

    // Match against the exact same German date string the data already uses
    // (e.g. "8. Mai 2026") — avoids any timestamp/timezone arithmetic, which
    // would otherwise depend on the visitor's browser timezone.
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetLabel = `${d}. ${GERMAN_MONTHS[m - 1]} ${y}`;

    let hits = ALL_ORDERS.filter(r => r.Modell === modell && r.Bestelldatum === targetLabel);
    const beforeFarbe = hits.length;
    if (farbe && hits.length > 1){
      const narrowed = hits.filter(r => (r.Farbe || '') === farbe);
      if (narrowed.length) hits = narrowed;
    }

    if (!hits.length){
      el.innerHTML = `
        <div class="lk-error">
          Keine Bestellung mit <strong>${escapeHtml(modell)}</strong> am
          <strong>${escapeHtml(targetLabel)}</strong> gefunden.
          Prüfe, ob Modell und Datum exakt stimmen — kleine Abweichungen beim Datum
          (z.&nbsp;B. Bestellbestätigung vs. Konfigurator) sind eine häufige Ursache.
          ${OPEN_ORDERS.length === 0
            ? '<br><br>Hinweis: In dieser Datei sind nur ausgelieferte Bestellungen enthalten. Führe das Update-Skript erneut aus, damit auch offene Bestellungen nachschlagbar sind.'
            : ''}
        </div>`;
      return;
    }

    let hint = '';
    if (hits.length > 1){
      hint = `<div class="lk-hint">${hits.length} Bestellungen mit dieser Kombination gefunden` +
        (beforeFarbe > hits.length ? '' : ' — wähle oben zusätzlich eine Farbe, falls deine nicht dabei ist') +
        `. Erkenne deine an Farbe/Ausstattung in der Karte.</div>`;
    }

    hits.sort((a, b) => b.BestelldatumTS - a.BestelldatumTS);
    el.innerHTML = hint + hits.map(r => r.Ausgeliefert === false ? openCard(r) : deliveredCard(r)).join('');
    wireConfidenceFan(el);

    // Permalink to exactly this lookup — appended once, after the cards, so
    // it always reflects the combination actually searched for (not
    // per-card, since farbe/modell/datum are shared across all shown hits).
    const linkWrap = document.createElement('div');
    linkWrap.className = 'lk-permalink';
    linkWrap.innerHTML = `<button type="button" id="lkCopyLinkBtn" class="lk-copy-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07l1.5-1.5"/></svg>
      Link zu dieser Prognose kopieren
    </button>`;
    el.appendChild(linkWrap);
    document.getElementById('lkCopyLinkBtn').addEventListener('click', () => {
      const p = new URLSearchParams();
      p.set('lk_modell', modell);
      p.set('lk_datum', dateStr);
      if (farbe) p.set('lk_farbe', farbe);
      const url = `${location.origin}${location.pathname}${location.search}#${p.toString()}`;
      const btn = document.getElementById('lkCopyLinkBtn');
      const done = ok => {
        const original = btn.innerHTML;
        btn.innerHTML = ok
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Link kopiert'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Kopieren fehlgeschlagen';
        setTimeout(() => { btn.innerHTML = original; }, 1800);
      };
      if (navigator.clipboard && window.isSecureContext !== false){
        navigator.clipboard.writeText(url).then(() => done(true)).catch(() => fallbackCopy(url, done));
      } else {
        fallbackCopy(url, done);
      }
    });
  }

  function initLookup(){
    const modellSel = document.getElementById('lkModell');
    const byGroup = {};
    ALL_ORDERS.forEach(r => {
      if (!r.Modell) return;
      (byGroup[r.Modellgruppe] = byGroup[r.Modellgruppe] || new Set()).add(r.Modell);
    });
    const groupOrder = Object.entries(byGroup)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], 'de'));
    modellSel.innerHTML = '<option value="">Modell wählen…</option>' + groupOrder.map(([group, models]) => `
      <optgroup label="${escapeHtml(group)}">
        ${[...models].sort((a, b) => a.localeCompare(b, 'de'))
          .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m.replace(/^Skoda\s+/, ''))}</option>`).join('')}
      </optgroup>`).join('');

    const farbeSel = document.getElementById('lkFarbe');
    farbeSel.innerHTML = '<option value="">Farbe (optional, hilft bei mehreren Treffern)</option>' +
      distinctValues('Farbe').filter(([val]) => val !== UNKNOWN)
        .map(([val]) => `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`).join('');

    document.getElementById('lookupBtn').addEventListener('click', runLookup);
    [modellSel, document.getElementById('lkDate'), farbeSel].forEach(elm => {
      elm.addEventListener('keydown', e => { if (e.key === 'Enter') runLookup(); });
    });
    enhanceSelect(modellSel);
    enhanceSelect(farbeSel);

    // Deep-link: ?/#lk_modell=...&lk_datum=YYYY-MM-DD&lk_farbe=... pre-fills
    // and auto-runs the lookup, so someone can share a link straight to
    // their own prediction card (e.g. "schau, meine Prognose" im Forum)
    // instead of asking the recipient to retype model/date/colour.
    let hash;
    try { hash = location.hash; } catch (e) { hash = ''; }
    if (hash && hash.length > 1){
      const p = new URLSearchParams(hash.slice(1));
      const lkModell = p.get('lk_modell');
      const lkDatum = p.get('lk_datum');
      const lkFarbe = p.get('lk_farbe');
      if (lkModell && lkDatum){
        modellSel.value = lkModell;
        document.getElementById('lkDate').value = lkDatum;
        if (lkFarbe) farbeSel.value = lkFarbe;
        syncCustomSelectLabels();
        document.querySelector('.tab-btn[data-tab="lookup"]')?.click();
        runLookup();
        setTimeout(() => {
          document.getElementById('sec-persoenlich')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
    }
  }

  // ---- What-if calculator ----
  // Reuses the exact same predict()/similarity() machinery as the personal
  // lookup for open orders — a hypothetical configuration is scored the same
  // way a real one would be, just without a logged, immutable snapshot.
  function initWhatIf(){
    // Group models by drivetrain group for the <select>, mirroring the filter tree.
    const byGroup = {};
    ALL_ORDERS.forEach(r => {
      if (!r.Modell) return;
      (byGroup[r.Modellgruppe] = byGroup[r.Modellgruppe] || new Set()).add(r.Modell);
    });
    const groupOrder = Object.entries(byGroup)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0], 'de'));

    const modellSel = document.getElementById('wiModell');
    modellSel.innerHTML = groupOrder.map(([group, models]) => `
      <optgroup label="${escapeHtml(group)}">
        ${[...models].sort((a, b) => a.localeCompare(b, 'de'))
          .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m.replace(/^Skoda\s+/, ''))}</option>`).join('')}
      </optgroup>`).join('');

    const fillSelect = (id, key, includeCounts) => {
      const el = document.getElementById(id);
      distinctValues(key).forEach(([val, count]) => {
        if (val === UNKNOWN) return;
        const o = document.createElement('option');
        o.value = val;
        o.textContent = includeCounts ? `${val} (${count})` : val;
        el.appendChild(o);
      });
    };
    fillSelect('wiFarbe', 'Farbe', false);
    fillSelect('wiInnen', 'Innenausstattung_DesignSelection', false);
    fillSelect('wiFelgen', 'Felgenname', false);

    const landSel = document.getElementById('wiLand');
    distinctValues('Land').forEach(([val]) => {
      if (val === UNKNOWN) return;
      const o = document.createElement('option');
      o.value = val; o.textContent = val;
      landSel.appendChild(o);
    });

    [modellSel, document.getElementById('wiFarbe'), document.getElementById('wiInnen'),
     document.getElementById('wiFelgen'), landSel].forEach(enhanceSelect);

    const boolsWrap = document.getElementById('whatIfBools');
    BOOL_FIELDS.forEach(f => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.wiField = f.key;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(f.label));
      boolsWrap.appendChild(label);
    });

    // Default order date: today, clamped into the range the data can speak to.
    const dateInput = document.getElementById('wiDate');
    const todayIso = new Date().toISOString().slice(0, 10);
    dateInput.value = todayIso;

    document.getElementById('whatIfForm').addEventListener('submit', e => {
      e.preventDefault();
      computeWhatIf();
    });
  }

  function computeWhatIf(){
    const el = document.getElementById('whatIfResult');
    const modell = document.getElementById('wiModell').value;
    const dateVal = document.getElementById('wiDate').value;
    if (!modell || !dateVal){
      el.innerHTML = `<div class="lk-error">Bitte mindestens Modell und Bestelldatum angeben.</div>`;
      return;
    }

    const [y, m, d] = dateVal.split('-').map(Number);
    const orderTs = new Date(y, m - 1, d).getTime();

    const order = {
      Modell: modell,
      Modellgruppe: model_group_lookup(modell),
      BestelldatumTS: orderTs,
      Land: document.getElementById('wiLand').value,
      Farbe: document.getElementById('wiFarbe').value,
      Innenausstattung_DesignSelection: document.getElementById('wiInnen').value,
      Felgenname: document.getElementById('wiFelgen').value,
    };
    BOOL_FIELDS.forEach(f => {
      const cb = document.querySelector(`#whatIfBools input[data-wi-field="${f.key}"]`);
      order[f.key] = cb && cb.checked ? 'Ja' : 'Nein';
    });

    const p = predict(order);
    if (!p){
      el.innerHTML = `<div class="lk-error">Zu wenig Vergleichsdaten für diese Konfiguration.</div>`;
      return;
    }

    const today = Date.now();
    const isFuture = orderTs > today;
    const daysUntil = Math.round((p.dateMedian - today) / DAY_MS);

    let timing;
    if (isFuture){
      timing = `Bestellung am ${fmtLong(orderTs)} → erwartetes Datum liegt ca. ${p.median} Tage später.`;
    } else if (daysUntil > 0){
      timing = `Bei Bestellung heute wäre der Median in ca. <strong>${daysUntil} Tagen</strong> erreicht.`;
    } else {
      timing = `Der berechnete Zeitpunkt läge bereits ${Math.abs(daysUntil)} Tage in der Vergangenheit — mit dieser Konfiguration ist die Wartezeit historisch eher kurz.`;
    }

    const refChips = p.refs.slice(0, 12).map(d => {
      const inner = `${flagFor(d.Land)}<span class="days">${d.WartezeitTage} Tage</span>`;
      return `<span class="twin-user">${inner}</span>`;
    }).join('');

    const opts = BOOL_FIELDS.filter(f => order[f.key] === 'Ja')
      .map(f => badgeHtml(f.key)).join('');

    el.innerHTML = `
      <div class="lk-card open">
        <div class="lk-head">
          <span class="lk-user">Hypothetische Konfiguration</span>
          <span class="lk-status">Prognose</span>
          <span class="lk-quality ${p.tier.quality}">${p.count} Referenzen</span>
        </div>
        <div class="lk-hero">
          <span class="lk-date">${fmtLong(p.dateMedian)}</span>
          <span class="lk-sub">${p.median} Tage Wartezeit (Median)</span>
        </div>
        <div class="lk-range">
          Wahrscheinlicher Korridor: ${fmtLong(p.dateEarly)} – ${fmtLong(p.dateLate)}
          &nbsp;·&nbsp; Spanne ${p.p25}–${p.p75} Tage
        </div>
        <div class="confidence-fan-wrap">${confidenceFanSVG(p)}</div>
        <p class="lk-sub" style="margin:10px 0 0;">${timing}</p>
        <p class="lk-config">
          <strong>${escapeHtml(modell)}</strong>
          ${order.Farbe ? '· ' + escapeHtml(order.Farbe) : ''}
          ${order.Innenausstattung_DesignSelection ? '· ' + escapeHtml(order.Innenausstattung_DesignSelection) : ''}
          ${order.Felgenname ? '· ' + escapeHtml(order.Felgenname) : ''}
          · Bestelldatum ${fmtDate(orderTs)} ${flagFor(order.Land)}
        </p>
        <div class="lk-badges">${opts || '<span class="badge">Keine Zusatzoptionen ausgewählt</span>'}</div>
        ${sameConfigBlock(order)}
        <div class="lk-method">
          <strong>Grundlage:</strong> ${p.count} ${p.tier.label}, bestellt zwischen
          ${fmtDate(p.eraFrom)} und ${fmtDate(p.eraTo)}. Angegeben ist der Median.
          ${countryScopeNote(p, order.Land)}
          Diese Prognose wird bei jeder Berechnung neu ermittelt und nicht geloggt.
          <div class="lk-refs">${refChips}</div>
        </div>
      </div>`;
    wireConfidenceFan(el);
  }

  function model_group_lookup(modell){
    const hit = ALL_ORDERS.find(r => r.Modell === modell);
    return hit ? hit.Modellgruppe : '';
  }

  // ---- Methodik-Panel: Rueckblick-Test + Segment-Genauigkeit + Daten-Guete ----
  function fmtPct(x){ return `${Math.round(x*100)}%`; }
  function fmtSigned(x){ return `${x > 0 ? '+' : ''}${x.toFixed(1)}`; }

  function segmentTable(rows, keyLabel){
    if (!rows || !rows.length){
      return `<p class="empty-state">Noch keine Segmente mit ausreichend Datengrundlage (mind. 12 Bestellungen).</p>`;
    }
    let html = `<table class="methodik-table"><thead><tr>
      <th>${keyLabel}</th><th>Anzahl</th><th>Ø Abweichung</th><th>Vorherige Methode</th><th>Tendenz</th>
    </tr></thead><tbody>`;
    rows.forEach(r => {
      const better = r.old_mae != null && r.new_mae < r.old_mae;
      const worse = r.old_mae != null && r.new_mae > r.old_mae;
      html += `<tr>
        <td>${escapeHtml(r.key)}</td>
        <td class="mono">${r.n}</td>
        <td class="mono ${better ? 'good' : (worse ? 'bad' : '')}">${r.new_mae} Tage</td>
        <td class="mono" style="color:var(--text-dim);">${r.old_mae != null ? r.old_mae + ' Tage' : '–'}</td>
        <td class="mono">${fmtSigned(r.new_bias)} Tage</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    return html;
  }

  function renderMethodikPanel(){
    const el = document.getElementById('methodikPanel');
    if (!el) return;
    const bt = METHODOLOGY.backtest;
    const dq = METHODOLOGY.data_quality;

    if (!bt || !bt.new){
      el.innerHTML = `<p class="empty-state">Für den Rückblick-Test liegen noch nicht genug historische Daten vor.</p>`;
      return;
    }

    const n = bt.new;
    const o = bt.old;

    // Plain-language framing of what used to be shown as a raw signed
    // "Bias" number — most visitors have no reason to know that word, and
    // "+40.7" on its own doesn't say whether that's good, bad, or which
    // direction it even points in.
    const absBias = Math.round(Math.abs(n.bias));
    const biasSentence = absBias < 5
      ? `Die Prognose schätzt im Schnitt weder spürbar zu kurz noch zu lang.`
      : `Die Prognose schätzt im Schnitt <strong>${absBias} Tage zu ${n.bias > 0 ? 'kurz' : 'lang'}</strong> —
         in der Praxis wartest du eher etwas ${n.bias > 0 ? 'länger' : 'kürzer'}, als angezeigt wird.`;

    const dataQualityNote = dq && dq.entfernt_rate != null
      ? `<p class="methodik-caveat-inline">
           <strong>Kleiner Vorbehalt:</strong> ${fmtPct(dq.entfernt_rate)} der beobachteten offenen Bestellungen
           (${dq.entfernt_count} von ${dq.entfernt_count + dq.eingetroffen_count}) sind ohne erkennbare Lieferung
           aus der Forumsliste verschwunden — vermutlich meist Stornierungen. Falls davon eher besonders langsame
           Bestellungen betroffen sind, könnten die Zahlen oben minimal zu optimistisch aussehen.
         </p>`
      : `<p class="methodik-caveat-inline">
           <strong>Kleiner Vorbehalt:</strong> Aus der Forumsliste verschwundene Bestellungen (z.&nbsp;B. Stornierungen)
           werden aktuell noch nicht separat erfasst. Sollte sich das mit mehr Datenpunkten ändern, erscheint hier
           automatisch eine Einschätzung.
         </p>`;

    // Status der Survivorship-Korrektur: wird bei jedem Build neu gegen die
    // juengere Historie geprueft, statt fest ein- oder ausgeschaltet zu sein.
    const cc = METHODOLOGY.censoring_correction;
    const censoringNote = (cc && cc.on && cc.off)
      ? `<p class="methodik-intro-sub">
           <strong style="color:var(--text-body);">Survivorship-Korrektur: ${cc.decision === 'an' ? 'aktiv' : 'inaktiv'}.</strong>
           Bereits ausgelieferte Vergleichsbestellungen sind zwangsläufig die, die es schon geschafft haben —
           die langsamen sind noch offen und fehlen im Vergleich, wodurch Prognosen zu kurz ausfallen können.
           Ein statistisches Standardverfahren (Kaplan-Meier) rechnet die noch offenen Bestellungen korrekt mit ein.
           Bei jedem Update wird an der jüngeren Hälfte der Historie geprüft, ob das hier tatsächlich hilft:
           ohne Korrektur ${cc.off.mae} Tage Ø Abweichung (Tendenz ${fmtSigned(cc.off.bias)}),
           mit Korrektur ${cc.on.mae} Tage (Tendenz ${fmtSigned(cc.on.bias)}) —
           deshalb ist sie aktuell <strong style="color:var(--text-body);">${cc.decision}</strong>.
         </p>`
      : '';

    const oldComparisonNote = o
      ? `<p class="methodik-intro-sub">Insgesamt lag die aktuelle Methode bei ${n.mae} Tagen Ø Abweichung
           gegenüber ${o.mae} Tagen bei der alten Methode (${n.n} getestete Bestellungen) — der Hauptvorteil zeigt
           sich aber weniger in dieser Gesamtzahl als darin, dass die alte Methode an Länder- und Datumsgrenzen
           harte Sprünge in der Prognose verursachte, die die neue Methode vermeidet.</p>`
      : '';

    el.innerHTML = `
      <p class="methodik-intro">
        Wir haben die Prognose an <strong>${bt.n_tested} bereits ausgelieferten Bestellungen</strong> im Nachhinein
        getestet: so getan, als wäre jede davon an ihrem eigenen Bestelldatum noch offen gewesen — nur mit den Daten,
        die zu diesem Zeitpunkt tatsächlich vorlagen — und verglichen, was die Prognose gesagt hätte mit dem, was
        wirklich passiert ist.
      </p>

      <div class="methodik-headline">
        <div class="methodik-headline-num">± ${n.mae} Tage</div>
        <div class="methodik-headline-lbl">so weit liegt die Prognose typischerweise neben der tatsächlichen Wartezeit</div>
      </div>
      <p class="methodik-intro">
        ${biasSentence} Bei Wartezeiten, die oft mehrere Monate dauern, ist das eine grobe Orientierung für die
        Planung — keine Punktlandung. In <strong>${fmtPct(n.within14)}</strong> der getesteten Fälle lag die Prognose
        sogar innerhalb von zwei Wochen der Wahrheit; bei einer typischen Wartezeit von mehreren Monaten ist ein so
        enges Zwei-Wochen-Fenster allerdings ein strenger Maßstab, kein Bestehen-oder-Durchfallen-Kriterium.
      </p>

      <p class="methodik-subhead">So kommt die Prognose zustande</p>
      <ul class="methodik-explainer">
        <li>Wir suchen Bestellungen mit möglichst <strong>ähnlicher Konfiguration</strong> — vor allem gleiches Modell, dazu Innenausstattung und Felgen.</li>
        <li>Bestellungen aus <strong>deinem Land</strong> zählen stärker, sobald genug davon vorliegen — das Land beeinflusst die Wartezeit oft mehr als jede einzelne Ausstattungsoption.</li>
        <li><strong>Neuere</strong> Vergleichsbestellungen wiegen schwerer als sehr alte, weil sich Wartezeiten über die Zeit spürbar verschieben.</li>
        <li>Aus den passendsten Vergleichsbestellungen berechnen wir den <strong>wahrscheinlichsten Wert</strong> plus eine Bandbreite für die Unsicherheit — zu sehen im Diagramm bei jeder Einzelprognose.</li>
      </ul>

      ${dataQualityNote}

      <details class="methodik-details">
        <summary>Technische Details &amp; Zahlen nach Modell/Land</summary>
        <div class="methodik-details-body">
          ${censoringNote}
          ${o ? `${oldComparisonNote}` : ''}

          <p class="methodik-subhead">Genauigkeit nach Modell</p>
          ${segmentTable(bt.segments.Modellgruppe, 'Modell')}

          <p class="methodik-subhead">Genauigkeit nach Land</p>
          ${segmentTable(bt.segments.Land, 'Land')}
        </div>
      </details>
    `;
  }

  function renderAccuracyPanel(){
    const el = document.getElementById('accuracyPanel');
    const resolved = ALL_ORDERS.filter(r => r.DeviationDays !== undefined && r.DeviationDays !== null);
    if (!resolved.length){
      el.innerHTML = '';
      return;
    }
    const mae = resolved.reduce((a, r) => a + Math.abs(r.DeviationDays), 0) / resolved.length;
    const within2w = resolved.filter(r => Math.abs(r.DeviationDays) <= 14).length / resolved.length;
    const early = resolved.filter(r => r.DeviationDays < 0).length;
    const late = resolved.filter(r => r.DeviationDays > 0).length;
    // Signed mean (not absolute) reveals a *systematic* bias rather than just
    // scatter — but with only a handful of real resolved predictions so far,
    // a single outlier can swing this a lot. We say so explicitly and point
    // to the Methodik-Sektion's backtest (hundreds of simulated predictions)
    // for a statistically meaningful picture instead of over-reading this.
    const meanSigned = resolved.reduce((a, r) => a + r.DeviationDays, 0) / resolved.length;
    const lowN = resolved.length < 20;
    const biasNote = Math.abs(meanSigned) >= 5
      ? `<div class="accuracy-bias ${meanSigned > 0 ? 'over' : 'under'}">
           Systematische Tendenz: Prognosen liegen im Schnitt <strong>${Math.abs(Math.round(meanSigned))} Tage
           ${meanSigned > 0 ? 'zu spät' : 'zu früh'}</strong> (${meanSigned > 0 ? 'Wartezeit tatsächlich länger' : 'Wartezeit tatsächlich kürzer'} als vorhergesagt).
           ${lowN
             ? `Bei nur ${resolved.length} bisher aufgelösten Prognose${resolved.length===1?'':'n'} ist das noch keine verlässliche Aussage —
                der <a href="#sec-methodik">Rückblick-Test in der Methodik-Sektion</a> simuliert stattdessen hunderte Prognosen und ist dafür aussagekräftiger.`
             : ''}
         </div>`
      : '';

    el.innerHTML = `
      <div class="accuracy-wrap">
        <div class="accuracy-head">
          <span class="accuracy-title">Prognose-Genauigkeit über alle Nutzer</span>
        </div>
        <div class="accuracy-stats">
          <div class="accuracy-stat"><div class="num mono">${resolved.length}</div><div class="lbl">Aufgelöste Prognosen</div></div>
          <div class="accuracy-stat"><div class="num mono">±${Math.round(mae)}</div><div class="lbl">Mittlere Abweichung (Tage)</div></div>
          <div class="accuracy-stat"><div class="num mono">${Math.round(within2w*100)}%</div><div class="lbl">Innerhalb ±14 Tagen</div></div>
          <div class="accuracy-stat"><div class="num mono">${early} / ${late}</div><div class="lbl">Zu früh / zu spät</div></div>
        </div>
        ${biasNote}
      </div>`;
  }

  // ---- Personal-area tabs (Nachschlagen / Was-wäre-wenn) ----
  function initTabs(){
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        buttons.forEach(b => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('.tab-panel').forEach(p => {
          p.hidden = p.dataset.tabPanel !== target;
        });
      });
    });
  }

  // ---- Vehicle switcher (Elroq/Enyaq dropdown, Notion/Linear-style) ----
  function initVehicleSwitch(){
    const trigger = document.getElementById('vswitchTrigger');
    const menu = document.getElementById('vswitchMenu');
    if (!trigger || !menu) return;

    const items = [...menu.querySelectorAll('.vswitch-item')];
    items.forEach(el => el.setAttribute('aria-selected', el.classList.contains('active') ? 'true' : 'false'));

    function open(){
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      // Focus the current item so arrow keys work immediately without an
      // extra tab press, but don't steal focus from a mouse click.
      const current = items.find(el => el.classList.contains('active')) || items[0];
      current?.focus({ preventScroll: true });
    }
    function close(returnFocus){
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    }

    trigger.addEventListener('click', () => {
      menu.hidden ? open() : close(false);
    });

    document.addEventListener('click', e => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== trigger){
        close(false);
      }
    });

    document.addEventListener('keydown', e => {
      if (menu.hidden) return;
      if (e.key === 'Escape'){ close(true); return; }
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown'){
        e.preventDefault();
        (items[idx + 1] || items[0]).focus();
      } else if (e.key === 'ArrowUp'){
        e.preventDefault();
        (items[idx - 1] || items[items.length - 1]).focus();
      }
    });
  }

  initKPIRow();
  initVehicleSwitch();
  initLookup();
  initWhatIf();
  initTabs();
  renderAccuracyPanel();
  renderMethodikPanel();

  // ---- Mobile filter drawer ----
  const panelEl = document.getElementById('filterPanel');
  const backdropEl = document.getElementById('drawerBackdrop');
  const openBtn = document.getElementById('openFiltersBtn');

  function openDrawer(){
    panelEl.classList.add('open');
    backdropEl.hidden = false;
    requestAnimationFrame(() => backdropEl.classList.add('open'));
    document.body.style.overflow = 'hidden';
    openBtn.setAttribute('aria-expanded', 'true');
  }
  function closeDrawer(){
    panelEl.classList.remove('open');
    backdropEl.classList.remove('open');
    setTimeout(() => { backdropEl.hidden = true; }, 200);
    document.body.style.overflow = '';
    openBtn.setAttribute('aria-expanded', 'false');
  }

  openBtn.addEventListener('click', openDrawer);
  document.getElementById('closeFiltersBtn').addEventListener('click', closeDrawer);
  document.getElementById('applyFiltersBtn').addEventListener('click', closeDrawer);
  backdropEl.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panelEl.classList.contains('open')) closeDrawer();
  });

  function countActiveFilters(){
    let n = 0;
    MULTI_FIELDS.forEach(f => { n += state[f.key].size; });
    BOOL_FIELDS.forEach(f => { if (state[f.key] !== 'alle') n++; });
    if (state.dateRange[0] !== DEFAULT_RANGE[0] || state.dateRange[1] !== DEFAULT_RANGE[1]) n++;
    return n;
  }

  function renderMobileBar(filtered){
    const pill = document.getElementById('activeFilterCount');
    const n = countActiveFilters();
    if (n > 0){ pill.hidden = false; pill.textContent = n; }
    else { pill.hidden = true; }
    document.getElementById('mobileResultCount').textContent = `${filtered.length} von ${GLOBAL_STATS.n}`;
  }

  // ---- CSV export of the current filter selection ----
  const CSV_COLUMNS = [
    'Modell', 'Ausstattungslinie', 'Farbe', 'Land',
    'Innenausstattung_DesignSelection', 'Felgenname', 'Felgengroesse_Zoll',
    'Bestelldatum', 'Lieferdatum', 'WartezeitTage',
    ...BOOL_FIELDS.map(f => f.key),
  ];

  function csvEscape(v){
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv(){
    const filtered = getFiltered();
    if (!filtered.length) return;
    const header = CSV_COLUMNS.join(';');
    const rows = filtered.map(r => CSV_COLUMNS.map(c => csvEscape(r[c])).join(';'));
    // Leading BOM so Excel opens the umlaut-heavy content as UTF-8 by default.
    const csv = '\uFEFF' + [header, ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `elroq-bestellungen-gefiltert-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);

  // ---- Render all ----
  function render(){
    const filtered = getFiltered();
    updateUrlHash();
    updateFacetCounts();
    renderChips();
    renderMobileBar(filtered);
    renderKPIs(filtered);
    renderHistogram(filtered);
    renderTrendChart(filtered);
    renderBreakdown(filtered);
    renderFeatureRanking(filtered);
    renderExtremes(filtered);
    renderTwins();
    renderResults(filtered);
    // Custom dropdowns (see enhanceSelect) mirror the hidden native <select>
    // elements' current value in their own display box; render() runs after
    // every filter change and is the one place guaranteed to fire after any
    // programmatic sel.value = ... assignment, so re-syncing here keeps
    // every dropdown's visible label correct without needing a MutationObserver.
    syncCustomSelectLabels();
  }

  render();

  // Re-render on resize/rotation so the chart picks up the right viewBox.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderHistogram(getFiltered());
      renderTrendChart(getFiltered());
      const outer = document.getElementById('resultsTableOuter');
      const scroller = document.getElementById('resultsTable').parentElement;
      outer.classList.toggle('has-x-overflow', scroller.scrollWidth > scroller.clientWidth + 1);
    }, 150);
  });
})();
