import { supabase } from "@/utils/supabase";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface ApproxLocationMapProps {
  approxLat: number;
  approxLng: number;
  commune?: string;
  radiusMeters?: number;
}

const staticMapCache: { [key: string]: string } = {};

export default function ApproxLocationMap({
  approxLat,
  approxLng,
  commune,
  radiusMeters = 600,
}: ApproxLocationMapProps) {
  const safeLat = Number(approxLat);
  const safeLng = Number(approxLng);
  const safeRadius = Number(radiusMeters) || 600;
  const cacheKey = `${safeLat.toFixed(5)}_${safeLng.toFixed(5)}_${safeRadius}`;

  const [imageUri, setImageUri] = useState<string | null>(
    staticMapCache[cacheKey] || null,
  );
  const [loading, setLoading] = useState<boolean>(!staticMapCache[cacheKey]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState<number>(0);

  useEffect(() => {
    if (isNaN(safeLat) || isNaN(safeLng)) return;

    if (staticMapCache[cacheKey]) {
      setImageUri(staticMapCache[cacheKey]);
      setLoading(false);
      setErrorMsg(null);
      return;
    }

    let cancelled = false;

    const loadStaticMap = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const { data, error } = await supabase.functions.invoke(
          "google-places-proxy",
          {
            body: {
              action: "static_map",
              approxLat: safeLat,
              approxLng: safeLng,
              radiusMeters: safeRadius,
            },
          },
        );

        if (cancelled) return;

        if (error || !data?.imageDataUrl) {
          setErrorMsg(
            data?.error ||
              "No pudimos cargar el mapa de referencia en este momento.",
          );
          return;
        }

        staticMapCache[cacheKey] = data.imageDataUrl;
        setImageUri(data.imageDataUrl);
      } catch {
        if (!cancelled) {
          setErrorMsg("Error de conexión al cargar el mapa aproximado.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadStaticMap();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, safeLat, safeLng, safeRadius, retryTick]);

  if (isNaN(safeLat) || isNaN(safeLng)) return null;

  return (
    <View style={styles.container}>
      <View style={styles.mapFrame}>
        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator size="small" color="#3182ce" />
            <Text style={styles.stateText}>
              Cargando sector en Google Maps...
            </Text>
          </View>
        ) : errorMsg || !imageUri ? (
          <View style={styles.stateBox}>
            <Text style={styles.errorText}>
              {errorMsg || "Mapa no disponible."}
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => setRetryTick((t) => t + 1)}
            >
              <Text style={styles.retryBtnText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Image
            source={{ uri: imageUri }}
            style={styles.mapImage}
            resizeMode="cover"
          />
        )}
      </View>

      <View style={styles.captionBar}>
        <Text style={styles.captionText}>
          🔵 Zona aproximada (~{safeRadius} m)
          {commune ? ` • ${commune}` : ""} • Dirección exacta protegida
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#bee3f8",
    backgroundColor: "#ebf8ff",
    marginTop: 8,
    marginBottom: 4,
  },
  mapFrame: {
    width: "100%",
    height: 195,
    backgroundColor: "#ebf8ff",
    justifyContent: "center",
    alignItems: "center",
  },
  mapImage: {
    width: "100%",
    height: "100%",
  },
  stateBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  stateText: {
    fontSize: 12,
    color: "#2b6cb0",
    fontWeight: "600",
  },
  errorText: {
    fontSize: 12,
    color: "#9c4221",
    textAlign: "center",
  },
  retryBtn: {
    backgroundColor: "#3182ce",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  retryBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "bold",
  },
  captionBar: {
    backgroundColor: "#ffffff",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: "#bee3f8",
  },
  captionText: {
    fontSize: 11,
    color: "#2c5282",
    fontWeight: "600",
    textAlign: "center",
  },
});
