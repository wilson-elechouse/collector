'use client';

import { useEffect, useMemo, useState } from 'react';

const STATUS_LABEL = {
  draft: 'Draft',
  reviewed: 'Reviewed',
  posted: 'Posted',
  failed: 'Failed'
};

const BILL_ENUMS = {
  vendors: ['Demo Vendor'],
  locations: ['HQ', 'Head Office'],
  accounts: ['Office Supplies', 'EWT Payable-BIR'],
  classes: ['DEFAULT'],
  taxCodes: ['NON', 'VAT12', 'WHT-Out of scope', 'WHT_OUT_SCOPE']
};

function makeRefId(entity, qboId) {
  const normalizedEntity = String(entity || '').trim().toLowerCase();
  const normalizedQboId = String(qboId || '').trim();
  if (!normalizedEntity || !normalizedQboId) return '';
  return `${normalizedEntity}:${normalizedQboId}`;
}

function asOption(option) {
  if (!option) return null;
  if (typeof option === 'string') {
    const label = String(option).trim();
    return label ? { label, refId: '', current: false } : null;
  }
  const label = String(option.label || option.name || option.key || '').trim();
  const refId = String(option.refId || '').trim();
  if (!label && !refId) return null;
  return { label: label || refId, refId, current: !!option.current };
}

