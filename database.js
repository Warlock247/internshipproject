const portalDb = window.supabase.createClient(
  window.PORTAL_CONFIG.supabaseUrl,
  window.PORTAL_CONFIG.supabaseAnonKey
);

let activeUser = null;
let activeProfile = null;
let profiles = [];
let submissions = [];
let logEntries = [];

function getBackendError(error) {
  if (!error) return 'The online database request failed.';
  if (error.code === '23505') {
    return 'That matric number is already registered. Please log in instead.';
  }
  const msg = error.message || '';
  if (msg.includes('email_provider_disabled') || msg.includes('Email logins are disabled')) {
    return 'Email provider is disabled in Supabase. In your Supabase Dashboard, go to Authentication -> Providers -> Email, and toggle "Enable Email provider" to ON.';
  }
  if (msg.includes('Email signups are disabled')) {
    return 'Email signups are disabled in Supabase. In your Supabase Dashboard, go to Authentication -> Providers -> Email, and toggle "Enable Email provider" to ON.';
  }
  if (msg.includes('Invalid login credentials')) {
    return 'Incorrect login credentials. Please verify your details.';
  }
  if (msg.includes('Password should be at least 6 characters')) {
    return 'Password must be at least 6 characters.';
  }
  return msg || 'The online database request failed.';
}

function createStudentAuthEmail(matric) {
  return `student.${matric}@accounts.siwes.invalid`;
}

function createStudentAuthPassword(password) {
  const clean = (password || '').trim().toLowerCase();
  // Supabase Auth requires at least 6 characters. If surname is shorter, pad predictably with '0'.
  return clean.length >= 6 ? clean : clean.padEnd(6, '0');
}

function createOTP(surname, firstName, matric, email) {
  const randomValue = new Uint32Array(1);
  crypto.getRandomValues(randomValue);
  const otpData = {
    code: String(100000 + (randomValue[0] % 900000)),
    surname: surname.trim(),
    firstName: firstName.trim(),
    matric: matric.trim(),
    email: email.trim().toLowerCase(),
    expiresAt: Date.now() + 120000,
  };
  sessionStorage.setItem('internship_pending_otp', JSON.stringify(otpData));
  return otpData;
}

function getPendingOTP() {
  try {
    return JSON.parse(sessionStorage.getItem('internship_pending_otp') || 'null');
  } catch (error) {
    console.warn('Could not read pending email verification:', error);
    sessionStorage.removeItem('internship_pending_otp');
    return null;
  }
}

function clearPendingOTP() {
  sessionStorage.removeItem('internship_pending_otp');
}

function verifyOTP(code) {
  const pending = getPendingOTP();
  if (!pending) {
    return { success: false, message: 'No pending OTP verification found.' };
  }
  if (Date.now() > pending.expiresAt) {
    clearPendingOTP();
    return { success: false, message: 'OTP has expired. Click Resend OTP.' };
  }
  if (pending.code !== (code || '').trim()) {
    return { success: false, message: 'Invalid OTP code. Please check your email and try again.' };
  }
  return { success: true, pending };
}

async function createStudentAccount(pending) {
  const password = createStudentAuthPassword(pending.surname);
  const { data, error } = await portalDb.auth.signUp({
    email: createStudentAuthEmail(pending.matric),
    password,
    options: {
      data: {
        matric: pending.matric,
        surname: pending.surname,
        first_name: pending.firstName,
        full_name: `${pending.surname} ${pending.firstName}`,
        contact_email: pending.email,
      },
    },
  });

  if (error) throw new Error(getBackendError(error));
  if (!data.user) throw new Error('Supabase did not return a user for the new account.');

  let session = data.session;
  if (!session) {
    const signIn = await portalDb.auth.signInWithPassword({
      email: createStudentAuthEmail(pending.matric),
      password,
    });
    if (signIn.error) {
      throw new Error(getBackendError(signIn.error));
    }
    session = signIn.data.session;
  }

  const profile = await getProfile(data.user.id);
  if (!profile || profile.role !== 'student') {
    await portalDb.auth.signOut();
    throw new Error('The account was created, but its student profile is missing. Please ensure the Supabase schema.sql was run.');
  }

  return { session, profile };
}

