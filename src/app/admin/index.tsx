import { supabase } from '@/utils/supabase';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
} from 'react-native';

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    alert(title + ': ' + message);
  } else {
    Alert.alert(title, message);
  }
};

const formatCLP = (amount: number) => {
  return '$' + new Intl.NumberFormat('es-CL').format(amount) + ' CLP';
};

export default function AdminDashboardScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'pending' | 'finance'>('upcoming');
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<any[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      // 1. Obtener todas las solicitudes de trabajo
      const { data: reqs, error: reqError } = await supabase
        .from('job_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (reqError) throw reqError;
      if (!reqs || reqs.length === 0) {
        setRequests([]);
        setLoading(false);
        return;
      }

      // 2. Extraer IDs únicos para buscar perfiles en memoria
      const parentIds = Array.from(new Set(reqs.map((r) => r.parent_id).filter(Boolean)));
      const babysitterIds = Array.from(new Set(reqs.map((r) => r.babysitter_id).filter(Boolean)));

      let parentsMap: { [key: string]: any } = {};
      let babysittersMap: { [key: string]: any } = {};

      if (parentIds.length > 0) {
        const { data: parents } = await supabase.from('parent_profiles').select('*').in('id', parentIds);
        parents?.forEach((p) => (parentsMap[p.id] = p));
      }

      if (babysitterIds.length > 0) {
        const { data: babysitters } = await supabase.from('babysitter_profiles').select('*').in('id', babysitterIds);
        babysitters?.forEach((b) => (babysittersMap[b.id] = b));
      }

      // 3. Combinar datos
      const combined = reqs.map((r) => ({
        ...r,
        parent: parentsMap[r.parent_id] || {},
        babysitter: babysittersMap[r.babysitter_id] || {},
      }));

      setRequests(combined);
    } catch (error: any) {
      console.error('Error al cargar datos del admin:', error.message);
      showAlert('Error', 'No se pudieron cargar los datos de operaciones.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePaymentStatus = async (requestId: string, newStatus: string) => {
    setUpdatingId(requestId);
    try {
      const { error } = await supabase
        .from('job_requests')
        .update({ payment_status: newStatus })
        .eq('id', requestId);

      if (error) throw error;

      setRequests((prev) =>
        prev.map((req) => (req.id === requestId ? { ...req, payment_status: newStatus } : req))
      );
      showAlert('Actualizado', 'El estado del pago ha sido actualizado correctamente.');
    } catch (error: any) {
      showAlert('Error', error.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const openWhatsApp = (phone: string, message: string) => {
    const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone) {
      showAlert('Sin teléfono', 'Este usuario no tiene un número registrado.');
      return;
    }
    const msg = encodeURIComponent(message);
    Linking.openURL('https://api.whatsapp.com/send?phone=' + cleanPhone + '&text=' + msg);
  };

  const upcomingRequests = requests.filter((r) => r.status === 'accepted');
  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const completedRequests = requests.filter((r) => r.status === 'completed');

  // Cálculos Financieros
  const gmv = completedRequests.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
  const revenue = completedRequests.reduce((sum, r) => sum + (Number(r.platform_fee) || 0), 0);
  const escrow = upcomingRequests.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0);
  const pendingPayouts = completedRequests
    .filter((r) => r.payment_status === 'ready_for_payout')
    .reduce((sum, r) => sum + (Number(r.babysitter_payout) || 0), 0);

  return (
    <View style={styles.mainWrapper}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={styles.headerContainer}>
          <Text style={styles.title}>Torre de Control 🗼</Text>
          <Text style={styles.subtitle}>Supervisión de Operaciones y Finanzas</Text>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'upcoming' && styles.activeTab]} onPress={() => setActiveTab('upcoming')}>
            <Text style={[styles.tabText, activeTab === 'upcoming' && styles.activeTabText]}>En Curso ({upcomingRequests.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'pending' && styles.activeTab]} onPress={() => setActiveTab('pending')}>
            <Text style={[styles.tabText, activeTab === 'pending' && styles.activeTabText]}>Pendientes ({pendingRequests.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'finance' && styles.activeTab]} onPress={() => setActiveTab('finance')}>
            <Text style={[styles.tabText, activeTab === 'finance' && styles.activeTabText]}>Finanzas 💰</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#3182ce" style={{ marginVertical: 32 }} />
        ) : (
          <View style={styles.contentArea}>
            
            {/* PESTAÑA: EN CURSO / PRÓXIMOS */}
            {activeTab === 'upcoming' && (
              <View style={styles.listContainer}>
                {upcomingRequests.length === 0 ? <Text style={styles.emptyText}>No hay servicios en curso.</Text> : null}
                {upcomingRequests.map((req) => (
                  <View key={req.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.requestId}>Servicio Aceptado</Text>
                      <Text style={[styles.badge, styles.badgeAccepted]}>Agendado</Text>
                    </View>
                    <Text style={styles.dateText}>📅 {req.job_date} | ⏰ {req.job_time}</Text>
                    
                    <View style={styles.participantsBox}>
                      <Text style={styles.participantTitle}>👶 Niñera: {req.babysitter.first_name} {req.babysitter.last_name}</Text>
                      <TouchableOpacity style={styles.waButton} onPress={() => openWhatsApp(req.babysitter.phone, `¡Hola ${req.babysitter.first_name}! Te escribo de Babysitter App para confirmar tu servicio de hoy a las ${req.job_time}. ¿Vas en camino?`)}>
                        <Text style={styles.waButtonText}>📲 Check-in Niñera</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.participantsBox}>
                      <Text style={styles.participantTitle}>🏡 Familia: {req.parent.address}</Text>
                      <TouchableOpacity style={styles.waButton} onPress={() => openWhatsApp(req.parent.phone, `¡Hola! Te escribimos de Babysitter App. ¿Llegó bien ${req.babysitter.first_name} y está todo en orden con el servicio?`)}>
                        <Text style={styles.waButtonText}>📲 Check-in Familia</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* PESTAÑA: PENDIENTES */}
            {activeTab === 'pending' && (
              <View style={styles.listContainer}>
                {pendingRequests.length === 0 ? <Text style={styles.emptyText}>Cero cuellos de botella. Todo limpio.</Text> : null}
                {pendingRequests.map((req) => (
                  <View key={req.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.requestId}>Esperando Confirmación</Text>
                      <Text style={[styles.badge, styles.badgePending]}>Pendiente</Text>
                    </View>
                    <Text style={styles.dateText}>Para el: {req.job_date} a las {req.job_time}</Text>
                    <Text style={{ marginBottom: 12 }}>Familia espera respuesta de: <Text style={{fontWeight: 'bold'}}>{req.babysitter.first_name}</Text></Text>
                    
                    <TouchableOpacity style={styles.waButton} onPress={() => openWhatsApp(req.babysitter.phone, `¡Hola ${req.babysitter.first_name}! Tienes una solicitud de cuidado pendiente en la App para el ${req.job_date}. ¿Podrás tomarla?`)}>
                      <Text style={styles.waButtonText}>📲 Apurar a Niñera por WhatsApp</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* PESTAÑA: FINANZAS Y ESCROW */}
            {activeTab === 'finance' && (
              <View style={styles.listContainer}>
                <View style={styles.financeGrid}>
                  <View style={styles.financeBox}>
                    <Text style={styles.financeLabel}>Volumen (GMV)</Text>
                    <Text style={styles.financeValue}>{formatCLP(gmv)}</Text>
                  </View>
                  <View style={[styles.financeBox, { backgroundColor: '#f0fff4', borderColor: '#c6f6d5' }]}>
                    <Text style={styles.financeLabel}>Ganancia (30%)</Text>
                    <Text style={[styles.financeValue, { color: '#2f855a' }]}>{formatCLP(revenue)}</Text>
                  </View>
                  <View style={[styles.financeBox, { backgroundColor: '#fffaf0', borderColor: '#feebc8' }]}>
                    <Text style={styles.financeLabel}>Escrow Activo</Text>
                    <Text style={[styles.financeValue, { color: '#c05621' }]}>{formatCLP(escrow)}</Text>
                  </View>
                  <View style={[styles.financeBox, { backgroundColor: '#ebf8ff', borderColor: '#bee3f8' }]}>
                    <Text style={styles.financeLabel}>Por Pagar a Niñeras</Text>
                    <Text style={[styles.financeValue, { color: '#2b6cb0' }]}>{formatCLP(pendingPayouts)}</Text>
                  </View>
                </View>

                <Text style={styles.sectionTitle}>Liquidaciones Pendientes</Text>
                {completedRequests.filter(r => r.payment_status === 'ready_for_payout').length === 0 ? (
                  <Text style={styles.emptyText}>No hay pagos pendientes a niñeras.</Text>
                ) : (
                  completedRequests.filter(r => r.payment_status === 'ready_for_payout').map(req => (
                    <View key={req.id} style={styles.payoutCard}>
                      <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Pagar a: {req.babysitter.first_name} {req.babysitter.last_name}</Text>
                      <Text style={{ fontSize: 18, color: '#2b6cb0', fontWeight: 'bold', marginVertical: 8 }}>{formatCLP(req.babysitter_payout)}</Text>
                      <Text style={{ fontSize: 12, color: '#718096', marginBottom: 12 }}>Servicio completado el: {req.job_date}</Text>
                      
                      <TouchableOpacity 
                        style={styles.payoutButton} 
                        onPress={() => handleUpdatePaymentStatus(req.id, 'paid_out')}
                        disabled={updatingId === req.id}
                      >
                        {updatingId === req.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.payoutButtonText}>Marcar como Transferido ✅</Text>}
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            )}

          </View>
        )}
      </ScrollView>

      <View style={styles.footerContainer}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/')}>
          <Text style={styles.backButtonText}>Volver al Inicio</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mainWrapper: { flex: 1, backgroundColor: '#f7fafc' },
  container: { flexGrow: 1, alignItems: 'center', paddingTop: 24, paddingBottom: 40 },
  headerContainer: { width: '100%', maxWidth: 600, paddingHorizontal: 24, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a202c', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#718096' },
  
  tabContainer: { flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: 8, padding: 4, marginBottom: 24, width: '100%', maxWidth: 600, alignSelf: 'center' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  activeTab: { backgroundColor: '#fff', elevation: 2 },
  tabText: { fontSize: 14, fontWeight: '600', color: '#718096' },
  activeTabText: { color: '#2b6cb0' },
  contentArea: { width: '100%', maxWidth: 600, alignItems: 'center', paddingHorizontal: 24 },

  listContainer: { width: '100%', marginBottom: 32 },
  card: { width: '100%', backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  requestId: { fontSize: 16, fontWeight: 'bold', color: '#2d3748' },
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, fontSize: 12, fontWeight: 'bold', overflow: 'hidden' },
  badgePending: { backgroundColor: '#feebc8', color: '#c05621' },
  badgeAccepted: { backgroundColor: '#c6f6d5', color: '#22543d' },
  dateText: { fontSize: 15, color: '#4a5568', marginBottom: 16, fontWeight: '600' },
  
  participantsBox: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  participantTitle: { fontSize: 14, fontWeight: 'bold', color: '#4a5568', marginBottom: 8 },
  
  waButton: { backgroundColor: '#25D366', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  waButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  
  financeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 24 },
  financeBox: { width: '48%', backgroundColor: '#fff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  financeLabel: { fontSize: 13, color: '#718096', marginBottom: 8, fontWeight: '600' },
  financeValue: { fontSize: 20, fontWeight: 'bold', color: '#2d3748' },
  
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#2d3748', marginBottom: 16 },
  payoutCard: { backgroundColor: '#fff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e0', marginBottom: 12 },
  payoutButton: { backgroundColor: '#3182ce', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  payoutButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  
  emptyText: { fontSize: 16, color: '#a0aec0', fontStyle: 'italic', textAlign: 'center', marginVertical: 20 },
  
  footerContainer: { padding: 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0', alignItems: 'center', width: '100%' },
  backButton: { backgroundColor: '#718096', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, width: '100%', maxWidth: 500, alignItems: 'center' },
  backButtonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
});