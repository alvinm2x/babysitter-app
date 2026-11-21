import { supabase } from "@/utils/supabase";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
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

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

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
  const buttonContainerRef = useRef<any>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const rawNonceRef = useRef<string>("");

  const [gisReady, setGisReady] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      !GOOGLE_WEB_CLIENT_ID
    ) {
      return;
    }

    let cancelled = false;

    const initGoogleButton = async () => {
      if (cancelled || !window.google?.accounts?.id) return;

      const containerEl = buttonContainerRef.current;
      if (!containerEl || typeof containerEl.innerHTML === "undefined") return;

      try {
        const { rawNonce, hashedNonce } = await generateNoncePair();
        if (cancelled) return;
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
        const measuredWidth = containerEl.offsetWidth || 360;
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
      } catch (err) {
        console.error("Error inicializando Google Identity Services:", err);
      }
    };

    if (window.google?.accounts?.id) {
      initGoogleButton();
    } else {
      const scriptId = "google-gsi-client";
      let script = document.getElementById(
        scriptId,
      ) as HTMLScriptElement | null;

      if (!script) {
        script = document.createElement("script");
        script.id = scriptId;
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }

      const handleLoad = () => {
        initGoogleButton();
      };

      script.addEventListener("load", handleLoad);
      return () => {
        cancelled = true;
        script?.removeEventListener("load", handleLoad);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Fallback seguro si aún no se agrega EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  const handleFallbackOAuth = async () => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      onError("El inicio con Google está disponible en la versión web.");
      return;
    }

    setAuthenticating(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            access_type: "offline",
            prompt: "select_account",
          },
        },
      });
      if (error) {
        onError(error.message);
        setAuthenticating(false);
      }
    } catch (err: any) {
      onError(err?.message || "No se pudo iniciar con Google.");
      setAuthenticating(false);
    }
  };

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

      {GOOGLE_WEB_CLIENT_ID ? (
        <View
          ref={buttonContainerRef}
          style={[
            styles.gisContainer,
            (disabled || authenticating) && styles.disabledBox,
          ]}
        />
      ) : null}

      {(!GOOGLE_WEB_CLIENT_ID || !gisReady) && !authenticating && (
        <TouchableOpacity
          style={styles.fallbackButton}
          onPress={handleFallbackOAuth}
          disabled={disabled || authenticating}
        >
          <View style={styles.fallbackInner}>
            <View style={styles.googleBadge}>
              <Text style={styles.googleBadgeText}>G</Text>
            </View>
            <Text style={styles.fallbackText}>
              {mode === "signup"
                ? "Registrarse con Google"
                : "Continuar con Google"}
            </Text>
          </View>
        </TouchableOpacity>
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
  gisContainer: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  disabledBox: {
    opacity: 0.5,
    pointerEvents: "none" as any,
  },
  loadingOverlay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 12,
    width: "100%",
    backgroundColor: "#f7fafc",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 8,
  },
  loadingText: {
    color: "#2d3748",
    fontSize: 15,
    fontWeight: "600",
  },
  fallbackButton: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#cbd5e0",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  fallbackInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ebf8ff",
    borderWidth: 1,
    borderColor: "#90cdf4",
    alignItems: "center",
    justifyContent: "center",
  },
  googleBadgeText: {
    color: "#2b6cb0",
    fontWeight: "bold",
    fontSize: 14,
  },
  fallbackText: {
    color: "#1a202c",
    fontSize: 15,
    fontWeight: "600",
  },
});
