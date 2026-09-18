/* Settings — company identity, pricing defaults, the filing profile, and the
 * import/export that keeps unit economics off the repository. */

import { load, update, exportBundle, importBundle, wipe } from '../store.js';
import { PROFILE_DEFAULTS, profile } from '../deadlines.js';
import { ROUNDING, PRICING_MODES } from '../pricing.js';
import { syncNow, parseFigures, applyFigures, syncUrlIsUsable, looksPublished, figuresTemplateCsv } from '../sync.js';
import {
  el, card, sectionTitle, button, input, select, field, sheet, closeSheet, toast,
  toFraction, toPercentInput, downloadBlob, confirmSheet,
} from '../ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function settingsView({ navigate }) {
  document.getElementById('view').dataset.volatile = 'true';
  const data = load();
  const wrap = el('div');

  wrap.appendChild(el('h1', { class: 'page-title' }, 'Settings'));
  wrap.appendChild(el('p', { class: 'page-sub' }, 'Everything here stays on this phone.'));

  wrap.appendChild(sectionTitle('Your figures'));
  wrap.appendChild(dataPanel(data, navigate));

  wrap.appendChild(sectionTitle('Sync from a sheet'));
  wrap.appendChild(syncPanel(data, navigate));

  wrap.appendChild(sectionTitle('Pricing defaults'));
  wrap.appendChild(defaultsPanel(data));

  wrap.appendChild(sectionTitle('Discount presets'));
  wrap.appendChild(presetsPanel(data));

  wrap.appendChild(sectionTitle('Company'));
  wrap.appendChild(companyPanel(data));

  wrap.appendChild(sectionTitle('Filing profile'));
  wrap.appendChild(profilePanel());

  wrap.appendChild(sectionTitle('Danger zone'));
  wrap.appendChild(
    card(
      el('p', { class: 'prose' }, 'Erase every quotation, sale and cost figure stored in this browser. Export a backup first.'),
      el('div', { class: 'btn-row' }, button('Erase everything', {
        variant: 'danger',
        onclick: async () => {
          if (!(await confirmSheet('Erase everything', 'This clears all local data on this device. There is no undo.', 'Erase'))) return;
          wipe();
          toast('All local data erased.');
          navigate('#/today');
        },
      })),
    ),
  );

  return wrap;
}

/* --------------------------------------------------------------------- data */

function dataPanel(data, navigate) {
  const financialCount = Object.keys(data.financials).length;
  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,text/csv,.json,.csv',
    style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        // A CSV straight out of Sheets and a JSON backup both land here; tell them
        // apart by content rather than by the extension, which Files often drops.
        if (/\.csv$/i.test(file.name) || !text.trim().startsWith('{')) {
          const parsed = applyFigures(parseFigures(text));
          toast(`Imported ${parsed.rows} products${parsed.skipped.length ? `, ${parsed.skipped.length} skipped` : ''}.`);
        } else {
          const summary = importBundle(text);
          toast(`Imported ${summary.financials} products, ${summary.quotes} quotes, ${summary.sales} sales.`);
        }
        // This screen opts out of auto-redraw, so refresh it by hand.
        navigate('#/settings');
      } catch (err) {
        console.error(err);
        toast(err.message || 'Could not read that file.', 'alert');
      } finally {
        e.target.value = '';
      }
    },
  });

  return card(
    el(
      'p',
      { class: 'prose' },
      financialCount
        ? `Unit economics loaded for ${financialCount} products.`
        : 'No unit economics loaded yet. Import the data file to unlock margin pricing.',
    ),
    el(
      'div',
      { class: 'btn-row' },
      button('Import', { variant: financialCount ? 'ghost' : 'primary', onclick: () => fileInput.click() }),
      button('Export backup', {
        onclick: () => {
          const bundle = exportBundle();
          update((d) => {
            d.settings.lastBackupAt = new Date().toISOString();
          });
          downloadBlob(
            new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
            `la-fuga-backup-${new Date().toISOString().slice(0, 10)}.json`,
          );
          toast('Backup saved to Files.');
        },
      }),
    ),
    fileInput,
      el('div', { class: 'btn-row' }, button('Paste figures instead', { variant: 'quiet', onclick: () => pasteSheet(() => navigate('#/settings')) })),
    el(
      'p',
      { class: 'inline-note' },
      'Takes a JSON backup or a CSV of figures. Importing merges: it tops up what is here rather than replacing it. Export regularly — this is the only copy.',
    ),
  );
}

