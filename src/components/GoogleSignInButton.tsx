import { supabase } from "@/utils/supabase";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

declare global {
  interface Window {
    google?: any;
  }
}

interface GoogleSignInButtonProps {
  mode?: "signin" | "signup";
  onSuccess: (user: any) => void | Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
}

const GOOGLE_WEB_CLIENT_ID = (
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || ""
).trim();

const generateNoncePair = async () => {
  const randomBytes = new Uint8Array(32);
  window.crypto.getRandomValues(randomBytes);
  const rawNonce = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const encoder = new TextEncoder();
  const hashBuffer = await window.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(rawNonce),
  );
  const hashedNonce = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { rawNonce, hashedNonce };
};

export default function GoogleSignInButton({
  mode = "signin",
  onSuccess,
  onError,
  disabled = false,
}: GoogleSignInButtonProps) {
  const buttonContainerRef = useRef<HTMLDivElement | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const rawNonceRef = useRef<string>("");

  const [gisReady, setGisReady] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return;
    }

    if (!GOOGLE_WEB_CLIENT_ID) {
      setConfigError(
        "Falta EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID en el build de Vercel.",
      );
      return;
    }

    setConfigError(null);
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const initGoogleButton = async () => {
      if (cancelled || !window.google?.accounts?.id) return false;

      const containerEl = buttonContainerRef.current;
      if (!containerEl) return false;

      try {
        const { rawNonce, hashedNonce } = await generateNoncePair();
        if (cancelled) return true;
        rawNonceRef.current = rawNonce;

        window.google.accounts.id.initialize({
          client_id: GOOGLE_WEB_CLIENT_ID,
          nonce: hashedNonce,
          ux_mode: "popup",
          callback: async (response: any) => {
            if (!response?.credential) {
              onErrorRef.current("No se recibió credencial desde Google.");
              return;
            }

            setAuthenticating(true);
            try {
              const { data, error } = await supabase.auth.signInWithIdToken({
                provider: "google",
                token: response.credential,
                nonce: rawNonceRef.current,
              });

              if (error) {
                onErrorRef.current(error.message);
                return;
              }

              if (data?.user) {
                await onSuccessRef.current(data.user);
              }
            } catch (err: any) {
              onErrorRef.current(
                err?.message || "No se pudo completar el acceso con Google.",
              );
            } finally {
              setAuthenticating(false);
            }
          },
        });

        containerEl.innerHTML = "";
        const measuredWidth = Math.round(containerEl.offsetWidth || 320);
        const clampedWidth = Math.min(Math.max(measuredWidth, 240), 400);

        window.google.accounts.id.renderButton(containerEl, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: mode === "signup" ? "signup_with" : "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          locale: "es",
          width: clampedWidth,
        });

        setGisReady(true);
        return true;
      } catch (err) {
        console.error("Error inicializando Google Identity Services:", err);
        setConfigError("No se pudo cargar el botón oficial de Google.");
        return true;
      }
    };

    const scriptId = "google-gsi-client";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    let attempts = 0;
    const tryMount = async () => {
      attempts += 1;
      const mounted = await initGoogleButton();
      if (mounted && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      } else if (attempts >= 40 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        if (!cancelled) {
          setConfigError(
            "Google tardó demasiado en responder. Recarga la página.",
          );
        }
      }
    };

    tryMount();
    pollTimer = setInterval(tryMount, 150);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [mode]);

  if (Platform.OS !== "web") {
    return null;
  }

  return (
    <View style={styles.wrapper}>
      {authenticating && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#3182ce" />
          <Text style={styles.loadingText}>Conectando con Google...</Text>
        </View>
      )}

      {configError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{configError}</Text>
        </View>
      ) : (
        <>
          {!gisReady && !authenticating && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="small" color="#718096" />
              <Text style={styles.loadingText}>
                Cargando botón de Google...
              </Text>
            </View>
          )}
          {React.createElement("div", {
            ref: buttonContainerRef,
            style: {
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: gisReady ? 44 : 0,
              opacity: disabled || authenticating ? 0.5 : 1,
              pointerEvents: disabled || authenticating ? "none" : "auto",
            },
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  loadingOverlay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 11,
    width: "100%",
    backgroundColor: "#f7fafc",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 6,
  },
  loadingText: {
    color: "#4a5568",
    fontSize: 14,
    fontWeight: "600",
  },
  errorBox: {
    width: "100%",
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fff5f5",
    borderWidth: 1,
    borderColor: "#feb2b2",
  },
  errorText: {
    color: "#c53030",
    fontSize: 13,
    textAlign: "center",
  },
});
