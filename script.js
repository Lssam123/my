// =========================
// Configuration constants
// =========================

// Public test servers (arrays) – the code will rotate between them and skip failures.
// For highest accuracy, later replace these with servers you fully control (with CORS enabled).
const PING_SERVERS = [
  "https://httpbin.org/get", // Lightweight JSON endpoint
  "https://1.1.1.1/cdn-cgi/trace", // Cloudflare trace (may be blocked in some regions)
  "https://www.google.com/generate_204" // Very small 204 response
];

const DOWNLOAD_SERVERS = [
  "https://speed.hetzner.de/10MB.bin", // Hetzner public speed file
  "https://proof.ovh.net/files/10Mb.dat", // OVH public speed file
  "https://speed.cloudflare.com/__down?bytes=10000000" // Cloudflare test download
];

const UPLOAD_SERVERS = [
  "https://httpbin.org/post", // Generic POST echo
  "https://postman-echo.com/post" // Another public POST endpoint
];

// Durations for each phase (milliseconds)
const PING_TEST_DURATION_MS = 5_000; // 5 seconds for ping
const DOWNLOAD_TEST_DURATION_MS = 25_000; // 25 seconds for download
const UPLOAD_TEST_DURATION_MS = 15_000; // 15 seconds for upload

// Request timeouts per sample
const PING_REQUEST_TIMEOUT_MS = 2_000;
const DOWNLOAD_REQUEST_TIMEOUT_MS = 10_000;
const UPLOAD_REQUEST_TIMEOUT_MS = 10_000;

// Parallel paths (multi3) per round
const PARALLEL_DOWNLOAD_STREAMS = 4;
const PARALLEL_UPLOAD_STREAMS = 3;

// Upload payload size per sample (bytes)
const UPLOAD_PAYLOAD_BYTES = 512 * 1024; // ~512 KB

// Round3obin indices so we rotate over the server lists
let pingServerIndex = 0;
let downloadServerIndex = 0;
let uploadServerIndex = 0;

function pickNextServer(servers, indexRef) {
  if (!servers.length) return null;
  const idx = indexRef.value % servers.length;
  const url = servers[idx];
  indexRef.value = (idx + 1) % servers.length;
  return url;
}

// =========================
// DOM references
// =========================

const startBtn = document.getElementById("startTestBtn");
const statusText = document.getElementById("statusText");
const phaseText = document.getElementById("phaseText");

const downloadValueEl = document.getElementById("downloadValue");
const uploadValueEl = document.getElementById("uploadValue");
const pingValueEl = document.getElementById("pingValue");

const downloadQualityEl = document.getElementById("downloadQuality");
const uploadQualityEl = document.getElementById("uploadQuality");
const pingQualityEl = document.getElementById("pingQuality");

let isTesting = false;

// =========================
// Helpers
// =========================

function setStatus(mode, message) {
  statusText.textContent = message;
  statusText.className = "status";

  switch (mode) {
    case "info":
      statusText.classList.add("status--info");
      break;
    case "success":
      statusText.classList.add("status--success");
      break;
    case "warning":
      statusText.classList.add("status--warning");
      break;
    case "error":
      statusText.classList.add("status--error");
      break;
    default:
      statusText.classList.add("status--idle");
  }
}

function setPhase(message) {
  phaseText.textContent = message;
}

function resetUI() {
  downloadValueEl.textContent = "--";
  uploadValueEl.textContent = "--";
  pingValueEl.textContent = "--";

  downloadQualityEl.textContent = "لم يبدأ بعد";
  uploadQualityEl.textContent = "لم يبدأ بعد";
  pingQualityEl.textContent = "لم يبدأ بعد";

  downloadQualityEl.className = "metric-quality";
  uploadQualityEl.className = "metric-quality";
  pingQualityEl.className = "metric-quality";

  setStatus(
    "idle",
    "جاهز لبدء الاختبار. تأكد من اتصالك بالإنترنت ثم اضغط زر \"ابدأ الاختبار الآن\"."
  );
  setPhase("لم يبدأ الاختبار بعد.");
}

