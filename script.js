/* ============================
   قاعدة معرفة أساسية
============================ */

let knowledgeBase = [
    { keywords: ["مرحبا", "هلا", "السلام"], replies: ["أهلاً! كيف أقدر أساعدك اليوم؟", "يا هلا! تفضل بسؤالك."] },
    { keywords: ["كيف حالك", "اخبارك"], replies: ["أنا بخير ولله الحمد، جاهز لخدمتك.", "تمام ولله الحمد، شكراً لسؤالك."] },
    { keywords: ["اسمك", "من انت"], replies: ["أنا محادث ذكي عربي صُمم لمساعدتك.", "تقدر تعتبرني مساعدك الشخصي الذكي."] },
    { keywords: ["شكرا", "يسلمو"], replies: ["العفو! سعيد بخدمتك دائماً.", "لا شكر على واجب."] },
    { keywords: ["برمجة", "اتعلم برمجة"], replies: ["ابدأ بـ HTML, CSS, JavaScript ثم انتقل لـ Python أو غيرها.", "أفضل بداية: تعلم أساسيات الويب ثم لغة برمجة عامة."] }
];

/* تحميل المعرفة المتعلمة سابقاً */
if (localStorage.getItem("learnedData")) {
    knowledgeBase = knowledgeBase.concat(JSON.parse(localStorage.getItem("learnedData")));
}

/* ============================
   خوارزمية Levenshtein
============================ */
function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + (a[j - 1] === b[i - 1] ? 0 : 1)
            );
        }
    }
    return matrix[b.length][a.length];
}

/* ============================
   اختيار رد من القاعدة
============================ */
function findBestReply(message) {
    message = message.trim();

    // مطابقة مباشرة بالكلمات
    for (let item of knowledgeBase) {
        for (let key of item.keywords) {
            if (message.includes(key)) {
                const replies = item.replies;
                return replies[Math.floor(Math.random() * replies.length)];
            }
        }
    }

    // مطابقة بالتشابه
    let bestMatch = null;
    let bestScore = 999;

    knowledgeBase.forEach(item => {
        item.keywords.forEach(key => {
            let score = levenshtein(message, key);
            if (score < bestScore) {
                bestScore = score;
                bestMatch = item.replies[Math.floor(Math.random() * item.replies.length)];
            }
        });
    });

    if (bestScore <= 3) return bestMatch;

    return null;
}

/* ============================
   التعلّم الذاتي
============================ */
let waitingForTeach = false;
let lastUserQuestion = "";

function learnNewReply(question, answer) {
    let newEntry = {
        keywords: [question],
        replies: [answer]
    };

    let learned = JSON.parse(localStorage.getItem("learnedData") || "[]");
    learned.push(newEntry);
    localStorage.setItem("learnedData", JSON.stringify(learned));

    knowledgeBase.push(newEntry);
}

/* ============================
   البحث في الإنترنت (DuckDuckGo)
============================ */

async function searchInternet(query) {
    const url = "https://api.duckduckgo.com/?q=" +
        encodeURIComponent(query) +
        "&format=json&no_redirect=1&no_html=1";

    try {
        const res = await fetch(url);
        const data = await res.json();

        let reply = "";

        if (data.AbstractText && data.AbstractText.length > 0) {
            reply += data.AbstractText + "\n\n";
        }

        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            reply += "بعض الروابط ذات الصلة:\n";
            data.RelatedTopics.slice(0, 3).forEach(t => {
                if (t.Text && t.FirstURL) {
                    reply += `• ${t.Text}\n${t.FirstURL}\n\n`;
                }
            });
        }

        if (reply === "") {
            reply = "لم أجد معلومات كافية عن هذا الموضوع.";
        }

        return reply;
    } catch (e) {
        return "حدث خطأ أثناء محاولة البحث في الإنترنت.";
    }
}

/* ============================
   منطق الرد الكامل
============================ */
async function handleUserMessage(msg) {
    msg = msg.trim();

    // أوامر البحث في النت
    if (msg.startsWith("ابحث عن") || msg.startsWith("بحث عن") || msg.includes("في النت") || msg.includes("في الإنترنت")) {
        let query = msg
            .replace("ابحث عن", "")
            .replace("بحث عن", "")
            .replace("في النت", "")
            .replace("في الإنترنت", "")
            .trim();

        if (query.length < 2) {
            return "ما هو الموضوع الذي تريد البحث عنه؟";
        }

        return await searchInternet(query);
    }

    // إذا كان البوت ينتظر تعليم
    if (waitingForTeach) {
        learnNewReply(lastUserQuestion, msg);
        waitingForTeach = false;
        return "تم حفظ الرد، شكراً لك! سأستخدمه إذا تكرر هذا السؤال.";
    }

    // محاولة الرد من القاعدة
    let reply = findBestReply(msg);
    if (reply) return reply;

    // لم يفهم → يطلب تعليم
    waitingForTeach = true;
    lastUserQuestion = msg;
    return "ما فهمت سؤالك… تقدر تعطيني الرد المناسب عشان أتعلمه؟";
}

/* ============================
   واجهة المحادثة
============================ */
const chatBox = document.getElementById("chatBox");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

function addMessage(text, type) {
    const div = document.createElement("div");
    div.className = "message " + type;
    div.textContent = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

sendBtn.onclick = async () => {
    const msg = userInput.value.trim();
    if (msg === "") return;

    addMessage(msg, "user");
    userInput.value = "";

    const reply = await handleUserMessage(msg);
    addMessage(reply, "bot");
};

userInput.addEventListener("keydown", e => {
    if (e.key === "Enter") sendBtn.click();
});

// رسالة ترحيب
addMessage("أهلاً بك! اكتب سؤالك، أو جرّب: ابحث عن فوائد العسل", "bot");
