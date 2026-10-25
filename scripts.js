/**
 * ===================================================================
 * UI CONTROLLER (scripts.js)
 * Dashboard layout controller for students and lecturers.
 * ===================================================================
 */

// ===================================================================
// 1. CONFIGURATION & HELPERS
// ===================================================================
const EMAILJS_SERVICE_ID = 'service_s4rqujp';
const EMAILJS_TEMPLATE_ID = 'template_mas8t7o';
const EMAILJS_PUBLIC_KEY = 'sNi2AVf3oBInwdYEe';
const LECTURER_PASSCODE = 'lecturer2026';
const AUTH_SESSION_KEY = 'internship_active_session';

let currentStudent = null; // Currently logged-in student account
let currentRole = null;    // 'student' or 'lecturer'
let otpCountdownTimer = null;

function saveAuthSession() {
  if (!currentStudent && !currentRole) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return;
  }

  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
    currentStudent,
    currentRole,
  }));
}

function restoreAuthSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    if (!stored) return false;

    if (stored.currentRole === 'student' && stored.currentStudent) {
      currentStudent = stored.currentStudent;
      currentRole = 'student';
      launchStudentDashboard(currentStudent);
      return true;
    }

    if (stored.currentRole === 'lecturer') {
      currentStudent = null;
      currentRole = 'lecturer';
      launchLecturerDashboard();
      return true;
    }
  } catch (error) {
    console.warn('Failed to restore session:', error);
    localStorage.removeItem(AUTH_SESSION_KEY);
  }

  return false;
}

// Send email using EmailJS (template variables: {{to_email}} and {{otp_code}})
async function sendOtpEmail(toEmail, otpCode, studentName) {
  if (typeof emailjs === 'undefined') {
    throw new Error('EmailJS SDK not loaded.');
  }
  return emailjs.send(
    EMAILJS_SERVICE_ID,
    EMAILJS_TEMPLATE_ID,
    {
      to_email: toEmail,
      otp_code: otpCode,
      to_name: studentName || 'Student',
    },
    EMAILJS_PUBLIC_KEY
  );
}

