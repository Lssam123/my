/*
  Internet speed test (front-end approximation)
  -------------------------------------------
  - All visible text is Arabic for the UI.
  - Logic is written in English and is structured for future backend integration.

  IMPORTANT (ffffffffffffffff
9a
95
8
7
96 
8
3
91
86
94 
8
f
92
8
9 
98
8
a
92
94
9a
94 
8
7
94
8
3
8
e
87
8
7
8
1):
  - 
94
8
3
91
86
94 
8
f
92
8
9 
98
8
3
92
94 
8
3
8
e
87
8
7
8
1
8
3
8
e
81 
8
7
94
81
98
8
7
8
8
87 
8
5
94
99 
8
5
94
8
7 
8
5
8
8
9d 
8
3
96
8
a
    (Download / Upload / Ping) 
8
8
8
d
9a
8
b 
9a
93
98
96 
92
81
9a
8
8 
95
96 
8
7
94
95
83
8
a
8
e
8
f
95
9a
96 
98
9a
8
f
89
95 CORS.
  - 
91
9a 
8
d
8
7
94 
94
95 
9a
8
f
89
95 
8
7
94
83
9a
81
91
81 
87
94
8
8
8
7
8
a 
8
7
94
95
8
a
85
91
8
d (CORS)
87
83
9a
88
97 
94
93 
8
e
87
8
3 
91
9a 
8
7
94
92
9a
8
7
83
    
98
80
8
7 
87
8
8
9a
89
8
7
8
1 
8
7
94
83
9a
81
91
817
8
a 
8
7
94
83
9a
81
91
81
8
7
8
a 
8
7
94
8
8
8
7
8
6
9a
8
9.
    
98
9a
83 
8
8
83
8
8
8
8 
8
7
94
93
98
8
f 
96
91
83
97.
*/

// === Configuration ===============================================

// Download: file endpoint used for measuring download speed.
// Choose a file of 510 MB on your own server for more stable results.
const DOWNLOAD_URL = "https://speed.hetzner.de/10MB.bin"; // TODO: replace with your own endpoint

// Upload: API endpoint that accepts POST requests with binary payload.
const UPLOAD_URL = "https://httpbin.org/post"; // TODO: replace with your own endpoint

// Ping: lightweight endpoint used just to measure round-trip latency.
const PING_URL = "https://www.google.com/generate_204"; // TODO: replace with your own endpoint

// Number of samples for each metric to stabilize results.
const PING_SAMPLES = 6;
const DOWNLOAD_SAMPLES = 3;
const UPLOAD_SAMPLES = 3;

// Size of generated payload for upload test (in bytes).
const UPLOAD_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

// Expected ranges for the gauges (adjust to your needs).
const EXPECTED_MAX_DOWNLOAD_MBPS = 300; // 0300 Mbps
const EXPECTED_MAX_UPLOAD_MBPS = 100; // 0100 Mbps
const EXPECTED_MAX_PING_MS = 200; // 0200 ms (lower is better)

// Safety timeout for any single network request (in milliseconds).
// If a request takes longer than this, it will be aborted.
const REQUEST_TIMEOUT_MS = 15000; // 15 seconds

// === DOM elements ===============================================

const startButton = document.getElementById("startTestBtn");
const statusText = document.getElementById("statusText");

const downloadValueEl = document.getElementById("downloadValue");
const uploadValueEl = document.getElementById("uploadValue");
const pingValueEl = document.getElementById("pingValue");

const downloadCard = document.getElementById("downloadCard");
const uploadCard = document.getElementById("uploadCard");
const pingCard = document.getElementById("pingCard");

const gaugeDownload = document.querySelector('.meter-gauge[data-metric="download"]');
const gaugeUpload = document.querySelector('.meter-gauge[data-metric="upload"]');
const gaugePing = document.querySelector('.meter-gauge[data-metric="ping"]');

let isRunning = false;

// === Helper functions ============================================

function setStatus(state, text) {
  statusText.classList.remove("status--idle", "status--running", "status--success", "status--error");
  statusText.classList.add(`status--${state}`);
  statusText.textContent = text;
}