async function signInStudent(matric, password) {
  const cleanMatric = (matric || '').trim();
  const rawPass = (password || '').trim();
  const normalizedPass = createStudentAuthPassword(rawPass);

  // Attempt sign in with normalized password (lowercased / padded)
  let { data, error } = await portalDb.auth.signInWithPassword({
    email: createStudentAuthEmail(cleanMatric),
    password: normalizedPass,
  });

  // Fallback to exact typed casing if account was registered prior to normalization
  if (error && rawPass !== normalizedPass) {
    const retry = await portalDb.auth.signInWithPassword({
      email: createStudentAuthEmail(cleanMatric),
      password: rawPass,
    });
    if (!retry.error) {
      data = retry.data;
      error = null;
    }
  }

  if (error) {
    const msg = error.message || '';
    if (msg.includes('email_provider_disabled') || msg.includes('Email logins are disabled')) {
      return { success: false, message: getBackendError(error) };
    }
    return { success: false, message: 'Matric number or password is incorrect.' };
  }

  const profile = await getProfile(data.user.id);
  if (!profile || profile.role !== 'student' || profile.matric !== cleanMatric) {
    await portalDb.auth.signOut();
    return { success: false, message: 'This account is not configured as a student account.' };
  }

  return { success: true, account: profile };
}

async function signInLecturer(password) {
  const { data, error } = await portalDb.auth.signInWithPassword({
    email: window.PORTAL_CONFIG.lecturerAuthEmail,
    password: (password || '').trim(),
  });
  if (error) return { success: false, message: 'Incorrect lecturer passcode.' };

  const profile = await getProfile(data.user.id);
  if (!profile || profile.role !== 'lecturer') {
    await portalDb.auth.signOut();
    return { success: false, message: 'This account is not authorized as a lecturer.' };
  }

  return { success: true, account: profile };
}

function normalizeProfile(row) {
  if (!row) return null;
  const fullName = (row.full_name || `${row.surname || ''} ${row.first_name || ''}`.trim()) || 'Student';
  return {
    ...row,
    fullName,
    full_name: fullName,
    firstName: row.first_name || '',
    first_name: row.first_name || '',
  };
}

