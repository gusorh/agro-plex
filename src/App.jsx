import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";

/* ══════════════════════════════════════════════════════════════════
   1. SOLVER — símplex de dos fases
   maximiza c·z  sujeto a  A z {≤,≥,=} b,  z ≥ 0
   Devuelve además los precios sombra (duales) de cada restricción.
   ══════════════════════════════════════════════════════════════════ */
function solveLP(nVars, cIn, rowsIn) {
  const EPS = 1e-9;
  if (nVars === 0) return { status: "vacio" };
  const m = rowsIn.length;
  const A = [], b = [], op = [], flip = [];
  for (const r of rowsIn) {
    let coef = r.coef.slice(), rhs = r.rhs, o = r.op;
    if (rhs < -EPS) {
      coef = coef.map((v) => -v); rhs = -rhs;
      o = o === "<=" ? ">=" : o === ">=" ? "<=" : "=";
      flip.push(true);
    } else flip.push(false);
    while (coef.length < nVars) coef.push(0);
    A.push(coef); b.push(rhs); op.push(o);
  }
  const slackIdx = new Array(m).fill(-1);
  const surIdx = new Array(m).fill(-1);
  const artIdx = new Array(m).fill(-1);
  let n = nVars;
  for (let i = 0; i < m; i++) {
    if (op[i] === "<=") slackIdx[i] = n++;
    else if (op[i] === ">=") { surIdx[i] = n++; artIdx[i] = n++; }
    else artIdx[i] = n++;
  }
  const T = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(n + 1).fill(0);
    for (let j = 0; j < nVars; j++) row[j] = A[i][j];
    if (slackIdx[i] >= 0) row[slackIdx[i]] = 1;
    if (surIdx[i] >= 0) row[surIdx[i]] = -1;
    if (artIdx[i] >= 0) row[artIdx[i]] = 1;
    row[n] = b[i];
    T.push(row);
  }
  const basis = [];
  for (let i = 0; i < m; i++) basis.push(artIdx[i] >= 0 ? artIdx[i] : slackIdx[i]);
  const isArt = new Array(n).fill(false);
  for (let i = 0; i < m; i++) if (artIdx[i] >= 0) isArt[artIdx[i]] = true;

  const pivot = (pr, pc) => {
    const pv = T[pr][pc];
    for (let j = 0; j <= n; j++) T[pr][j] /= pv;
    for (let i = 0; i < m; i++) {
      if (i === pr) continue;
      const f = T[i][pc];
      if (Math.abs(f) < 1e-14) continue;
      for (let j = 0; j <= n; j++) T[i][j] -= f * T[pr][j];
    }
    basis[pr] = pc;
  };
  const reduced = (cost, allowed) => {
    const d = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      if (!allowed[j]) { d[j] = Infinity; continue; }
      let s = 0;
      for (let i = 0; i < m; i++) s += cost[basis[i]] * T[i][j];
      d[j] = s - cost[j];
    }
    return d;
  };
  const iterate = (cost, allowed) => {
    for (let it = 0; it < 20000; it++) {
      const d = reduced(cost, allowed);
      let pc = -1;
      for (let j = 0; j < n; j++) if (d[j] < -1e-9) { pc = j; break; } // regla de Bland
      if (pc === -1) return "optimal";
      let pr = -1, best = Infinity, bb = Infinity;
      for (let i = 0; i < m; i++) {
        if (T[i][pc] > 1e-9) {
          const rt = T[i][n] / T[i][pc];
          if (rt < best - 1e-12 || (Math.abs(rt - best) <= 1e-12 && basis[i] < bb)) { best = rt; pr = i; bb = basis[i]; }
        }
      }
      if (pr === -1) return "unbounded";
      pivot(pr, pc);
    }
    return "error";
  };

  const todo = new Array(n).fill(true);
  if (artIdx.some((v) => v >= 0)) {
    const c1 = new Array(n).fill(0);
    for (let j = 0; j < n; j++) if (isArt[j]) c1[j] = -1;
    if (iterate(c1, todo) === "error") return { status: "error" };
    let w = 0;
    for (let i = 0; i < m; i++) if (isArt[basis[i]]) w += T[i][n];
    if (w > 1e-7) return { status: "infactible" };
    for (let i = 0; i < m; i++) {
      if (isArt[basis[i]]) {
        let pc = -1;
        for (let j = 0; j < n; j++) if (!isArt[j] && Math.abs(T[i][j]) > 1e-9) { pc = j; break; }
        if (pc >= 0) pivot(i, pc);
      }
    }
  }
  const c2 = new Array(n).fill(0);
  for (let j = 0; j < nVars; j++) c2[j] = cIn[j] || 0;
  const allow2 = new Array(n).fill(true);
  for (let j = 0; j < n; j++) if (isArt[j]) allow2[j] = false;
  const st = iterate(c2, allow2);
  if (st === "unbounded") return { status: "no_acotado" };
  if (st === "error") return { status: "error" };

  const x = new Array(nVars).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < nVars) x[basis[i]] = T[i][n];
  for (let j = 0; j < nVars; j++) if (Math.abs(x[j]) < 1e-9) x[j] = 0;
  let z = 0;
  for (let j = 0; j < nVars; j++) z += (cIn[j] || 0) * x[j];
  const dAll = reduced(c2, new Array(n).fill(true));
  const duals = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let y = 0;
    if (slackIdx[i] >= 0) y = dAll[slackIdx[i]];
    else if (surIdx[i] >= 0) y = -dAll[surIdx[i]];
    else if (artIdx[i] >= 0) y = dAll[artIdx[i]];
    if (flip[i]) y = -y;
    duals[i] = Math.abs(y) < 1e-7 ? 0 : y;
  }
  return { status: "optimo", x, z, duals };
}

/* ══════════════════════════════════════════════════════════════════
   2. DATOS BASE
   ══════════════════════════════════════════════════════════════════ */
const SUBD = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n) => String(n).split("").map((d) => SUBD[+d]).join("");

const NUTS = [
  { k: "N", lab: "N", nombre: "Nitrógeno", color: "#2F6B4F" },
  { k: "P", lab: "P₂O₅", nombre: "Fósforo", color: "#8A5A2B" },
  { k: "K", lab: "K₂O", nombre: "Potasio", color: "#1D6E8C" },
];

const CULTIVOS_0 = [
  { id: "maiz", nombre: "Maíz", color: "#E0A215", on: true, utilidad: 28000, agua: 5000, req: { N: 0.16, P: 0.06, K: 0.06 }, areaMin: 0, areaMax: 30 },
  { id: "frijol", nombre: "Frijol negro", color: "#6B4226", on: true, utilidad: 24000, agua: 3500, req: { N: 0.04, P: 0.06, K: 0.04 }, areaMin: 0, areaMax: 20 },
  { id: "calabaza", nombre: "Calabaza", color: "#D96C1F", on: true, utilidad: 26000, agua: 4000, req: { N: 0.09, P: 0.05, K: 0.08 }, areaMin: 0, areaMax: 15 },
  { id: "chile", nombre: "Chile jalapeño", color: "#3F7D3A", on: true, utilidad: 78000, agua: 7000, req: { N: 0.20, P: 0.08, K: 0.25 }, areaMin: 0, areaMax: 10 },
  { id: "jitomate", nombre: "Jitomate", color: "#C1272D", on: false, utilidad: 120000, agua: 8500, req: { N: 0.25, P: 0.12, K: 0.35 }, areaMin: 0, areaMax: 6 },
  { id: "cafe", nombre: "Café", color: "#7E5A9B", on: false, utilidad: 46000, agua: 2500, req: { N: 0.12, P: 0.04, K: 0.15 }, areaMin: 0, areaMax: 25 },
  { id: "cana", nombre: "Caña de azúcar", color: "#A3B93B", on: false, utilidad: 38000, agua: 12000, req: { N: 0.15, P: 0.06, K: 0.18 }, areaMin: 0, areaMax: 40 },
  { id: "naranja", nombre: "Naranja", color: "#2A7D9B", on: false, utilidad: 52000, agua: 9000, req: { N: 0.18, P: 0.05, K: 0.20 }, areaMin: 0, areaMax: 20 },
];

const FERTS_0 = [
  { id: "urea", marca: "Yara", nombre: "Urea", grado: "46-00-00", on: true, ap: { N: 0.46, P: 0, K: 0 }, costo: 12500, stock: 60, organico: false },
  { id: "sam", marca: "Fertinal", nombre: "Sulfato de amonio", grado: "20.5-00-00", on: true, ap: { N: 0.205, P: 0, K: 0 }, costo: 8200, stock: 80, organico: false },
  { id: "dap", marca: "Yara", nombre: "DAP", grado: "18-46-00", on: true, ap: { N: 0.18, P: 0.46, K: 0 }, costo: 17000, stock: 40, organico: false },
  { id: "map", marca: "Mosaic", nombre: "MAP", grado: "11-52-00", on: false, ap: { N: 0.11, P: 0.52, K: 0 }, costo: 18200, stock: 30, organico: false },
  { id: "kcl", marca: "Nutrien", nombre: "Cloruro de potasio", grado: "00-00-60", on: true, ap: { N: 0, P: 0, K: 0.60 }, costo: 11800, stock: 50, organico: false },
  { id: "sop", marca: "Haifa", nombre: "Sulfato de potasio", grado: "00-00-50", on: false, ap: { N: 0, P: 0, K: 0.50 }, costo: 19500, stock: 25, organico: false },
  { id: "t17", marca: "Fertinal", nombre: "Triple 17", grado: "17-17-17", on: true, ap: { N: 0.17, P: 0.17, K: 0.17 }, costo: 15200, stock: 60, organico: false },
  { id: "nk", marca: "Yara", nombre: "Nitrofoska", grado: "12-24-12", on: false, ap: { N: 0.12, P: 0.24, K: 0.12 }, costo: 16400, stock: 40, organico: false },
  { id: "comp", marca: "BioNutre", nombre: "Composta", grado: "2-1-1", on: true, ap: { N: 0.02, P: 0.01, K: 0.01 }, costo: 1200, stock: 300, organico: true },
];

const ASOCS_0 = [
  { id: 1, a: "frijol", op: ">=", k: 0.3, b: "maiz", on: true },
  { id: 2, a: "calabaza", op: ">=", k: 0.25, b: "maiz", on: true },
  { id: 3, a: "frijol", op: "<=", k: 0.6, b: "maiz", on: false },
];

const PAR_0 = {
  superficie: 50, usarAgua: true, agua: 280000,
  usarPresupuesto: true, presupuesto: 380000,
  usarStock: true, usarTope: false, tolerancia: 25,
  usarOrganico: false, beta: 20, detallado: false,
};

/* ══════════════════════════════════════════════════════════════════
   2b. CRÉDITOS DEL PROYECTO
   ══════════════════════════════════════════════════════════════════ */