function resetUI() {
  downloadValueEl.textContent = "--";
  uploadValueEl.textContent = "--";
  pingValueEl.textContent = "--";

  setGaugeValue(gaugeDownload, 0);
  setGaugeValue(gaugeUpload, 0);
  setGaugeValue(gaugePing, 0);

  [downloadCard, uploadCard, pingCard].forEach((card) => {
    if (card) card.classList.remove("is-active");
  });
}

function activateCard(card) {
  [downloadCard, uploadCard, pingCard].forEach((c) => {
    if (!c) return;
    c.classList.toggle("is-active", c === card);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function median(values) {
  if (!values || !values.length) return NaN;
  const arr = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2 === 0) {
    return (arr[mid - 1] + arr[mid]) / 2;
  }
  return arr[mid];
}

// Convert a numeric value into a gauge angle (0270 degrees).
function valueToAngle(value, maxValue, invert = false) {
  if (!isFinite(value) || value <= 0 || !isFinite(maxValue) || maxValue <= 0) {
    return 0;
  }
  const ratioRaw = value / maxValue;
  const ratio = clamp(ratioRaw, 0, 1);
  const angle = 270 * ratio;
  if (invert) {
    // For ping, lower is better 13 invert the scale.
    return 270 - angle;
  }
  return angle;
}

function setGaugeValue(gaugeEl, angleDeg) {
  if (!gaugeEl) return;
  const safeAngle = clamp(angleDeg, 0, 270);
  gaugeEl.style.setProperty("--gauge-fill", `${safeAngle}deg`);
}

function setMetricNumber(el, value, fractionDigits) {
  if (!el) return;
  if (!isFinite(value) || value < 0) {
    el.textContent = "--";
  } else {
    el.textContent = value.toFixed(fractionDigits);
  }
}

// Wrap a fetch-like operation in a timeout using AbortController.
async function fetchWithTimeout(resource, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => {
    controller.abort("timeout");
  }, timeoutMs);

  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// Helper to safely measure a metric without breaking the whole test.
async function safeMeasure(measureFn, labelForLog) {
  try {
    const value = await measureFn();
    if (!isFinite(value) || value < 0) {
      console.warn(`${labelForLog} returned invalid value`, value);
      return null;
    }
    return value;
  } catch (error) {
    console.error(`${labelForLog} failed`, error);
    return null;
  }
}

// === Measurement functions =======================================

// Ping: multiple small requests and median of timings (ms).
async function measurePing(samples = PING_SAMPLES) {
  const timings = [];

  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    try {
      await fetchWithTimeout(`${PING_URL}?t=${Date.now()}-${i}`, {
        cache: "no-store",
        mode: "cors",
      });
      const end = performance.now();
      timings.push(end - start);
    } catch (error) {
      console.error("Ping attempt failed", error);
    }
  }

  if (!timings.length) {
    throw new Error("لم تنجح أي محاولة لقياس البينج (غالباً بسبب حظر من السيرفر أو CORS).");
  }

  return median(timings); // ms
}

// Download: stream the response and measure time + bytes.
async function measureDownload(samples = DOWNLOAD_SAMPLES) {
  const results = [];

  for (let i = 0; i < samples; i += 1) {
    const testUrl = `${DOWNLOAD_URL}?t=${Date.now()}-${i}`;
    const startTime = performance.now();

    let response;
    try {
      response = await fetchWithTimeout(testUrl, {
        cache: "no-store",
        mode: "cors",
      });
    } catch (error) {
      console.error("Download request failed", error);
      continue;
    }

    if (!response.ok || !response.body) {
      console.error("Download response not OK or body missing");
      continue;
    }

    const reader = response.body.getReader();
    let bytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) bytes += value.byteLength;
      }
    } catch (error) {
      console.error("Reading download stream failed", error);
      continue;
    }

    const endTime = performance.now();
    const seconds = (endTime - startTime) / 1000;
    if (seconds <= 0 || !isFinite(seconds)) continue;

    const bits = bytes * 8;
    const mbps = bits / seconds / 1_000_000; // bits → megabits
    if (isFinite(mbps) && mbps > 0) {
      results.push(mbps);
    }
  }

  if (!results.length) {
    throw new Error("فشل اختبار التحميل (ربما بسبب CORS أو مشكلة في ملف الاختبار).");
  }

  return median(results);
}

