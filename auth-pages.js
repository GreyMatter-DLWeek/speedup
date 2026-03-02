async function initAuthPage() {
  const mode = document.body.dataset.mode === "signup" ? "signup" : "login";
  const authClient = window.firebaseAuthClient;
  await authClient?.initFirebaseClient?.();
  await authClient?.waitForAuthReady?.();

  const existing = await authClient?.getUser?.();
  if (existing) {
    window.location.replace("/index.html");
    return;
  }

  const form = document.getElementById("authForm");
  const emailEl = document.getElementById("authEmail");
  const passEl = document.getElementById("authPassword");
  const confirmWrap = document.getElementById("confirmWrap");
  const confirmEl = document.getElementById("authConfirmPassword");
  const errorEl = document.getElementById("authError");
  const submitBtn = document.getElementById("authSubmit");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");

  if (confirmWrap) confirmWrap.style.display = mode === "signup" ? "" : "none";
  if (title) title.textContent = mode === "signup" ? "Create your account" : "Welcome back";
  if (subtitle) subtitle.textContent = mode === "signup" ? "Sign up to start using SpeedUp." : "Sign in to continue.";
  if (submitBtn) submitBtn.textContent = mode === "signup" ? "Sign Up" : "Login";

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(emailEl?.value || "").trim();
    const password = String(passEl?.value || "");
    const confirmPassword = String(confirmEl?.value || "");
    if (!email || !password) {
      if (errorEl) errorEl.textContent = "Email and password are required.";
      return;
    }
    if (password.length < 8) {
      if (errorEl) errorEl.textContent = "Authentication failed. Please try again.";
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      if (errorEl) errorEl.textContent = "Passwords do not match.";
      return;
    }
    if (errorEl) errorEl.textContent = "";
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (mode === "signup") {
        await authClient?.signUpWithEmail?.(email, password);
      } else {
        await authClient?.signInWithEmail?.(email, password);
      }
      window.location.replace("/index.html");
    } catch (error) {
      if (errorEl) errorEl.textContent = "Authentication failed. Please try again.";
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

window.addEventListener("DOMContentLoaded", initAuthPage);
