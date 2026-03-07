/* global firebase */

let firebaseApp = null;
let auth = null;
let currentUser = null;
let initPromise = null;
let authStateReadyResolve = null;
let authStateReadyPromise = null;
let signInWaiters = [];

function initFirebaseClient() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const cfg = window.FIREBASE_CLIENT_CONFIG || {};
    if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId) {
      return null;
    }
    firebaseApp = firebase.initializeApp(cfg);
    auth = firebase.auth();
    authStateReadyPromise = new Promise((resolve) => {
      authStateReadyResolve = resolve;
    });
    auth.onAuthStateChanged((u) => {
      currentUser = u || null;
      if (authStateReadyResolve) {
        authStateReadyResolve(true);
        authStateReadyResolve = null;
      }
      if (currentUser) {
        const waiters = signInWaiters.slice();
        signInWaiters = [];
        waiters.forEach((resolve) => resolve(currentUser));
      }
    });
    return auth;
  })();
  return initPromise;
}

async function waitForAuthReady() {
  await initFirebaseClient();
  if (authStateReadyPromise) await authStateReadyPromise;
}

async function getIdToken(forceRefresh = false) {
  await waitForAuthReady();
  if (!auth) return "";
  const user = auth.currentUser || currentUser;
  if (!user) return "";
  return user.getIdToken(Boolean(forceRefresh));
}

async function getUser() {
  await waitForAuthReady();
  return auth?.currentUser || currentUser || null;
}

async function signUpWithEmail(email, password) {
  await waitForAuthReady();
  if (!auth) throw new Error("Firebase auth is not configured.");
  const out = await auth.createUserWithEmailAndPassword(String(email || "").trim(), String(password || ""));
  return out?.user || null;
}

async function signInWithEmail(email, password) {
  await waitForAuthReady();
  if (!auth) throw new Error("Firebase auth is not configured.");
  const out = await auth.signInWithEmailAndPassword(String(email || "").trim(), String(password || ""));
  return out?.user || null;
}

async function signOutUser() {
  await waitForAuthReady();
  if (!auth) return;
  await auth.signOut();
}

async function deleteCurrentUser() {
  await waitForAuthReady();
  if (!auth) throw new Error("Firebase auth is not configured.");
  const user = auth.currentUser || currentUser;
  if (!user) throw new Error("No authenticated user.");
  await user.delete();
  currentUser = null;
}

async function waitForSignIn() {
  const u = await getUser();
  if (u) return u;
  return new Promise((resolve) => {
    signInWaiters.push(resolve);
  });
}

function onAuthChanged(callback) {
  if (typeof callback !== "function") return () => {};
  initFirebaseClient().then(() => {
    if (!auth) return;
    auth.onAuthStateChanged((u) => callback(u || null));
  });
  return () => {};
}

window.firebaseAuthClient = {
  initFirebaseClient,
  waitForAuthReady,
  getIdToken,
  getUser,
  signUpWithEmail,
  signInWithEmail,
  signOutUser,
  deleteCurrentUser,
  waitForSignIn,
  onAuthChanged
};