function mergeOptions(...groups) {
  const out = [];
  const seen = new Set();
  groups.flat().forEach((raw) => {
    const option = asOption(raw);
    if (!option) return;
    const key = option.refId || `label:${option.label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(option);
  });
  return out;
}

function findOption(options, value, refId = '') {
  const wantedRefId = String(refId || '').trim();
  if (wantedRefId) {
    const byRefId = options.find((x) => String(x?.refId || '').trim() === wantedRefId);
    if (byRefId) return byRefId;
  }
  const wantedLabel = String(value || '').trim().toLowerCase();
  if (!wantedLabel) return null;
  return options.find((x) => String(x?.label || '').trim().toLowerCase() === wantedLabel) || null;
}

function currentOption(value, refId) {
  const label = String(value || '').trim();
  const normalizedRefId = String(refId || '').trim();
  if (!label && !normalizedRefId) return null;
  return {
    label: label || normalizedRefId,
    refId: normalizedRefId,
    current: true
  };
}

function optionsWithCurrent(options, value, refId) {
  const current = currentOption(value, refId);
  if (!current) return options;
  if (findOption(options, value, refId)) return options;
  return [current, ...options];
}

function refMatchInfo(options, value, refId) {
  const hasValue = !!String(value || '').trim() || !!String(refId || '').trim();
  if (!hasValue) return { matched: true, currentOnly: false, refId: '' };
  const matched = !!findOption(options, value, refId);
  return {
    matched,
    currentOnly: !matched,
    refId: String(refId || '').trim()
  };
}

function normalizePick(value, options) {
  const hit = findOption(options, value);
  return hit ? { label: hit.label, refId: hit.refId || '' } : { label: String(value || '').trim(), refId: '' };
}

function StepHeader({ current }) {
  const steps = ['Edit', 'Confirm', 'Result'];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {steps.map((name, idx) => {
        const stepNo = idx + 1;
        const active = current === stepNo;
        return (
          <div
            key={name}
            style={{
              border: '1px solid #d0d7de',
              borderRadius: 999,
              padding: '6px 10px',
              background: active ? '#111827' : '#fff',
              color: active ? '#fff' : '#111827',
              fontWeight: 600
            }}
          >
            Step {stepNo}: {name}
          </div>
        );
      })}
    </div>
  );
}

function emptyBillLine() {
  return {
    account_ref_text: '',
    account_ref_id: '',
    description: '',
    amount: 0,
    class_ref_text: '',
    class_ref_id: '',
    tax_ref_text: '',
    tax_ref_id: ''
  };
}

function parseTaxRateFromName(name) {
  const s = String(name || '').trim();
  if (!s) return 0;

  const lower = s.toLowerCase();
  if (
    lower.includes('out of scope') ||
    lower.includes('non') ||
    lower.includes('exempt') ||
    lower.includes('no vat') ||
    lower.includes('zero')
  ) {
    return 0;
  }

  const percentMatch = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) return Number(percentMatch[1]) || 0;

  const vatMatch = s.match(/vat\s*[-_ ]?(\d+(?:\.\d+)?)/i);
  if (vatMatch) return Number(vatMatch[1]) || 0;

  const leadingMatch = s.match(/^(\d+(?:\.\d+)?)/);
  if (leadingMatch) return Number(leadingMatch[1]) || 0;

  return 0;
}

function confidenceStyle(level) {
  const v = String(level || '').toLowerCase();
  if (v === 'high') return { bg: '#ecfdf3', bd: '#abefc6', fg: '#067647', label: 'HIGH' };
  if (v === 'medium') return { bg: '#fffaeb', bd: '#fedf89', fg: '#b54708', label: 'MEDIUM' };
  return { bg: '#fff6f6', bd: '#fecdca', fg: '#b42318', label: 'LOW' };
}

function lineConfidence(line) {
  return {
    level: line?.meta?.confidence_level || line?.confidence_level || 'low',
    reason: line?.meta?.confidence_reason || line?.confidence_reason || 'Needs customer confirmation.'
  };
}

export default function SubmissionEditPage({ params }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const [clientRef, setClientRef] = useState('');
  const [memo, setMemo] = useState('');
  const [payload, setPayload] = useState({});
  const [payloadText, setPayloadText] = useState('{}');
  const [whtRate, setWhtRate] = useState('');
  const [whtAmount, setWhtAmount] = useState('');
  const [mappingCatalog, setMappingCatalog] = useState(null);
  const [billRules, setBillRules] = useState(null);
  const [billPaymentRules, setBillPaymentRules] = useState(null);
  const [openBills, setOpenBills] = useState([]);
  const [loadingOpenBills, setLoadingOpenBills] = useState(false);
  const [loadingEnums, setLoadingEnums] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch(`/api/submissions/${params.id}`, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || `load_failed_${res.status}`);
        if (!ignore) {
          if (j?.row?.result?.qbo_id) {
            window.location.href = `/submissions/${params.id}/result`;
            return;
          }
          const p = j.row.payload || {};
          if (!Array.isArray(p.lines)) p.lines = [emptyBillLine()];
          setRow(j.row);
          setClientRef(j.row.client_ref || '');
          setMemo(j.row.memo || '');
          setPayload(p);
          setPayloadText(JSON.stringify(p, null, 2));
          setWhtRate(String(p?.wht?.rate ?? ''));
          setWhtAmount(String(p?.wht?.amount ?? ''));
        }
      } catch (e) {
        if (!ignore) setErr(e.message);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [params.id]);

  async function loadEnumSources() {
    setLoadingEnums(true);
    try {
      const [mapRes, rulesRes, bpRulesRes] = await Promise.all([
        fetch('/api/mappings/catalog', { cache: 'no-store' }),
        fetch('/api/bill-rules', { cache: 'no-store' }),
        fetch('/api/bill-payment-rules', { cache: 'no-store' })
      ]);
      const mapJson = await mapRes.json().catch(() => ({}));
      const rulesJson = await rulesRes.json().catch(() => ({}));
      const bpRulesJson = await bpRulesRes.json().catch(() => ({}));
      if (mapRes.ok && mapJson?.ok) setMappingCatalog(mapJson.catalog || null);
      if (rulesRes.ok && rulesJson?.ok) setBillRules(rulesJson.rules || null);
      if (bpRulesRes.ok && bpRulesJson?.ok) setBillPaymentRules(bpRulesJson.rules || null);
    } catch {}
    setLoadingEnums(false);
  }

  useEffect(() => {
    loadEnumSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (row?.kind !== 'bill_payment') return;
    if (!billPaymentRules) return;
    setPayload((prev) => {
      const next = {
        ...prev,
        pay_date: prev.pay_date || new Date().toISOString().slice(0, 10),
        vendor_ref_text: prev.vendor_ref_text || billPaymentRules?.payload?.vendor_ref_text?.default || '',
        bank_account_ref_text: prev.bank_account_ref_text || billPaymentRules?.payload?.bank_account_ref_text?.default || '',
        ref_no: prev.ref_no || ''
      };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }, [row?.kind, billPaymentRules]);

  useEffect(() => {
    if (row?.kind !== 'bill_payment') return;
    const vendor = String(payload?.vendor_ref_text || '').trim();
    if (!vendor) return;
    loadOpenBills(vendor);
  }, [row?.kind, payload?.vendor_ref_text]);

  function patchPayload(key, value) {
    setPayload((prev) => {
      const next = { ...prev, [key]: value };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function patchPayloadRefSelection(textField, idField, value, options) {
    const normalized = normalizePick(value, options);
    setPayload((prev) => {
      const next = { ...prev, [textField]: normalized.label };
      if (normalized.refId) next[idField] = normalized.refId;
      else delete next[idField];
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function patchPayloadRefInput(textField, idField, value) {
    setPayload((prev) => {
      const next = { ...prev, [textField]: value };
      delete next[idField];
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function patchBillLine(index, key, value) {
    setPayload((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
      while (lines.length <= index) lines.push(emptyBillLine());
      lines[index] = { ...lines[index], [key]: key === 'amount' ? Number(value || 0) : value };
      const next = { ...prev, lines };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function patchBillLineRefSelection(index, textField, idField, value, options) {
    const normalized = normalizePick(value, options);
    setPayload((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
      while (lines.length <= index) lines.push(emptyBillLine());
      const current = { ...lines[index], [textField]: normalized.label };
      if (normalized.refId) current[idField] = normalized.refId;
      else delete current[idField];
      lines[index] = current;
      const next = { ...prev, lines };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function patchBillLineRefInput(index, textField, idField, value) {
    setPayload((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
      while (lines.length <= index) lines.push(emptyBillLine());
      const current = { ...lines[index], [textField]: value };
      delete current[idField];
      lines[index] = current;
      const next = { ...prev, lines };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function addBillLine() {
    setPayload((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines, emptyBillLine()] : [emptyBillLine()];
      const next = { ...prev, lines };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function applyWhtLine() {
    setPayload((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
      const businessLines = lines.filter((x) => String(x?.meta?.kind || '') !== 'wht');
      const netBaseTotal = businessLines.reduce((sum, ln) => {
        const gross = Number(ln?.amount || 0) || 0;
        const ratePct = parseTaxRateFromName(ln?.tax_ref_text);
        const denom = 1 + ratePct / 100;
        const net = denom > 0 ? gross / denom : gross;
        return sum + net;
      }, 0);

      const amountFromRate = (() => {
        const raw = String(whtRate || '').trim();
        if (!raw) return 0;
        const n = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
        if (!Number.isFinite(n)) return 0;
        return -(netBaseTotal * n);
      })();

      const manualAmount = Number(String(whtAmount || '').trim());
      const amount = String(whtAmount || '').trim()
        ? -Math.abs(Number.isFinite(manualAmount) ? manualAmount : 0)
        : amountFromRate;

      const whtLine = {
        account_ref_text: 'EWT Payable-BIR',
        description: 'Withholding tax',
        amount: Math.round((amount + Number.EPSILON) * 100) / 100,
        tax_ref_text: 'WHT-Out of scope',
        class_ref_text: '',
        meta: { kind: 'wht' }
      };

      const next = {
        ...prev,
        wht: {
          rate: String(whtRate || '').trim() || undefined,
          amount: String(whtAmount || '').trim() || undefined
        },
        lines: [...businessLines, whtLine]
      };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function removeBillLine(index) {
    setPayload((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
      lines.splice(index, 1);
      const next = { ...prev, lines: lines.length ? lines : [emptyBillLine()] };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  function patchBillPaymentLine(index, key, value) {
    setPayload((prev) => {
      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
      while (lines.length <= index) lines.push({});
      lines[index] = { ...lines[index], [key]: key === 'pay_amount' ? Number(value || 0) : value };
      const next = { ...prev, lines };
      setPayloadText(JSON.stringify(next, null, 2));
      return next;
    });
  }

  async function loadOpenBills(vendorName) {
    const v = String(vendorName || '').trim();
    if (!v) {
      setOpenBills([]);
      return;
    }
    setLoadingOpenBills(true);
    setErr('');
    try {
      const res = await fetch(`/api/bill-payments/open-bills?vendor_ref_text=${encodeURIComponent(v)}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.detail || j?.error || `open_bills_failed_${res.status}`);
      const rows = Array.isArray(j.rows) ? j.rows : [];
      setOpenBills(rows);
      setPayload((prev) => {
        const existing = Array.isArray(prev.lines) ? prev.lines : [];
        const map = new Map(existing.map((x) => [String(x?.bill_id || ''), x]));
        const lines = rows.map((r) => {
          const keep = map.get(String(r.bill_id || ''));
          const open = Number(r.open_balance || 0);
          const pay = keep ? Number(keep.pay_amount || 0) : 0;
          return {
            bill_id: r.bill_id,
            doc_number: r.doc_number,
            bill_date: r.bill_date,
            due_date: r.due_date,
            amount: Number(r.amount || 0),
            open_balance: open,
            client_ref: r.client_ref || '',
            memo: r.memo || '',
            selected: !!(keep?.selected && pay > 0),
            pay_amount: pay
          };
        });
        const next = { ...prev, lines };
        setPayloadText(JSON.stringify(next, null, 2));
        return next;
      });
    } catch (e) {
      setErr(`Load open bills failed: ${e.message}`);
    } finally {
      setLoadingOpenBills(false);
    }
  }

  async function saveDraft() {
    setErr('');
    setSaving(true);
    try {
      const finalPayload = showJson ? JSON.parse(payloadText || '{}') : payload;
      const res = await fetch(`/api/submissions/${params.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_ref: clientRef, memo, payload: finalPayload })
      });
      const raw = await res.text();
      let j = null;
      try { j = raw ? JSON.parse(raw) : null; } catch {}
      if (!res.ok || !j?.ok) throw new Error(j?.error || `save_failed_${res.status}`);
      setRow(j.row);
      setPayload(j.row.payload || {});
      setPayloadText(JSON.stringify(j.row.payload || {}, null, 2));
    } catch (e) {
      setErr(`Save draft failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function validateAndContinue() {
    setErr('');
    setValidating(true);
    try {
      await saveDraft();
      const res = await fetch(`/api/submissions/${params.id}/validate`, { method: 'POST' });
      const raw = await res.text();
      let j = null;
      try { j = raw ? JSON.parse(raw) : null; } catch {}
      if (!res.ok || !j?.ok) throw new Error(j?.issues?.join(', ') || j?.error || `validate_failed_${res.status}`);
      window.location.href = `/submissions/${params.id}/confirm`;
    } catch (e) {
      setErr(`Validate failed: ${e.message}`);
    } finally {
      setValidating(false);
    }
  }

  const status = useMemo(() => STATUS_LABEL[row?.status] || row?.status || '-', [row]);
  const isBill = row?.kind === 'bill';
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];

  const billTotals = useMemo(() => {
    const businessLines = lines.filter((ln) => String(ln?.meta?.kind || '') !== 'wht');
    const whtLines = lines.filter((ln) => String(ln?.meta?.kind || '') === 'wht');

    const businessGross = businessLines.reduce((s, ln) => s + (Number(ln?.amount || 0) || 0), 0);
    const businessNet = businessLines.reduce((s, ln) => {
      const gross = Number(ln?.amount || 0) || 0;
      const ratePct = parseTaxRateFromName(ln?.tax_ref_text);
      const denom = 1 + ratePct / 100;
      const net = denom > 0 ? gross / denom : gross;
      return s + net;
    }, 0);
    const whtAmountTotal = whtLines.reduce((s, ln) => s + (Number(ln?.amount || 0) || 0), 0);
    const billTotal = businessGross + whtAmountTotal;

    return {
      businessGross,
      businessNet,
      whtAmountTotal,
      billTotal
    };
  }, [lines]);

  const vendorsFromRules = mergeOptions((billRules?.qboOptionDictionaries?.vendors || []).map((x) => ({
    label: x?.label || x?.key,
    refId: makeRefId('vendor', x?.qbo_vendor_id)
  })));
  const locationsFromRules = mergeOptions((billRules?.qboOptionDictionaries?.locations || []).map((x) => ({
    label: x?.label || x?.key,
    refId: makeRefId('department', x?.qbo_department_id)
  })));
  const accountsFromRules = mergeOptions((billRules?.qboOptionDictionaries?.accounts || []).map((x) => ({
    label: x?.label || x?.key,
    refId: makeRefId('account', x?.qbo_account_id)
  })));
  const classesFromRules = mergeOptions((billRules?.qboOptionDictionaries?.classes || []).map((x) => ({
    label: x?.label || x?.key,
    refId: makeRefId('class', x?.qbo_class_id)
  })));
  const taxCodesFromRules = mergeOptions((billRules?.qboOptionDictionaries?.taxCodes || []).map((x) => ({
    label: x?.label || x?.key,
    refId: makeRefId('taxcode', x?.qbo_tax_code_id)
  })));
  const bpVendorsFromRules = mergeOptions((billPaymentRules?.qboOptionDictionaries?.vendors || []).map((x) => ({
    label: x?.label || x?.key,
    refId: makeRefId('vendor', x?.qbo_vendor_id)
  })));
  const bankAccountsFromRules = mergeOptions((billPaymentRules?.qboOptionDictionaries?.bankAccounts || []).map((x) => ({
    label: x?.label || x?.key,
    refId: makeRefId('account', x?.qbo_account_id)
  })));

  const vendors = mergeOptions((mappingCatalog?.vendors || []).map((x) => ({ label: x.name, refId: makeRefId('vendor', x.id) })));
  const locations = mergeOptions((mappingCatalog?.departments || []).map((x) => ({ label: x.name, refId: makeRefId('department', x.id) })));
  const accounts = mergeOptions((mappingCatalog?.accounts || []).map((x) => ({ label: x.name, refId: makeRefId('account', x.id) })));
  const classes = mergeOptions((mappingCatalog?.classes || []).map((x) => ({ label: x.name, refId: makeRefId('class', x.id) })));
  const taxCodes = mergeOptions((mappingCatalog?.taxCodes || []).map((x) => ({ label: x.name, refId: makeRefId('taxcode', x.id) })));
  const fallbackVendors = mergeOptions(BILL_ENUMS.vendors);
  const fallbackLocations = mergeOptions(BILL_ENUMS.locations);
  const fallbackAccounts = mergeOptions(BILL_ENUMS.accounts);
  const fallbackClasses = mergeOptions(BILL_ENUMS.classes);
  const fallbackTaxCodes = mergeOptions(BILL_ENUMS.taxCodes);

  const enumSource = {
    vendors: vendorsFromRules.length ? vendorsFromRules : (vendors.length ? vendors : fallbackVendors),
    bpVendors: bpVendorsFromRules.length ? bpVendorsFromRules : (vendors.length ? vendors : fallbackVendors),
    locations: locationsFromRules.length ? locationsFromRules : (locations.length ? locations : fallbackLocations),
    accounts: accountsFromRules.length ? accountsFromRules : (accounts.length ? accounts : fallbackAccounts),
    bankAccounts: bankAccountsFromRules.length ? bankAccountsFromRules : (accounts.length ? accounts : fallbackAccounts),
    classes: classesFromRules.length ? classesFromRules : (classes.length ? classes : fallbackClasses),
    taxCodes: taxCodesFromRules.length ? taxCodesFromRules : (taxCodes.length ? taxCodes : fallbackTaxCodes)
  };

  const mappingMisses = useMemo(() => {
    if (!isBill) return [];
    const misses = [];
    const has = (arr, text, refId) => {
      if (!String(text || '').trim() && !String(refId || '').trim()) return true;
      return !!findOption(arr, text, refId);
    };
    if (!has(enumSource.vendors, payload?.vendor_ref_text, payload?.vendor_ref_id)) misses.push('vendor');
    if (!has(enumSource.locations, payload?.location_ref_text, payload?.location_ref_id)) misses.push('location');
    lines.forEach((ln, idx) => {
      if (!has(enumSource.accounts, ln?.account_ref_text, ln?.account_ref_id)) misses.push(`line ${idx + 1}: category`);
      if (!has(enumSource.classes, ln?.class_ref_text, ln?.class_ref_id)) misses.push(`line ${idx + 1}: class`);
      if (!has(enumSource.taxCodes, ln?.tax_ref_text, ln?.tax_ref_id)) misses.push(`line ${idx + 1}: tax`);
    });
    return misses;
  }, [isBill, payload, lines]);

  const vendorRefMeta = refMatchInfo(enumSource.vendors, payload?.vendor_ref_text, payload?.vendor_ref_id);
  const locationRefMeta = refMatchInfo(enumSource.locations, payload?.location_ref_text, payload?.location_ref_id);

  if (err && !row) return <main style={{ padding: 16 }}><p role="alert">Failed to load submission: {err}</p></main>;
  if (!row) return <main style={{ padding: 16 }}><p>Loading edit page...</p></main>;

  return (
    <main style={{ padding: 16, maxWidth: 960, margin: '0 auto', paddingBottom: 90 }}>
      <StepHeader current={1} />
      <h1 style={{ marginTop: 4 }}>Edit Submission</h1>
      <p>ID: <code>{row.id}</code> · Kind: <b>{row.kind}</b> · Status: <b>{status}</b></p>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Basic information</h3>
        <div style={{ marginBottom: 10 }}>
          <button type="button" onClick={loadEnumSources} disabled={loadingEnums} style={{ padding: '6px 10px' }}>
            {loadingEnums ? 'Reloading options...' : 'Reload latest rule options'}
          </button>
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            Client Ref
            <input value={clientRef} onChange={(e) => setClientRef(e.target.value)} style={{ minHeight: 36 }} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            Memo
            <input value={memo} onChange={(e) => setMemo(e.target.value)} style={{ minHeight: 36 }} />
          </label>
          {isBill ? (
            <label style={{ display: 'grid', gap: 6 }}>
              Vendor
              <select
                value={payload.vendor_ref_text || ''}
                onChange={(e) => patchPayloadRefSelection('vendor_ref_text', 'vendor_ref_id', e.target.value, enumSource.vendors)}
                style={{ minHeight: 36, borderColor: mappingMisses.includes('vendor') ? '#b42318' : undefined }}
              >
                {!payload.vendor_ref_text ? <option value="">-- Select vendor --</option> : null}
                {optionsWithCurrent(enumSource.vendors, payload.vendor_ref_text, payload.vendor_ref_id).map((x) => (
                  <option key={x.refId || x.label} value={x.label}>{x.current ? `${x.label} (current)` : x.label}</option>
                ))}
              </select>
              <small style={{ color: vendorRefMeta.currentOnly ? '#b42318' : '#667085' }}>
                {vendorRefMeta.currentOnly ? 'Current value is displayed but not resolved in latest mapping.' : (vendorRefMeta.refId ? `Ref: ${vendorRefMeta.refId}` : 'Select a vendor to bind its ref id.')}
              </small>
            </label>
          ) : null}
          {isBill ? (
            <>
              <label style={{ display: 'grid', gap: 6 }}>
                Bill date
                <input type="date" value={payload.bill_date || ''} onChange={(e) => patchPayload('bill_date', e.target.value)} style={{ minHeight: 36 }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                Due date
                <input type="date" value={payload.due_date || ''} onChange={(e) => patchPayload('due_date', e.target.value)} style={{ minHeight: 36 }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                Location (bill level)
                <input
                  list="location-options"
                  value={payload.location_ref_text || ''}
                  onChange={(e) => patchPayloadRefInput('location_ref_text', 'location_ref_id', e.target.value)}
                  onBlur={(e) => patchPayloadRefSelection('location_ref_text', 'location_ref_id', e.target.value, enumSource.locations)}
                  style={{ minHeight: 36, borderColor: mappingMisses.includes('location') ? '#b42318' : undefined }}
                />
                <datalist id="location-options">
                  {optionsWithCurrent(enumSource.locations, payload.location_ref_text, payload.location_ref_id).map((x) => <option key={x.refId || x.label} value={x.label} />)}
                </datalist>
                <small style={{ color: locationRefMeta.currentOnly ? '#b42318' : '#667085' }}>
                  {locationRefMeta.currentOnly ? 'Current value is displayed but not resolved in latest mapping.' : (locationRefMeta.refId ? `Ref: ${locationRefMeta.refId}` : 'Optional bill-level location.')}
                </small>
              </label>
              {/* tax/class are line-level only */}
            </>
          ) : (
            <>
              <label style={{ display: 'grid', gap: 6 }}>
                Vendor
                <input
                  list="bp-vendor-options"
                  value={payload.vendor_ref_text || ''}
                  onChange={(e) => patchPayloadRefInput('vendor_ref_text', 'vendor_ref_id', e.target.value)}
                  onBlur={(e) => patchPayloadRefSelection('vendor_ref_text', 'vendor_ref_id', e.target.value, enumSource.bpVendors)}
                  style={{ minHeight: 36 }}
                />
                <datalist id="bp-vendor-options">
                  {optionsWithCurrent(enumSource.bpVendors, payload.vendor_ref_text, payload.vendor_ref_id).map((x) => <option key={x.refId || x.label} value={x.label} />)}
                </datalist>
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                Payment date
                <input type="date" value={payload.pay_date || ''} onChange={(e) => patchPayload('pay_date', e.target.value)} style={{ minHeight: 36 }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                Bank / Credit account
                <input
                  list="bp-bank-options"
                  value={payload.bank_account_ref_text || ''}
                  onChange={(e) => patchPayloadRefInput('bank_account_ref_text', 'bank_account_ref_id', e.target.value)}
                  onBlur={(e) => patchPayloadRefSelection('bank_account_ref_text', 'bank_account_ref_id', e.target.value, enumSource.bankAccounts)}
                  style={{ minHeight: 36 }}
                />
                <datalist id="bp-bank-options">
                  {optionsWithCurrent(enumSource.bankAccounts, payload.bank_account_ref_text, payload.bank_account_ref_id).map((x) => <option key={x.refId || x.label} value={x.label} />)}
                </datalist>
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                Ref no
                <input value={payload.ref_no || ''} onChange={(e) => patchPayload('ref_no', e.target.value)} style={{ minHeight: 36 }} />
              </label>
            </>
          )}
        </div>
      </section>

      {isBill && mappingMisses.length ? (
        <section style={{ border: '1px solid #fecdca', background: '#fff6f6', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <b style={{ color: '#b42318' }}>Mapping warnings</b>
          <p style={{ margin: '6px 0 0 0', color: '#b42318' }}>
            These fields are not matched in current mapping catalog: {mappingMisses.join(', ')}.
          </p>
        </section>
      ) : null}

      {isBill ? (
        <>
          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Bill lines</h3>
              <button type="button" onClick={addBillLine} style={{ padding: '8px 10px' }}>+ Add line</button>
            </div>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {lines.map((ln, idx) => {
              const cf = lineConfidence(ln);
              const cfs = confidenceStyle(cf.level);
              const accountRefMeta = refMatchInfo(enumSource.accounts, ln?.account_ref_text, ln?.account_ref_id);
              const classRefMeta = refMatchInfo(enumSource.classes, ln?.class_ref_text, ln?.class_ref_id);
              const taxRefMeta = refMatchInfo(enumSource.taxCodes, ln?.tax_ref_text, ln?.tax_ref_id);
              return (
              <div key={idx} style={{ border: '1px solid #f1f5f9', borderRadius: 8, padding: 10 }}>
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, border: `1px solid ${cfs.bd}`, background: cfs.bg, color: cfs.fg, fontWeight: 700 }}>
                    Confidence: {cfs.label}
                  </span>
                  <span style={{ color: '#555', fontSize: 12 }}>{cf.reason}</span>
                </div>
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    Category
                    <select
                      value={ln.account_ref_text || ''}
                      onChange={(e) => patchBillLineRefSelection(idx, 'account_ref_text', 'account_ref_id', e.target.value, enumSource.accounts)}
                      style={{ minHeight: 34, borderColor: mappingMisses.includes(`line ${idx + 1}: category`) ? '#b42318' : undefined }}
                    >
                      {!ln.account_ref_text ? <option value="">-- Select category/account --</option> : null}
                      {optionsWithCurrent(enumSource.accounts, ln.account_ref_text, ln.account_ref_id).map((x) => (
                        <option key={x.refId || x.label} value={x.label}>{x.current ? `${x.label} (current)` : x.label}</option>
                      ))}
                    </select>
                    <small style={{ color: accountRefMeta.currentOnly ? '#b42318' : '#667085' }}>
                      {accountRefMeta.currentOnly ? 'Current account label is not resolved in latest mapping.' : (accountRefMeta.refId ? `Ref: ${accountRefMeta.refId}` : 'Select a mapped account.')}
                    </small>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    Amount (含税值)
                    <input value={ln.amount ?? 0} onChange={(e) => patchBillLine(idx, 'amount', e.target.value)} style={{ minHeight: 34 }} />
                    <small style={{ color: '#666' }}>
                      税率 {parseTaxRateFromName(ln?.tax_ref_text).toFixed(2)}% · Net {(() => {
                        const gross = Number(ln?.amount || 0) || 0;
                        const ratePct = parseTaxRateFromName(ln?.tax_ref_text);
                        const denom = 1 + ratePct / 100;
                        const net = denom > 0 ? gross / denom : gross;
                        return net.toFixed(2);
                      })()}
                    </small>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    Class
                    <input
                      list={`class-options-${idx}`}
                      value={ln.class_ref_text || ''}
                      onChange={(e) => patchBillLineRefInput(idx, 'class_ref_text', 'class_ref_id', e.target.value)}
                      onBlur={(e) => patchBillLineRefSelection(idx, 'class_ref_text', 'class_ref_id', e.target.value, enumSource.classes)}
                      style={{ minHeight: 34, borderColor: mappingMisses.includes(`line ${idx + 1}: class`) ? '#b42318' : undefined }}
                    />
                    <datalist id={`class-options-${idx}`}>
                      {optionsWithCurrent(enumSource.classes, ln.class_ref_text, ln.class_ref_id).map((x) => <option key={x.refId || x.label} value={x.label} />)}
                    </datalist>
                    <small style={{ color: classRefMeta.currentOnly ? '#b42318' : '#667085' }}>
                      {classRefMeta.currentOnly ? 'Current class label is not resolved in latest mapping.' : (classRefMeta.refId ? `Ref: ${classRefMeta.refId}` : 'Optional class mapping.')}
                    </small>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    Tax
                    <input
                      list={`tax-options-${idx}`}
                      value={ln.tax_ref_text || ''}
                      onChange={(e) => patchBillLineRefInput(idx, 'tax_ref_text', 'tax_ref_id', e.target.value)}
                      onBlur={(e) => patchBillLineRefSelection(idx, 'tax_ref_text', 'tax_ref_id', e.target.value, enumSource.taxCodes)}
                      style={{ minHeight: 34, borderColor: mappingMisses.includes(`line ${idx + 1}: tax`) ? '#b42318' : undefined }}
                    />
                    <datalist id={`tax-options-${idx}`}>
                      {optionsWithCurrent(enumSource.taxCodes, ln.tax_ref_text, ln.tax_ref_id).map((x) => <option key={x.refId || x.label} value={x.label} />)}
                    </datalist>
                    <small style={{ color: taxRefMeta.currentOnly ? '#b42318' : '#667085' }}>
                      {taxRefMeta.currentOnly ? 'Current tax label is not resolved in latest mapping.' : (taxRefMeta.refId ? `Ref: ${taxRefMeta.refId}` : 'Optional tax mapping.')}
                    </small>
                    <small style={{ color: '#666' }}>自动识别税率: {parseTaxRateFromName(ln?.tax_ref_text).toFixed(2)}%</small>
                  </label>
                  {/* location is bill-level only */}
                  <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                    Description
                    <input value={ln.description || ''} onChange={(e) => patchBillLine(idx, 'description', e.target.value)} style={{ minHeight: 34 }} />
                  </label>
                </div>
                <button type="button" onClick={() => removeBillLine(idx)} style={{ marginTop: 8, padding: '6px 10px' }}>Delete line</button>
              </div>
              );
            })}
          </div>
        </section>

          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Withholding tax (auto line)</h3>
            <p style={{ margin: '0 0 10px 0', color: '#555' }}>先调整 Bill lines，再应用 WHT 计算。</p>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
              <label style={{ display: 'grid', gap: 6 }}>
                Rate (e.g. 1% or 0.01)
                <input value={whtRate} onChange={(e) => setWhtRate(e.target.value)} style={{ minHeight: 34 }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                Amount override (optional)
                <input value={whtAmount} onChange={(e) => setWhtAmount(e.target.value)} style={{ minHeight: 34 }} />
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <button type="button" onClick={applyWhtLine} style={{ padding: '8px 10px' }}>Apply WHT (auto create line)</button>
            </div>
          </section>

          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12, background: '#fafafa' }}>
            <h3 style={{ marginTop: 0 }}>Bill totals (read-only)</h3>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
              <div><b>Business Gross Total</b><div>{billTotals.businessGross.toFixed(2)}</div></div>
              <div><b>Business Net Total</b><div>{billTotals.businessNet.toFixed(2)}</div></div>
              <div><b>WHT Amount</b><div>{billTotals.whtAmountTotal.toFixed(2)}</div></div>
              <div><b>Bill Total</b><div>{billTotals.billTotal.toFixed(2)}</div></div>
            </div>
          </section>
        </>
      ) : (
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Outstanding Bills (select + adjust payment)</h3>
          <p style={{ marginTop: 0, color: '#555' }}>先选择 Vendor，系统会加载未结清 Bill。默认每条支付额为 0，勾选后默认全额支付，可手工调整。</p>
          {loadingOpenBills ? <p>Loading open bills...</p> : null}
          {!loadingOpenBills && !openBills.length ? <p style={{ color: '#555' }}>No open bills loaded.</p> : null}
          {Array.isArray(payload?.lines) && payload.lines.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Pick</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Bill No</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Bill date</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Due date</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Amount</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Open balance</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Client Ref</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Memo</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb', padding: 6 }}>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.lines.map((ln, idx) => (
                    <tr key={ln.bill_id || idx}>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6 }}>
                        <input
                          type="checkbox"
                          checked={!!ln.selected}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            patchBillPaymentLine(idx, 'selected', checked);
                            patchBillPaymentLine(idx, 'pay_amount', checked ? Number(ln.open_balance || 0) : 0);
                          }}
                        />
                      </td>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6 }}>{ln.doc_number || ln.bill_id}</td>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6 }}>{ln.bill_date || '-'}</td>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6 }}>{ln.due_date || '-'}</td>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6, textAlign: 'right' }}>{Number(ln.amount || 0).toFixed(2)}</td>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6, textAlign: 'right' }}>{Number(ln.open_balance || 0).toFixed(2)}</td>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6 }}>{ln.client_ref || '-'}</td>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6 }}>{ln.memo || '-'}</td>
                      <td style={{ borderBottom: '1px solid #f3f4f6', padding: 6, textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={Number(ln.open_balance || 0)}
                          value={ln.pay_amount ?? 0}
                          onChange={(e) => {
                            const n = Number(e.target.value || 0);
                            const cap = Number(ln.open_balance || 0);
                            patchBillPaymentLine(idx, 'pay_amount', Math.max(0, Math.min(n, cap)));
                            patchBillPaymentLine(idx, 'selected', n > 0);
                          }}
                          style={{ width: 110, textAlign: 'right' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div style={{ marginTop: 10, fontWeight: 700 }}>
            Amount to pay: {(Array.isArray(payload?.lines) ? payload.lines.reduce((s, x) => s + (Number(x?.pay_amount || 0) || 0), 0) : 0).toFixed(2)}
          </div>
        </section>
      )}

      <section style={{ marginTop: 14, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
        <button type="button" onClick={() => setShowJson((v) => !v)} style={{ padding: '8px 10px', borderRadius: 8 }}>
          {showJson ? 'Hide' : 'Show'} Advanced JSON Mode
        </button>
        {showJson ? (
          <textarea
            value={payloadText}
            onChange={(e) => {
              setPayloadText(e.target.value);
              try { setPayload(JSON.parse(e.target.value)); } catch {}
            }}
            style={{ width: '100%', minHeight: 220, marginTop: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          />
        ) : (
          <p style={{ marginTop: 10, color: '#555' }}>Advanced payload JSON is hidden by default. Expand only when needed.</p>
        )}
      </section>

      {err ? <p role="alert" style={{ color: '#b42318', marginTop: 12 }}>{err}</p> : null}

      <div style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        borderTop: '1px solid #e5e7eb',
        background: '#fff',
        padding: '10px 16px',
        display: 'flex',
        justifyContent: 'center',
        gap: 10
      }}>
        <button onClick={saveDraft} disabled={saving || validating} style={{ padding: '10px 14px' }}>
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button onClick={validateAndContinue} disabled={saving || validating} style={{ padding: '10px 14px', fontWeight: 700 }}>
          {validating ? 'Validating...' : 'Validate & Continue'}
        </button>
      </div>
    </main>
  );
}