function pasteSheet(onDone) {
  const box = el('textarea', { class: 'input', style: { minHeight: '200px', fontFamily: 'ui-monospace, monospace', fontSize: '13px' }, placeholder: '{ "kind": "lafuga-financials", ... }' });
  sheet('Paste figures', el('div', {}, field('JSON', box, 'From the data file you were sent')), {
    actions: [
      button('Import', {
        variant: 'primary',
        onclick: () => {
          try {
            const summary = importBundle(box.value.trim());
            closeSheet();
            toast(`Imported ${summary.financials} products.`);
            onDone();
          } catch (err) {
            toast(err.message || 'That is not valid JSON.', 'alert');
          }
        },
      }),
    ],
  });
}

/* --------------------------------------------------------------------- sync */

function syncPanel(data, navigate) {
  const s = data.settings;
  const urlInput = input({
    type: 'url',
    value: s.syncUrl || '',
    placeholder: 'https://docs.google.com/spreadsheets/d/e/…/pub?output=csv',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: false,
  });

  const status = el(
    'p',
    { class: 'inline-note' },
    s.lastSyncAt
      ? `Last synced ${new Date(s.lastSyncAt).toLocaleString('en-GB')} — ${s.lastSyncSummary || 'ok'}.`
      : 'Never synced.',
  );

  const autoBox = el('input', { type: 'checkbox', checked: s.syncAuto });
  autoBox.addEventListener('change', () => {
    update((d) => {
      d.settings.syncAuto = autoBox.checked;
    });
    toast(autoBox.checked ? 'Will check on open, hourly at most.' : 'Auto-sync off.');
  });

  const run = async (button) => {
    const url = urlInput.value.trim();
    if (!url) return toast('Paste the published CSV link first.', 'alert');
    if (!syncUrlIsUsable(url)) return toast('That is not an https link.', 'alert');

    update((d) => {
      d.settings.syncUrl = url;
    });

    button.disabled = true;
    button.textContent = 'Syncing…';
    try {
      const parsed = await syncNow(url);
      toast(`Synced ${parsed.rows} products.`);
      if (parsed.errors.length) console.warn('Sync notes:', parsed.errors);
      navigate('#/settings');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Sync failed.', 'alert');
      button.disabled = false;
      button.textContent = 'Sync now';
    }
  };

  const syncButton = button('Sync now', { variant: 'primary' });
  syncButton.addEventListener('click', () => run(syncButton));

  const warning = el('div', { class: 'hint-block' });
  const drawWarning = () => {
    const url = urlInput.value.trim();
    // replaceChildren is the raw DOM API and stringifies null, so filter first.
    const parts = [
      el('strong', {}, 'This makes the sheet public. '),
      'A browser can only read a Google Sheet that is published with File \u2192 Share \u2192 Publish to web. Anyone holding that link can read it, so publish a separate sheet carrying only the columns in the template \u2014 not your whole financial model.',
    ];
    if (url && !looksPublished(url)) {
      parts.push(
        el(
          'p',
          { class: 'inline-note text-alert', style: { marginTop: '8px' } },
          'That does not look like a published-to-web link. A normal share link will be refused by the browser.',
        ),
      );
    }
    warning.replaceChildren(...parts);
  };
  urlInput.addEventListener('input', drawWarning);
  drawWarning();

  return card(
    el(
      'p',
      { class: 'prose' },
      'Keep your costs in a sheet and the app can pull them in, so a price change reaches the phone on its own.',
    ),
    warning,
    field('Published CSV link', urlInput, 'Stored on this phone only — never in the app\u2019s code'),
    el('div', { class: 'btn-row' }, syncButton, button('Copy template', { onclick: copyTemplate })),
    el(
      'label',
      { class: 'switch-row' },
      el(
        'div',
        {},
        el('div', { class: 'switch-label' }, 'Check on open'),
        el('div', { class: 'switch-hint' }, 'At most once an hour, and never offline'),
      ),
      autoBox,
    ),
    status,
    el(
      'p',
      { class: 'inline-note' },
      'Prefer to keep it private? Skip the link and use Import above — the Files app can open a CSV straight out of Google Drive.',
    ),
  );
}

