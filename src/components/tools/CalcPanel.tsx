import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Copy, Delete, Percent, Ruler, X } from "lucide-react";

/** LANX 2.5.0: a calculator with GST, and a unit converter. No internet. */

type Tab = "calc" | "gst" | "units";

/** A number, or a percentage ("18%") that works the way shop calculators do:
 *  1000 + 18% = 1180, 1000 - 10% = 900, 1000 × 18% = 180, 50% alone = 0.5. */
type Val = { v: number; pct: boolean };

/** Safe arithmetic: digits, + - × ÷ % ( ) and decimals only. */
export function evaluate(expr: string): number | null {
  const s = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, "").replace(/\s+/g, "");
  if (!s || !/^[\d.+\-*/()%]+$/.test(s)) return null;
  // Shunting-yard, so no eval().
  const out: (Val | string)[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  let i = 0;
  let prevValue = false;
  while (i < s.length) {
    const c = s[i];
    if (/[\d.]/.test(c)) {
      let j = i;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) return null;
      let pct = false;
      if (s[j] === "%") {
        pct = true;
        j++;
      }
      out.push({ v, pct });
      i = j;
      prevValue = true;
      continue;
    }
    if (c === "%") return null;
    if (c === "(") {
      ops.push(c);
      prevValue = false;
    } else if (c === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!);
      if (!ops.length) return null;
      ops.pop();
      prevValue = true;
    } else {
      if (!prevValue) {
        if (c === "-") {
          out.push({ v: 0, pct: false }); // unary minus
        } else return null;
      }
      while (ops.length && ops[ops.length - 1] !== "(" && prec[ops[ops.length - 1]] >= prec[c]) out.push(ops.pop()!);
      ops.push(c);
      prevValue = false;
    }
    i++;
  }
  while (ops.length) {
    const o = ops.pop()!;
    if (o === "(") return null;
    out.push(o);
  }
  const st: Val[] = [];
  for (const t of out) {
    if (typeof t !== "string") st.push(t);
    else {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) return null;
      const av = a.pct ? a.v / 100 : a.v;
      let r: number;
      if (b.pct) {
        const p = b.v / 100;
        r = t === "+" ? av * (1 + p) : t === "-" ? av * (1 - p) : t === "*" ? av * p : p === 0 ? NaN : av / p;
      } else {
        r = t === "+" ? av + b.v : t === "-" ? av - b.v : t === "*" ? av * b.v : b.v === 0 ? NaN : av / b.v;
      }
      st.push({ v: r, pct: false });
    }
  }
  if (st.length !== 1) return null;
  const r = st[0].pct ? st[0].v / 100 : st[0].v;
  return Number.isFinite(r) ? r : null;
}

export function money(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function tidy(n: number): string {
  const r = Math.round(n * 1e8) / 1e8;
  return r.toLocaleString("en-IN", { maximumFractionDigits: 8 });
}

const UNITS: Record<string, { name: string; units: Record<string, number>; special?: "temp" }> = {
  length: { name: "Length", units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, inch: 0.0254, ft: 0.3048, yard: 0.9144, mile: 1609.344 } },
  weight: { name: "Weight", units: { g: 0.001, kg: 1, quintal: 100, tonne: 1000, lb: 0.45359237, oz: 0.028349523 } },
  area: { name: "Area", units: { "sq m": 1, "sq ft": 0.09290304, "sq yard": 0.83612736, acre: 4046.8564, hectare: 10000, guntha: 101.17, bigha: 1618.7 } },
  volume: { name: "Volume", units: { ml: 0.001, litre: 1, "cu m": 1000, gallon: 3.785411784, "cu ft": 28.316846592 } },
  temp: { name: "Temperature", units: { "°C": 1, "°F": 1, K: 1 }, special: "temp" },
  pressure: { name: "Pressure", units: { Pa: 1, kPa: 1000, bar: 100000, psi: 6894.757, atm: 101325, "kg/cm²": 98066.5 } },
  power: { name: "Power", units: { W: 1, kW: 1000, HP: 745.7, BTU_h: 0.29307107 } },
  speed: { name: "Speed", units: { "m/s": 1, "km/h": 0.2777778, mph: 0.44704, knot: 0.5144444 } },
};

function convert(cat: string, v: number, from: string, to: string): number {
  const c = UNITS[cat];
  if (c.special === "temp") {
    const toC = from === "°C" ? v : from === "°F" ? ((v - 32) * 5) / 9 : v - 273.15;
    return to === "°C" ? toC : to === "°F" ? (toC * 9) / 5 + 32 : toC + 273.15;
  }
  return (v * c.units[from]) / c.units[to];
}

