# SBAS Student Portal

Separate Student Portal for Sonar Bangla Adarsho School. It uses the existing Firebase project `sbas-2bfe2` and does not change the Admin Dashboard repository.

## Student login
Students enter their Student ID and the guardian phone number saved in the Admin Dashboard `students` collection field `guardianPhone`. No password or OTP is requested. The login check runs in a Cloudflare Worker (free tier available) rather than Firebase Cloud Functions, so no Firebase Blaze upgrade is needed for the login endpoint. Cloudflare account limits and Google/Firebase free quotas still apply.

## Included
- Student ID + `guardianPhone` login
- My Profile, Attendance, Exam Results, Fees & Payments, Class Routine, School Notices
- Firebase custom-token sign-in and read-only student access rules
- Separate repository and responsive interface

## A. Publish the website
1. Upload the contents of this folder to the root of `https://github.com/sonarbanglaadarshoschool/student`.
2. GitHub → Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save.
3. Wait for GitHub Pages to publish `https://sonarbanglaadarshoschool.github.io/student/`.

## B. Create a Google service account for the Worker
The Worker needs server-side access to look up exactly one matching student record and mint a Firebase custom token. Never put the service-account JSON/private key in GitHub or browser JavaScript.

1. Open Google Cloud Console for project `sbas-2bfe2`: https://console.cloud.google.com/
2. Go to IAM & Admin → Service Accounts → Create Service Account. Name it `sbas-student-portal-login`.
3. Grant the service account the **Cloud Datastore User** role (`roles/datastore.user`) so it can read Firestore. Do not grant Owner or Editor.
4. Open the service account → Keys → Add Key → Create new key → JSON. Download the JSON securely. Do not upload it to GitHub or send it to anyone.
5. In the JSON, note `client_email` and `private_key`.

## C. Deploy the free-tier Cloudflare Worker
Install Node.js, then open Command Prompt in this project folder (the folder containing `worker.js`):

```bash
npm install -g wrangler
wrangler login
wrangler deploy worker.js --name sbas-student-login
```

Add the service-account email as a secret:

```bash
wrangler secret put SERVICE_ACCOUNT_EMAIL
```
Paste the JSON `client_email` value when prompted. Then add the private key:

```bash
wrangler secret put SERVICE_ACCOUNT_PRIVATE_KEY
```
Paste the complete JSON `private_key` value, including the BEGIN/END PRIVATE KEY lines. Keep it private.

The Worker URL will look like `https://sbas-student-login.<your-cloudflare-subdomain>.workers.dev`. Copy the exact URL.

## D. Set the Worker URL in the portal
Open `assets/firebase-config.js` in the `student` GitHub repository and replace `YOUR-SUBDOMAIN` in this line with your actual Cloudflare Workers subdomain:

```js
window.SBAS_STUDENT_LOGIN_API = 'https://sbas-student-login.YOUR-SUBDOMAIN.workers.dev';
```

Commit the change and wait for GitHub Pages to redeploy. The Worker only accepts requests from `https://sonarbanglaadarshoschool.github.io`.

## E. Publish Firestore rules
The existing `firestore.rules` file expects a Firebase custom token with student claims. Review the rules against the live Admin Dashboard rules before publishing. Do not replace working admin rules blindly. The included rules preserve the known admin check (`users/{uid}` with role `admin` and status `active`) and add read-only student access.

Firebase Console → Firestore Database → Rules. Merge/review and publish the rules.

## Student data requirements
- Each student must have a unique `studentId` such as `ST0001`.
- The phone must be saved in `guardianPhone` exactly as the registered guardian contact (the Worker normalizes country code and punctuation).
- Student status must not be `inactive`.
- Attendance, results and fees documents must store `studentId` as the student's Firestore document ID, matching the Admin Dashboard's current data model.
- Student class routine access uses the student's `classId`; the Worker tries to resolve it from `className` and `group` when needed.

## Important limitations
Student ID + guardian phone is intentionally a low-assurance login. Anyone who knows both values may be able to access that student's portal. Do not display highly sensitive information in the portal. This design does not provide OTP, password protection, or robust per-user rate limiting. Cloudflare Workers has a free tier, but its limits and terms can change; Google Cloud/Firebase quotas and any enabled paid services are separate.

The Worker and website are packaged but have **not** been deployed or tested against the live Firebase project. A Google service-account key and Cloudflare deployment are required before login works. The service-account private key must remain a Cloudflare secret only.
