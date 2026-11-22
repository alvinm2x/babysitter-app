import { supabase } from "@/utils/supabase";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export interface ResolvedPlaceData {
  address: string;
  commune: string;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  approx_lat: number | null;
  approx_lng: number | null;
}

interface PlaceSuggestion {
  placeId: string;
  fullText: string;
  mainText: string;
  secondaryText: string;
}

interface AddressAutocompleteInputProps {
  value: string;
  commune?: string;
  isVerified?: boolean;
  placeholder?: string;
  onChangeText: (text: string) => void;
  onSelectPlace: (place: ResolvedPlaceData) => void;
  onClear?: () => void;
}

const createSessionToken = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

export default function AddressAutocompleteInput({
  value,
  commune,
  isVerified = false,
  placeholder = "Ej: Av. Las Condes 9000 (sin depto)",
  onChangeText,
  onSelectPlace,
  onClear,
}: AddressAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);

  const sessionTokenRef = useRef<string>(createSessionToken());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef<number>(0);
  const suppressFetchRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const fetchSuggestions = async (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      setLoadingSuggestions(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoadingSuggestions(true);
    setFallbackMessage(null);

    try {
      const { data, error } = await supabase.functions.invoke(
        "google-places-proxy",
        {
          body: {
            action: "autocomplete",
            input: trimmed,
            sessionToken: sessionTokenRef.current,
          },
        },
      );

      if (seq !== requestSeqRef.current) return;

      if (error || data?.error) {
        setSuggestions([]);
        setShowDropdown(false);
        setFallbackMessage(
          "No pudimos cargar sugerencias automáticas. Puedes escribir tu dirección manualmente y elegir tu comuna abajo.",
        );
        return;
      }

      const list: PlaceSuggestion[] = Array.isArray(data?.suggestions)
        ? data.suggestions
        : [];
      setSuggestions(list);
      setShowDropdown(list.length > 0);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setSuggestions([]);
      setShowDropdown(false);
      setFallbackMessage(
        "Sin conexión con sugerencias. Puedes escribir tu dirección manualmente sin problema.",
      );
    } finally {
      if (seq === requestSeqRef.current) {
        setLoadingSuggestions(false);
      }
    }
  };

  const handleInputChange = (text: string) => {
    onChangeText(text);
    setFallbackMessage(null);

    if (suppressFetchRef.current) {
      suppressFetchRef.current = false;
      return;
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (text.trim().length < 3) {
      requestSeqRef.current += 1;
      setSuggestions([]);
      setShowDropdown(false);
      setLoadingSuggestions(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestions(text);
    }, 350);
  };

  const handleSelectSuggestion = async (item: PlaceSuggestion) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    requestSeqRef.current += 1;
    setShowDropdown(false);
    setSuggestions([]);
    setLoadingDetails(true);
    setFallbackMessage(null);

    try {
      const { data, error } = await supabase.functions.invoke(
        "google-places-proxy",
        {
          body: {
            action: "details",
            placeId: item.placeId,
            sessionToken: sessionTokenRef.current,
          },
        },
      );

      // Reinicia el session token al cerrar una sesión de Places
      sessionTokenRef.current = createSessionToken();

      if (error || data?.error) {
        suppressFetchRef.current = true;
        onChangeText(item.fullText || item.mainText);
        setFallbackMessage(
          "Guardamos el texto de la dirección. Confirma tu comuna abajo para continuar.",
        );
        return;
      }

      const resolvedAddress = String(
        data?.address || item.fullText || item.mainText || "",
      ).trim();

      suppressFetchRef.current = true;
      onSelectPlace({
        address: resolvedAddress,
        commune: String(data?.commune || "").trim(),
        google_place_id: data?.placeId ? String(data.placeId) : item.placeId,
        lat: typeof data?.lat === "number" ? data.lat : null,
        lng: typeof data?.lng === "number" ? data.lng : null,
        approx_lat: typeof data?.approxLat === "number" ? data.approxLat : null,
        approx_lng: typeof data?.approxLng === "number" ? data.approxLng : null,
      });
    } catch {
      sessionTokenRef.current = createSessionToken();
      suppressFetchRef.current = true;
      onChangeText(item.fullText || item.mainText);
      setFallbackMessage(
        "No pudimos validar las coordenadas, pero puedes continuar con el texto y tu comuna.",
      );
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleClear = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    requestSeqRef.current += 1;
    sessionTokenRef.current = createSessionToken();
    setSuggestions([]);
    setShowDropdown(false);
    setFallbackMessage(null);
    if (onClear) {
      onClear();
    } else {
      onChangeText("");
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.inputBox, isVerified && styles.inputBoxVerified]}>
        <Text style={styles.pinIcon}>📍</Text>
        <TextInput
          style={styles.textInput}
          placeholder={placeholder}
          placeholderTextColor="#a0aec0"
          value={value}
          onChangeText={handleInputChange}
          autoCorrect={false}
        />
        {(loadingSuggestions || loadingDetails) && (
          <ActivityIndicator
            size="small"
            color="#3182ce"
            style={styles.spinner}
          />
        )}
        {!loadingSuggestions && !loadingDetails && value.length > 0 && (
          <TouchableOpacity
            onPress={handleClear}
            style={styles.clearBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {isVerified && (
        <View style={styles.verifiedBadge}>
          <Text style={styles.verifiedBadgeText}>
            ✓ Dirección verificada
            {commune ? ` • Comuna: ${commune}` : ""}
          </Text>
        </View>
      )}

      {Boolean(fallbackMessage) && (
        <Text style={styles.fallbackText}>ℹ️ {fallbackMessage}</Text>
      )}

      {showDropdown && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          {suggestions.map((item, idx) => (
            <TouchableOpacity
              key={item.placeId}
              style={[
                styles.suggestionRow,
                idx < suggestions.length - 1 && styles.suggestionDivider,
              ]}
              onPress={() => handleSelectSuggestion(item)}
            >
              <Text style={styles.suggestionMain}>{item.mainText}</Text>
              {Boolean(item.secondaryText) && (
                <Text style={styles.suggestionSecondary}>
                  {item.secondaryText}
                </Text>
              )}
            </TouchableOpacity>
          ))}
          <View style={styles.attributionRow}>
            <Text style={styles.attributionText}>Powered by Google</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: 10,
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#cbd5e0",
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 10,
  },
  inputBoxVerified: {
    borderColor: "#68d391",
    backgroundColor: "#f0fff4",
  },
  pinIcon: {
    fontSize: 15,
    marginRight: 6,
  },
  textInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 15,
    color: "#1a202c",
  },
  spinner: {
    marginLeft: 6,
  },
  clearBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  clearBtnText: {
    fontSize: 14,
    color: "#718096",
    fontWeight: "bold",
  },
  verifiedBadge: {
    marginTop: 6,
    backgroundColor: "#c6f6d5",
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },
  verifiedBadgeText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#22543d",
  },
  fallbackText: {
    marginTop: 6,
    fontSize: 12,
    color: "#9c4221",
    lineHeight: 16,
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#cbd5e0",
    borderRadius: 10,
    overflow: "hidden",
    elevation: 3,
  },
  suggestionRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  suggestionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#edf2f7",
  },
  suggestionMain: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2d3748",
  },
  suggestionSecondary: {
    fontSize: 12,
    color: "#718096",
    marginTop: 2,
  },
  attributionRow: {
    backgroundColor: "#f7fafc",
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: "#edf2f7",
    alignItems: "flex-end",
  },
  attributionText: {
    fontSize: 10,
    color: "#a0aec0",
    fontWeight: "600",
  },
});
