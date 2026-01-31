// === إعدادات عامة للقياس ===
const PING_URL = "https://httpbin.org/get"; // قياس البِنغ
const DOWNLOAD_URL = "https://httpbin.org/bytes/5000000"; // تحميل 5 ميجابايت
const UPLOAD_URL = "https://httpbin.org/post"; // رفع بيانات تجريبية

const PING_SAMPLES = 5;
const DOWNLOAD_SAMPLES = 3;
const UPLOAD_SAMPLES = 3;
const TIMEOUT_MS = 8000; // حد أقصى لكل طلب

// قيم مرجعية تقريبية لتعبئة العدادات
const MAX_DOWNLOAD_Mbps = 200;
const MAX_UPLOAD_Mbps = 50;
const MAX_PING_ms = 200; // الأصغر أفضل

const startBtn = document.getElementById("startTestBtn");
const statusText = document.getElementById("statusText");

const downloadValueEl = document.getElementById("downloadValue");
const uploadValueEl = document.getElementById("uploadValue");
const pingValueEl = document.getElementById("pingValue");

const downloadQualityEl = document.getElementById("downloadQuality");
const uploadQualityEl = document.getElementById("uploadQuality");
const pingQualityEl = document.getElementById("pingQuality");

let isRunning = false;

// === أدوات مساعدة ===
function setStatus(msg) {
  statusText.textContent = msg;
}

