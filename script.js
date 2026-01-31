// -----------------------------
// قابل للتعديل: روابط الاختبار
// -----------------------------
// يُفضّل استبدال هذه الروابط بروابط من سيرفرك الخاص مع تفعيل CORS
const DOWNLOAD_URL = "https://httpbin.org/bytes/5000000"; // حوالي 5 ميجابايت للتحميل
const UPLOAD_URL = "https://httpbin.org/post"; // لاستقبال بيانات الرفع
const PING_URL = "https://httpbin.org/get"; // لقياس زمن الاستجابة
const LOAD_STRESS_URL = "https://httpbin.org/bytes/8000000"; // لخلق ضغط أثناء قياس البنق

// عدد العينات لكل نوع قياس
const PING_SAMPLES_IDLE = 5;
const PING_SAMPLES_LOADED = 5;
const DOWNLOAD_SAMPLES = 3;
const UPLOAD_SAMPLES = 3;

// مهلة قصوى لكل طلب (مللي ثانية)
const REQUEST_TIMEOUT_MS = 8000;

// -----------------------------
// عناصر الواجهة
// -----------------------------
const startBtn = document.getElementById("startTestBtn");
const statusText = document.getElementById("statusText");

const downloadValueEl = document.getElementById("downloadValue");
const uploadValueEl = document.getElementById("uploadValue");
const pingValueEl = document.getElementById("pingValue");
const pingIdleTextEl = document.getElementById("pingIdleText");
const pingLoadedTextEl = document.getElementById("pingLoadedText");

const downloadQualityEl = document.getElementById("downloadQuality");
const uploadQualityEl = document.getElementById("uploadQuality");
const pingQualityEl = document.getElementById("pingQuality");

// دوائر القياس
const CIRCUMFERENCE = 2 * Math.PI * 50; // نصف القطر = 50 في الـ SVG

function setGaugeValue(metric, value, maxValue) {
  const circle = document.querySelector(
    `.gauge[data-metric="${metric}"] .gauge-progress`
  );
  if (!circle) return;

  const safeMax = maxValue <= 0 ? 1 : maxValue;
  const clamped = Math.max(0, Math.min(value, safeMax));
  const ratio = clamped / safeMax;
  const offset = CIRCUMFERENCE * (1 - ratio);

  circle.style.strokeDashoffset = `${offset}`;
}

function resetUI() {
  downloadValueEl.textContent = "0.0";
  uploadValueEl.textContent = "0.0";
  pingValueEl.textContent = "0";
  pingIdleTextEl.textContent = "0 مللي ثانية";
  pingLoadedTextEl.textContent = "0 مللي ثانية";

  downloadQualityEl.textContent = "لم يبدأ بعد";
  uploadQualityEl.textContent = "لم يبدأ بعد";
  pingQualityEl.textContent = "لم يبدأ بعد";

  setGaugeValue("download", 0, 100);
  setGaugeValue("upload", 0, 50);
  setGaugeValue("ping", 0, 200);
}

function classifySpeedMbps(mbps) {
  if (mbps >= 200) return "ممتاز جداً";
  if (mbps >= 100) return "ممتاز";
  if (mbps >= 50) return "جيد";
  if (mbps >= 20) return "متوسط";
  if (mbps > 0) return "ضعيف";
  return "غير متاح";
}

