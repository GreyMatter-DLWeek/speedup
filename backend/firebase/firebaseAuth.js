const { verifyFirebaseIdToken } = require("./firebaseAdmin");

function isLocalDevHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.startsWith("192.168.") ||
    host.startsWith("10.")
  );
}

function decodeBase64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function decodeUnverifiedFirebaseToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) throw new Error("Malformed Firebase token.");

  const payload = JSON.parse(decodeBase64Url(parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (payload?.exp && now >= Number(payload.exp)) {
    throw new Error("Firebase token expired.");
  }

  const uid = String(payload?.user_id || payload?.uid || payload?.sub || "").trim();
  if (!uid) throw new Error("Firebase token missing uid.");

  return {
    ...payload,
    uid,
    __unverifiedLocalDev: true
  };
}

async function authenticateFirebaseRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  try {
    return await verifyFirebaseIdToken(token);
  } catch (error) {
    const host = String(req.hostname || req.headers.host || "").split(":")[0];
    if (/firebase admin is not configured/i.test(String(error?.message || "")) && isLocalDevHost(host)) {
      return decodeUnverifiedFirebaseToken(token);
    }
    throw error;
  }
}

async function requireFirebaseAuth(req, res, next) {
  try {
    const decoded = await authenticateFirebaseRequest(req);
    req.firebaseUser = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid Firebase token.", details: error.message || "Unauthorized" });
  }
}

async function tryGetFirebaseUser(req) {
  try {
    return await authenticateFirebaseRequest(req);
  } catch {
    return null;
  }
}

module.exports = {
  requireFirebaseAuth,
  tryGetFirebaseUser
};
