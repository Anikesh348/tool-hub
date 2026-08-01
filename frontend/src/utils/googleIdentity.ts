let googleIdentityPromise: Promise<void> | null = null;

const googleIdentityReady = () => Boolean(window.google?.accounts?.id);

const waitForGoogleIdentity = (timeoutMs = 10_000) => new Promise<void>((resolve, reject) => {
  const startedAt = Date.now();
  const check = () => {
    if (googleIdentityReady()) {
      resolve();
      return;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      reject(new Error("Google Identity Services did not become ready"));
      return;
    }
    window.setTimeout(check, 50);
  };
  check();
});

export const loadGoogleIdentity = () => {
  if (googleIdentityReady()) return Promise.resolve();
  if (googleIdentityPromise) return googleIdentityPromise;

  googleIdentityPromise = new Promise<void>((resolve, reject) => {
    let script = document.getElementById("google-login-script") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.id = "google-login-script";
      document.head.appendChild(script);
    }

    const fail = () => reject(new Error("Google Identity Services failed to load"));
    script.addEventListener("error", fail, { once: true });
    waitForGoogleIdentity()
      .then(() => {
        script?.setAttribute("data-loaded", "true");
        resolve();
      })
      .catch(reject);
  }).catch((error) => {
    googleIdentityPromise = null;
    const script = document.getElementById("google-login-script");
    if (!googleIdentityReady()) script?.remove();
    throw error;
  });

  return googleIdentityPromise;
};