const LOGO_FCA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAAFPCAMAAABEYLO0AAAAP1BMVEUAAACmwxH19vLw9ecWhzPooxHi6KLw8uny9OxXpWmjzKzL3GswlEq5z03l5rLofDAAAAAAAAAAAAAAAAAAAAAqNNI+AAAAEHRSTlMA/g30/v78nF/8+/z9+Qj+BwjUzQAAIJNJREFUeNrtXYmCs6oOzoQWEJf//d/2kAVExda21tqZ471n/hlXPrISQgD4zIHwpw7EP9XNBPfPUdjgKUh+BAMjwTXmdwv1MGJGggvWlL0Qzw2/B3FEg1NuJurGH1gQ17lfROOI0PuMGsHY678rGF9Q3YNx+EvkGL2HyMGJoDh4A//+/RtJHIG6SPPYAb+GvsAEHVAJzICv1sCgt1AXXO3waxgarhGgcaCAnbkWgJH4OfbANcoxfqkYT7WUAL5ah4UIlxT2xsY/Iw+Y8Tn8JoFGbfEImGUWBN8cMBJDU49A1tP6LH4NXnRMTSwAX/+B9YC3ANvJS5zz34KY3SjjskCisQT4nxU7VGPpazwROwTHDnPxFf47uJopxnZI24tCwWiHWG3NACNxwD/iAJPtdJTmSG7rvoPEA3iiaGlXfQKMNcA+AfaZna0Y6u8gMQEWfGNrBUAkWSHDkFg6AVZ46IDtdOKIbwHMPJqY2ioCwrRQWsQQ0SpZVC1uWKtfvwYwok8UGkbDNJJsqbTsvwkDs2PGDPEttlgBk7eMjBAVQgZMfwpgEWG+6FWlCYdfv4TAEYCjoYC2mU1TJJSFaxLi6FqKxa0DRmO1t76FwCh2iZiWRvmZxPFQwNHo0MGjpUH5Id6qFBZ5Z08Uz4wSSz+YLe812VYGzDR1oqbSMVptUBEeQGz2TGOdzbMW30okVhQ1MTUBZsTIzpYl94vjWSUORkxuhlFP0mQCYxER4pefSG5N8q0KZ0sJlUgscJeEQhYBciRFhCEp9PgKNcz6djwX4CsbFBSiIZOYh0jzduLsWLzon0i0G+krOu5kgK+qpCRswzGbK4/5hOwqsBzMmR7jFVCLlSQYJfaTBpdnAoxuYnlVMkG7AIcxcmVUQ+djxCwmOsIj0ZfgtTc+v9meTIhhROwNRyi9ZbE2CS3ppnjqOj0A2niTSxSmLoF/ErOm/yujaFeeSksLYGJhr6NAZ6wQ3HvSSkuwI2rW4F5CBvSYS/xsRffxSONU7pWTEV3SN9zeCFzGxIS2XUUrB9HZi6zH0b9YL2/yS+F8bqaMCHiQMzIfTSd4avf1/kG+Fo2IPYcxUYfFV+Wbs022SSid2saIPdsmovNWuHwQ5KimSECIQYziBXtCv5otL3tXiashOVHXBw7LKoDE2Wf5pYD1CUOY2WlI40AVwutjB2knn2ZfkozgKWePIw/a0WZSCyPe6+NHy241giK+nnmcaIwOeyl8F2WwvT5ztDxSHCi4BRIHOG9sh9wr0tKO3A8D1ycP1QHytnPHAbyVQb93j4vvHDGSXTKnjgPIMJBVjDMv4E009mnUeO7IB8mff1J+S8TVEeSHYzq4GtR6Ee/1uqarPtQHOIbdZ5PByAMje335UDmepfoMY68eL6wsYdVI7WsCrIDr6hlXv/tuvGn4zmpqKBr3lIe1ZpoKgmof64cPVWYchvzho2fUuBxKvCjEZfpDQVvb9vzZ9njA8mE5WkFdhGqcedEOF/RFDtTahFUOeyjiCMn+TI6+zaApvCrxjmeJnGKBOYwXwU7QHk5imiz6WRy9YI60kYSsp31piYPpOxJpYfaxCHg4VITbn+qRx+rsbT0BWcirodvB2b76md4eCThpadKX7aJBbRGfcA8bZI5zok5QLXuVuEjNw7FaC5NFtBX5Is3tUtj1IUlm8gJqUHf2XgH7ASs8c++8qbZNA1txkNw+Ir0SvqNXVt6Y3U0cDvUwZ9OYTrKqZvzXShDykYEikTeadApjT+EKWAqBDsNHxhJej/HbjlFH7l5ANuC2SXIrtpeC9rafoWWwyYFGP37/EPTo80yYfDX1OrWqbGtPLGr4wl0ig5Vc2hlcklvNY5QwGcdx80TcQYBjk6Kj0aoGcULoISmySXvV6cV78Z6U8TDVzL26ralHecpG9WTf2wMBT50N7vg0QUgM3M8MJjBbw21Xkuln2jkvKygiLbB27Eff4zDA7dzyUtMUNGWGTsjcEuOz8mpvSK/AnTxmUk6u19m4uXdnDtLTNbdSuE9TfmmRQ2wdFJckHbhOZCtptBFTO2EMrwbBL00AH2CPorDQASoulswAqo81IXIkU32YzPMyA0Wxxwd6m1/kWfnPPBv99FGZTaiKozp84GlecgxI3RZ94ZJNrvgaHqfk5XMyf+jqxG3V6ToIMNtATmpeuvaROJmxCxB0mudBZ0S2nGOMfkpe9lgGtj9Lb5oVhvoChzohKCaRSQ0whSzSN8HR6oxiOYJqjaRxgbfFcCtz80Td0ydk/Hk00NKVRi8jiKmQtTwfFk0RRSra0vHScRYk6UXNS2xLbkaefDRuysviTBvMVv84ZxoX6BdqlBpHE0wTR0SHBqhEBpOy9IpOYQ6XUN3yhYpwODwuPSZZ+bxkB+cesC7SoOBIWwSixEvkTES5Gu/rJ06KZBq2M5OXc80xD9GMOcYQY5lW5me6u59Alhz3Ql1bD87o+C/lJE45QOR8NgaRfhpHSv5QZzqKXJMOCCGYxJoaW5wRxkyIH2mYCC//TS5pgnj5jgw3pV2a+E0I+vlDEGNo4JKOjkGnyDQnRpYOR+Rbnkycwhp0wdYML0ZzZiaiQXDzyhaiaOxf6u1OPg7NUYAv06OLoI0uU5o6HL2uAy8UUwooYxnOF7wGp35Ga8YcYoYL0y8fBri7LI6IWbPQxPUtzSpOVbFVwS/x6pgKceKdpWg8C0toFp89CjBUADNzB5OSWQo69ZoVilMak3Bn5m3TqRFvn+AKWmi65VePBdzRMW2AcPbcS2K2Zv00IlZj205cEld0U6sJ0zzxUCHuBwA3UVfOWwJdSo8mKvcFW8MUseesLqWnriqN0CZPaKapWaiMzwDukvsx0yRdKFYy/JQk5VnUQmSNynVUTQNOxJecFs2nhdBdVo+l2/dOCgeXXIAwoXQXRVlmHgoWVa7OEZxeGIG4oBXxdWX3uETyNWbOgPEwwF3I8ylxjA6TlkXInEsXz7cj0aBE3EoSOc3XyK2FwnaStxjhwi241OkHUjgCVh2qk0hQQG6CS9MONiPGEjG0RhcKG80UzmEMkwaHkZvhFIBDATj78xSbGOWtAxnvD26CmFVxnxQXhX2chAVcpq9hiaaAXnO5e4RjfGlWmwVg1R2O1v1myI0sZKAYfJ/Nr+cpwQzN80RwKb9RgTlJYQwb8B4NeFZghxl7lOUoyJL1O7oXml1XIPaaZFxERYTR70mvWoRjAEOFwgrZkSzn5jjUad7COhX6qU1pwrawvgMtT4Ut5CUuOmh4KIArM9IonkKXETv1QUrEPveAVc2deN6xNx5/bsN7MGBd/TzPlaP4c0asub/ej3LMCljtc2/FBKvD5YCic86E++zcHQmYMvT5a7WVNWpQmpEGOsxPsyNGlohPpbovBlEb8HYyIgY4anIpXDLgaFfcItfSjUpHT5WaivyN5H9YMkJMYiueSBSCDfSFYwGLIRbArpZxEcXUKZ1EjmHUxKKpMmLG72mNnhP53cDP0QAIB4WD6nyompaEZhcCzKrm8HApIb6oHCO0o1sdIatUs96KxjfSV+R3i7JSJdEdN10KafTAme+LSmfqCTcJsYYiVXEZzw8lTR1VldHycdvoGwkcDtVZselJiJlyISw/zIKsiDuuBUdyPIZvKZTZ5riV0+IP2/DGHgz67+GA2fDGYXgl85U4FZIcJ0ktxoqQjHPO9d+KN75ORfgwwGi4ZbqKFKpdLdF2Ge50oCROYoxFvK7XWE4k8Ca8JCIC+LiigYUQ09F01b4mIiau5kFgjvpIcob+1Wv5FrfRv+oSRzfHraBGYb5G/nJB/IsqKyhi5voBfbZNozfS6xIlA1v9SemZLvgDAat3KYbJrIoTZr9Jll+OTG3yFFKr9hy6rXi5E6E7Nrs0JBTRBrtmlb0yYho60d2mn5E4EXibwmI54lujqjwOcGxgcrZQfYwVxFwcoMtMjaWmloQvayQfbeMAKY1dqLcPBJy+Kl4UqRvSWyufN0mMXRHT6oXEhiOU9OQ2vMwo6mYdmEOMSU93MqFLJI6I12xY8nzVMyuMsUmrJMJlI0MblabYf/7QVS1KtxznueXoJTOiid9pLJxzCdxmhib/XSd6wqEVAok4mcT0B4n0mqeHLkudK0nsddrU42a80efIRvjgFQBqionEoEa0W1UjLllOzqjMUmx0LarbaJEujYvMkMzcsSUgCyl24hh3zGbVqY9I1aSp4yAwmyara5O2MjQ0gaptjY7MwYDV9WXeQvEbmuDr/ACZxLF/TB4nad7GRhNMhsBDk349fB114kRmahDfKyL21RJh6lcQYcCn0LzMoXrYaoKjCsgm7vh148kWyxwtesepLk1Z6X6i1CHP90WZthkw4laTxG5d+ISKTmTz6kOBFMrWQTL4ZR24UcdJ7+hQWGfJtwbdfR5QNZ+oeKkelsbpMOMnxJWb3Thoz7bYPOBEC17I7tYH1vJgDtR1UoQ2attOpkrdnOHYi8yKWuPSPQPeRmAW2uSyfaqkKWaXv0lzv43Oorm5eaIJQQ1+cKI4WSbV0h1s8Th84ZQH/5nSHiNTX7Q8kB91SiUZQS4KNxCJ2fHYNOxnK5RD9OFjpWpGJ4nCdMU0SRdgMZZJ/kXHMVljes4U3sTRHVWeziG+xrhPVvZwMAYmCVRu1bzCe2TqADlNgbJQMceK7tGX+dkUwSL4HI0TU+voMCNWtp5I/Ohf8iiJUro2BHaaIHMwzcjdnzsKMW6CET2mubYdcNOKHWlGnubdpSSxuNmgnwu8l0/4lHXbRIiNIk6kKYuNcjWTbMQ0Z9TcDUXLOD+H+MB8uvYSI87xROHq7Bw3MKka7KGMJ2OewrjpT45Dkxzfhg8jzuzWCUUpN6fIysuLFcDnaBROAvq3xFfWwYQU8DAnKL1UIG5CypgeM1tyTnE2TKMc3hZh0gIyyzYVmjMco9ga9TLH9CWGrGdhAvimUeoayFMSXWkITnAgmoKrja61zNwK3A9cpBe6UvPcFOFG59hGgQmnqV7KSR1jGgsrYcqybRarIqYT2euAOTdZ53FGvOY0xQDL+X7NHmZBnmQVE2bIqQqqs2BFeLW2ozOlsMB5DjKVY6pS0Hxnx0sVRs6+dEkYOaGjrqS7rkm6Cse0PnVrToQYoWDhAFpxwtWTJqMQ86RURUl3ADr5QouNG80f7k5ZfbhIWSAiMWROKp5jTuXecR6+Y0OkGz76UdN3TbFb1ZmO2NLSFkncw3FWcdPM1mZIpZ5mtgoINL2F8jFNkoZOJilPd3Cm8Jjl3KTVsizMNIutK4/i36qmeU0fsGzzmifn0miDJlkzO4c0wXhCyG6kCxEZpFBDrtYTGHWX7BJRuCMlFdIea4KL0lObkc3Pu6mp5EuX6wCIr3PZB+9mNWVoxZlAjdfSAlIq2TGKxkVq0562WCsXWS4lUzh13MhwWrVI/8hja65hUS7daTjL78zFh2fyJy5xWoa01vAx55riICPcrhnVwHkRczH7ySomcpzAOV+gq+zW4llBzxZ8GfyKnbYJspksKWO9xCW3atMSUotrtqaPuNl/xd6tKMV4FolXHSQNNTt4lfvsZhr6F5uBfgFkwDnJgM0tVw3IZSJAlrjP1uUqM3/TxvFS0mCqgorhQZeLJixXQad111+3EXFe200KbGMOhxIXEL9x/3R2NXmqMECzATGwb8bx6m9i5jljQypHAU1zK4BFwg2m3H3rSw9Z553qjXANjunBoizlT2TlA/6KreK1+KqWHinCnQLVIeLvALrQZN5UDge/Eexdpf4rQeHMmQY4JTPjM0fN/WLPebrp4ThcwheacZZemnAs8r4Uzkw3PRy0AsZrmWa4LyfuQ2E/rbZVVp9FtyWV8NbHcFfAVdV65/CYR3fIVQxMtbZ9KjO0gTHxxtf2dr1t++BBFR1SMzDVJAaolbePZ3ur1aXuALb9+uf2leOViv83DluM9KlSbX/vfrg73Eez2ox274njZwCnHaSnJdR+brT5zl5huN5rpwAMKZPD3CXvWGjsVgzrBuD+NIDLCg/3n5E9S9c1yY1HTwKY+fmBh6JX7VdtkrsJGM8BGLaI7wSxWV/F2J6ewghuMz+nHWdWKgtTkkF7S+Xtm3H6FODhTiOrDXer3o8x/a2e2pfEz1G4LPv2AFOvUPi2sj8FYHhEYf0UtWuqOut2550B8ADu8edoYUDtGO6oP3sCwODszxOHNfW19bfVwRkA486A+ztPDR+n8BOPsYu5AvieJHwc8BqBdSs5u7brWgtPAP7ZN/T5OGDjV2ywhjhk84C+TiysFUGx97T7RwH3BLhf280u54fbrU7EPau0t9Zqq4x56zC+ztGTDSlXUFRGAgPc89neDtjejWq1VXYto3W4dtOiWtWAnwd8Z0FcnaOneFdI3EcTg49ZJeK4PdV0W+e7W4czddGeFAwcsN4tc2ptGGa2Ft8N+BYLjdUrZqG6CRlwJTD3FGCADwO21SAOzgHbLfK4JZBg3+xaPgWY986azpDsB3jPKM/DgIdVwDibPNkGGO1dV6Dd09d6G2Coaq3Fuwf49YCnnD9siPX2Xwx4PvSpiXDb/mbAS2XeL3Z9nJuAL6fwkp4VwL+FwuS2tYtb7G0//asBVzzptjKY3lGIzwfYVkYTvwmw/fnrgKO8vlNrfRxw+5cAIy6DCX0thGTdbiPEzwKuhGhbqEQYdhwSfxjwEpuF5Un4FsBwn8J2C+A91fQ7AdtKwNdMyxZV3chvBIyr6YT3APP2xu371PQbAd8vf1aLSZPbXAU8nJul9d5KSGx6va1S2N4Jip4R8Kbc7mXci7dKWH4hGqtvoPA9uDUzbPxQBfxWCtfmG4Z3AK7wrq+H+mGvvOmH55Z2BFx7lXWIldkrsG6n9Q9VCvvaoYDeDhhqgPcL1bbVFOUbBnRXwNBuB+zfBvinrxx5znJHwOPWVLOIrF+a57cCrkfD3yHDi7USsvtH5RP9LwAcKWmrolpNoLYevxxwuTHmDDBUAX87haspyKuAod1pPc9nAfc1M1w1xLsJ8ekAxw/8YsCV1yCuJNj+BsB2ZSa4mp33/YAr4/wE+I1q+nOAKa0eqh5zubP87ob4Y4BZhFcAV1l6p6DHZwEvB2r6mkoK0E5q+mSAdVHWUFul+/2A7c9aNLaazPTlgKvvMb8ZMIJdXRNRXcsU1fRwHOC+3Z3Cy2+3eQlBDfA+MYBPhXgkCLm0PDcA97uMlzYvAXD7Ah7qSlpNbT3H9l0UPiRMO6wo6WE1RC8jC3wLhW/VZzkGcHWdgd2DxJ+aalmzSkMW4mXll7MDvl2SBiufHl+CtYSJ9pspXP10Abi2fOvcgKnU/3qlJawND35o5vC2XTozYFp16Vd0X30A2LqizlTdLuG5WRpvxOCNvW0Pa4AtnpfCqLWWF0eqa1ORUWsmlYvfs57nrWlLlawlcwNwP7m16vS+vrv4Z1a1EOCHCr0krYXfBlgz8Whe6XG88MWAKxOHW47vBezNU3UirMevBPykCMemDfC3ALevV338HGD4Y4CfITDbpS8F/JSSJjWN3wh4eBqwfZnEHwIMfwowbSTW/i3AT1qlPdT0JwAPzyrpPdT0BwDj8GTFtV2CHh8YHtbDHUcJ8QfKWtRH/38OcL9c1dX2ZwCMmwGvVWqp94Vd7shVY/z2E4BNHfCsXsU64JWJo8WnaoD7V53L/QDjrF7FUGUEsxKi5YjkUB441AHDByhck61FPS23ChjrgJd1mKqFu17czXYvwLN0ZqzOhvFkyVAHbLYCNucA/DOtex3Zc8XvwJVdDhYeBUU2+/211uOAV0q6l9s/8LbUdZ0lW/L2K10xJ/GyddCagz2tNbvUmkwjxJVahj2/ukq5SlHT6oTaJwBjnad5j5LU6vqOF4oKzaaP4ppdOp7Cdc/QconwaFC4OG19cCduh30FsD2ewmuDnVYgE3nrvrLl/P66zqoCNvvHph8HzDll7Uq6nvjAbX1431tYq3jZrwDuzwB4bfywaaSzUu+ivrlBfUgNhwNe8S7vA8bVYVRbn+quMX874CcAPxGTSgYF7c8WM8y8VHdP8WDAD2/UMm0o2s3fXBlxHQ8Y3eMxizYBrpCttysfOgngu9uN3EpXqMWk21XA/UkAP75Zi5WRO1b9rFXAa8OHowHDw9vxWJP2hKzFpFd2Nan7KP0nAG8pdT43O8ko2dXknm2Afwx8AjDtVNo/orB2BOz3BrypjA64zVzNWy0h3ARc35rI7K6m60sAtryQNmK1mxBbl+NQK0OHtU+uxBpeAjx3a+Fn6+6ZPMynfTzv2KMyClVzLGnDz9Uutj+1zPidKbx5wgq9u7NZEm/gUuzx+JAnvWaXXgHsTSX/85E0bIK8ztgEd7JxaT3ndH37GdoLtnL7s4ApvrReZmgbV9OGrUDTQFCuu6LfGa3HWeAc65WNVnnooduf7ocH7/WyyVJblO5prWwefLZN01/ftZtqizEd3GxbZt7YcUDc8MUb3zzvxuKR+0r+w4d55ZsOpvL83PAUJU5Dv20KbAxV4Avq47fyRRWvNzsWwF9VCpD2yNbf63pisuxoPDOegvmG9noKxp+Lt8z+8bIN/exCmr8B/CKO3+gHhQ6Mfy8HkbmUzZDl99UiumnZNA3+xcimK4kyE8vk4gNOzvMDfPviLfoSPY8mQDBmdsHpF3x65JUj0H8GQiCk/LsJ8h/9Y+iG+C/Q5RDoNqqkyr8C3cUPx8ZA8Sj/GiZ/ycv4hwkNBCO1DWHyVZD76Wt0BuXtdIZJT02MjzTwGuTucrk0poEufqe5dPH30Ml/0MVmX+hy/HAX0DR8q6OWyq/yT6DmNJf4PzBdEwy9EUJzgXjSpAt0d+g6QiNvIcDhEj9h+KtB3xUbEeSZ+E8nFyB9IfZW09HTrwBuGup2BkziE9sYGgUsV6hNABdqWfx0hEEFr+NT8S86w1zg6TduKgGm52LnBX4Zvyh2WMNQ6Y+O7uRVhhFwpF7Dd9CjcKE/Q8hniBtGwEyAePXyEom5yYZ7NNAbmyrgTgBzWwQw38a9FUnu6TVBwTIlYjPju7X3IhQC3DT81tjeIKv549/6OWYOExJgEKRTwB0DJkF6KabFgONHE2AYAXckMw2fbIgZGcMSMChgkuoEOPJ/bLkCpjkiAdx01LdB5tRcPKnvMWEE3AngEPiMAkYfb6OWdPrFF2SYVAgBBgasjVPAXgE33C8NN3oCmL5PI0QgSWYIsZ0diGQyhTugAtncC/FEp5IsSvoSEmDDAkN9wYADTzJ3JYW1DYEk+CU1zUqASc2AaayZAce2Om5EJBYAUxgKwMSzlwvLMEkljZdEabHARvJ1HQGOFwwBjvIHxCiBeBNZZ4XQjTwgepBZmkg6AYwudkT83RkWjtcoTGq/SYCFvzNgNAmwaKQJSxODQ3BJhoVMxNIB2HxEIvOL6EiA2Tp1DRs3OUGvJjYi/s6A2XyPgJFEmNrFLNe8KsOemkaMOFdaRiksl43o5SlgtqKqtCArLQDhCgEs2ox0Mtsloj5EpRUBRyMTRBdECkdCNqPSgkKGVUmz/BrSDP5VpXWJbyP+ImxhBBy5kWWYPnaBpLT8FDDFW0RpdVlpRSYGMe7KKsRIDLghbSS6nnogCvqopcnaJ8DyskRhIiwDZrcEwqtmKXY1WVphLrKUgbQya2YB3LCyILPUFXY4eGLpZIdDk80Sn6NnLiywpNGIz5V9LyIYCKKxAkuKqkpVWg00apnVtiunxD7iF7wOGOi/2KROHYRO3ahOjC+oTubzPnlaofC0gLwiU3haRF3xtPid1FB+dSR0fAuQxetE80e9KX0V7wLx77gdLvY83cnOFQjbxVdSG9wLgMVjNuwuM7dE9iGExHNsq9jNdexcs7FA9qW5o3xgR43nmeiaU++Zjbo40MWF5Cnz22n3ipAeaNLNcpcjOxR/stTQBWKkELSJTdiwY8bN0RIVVOBRjYycQIck8peOf3RUZSSorpd8Hi3RjkHkcmF+i46dnA6CimEUD6mk1D+flwEVP6YDNXkZzEdgYztfcTzQx9E2hdzIAKfoG/+UiBykkFyOzWGKFuegMWfXSbAY8xOsy/jdxdP5NBev5F/lhzyGxbdY+Y+XfdnOPWIARQAZayFqvH0jLqNay8srv+PKy/QqrrXztbh0DsdgNdJT3Eih5uKhfB0mty2DPau/L76XAzlrYaMzhGY0hrFWnaZkFMQnJjg+G1d0oldSIqEonTFmk2e+s4JJQSEd56Ax5t3ByR0Bjxp3BBy1p+flOXPADAtHLS1FmLSPviIASYmlfUsT4bL4gJMSWomiUgqEHUbALU0getrXxkm+Fc2LxvO8MM1+CYklk9aa/icBbmlyFFL95AKw5WwCB6jZt71UkCQa/3wPYMmkba1ke6c8m3Sl/5kA1oLR2klEZfZs9MqXCDEt/oXepvQwyUmwsjvDLcDx/parNGgf9ScHXBgTSZbWVBUC3Gvl7wKwirAUfS8BK1P0ZweMxiTLr8nSCTAxax1w30cmthkwyX1vNK3FxoseJg7N2QC7TGrOR9PF+FQzmfn7LmDe/L3NgNvdNl954yRjciJZbanBjXza1gCTKu7pb45Aa35Zq2stfwhw63E4WxbDhKVTDWJZxSO1j5HpaIutzgSw2Oc2soIyO1E4pSeh5Z3gRYhrG16eArCl3Bxr3ESGqR8iRlvs/FUCJpYWWCLDipfFvpUrUYHJi89G40EB+1wYuFXA4lG0JYWH5JD0PwVg8USpjIfNSbGkD+TFZyMxpiBHUrm8VHvMdpUNKQUwlEthS8C6hjwtARgHHCfkaa7KyYspo+PRAntaPjGu6UfALcUkBuH1ln3mksIpI75lMfCShMxVO90pRxJqhkmAWzFMopYsFz0Q4aYcPB4qxZ7gWwsK6yCKfeqerqhbBs6dzkQl08GlsHrDlFWT6sDwAnECDJRlaYXXaTfwyAwekqcFmLVZBAxSNiAbu/OOlgznUVohJNkaRz95klCzXVGyYGnKpWX9Lbd7pbA8U9ZdPfHImOKGRQhTkiy98zynlo5BA5oUmeQQpfzFAfTZlW88iHIU+NkQ+fpKgCge4cDZhfIP/SR6aeURTHcBajJ8ul2UwSAv+NoUs80NfzNCPBj1H0oJPYs6hT+WiOv+GH0Zr/lz9P0ziN2ntPX/x6HHfyWdyUPRuAqrAAAAAElFTkSuQmCC";

const CREDITOS = {
  clave: "UVA-CA-220",
  ca: "Biotecnología, Biodiversidad y Manejo de los Recursos Naturales",
  proyecto: "Proyecto Educativo Innovador para las experiencias educativas Matemáticas, Nutrición Vegetal y Diagnóstico de Sistemas Productivos",
  programa: "Programa de Ingeniero Agrónomo · Facultad de Ciencias Agrícolas · Universidad Veracruzana",
  integrantes: [
    { n: "Dr. Gustavo Ortiz Hernández", m: "gustortiz@uv.mx" },
    { n: "Dra. Luz Amelia Sánchez Landero", m: "lusanchez@uv.mx" },
    { n: "Dr. Gustavo C. Ortiz Ceballos", m: "gusortiz@uv.mx" },
  ],
};

/* ══════════════════════════════════════════════════════════════════
   3. FORMATO
   ══════════════════════════════════════════════════════════════════ */
