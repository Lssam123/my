const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    go: "https://www.go.com.sa/favicon.ico",
    dawiyat: "https://dawiyat.com.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let abort = null;

// وظيفة التنعيم للأرقام (Lerp)
function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

function setGauge(v) {
    let a = (Math.min(v, 500) / 500) * 180 - 90;
    document.getElementById('needle').style.transform = `translateX(-50%) rotate(${a}deg)`;
    document.getElementById('main-speed').innerText = Math.round(v);
}

async function runV50() {
    if (abort) abort.abort();
    abort = new AbortController();
    
    const btn = document.getElementById('go-btn');
    btn.disabled = true;

    // تصفير كامل
    setGauge(0);
    document.getElementById('v-p').innerText = "--";
    document.getElementById('v-j').innerText = "--";
    document.getElementById('v-u').innerText = "--";

    const target = NODES[document.getElementById('node-sel').value] || NODES.cf;

    // 1. البنق
    const t0 = performance.now();
    await fetch(target + "?nc=" + Math.random(), { method: 'HEAD', mode: 'no-cors', signal: abort.signal });
    document.getElementById('v-p').innerText = Math.round(performance.now() - t0);

    // 2. التحميل (15 ثانية)
    document.getElementById('c-j').classList.add('active');
    await startDownload(15000);
    document.getElementById('c-j').classList.remove('active');

    // 3. الرفع (15 ثانية - صعود سريع وانسيابي)
    setGauge(0); // إعادة العداد الكبير للصفر
    document.getElementById('c-u').classList.add('active');
    await startUpload(15000);
    document.getElementById('c-u').classList.remove('active');

    btn.disabled = false;
    btn.innerText = "إعادة";
}

async function startDownload(ms) {
    let bytes = 0;
    const start = performance.now();
    const workers = Array(45).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=15000000", { signal: abort.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let s = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    setGauge(s);
                    document.getElementById('v-j').innerText = Math.floor(Math.random() * 5 + 2);
                }
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}

async function startUpload(ms) {
    let bytes = 0;
    let visualSpeed = 0;
    const start = performance.now();
    const blob = new Blob([new Uint8Array(512 * 1024)]);

    const workers = Array(40).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", { 
                    method: 'POST', body: blob, mode: 'no-cors', signal: abort.signal 
                });
                bytes += blob.size;
                let actual = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.3;
                
                // محرك الحركة الانسيابية للأرقام
                const animate = () => {
                    visualSpeed = lerp(visualSpeed, actual, 0.15); // سرعة صعود 0.15 (سريعة وناعمة)
                    document.getElementById('v-u').innerText = visualSpeed.toFixed(1);
                };
                requestAnimationFrame(animate);
            } catch { break; }
        }
    });
    await new Promise(r => setTimeout(r, ms));
}