function copyTemplate() {
  const csv = figuresTemplateCsv();
  downloadBlob(new Blob([csv], { type: 'text/csv' }), 'la-fuga-figures-template.csv');
  toast('Template saved — open it in Sheets and publish as CSV.');
}

/* ----------------------------------------------------------------- defaults */

function defaultsPanel(data) {
  const s = data.settings;
  const bind = (node, apply) => {
    node.addEventListener('change', () => {
      update((d) => apply(d.settings, node.value));
      toast('Saved.');
    });
    return node;
  };

  return card(
    field(
      'Currency',
      bind(select([{ value: 'GBP', label: 'GBP £' }, { value: 'EUR', label: 'EUR €' }, { value: 'USD', label: 'USD $' }], { value: s.currency }), (set, v) => {
        set.currency = v;
      }),
    ),
    el(
      'div',
      { class: 'field-grid' },
      field('VAT %', bind(input({ type: 'number', inputmode: 'decimal', step: '1', value: toPercentInput(s.vatRate) }), (set, v) => {
        set.vatRate = toFraction(v);
      })),
      field('Net margin %', bind(input({ type: 'number', inputmode: 'decimal', step: '1', value: toPercentInput(s.targetMargin) }), (set, v) => {
        set.targetMargin = toFraction(v);
      })),
    ),
    field(
      'Price from',
      bind(select(Object.entries(PRICING_MODES).map(([value, label]) => ({ value, label })), { value: s.mode }), (set, v) => {
        set.mode = v;
      }),
    ),
    el(
      'div',
      { class: 'field-grid' },
      field('Commission %', bind(input({ type: 'number', inputmode: 'decimal', step: '0.5', value: toPercentInput(s.commissionRate) }), (set, v) => {
        set.commissionRate = toFraction(v);
      }), 'Payment and platform fees'),
      field('Round prices to', bind(select(ROUNDING.map((r) => ({ value: r.value, label: r.label })), { value: s.rounding }), (set, v) => {
        set.rounding = parseFloat(v);
      })),
    ),
    el(
      'div',
      { class: 'field-grid' },
      field('Quote valid (days)', bind(input({ type: 'number', inputmode: 'numeric', step: '1', value: s.quoteValidDays }), (set, v) => {
        set.quoteValidDays = parseInt(v, 10) || 30;
      })),
      field('Monthly overheads', bind(input({ type: 'number', inputmode: 'decimal', step: '10', value: s.monthlyOverheads }), (set, v) => {
        set.monthlyOverheads = parseFloat(v) || 0;
      })),
    ),
    el(
      'div',
      { class: 'field-grid' },
      field('Quote prefix', bind(input({ value: s.quotePrefix }), (set, v) => {
        set.quotePrefix = v.trim().toUpperCase() || 'LF';
      })),
      field('Next number', bind(input({ type: 'number', inputmode: 'numeric', step: '1', value: s.nextQuoteNumber }), (set, v) => {
        set.nextQuoteNumber = parseInt(v, 10) || 1;
      })),
    ),
    field('Lead time', bind(input({ value: s.leadTime }), (set, v) => {
      set.leadTime = v;
    })),
    field('Payment terms', bind(el('textarea', { class: 'input' }, s.paymentTerms), (set, v) => {
      set.paymentTerms = v;
    })),
  );
}

