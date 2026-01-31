// Simple front-end internet speed test (approximate only)
// For maximum accuracy, replace the URLs below with endpoints on your own server
// and make sure CORS is enabled.

// ====== CONFIGURATION ======
const DOWNLOAD_URL = "https://speed.hetzner.de/10MB.bin"; // Public test file (may change / be rate-limited)
const UPLOAD_URL = "https://httpbin.org/post"; // Echo endpoint for upload test
const PING_URL = "https://httpbin.org/get"; // Lightweight endpoint for ping

const PING_SAMPLES = 7;
const DOWNLOAD_SAMPLES = 4;
const UPLOAD_SAMPLES = 4;

const REQUEST_TIMEOUT_MS = 7000; // Per request

// Size of upload payload in bytes (roughly 2 MB)
const UPLOAD_SIZE_BYTES = 2 * 1024 * 1024;

// ====== DOM ELEMENTS ======
const startBtn = document.getElementById("startTestBtn");
const statusText = document.getElementById("statusText");

const downloadValueEl = document.getElementById("downloadValue");
const uploadValueEl = document.getElementById("uploadValue");
const pingValueEl = document.getElementById("pingValue");

const downloadQualityEl = document.getElementById("downloadQuality");
const uploadQualityEl = document.getElementById("uploadQuality");
const pingQualityEl = document.getElementById("pingQuality");

// Retrieve all gauges
const downloadGauge = document.querySelector('.gauge[data-metric="download"] .gauge-progress');
const uploadGauge = document.querySelector('.gauge[data-metric="upload"] .gauge-progress');
const pingGauge = document.querySelector('.gauge[data-metric="ping"] .gauge-progress');

// Max visualization values (UI only)
const MAX_DOWNLOAD_MBPS = 500; // clamp for gauge
const MAX_UPLOAD_MBPS = 100; // clamp for gauge
const MAX_PING_MS = 200; // higher is worse

// ====== HELPERS ======
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function timeoutPromise(ms) {
  return new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error("timeout"));
    }, ms);
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return Promise.race([
    fetch(url, options),
    timeoutPromise(timeoutMs)
  ]);
}

function setGaugeValue(gaugeCircle, valueNormalized) {
  if (!gaugeCircle) return;
  const maxDash = 314; // matches CSS
  const clamped = Math.max(0, Math.min(1, valueNormalized));
  const offset = maxDash - maxDash * clamped;
  gaugeCircle.style.strokeDashoffset = offset.toString();
}

function qualityLabelForSpeed(mbps) {
  if (mbps === null || Number.isNaN(mbps)) return "غير متوفر";
  if (mbps >= 200) return "ممتاز جداً";
  if (mbps >= 100) return "ممتاز";
  if (mbps >= 50) return "جيد";
  if (mbps >= 20) return "متوسط";
  return "ضعيف";
}

function qualityLabelForPing(ms) {
  if (ms === null || Number.isNaN(ms)) return "غير متوفر";
  if (ms <= 20) return "ممتاز جداً";
  if (ms <= 40) return "ممتاز";
  if (ms <= 70) return "جيد";
  if (ms <= 120) return "متوسط";
  return "ضعيف";
}

function resetUI() {
  downloadValueEl.textContent = "0.0";
  uploadValueEl.textContent = "0.0";
  pingValueEl.textContent = "0";

  downloadQualityEl.textContent = "لم يبدأ بعد";
  uploadQualityEl.textContent = "لم يبدأ بعد";
  pingQualityEl.textContent = "لم يبدأ بعد";

  setGaugeValue(downloadGauge, 0);
  setGaugeValue(uploadGauge, 0);
  setGaugeValue(pingGauge, 0);
}

// ====== MEASUREMENT FUNCTIONS ======
async function measurePing() {
  const samples = [];

  for (let i = 0; i < PING_SAMPLES; i++) {
    const start = performance.now();
    try {
      await fetchWithTimeout(PING_URL + "?t=" + Date.now(), {
        method: "GET",
        cache: "no-store"
      });
      const end = performance.now();
      samples.push(end - start);
    } catch (err) {
      // ignore failed sample
    }
  }

  return median(samples);
}

