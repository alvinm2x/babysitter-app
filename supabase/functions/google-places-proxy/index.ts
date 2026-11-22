const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const extractComponent = (
  components: Array<{ longText?: string; shortText?: string; types?: string[] }>,
  type: string,
) => {
  const found = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  return found?.longText?.trim() || "";
};

const extractChileanCommune = (
  components: Array<{ longText?: string; shortText?: string; types?: string[] }>,
) => {
  const raw =
    extractComponent(components, "administrative_area_level_3") ||
    extractComponent(components, "locality") ||
    extractComponent(components, "sublocality_level_1");

  if (!raw) return "";
  if (raw.toLowerCase() === "santiago") return "Santiago Centro";
  return raw;
};

const computeApproxCoords = (lat: number, lng: number) => {
  // Desplazamiento aleatorio fijo entre 200m y 350m para cubrir la casa dentro de un radio de 600m sin centrarla
  const distanceMeters = 200 + Math.random() * 150;
  const angle = Math.random() * 2 * Math.PI;
  const dLat = (distanceMeters * Math.cos(angle)) / 111320;
  const dLng =
    (distanceMeters * Math.sin(angle)) /
    (111320 * Math.cos((lat * Math.PI) / 180));

  return {
    approxLat: Number((lat + dLat).toFixed(6)),
    approxLng: Number((lng + dLng).toFixed(6)),
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) {
    return jsonResponse(
      { error: "Falta configurar GOOGLE_MAPS_API_KEY en Supabase Secrets." },
      500,
    );
  }

  try {
    const payload = await req.json();
    const action = String(payload?.action || "");

    if (action === "autocomplete") {
      const input = String(payload?.input || "").trim();
      const sessionToken = payload?.sessionToken
        ? String(payload.sessionToken)
        : undefined;

      if (input.length < 3) {
        return jsonResponse({ suggestions: [] });
      }

      const body: Record<string, unknown> = {
        input,
        languageCode: "es",
        regionCode: "CL",
        includedRegionCodes: ["CL"],
        locationBias: {
          circle: {
            center: { latitude: -33.4489, longitude: -70.6693 },
            radius: 45000.0,
          },
        },
      };

      if (sessionToken) body.sessionToken = sessionToken;

      const googleRes = await fetch(
        "https://places.googleapis.com/v1/places:autocomplete",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
          },
          body: JSON.stringify(body),
        },
      );

      const googleData = await googleRes.json();

      if (!googleRes.ok) {
        console.error("Places Autocomplete error:", googleData);
        return jsonResponse(
          {
            error:
              googleData?.error?.message ||
              "Error consultando sugerencias en Google Places.",
          },
          502,
        );
      }

      const suggestions = (googleData?.suggestions || [])
        .map((s: any) => s?.placePrediction)
        .filter((p: any) => p?.placeId)
        .slice(0, 5)
        .map((p: any) => ({
          placeId: String(p.placeId),
          fullText: String(p.text?.text || ""),
          mainText: String(
            p.structuredFormat?.mainText?.text || p.text?.text || "",
          ),
          secondaryText: String(p.structuredFormat?.secondaryText?.text || ""),
        }));

      return jsonResponse({ suggestions });
    }

    if (action === "details") {
      const placeId = String(payload?.placeId || "").trim();
      const sessionToken = payload?.sessionToken
        ? String(payload.sessionToken)
        : undefined;

      if (!placeId) {
        return jsonResponse({ error: "placeId es requerido." }, 400);
      }

      const params = new URLSearchParams({
        languageCode: "es",
        regionCode: "CL",
      });
      if (sessionToken) params.set("sessionToken", sessionToken);

      const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(
        placeId,
      )}?${params.toString()}`;

      const googleRes = await fetch(url, {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "id,formattedAddress,addressComponents,location",
        },
      });

      const googleData = await googleRes.json();

      if (!googleRes.ok) {
        console.error("Places Details error:", googleData);
        return jsonResponse(
          {
            error:
              googleData?.error?.message ||
              "Error obteniendo detalles de la dirección.",
          },
          502,
        );
      }

      const components = Array.isArray(googleData?.addressComponents)
        ? googleData.addressComponents
        : [];

      const route = extractComponent(components, "route");
      const streetNumber = extractComponent(components, "street_number");
      const commune = extractChileanCommune(components);
      const formattedAddress = String(googleData?.formattedAddress || "").trim();

      let cleanAddress = formattedAddress
        .replace(/,\s*Chile$/i, "")
        .replace(/,\s*Regi[oó]n Metropolitana$/i, "")
        .trim();

      if (route && streetNumber) {
        cleanAddress = commune
          ? `${route} ${streetNumber}, ${commune}`
          : `${route} ${streetNumber}`;
      }

      const lat =
        typeof googleData?.location?.latitude === "number"
          ? googleData.location.latitude
          : null;
      const lng =
        typeof googleData?.location?.longitude === "number"
          ? googleData.location.longitude
          : null;

      const approx =
        lat !== null && lng !== null
          ? computeApproxCoords(lat, lng)
          : { approxLat: null, approxLng: null };

      return jsonResponse({
        placeId: String(googleData?.id || placeId),
        address: cleanAddress || formattedAddress,
        formattedAddress,
        commune,
        lat,
        lng,
        approxLat: approx.approxLat,
        approxLng: approx.approxLng,
      });
    }

    return jsonResponse({ error: "Acción no válida." }, 400);
  } catch (err: any) {
    console.error("google-places-proxy exception:", err);
    return jsonResponse(
      { error: err?.message || "Error interno en google-places-proxy." },
      500,
    );
  }
});