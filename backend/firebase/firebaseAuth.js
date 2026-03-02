const { verifyFirebaseIdToken } = require("./firebaseAdmin");

async function requireFirebaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Bearer token." });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    const decoded = await verifyFirebaseIdToken(token);
    req.firebaseUser = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid Firebase token.", details: error.message || "Unauthorized" });
  }
}

async function tryGetFirebaseUser(req) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length).trim();
    return await verifyFirebaseIdToken(token);
  } catch {
    return null;
  }
}

module.exports = {
  requireFirebaseAuth,
  tryGetFirebaseUser
};