function classifyPingMs(ms) {
  if (ms <= 20) return "ممتاز جداً";
  if (ms <= 40) return "ممتاز";
  if (ms <= 70) return "جيد";
  if (ms <= 120) return "متوسط";
  if (ms > 0) return "ضعيف";
  return "غير متاح";
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function measurePingSamples(samplesCount, label) {
  const results = [];

  for (let i = 0; i < samplesCount; i++) {
    const start = performance.now();

    try {
      await withTimeout(
        fetch(`${PING_URL}?t=${Date.now()}&n=${i}`, {
          cache: "no-store",
        }),
        REQUEST_TIMEOUT_MS
      );
      const end = performance.now();
      results.push(end - start);
    } catch (error) {
      console.warn(`Ping ${label} sample failed`, error);
    }
  }

  return median(results);
}

async function createLoadWhilePinging(durationMs) {
  const start = performance.now();

  async function loop() {
    while (performance.now() - start < durationMs) {
      try {
        await withTimeout(
          fetch(`${LOAD_STRESS_URL}?t=${Date.now()}`, {
            cache: "no-store",
          }),
          REQUEST_TIMEOUT_MS
        );
      } catch (error) {
        // لا حاجة لإظهار الخطأ للمستخدم هنا، الهدف فقط خلق ضغط على الرابط
      }
    }
  }

  return loop();
}

async function measureDownloadMbps() {
  const bytes = 5_000_000; // نفس حجم DOWNLOAD_URL
  const speeds = [];

  for (let i = 0; i < DOWNLOAD_SAMPLES; i++) {
    const url = `${DOWNLOAD_URL}?t=${Date.now()}&n=${i}`;
    const start = performance.now();

    try {
      const response = await withTimeout(
        fetch(url, { cache: "no-store" }),
        REQUEST_TIMEOUT_MS
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      await response.arrayBuffer();
      const end = performance.now();
      const seconds = (end - start) / 1000;
      if (seconds > 0) {
        const bitsPerSecond = (bytes * 8) / seconds;
        const mbps = bitsPerSecond / 1_000_000;
        speeds.push(mbps);
      }
    } catch (error) {
      console.warn("Download sample failed", error);
    }
  }

  return median(speeds);
}

async function measureUploadMbps() {
  const sizeBytes = 2 * 1024 * 1024; // ~2MB
  const payload = new Uint8Array(sizeBytes);
  const speeds = [];

  for (let i = 0; i < UPLOAD_SAMPLES; i++) {
    const start = performance.now();

    try {
      const response = await withTimeout(
        fetch(`${UPLOAD_URL}?t=${Date.now()}&n=${i}`, {
          method: "POST",
          body: payload,
        }),
        REQUEST_TIMEOUT_MS
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const end = performance.now();
      const seconds = (end - start) / 1000;
      if (seconds > 0) {
        const bitsPerSecond = (sizeBytes * 8) / seconds;
        const mbps = bitsPerSecond / 1_000_000;
        speeds.push(mbps);
      }
    } catch (error) {
      console.warn("Upload sample failed", error);
    }
  }

  return median(speeds);
}

async function runFullTest() {
  resetUI();
  startBtn.disabled = true;
  statusText.textContent = "جاري قياس البِنغ بدون تحميل...";

  let idlePingMs = 0;
  let loadedPingMs = 0;
  let downloadMbps = 0;
  let uploadMbps = 0;

  try {
    // 1) Ping بدون تحميل
    idlePingMs = await measurePingSamples(PING_SAMPLES_IDLE, "idle");
    if (idlePingMs > 0) {
      pingValueEl.textContent = Math.round(idlePingMs).toString();
      pingIdleTextEl.textContent = `${Math.round(idlePingMs)} مللي ثانية`;
      pingQualityEl.textContent = classifyPingMs(idlePingMs);
      setGaugeValue("ping", idlePingMs, 200);
    } else {
      pingQualityEl.textContent = "تعذر قياس البِنغ بدون تحميل";
    }

    // 2) التحميل
    statusText.textContent = "جاري قياس سرعة التحميل...";
    downloadMbps = await measureDownloadMbps();
    if (downloadMbps > 0) {
      const dlRounded = downloadMbps.toFixed(1);
      downloadValueEl.textContent = dlRounded;
      downloadQualityEl.textContent = classifySpeedMbps(downloadMbps);
      setGaugeValue("download", downloadMbps, 200);
    } else {
      downloadQualityEl.textContent = "تعذر قياس سرعة التحميل";
    }

    // 3) الرفع
    statusText.textContent = "جاري قياس سرعة الرفع...";
    uploadMbps = await measureUploadMbps();
    if (uploadMbps > 0) {
      const ulRounded = uploadMbps.toFixed(1);
      uploadValueEl.textContent = ulRounded;
      uploadQualityEl.textContent = classifySpeedMbps(uploadMbps);
      setGaugeValue("upload", uploadMbps, 100);
    } else {
      uploadQualityEl.textContent = "تعذر قياس سرعة الرفع";
    }

    // 4) Ping أثناء التحميل (بنق مثقل)
    statusText.textContent = "جاري قياس البِنغ أثناء التحميل (بنق مثقل)...";

    const stressDuration = 5000; // مللي ثانية من الضغط التقريبي
    const loadPromise = createLoadWhilePinging(stressDuration);
    loadedPingMs = await measurePingSamples(PING_SAMPLES_LOADED, "loaded");
    await loadPromise.catch(() => {});

    if (loadedPingMs > 0) {
      pingLoadedTextEl.textContent = `${Math.round(loadedPingMs)} مللي ثانية`;
      // نحدّث المؤشر ليبين البِنغ الأسوأ بين الحالتين
      const worstPing = Math.max(idlePingMs || 0, loadedPingMs || 0);
      pingValueEl.textContent = Math.round(worstPing).toString();
      pingQualityEl.textContent = classifyPingMs(worstPing);
      setGaugeValue("ping", worstPing, 200);
    } else {
      pingLoadedTextEl.textContent = "تعذر قياس البِنغ أثناء التحميل";
    }

    // رسالة نهائية أوضح
    statusText.textContent = buildFinalStatusMessage({
      idlePingMs,
      loadedPingMs,
      downloadMbps,
      uploadMbps,
    });
  } catch (error) {
    console.error("Speed test failed", error);
    statusText.textContent =
      "حدث خطأ عام أثناء الفحص. إذا استمرت المشكلة، غيّر الروابط في script.js إلى سيرفر خاص بك وتأكد من تفعيل CORS.";
  } finally {
    startBtn.disabled = false;
  }
}

function buildFinalStatusMessage({ idlePingMs, loadedPingMs, downloadMbps, uploadMbps }) {
  const parts = [];

  if (downloadMbps > 0) {
    parts.push(`التحميل: ${downloadMbps.toFixed(1)} ميجابت/ث – ${classifySpeedMbps(downloadMbps)}`);
  }

  if (uploadMbps > 0) {
    parts.push(`الرفع: ${uploadMbps.toFixed(1)} ميجابت/ث – ${classifySpeedMbps(uploadMbps)}`);
  }

  if (idlePingMs > 0) {
    parts.push(`البِنغ بدون تحميل: ${Math.round(idlePingMs)} مللي ثانية – ${classifyPingMs(idlePingMs)}`);
  }

  if (loadedPingMs > 0) {
    parts.push(
      `البِنغ أثناء التحميل: ${Math.round(loadedPingMs)} مللي ثانية – ${classifyPingMs(loadedPingMs)}`
    );
  }

  if (!parts.length) {
    return "انتهى الفحص لكن لم نتمكن من الحصول على قراءات صالحة. غالباً السبب من الاتصال أو إعدادات السيرفر (CORS).";
  }

  return `انتهى الفحص:
${parts.join(" | ")}`;
}

// -----------------------------
// ربط الزر بالتشغيل
// -----------------------------
if (startBtn) {
  startBtn.addEventListener("click", () => {
    runFullTest();
  });
}