export function CalcPanel({ onClose, onError }: { onClose: () => void; onError: (t: string) => void }) {
  const [tab, setTab] = useState<Tab>("calc");
  const [expr, setExpr] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // GST
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(18);
  const [inclusive, setInclusive] = useState(false);
  const [interstate, setInterstate] = useState(false);

  // Units
  const [cat, setCat] = useState("length");
  const [uv, setUv] = useState("1");
  const [from, setFrom] = useState("m");
  const [to, setTo] = useState("ft");

  useEffect(() => {
    inputRef.current?.focus();
  }, [tab]);

  const result = useMemo(() => evaluate(expr), [expr]);
  const press = (k: string) => {
    if (k === "=") {
      if (result !== null && expr.trim()) {
        setHistory((h) => [`${expr} = ${tidy(result)}`, ...h].slice(0, 12));
        setExpr(tidy(result).replace(/,/g, ""));
      }
      return;
    }
    if (k === "C") return setExpr("");
    if (k === "⌫") return setExpr((e) => e.slice(0, -1));
    setExpr((e) => e + k);
    inputRef.current?.focus();
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => onError("Copied"), () => {});

  const amt = Number(amount.replace(/,/g, "")) || 0;
  const base = inclusive ? amt / (1 + rate / 100) : amt;
  const tax = base * (rate / 100);
  const total = base + tax;

  const units = Object.keys(UNITS[cat].units);
  const uvNum = Number(uv.replace(/,/g, ""));
  const converted = Number.isFinite(uvNum) && units.includes(from) && units.includes(to) ? convert(cat, uvNum, from, to) : null;

  const keys = ["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "-", "1", "2", "3", "+", "0", ".", "%", "="];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lanx-scrim" onMouseDown={onClose}>
      <div data-calc-panel className="w-[520px] max-w-[96vw] max-h-[92vh] flex flex-col rounded-[22px] lanx-sheet overflow-hidden lanx-rise" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b lanx-line">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-white"><Calculator className="h-4 w-4" /></span>
            Calculator
          </h3>
          <button type="button" onClick={onClose} className="lanx-tool p-1 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-1 px-4 pt-3">
          {([["calc", "Calculator", Calculator], ["gst", "GST", Percent], ["units", "Units", Ruler]] as [Tab, string, React.ElementType][]).map(([id, label, I]) => (
            <button key={id} type="button" data-calc-tab={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 ${tab === id ? "bg-slate-700 text-white" : "lanx-group text-slate-600 dark:text-slate-300"}`}>
              <I className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === "calc" && (
          <div className="p-4 space-y-3">
            <div className="rounded-2xl lanx-group px-4 py-3">
              <input
                ref={inputRef}
                data-calc-input
                value={expr}
                onChange={(e) => setExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") press("=");
                  if (e.key === "Escape") press("C");
                }}
                placeholder="Type a sum, e.g. 1250 × 12 + 18%"
                className="w-full bg-transparent text-right text-[22px] font-semibold text-slate-900 dark:text-white outline-none placeholder:text-slate-400 placeholder:text-[14px]"
              />
              <div data-calc-result className="text-right text-[13px] text-slate-500 min-h-[18px]">{expr && (result !== null ? `= ${tidy(result)}` : "…")}</div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {keys.map((k) => (
                <button key={k} type="button" data-calc-key={k} onClick={() => press(k)} className={`h-11 rounded-xl text-[15px] font-semibold ${k === "=" ? "bg-sky-500 hover:bg-sky-600 text-white" : /[÷×\-+%()]/.test(k) || k === "C" ? "lanx-group text-sky-700 dark:text-sky-300" : "lanx-group text-slate-800 dark:text-slate-100"}`}>
                  {k}
                </button>
              ))}
              <button type="button" onClick={() => press("⌫")} className="h-11 rounded-xl lanx-group text-slate-600 flex items-center justify-center col-span-2"><Delete className="h-4 w-4" /></button>
              <button type="button" onClick={() => result !== null && copy(tidy(result))} className="h-11 rounded-xl lanx-group text-slate-600 flex items-center justify-center gap-1 col-span-2 text-[12px] font-semibold"><Copy className="h-4 w-4" /> Copy result</button>
            </div>
            {history.length > 0 && (
              <div className="max-h-28 overflow-y-auto text-[12px] text-slate-500 space-y-0.5">
                {history.map((h, i) => (
                  <button key={i} type="button" onClick={() => setExpr(h.split(" = ")[1].replace(/,/g, ""))} className="block w-full text-right hover:text-slate-800 dark:hover:text-slate-200">{h}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "gst" && (
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[11.5px] font-semibold text-slate-500">Amount (₹)</label>
              <input data-gst-amount value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 12500" inputMode="decimal" className="lanx-field mt-1 w-full rounded-[10px] px-3 py-2 text-[16px] font-semibold text-slate-900 dark:text-white" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold text-slate-500">GST rate</span>
              {[0, 5, 12, 18, 28].map((r) => (
                <button key={r} type="button" data-gst-rate={r} onClick={() => setRate(r)} className={`px-3 py-1 rounded-full text-[12px] font-semibold ${rate === r ? "bg-slate-700 text-white" : "lanx-group text-slate-600 dark:text-slate-300"}`}>{r}%</button>
              ))}
              <input value={rate} onChange={(e) => setRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="lanx-field w-16 rounded-[8px] px-2 py-1 text-[12px] text-slate-900 dark:text-white" />
            </div>
            <div className="flex flex-wrap gap-4 text-[12.5px]">
              <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-200"><input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} /> Amount already includes GST</label>
              <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-200"><input type="checkbox" checked={interstate} onChange={(e) => setInterstate(e.target.checked)} /> Inter-state (IGST)</label>
            </div>
            <div data-gst-result className="rounded-2xl lanx-group p-4 text-[13px] space-y-1.5 text-slate-700 dark:text-slate-200">
              <div className="flex justify-between"><span>Taxable value</span><b>₹ {money(base)}</b></div>
              {interstate ? (
                <div className="flex justify-between"><span>IGST {rate}%</span><b>₹ {money(tax)}</b></div>
              ) : (
                <>
                  <div className="flex justify-between"><span>CGST {rate / 2}%</span><b>₹ {money(tax / 2)}</b></div>
                  <div className="flex justify-between"><span>SGST {rate / 2}%</span><b>₹ {money(tax / 2)}</b></div>
                </>
              )}
              <div className="flex justify-between border-t lanx-line pt-1.5 text-[15px]"><span>Total</span><b className="text-slate-900 dark:text-white">₹ {money(total)}</b></div>
              <div className="pt-1 text-right">
                <button type="button" onClick={() => copy(`Taxable ₹${money(base)} + GST ${rate}% ₹${money(tax)} = ₹${money(total)}`)} className="text-[11.5px] font-semibold text-sky-600 inline-flex items-center gap-1"><Copy className="h-3 w-3" /> Copy breakdown</button>
              </div>
            </div>
          </div>
        )}

        {tab === "units" && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(UNITS).map(([id, c]) => (
                <button key={id} type="button" data-unit-cat={id} onClick={() => { setCat(id); const u = Object.keys(UNITS[id].units); setFrom(u[0]); setTo(u[1] ?? u[0]); }} className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold ${cat === id ? "bg-slate-700 text-white" : "lanx-group text-slate-600 dark:text-slate-300"}`}>{c.name}</button>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
              <div>
                <input data-unit-value value={uv} onChange={(e) => setUv(e.target.value)} inputMode="decimal" className="lanx-field w-full rounded-[10px] px-3 py-2 text-[16px] font-semibold text-slate-900 dark:text-white" />
                <select value={from} onChange={(e) => setFrom(e.target.value)} className="lanx-field mt-1 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white">
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => { setFrom(to); setTo(from); }} className="lanx-tool px-2 py-2 text-slate-500 text-[12px] font-semibold mb-1">⇄</button>
              <div>
                <div data-unit-result className="rounded-[10px] lanx-group px-3 py-2 text-[16px] font-semibold text-slate-900 dark:text-white min-h-[42px]">{converted !== null ? tidy(converted) : "…"}</div>
                <select value={to} onChange={(e) => setTo(e.target.value)} className="lanx-field mt-1 w-full rounded-[10px] px-2 py-1.5 text-[12.5px] text-slate-900 dark:text-white">
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div className="text-right">
              <button type="button" onClick={() => converted !== null && copy(`${uv} ${from} = ${tidy(converted)} ${to}`)} className="text-[11.5px] font-semibold text-sky-600 inline-flex items-center gap-1"><Copy className="h-3 w-3" /> Copy</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
