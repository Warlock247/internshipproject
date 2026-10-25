/**
 * ===================================================================
 * DATABASE LAYER (database.js)
 * Clean, minimal, and beginner-friendly data store using localStorage.
 * ===================================================================
 */

// Storage keys in localStorage
const DB_KEYS = {
  ACCOUNTS: 'internship_accounts',
  SUBMISSIONS: 'internship_submissions',
  LOGBOOK: 'internship_logbook',
  OTP: 'internship_pending_otp',
};

// --- 1. GENERIC STORAGE HELPERS ---
function dbGet(key, fallback = []) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch (err) {
    return fallback;
  }
}

function dbSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error('Storage quota or error:', err);
  }
}

// --- 2. STUDENT ACCOUNTS & AUTHENTICATION ---
function isValidMatric(matric) {
  return /^\d{9}$/.test((matric || '').trim());
}

function getAccount(matric) {
  const clean = (matric || '').trim();
  return dbGet(DB_KEYS.ACCOUNTS).find(a => a.matric === clean) || null;
}

function createAccount(surname, firstName, matric, email) {
  const accounts = dbGet(DB_KEYS.ACCOUNTS);
  if (accounts.some(a => a.matric === matric.trim())) {
    return { success: false, message: 'Matric number already registered. Please login.' };
  }
  const newAccount = {
    surname: surname.trim(),
    firstName: firstName.trim(),
    fullName: `${surname.trim()} ${firstName.trim()}`,
    matric: matric.trim(),
    email: email.trim().toLowerCase(),
    password: surname.trim().toLowerCase(), // Surname acts as password
    createdAt: new Date().toISOString(),
  };
  accounts.push(newAccount);
  dbSet(DB_KEYS.ACCOUNTS, accounts);
  return { success: true, account: newAccount };
}

function verifyLogin(matric, password) {
  const account = getAccount(matric);
  if (!account) return { success: false, message: 'Matric number not found. Please sign up.' };
  if (account.password !== (password || '').trim().toLowerCase()) {
    return { success: false, message: 'Incorrect password. Your password is your surname.' };
  }
  return { success: true, account };
}

// --- 3. OTP MANAGEMENT ---
function createOTP(surname, firstName, matric, email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const otpData = {
    code,
    surname: surname.trim(),
    firstName: firstName.trim(),
    matric: matric.trim(),
    email: email.trim().toLowerCase(),
    expiresAt: Date.now() + 120000, // 2 minutes
  };
  dbSet(DB_KEYS.OTP, otpData);
  return otpData;
}

function verifyOTP(code) {
  const pending = dbGet(DB_KEYS.OTP, null);
  if (!pending) return { success: false, message: 'No pending OTP verification found.' };
  if (Date.now() > pending.expiresAt) {
    localStorage.removeItem(DB_KEYS.OTP);
    return { success: false, message: 'OTP has expired. Click Resend OTP.' };
  }
  if (pending.code !== (code || '').trim()) {
    return { success: false, message: 'Invalid OTP code. Please check your email and try again.' };
  }
  const result = createAccount(pending.surname, pending.firstName, pending.matric, pending.email);
  localStorage.removeItem(DB_KEYS.OTP);
  return result;
}

// --- 4. INTERNSHIP SUBMISSIONS ---
function getAllSubmissions() {
  return dbGet(DB_KEYS.SUBMISSIONS);
}

function getSubmissionByMatric(matric) {
  const clean = (matric || '').trim();
  const list = getAllSubmissions().filter(s => s.matricNumber === clean);
  return list.length ? list[list.length - 1] : null;
}

function calculateProgress(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (isNaN(start) || isNaN(end) || start >= end) return 0;
  const now = Date.now();
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
}

// Calculate the number of project weeks based on Start and End dates
function calculateDurationWeeks(startDate, endDate) {
  if (!startDate || !endDate) return 12; // Default 12 weeks
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 12;
  const diffDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  return Math.max(1, Math.ceil(diffDays / 7));
}