// Upload: send a generated binary payload and measure the duration.
async function measureUpload(samples = UPLOAD_SAMPLES) {
  const results = [];

  // Prepare payload once and reuse it for all samples.
  const payload = new Uint8Array(UPLOAD_SIZE_BYTES);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(payload);
  } else {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = Math.floor(Math.random() * 256);
    }
  }

  for (let i = 0; i < samples; i += 1) {
    const startTime = performance.now();

    let response;
    try {
      response = await fetchWithTimeout(`${UPLOAD_URL}?t=${Date.now()}-${i}`, {
        method: "POST",
        mode: "cors",
        body: payload,
        headers: {
          "Content-Type": "application/octet-stream",
        },
      });
    } catch (error) {
      console.error("Upload request failed", error);
      continue;
    }

    if (!response.ok) {
      console.error("Upload response not OK");
      continue;
    }

    const endTime = performance.now();
    const seconds = (endTime - startTime) / 1000;
    if (seconds <= 0 || !isFinite(seconds)) continue;

    const bits = UPLOAD_SIZE_BYTES * 8;
    const mbps = bits / seconds / 1_000_000;
    if (isFinite(mbps) && mbps > 0) {
      results.push(mbps);
    }
  }

  if (!results.length) {
    throw new Error("فشل اختبار الرفع (تأكد من أن نقطة الرفع تدعم CORS وتستقبل POST).");
  }

  return median(results);
}

// === Main flow ===================================================

async function runSpeedTest() {
  if (isRunning) return;
  isRunning = true;
  startButton.disabled = true;

  resetUI();
  setStatus("running", "جاري تنفيذ اختبار السرعة، يرجى الانتظار...");

  let pingMs = null;
  let downloadMbps = null;
  let uploadMbps = null;

  try {
    // 1) Ping
    activateCard(pingCard);
    pingMs = await safeMeasure(() => measurePing(), "Ping measurement");
    if (pingMs !== null) {
      setMetricNumber(pingValueEl, pingMs, 0);
      const pingAngle = valueToAngle(pingMs, EXPECTED_MAX_PING_MS, true);
      setGaugeValue(gaugePing, pingAngle);
    }

    // 2) Download
    activateCard(downloadCard);
    downloadMbps = await safeMeasure(() => measureDownload(), "Download measurement");
    if (downloadMbps !== null) {
      setMetricNumber(downloadValueEl, downloadMbps, 1);
      const downloadAngle = valueToAngle(downloadMbps, EXPECTED_MAX_DOWNLOAD_MBPS, false);
      setGaugeValue(gaugeDownload, downloadAngle);
    }

    // 3) Upload
    activateCard(uploadCard);
    uploadMbps = await safeMeasure(() => measureUpload(), "Upload measurement");
    if (uploadMbps !== null) {
      setMetricNumber(uploadValueEl, uploadMbps, 1);
      const uploadAngle = valueToAngle(uploadMbps, EXPECTED_MAX_UPLOAD_MBPS, false);
      setGaugeValue(gaugeUpload, uploadAngle);
    }

    const successfulCount = [pingMs, downloadMbps, uploadMbps].filter(
      (v) => v !== null && isFinite(v) && v >= 0
    ).length;

    if (successfulCount === 3) {
      setStatus("success", "تم إكمال اختبار السرعة بنجاح ✅");
    } else if (successfulCount > 0) {
      setStatus(
        "success",
        "تم تنفيذ جزء من الاختبار. بعض القياسات لم تنجح بالكامل (غالباً بسبب إعدادات السيرفر أو CORS)."
      );
    } else {
      setStatus(
        "error",
        "تعذّر إكمال أي قياس. تحقق من اتصال الإنترنت وإعدادات السيرفر أو غيّر روابط نقاط الاختبار ثم أعد المحاولة."
      );
    }
  } catch (error) {
    console.error("Unexpected error in speed test", error);
    setStatus(
      "error",
      "حدث خطأ غير متوقع أثناء الاختبار. حاول إعادة تحميل الصفحة أو التحقق من الإعدادات."
    );
  } finally {
    isRunning = false;
    startButton.disabled = false;
    activateCard(null);
  }
}

// === Event listeners =============================================

startButton.addEventListener("click", runSpeedTest);

// Optional: run automatically on page load (disable if you prefer manual only).
// window.addEventListener("load", () => {
//   runSpeedTest();
// });