function median(values) {
  if (!values.length) return 0;
  const arr = [...values].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function setGauge(metric, value, maxValue, invertForPing = false) {
  const gauge = document.querySelector(`.gauge[data-metric="${metric}"] .gauge-progress`);
  const card = document.querySelector(`.metric-${metric}`);
  if (!gauge || !card) return;

  let ratio = value / maxValue;
  if (invertForPing) {
    // كلما قلّ البِنغ كان أفضل، فنقلب النسبة تقريبًا
    ratio = 1 - ratio;
  }

  const percent = clamp01(ratio);
  const circumference = 2 * Math.PI * 50; // نفس نصف القطر في الـ SVG
  const offset = circumference - percent * circumference;

  gauge.style.strokeDashoffset = offset.toString();

  // تمييز الكرت أثناء القياس
  card.classList.add("active");
  setTimeout(() => card.classList.remove("active"), 600);
}

function qualityLabelForSpeed(mbps) {
  if (mbps >= 150) return { text: "ممتاز جداً", cls: "good" };
  if (mbps >= 80) return { text: "ممتاز", cls: "good" };
  if (mbps >= 40) return { text: "جيد", cls: "medium" };
  if (mbps >= 15) return { text: "متوسط", cls: "medium" };
  return { text: "ضعيف", cls: "bad" };
}

function qualityLabelForPing(ms) {
  if (ms <= 20) return { text: "ممتاز جداً", cls: "good" };
  if (ms <= 40) return { text: "ممتاز", cls: "good" };
  if (ms <= 80) return { text: "جيد", cls: "medium" };
  if (ms <= 140) return { text: "متوسط", cls: "medium" };
  return { text: "ضعيف", cls: "bad" };
}

function updateQuality(el, labelObj) {
  el.classList.remove("good", "medium", "bad");
  if (labelObj.cls) el.classList.add(labelObj.cls);
  el.textContent = labelObj.text;
}

function resetUI() {
  downloadValueEl.textContent = "0.0";
  uploadValueEl.textContent = "0.0";
  pingValueEl.textContent = "0";

  downloadQualityEl.textContent = "لم يبدأ بعد";
  uploadQualityEl.textContent = "لم يبدأ بعد";
  pingQualityEl.textContent = "لم يبدأ بعد";

  downloadQualityEl.classList.remove("good", "medium", "bad");
  uploadQualityEl.classList.remove("good", "medium", "bad");
  pingQualityEl.classList.remove("good", "medium", "bad");

  setGauge("download", 0, 1);
  setGauge("upload", 0, 1);
  setGauge("ping", 1, 1, true); // نبدأ من أسوأ حالة
}

// === قياس البِنغ ===
async function measurePing() {
  const samples = [];

  for (let i = 0; i < PING_SAMPLES; i++) {
    const start = performance.now();
    try {
      await withTimeout(
        fetch(`${PING_URL}?_=${Date.now()}_${i}`, { cache: "no-store" }),
        TIMEOUT_MS
      );
      const end = performance.now();
      samples.push(end - start);
    } catch (e) {
      console.warn("Ping sample failed", e);
    }
  }

  if (!samples.length) throw new Error("Ping failed");

  const med = median(samples);
  const rounded = Math.round(med);

  pingValueEl.textContent = rounded.toString();
  setGauge("ping", rounded, MAX_PING_ms, true);
  updateQuality(pingQualityEl, qualityLabelForPing(rounded));

  return rounded;
}

// === قياس التحميل ===
async function measureDownload() {
  const samples = [];
  const bytes = 5_000_000; // نفس حجم DOWNLOAD_URL أعلاه

  for (let i = 0; i < DOWNLOAD_SAMPLES; i++) {
    const start = performance.now();
    try {
      const response = await withTimeout(
        fetch(`${DOWNLOAD_URL}?_=${Date.now()}_${i}`, {
          cache: "no-store",
        }),
        TIMEOUT_MS
      );
      await response.arrayBuffer();
      const end = performance.now();
      const seconds = (end - start) / 1000;
      const mbps = (bytes * 8) / (seconds * 1_000_000); // من بت إلى ميجابت/ثانية
      samples.push(mbps);
    } catch (e) {
      console.warn("Download sample failed", e);
    }
  }

  if (!samples.length) throw new Error("Download failed");

  const med = median(samples);
  const rounded = Math.round(med * 10) / 10; // رقم عشري واحد

  downloadValueEl.textContent = rounded.toFixed(1);
  setGauge("download", rounded, MAX_DOWNLOAD_Mbps);
  updateQuality(downloadQualityEl, qualityLabelForSpeed(rounded));

  return rounded;
}

// === قياس الرفع ===
async function measureUpload() {
  const samples = [];
  const bytes = 1_000_000; // 1 ميجابايت بيانات رفع
  const payload = new Uint8Array(bytes);

  for (let i = 0; i < UPLOAD_SAMPLES; i++) {
    const start = performance.now();
    try {
      await withTimeout(
        fetch(`${UPLOAD_URL}?_=${Date.now()}_${i}`, {
          method: "POST",
          body: payload,
        }),
        TIMEOUT_MS
      );
      const end = performance.now();
      const seconds = (end - start) / 1000;
      const mbps = (bytes * 8) / (seconds * 1_000_000);
      samples.push(mbps);
    } catch (e) {
      console.warn("Upload sample failed", e);
    }
  }

  if (!samples.length) throw new Error("Upload failed");

  const med = median(samples);
  const rounded = Math.round(med * 10) / 10;

  uploadValueEl.textContent = rounded.toFixed(1);
  setGauge("upload", rounded, MAX_UPLOAD_Mbps);
  updateQuality(uploadQualityEl, qualityLabelForSpeed(rounded));

  return rounded;
}

// === تشغيل الاختبار بالتسلسل ===
startBtn.addEventListener("click", async () => {
  if (isRunning) return;
  isRunning = true;
  startBtn.disabled = true;
  startBtn.textContent = "جارٍ الاختبار...";
  resetUI();

  try {
    setStatus("جاري قياس زمن الاستجابة (البِنغ)...");
    await measurePing();

    setStatus("جاري قياس سرعة التحميل...");
    await measureDownload();

    setStatus("جاري قياس سرعة الرفع...");
    await measureUpload();

    setStatus("اكتمل الاختبار بنجاح ✅");
  } catch (e) {
    console.error(e);
    setStatus(
      "تعذّر إكمال الاختبار بالكامل. قد تكون هناك مشكلة في الاتصال أو إعدادات السيرفر."
    );
  } finally {
    isRunning = false;
    startBtn.disabled = false;
    startBtn.textContent = "ابدأ الاختبار الآن";
  }
});

// تهيئة أولية
resetUI();