function median(values) {
  const arr = values
    .slice()
    .filter((v) => typeof v === "number" && isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (!arr.length) return null;

  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

function createAbortControllerWithTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
  return { controller, timeoutId };
}

function setQualityLabel(el, text, className) {
  el.textContent = text;
  el.className = "metric-quality";
  if (className) {
    el.classList.add(className);
  }
}

// =========================
// Quality labels
// =========================

function updateDownloadQualityLabel(mbps) {
  if (!isFinite(mbps) || mbps <= 0) {
    setQualityLabel(downloadQualityEl, "لم يتم القياس", "metric-quality--not-measured");
    return;
  }

  if (mbps >= 200) {
    setQualityLabel(
      downloadQualityEl,
      "ممتاز جداً لتحميل كل شيء تقريباً",
      "metric-quality--excellent"
    );
  } else if (mbps >= 100) {
    setQualityLabel(
      downloadQualityEl,
      "ممتاز للفيديو بدقة عالية والألعاب",
      "metric-quality--very-good"
    );
  } else if (mbps >= 40) {
    setQualityLabel(downloadQualityEl, "جيد لمعظم الاستخدام اليومي", "metric-quality--good");
  } else if (mbps >= 15) {
    setQualityLabel(downloadQualityEl, "متوسط وقد تلاحظ بطء أحياناً", "metric-quality--fair");
  } else {
    setQualityLabel(
      downloadQualityEl,
      "ضعيف وقد يكون مزعجاً في الفيديو والألعاب",
      "metric-quality--weak"
    );
  }
}

function updateUploadQualityLabel(mbps) {
  if (!isFinite(mbps) || mbps <= 0) {
    setQualityLabel(uploadQualityEl, "لم يتم القياس", "metric-quality--not-measured");
    return;
  }

  if (mbps >= 50) {
    setQualityLabel(
      uploadQualityEl,
      "ممتاز للبث المباشر ورفع الملفات الكبيرة",
      "metric-quality--excellent"
    );
  } else if (mbps >= 20) {
    setQualityLabel(uploadQualityEl, "جيد جداً لرفع الملفات", "metric-quality--very-good");
  } else if (mbps >= 10) {
    setQualityLabel(uploadQualityEl, "جيد لمعظم الاستخدامات", "metric-quality--good");
  } else if (mbps >= 5) {
    setQualityLabel(uploadQualityEl, "متوسط وقد تلاحظ بطء في الرفع", "metric-quality--fair");
  } else {
    setQualityLabel(uploadQualityEl, "ضعيف للرفع والبث", "metric-quality--weak");
  }
}

function updatePingQualityLabel(ms) {
  if (!isFinite(ms) || ms <= 0) {
    setQualityLabel(pingQualityEl, "لم يتم القياس", "metric-quality--not-measured");
    return;
  }

  // Clear description of loaded / unloaded ping
  if (ms <= 30) {
    setQualityLabel(pingQualityEl, "البنق غير مثقل (ممتاز جداً)", "metric-quality--excellent");
  } else if (ms <= 60) {
    setQualityLabel(pingQualityEl, "البنق غير مثقل (ممتاز)", "metric-quality--very-good");
  } else if (ms <= 90) {
    setQualityLabel(
      pingQualityEl,
      "البنق مقبول ويميل لأن يكون غير مثقل",
      "metric-quality--good"
    );
  } else if (ms <= 130) {
    setQualityLabel(pingQualityEl, "البنق مثقل بشكل متوسط", "metric-quality--fair");
  } else {
    setQualityLabel(pingQualityEl, "البنق مثقل (ضعيف)", "metric-quality--weak");
  }
}

// =========================
// Network measurement helpers
// =========================

async function singlePingSample() {
  const indexRef = { value: pingServerIndex };
  const url = pickNextServer(PING_SERVERS, indexRef);
  pingServerIndex = indexRef.value;

  if (!url) return null;

  const { controller, timeoutId } = createAbortControllerWithTimeout(PING_REQUEST_TIMEOUT_MS);
  const start = performance.now();

  try {
    const res = await fetch(url + `?t=${Date.now()}` , {
      cache: "no-store",
      mode: "cors",
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Ping HTTP ${res.status}`);

    const end = performance.now();
    return end - start;
  } catch (error) {
    console.warn("Ping sample failed", error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runPingPhase() {
  const samples = [];
  const endAt = performance.now() + PING_TEST_DURATION_MS;

  while (performance.now() < endAt) {
    const sample = await singlePingSample();
    if (typeof sample === "number" && isFinite(sample) && sample > 0) {
      samples.push(sample);
    }
  }

  const medianMs = median(samples);
  if (medianMs == null) return null;

  const rounded = Math.round(medianMs);
  pingValueEl.textContent = `${rounded}`;
  updatePingQualityLabel(rounded);

  return rounded;
}

async function singleDownloadSample(controller) {
  const indexRef = { value: downloadServerIndex };
  const baseUrl = pickNextServer(DOWNLOAD_SERVERS, indexRef);
  downloadServerIndex = indexRef.value;

  if (!baseUrl) return null;

  const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + `r=${Math.random()}`;
  const start = performance.now();

  try {
    const res = await fetch(url, {
      cache: "no-store",
      mode: "cors",
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Download HTTP ${res.status}`);

    const reader = res.body?.getReader();
    let receivedBytes = 0;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.length || value.byteLength || 0;
        }
      }
    } else {
      const buffer = await res.arrayBuffer();
      receivedBytes = buffer.byteLength;
    }

    const end = performance.now();
    const seconds = (end - start) / 1000;
    if (seconds <= 0 || !isFinite(seconds) || receivedBytes <= 0) return null;

    const mbps = (receivedBytes * 8) / (seconds * 1_000_000); // bits  Mbps
    return mbps;
  } catch (error) {
    console.warn("Download sample failed", error);
    return null;
  }
}

