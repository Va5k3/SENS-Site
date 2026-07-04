const csvInput = document.getElementById("csvInput");
const fileDrop = document.getElementById("fileDrop");
const statusEl = document.getElementById("status");
const canvas = document.getElementById("chart");
const clockEl = document.getElementById("clock");

const fromSlider = document.getElementById("fromSlider");
const toSlider = document.getElementById("toSlider");
const rangeFill = document.getElementById("rangeFill");
const rangeValuesLabel = document.getElementById("rangeValuesLabel");
const boundMin = document.getElementById("boundMin");
const boundMax = document.getElementById("boundMax");

const resetBtn = document.getElementById("resetRange");
const toggleTableBtn = document.getElementById("toggleTable");

const seriesListEl = document.getElementById("seriesList");
const statsContainer = document.getElementById("statsContainer");
const tableContainer = document.getElementById("tableContainer");

const PALETTE = ["#00e5ff", "#ff5470", "#ffd23f", "#06d6a0", "#a56bff", "#ff9f4a", "#5ec6ff", "#f26fb2"];

let chart = null;
let parsedCsv = null;
let seriesState = [];
let tableVisible = false;
let lastFilteredIdx = null;

function pad2(n){ return String(n).padStart(2, "0"); }

function tickClock(){
  const d = new Date();
  clockEl.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
tickClock();
setInterval(tickClock, 1000);

function setStatus(msg, state = "idle"){
  statusEl.textContent = msg || "";
  statusEl.dataset.state = state;
}

function parseNumberLoose(v){
  const s = String(v ?? "").trim();
  if(!s) return NaN;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function fmt(v){
  if(!Number.isFinite(v)) return "";
  return String(Math.round(v * 100) / 100);
}

function parseCSV(text){
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if(lines.length < 2) throw new Error("CSV fajl nema dovoljno redova.");

  const headers = lines[0].split(",").map(h => h.trim());
  let rows = lines.slice(1).map(line => line.split(",").map(x => x.trim()));

  if(rows.length){
    const first = (rows[0][0] ?? "").trim();
    const firstNum = parseNumberLoose(first);
    const looksLikeTime = /^(\d{1,2}:\d{2})(?::\d{2})?$/.test(first);
    if(!Number.isFinite(firstNum) && !looksLikeTime) rows = rows.slice(1);
  }

  const labelSec = rows.map(r => parseNumberLoose(r[0] ?? ""));

  const dataCols = headers.slice(1).map((_, idx) => {
    const col = idx + 1;
    return rows.map(r => {
      const v = parseNumberLoose(r[col] ?? "");
      return Number.isFinite(v) ? v : null;
    });
  });

  const finite = labelSec.filter(Number.isFinite);
  const minSec = finite.length ? Math.min(...finite) : 0;
  const maxSec = finite.length ? Math.max(...finite) : 0;

  return { headers, labelSec, dataCols, rowsCount: rows.length, minSec, maxSec };
}

function buildSeriesState(headers){
  seriesState = headers.slice(1).map((h, i) => ({
    name: (h || `Kanal ${i+1}`).trim(),
    color: PALETTE[i % PALETTE.length],
    checked: true
  }));
}

function buildSeriesUI(){
  seriesListEl.innerHTML = "";
  seriesState.forEach((s, i) => {
    const chip = document.createElement("div");
    chip.className = "channel-chip";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = s.checked;
    cb.id = `chk-${i}`;

    const color = document.createElement("input");
    color.type = "color";
    color.value = s.color;

    const label = document.createElement("label");
    label.textContent = s.name;
    label.setAttribute("for", `chk-${i}`);

    cb.addEventListener("change", () => {
      seriesState[i].checked = cb.checked;
      render();
    });

    color.addEventListener("input", () => {
      seriesState[i].color = color.value;
      render();
    });

    chip.appendChild(cb);
    chip.appendChild(color);
    chip.appendChild(label);
    seriesListEl.appendChild(chip);
  });
}

function checkedIndexes(){
  const idx = [];
  seriesState.forEach((s, i) => { if(s.checked) idx.push(i); });
  return idx;
}

function calcStats(values){
  const nums = values.filter(v => typeof v === "number" && Number.isFinite(v));
  const n = nums.length;
  if(!n) return { n: 0, min: null, max: null, avg: null };
  let min = nums[0], max = nums[0], sum = 0;
  for(const v of nums){
    if(v < min) min = v;
    if(v > max) max = v;
    sum += v;
  }
  return { n, min, max, avg: sum / n };
}

function renderStats(filteredIdx){
  const cards = [];
  seriesState.forEach((s, i) => {
    if(!s.checked) return;
    const values = filteredIdx.map(r => parsedCsv.dataCols[i][r]);
    const st = calcStats(values);
    cards.push(`
      <div class="stat-card" style="--accent:${s.color}">
        <h4>${s.name}</h4>
        <div class="stat-line"><span>Min</span><b>${st.n ? st.min.toFixed(2) : "—"}</b></div>
        <div class="stat-line"><span>Max</span><b>${st.n ? st.max.toFixed(2) : "—"}</b></div>
        <div class="stat-line"><span>Prosek</span><b>${st.n ? st.avg.toFixed(2) : "—"}</b></div>
      </div>
    `);
  });
  statsContainer.innerHTML = cards.join("");
}

function buildDatasets(filteredIdx, cols){
  return cols.map(i => {
    const s = seriesState[i];
    const points = [];
    for(const r of filteredIdx){
      const x = parsedCsv.labelSec[r];
      const y = parsedCsv.dataCols[i][r];
      if(!Number.isFinite(x) || y == null) continue;
      points.push({ x, y });
    }
    return {
      label: s.name,
      data: points,
      borderColor: s.color,
      backgroundColor: s.color,
      pointRadius: 0,
      borderWidth: 2.5,
      tension: 0.25
    };
  });
}

function drawChart(datasets, xMin, xMax){
  if(chart) chart.destroy();

  chart = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#241a48",
          borderColor: "rgba(255,255,255,0.15)",
          borderWidth: 1,
          titleColor: "#ffd23f",
          bodyColor: "#f5f3ff",
          titleFont: { family: "IBM Plex Mono" },
          bodyFont: { family: "IBM Plex Mono" },
          callbacks: {
            title: items => `t = ${fmt(Number(items?.[0]?.raw?.x))} s`,
            label: item => {
              const y = item.raw?.y;
              const val = (typeof y === "number" && Number.isFinite(y)) ? y.toFixed(2) : "";
              return `${item.dataset.label || ""}: ${val}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          min: xMin,
          max: xMax,
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#b9aede", maxTicksLimit: 8, callback: v => fmt(Number(v)), font: { family: "IBM Plex Mono", size: 11 } }
        },
        y: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#b9aede", font: { family: "IBM Plex Mono", size: 11 } }
        }
      }
    }
  });
}

function setupSliders(minSec, maxSec){
  [fromSlider, toSlider].forEach(el => {
    el.min = String(minSec);
    el.max = String(maxSec);
    el.step = "0.01";
  });
  fromSlider.value = String(minSec);
  toSlider.value = String(maxSec);
  boundMin.textContent = `${fmt(minSec)} s`;
  boundMax.textContent = `${fmt(maxSec)} s`;
  updateRangeVisuals();
}

function updateRangeVisuals(){
  const min = Number(fromSlider.min);
  const max = Number(fromSlider.max);
  let from = Number(fromSlider.value);
  let to = Number(toSlider.value);

  if(from > to){
    // keep from <= to by nudging the one being dragged; simplest: swap read values only for display
    [from, to] = [Math.min(from, to), Math.max(from, to)];
  }

  const span = (max - min) || 1;
  const leftPct = ((from - min) / span) * 100;
  const rightPct = ((to - min) / span) * 100;

  rangeFill.style.left = `${leftPct}%`;
  rangeFill.style.right = `${100 - rightPct}%`;
  rangeValuesLabel.textContent = `${fmt(from)} s do ${fmt(to)} s`;
}

function getRange(){
  let from = Number(fromSlider.value);
  let to = Number(toSlider.value);
  if(from > to) [from, to] = [to, from];
  return { fromSec: from, toSec: to };
}

function filterIdxBySeconds(fromSec, toSec){
  const idx = [];
  for(let i = 0; i < parsedCsv.labelSec.length; i++){
    const sec = parsedCsv.labelSec[i];
    if(!Number.isFinite(sec)) continue;
    if(sec >= fromSec && sec <= toSec) idx.push(i);
  }
  return idx;
}

function renderTable(filteredIdx){
  const cols = checkedIndexes();

  const headerCells = [
    `<th class="idx-col">#</th>`,
    `<th class="time-col">Vreme (s)</th>`,
    ...cols.map(i => `<th class="col-mark" style="border-left-color:${seriesState[i].color}">${seriesState[i].name}</th>`)
  ].join("");

  const bodyRows = filteredIdx.map((r, pos) => {
    const cells = [
      `<td class="idx-col">${pos + 1}</td>`,
      `<td class="time-col">${fmt(parsedCsv.labelSec[r])}</td>`,
      ...cols.map(i => {
        const v = parsedCsv.dataCols[i][r];
        return `<td class="col-mark" style="border-left-color:${seriesState[i].color}">${v == null ? "" : v}</td>`;
      })
    ].join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  tableContainer.innerHTML = `
    <div class="table-head">
      <b>Tabela podataka</b>
      <span class="hint">${filteredIdx.length} redova</span>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function render(){
  if(!parsedCsv) return;

  updateRangeVisuals();
  const { fromSec, toSec } = getRange();
  const filteredIdx = filterIdxBySeconds(fromSec, toSec);
  lastFilteredIdx = filteredIdx;

  const cols = checkedIndexes();
  const datasets = buildDatasets(filteredIdx, cols);
  drawChart(datasets, fromSec, toSec);
  renderStats(filteredIdx);

  if(tableVisible){
    renderTable(filteredIdx);
    tableContainer.classList.remove("hidden");
  } else {
    tableContainer.classList.add("hidden");
  }
}

function loadFile(file){
  file.text().then(text => {
    parsedCsv = parseCSV(text);
    buildSeriesState(parsedCsv.headers);
    buildSeriesUI();

    resetBtn.disabled = false;
    toggleTableBtn.disabled = false;

    setupSliders(parsedCsv.minSec, parsedCsv.maxSec);
    setStatus(`Učitano: ${file.name} · ${parsedCsv.rowsCount} merenja`, "ok");
    render();
  }).catch(err => {
    console.error(err);
    setStatus(err?.message || "Greška pri učitavanju CSV fajla.", "error");
  });
}

csvInput.addEventListener("change", e => {
  const file = e.target.files?.[0];
  if(file) loadFile(file);
});

["dragover", "dragenter"].forEach(evt => {
  fileDrop.addEventListener(evt, e => {
    e.preventDefault();
    fileDrop.style.borderColor = "var(--cyan)";
  });
});
["dragleave", "drop"].forEach(evt => {
  fileDrop.addEventListener(evt, e => {
    e.preventDefault();
    fileDrop.style.borderColor = "";
  });
});
fileDrop.addEventListener("drop", e => {
  const file = e.dataTransfer?.files?.[0];
  if(file && file.name.toLowerCase().endsWith(".csv")) loadFile(file);
});

fromSlider.addEventListener("input", render);
toSlider.addEventListener("input", render);

resetBtn.addEventListener("click", () => {
  if(!parsedCsv) return;
  fromSlider.value = String(parsedCsv.minSec);
  toSlider.value = String(parsedCsv.maxSec);
  render();
});

toggleTableBtn.addEventListener("click", () => {
  if(!parsedCsv) return;
  tableVisible = !tableVisible;
  toggleTableBtn.textContent = tableVisible ? "▤ Sakrij tabelu" : "▤ Prikaži tabelu";
  if(tableVisible){
    renderTable(lastFilteredIdx ?? []);
    tableContainer.classList.remove("hidden");
  } else {
    tableContainer.classList.add("hidden");
  }
});
