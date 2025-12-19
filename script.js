// ==========================================
// CONFIG & STATE
// ==========================================
const RECURSIVE_SAFE_LIMIT = 34;

const fileInput = document.getElementById("fileInput");
const dashboard = document.getElementById("dashboard");
const warningBox = document.getElementById("warning-limit");

// Event Listener untuk Upload File
if (fileInput) {
  fileInput.addEventListener("change", handleFile);
}

// Helper untuk update Text konten dengan aman (cek null agar tidak error)
const setTextSafe = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
};

const setDisplaySafe = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.style.display = val;
};

// ==========================================
// 1. DATA PARSING (MULTI-SHEET) & STATISTICS
// ==========================================
function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Reset UI
  setTextSafe("error-msg", "");
  setDisplaySafe("file-info", "block");
  setTextSafe("file-info", `Menganalisis: ${file.name}...`);

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      let allParsedData = [];
      let sheetsProcessed = 0;

      // --- LOOP THROUGH ALL SHEETS ---
      workbook.SheetNames.forEach((sheetName) => {
        const jsonSheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

        // Skip empty sheets
        if (!jsonSheet || jsonSheet.length === 0) return;

        // --- FIND COLUMNS PER SHEET ---
        let idxNilai = -1,
          idxNama = -1,
          idxKelas = -1,
          idxNim = -1;
        let startRow = -1;

        const matchHeader = (cell, keywords) => {
          if (!cell) return false;
          const str = cell.toString().toUpperCase().trim();
          return keywords.some((k) => str.includes(k));
        };

        // Scan first 20 rows of EACH sheet to find headers
        for (let r = 0; r < Math.min(jsonSheet.length, 20); r++) {
          const row = jsonSheet[r];
          if (!row) continue;

          const foundNilai = row.findIndex((c) => matchHeader(c, ["TOTAL NILAI", "NILAI AKHIR", "SCORE", "TOTAL"]));
          const foundNama = row.findIndex((c) => matchHeader(c, ["NAMA", "NAME", "MAHASISWA", "STUDENT"]));
          const foundKelas = row.findIndex((c) => matchHeader(c, ["KELAS", "CLASS", "SECTION", "GROUP", "KODE"]));
          const foundNim = row.findIndex((c) => matchHeader(c, ["NIM", "N.I.M", "NO.", "NOMOR", "ID"]));

          if (foundNilai !== -1) {
            idxNilai = foundNilai;
            idxNama = foundNama;
            idxKelas = foundKelas;
            idxNim = foundNim;
            startRow = r + 1;
            break;
          }
        }

        // Only process if 'Total Nilai' found in this sheet
        if (idxNilai !== -1) {
          sheetsProcessed++;

          // Extract Data from this sheet
          for (let i = startRow; i < jsonSheet.length; i++) {
            const row = jsonSheet[i];
            if (!row) continue;

            const val = row[idxNilai];

            if (typeof val === "number") {
              let namaVal = idxNama !== -1 ? row[idxNama] : row[2] || row[1] || "Unknown";
              let nimVal = idxNim !== -1 ? row[idxNim] : row[1] || "-";
              // Use Sheet Name if Class column not found
              let kelasVal = idxKelas !== -1 && row[idxKelas] ? row[idxKelas] : sheetName;

              allParsedData.push({
                nilai: val,
                nama: namaVal,
                nim: nimVal,
                kelas: kelasVal,
              });
            }
          }
        }
      });

      const n = allParsedData.length;
      if (n === 0) throw new Error("Tidak ada data angka ditemukan di semua sheet.");

      setTextSafe("file-info", `Sukses! Membaca ${n} data dari ${sheetsProcessed} sheet.`);

      // --- CALCULATE STATISTICS ---
      calculateStatistics(allParsedData);

      // --- RUN ALGORITHM BENCHMARK ---
      runAlgorithmBenchmark(n);
    } catch (err) {
      console.error(err);
      setTextSafe("error-msg", "Error: " + err.message);
      dashboard.classList.add("hidden");
    }
  };
  reader.readAsArrayBuffer(file);
}

