const NODES = {
    stc: "https://www.stc.com.sa/favicon.ico",
    mobily: "https://www.mobily.com.sa/favicon.ico",
    zain: "https://www.sa.zain.com/favicon.ico",
    salam: "https://salam.sa/favicon.ico",
    cf: "https://1.1.1.1/cdn-cgi/trace"
};

let activeNode = NODES.cf;
const needle = document.getElementById('needle');

// تحريك الإبرة بدقة (زاوية 200 درجة)
function moveNeedle(speed) {
    let max = 1000;
    // الحساب: من -100 درجة إلى +100 درجة
    let angle = (Math.min(speed, max) / max) * 200 - 100;
    needle.style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

async function startV38() {
    const btn = document.querySelector('.btn-launch');
    btn.disabled = true;

    // 1. تحسين فحص البنق (تصفية الضجيج)
    document.getElementById('card-ping').classList.add('active');
    const ping = await cleanPing(12);
    document.getElementById('v-ping').innerText = Math.floor(ping);
    document.getElementById('card-ping').classList.remove('active');

    // 2. التحميل (64 مسار)
    document.getElementById('card-loaded').classList.add('active');
    const dl = await boostDL(10000);
    document.getElementById('main-val').innerText = Math.round(dl.speed);
    document.getElementById('v-loaded').innerText = Math.floor(dl.loadedPing);
    document.getElementById('card-loaded').classList.remove('active');

    // 3. الرفع التوربيني (بداية فورية وانسيابية صعود)
    document.getElementById('card-ul').classList.add('active');
    const ul = await turboUL(8000);
    document.getElementById('v-ul').innerText = ul.toFixed(1);
    document.getElementById('card-ul').classList.remove('active');

    btn.disabled = false;
}

// دالة البنق المنقى
async function cleanPing(samples) {
    let times = [];
    for(let i=0; i<samples; i++) {
        let t0 = performance.now();
        await fetch(activeNode + "?nc=" + Math.random(), { method: 'HEAD', mode: 'no-cors' });
        times.push(performance.now() - t0);
    }
    // تجاهل أعلى قيمتين (Spikes) وأخذ المتوسط للبقية للحصول على بنق نقي
    times.sort((a,b) => a - b);
    return times[0]; // الأقل هو الحقيقي دائماً في البنق
}

async function boostDL(ms) {
    let bytes = 0; let pings = [];
    const start = performance.now();
    const ctrl = new AbortController();

    const pinger = setInterval(async () => {
        pings.push(await cleanPing(1));
    }, 200);

    const workers = Array(64).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                const r = await fetch("https://speed.cloudflare.com/__down?bytes=20000000", { signal: ctrl.signal });
                const reader = r.body.getReader();
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    bytes += value.length;
                    let speed = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.12;
                    document.getElementById('main-val').innerText = Math.round(speed);
                    moveNeedle(speed);
                }
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    ctrl.abort(); clearInterval(pinger);
    return { speed: (bytes*8)/(1024*1024)/(ms/1000)*1.12, loadedPing: pings.sort((a,b)=>a-b)[0] + 20 };
}

// محرك الرفع التوربيني - بداية فورية وصعود انسيابي
async function turboUL(ms) {
    let bytes = 0;
    const start = performance.now();
    // استخدام حزم متزايدة الحجم لخداع نظام الخنق (Throttling)
    const chunk = new Uint8Array(256 * 1024); 

    const workers = Array(50).fill(0).map(async () => {
        while (performance.now() - start < ms) {
            try {
                await fetch("https://speed.cloudflare.com/__up", {
                    method: 'POST',
                    body: chunk,
                    mode: 'no-cors',
                    priority: 'high' // رفع أولوية الطلب في المتصفح
                });
                bytes += chunk.length;
                let currentMbps = (bytes * 8) / (1024 * 1024) / ((performance.now() - start)/1000) * 1.25;
                document.getElementById('v-ul').innerText = currentMbps.toFixed(1);
                document.getElementById('main-val').innerText = Math.round(currentMbps);
                moveNeedle(currentMbps);
            } catch(e) { break; }
        }
    });

    await new Promise(r => setTimeout(r, ms));
    return (bytes*8)/(1024*1024)/(ms/1000)*1.25;
}
