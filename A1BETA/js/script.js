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

// 1. Inisialisasi: Load Config
window.onload = async () => {
    try {
        const res = await fetch('data/config.json');
        configs = await res.json();
        const select = document.getElementById('mapelSelect');
        
        // Bersihkan pilihan kecuali placeholder agar data tidak duplikat
        select.innerHTML = '<option value="">Pilih Mata Pelajaran...</option>';
        
        configs.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id_mapel;
            opt.textContent = m.nama_mapel;
            select.appendChild(opt);
        });

        // Memuat daftar siswa yang diizinkan (whitelist)
        const resSiswa = await fetch('data/students.json');
        allowedStudents = await resSiswa.json();
    } catch (e) { console.error("Gagal memuat config", e); }
};

// 2. Memulai Ujian
document.getElementById('btnStart').onclick = async () => {
    const nama = document.getElementById('nama').value.trim();
    const nomor = document.getElementById('nomor').value.trim();
    const sekolah = document.getElementById('sekolah').value.trim();
    const idMapel = document.getElementById('mapelSelect').value;
    const token = document.getElementById('tokenInput').value.trim();

    if(!nama || !nomor || !sekolah || !idMapel || !token) {
        return alert("Harap lengkapi semua data dan pilih mata pelajaran!");
    }

    if (allowedStudents.length === 0) {
        return alert("Data peserta belum siap atau gagal dimuat. Silakan muat ulang halaman.");
    }

    activeMapel = configs.find(c => c.id_mapel === idMapel);
    if (!activeMapel) return alert("Data mata pelajaran tidak valid!");

    // Filter Siswa: Cek apakah Nama dan Nomor ada di dalam daftar yang diizinkan
    const isAllowed = allowedStudents.some(s => 
        String(s.nomor).trim() === nomor && 
        String(s.nama).toLowerCase().trim() === nama.toLowerCase()
    );
    if (!isAllowed) return alert("Maaf, Nama atau Nomor Ujian Anda tidak terdaftar sebagai peserta!");
    
    if(activeMapel.token.toUpperCase() !== token.toUpperCase()) return alert("Token Salah!");

    try {
        const res = await fetch(activeMapel.file_soal);
        questions = await res.json();
        
        // Mengambil durasi dari config (asumsi dalam menit) dan ubah ke detik
        timeLeft = (parseInt(activeMapel.duration_minutes) || 60) * 60;

        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('examScreen').classList.remove('hidden');
        
        const dispNama = document.getElementById('dispNama');
        if (dispNama) dispNama.textContent = nama;
        
        isExamActive = true;
        renderQuestion();
        renderNav();
        startTimer();
        document.documentElement.requestFullscreen().catch(() => {});
    } catch (e) { 
        console.error("Fetch error:", e);
        alert("Terjadi kesalahan saat memuat soal. Pastikan:\n" +
              "1. File JSON soal ada di folder 'data/'\n" +
              "2. Format JSON soal sudah benar\n" +
              "3. Kamu menjalankan aplikasi menggunakan Live Server (HTTP)"); 
    }
};

// 3. Render Soal
function renderQuestion() {
    const card = document.querySelector('.question-card');
    // Hanya jalankan animasi jika nomor soal benar-benar berubah
    if (card && currentIndex !== lastQuestionIndex) {
        card.classList.remove('question-slide-active');
        void card.offsetWidth; // Trigger reflow untuk mengulang animasi
        card.classList.add('question-slide-active');
        lastQuestionIndex = currentIndex;
    }

    const q = questions[currentIndex];
    document.getElementById('qNumber').textContent = currentIndex + 1;
    document.getElementById('qText').textContent = q.soal;
    
    const grid = document.getElementById('optionsGrid');
    grid.innerHTML = '';

    Object.entries(q.pilihan).forEach(([key, val]) => {
        const isActive = userAnswers[currentIndex] === key;
        const btn = document.createElement('button');
        btn.className = `option-item ${isActive ? 'active' : ''}`;
        btn.innerHTML = `<span class="option-key">${key}</span> <span class="option-text">${val}</span>`;
        btn.onclick = () => {
            if (!isExamActive) return;
            userAnswers[currentIndex] = key;
            renderQuestion();
            renderNav();
        };
        grid.appendChild(btn);
    });

    document.getElementById('checkRagu').checked = doubtful[currentIndex] || false;
    document.getElementById('checkRagu').onchange = (e) => {
        if (!isExamActive) return;
        doubtful[currentIndex] = e.target.checked;
        renderNav();
    };
}

