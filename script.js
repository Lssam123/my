// Simple front-end internet speed test (approximate only).
// This implementation uses public endpoints by default, but you SHOULD
// replace them with your own backend/API endpoints for more reliable results
// and to avoid possible CORS or rate-limit issues.

const DOWNLOAD_TEST_URL = "https://speed.hetzner.de/10MB.bin";
// Small, fast endpoint to approximate ping. You can point this to your own API.
const PING_TEST_URL = "https://www.google.com/generate_204";
// Echo endpoint for upload test (replace with your own server-side URL).
const UPLOAD_TEST_URL = "https://httpbin.org/post";

// Approximate payload size for upload test (bytes)
const UPLOAD_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

const startTestBtn = document.getElementById("startTestBtn");
const statusText = document.getElementById("statusText");

const downloadValueEl = document.getElementById("downloadValue");
const uploadValueEl = document.getElementById("uploadValue");
const pingValueEl = document.getElementById("pingValue");

let isRunning = false;

const metricCards = {
  download: document.getElementById("downloadCard"),
  upload: document.getElementById("uploadCard"),
  ping: document.getElementById("pingCard"),
};

function setStatus(state, messageAr, messageEn) {
  statusText.classList.remove("status--idle", "status--running", "status--success", "status--error");
  statusText.classList.add(`status--${state}`);
  statusText.innerHTML = `
    ${messageAr}
    ${messageEn}
  `;
}

function resetValues() {
  downloadValueEl.textContent = "--";
  uploadValueEl.textContent = "--";
  pingValueEl.textContent = "--";
}

function setMetricValue(el, value, fractionDigits = 2) {
  if (typeof value !== "number" || !isFinite(value)) {
    el.textContent = "--";
    return;
  }
  el.textContent = value.toFixed(fractionDigits);
}

function activateCard(activeKey) {
  Object.entries(metricCards).forEach(([key, card]) => {
    if (!card) return;
    card.classList.toggle("is-active", key === activeKey);
  });
}

// Ping test: perform several small requests and average the response time.
async function testPing(attempts = 5) {
  const timings = [];

  for (let i = 0; i < attempts; i += 1) {
    const start = performance.now();
    try {
      // We use "no-store" to avoid cached responses affecting timing.
      await fetch(`${PING_TEST_URL}?cacheBust=${Math.random()}`, {
        cache: "no-store",
        mode: "cors",
      });
      const end = performance.now();
      timings.push(end - start);
    } catch (error) {
      console.error("Ping attempt failed:", error);
    }
  }

  if (!timings.length) {
    throw new Error("Ping test failed (no successful attempts).");
  }

  const sum = timings.reduce((total, t) => total + t, 0);
  return sum / timings.length; // ms
}

// Download test: download a known-size file and measure how long it takes.
async function testDownload(url = DOWNLOAD_TEST_URL) {
  const startTime = performance.now();
  const response = await fetch(`${url}?cacheBust=${Math.random()}`, {
    cache: "no-store",
    mode: "cors",
  });

  if (!response.ok || !response.body) {
    throw new Error("Download test failed (response not OK or no body).");
  }

  const reader = response.body.getReader();
  let bytesReceived = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesReceived += value.byteLength;
  }

  const endTime = performance.now();
  const durationSeconds = (endTime - startTime) / 1000;

  if (durationSeconds === 0) {
    throw new Error("Download test failed (zero duration).");
  }

  // bits per second -> megabits per second (Mbps)
  const bitsLoaded = bytesReceived * 8;
  const mbps = bitsLoaded / durationSeconds / 1_000_000;
  return mbps;
}

// Upload test: upload a generated payload and measure how long it takes.
async function testUpload(url = UPLOAD_TEST_URL, sizeBytes = UPLOAD_SIZE_BYTES) {
  // Generate a binary payload of the requested size.
  const payload = new Uint8Array(sizeBytes);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(payload);
  } else {
    // Fallback: fill with pseudo-random data.
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = Math.floor(Math.random() * 256);
    }
  }

  const startTime = performance.now();
  const response = await fetch(`${url}?cacheBust=${Math.random()}`, {
    method: "POST",
    mode: "cors",
    body: payload,
    headers: {
      "Content-Type": "application/octet-stream",
    },
  });
  const endTime = performance.now();

  if (!response.ok) {
    throw new Error("Upload test failed (response not OK).");
  }

  const durationSeconds = (endTime - startTime) / 1000;
  if (durationSeconds === 0) {
    throw new Error("Upload test failed (zero duration).");
  }

  const bitsSent = sizeBytes * 8;
  const mbps = bitsSent / durationSeconds / 1_000_000;
  return mbps;
}

async function runSpeedTest() {
  if (isRunning) return;
  isRunning = true;
  startTestBtn.disabled = true;
  resetValues();

  setStatus(
    "جاري قياس سرعة الاتصال بالإنترنت، يُرجى الانتظار...",
    "Testing your internet speed, please wait..."
  );

  try {
    // 1) Ping
    activateCard("ping");
    const pingMs = await testPing();
    setMetricValue(pingValueEl, pingMs, 0);

    // 2) Download
    activateCard("download");
    const downloadMbps = await testDownload();
    setMetricValue(downloadValueEl, downloadMbps, 2);

    // 3) Upload
    activateCard("upload");
    const uploadMbps = await testUpload();
    setMetricValue(uploadValueEl, uploadMbps, 2);

    setStatus(
      "تم إكمال الاختبار بنجاح ✅",
      "Test completed successfully ✅"
    );
  } catch (error) {
    console.error("Speed test failed:", error);
    setStatus(
      "تعذّر إكمال الاختبار. قد تكون هناك مشكلة في الاتصال أو في إعداد نقطة الاختبار. جرّب لاحقًا أو حدّث عناوين الـ API.",
      "The test could not be completed. There may be a connectivity or test-endpoint issue. Try again later or update the API endpoints."
    );
  } finally {
    isRunning = false;
    startTestBtn.disabled = false;
    activateCard(null);
  }
}

// Attach event listener
startTestBtn.addEventListener("click", runSpeedTest);

// Optional: run an automatic test when the page loads.
// Comment this out if you prefer manual-only testing.
// window.addEventListener("load", () => {
//   runSpeedTest();
// });
