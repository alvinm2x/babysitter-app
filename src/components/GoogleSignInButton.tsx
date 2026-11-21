import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const GOOGLE_WEB_CLIENT_ID = (
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || ""
).trim();

const GOOGLE_NONCE_KEY = "mibabysitter_google_raw_nonce";
const GOOGLE_PENDING_ROLE_KEY = "mibabysitter_pending_google_role";

export const consumeGoogleRawNonce = (): string | null => {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const val = window.localStorage.getItem(GOOGLE_NONCE_KEY);
    if (val) window.localStorage.removeItem(GOOGLE_NONCE_KEY);
    return val;
  } catch {
    return null;
  }
};

export const consumePendingGoogleRole = (): "parent" | "babysitter" | null => {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const val = window.localStorage.getItem(GOOGLE_PENDING_ROLE_KEY);
    if (val) window.localStorage.removeItem(GOOGLE_PENDING_ROLE_KEY);
    if (val === "parent" || val === "babysitter") return val;
    return null;
  } catch {
    return null;
  }
};

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

const GoogleLogoIcon = () => {
  if (Platform.OS !== "web") return null;
  return React.createElement(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 48 48" },
    React.createElement("path", {
      fill: "#EA4335",
      d: "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z",
    }),
    React.createElement("path", {
      fill: "#4285F4",
      d: "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z",
    }),
    React.createElement("path", {
      fill: "#FBBC05",
      d: "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z",
    }),
    React.createElement("path", {
      fill: "#34A853",
      d: "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z",
    }),
  );
};

interface GoogleSignInButtonProps {
  mode?: "signin" | "signup";
  preselectedRole?: "parent" | "babysitter";
  onError: (message: string) => void;
  disabled?: boolean;
}

export default function GoogleSignInButton({
  mode = "signin",
  preselectedRole,
  onError,
  disabled = false,
}: GoogleSignInButtonProps) {
  const [redirecting, setRedirecting] = useState(false);

  if (Platform.OS !== "web") {
    return null;
  }

  const handlePress = async () => {
    if (typeof window === "undefined") return;

    if (!GOOGLE_WEB_CLIENT_ID) {
      onError("Falta configurar EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID en Vercel.");
      return;
    }

    setRedirecting(true);
    try {
      const { rawNonce, hashedNonce } = await generateNoncePair();
      window.localStorage.setItem(GOOGLE_NONCE_KEY, rawNonce);

      if (preselectedRole) {
        window.localStorage.setItem(GOOGLE_PENDING_ROLE_KEY, preselectedRole);
      } else {
        window.localStorage.removeItem(GOOGLE_PENDING_ROLE_KEY);
      }

      const params = new URLSearchParams({
        client_id: GOOGLE_WEB_CLIENT_ID,
        redirect_uri: window.location.origin,
        response_type: "id_token",
        scope: "openid email profile",
        nonce: hashedNonce,
        prompt: "select_account",
      });

      window.location.assign(
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      );
    } catch (err: any) {
      setRedirecting(false);
      onError(err?.message || "No se pudo redirigir a Google.");
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={[
          styles.button,
          (disabled || redirecting) && styles.buttonDisabled,
        ]}
        onPress={handlePress}
        disabled={disabled || redirecting}
      >
        {redirecting ? (
          <View style={styles.inner}>
            <ActivityIndicator size="small" color="#3182ce" />
            <Text style={styles.buttonText}>Abriendo Google...</Text>
          </View>
        ) : (
          <View style={styles.inner}>
            <GoogleLogoIcon />
            <Text style={styles.buttonText}>
              {mode === "signup"
                ? "Registrarse con Google"
                : "Continuar con Google"}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    marginBottom: 16,
  },
  button: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dadce0",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  buttonText: {
    color: "#3c4043",
    fontSize: 15,
    fontWeight: "600",
  },
});