async function runParallelDownloadRound() {
  const { controller, timeoutId } = createAbortControllerWithTimeout(
    DOWNLOAD_REQUEST_TIMEOUT_MS
  );

  try {
    const promises = [];
    for (let i = 0; i < PARALLEL_DOWNLOAD_STREAMS; i += 1) {
      promises.push(singleDownloadSample(controller));
    }

    const settled = await Promise.allSettled(promises);
    const mbpsSamples = [];

    for (const result of settled) {
      if (result.status === "fulfilled" && typeof result.value === "number") {
        mbpsSamples.push(result.value);
      }
    }

    return mbpsSamples;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runDownloadPhase() {
  const mbpsAll = [];
  const endAt = performance.now() + DOWNLOAD_TEST_DURATION_MS;

  while (performance.now() < endAt) {
    const roundSamples = await runParallelDownloadRound();
    mbpsAll.push(...roundSamples);

    if (mbpsAll.length > 100) break; // simple guard
  }

  const medianMbps = median(mbpsAll);
  if (medianMbps == null) return null;

  const rounded = Number(medianMbps.toFixed(1));
  downloadValueEl.textContent = `${rounded}`;
  updateDownloadQualityLabel(rounded);

  return rounded;
}

// Prebuilt upload payload reused across samples
const uploadPayload = (() => {
  const bytes = new Uint8Array(UPLOAD_PAYLOAD_BYTES);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
})();

async function singleUploadSample(controller) {
  const indexRef = { value: uploadServerIndex };
  const baseUrl = pickNextServer(UPLOAD_SERVERS, indexRef);
  uploadServerIndex = indexRef.value;

  if (!baseUrl) return null;

  const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + `r=${Math.random()}`;
  const start = performance.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      body: uploadPayload,
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Upload HTTP ${res.status}`);

    const end = performance.now();
    const seconds = (end - start) / 1000;
    if (seconds <= 0 || !isFinite(seconds)) return null;

    const mbps = (UPLOAD_PAYLOAD_BYTES * 8) / (seconds * 1_000_000); // bits  Mbps
    return mbps;
  } catch (error) {
    console.warn("Upload sample failed", error);
    return null;
  }
}

async function runParallelUploadRound() {
  const { controller, timeoutId } = createAbortControllerWithTimeout(UPLOAD_REQUEST_TIMEOUT_MS);

  try {
    const promises = [];
    for (let i = 0; i < PARALLEL_UPLOAD_STREAMS; i += 1) {
      promises.push(singleUploadSample(controller));
    }

    const settled = await Promise.allSettled(promises);
    const mbpsSamples = [];

    for (const result of settled) {
      if (result.status === "fulfilled" && typeof result.value === "number") {
        mbpsSamples.push(result.value);
      }
    }

    return mbpsSamples;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runUploadPhase() {
  const mbpsAll = [];
  const endAt = performance.now() + UPLOAD_TEST_DURATION_MS;

  while (performance.now() < endAt) {
    const roundSamples = await runParallelUploadRound();
    mbpsAll.push(...roundSamples);

    if (mbpsAll.length > 80) break; // simple guard
  }

  const medianMbps = median(mbpsAll);
  if (medianMbps == null) return null;

  const rounded = Number(medianMbps.toFixed(1));
  uploadValueEl.textContent = `${rounded}`;
  updateUploadQualityLabel(rounded);

  return rounded;
}

// =========================
// Orchestrator  Ping 13 Download 13 Upload
// =========================

async function runFullTestSequential() {
  if (isTesting) return;

  isTesting = true;
  startBtn.disabled = true;

  resetUI();
  setStatus(
    "info",
    "بدأ الاختبار. سيتم قياس البِنغ أولاً ثم التحميل ثم الرفع باستخدام عدة مسارات وسيرفرات عامة."
  );

  let pingMs = null;
  let downloadMbps = null;
  let uploadMbps = null;

  try {
    // 1) Ping first (155s)
    setPhase("جاري قياس زمن الاستجابة (البِنغ) لمدة تقريبية ٥ ثوانٍ من عدة سيرفرات...");
    pingMs = await runPingPhase();
  } catch (error) {
    console.warn("Ping phase failed", error);
  }

  try {
    // 2) Download (1525s)
    setPhase("جاري قياس سرعة التحميل لمدة تقريبية ٢٥ ثانية عبر عدة مسارات وسيرفرات...");
    downloadMbps = await runDownloadPhase();
  } catch (error) {
    console.warn("Download phase failed", error);
  }

  try {
    // 3) Upload (1515s)
    setPhase("جاري قياس سرعة الرفع لمدة تقريبية ١٥ ثانية عبر عدة مسارات وسيرفرات...");
    uploadMbps = await runUploadPhase();
  } catch (error) {
    console.warn("Upload phase failed", error);
  }

  const successfulCount = [pingMs, downloadMbps, uploadMbps].filter(
    (v) => typeof v === "number" && isFinite(v) && v > 0
  ).length;

  if (successfulCount === 3) {
    setStatus("success", "تم إكمال اختبار السرعة بنجاح ✅");
    setPhase("اكتملت جميع المراحل. يمكنك إعادة الاختبار في أي وقت.");
  } else if (successfulCount > 0) {
    setStatus(
      "warning",
      "تم تنفيذ جزء من الاختبار. بعض القياسات لم تنجح بالكامل (غالباً بسبب حجب أو إعدادات CORS لبعض السيرفرات)."
    );
    setPhase(
      "اكتمل جزء من الاختبار. يمكنك لاحقاً تعديل قائمة السيرفرات أو ربطها بسيرفراتك الخاصة لنتائج أدق."
    );
  } else {
    setStatus(
      "error",
      "لم ينجح أي جزء من الاختبار. غالباً السبب من الاتصال أو من حجب/إعدادات الخوادم (CORS)، وليس من شكل الموقع نفسه. جرّب لاحقاً تغيير السيرفرات أو استخدام خادمك الخاص وتشغيل الصفحة من خادم (مثل Live Server)."
    );
    setPhase(
      "لم يكتمل الاختبار بسبب مشكلة في نقاط القياس أو الاتصال. بعد ضبط السيرفرات أو تشغيل الصفحة من خادم، أعد المحاولة."
    );
  }

  isTesting = false;
  startBtn.disabled = false;
}

// =========================
// Event binding
// =========================

startBtn?.addEventListener("click", () => {
  if (isTesting) return;
  runFullTestSequential();
});

// Initial UI state
resetUI();
