import { supabase } from "@/utils/supabase";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const showAlert = (title: string, message: string) => {
  if (Platform.OS === "web") {
    alert(title + ": " + message);
  } else {
    Alert.alert(title, message);
  }
};

const formatCLP = (amount: number) => {
  return (
    "$" + new Intl.NumberFormat("es-CL").format(Math.round(amount)) + " CLP"
  );
};

// -----------------------------------------------------------------------------
// MOTOR DETERMINISTA DE ALERTAS (FASE 1)
// -----------------------------------------------------------------------------
// Esta función evalúa cada solicitud y la clasifica en una categoría de alerta.
// Retorna un objeto con el nivel de urgencia, color y mensaje de estado.
const evaluateJobAlert = (req: any) => {
  const now = new Date();

  // Convertir fecha (DD/MM/YYYY o YYYY-MM-DD) y hora (HH:mm) a objeto Date
  let jobDateStr = req.job_date;
  if (jobDateStr && jobDateStr.includes("/")) {
    const parts = jobDateStr.split("/");
    if (parts.length === 3) jobDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  const jobStartStr = `${jobDateStr}T${req.job_time}:00`;
  const jobStart = new Date(jobStartStr);
  const diffHours = (jobStart.getTime() - now.getTime()) / (1000 * 60 * 60);

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

  // 2. CRITICAL_CHECKIN (Turno inminente o ya iniciado, pago OK pero requiere monitoreo)
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

  // 3. WARNING_PENDING_SLA (Padre esperando respuesta hace rato)
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

  // 4. WARNING_NEEDS_COMPLETION (El servicio ya debió terminar, falta cerrarlo)
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

  // 5. OK_ACTIVE (Todo en regla, pagado, agendado a futuro)
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

  // Fallback
  return null;
};

// -----------------------------------------------------------------------------
// COMPONENTE PRINCIPAL
// -----------------------------------------------------------------------------
export default function AdminDashboardScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"alerts" | "finance">("alerts");
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<any[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [expandedBreakdownIds, setExpandedBreakdownIds] = useState<{
    [key: string]: boolean;
  }>({});

  const toggleBreakdown = (id: string) => {
    setExpandedBreakdownIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const { data: reqs, error: reqError } = await supabase
        .from("job_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (reqError) throw reqError;
      if (!reqs || reqs.length === 0) {
        setRequests([]);
        setLoading(false);
        return;
      }

      const parentIds = Array.from(
        new Set(reqs.map((r) => r.parent_id).filter(Boolean)),
      );
      const babysitterIds = Array.from(
        new Set(reqs.map((r) => r.babysitter_id).filter(Boolean)),
      );

      let parentsMap: { [key: string]: any } = {};
      let babysittersMap: { [key: string]: any } = {};

      if (parentIds.length > 0) {
        const { data: parents } = await supabase
          .from("parent_profiles")
          .select("*")
          .in("id", parentIds);
        parents?.forEach((p) => (parentsMap[p.id] = p));
      }

      if (babysitterIds.length > 0) {
        const { data: babysitters } = await supabase
          .from("babysitter_profiles")
          .select("*")
          .in("id", babysitterIds);
        babysitters?.forEach((b) => (babysittersMap[b.id] = b));
      }

      const combined = reqs.map((r) => ({
        ...r,
        parent: parentsMap[r.parent_id] || {},
        babysitter: babysittersMap[r.babysitter_id] || {},
      }));

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

  const handleForceCompletion = async (requestId: string) => {
    setUpdatingId(requestId);
    try {
      const { error } = await supabase
        .from("job_requests")
        .update({ status: "completed", payment_status: "ready_for_payout" })
        .eq("id", requestId);

      if (error) throw error;

      setRequests((prev) =>
        prev.map((req) =>
          req.id === requestId
            ? {
                ...req,
                status: "completed",
                payment_status: "ready_for_payout",
              }
            : req,
        ),
      );
      showAlert(
        "Servicio Cerrado",
        "Se marcó como completado y el dinero pasó a Payout.",
      );
    } catch (error: any) {
      showAlert("Error", error.message);
    } finally {
      setUpdatingId(null);
    }
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

  // ---------------------------------------------------------------------------
  // RENDERIZADO DEL BOTÓN CONTEXTUAL SEGÚN EL TIPO DE ALERTA
  // ---------------------------------------------------------------------------
  const renderActionButtons = (req: any, alertType: string) => {
    switch (alertType) {
      case "nudge_parent_pay":
        return (
          <TouchableOpacity
            style={styles.actionBtnRed}
            onPress={() =>
              openWhatsApp(
                req.parent.phone,
                `¡Hola! Te escribimos de Babysitter App. Tu servicio agendado para el ${req.job_date} a las ${req.job_time} con ${req.babysitter.first_name} ha sido aceptado, pero vemos que el pago aún está pendiente. Para asegurar la reserva, por favor realiza el pago en la plataforma.`,
              )
            }
          >
            <Text style={styles.actionBtnText}>📲 Cobrar al Padre</Text>
          </TouchableOpacity>
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
            <TouchableOpacity
              style={[styles.actionBtnGreen, { flex: 1 }]}
              onPress={() =>
                openWhatsApp(
                  req.babysitter.phone,
                  `¡Hola ${req.babysitter.first_name}! Desde la plataforma vemos que tu servicio inicia pronto a las ${req.job_time}. ¿Vas en camino?`,
                )
              }
            >
              <Text style={styles.actionBtnText}>📲 Niñera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnGreen, { flex: 1 }]}
              onPress={() =>
                openWhatsApp(
                  req.parent.phone,
                  `¡Hola! ¿Llegó bien ${req.babysitter.first_name}? Cualquier novedad nos comentas.`,
                )
              }
            >
              <Text style={styles.actionBtnText}>📲 Familia</Text>
            </TouchableOpacity>
          </View>
        );
      case "nudge_babysitter_accept":
        return (
          <TouchableOpacity
            style={styles.actionBtnYellow}
            onPress={() =>
              openWhatsApp(
                req.babysitter.phone,
                `¡Hola ${req.babysitter.first_name}! Tienes una solicitud de cuidado pendiente en la App para el ${req.job_date}. ¿Podrás tomarla?`,
              )
            }
          >
            <Text style={styles.actionBtnTextDark}>📲 Apurar a Niñera</Text>
          </TouchableOpacity>
        );
      case "force_completion":
        return (
          <TouchableOpacity
            style={styles.actionBtnTeal}
            onPress={() => handleForceCompletion(req.id)}
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

  // Clasificar solicitudes activas para la pestaña de alertas
  const activeRequests = requests.filter(
    (r) => r.status === "pending" || r.status === "accepted",
  );
  const alertCards = activeRequests
    .map((req) => {
      const alert = evaluateJobAlert(req);
      return alert ? { req, alert } : null;
    })
    .filter(Boolean) as { req: any; alert: any }[];

  // Ordenar por urgencia: critical -> warning -> ok
  const sortedAlertCards = alertCards.sort((a, b) => {
    const priority = { critical: 1, warning: 2, ok: 3 };
    return (
      (priority[a.alert.type as keyof typeof priority] || 99) -
      (priority[b.alert.type as keyof typeof priority] || 99)
    );
  });

  // Cálculos Financieros
  const completedRequests = requests.filter((r) => r.status === "completed");
  const upcomingRequests = requests.filter((r) => r.status === "accepted");

  const gmv = completedRequests.reduce(
    (sum, r) => sum + (Number(r.total_amount) || 0),
    0,
  );
  const revenue = completedRequests.reduce(
    (sum, r) => sum + (Number(r.platform_fee) || 0),
    0,
  );
  const escrow = upcomingRequests.reduce(
    (sum, r) => sum + (Number(r.total_amount) || 0),
    0,
  );
  const pendingPayouts = completedRequests
    .filter((r) => r.payment_status === "ready_for_payout")
    .reduce((sum, r) => sum + (Number(r.babysitter_payout) || 0), 0);

  return (
    <View style={styles.mainWrapper}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={styles.headerContainer}>
          <Text style={styles.title}>Torre de Control 🗼</Text>
          <Text style={styles.subtitle}>Gestión Proactiva y Finanzas</Text>
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
              🔥 Alertas de Operación ({sortedAlertCards.length})
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
              💰 Tesorería y Payouts
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
            {/* PESTAÑA 1: ALERTAS PROACTIVAS (El corazón de operaciones) */}
            {activeTab === "alerts" && (
              <View style={styles.listContainer}>
                {sortedAlertCards.length === 0 ? (
                  <Text style={styles.emptyText}>
                    Bandeja limpia. Todo en orden.
                  </Text>
                ) : null}

                {sortedAlertCards.map(({ req, alert }) => (
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
                          {req.babysitter.first_name}
                        </Text>
                      </Text>
                      <Text style={{ fontSize: 13, color: "#4a5568" }}>
                        🏡 Familia:{" "}
                        <Text style={{ fontWeight: "bold" }}>
                          {req.parent.address}
                        </Text>
                      </Text>
                    </View>

                    {/* Botonera de Acción Contextual */}
                    <View style={{ marginTop: 8 }}>
                      {renderActionButtons(req, alert.actionType)}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* PESTAÑA 2: FINANZAS Y ESCROW */}
            {activeTab === "finance" && (
              <View style={styles.listContainer}>
                <View style={styles.financeGrid}>
                  <View style={styles.financeBox}>
                    <Text style={styles.financeLabel}>Por Cobrar a Padres</Text>
                    <Text style={styles.financeValue}>
                      {formatCLP(
                        requests
                          .filter(
                            (r) =>
                              r.status === "accepted" &&
                              r.payment_status === "unpaid",
                          )
                          .reduce(
                            (s, r) => s + (Number(r.total_amount) || 0),
                            0,
                          ),
                      )}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.financeBox,
                      { backgroundColor: "#fffaf0", borderColor: "#feebc8" },
                    ]}
                  >
                    <Text style={styles.financeLabel}>Escrow Activo</Text>
                    <Text style={[styles.financeValue, { color: "#c05621" }]}>
                      {formatCLP(escrow)}
                    </Text>
                  </View>
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
                      const totalAmt = Number(req.total_amount) || 0;
                      const feeAmt = Number(req.platform_fee) || 0;
                      const payoutAmt = Number(req.babysitter_payout) || 0;

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

                          {/* DESGLOSE EXPANDIBLE EN LIQUIDACIONES */}
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
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a202c",
    marginBottom: 4,
  },
  subtitle: { fontSize: 15, color: "#718096" },

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
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 6 },
  activeTab: { backgroundColor: "#fff", elevation: 2 },
  tabText: { fontSize: 14, fontWeight: "600", color: "#718096" },
  activeTabText: { color: "#2b6cb0" },
  contentArea: {
    width: "100%",
    maxWidth: 600,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  listContainer: { width: "100%", marginBottom: 32 },

  // Estilos de Tarjetas de Alerta
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

  // Botones de Acción
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
  actionBtnText: { color: "#ffffff", fontWeight: "bold", fontSize: 14 },
  actionBtnTextDark: { color: "#1a202c", fontWeight: "bold", fontSize: 14 },

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
    marginBottom: 24,
  },
  financeBox: {
    width: "48%",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 16,
  },
  financeLabel: {
    fontSize: 13,
    color: "#718096",
    marginBottom: 8,
    fontWeight: "600",
  },
  financeValue: { fontSize: 20, fontWeight: "bold", color: "#2d3748" },

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
});
