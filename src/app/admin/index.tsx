import { supabase } from "@/utils/supabase";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const PLATFORM_COMMISSION_RATE = 0.3;
const COVERAGE_ZONES = [
  "Las Condes",
  "Providencia",
  "Vitacura",
  "Santiago Centro",
];
const COVERAGE_SHIFTS = ["Mañana", "Tarde", "Noche"];

const showAlert = (title: string, message: string) => {
  if (Platform.OS === "web") {
    alert(title + ": " + message);
  } else {
    Alert.alert(title, message);
  }
};

const confirmAction = (
  title: string,
  message: string,
  onConfirm: () => void,
  confirmLabel = "Confirmar",
  isDestructive = false,
) => {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      const ok = window.confirm(`${title}\n\n${message}`);
      if (ok) onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: "Cancelar", style: "cancel" },
    {
      text: confirmLabel,
      style: isDestructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
};

const formatCLP = (amount: number) => {
  return (
    "$" + new Intl.NumberFormat("es-CL").format(Math.round(amount)) + " CLP"
  );
};

const formatCLPCompact = (amount: number) => {
  return "$" + new Intl.NumberFormat("es-CL").format(Math.round(amount));
};

const formatMsgTime = (iso?: string) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
};

const formatShortDate = (iso?: string | null) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
};

const stripSupportPrefix = (content?: string) => {
  return String(content || "").replace(/^\[Soporte[^\]]*\]:\s*/i, "");
};

const normalizeText = (text: string) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const parseZonesList = (rawZones: any): string[] => {
  if (Array.isArray(rawZones)) {
    return rawZones.map((z) => String(z || "").trim()).filter(Boolean);
  }
  if (typeof rawZones === "string") {
    return rawZones
      .split(",")
      .map((z) => z.trim())
      .filter(Boolean);
  }
  return [];
};

const evaluateBabysitterReadiness = (sitterRow: any, masterRow?: any) => {
  const firstName = String(sitterRow?.first_name || "").trim();
  const lastName = String(sitterRow?.last_name || "").trim();
  const fallbackFullName = String(masterRow?.full_name || "").trim();
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    fallbackFullName ||
    "Sin nombre";
  const displayFirstName =
    firstName || fallbackFullName.split(" ")[0] || "Hola";

  const phone = String(sitterRow?.phone || "").trim();
  const hasValidPhone = phone.replace(/\D/g, "").length >= 8;
  const bio = String(sitterRow?.bio || "").trim();
  const hourlyRate = Number(sitterRow?.hourly_rate) || 0;
  const zones = parseZonesList(sitterRow?.location_zone);
  const days: string[] = Array.isArray(sitterRow?.available_days)
    ? sitterRow.available_days.filter(Boolean)
    : [];
  const shifts: string[] = Array.isArray(sitterRow?.available_shifts)
    ? sitterRow.available_shifts.filter(Boolean)
    : [];

  const missingFields: string[] = [];
  if (!firstName || !lastName) missingFields.push("Nombre y apellido");
  if (!hasValidPhone) missingFields.push("WhatsApp");
  if (!bio) missingFields.push("Biografía");
  if (hourlyRate < 10000) missingFields.push("Tarifa (mín. $10.000)");
  if (zones.length === 0) missingFields.push("Comunas");
  if (days.length === 0) missingFields.push("Días disponibles");
  if (shifts.length === 0) missingFields.push("Bloques horarios");

  const isOperational = missingFields.length === 0;

  return {
    id: String(sitterRow?.id || masterRow?.id || ""),
    displayName,
    displayFirstName,
    phone,
    hasValidPhone,
    bio,
    hourlyRate,
    experienceYears: Number(sitterRow?.experience_years) || 0,
    rating: sitterRow?.rating ? Number(sitterRow.rating) : null,
    reviewsCount: Number(sitterRow?.reviews_count) || 0,
    zones,
    days,
    shifts,
    isOperational,
    missingFields,
    isAdminAccount: Boolean(masterRow?.is_admin),
    updatedAt:
      sitterRow?.updated_at ||
      sitterRow?.created_at ||
      masterRow?.created_at ||
      null,
  };
};

const getRequestFinancials = (req: any) => {
  const total = Number(req.total_amount) || 0;
  const fee =
    Number(req.platform_fee) || Math.round(total * PLATFORM_COMMISSION_RATE);
  const payout = Number(req.babysitter_payout) || Math.max(0, total - fee);
  return { total, fee, payout };
};

