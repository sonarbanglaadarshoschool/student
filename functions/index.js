const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();
const normalizePhone = value => String(value || '').replace(/\D/g, '').replace(/^880/, '0');
const genericError = () => new HttpsError('unauthenticated', 'Student ID or registered phone number is incorrect.');

exports.studentPortalLogin = onCall({ region: 'us-central1', maxInstances: 10, enforceAppCheck: false }, async request => {
  const studentId = String(request.data?.studentId || '').trim().toUpperCase().slice(0, 30);
  const phone = normalizePhone(request.data?.phone).slice(0, 20);
  if (!/^ST[A-Z0-9-]{1,28}$/.test(studentId) || phone.length < 10 || phone.length > 14) throw genericError();

  // Limit attempts per IP + student ID. The hash prevents storing raw IP addresses.
  const ip = String(request.rawRequest?.ip || 'unknown');
  const key = crypto.createHash('sha256').update(`${ip}|${studentId}`).digest('hex');
  const limitRef = db.collection('_studentPortalLoginLimits').doc(key);
  const now = Timestamp.now();
  const blocked = await db.runTransaction(async tx => {
    const snap = await tx.get(limitRef);
    const data = snap.exists ? snap.data() : {};
    const windowStart = data.windowStart?.toMillis?.() || 0;
    let count = data.count || 0;
    if (now.toMillis() - windowStart > 15 * 60 * 1000) count = 0;
    if (count >= 6) return true;
    tx.set(limitRef, { count: count + 1, windowStart: count === 0 ? now : (data.windowStart || now), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return false;
  });
  if (blocked) throw new HttpsError('resource-exhausted', 'Too many attempts. Please try again after 15 minutes.');

  const match = await db.collection('students').where('studentId', '==', studentId).limit(2).get();
  if (match.size !== 1) throw genericError();
  const doc = match.docs[0];
  const student = doc.data();
  if (student.status === 'inactive' || normalizePhone(student.guardianPhone) !== phone) throw genericError();

  let classId = String(student.classId || '');
  if (!classId && student.className) {
    let classes = await db.collection('classes').where('className', '==', student.className).get();
    let candidates = classes.docs.filter(d => !student.group || String(d.data().group || '') === String(student.group));
    if (candidates.length === 1) classId = candidates[0].id;
  }

  const uid = `student_${doc.id}`;
  const customToken = await getAuth().createCustomToken(uid, {
    role: 'student', studentDocId: doc.id, studentId,
    ...(classId ? { classId } : {})
  });
  await limitRef.set({ lastSuccessAt: FieldValue.serverTimestamp(), count: 0, windowStart: now }, { merge: true });
  return { token: customToken };
});
