const admin = require("firebase-admin");

let initialized = false;

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

function initFirebaseAdmin() {
  if (initialized) return admin;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  let serviceAccount = null;
  if (json) {
    try {
      serviceAccount = JSON.parse(json);
    } catch {
      serviceAccount = null;
    }
  }

  if (!serviceAccount) {
    const projectId = process.env.FIREBASE_PROJECT_ID || "";
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || "");
    if (projectId && clientEmail && privateKey) {
      serviceAccount = { projectId, clientEmail, privateKey };
    }
  }

  if (!serviceAccount) {
    return null;
  }

  const bucket = process.env.FIREBASE_STORAGE_BUCKET || undefined;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: bucket
    });
  }
  initialized = true;
  return admin;
}

function getAdmin() {
  return initFirebaseAdmin();
}

function isFirebaseConfigured() {
  return Boolean(initFirebaseAdmin());
}

async function verifyFirebaseIdToken(token) {
  const a = initFirebaseAdmin();
  if (!a) throw new Error("Firebase Admin is not configured.");
  return a.auth().verifyIdToken(token);
}

function getFirestore() {
  const a = initFirebaseAdmin();
  if (!a) throw new Error("Firebase Admin is not configured.");
  return a.firestore();
}

function getStorageBucket() {
  const a = initFirebaseAdmin();
  if (!a) throw new Error("Firebase Admin is not configured.");
  return a.storage().bucket();
}

module.exports = {
  isFirebaseConfigured,
  verifyFirebaseIdToken,
  getFirestore,
  getStorageBucket
};

