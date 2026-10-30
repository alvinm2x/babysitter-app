import { supabase } from '@/utils/supabase';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
} from 'react-native';

const AVAILABLE_ZONES = ['Santiago Centro', 'Las Condes', 'Providencia', 'Vitacura'];
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const SHIFTS = ['Mañana', 'Tarde', 'Noche'];
const PLATFORM_COMMISSION_RATE = 0.30;

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    alert(title + ': ' + message);
  } else {
    Alert.alert(title, message);
  }
};

const buildGoogleCalendarDates = (jobDate?: string, jobTime?: string) => {
  if (!jobDate || !jobTime) return '';
  const dateMatch = jobDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const timeMatch = jobTime.match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/);
  if (!dateMatch || !timeMatch) return '';

  const dd = dateMatch[1];
  const mm = dateMatch[2];
  const yyyy = dateMatch[3];
  const startH = timeMatch[1];
  const startM = timeMatch[2];
  const endH = timeMatch[3];
  const endM = timeMatch[4];

  const ymd = yyyy + mm + dd;
  return '&dates=' + ymd + 'T' + startH + startM + '00/' + ymd + 'T' + endH + endM + '00';
};

const formatCLP = (amount: number | string) => {
  const num = Number(amount) || 0;
  return '$' + new Intl.NumberFormat('es-CL').format(Math.round(num)) + ' CLP';
};

const formatCurrencyInput = (value: string) => {
  const cleanValue = value.replace(/\D/g, ''); 
  if (!cleanValue) return '';
  return new Intl.NumberFormat('es-CL').format(Number(cleanValue));
};

const timeToMinutes = (timeStr: string) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

const getHoursFromTimeRange = (jobTime?: string) => {
  if (!jobTime) return 2;
  const parts = jobTime.split('-').map(s => s.trim());
  if (parts.length !== 2) return 2;
  const diffMins = timeToMinutes(parts[1]) - timeToMinutes(parts[0]);
  return diffMins > 0 ? diffMins / 60 : 2;
};