function calculateStatistics(data) {
  // 1. GROUP BY STUDENT
  const studentStats = {};

  data.forEach((item) => {
    const key = item.nim && item.nim !== "-" && item.nim.toString().length > 3 ? item.nim.toString().trim() : item.nama.toString().trim();

    if (!studentStats[key]) {
      studentStats[key] = {
        nim: item.nim,
        nama: item.nama,
        kelas: item.kelas,
        totalScore: 0,
        moduleCount: 0,
      };
    }

    studentStats[key].totalScore += item.nilai;
    studentStats[key].moduleCount += 1;
    if (item.kelas !== "Lainnya" && item.kelas !== "Unassigned") {
      studentStats[key].kelas = item.kelas;
    }
  });

  // Cari 1 Mahasiswa Terbaik (Juara Umum)
  let bestStudent = null;
  let maxAvg = -Infinity;

  Object.values(studentStats).forEach((student) => {
    const avg = student.totalScore / student.moduleCount;
    student.average = avg;

    if (avg > maxAvg) {
      maxAvg = avg;
      bestStudent = student;
    }
  });

  // 2. GROUP BY CLASS
  const classGroups = {};
  data.forEach((item) => {
    const cls = item.kelas ? item.kelas.toString().trim() : "Lainnya";
    if (!classGroups[cls]) classGroups[cls] = { sum: 0, count: 0 };
    classGroups[cls].sum += item.nilai;
    classGroups[cls].count += 1;
  });

  let bestClassAvg = -Infinity;
  let bestClassGroups = [];

  for (const [className, stat] of Object.entries(classGroups)) {
    const avg = stat.sum / stat.count;
    if (avg > bestClassAvg) {
      bestClassAvg = avg;
      bestClassGroups = [{ name: className, avg: avg }];
    } else if (Math.abs(avg - bestClassAvg) < 0.0001) {
      bestClassGroups.push({ name: className, avg: avg });
    }
  }

  // 3. RENDER UI
  setTextSafe("total-data-badge", `${data.length} Data Mentah`);

  const maxTableBody = document.getElementById("table-max-body");
  if (maxTableBody) {
    maxTableBody.innerHTML = "";
    if (bestStudent) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
                  <td><strong>${bestStudent.nama}</strong></td>
                  <td>${bestStudent.kelas}</td>
                  <td style="color: var(--primary); font-weight:bold;">${bestStudent.average.toFixed(2)}</td>
              `;
      maxTableBody.appendChild(tr);
    }
  }

  const avgTableBody = document.getElementById("table-avg-body");
  if (avgTableBody) {
    avgTableBody.innerHTML = "";
    bestClassGroups.forEach((cls) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
                  <td><strong>${cls.name}</strong></td>
                  <td style="color: var(--success); font-weight:bold;">${cls.avg.toFixed(2)}</td>
              </tr>
              `;
      avgTableBody.appendChild(tr);
    });
  }
}

// ==========================================
// 2. EXECUTION & VISUALIZATION
// ==========================================
let myChart = null;

function runAlgorithmBenchmark(nValue) {
  const fullN = nValue;
  let safeN = fullN;
  let isLimited = false;

  // Clamp limit
  if (fullN > RECURSIVE_SAFE_LIMIT) {
    safeN = RECURSIVE_SAFE_LIMIT;
    isLimited = true;
    setDisplaySafe("warning-limit", "block");
    setTextSafe("real-count", fullN);
    setDisplaySafe("rec-limit-note", "block");
  } else {
    setDisplaySafe("warning-limit", "none");
    setDisplaySafe("rec-limit-note", "none");
  }

  setTextSafe("n-iter", fullN);
  setTextSafe("n-rec", safeN);
  setTextSafe("disp-n-iter", fullN);
  setTextSafe("disp-n-rec", safeN);
  setTextSafe("note-n-full", fullN);
  setTextSafe("note-n-safe", safeN);

  // --- A. SINGLE RUN CALCULATION ---
  const t1Start = performance.now();
  // NOTE: fibIterative berasal dari file algorithms.js
  const resIter = typeof fibIterative === "function" ? fibIterative(fullN) : "Error: algorithms.js not loaded";
  const t1End = performance.now();

  const t2Start = performance.now();
  // NOTE: fibRecursive berasal dari file algorithms.js
  const resRec = typeof fibRecursive === "function" ? fibRecursive(safeN) : "Error";
  const t2End = performance.now();

  setTextSafe("res-val-iter", resIter.toLocaleString());
  setTextSafe("res-val-rec", resRec.toLocaleString());

  setTextSafe("time-iter", (t1End - t1Start).toFixed(7));
  setTextSafe("time-rec", (t2End - t2Start).toFixed(7));

  // --- B. GENERATE CHART DATA ---
  const labels = [];
  const iterTimes = [];
  const recTimes = [];

  for (let i = 0; i <= safeN; i++) {
    labels.push(i);

    const tStartIter = performance.now();
    if (typeof fibIterative === "function") fibIterative(i);
    const tEndIter = performance.now();
    iterTimes.push(tEndIter - tStartIter);

    const tStartRec = performance.now();
    if (typeof fibRecursive === "function") fibRecursive(i);
    const tEndRec = performance.now();
    recTimes.push(tEndRec - tStartRec);
  }

  renderChart(labels, iterTimes, recTimes);
  if (dashboard) dashboard.classList.remove("hidden");
}

function renderChart(labels, iterData, recData) {
  const ctx = document.getElementById("perfChart").getContext("2d");
  if (myChart) myChart.destroy();

  myChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Iterative Fibonacci O(N)",
          data: iterData,
          borderColor: "#2563eb",
          backgroundColor: "#2563eb",
          borderWidth: 3,
          pointRadius: 2,
          tension: 0.2,
        },
        {
          label: "Recursive Fibonacci O(2^N)",
          data: recData,
          borderColor: "#ef4444",
          backgroundColor: "#ef4444",
          borderWidth: 3,
          pointRadius: 3,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "Waktu Eksekusi (ms)" },
        },
        x: {
          title: { display: true, text: "Nilai N (Input)" },
        },
      },
      plugins: {
        title: {
          display: true,
          text: "Perbandingan Kecepatan: Fibonacci",
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              return context.dataset.label + ": " + context.parsed.y.toFixed(7) + " ms";
            },
          },
        },
      },
    },
  });
}