const nf = (n, d = 2) =>
  isFinite(n) ? Number(n).toLocaleString("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
const money = (n, d = 0) => "$" + nf(n, d);
const coefTxt = (a) => {
  const v = Math.abs(a);
  if (v === 0) return "0";
  if (Number.isInteger(v)) return v.toLocaleString("es-MX");
  if (v < 1) return String(parseFloat(v.toFixed(4)));
  return v.toLocaleString("es-MX", { maximumFractionDigits: 3 });
};

/* ══════════════════════════════════════════════════════════════════
   4. CONSTRUCCIÓN DEL MODELO LINEAL
   ══════════════════════════════════════════════════════════════════ */
function construirModelo(cultivos, ferts, asocs, p) {
  const C = cultivos.filter((c) => c.on);
  const F = ferts.filter((f) => f.on);
  const nc = C.length, nfz = F.length;
  const det = p.detallado;

  const vars = [];
  C.forEach((c, i) => vars.push({ sym: "x" + sub(i + 1), tipo: "x", nombre: c.nombre, desc: "hectáreas sembradas de " + c.nombre, unidad: "ha", ci: i, color: c.color }));
  if (det) {
    C.forEach((c, i) => F.forEach((f, j) =>
      vars.push({ sym: "y" + sub(i + 1) + "," + sub(j + 1), tipo: "y", nombre: f.nombre + " → " + c.nombre, desc: "t de " + f.nombre + " " + f.grado + " aplicadas al " + c.nombre, unidad: "t", ci: i, fj: j })));
  } else {
    F.forEach((f, j) => vars.push({ sym: "y" + sub(j + 1), tipo: "y", nombre: f.nombre + " " + f.grado, desc: "toneladas totales de " + f.nombre, unidad: "t", fj: j }));
  }
  const n = vars.length;
  const IX = (i) => i;
  const IY = (i, j) => (det ? nc + i * nfz + j : nc + j);

  const c = new Array(n).fill(0);
  C.forEach((cu, i) => (c[IX(i)] = cu.utilidad));
  if (det) C.forEach((_, i) => F.forEach((f, j) => (c[IY(i, j)] = -f.costo)));
  else F.forEach((f, j) => (c[IY(0, j)] = -f.costo));

  const rows = [];
  const Z = () => new Array(n).fill(0);
  const add = (o) => rows.push({ id: "R" + (rows.length + 1), ...o });

  if (nc > 0) {
    const a = Z();
    C.forEach((_, i) => (a[IX(i)] = 1));
    add({ grupo: "Tierra", nombre: "Superficie total", sim: "∑ᵢ xᵢ ≤ S", coef: a, op: "<=", rhs: p.superficie, unidad: "ha",
      lee: "No se puede sembrar más tierra de la que existe." });
  }
  if (p.usarAgua && nc > 0) {
    const a = Z();
    C.forEach((cu, i) => (a[IX(i)] = cu.agua));
    add({ grupo: "Agua", nombre: "Volumen de riego", sim: "∑ᵢ aᵢ xᵢ ≤ A", coef: a, op: "<=", rhs: p.agua, unidad: "m³",
      lee: "El agua consumida por el plan no puede exceder la lámina disponible en el ciclo." });
  }
  if (!det) {
    NUTS.forEach((nu) => {
      const a = Z();
      C.forEach((cu, i) => (a[IX(i)] = -cu.req[nu.k]));
      F.forEach((f, j) => (a[IY(0, j)] += f.ap[nu.k]));
      add({ grupo: "Nutrientes", nut: nu.k, nombre: "Balance de " + nu.lab,
        sim: "∑ⱼ pⱼ" + nu.k + " yⱼ ≥ ∑ᵢ rᵢ" + nu.k + " xᵢ", coef: a, op: ">=", rhs: 0, unidad: "t",
        lee: "Los fertilizantes comprados deben aportar al menos el " + nu.nombre.toLowerCase() + " que exige el plan de siembra." });
    });
  } else {
    C.forEach((cu, i) => NUTS.forEach((nu) => {
      const a = Z();
      a[IX(i)] = -cu.req[nu.k];
      F.forEach((f, j) => (a[IY(i, j)] = f.ap[nu.k]));
      add({ grupo: "Nutrientes", nut: nu.k, nombre: nu.lab + " en " + cu.nombre,
        sim: "∑ⱼ pⱼ" + nu.k + " y" + sub(i + 1) + ",ⱼ ≥ r" + sub(i + 1) + nu.k + " x" + sub(i + 1),
        coef: a, op: ">=", rhs: 0, unidad: "t",
        lee: "La mezcla aplicada al " + cu.nombre.toLowerCase() + " cubre su requerimiento de " + nu.lab + "." });
    }));
  }
  if (p.usarTope) {
    NUTS.forEach((nu) => {
      const a = Z();
      C.forEach((cu, i) => (a[IX(i)] = -(1 + p.tolerancia / 100) * cu.req[nu.k]));
      if (det) C.forEach((_, i) => F.forEach((f, j) => (a[IY(i, j)] += f.ap[nu.k])));
      else F.forEach((f, j) => (a[IY(0, j)] += f.ap[nu.k]));
      add({ grupo: "Nutrientes", nut: nu.k, nombre: "Tope de " + nu.lab + " (+" + p.tolerancia + "%)",
        sim: "∑ⱼ pⱼ" + nu.k + " yⱼ ≤ (1+τ) ∑ᵢ rᵢ" + nu.k + " xᵢ", coef: a, op: "<=", rhs: 0, unidad: "t",
        lee: "Evita la sobrefertilización: el aporte no supera el requerimiento más la tolerancia agronómica." });
    });
  }
  if (p.usarOrganico) {
    const a = Z();
    C.forEach((cu, i) => (a[IX(i)] = -(p.beta / 100) * cu.req.N));
    if (det) C.forEach((_, i) => F.forEach((f, j) => { if (f.organico) a[IY(i, j)] += f.ap.N; }));
    else F.forEach((f, j) => { if (f.organico) a[IY(0, j)] += f.ap.N; });
    add({ grupo: "Nutrientes", nombre: "N orgánico ≥ " + p.beta + "%", sim: "∑ⱼ∈O pⱼN yⱼ ≥ β ∑ᵢ rᵢN xᵢ",
      coef: a, op: ">=", rhs: 0, unidad: "t",
      lee: "Una fracción mínima del nitrógeno debe provenir de fuentes orgánicas." });
  }
  if (p.usarPresupuesto) {
    const a = Z();
    if (det) C.forEach((_, i) => F.forEach((f, j) => (a[IY(i, j)] = f.costo)));
    else F.forEach((f, j) => (a[IY(0, j)] = f.costo));
    add({ grupo: "Presupuesto", nombre: "Gasto en fertilizantes", sim: "∑ⱼ cⱼ yⱼ ≤ B", coef: a, op: "<=", rhs: p.presupuesto, unidad: "$",
      lee: "El desembolso en fertilizantes está limitado por la caja disponible." });
  }
  if (p.usarStock) {
    F.forEach((f, j) => {
      if (!(f.stock > 0)) return;
      const a = Z();
      if (det) C.forEach((_, i) => (a[IY(i, j)] = 1));
      else a[IY(0, j)] = 1;
      add({ grupo: "Disponibilidad", nombre: "Existencia · " + f.marca + " " + f.nombre,
        sim: (det ? "∑ᵢ yᵢ," : "y") + sub(j + 1) + " ≤ D" + sub(j + 1), coef: a, op: "<=", rhs: f.stock, unidad: "t",
        lee: "El proveedor no puede surtir más de ese volumen en el ciclo." });
    });
  }
  C.forEach((cu, i) => {
    if (cu.areaMin > 0) {
      const a = Z(); a[IX(i)] = 1;
      add({ grupo: "Áreas", nombre: "Área mínima · " + cu.nombre, sim: "x" + sub(i + 1) + " ≥ m" + sub(i + 1), coef: a, op: ">=", rhs: cu.areaMin, unidad: "ha",
        lee: "Compromiso de siembra ya contratado o autoconsumo." });
    }
    if (cu.areaMax > 0) {
      const a = Z(); a[IX(i)] = 1;
      add({ grupo: "Áreas", nombre: "Área máxima · " + cu.nombre, sim: "x" + sub(i + 1) + " ≤ M" + sub(i + 1), coef: a, op: "<=", rhs: cu.areaMax, unidad: "ha",
        lee: "Límite de mercado, de mano de obra o agronómico (rotación)." });
    }
  });
  asocs.filter((s) => s.on).forEach((s) => {
    const ia = C.findIndex((x) => x.id === s.a);
    const ib = C.findIndex((x) => x.id === s.b);
    if (ia < 0 || ib < 0 || ia === ib) return;
    const a = Z(); a[IX(ia)] = 1; a[IX(ib)] = -s.k;
    add({ grupo: "Asociación", nombre: C[ia].nombre + (s.op === ">=" ? " ≥ " : s.op === "<=" ? " ≤ " : " = ") + s.k + " × " + C[ib].nombre,
      sim: "x" + sub(ia + 1) + " − " + s.k + " x" + sub(ib + 1) + " " + (s.op === "<=" ? "≤" : s.op === ">=" ? "≥" : "=") + " 0",
      coef: a, op: s.op, rhs: 0, unidad: "ha",
      lee: "Regla de asociación / intercalado entre ambos cultivos." });
  });

  return { C, F, vars, c, rows, n, det, IX, IY, nc, nfz };
}

/* ── resumen de la solución ─────────────────────────────────────── */
function resumir(M, sol, p) {
  if (sol.status !== "optimo") return null;
  const { C, F, vars, rows, det, IX, IY } = M;
  const x = sol.x;
  const ha = C.map((cu, i) => ({ ...cu, ha: x[IX(i)] }));
  const haTotal = ha.reduce((s, c) => s + c.ha, 0);
  const agua = ha.reduce((s, c) => s + c.ha * c.agua, 0);
  const ingreso = ha.reduce((s, c) => s + c.ha * c.utilidad, 0);
  const fert = F.map((f, j) => {
    const porCultivo = C.map((cu, i) => ({ id: cu.id, nombre: cu.nombre, color: cu.color, t: det ? x[IY(i, j)] : 0 }));
    const t = det ? porCultivo.reduce((s, r) => s + r.t, 0) : x[IY(0, j)];
    return { ...f, t, costoTotal: t * f.costo, porCultivo };
  });
  const costoFert = fert.reduce((s, f) => s + f.costoTotal, 0);
  const nut = NUTS.map((nu) => ({
    ...nu,
    req: ha.reduce((s, c) => s + c.ha * c.req[nu.k], 0),
    apo: fert.reduce((s, f) => s + f.t * f.ap[nu.k], 0),
  }));
  const cons = rows.map((r, i) => {
    const lhs = r.coef.reduce((s, a, k) => s + a * x[k], 0);
    const hol = r.op === "<=" ? r.rhs - lhs : r.op === ">=" ? lhs - r.rhs : 0;
    return { ...r, lhs, holgura: hol, activa: Math.abs(hol) < 1e-6, dual: sol.duals[i] };
  });
  return { ha, haTotal, agua, ingreso, costoFert, z: sol.z, fert, nut, cons, libre: Math.max(0, p.superficie - haTotal) };
}

/* ══════════════════════════════════════════════════════════════════
   5. ESTILOS
   ══════════════════════════════════════════════════════════════════ */
const CSS = `
.lp{--tinta:#1A2216;--tinta2:#586252;--linea:#DCE1CE;--papel:#FFF;--campo:#F2F4EA;
 --verde:#2E5C3C;--verde2:#4E7B4A;--riego:#1D6E8C;--grano:#B7830E;--rojo:#9E3B27;--suelo:#6E5B45;
 background:var(--campo);color:var(--tinta);min-height:100%;
 font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px}
.lp *{box-sizing:border-box}
.serif{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-variant-numeric:tabular-nums}
.lp h1,.lp h2,.lp h3{margin:0;font-weight:600}
.hdr{background:#1E2A1A;color:#EDF0E2;position:sticky;top:0;z-index:30;
 background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.045) 0 2px,transparent 2px 11px)}
.eyebrow{letter-spacing:.18em;text-transform:uppercase;font-size:10px;color:#A8B79B}
.tabbar{display:flex;gap:2px;overflow-x:auto;border-top:1px solid #34452F}
.tabbtn{background:transparent;border:0;border-bottom:3px solid transparent;color:#B9C6AC;
 padding:9px 14px;font-size:13px;cursor:pointer;white-space:nowrap;font-weight:500}
.tabbtn:hover{color:#fff}
.tabbtn.on{color:#fff;border-bottom-color:var(--grano);background:rgba(255,255,255,.06)}
.card{background:var(--papel);border:1px solid var(--linea);border-radius:3px}
.card>header{padding:10px 14px;border-bottom:1px solid var(--linea);display:flex;
 align-items:baseline;justify-content:space-between;gap:10px}
.card>header h3{font-size:14px}
.hint{font-size:11.5px;color:var(--tinta2);line-height:1.5}
.pad{padding:14px}
table.t{width:100%;border-collapse:collapse;font-size:12.5px}
table.t th{text-align:left;font-weight:600;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;
 color:var(--tinta2);padding:7px 8px;border-bottom:1px solid var(--linea);white-space:nowrap;background:#FAFBF5}
table.t td{padding:5px 8px;border-bottom:1px solid #EDF0E4;vertical-align:middle}
table.t tr.off{opacity:.42}
table.t tr:hover td{background:#FAFBF2}
.num{width:82px;border:1px solid var(--linea);border-radius:2px;padding:3px 6px;text-align:right;
 background:#fff;color:var(--tinta);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.num:focus{outline:2px solid var(--verde2);outline-offset:-1px;border-color:var(--verde2)}
.num.w{width:110px}
.sel{border:1px solid var(--linea);border-radius:2px;padding:3px 6px;background:#fff;font-size:12px;color:var(--tinta)}
.btn{border:1px solid var(--linea);background:#fff;border-radius:2px;padding:6px 11px;font-size:12.5px;
 cursor:pointer;color:var(--tinta)}
.btn:hover{background:#F0F3E6;border-color:var(--verde2)}
.btn.pri{background:var(--verde);color:#fff;border-color:var(--verde)}
.btn.pri:hover{background:#26492F}
.btn.sm{padding:3px 8px;font-size:11.5px}
.sw{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.sw input{appearance:none;width:34px;height:19px;border-radius:10px;background:#CBD2BC;position:relative;
 cursor:pointer;transition:background .15s;flex:none;margin:0}
.sw input:checked{background:var(--verde2)}
.sw input::after{content:"";position:absolute;width:15px;height:15px;border-radius:50%;background:#fff;top:2px;left:2px;transition:left .15s}
.sw input:checked::after{left:17px}
.sw input:focus-visible{outline:2px solid var(--verde);outline-offset:2px}
.rng{width:100%;accent-color:var(--verde2)}
.kpi{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:3px;padding:7px 11px;min-width:112px}
.kpi .v{font-size:17px;font-weight:600;line-height:1.15}
.kpi .l{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:#A8B79B;margin-bottom:2px}
.math{background:#FBFCF6;border:1px solid var(--linea);border-left:3px solid var(--verde2);
 padding:11px 13px;border-radius:2px;line-height:2.1;word-break:break-word}
.vx{color:var(--verde);font-weight:600}
.vy{color:var(--riego);font-weight:600}
.op{color:var(--tinta2);padding:0 3px}
.badge{display:inline-block;font-size:10px;letter-spacing:.05em;text-transform:uppercase;
 padding:2px 6px;border-radius:2px;border:1px solid currentColor;font-weight:600}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:2px 8px;border-radius:2px;background:#F0F3E6;border:1px solid var(--linea)}
.dot{width:9px;height:9px;border-radius:2px;flex:none;display:inline-block}
.bar{height:7px;background:#E4E9D6;border-radius:4px;overflow:hidden}
.bar>i{display:block;height:100%;border-radius:4px}
.alerta{border-left:3px solid var(--rojo);background:#FCF3F0;padding:11px 13px;border-radius:2px;font-size:13px}
.ok{border-left:3px solid var(--verde2);background:#F1F6EC;padding:11px 13px;border-radius:2px;font-size:13px}
.scroll{overflow-x:auto}
.eq{background:#FBFCF6;border-top:1px solid var(--linea);border-bottom:1px solid var(--linea);
 padding:18px 14px;text-align:center;overflow-x:auto;font-size:17px;line-height:1.9}
.eq.sm{font-size:14px;padding:12px}
.par{color:var(--suelo);font-weight:600}
.qual{color:var(--tinta2);font-size:12px;margin-left:14px}
.dd{display:grid;grid-template-columns:112px 1fr;gap:10px;align-items:start}
.campo{display:grid;gap:3px}
.campo>span{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--tinta2);font-weight:600}
.txt{border:1px solid var(--linea);border-radius:2px;padding:6px 8px;background:#fff;font-size:13px;
 color:var(--tinta);font-family:inherit;width:100%}
.txt:focus{outline:2px solid var(--verde2);outline-offset:-1px;border-color:var(--verde2)}
textarea.txt{resize:vertical;min-height:74px;line-height:1.5}
.prev{width:100%;height:640px;border:1px solid var(--linea);border-radius:2px;background:#fff}
.marca{background:#fff;border-radius:3px;padding:4px 7px;flex:none;display:block}
.cred{background:#1E2A1A;color:#C3CEB4;margin-top:26px;
 background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.045) 0 2px,transparent 2px 11px)}
.cred-in{max-width:1180px;margin:0 auto;padding:24px 14px;display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
.cred-in img{height:104px;display:block}
.cred-tx{flex:1;min-width:260px}
.cred p{font-size:12.5px;line-height:1.65;margin:0 0 8px;max-width:74ch}
.cred-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(212px,1fr));gap:12px;margin-top:14px}
.cred-p{border-top:1px solid #3D5135;padding-top:8px}
.cred-p b{display:block;color:#F0F3E6;font-size:12.5px;font-weight:600;line-height:1.35}
.cred-p a{color:#D9BE6A;font-size:11.5px;text-decoration:none}
.cred-p a:hover{text-decoration:underline}
.cred-pie{border-top:1px solid #3D5135}
.cred-pie div{max-width:1180px;margin:0 auto;padding:11px 14px;font-size:10.5px;color:#8C9C7C;line-height:1.6}
@media (max-width:640px){.dd{grid-template-columns:1fr;gap:2px}.eq{font-size:15px}}
.lp a{color:var(--verde)}
@media (prefers-reduced-motion:reduce){.lp *{transition:none!important}}
`;

/* ══════════════════════════════════════════════════════════════════
   6. COMPONENTES BASE
   ══════════════════════════════════════════════════════════════════ */
function Num({ value, onChange, step = 1, min = 0, max, wide }) {
  const [t, setT] = useState(String(value));
  useEffect(() => { if (parseFloat(t) !== value) setT(String(value)); }, [value]);
  return (
    <input className={"num" + (wide ? " w" : "")} type="number" value={t} step={step} min={min} max={max}
      onChange={(e) => { const v = e.target.value; setT(v); const n = parseFloat(v); if (!isNaN(n)) onChange(n); }}
      onBlur={() => { const n = parseFloat(t); if (isNaN(n)) setT(String(value)); }} />
  );
}
const Sw = ({ on, set, children }) => (
  <label className="sw"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
    <span>{children}</span></label>
);
const Card = ({ title, aside, children, hint }) => (
  <section className="card">
    {(title || aside) && <header><h3 className="serif">{title}</h3>{aside}</header>}
    {hint && <p className="hint pad" style={{ paddingBottom: 0 }}>{hint}</p>}
    {children}
  </section>
);
const Dot = ({ c }) => <span className="dot" style={{ background: c }} />;

/* ══════════════════════════════════════════════════════════════════
   7. EL PREDIO (elemento distintivo)
   ══════════════════════════════════════════════════════════════════ */
function Predio({ res, sup }) {
  const COLS = 32, ROWS = 16, TOT = COLS * ROWS;
  const celdas = useMemo(() => {
    const out = [];
    if (!res || sup <= 0) return out;
    const items = res.ha.filter((c) => c.ha > 1e-9)
      .map((c) => ({ ...c, exacto: (c.ha / sup) * TOT }));
    const base = items.map((c) => ({ ...c, n: Math.floor(c.exacto) }));
    const objetivo = Math.min(TOT, Math.round(items.reduce((s, c) => s + c.exacto, 0)));
    let quedan = objetivo - base.reduce((s, c) => s + c.n, 0);
    base.sort((a, b) => (b.exacto % 1) - (a.exacto % 1));
    for (let i = 0; i < base.length && quedan > 0; i++, quedan--) base[i].n++;
    base.sort((a, b) => b.ha - a.ha);
    base.forEach((c) => { for (let i = 0; i < c.n; i++) out.push(c); });
    return out.slice(0, TOT);
  }, [res, sup]);

  const W = 640, H = 330, PAD = 14;
  const cw = (W - PAD * 2) / COLS, ch = (H - PAD * 2) / ROWS;
  const haCelda = sup / TOT;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label="Mapa del predio: cada celda representa una fracción de hectárea coloreada por cultivo">
        <defs>
          <pattern id="surco" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#C9BFA8" />
            <path d="M0 3 H6" stroke="#B7AB90" strokeWidth="1.2" />
          </pattern>
        </defs>
        <rect x="1" y="1" width={W - 2} height={H - 2} fill="url(#surco)" stroke="#8C7F63" strokeWidth="2" rx="3" />
        {Array.from({ length: TOT }).map((_, i) => {
          const c = celdas[i];
          const col = i % COLS, row = Math.floor(i / COLS);
          return (
            <rect key={i} x={PAD + col * cw + 0.7} y={PAD + row * ch + 0.7}
              width={cw - 1.4} height={ch - 1.4} rx="1.5"
              fill={c ? c.color : "transparent"} opacity={c ? 0.93 : 0}>
              {c && <title>{`${c.nombre} · ${nf(c.ha, 2)} ha`}</title>}
            </rect>
          );
        })}
      </svg>
      <p className="hint" style={{ marginTop: 6 }}>
        Cada celda ≈ {nf(haCelda, 3)} ha. La textura de surcos es tierra sin sembrar
        ({nf(res ? res.libre : sup, 2)} ha).
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   8. RENDER DEL MODELO
   ══════════════════════════════════════════════════════════════════ */
function Expr({ coef, vars, limite = 26 }) {
  const t = [];
  coef.forEach((a, i) => { if (Math.abs(a) > 1e-12) t.push({ a, v: vars[i] }); });
  if (!t.length) return <span className="mono">0</span>;
  const vis = t.slice(0, limite);
  return (
    <span className="mono" style={{ fontSize: 12.5 }}>
      {vis.map((p, k) => (
        <span key={k}>
          {k === 0 ? (p.a < 0 ? "−" : "") : <span className="op">{p.a < 0 ? "−" : "+"}</span>}
          {coefTxt(p.a) !== "1" && <>{coefTxt(p.a)}<span style={{ opacity: .45 }}>·</span></>}
          <span className={p.v.tipo === "x" ? "vx" : "vy"}>{p.v.sym}</span>{" "}
        </span>
      ))}
      {t.length > limite && <span className="op">… (+{t.length - limite} términos)</span>}
    </span>
  );
}

function ModeloVista({ M, res }) {
  const grupos = [...new Set(M.rows.map((r) => r.grupo))];
  const sgn = (o) => (o === "<=" ? "≤" : o === ">=" ? "≥" : "=");
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card title="Variables de decisión"
        hint="Todo lo que el productor puede decidir. Son continuas y no negativas: fracciones de hectárea y de tonelada están permitidas.">
        <div className="pad scroll">
          <table className="t">
            <thead><tr><th>Símbolo</th><th>Significado</th><th>Unidad</th><th style={{ textAlign: "right" }}>Valor óptimo</th></tr></thead>
            <tbody>
              {M.vars.map((v, i) => (
                <tr key={v.sym}>
                  <td className={"mono " + (v.tipo === "x" ? "vx" : "vy")} style={{ fontSize: 13 }}>{v.sym}</td>
                  <td>{v.desc}</td>
                  <td className="hint">{v.unidad}</td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: res && res.valores[i] > 1e-9 ? 600 : 400 }}>
                    {res ? nf(res.valores[i], 3) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Función objetivo — utilidad neta"
        hint="Ingreso por hectárea de cada cultivo menos el costo de las toneladas de fertilizante compradas. Es lineal: cada término es un coeficiente constante por una variable.">
        <div className="pad">
          <p className="serif" style={{ fontSize: 16, fontStyle: "italic", marginBottom: 8 }}>
            máx <b>Z</b> = ∑ᵢ uᵢ·xᵢ − ∑ⱼ cⱼ·yⱼ
          </p>
          <div className="math">
            <span className="serif" style={{ fontStyle: "italic", marginRight: 6 }}>máx Z =</span>
            <Expr coef={M.c} vars={M.vars} limite={40} />
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            uᵢ = margen bruto del cultivo i ($/ha, sin contar fertilizante) · cⱼ = precio del fertilizante j ($/t).
          </p>
        </div>
      </Card>

      <Card title={"Restricciones (" + M.rows.length + ")"}
        hint="Cada renglón es una desigualdad lineal. Los coeficientes negativos del lado izquierdo son requerimientos que se pasaron a la izquierda para dejar el término independiente solo.">
        <div className="pad" style={{ display: "grid", gap: 14 }}>
          {grupos.map((g) => (
            <div key={g}>
              <div className="eyebrow" style={{ color: "var(--tinta2)", marginBottom: 6 }}>{g}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {M.rows.filter((r) => r.grupo === g).map((r) => {
                  const c = res ? res.cons.find((x) => x.id === r.id) : null;
                  return (
                    <div key={r.id} className="math" style={{ borderLeftColor: c && c.activa ? "var(--grano)" : "var(--linea)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", lineHeight: 1.5 }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--tinta2)" }}>{r.id} · {r.nombre}</span>
                        <span className="serif" style={{ fontStyle: "italic", fontSize: 13 }}>{r.sim}</span>
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <Expr coef={r.coef} vars={M.vars} />
                        <span className="op" style={{ fontSize: 15, padding: "0 8px" }}>{sgn(r.op)}</span>
                        <span className="mono" style={{ fontWeight: 600 }}>{coefTxt(r.rhs)}</span>
                        <span className="hint"> {r.unidad}</span>
                      </div>
                      {c && (
                        <div className="hint" style={{ marginTop: 4 }}>
                          Izquierda = <b className="mono">{nf(c.lhs, 2)}</b> · holgura <b className="mono">{nf(c.holgura, 2)}</b>
                          {c.activa && <span className="badge" style={{ color: "var(--grano)", marginLeft: 8 }}>activa</span>}
                        </div>
                      )}
                      <div className="hint" style={{ marginTop: 2, fontStyle: "italic" }}>{r.lee}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {!M.rows.length && <p className="hint">Sin restricciones: activa al menos un cultivo.</p>}
        </div>
      </Card>

      <Card title="No negatividad">
        <div className="pad math">
          <span className="mono">xᵢ ≥ 0 &nbsp;∀i</span><span className="op"> , </span>
          <span className="mono">yⱼ ≥ 0 &nbsp;∀j</span>
          <p className="hint" style={{ marginTop: 6 }}>
            El modelo se resuelve con símplex de dos fases sobre la forma estándar: cada ≤ recibe una holgura,
            cada ≥ una variable de excedente y una artificial, y cada = una artificial.
            Tamaño: {M.n} variables de decisión y {M.rows.length} restricciones.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   8b. FORMULACIÓN MATEMÁTICA (pestaña didáctica)
   ══════════════════════════════════════════════════════════════════ */
const Sig = ({ lo, up }) => (
  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle", margin: "0 3px", lineHeight: 1 }}>
    <span style={{ fontSize: "0.42em", height: "1em" }}>{up || ""}</span>
    <span className="serif" style={{ fontSize: "1.45em", lineHeight: 0.85 }}>∑</span>
    <span style={{ fontSize: "0.42em" }}>{lo}</span>
  </span>
);
const X = ({ children }) => <span className="vx serif" style={{ fontStyle: "italic" }}>{children}</span>;
const Y = ({ children }) => <span className="vy serif" style={{ fontStyle: "italic" }}>{children}</span>;
const Pa = ({ children }) => <span className="par serif" style={{ fontStyle: "italic" }}>{children}</span>;
const Op = ({ children }) => <span className="op" style={{ padding: "0 7px" }}>{children}</span>;
const Dd = ({ t, children }) => (
  <div className="dd"><div className="eyebrow" style={{ paddingTop: 3 }}>{t}</div>
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>{children}</div></div>
);

function Ec({ num, titulo, off, estado, formula, children }) {
  return (
    <section className="card" style={off ? { opacity: 0.6 } : undefined}>
      <header>
        <h3 className="serif">{titulo}{off && <span className="badge" style={{ color: "var(--tinta2)", marginLeft: 8 }}>desactivada</span>}</h3>
        <span className="mono hint">({num})</span>
      </header>
      <div className="eq">{formula}</div>
      <div className="pad" style={{ display: "grid", gap: 9 }}>{children}</div>
      {estado && <div className="pad" style={{ borderTop: "1px solid var(--linea)", paddingTop: 8, paddingBottom: 8 }}>
        <span className="hint"><b>En tu modelo ahora: </b>{estado}</span></div>}
    </section>
  );
}

function Formulacion({ M, res, par }) {
  const det = M.det;
  const c0 = M.C[0], f0 = M.F.find((f) => f.ap.N > 0) || M.F[0];
  const cuenta = (filtro) => {
    const rs = M.rows.filter(filtro);
    const act = res ? res.cons.filter((c) => filtro(c) && c.activa).length : 0;
    return rs.length === 0 ? "no genera ninguna restricción." :
      `genera ${rs.length} restricción${rs.length > 1 ? "es" : ""}, ${act} activa${act === 1 ? "" : "s"} en el óptimo.`;
  };
  const yGen = det ? <Y>yᵢⱼ</Y> : <Y>yⱼ</Y>;
  const sumaY = det ? <Sig lo="j∈J" /> : <Sig lo="j∈J" />;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card title="Cómo se lee esta página"
        hint="Cada bloque muestra una ecuación en notación general, independiente de cuántos cultivos o marcas tengas, y debajo qué significa, en qué unidades vive y qué pasaría si la quitaras. Los colores se mantienen en toda la app: verde para las variables de área, azul para las de fertilizante, café para los parámetros que tú capturas.">
        <div className="pad" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span className="tag"><X>xᵢ</X> variable de área</span>
          <span className="tag">{yGen} variable de fertilizante</span>
          <span className="tag"><Pa>uᵢ, cⱼ, S, A…</Pa> parámetros (datos)</span>
        </div>
      </Card>

      {/* ── conjuntos ── */}
      <Card title="Conjuntos e índices" hint="Un modelo se escribe con índices para que la formulación no cambie cuando agregas un cultivo o una marca: solo crece el tamaño de los conjuntos.">
        <div className="pad scroll">
          <table className="t">
            <thead><tr><th>Conjunto</th><th>Índice</th><th>Significado</th><th>Contenido actual</th></tr></thead>
            <tbody>
              <tr><td className="serif" style={{ fontStyle: "italic" }}>I</td><td className="serif" style={{ fontStyle: "italic" }}>i</td>
                <td>Cultivos habilitados</td><td className="hint">{M.C.length ? M.C.map((c) => c.nombre).join(", ") : "—"} ({M.C.length})</td></tr>
              <tr><td className="serif" style={{ fontStyle: "italic" }}>J</td><td className="serif" style={{ fontStyle: "italic" }}>j</td>
                <td>Fertilizantes habilitados (marca + fórmula)</td><td className="hint">{M.F.length ? M.F.map((f) => f.nombre + " " + f.grado).join(", ") : "—"} ({M.F.length})</td></tr>
              <tr><td className="serif" style={{ fontStyle: "italic" }}>K</td><td className="serif" style={{ fontStyle: "italic" }}>k</td>
                <td>Nutrientes del balance</td><td className="hint">N, P₂O₅, K₂O (3)</td></tr>
              <tr><td className="serif" style={{ fontStyle: "italic" }}>O ⊆ J</td><td className="serif" style={{ fontStyle: "italic" }}>j</td>
                <td>Fertilizantes de origen orgánico</td><td className="hint">{M.F.filter((f) => f.organico).map((f) => f.nombre).join(", ") || "ninguno marcado"}</td></tr>
              <tr><td className="serif" style={{ fontStyle: "italic" }}>P ⊂ I×I</td><td className="serif" style={{ fontStyle: "italic" }}>(a,b)</td>
                <td>Parejas de cultivos con regla de asociación</td><td className="hint">{M.rows.filter((r) => r.grupo === "Asociación").length} pareja(s) activa(s)</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── parámetros ── */}
      <Card title="Parámetros" hint="Son los datos que capturas en las otras pestañas. En programación lineal son constantes conocidas: el modelo supone certidumbre, y por eso conviene volver a correrlo con precios pesimistas y optimistas.">
        <div className="pad scroll">
          <table className="t">
            <thead><tr><th>Símbolo</th><th>Significado</th><th>Unidad</th><th>Valor actual</th></tr></thead>
            <tbody>
              {[["S", "Superficie total del predio", "ha", nf(par.superficie, 2)],
                ["A", "Volumen de agua de riego del ciclo", "m³", par.usarAgua ? nf(par.agua, 0) : "sin límite"],
                ["B", "Presupuesto para fertilizante", "$", par.usarPresupuesto ? money(par.presupuesto) : "sin límite"],
                ["uᵢ", "Margen bruto del cultivo i, sin contar fertilizante", "$/ha", M.C.length ? money(Math.min(...M.C.map((c) => c.utilidad))) + " a " + money(Math.max(...M.C.map((c) => c.utilidad))) : "—"],
                ["aᵢ", "Lámina de riego que consume el cultivo i", "m³/ha", M.C.length ? nf(Math.min(...M.C.map((c) => c.agua)), 0) + " a " + nf(Math.max(...M.C.map((c) => c.agua)), 0) : "—"],
                ["rᵢₖ", "Requerimiento del nutriente k por hectárea del cultivo i", "t/ha", c0 ? `p. ej. ${c0.nombre}: N ${nf(c0.req.N, 3)}, P₂O₅ ${nf(c0.req.P, 3)}, K₂O ${nf(c0.req.K, 3)}` : "—"],
                ["pⱼₖ", "Aporte del nutriente k por tonelada del fertilizante j", "t/t", f0 ? `p. ej. ${f0.nombre} ${f0.grado}: N ${nf(f0.ap.N, 3)}` : "—"],
                ["cⱼ", "Precio del fertilizante j", "$/t", M.F.length ? money(Math.min(...M.F.map((f) => f.costo))) + " a " + money(Math.max(...M.F.map((f) => f.costo))) : "—"],
                ["Dⱼ", "Existencia máxima del fertilizante j", "t", par.usarStock ? "según proveedor" : "sin límite"],
                ["mᵢ, Mᵢ", "Área mínima y máxima del cultivo i", "ha", "por cultivo"],
                ["τ", "Tolerancia de sobrefertilización", "%", par.usarTope ? nf(par.tolerancia, 0) + " %" : "no aplica"],
                ["β", "Fracción mínima de nitrógeno orgánico", "%", par.usarOrganico ? nf(par.beta, 0) + " %" : "no aplica"],
                ["kₐᵦ", "Factor de proporción entre dos cultivos asociados", "adimensional", "por regla"]]
                .map(([s, d, u, v]) => (
                  <tr key={s}><td className="serif par" style={{ fontStyle: "italic", fontSize: 14 }}>{s}</td>
                    <td>{d}</td><td className="hint">{u}</td><td className="mono hint">{v}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── variables ── */}
      <Ec num="1" titulo="Variables de decisión"
        formula={<>
          <X>xᵢ</X> <Op>≥</Op> 0 <span className="qual">∀ i ∈ I</span>
          <span style={{ display: "inline-block", width: 28 }} />
          {yGen} <Op>≥</Op> 0 <span className="qual">∀ {det ? "i ∈ I, j ∈ J" : "j ∈ J"}</span>
        </>}
        estado={`${M.nc} variable(s) de área y ${det ? M.nc * M.nfz : M.nfz} de fertilizante; ${M.n} en total.`}>
        <Dd t="Qué son"><X>xᵢ</X> son las hectáreas que se siembran del cultivo i.{" "}
          {det ? <>{yGen} son las toneladas del fertilizante j que se aplican al cultivo i.</>
            : <>{yGen} son las toneladas del fertilizante j que se compran para todo el predio.</>}</Dd>
        <Dd t="Por qué continuas">Se admite sembrar 12.4 ha o comprar 3.7 t. Si exigieras parcelas enteras o bultos
          completos el problema dejaría de ser lineal continuo y pasaría a ser entero mixto, que necesita ramificación
          y acotamiento en vez de símplex.</Dd>
        <Dd t="No negatividad">No existe “sembrar menos cero hectáreas”. Esta condición es la que permite que el símplex
          recorra los vértices de la región factible: sin ella el poliedro no tendría esquinas donde buscar.</Dd>
      </Ec>

      {/* ── objetivo ── */}
      <Ec num="2" titulo="Función objetivo — utilidad neta"
        formula={<>máx <b className="serif" style={{ fontStyle: "italic" }}>Z</b> <Op>=</Op>
          <Sig lo="i∈I" /> <Pa>uᵢ</Pa><X>xᵢ</X> <Op>−</Op> {sumaY}{det && <Sig lo="i∈I" />} <Pa>cⱼ</Pa>{yGen}</>}
        estado={res ? `Z = ${money(res.z)} = ${money(res.ingreso)} de margen − ${money(res.costoFert)} de fertilizante.` : "sin solución."}>
        <Dd t="Lee así">Suma lo que deja cada hectárea sembrada y réstale lo que cuestan las toneladas de fertilizante
          compradas. El resultado es la utilidad neta del ciclo.</Dd>
        <Dd t="Unidades">$/ha × ha = $, y $/t × t = $. Los dos sumandos viven en pesos, que es la condición para poder
          restarlos. Revisar unidades es la forma más rápida de detectar un error de formulación.</Dd>
        <Dd t="Qué supone">Que el margen por hectárea es constante: la hectárea número 30 de maíz deja lo mismo que la
          primera. Si el precio de venta bajara al vender más volumen, el ingreso sería cuadrático y ya no serviría el
          símplex. Lo mismo con descuentos por volumen en el fertilizante.</Dd>
        <Dd t="Truco útil">Todo modelo de máximo se puede escribir como mínimo cambiando el signo: máx Z equivale a
          mín (−Z). Aquí el costo del fertilizante entra con signo negativo justamente por eso.</Dd>
      </Ec>

      {/* ── tierra ── */}
      <Ec num="3" titulo="Restricción de tierra"
        formula={<><Sig lo="i∈I" /> <X>xᵢ</X> <Op>≤</Op> <Pa>S</Pa></>}
        estado={cuenta((r) => r.grupo === "Tierra")}>
        <Dd t="Lee así">La suma de las superficies sembradas no puede pasar del tamaño del predio.</Dd>
        <Dd t="Unidades">Hectáreas de los dos lados.</Dd>
        <Dd t="Por qué ≤ y no =">Puede convenir dejar tierra ociosa, por ejemplo si el agua o el presupuesto se acaban
          antes. Si escribieras “=” obligarías a sembrar todo aunque fuera a pérdida.</Dd>
        <Dd t="Precio sombra">Si esta restricción queda activa, su dual dice cuánto pagarías como máximo por rentar una
          hectárea más. {!res ? <>Ahora no hay solución óptima que interpretar.</>
            : res.cons.some((c) => c.grupo === "Tierra" && c.activa)
              ? <>Ahora mismo vale <b>{money(res.cons.find((c) => c.grupo === "Tierra").dual)}</b> por hectárea.</>
              : <>Ahora sobra tierra, así que su dual es cero.</>}</Dd>
      </Ec>

      {/* ── agua ── */}
      <Ec num="4" titulo="Restricción de agua de riego" off={!par.usarAgua}
        formula={<><Sig lo="i∈I" /> <Pa>aᵢ</Pa><X>xᵢ</X> <Op>≤</Op> <Pa>A</Pa></>}
        estado={cuenta((r) => r.grupo === "Agua")}>
        <Dd t="Lee así">Cada hectárea del cultivo i consume <Pa>aᵢ</Pa> metros cúbicos en el ciclo; el total no puede
          exceder el volumen concesionado.</Dd>
        <Dd t="Unidades">m³/ha × ha = m³.</Dd>
        <Dd t="Ejemplo">{c0
          ? <>Con {c0.nombre.toLowerCase()} a {nf(c0.agua, 0)} m³/ha, sembrar 10 ha consume {nf(c0.agua * 10, 0)} m³ del
            total de {nf(par.agua, 0)} m³ disponibles.</>
          : "Activa un cultivo para ver el ejemplo."}</Dd>
        <Dd t="Por qué importa">Es la restricción que hace competir a los cultivos rentables pero sedientos contra los
          modestos y sobrios. Sin ella el modelo escogería siempre el cultivo de mayor margen.</Dd>
      </Ec>

      {/* ── balance nutrientes ── */}
      <Ec num="5" titulo="Balance de nutrientes"
        formula={det
          ? <><Sig lo="j∈J" /> <Pa>pⱼₖ</Pa><Y>yᵢⱼ</Y> <Op>≥</Op> <Pa>rᵢₖ</Pa><X>xᵢ</X> <span className="qual">∀ i ∈ I, ∀ k ∈ K</span></>
          : <><Sig lo="j∈J" /> <Pa>pⱼₖ</Pa><Y>yⱼ</Y> <Op>≥</Op> <Sig lo="i∈I" /> <Pa>rᵢₖ</Pa><X>xᵢ</X> <span className="qual">∀ k ∈ K</span></>}
        estado={cuenta((r) => !!r.nut && r.op === ">=")}>
        <Dd t="Lee así">Lo que aportan los fertilizantes comprados debe cubrir al menos lo que el plan de siembra
          demanda, nutriente por nutriente. Es el corazón del modelo: conecta las variables de área con las de
          fertilización.</Dd>
        <Dd t="Ejemplo">{c0 && f0
          ? <>Una hectárea de {c0.nombre.toLowerCase()} pide {nf(c0.req.N, 3)} t de N. Una tonelada de{" "}
            {f0.nombre} {f0.grado} aporta {nf(f0.ap.N, 3)} t de N, así que harían falta{" "}
            <b>{f0.ap.N > 0 ? nf(c0.req.N / f0.ap.N, 3) : "—"} t</b> de ese producto por hectárea si fuera la única
            fuente, a un costo de {f0.ap.N > 0 ? money((c0.req.N / f0.ap.N) * f0.costo) : "—"} por hectárea.</>
          : "Activa un cultivo y un fertilizante para ver el ejemplo."}</Dd>
        <Dd t="Forma estándar">Los dos lados traen variables, así que para resolver se pasan todas a la izquierda:{" "}
          <span className="mono">∑ⱼ pⱼₖyⱼ − ∑ᵢ rᵢₖxᵢ ≥ 0</span>. Sigue siendo lineal porque solo movimos términos; por eso
          en la pestaña de datos verás coeficientes negativos acompañando a las <X>xᵢ</X>.</Dd>
        <Dd t="Por qué ≥ y no =">Casi ningún producto aporta un solo nutriente. Al comprar DAP para cubrir el fósforo
          entra nitrógeno “de regalo”, y forzar la igualdad haría infactibles muchas combinaciones razonables. El exceso
          se controla aparte con la ecuación (6).</Dd>
        <Dd t="Global vs. por cultivo">{det
          ? <>Estás en modo detallado: cada cultivo tiene su propio balance, por eso el índice i aparece también en la
            variable de fertilizante y la ecuación se repite {M.nc} × 3 veces.</>
          : <>Estás en modo global: el balance se cumple para el predio completo, lo que implícitamente supone que los
            nutrientes se pueden repartir libremente entre parcelas. Enciende el modo detallado en la pestaña de recursos
            para exigir el balance cultivo por cultivo.</>}</Dd>
      </Ec>

      {/* ── tope ── */}
      <Ec num="6" titulo="Tope de sobrefertilización" off={!par.usarTope}
        formula={<>{sumaY} <Pa>pⱼₖ</Pa>{yGen} <Op>≤</Op> (1 + <Pa>τ</Pa>) <Sig lo="i∈I" /> <Pa>rᵢₖ</Pa><X>xᵢ</X> <span className="qual">∀ k ∈ K</span></>}
        estado={cuenta((r) => !!r.nut && r.op === "<=")}>
        <Dd t="Lee así">El aporte de cada nutriente no puede superar el requerimiento más un margen de tolerancia τ.
          Es la contraparte agronómica y ambiental de la ecuación (5).</Dd>
        <Dd t="Por qué es lineal">τ es un dato, no una variable, así que (1+τ) es solo un coeficiente. Si en cambio
          quisieras que el modelo eligiera τ, el término (1+τ)·xᵢ sería un producto de dos variables y el problema
          dejaría de ser lineal.</Dd>
        <Dd t="Efecto práctico">Con τ chico, el modelo se ve obligado a usar fórmulas balanceadas en vez de comprar el
          producto más barato por unidad de nutriente y desperdiciar el resto. Prueba con 10 % y observa cómo cambia la
          mezcla y cuánto sube el costo.</Dd>
      </Ec>

      {/* ── organico ── */}
      <Ec num="7" titulo="Fracción mínima de nitrógeno orgánico" off={!par.usarOrganico}
        formula={<><Sig lo="j∈O" /> <Pa>pⱼN</Pa>{yGen} <Op>≥</Op> <Pa>β</Pa> <Sig lo="i∈I" /> <Pa>rᵢN</Pa><X>xᵢ</X></>}
        estado={cuenta((r) => r.nombre.startsWith("N orgánico"))}>
        <Dd t="Lee así">Al menos una fracción β del nitrógeno total debe venir de los productos marcados como orgánicos,
          o sea del subconjunto O.</Dd>
        <Dd t="Para qué sirve">Modela una certificación, un programa de suelo o una norma. Es el ejemplo típico de
          restricción “de política”: no viene de la física del problema sino de una decisión externa.</Dd>
        <Dd t="Qué esperar">La composta suele ser cara por tonelada de nutriente, así que esta restricción casi siempre
          empeora Z. La diferencia entre el Z con y sin la regla es exactamente el costo de la política, y el dual te lo
          da por unidad.</Dd>
      </Ec>

      {/* ── presupuesto ── */}
      <Ec num="8" titulo="Presupuesto de fertilizante" off={!par.usarPresupuesto}
        formula={<>{sumaY}{det && <Sig lo="i∈I" />} <Pa>cⱼ</Pa>{yGen} <Op>≤</Op> <Pa>B</Pa></>}
        estado={cuenta((r) => r.grupo === "Presupuesto")}>
        <Dd t="Lee así">El desembolso en fertilizante no puede pasar de la caja disponible. Es el mismo término que
          aparece restando en la función objetivo, ahora con un límite propio.</Dd>
        <Dd t="Detalle fino">Que un gasto esté en el objetivo y además acotado no es redundante: el objetivo dice que
          gastar duele, la restricción dice que a partir de cierto punto es imposible aunque fuera rentable.</Dd>
        <Dd t="Interpretación del dual">Si queda activa, el dual es el rendimiento marginal del crédito: cuántos pesos
          de utilidad genera un peso más de financiamiento. Si supera el costo del crédito, endeudarse conviene.</Dd>
      </Ec>

      {/* ── disponibilidad ── */}
      <Ec num="9" titulo="Disponibilidad por marca" off={!par.usarStock}
        formula={<>{det ? <><Sig lo="i∈I" /> <Y>yᵢⱼ</Y></> : <Y>yⱼ</Y>} <Op>≤</Op> <Pa>Dⱼ</Pa> <span className="qual">∀ j ∈ J</span></>}
        estado={cuenta((r) => r.grupo === "Disponibilidad")}>
        <Dd t="Lee así">Ningún proveedor puede surtir más de <Pa>Dⱼ</Pa> toneladas en el ciclo.</Dd>
        <Dd t="Por qué una por marca">Es una familia de restricciones: el símbolo ∀ j ∈ J indica que se escribe una vez
          por cada fertilizante. Así es como una sola línea de notación se convierte en varios renglones de la matriz.</Dd>
        <Dd t="Cota superior">Las restricciones de esta forma, con una sola variable, se llaman cotas. El símplex las
          puede tratar de manera especial y más rápida, aunque aquí se resuelven como cualquier otro renglón.</Dd>
      </Ec>

      {/* ── areas ── */}
      <Ec num="10" titulo="Áreas mínimas y máximas por cultivo"
        formula={<><Pa>mᵢ</Pa> <Op>≤</Op> <X>xᵢ</X> <Op>≤</Op> <Pa>Mᵢ</Pa> <span className="qual">∀ i ∈ I</span></>}
        estado={cuenta((r) => r.grupo === "Áreas")}>
        <Dd t="Lee así">Cada cultivo tiene un piso, por compromisos de venta o autoconsumo, y un techo, por mercado,
          mano de obra o rotación del suelo.</Dd>
        <Dd t="Cómo se captura">En la pestaña Cultivos, un cero significa “sin límite” y entonces esa restricción
          simplemente no se escribe. Solo se generan los renglones que hacen falta.</Dd>
        <Dd t="Cuidado con la factibilidad">Si la suma de los mínimos supera S, el modelo se vuelve infactible: no hay
          ningún plan que cumpla todo a la vez. Es el error más común al armar estos modelos.</Dd>
      </Ec>

      {/* ── asociacion ── */}
      <Ec num="11" titulo="Asociación entre cultivos"
        formula={<><X>x</X><sub className="vx">a</sub> <Op>−</Op> <Pa>kₐᵦ</Pa> <X>x</X><sub className="vx">b</sub> <Op>≤</Op> 0
          <span className="qual">∀ (a,b) ∈ P</span></>}
        estado={cuenta((r) => r.grupo === "Asociación")}>
        <Dd t="Lee así">El área del cultivo a no puede pasar de <Pa>kₐᵦ</Pa> veces el área del cultivo b. Con ≥ se
          consigue lo contrario: obligar a que a acompañe a b, como el frijol al maíz en la milpa.</Dd>
        <Dd t="El detalle clave">La forma natural de decirlo es “la proporción xₐ / x_b no debe pasar de k”, pero una
          división entre variables no es lineal. Como x_b ≥ 0, se multiplican ambos lados y queda{" "}
          <span className="mono">xₐ ≤ k·x_b</span>, es decir <span className="mono">xₐ − k·x_b ≤ 0</span>. Es la
          transformación más útil que se aprende en un curso de programación lineal.</Dd>
        <Dd t="Lado derecho cero">El término independiente es 0 porque todas las variables quedaron a la izquierda.
          Un cero a la derecha no tiene nada de raro: significa que la restricción compara dos decisiones entre sí en
          vez de compararlas contra un recurso fijo.</Dd>
        <Dd t="Qué cuesta">Si la regla queda activa, su dual mide cuánta utilidad sacrificas por sembrar asociado. Ese
          número es el argumento económico para discutir la práctica agronómica.</Dd>
      </Ec>

      {/* ── forma matricial ── */}
      <Card title="Forma compacta y forma estándar"
        hint="Todo lo anterior se puede escribir en dos renglones. Así es como el solucionador ve el problema.">
        <div className="eq sm">
          máx <span className="serif" style={{ fontStyle: "italic" }}>Z</span> = <b>c</b>ᵀ<b>z</b>
          <span className="qual">sujeto a</span> <b>A</b><b>z</b> <Op>≤ = ≥</Op> <b>b</b>,
          <span style={{ marginLeft: 10 }}><b>z</b> ≥ <b>0</b></span>
        </div>
        <div className="pad" style={{ display: "grid", gap: 9 }}>
          <Dd t="Qué es cada cosa"><b>z</b> apila las {M.n} variables (<X>xᵢ</X> primero, luego {yGen}), <b>c</b> son los
            coeficientes de la función objetivo, <b>A</b> es la matriz de {M.rows.length} × {M.n} con los coeficientes
            tecnológicos y <b>b</b> los términos independientes.</Dd>
          <Dd t="Forma estándar">El símplex necesita igualdades. Cada ≤ recibe una variable de holgura que absorbe lo que
            sobra, cada ≥ una de excedente que resta lo que se pasa, y las ≥ y = reciben además una variable artificial
            que la fase 1 se encarga de expulsar. Si al terminar la fase 1 alguna artificial sigue con valor positivo,
            el modelo es infactible.</Dd>
          <Dd t="De dónde salen los duales">Al llegar al óptimo, el costo reducido de la holgura de cada restricción es
            su precio sombra. Por eso la pestaña Solución puede decirte cuánto vale una hectárea o un metro cúbico más
            sin necesidad de volver a resolver el problema.</Dd>
          <Dd t="Tamaño actual">{M.rows.length} restricciones × {M.n} variables. Un problema de este tamaño se resuelve
            en milisegundos; los modelos reales de planeación agrícola llegan a cientos de miles de variables y se
            resuelven con los mismos principios.</Dd>
        </div>
      </Card>

      {/* ── supuestos ── */}
      <Card title="Los cuatro supuestos que hacen posible este modelo"
        hint="Vale la pena discutirlos en clase: cada uno se puede romper en el campo, y saber cuándo pasa es lo que separa a un buen modelador de alguien que solo corre el solucionador.">
        <div className="pad" style={{ display: "grid", gap: 12 }}>
          {[["Proporcionalidad", "Duplicar las hectáreas duplica el ingreso y el requerimiento de nutrientes. Se rompe si el rendimiento cae por unidad al crecer la escala, o si hay economías de escala en la maquinaria."],
            ["Aditividad", "La utilidad total es la suma de las utilidades de cada cultivo, sin efectos cruzados. Se rompe justamente con los cultivos asociados: la milpa real fija nitrógeno con el frijol y beneficia al maíz. Aquí solo se modela la proporción de áreas, no la sinergia biológica."],
            ["Divisibilidad", "Se admiten fracciones de hectárea y de tonelada. Si el fertilizante solo se vende en bultos de 50 kg o hay que decidir “siembro o no siembro”, hace falta programación entera."],
            ["Certidumbre", "Precios, rendimientos y lluvia se toman como datos exactos. En la práctica conviene correr el modelo con varios escenarios y comparar los planes en la pestaña Solución."]]
            .map(([t, d]) => (
              <div key={t}>
                <b className="serif" style={{ fontSize: 14 }}>{t}</b>
                <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{d}</p>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   8c. FICHA TÉCNICA Y REPORTE
   ══════════════════════════════════════════════════════════════════ */
const hoyISO = () => new Date().toISOString().slice(0, 10);
const FICHA_0 = {
  folio: "PF-" + hoyISO().replace(/-/g, "") + "-01",
  fecha: hoyISO(),
  ciclo: "Primavera–Verano 2026",
  tecnico: "", cedula: "", institucion: "",
  productor: "", contacto: "",
  predio: "", localidad: "", municipio: "", estado: "",
  lat: "", lon: "", supCatastral: "",
  regimen: "Riego", textura: "Franco", ph: "", mo: "",
  fuenteAnalisis: "", fechaAnalisis: "",
  observaciones: "", recomendaciones: "",
};

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escNL = (s) => esc(s).replace(/\n/g, "<br>");
const oNo = (s, alt = "—") => (String(s || "").trim() ? esc(s) : alt);

/* ── interpretación automática ───────────────────────────────────── */
function interpretacionGeneral(M, res, par) {
  if (!res) return [];
  const S = [];
  const sem = res.ha.filter((c) => c.ha > 1e-9).sort((a, b) => b.ha - a.ha);
  const fuera = res.ha.filter((c) => c.ha <= 1e-9);
  const usados = res.fert.filter((f) => f.t > 1e-9).sort((a, b) => b.costoTotal - a.costoTotal);
  const pct = (v, t) => (t > 0 ? nf(100 * v / t, 1) + " %" : "—");

  S.push({
    t: "Plan de siembra",
    p: sem.length === 0
      ? "Con los datos capturados, el plan óptimo es no sembrar: ningún cultivo alcanza a cubrir el costo de los nutrientes que exige. Conviene revisar los márgenes brutos y los precios de fertilizante antes de concluir."
      : `El plan óptimo ocupa ${nf(res.haTotal, 2)} de las ${nf(par.superficie, 2)} hectáreas disponibles (${pct(res.haTotal, par.superficie)}), distribuidas en ${sem.length} cultivo${sem.length > 1 ? "s" : ""}: ` +
        sem.map((c) => `${c.nombre} con ${nf(c.ha, 2)} ha (${pct(c.ha, res.haTotal)} de lo sembrado)`).join("; ") +
        `. La utilidad neta esperada del ciclo es de ${money(res.z)}, equivalente a ${money(res.z / res.haTotal)} por hectárea sembrada. ` +
        `Se compone de ${money(res.ingreso)} de margen bruto menos ${money(res.costoFert)} de fertilizante, de modo que la fertilización absorbe el ${pct(res.costoFert, res.ingreso)} del margen.` +
        (res.libre > 0.01 ? ` Quedan ${nf(res.libre, 2)} ha sin sembrar porque otro recurso se agota antes que la tierra o porque el margen de los cultivos restantes no compensa su costo de fertilización.` : ""),
  });

  const act = res.cons.filter((c) => c.activa && Math.abs(c.dual) > 1e-4);
  const rec = act.filter((c) => ["Tierra", "Agua", "Presupuesto", "Disponibilidad"].includes(c.grupo));
  const top = act.filter((c) => c.grupo === "Áreas" && c.op === "<=");
  const aso = act.filter((c) => c.grupo === "Asociación");
  let txt = "";
  if (rec.length === 0 && top.length === 0)
    txt = "Ningún recurso quedó saturado. El plan está determinado por la rentabilidad relativa de los cultivos y no por una escasez física, así que ampliar tierra, agua o crédito no mejoraría el resultado con los datos actuales.";
  else {
    txt = "Los factores que están frenando la utilidad son: " + [
      ...rec.map((c) => {
        if (c.grupo === "Tierra") return `la superficie disponible, cuyo precio sombra es de ${money(c.dual)} por hectárea adicional`;
        if (c.grupo === "Agua") return `el volumen de riego, valuado en ${money(c.dual * 1000)} por cada 1 000 m³ adicionales`;
        if (c.grupo === "Presupuesto") return `el presupuesto de fertilizante, con un rendimiento marginal de ${nf(c.dual, 2)} pesos de utilidad por peso adicional invertido`;
        return `la existencia de ${c.nombre.replace("Existencia · ", "")}, cuyo faltante cuesta ${money(c.dual)} por tonelada`;
      }),
      ...top.map((c) => `el techo de siembra de ${c.nombre.replace("Área máxima · ", "")}, donde una hectárea más valdría ${money(c.dual)}`),
    ].join("; ") + ". Cada uno de esos valores indica hasta cuánto conviene pagar por relajar la limitante correspondiente, mientras el resto de las condiciones no cambie.";
    if (aso.length) txt += " Las reglas de asociación activas (" + aso.map((c) => c.nombre).join("; ") + ") también restan utilidad: su precio sombra es el costo económico de sembrar asociado, que debe compararse contra los beneficios agronómicos que no captura el modelo.";
  }
  S.push({ t: "Factores limitantes", p: txt });

  const nutCaro = res.cons.filter((c) => c.nut && c.op === ">=" && c.activa)
    .sort((a, b) => a.dual - b.dual)[0];
  S.push({
    t: "Programa de fertilización",
    p: usados.length === 0
      ? "El plan óptimo no requiere compra de fertilizante, lo que suele indicar que no hay superficie sembrada o que los requerimientos capturados son nulos."
      : `Se recomienda adquirir ${nf(usados.reduce((s, f) => s + f.t, 0), 2)} toneladas de producto por ${money(res.costoFert)}, ` +
        `es decir ${money(res.costoFert / res.haTotal)} por hectárea sembrada. El detalle es: ` +
        usados.map((f) => `${f.t < 1 ? nf(f.t, 3) : nf(f.t, 2)} t de ${f.marca} ${f.nombre} ${f.grado} (${nf(f.t / res.haTotal, 3)} t/ha, ${money(f.costoTotal)})`).join("; ") +
        `. El aporte total es de ${res.nut.map((n) => `${nf(n.apo, 3)} t de ${n.lab}`).join(", ")}, frente a un requerimiento de ${res.nut.map((n) => `${nf(n.req, 3)} t`).join(", ")} respectivamente.` +
        (nutCaro ? ` El nutriente más caro de cubrir con la oferta disponible es ${(NUTS.find((n) => n.k === nutCaro.nut) || {}).lab}, a ${money(-nutCaro.dual)} por tonelada de nutriente; sustituirlo por una fuente más económica es la vía más directa para bajar el costo del programa.` : ""),
  });

  if (fuera.length) S.push({
    t: "Cultivos descartados",
    p: `Quedaron fuera del plan ${fuera.map((c) => c.nombre).join(", ")}. No significa que sean malos cultivos, sino que con los precios, requerimientos y consumos de agua capturados no compiten por la tierra frente a las alternativas. ` +
       `Para que entraran habría que mejorar su margen bruto, reducir su lámina de riego o su requerimiento nutricional, o bien imponerles un área mínima si existe un compromiso comercial o de autoconsumo que lo justifique.`,
  });

  S.push({
    t: "Alcances y precauciones",
    p: "El modelo supone proporcionalidad y certidumbre: rendimientos, precios y requerimientos se toman como constantes conocidas. No descuenta el aporte nutricional que ya tiene el suelo, por lo que las dosis obtenidas deben ajustarse contra un análisis de suelo vigente; tampoco considera eficiencias de aplicación, pérdidas por lixiviación o volatilización, época de aplicación, ni la sinergia biológica de los cultivos asociados. " +
       "Se recomienda repetir el ejercicio con un escenario pesimista de precios de venta y otro con precios altos de fertilizante para conocer qué tan estable es el plan antes de comprometer la compra de insumos.",
  });
  return S;
}

/* ── SVG del predio y de barras para el reporte ──────────────────── */
function svgPredioStr(res, sup) {
  const COLS = 32, ROWS = 14, TOT = COLS * ROWS, W = 640, H = 292, PAD = 12;
  const cw = (W - PAD * 2) / COLS, ch = (H - PAD * 2) / ROWS;
  const celdas = [];
  if (res && sup > 0) {
    const items = res.ha.filter((c) => c.ha > 1e-9).map((c) => ({ ...c, ex: (c.ha / sup) * TOT }));
    const base = items.map((c) => ({ ...c, n: Math.floor(c.ex) }));
    let quedan = Math.min(TOT, Math.round(items.reduce((s, c) => s + c.ex, 0))) - base.reduce((s, c) => s + c.n, 0);
    base.sort((a, b) => (b.ex % 1) - (a.ex % 1));
    for (let i = 0; i < base.length && quedan > 0; i++, quedan--) base[i].n++;
    base.sort((a, b) => b.ha - a.ha);
    base.forEach((c) => { for (let i = 0; i < c.n; i++) celdas.push(c); });
  }
  let r = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
  <defs><pattern id="s" width="6" height="6" patternUnits="userSpaceOnUse">
  <rect width="6" height="6" fill="#C9BFA8"/><path d="M0 3 H6" stroke="#B7AB90" stroke-width="1.2"/></pattern></defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="url(#s)" stroke="#8C7F63" stroke-width="2" rx="3"/>`;
  for (let i = 0; i < TOT; i++) {
    const c = celdas[i]; if (!c) continue;
    const col = i % COLS, row = Math.floor(i / COLS);
    r += `<rect x="${(PAD + col * cw + 0.7).toFixed(1)}" y="${(PAD + row * ch + 0.7).toFixed(1)}" width="${(cw - 1.4).toFixed(1)}" height="${(ch - 1.4).toFixed(1)}" rx="1.5" fill="${c.color}" opacity="0.93"/>`;
  }
  return r + "</svg>";
}
function svgBarrasStr(items, maxV, unidad) {
  const W = 640, fila = 26, H = Math.max(40, items.length * fila + 12);
  const x0 = 150, ancho = W - x0 - 70;
  let r = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica,Arial,sans-serif">`;
  items.forEach((it, i) => {
    const y = 8 + i * fila, w = maxV > 0 ? (it.v / maxV) * ancho : 0;
    r += `<text x="${x0 - 8}" y="${y + 12}" font-size="11" text-anchor="end" fill="#1A2216">${esc(it.n)}</text>`;
    r += `<rect x="${x0}" y="${y}" width="${Math.max(1, w).toFixed(1)}" height="16" fill="${it.c}" rx="2"/>`;
    r += `<text x="${x0 + w + 6}" y="${y + 12}" font-size="10.5" fill="#586252">${esc(nf(it.v, 2))} ${esc(unidad)}</text>`;
  });
  return r + "</svg>";
}

/* ── documento HTML del reporte ──────────────────────────────────── */
function reporteHTML(ficha, M, res, par, sol) {
  const fechaLarga = (() => {
    try {
      return new Date(ficha.fecha + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return ficha.fecha; }
  })();
  const inter = interpretacionGeneral(M, res, par);
  const sem = res ? res.ha.filter((c) => c.ha > 1e-9).sort((a, b) => b.ha - a.ha) : [];
  const usados = res ? res.fert.filter((f) => f.t > 1e-9) : [];
  const activas = res ? res.cons.filter((c) => c.activa) : [];
  const fila = (a, b) => `<tr><th>${a}</th><td>${b}</td></tr>`;

  const secciones = M.rows.reduce((acc, r) => { acc[r.grupo] = (acc[r.grupo] || 0) + 1; return acc; }, {});

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Reporte de fertilización ${esc(ficha.folio)}</title>
<style>
@page{size:letter;margin:16mm 15mm}
*{box-sizing:border-box}
body{margin:0;color:#1A2216;font-family:Georgia,"Times New Roman",serif;font-size:10.5pt;line-height:1.55}
h1,h2,h3{font-family:Georgia,serif;margin:0}
.tool{background:#1E2A1A;color:#fff;padding:10px 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px}
.tool button{background:#C9A227;border:0;color:#1E2A1A;font-weight:700;padding:7px 14px;border-radius:3px;cursor:pointer;font-size:13px}
.hoja{max-width:186mm;margin:0 auto;padding:14px 4px 40px}
.eyebrow{font-family:Helvetica,Arial,sans-serif;font-size:8pt;letter-spacing:.18em;text-transform:uppercase;color:#5B6B52}
.titulo{display:flex;gap:14px;align-items:flex-start;border-bottom:2.5px solid #2E5C3C;padding-bottom:9px;margin-bottom:14px}
.titulo img{height:76px;display:block;flex:none}
.tit-r{flex:1}
.titulo h1{font-size:19pt;line-height:1.15;margin-top:3px}
.creditos{display:flex;gap:14px;align-items:flex-start;border:1px solid #D6DCC8;border-left:3px solid #2E5C3C;
 background:#F6F8EF;padding:11px 13px;margin-top:20px;font-size:8.5pt;line-height:1.5;page-break-inside:avoid}
.creditos img{height:62px;flex:none}
.creditos b{font-size:9pt}
.creditos .eq2{display:flex;gap:14px;flex-wrap:wrap;margin-top:6px}
.creditos .eq2 span{white-space:nowrap}
.meta{display:flex;justify-content:space-between;gap:20px;font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;color:#5B6B52;margin-top:6px}
h2{font-size:12pt;margin:20px 0 7px;padding-bottom:3px;border-bottom:1px solid #C6CFB6;page-break-after:avoid}
h3{font-size:10.5pt;margin:11px 0 2px}
p{margin:0 0 8px;text-align:justify}
table{width:100%;border-collapse:collapse;font-size:9pt;margin:6px 0 10px;page-break-inside:avoid}
th,td{border:1px solid #D6DCC8;padding:4px 7px;text-align:left;vertical-align:top}
thead th{background:#EDF0E2;font-family:Helvetica,Arial,sans-serif;font-size:7.5pt;letter-spacing:.05em;text-transform:uppercase}
table.ficha th{width:34%;background:#F6F8EF;font-weight:600;font-size:9pt}
.num{text-align:right;font-family:"DejaVu Sans Mono",Consolas,monospace}
.kpis{display:flex;gap:8px;margin:10px 0}
.kpi{flex:1;border:1px solid #D6DCC8;border-top:3px solid #2E5C3C;padding:7px 9px}
.kpi b{display:block;font-size:14pt}
.kpi span{font-family:Helvetica,Arial,sans-serif;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:#5B6B52}
.chip{display:inline-block;font-size:8.5pt;border:1px solid #D6DCC8;padding:2px 7px;margin:0 4px 4px 0}
.sw{width:9px;height:9px;display:inline-block;margin-right:4px;vertical-align:middle}
.nota{background:#F6F8EF;border-left:3px solid #2E5C3C;padding:8px 11px;font-size:9pt;margin:8px 0}
.obs{border:1px solid #D6DCC8;padding:9px 11px;min-height:44px;font-size:9.5pt}
.firmas{display:flex;gap:40px;margin-top:34px;page-break-inside:avoid}
.firma{flex:1;border-top:1px solid #1A2216;padding-top:5px;font-size:8.5pt;text-align:center}
.pie{margin-top:22px;border-top:1px solid #C6CFB6;padding-top:7px;font-size:8pt;color:#5B6B52}
.br{page-break-before:always}
@media print{.tool{display:none}.hoja{max-width:none;padding:0}}
</style></head><body>
<div class="tool">Usa el botón para guardar en PDF: en el diálogo elige “Destino: Guardar como PDF”.
 &nbsp;<button onclick="window.print()">Imprimir / Guardar como PDF</button></div>
<div class="hoja">

<div class="titulo">
 <img src="${LOGO_FCA}" alt="Facultad de Ciencias Agrícolas, Xalapa">
 <div class="tit-r">
  <div class="eyebrow">Reporte técnico · plan de siembra y fertilización</div>
  <h1>${oNo(ficha.predio, "Parcela sin nombre")}</h1>
  <div class="meta"><span>Folio ${oNo(ficha.folio)} · ${esc(fechaLarga)} · Ciclo ${oNo(ficha.ciclo)}</span>
  <span>Optimización por programación lineal</span></div>
 </div>
</div>

<h2>1. Identificación</h2>
<table class="ficha">
${fila("Productor", oNo(ficha.productor))}
${fila("Contacto del productor", oNo(ficha.contacto))}
${fila("Responsable técnico", oNo(ficha.tecnico) + (String(ficha.cedula || "").trim() ? " · Cédula " + esc(ficha.cedula) : ""))}
${fila("Institución o despacho", oNo(ficha.institucion))}
${fila("Predio o parcela", oNo(ficha.predio))}
${fila("Ubicación", [ficha.localidad, ficha.municipio, ficha.estado].filter((s) => String(s || "").trim()).map(esc).join(", ") || "—")}
${fila("Coordenadas", String(ficha.lat || "").trim() || String(ficha.lon || "").trim() ? esc(ficha.lat) + ", " + esc(ficha.lon) : "—")}
${fila("Superficie catastral", String(ficha.supCatastral || "").trim() ? esc(ficha.supCatastral) + " ha" : "—")}
${fila("Superficie considerada en el modelo", nf(par.superficie, 2) + " ha")}
${fila("Régimen hídrico", oNo(ficha.regimen))}
${fila("Textura del suelo", oNo(ficha.textura))}
${fila("pH · materia orgánica", (String(ficha.ph || "").trim() ? esc(ficha.ph) : "—") + " · " + (String(ficha.mo || "").trim() ? esc(ficha.mo) + " %" : "—"))}
${fila("Análisis de suelo de referencia", oNo(ficha.fuenteAnalisis) + (String(ficha.fechaAnalisis || "").trim() ? " (" + esc(ficha.fechaAnalisis) + ")" : ""))}
</table>

<h2>2. Recursos y supuestos del ciclo</h2>
<table>
<thead><tr><th>Recurso o parámetro</th><th>Valor</th><th>Tratamiento en el modelo</th></tr></thead>
<tbody>
<tr><td>Superficie total (S)</td><td class="num">${nf(par.superficie, 2)} ha</td><td>Restricción de tierra, tipo ≤</td></tr>
<tr><td>Agua de riego (A)</td><td class="num">${par.usarAgua ? nf(par.agua, 0) + " m³" : "sin límite"}</td><td>${par.usarAgua ? "Restricción de agua, consumo por hectárea de cada cultivo" : "No restringida"}</td></tr>
<tr><td>Presupuesto de fertilizante (B)</td><td class="num">${par.usarPresupuesto ? money(par.presupuesto) : "sin límite"}</td><td>${par.usarPresupuesto ? "Restricción de gasto, tipo ≤" : "No restringido"}</td></tr>
<tr><td>Existencias por marca</td><td class="num">${par.usarStock ? "activas" : "sin límite"}</td><td>Una cota superior por producto</td></tr>
<tr><td>Tope de sobrefertilización (τ)</td><td class="num">${par.usarTope ? nf(par.tolerancia, 0) + " %" : "no aplicado"}</td><td>Limita el aporte por encima del requerimiento</td></tr>
<tr><td>Nitrógeno de origen orgánico (β)</td><td class="num">${par.usarOrganico ? nf(par.beta, 0) + " %" : "no aplicado"}</td><td>Piso mínimo sobre el N total</td></tr>
<tr><td>Alcance del balance nutricional</td><td>${M.det ? "por cultivo" : "global del predio"}</td><td>${M.det ? "Cada cultivo cubre su propio requerimiento" : "El balance se cumple para el conjunto de la superficie"}</td></tr>
</tbody></table>

<h2>3. Modelo de optimización</h2>
<p>El plan se obtuvo maximizando la utilidad neta del ciclo mediante un modelo de programación lineal continua,
resuelto con el método símplex de dos fases. La función objetivo y las restricciones son las siguientes:</p>
<div class="nota"><b>máx Z = ∑<sub>i</sub> u<sub>i</sub> x<sub>i</sub> − ∑<sub>j</sub> c<sub>j</sub> y<sub>j</sub></b><br>
donde x<sub>i</sub> son las hectáreas del cultivo i, y<sub>j</sub> las toneladas del fertilizante j,
u<sub>i</sub> el margen bruto por hectárea y c<sub>j</sub> el precio por tonelada.</div>
<table>
<thead><tr><th>Familia de restricciones</th><th>Renglones</th><th>Expresión general</th></tr></thead>
<tbody>${Object.keys(secciones).map((g) => {
    const r0 = M.rows.find((r) => r.grupo === g);
    return `<tr><td>${esc(g)}</td><td class="num">${secciones[g]}</td><td>${esc(r0 ? r0.sim : "")}</td></tr>`;
  }).join("")}</tbody></table>
<p>El modelo resultante tiene <b>${M.n} variables de decisión</b> y <b>${M.rows.length} restricciones</b>, con
${M.C.length} cultivo(s) y ${M.F.length} producto(s) fertilizantes habilitados. Estado de la solución:
<b>${sol.status === "optimo" ? "óptimo encontrado" : sol.status === "infactible" ? "infactible" : sol.status}</b>.</p>

${!res ? `<div class="nota"><b>Sin solución factible.</b> Las condiciones capturadas no admiten ningún plan que las cumpla todas al mismo tiempo; revise áreas mínimas, reglas de asociación y presupuesto.</div>` : `
<h2>4. Resultados</h2>
<div class="kpis">
 <div class="kpi"><span>Margen bruto</span><b>${money(res.ingreso)}</b></div>
 <div class="kpi"><span>Costo fertilizante</span><b>${money(res.costoFert)}</b></div>
 <div class="kpi"><span>Utilidad neta</span><b>${money(res.z)}</b></div>
 <div class="kpi"><span>Utilidad por ha</span><b>${res.haTotal > 0 ? money(res.z / res.haTotal) : "—"}</b></div>
</div>

<h3>4.1 Plan de siembra</h3>
<table>
<thead><tr><th>Cultivo</th><th>Superficie (ha)</th><th>% de lo sembrado</th><th>Margen bruto</th><th>Riego (m³)</th><th>N (t)</th><th>P₂O₅ (t)</th><th>K₂O (t)</th></tr></thead>
<tbody>${sem.map((c) => `<tr><td><span class="sw" style="background:${c.color}"></span>${esc(c.nombre)}</td>
<td class="num">${nf(c.ha, 2)}</td><td class="num">${nf(100 * c.ha / (res.haTotal || 1), 1)} %</td>
<td class="num">${money(c.ha * c.utilidad)}</td><td class="num">${nf(c.ha * c.agua, 0)}</td>
<td class="num">${nf(c.ha * c.req.N, 3)}</td><td class="num">${nf(c.ha * c.req.P, 3)}</td><td class="num">${nf(c.ha * c.req.K, 3)}</td></tr>`).join("")
    || `<tr><td colspan="8">Sin superficie sembrada.</td></tr>`}
<tr><th>Total</th><th class="num">${nf(res.haTotal, 2)}</th><th class="num">100 %</th><th class="num">${money(res.ingreso)}</th>
<th class="num">${nf(res.agua, 0)}</th>${res.nut.map((n) => `<th class="num">${nf(n.req, 3)}</th>`).join("")}</tr>
</tbody></table>
<p style="font-size:9pt">Superficie sin sembrar: ${nf(res.libre, 2)} ha.</p>
${svgPredioStr(res, par.superficie)}
<p style="font-size:8.5pt;color:#5B6B52">Distribución de la parcela: cada celda equivale a ${nf(par.superficie / 448, 3)} ha; la textura de surcos representa la tierra sin sembrar.
${sem.map((c) => `<span class="chip"><span class="sw" style="background:${c.color}"></span>${esc(c.nombre)} ${nf(c.ha, 2)} ha</span>`).join("")}</p>

<h3 class="br">4.2 Programa de fertilización</h3>
<table>
<thead><tr><th>Marca</th><th>Producto</th><th>Grado</th><th>Toneladas</th><th>Dosis (t/ha)</th><th>Precio ($/t)</th><th>Importe</th></tr></thead>
<tbody>${usados.map((f) => `<tr><td>${esc(f.marca)}</td><td>${esc(f.nombre)}</td><td>${esc(f.grado)}</td>
<td class="num">${nf(f.t, 3)}</td><td class="num">${res.haTotal > 0 ? nf(f.t / res.haTotal, 3) : "—"}</td>
<td class="num">${money(f.costo)}</td><td class="num">${money(f.costoTotal)}</td></tr>`).join("")
    || `<tr><td colspan="7">El plan óptimo no requiere compra de fertilizante.</td></tr>`}
<tr><th colspan="3">Total</th><th class="num">${nf(usados.reduce((s, f) => s + f.t, 0), 3)}</th><th></th><th></th><th class="num">${money(res.costoFert)}</th></tr>
</tbody></table>
${M.det && usados.length ? `<p style="font-size:9pt">Asignación por cultivo (t):</p>
<table><thead><tr><th>Producto</th>${sem.map((c) => `<th>${esc(c.nombre)}</th>`).join("")}</tr></thead>
<tbody>${usados.map((f) => `<tr><td>${esc(f.nombre)} ${esc(f.grado)}</td>${sem.map((c) => {
      const v = f.porCultivo.find((p) => p.id === c.id);
      return `<td class="num">${v && v.t > 1e-9 ? nf(v.t, 3) : "—"}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table>` : ""}

<h3>4.3 Balance de nutrientes</h3>
<table>
<thead><tr><th>Nutriente</th><th>Requerido (t)</th><th>Aportado (t)</th><th>Diferencia (t)</th><th>Cobertura</th></tr></thead>
<tbody>${res.nut.map((n) => `<tr><td>${esc(n.lab)} · ${esc(n.nombre)}</td><td class="num">${nf(n.req, 3)}</td>
<td class="num">${nf(n.apo, 3)}</td><td class="num">${nf(n.apo - n.req, 3)}</td>
<td class="num">${n.req > 0 ? nf(100 * n.apo / n.req, 1) + " %" : "—"}</td></tr>`).join("")}</tbody></table>

<h3>4.4 Uso de los recursos y precios sombra</h3>
<table>
<thead><tr><th>Restricción</th><th>Grupo</th><th>Utilizado</th><th>Disponible</th><th>Holgura</th><th>Precio sombra</th></tr></thead>
<tbody>${activas.length ? activas.map((c) => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.grupo)}</td>
<td class="num">${nf(c.lhs, 2)}</td><td class="num">${nf(c.rhs, 2)} ${esc(c.unidad)}</td>
<td class="num">0</td><td class="num">${Math.abs(c.dual) > 1e-6 ? nf(c.dual, 2) : "0"}</td></tr>`).join("")
    : `<tr><td colspan="6">Ninguna restricción quedó activa: sobran recursos en todas las categorías.</td></tr>`}</tbody></table>
<p style="font-size:8.5pt;color:#5B6B52">El precio sombra indica en cuánto cambiaría la utilidad neta si el límite de esa
restricción aumentara en una unidad, manteniendo todo lo demás constante.</p>
${sem.length ? svgBarrasStr(sem.map((c) => ({ n: c.nombre, v: c.ha, c: c.color })), Math.max(...sem.map((c) => c.ha)), "ha") : ""}

<h2 class="br">5. Interpretación general</h2>
${inter.map((s) => `<h3>${esc(s.t)}</h3><p>${esc(s.p)}</p>`).join("")}
`}

<h2>6. Observaciones del técnico</h2>
<div class="obs">${String(ficha.observaciones || "").trim() ? escNL(ficha.observaciones) : "<i style='color:#7B8574'>Sin observaciones registradas.</i>"}</div>

<h2>7. Recomendaciones de manejo</h2>
<div class="obs">${String(ficha.recomendaciones || "").trim() ? escNL(ficha.recomendaciones) : "<i style='color:#7B8574'>Sin recomendaciones adicionales registradas.</i>"}</div>

<div class="firmas">
 <div class="firma">${oNo(ficha.tecnico, "Responsable técnico")}<br><span style="color:#5B6B52">Responsable técnico</span></div>
 <div class="firma">${oNo(ficha.productor, "Productor")}<br><span style="color:#5B6B52">Productor · enterado</span></div>
</div>

<div class="creditos">
 <img src="${LOGO_FCA}" alt="Facultad de Ciencias Agrícolas, Xalapa">
 <div>
  <b>Cuerpo académico ${esc(CREDITOS.ca)} (${esc(CREDITOS.clave)})</b><br>
  ${esc(CREDITOS.proyecto)}.<br>${esc(CREDITOS.programa)}.
  <div class="eq2">${CREDITOS.integrantes.map((i) => `<span><b>${esc(i.n)}</b> · ${esc(i.m)}</span>`).join("")}</div>
 </div>
</div>

<div class="pie">Reporte generado el ${esc(fechaLarga)} a partir de un modelo de programación lineal resuelto con símplex de dos fases.
Los resultados dependen por completo de los datos capturados de márgenes, requerimientos, precios y disponibilidad de recursos,
y no sustituyen un análisis de suelo ni el criterio profesional del responsable técnico.</div>
</div></body></html>`;
}

/* ── campo de texto reutilizable (definido fuera del componente para no perder el foco) ── */
const Campo = ({ label, value, onChange, tipo = "text", ph }) => (
  <label className="campo"><span>{label}</span>
    <input className="txt" type={tipo} value={value} placeholder={ph || ""} onChange={onChange} /></label>
);

/* ── pestaña de ficha ────────────────────────────────────────────── */
function Ficha({ ficha, setFicha, M, res, par, sol }) {
  const [html, setHtml] = useState("");
  const [aviso, setAviso] = useState("");
  const set = (k) => (e) => setFicha((f) => ({ ...f, [k]: e.target.value }));

  const generar = (imprimir) => {
    const doc = reporteHTML(ficha, M, res, par, sol);
    setHtml(doc);
    if (!imprimir) { setAviso("Vista previa generada abajo."); return; }
    try {
      const w = window.open("", "_blank");
      if (w && w.document) {
        w.document.open(); w.document.write(doc); w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* el usuario puede imprimir manualmente */ } }, 400);
        setAviso("Se abrió el reporte en una pestaña nueva. En el diálogo de impresión elige “Guardar como PDF”.");
        return;
      }
    } catch (e) { /* sigue al respaldo */ }
    try {
      const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "reporte-" + (ficha.folio || "fertilizacion") + ".html";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      setAviso("Tu navegador bloqueó la ventana emergente, así que se descargó el reporte como archivo. Ábrelo y usa Imprimir → Guardar como PDF.");
    } catch (e) {
      setAviso("No fue posible abrir ni descargar el archivo desde aquí. Usa la vista previa de abajo: haz clic derecho sobre ella, elige Imprimir y luego Guardar como PDF.");
    }
  };

  const listo = sol.status === "optimo";
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card title="Ficha de identificación"
        hint="Estos datos no entran al modelo: son los que encabezan el reporte y le dan trazabilidad. Ninguno es obligatorio, los campos vacíos salen como guion.">
        <div className="pad grid grid-cols-1 md:grid-cols-3 gap-4">
          <Campo label="Folio" value={ficha.folio} onChange={set("folio")} />
          <Campo label="Fecha del reporte" value={ficha.fecha} onChange={set("fecha")} tipo="date" />
          <Campo label="Ciclo agrícola" value={ficha.ciclo} onChange={set("ciclo")} ph="Primavera–Verano 2026" />
          <Campo label="Nombre del técnico" value={ficha.tecnico} onChange={set("tecnico")} ph="Ing. Agr. …" />
          <Campo label="Cédula profesional" value={ficha.cedula} onChange={set("cedula")} />
          <Campo label="Institución o despacho" value={ficha.institucion} onChange={set("institucion")} />
          <Campo label="Nombre del productor" value={ficha.productor} onChange={set("productor")} />
          <Campo label="Contacto del productor" value={ficha.contacto} onChange={set("contacto")} ph="Teléfono o correo" />
          <Campo label="Nombre del predio o parcela" value={ficha.predio} onChange={set("predio")} ph="Rancho El Encino, lote 3" />
        </div>
      </Card>

      <Card title="Ubicación y características del predio"
        hint="La superficie catastral es la del documento legal; la que usa el modelo es la de la pestaña Predio y recursos, que puede ser menor si dejas áreas fuera de producción.">
        <div className="pad grid grid-cols-1 md:grid-cols-3 gap-4">
          <Campo label="Localidad o ejido" value={ficha.localidad} onChange={set("localidad")} />
          <Campo label="Municipio" value={ficha.municipio} onChange={set("municipio")} />
          <Campo label="Estado" value={ficha.estado} onChange={set("estado")} />
          <Campo label="Latitud" value={ficha.lat} onChange={set("lat")} ph="19.1738" />
          <Campo label="Longitud" value={ficha.lon} onChange={set("lon")} ph="-96.1342" />
          <Campo label="Superficie catastral (ha)" value={ficha.supCatastral} onChange={set("supCatastral")} />
          <label className="campo"><span>Régimen hídrico</span>
            <select className="txt" value={ficha.regimen} onChange={set("regimen")}>
              {["Riego", "Temporal", "Riego complementario", "Punta de riego"].map((o) => <option key={o}>{o}</option>)}
            </select></label>
          <label className="campo"><span>Textura del suelo</span>
            <select className="txt" value={ficha.textura} onChange={set("textura")}>
              {["Arenosa", "Franco-arenosa", "Franco", "Franco-arcillosa", "Arcillosa", "Limosa"].map((o) => <option key={o}>{o}</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="pH del suelo" value={ficha.ph} onChange={set("ph")} />
            <Campo label="Materia orgánica (%)" value={ficha.mo} onChange={set("mo")} />
          </div>
          <Campo label="Laboratorio del análisis de suelo" value={ficha.fuenteAnalisis} onChange={set("fuenteAnalisis")} />
          <Campo label="Fecha del análisis" value={ficha.fechaAnalisis} onChange={set("fechaAnalisis")} tipo="date" />
        </div>
        <p className="hint pad" style={{ paddingTop: 0 }}>
          El modelo no descuenta el nutriente que ya aporta el suelo. Si cuentas con un análisis vigente, réstalo de los
          requerimientos en la pestaña Cultivos antes de generar el reporte, y anota aquí la fuente.
        </p>
      </Card>

      <Card title="Observaciones y recomendaciones"
        hint="Texto libre que se imprime al final del reporte, en las secciones 6 y 7.">
        <div className="pad grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="campo"><span>Observaciones</span>
            <textarea className="txt" rows={5} value={ficha.observaciones} onChange={set("observaciones")}
              placeholder="Antecedentes del predio, cultivo anterior, problemas de drenaje, plagas recurrentes, criterios que se usaron para fijar los márgenes…" /></label>
          <label className="campo"><span>Recomendaciones de manejo</span>
            <textarea className="txt" rows={5} value={ficha.recomendaciones} onChange={set("recomendaciones")}
              placeholder="Época y número de aplicaciones, fraccionamiento del nitrógeno, incorporación al suelo, monitoreo, siguiente análisis…" /></label>
        </div>
      </Card>

      <Card title="Generar el reporte"
        hint="El reporte incluye la ficha, los recursos del ciclo, el modelo, el plan de siembra con el mapa de la parcela, el programa de fertilización, el balance de nutrientes, los precios sombra y una interpretación general redactada a partir de la solución actual.">
        <div className="pad">
          {!listo && <div className="alerta" style={{ marginBottom: 12 }}>
            El modelo no tiene solución óptima en este momento ({sol.status}). Puedes generar el reporte de todos modos:
            saldrá con la ficha y el aviso de infactibilidad, pero sin resultados.
          </div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn pri" onClick={() => generar(true)}>Generar reporte PDF</button>
            <button className="btn" onClick={() => generar(false)}>Solo ver la vista previa</button>
            <button className="btn" onClick={() => { setFicha(FICHA_0); setHtml(""); setAviso(""); }}>Limpiar la ficha</button>
          </div>
          {aviso && <p className="hint" style={{ marginTop: 10 }}>{aviso}</p>}
          <p className="hint" style={{ marginTop: 10 }}>
            El PDF se produce con la función de impresión del navegador: en el diálogo elige “Guardar como PDF” como
            destino. Tamaño carta, márgenes ya definidos en el documento.
          </p>
        </div>
        {html && (
          <div className="pad" style={{ borderTop: "1px solid var(--linea)" }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Vista previa del reporte</div>
            <iframe className="prev" srcDoc={html} title="Vista previa del reporte" />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── banda de créditos institucional ─────────────────────────────── */
function BandaCreditos() {
  return (
    <footer className="cred">
      <div className="cred-in">
        <img className="marca" src={LOGO_FCA} alt="Facultad de Ciencias Agrícolas, Xalapa, Universidad Veracruzana" />
        <div className="cred-tx">
          <div className="eyebrow" style={{ color: "#93A585" }}>Cuerpo académico {CREDITOS.clave}</div>
          <h2 className="serif" style={{ fontSize: 17, color: "#F0F3E6", margin: "4px 0 8px", letterSpacing: "-0.01em" }}>
            {CREDITOS.ca}
          </h2>
          <p>{CREDITOS.proyecto}.</p>
          <p style={{ color: "#93A585" }}>{CREDITOS.programa}.</p>
          <div className="cred-g">
            {CREDITOS.integrantes.map((p) => (
              <div className="cred-p" key={p.m}>
                <b>{p.n}</b>
                <a href={"mailto:" + p.m}>{p.m}</a>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cred-pie"><div>
        Modelo de programación lineal continua resuelto con símplex de dos fases en el navegador. Material de uso
        didáctico: los datos precargados son ilustrativos y deben sustituirse por los de la parcela antes de tomar
        cualquier decisión de siembra o de compra de insumos.
      </div></div>
    </footer>
  );
}

/* ══════════════════════════════════════════════════════════════════
   9. APP
   ══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [tab, setTab] = useState("predio");
  const [par, setPar] = useState(PAR_0);
  const [cultivos, setCultivos] = useState(CULTIVOS_0);
  const [ferts, setFerts] = useState(FERTS_0);
  const [asocs, setAsocs] = useState(ASOCS_0);
  const [ficha, setFicha] = useState(FICHA_0);
  const [escenarios, setEscenarios] = useState([]);

  const setP = (k, v) => setPar((p) => ({ ...p, [k]: v }));
  const setC = (id, k, v) => setCultivos((cs) => cs.map((c) => (c.id === id ? { ...c, [k]: v } : c)));
  const setCReq = (id, k, v) => setCultivos((cs) => cs.map((c) => (c.id === id ? { ...c, req: { ...c.req, [k]: v } } : c)));
  const setF = (id, k, v) => setFerts((fs) => fs.map((f) => (f.id === id ? { ...f, [k]: v } : f)));
  const setFap = (id, k, v) => setFerts((fs) => fs.map((f) => (f.id === id ? { ...f, ap: { ...f.ap, [k]: v } } : f)));

  const M = useMemo(() => construirModelo(cultivos, ferts, asocs, par), [cultivos, ferts, asocs, par]);
  const sol = useMemo(() => (M.n > 0 ? solveLP(M.n, M.c, M.rows) : { status: "vacio" }), [M]);
  const res = useMemo(() => {
    const r = resumir(M, sol, par);
    return r ? { ...r, valores: sol.x } : null;
  }, [M, sol, par]);

  const guardar = () => {
    if (!res) return;
    setEscenarios((e) => [...e, {
      id: Date.now(),
      nombre: M.C.map((c) => c.nombre.split(" ")[0]).join("+") || "vacío",
      z: res.z, ha: res.haTotal, sup: par.superficie, agua: res.agua, costo: res.costoFert,
    }]);
  };

  const estado = {
    optimo: { t: "Solución óptima encontrada", c: "var(--verde2)" },
    infactible: { t: "Modelo infactible", c: "var(--rojo)" },
    no_acotado: { t: "Modelo no acotado", c: "var(--rojo)" },
    vacio: { t: "Sin variables", c: "var(--tinta2)" },
    error: { t: "Error numérico", c: "var(--rojo)" },
  }[sol.status];

  const TABS = [
    ["predio", "Predio y recursos"],
    ["cultivos", "Cultivos"],
    ["fert", "Fertilizantes"],
    ["asoc", "Asociaciones"],
    ["mate", "Formulación matemática"],
    ["modelo", "Modelo con tus datos"],
    ["sol", "Solución"],
    ["ficha", "Ficha y reporte"],
  ];

  return (
    <div className="lp">
      <style>{CSS}</style>

      {/* ── encabezado ── */}
      <header className="hdr">
        <div className="pad" style={{ paddingBottom: 10, display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
            <img className="marca" src={LOGO_FCA} alt="Facultad de Ciencias Agrícolas, Xalapa" style={{ height: 54 }} />
            <div>
              <div className="eyebrow">Programación lineal aplicada · plan de siembra y fertilización</div>
              <h1 className="serif" style={{ fontSize: 25, marginTop: 3, letterSpacing: "-0.01em" }}>
                ¿Qué sembrar y con qué fertilizar en {nf(par.superficie, 0)} hectáreas?
              </h1>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="kpi"><div className="l">Utilidad neta Z</div>
              <div className="v mono" style={{ color: sol.status === "optimo" ? "#D9BE6A" : "#D89A8C" }}>
                {sol.status === "optimo" ? money(res.z) : "—"}</div></div>
            <div className="kpi"><div className="l">Superficie usada</div>
              <div className="v mono">{res ? nf(res.haTotal, 1) : "—"}<span style={{ fontSize: 11 }}> ha</span></div></div>
            <div className="kpi"><div className="l">Estado</div>
              <div className="v" style={{ fontSize: 12.5, color: estado.c, paddingTop: 3 }}>{estado.t}</div></div>
          </div>
        </div>
        <nav className="tabbar">
          {TABS.map(([k, l]) => (
            <button key={k} className={"tabbtn" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
      </header>

      <main className="pad" style={{ display: "grid", gap: 16, maxWidth: 1180, margin: "0 auto" }}>

        {/* ══════ PREDIO ══════ */}
        {tab === "predio" && (
          <div className="grid grid-cols-1 gap-4">
            <Card title="Recursos del ciclo" hint="Todo se recalcula al instante: mueve los deslizadores y observa cómo cambia el plan óptimo.">
              <div className="pad grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label className="eyebrow">Superficie total (S)</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                    <Num value={par.superficie} onChange={(v) => setP("superficie", v)} step={1} /> <span className="hint">ha</span>
                  </div>
                  <input className="rng" type="range" min={1} max={300} step={1} value={par.superficie}
                    onChange={(e) => setP("superficie", +e.target.value)} />
                </div>
                <div>
                  <Sw on={par.usarAgua} set={(v) => setP("usarAgua", v)}><b>Agua de riego (A)</b></Sw>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                    <Num wide value={par.agua} onChange={(v) => setP("agua", v)} step={5000} /> <span className="hint">m³ / ciclo</span>
                  </div>
                  <input className="rng" type="range" min={0} max={1500000} step={5000} value={par.agua}
                    disabled={!par.usarAgua} onChange={(e) => setP("agua", +e.target.value)} />
                  <p className="hint">{par.superficie > 0 ? nf(par.agua / par.superficie, 0) + " m³ por hectárea en promedio" : ""}</p>
                </div>
                <div>
                  <Sw on={par.usarPresupuesto} set={(v) => setP("usarPresupuesto", v)}><b>Presupuesto de fertilizante (B)</b></Sw>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                    <Num wide value={par.presupuesto} onChange={(v) => setP("presupuesto", v)} step={10000} /> <span className="hint">$</span>
                  </div>
                  <input className="rng" type="range" min={0} max={3000000} step={10000} value={par.presupuesto}
                    disabled={!par.usarPresupuesto} onChange={(e) => setP("presupuesto", +e.target.value)} />
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card title="Reglas agronómicas opcionales">
                <div className="pad" style={{ display: "grid", gap: 12 }}>
                  <div>
                    <Sw on={par.usarStock} set={(v) => setP("usarStock", v)}>Respetar existencias del proveedor</Sw>
                    <p className="hint">Limita las toneladas disponibles de cada marca (columna “Existencia”).</p>
                  </div>
                  <div>
                    <Sw on={par.usarTope} set={(v) => setP("usarTope", v)}>Tope de sobrefertilización</Sw>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <Num value={par.tolerancia} onChange={(v) => setP("tolerancia", v)} step={5} /><span className="hint">% de tolerancia (τ)</span>
                    </div>
                    <p className="hint">El aporte de cada nutriente no puede exceder el requerimiento más τ%.</p>
                  </div>
                  <div>
                    <Sw on={par.usarOrganico} set={(v) => setP("usarOrganico", v)}>Fracción mínima de N orgánico</Sw>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <Num value={par.beta} onChange={(v) => setP("beta", v)} step={5} /><span className="hint">% del N total (β)</span>
                    </div>
                    <p className="hint">Obliga a cubrir parte del nitrógeno con fuentes marcadas como orgánicas.</p>
                  </div>
                </div>
              </Card>

              <Card title="Alcance del balance de nutrientes">
                <div className="pad" style={{ display: "grid", gap: 10 }}>
                  <Sw on={par.detallado} set={(v) => setP("detallado", v)}>
                    Asignar fertilizante cultivo por cultivo
                  </Sw>
                  <p className="hint">
                    <b>Apagado (balance global):</b> las variables son yⱼ = toneladas totales de cada fertilizante y el
                    balance de N, P₂O₅ y K₂O se cumple para todo el predio. Modelo compacto, ideal para explicar el método.
                  </p>
                  <p className="hint">
                    <b>Encendido (balance por cultivo):</b> las variables son yᵢⱼ = toneladas del fertilizante j aplicadas
                    al cultivo i, y cada cultivo debe cubrir su propio requerimiento. Es más realista y produce una mezcla
                    distinta por cultivo, a costa de {M.nc * M.nfz} variables de fertilización.
                  </p>
                  <div className="tag" style={{ width: "fit-content" }}>
                    Modelo actual: <b className="mono">{M.n}</b> variables · <b className="mono">{M.rows.length}</b> restricciones
                  </div>
                </div>
              </Card>
            </div>

            <Card title="El predio" aside={<span className="hint">vista del plan óptimo</span>}>
              <div className="pad">
                <Predio res={res} sup={par.superficie} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {res && res.ha.filter((c) => c.ha > 1e-9).map((c) => (
                    <span key={c.id} className="tag"><Dot c={c.color} />{c.nombre} · <b className="mono">{nf(c.ha, 2)} ha</b></span>
                  ))}
                  {res && res.libre > 1e-6 && <span className="tag"><Dot c="#C9BFA8" />Sin sembrar · <b className="mono">{nf(res.libre, 2)} ha</b></span>}
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ══════ CULTIVOS ══════ */}
        {tab === "cultivos" && (
          <Card title="Cultivos posibles"
            hint="Enciende los cultivos que quieres considerar. Los requerimientos están en toneladas de nutriente por hectárea (0.16 t/ha = 160 kg/ha). Un área máxima de 0 significa “sin límite”.">
            <div className="pad scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th>Sembrar</th><th>Cultivo</th>
                    <th>Margen bruto $/ha</th><th>Riego m³/ha</th>
                    <th>N t/ha</th><th>P₂O₅ t/ha</th><th>K₂O t/ha</th>
                    <th>Área mín ha</th><th>Área máx ha</th>
                    <th style={{ textAlign: "right" }}>Óptimo</th>
                  </tr>
                </thead>
                <tbody>
                  {cultivos.map((c) => {
                    const r = res && res.ha.find((h) => h.id === c.id);
                    return (
                      <tr key={c.id} className={c.on ? "" : "off"}>
                        <td><input type="checkbox" checked={c.on} onChange={(e) => setC(c.id, "on", e.target.checked)} /></td>
                        <td style={{ whiteSpace: "nowrap" }}><Dot c={c.color} /> <b style={{ marginLeft: 6 }}>{c.nombre}</b></td>
                        <td><Num value={c.utilidad} onChange={(v) => setC(c.id, "utilidad", v)} step={1000} /></td>
                        <td><Num value={c.agua} onChange={(v) => setC(c.id, "agua", v)} step={500} /></td>
                        {NUTS.map((n) => (
                          <td key={n.k}><Num value={c.req[n.k]} onChange={(v) => setCReq(c.id, n.k, v)} step={0.01} /></td>
                        ))}
                        <td><Num value={c.areaMin} onChange={(v) => setC(c.id, "areaMin", v)} step={1} /></td>
                        <td><Num value={c.areaMax} onChange={(v) => setC(c.id, "areaMax", v)} step={1} /></td>
                        <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: r && r.ha > 0 ? "var(--verde)" : "var(--tinta2)" }}>
                          {r ? nf(r.ha, 2) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn sm" onClick={() => setCultivos((cs) => cs.map((c) => ({ ...c, on: ["maiz", "frijol", "calabaza"].includes(c.id) })))}>
                  Milpa tradicional
                </button>
                <button className="btn sm" onClick={() => setCultivos((cs) => cs.map((c) => ({ ...c, on: ["maiz", "frijol", "calabaza", "chile"].includes(c.id) })))}>
                  Milpa + hortaliza
                </button>
                <button className="btn sm" onClick={() => setCultivos((cs) => cs.map((c) => ({ ...c, on: ["cafe", "naranja", "cana"].includes(c.id) })))}>
                  Perennes
                </button>
                <button className="btn sm" onClick={() => setCultivos((cs) => cs.map((c) => ({ ...c, on: true })))}>Todos</button>
                <button className="btn sm" onClick={() => setCultivos(CULTIVOS_0)}>Restaurar datos</button>
              </div>
            </div>
          </Card>
        )}

        {/* ══════ FERTILIZANTES ══════ */}
        {tab === "fert" && (
          <Card title="Marcas y fórmulas disponibles"
            hint="El aporte está en toneladas de nutriente por tonelada de producto: una urea 46-00-00 aporta 0.46 t de N por tonelada. Una existencia de 0 significa “sin límite”.">
            <div className="pad scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th>Usar</th><th>Marca</th><th>Producto</th><th>Grado</th>
                    <th>N t/t</th><th>P₂O₅ t/t</th><th>K₂O t/t</th>
                    <th>Precio $/t</th><th>Existencia t</th><th>Orgánico</th>
                    <th style={{ textAlign: "right" }}>Óptimo t</th>
                  </tr>
                </thead>
                <tbody>
                  {ferts.map((f) => {
                    const r = res && res.fert.find((x) => x.id === f.id);
                    return (
                      <tr key={f.id} className={f.on ? "" : "off"}>
                        <td><input type="checkbox" checked={f.on} onChange={(e) => setF(f.id, "on", e.target.checked)} /></td>
                        <td className="hint" style={{ whiteSpace: "nowrap" }}>{f.marca}</td>
                        <td style={{ whiteSpace: "nowrap" }}><b>{f.nombre}</b></td>
                        <td className="mono">{f.grado}</td>
                        {NUTS.map((n) => (
                          <td key={n.k}><Num value={f.ap[n.k]} onChange={(v) => setFap(f.id, n.k, v)} step={0.01} max={1} /></td>
                        ))}
                        <td><Num value={f.costo} onChange={(v) => setF(f.id, "costo", v)} step={500} /></td>
                        <td><Num value={f.stock} onChange={(v) => setF(f.id, "stock", v)} step={5} /></td>
                        <td><input type="checkbox" checked={!!f.organico} onChange={(e) => setF(f.id, "organico", e.target.checked)} /></td>
                        <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: r && r.t > 0 ? "var(--riego)" : "var(--tinta2)" }}>
                          {r ? nf(r.t, 3) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="hint" style={{ marginTop: 10 }}>
                Costo efectivo por tonelada de nutriente (útil para anticipar qué elegirá el modelo):{" "}
                {ferts.filter((f) => f.on).map((f) => (
                  <span key={f.id} className="tag" style={{ margin: "3px 4px 0 0" }}>
                    {f.nombre}: {NUTS.filter((n) => f.ap[n.k] > 0).map((n) => n.lab + " " + money(f.costo / f.ap[n.k])).join(" · ") || "sin nutrientes"}
                  </span>
                ))}
              </p>
              <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setFerts(FERTS_0)}>Restaurar datos</button>
            </div>
          </Card>
        )}

        {/* ══════ ASOCIACIONES ══════ */}
        {tab === "asoc" && (
          <Card title="Cultivos asociados"
            hint="Reglas del tipo “el área de A guarda una proporción con el área de B”. Son lineales porque se escriben como xA − k·xB ≤ 0 (o ≥, o =). Sirven para modelar milpa, intercalado, rotación o compromisos de mercado.">
            <div className="pad scroll">
              <table className="t">
                <thead><tr><th>Activa</th><th>Cultivo A</th><th>Relación</th><th>Factor k</th><th>Cultivo B</th><th>Forma lineal</th><th></th></tr></thead>
                <tbody>
                  {asocs.map((s) => {
                    const nom = (id) => (cultivos.find((c) => c.id === id) || {}).nombre || "—";
                    return (
                      <tr key={s.id} className={s.on ? "" : "off"}>
                        <td><input type="checkbox" checked={s.on} onChange={(e) => setAsocs((a) => a.map((z) => z.id === s.id ? { ...z, on: e.target.checked } : z))} /></td>
                        <td>
                          <select className="sel" value={s.a} onChange={(e) => setAsocs((a) => a.map((z) => z.id === s.id ? { ...z, a: e.target.value } : z))}>
                            {cultivos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="sel" value={s.op} onChange={(e) => setAsocs((a) => a.map((z) => z.id === s.id ? { ...z, op: e.target.value } : z))}>
                            <option value="<=">≤ como máximo</option>
                            <option value=">=">≥ al menos</option>
                            <option value="=">= exactamente</option>
                          </select>
                        </td>
                        <td><Num value={s.k} onChange={(v) => setAsocs((a) => a.map((z) => z.id === s.id ? { ...z, k: v } : z))} step={0.05} /></td>
                        <td>
                          <select className="sel" value={s.b} onChange={(e) => setAsocs((a) => a.map((z) => z.id === s.id ? { ...z, b: e.target.value } : z))}>
                            {cultivos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                        </td>
                        <td className="mono hint">ha({nom(s.a)}) {s.op === "<=" ? "≤" : s.op === ">=" ? "≥" : "="} {s.k} · ha({nom(s.b)})</td>
                        <td><button className="btn sm" onClick={() => setAsocs((a) => a.filter((z) => z.id !== s.id))}>Quitar</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="btn sm" style={{ marginTop: 12 }}
                onClick={() => setAsocs((a) => [...a, { id: Date.now(), a: cultivos[0].id, op: "<=", k: 1, b: cultivos[1].id, on: true }])}>
                Agregar regla
              </button>
              <p className="hint" style={{ marginTop: 10 }}>
                Ojo con la factibilidad: pedir “al menos” demasiado de varios cultivos a la vez puede volver imposible el
                plan. Si eso pasa, el encabezado marcará <b>Modelo infactible</b>.
              </p>
            </div>
          </Card>
        )}

        {/* ══════ FORMULACIÓN MATEMÁTICA ══════ */}
        {tab === "mate" && <Formulacion M={M} res={res} par={par} />}

        {/* ══════ MODELO CON DATOS ══════ */}
        {tab === "modelo" && <ModeloVista M={M} res={res} />}

        {/* ══════ SOLUCIÓN ══════ */}
        {tab === "sol" && (
          <Solucion M={M} sol={sol} res={res} par={par} escenarios={escenarios}
            guardar={guardar} limpiar={() => setEscenarios([])} />
        )}

        {/* ══════ FICHA Y REPORTE ══════ */}
        {tab === "ficha" && <Ficha ficha={ficha} setFicha={setFicha} M={M} res={res} par={par} sol={sol} />}

      </main>

      <BandaCreditos />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   10. PESTAÑA DE SOLUCIÓN
   ══════════════════════════════════════════════════════════════════ */
function Solucion({ M, sol, res, par, escenarios, guardar, limpiar }) {
  if (sol.status === "infactible")
    return (
      <div className="alerta">
        <b>No existe ningún plan que cumpla todas las restricciones a la vez.</b>
        <p style={{ marginTop: 6 }}>Revisa las áreas mínimas, las reglas de asociación con “al menos”, el presupuesto
          y las existencias de fertilizante. Prueba a aflojar una restricción a la vez para encontrar cuál choca.</p>
      </div>
    );
  if (sol.status === "no_acotado")
    return <div className="alerta"><b>La utilidad crece sin límite.</b>
      <p style={{ marginTop: 6 }}>Falta alguna restricción que acote el problema, normalmente la superficie total.</p></div>;
  if (!res) return <div className="alerta">Activa al menos un cultivo y un fertilizante para resolver el modelo.</div>;
  if (M.C.length === 0)
    return <div className="alerta"><b>No hay cultivos activos.</b>
      <p style={{ marginTop: 6 }}>Enciende al menos uno en la pestaña <b>Cultivos</b> para que el modelo tenga variables xᵢ.</p></div>;
  if (M.F.length === 0)
    return <div className="alerta"><b>No hay fertilizantes activos.</b>
      <p style={{ marginTop: 6 }}>Sin fuentes de nutrientes, ningún cultivo puede cumplir su balance de N, P₂O₅ y K₂O,
        así que el plan óptimo es no sembrar nada. Enciende alguna marca en la pestaña <b>Fertilizantes</b>.</p></div>;

  const usoTierra = par.superficie > 0 ? res.haTotal / par.superficie : 0;
  const usoAgua = par.usarAgua && par.agua > 0 ? res.agua / par.agua : 0;
  const usoPres = par.usarPresupuesto && par.presupuesto > 0 ? res.costoFert / par.presupuesto : 0;

  const dataHa = res.ha.filter((c) => c.ha > 1e-9).map((c) => ({ name: c.nombre, ha: +c.ha.toFixed(3), color: c.color }));
  const dataFert = res.fert.filter((f) => f.t > 1e-9).map((f) => ({
    name: f.nombre + " " + f.grado, t: +f.t.toFixed(3), costo: Math.round(f.costoTotal),
    dosis: res.haTotal > 0 ? +(f.t / res.haTotal).toFixed(3) : 0,
  }));
  const dataNut = res.nut.map((n) => ({ name: n.lab, Requerido: +n.req.toFixed(3), Aportado: +n.apo.toFixed(3) }));
  const dataMezcla = M.det
    ? res.ha.filter((c) => c.ha > 1e-9).map((c) => {
        const o = { name: c.nombre };
        res.fert.forEach((f) => {
          const v = f.porCultivo.find((p) => p.id === c.id);
          if (v && v.t > 1e-9) o[f.nombre] = +v.t.toFixed(3);
        });
        return o;
      })
    : [];
  const fertUsados = res.fert.filter((f) => f.t > 1e-9);
  const PALETA = ["#2E5C3C", "#1D6E8C", "#B7830E", "#8A5A2B", "#7E5A9B", "#9E3B27", "#4E7B4A", "#C97E3C", "#5A6E8C"];

  const lecturas = [];
  res.cons.filter((c) => c.activa && Math.abs(c.dual) > 1e-4).forEach((c) => {
    if (c.grupo === "Tierra") lecturas.push(`La tierra es un recurso escaso: una hectárea más subiría la utilidad ${money(c.dual)}.`);
    else if (c.grupo === "Agua") lecturas.push(`El agua limita el plan: cada 1 000 m³ adicionales valen ${money(c.dual * 1000)}.`);
    else if (c.grupo === "Presupuesto") lecturas.push(`El presupuesto está agotado: cada peso extra para fertilizante devuelve ${nf(c.dual, 2)} pesos de utilidad.`);
    else if (c.nut && c.op === ">=") {
      const lab = (NUTS.find((n) => n.k === c.nut) || {}).lab;
      lecturas.push(`Cubrir una tonelada más de ${lab} cuesta ${money(-c.dual)} con la mezcla más barata disponible.`);
    }
    else if (c.grupo === "Áreas" && c.op === "<=") lecturas.push(`${c.nombre.replace("Área máxima · ", "")} tocó su tope: una hectárea más valdría ${money(c.dual)}.`);
    else if (c.grupo === "Disponibilidad") lecturas.push(`${c.nombre.replace("Existencia · ", "")} se agotó en el proveedor: una tonelada más ahorraría ${money(c.dual)}.`);
    else if (c.grupo === "Asociación") lecturas.push(`La regla “${c.nombre}” cuesta ${money(Math.abs(c.dual))} por hectárea forzada; es el precio de sembrar asociado.`);
  });
  const lecturasUnicas = [...new Set(lecturas)];
  const sinSembrar = res.ha.filter((c) => c.ha < 1e-9);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="ok">
        <b>Plan óptimo.</b> Sembrar {nf(res.haTotal, 2)} de {nf(par.superficie, 2)} ha deja una utilidad neta de{" "}
        <b className="mono">{money(res.z)}</b> = {money(res.ingreso)} de margen bruto − {money(res.costoFert)} de fertilizante.
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Margen bruto", money(res.ingreso), "var(--verde)"],
          ["Costo fertilizante", money(res.costoFert), "var(--riego)"],
          ["Utilidad neta Z", money(res.z), "var(--grano)"],
          ["Utilidad por hectárea", res.haTotal > 0 ? money(res.z / res.haTotal) : "—", "var(--tinta)"]]
          .map(([l, v, c]) => (
            <div key={l} className="card pad">
              <div className="eyebrow">{l}</div>
              <div className="mono" style={{ fontSize: 19, fontWeight: 600, color: c, marginTop: 2 }}>{v}</div>
            </div>
          ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="El predio sembrado">
          <div className="pad">
            <Predio res={res} sup={par.superficie} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {res.ha.filter((c) => c.ha > 1e-9).map((c) => (
                <span key={c.id} className="tag"><Dot c={c.color} />{c.nombre} · <b className="mono">{nf(c.ha, 2)} ha</b>
                  <span className="hint">({nf(100 * c.ha / (res.haTotal || 1), 0)}%)</span></span>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Uso de los recursos" hint="Una barra llena significa restricción activa: ese recurso es el que está frenando la utilidad.">
          <div className="pad" style={{ display: "grid", gap: 14 }}>
            {[["Tierra", usoTierra, `${nf(res.haTotal, 2)} de ${nf(par.superficie, 2)} ha`, "var(--verde2)"],
              ...(par.usarAgua ? [["Agua de riego", usoAgua, `${nf(res.agua, 0)} de ${nf(par.agua, 0)} m³`, "var(--riego)"]] : []),
              ...(par.usarPresupuesto ? [["Presupuesto", usoPres, `${money(res.costoFert)} de ${money(par.presupuesto)}`, "var(--grano)"]] : [])]
              .map(([l, v, t, c]) => (
                <div key={l}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <b style={{ fontSize: 12.5 }}>{l}</b>
                    <span className="mono hint">{t} · {nf(100 * v, 1)}%</span>
                  </div>
                  <div className="bar"><i style={{ width: Math.min(100, v * 100) + "%", background: c }} /></div>
                </div>
              ))}
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Consumo total de nutrientes</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {res.nut.map((n) => (
                  <span key={n.k} className="tag"><Dot c={n.color} />{n.lab}: <b className="mono">{nf(n.apo, 3)} t</b>
                    <span className="hint">req. {nf(n.req, 3)} t</span></span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Hectáreas por cultivo">
          <div className="pad" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataHa} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="#E4E9D6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#8B9682" />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} stroke="#8B9682" />
                <Tooltip formatter={(v) => [nf(v, 2) + " ha", "Superficie"]} />
                <Bar dataKey="ha" radius={[0, 2, 2, 0]}>
                  {dataHa.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Nutriente requerido vs. aportado" hint="Con balance ≥, el óptimo compra justo lo necesario: las barras coinciden salvo por el arrastre de fórmulas compuestas.">
          <div className="pad" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataNut} margin={{ left: 4, right: 10 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="#E4E9D6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#8B9682" />
                <YAxis tick={{ fontSize: 11 }} stroke="#8B9682" label={{ value: "t", angle: 0, position: "top", fontSize: 10, fill: "#8B9682" }} />
                <Tooltip formatter={(v) => nf(v, 3) + " t"} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Requerido" fill="#B7830E" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Aportado" fill="#2E5C3C" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Compra de fertilizante" aside={<span className="hint">dosis equivalente sobre la superficie sembrada</span>}>
        <div className="pad grid grid-cols-1 md:grid-cols-2 gap-4">
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataFert} margin={{ left: 4, right: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="#E4E9D6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-18} textAnchor="end" height={54} stroke="#8B9682" interval={0} />
                <YAxis tick={{ fontSize: 11 }} stroke="#8B9682" />
                <Tooltip formatter={(v, k) => (k === "t" ? [nf(v, 3) + " t", "Toneladas"] : [money(v), "Costo"])} />
                <Bar dataKey="t" radius={[2, 2, 0, 0]}>
                  {dataFert.map((d, i) => <Cell key={d.name} fill={PALETA[i % PALETA.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="scroll">
            <table className="t">
              <thead><tr><th>Producto</th><th style={{ textAlign: "right" }}>t totales</th><th style={{ textAlign: "right" }}>t/ha</th><th style={{ textAlign: "right" }}>Costo</th></tr></thead>
              <tbody>
                {dataFert.map((f) => (
                  <tr key={f.name}><td>{f.name}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{nf(f.t, 3)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{nf(f.dosis, 3)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{money(f.costo)}</td></tr>
                ))}
                {!dataFert.length && <tr><td colSpan={4} className="hint">El plan óptimo no compra fertilizante.</td></tr>}
                <tr><td><b>Total</b></td><td className="mono" style={{ textAlign: "right" }}><b>{nf(dataFert.reduce((s, f) => s + f.t, 0), 3)}</b></td><td /><td className="mono" style={{ textAlign: "right" }}><b>{money(res.costoFert)}</b></td></tr>
              </tbody>
            </table>
          </div>
        </div>
        {M.det && dataMezcla.length > 0 && (
          <div className="pad" style={{ borderTop: "1px solid var(--linea)" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Mezcla asignada a cada cultivo (t)</div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dataMezcla} margin={{ left: 4, right: 10 }}>
                  <CartesianGrid strokeDasharray="2 3" stroke="#E4E9D6" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#8B9682" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#8B9682" />
                  <Tooltip formatter={(v) => nf(v, 3) + " t"} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {fertUsados.map((f, i) => (
                    <Bar key={f.id} dataKey={f.nombre} stackId="m" fill={PALETA[i % PALETA.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>

      <Card title="Análisis de sensibilidad"
        hint="Precio sombra = cuánto cambia la utilidad neta Z si el término independiente de esa restricción aumenta en una unidad. Solo las restricciones activas (holgura cero) tienen precio sombra distinto de cero.">
        <div className="pad scroll">
          <table className="t">
            <thead><tr><th>ID</th><th>Restricción</th><th>Grupo</th><th style={{ textAlign: "right" }}>Lado izq.</th><th>Signo</th>
              <th style={{ textAlign: "right" }}>Lado der.</th><th style={{ textAlign: "right" }}>Holgura</th><th style={{ textAlign: "right" }}>Precio sombra</th></tr></thead>
            <tbody>
              {res.cons.map((c) => (
                <tr key={c.id} style={c.activa ? { background: "#FBF7EA" } : undefined}>
                  <td className="mono hint">{c.id}</td>
                  <td>{c.nombre} {c.activa && <span className="badge" style={{ color: "var(--grano)" }}>activa</span>}</td>
                  <td className="hint">{c.grupo}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{nf(c.lhs, 2)}</td>
                  <td className="mono">{c.op === "<=" ? "≤" : c.op === ">=" ? "≥" : "="}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{nf(c.rhs, 2)}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{nf(c.holgura, 2)}</td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: Math.abs(c.dual) > 1e-6 ? 600 : 400, color: c.dual > 0 ? "var(--verde)" : c.dual < 0 ? "var(--rojo)" : "var(--tinta2)" }}>
                    {Math.abs(c.dual) > 1e-6 ? nf(c.dual, 2) : "0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Cómo leer este resultado">
        <div className="pad" style={{ display: "grid", gap: 7 }}>
          {lecturasUnicas.length ? lecturasUnicas.map((l, i) => (
            <p key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>· {l}</p>
          )) : <p className="hint">Ninguna restricción está activa: sobran recursos en todas partes.</p>}
          {sinSembrar.length > 0 && (
            <p style={{ fontSize: 13, lineHeight: 1.55 }}>
              · Quedan fuera del plan {sinSembrar.map((c) => c.nombre).join(", ")}: con los precios y requerimientos
              actuales no compiten por la tierra. Sube su margen bruto o baja el de los ganadores para verlos entrar.
            </p>
          )}
        </div>
      </Card>

      <Card title="Comparar escenarios"
        aside={<span style={{ display: "flex", gap: 6 }}>
          <button className="btn sm pri" onClick={guardar}>Guardar este escenario</button>
          {escenarios.length > 0 && <button className="btn sm" onClick={limpiar}>Borrar</button>}
        </span>}
        hint="Guarda la corrida actual, cambia cultivos o recursos, y compara la utilidad neta de cada combinación.">
        <div className="pad">
          {escenarios.length === 0 ? (
            <p className="hint">Todavía no hay escenarios guardados.</p>
          ) : (
            <>
              <div style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={escenarios.map((e, i) => ({ name: (i + 1) + ". " + e.nombre, Z: Math.round(e.z) }))} margin={{ left: 10, right: 10, bottom: 26 }}>
                    <CartesianGrid strokeDasharray="2 3" stroke="#E4E9D6" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={50} stroke="#8B9682" interval={0} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#8B9682" />
                    <Tooltip formatter={(v) => money(v)} />
                    <Bar dataKey="Z" fill="#2E5C3C" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="scroll" style={{ marginTop: 10 }}>
                <table className="t">
                  <thead><tr><th>#</th><th>Cultivos</th><th style={{ textAlign: "right" }}>Superficie</th><th style={{ textAlign: "right" }}>Sembrado</th>
                    <th style={{ textAlign: "right" }}>Agua</th><th style={{ textAlign: "right" }}>Fertilizante</th><th style={{ textAlign: "right" }}>Z</th></tr></thead>
                  <tbody>
                    {escenarios.map((e, i) => (
                      <tr key={e.id}><td className="mono">{i + 1}</td><td>{e.nombre}</td>
                        <td className="mono" style={{ textAlign: "right" }}>{nf(e.sup, 0)} ha</td>
                        <td className="mono" style={{ textAlign: "right" }}>{nf(e.ha, 2)} ha</td>
                        <td className="mono" style={{ textAlign: "right" }}>{nf(e.agua, 0)} m³</td>
                        <td className="mono" style={{ textAlign: "right" }}>{money(e.costo)}</td>
                        <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>{money(e.z)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