// Convert uploaded file to Base64 data URL
function fileToDataUrl(file) {
  return new Promise(resolve => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function setAuthError(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

// ===================================================================
// 2. THEME CONTROLLER (DARK / LIGHT MODE)
// ===================================================================
function initTheme() {
  const saved = localStorage.getItem('portal_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('portal_theme', next);
}

document.getElementById('themeToggleBtnAuth')?.addEventListener('click', toggleTheme);
document.getElementById('themeToggleBtnDash')?.addEventListener('click', toggleTheme);
initTheme();

// ===================================================================
// 3. AUTHENTICATION & OTP (LOGIN & SIGN UP)
// ===================================================================
const authWrapper = document.getElementById('authWrapper');
const dashboardShell = document.getElementById('dashboardShell');

const studentLoginBtn = document.getElementById('studentLoginButton');
const studentSignupBtn = document.getElementById('studentSignupButton');
const lecturerRoleBtn = document.getElementById('lecturerRoleButton');

const studentLoginForm = document.getElementById('studentLoginForm');
const studentSignupForm = document.getElementById('studentSignupForm');
const otpVerifySection = document.getElementById('otpVerifySection');
const otpVerifyForm = document.getElementById('otpVerifyForm');
const lecturerLoginForm = document.getElementById('lecturerLoginForm');

function switchAuthTab(tab) {
  [studentLoginBtn, studentSignupBtn, lecturerRoleBtn].forEach(b => b.classList.remove('active'));
  [studentLoginForm, studentSignupForm, otpVerifySection, lecturerLoginForm].forEach(f => {
    f.classList.remove('active');
    f.classList.add('hidden');
  });

  setAuthError('signupError', null);
  setAuthError('otpError', null);
  document.getElementById('forgotMessage').classList.add('hidden');

  if (tab === 'login') {
    studentLoginBtn.classList.add('active');
    studentLoginForm.classList.add('active');
    studentLoginForm.classList.remove('hidden');
  } else if (tab === 'signup') {
    studentSignupBtn.classList.add('active');
    studentSignupForm.classList.add('active');
    studentSignupForm.classList.remove('hidden');
  } else if (tab === 'otp') {
    studentSignupBtn.classList.add('active');
    otpVerifySection.classList.add('active');
    otpVerifySection.classList.remove('hidden');
  } else if (tab === 'lecturer') {
    lecturerRoleBtn.classList.add('active');
    lecturerLoginForm.classList.add('active');
    lecturerLoginForm.classList.remove('hidden');
  }
}

studentLoginBtn.addEventListener('click', () => switchAuthTab('login'));
studentSignupBtn.addEventListener('click', () => switchAuthTab('signup'));
lecturerRoleBtn.addEventListener('click', () => switchAuthTab('lecturer'));

document.getElementById('forgotPasswordButton').addEventListener('click', () => {
  document.getElementById('forgotMessage').classList.toggle('hidden');
});

// Step 1: Sign up details -> Send OTP
studentSignupForm.addEventListener('submit', async event => {
  event.preventDefault();
  setAuthError('signupError', null);

  const surname = document.getElementById('signupSurname').value.trim();
  const firstName = document.getElementById('signupFirstName').value.trim();
  const matric = document.getElementById('signupMatric').value.trim();
  const email = document.getElementById('signupEmail').value.trim();

  if (!isValidMatric(matric)) {
    return setAuthError('signupError', 'Matric number must be exactly 9 digits.');
  }

  if (getAccount(matric)) {
    return setAuthError('signupError', 'An account with this matric already exists. Please log in.');
  }

  const submitBtn = studentSignupForm.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending OTP...';

    const otpData = createOTP(surname, firstName, matric, email);
    await sendOtpEmail(email, otpData.code, `${surname} ${firstName}`);

    document.getElementById('otpInfoMessage').innerHTML =
      `A 6-digit verification code has been sent to <strong>${email}</strong>. Check inbox & spam folder.`;

    startOtpCountdown(120);
    switchAuthTab('otp');
  } catch (err) {
    console.error('OTP error:', err);
    setAuthError('signupError', `Could not send email: ${err?.text || err?.message || 'Check connection.'}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

// Countdown timer
function startOtpCountdown(seconds) {
  if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  let timeLeft = seconds;
  const countEl = document.getElementById('otpCountdown');
  const timerDiv = document.getElementById('otpTimer');
  const resendBtn = document.getElementById('resendOtpButton');

  countEl.textContent = timeLeft;
  resendBtn.disabled = true;

  otpCountdownTimer = setInterval(() => {
    timeLeft--;
    countEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(otpCountdownTimer);
      timerDiv.innerHTML = '<strong>Code expired.</strong> Click Resend OTP.';
      resendBtn.disabled = false;
    }
  }, 1000);
}

// Step 2: Verify OTP
otpVerifyForm.addEventListener('submit', event => {
  event.preventDefault();
  setAuthError('otpError', null);

  const code = document.getElementById('otpInput').value.trim();
  const result = verifyOTP(code);

  if (!result.success) {
    return setAuthError('otpError', result.message);
  }

  if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  launchStudentDashboard(result.account);
});

// Resend OTP
document.getElementById('resendOtpButton').addEventListener('click', async () => {
  const pending = dbGet(DB_KEYS.OTP, null);
  if (!pending) return switchAuthTab('signup');

  const resendBtn = document.getElementById('resendOtpButton');
  resendBtn.disabled = true;
  resendBtn.textContent = 'Resending...';

  try {
    const newOtp = createOTP(pending.surname, pending.firstName, pending.matric, pending.email);
    await sendOtpEmail(pending.email, newOtp.code, `${pending.surname} ${pending.firstName}`);
    startOtpCountdown(120);
    alert(`New code sent to ${pending.email}.`);
  } catch (err) {
    setAuthError('otpError', 'Failed to resend code.');
    resendBtn.disabled = false;
  }
});

// Student Login
studentLoginForm.addEventListener('submit', event => {
  event.preventDefault();
  const matric = document.getElementById('studentMatric').value.trim();
  const password = document.getElementById('studentPassword').value.trim();

  if (!isValidMatric(matric)) {
    return alert('Matric number must be exactly 9 digits.');
  }

  const result = verifyLogin(matric, password);
  if (!result.success) {
    return alert(result.message);
  }

  document.getElementById('studentPassword').value = '';
  launchStudentDashboard(result.account);
});

// Lecturer Login
lecturerLoginForm.addEventListener('submit', event => {
  event.preventDefault();
  const pass = document.getElementById('lecturerPassword').value.trim();

  if (pass === LECTURER_PASSCODE) {
    document.getElementById('lecturerPassword').value = '';
    launchLecturerDashboard();
  } else {
    alert('Incorrect lecturer passcode.');
  }
});

// Logout
function logout() {
  currentStudent = null;
  currentRole = null;
  localStorage.removeItem(AUTH_SESSION_KEY);

  authWrapper.classList.remove('hidden');
  dashboardShell.classList.add('hidden');
  document.getElementById('dashSidebar').classList.remove('open');

  switchAuthTab('login');
}

document.getElementById('logoutBtn').addEventListener('click', logout);

// ===================================================================
// 4. DASHBOARD SHELL & SIDEBAR NAVIGATION
// ===================================================================
const studentHeaderBadge = document.getElementById('studentHeaderBadge');
const lecturerHeaderBadge = document.getElementById('lecturerHeaderBadge');
const studentSidebarMenu = document.getElementById('studentSidebarMenu');
const lecturerSidebarMenu = document.getElementById('lecturerSidebarMenu');
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const dashSidebar = document.getElementById('dashSidebar');

// Toggle mobile sidebar
if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener('click', () => {
    dashSidebar.classList.toggle('open');
  });
}

// Student views
const viewStudentStatus = document.getElementById('viewStudentStatus');
const viewStudentForm = document.getElementById('viewStudentForm');
const viewStudentLogbook = document.getElementById('viewStudentLogbook');
const viewLecturerDashboard = document.getElementById('viewLecturerDashboard');

function switchDashboardView(viewName) {
  // Hide mobile sidebar if open
  dashSidebar.classList.remove('open');

  // Update active sidebar nav button
  document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
    if (btn.dataset.view === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Hide all sections
  [viewStudentStatus, viewStudentForm, viewStudentLogbook, viewLecturerDashboard].forEach(v => {
    v.classList.add('hidden');
  });

  if (viewName === 'status') {
    viewStudentStatus.classList.remove('hidden');
    renderStudentApplicationStatus();
  } else if (viewName === 'form') {
    viewStudentForm.classList.remove('hidden');
    setupStudentApplicationForm();
  } else if (viewName === 'logbook') {
    viewStudentLogbook.classList.remove('hidden');
    renderStudentLogbookView();
  } else if (viewName === 'slip') {
    openClearanceSlip();
  } else if (viewName === 'lecturer-dash') {
    viewLecturerDashboard.classList.remove('hidden');
    renderLecturerDashboard();
  }
}

// Bind sidebar click events
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    if (view) switchDashboardView(view);
  });
});

// Launch Student Dashboard
function launchStudentDashboard(account) {
  currentStudent = account;
  currentRole = 'student';
  saveAuthSession();

  // Toggle wrappers
  authWrapper.classList.add('hidden');
  dashboardShell.classList.remove('hidden');

  // Header display: Name and 9-digit Matric Number at the top
  studentHeaderBadge.classList.remove('hidden');
  lecturerHeaderBadge.classList.add('hidden');
  document.getElementById('loggedInStudentName').textContent = account.fullName;
  document.getElementById('loggedInMatric').textContent = account.matric;

  // Sidebar menus
  studentSidebarMenu.classList.remove('hidden');
  lecturerSidebarMenu.classList.add('hidden');

  // Load default view
  switchDashboardView('status');
}

// Launch Lecturer Dashboard
function launchLecturerDashboard() {
  currentStudent = null;
  currentRole = 'lecturer';
  saveAuthSession();

  authWrapper.classList.add('hidden');
  dashboardShell.classList.remove('hidden');

  studentHeaderBadge.classList.add('hidden');
  lecturerHeaderBadge.classList.remove('hidden');

  studentSidebarMenu.classList.add('hidden');
  lecturerSidebarMenu.classList.remove('hidden');

  switchDashboardView('lecturer-dash');
}

// ===================================================================
// 5. STUDENT APPLICATION STATUS & EDITING
// ===================================================================
const recordEmpty = document.getElementById('recordEmpty');
const recordDetails = document.getElementById('recordDetails');
const editSubmissionBtn = document.getElementById('editSubmissionBtn');
const viewClearanceTopBtn = document.getElementById('viewClearanceTopBtn');

// Render student's submission status
function renderStudentApplicationStatus() {
  if (!currentStudent) return;
  const sub = getSubmissionByMatric(currentStudent.matric);

  // Update lock indicators in sidebar
  const sideLogbookLock = document.getElementById('sideLogbookLock');
  const sideSlipLock = document.getElementById('sideSlipLock');

  if (sub && sub.status === 'Accepted') {
    sideLogbookLock.textContent = '✅';
    sideSlipLock.textContent = '✅';
  } else {
    sideLogbookLock.textContent = '🔒';
    sideSlipLock.textContent = '🔒';
  }

  if (!sub) {
    recordEmpty.classList.remove('hidden');
    recordDetails.classList.add('hidden');
    editSubmissionBtn.textContent = '📝 Fill Application Form';
    viewClearanceTopBtn.classList.add('hidden');
    return;
  }

  recordEmpty.classList.add('hidden');
  recordDetails.classList.remove('hidden');
  editSubmissionBtn.textContent = '✏️ Edit Submission';

  const progress = calculateProgress(sub.startDate, sub.endDate);
  const status = sub.status || 'Pending';

  document.getElementById('recordFullName').textContent = sub.fullName;
  document.getElementById('recordMatricNumber').textContent = sub.matricNumber;
  document.getElementById('recordDeptSchool').textContent = `${sub.department} (${sub.school})`;
  document.getElementById('recordCompanyName').textContent = sub.companyName;
  document.getElementById('recordCompanyPhone').textContent = sub.companyPhone;
  document.getElementById('recordSupervisor').textContent = sub.supervisor;
  document.getElementById('recordDates').textContent = `${sub.startDate} to ${sub.endDate}`;
  document.getElementById('recordProgressPercent').textContent = `${progress}%`;

  const badge = document.getElementById('recordStatusBadge');
  badge.className = `status-badge status-${status.toLowerCase()}`;
  badge.textContent = status;

  const progressFill = document.getElementById('recordProgressFill');
  progressFill.style.width = `${progress}%`;
  document.getElementById('recordProgressBar').classList.remove('hidden');

  // Lecturer feedback
  const feedbackRow = document.getElementById('recordFeedbackRow');
  if (sub.lecturerFeedback) {
    document.getElementById('recordFeedbackText').textContent = sub.lecturerFeedback;
    feedbackRow.classList.remove('hidden');
  } else {
    feedbackRow.classList.add('hidden');
  }

  // Documents
  document.getElementById('recordAcceptanceForm').innerHTML = sub.acceptanceFileData
    ? `<a href="${sub.acceptanceFileData}" download="${sub.acceptanceForm}" class="file-link">📥 Download</a>
       <button type="button" class="preview-btn" onclick="openPreview('${sub.acceptanceForm}', '${sub.acceptanceFileData}')">👁️ Preview</button>`
    : sub.acceptanceForm || 'None';

  document.getElementById('recordApplicationLetter').innerHTML = sub.applicationLetterData
    ? `<a href="${sub.applicationLetterData}" download="${sub.applicationLetter}" class="file-link">📥 Download</a>
       <button type="button" class="preview-btn" onclick="openPreview('${sub.applicationLetter}', '${sub.applicationLetterData}')">👁️ Preview</button>`
    : sub.applicationLetter || 'None';

  document.getElementById('recordNotes').textContent = sub.notes || 'None';

  // Clearance button visibility
  if (status === 'Accepted') {
    viewClearanceTopBtn.classList.remove('hidden');
  } else {
    viewClearanceTopBtn.classList.add('hidden');
  }
}

// "Edit Submission" button on the submission status page
if (editSubmissionBtn) {
  editSubmissionBtn.addEventListener('click', () => {
    switchDashboardView('form');
  });
}

if (viewClearanceTopBtn) {
  viewClearanceTopBtn.addEventListener('click', () => {
    openClearanceSlip();
  });
}

// Setup and pre-fill application form
function setupStudentApplicationForm() {
  if (!currentStudent) return;
  const sub = getSubmissionByMatric(currentStudent.matric);

  document.getElementById('fullName').value = sub ? sub.fullName : currentStudent.fullName;
  document.getElementById('matricNumber').value = currentStudent.matric;

  if (sub) {
    document.getElementById('formTitle').textContent = '✏️ Edit Internship Application';
    document.getElementById('submitButton').textContent = 'Update Application';

    document.getElementById('department').value = sub.department || '';
    document.getElementById('school').value = sub.school || '';
    document.getElementById('supervisor').value = sub.supervisor || '';
    document.getElementById('companyName').value = sub.companyName || '';
    document.getElementById('companyPhone').value = sub.companyPhone || '';
    document.getElementById('startDate').value = sub.startDate || '';
    document.getElementById('endDate').value = sub.endDate || '';
    document.getElementById('additionalNotes').value = sub.notes || '';

    // Files are optional if retaining existing uploads
    document.getElementById('acceptanceForm').required = !sub.acceptanceFileData;
    document.getElementById('applicationLetter').required = !sub.applicationLetterData;
  } else {
    document.getElementById('formTitle').textContent = 'Internship Application Form';
    document.getElementById('submitButton').textContent = 'Submit Application';
    document.getElementById('acceptanceForm').required = true;
    document.getElementById('applicationLetter').required = true;
  }
}

// Submission Form Handler
const submissionForm = document.getElementById('submissionForm');
submissionForm.addEventListener('submit', async event => {
  event.preventDefault();

  const fullName = document.getElementById('fullName').value.trim();
  const matricNumber = document.getElementById('matricNumber').value.trim();
  const department = document.getElementById('department').value.trim();
  const school = document.getElementById('school').value.trim();
  const supervisor = document.getElementById('supervisor').value.trim();
  const companyName = document.getElementById('companyName').value.trim();
  const companyPhone = document.getElementById('companyPhone').value.trim();
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;
  const notes = document.getElementById('additionalNotes').value.trim();

  if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
    return alert('End Date cannot be earlier than Start Date.');
  }

  const existing = getSubmissionByMatric(matricNumber);
  const submitBtn = document.getElementById('submitButton');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  const acceptFile = document.getElementById('acceptanceForm').files[0];
  const letterFile = document.getElementById('applicationLetter').files[0];

  let acceptanceForm = existing ? existing.acceptanceForm : 'No file';
  let acceptanceFileData = existing ? existing.acceptanceFileData : null;
  if (acceptFile) {
    acceptanceForm = acceptFile.name;
    acceptanceFileData = await fileToDataUrl(acceptFile);
  }

  let applicationLetter = existing ? existing.applicationLetter : 'No file';
  let applicationLetterData = existing ? existing.applicationLetterData : null;
  if (letterFile) {
    applicationLetter = letterFile.name;
    applicationLetterData = await fileToDataUrl(letterFile);
  }

  saveSubmission({
    fullName,
    matricNumber,
    department,
    school,
    supervisor,
    companyName,
    companyPhone,
    startDate,
    endDate,
    acceptanceForm,
    acceptanceFileData,
    applicationLetter,
    applicationLetterData,
    notes,
  });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit Application';
  alert('Application saved successfully!');

  // Return to application status view
  switchDashboardView('status');
});

// ===================================================================
// 6. WEEKLY LOGBOOK (LOCKED UNTIL ACCEPTED + DYNAMIC WEEKS)
// ===================================================================
const logbookForm = document.getElementById('logbookForm');
const logbookList = document.getElementById('logbookList');
const logbookLockedBanner = document.getElementById('logbookLockedBanner');
const logbookUnlockedArea = document.getElementById('logbookUnlockedArea');
const lockedStatusBadge = document.getElementById('lockedStatusBadge');

function renderStudentLogbookView() {
  if (!currentStudent) return;
  const sub = getSubmissionByMatric(currentStudent.matric);

  // RULE: Cannot upload logbook until lecturer accepts submission
  if (!sub || sub.status !== 'Accepted') {
    logbookLockedBanner.classList.remove('hidden');
    logbookUnlockedArea.classList.add('hidden');

    const curStatus = sub ? sub.status : 'Not Submitted';
    lockedStatusBadge.className = `status-badge status-${curStatus.toLowerCase().replace(' ', '')}`;
    lockedStatusBadge.textContent = curStatus;
  } else {
    logbookLockedBanner.classList.add('hidden');
    logbookUnlockedArea.classList.remove('hidden');
    setupLogbookWeeks(sub);

    if (sub.logbookApproved) {
      const approvedNotice = document.createElement('div');
      approvedNotice.className = 'status-banner approved';
      approvedNotice.innerHTML = '✅ Weekly logbook approved by your lecturer.';
      const existingBanner = logbookUnlockedArea.querySelector('.status-banner');
      if (existingBanner) existingBanner.remove();
      logbookUnlockedArea.insertBefore(approvedNotice, logbookUnlockedArea.firstChild.nextSibling);
    } else if (getLogEntries(currentStudent.matric).length) {
      const pendingNotice = document.createElement('div');
      pendingNotice.className = 'status-banner pending';
      pendingNotice.innerHTML = '⏳ Your weekly logbook has been submitted and is awaiting lecturer approval.';
      const existingBanner = logbookUnlockedArea.querySelector('.status-banner');
      if (existingBanner) existingBanner.remove();
      logbookUnlockedArea.insertBefore(pendingNotice, logbookUnlockedArea.firstChild.nextSibling);
    }
  }

  renderLogbookList();
}

// Generate the week options based on project duration
function setupLogbookWeeks(sub) {
  const logWeekSelect = document.getElementById('logWeek');
  const logWeekHelp = document.getElementById('logWeekHelp');
  if (!logWeekSelect) return;

  const totalWeeks = sub ? calculateDurationWeeks(sub.startDate, sub.endDate) : 12;

  logWeekSelect.innerHTML = '<option value="">Select Week</option>';
  for (let w = 1; w <= totalWeeks; w++) {
    const opt = document.createElement('option');
    opt.value = `Week ${w}`;
    opt.textContent = `Week ${w}`;
    logWeekSelect.appendChild(opt);
  }

  if (logWeekHelp && sub && sub.startDate && sub.endDate) {
    logWeekHelp.innerHTML = `Project duration: <strong>${totalWeeks} weeks</strong> (${sub.startDate} to ${sub.endDate}).`;
  }
}

// Auto-fill dates when week is picked
const logWeekSelectEl = document.getElementById('logWeek');
if (logWeekSelectEl) {
  logWeekSelectEl.addEventListener('change', () => {
    if (!currentStudent) return;
    const sub = getSubmissionByMatric(currentStudent.matric);
    if (!sub || !sub.startDate) return;

    const match = logWeekSelectEl.value.match(/Week (\d+)/);
    if (match) {
      const weekNum = parseInt(match[1], 10);
      const start = new Date(sub.startDate);
      if (!isNaN(start.getTime())) {
        const weekStart = new Date(start.getTime() + (weekNum - 1) * 7 * 86400000);
        const weekEnd = new Date(weekStart.getTime() + 4 * 86400000); // Mon - Fri
        const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const datesInput = document.getElementById('logDates');
        if (datesInput) datesInput.value = `${fmt(weekStart)} - ${fmt(weekEnd)}`;
      }
    }
  });
}

// Submit new weekly log entry
logbookForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentStudent) return;

  const sub = getSubmissionByMatric(currentStudent.matric);
  if (!sub || sub.status !== 'Accepted') {
    return alert('Logbook submission is locked. Your placement must be officially Accepted by your lecturer first.');
  }

  const week = document.getElementById('logWeek').value;
  const dates = document.getElementById('logDates').value.trim();
  const tasks = document.getElementById('logTasks').value.trim();
  const skills = document.getElementById('logSkills').value.trim();
  const selectedFiles = Array.from(document.getElementById('logImages').files || []);
  const uploadedImages = await Promise.all(selectedFiles.map(file => fileToDataUrl(file)));

  saveLogEntry({
    matric: currentStudent.matric,
    studentName: currentStudent.fullName,
    week,
    dates,
    tasks,
    skills,
    images: uploadedImages.filter(Boolean),
    approved: false,
  });

  logbookForm.reset();
  renderLogbookList();
  renderStudentLogbookView();
  alert('Weekly log entry saved successfully!');
});

function renderLogbookList() {
  if (!currentStudent) return;
  const logs = getLogEntries(currentStudent.matric);

  if (!logs.length) {
    logbookList.innerHTML = '<p class="record-empty">No weekly log entries recorded yet.</p>';
    return;
  }

  logbookList.innerHTML = logs.map(l => `
    <div class="logbook-entry">
      <span class="log-week-badge">${l.week}</span>
      <small style="color: var(--text-muted); float: right;">Period: ${l.dates}</small>
      <div style="margin: 8px 0;"><strong>Activities:</strong> ${l.tasks}</div>
      <div style="font-size: 0.85rem; color: var(--text-muted);"><strong>Skills Learned:</strong> ${l.skills}</div>
      <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px;">
        ${(Array.isArray(l.images) && l.images.length ? l.images.map(image => `<img src="${image}" alt="${l.week} proof" style="max-width: 120px; max-height: 90px; border-radius: 10px; border: 1px solid #dfe9f2; object-fit: cover;" />`).join('') : '<span style="color: var(--text-muted);">No images uploaded for this week.</span>')}
      </div>
      <div style="margin-top: 8px; font-size: 0.8rem; color: var(--text-muted);">
        ${l.approved ? '✅ Lecturer approved this weekly log.' : '⏳ Pending lecturer approval.'}
      </div>
    </div>
  `).join('');
}

// ===================================================================
// 7. PRINTABLE CLEARANCE SLIP
// ===================================================================
const clearanceModal = document.getElementById('clearanceModal');
const closeSlipBtn = document.getElementById('closeSlipBtn');

function openClearanceSlip() {
  if (!currentStudent) return;
  const sub = getSubmissionByMatric(currentStudent.matric);

  if (!sub || sub.status !== 'Accepted') {
    return alert(`Official Clearance Slip is only unlocked once your internship placement is Accepted.\n(Current Status: ${sub ? sub.status : 'Not Submitted'})`);
  }

  document.getElementById('slipFullName').textContent = sub.fullName;
  document.getElementById('slipMatric').textContent = sub.matricNumber;
  document.getElementById('slipDept').textContent = sub.department;
  document.getElementById('slipSchool').textContent = sub.school;
  document.getElementById('slipCompany').textContent = sub.companyName;
  document.getElementById('slipPhone').textContent = sub.companyPhone;
  document.getElementById('slipSupervisor').textContent = sub.supervisor;
  document.getElementById('slipDates').textContent = `${sub.startDate} to ${sub.endDate}`;
  document.getElementById('slipQrCode').textContent = `SIWES-${sub.matricNumber}-${Date.now().toString().slice(-6)}`;

  clearanceModal.classList.remove('hidden');
}

if (closeSlipBtn) closeSlipBtn.addEventListener('click', () => clearanceModal.classList.add('hidden'));

// ===================================================================
// 8. DOCUMENT PREVIEW MODAL
// ===================================================================
const previewModal = document.getElementById('previewModal');
const previewTitle = document.getElementById('previewTitle');
const previewBody = document.getElementById('previewBody');
const closePreviewBtn = document.getElementById('closePreviewBtn');

function openPreview(filename, dataUrl) {
  if (!dataUrl) return alert('No file data available.');
  previewTitle.textContent = filename || 'Document Preview';

  if (dataUrl.startsWith('data:image/')) {
    previewBody.innerHTML = `<img src="${dataUrl}" alt="Preview" style="max-width:100%; border-radius:8px;" />`;
  } else {
    previewBody.innerHTML = `<iframe src="${dataUrl}" style="width:100%; height:480px; border:none; border-radius:8px;"></iframe>`;
  }
  previewModal.classList.remove('hidden');
}

if (closePreviewBtn) {
  closePreviewBtn.addEventListener('click', () => {
    previewModal.classList.add('hidden');
    previewBody.innerHTML = '';
  });
}

// ===================================================================
// 9. LECTURER DASHBOARD (KPIS, LIVE SEARCH, ACTIONS, OVERTURN, CSV)
// ===================================================================
let lecturerStatusFilter = 'all';
let lecturerSearchTerm = '';

const dbTableBody = document.getElementById('dbTableBody');
const dbMessage = document.getElementById('dbMessage');
const dbSearchInput = document.getElementById('dbSearchInput');
const exportCsvBtn = document.getElementById('exportCsvButton');
const sideExportBtn = document.getElementById('sideExportBtn');
const filterPills = document.querySelectorAll('.filter-pill');

function updateKpiCards() {
  const stats = getKpiStats();
  document.getElementById('kpiTotal').textContent = stats.total;
  document.getElementById('kpiPending').textContent = stats.pending;
  document.getElementById('kpiAccepted').textContent = stats.accepted;
  document.getElementById('kpiDenied').textContent = stats.denied;
}

function renderLecturerDashboard() {
  updateKpiCards();

  const all = getAllSubmissions();
  let list = all;

  if (lecturerStatusFilter !== 'all') {
    list = list.filter(s => (s.status || 'Pending') === lecturerStatusFilter);
  }

  if (lecturerSearchTerm) {
    const q = lecturerSearchTerm.toLowerCase();
    list = list.filter(s =>
      (s.fullName || '').toLowerCase().includes(q) ||
      (s.matricNumber || '').toLowerCase().includes(q) ||
      (s.companyName || '').toLowerCase().includes(q) ||
      (s.department || '').toLowerCase().includes(q)
    );
  }

  dbTableBody.innerHTML = '';

  if (!all.length) {
    dbMessage.textContent = 'No submissions recorded yet.';
    return;
  }
  if (!list.length) {
    dbMessage.textContent = 'No matching records for current filter/search.';
    return;
  }

  dbMessage.textContent = `Showing ${list.length} of ${all.length} application(s).`;

  list.forEach((entry, idx) => {
    const progress = calculateProgress(entry.startDate, entry.endDate);
    const status = entry.status || 'Pending';
    const row = document.createElement('tr');

    const acceptDoc = entry.acceptanceFileData
      ? `<a href="${entry.acceptanceFileData}" download="${entry.acceptanceForm}" class="file-link">📥 Form</a>
         <button type="button" class="preview-btn" onclick="openPreview('${entry.acceptanceForm}', '${entry.acceptanceFileData}')">👁️</button>`
      : entry.acceptanceForm || 'None';

    const letterDoc = entry.applicationLetterData
      ? `<a href="${entry.applicationLetterData}" download="${entry.applicationLetter}" class="file-link">📥 Letter</a>
         <button type="button" class="preview-btn" onclick="openPreview('${entry.applicationLetter}', '${entry.applicationLetterData}')">👁️</button>`
      : entry.applicationLetter || 'None';

    const logEntries = getLogEntries(entry.matricNumber);
    const logsPendingApproval = logEntries.length > 0 && !entry.logbookApproved;
    const logsApproved = Boolean(entry.logbookApproved);

    // Once accepted: hide Accept & Deny and show the Overturn button
    let actionsHtml = '';
    if (status === 'Accepted') {
      actionsHtml = `
        <button type="button" class="action-button edit-btn" onclick="overturnDecision(${entry.id})">✏️ Overturn</button>
        <button type="button" class="action-button logs-btn" onclick="openStudentLogsModal('${entry.matricNumber}', '${entry.fullName}')">📖 Logs</button>
      `;
      if (logEntries.length) {
        actionsHtml += `
          <button type="button" class="action-button accept-btn" onclick="approveStudentLogbookHandler('${entry.matricNumber}', '${entry.fullName}')">${logsApproved ? '✓ Approved' : '✅ Approve Logs'}</button>
        `;
      }
    } else {
      actionsHtml = `
        <button type="button" class="action-button accept-btn" onclick="handleLecturerStatus(${entry.id}, 'Accepted')">✓ Accept</button>
        <button type="button" class="action-button deny-btn" onclick="handleLecturerStatus(${entry.id}, 'Denied')">✕ Deny</button>
        <button type="button" class="action-button logs-btn" onclick="openStudentLogsModal('${entry.matricNumber}', '${entry.fullName}')">📖 Logs</button>
      `;
    }

    if (logsPendingApproval) {
      row.classList.add('row-pending-logbook');
    }

    row.innerHTML = `
      <td><strong>${idx + 1}</strong></td>
      <td><strong>${entry.fullName}</strong></td>
      <td><code>${entry.matricNumber}</code></td>
      <td>${entry.department}</td>
      <td>${entry.companyName}<small>📞 ${entry.companyPhone}</small></td>
      <td>${entry.supervisor}</td>
      <td><small>${entry.startDate}<br>to ${entry.endDate}</small></td>
      <td>
        <strong>${progress}%</strong>
        <div class="progress-container" style="height:6px; margin-top:4px;">
          <div class="progress-fill" style="width:${progress}%;"></div>
        </div>
      </td>
      <td><span class="status-badge status-${status.toLowerCase()}">${status}</span></td>
      <td>
        <div class="action-buttons">
          ${actionsHtml}
        </div>
      </td>
      <td>${acceptDoc}<br>${letterDoc}</td>
      <td>
        <small>${entry.notes || 'No notes'}</small>
        ${entry.lecturerFeedback ? `<div style="color:#dc2626; font-size:0.8rem; margin-top:4px;"><strong>Note:</strong> ${entry.lecturerFeedback}</div>` : ''}
      </td>
    `;
    dbTableBody.appendChild(row);
  });
}

// Lecturer overturns decision
window.overturnDecision = async function(id) {
  const sub = getAllSubmissions().find(s => String(s.id) === String(id));
  if (!sub) return;

  const choice = prompt(
    `Overturn decision for ${sub.fullName} (${sub.matricNumber})?\n\nCurrent Status: ${sub.status}\n\nType "deny" to mark Denied\nType "pending" to reset to Pending review:`,
    'deny'
  );
  if (!choice) return;

  const clean = choice.trim().toLowerCase();
  let newStatus = '';
  if (clean === 'deny' || clean === 'denied') {
    newStatus = 'Denied';
  } else if (clean === 'pending') {
    newStatus = 'Pending';
  } else {
    return alert('Invalid choice. Please type "deny" or "pending".');
  }

  let feedback = '';
  if (newStatus === 'Denied') {
    feedback = prompt('Enter reason for denial / overturn:', 'Previous approval overturned — placement details require update.');
    if (feedback === null) return;
  } else {
    feedback = 'Decision overturned to Pending review by lecturer.';
  }

  updateSubmissionStatus(id, newStatus, feedback);
  renderLecturerDashboard();

  // Notify student via EmailJS
  const acc = getAccount(sub.matricNumber);
  if (acc && acc.email) {
    try {
      await sendOtpEmail(acc.email, `Status Update: ${newStatus}`, acc.fullName);
    } catch (e) {
      console.warn('Status email skipped:', e);
    }
  }

  alert(`Status for ${sub.fullName} updated to "${newStatus}".`);
};

// Lecturer Accept / Deny
window.handleLecturerStatus = async function(id, newStatus) {
  let feedback = '';
  if (newStatus === 'Denied') {
    feedback = prompt('Enter reason for denial (optional):', 'Please correct company details / re-upload form.');
    if (feedback === null) return;
  } else {
    if (!confirm('Mark this internship placement as Accepted?')) return;
  }

  updateSubmissionStatus(id, newStatus, feedback);
  renderLecturerDashboard();

  const sub = getAllSubmissions().find(s => String(s.id) === String(id));
  if (sub) {
    const acc = getAccount(sub.matricNumber);
    if (acc && acc.email) {
      try {
        await sendOtpEmail(acc.email, `Status Update: ${newStatus}`, acc.fullName);
      } catch (e) {
        console.warn('Status email skipped:', e);
      }
    }
  }
};

// Search & Filter listeners
if (dbSearchInput) {
  dbSearchInput.addEventListener('input', e => {
    lecturerSearchTerm = e.target.value.trim();
    renderLecturerDashboard();
  });
}

filterPills.forEach(pill => {
  pill.addEventListener('click', () => {
    filterPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    lecturerStatusFilter = pill.dataset.filter;
    renderLecturerDashboard();
  });
});

if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportSubmissionsCsv);
if (sideExportBtn) sideExportBtn.addEventListener('click', exportSubmissionsCsv);

window.approveAllLogbooks = function() {
  const allLogs = dbGet(DB_KEYS.LOGBOOK);
  const pending = allLogs.filter(item => !item.approved);

  if (!pending.length) {
    return alert('There are no pending weekly logbooks to approve.');
  }

  const confirmApprove = confirm(`Approve all ${pending.length} pending weekly logbook entries?`);
  if (!confirmApprove) return;

  const updatedLogs = allLogs.map(item => ({ ...item, approved: true }));
  dbSet(DB_KEYS.LOGBOOK, updatedLogs);

  const approvedMatricNumbers = [...new Set(pending.map(item => item.matric))];
  approvedMatricNumbers.forEach(matric => markLogbookApproved(matric, 'Approved by lecturer'));

  renderLecturerDashboard();
  if (currentStudent) {
    renderStudentLogbookView();
  }
  alert(`Approved all ${pending.length} pending logbook entries.`);
};

// Lecturer View Student Logbook Modal
const studentLogsModal = document.getElementById('studentLogsModal');
const logsModalTitle = document.getElementById('logsModalTitle');
const logsModalBody = document.getElementById('logsModalBody');
const closeLogsBtn = document.getElementById('closeLogsBtn');

window.openStudentLogsModal = function(matric, name) {
  logsModalTitle.textContent = `${name}'s Weekly Logbook (${matric})`;
  const logs = getLogEntries(matric);

  if (!logs.length) {
    logsModalBody.innerHTML = '<p class="record-empty">No weekly logs submitted by this student yet.</p>';
  } else {
    logsModalBody.innerHTML = logs.map(l => `
      <div class="logbook-entry">
        <span class="log-week-badge">${l.week}</span>
        <small style="color: var(--text-muted); float: right;">${l.dates}</small>
        <div style="margin: 8px 0;"><strong>Activities:</strong> ${l.tasks}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted);"><strong>Skills:</strong> ${l.skills}</div>
        <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px;">
          ${(Array.isArray(l.images) && l.images.length ? l.images.map(image => `<img src="${image}" alt="${l.week} proof" style="max-width: 160px; max-height: 110px; border-radius: 10px; border: 1px solid #dfe9f2; object-fit: cover;" />`).join('') : '<span style="color: var(--text-muted);">No images uploaded.</span>')}
        </div>
        <div style="margin-top: 8px; font-size: 0.8rem; color: var(--text-muted);">
          ${l.approved ? '✅ Approved by lecturer' : '⏳ Awaiting lecturer approval'}
        </div>
      </div>
    `).join('');

    const studentSubmission = getSubmissionByMatric(matric);
    const shouldShowApproveButton = logs.length > 0 && (!studentSubmission || !studentSubmission.logbookApproved);
    if (shouldShowApproveButton) {
      logsModalBody.insertAdjacentHTML('beforeend', `
        <div style="margin-top: 18px; text-align: right;">
          <button type="button" class="primary-btn-sm" onclick="approveStudentLogbookHandler('${matric}', '${name}')">✅ Approve this logbook</button>
        </div>
      `);
    }
  }

  studentLogsModal.classList.remove('hidden');
};

window.approveStudentLogbookHandler = function(matric, name) {
  const logs = getLogEntries(matric);
  if (!logs.length) {
    return alert(`${name} has not uploaded any weekly log entries yet.`);
  }

  const confirmApprove = confirm(`Approve the full weekly logbook for ${name}?`);
  if (!confirmApprove) return;

  markLogbookApproved(matric, 'Approved by lecturer');
  const allLogs = dbGet(DB_KEYS.LOGBOOK).map(item => item.matric === matric ? { ...item, approved: true } : item);
  dbSet(DB_KEYS.LOGBOOK, allLogs);

  renderLecturerDashboard();
  if (currentStudent && currentStudent.matric === matric) {
    renderStudentLogbookView();
  }
  studentLogsModal.classList.add('hidden');
  alert(`Weekly logbook approved for ${name}.`);
};

if (closeLogsBtn) {
  closeLogsBtn.addEventListener('click', () => studentLogsModal.classList.add('hidden'));
}

restoreAuthSession();