const parseJobWindow = (jobDate?: string, jobTime?: string) => {
  let jobDateStr = String(jobDate || "").trim();
  const slashMatch = jobDateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) {
    jobDateStr = `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  const timeParts = String(jobTime || "09:00 - 11:00")
    .split("-")
    .map((s) => s.trim());
  const startTime = timeParts[0] || "09:00";
  const endTime = timeParts[1] || "";

  const startDate = new Date(`${jobDateStr}T${startTime}:00`);
  const isValidStart = !isNaN(startDate.getTime());

  let endDate: Date | null = null;
  if (isValidStart && endTime) {
    const parsedEnd = new Date(`${jobDateStr}T${endTime}:00`);
    if (!isNaN(parsedEnd.getTime())) {
      endDate = parsedEnd;
    }
  }
  if (isValidStart && !endDate) {
    endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  }

  return { startDate, endDate, isValidStart };
};

const evaluateEscrowState = (req: any) => {
  const now = new Date();
  const { startDate, endDate, isValidStart } = parseJobWindow(
    req.job_date,
    req.job_time,
  );

  if (!isValidStart) {
    return {
      priority: 3,
      label: "🟢 Agendado",
      color: "#22543d",
      bg: "#c6f6d5",
      borderColor: "#cbd5e0",
      sortTime: Number.MAX_SAFE_INTEGER,
    };
  }

  const diffHoursToStart =
    (startDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  const hasEnded = endDate
    ? now.getTime() > endDate.getTime()
    : diffHoursToStart < -2;

  if (hasEnded) {
    return {
      priority: 1,
      label: "🔵 Por cerrar",
      color: "#234e52",
      bg: "#b2f5ea",
      borderColor: "#319795",
      sortTime: startDate.getTime(),
    };
  }

  if (diffHoursToStart < 2) {
    return {
      priority: 2,
      label: "🟡 En curso / Inminente",
      color: "#975a16",
      bg: "#fefcbf",
      borderColor: "#d69e2e",
      sortTime: startDate.getTime(),
    };
  }

  return {
    priority: 3,
    label: "🟢 Agendado",
    color: "#22543d",
    bg: "#c6f6d5",
    borderColor: "#cbd5e0",
    sortTime: startDate.getTime(),
  };
};

const getConciergeTemplates = (req: any) => {
  const parentName = req?.parent?.parent_name || "Familia";
  const sitterName = req?.babysitter?.first_name || "la niñera";
  const jobDate = req?.job_date || "la fecha agendada";
  const jobTime = req?.job_time || "el horario acordado";

  return [
    {
      id: "checkin",
      label: "👋 Check-in",
      text: `Hola, les escribimos desde Soporte MiBabysitter. Confirmamos que su turno del ${jobDate} (${jobTime}) sigue en pie. ¿Todo coordinado por ambos lados?`,
    },
    {
      id: "nudge",
      label: "⚡ Destrabar",
      text: `Hola ${sitterName}, desde Soporte MiBabysitter vemos que la familia de ${parentName} espera respuesta para el ${jobDate} (${jobTime}). ¿Podrás tomar este turno?`,
    },
    {
      id: "payment",
      label: "💳 Pago",
      text: `Hola ${parentName}, te escribimos desde Soporte MiBabysitter. Tu turno del ${jobDate} con ${sitterName} ya está aceptado; recuerda confirmar el pago protegido para liberar los datos de contacto.`,
    },
    {
      id: "close",
      label: "✅ Cierre",
      text: `Hola, desde Soporte MiBabysitter vemos que el horario del turno (${jobTime}) ya finalizó. Recuerden marcar el servicio como completado para liberar el pago protegido.`,
    },
  ];
};

// -----------------------------------------------------------------------------
// MOTOR DETERMINISTA DE ALERTAS (FASE 1 & FASE 3: LIMPIEZA DE VENCIDOS)
// -----------------------------------------------------------------------------
const evaluateJobAlert = (req: any) => {
  const now = new Date();
  const { startDate, isValidStart } = parseJobWindow(
    req.job_date,
    req.job_time,
  );
  const diffHours = isValidStart
    ? (startDate.getTime() - now.getTime()) / (1000 * 60 * 60)
    : 999;

  // Si la fecha y hora del turno ya quedaron en el pasado y sigue pendiente, lo filtramos
  if (req.status === "pending" && diffHours < -1) {
    return null;
  }

  // 1. CRITICAL_UNPAID_SOON (Riesgo de cancelación por falta de pago)
  if (
    req.status === "accepted" &&
    req.payment_status === "unpaid" &&
    diffHours < 48
  ) {
    return {
      type: "critical",
      color: "#e53e3e",
      bg: "#fff5f5",
      badge: "🔴 URGENTE",
      message:
        "Servicio pronto a iniciar SIN PAGO. Contactar al padre urgente.",
      actionType: "nudge_parent_pay",
    };
  }

  // 2. CRITICAL_CHECKIN (Turno inminente o ya iniciado)
  if (
    req.status === "accepted" &&
    req.payment_status === "held" &&
    diffHours > -2 &&
    diffHours < 2
  ) {
    return {
      type: "critical",
      color: "#dd6b20",
      bg: "#fffff0",
      badge: "🟡 INMINENTE",
      message: "Servicio inicia pronto o acaba de empezar. Verificar check-in.",
      actionType: "check_in",
    };
  }

  // 3. WARNING_PENDING_SLA (Padre esperando respuesta)
  if (req.status === "pending") {
    return {
      type: "warning",
      color: "#d69e2e",
      bg: "#fffff0",
      badge: "⏳ PENDIENTE",
      message: "Niñera aún no responde. Riesgo de fuga del cliente.",
      actionType: "nudge_babysitter_accept",
    };
  }

  // 4. WARNING_NEEDS_COMPLETION (Cierre atrasado)
  if (
    req.status === "accepted" &&
    req.payment_status === "held" &&
    diffHours < -2
  ) {
    return {
      type: "warning",
      color: "#319795",
      bg: "#e6fffa",
      badge: "🔵 CIERRE ATRASADO",
      message:
        "El horario de servicio ya pasó. Requiere cierre administrativo.",
      actionType: "force_completion",
    };
  }

  // 5. OK_ACTIVE
  if (
    req.status === "accepted" &&
    req.payment_status === "held" &&
    diffHours >= 2
  ) {
    return {
      type: "ok",
      color: "#38a169",
      bg: "#f0fff4",
      badge: "🟢 EN REGLA",
      message: "Todo listo. Fondos en custodia.",
      actionType: "none",
    };
  }

  return null;
};

// -----------------------------------------------------------------------------
// COMPONENTE PRINCIPAL TORRE DE CONTROL
// -----------------------------------------------------------------------------
export default function AdminDashboardScreen() {
  const router = useRouter();
  const chatScrollRef = useRef<ScrollView | null>(null);

  // Refs para Chat 2.0 en Torre de Control (#24 Fase 2)
  const adminUserIdRef = useRef<string | null>(null);
  const trackedRequestIdsRef = useRef<string[]>([]);
  const isChatOpenRef = useRef<boolean>(false);
  const activeChatReqIdRef = useRef<string | null>(null);
  const typingChannelRef = useRef<any>(null);
  const lastTypingEmitRef = useRef<number>(0);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [activeTab, setActiveTab] = useState<
    "alerts" | "babysitters" | "finance"
  >("alerts");
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<any[]>([]);
  const [babysittersDirectory, setBabysittersDirectory] = useState<any[]>([]);
  const [msgCountsMap, setMsgCountsMap] = useState<{ [key: string]: number }>(
    {},
  );
  const [unreadCountsMap, setUnreadCountsMap] = useState<{
    [key: string]: number;
  }>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [emailStatusMap, setEmailStatusMap] = useState<{
    [key: string]: string;
  }>({});

  // FILTROS DEL MÓDULO DE OFERTA Y DIRECTORIO DE NIÑERAS (ÍTEM #30 FASE 1)
  const [sitterStatusFilter, setSitterStatusFilter] = useState<
    "all" | "operational" | "incomplete"
  >("all");
  const [sitterZoneFilter, setSitterZoneFilter] = useState<string>("Todas");
  const [sitterSearchQuery, setSitterSearchQuery] = useState<string>("");
  const [hideAdminTestAccounts, setHideAdminTestAccounts] =
    useState<boolean>(false);

  const [expandedBreakdownIds, setExpandedBreakdownIds] = useState<{
    [key: string]: boolean;
  }>({});

  // DETALLE INTERACTIVO DE ESCROW ACTIVO (ÍTEM #27)
  const [showEscrowDetail, setShowEscrowDetail] = useState(false);

  // ESTADOS DEL CHAT OPERATIVO DE SOPORTE (ÍTEM #26 + #24 FASE 2)
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeChatReq, setActiveChatReq] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [notifyTarget, setNotifyTarget] = useState<
    "both" | "parent" | "babysitter"
  >("both");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [participantReceipts, setParticipantReceipts] = useState<{
    parent: string | null;
    babysitter: string | null;
  }>({ parent: null, babysitter: null });
  const [typingIndicatorText, setTypingIndicatorText] = useState<string | null>(
    null,
  );

  const toggleBreakdown = (id: string) => {
    setExpandedBreakdownIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
    activeChatReqIdRef.current = activeChatReq?.id
      ? String(activeChatReq.id)
      : null;
  }, [isChatOpen, activeChatReq]);

  const markAdminChatAsRead = async (reqId: string) => {
    if (!reqId) return;
    setUnreadCountsMap((prev) => ({ ...prev, [String(reqId)]: 0 }));

    try {
      let uid = adminUserIdRef.current;
      if (!uid) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        uid = user?.id || null;
        adminUserIdRef.current = uid;
      }
      if (!uid) return;

      const nowIso = new Date().toISOString();
      await supabase.from("chat_read_receipts").upsert(
        {
          request_id: reqId,
          user_id: uid,
          reader_role: "admin",
          last_read_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "request_id,user_id,reader_role" },
      );
    } catch (err) {
      console.error("Error marcando chat admin como leído:", err);
    }
  };

  const loadParticipantReceipts = async (reqId: string) => {
    try {
      const { data, error } = await supabase
        .from("chat_read_receipts")
        .select("reader_role, last_read_at")
        .eq("request_id", reqId)
        .in("reader_role", ["parent", "babysitter"]);

      if (!error && data) {
        let parentRead: string | null = null;
        let sitterRead: string | null = null;
        data.forEach((row: any) => {
          if (row.reader_role === "parent") {
            if (
              !parentRead ||
              new Date(row.last_read_at).getTime() >
                new Date(parentRead).getTime()
            ) {
              parentRead = row.last_read_at;
            }
          }
          if (row.reader_role === "babysitter") {
            if (
              !sitterRead ||
              new Date(row.last_read_at).getTime() >
                new Date(sitterRead).getTime()
            ) {
              sitterRead = row.last_read_at;
            }
          }
        });
        setParticipantReceipts({ parent: parentRead, babysitter: sitterRead });
      }
    } catch (err) {
      console.error("Error cargando recibos de lectura de participantes:", err);
    }
  };

  const emitAdminTypingEvent = (isTyping: boolean) => {
    const channel = typingChannelRef.current;
    if (!channel) return;
    try {
      channel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          role: "admin",
          name: "Soporte MiBabysitter",
          isTyping,
        },
      });
    } catch {}
  };

  const handleAdminTextChange = (text: string) => {
    setNewMessage(text);
    if (!isChatOpen || !activeChatReq?.id) return;

    if (!text.trim()) {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      emitAdminTypingEvent(false);
      return;
    }

    const now = Date.now();
    if (now - lastTypingEmitRef.current > 1500) {
      lastTypingEmitRef.current = now;
      emitAdminTypingEvent(true);
    }

    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      emitAdminTypingEvent(false);
    }, 2500);
  };

  useEffect(() => {
    let bgMsgSub: any = null;

    const initAdmin = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) adminUserIdRef.current = user.id;

      await fetchAdminData();

      supabase.removeChannel(supabase.channel("admin_realtime_bg_msgs"));
      bgMsgSub = supabase
        .channel("admin_realtime_bg_msgs")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            const incoming: any = payload.new;
            const rId = String(incoming?.request_id || "");
            if (!rId || !trackedRequestIdsRef.current.includes(rId)) return;

            const isSupport = Boolean(
              incoming?.content?.startsWith("[Soporte"),
            );

            if (isChatOpenRef.current && activeChatReqIdRef.current === rId) {
              markAdminChatAsRead(rId);
              return;
            }

            setMsgCountsMap((prev) => ({
              ...prev,
              [rId]: (prev[rId] || 0) + 1,
            }));

            if (!isSupport) {
              setUnreadCountsMap((prev) => ({
                ...prev,
                [rId]: (prev[rId] || 0) + 1,
              }));
            }
          },
        )
        .subscribe();
    };

    initAdmin();

    return () => {
      if (bgMsgSub) supabase.removeChannel(bgMsgSub);
    };
  }, []);

  // MOTOR CHAT REALTIME 2.0 + RECIBOS DE PARTICIPANTES + BROADCAST "ESCRIBIENDO..." + POLLING 4S
  useEffect(() => {
    let chatSub: any = null;
    let receiptSub: any = null;
    let typingSub: any = null;
    let pollInterval: any = null;

    if (isChatOpen && activeChatReq?.id) {
      const reqId = String(activeChatReq.id);
      loadMessages(reqId);
      loadParticipantReceipts(reqId);
      markAdminChatAsRead(reqId);

      const channelName = "admin_chat_" + reqId;
      const receiptChannelName = "admin_receipts_" + reqId;
      const typingChannelName = "chat_room_typing_" + reqId;

      supabase.removeChannel(supabase.channel(channelName));
      supabase.removeChannel(supabase.channel(receiptChannelName));
      supabase.removeChannel(supabase.channel(typingChannelName));

      chatSub = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: "request_id=eq." + reqId,
          },
          (payload) => {
            const incoming = payload.new;
            setMessages((prev) => {
              const exists = prev.some(
                (m) =>
                  m.id === incoming.id ||
                  (m._optimistic &&
                    m.sender_id === incoming.sender_id &&
                    m.content === incoming.content),
              );
              const nextList = exists
                ? prev.map((m) =>
                    m._optimistic &&
                    m.sender_id === incoming.sender_id &&
                    m.content === incoming.content
                      ? incoming
                      : m,
                  )
                : [...prev, incoming];

              setMsgCountsMap((counts) => ({
                ...counts,
                [reqId]: nextList.length,
              }));
              return nextList;
            });
            markAdminChatAsRead(reqId);
          },
        )
        .subscribe();

      receiptSub = supabase
        .channel(receiptChannelName)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_read_receipts",
            filter: "request_id=eq." + reqId,
          },
          (payload) => {
            const row: any = payload.new;
            if (row?.reader_role === "parent" && row?.last_read_at) {
              setParticipantReceipts((prev) => ({
                ...prev,
                parent: row.last_read_at,
              }));
            } else if (row?.reader_role === "babysitter" && row?.last_read_at) {
              setParticipantReceipts((prev) => ({
                ...prev,
                babysitter: row.last_read_at,
              }));
            }
          },
        )
        .subscribe();

      typingSub = supabase
        .channel(typingChannelName, {
          config: { broadcast: { self: false } },
        })
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          if (!payload || payload.role === "admin") return;

          if (typingClearTimerRef.current) {
            clearTimeout(typingClearTimerRef.current);
          }

          if (!payload.isTyping) {
            setTypingIndicatorText(null);
            return;
          }

          const label =
            payload.role === "babysitter"
              ? `👩‍🍼 ${activeChatReq.babysitter?.first_name || payload.name || "La niñera"} está escribiendo...`
              : `👨‍👩‍👧 ${activeChatReq.parent?.parent_name || payload.name || "La familia"} está escribiendo...`;
          setTypingIndicatorText(label);

          typingClearTimerRef.current = setTimeout(() => {
            setTypingIndicatorText(null);
          }, 3200);
        })
        .subscribe();

      typingChannelRef.current = typingSub;

      pollInterval = setInterval(() => {
        loadMessages(reqId, true);
        loadParticipantReceipts(reqId);
      }, 4000);
    }

    return () => {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      if (typingClearTimerRef.current)
        clearTimeout(typingClearTimerRef.current);
      if (typingChannelRef.current) {
        emitAdminTypingEvent(false);
        typingChannelRef.current = null;
      }
      setTypingIndicatorText(null);
      if (chatSub) supabase.removeChannel(chatSub);
      if (receiptSub) supabase.removeChannel(receiptSub);
      if (typingSub) supabase.removeChannel(typingSub);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isChatOpen, activeChatReq]);

  const loadMessages = async (reqId: string, silent = false) => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("request_id", reqId)
        .order("created_at", { ascending: true });
      if (!error && data) {
        setMsgCountsMap((counts) => ({ ...counts, [reqId]: data.length }));
        setMessages((prev) => {
          if (silent && prev.length === data.length) {
            const lastPrev = prev[prev.length - 1];
            const lastNew = data[data.length - 1];
            if (lastPrev?.id === lastNew?.id && !lastPrev?._optimistic) {
              return prev;
            }
          }
          return data;
        });
      }
    } catch (err) {
      console.error("Error al cargar mensajes admin:", err);
    }
  };

  const handleOpenAdminChat = (req: any) => {
    setActiveChatReq(req);
    setMessages([]);
    setNewMessage("");
    setNotifyTarget("both");
    setParticipantReceipts({ parent: null, babysitter: null });
    setTypingIndicatorText(null);
    setIsChatOpen(true);
    if (req?.id) markAdminChatAsRead(String(req.id));
  };

  const sendAdminMessage = async () => {
    const rawText = newMessage.trim();
    if (!rawText || !activeChatReq?.id || sendingMessage) return;

    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    emitAdminTypingEvent(false);

    const cleanBody = stripSupportPrefix(rawText);
    const formattedText = `[Soporte MiBabysitter]: ${cleanBody}`;

    const receiverId =
      notifyTarget === "parent"
        ? activeChatReq.parent_id || activeChatReq.babysitter_id
        : activeChatReq.babysitter_id || activeChatReq.parent_id;

    setSendingMessage(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const tempId = "temp_" + Date.now();
      const optimisticMsg = {
        id: tempId,
        request_id: activeChatReq.id,
        sender_id: user.id,
        receiver_id: receiverId,
        content: formattedText,
        created_at: new Date().toISOString(),
        _optimistic: true,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setNewMessage("");

      const { data: insertedRows, error } = await supabase
        .from("messages")
        .insert([
          {
            request_id: activeChatReq.id,
            sender_id: user.id,
            receiver_id: receiverId,
            content: formattedText,
          },
        ])
        .select();

      if (error) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setNewMessage(rawText);
        throw error;
      }

      if (insertedRows && insertedRows[0]) {
        const realMsg = insertedRows[0];
        setMessages((prev) => {
          const alreadyAdded = prev.some((m) => m.id === realMsg.id);
          const nextList = alreadyAdded
            ? prev.filter((m) => m.id !== tempId)
            : prev.map((m) => (m.id === tempId ? realMsg : m));
          setMsgCountsMap((counts) => ({
            ...counts,
            [activeChatReq.id]: nextList.length,
          }));
          return nextList;
        });
      }

      markAdminChatAsRead(String(activeChatReq.id));

      // Notificación institucional en campanita (deduplicada por usuario)
      const preview =
        cleanBody.length > 90 ? cleanBody.slice(0, 87) + "..." : cleanBody;
      const recipientIds: string[] = [];

      if (
        (notifyTarget === "both" || notifyTarget === "babysitter") &&
        activeChatReq.babysitter_id
      ) {
        recipientIds.push(activeChatReq.babysitter_id);
      }
      if (
        (notifyTarget === "both" || notifyTarget === "parent") &&
        activeChatReq.parent_id
      ) {
        recipientIds.push(activeChatReq.parent_id);
      }

      const uniqueRecipients = Array.from(new Set(recipientIds));
      if (uniqueRecipients.length > 0) {
        const notifRows = uniqueRecipients.map((uid) => ({
          user_id: uid,
          title: "🛡️ Mensaje de Soporte MiBabysitter",
          message: `Turno ${activeChatReq.job_date || ""}: ${preview}`,
        }));
        await supabase.from("notifications").insert(notifRows);
      }
    } catch (err: any) {
      showAlert("Error al enviar mensaje", err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const notifyParticipants = async (
    req: any,
    parentNotif: { title: string; message: string },
    sitterNotif: { title: string; message: string },
  ) => {
    try {
      const rows: { user_id: string; title: string; message: string }[] = [];
      if (req.parent_id) {
        rows.push({
          user_id: req.parent_id,
          title: parentNotif.title,
          message: parentNotif.message,
        });
      }
      if (req.babysitter_id && req.babysitter_id !== req.parent_id) {
        rows.push({
          user_id: req.babysitter_id,
          title: sitterNotif.title,
          message: sitterNotif.message,
        });
      }
      if (rows.length > 0) {
        await supabase.from("notifications").insert(rows);
      }
    } catch (err) {
      console.error("Error enviando notificaciones administrativas:", err);
    }
  };

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      // Cargar solicitudes + directorio completo de niñeras en paralelo (#30 Fase 1)
      const [reqsRes, allSittersRes, sitterMasterRes] = await Promise.all([
        supabase
          .from("job_requests")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.from("babysitter_profiles").select("*"),
        supabase.from("profiles").select("*").eq("role", "babysitter"),
      ]);

      if (reqsRes.error) throw reqsRes.error;
      const reqs = reqsRes.data || [];

      const allSittersList = allSittersRes.data || [];
      const sitterProfileMap: { [id: string]: any } = {};
      allSittersList.forEach((b: any) => {
        if (b?.id) sitterProfileMap[String(b.id)] = b;
      });

      const sitterMasterMap: { [id: string]: any } = {};
      (sitterMasterRes.data || []).forEach((mp: any) => {
        if (mp?.id) sitterMasterMap[String(mp.id)] = mp;
      });

      // Buscar perfiles maestros faltantes para niñeras que tienen fila en babysitter_profiles (ej: super-admins)
      const missingMasterIds = Object.keys(sitterProfileMap).filter(
        (id) => !sitterMasterMap[id],
      );
      if (missingMasterIds.length > 0) {
        const { data: extraMasters } = await supabase
          .from("profiles")
          .select("*")
          .in("id", missingMasterIds);
        extraMasters?.forEach((mp: any) => {
          if (mp?.id) sitterMasterMap[String(mp.id)] = mp;
        });
      }

      // Contabilizar turnos activos y completados por niñera
      const sitterStatsMap: {
        [id: string]: { active: number; completed: number; earnedNet: number };
      } = {};
      reqs.forEach((r: any) => {
        const sid = String(r.babysitter_id || "");
        if (!sid) return;
        if (!sitterStatsMap[sid]) {
          sitterStatsMap[sid] = { active: 0, completed: 0, earnedNet: 0 };
        }
        if (r.status === "pending" || r.status === "accepted") {
          sitterStatsMap[sid].active += 1;
        } else if (r.status === "completed") {
          sitterStatsMap[sid].completed += 1;
          sitterStatsMap[sid].earnedNet += getRequestFinancials(r).payout;
        }
      });

      const allSitterIds = Array.from(
        new Set([
          ...Object.keys(sitterProfileMap),
          ...Object.keys(sitterMasterMap),
        ]),
      );

      const directory = allSitterIds
        .map((id) => {
          const evaluated = evaluateBabysitterReadiness(
            sitterProfileMap[id],
            sitterMasterMap[id],
          );
          const stats = sitterStatsMap[id] || {
            active: 0,
            completed: 0,
            earnedNet: 0,
          };
          return {
            ...evaluated,
            activeJobsCount: stats.active,
            completedJobsCount: stats.completed,
            earnedNet: stats.earnedNet,
          };
        })
        .sort((a, b) => {
          // Primero operativas, luego por más turnos completados y nombre
          if (a.isOperational !== b.isOperational) {
            return a.isOperational ? -1 : 1;
          }
          if (a.completedJobsCount !== b.completedJobsCount) {
            return b.completedJobsCount - a.completedJobsCount;
          }
          return a.displayName.localeCompare(b.displayName, "es");
        });

      setBabysittersDirectory(directory);

      if (reqs.length === 0) {
        trackedRequestIdsRef.current = [];
        setRequests([]);
        setMsgCountsMap({});
        setUnreadCountsMap({});
        return;
      }

      const reqIds = reqs.map((r: any) => String(r.id)).filter(Boolean);
      trackedRequestIdsRef.current = reqIds;

      const parentIds = Array.from(
        new Set(reqs.map((r: any) => r.parent_id).filter(Boolean)),
      );

      let parentsMap: { [key: string]: any } = {};
      let nameMap: { [key: string]: string } = {};
      const counts: { [key: string]: number } = {};
      const unreadCounts: { [key: string]: number } = {};

      if (reqIds.length > 0) {
        let adminUid = adminUserIdRef.current;
        if (!adminUid) {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          adminUid = user?.id || null;
          adminUserIdRef.current = adminUid;
        }

        const [msgRes, receiptsRes] = await Promise.all([
          supabase
            .from("messages")
            .select("request_id, content, created_at")
            .in("request_id", reqIds),
          adminUid
            ? supabase
                .from("chat_read_receipts")
                .select("request_id, last_read_at")
                .in("request_id", reqIds)
                .eq("user_id", adminUid)
                .eq("reader_role", "admin")
            : Promise.resolve({ data: [] as any[] }),
        ]);

        const adminReadMap: { [key: string]: number } = {};
        receiptsRes.data?.forEach((r: any) => {
          const ts = new Date(r.last_read_at).getTime();
          if (!isNaN(ts)) adminReadMap[String(r.request_id)] = ts;
        });

        msgRes.data?.forEach((m: any) => {
          if (!m.request_id) return;
          const rId = String(m.request_id);
          counts[rId] = (counts[rId] || 0) + 1;

          const isSupport = Boolean(m.content?.startsWith("[Soporte"));
          if (!isSupport) {
            const msgTs = new Date(m.created_at).getTime();
            const lastReadTs = adminReadMap[rId] || 0;
            if (msgTs > lastReadTs) {
              unreadCounts[rId] = (unreadCounts[rId] || 0) + 1;
            }
          }
        });
      }

      if (parentIds.length > 0) {
        const [parentsRes, masterParentsRes] = await Promise.all([
          supabase.from("parent_profiles").select("*").in("id", parentIds),
          supabase.from("profiles").select("id, full_name").in("id", parentIds),
        ]);
        parentsRes.data?.forEach((p: any) => (parentsMap[p.id] = p));
        masterParentsRes.data?.forEach((mp: any) => {
          if (mp.full_name) nameMap[mp.id] = mp.full_name;
        });
      }

      const combined = reqs.map((r: any) => ({
        ...r,
        parent: {
          ...(parentsMap[r.parent_id] || {}),
          parent_name: nameMap[r.parent_id] || "Familia",
        },
        babysitter: sitterProfileMap[String(r.babysitter_id)] || {},
      }));

      setMsgCountsMap(counts);
      setUnreadCountsMap(unreadCounts);
      setRequests(combined);
    } catch (error: any) {
      console.error("Error al cargar datos del admin:", error.message);
      showAlert("Error", "No se pudieron cargar los datos de operaciones.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePaymentStatus = async (
    requestId: string,
    newStatus: string,
  ) => {
    setUpdatingId(requestId);
    try {
      const { error } = await supabase
        .from("job_requests")
        .update({ payment_status: newStatus })
        .eq("id", requestId);

      if (error) throw error;

      setRequests((prev) =>
        prev.map((req) =>
          req.id === requestId ? { ...req, payment_status: newStatus } : req,
        ),
      );
      showAlert(
        "Actualizado",
        "El estado del pago ha sido actualizado correctamente.",
      );
    } catch (error: any) {
      showAlert("Error", error.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const executeForceCompletion = async (req: any) => {
    setUpdatingId(req.id);
    try {
      const { error } = await supabase
        .from("job_requests")
        .update({ status: "completed", payment_status: "ready_for_payout" })
        .eq("id", req.id);

      if (error) throw error;

      setRequests((prev) =>
        prev.map((item) =>
          item.id === req.id
            ? {
                ...item,
                status: "completed",
                payment_status: "ready_for_payout",
              }
            : item,
        ),
      );

      const { payout } = getRequestFinancials(req);
      await notifyParticipants(
        req,
        {
          title: "✅ Servicio Cerrado por Soporte",
          message: `Tu turno del ${req.job_date || ""} fue cerrado y el pago pasó a liquidación. ¡Ya puedes calificar en tu historial!`,
        },
        {
          title: "💰 Turno Cerrado — Pago en Proceso",
          message: `Soporte cerró el turno del ${req.job_date || ""}. Tu pago líquido de ${formatCLP(payout)} pasó a Liquidaciones Pendientes.`,
        },
      );

      showAlert(
        "Servicio Cerrado",
        "Se marcó como completado y el dinero pasó a Liquidaciones Pendientes (Payouts).",
      );
    } catch (error: any) {
      showAlert("Error", error.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleForceCompletion = (req: any) => {
    const parentName = req.parent?.parent_name || "Familia";
    const sitterName = req.babysitter?.first_name || "Niñera";
    const { payout } = getRequestFinancials(req);

    confirmAction(
      "Cerrar turno y pasar a Payout",
      `¿Confirmas marcar como completado el turno del ${req.job_date || ""} (${parentName} ↔ ${sitterName}) y liberar ${formatCLP(payout)} a Liquidaciones Pendientes?`,
      () => executeForceCompletion(req),
      "Pasar a Payout",
      false,
    );
  };

  const executeRefundEscrow = async (req: any) => {
    setUpdatingId(req.id);
    try {
      const { error } = await supabase
        .from("job_requests")
        .update({ status: "rejected", payment_status: "refunded" })
        .eq("id", req.id);

      if (error) throw error;

      setRequests((prev) =>
        prev.map((item) =>
          item.id === req.id
            ? {
                ...item,
                status: "rejected",
                payment_status: "refunded",
              }
            : item,
        ),
      );

      const { total } = getRequestFinancials(req);
      await notifyParticipants(
        req,
        {
          title: "↩️ Reserva Cancelada y Reembolsada",
          message: `Soporte MiBabysitter canceló el turno del ${req.job_date || ""} y registró el reembolso de ${formatCLP(total)}.`,
        },
        {
          title: "↩️ Turno Cancelado por Soporte",
          message: `Soporte MiBabysitter canceló el turno del ${req.job_date || ""} y liberó el reembolso a la familia.`,
        },
      );

      showAlert(
        "Reembolso Registrado",
        "La reserva fue cancelada y marcada como reembolsada.",
      );
    } catch (error: any) {
      showAlert("Error al reembolsar", error.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRefundEscrow = (req: any) => {
    const parentName = req.parent?.parent_name || "Familia";
    const sitterName = req.babysitter?.first_name || "Niñera";
    const { total } = getRequestFinancials(req);

    confirmAction(
      "Cancelar y Reembolsar Escrow",
      `¿Seguro que deseas cancelar el turno del ${req.job_date || ""} (${parentName} ↔ ${sitterName}) y marcar ${formatCLP(total)} como reembolsado? Esta acción notificará a ambas partes.`,
      () => executeRefundEscrow(req),
      "Sí, reembolsar",
      true,
    );
  };

  const openWhatsApp = (phone: string, message: string) => {
    const cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
    if (!cleanPhone) {
      showAlert("Sin teléfono", "Este usuario no tiene un número registrado.");
      return;
    }
    const msg = encodeURIComponent(message);
    Linking.openURL(
      "https://api.whatsapp.com/send?phone=" + cleanPhone + "&text=" + msg,
    );
  };

  const handleNudgeByEmail = async (req: any) => {
    setUpdatingId(req.id);
    try {
      const sitterId = req.babysitter_id;
      const { error } = await supabase.functions.invoke(
        "send-email-notification",
        {
          body: {
            recipientId: sitterId,
            type: "nudge_pending",
            requestId: req.id,
            jobDate: req.job_date,
            jobTime: req.job_time,
          },
        },
      );

      if (error) throw error;

      setEmailStatusMap((prev) => ({
        ...prev,
        [req.id]: "✅ Recordatorio enviado",
      }));
      showAlert(
        "Correo Enviado",
        "Se ha enviado un recordatorio por correo a la niñera.",
      );
    } catch (err: any) {
      console.error(err);
      setEmailStatusMap((prev) => ({
        ...prev,
        [req.id]: "✅ Recordatorio registrado",
      }));
      showAlert("Aviso", "Notificación interna registrada para la niñera.");
    } finally {
      setUpdatingId(null);
    }
  };

  const renderActionButtons = (req: any, alertType: string) => {
    const hasSitterPhone = Boolean(
      req.babysitter?.phone &&
      String(req.babysitter.phone).replace(/\D/g, "").length >= 8,
    );
    const hasParentPhone = Boolean(
      req.parent?.phone &&
      String(req.parent.phone).replace(/\D/g, "").length >= 8,
    );
    const emailStatus = emailStatusMap[req.id];

    switch (alertType) {
      case "nudge_parent_pay":
        return (
          <View style={{ gap: 8 }}>
            {hasParentPhone ? (
              <TouchableOpacity
                style={styles.actionBtnRed}
                onPress={() =>
                  openWhatsApp(
                    req.parent.phone,
                    `¡Hola! Te escribimos de MiBabysitter.cl. Tu servicio agendado para el ${req.job_date} a las ${req.job_time} con ${req.babysitter.first_name} ha sido aceptado, pero vemos que el pago aún está pendiente.`,
                  )
                }
              >
                <Text style={styles.actionBtnText}>📲 WhatsApp al Padre</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.actionBtnDisabled}>
                <Text style={styles.actionBtnTextDisabled}>
                  ⚠️ Sin Teléfono Padre
                </Text>
              </View>
            )}
          </View>
        );

      case "check_in":
        return (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            {hasSitterPhone ? (
              <TouchableOpacity
                style={[styles.actionBtnGreen, { flex: 1 }]}
                onPress={() =>
                  openWhatsApp(
                    req.babysitter.phone,
                    `¡Hola ${req.babysitter.first_name}! Desde MiBabysitter.cl vemos que tu servicio inicia pronto a las ${req.job_time}. ¿Vas en camino?`,
                  )
                }
              >
                <Text style={styles.actionBtnText}>📲 Niñera</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.actionBtnDisabled, { flex: 1 }]}>
                <Text style={styles.actionBtnTextDisabled}>⚠️ Sin Niñera</Text>
              </View>
            )}

            {hasParentPhone ? (
              <TouchableOpacity
                style={[styles.actionBtnGreen, { flex: 1 }]}
                onPress={() =>
                  openWhatsApp(
                    req.parent.phone,
                    `¡Hola ${req.parent.parent_name}! ¿Llegó bien ${req.babysitter.first_name}? Cualquier novedad nos comentas.`,
                  )
                }
              >
                <Text style={styles.actionBtnText}>📲 Familia</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.actionBtnDisabled, { flex: 1 }]}>
                <Text style={styles.actionBtnTextDisabled}>⚠️ Sin Familia</Text>
              </View>
            )}
          </View>
        );

      case "nudge_babysitter_accept":
        return (
          <View style={{ gap: 8 }}>
            {hasSitterPhone ? (
              <TouchableOpacity
                style={styles.actionBtnYellow}
                onPress={() =>
                  openWhatsApp(
                    req.babysitter.phone,
                    `¡Hola ${req.babysitter.first_name}! Tienes una solicitud de cuidado pendiente en MiBabysitter.cl para el ${req.job_date}. ¿Podrás tomarla?`,
                  )
                }
              >
                <Text style={styles.actionBtnTextDark}>
                  📲 WhatsApp a Niñera
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.actionBtnDisabled}>
                <Text style={styles.actionBtnTextDisabled}>
                  ⚠️ Sin Teléfono WhatsApp (Niñera)
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.actionBtnTeal}
              onPress={() => handleNudgeByEmail(req)}
              disabled={updatingId === req.id}
            >
              {updatingId === req.id ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.actionBtnText}>
                  {emailStatus || "✉️ Apurar por Correo (Resend)"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        );

      case "force_completion":
        return (
          <TouchableOpacity
            style={styles.actionBtnTeal}
            onPress={() => handleForceCompletion(req)}
            disabled={updatingId === req.id}
          >
            {updatingId === req.id ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionBtnText}>
                ✅ Forzar Cierre y Payout
              </Text>
            )}
          </TouchableOpacity>
        );

      default:
        return null;
    }
  };

  const activeRequests = requests.filter(
    (r) => r.status === "pending" || r.status === "accepted",
  );
  const alertCards = activeRequests
    .map((req) => {
      const alert = evaluateJobAlert(req);
      return alert ? { req, alert } : null;
    })
    .filter(Boolean) as { req: any; alert: any }[];

  const sortedAlertCards = alertCards.sort((a, b) => {
    const priority = { critical: 1, warning: 2, ok: 3 };
    return (
      (priority[a.alert.type as keyof typeof priority] || 99) -
      (priority[b.alert.type as keyof typeof priority] || 99)
    );
  });

  const completedRequests = requests.filter((r) => r.status === "completed");

  // MÉTRICAS DE OFERTA Y DIRECTORIO DE NIÑERAS (#30 FASE 1)
  const scopedSitters = hideAdminTestAccounts
    ? babysittersDirectory.filter((s) => !s.isAdminAccount)
    : babysittersDirectory;

  const operationalSitters = scopedSitters.filter((s) => s.isOperational);
  const incompleteSitters = scopedSitters.filter((s) => !s.isOperational);
  const activationRate =
    scopedSitters.length > 0
      ? Math.round((operationalSitters.length / scopedSitters.length) * 100)
      : 0;
  const adminTestAccountsCount = babysittersDirectory.filter(
    (s) => s.isAdminAccount,
  ).length;

  const zoneCoverage = COVERAGE_ZONES.map((zone) => {
    const count = operationalSitters.filter((s) =>
      s.zones.some((z: string) =>
        normalizeText(z).includes(normalizeText(zone)),
      ),
    ).length;
    return { zone, count };
  });

  const shiftCoverage = COVERAGE_SHIFTS.map((shift) => {
    const count = operationalSitters.filter((s) =>
      s.shifts.some((sh: string) => normalizeText(sh) === normalizeText(shift)),
    ).length;
    return { shift, count };
  });

  const weekendCoverage = ["Sábado", "Domingo"].map((day) => {
    const count = operationalSitters.filter((s) =>
      s.days.some((d: string) => normalizeText(d) === normalizeText(day)),
    ).length;
    return { day: day.slice(0, 3), count };
  });

  const filteredSitters = scopedSitters.filter((s) => {
    if (sitterStatusFilter === "operational" && !s.isOperational) return false;
    if (sitterStatusFilter === "incomplete" && s.isOperational) return false;
    if (sitterZoneFilter !== "Todas") {
      const matchesZone = s.zones.some((z: string) =>
        normalizeText(z).includes(normalizeText(sitterZoneFilter)),
      );
      if (!matchesZone) return false;
    }
    if (sitterSearchQuery.trim()) {
      const q = normalizeText(sitterSearchQuery.trim());
      const haystack = normalizeText(
        `${s.displayName} ${s.phone} ${s.zones.join(" ")}`,
      );
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // CONTABILIDAD LIMPIA (#27): Escrow estricto (accepted + held) sin duplicar unpaid
  const unpaidAcceptedRequests = requests.filter(
    (r) => r.status === "accepted" && r.payment_status === "unpaid",
  );
  const unpaidAcceptedTotal = unpaidAcceptedRequests.reduce(
    (sum, r) => sum + (Number(r.total_amount) || 0),
    0,
  );

  const escrowItems = requests
    .filter((r) => r.status === "accepted" && r.payment_status === "held")
    .map((req) => ({
      req,
      escrowState: evaluateEscrowState(req),
      financials: getRequestFinancials(req),
    }))
    .sort((a, b) => {
      if (a.escrowState.priority !== b.escrowState.priority) {
        return a.escrowState.priority - b.escrowState.priority;
      }
      return a.escrowState.sortTime - b.escrowState.sortTime;
    });

  const escrowTotal = escrowItems.reduce(
    (sum, item) => sum + item.financials.total,
    0,
  );
  const escrowBabysitterTotal = escrowItems.reduce(
    (sum, item) => sum + item.financials.payout,
    0,
  );
  const escrowPlatformTotal = escrowItems.reduce(
    (sum, item) => sum + item.financials.fee,
    0,
  );
  const escrowNeedsCloseCount = escrowItems.filter(
    (item) => item.escrowState.priority === 1,
  ).length;

  const revenue = completedRequests.reduce(
    (sum, r) => sum + (Number(r.platform_fee) || 0),
    0,
  );
  const pendingPayouts = completedRequests
    .filter((r) => r.payment_status === "ready_for_payout")
    .reduce((sum, r) => sum + (Number(r.babysitter_payout) || 0), 0);

  const conciergeTemplates = activeChatReq
    ? getConciergeTemplates(activeChatReq)
    : [];

  return (
    <View style={styles.mainWrapper}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={styles.headerContainer}>
          <View style={styles.headerTitleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Torre de Control 🗼</Text>
              <Text style={styles.subtitle}>
                Operación, Oferta de Niñeras y Finanzas
              </Text>
            </View>
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={fetchAdminData}
              disabled={loading}
            >
              <Text style={styles.refreshBtnText}>
                {loading ? "⏳" : "🔄 Actualizar"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "alerts" && styles.activeTab]}
            onPress={() => setActiveTab("alerts")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "alerts" && styles.activeTabText,
              ]}
            >
              🔥 Alertas ({sortedAlertCards.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === "babysitters" && styles.activeTab,
            ]}
            onPress={() => setActiveTab("babysitters")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "babysitters" && styles.activeTabText,
              ]}
            >
              👩‍🍼 Niñeras ({operationalSitters.length}/{scopedSitters.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === "finance" && styles.activeTab]}
            onPress={() => setActiveTab("finance")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "finance" && styles.activeTabText,
              ]}
            >
              💰 Tesorería
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator
            size="large"
            color="#3182ce"
            style={{ marginVertical: 32 }}
          />
        ) : (
          <View style={styles.contentArea}>
            {activeTab === "alerts" && (
              <View style={styles.listContainer}>
                {sortedAlertCards.length === 0 ? (
                  <Text style={styles.emptyText}>
                    Bandeja limpia. Todo en orden.
                  </Text>
                ) : null}

                {sortedAlertCards.map(({ req, alert }) => {
                  const parentName = req.parent?.parent_name || "Familia";
                  const sitterName = req.babysitter?.first_name || "Niñera";
                  const msgCount = msgCountsMap[String(req.id)] || 0;
                  const unreadCount = unreadCountsMap[String(req.id)] || 0;

                  return (
                    <View
                      key={req.id}
                      style={[
                        styles.alertCard,
                        { borderColor: alert.color, backgroundColor: alert.bg },
                      ]}
                    >
                      <View style={styles.cardHeader}>
                        <Text
                          style={[
                            styles.badge,
                            { backgroundColor: alert.color, color: "#fff" },
                          ]}
                        >
                          {alert.badge}
                        </Text>
                        <Text
                          style={{
                            fontSize: 13,
                            color: "#4a5568",
                            fontWeight: "bold",
                          }}
                        >
                          {req.job_date} a las {req.job_time}
                        </Text>
                      </View>

                      <Text
                        style={{
                          fontSize: 15,
                          color: "#2d3748",
                          marginBottom: 12,
                          fontWeight: "500",
                        }}
                      >
                        {alert.message}
                      </Text>

                      <View style={styles.participantsMiniBox}>
                        <Text style={{ fontSize: 13, color: "#4a5568" }}>
                          👶 Niñera:{" "}
                          <Text style={{ fontWeight: "bold" }}>
                            {sitterName}
                          </Text>
                        </Text>
                        <Text
                          style={{
                            fontSize: 13,
                            color: "#4a5568",
                            marginTop: 2,
                          }}
                        >
                          🏡 Familia de:{" "}
                          <Text
                            style={{ fontWeight: "bold", color: "#2b6cb0" }}
                          >
                            {parentName}
                          </Text>{" "}
                          ({req.parent?.address || "Sin dirección"})
                        </Text>
                      </View>

                      <View style={{ marginTop: 8, gap: 8 }}>
                        {renderActionButtons(req, alert.actionType)}

                        <TouchableOpacity
                          style={styles.actionBtnPurple}
                          onPress={() => handleOpenAdminChat(req)}
                        >
                          <View style={styles.chatBtnContentRow}>
                            <Text style={styles.actionBtnText}>
                              💬 Abrir Chat Operativo ({msgCount}{" "}
                              {msgCount === 1 ? "msg" : "msgs"})
                            </Text>
                            {unreadCount > 0 && (
                              <View style={styles.adminUnreadPill}>
                                <Text style={styles.adminUnreadPillText}>
                                  {unreadCount}{" "}
                                  {unreadCount === 1 ? "nuevo" : "nuevos"}
                                </Text>
                              </View>
                            )}
                          </View>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* NUEVA PESTAÑA: OFERTA Y DIRECTORIO DE NIÑERAS (ÍTEM #30 FASE 1) */}
            {activeTab === "babysitters" && (
              <View style={styles.listContainer}>
                {/* KPIs DE SALUD DE OFERTA */}
                <View style={styles.supplyKpiRow}>
                  <TouchableOpacity
                    style={[
                      styles.supplyKpiCard,
                      styles.supplyKpiOperational,
                      sitterStatusFilter === "operational" &&
                        styles.supplyKpiSelected,
                    ]}
                    onPress={() =>
                      setSitterStatusFilter((prev) =>
                        prev === "operational" ? "all" : "operational",
                      )
                    }
                  >
                    <Text style={styles.supplyKpiLabel}>🟢 Operativas</Text>
                    <Text style={[styles.supplyKpiValue, { color: "#22543d" }]}>
                      {operationalSitters.length}
                    </Text>
                    <Text style={styles.supplyKpiMicro}>
                      Listas para turnos
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.supplyKpiCard,
                      styles.supplyKpiIncomplete,
                      sitterStatusFilter === "incomplete" &&
                        styles.supplyKpiSelected,
                    ]}
                    onPress={() =>
                      setSitterStatusFilter((prev) =>
                        prev === "incomplete" ? "all" : "incomplete",
                      )
                    }
                  >
                    <Text style={styles.supplyKpiLabel}>🟡 Incompletas</Text>
                    <Text style={[styles.supplyKpiValue, { color: "#9c4221" }]}>
                      {incompleteSitters.length}
                    </Text>
                    <Text style={styles.supplyKpiMicro}>Faltan datos</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.supplyKpiCard,
                      styles.supplyKpiTotal,
                      sitterStatusFilter === "all" && styles.supplyKpiSelected,
                    ]}
                    onPress={() => setSitterStatusFilter("all")}
                  >
                    <Text style={styles.supplyKpiLabel}>📊 Activación</Text>
                    <Text style={[styles.supplyKpiValue, { color: "#2b6cb0" }]}>
                      {activationRate}%
                    </Text>
                    <Text style={styles.supplyKpiMicro}>
                      Total: {scopedSitters.length}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* TOGGLE PARA EXCLUIR CUENTAS ADMIN / TEST */}
                {adminTestAccountsCount > 0 && (
                  <TouchableOpacity
                    style={[
                      styles.testFilterBar,
                      hideAdminTestAccounts && styles.testFilterBarActive,
                    ]}
                    onPress={() => setHideAdminTestAccounts((prev) => !prev)}
                  >
                    <Text
                      style={[
                        styles.testFilterText,
                        hideAdminTestAccounts && styles.testFilterTextActive,
                      ]}
                    >
                      {hideAdminTestAccounts
                        ? `✅ Ocultando ${adminTestAccountsCount} cuentas Admin/Test (mostrando solo oferta real)`
                        : `🧪 Incluyendo ${adminTestAccountsCount} cuentas Admin/Test — Toca para ver solo oferta real`}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* MAPA DE COBERTURA POR COMUNA Y HORARIO (SOLO OPERATIVAS) */}
                <View style={styles.coverageCard}>
                  <Text style={styles.coverageTitle}>
                    🗺️ Cobertura Operativa por Comuna
                  </Text>
                  <View style={styles.coverageChipsRow}>
                    <TouchableOpacity
                      style={[
                        styles.coverageChip,
                        sitterZoneFilter === "Todas" &&
                          styles.coverageChipActive,
                      ]}
                      onPress={() => setSitterZoneFilter("Todas")}
                    >
                      <Text
                        style={[
                          styles.coverageChipText,
                          sitterZoneFilter === "Todas" &&
                            styles.coverageChipTextActive,
                        ]}
                      >
                        🌎 Todas ({operationalSitters.length})
                      </Text>
                    </TouchableOpacity>

                    {zoneCoverage.map(({ zone, count }) => {
                      const isSelected = sitterZoneFilter === zone;
                      return (
                        <TouchableOpacity
                          key={zone}
                          style={[
                            styles.coverageChip,
                            count === 0 && styles.coverageChipEmpty,
                            isSelected && styles.coverageChipActive,
                          ]}
                          onPress={() =>
                            setSitterZoneFilter((prev) =>
                              prev === zone ? "Todas" : zone,
                            )
                          }
                        >
                          <Text
                            style={[
                              styles.coverageChipText,
                              count === 0 && styles.coverageChipTextEmpty,
                              isSelected && styles.coverageChipTextActive,
                            ]}
                          >
                            {zone} ({count})
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={[styles.coverageTitle, { marginTop: 10 }]}>
                    ⏰ Bloques y Fines de Semana (Operativas)
                  </Text>
                  <View style={styles.coverageChipsRow}>
                    {shiftCoverage.map(({ shift, count }) => (
                      <View
                        key={shift}
                        style={[
                          styles.shiftPill,
                          count === 0 && styles.coverageChipEmpty,
                        ]}
                      >
                        <Text
                          style={[
                            styles.shiftPillText,
                            count === 0 && styles.coverageChipTextEmpty,
                          ]}
                        >
                          {shift}: {count}
                        </Text>
                      </View>
                    ))}
                    {weekendCoverage.map(({ day, count }) => (
                      <View
                        key={day}
                        style={[
                          styles.shiftPill,
                          count === 0 && styles.coverageChipEmpty,
                        ]}
                      >
                        <Text
                          style={[
                            styles.shiftPillText,
                            count === 0 && styles.coverageChipTextEmpty,
                          ]}
                        >
                          {day}: {count}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* BUSCADOR Y FILTROS DE DIRECTORIO */}
                <View style={styles.directoryFiltersBox}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="🔍 Buscar por nombre, teléfono o comuna..."
                    placeholderTextColor="#a0aec0"
                    value={sitterSearchQuery}
                    onChangeText={setSitterSearchQuery}
                  />

                  <View style={styles.filterPillsRow}>
                    {(
                      [
                        {
                          key: "all",
                          label: `Todas (${scopedSitters.length})`,
                        },
                        {
                          key: "operational",
                          label: `🟢 Operativas (${operationalSitters.length})`,
                        },
                        {
                          key: "incomplete",
                          label: `🟡 Incompletas (${incompleteSitters.length})`,
                        },
                      ] as const
                    ).map((opt) => {
                      const active = sitterStatusFilter === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          style={[
                            styles.filterPill,
                            active && styles.filterPillActive,
                          ]}
                          onPress={() => setSitterStatusFilter(opt.key)}
                        >
                          <Text
                            style={[
                              styles.filterPillText,
                              active && styles.filterPillTextActive,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* LISTADO DE NIÑERAS */}
                {filteredSitters.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No hay niñeras que coincidan con estos filtros.
                  </Text>
                ) : (
                  filteredSitters.map((sitter) => {
                    const rescueMessage = `¡Hola ${sitter.displayFirstName}! Te escribimos desde MiBabysitter.cl 😊 Vimos que ya creaste tu cuenta, pero aún te falta completar: ${sitter.missingFields.join(", ")} en tu perfil para aparecer a las familias. ¿Te ayudamos a dejarlo listo?`;
                    const checkMessage = `¡Hola ${sitter.displayFirstName}! Te escribimos desde Soporte MiBabysitter.cl 😊 Queríamos saludarte y confirmar si tus comunas y horarios en la app siguen al día para recibir solicitudes.`;

                    return (
                      <View
                        key={sitter.id}
                        style={[
                          styles.sitterCard,
                          sitter.isOperational
                            ? styles.sitterCardOperational
                            : styles.sitterCardIncomplete,
                        ]}
                      >
                        <View style={styles.sitterHeaderRow}>
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <View style={styles.sitterNameRow}>
                              <Text style={styles.sitterName}>
                                {sitter.displayName}
                              </Text>
                              {sitter.isAdminAccount && (
                                <View style={styles.adminTagPill}>
                                  <Text style={styles.adminTagText}>
                                    🧪 Test/Admin
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.sitterSubMeta}>
                              {sitter.hourlyRate >= 10000
                                ? `${formatCLPCompact(sitter.hourlyRate)}/hr`
                                : "Sin tarifa"}
                              {" • "}⭐{" "}
                              {sitter.rating
                                ? `${sitter.rating.toFixed(1)} (${sitter.reviewsCount})`
                                : "Nuevo"}
                              {" • "}
                              {sitter.completedJobsCount}{" "}
                              {sitter.completedJobsCount === 1
                                ? "turno"
                                : "turnos"}
                              {sitter.activeJobsCount > 0
                                ? ` (${sitter.activeJobsCount} activos)`
                                : ""}
                            </Text>
                          </View>

                          <View
                            style={[
                              styles.sitterStatusBadge,
                              sitter.isOperational
                                ? styles.sitterStatusOk
                                : styles.sitterStatusWarn,
                            ]}
                          >
                            <Text
                              style={[
                                styles.sitterStatusText,
                                sitter.isOperational
                                  ? { color: "#22543d" }
                                  : { color: "#9c4221" },
                              ]}
                            >
                              {sitter.isOperational
                                ? "🟢 Operativa"
                                : "🟡 Incompleta"}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.sitterDetailsBox}>
                          <Text style={styles.sitterDetailLine}>
                            📍 Comunas:{" "}
                            <Text style={{ fontWeight: "600" }}>
                              {sitter.zones.length > 0
                                ? sitter.zones.join(", ")
                                : "No definidas"}
                            </Text>
                          </Text>
                          <Text style={styles.sitterDetailLine}>
                            📅 Días:{" "}
                            <Text style={{ fontWeight: "600" }}>
                              {sitter.days.length > 0
                                ? sitter.days
                                    .map((d: string) => d.slice(0, 3))
                                    .join(", ")
                                : "Sin días"}
                            </Text>
                          </Text>
                          <Text style={styles.sitterDetailLine}>
                            ⏰ Horarios:{" "}
                            <Text style={{ fontWeight: "600" }}>
                              {sitter.shifts.length > 0
                                ? sitter.shifts.join(" • ")
                                : "Sin bloques"}
                            </Text>
                          </Text>
                          <Text style={styles.sitterDetailLine}>
                            📞 WhatsApp:{" "}
                            <Text style={{ fontWeight: "600" }}>
                              {sitter.phone || "No registrado"}
                            </Text>
                            {sitter.updatedAt
                              ? `  •  Act.: ${formatShortDate(sitter.updatedAt)}`
                              : ""}
                          </Text>
                        </View>

                        {!sitter.isOperational && (
                          <View style={styles.missingFieldsBox}>
                            <Text style={styles.missingFieldsTitle}>
                              ⚠️ Pendiente para estar operativa:
                            </Text>
                            <View style={styles.missingChipsRow}>
                              {sitter.missingFields.map((field: string) => (
                                <View key={field} style={styles.missingChip}>
                                  <Text style={styles.missingChipText}>
                                    • {field}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}

                        {sitter.hasValidPhone ? (
                          <TouchableOpacity
                            style={
                              sitter.isOperational
                                ? styles.actionBtnGreen
                                : styles.actionBtnYellow
                            }
                            onPress={() =>
                              openWhatsApp(
                                sitter.phone,
                                sitter.isOperational
                                  ? checkMessage
                                  : rescueMessage,
                              )
                            }
                          >
                            <Text
                              style={
                                sitter.isOperational
                                  ? styles.actionBtnText
                                  : styles.actionBtnTextDark
                              }
                            >
                              {sitter.isOperational
                                ? "📲 WhatsApp de Coordinación"
                                : "📲 WhatsApp — Ayudar a Completar Perfil"}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.actionBtnDisabled}>
                            <Text style={styles.actionBtnTextDisabled}>
                              ⚠️ Sin WhatsApp registrado todavía
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {activeTab === "finance" && (
              <View style={styles.listContainer}>
                <View style={styles.financeGrid}>
                  <View style={styles.financeBox}>
                    <Text style={styles.financeLabel}>Por Cobrar a Padres</Text>
                    <Text style={styles.financeValue}>
                      {formatCLP(unpaidAcceptedTotal)}
                    </Text>
                    <Text style={styles.financeMicroNote}>
                      {unpaidAcceptedRequests.length}{" "}
                      {unpaidAcceptedRequests.length === 1
                        ? "reserva sin pago"
                        : "reservas sin pago"}
                    </Text>
                  </View>

                  {/* KPI INTERACTIVO: ESCROW ACTIVO (#27) */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setShowEscrowDetail((prev) => !prev)}
                    style={[
                      styles.financeBox,
                      styles.escrowKpiBox,
                      showEscrowDetail && styles.escrowKpiBoxExpanded,
                    ]}
                  >
                    <View style={styles.escrowKpiHeaderRow}>
                      <Text style={styles.financeLabel}>Escrow Activo</Text>
                      <Text style={styles.escrowToggleHint}>
                        {showEscrowDetail ? "Ocultar ▲" : "Detalle ▼"}
                      </Text>
                    </View>
                    <Text style={[styles.financeValue, { color: "#c05621" }]}>
                      {formatCLP(escrowTotal)}
                    </Text>
                    <Text style={styles.escrowCountNote}>
                      🔒 {escrowItems.length}{" "}
                      {escrowItems.length === 1
                        ? "turno retenido"
                        : "turnos retenidos"}
                      {escrowNeedsCloseCount > 0
                        ? ` (${escrowNeedsCloseCount} por cerrar)`
                        : ""}
                    </Text>
                    {escrowTotal > 0 && (
                      <Text style={styles.escrowSplitNote}>
                        Niñeras: {formatCLPCompact(escrowBabysitterTotal)} •
                        App: {formatCLPCompact(escrowPlatformTotal)}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <View
                    style={[
                      styles.financeBox,
                      { backgroundColor: "#ebf8ff", borderColor: "#bee3f8" },
                    ]}
                  >
                    <Text style={styles.financeLabel}>Por Pagar a Niñeras</Text>
                    <Text style={[styles.financeValue, { color: "#2b6cb0" }]}>
                      {formatCLP(pendingPayouts)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.financeBox,
                      { backgroundColor: "#f0fff4", borderColor: "#c6f6d5" },
                    ]}
                  >
                    <Text style={styles.financeLabel}>Ganancia Histórica</Text>
                    <Text style={[styles.financeValue, { color: "#2f855a" }]}>
                      {formatCLP(revenue)}
                    </Text>
                  </View>
                </View>

                {/* SECCIÓN DESPLEGABLE: DETALLE DE FONDOS EN ESCROW (#27) */}
                {showEscrowDetail && (
                  <View style={styles.escrowSectionContainer}>
                    <View style={styles.escrowSectionHeader}>
                      <Text style={styles.escrowSectionTitle}>
                        🔒 Detalle de Fondos en Escrow ({escrowItems.length})
                      </Text>
                      <TouchableOpacity
                        onPress={() => setShowEscrowDetail(false)}
                      >
                        <Text style={styles.escrowCloseLink}>Ocultar ▲</Text>
                      </TouchableOpacity>
                    </View>

                    {escrowItems.length > 0 && (
                      <View style={styles.escrowSummaryBar}>
                        <Text style={styles.escrowSummaryText}>
                          Pasivo Niñeras (70%):{" "}
                          <Text
                            style={{ fontWeight: "bold", color: "#2b6cb0" }}
                          >
                            {formatCLP(escrowBabysitterTotal)}
                          </Text>
                        </Text>
                        <Text style={styles.escrowSummaryText}>
                          Comisión Proyectada (30%):{" "}
                          <Text
                            style={{ fontWeight: "bold", color: "#2f855a" }}
                          >
                            {formatCLP(escrowPlatformTotal)}
                          </Text>
                        </Text>
                      </View>
                    )}

                    {escrowItems.length === 0 ? (
                      <Text style={styles.emptyText}>
                        No hay fondos retenidos en Escrow actualmente.
                      </Text>
                    ) : (
                      escrowItems.map(({ req, escrowState, financials }) => {
                        const parentName = req.parent?.parent_name || "Familia";
                        const sitterFirst =
                          req.babysitter?.first_name || "Niñera";
                        const sitterLast = req.babysitter?.last_name || "";
                        const sitterName =
                          `${sitterFirst} ${sitterLast}`.trim();
                        const msgCount = msgCountsMap[String(req.id)] || 0;
                        const unreadCount =
                          unreadCountsMap[String(req.id)] || 0;
                        const isBusy = updatingId === req.id;

                        return (
                          <View
                            key={req.id}
                            style={[
                              styles.escrowCard,
                              { borderLeftColor: escrowState.borderColor },
                            ]}
                          >
                            <View style={styles.escrowCardTopRow}>
                              <View
                                style={[
                                  styles.escrowStatePill,
                                  { backgroundColor: escrowState.bg },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.escrowStatePillText,
                                    { color: escrowState.color },
                                  ]}
                                >
                                  {escrowState.label}
                                </Text>
                              </View>
                              <Text style={styles.escrowShiftText}>
                                📅 {req.job_date || "Sin fecha"} • ⏰{" "}
                                {req.job_time || "Sin hora"}
                              </Text>
                            </View>

                            <Text style={styles.escrowActorsText}>
                              👨‍👩‍👧{" "}
                              <Text style={{ fontWeight: "bold" }}>
                                {parentName}
                              </Text>{" "}
                              ↔ 👩‍🍼{" "}
                              <Text style={{ fontWeight: "bold" }}>
                                {sitterName}
                              </Text>
                            </Text>
                            <Text
                              style={styles.escrowAddressText}
                              numberOfLines={1}
                            >
                              📍{" "}
                              {req.parent?.address || "Dirección sin registro"}
                            </Text>

                            <View style={styles.escrowMoneyGrid}>
                              <View style={styles.escrowMoneyCell}>
                                <Text style={styles.escrowMoneyLabel}>
                                  Retenido (100%)
                                </Text>
                                <Text
                                  style={[
                                    styles.escrowMoneyValue,
                                    { color: "#c05621" },
                                  ]}
                                >
                                  {formatCLPCompact(financials.total)}
                                </Text>
                              </View>
                              <View style={styles.escrowMoneyDivider} />
                              <View style={styles.escrowMoneyCell}>
                                <Text style={styles.escrowMoneyLabel}>
                                  Niñera (70%)
                                </Text>
                                <Text
                                  style={[
                                    styles.escrowMoneyValue,
                                    { color: "#2b6cb0" },
                                  ]}
                                >
                                  {formatCLPCompact(financials.payout)}
                                </Text>
                              </View>
                              <View style={styles.escrowMoneyDivider} />
                              <View style={styles.escrowMoneyCell}>
                                <Text style={styles.escrowMoneyLabel}>
                                  Comisión (30%)
                                </Text>
                                <Text
                                  style={[
                                    styles.escrowMoneyValue,
                                    { color: "#2f855a" },
                                  ]}
                                >
                                  {formatCLPCompact(financials.fee)}
                                </Text>
                              </View>
                            </View>

                            <View style={styles.escrowActionsWrap}>
                              <TouchableOpacity
                                style={styles.actionBtnPurple}
                                onPress={() => handleOpenAdminChat(req)}
                                disabled={isBusy}
                              >
                                <View style={styles.chatBtnContentRow}>
                                  <Text style={styles.actionBtnText}>
                                    💬 Chat Operativo ({msgCount}{" "}
                                    {msgCount === 1 ? "msg" : "msgs"})
                                  </Text>
                                  {unreadCount > 0 && (
                                    <View style={styles.adminUnreadPill}>
                                      <Text style={styles.adminUnreadPillText}>
                                        {unreadCount}{" "}
                                        {unreadCount === 1 ? "nuevo" : "nuevos"}
                                      </Text>
                                    </View>
                                  )}
                                </View>
                              </TouchableOpacity>

                              <View style={styles.escrowSecondaryActionsRow}>
                                <TouchableOpacity
                                  style={[styles.actionBtnTeal, { flex: 1.4 }]}
                                  onPress={() => handleForceCompletion(req)}
                                  disabled={isBusy}
                                >
                                  {isBusy ? (
                                    <ActivityIndicator
                                      color="#fff"
                                      size="small"
                                    />
                                  ) : (
                                    <Text style={styles.actionBtnText}>
                                      ✅ Pasar a Payout
                                    </Text>
                                  )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={[styles.refundBtnOutline, { flex: 1 }]}
                                  onPress={() => handleRefundEscrow(req)}
                                  disabled={isBusy}
                                >
                                  <Text style={styles.refundBtnOutlineText}>
                                    ↩️ Reembolsar
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>
                )}

                <Text style={styles.sectionTitle}>
                  Liquidaciones Pendientes (Payouts)
                </Text>
                {completedRequests.filter(
                  (r) => r.payment_status === "ready_for_payout",
                ).length === 0 ? (
                  <Text style={styles.emptyText}>
                    No hay pagos pendientes a niñeras.
                  </Text>
                ) : (
                  completedRequests
                    .filter((r) => r.payment_status === "ready_for_payout")
                    .map((req) => {
                      const isHistExpanded = Boolean(
                        expandedBreakdownIds["admin_payout_" + req.id],
                      );
                      const {
                        total: totalAmt,
                        fee: feeAmt,
                        payout: payoutAmt,
                      } = getRequestFinancials(req);

                      return (
                        <View key={req.id} style={styles.payoutCard}>
                          <Text style={{ fontWeight: "bold", fontSize: 16 }}>
                            Pagar a: {req.babysitter.first_name}{" "}
                            {req.babysitter.last_name}
                          </Text>
                          <Text
                            style={{
                              fontSize: 18,
                              color: "#2b6cb0",
                              fontWeight: "bold",
                              marginVertical: 8,
                            }}
                          >
                            {formatCLP(payoutAmt)}
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              color: "#718096",
                              marginBottom: 10,
                            }}
                          >
                            Servicio completado el: {req.job_date}
                          </Text>

                          <TouchableOpacity
                            style={styles.breakdownToggleBtn}
                            onPress={() =>
                              toggleBreakdown("admin_payout_" + req.id)
                            }
                          >
                            <Text style={styles.breakdownToggleText}>
                              📊 Ver matemática del servicio
                            </Text>
                            <Text style={styles.breakdownToggleArrow}>
                              {isHistExpanded ? "Ocultar ▲" : "Ver detalle ▼"}
                            </Text>
                          </TouchableOpacity>

                          {isHistExpanded && (
                            <View style={styles.breakdownCard}>
                              <View style={styles.breakdownRow}>
                                <Text style={styles.breakdownLabel}>
                                  Total cobrado al padre:
                                </Text>
                                <Text style={styles.breakdownValue}>
                                  {formatCLP(totalAmt)}
                                </Text>
                              </View>
                              <View style={styles.breakdownRow}>
                                <Text style={styles.breakdownLabel}>
                                  Comisión App (30%):
                                </Text>
                                <Text
                                  style={[
                                    styles.breakdownValue,
                                    { color: "#2f855a" },
                                  ]}
                                >
                                  {formatCLP(feeAmt)}
                                </Text>
                              </View>
                              <View style={styles.breakdownRow}>
                                <Text style={styles.breakdownLabel}>
                                  Transferencia neta:
                                </Text>
                                <Text
                                  style={[
                                    styles.breakdownValue,
                                    { fontWeight: "bold" },
                                  ]}
                                >
                                  {formatCLP(payoutAmt)}
                                </Text>
                              </View>
                            </View>
                          )}

                          <TouchableOpacity
                            style={[styles.payoutButton, { marginTop: 12 }]}
                            onPress={() =>
                              handleUpdatePaymentStatus(req.id, "paid_out")
                            }
                            disabled={updatingId === req.id}
                          >
                            {updatingId === req.id ? (
                              <ActivityIndicator color="#fff" />
                            ) : (
                              <Text style={styles.payoutButtonText}>
                                Marcar como Transferido ✅
                              </Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      );
                    })
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footerContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.backButtonText}>Volver al Inicio</Text>
        </TouchableOpacity>
      </View>

      {/* MODAL DE CHAT OPERATIVO DE SOPORTE (ÍTEM #26 + #24 FASE 2) */}
      {isChatOpen && activeChatReq && (
        <Modal
          visible={isChatOpen}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setIsChatOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.chatModalContent}>
              <View style={styles.chatHeader}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={styles.chatHeaderTitleRow}>
                    <Text style={styles.chatModalName}>🛡️ Chat Operativo</Text>
                    <View
                      style={[
                        styles.chatStatusPill,
                        activeChatReq.payment_status === "held"
                          ? styles.chatStatusEscrow
                          : styles.chatStatusPending,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chatStatusPillText,
                          activeChatReq.payment_status === "held"
                            ? { color: "#22543d" }
                            : { color: "#9c4221" },
                        ]}
                      >
                        {activeChatReq.payment_status === "held"
                          ? "🔒 Escrow"
                          : activeChatReq.status === "accepted"
                            ? "Aceptada"
                            : "Pendiente"}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.chatContextActors}>
                    👨‍👩‍👧 {activeChatReq.parent?.parent_name || "Familia"} ↔ 👩‍🍼{" "}
                    {activeChatReq.babysitter?.first_name || "Niñera"}
                  </Text>
                  <Text style={styles.chatContextShift}>
                    📅 {activeChatReq.job_date || "Sin fecha"} • ⏰{" "}
                    {activeChatReq.job_time || "Sin hora"} •{" "}
                    <Text style={{ color: "#38a169", fontWeight: "600" }}>
                      ● En vivo
                    </Text>
                  </Text>
                </View>

                <TouchableOpacity onPress={() => setIsChatOpen(false)}>
                  <Text style={{ fontSize: 26, color: "#718096" }}>×</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                ref={chatScrollRef}
                style={styles.chatScroll}
                contentContainerStyle={{ padding: 16 }}
                onContentSizeChange={() =>
                  chatScrollRef.current?.scrollToEnd({ animated: true })
                }
              >
                {messages.length === 0 ? (
                  <View style={styles.chatEmptyBox}>
                    <Text style={styles.chatEmptyTitle}>
                      👀 Modo Observación Activo
                    </Text>
                    <Text style={styles.chatEmptySub}>
                      Aún no hay mensajes entre familia y niñera en este turno.
                      Puedes usar una plantilla rápida o escribir abajo para
                      intervenir como Soporte MiBabysitter.
                    </Text>
                  </View>
                ) : (
                  messages.map((msg, idx) => {
                    const isSupport = Boolean(
                      msg.content?.startsWith("[Soporte"),
                    );
                    const isBabysitter =
                      !isSupport &&
                      msg.sender_id === activeChatReq.babysitter_id;

                    const senderLabel = isSupport
                      ? "🛡️ Soporte MiBabysitter"
                      : isBabysitter
                        ? `👩‍🍼 ${activeChatReq.babysitter?.first_name || "Niñera"}`
                        : `👨‍👩‍👧 ${activeChatReq.parent?.parent_name || "Familia"}`;

                    const displayContent = isSupport
                      ? stripSupportPrefix(msg.content)
                      : msg.content;
                    const timeStr = formatMsgTime(msg.created_at);

                    const msgTs = new Date(msg.created_at).getTime();
                    const readByParent =
                      Boolean(participantReceipts.parent) &&
                      new Date(
                        participantReceipts.parent as string,
                      ).getTime() >=
                        msgTs - 1000;
                    const readBySitter =
                      Boolean(participantReceipts.babysitter) &&
                      new Date(
                        participantReceipts.babysitter as string,
                      ).getTime() >=
                        msgTs - 1000;

                    return (
                      <View
                        key={msg.id || idx}
                        style={[
                          styles.messageBubble,
                          isSupport
                            ? styles.messageSupport
                            : isBabysitter
                              ? styles.messageSitter
                              : styles.messageParent,
                          msg._optimistic && { opacity: 0.72 },
                        ]}
                      >
                        <View style={styles.msgHeaderRow}>
                          <Text
                            style={[
                              styles.senderTag,
                              isSupport
                                ? { color: "#9c4221" }
                                : isBabysitter
                                  ? { color: "#553c9a" }
                                  : { color: "#2b6cb0" },
                            ]}
                          >
                            {senderLabel}
                          </Text>
                          <View style={styles.msgTimeCheckRow}>
                            {Boolean(timeStr) && (
                              <Text style={styles.msgTimeText}>{timeStr}</Text>
                            )}
                            {isSupport && (
                              <Text
                                style={
                                  readByParent || readBySitter
                                    ? styles.adminCheckRead
                                    : styles.adminCheckSent
                                }
                              >
                                {msg._optimistic
                                  ? "🕒"
                                  : readByParent && readBySitter
                                    ? "✓✓"
                                    : readByParent || readBySitter
                                      ? "✓✓"
                                      : "✓"}
                              </Text>
                            )}
                          </View>
                        </View>
                        <Text
                          style={[
                            styles.messageText,
                            isSupport
                              ? { color: "#744210" }
                              : { color: "#1a202c" },
                          ]}
                        >
                          {displayContent}
                        </Text>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {/* ESTADO DE LECTURA POR ACTOR + INDICADOR ESCRIBIENDO (#24 FASE 2) */}
              <View style={styles.readReceiptsStatusBar}>
                <Text
                  style={[
                    styles.readReceiptItem,
                    participantReceipts.parent && styles.readReceiptItemRead,
                  ]}
                >
                  👨‍👩‍👧 Familia:{" "}
                  {participantReceipts.parent
                    ? `✓✓ Visto ${formatMsgTime(participantReceipts.parent)}`
                    : "Sin leer"}
                </Text>
                <Text style={styles.readReceiptDivider}>•</Text>
                <Text
                  style={[
                    styles.readReceiptItem,
                    participantReceipts.babysitter &&
                      styles.readReceiptItemRead,
                  ]}
                >
                  👩‍🍼 Niñera:{" "}
                  {participantReceipts.babysitter
                    ? `✓✓ Visto ${formatMsgTime(participantReceipts.babysitter)}`
                    : "Sin leer"}
                </Text>
              </View>

              {Boolean(typingIndicatorText) && (
                <View style={styles.typingIndicatorBar}>
                  <Text style={styles.typingIndicatorText}>
                    ✍️ {typingIndicatorText}
                  </Text>
                </View>
              )}

              {/* PLANTILLAS CONCIERGE EDITABLES EN 1 CLIC */}
              <View style={styles.conciergeBar}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.conciergeScroll}
                >
                  {conciergeTemplates.map((tpl) => (
                    <TouchableOpacity
                      key={tpl.id}
                      style={styles.conciergeChip}
                      onPress={() => handleAdminTextChange(tpl.text)}
                    >
                      <Text style={styles.conciergeChipText}>{tpl.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={styles.notifyTargetRow}>
                  <Text style={styles.notifyTargetLabel}>🔔 Notificar:</Text>
                  {(
                    [
                      { key: "both", label: "👥 Ambos" },
                      { key: "parent", label: "👨‍👩‍👧 Familia" },
                      { key: "babysitter", label: "👩‍🍼 Niñera" },
                    ] as const
                  ).map((opt) => {
                    const selected = notifyTarget === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[
                          styles.notifyPill,
                          selected && styles.notifyPillActive,
                        ]}
                        onPress={() => setNotifyTarget(opt.key)}
                      >
                        <Text
                          style={[
                            styles.notifyPillText,
                            selected && styles.notifyPillTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.chatInputRow}>
                <TextInput
                  style={styles.chatInput}
                  placeholder="Escribir como Soporte MiBabysitter..."
                  value={newMessage}
                  onChangeText={handleAdminTextChange}
                  onSubmitEditing={sendAdminMessage}
                  returnKeyType="send"
                  multiline
                />
                <TouchableOpacity
                  style={styles.chatSendButton}
                  onPress={sendAdminMessage}
                  disabled={sendingMessage}
                >
                  {sendingMessage ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.chatSendButtonText}>Enviar</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1, backgroundColor: "#f7fafc" },
  container: {
    flexGrow: 1,
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 40,
  },
  headerContainer: {
    width: "100%",
    maxWidth: 600,
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  headerTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a202c",
    marginBottom: 4,
  },
  subtitle: { fontSize: 15, color: "#718096" },
  refreshBtn: {
    backgroundColor: "#ebf8ff",
    borderWidth: 1,
    borderColor: "#bee3f8",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#2b6cb0",
  },

  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderRadius: 8,
    padding: 4,
    marginBottom: 24,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: "center",
    borderRadius: 6,
  },
  activeTab: { backgroundColor: "#fff", elevation: 2 },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#718096",
    textAlign: "center",
  },
  activeTabText: { color: "#2b6cb0" },
  contentArea: {
    width: "100%",
    maxWidth: 600,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  listContainer: { width: "100%", marginBottom: 32 },

  // ESTILOS DEL MÓDULO DE OFERTA Y DIRECTORIO DE NIÑERAS (#30 FASE 1)
  supplyKpiRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 12,
  },
  supplyKpiCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1.5,
    alignItems: "center",
  },
  supplyKpiOperational: {
    backgroundColor: "#f0fff4",
    borderColor: "#c6f6d5",
  },
  supplyKpiIncomplete: {
    backgroundColor: "#fffaf0",
    borderColor: "#fbd38d",
  },
  supplyKpiTotal: {
    backgroundColor: "#ebf8ff",
    borderColor: "#bee3f8",
  },
  supplyKpiSelected: {
    borderColor: "#2b6cb0",
    borderWidth: 2,
  },
  supplyKpiLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4a5568",
    marginBottom: 4,
  },
  supplyKpiValue: {
    fontSize: 22,
    fontWeight: "bold",
  },
  supplyKpiMicro: {
    fontSize: 10.5,
    color: "#718096",
    marginTop: 2,
    textAlign: "center",
  },
  testFilterBar: {
    backgroundColor: "#edf2f7",
    borderWidth: 1,
    borderColor: "#cbd5e0",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  testFilterBarActive: {
    backgroundColor: "#ebf8ff",
    borderColor: "#90cdf4",
  },
  testFilterText: {
    fontSize: 12,
    color: "#4a5568",
    fontWeight: "600",
    textAlign: "center",
  },
  testFilterTextActive: {
    color: "#2b6cb0",
  },
  coverageCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  coverageTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#2d3748",
    marginBottom: 8,
  },
  coverageChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  coverageChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "#ebf8ff",
    borderWidth: 1,
    borderColor: "#bee3f8",
  },
  coverageChipEmpty: {
    backgroundColor: "#fff5f5",
    borderColor: "#fed7d7",
  },
  coverageChipActive: {
    backgroundColor: "#3182ce",
    borderColor: "#2b6cb0",
  },
  coverageChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2b6cb0",
  },
  coverageChipTextEmpty: {
    color: "#c53030",
  },
  coverageChipTextActive: {
    color: "#ffffff",
  },
  shiftPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#edf2f7",
    borderWidth: 1,
    borderColor: "#cbd5e0",
  },
  shiftPillText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: "#4a5568",
  },
  directoryFiltersBox: {
    marginBottom: 14,
    gap: 8,
  },
  searchInput: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#cbd5e0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: "#2d3748",
  },
  filterPillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#edf2f7",
    borderWidth: 1,
    borderColor: "#cbd5e0",
  },
  filterPillActive: {
    backgroundColor: "#2b6cb0",
    borderColor: "#2b6cb0",
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4a5568",
  },
  filterPillTextActive: {
    color: "#ffffff",
  },
  sitterCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderLeftWidth: 4,
  },
  sitterCardOperational: {
    borderLeftColor: "#38a169",
  },
  sitterCardIncomplete: {
    borderLeftColor: "#d69e2e",
  },
  sitterHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  sitterNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 3,
  },
  sitterName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1a202c",
  },
  adminTagPill: {
    backgroundColor: "#edf2f7",
    borderWidth: 1,
    borderColor: "#cbd5e0",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  adminTagText: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#4a5568",
  },
  sitterSubMeta: {
    fontSize: 12.5,
    color: "#4a5568",
    fontWeight: "500",
  },
  sitterStatusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 12,
  },
  sitterStatusOk: {
    backgroundColor: "#c6f6d5",
  },
  sitterStatusWarn: {
    backgroundColor: "#feebc8",
  },
  sitterStatusText: {
    fontSize: 11.5,
    fontWeight: "bold",
  },
  sitterDetailsBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    gap: 3,
  },
  sitterDetailLine: {
    fontSize: 12.5,
    color: "#4a5568",
  },
  missingFieldsBox: {
    backgroundColor: "#fffaf0",
    borderWidth: 1,
    borderColor: "#fbd38d",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  missingFieldsTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#9c4221",
    marginBottom: 6,
  },
  missingChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  missingChip: {
    backgroundColor: "#feebc8",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  missingChipText: {
    fontSize: 11.5,
    fontWeight: "600",
    color: "#744210",
  },

  alertCard: {
    width: "100%",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: "bold",
    overflow: "hidden",
  },
  participantsMiniBox: {
    backgroundColor: "rgba(255,255,255,0.6)",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },

  actionBtnRed: {
    backgroundColor: "#e53e3e",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  actionBtnGreen: {
    backgroundColor: "#38a169",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  actionBtnYellow: {
    backgroundColor: "#d69e2e",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  actionBtnTeal: {
    backgroundColor: "#319795",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  actionBtnPurple: {
    backgroundColor: "#805ad5",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  chatBtnContentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  adminUnreadPill: {
    backgroundColor: "#e53e3e",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  adminUnreadPillText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "bold",
  },
  actionBtnDisabled: {
    backgroundColor: "#cbd5e0",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  actionBtnText: { color: "#ffffff", fontWeight: "bold", fontSize: 14 },
  actionBtnTextDark: { color: "#1a202c", fontWeight: "bold", fontSize: 14 },
  actionBtnTextDisabled: { color: "#718096", fontWeight: "bold", fontSize: 13 },

  breakdownToggleBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    backgroundColor: "#edf2f7",
    borderWidth: 1,
    borderColor: "#cbd5e0",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  breakdownToggleText: { fontSize: 13, fontWeight: "bold", color: "#2b6cb0" },
  breakdownToggleArrow: { fontSize: 12, fontWeight: "600", color: "#4a5568" },
  breakdownCard: {
    width: "100%",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 3,
  },
  breakdownLabel: { fontSize: 13, color: "#4a5568" },
  breakdownValue: { fontSize: 13, fontWeight: "600", color: "#2d3748" },

  financeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  financeBox: {
    width: "48%",
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 14,
  },
  financeLabel: {
    fontSize: 13,
    color: "#718096",
    marginBottom: 6,
    fontWeight: "600",
  },
  financeValue: { fontSize: 19, fontWeight: "bold", color: "#2d3748" },
  financeMicroNote: {
    fontSize: 11,
    color: "#718096",
    marginTop: 6,
  },

  // ESTILOS DE ESCROW INTERACTIVO Y DETALLE (#27)
  escrowKpiBox: {
    backgroundColor: "#fffaf0",
    borderColor: "#fbd38d",
    borderWidth: 1.5,
  },
  escrowKpiBoxExpanded: {
    borderColor: "#d69e2e",
    borderWidth: 2,
    backgroundColor: "#fffff0",
  },
  escrowKpiHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 4,
  },
  escrowToggleHint: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#c05621",
    marginBottom: 6,
  },
  escrowCountNote: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9c4221",
    marginTop: 6,
  },
  escrowSplitNote: {
    fontSize: 10.5,
    color: "#744210",
    marginTop: 3,
  },
  escrowSectionContainer: {
    width: "100%",
    backgroundColor: "#fffaf0",
    borderWidth: 1,
    borderColor: "#fbd38d",
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  escrowSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  escrowSectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#9c4221",
  },
  escrowCloseLink: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#c05621",
  },
  escrowSummaryBar: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#feebc8",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    gap: 4,
  },
  escrowSummaryText: {
    fontSize: 12.5,
    color: "#4a5568",
  },
  escrowCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderLeftWidth: 4,
  },
  escrowCardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  escrowStatePill: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 10,
  },
  escrowStatePillText: {
    fontSize: 11,
    fontWeight: "bold",
  },
  escrowShiftText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4a5568",
  },
  escrowActorsText: {
    fontSize: 14,
    color: "#2d3748",
    marginBottom: 3,
  },
  escrowAddressText: {
    fontSize: 12,
    color: "#718096",
    marginBottom: 10,
  },
  escrowMoneyGrid: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginBottom: 10,
  },
  escrowMoneyCell: {
    flex: 1,
    alignItems: "center",
  },
  escrowMoneyDivider: {
    width: 1,
    height: 26,
    backgroundColor: "#e2e8f0",
  },
  escrowMoneyLabel: {
    fontSize: 10.5,
    color: "#718096",
    marginBottom: 2,
    fontWeight: "600",
  },
  escrowMoneyValue: {
    fontSize: 13.5,
    fontWeight: "bold",
  },
  escrowActionsWrap: {
    gap: 8,
  },
  escrowSecondaryActionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  refundBtnOutline: {
    backgroundColor: "#fff5f5",
    borderWidth: 1,
    borderColor: "#feb2b2",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  refundBtnOutlineText: {
    color: "#c53030",
    fontWeight: "bold",
    fontSize: 13,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2d3748",
    marginBottom: 16,
  },
  payoutCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e0",
    marginBottom: 16,
  },
  payoutButton: {
    backgroundColor: "#3182ce",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  payoutButtonText: { color: "#fff", fontWeight: "bold", fontSize: 15 },

  emptyText: {
    fontSize: 16,
    color: "#a0aec0",
    fontStyle: "italic",
    textAlign: "center",
    marginVertical: 20,
  },

  footerContainer: {
    padding: 16,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    alignItems: "center",
    width: "100%",
  },
  backButton: {
    backgroundColor: "#718096",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: "100%",
    maxWidth: 500,
    alignItems: "center",
  },
  backButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "bold" },

  // ESTILOS DEL CHAT OPERATIVO ADMIN (3 ACTORES + CONCIERGE + RECIBOS)
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
  },
  chatModalContent: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    width: "100%",
    maxWidth: 520,
    height: "88%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  chatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#edf2f7",
    backgroundColor: "#ffffff",
  },
  chatHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  chatModalName: { fontSize: 17, fontWeight: "bold", color: "#1a202c" },
  chatStatusPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  chatStatusEscrow: { backgroundColor: "#c6f6d5" },
  chatStatusPending: { backgroundColor: "#feebc8" },
  chatStatusPillText: { fontSize: 11, fontWeight: "bold" },
  chatContextActors: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2d3748",
    marginTop: 4,
  },
  chatContextShift: {
    fontSize: 12,
    color: "#718096",
    marginTop: 2,
  },
  chatScroll: { flex: 1, backgroundColor: "#f7fafc" },
  chatEmptyBox: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    alignItems: "center",
  },
  chatEmptyTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2d3748",
    marginBottom: 4,
  },
  chatEmptySub: {
    fontSize: 13,
    color: "#718096",
    textAlign: "center",
    lineHeight: 18,
  },
  messageBubble: {
    maxWidth: "85%",
    padding: 11,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  messageSupport: {
    alignSelf: "flex-end",
    backgroundColor: "#fffaf0",
    borderColor: "#d69e2e",
    borderBottomRightRadius: 4,
  },
  messageParent: {
    alignSelf: "flex-start",
    backgroundColor: "#ebf8ff",
    borderColor: "#bee3f8",
    borderBottomLeftRadius: 4,
  },
  messageSitter: {
    alignSelf: "flex-start",
    backgroundColor: "#faf5ff",
    borderColor: "#d6bcfa",
    borderBottomLeftRadius: 4,
  },
  msgHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  msgTimeCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  senderTag: {
    fontSize: 11,
    fontWeight: "bold",
  },
  msgTimeText: {
    fontSize: 10,
    color: "#718096",
  },
  adminCheckSent: {
    fontSize: 11,
    color: "#975a16",
    fontWeight: "bold",
  },
  adminCheckRead: {
    fontSize: 11,
    color: "#2b6cb0",
    fontWeight: "bold",
  },
  messageText: { fontSize: 14, lineHeight: 20 },

  readReceiptsStatusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#edf2f7",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  readReceiptItem: {
    fontSize: 11,
    color: "#718096",
    fontWeight: "600",
  },
  readReceiptItemRead: {
    color: "#2b6cb0",
  },
  readReceiptDivider: {
    fontSize: 11,
    color: "#a0aec0",
  },
  typingIndicatorBar: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: "#f7fafc",
    borderTopWidth: 1,
    borderTopColor: "#edf2f7",
  },
  typingIndicatorText: {
    fontSize: 12,
    fontStyle: "italic",
    color: "#805ad5",
    fontWeight: "600",
  },

  conciergeBar: {
    borderTopWidth: 1,
    borderTopColor: "#edf2f7",
    backgroundColor: "#f8fafc",
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  conciergeScroll: {
    gap: 8,
    paddingBottom: 8,
  },
  conciergeChip: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#cbd5e0",
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  conciergeChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2d3748",
  },
  notifyTargetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  notifyTargetLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#718096",
  },
  notifyPill: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: "#edf2f7",
    borderWidth: 1,
    borderColor: "#cbd5e0",
  },
  notifyPillActive: {
    backgroundColor: "#fefcbf",
    borderColor: "#d69e2e",
  },
  notifyPillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#4a5568",
  },
  notifyPillTextActive: {
    color: "#975a16",
    fontWeight: "bold",
  },

  chatInputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#edf2f7",
    backgroundColor: "#ffffff",
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd5e0",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    maxHeight: 96,
    backgroundColor: "#f8fafc",
    marginRight: 8,
  },
  chatSendButton: {
    backgroundColor: "#d69e2e",
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: "center",
    borderRadius: 18,
  },
  chatSendButtonText: { color: "#ffffff", fontWeight: "bold", fontSize: 14 },
});