async function measureDownload() {
  const samples = [];

  for (let i = 0; i < DOWNLOAD_SAMPLES; i++) {
    const start = performance.now();
    try {
      const response = await fetchWithTimeout(DOWNLOAD_URL + "?cachebust=" + Date.now(), {
        method: "GET",
        cache: "no-store"
      });

      const clone = response.clone();
      let bytes = 0;

      // Try content-length header first
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        bytes = parseInt(contentLength, 10) || 0;
        await clone.arrayBuffer(); // consume
      } else {
        const buffer = await clone.arrayBuffer();
        bytes = buffer.byteLength;
      }

      const end = performance.now();
      const durationSeconds = (end - start) / 1000;
      if (durationSeconds > 0 && bytes > 0) {
        const bits = bytes * 8;
        const mbps = (bits / durationSeconds) / (1024 * 1024);
        samples.push(mbps);
      }
    } catch (err) {
      // ignore failed sample
    }
  }

  return median(samples);
}

async function measureUpload() {
  const samples = [];

  // Prepare payload once
  const payload = new Uint8Array(UPLOAD_SIZE_BYTES);
  // Fill with random data (optional, can stay zeros)
  crypto.getRandomValues(payload);

  const blob = new Blob([payload.buffer], { type: "application/octet-stream" });

  for (let i = 0; i < UPLOAD_SAMPLES; i++) {
    const start = performance.now();
    try {
      await fetchWithTimeout(UPLOAD_URL + "?cachebust=" + Date.now(), {
        method: "POST",
        body: blob,
        cache: "no-store"
      });
      const end = performance.now();
      const durationSeconds = (end - start) / 1000;
      if (durationSeconds > 0) {
        const bits = UPLOAD_SIZE_BYTES * 8;
        const mbps = (bits / durationSeconds) / (1024 * 1024);
        samples.push(mbps);
      }
    } catch (err) {
      // ignore failed sample
    }
  }

  return median(samples);
}

// ====== MAIN FLOW ======
async function runSpeedTest() {
  resetUI();

  startBtn.disabled = true;
  statusText.textContent = "جاري قياس البِنغ (زمن الاستجابة)...";

  try {
    // PING
    const pingMs = await measurePing();
    if (pingMs !== null) {
      const pingRounded = Math.round(pingMs);
      pingValueEl.textContent = pingRounded.toString();
      pingQualityEl.textContent = qualityLabelForPing(pingRounded);

      const normPing = 1 - Math.min(pingRounded / MAX_PING_MS, 1); // lower is better
      setGaugeValue(pingGauge, normPing);
    } else {
      pingValueEl.textContent = "-";
      pingQualityEl.textContent = "تعذّر القياس";
      setGaugeValue(pingGauge, 0);
    }

    statusText.textContent = "جاري قياس سرعة التحميل...";

    // DOWNLOAD
    const downloadMbps = await measureDownload();
    if (downloadMbps !== null) {
      const dlRounded = Number(downloadMbps.toFixed(1));
      downloadValueEl.textContent = dlRounded.toString();
      downloadQualityEl.textContent = qualityLabelForSpeed(dlRounded);

      const normDl = Math.min(dlRounded / MAX_DOWNLOAD_MBPS, 1);
      setGaugeValue(downloadGauge, normDl);
    } else {
      downloadValueEl.textContent = "-";
      downloadQualityEl.textContent = "تعذّر القياس";
      setGaugeValue(downloadGauge, 0);
    }

    statusText.textContent = "جاري قياس سرعة الرفع...";

    // UPLOAD
    const uploadMbps = await measureUpload();
    if (uploadMbps !== null) {
      const upRounded = Number(uploadMbps.toFixed(1));
      uploadValueEl.textContent = upRounded.toString();
      uploadQualityEl.textContent = qualityLabelForSpeed(upRounded);

      const normUp = Math.min(upRounded / MAX_UPLOAD_MBPS, 1);
      setGaugeValue(uploadGauge, normUp);
    } else {
      uploadValueEl.textContent = "-";
      uploadQualityEl.textContent = "تعذّر القياس";
      setGaugeValue(uploadGauge, 0);
    }

    statusText.textContent = "اكتمل الاختبار. تذكّر أن الدقة الأعلى تحتاج سيرفر خاص بك وروابط مهيّأة.";
  } catch (err) {
    console.error(err);
    statusText.textContent =
      "حدث خطأ أثناء الفحص. قد يكون بسبب الاتصال أو إعدادات السيرفر (CORS). جرّب مرة أخرى أو استخدم سيرفرك الخاص.";
  } finally {
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", () => {
  runSpeedTest();
});
