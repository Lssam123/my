/*
  Internet speed test (front-end approximation)
  -------------------------------------------
  - All visible text is Arabic for the UI.
  - Logic is written in English and is structured for future backend integration.

  IMPORTANT:
  - For best accuracy, replace the placeholder URLs below with your own backend
    endpoints that are hosted close to your users.
  - Make sure CORS is configured correctly on your server, otherwise the
    requests may fail from the browser.
*/

// === Configuration ===============================================

// Download: file endpoint used for measuring download speed.
// Choose a file of 5–20 MB on your own server for more stable results.
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
const EXPECTED_MAX_DOWNLOAD_MBPS = 300; // 0–300 Mbps
const EXPECTED_MAX_UPLOAD_MBPS = 100; // 0–100 Mbps
const EXPECTED_MAX_PING_MS = 200; // 0–200 ms (lower is better)

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

// === Helpers =====================================================

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
  const arr = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  if (arr.length === 0) return NaN;
  if (arr.length % 2 === 0) {
    return (arr[mid - 1] + arr[mid]) / 2;
  }
  return arr[mid];
}

// Convert a numeric value into a gauge angle (0–270 degrees).
function valueToAngle(value, maxValue, invert = false) {
  if (!isFinite(value) || value <= 0) return 0;
  const ratioRaw = value / maxValue;
  const ratio = clamp(ratioRaw, 0, 1);
  const angle = 270 * ratio;
  if (invert) {
    // For ping, lower is better → invert the scale.
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
  if (!isFinite(value) || value < 0) {
    el.textContent = "--";
  } else {
    el.textContent = value.toFixed(fractionDigits);
  }
}

// === Measurement functions =======================================

// Ping: multiple small requests and median of timings (ms).
async function measurePing(samples = PING_SAMPLES) {
  const timings = [];

  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    try {
      await fetch(`${PING_URL}?t=${Date.now()}-${i}`, {
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
    throw new Error("لم تنجح أي محاولة لقياس البينج.");
  }

  return median(timings); // ms
}

// Download: stream the response and measure time + bytes.
async function measureDownload(samples = DOWNLOAD_SAMPLES) {
  const results = [];

  for (let i = 0; i < samples; i += 1) {
    const testUrl = `${DOWNLOAD_URL}?t=${Date.now()}-${i}`;
    const startTime = performance.now();
    const response = await fetch(testUrl, {
      cache: "no-store",
      mode: "cors",
    });

    if (!response.ok || !response.body) {
      throw new Error("فشل اختبار التحميل (الاستجابة غير ناجحة).");
    }

    const reader = response.body.getReader();
    let bytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }

    const endTime = performance.now();
    const seconds = (endTime - startTime) / 1000;
    if (seconds === 0) continue;

    const bits = bytes * 8;
    const mbps = bits / seconds / 1_000_000; // bits → megabits
    results.push(mbps);
  }

  if (!results.length) {
    throw new Error("فشل اختبار التحميل.");
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
    const response = await fetch(`${UPLOAD_URL}?t=${Date.now()}-${i}`, {
      method: "POST",
      mode: "cors",
      body: payload,
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });
    const endTime = performance.now();

    if (!response.ok) {
      throw new Error("فشل اختبار الرفع (الاستجابة غير ناجحة).");
    }

    const seconds = (endTime - startTime) / 1000;
    if (seconds === 0) continue;

    const bits = UPLOAD_SIZE_BYTES * 8;
    const mbps = bits / seconds / 1_000_000;
    results.push(mbps);
  }

  if (!results.length) {
    throw new Error("فشل اختبار الرفع.");
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

  try {
    // 1) Ping
    activateCard(pingCard);
    const pingMs = await measurePing();
    setMetricNumber(pingValueEl, pingMs, 0);
    const pingAngle = valueToAngle(pingMs, EXPECTED_MAX_PING_MS, true);
    setGaugeValue(gaugePing, pingAngle);

    // 2) Download
    activateCard(downloadCard);
    const downloadMbps = await measureDownload();
    setMetricNumber(downloadValueEl, downloadMbps, 1);
    const downloadAngle = valueToAngle(downloadMbps, EXPECTED_MAX_DOWNLOAD_MBPS, false);
    setGaugeValue(gaugeDownload, downloadAngle);

    // 3) Upload
    activateCard(uploadCard);
    const uploadMbps = await measureUpload();
    setMetricNumber(uploadValueEl, uploadMbps, 1);
    const uploadAngle = valueToAngle(uploadMbps, EXPECTED_MAX_UPLOAD_MBPS, false);
    setGaugeValue(gaugeUpload, uploadAngle);

    setStatus("success", "تم إكمال اختبار السرعة بنجاح ✅");
  } catch (error) {
    console.error("Speed test failed", error);
    setStatus(
      "error",
      "تعذّر إكمال الاختبار. تحقق من اتصال الإنترنت أو عناوين نقاط الاختبار ثم أعد المحاولة."
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
