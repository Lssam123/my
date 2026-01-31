const downloadUrl = "https://speed.cloudflare.com/__down?bytes=10000000";
const uploadUrl = "https://httpbin.org/post";

const rounds = 5;

async function ping() {
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    await fetch("https://1.1.1.1/cdn-cgi/trace", { cache: "no-store" });
    times.push(performance.now() - t0);
  }
  times.shift(); // تجاهل أول قيمة
  const avg = times.reduce((a,b)=>a+b)/times.length;
  const jitter = Math.max(...times) - Math.min(...times);
  return { ping: avg.toFixed(1), jitter: jitter.toFixed(1) };
}

async function download() {
  let totalBits = 0;
  const start = performance.now();
  const promises = [];

  for (let i = 0; i < 3; i++) {
    promises.push(fetch(downloadUrl,{cache:"no-store"}).then(r=>r.blob()));
  }

  const blobs = await Promise.all(promises);
  blobs.forEach(b => totalBits += b.size * 8);

  const time = (performance.now() - start) / 1000;
  return (totalBits / time / 1e6).toFixed(2);
}

async function upload() {
  const data = new Blob([new ArrayBuffer(8 * 1024 * 1024)]);
  const start = performance.now();
  await fetch(uploadUrl,{method:"POST",body:data});
  const time = (performance.now() - start) / 1000;
  return ((data.size * 8) / time / 1e6).toFixed(2);
}

async function startTest() {
  document.getElementById("status").textContent = "قياس Ping...";
  const p = await ping();
  document.getElementById("ping").textContent = p.ping;
  document.getElementById("jitter").textContent = p.jitter;

  document.getElementById("status").textContent = "قياس Download...";
  const down = await download();
  document.getElementById("speed").textContent = down;

  document.getElementById("status").textContent = "قياس Loaded Ping...";
  const lp = await ping();
  document.getElementById("lp").textContent = lp.ping;

  document.getElementById("status").textContent = "قياس Upload...";
  const up = await upload();
  document.getElementById("up").textContent = up;

  document.getElementById("status").textContent = "انتهى الفحص ✔";
}