// 4. Navigasi
function changeQuestion(step) {
    const newIdx = currentIndex + step;
    if(newIdx >= 0 && newIdx < questions.length) {
        currentIndex = newIdx;
        renderQuestion();
        renderNav();
    }
}

function renderNav() {
    const grid = document.getElementById('navGrid');
    grid.innerHTML = '';
    
    let terjawab = 0;
    let ragu = 0;
    let belum = 0;

    questions.forEach((_, i) => {
        const btn = document.createElement('button');
        
        // Calculate counts
        if (doubtful[i]) {
            ragu++;
        } else if (userAnswers[i]) {
            terjawab++;
        } else {
            belum++;
        }

        let statusClass = '';
        if(userAnswers[i]) statusClass = 'answered';
        if(doubtful[i]) statusClass = 'doubtful';
        if(i === currentIndex) statusClass += ' current';

        btn.className = statusClass;
        btn.textContent = i + 1;
        btn.onclick = () => { 
            currentIndex = i; 
            renderQuestion(); 
            renderNav(); 
            // Tutup sidebar otomatis di mobile setelah memilih soal
            if (window.innerWidth < 1024) {
                document.getElementById('navSidebar').classList.remove('active');
            }
        };
        grid.appendChild(btn);
    });

    // Update status counters
    document.getElementById('statTerjawab').textContent = terjawab;
    document.getElementById('statRagu').textContent = ragu;
    document.getElementById('statBelum').textContent = belum;

    // Update Progress Bar
    const answeredCount = Object.keys(userAnswers).length;
    const progress = (answeredCount / questions.length) * 100;
    document.getElementById('progressBar').style.width = `${progress}%`;
}

