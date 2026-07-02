const SHEET_NAMES = {
  config: 'config',
  students: 'students',
  soal: 'soal',
  results: 'results'
};

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length === 0) return [];
  const header = rows.shift();
  return rows.map(row => {
    const item = {};
    header.forEach((col, idx) => item[col] = row[idx]);
    return item;
  });
}

function getConfig() {
  return getSheetData(SHEET_NAMES.config);
}

function getStudents() {
  return getSheetData(SHEET_NAMES.students);
}

function getSoal(idMapel) {
  const all = getSheetData(SHEET_NAMES.soal);
  return all
    .filter(row => String(row.id_mapel).trim() === String(idMapel).trim())
    .map(row => ({
      id: row.id,
      soal: row.soal,
      pilihan: {
        A: row.pilihan_A,
        B: row.pilihan_B,
        C: row.pilihan_C,
        D: row.pilihan_D,
        E: row.pilihan_E
      },
      kunci: row.kunci
    }));
}

function getAvailableMapel() {
  return getConfig().map(row => ({
    id_mapel: row.id_mapel,
    nama_mapel: row.nama_mapel,
    duration: row.duration_minutes
  }));
}

function findStudent(nama, nomor, sekolah) {
  const normalizedNama = String(nama).toLowerCase().trim();
  const normalizedNomor = String(nomor).trim();
  const normalizedSekolah = String(sekolah).toLowerCase().trim();

  return getStudents().find(row => 
    String(row.nomor).trim() === normalizedNomor &&
    String(row.nama).toLowerCase().trim() === normalizedNama &&
    String(row.sekolah || '').toLowerCase().trim() === normalizedSekolah
  );
}

function validateMapelToken(idMapel, token) {
  const mapel = getConfig().find(row => String(row.id_mapel).trim() === String(idMapel).trim());
  if (!mapel) return null;
  if (String(mapel.token || '').trim().toUpperCase() !== String(token || '').trim().toUpperCase()) return null;
  return mapel;
}

/**
 * Dipanggil oleh client via google.script.run
 * payload: { nama, nomor, sekolah, id_mapel, token }
 */
function prepareExam(payload) {
  if (!payload || !payload.nama || !payload.nomor || !payload.sekolah || !payload.id_mapel || !payload.token) {
    return { success: false, message: 'Data peserta atau mapel tidak lengkap.' };
  }

  const student = findStudent(payload.nama, payload.nomor, payload.sekolah);
  if (!student) {
    return { success: false, message: 'Nama, nomor, atau sekolah tidak terdaftar.' };
  }

  const mapel = validateMapelToken(payload.id_mapel, payload.token);
  if (!mapel) {
    return { success: false, message: 'Token mata pelajaran tidak valid.' };
  }

  const questions = getSoal(payload.id_mapel);
  if (!questions.length) {
    return { success: false, message: 'Soal tidak ditemukan untuk mapel ini.' };
  }

  // Hapus kunci jawaban sebelum mengirim ke client
  const safeQuestions = questions.map(q => ({ id: q.id, soal: q.soal, pilihan: q.pilihan }));

  return {
    success: true,
    mapel: {
      id_mapel: mapel.id_mapel,
      nama_mapel: mapel.nama_mapel,
      duration: mapel.duration_minutes
    },
    questions: safeQuestions
  };
}

function appendResult(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.results);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.results);
    sheet.appendRow([
      'timestamp', 'nama', 'nomor', 'sekolah',
      'id_mapel', 'nama_mapel', 'score',
      'benar', 'salah', 'kosong', 'answers_json'
    ]);
  }

  sheet.appendRow([
    new Date(),
    payload.nama,
    payload.nomor,
    payload.sekolah,
    payload.id_mapel,
    payload.nama_mapel || '',
    payload.score,
    payload.stats?.benar || 0,
    payload.stats?.salah || 0,
    payload.stats?.kosong || 0,
    JSON.stringify(payload.answers || {})
  ]);
}

/**
 * Dipanggil oleh client via google.script.run untuk menyimpan hasil
 * payload: { nama, nomor, sekolah, id_mapel, score, stats, answers }
 */
function submitExamResult(payload) {
  if (!payload || !payload.nama || !payload.nomor || !payload.sekolah || !payload.id_mapel) {
    return { success: false, message: 'Data pengiriman tidak lengkap.' };
  }

  try {
    const mapel = getConfig().find(row => String(row.id_mapel).trim() === String(payload.id_mapel).trim());
    appendResult({
      ...payload,
      nama_mapel: mapel ? mapel.nama_mapel : ''
    });
    return { success: true };
  } catch (err) {
    return { success: false, message: 'Gagal menyimpan hasil ujian: ' + err.message };
  }
}

/**
 * Tetap sediakan endpoint JSON (opsional) bila ingin fetch langsung dari client.
 * Namun disarankan supaya client dijalankan lewat HtmlService dan memanggil fungsi server via google.script.run
 */
function doGet(e) {
  const type = (e.parameter.type || '').toLowerCase();
  const idMapel = e.parameter.id_mapel;

  if (type === 'config') return jsonResponse(getConfig());
  if (type === 'students') return jsonResponse(getStudents());
  if (type === 'soal' && idMapel) return jsonResponse(getSoal(idMapel));

  return jsonResponse({ error: 'Parameter salah. Gunakan ?type=config, ?type=students, atau ?type=soal&id_mapel=QH-01' });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var content = null;
    if (e.postData && e.postData.contents) {
      content = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.payload) {
      content = JSON.parse(e.parameter.payload);
    }

    if (!content || !content.action) return jsonResponse({ success: false, message: 'Invalid post payload' });

    if (content.action === 'submit') {
      var res = submitExamResult(content.payload || {});
      return jsonResponse(res);
    }

    return jsonResponse({ success: false, message: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ success: false, message: err.message });
  }
}