async function getProfile(userId) {
  const { data, error } = await portalDb
    .from('profiles')
    .select('id, matric, surname, first_name, full_name, email, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(getBackendError(error));
  return normalizeProfile(data);
}

function getAccount(matric) {
  const clean = (matric || '').trim();
  return profiles.find(profile => profile.matric === clean) || null;
}

async function loadPortalData(profile) {
  activeProfile = profile;
  const { data: userData, error: userError } = await portalDb.auth.getUser();
  if (userError) throw new Error(getBackendError(userError));
  activeUser = userData.user;
  if (!activeUser) throw new Error('Your online session has expired. Please log in again.');

  const profileQuery = portalDb
    .from('profiles')
    .select('id, matric, surname, first_name, full_name, email, role');
  const applicationQuery = portalDb.from('applications').select('*');
  const logQuery = portalDb.from('logbook_entries').select('*');

  if (profile.role !== 'lecturer') {
    profileQuery.eq('id', activeUser.id);
    applicationQuery.eq('student_id', activeUser.id);
    logQuery.eq('student_id', activeUser.id);
  }

  const [profileResult, applicationResult, logResult] = await Promise.all([
    profileQuery,
    applicationQuery,
    logQuery,
  ]);
  for (const result of [profileResult, applicationResult, logResult]) {
    if (result.error) throw new Error(getBackendError(result.error));
  }

  profiles = (profileResult.data || []).map(normalizeProfile);
  submissions = await Promise.all((applicationResult.data || []).map(hydrateSubmission));
  logEntries = await Promise.all((logResult.data || []).map(hydrateLogEntry));
}

async function restoreOnlineSession() {
  const { data, error } = await portalDb.auth.getSession();
  if (error) throw new Error(getBackendError(error));
  if (!data.session) return null;

  const profile = await getProfile(data.session.user.id);
  if (!profile) {
    await portalDb.auth.signOut();
    throw new Error('Your account profile is missing. Run the Supabase setup SQL or contact the portal administrator.');
  }

  await loadPortalData(profile);
  return profile;
}

async function signOutOnline() {
  const { error } = await portalDb.auth.signOut();
  if (error) throw new Error(getBackendError(error));
  activeUser = null;
  activeProfile = null;
  profiles = [];
  submissions = [];
  logEntries = [];
}

function isValidMatric(matric) {
  return /^\d{9}$/.test((matric || '').trim());
}

function getAllSubmissions() {
  return submissions.slice();
}

function getSubmissionByMatric(matric) {
  const clean = (matric || '').trim();
  return submissions.find(submission => submission.matricNumber === clean) || null;
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

function calculateDurationWeeks(startDate, endDate) {
  if (!startDate || !endDate) return 12;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 12;
  const diffDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  return Math.max(1, Math.ceil(diffDays / 7));
}

async function createSignedAssetUrl(path) {
  if (!path) return null;
  try {
    const { data, error } = await portalDb.storage
      .from('portal-files')
      .createSignedUrl(path, 3600);
    if (error) {
      console.warn('Could not create signed URL for path:', path, error.message);
      return null;
    }
    return data?.signedUrl || null;
  } catch (err) {
    console.warn('Error creating signed URL for path:', path, err);
    return null;
  }
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (_) {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function uploadPortalFile(file, matric, category) {
  if (!file) return null;
  if (!activeUser) throw new Error('Please log in before uploading files.');
  const safeName = file.name.replace(/[^\w.-]/g, '_');
  const path = `${activeUser.id}/${matric}/${category}/${generateUuid()}-${safeName}`;
  const { error } = await portalDb.storage
    .from('portal-files')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error(getBackendError(error));
  return path;
}

async function hydrateSubmission(row) {
  const payload = row.payload || {};
  const submission = {
    ...payload,
    id: row.id,
    status: row.status,
    lecturerFeedback: row.lecturer_feedback || '',
    logbookApproved: row.logbook_approved,
    logbookStatus: row.logbook_status || '',
    lecturerLogbookFeedback: row.lecturer_logbook_feedback || '',
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
  };
  submission.acceptanceFileData = await createSignedAssetUrl(submission.acceptanceFilePath);
  submission.applicationLetterData = await createSignedAssetUrl(submission.applicationLetterPath);
  return submission;
}

async function hydrateLogEntry(row) {
  const entry = {
    ...(row.payload || {}),
    id: row.id,
    matric: row.matric,
    approved: row.approved,
    createdAt: row.created_at,
  };
  const paths = Array.isArray(entry.images) ? entry.images : [];
  entry.images = await Promise.all(paths.map(createSignedAssetUrl));
  return entry;
}

function serializableSubmission(record) {
  const payload = { ...record };
  [
    'id',
    'status',
    'lecturerFeedback',
    'logbookApproved',
    'logbookStatus',
    'lecturerLogbookFeedback',
    'submittedAt',
    'updatedAt',
    'acceptanceFileData',
    'applicationLetterData',
  ].forEach(key => delete payload[key]);
  return payload;
}

async function saveSubmission(record) {
  if (!activeUser) throw new Error('Please log in before saving an application.');

  // Check memory or query Supabase directly to preserve review fields
  let previous = getSubmissionByMatric(record.matricNumber);
  if (!previous) {
    const { data: existingData } = await portalDb
      .from('applications')
      .select('*')
      .eq('student_id', activeUser.id)
      .maybeSingle();
    if (existingData) {
      previous = await hydrateSubmission(existingData);
    }
  }

  const values = {
    student_id: activeUser.id,
    matric_number: record.matricNumber,
    payload: serializableSubmission(record),
    status: 'Pending',
    lecturer_feedback: '',
    logbook_approved: previous ? Boolean(previous.logbookApproved) : false,
    logbook_status: previous ? (previous.logbookStatus || null) : null,
    lecturer_logbook_feedback: previous ? (previous.lecturerLogbookFeedback || null) : null,
  };
  const { data, error } = await portalDb
    .from('applications')
    .upsert(values, { onConflict: 'student_id' })
    .select('*')
    .single();
  if (error) throw new Error(getBackendError(error));
  const saved = await hydrateSubmission(data);
  submissions = submissions.filter(item => item.id !== saved.id);
  submissions.push(saved);
  return saved;
}

async function updateSubmissionStatus(id, newStatus, feedback = '') {
  const { data, error } = await portalDb
    .from('applications')
    .update({ status: newStatus, lecturer_feedback: feedback })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(getBackendError(error));
  const updated = await hydrateSubmission(data);
  submissions = submissions.map(item => item.id === updated.id ? updated : item);
  return updated;
}

function getKpiStats() {
  return {
    total: submissions.length,
    pending: submissions.filter(s => (s.status || 'Pending') === 'Pending').length,
    accepted: submissions.filter(s => s.status === 'Accepted').length,
    denied: submissions.filter(s => s.status === 'Denied').length,
  };
}

function getLogEntries(matric) {
  const clean = (matric || '').trim();
  return logEntries.filter(entry => entry.matric === clean);
}

function getAllLogEntries() {
  return logEntries.slice();
}

async function saveLogEntry(entry) {
  if (!activeUser) throw new Error('Please log in before saving a logbook entry.');
  const { data, error } = await portalDb
    .from('logbook_entries')
    .insert({
      student_id: activeUser.id,
      matric: entry.matric,
      payload: { ...entry, images: Array.isArray(entry.images) ? entry.images : [] },
    })
    .select('*')
    .single();
  if (error) throw new Error(getBackendError(error));

  const saved = await hydrateLogEntry(data);
  logEntries.push(saved);
  submissions = submissions.map(submission => submission.matricNumber === entry.matric
    ? { ...submission, logbookStatus: 'Awaiting lecturer approval', logbookApproved: false }
    : submission);
  return saved;
}

async function markLogbookApproved(matric, feedback = 'Approved by lecturer') {
  const { data, error } = await portalDb
    .from('applications')
    .update({
      logbook_approved: true,
      logbook_status: 'Approved',
      lecturer_logbook_feedback: feedback,
    })
    .eq('matric_number', matric)
    .select('*');
  if (error) throw new Error(getBackendError(error));

  const { error: logsError } = await portalDb
    .from('logbook_entries')
    .update({ approved: true })
    .eq('matric', matric);
  if (logsError) throw new Error(getBackendError(logsError));

  const updated = await Promise.all((data || []).map(hydrateSubmission));
  submissions = submissions.map(submission =>
    submission.matricNumber === matric
      ? updated.find(item => item.id === submission.id) || submission
      : submission
  );
  logEntries = logEntries.map(entry => entry.matric === matric ? { ...entry, approved: true } : entry);
}

async function approveAllPendingLogbooks() {
  const pending = logEntries.filter(entry => !entry.approved);
  if (!pending.length) return 0;

  const matricNumbers = [...new Set(pending.map(entry => entry.matric))];
  const { error } = await portalDb
    .from('logbook_entries')
    .update({ approved: true })
    .in('matric', matricNumbers);
  if (error) throw new Error(getBackendError(error));

  for (const matric of matricNumbers) {
    const { error: applicationError } = await portalDb
      .from('applications')
      .update({
        logbook_approved: true,
        logbook_status: 'Approved',
        lecturer_logbook_feedback: 'Approved by lecturer',
      })
      .eq('matric_number', matric);
    if (applicationError) throw new Error(getBackendError(applicationError));
  }

  logEntries = logEntries.map(entry => pending.some(item => item.id === entry.id)
    ? { ...entry, approved: true }
    : entry);
  submissions = submissions.map(submission => matricNumbers.includes(submission.matricNumber)
    ? {
        ...submission,
        logbookApproved: true,
        logbookStatus: 'Approved',
        lecturerLogbookFeedback: 'Approved by lecturer',
      }
    : submission);
  return pending.length;
}

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