export default function BabysitterHomeScreen() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'requests' | 'history' | 'profile'>('requests');
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [requests, setRequests] = useState<any[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  
  const [expandedBreakdownIds, setExpandedBreakdownIds] = useState<{ [key: string]: boolean }>({});
  const [isSaved, setIsSaved] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bio, setBio] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [experience, setExperience] = useState('');

  const [selectedZones, setSelectedZones] = useState<string[]>(['Las Condes']);
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [availableShifts, setAvailableShifts] = useState<string[]>([]);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(false);

  // Estados del Chat
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeChatParent, setActiveChatParent] = useState<any | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const toggleBreakdown = (id: string) => {
    setExpandedBreakdownIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    let reqSubscription: any = null;
    let notifSubscription: any = null;

    const initDataAndRealtime = async () => {
      await fetchRequests();
      await loadProfile();
      await loadNotifications();

      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // CORRECCIÓN REALTIME: Limpiamos los canales antes de suscribirnos (útil para Hot-Reload en localhost)
        supabase.removeChannel(supabase.channel('babysitter_realtime_requests'));
        supabase.removeChannel(supabase.channel('babysitter_realtime_notifs'));

        reqSubscription = supabase.channel('babysitter_realtime_requests')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'job_requests', filter: 'babysitter_id=eq.' + user.id }, () => {
            fetchRequests();
          })
          .subscribe();

        notifSubscription = supabase.channel('babysitter_realtime_notifs')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + user.id }, () => {
            loadNotifications();
          })
          .subscribe();
      }
    };

    initDataAndRealtime();

    return () => {
      if (reqSubscription) supabase.removeChannel(reqSubscription);
      if (notifSubscription) supabase.removeChannel(notifSubscription);
    };
  }, []);

  useEffect(() => {
    let chatSub: any = null;

    if (isChatOpen && activeRequestId) {
      loadMessages(activeRequestId);
      supabase.removeChannel(supabase.channel('chat_' + activeRequestId));

      chatSub = supabase.channel('chat_' + activeRequestId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'request_id=eq.' + activeRequestId }, (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        })
        .subscribe();
    }

    return () => {
      if (chatSub) supabase.removeChannel(chatSub);
    };
  }, [isChatOpen, activeRequestId]);

  const loadMessages = async (reqId: string) => {
    try {
      const { data, error } = await supabase.from('messages').select('*').eq('request_id', reqId).order('created_at', { ascending: true });
      if (!error && data) setMessages(data);
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeRequestId || !activeChatParent) return;
    setSendingMessage(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('messages').insert([{ request_id: activeRequestId, sender_id: user.id, receiver_id: activeChatParent.id, content: newMessage.trim() }]);
      if (error) throw error;
      setNewMessage('');
      await sendNotificationToParent(activeChatParent.id, "💬 Nuevo Mensaje", "La niñera te ha respondido en el chat de la app.");
    } catch (err: any) {
      showAlert("Error al enviar", err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const sendNotificationToParent = async (parentId: string, title: string, message: string) => {
    if (!parentId) return;
    try {
      await supabase.from('notifications').insert([{ user_id: parentId, title: title, message: message }]);
    } catch (err) {
      console.error("Error al enviar notificación al padre", err);
    }
  };

  const loadNotifications = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      if (!error && data) setNotifications(data);
    } catch (err) {
      console.error(err);
    }
  };

  const markNotificationAsRead = async (id: string) => {
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error(err);
    }
  };

  const markAllNotificationsAsRead = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRequests = async () => {
    setLoadingRequests(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: reqs, error: reqError } = await supabase.from('job_requests').select('*').eq('babysitter_id', user.id).order('created_at', { ascending: false });
      if (reqError) throw reqError;
      if (!reqs || reqs.length === 0) {
        setRequests([]);
        setLoadingRequests(false);
        return;
      }

      const parentIds = Array.from(new Set(reqs.map((r) => r.parent_id).filter(Boolean)));
      let profilesMap: { [key: string]: any } = {};
      
      if (parentIds.length > 0) {
        const { data: profiles, error: profError } = await supabase.from('parent_profiles').select('id, phone, address, children_info, emergency_contact').in('id', parentIds);
        if (!profError && profiles) {
          profiles.forEach((p) => { profilesMap[p.id] = p; });
        }
      }

      const combined = reqs.map((r) => ({ ...r, parent_profiles: profilesMap[r.parent_id] || {} }));
      setRequests(combined);
    } catch (error: any) {
      console.error('Error al obtener solicitudes:', error.message);
    } finally {
      setLoadingRequests(false);
    }
  };

  const handleUpdateStatus = async (requestId: string, parentId: string, newStatus: 'accepted' | 'rejected' | 'completed') => {
    setUpdatingId(requestId);
    try {
      const updateData: any = { status: newStatus };
      if (newStatus === 'accepted') updateData.payment_status = 'held';
      else if (newStatus === 'completed') updateData.payment_status = 'ready_for_payout';
      else if (newStatus === 'rejected') updateData.payment_status = 'refunded';

      const { error } = await supabase.from('job_requests').update(updateData).eq('id', requestId);
      if (error) throw error;

      setRequests((prev) => prev.map((req) => (req.id === requestId ? { ...req, status: newStatus, payment_status: updateData.payment_status } : req)));

      if (newStatus === 'accepted') {
        await sendNotificationToParent(parentId, "Solicitud Aceptada 🎉", "¡La niñera ha aceptado tu solicitud! Ya pueden coordinar por el chat.");
      } else if (newStatus === 'rejected') {
        await sendNotificationToParent(parentId, "Solicitud Cancelada", "La niñera ha cancelado o rechazado la solicitud.");
      } else if (newStatus === 'completed') {
        showAlert('¡Trabajo completado!', 'El servicio ha finalizado y se ha movido a tu pestaña de Historial.');
        await sendNotificationToParent(parentId, "Servicio Finalizado ✅", "La niñera ha marcado el trabajo como completado. ¡No olvides calificarla!");
      }
    } catch (error: any) {
      showAlert('Error al actualizar estado', error.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleOpenWhatsApp = (parentPhone: string) => {
    const cleanPhone = String(parentPhone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone) {
      showAlert('Sin teléfono', 'Este padre no ha registrado un número de teléfono válido.');
      return;
    }
    const textMsg = '¡Hola! Soy ' + firstName + ', acepté tu solicitud de niñera y me gustaría coordinar los detalles.';
    const msg = encodeURIComponent(textMsg);
    Linking.openURL('https://api.whatsapp.com/send?phone=' + cleanPhone + '&text=' + msg);
  };

  const handleAddToCalendar = (title: string, jobDate: string, jobTime: string, address: string) => {
    const text = encodeURIComponent(title);
    const datesParam = buildGoogleCalendarDates(jobDate, jobTime);
    const details = encodeURIComponent('Cita agendada: ' + (jobDate || 'No especificado') + '\nHorario: ' + (jobTime || 'No especificado'));
    const location = encodeURIComponent(address || '');
    Linking.openURL('https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + text + datesParam + '&details=' + details + '&location=' + location);
  };

  const loadProfile = async () => {
    setLoadingProfile(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoadingProfile(false); return; }

    const { data } = await supabase.from('babysitter_profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (data) {
      setFirstName(data.first_name || '');
      setLastName(data.last_name || '');
      setBio(data.bio || '');
      if (data.hourly_rate) setHourlyRate(formatCurrencyInput(data.hourly_rate.toString()));
      setExperience(data.experience_years ? data.experience_years.toString() : '');
      if (data.location_zone) {
        const zones = Array.isArray(data.location_zone) ? data.location_zone : data.location_zone.split(',').map((z: string) => z.trim());
        setSelectedZones(zones);
      }
      if (data.available_days) setAvailableDays(data.available_days);
      if (data.available_shifts) setAvailableShifts(data.available_shifts);
    }
    setLoadingProfile(false);
  };

  const saveProfile = async () => {
    if (!firstName || !lastName || !bio || !hourlyRate || !experience) {
      showAlert('Error', 'Por favor completa todos los campos de texto.');
      return;
    }
    if (selectedZones.length === 0 || availableDays.length === 0 || availableShifts.length === 0) {
      showAlert('Error', 'Debes seleccionar al menos una Comuna, un Día y un Horario.');
      return;
    }
    const numericRate = Number(hourlyRate.replace(/\D/g, ''));
    if (numericRate < 10000) {
      showAlert('Tarifa muy baja', 'La tarifa mínima por hora debe ser de al menos $10.000 CLP.');
      return;
    }

    setSavingProfile(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSavingProfile(false); return; }

    const updates = {
      id: session.user.id,
      first_name: firstName,
      last_name: lastName,
      bio,
      hourly_rate: numericRate, 
      experience_years: Number(experience),
      location_zone: selectedZones.join(', '),
      available_days: availableDays,
      available_shifts: availableShifts,
      updated_at: new Date(),
    };

    const { error } = await supabase.from('babysitter_profiles').upsert(updates);
    setSavingProfile(false);

    if (error) {
      console.error('Error al guardar:', error.message);
      showAlert('Error', 'Hubo un problema al guardar tu perfil. Revisa la consola.');
    } else {
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000); 
    }
  };

  const toggleZone = (zone: string) => { setSelectedZones((prev) => prev.includes(zone) ? prev.filter((z) => z !== zone) : [...prev, zone]); };
  const toggleDay = (day: string) => { setAvailableDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]); };
  const toggleShift = (shift: string) => { setAvailableShifts((prev) => prev.includes(shift) ? prev.filter((s) => s !== shift) : [...prev, shift]); };

  const handleSignOut = async () => {
    setLoadingAuth(true);
    const { error } = await supabase.auth.signOut();
    setLoadingAuth(false);
    if (!error) router.replace('/');
  };

  const activeRequests = requests.filter((req) => { const s = String(req.status || '').toLowerCase().trim(); return s !== 'completed' && s !== 'rejected' && s !== 'dismissed'; });
  const historyRequests = requests.filter((req) => { const s = String(req.status || '').toLowerCase().trim(); return s === 'completed' || s === 'rejected' || s === 'dismissed'; });
  const unreadNotificationsCount = notifications.filter(n => !n.is_read).length;

  const getPaymentStatusBadge = (paymentStatus?: string) => {
    switch (paymentStatus) {
      case 'held': return { label: '🔒 Fondos retenidos seguros', color: '#c05621', bg: '#feebc8' };
      case 'ready_for_payout': return { label: '⏳ En proceso de transferencia a tu cuenta', color: '#2b6cb0', bg: '#ebf8ff' };
      case 'paid_out': return { label: '✅ Pago transferido', color: '#22543d', bg: '#c6f6d5' };
      default: return { label: '💳 Esperando confirmación', color: '#744210', bg: '#fefcbf' };
    }
  };

  return (
    <View style={styles.mainWrapper}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        
        <View style={styles.headerContainer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Panel de Niñera 👩‍🍼</Text>
            <Text style={styles.subtitle}>Gestiona tus solicitudes y ganancias.</Text>
          </View>
          <TouchableOpacity style={styles.bellButton} onPress={() => setShowNotifications(true)}>
            <Text style={styles.bellIcon}>🔔</Text>
            {unreadNotificationsCount > 0 && (
              <View style={styles.badgeCount}>
                <Text style={styles.badgeCountText}>{unreadNotificationsCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'requests' && styles.activeTab]} onPress={() => setActiveTab('requests')}>
            <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>Solicitudes</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.tab, activeTab === 'history' && styles.activeTab]} onPress={() => { setActiveTab('history'); fetchRequests(); }}>
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>Historial</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.tab, activeTab === 'profile' && styles.activeTab]} onPress={() => setActiveTab('profile')}>
            <Text style={[styles.tabText, activeTab === 'profile' && styles.activeTabText]}>Mi Perfil</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'requests' && (
          <View style={styles.contentArea}>
            {loadingRequests ? (
              <ActivityIndicator size="large" color="#3182ce" style={{ marginVertical: 32 }} />
            ) : activeRequests.length === 0 ? (
              <Text style={styles.emptyText}>No tienes solicitudes activas por ahora.</Text>
            ) : (
              <View style={styles.listContainer}>
                {activeRequests.map((req) => {
                  const isUpdatingThis = updatingId === req.id;
                  const statusNormalized = String(req.status || '').toLowerCase().trim();
                  const parentInfo = req.parent_profiles || {};
                  const isAccepted = statusNormalized === 'accepted';
                  
                  const reqHours = getHoursFromTimeRange(req.job_time);
                  const myRate = Number(hourlyRate.replace(/\D/g, '')) || 10000;
                  const reqTotal = Number(req.total_amount) || Math.round(reqHours * myRate);
                  const reqFee = Number(req.platform_fee) || Math.round(reqTotal * PLATFORM_COMMISSION_RATE);
                  const reqNet = Number(req.babysitter_payout) || (reqTotal - reqFee);
                  const isExpanded = Boolean(expandedBreakdownIds[req.id]);
                  const payBadge = getPaymentStatusBadge(req.payment_status);

                  return (
                    <View key={req.id} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.requestId}>Nueva Solicitud de Trabajo</Text>
                        <Text style={[styles.badge, isAccepted ? styles.badgeAccepted : styles.badgePending]}>
                          {isAccepted ? 'Aceptada' : 'Pendiente'}
                        </Text>
                      </View>

                      {(req.job_date || req.job_time) && (
                        <View style={styles.jobDetailsBox}>
                          <Text style={styles.jobDetailsText}>📅 Fecha: {req.job_date || 'No especificado'}</Text>
                          <Text style={styles.jobDetailsText}>⏰ Horario: {req.job_time || 'No especificado'} ({reqHours} hrs)</Text>
                        </View>
                      )}

                      <TouchableOpacity style={styles.breakdownToggleBtn} onPress={() => toggleBreakdown(req.id)}>
                        <Text style={styles.breakdownToggleText}>💳 Ganancia Líquida: {formatCLP(reqNet)}</Text>
                        <Text style={styles.breakdownToggleArrow}>{isExpanded ? 'Ocultar desglose ▲' : 'Ver detalle ▼'}</Text>
                      </TouchableOpacity>

                      {isExpanded && (
                        <View style={styles.breakdownCard}>
                          <View style={styles.breakdownRow}>
                            <Text style={styles.breakdownLabel}>Valor total del servicio:</Text>
                            <Text style={styles.breakdownValue}>{formatCLP(reqTotal)}</Text>
                          </View>
                          <View style={styles.breakdownRow}>
                            <Text style={styles.breakdownLabel}>Comisión Plataforma (30%):</Text>
                            <Text style={[styles.breakdownValue, { color: '#e53e3e' }]}>-{formatCLP(reqFee)}</Text>
                          </View>
                          <View style={styles.breakdownDivider} />
                          <View style={styles.breakdownRow}>
                            <Text style={styles.breakdownTotalLabel}>Monto a transferir:</Text>
                            <Text style={styles.breakdownTotalValue}>{formatCLP(reqNet)}</Text>
                          </View>
                          {isAccepted && (
                             <View style={[styles.paymentStatusPill, { backgroundColor: payBadge.bg }]}>
                               <Text style={[styles.paymentStatusPillText, { color: payBadge.color }]}>{payBadge.label}</Text>
                             </View>
                          )}
                        </View>
                      )}

                      {isAccepted && (
                        <View style={styles.acceptedBanner}>
                          <Text style={styles.acceptedBannerTitle}>🎉 ¡Servicio Confirmado!</Text>
                          <Text style={styles.acceptedBannerSub}>Agendado para el <Text style={{ fontWeight: 'bold' }}>{req.job_date}</Text>.</Text>
                        </View>
                      )}

                      {isAccepted && (
                        <View style={styles.parentContactBox}>
                          <Text style={styles.contactBoxTitle}>📍 Datos de la Familia</Text>
                          <Text style={styles.contactText}>🏠 Dirección: {parentInfo.address || 'No especificada'}</Text>
                          <Text style={styles.contactText}>👶 Niños: {parentInfo.children_info || 'No especificado'}</Text>
                          <Text style={styles.contactText}>📞 Teléfono: {parentInfo.phone || 'No especificado'}</Text>
                          {parentInfo.emergency_contact ? <Text style={styles.contactText}>🚨 Emergencia: {parentInfo.emergency_contact}</Text> : null}
                          
                          <TouchableOpacity 
                            style={styles.chatAppButton} 
                            onPress={() => { setActiveChatParent({ id: req.parent_id, ...parentInfo }); setActiveRequestId(req.id); setIsChatOpen(true); }}
                          >
                            <Text style={styles.chatAppButtonText}>💬 Chat en la App</Text>
                          </TouchableOpacity>

                          <TouchableOpacity style={styles.calendarButton} onPress={() => handleAddToCalendar('Trabajo de Niñera', req.job_date, req.job_time, parentInfo.address)}>
                            <Text style={styles.calendarButtonText}>📅 Agregar a Google Calendar</Text>
                          </TouchableOpacity>

                          {Boolean(parentInfo.phone) && (
                            <TouchableOpacity style={[styles.contactButton, styles.whatsappButton]} onPress={() => handleOpenWhatsApp(parentInfo.phone)}>
                              <Text style={styles.contactButtonText}>📱 WhatsApp</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                      <Text style={styles.dateText}>Recibida el: {new Date(req.created_at).toLocaleDateString()}</Text>

                      {!isAccepted && (
                        <View style={styles.actionRow}>
                          <TouchableOpacity style={[styles.actionButton, styles.acceptButton]} onPress={() => handleUpdateStatus(req.id, req.parent_id, 'accepted')} disabled={isUpdatingThis}>
                            {isUpdatingThis ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionButtonText}>Aceptar Trabajo</Text>}
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.actionButton, styles.rejectButton]} onPress={() => handleUpdateStatus(req.id, req.parent_id, 'rejected')} disabled={isUpdatingThis}>
                            <Text style={styles.actionButtonText}>Rechazar</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {isAccepted && (
                        <>
                          <TouchableOpacity style={styles.completeButton} onPress={() => handleUpdateStatus(req.id, req.parent_id, 'completed')} disabled={isUpdatingThis}>
                            {isUpdatingThis ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.completeButtonText}>✅ Marcar Trabajo como Completado</Text>}
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.actionButton, styles.rejectButton, { marginTop: 8 }]} onPress={() => handleUpdateStatus(req.id, req.parent_id, 'rejected')} disabled={isUpdatingThis}>
                            <Text style={styles.actionButtonText}>Cancelar Trabajo</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.contentArea}>
            <Text style={styles.historyTitle}>Historial de Ganancias</Text>
            <Text style={styles.historySubtitle}>Registro de servicios completados y cancelados.</Text>
            {loadingRequests ? (
              <ActivityIndicator size="large" color="#3182ce" style={{ marginVertical: 32 }} />
            ) : historyRequests.length === 0 ? (
              <Text style={styles.emptyText}>Aún no tienes trabajos en tu historial.</Text>
            ) : (
              <View style={styles.listContainer}>
                {historyRequests.map((req) => {
                  const statusNormalized = String(req.status || '').toLowerCase().trim();
                  const parentInfo = req.parent_profiles || {};
                  const isCompleted = statusNormalized === 'completed';
                  const isRejected = statusNormalized === 'rejected';

                  const histHours = getHoursFromTimeRange(req.job_time);
                  const myRate = Number(hourlyRate.replace(/\D/g, '')) || 10000;
                  const histTotal = Number(req.total_amount) || Math.round(histHours * myRate);
                  const histFee = Number(req.platform_fee) || Math.round(histTotal * PLATFORM_COMMISSION_RATE);
                  const histNet = Number(req.babysitter_payout) || (histTotal - histFee);
                  const isHistExpanded = Boolean(expandedBreakdownIds['hist_' + req.id]);
                  const payBadge = getPaymentStatusBadge(req.payment_status);

                  return (
                    <View key={req.id} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.requestId}>Servicio registrado</Text>
                        <Text style={[styles.badge, isCompleted ? styles.badgeAccepted : styles.badgeRejected]}>
                          {isCompleted ? 'Completado' : isRejected ? 'Rechazado' : 'Cancelado'}
                        </Text>
                      </View>
                      {(req.job_date || req.job_time) && (
                        <View style={styles.jobDetailsBox}>
                          <Text style={styles.jobDetailsText}>📅 Fecha: {req.job_date || 'No especificado'}</Text>
                          <Text style={styles.jobDetailsText}>⏰ Horario: {req.job_time || 'No especificado'} ({histHours} hrs)</Text>
                        </View>
                      )}
                      {isCompleted && (
                        <>
                          <TouchableOpacity style={styles.breakdownToggleBtn} onPress={() => toggleBreakdown('hist_' + req.id)}>
                            <Text style={styles.breakdownToggleText}>💳 Ganancia Líquida: {formatCLP(histNet)}</Text>
                            <Text style={styles.breakdownToggleArrow}>{isHistExpanded ? 'Ocultar desglose ▲' : 'Ver detalle ▼'}</Text>
                          </TouchableOpacity>
                          {isHistExpanded && (
                            <View style={styles.breakdownCard}>
                              <View style={styles.breakdownRow}>
                                <Text style={styles.breakdownLabel}>Valor total del servicio:</Text>
                                <Text style={styles.breakdownValue}>{formatCLP(histTotal)}</Text>
                              </View>
                              <View style={styles.breakdownRow}>
                                <Text style={styles.breakdownLabel}>Comisión Plataforma (30%):</Text>
                                <Text style={[styles.breakdownValue, { color: '#e53e3e' }]}>-{formatCLP(histFee)}</Text>
                              </View>
                              <View style={styles.breakdownDivider} />
                              <View style={styles.breakdownRow}>
                                <Text style={styles.breakdownTotalLabel}>Ganancia Neta:</Text>
                                <Text style={styles.breakdownTotalValue}>{formatCLP(histNet)}</Text>
                              </View>
                              <View style={[styles.paymentStatusPill, { backgroundColor: payBadge.bg }]}>
                                <Text style={[styles.paymentStatusPillText, { color: payBadge.color }]}>{payBadge.label}</Text>
                              </View>
                            </View>
                          )}
                        </>
                      )}
                      {isCompleted && (
                        <View style={styles.parentContactBox}>
                          <Text style={styles.contactBoxTitle}>📍 Familia atendida</Text>
                          <Text style={styles.contactText}>🏠 Dirección: {parentInfo.address || 'No especificada'}</Text>
                        </View>
                      )}
                      <Text style={styles.dateText}>Fecha de solicitud: {new Date(req.created_at).toLocaleDateString()}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {activeTab === 'profile' && (
          <View style={styles.contentArea}>
            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>Tu Perfil Profesional</Text>
              <Text style={styles.profileCardSubtitle}>Esta información será pública para los padres.</Text>

              {loadingProfile ? (
                <ActivityIndicator size="large" color="#3182ce" style={{ marginTop: 20 }} />
              ) : (
                <>
                  <Text style={styles.label}>Nombre</Text>
                  <TextInput style={styles.input} placeholder="Ej: Camila" value={firstName} onChangeText={setFirstName} />
                  <Text style={styles.label}>Apellido</Text>
                  <TextInput style={styles.input} placeholder="Ej: Pérez" value={lastName} onChangeText={setLastName} />
                  <Text style={styles.label}>Sobre ti (Biografía corta)</Text>
                  <TextInput style={[styles.input, styles.textArea]} placeholder="Ej: Soy estudiante, muy responsable..." value={bio} onChangeText={setBio} multiline />
                  
                  <Text style={styles.label}>Tarifa por hora</Text>
                  <View style={styles.currencyInputContainer}>
                    <Text style={styles.currencyPrefix}>CLP</Text>
                    <TextInput 
                      style={styles.currencyInput} 
                      placeholder="10.000" 
                      value={hourlyRate} 
                      onChangeText={(val) => setHourlyRate(formatCurrencyInput(val))} 
                      keyboardType="numeric" 
                    />
                  </View>

                  <Text style={styles.label}>Años de experiencia</Text>
                  <TextInput style={styles.input} placeholder="Ej: 3" value={experience} onChangeText={setExperience} keyboardType="numeric" />

                  <View style={styles.sectionDivider} />

                  <Text style={styles.sectionTitle}>📍 Comunas de Trabajo</Text>
                  <View style={styles.chipContainer}>
                    {AVAILABLE_ZONES.map((zone) => {
                      const isSelected = selectedZones.includes(zone);
                      return (
                        <TouchableOpacity key={zone} style={[styles.chip, isSelected && styles.chipSelected]} onPress={() => toggleZone(zone)}>
                          <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{zone}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={styles.sectionTitle}>📅 Días Disponibles</Text>
                  <View style={styles.chipContainer}>
                    {DAYS.map((day) => {
                      const isSelected = availableDays.includes(day);
                      return (
                        <TouchableOpacity key={day} style={[styles.chip, isSelected && styles.chipSelected]} onPress={() => toggleDay(day)}>
                          <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{day}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={styles.sectionTitle}>⏰ Horarios Disponibles</Text>
                  <View style={styles.chipContainer}>
                    {SHIFTS.map((shift) => {
                      const isSelected = availableShifts.includes(shift);
                      return (
                        <TouchableOpacity key={shift} style={[styles.chip, isSelected && styles.chipSelected]} onPress={() => toggleShift(shift)}>
                          <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{shift}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TouchableOpacity 
                    style={[styles.saveButton, isSaved && styles.saveButtonSuccess]} 
                    onPress={saveProfile} 
                    disabled={savingProfile || isSaved}
                  >
                    {savingProfile ? (
                      <ActivityIndicator color="#fff" />
                    ) : isSaved ? (
                      <Text style={styles.saveButtonText}>¡Guardado! ✅</Text>
                    ) : (
                      <Text style={styles.saveButtonText}>Guardar Perfil y Disponibilidad</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footerContainer}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={loadingAuth}>
          {loadingAuth ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.signOutButtonText}>Cerrar Sesión</Text>}
        </TouchableOpacity>
      </View>

      {showNotifications && (
        <Modal visible={showNotifications} transparent={true} animationType="slide" onRequestClose={() => setShowNotifications(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.notificationsModal}>
              <View style={styles.notificationsHeader}>
                <Text style={styles.modalName}>Notificaciones 🔔</Text>
                <TouchableOpacity onPress={() => setShowNotifications(false)}>
                  <Text style={{ fontSize: 24, color: '#718096' }}>×</Text>
                </TouchableOpacity>
              </View>
              {unreadNotificationsCount > 0 && (
                <TouchableOpacity onPress={markAllNotificationsAsRead} style={{ marginBottom: 12, alignSelf: 'flex-end' }}>
                  <Text style={{ color: '#3182ce', fontWeight: 'bold' }}>Marcar todas como leídas</Text>
                </TouchableOpacity>
              )}
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
                {notifications.length === 0 ? (
                  <Text style={styles.emptyText}>No tienes notificaciones.</Text>
                ) : (
                  notifications.map((notif) => (
                    <TouchableOpacity 
                      key={notif.id} 
                      style={[styles.notificationCard, !notif.is_read && styles.notificationUnread]} 
                      onPress={() => markNotificationAsRead(notif.id)}
                    >
                      <View style={styles.notificationHeaderRow}>
                        <Text style={styles.notificationTitle}>{notif.title}</Text>
                        {!notif.is_read && <View style={styles.unreadDot} />}
                      </View>
                      <Text style={styles.notificationMessage}>{notif.message}</Text>
                      <Text style={styles.notificationDate}>{new Date(notif.created_at).toLocaleString()}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {isChatOpen && (
        <Modal visible={isChatOpen} transparent={true} animationType="slide" onRequestClose={() => setIsChatOpen(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.chatModalContent}>
              <View style={styles.chatHeader}>
                <Text style={styles.chatModalName}>Chat con la Familia</Text>
                <TouchableOpacity onPress={() => setIsChatOpen(false)}>
                  <Text style={{ fontSize: 24, color: '#718096' }}>×</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.chatScroll} contentContainerStyle={{ padding: 16 }}>
                {messages.length === 0 ? (
                  <Text style={styles.emptyText}>No hay mensajes en esta conversación. ¡Di hola!</Text>
                ) : (
                  messages.map((msg, idx) => {
                    const isMe = msg.sender_id !== activeChatParent?.id; 
                    return (
                      <View key={msg.id || idx} style={[styles.messageBubble, isMe ? styles.messageMe : styles.messageThem]}>
                        <Text style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextThem]}>
                          {msg.content}
                        </Text>
                      </View>
                    );
                  })
                )}
              </ScrollView>
              <View style={styles.chatInputRow}>
                <TextInput style={styles.chatInput} placeholder="Escribe un mensaje..." value={newMessage} onChangeText={setNewMessage} />
                <TouchableOpacity style={styles.chatSendButton} onPress={sendMessage} disabled={sendingMessage}>
                  {sendingMessage ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.chatSendButtonText}>Enviar</Text>}
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
  mainWrapper: { flex: 1, backgroundColor: '#f7fafc' },
  container: { flexGrow: 1, alignItems: 'center', paddingTop: 24, paddingBottom: 40 },
  headerContainer: { flexDirection: 'row', width: '100%', maxWidth: 500, justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 24 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a202c', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#718096', marginBottom: 20 },
  bellButton: { position: 'relative', padding: 8, backgroundColor: '#edf2f7', borderRadius: 20, marginTop: 4 },
  bellIcon: { fontSize: 20 },
  badgeCount: { position: 'absolute', top: -2, right: -4, backgroundColor: '#e53e3e', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#f7fafc' },
  badgeCountText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  tabContainer: { flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: 8, padding: 4, marginBottom: 24, width: '100%', maxWidth: 500, alignSelf: 'center' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  activeTab: { backgroundColor: '#fff', elevation: 2 },
  tabText: { fontSize: 14, fontWeight: '600', color: '#718096' },
  activeTabText: { color: '#2b6cb0' },
  contentArea: { width: '100%', maxWidth: 500, alignItems: 'center', paddingHorizontal: 24 },
  historyTitle: { fontSize: 20, fontWeight: 'bold', color: '#2d3748', marginBottom: 4, alignSelf: 'flex-start' },
  historySubtitle: { fontSize: 14, color: '#718096', marginBottom: 20, alignSelf: 'flex-start' },
  listContainer: { width: '100%', marginBottom: 32 },
  card: { width: '100%', backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  requestId: { fontSize: 16, fontWeight: 'bold', color: '#2d3748' },
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, fontSize: 12, fontWeight: 'bold', overflow: 'hidden' },
  badgePending: { backgroundColor: '#feebc8', color: '#c05621' },
  badgeAccepted: { backgroundColor: '#c6f6d5', color: '#22543d' },
  badgeRejected: { backgroundColor: '#fed7d7', color: '#9b2c2c' },
  jobDetailsBox: { backgroundColor: '#ebf8ff', padding: 12, borderRadius: 8, marginBottom: 12 },
  jobDetailsText: { fontSize: 14, color: '#2b6cb0', fontWeight: '600' },
  breakdownToggleBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', backgroundColor: '#f0fff4', borderWidth: 1, borderColor: '#c6f6d5', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 8 },
  breakdownToggleText: { fontSize: 14, fontWeight: 'bold', color: '#2f855a' },
  breakdownToggleArrow: { fontSize: 12, fontWeight: '600', color: '#38a169' },
  breakdownCard: { width: '100%', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginBottom: 12 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 3 },
  breakdownLabel: { fontSize: 13, color: '#4a5568' },
  breakdownValue: { fontSize: 13, fontWeight: '600', color: '#2d3748' },
  breakdownTotalLabel: { fontSize: 14, fontWeight: 'bold', color: '#1a202c' },
  breakdownTotalValue: { fontSize: 15, fontWeight: 'bold', color: '#2f855a' },
  breakdownDivider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 6 },
  paymentStatusPill: { marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, alignItems: 'center' },
  paymentStatusPillText: { fontSize: 12, fontWeight: 'bold' },
  acceptedBanner: { backgroundColor: '#c6f6d5', borderWidth: 1, borderColor: '#9ae6b4', padding: 12, borderRadius: 8, marginBottom: 12, alignItems: 'center' },
  acceptedBannerTitle: { fontSize: 16, fontWeight: 'bold', color: '#22543d', marginBottom: 4 },
  acceptedBannerSub: { fontSize: 14, color: '#2f855a', textAlign: 'center' },
  parentContactBox: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', padding: 14, borderRadius: 8, marginBottom: 12 },
  contactBoxTitle: { fontSize: 15, fontWeight: 'bold', color: '#4a5568', marginBottom: 6 },
  contactText: { fontSize: 14, color: '#4a5568', marginBottom: 4 },
  contactButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, width: '100%' },
  chatAppButton: { backgroundColor: '#805ad5', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, width: '100%' },
  chatAppButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  calendarButton: { backgroundColor: '#ecc94b', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  calendarButtonText: { color: '#744210', fontWeight: 'bold', fontSize: 14 },
  whatsappButton: { backgroundColor: '#25D366', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  contactButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  completeButton: { backgroundColor: '#3182ce', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  completeButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  dateText: { fontSize: 13, color: '#718096', marginBottom: 16 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  actionButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  acceptButton: { backgroundColor: '#38a169' },
  rejectButton: { backgroundColor: '#e53e3e' },
  actionButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  emptyText: { fontSize: 16, color: '#a0aec0', fontStyle: 'italic', marginBottom: 32, textAlign: 'center', marginTop: 20 },
  profileCard: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 20, elevation: 2, marginBottom: 32 },
  profileCardTitle: { fontSize: 18, fontWeight: 'bold', color: '#2d3748', marginBottom: 4 },
  profileCardSubtitle: { fontSize: 14, color: '#718096', marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#4a5568', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 15, backgroundColor: '#f8fafc', marginBottom: 16 },
  textArea: { height: 100, textAlignVertical: 'top' },
  currencyInputContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, backgroundColor: '#f8fafc', marginBottom: 16, overflow: 'hidden' },
  currencyPrefix: { paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#edf2f7', color: '#4a5568', fontWeight: 'bold', fontSize: 15, borderRightWidth: 1, borderRightColor: '#e2e8f0' },
  currencyInput: { flex: 1, padding: 12, fontSize: 15 },
  sectionDivider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 24 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#2d3748', marginBottom: 12 },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#edf2f7', borderWidth: 1, borderColor: '#cbd5e0' },
  chipSelected: { backgroundColor: '#ebf8ff', borderColor: '#3182ce' },
  chipText: { fontSize: 14, fontWeight: '600', color: '#4a5568' },
  chipTextSelected: { color: '#2b6cb0' },
  saveButton: { backgroundColor: '#3182ce', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  saveButtonSuccess: { backgroundColor: '#38a169' },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  footerContainer: { padding: 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0', alignItems: 'center', width: '100%' },
  signOutButton: { backgroundColor: '#e53e3e', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, width: '100%', maxWidth: 500, alignItems: 'center' },
  signOutButtonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalName: { fontSize: 22, fontWeight: 'bold', color: '#2d3748', marginBottom: 4, textAlign: 'center' },
  notificationsModal: { backgroundColor: '#ffffff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, maxHeight: '80%' },
  notificationsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#edf2f7', paddingBottom: 12 },
  notificationCard: { padding: 12, backgroundColor: '#f7fafc', borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#edf2f7' },
  notificationUnread: { backgroundColor: '#ebf8ff', borderColor: '#bee3f8' },
  notificationHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  notificationTitle: { fontSize: 15, fontWeight: 'bold', color: '#2d3748' },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#3182ce' },
  notificationMessage: { fontSize: 14, color: '#4a5568', marginBottom: 6 },
  notificationDate: { fontSize: 12, color: '#a0aec0' },
  chatModalContent: { backgroundColor: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 480, height: '80%', display: 'flex', flexDirection: 'column' },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#edf2f7' },
  chatModalName: { fontSize: 18, fontWeight: 'bold', color: '#2d3748' },
  chatScroll: { flex: 1, backgroundColor: '#f7fafc' },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 12, marginBottom: 8 },
  messageMe: { alignSelf: 'flex-end', backgroundColor: '#805ad5', borderBottomRightRadius: 4 },
  messageThem: { alignSelf: 'flex-start', backgroundColor: '#e2e8f0', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 15 },
  messageTextMe: { color: '#ffffff' },
  messageTextThem: { color: '#2d3748' },
  chatInputRow: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#edf2f7', backgroundColor: '#ffffff' },
  chatInput: { flex: 1, borderWidth: 1, borderColor: '#cbd5e0', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, backgroundColor: '#f8fafc', marginRight: 8 },
  chatSendButton: { backgroundColor: '#805ad5', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 20 },
  chatSendButtonText: { color: '#ffffff', fontWeight: 'bold' },
});