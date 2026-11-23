# SBAS Student Portal

Standalone Student Portal for Sonar Bangla Adarsho School. It uses the existing Firebase project `sbas-2bfe2`; it does not modify or replace the Admin Dashboard repository.

## Included
- Student sign-in using Student ID + registered guardian phone number
- My Profile, Attendance, Exam Results, Fees & Payment History, Class Routine, School Notices
- Responsive mobile/desktop interface
- Firebase custom-token authentication through a trusted callable Cloud Function
- Firestore rules that keep student data read-only and scoped to the signed-in student's own record

## Deploy to the `student` GitHub repository
1. Upload the contents of this folder (including the updated `functions/` folder) to the root of `https://github.com/sonarbanglaadarshoschool/student` (not the folder itself).
2. In GitHub: Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save.
3. The site URL will be `https://sonarbanglaadarshoschool.github.io/student/` after Pages finishes publishing.

## Required Firebase setup (do not skip)

### 1. Deploy the login Cloud Function
Cloud Functions deployment generally requires the Firebase project to be on the Blaze billing plan. Check billing before deploying; do not enable billing unless you understand any costs.

From a local terminal with Node.js and Firebase CLI installed:

```bash
firebase login
firebase use sbas-2bfe2
cd functions
npm install
cd ..
firebase deploy --only functions:studentPortalLogin
```

The function is deployed in `us-central1`, matching the portal client. Its callable CORS allowlist includes `https://sonarbanglaadarshoschool.github.io`. Redeploy the function after pulling this updated project. The function checks the Student ID against `students.studentId`, compares the supplied phone against `guardianPhone`, blocks inactive students, applies a basic attempt limit, then issues a Firebase custom token. Raw phone numbers are not stored in the login-attempt records.

### 2. Publish Firestore rules
Firebase Console → Firestore Database → Rules. Review and publish the included `firestore.rules`.

These rules preserve the existing admin check using `users/{uid}` with `role: admin` and `status: active`. Student claims are restricted to their own student, attendance, result and fee documents; routines are restricted to their class; notices are published notices for students. Student accounts cannot write records.

**Important:** rules are security-critical. Review against the live project before publishing. Admin SDK functions bypass Firestore rules. The login function uses the Admin SDK.

### 3. Student data requirements
- Student records must have unique `studentId` values (e.g. `ST0001`).
- `guardianPhone` must contain the registered phone number.
- Student status should be `active`.
- Attendance, results and fees records must store `studentId` as the student's Firestore document ID, matching the current Admin Dashboard implementation.
- Class routines must have `classId` matching the student's class document ID. The login function attempts to resolve it by `className` and `group` when it is not already stored on the student record.

## Limitations / security note
Student ID + phone number is a low-assurance login method because both may be known to others. Add phone OTP verification before production use if stronger identity verification is required. The included attempt limiter is a basic safeguard, not a substitute for App Check, OTP, monitoring, or a production-grade abuse-control service.

The portal has not been connected to or tested against the live Firebase project in this environment. Deploy the Cloud Function and rules, then test with one active test student before sharing the portal URL. If Firestore reports a missing composite index, follow the Firebase Console link in the error to create it.


## Important: how to open the portal while testing
Do not double-click `index.html` or open it using a `file://` address. That creates browser origin `null`, which is not permitted by the secure Cloud Function CORS allowlist. Publish through GitHub Pages and test at `https://sonarbanglaadarshoschool.github.io/student/`. If testing locally, run a local HTTP server and separately add that exact localhost origin to the function CORS allowlist before deploying.

## Deployment clarification (404 / CORS)
If the browser reports HTTP 404 for `https://us-central1-sbas-2bfe2.cloudfunctions.net/studentPortalLogin`, the function is not deployed at that region/name (or the project is wrong). The CORS warning shown alongside a 404 is normally secondary: the 404 response does not include callable CORS headers. This package includes `firebase.json` and `.firebaserc` so Firebase CLI can deploy from this repository root. Follow `DEPLOY-FUNCTION-WINDOWS.txt` on Windows.