// 5. Timer & Submit ke Google Form
function startTimer() {
    const clock = setInterval(() => {
        if(!isExamActive) return clearInterval(clock);
        timeLeft--;
        const h = Math.floor(timeLeft / 3600).toString().padStart(2, '0');
        const m = Math.floor((timeLeft % 3600) / 60).toString().padStart(2, '0');
        const s = (timeLeft % 60).toString().padStart(2, '0');
        document.getElementById('timer').textContent = `${h}:${m}:${s}`;
        if(timeLeft <= 0) finishExam(true);
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

    // Tampilkan Modal Konfirmasi Kustom
    const overlay = document.getElementById('finishOverlay');
    const countdownEl = document.getElementById('finishCountdown');
    const btnYa = document.getElementById('btnConfirmFinish');
    
    overlay.classList.remove('hidden');
    let waitTime = 15;
    countdownEl.textContent = waitTime;
    btnYa.disabled = true;
    btnYa.classList.add('opacity-50', 'cursor-not-allowed');

    clearInterval(finishInterval);
    finishInterval = setInterval(() => {
        waitTime--;
        if (waitTime >= 0) countdownEl.textContent = waitTime;
        
        if (waitTime <= 0) {
            clearInterval(finishInterval);
            countdownEl.textContent = "✓";
            btnYa.disabled = false;
            btnYa.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }, 1000);

    btnYa.onclick = async () => {
        isExamActive = false;
        isSubmitting = true;
        overlay.classList.add('hidden');
        await executeSubmission();
    };
}

function closeFinishOverlay() {
    clearInterval(finishInterval);
    document.getElementById('finishOverlay').classList.add('hidden');
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

    // Tampilkan data ke layar hasil
    document.getElementById('finalScore').textContent = nilai;
    document.getElementById('resBenar').textContent = benar;
    document.getElementById('resSalah').textContent = salah;
    document.getElementById('resKosong').textContent = kosong;

    const body = new FormData();
    body.append(activeMapel.entry_nama, document.getElementById('nama').value);
    body.append(activeMapel.entry_nomor, document.getElementById('nomor').value);
    body.append(activeMapel.entry_asal_sekolah, document.getElementById('sekolah').value);
    body.append(activeMapel.entry_nilai, nilai);

    try {
        await fetch(activeMapel.url_form, { method: 'POST', mode: 'no-cors', body });
        
        // Sembunyikan layar ujian dan tampilkan layar hasil
        document.getElementById('examScreen').classList.add('hidden');
        document.getElementById('resultScreen').classList.remove('hidden');
        
        // Keluar dari fullscreen jika masih aktif
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    } catch (e) {
        console.error("Submit error:", e);
        alert("Gagal mengirim data. Coba lagi atau hubungi admin.");
        isSubmitting = false;
    }
}

document.getElementById('btnFinish').onclick = () => finishExam();

function toggleSidebar() {
    const sidebar = document.getElementById('navSidebar');
    sidebar.classList.toggle('active');
}

function toggleMinimizePC() {
    const sidebar = document.getElementById('navSidebar');
    sidebar.classList.toggle('minimized');
    const btnMinimize = document.getElementById('btnMinimizeNav');
    if (btnMinimize) {
        btnMinimize.textContent = sidebar.classList.contains('minimized') ? '»' : '«';
    }
}

document.getElementById('btnToggleNav').onclick = toggleSidebar;
document.getElementById('btnMinimizeNav').onclick = toggleMinimizePC;

// 6. Security
let violationCooldown = false;

function handleViolation(reason) {
    if (!isExamActive || isSubmitting || violationCooldown) return;

    // Cooldown 1 detik untuk mencegah trigger beruntun
    violationCooldown = true;
    setTimeout(() => violationCooldown = false, 1000);

    violationCount++;
    document.getElementById('violationCount').textContent = violationCount;

    if (violationCount >= 3) {
        finishExam(true);
    } else {
        document.getElementById('cheatOverlay').classList.remove('hidden');
        document.getElementById('violationWarning').textContent = 
            `Peringatan ke-${violationCount}: ${reason}. Setelah 3 kali pelanggaran, sistem akan mengirim jawaban secara otomatis.`;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden && isExamActive && !isSubmitting) {
        handleViolation("Anda terdeteksi meninggalkan tab atau meminimalkan browser");
    }
});

// Tambahkan deteksi ketika jendela kehilangan fokus (berpindah aplikasi)
window.addEventListener('blur', () => {
    if (isExamActive && !isSubmitting) {
        handleViolation("Anda terdeteksi berpindah ke aplikasi lain");
    }
});

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isExamActive && !isSubmitting) {
        handleViolation("Anda terdeteksi keluar dari mode layar penuh (fullscreen)");
    }
});

// Blokir Pintasan Keyboard (F12, Inspect Element, Print, Copy-Paste, Save)
document.addEventListener('keydown', e => {
    if (!isExamActive || isSubmitting) return;

    const forbiddenKeys = ['u', 'i', 'j', 's', 'p', 'c', 'v'];
    const isForbiddenShortcut = e.ctrlKey && forbiddenKeys.includes(e.key.toLowerCase());
    const isDevTools = e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C'));

    if (isForbiddenShortcut || isDevTools) {
        e.preventDefault();
        handleViolation(`Menggunakan pintasan keyboard terlarang (${e.key})`);
        return false;
    }
});

// Cegah Refresh atau Tutup Halaman Secara Tidak Sengaja
window.addEventListener('beforeunload', (e) => {
    if (isExamActive && !isSubmitting) {
        e.preventDefault();
        e.returnValue = ''; // Standard browser prompt
    }
});

window.closeOverlay = () => {
    document.getElementById('cheatOverlay').classList.add('hidden');
    document.documentElement.requestFullscreen().catch(() => {});
};

document.addEventListener('contextmenu', e => e.preventDefault());