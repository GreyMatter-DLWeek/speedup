const { getFirestore } = require("./firebaseAdmin");

const COLLECTION = "speedup_users";

function userDoc(uid) {
  return getFirestore().collection(COLLECTION).doc(uid);
}

async function getUserState(uid) {
  const doc = await userDoc(uid).get();
  if (!doc.exists) return {};
  return doc.data()?.state || {};
}

async function setUserState(uid, state) {
  await userDoc(uid).set(
    {
      state,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
  return true;
}

async function appendAuditEvent(uid, message) {
  const current = await getUserState(uid);
  current.auditLog = current.auditLog || [];
  current.auditLog.push({ ts: new Date().toISOString(), message: String(message || "") });
  current.auditLog = current.auditLog.slice(-300);
  await setUserState(uid, current);
  return current;
}

module.exports = {
  getUserState,
  setUserState,
  appendAuditEvent
};