function presetsPanel(data) {
  const box = card();
  const draw = () => {
    box.replaceChildren();
    data.settings.discountPresets.forEach((preset, i) => {
      const label = input({ value: preset.label });
      const value = input({ type: 'number', inputmode: 'decimal', step: '1', value: toPercentInput(preset.value), style: { maxWidth: '96px' } });
      const commit = () => {
        update((d) => {
          d.settings.discountPresets[i] = { label: label.value.trim() || 'Discount', value: toFraction(value.value) };
        });
      };
      label.addEventListener('change', commit);
      value.addEventListener('change', commit);

      box.appendChild(
        el(
          'div',
          { class: 'switch-row' },
          el('div', { style: { flex: '1' } }, label),
          value,
          button('×', {
            variant: 'quiet',
            'aria-label': `Remove ${preset.label}`,
            onclick: () => {
              update((d) => d.settings.discountPresets.splice(i, 1));
              data = load();
              draw();
            },
          }),
        ),
      );
    });
    box.appendChild(
      el('div', { class: 'btn-row' }, button('Add preset', {
        onclick: () => {
          update((d) => d.settings.discountPresets.push({ label: 'New', value: 0.1 }));
          data = load();
          draw();
        },
      })),
    );
  };
  draw();
  return box;
}

/* ------------------------------------------------------------------ company */

function companyPanel(data) {
  const c = data.company;
  const bind = (node, apply) => {
    node.addEventListener('change', () => {
      update((d) => apply(d.company, node.value));
      toast('Saved.');
    });
    return node;
  };

  return card(
    field('Legal name', bind(input({ value: c.name }), (co, v) => {
      co.name = v.trim();
    })),
    field('Trading name', bind(input({ value: c.tradingName }), (co, v) => {
      co.tradingName = v.trim();
    })),
    field(
      'Registered address',
      bind(el('textarea', { class: 'input' }, c.addressLines.join('\n')), (co, v) => {
        co.addressLines = v.split('\n').map((x) => x.trim()).filter(Boolean);
      }),
      'One line per line',
    ),
    el(
      'div',
      { class: 'field-grid' },
      field('Company number', bind(input({ value: c.companyNumber }), (co, v) => {
        co.companyNumber = v.trim();
      })),
      field('VAT number', bind(input({ value: c.vatNumber }), (co, v) => {
        co.vatNumber = v.trim();
      })),
    ),
    el(
      'div',
      { class: 'field-grid' },
      field('Email', bind(input({ type: 'email', value: c.email, autocapitalize: 'off' }), (co, v) => {
        co.email = v.trim();
      })),
      field('Website', bind(input({ value: c.website, autocapitalize: 'off' }), (co, v) => {
        co.website = v.trim();
      })),
    ),
    field('EORI', bind(input({ value: c.eori }), (co, v) => {
      co.eori = v.trim();
    })),
  );
}

/* ------------------------------------------------------------------ profile */

function profilePanel() {
  const p = profile();
  const commit = (patch) => {
    update((d) => {
      d.settings.complianceProfile = { ...PROFILE_DEFAULTS, ...(d.settings.complianceProfile || {}), ...patch };
    });
    toast('Filing profile updated.');
  };

  const yearEnd = select(MONTHS.map((m, i) => ({ value: i + 1, label: m })), { value: p.yearEndMonth });
  yearEnd.addEventListener('change', () => commit({ yearEndMonth: parseInt(yearEnd.value, 10) }));

  const stagger = select(
    [
      { value: '1,4,7,10', label: 'Jan / Apr / Jul / Oct' },
      { value: '2,5,8,11', label: 'Feb / May / Aug / Nov' },
      { value: '3,6,9,12', label: 'Mar / Jun / Sep / Dec' },
    ],
    { value: p.vatQuarterEndMonths.join(',') },
  );
  stagger.addEventListener('change', () =>
    commit({ vatQuarterEndMonths: stagger.value.split(',').map(Number) }),
  );

  const toggle = (key, label, hint) => {
    const box = el('input', { type: 'checkbox', checked: p[key] });
    box.addEventListener('change', () => commit({ [key]: box.checked }));
    return el(
      'label',
      { class: 'switch-row' },
      el('div', {}, el('div', { class: 'switch-label' }, label), hint ? el('div', { class: 'switch-hint' }, hint) : null),
      box,
    );
  };

  return card(
    field('Financial year ends', yearEnd, 'Drives accounts and Corporation Tax dates'),
    field('VAT quarters end', stagger, 'Your HMRC stagger'),
    toggle('vatRegistered', 'VAT registered', 'Generates quarterly return deadlines'),
    toggle('payeRegistered', 'Running PAYE', 'Adds P60 and P11D dates'),
    toggle('selfAssessment', 'Director Self Assessment', 'Adds the 31 January deadline'),
  );
}
