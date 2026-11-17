(function () {
  const loginUrl = "/signin.sql";
  let redirectTimer = 0;

  function hasValue(value) {
    return String(value ?? "").trim() !== "";
  }

  function isMissingSession(user) {
    if (user?.session_valid != null) {
      return ![true, 1, "1", "true"].includes(user.session_valid);
    }
    return !user || (!hasValue(user.username) && !hasValue(user.userId));
  }

  function showMissingSession() {
    if (document.querySelector(".session-missing-screen")) return true;

    const screen = document.createElement("section");
    screen.className = "session-missing-screen";
    screen.setAttribute("role", "alert");
    screen.setAttribute("aria-live", "assertive");
    screen.innerHTML = `
      <div class="session-missing-card">
        <span class="session-missing-dot" aria-hidden="true"></span>
        <strong>Missing session_id</strong>
        <small>Redirecting to login...</small>
      </div>
    `;
    document.body.appendChild(screen);

    window.clearTimeout(redirectTimer);
    redirectTimer = window.setTimeout(() => {
      window.location.replace(loginUrl);
    }, 2000);
    return true;
  }

  window.InternalTicketSessionGuard = {
    isMissingSession,
    showMissingSession
  };
}());
