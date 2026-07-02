const SHEETS_API = "https://script.google.com/macros/s/AKfycbzDbNIchhQPV7ArylSoycP-Pb9VW-1olZc9WptkW6_q9uH4MjhDQO1EHi7QtpA7JTMA/exec";

let configs = [];
let allowedStudents = [];
let activeMapel = null;
let questions = [];
let currentIndex = 0;
let lastQuestionIndex = -1;
let userAnswers = {};
let doubtful = {};
let timeLeft = 0;
let isExamActive = false;
let violationCount = 0;
let isSubmitting = false;

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch gagal: ${res.status}`);
    return res.json();
}

async function loadConfigData() {
    return fetchJson(`${SHEETS_API}?type=config`);
}

async function loadStudentsData() {
    return fetchJson(`${SHEETS_API}?type=students`);
}

async function loadSoalData(idMapelOrPath) {
    if (!idMapelOrPath) throw new Error("file_soal/id_mapel tidak ditemukan.");

    if (idMapelOrPath.startsWith("data/")) {
        return fetchJson(idMapelOrPath);
    }

    return fetchJson(`${SHEETS_API}?type=soal&id_mapel=${encodeURIComponent(idMapelOrPath)}`);
}

function normalizeQuestion(q) {
    if (q.pilihan && typeof q.pilihan === "object") return q;
    return {
        ...q,
        pilihan: {
            A: q.pilihan_A || "",
            B: q.pilihan_B || "",
            C: q.pilihan_C || "",
            D: q.pilihan_D || "",
            E: q.pilihan_E || ""
        }
    };
}

window.onload = async () => {
    try {
        configs = await loadConfigData();
        const select = document.getElementById("mapelSelect");

        select.innerHTML = '<option value="">Pilih Mata Pelajaran...</option>';
        configs.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.id_mapel;
            opt.textContent = m.nama_mapel;
            select.appendChild(opt);
        });

        allowedStudents = await loadStudentsData();
    } catch (e) {
        console.error("Gagal memuat config atau siswa", e);
        alert("Gagal memuat data. Periksa koneksi atau setting Google Sheets endpoint.");
    }
};

document.getElementById("btnStart").onclick = async () => {
    const nama = document.getElementById("nama").value.trim();
    const nomor = document.getElementById("nomor").value.trim();
    const sekolah = document.getElementById("sekolah").value.trim();
    const idMapel = document.getElementById("mapelSelect").value;
    const token = document.getElementById("tokenInput").value.trim();

    if (!nama || !nomor || !sekolah || !idMapel || !token) {
        return alert("Harap lengkapi semua data dan pilih mata pelajaran!");
    }

    if (allowedStudents.length === 0) {
        return alert("Data peserta belum siap atau gagal dimuat. Silakan muat ulang halaman.");
    }

    activeMapel = configs.find(c => c.id_mapel === idMapel);
    if (!activeMapel) return alert("Data mata pelajaran tidak valid!");

    const isAllowed = allowedStudents.some(s =>
        String(s.nomor).trim() === nomor &&
        String(s.nama).toLowerCase().trim() === nama.toLowerCase()
    );
    if (!isAllowed) return alert("Maaf, Nama atau Nomor Ujian Anda tidak terdaftar sebagai peserta!");

    if (String(activeMapel.token).toUpperCase() !== token.toUpperCase()) return alert("Token Salah!");

    try {
        const soalKey = activeMapel.file_soal && !activeMapel.file_soal.startsWith("data/")
            ? activeMapel.file_soal
            : activeMapel.id_mapel;

        const loaded = await loadSoalData(soalKey);
        questions = Array.isArray(loaded) ? loaded.map(normalizeQuestion) : [];

        if (questions.length === 0) {
            throw new Error("Soal kosong atau format soal tidak valid.");
        }

        timeLeft = (parseInt(activeMapel.duration_minutes, 10) || 60) * 60;

        document.getElementById("loginScreen").classList.add("hidden");
        document.getElementById("examScreen").classList.remove("hidden");

        const dispNama = document.getElementById("dispNama");
        if (dispNama) dispNama.textContent = nama;

        isExamActive = true;
        renderQuestion();
        renderNav();
        startTimer();
        document.documentElement.requestFullscreen().catch(() => {});
    } catch (e) {
        console.error("Fetch error:", e);
        alert("Terjadi kesalahan saat memuat soal. Periksa console dan pastikan endpoint sudah benar.");
    }
};

function renderQuestion() {
    const card = document.querySelector(".question-card");
    if (card && currentIndex !== lastQuestionIndex) {
        card.classList.remove("question-slide-active");
        void card.offsetWidth;
        card.classList.add("question-slide-active");
        lastQuestionIndex = currentIndex;
    }

    const q = questions[currentIndex];
    if (!q) return;

    document.getElementById("qNumber").textContent = currentIndex + 1;
    document.getElementById("qText").textContent = q.soal;

    const grid = document.getElementById("optionsGrid");
    grid.innerHTML = "";

    Object.entries(q.pilihan).forEach(([key, val]) => {
        const isActive = userAnswers[currentIndex] === key;
        const btn = document.createElement("button");
        btn.className = `option-item ${isActive ? "active" : ""}`;
        btn.innerHTML = `<span class="option-key">${key}</span> <span class="option-text">${val}</span>`;
        btn.onclick = () => {
            if (!isExamActive) return;
            userAnswers[currentIndex] = key;
            renderQuestion();
            renderNav();
        };
        grid.appendChild(btn);
    });

    const checkbox = document.getElementById("checkRagu");
    checkbox.checked = doubtful[currentIndex] || false;
    checkbox.onchange = (e) => {
        if (!isExamActive) return;
        doubtful[currentIndex] = e.target.checked;
        renderNav();
    };
}

function changeQuestion(step) {
    const newIdx = currentIndex + step;
    if (newIdx >= 0 && newIdx < questions.length) {
        currentIndex = newIdx;
        renderQuestion();
        renderNav();
    }
}

function renderNav() {
    const grid = document.getElementById("navGrid");
    grid.innerHTML = "";

    let terjawab = 0;
    let ragu = 0;
    let belum = 0;

    questions.forEach((_, i) => {
        const btn = document.createElement("button");

        if (doubtful[i]) {
            ragu++;
        } else if (userAnswers[i]) {
            terjawab++;
        } else {
            belum++;
        }

        let statusClass = "";
        if (userAnswers[i]) statusClass = "answered";
        if (doubtful[i]) statusClass = "doubtful";
        if (i === currentIndex) statusClass += " current";

        btn.className = statusClass;
        btn.textContent = i + 1;
        btn.onclick = () => {
            currentIndex = i;
            renderQuestion();
            renderNav();
            if (window.innerWidth < 1024) {
                document.getElementById("navSidebar").classList.remove("active");
            }
        };
        grid.appendChild(btn);
    });

    document.getElementById("statTerjawab").textContent = terjawab;
    document.getElementById("statRagu").textContent = ragu;
    document.getElementById("statBelum").textContent = belum;

    const answeredCount = Object.keys(userAnswers).length;
    const progress = questions.length ? (answeredCount / questions.length) * 100 : 0;
    document.getElementById("progressBar").style.width = `${progress}%`;
}

function startTimer() {
    const clock = setInterval(() => {
        if (!isExamActive) return clearInterval(clock);
        timeLeft--;
        const h = Math.floor(timeLeft / 3600).toString().padStart(2, "0");
        const m = Math.floor((timeLeft % 3600) / 60).toString().padStart(2, "0");
        const s = (timeLeft % 60).toString().padStart(2, "0");
        document.getElementById("timer").textContent = `${h}:${m}:${s}`;
        if (timeLeft <= 0) finishExam(true);
    }, 1000);
}

let finishInterval = null;

async function finishExam(isAuto = false) {
    if (isSubmitting) return;

    if (isAuto) {
        isExamActive = false;
        isSubmitting = true;
        alert("Waktu habis atau batas pelanggaran tercapai! Jawaban Anda sedang dikirim secara otomatis.");
        await executeSubmission();
        return;
    }

    const overlay = document.getElementById("finishOverlay");
    const countdownEl = document.getElementById("finishCountdown");
    const btnYa = document.getElementById("btnConfirmFinish");

    overlay.classList.remove("hidden");
    let waitTime = 15;
    countdownEl.textContent = waitTime;
    btnYa.disabled = true;
    btnYa.classList.add("opacity-50", "cursor-not-allowed");

    clearInterval(finishInterval);
    finishInterval = setInterval(() => {
        waitTime--;
        if (waitTime >= 0) countdownEl.textContent = waitTime;

        if (waitTime <= 0) {
            clearInterval(finishInterval);
            countdownEl.textContent = "✓";
            btnYa.disabled = false;
            btnYa.classList.remove("opacity-50", "cursor-not-allowed");
        }
    }, 1000);

    btnYa.onclick = async () => {
        isExamActive = false;
        isSubmitting = true;
        overlay.classList.add("hidden");
        await executeSubmission();
    };
}

function closeFinishOverlay() {
    clearInterval(finishInterval);
    document.getElementById("finishOverlay").classList.add("hidden");
}

async function executeSubmission() {
    let benar = 0;
    let salah = 0;
    let kosong = 0;

    questions.forEach((q, i) => {
        if (!userAnswers[i]) {
            kosong++;
        } else if (userAnswers[i] === q.kunci) {
            benar++;
        } else {
            salah++;
        }
    });

    const nilai = Math.round((benar / questions.length) * 100);

    document.getElementById("finalScore").textContent = nilai;
    document.getElementById("resBenar").textContent = benar;
    document.getElementById("resSalah").textContent = salah;
    document.getElementById("resKosong").textContent = kosong;

    const body = new FormData();
    body.append(activeMapel.entry_nama, document.getElementById("nama").value);
    body.append(activeMapel.entry_nomor, document.getElementById("nomor").value);
    body.append(activeMapel.entry_asal_sekolah, document.getElementById("sekolah").value);
    body.append(activeMapel.entry_nilai, nilai);

    try {
        await fetch(activeMapel.url_form, { method: "POST", mode: "no-cors", body });
        document.getElementById("examScreen").classList.add("hidden");
        document.getElementById("resultScreen").classList.remove("hidden");

        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    } catch (e) {
        console.error("Submit error:", e);
        alert("Gagal mengirim data. Coba lagi atau hubungi admin.");
        isSubmitting = false;
    }
}

document.getElementById("btnFinish").onclick = () => finishExam();

function toggleSidebar() {
    document.getElementById("navSidebar").classList.toggle("active");
}

function toggleMinimizePC() {
    const sidebar = document.getElementById("navSidebar");
    sidebar.classList.toggle("minimized");
    const btnMinimize = document.getElementById("btnMinimizeNav");
    if (btnMinimize) {
        btnMinimize.textContent = sidebar.classList.contains("minimized") ? "»" : "«";
    }
}

document.getElementById("btnToggleNav").onclick = toggleSidebar;
document.getElementById("btnMinimizeNav").onclick = toggleMinimizePC;

let violationCooldown = false;

function handleViolation(reason) {
    if (!isExamActive || isSubmitting || violationCooldown) return;

    violationCooldown = true;
    setTimeout(() => violationCooldown = false, 1000);

    violationCount++;
    document.getElementById("violationCount").textContent = violationCount;

    if (violationCount >= 3) {
        finishExam(true);
    } else {
        document.getElementById("cheatOverlay").classList.remove("hidden");
        document.getElementById("violationWarning").textContent =
            `Peringatan ke-${violationCount}: ${reason}. Setelah 3 kali pelanggaran, sistem akan mengirim jawaban secara otomatis.`;
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden && isExamActive && !isSubmitting) {
        handleViolation("Anda terdeteksi meninggalkan tab atau meminimalkan browser");
    }
});

window.addEventListener("blur", () => {
    if (isExamActive && !isSubmitting) {
        handleViolation("Anda terdeteksi berpindah ke aplikasi lain");
    }
});

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && isExamActive && !isSubmitting) {
        handleViolation("Anda terdeteksi keluar dari mode layar penuh (fullscreen)");
    }
});

document.addEventListener("keydown", e => {
    if (!isExamActive || isSubmitting) return;

    const forbiddenKeys = ["u", "i", "j", "s", "p", "c", "v"];
    const isForbiddenShortcut = e.ctrlKey && forbiddenKeys.includes(e.key.toLowerCase());
    const isDevTools = e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C"));

    if (isForbiddenShortcut || isDevTools) {
        e.preventDefault();
        handleViolation(`Menggunakan pintasan keyboard terlarang (${e.key})`);
        return false;
    }
});

window.addEventListener("beforeunload", e => {
    if (isExamActive && !isSubmitting) {
        e.preventDefault();
        e.returnValue = "";
    }
});

window.closeOverlay = () => {
    document.getElementById("cheatOverlay").classList.add("hidden");
    document.documentElement.requestFullscreen().catch(() => {});
};

document.addEventListener("contextmenu", e => e.preventDefault());