function saveSubmission(record) {
  const list = getAllSubmissions();
  const cleanMatric = record.matricNumber.trim();
  const index = list.findIndex(s => s.matricNumber === cleanMatric);

  let saved;
  if (index !== -1) {
    // Resubmit / update
    saved = {
      ...list[index],
      ...record,
      status: 'Pending',
      lecturerFeedback: '',
      updatedAt: new Date().toISOString(),
    };
    list[index] = saved;
  } else {
    // Brand new submission
    saved = {
      id: Date.now(),
      status: 'Pending',
      submittedAt: new Date().toISOString(),
      ...record,
    };
    list.push(saved);
  }
  dbSet(DB_KEYS.SUBMISSIONS, list);
  return saved;
}

function updateSubmissionStatus(id, newStatus, feedback = '') {
  const list = getAllSubmissions().map(item => {
    if (String(item.id) === String(id)) {
      return {
        ...item,
        status: newStatus,
        lecturerFeedback: feedback || item.lecturerFeedback || '',
        statusUpdatedAt: new Date().toISOString(),
      };
    }
    return item;
  });
  dbSet(DB_KEYS.SUBMISSIONS, list);
}

// --- 5. DASHBOARD KPI ANALYTICS ---
function getKpiStats() {
  const all = getAllSubmissions();
  return {
    total: all.length,
    pending: all.filter(s => (s.status || 'Pending') === 'Pending').length,
    accepted: all.filter(s => s.status === 'Accepted').length,
    denied: all.filter(s => s.status === 'Denied').length,
  };
}

// --- 6. WEEKLY SIWES LOGBOOK ---
function getLogEntries(matric) {
  const clean = (matric || '').trim();
  return dbGet(DB_KEYS.LOGBOOK).filter(l => l.matric === clean);
}

function saveLogEntry(entry) {
  const logs = dbGet(DB_KEYS.LOGBOOK);
  const newEntry = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    ...entry,
    images: Array.isArray(entry.images) ? entry.images : [],
    approved: Boolean(entry.approved),
  };
  logs.push(newEntry);
  dbSet(DB_KEYS.LOGBOOK, logs);

  const relatedSubmission = getSubmissionByMatric(entry.matric);
  if (relatedSubmission) {
    const list = getAllSubmissions().map(item => {
      if (item.matricNumber === entry.matric) {
        return {
          ...item,
          logbookStatus: 'Awaiting lecturer approval',
          logbookApproved: false,
          updatedAt: new Date().toISOString(),
        };
      }
      return item;
    });
    dbSet(DB_KEYS.SUBMISSIONS, list);
  }

  return newEntry;
}

function markLogbookApproved(matric, feedback = 'Approved by lecturer') {
  const list = getAllSubmissions().map(item => {
    if (item.matricNumber === matric) {
      return {
        ...item,
        logbookApproved: true,
        logbookStatus: 'Approved',
        lecturerLogbookFeedback: feedback,
        logbookApprovedAt: new Date().toISOString(),
      };
    }
    return item;
  });
  dbSet(DB_KEYS.SUBMISSIONS, list);
}

// --- 7. CSV EXPORT ---
function exportSubmissionsCsv() {
  const data = getAllSubmissions();
  if (!data.length) return alert('No submissions to export.');

  const headers = ['Full Name', 'Matric', 'Department', 'School', 'Company', 'Phone', 'Supervisor', 'Start Date', 'End Date', 'Status', 'Feedback', 'Submitted At'];
  const esc = val => `"${String(val || '').replace(/"/g, '""')}"`;

  const rows = data.map(s => [
    esc(s.fullName), esc(s.matricNumber), esc(s.department), esc(s.school),
    esc(s.companyName), esc(s.companyPhone), esc(s.supervisor),
    esc(s.startDate), esc(s.endDate), esc(s.status || 'Pending'),
    esc(s.lecturerFeedback || ''), esc(s.submittedAt || '')
  ].join(','));

  const csvBlob = new Blob([headers.join(',') + '\n' + rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(csvBlob);
  a.download = `internship_report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
