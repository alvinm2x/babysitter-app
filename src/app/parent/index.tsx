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

const FILTER_ZONES = ['Todas', 'Santiago Centro', 'Las Condes', 'Providencia', 'Vitacura'];
const FILTER_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FILTER_SHIFTS = ['Mañana', 'Tarde', 'Noche'];

const AVAILABLE_TIMES = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30', '22:00'
];

const JS_DAYS_MAP = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    alert(title + ': ' + message);
  } else {
    Alert.alert(title, message);
  }
};

const timeToMinutes = (timeStr: string) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// Genera los próximos 14 días cruzados con la disponibilidad de la niñera
const getUpcoming14Days = (allowedDays?: string[]) => {
  const result: { label: string; value: string; dayName: string }[] = [];
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dayName = JS_DAYS_MAP[d.getDay()];

    if ( Array.isArray(allowedDays) && allowedDays.length > 0 && !allowedDays.includes(dayName) ) {
      continue;
    }

    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();

    const shortDay = dayName.slice(0, 3);
    result.push({
      label: shortDay + ' ' + dd + '/' + mm,
      value: dayName + ' ' + dd + '/' + mm + '/' + yyyy,
      dayName: dayName,
    });
  }
  return result;
};

// Convierte "Martes 27/10/2026" y "09:00 - 11:00" en "20261027T090000/20261027T110000"
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

export default function ParentHomeScreen() {
  const router = useRouter();
  
  const [activeTab, setActiveTab] = useState<'nannies' | 'history' | 'profile'>('nannies');
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  
  const [selectedZone, setSelectedZone] = useState<string>('Todas');
  const [selectedDay, setSelectedDay] = useState<string>('Todos');
  const [selectedShift, setSelectedShift] = useState<string>('Todos');

  const [babysitters, setBabysitters] = useState<any[]>([]);
  const [myRequests, setMyRequests] = useState<{ [key: string]: any }>({});
  const [historyRequests, setHistoryRequests] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const [selectedSitter, setSelectedSitter] = useState<any | null>(null);
  const [modalDateOptions, setModalDateOptions] = useState<{ label: string; value: string; dayName: string }[]>([]);
  const [modalDay, setModalDay] = useState<string>('');
  const [modalStartTime, setModalStartTime] = useState<string>('09:00');
  const [modalEndTime, setModalEndTime] = useState<string>('11:00');

  const [reviewingSitter, setReviewingSitter] = useState<any | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  // Estados del Chat
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeChatSitter, setActiveChatSitter] = useState<any | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const [parentProfile, setParentProfile] = useState({
    phone: '',
    address: '',
    children_info: '',
    emergency_contact: ''
  });
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    let reqSubscription: any = null;
    let notifSubscription: any = null;

    const initDataAndRealtime = async () => {
      await loadMyRequests(); 
      await loadHistoryRequests();
      await loadParentProfile();
      await loadNotifications();

      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        reqSubscription = supabase
          .channel('parent_realtime_updates')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'job_requests', filter: 'parent_id=eq.' + user.id },
            () => {
              loadMyRequests();
              loadHistoryRequests();
            }
          )
          .subscribe();

        notifSubscription = supabase
          .channel('parent_realtime_notifs')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + user.id },
            () => {
              loadNotifications();
            }
          )
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

      chatSub = supabase.channel('chat_' + activeRequestId)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: 'request_id=eq.' + activeRequestId },
          (payload) => {
            setMessages((prev) => [...prev, payload.new]);
          }
        )
        .subscribe();
    }

    return () => {
      if (chatSub) supabase.removeChannel(chatSub);
    };
  }, [isChatOpen, activeRequestId]);

  useEffect(() => {
    loadBabysitters();
  }, [selectedZone, selectedDay, selectedShift]);

  const loadMessages = async (reqId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('request_id', reqId)
        .order('created_at', { ascending: true });
      if (!error && data) {
        setMessages(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeRequestId || !activeChatSitter) return;
    setSendingMessage(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { error } = await supabase.from('messages').insert([{
        request_id: activeRequestId,
        sender_id: user.id,
        receiver_id: activeChatSitter.id,
        content: newMessage.trim()
      }]);
      if (error) throw error;
      
      setNewMessage('');
      await sendNotificationToSitter(activeChatSitter.id, "💬 Nuevo Mensaje", "El padre te ha enviado un mensaje en el chat.");

    } catch (err: any) {
      showAlert("Error al enviar", err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const sendNotificationToSitter = async (sitterId: string, title: string, message: string) => {
    try {
      await supabase.from('notifications').insert([{
        user_id: sitterId,
        title: title,
        message: message
      }]);
    } catch (err) {
      console.error("Error al enviar notificación", err);
    }
  };

  const loadNotifications = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!error && data) {
        setNotifications(data);
      }
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

  const loadBabysitters = async () => {
    setLoadingData(true);
    try {
      let query = supabase
        .from('babysitter_profiles')
        .select('*')
        .order('rating', { ascending: false, nullsFirst: false });

      if (selectedZone !== 'Todas') {
        query = query.ilike('location_zone', '%' + selectedZone + '%');
      }
      if (selectedDay !== 'Todos') {
        query = query.contains('available_days', [selectedDay]);
      }
      if (selectedShift !== 'Todos') {
        query = query.contains('available_shifts', [selectedShift]);
      }

      const { data, error } = await query;
      if (error) throw error;
      setBabysitters(data || []);
    } catch (error: any) {
      console.error("Error al cargar niñeras:", error.message);
    } finally {
      setLoadingData(false);
    }
  };

  const loadMyRequests = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('job_requests')
        .select('id, babysitter_id, status, job_date, job_time')
        .eq('parent_id', user.id)
        .in('status', ['pending', 'accepted']);
      if (error) throw error;

      const requestsMap: { [key: string]: any } = {};
      data?.forEach((req) => { requestsMap[req.babysitter_id] = req; });
      setMyRequests(requestsMap);
    } catch (error: any) {
      console.error("Error al cargar solicitudes:", error.message);
    }
  };

  const loadHistoryRequests = async () => {
    setLoadingHistory(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: reqs, error } = await supabase
        .from('job_requests')
        .select('*')
        .eq('parent_id', user.id)
        .in('status', ['completed', 'rejected', 'dismissed'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!reqs || reqs.length === 0) {
        setHistoryRequests([]);
        setLoadingHistory(false);
        return;
      }

      const sitterIds = Array.from(new Set(reqs.map(r => r.babysitter_id).filter(Boolean)));
      let sittersMap: { [key: string]: any } = {};

      if (sitterIds.length > 0) {
        const { data: sittersData, error: sittersErr } = await supabase
          .from('babysitter_profiles')
          .select('id, first_name, last_name, location_zone, hourly_rate')
          .in('id', sitterIds);

        if (!sittersErr && sittersData) {
          sittersData.forEach(s => {
            sittersMap[s.id] = s;
          });
        }
      }

      const combined = reqs.map(r => ({
        ...r,
        babysitter_profiles: sittersMap[r.babysitter_id] || {}
      }));

      setHistoryRequests(combined);
    } catch (error: any) {
      console.error("Error al cargar historial:", error.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleOpenSitterModal = (sitter: any) => {
    setSelectedSitter(sitter);
    const upcomingDates = getUpcoming14Days(sitter.available_days);
    setModalDateOptions(upcomingDates);

    if (selectedDay !== 'Todos') {
      const matchingDate = upcomingDates.find(d => d.dayName === selectedDay);
      setModalDay(matchingDate ? matchingDate.value : (upcomingDates[0]?.value || 'Lunes'));
    } else {
      setModalDay(upcomingDates[0]?.value || 'Lunes');
    }

    setModalStartTime('09:00');
    setModalEndTime('11:00');
  };

  const handleStartTimeChange = (newStartTime: string) => {
    setModalStartTime(newStartTime);
    const startMins = timeToMinutes(newStartTime);
    const endMins = timeToMinutes(modalEndTime);

    if (endMins - startMins < 120) {
      const validEndTimes = AVAILABLE_TIMES.filter(t => timeToMinutes(t) >= startMins + 120);
      if (validEndTimes.length > 0) {
        setModalEndTime(validEndTimes[0]);
      }
    }
  };

  const confirmRequestBabysitter = async (babysitterId: string) => {
    const startMins = timeToMinutes(modalStartTime);
    const endMins = timeToMinutes(modalEndTime);

    if (endMins - startMins < 120) {
      showAlert("Duración insuficiente", "El servicio requiere un mínimo de 2 horas.");
      return;
    }

    const timeRangeString = modalStartTime + " - " + modalEndTime;

    setRequestingId(babysitterId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No hay sesión activa");

      const { data: existingReq, error: checkError } = await supabase
        .from('job_requests')
        .select('id')
        .eq('parent_id', user.id)
        .eq('babysitter_id', babysitterId)
        .maybeSingle();

      if (checkError) throw checkError;

      const jobDetails = {
        status: 'pending',
        job_date: modalDay,
        job_time: timeRangeString
      };

      if (existingReq) {
        const { error: updateError } = await supabase.from('job_requests').update(jobDetails).eq('id', existingReq.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from('job_requests').insert([{ 
          parent_id: user.id, 
          babysitter_id: babysitterId, 
          ...jobDetails
        }]);
        if (insertError) throw insertError;
      }

      showAlert("¡Solicitud enviada!", "Has solicitado a esta niñera para el " + modalDay + " de " + timeRangeString + ".");
      loadMyRequests();
      setSelectedSitter(null);
      
      await sendNotificationToSitter(babysitterId, "Nueva Solicitud", "Un padre te ha enviado una solicitud de trabajo para el " + modalDay + ".");

    } catch (error: any) {
      showAlert("Error", error.message);
    } finally {
      setRequestingId(null);
    }
  };

  const handleCompleteRequest = async (babysitterId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('job_requests')
        .update({ status: 'completed' })
        .eq('parent_id', user.id)
        .eq('babysitter_id', babysitterId);
      if (error) throw error;
      setMyRequests(prev => { const copy = { ...prev }; delete copy[babysitterId]; return copy; });
      loadHistoryRequests();
      showAlert("¡Servicio completado!", "Ahora puedes calificar la atención en tu historial.");

      await sendNotificationToSitter(babysitterId, "Trabajo Completado", "El padre ha marcado el servicio como completado. ¡Buen trabajo!");

    } catch (error: any) {
      showAlert("Error", error.message);
    }
  };

  const handleCancelRequest = async (babysitterId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('job_requests').update({ status: 'dismissed' }).eq('parent_id', user.id).eq('babysitter_id', babysitterId);
      setMyRequests(prev => { const copy = { ...prev }; delete copy[babysitterId]; return copy; });
      loadHistoryRequests();

      await sendNotificationToSitter(babysitterId, "Solicitud Cancelada", "El padre ha cancelado la solicitud de trabajo.");

    } catch (error: any) {
      showAlert("Error al cancelar", error.message);
    }
  };

  const handleOpenWhatsApp = (sitter: any, phone: string) => {
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    const msg = encodeURIComponent("Hola " + sitter.first_name + ", vi tu perfil y me gustaría coordinar los detalles de la solicitud.");
    Linking.openURL("https://api.whatsapp.com/send?phone=" + cleanPhone + "&text=" + msg);
  };

  const handleAddToCalendar = (title: string, jobDate: string, jobTime: string, address: string) => {
    const text = encodeURIComponent(title);
    const datesParam = buildGoogleCalendarDates(jobDate, jobTime);
    const details = encodeURIComponent('Cita agendada: ' + (jobDate || 'No especificado') + '\nHorario: ' + (jobTime || 'No especificado'));
    const location = encodeURIComponent(address || '');
    Linking.openURL('https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + text + datesParam + '&details=' + details + '&location=' + location);
  };

  const submitReview = async () => {
    if (!reviewingSitter) return;
    setSubmittingReview(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No hay sesión activa");

      const sitterIdToReview = reviewingSitter.babysitter_id || reviewingSitter.id;

      const { error: revError } = await supabase.from('reviews').insert([{
        babysitter_id: sitterIdToReview,
        parent_id: user.id,
        rating: reviewRating,
        comment: reviewComment
      }]);
      if (revError) throw revError;

      const { data: allReviews, error: fetchErr } = await supabase
        .from('reviews')
        .select('rating')
        .eq('babysitter_id', sitterIdToReview);

      if (fetchErr) throw fetchErr;

      const totalReviews = allReviews.length;
      const sumRatings = allReviews.reduce((acc, curr) => acc + curr.rating, 0);
      const newAverage = Number((sumRatings / totalReviews).toFixed(1));

      const { error: updateErr } = await supabase
        .from('babysitter_profiles')
        .update({
          rating: newAverage,
          reviews_count: totalReviews
        })
        .eq('id', sitterIdToReview);

      if (updateErr) throw updateErr;

      showAlert("¡Gracias!", "Tu reseña ha sido publicada con éxito.");
      setReviewingSitter(null);
      setReviewComment('');
      setReviewRating(5);
      loadBabysitters();
      loadHistoryRequests();
      
      await sendNotificationToSitter(sitterIdToReview, "Nueva Calificación", "¡Has recibido una nueva calificación de " + reviewRating + " estrellas!");

    } catch (error: any) {
      showAlert("Error", error.message);
    } finally {
      setSubmittingReview(false);
    }
  };

  const loadParentProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('parent_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') return;

      if (data) {
        setParentProfile({
          phone: data.phone || '',
          address: data.address || '',
          children_info: data.children_info || '',
          emergency_contact: data.emergency_contact || ''
        });
      }
    } catch (error) {}
  };

  const handleSaveProfile = async () => {
    setProfileLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No hay sesión activa");

      const updates = {
        id: user.id,
        phone: parentProfile.phone,
        address: parentProfile.address,
        children_info: parentProfile.children_info,
        emergency_contact: parentProfile.emergency_contact,
        updated_at: new Date()
      };

      const { error } = await supabase.from('parent_profiles').upsert(updates);
      if (error) throw error;
      showAlert("Éxito", "Tu perfil ha sido actualizado correctamente.");
    } catch (error: any) {
      showAlert("Error", error.message);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoadingAuth(true);
    const { error } = await supabase.auth.signOut();
    setLoadingAuth(false);
    if (!error) router.replace('/');
  };

  const availableEndTimes = AVAILABLE_TIMES.filter(
    time => timeToMinutes(time) >= timeToMinutes(modalStartTime) + 120
  );

  const unreadNotificationsCount = notifications.filter(n => !n.is_read).length;

  return (
    <View style={styles.mainWrapper}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container} stickyHeaderIndices={[2]}>
        
        <View style={styles.headerContainer}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Panel de Padres 👨‍👩‍👧</Text>
            <Text style={styles.subtitle}>Selecciona cuándo necesitas ayuda.</Text>
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

        <View style={{ height: 16 }} />

        <View style={styles.tabsContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'nannies' && styles.activeTab]} onPress={() => setActiveTab('nannies')}>
            <Text style={[styles.tabText, activeTab === 'nannies' && styles.activeTabText]}>Buscar Niñeras</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'history' && styles.activeTab]} onPress={() => { setActiveTab('history'); loadHistoryRequests(); }}>
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>Historial</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'profile' && styles.activeTab]} onPress={() => setActiveTab('profile')}>
            <Text style={[styles.tabText, activeTab === 'profile' && styles.activeTabText]}>Mi Perfil</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'nannies' && (
          <View style={styles.contentArea}>
            <View style={styles.filtersContainer}>
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>1. ¿Qué día necesitas?</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                  {['Todos', ...FILTER_DAYS].map(day => (
                    <TouchableOpacity key={day} style={[styles.filterChip, selectedDay === day && styles.filterChipSelected]} onPress={() => setSelectedDay(day)}>
                      <Text style={[styles.filterChipText, selectedDay === day && styles.filterChipTextSelected]}>{day === 'Todos' ? '📅 Cualquier día' : day}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>2. ¿En qué horario genérico?</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                  {['Todos', ...FILTER_SHIFTS].map(shift => (
                    <TouchableOpacity key={shift} style={[styles.filterChip, selectedShift === shift && styles.filterChipSelected]} onPress={() => setSelectedShift(shift)}>
                      <Text style={[styles.filterChipText, selectedShift === shift && styles.filterChipTextSelected]}>{shift === 'Todos' ? '⏰ Cualquier horario' : shift}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>3. ¿En qué comuna?</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                  {FILTER_ZONES.map(zone => (
                    <TouchableOpacity key={zone} style={[styles.filterChip, selectedZone === zone && styles.filterChipSelected]} onPress={() => setSelectedZone(zone)}>
                      <Text style={[styles.filterChipText, selectedZone === zone && styles.filterChipTextSelected]}>{zone === 'Todas' ? '🌎 Todas' : '📍 ' + zone}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            {loadingData ? (
              <ActivityIndicator size="large" color="#3182ce" style={{ marginVertical: 32 }} />
            ) : babysitters.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No hay niñeras disponibles con esta combinación.</Text>
                <Text style={styles.emptySubText}>Intenta flexibilizar el día, el horario o la comuna.</Text>
              </View>
            ) : (
              <View style={styles.listContainer}>
                {babysitters.map((sitter) => {
                  const reqData = myRequests[sitter.id];
                  const requestStatus = reqData?.status;
                  const rawPhone = sitter.phone_number || sitter.phone || sitter.telefono || "";
                  const ratingLabel = sitter.rating ? Number(sitter.rating).toFixed(1) : 'Nuevo';

                  return (
                    <View key={sitter.id} style={styles.card}>
                      <TouchableOpacity activeOpacity={0.7} onPress={() => handleOpenSitterModal(sitter)}>
                        <View style={styles.cardHeaderRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.cardName}>{sitter.first_name} {sitter.last_name}</Text>
                            <Text style={styles.cardZone}>📍 {sitter.location_zone}</Text>
                          </View>
                          <View style={styles.ratingBadge}>
                            <Text style={styles.ratingText}>⭐ {ratingLabel}</Text>
                          </View>
                        </View>

                        <Text style={styles.cardBio} numberOfLines={2}>{sitter.bio}</Text>

                        {Array.isArray(sitter.skills) && sitter.skills.length > 0 && (
                          <View style={styles.cardSkillsPreview}>
                            {sitter.skills.slice(0, 3).map((skill: string, idx: number) => (
                              <View key={idx} style={styles.skillMiniBadge}>
                                <Text style={styles.skillMiniText}>{skill}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </TouchableOpacity>
                      
                      <View style={styles.cardFooter}>
                        <Text style={styles.cardRate}>${sitter.hourly_rate}/hr</Text>
                        <Text style={styles.cardExp}>⭐ {sitter.experience_years} años exp.</Text>
                      </View>

                      <TouchableOpacity
                        style={styles.viewProfileButton}
                        onPress={() => handleOpenSitterModal(sitter)}
                      >
                        <Text style={styles.viewProfileButtonText}>🔍 Ver Perfil y Seleccionar Fecha</Text>
                      </TouchableOpacity>

                      {requestStatus === 'accepted' ? (
                        <View style={[styles.statusBox, styles.statusBoxAccepted]}>
                          
                          <View style={styles.acceptedBanner}>
                            <Text style={styles.acceptedBannerTitle}>🎉 ¡Servicio Confirmado!</Text>
                            <Text style={styles.acceptedBannerSub}>
                              Agendado para el <Text style={{ fontWeight: 'bold' }}>{reqData?.job_date || 'día indicado'}</Text> de <Text style={{ fontWeight: 'bold' }}>{reqData?.job_time || 'horario indicado'}</Text>.
                            </Text>
                          </View>

                          <TouchableOpacity 
                            style={styles.chatAppButton} 
                            onPress={() => { 
                              setActiveChatSitter(sitter); 
                              setActiveRequestId(reqData?.id); 
                              setIsChatOpen(true); 
                            }}
                          >
                            <Text style={styles.chatAppButtonText}>💬 Chat en la App</Text>
                          </TouchableOpacity>

                          <TouchableOpacity style={styles.calendarButton} onPress={() => handleAddToCalendar('Servicio de Niñera: ' + sitter.first_name, reqData?.job_date, reqData?.job_time, parentProfile.address)}>
                            <Text style={styles.calendarButtonText}>📅 Agregar a Google Calendar</Text>
                          </TouchableOpacity>

                          {Boolean(rawPhone) && (
                            <TouchableOpacity style={[styles.contactButton, styles.whatsappButton]} onPress={() => handleOpenWhatsApp(sitter, rawPhone)}>
                              <Text style={styles.contactButtonText}>📱 WhatsApp</Text>
                            </TouchableOpacity>
                          )}
                          
                          <TouchableOpacity style={styles.completeButton} onPress={() => handleCompleteRequest(sitter.id)}>
                            <Text style={styles.completeButtonText}>✅ Marcar Servicio como Completado</Text>
                          </TouchableOpacity>

                          <TouchableOpacity style={styles.cancelAcceptedButton} onPress={() => handleCancelRequest(sitter.id)}>
                            <Text style={styles.cancelAcceptedButtonText}>Cerrar / Cancelar</Text>
                          </TouchableOpacity>
                        </View>
                      ) : requestStatus === 'pending' ? (
                        <View style={[styles.statusBox, styles.statusBoxPending]}>
                          <Text style={styles.statusBoxTextPending}>
                            ⏳ Solicitud enviada ({reqData?.job_date || 'Pendiente'})
                          </Text>
                          <TouchableOpacity style={styles.cancelButton} onPress={() => handleCancelRequest(sitter.id)}>
                            <Text style={styles.cancelButtonText}>Cancelar Solicitud</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.contentArea}>
            <Text style={styles.sectionTitle}>Historial de Servicios</Text>
            <Text style={styles.sectionSubtitle}>Consulta aquí los servicios completados y pasados.</Text>

            {loadingHistory ? (
              <ActivityIndicator size="large" color="#3182ce" style={{ marginVertical: 32 }} />
            ) : historyRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No tienes servicios en tu historial todavía.</Text>
              </View>
            ) : (
              <View style={styles.listContainer}>
                {historyRequests.map((item) => {
                  const sitter = item.babysitter_profiles || {};
                  const isCompleted = item.status === 'completed';
                  const isRejected = item.status === 'rejected';

                  return (
                    <View key={item.id} style={styles.card}>
                      <View style={styles.cardHeaderRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardName}>{sitter.first_name || 'Niñera'} {sitter.last_name || ''}</Text>
                          <Text style={styles.cardZone}>📍 {sitter.location_zone || 'Sin zona'}</Text>
                        </View>
                        <Text style={[styles.badge, isCompleted ? styles.badgeAccepted : styles.badgeRejected]}>
                          {isCompleted ? 'Completado' : isRejected ? 'Rechazado' : 'Cancelado'}
                        </Text>
                      </View>

                      <View style={styles.jobDetailsBox}>
                        <Text style={styles.jobDetailsText}>📅 Fecha: {item.job_date || 'No especificado'}</Text>
                        <Text style={styles.jobDetailsText}>⏰ Horario: {item.job_time || 'No especificado'}</Text>
                      </View>

                      <Text style={styles.dateText}>Registrado el: {new Date(item.created_at).toLocaleDateString()}</Text>

                      {isCompleted && (
                        <TouchableOpacity style={styles.reviewButton} onPress={() => setReviewingSitter(item)}>
                          <Text style={styles.reviewButtonText}>⭐ Calificar o Recalificar Niñera</Text>
                        </TouchableOpacity>
                      )}
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
              <Text style={styles.sectionTitle}>Tus Datos de Contacto</Text>
              <Text style={styles.sectionSubtitle}>Las niñeras verán esta información únicamente cuando acepten tu solicitud.</Text>
              <Text style={styles.inputLabel}>Teléfono (WhatsApp)</Text>
              <TextInput style={styles.input} placeholder="+56 9 1234 5678" value={parentProfile.phone} onChangeText={(text) => setParentProfile({ ...parentProfile, phone: text })} keyboardType="phone-pad" />
              <Text style={styles.inputLabel}>Dirección / Comuna</Text>
              <TextInput style={styles.input} placeholder="Ej: Av. Providencia 1234, Depto 501" value={parentProfile.address} onChangeText={(text) => setParentProfile({ ...parentProfile, address: text })} />
              <Text style={styles.inputLabel}>Información de los Niños</Text>
              <TextInput style={[styles.input, styles.textArea]} placeholder="Ej: 2 niños (3 y 5 años). El mayor es alérgico al maní." value={parentProfile.children_info} onChangeText={(text) => setParentProfile({ ...parentProfile, children_info: text })} multiline numberOfLines={3} />
              <Text style={styles.inputLabel}>Contacto de Emergencia</Text>
              <TextInput style={styles.input} placeholder="Nombre y teléfono de un familiar" value={parentProfile.emergency_contact} onChangeText={(text) => setParentProfile({ ...parentProfile, emergency_contact: text })} />
              <TouchableOpacity style={styles.saveButton} onPress={handleSaveProfile} disabled={profileLoading}>
                {profileLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveButtonText}>Guardar Perfil</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footerContainer}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} disabled={loadingAuth}>
          {loadingAuth ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.signOutButtonText}>Cerrar Sesión</Text>}
        </TouchableOpacity>
      </View>

      {/* MODAL PARA SOLICITAR NIÑERA CON FECHAS EXACTAS (14 DÍAS) */}
      {selectedSitter && (
        <Modal visible={!!selectedSitter} transparent={true} animationType="fade" onRequestClose={() => setSelectedSitter(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarText}>{selectedSitter.first_name?.[0]?.toUpperCase() || '👩‍🍼'}</Text>
                  </View>
                  <Text style={styles.modalName}>{selectedSitter.first_name} {selectedSitter.last_name}</Text>
                  <Text style={styles.modalZone}>📍 {selectedSitter.location_zone}</Text>
                  <View style={styles.modalStatsRow}>
                    <Text style={styles.modalStatItem}>⭐ {selectedSitter.rating ? Number(selectedSitter.rating).toFixed(1) : 'Nuevo'} ({selectedSitter.reviews_count || 0})</Text>
                    <Text style={styles.modalStatItem}>💼 {selectedSitter.experience_years} años exp.</Text>
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Sobre mí</Text>
                  <Text style={styles.modalBioText}>{selectedSitter.bio}</Text>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Habilidades</Text>
                  {Array.isArray(selectedSitter.skills) && selectedSitter.skills.length > 0 ? (
                    <View style={styles.skillsContainer}>
                      {selectedSitter.skills.map((skill: string, index: number) => (
                        <View key={index} style={styles.skillBadge}><Text style={styles.skillText}>✨ {skill}</Text></View>
                      ))}
                    </View>
                  ) : <Text style={styles.modalEmptySkills}>Sin habilidades registradas.</Text>}
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>📅 Selecciona la Fecha Exacta (Próximos 14 días)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalChipScroll}>
                    {modalDateOptions.map((item) => (
                      <TouchableOpacity key={item.value} style={[styles.modalChip, modalDay === item.value && styles.modalChipSelected]} onPress={() => setModalDay(item.value)}>
                        <Text style={[styles.modalChipText, modalDay === item.value && styles.modalChipTextSelected]}>{item.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={{ fontSize: 12, color: '#2b6cb0', marginTop: 6, fontWeight: '600' }}>
                    Fecha elegida: {modalDay}
                  </Text>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>⏰ Hora de Inicio</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalChipScroll}>
                    {AVAILABLE_TIMES.map((time) => (
                      <TouchableOpacity key={time} style={[styles.modalChip, modalStartTime === time && styles.modalChipSelected]} onPress={() => handleStartTimeChange(time)}>
                        <Text style={[styles.modalChipText, modalStartTime === time && styles.modalChipTextSelected]}>{time}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>🏁 Hora de Término (Mínimo 2 horas)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalChipScroll}>
                    {availableEndTimes.map((time) => (
                      <TouchableOpacity key={time} style={[styles.modalChip, modalEndTime === time && styles.modalChipSelected]} onPress={() => setModalEndTime(time)}>
                        <Text style={[styles.modalChipText, modalEndTime === time && styles.modalChipTextSelected]}>{time}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Tarifa por Hora</Text>
                  <Text style={styles.modalPriceText}>${selectedSitter.hourly_rate}/hr</Text>
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.requestButton} onPress={() => confirmRequestBabysitter(selectedSitter.id)}>
                  <Text style={styles.requestButtonText}>✨ Solicitar para el {modalDay}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.closeModalButton} onPress={() => setSelectedSitter(null)}>
                  <Text style={styles.closeModalText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {reviewingSitter && (
        <Modal visible={!!reviewingSitter} transparent={true} animationType="fade" onRequestClose={() => setReviewingSitter(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalName}>Calificar Niñera</Text>
                <Text style={{ textAlign: 'center', color: '#718096', marginBottom: 20 }}>
                  ¿Cómo fue tu experiencia con el servicio?
                </Text>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Selecciona tu Calificación</Text>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity key={star} onPress={() => setReviewRating(star)}>
                        <Text style={{ fontSize: 32 }}>{star <= reviewRating ? '⭐' : '☆'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Comentario (Opcional)</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Ej: Muy atenta y puntual..."
                    value={reviewComment}
                    onChangeText={setReviewComment}
                    multiline
                  />
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.requestButton, { backgroundColor: '#38a169' }]} onPress={submitReview} disabled={submittingReview}>
                  {submittingReview ? <ActivityIndicator color="#fff" /> : <Text style={styles.requestButtonText}>Publicar Calificación</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.closeModalButton} onPress={() => setReviewingSitter(null)}>
                  <Text style={styles.closeModalText}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

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
                <Text style={styles.chatModalName}>Chat con {activeChatSitter?.first_name}</Text>
                <TouchableOpacity onPress={() => setIsChatOpen(false)}>
                  <Text style={{ fontSize: 24, color: '#718096' }}>×</Text>
                </TouchableOpacity>
              </View>
              
              <ScrollView style={styles.chatScroll} contentContainerStyle={{ padding: 16 }}>
                {messages.length === 0 ? (
                  <Text style={styles.emptyText}>No hay mensajes en esta conversación. ¡Di hola!</Text>
                ) : (
                  messages.map((msg, idx) => {
                    const isMe = msg.sender_id !== activeChatSitter?.id; 
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
                <TextInput 
                  style={styles.chatInput} 
                  placeholder="Escribe un mensaje..." 
                  value={newMessage} 
                  onChangeText={setNewMessage} 
                />
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
  container: { flexGrow: 1, alignItems: 'center', padding: 24, paddingBottom: 40 },
  
  headerContainer: { flexDirection: 'row', width: '100%', maxWidth: 500, justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 16 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a202c', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#718096', marginBottom: 8 },
  
  bellButton: { position: 'relative', padding: 8, backgroundColor: '#edf2f7', borderRadius: 20 },
  bellIcon: { fontSize: 20 },
  badgeCount: { position: 'absolute', top: -2, right: -4, backgroundColor: '#e53e3e', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#f7fafc' },
  badgeCountText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },

  tabsContainer: { flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: 8, padding: 4, marginBottom: 24, width: '100%', maxWidth: 500 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  activeTab: { backgroundColor: '#ffffff', elevation: 2 },
  tabText: { fontSize: 14, fontWeight: '600', color: '#718096' },
  activeTabText: { color: '#2b6cb0' },
  contentArea: { width: '100%', maxWidth: 500, alignItems: 'center' },

  filtersContainer: { width: '100%', backgroundColor: '#ffffff', padding: 16, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#e2e8f0' },
  filterSection: { marginBottom: 16 },
  filterLabel: { fontSize: 14, fontWeight: 'bold', color: '#4a5568', marginBottom: 10, paddingHorizontal: 4 },
  filterScroll: { gap: 8, paddingBottom: 4 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#edf2f7', borderWidth: 1, borderColor: '#cbd5e0' },
  filterChipSelected: { backgroundColor: '#ebf8ff', borderColor: '#3182ce' },
  filterChipText: { fontSize: 14, fontWeight: '600', color: '#4a5568' },
  filterChipTextSelected: { color: '#2b6cb0' },

  listContainer: { width: '100%', marginBottom: 32 },
  card: { width: '100%', backgroundColor: '#fff', padding: 20, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardName: { fontSize: 20, fontWeight: 'bold', color: '#2d3748', marginBottom: 4 },
  cardZone: { fontSize: 14, color: '#718096', marginBottom: 12 },
  ratingBadge: { backgroundColor: '#fffaf0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#fbd38d' },
  ratingText: { fontSize: 13, fontWeight: 'bold', color: '#dd6b20' },
  cardBio: { fontSize: 15, color: '#4a5568', marginBottom: 12, lineHeight: 22 },
  cardSkillsPreview: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  skillMiniBadge: { backgroundColor: '#e6fffa', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#b2f5ea' },
  skillMiniText: { color: '#285e61', fontSize: 12, fontWeight: '600' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#edf2f7', paddingTop: 12, paddingBottom: 12 },
  cardRate: { fontSize: 16, fontWeight: 'bold', color: '#38a169' },
  cardExp: { fontSize: 14, color: '#4a5568', fontWeight: '500' },

  viewProfileButton: { backgroundColor: '#edf2f7', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#cbd5e0' },
  viewProfileButtonText: { color: '#2b6cb0', fontSize: 14, fontWeight: 'bold' },
  
  requestButton: { backgroundColor: '#4299e1', paddingVertical: 14, borderRadius: 10, alignItems: 'center', elevation: 2, marginTop: 4 },
  requestButtonDisabled: { opacity: 0.7 },
  requestButtonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.3 },
  
  statusBox: { padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  statusBoxPending: { backgroundColor: '#feebc8' },
  statusBoxTextPending: { color: '#c05621', fontWeight: '600', fontSize: 14, marginBottom: 8 },
  cancelButton: { backgroundColor: '#e53e3e', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, marginTop: 4 },
  cancelButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
  
  statusBoxAccepted: { backgroundColor: '#ffffff', padding: 0 },
  acceptedBanner: { backgroundColor: '#c6f6d5', borderWidth: 1, borderColor: '#9ae6b4', padding: 12, borderRadius: 8, marginBottom: 12, alignItems: 'center', width: '100%' },
  acceptedBannerTitle: { fontSize: 16, fontWeight: 'bold', color: '#22543d', marginBottom: 4 },
  acceptedBannerSub: { fontSize: 14, color: '#2f855a', textAlign: 'center' },
  
  chatAppButton: { backgroundColor: '#805ad5', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', marginTop: 8, width: '100%' },
  chatAppButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  
  calendarButton: { backgroundColor: '#ecc94b', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, marginBottom: 8, width: '100%', alignItems: 'center', marginTop: 8 },
  calendarButtonText: { color: '#744210', fontWeight: 'bold', fontSize: 14 },
  
  contactButton: { backgroundColor: '#25D366', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, marginBottom: 8, width: '100%', alignItems: 'center' },
  whatsappButton: {},
  contactButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  
  completeButton: { backgroundColor: '#3182ce', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, marginBottom: 8, width: '100%', alignItems: 'center' },
  completeButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },

  reviewButton: { backgroundColor: '#d69e2e', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, marginBottom: 8, width: '100%', alignItems: 'center' },
  reviewButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 14 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 10 },

  cancelAcceptedButton: { backgroundColor: '#c53030', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, width: '100%', alignItems: 'center' },
  cancelAcceptedButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  statusBoxRejected: { backgroundColor: '#fed7d7' },
  statusBoxTextRejected: { color: '#9b2c2c', fontWeight: '600', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  dismissButton: { backgroundColor: '#718096', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  dismissButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
  
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, fontSize: 12, fontWeight: 'bold', overflow: 'hidden' },
  badgeAccepted: { backgroundColor: '#c6f6d5', color: '#22543d' },
  badgeRejected: { backgroundColor: '#fed7d7', color: '#9b2c2c' },
  jobDetailsBox: { backgroundColor: '#ebf8ff', padding: 12, borderRadius: 8, marginBottom: 12 },
  jobDetailsText: { fontSize: 14, color: '#2b6cb0', fontWeight: '600' },
  dateText: { fontSize: 13, color: '#718096', marginBottom: 16 },

  emptyState: { alignItems: 'center', marginTop: 20, padding: 20 },
  emptyText: { fontSize: 16, color: '#4a5568', fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  emptySubText: { fontSize: 14, color: '#a0aec0', textAlign: 'center' },

  profileCard: { width: '100%', backgroundColor: '#ffffff', padding: 24, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 32 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#2d3748', marginBottom: 6 },
  sectionSubtitle: { fontSize: 14, color: '#718096', marginBottom: 24 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: '#4a5568', marginBottom: 8 },
  input: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e0', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#2d3748', marginBottom: 20 },
  textArea: { height: 100, textAlignVertical: 'top' },
  saveButton: { backgroundColor: '#38a169', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  saveButtonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },

  footerContainer: { padding: 16, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0', alignItems: 'center', width: '100%' },
  signOutButton: { backgroundColor: '#e53e3e', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, width: '100%', maxWidth: 500, alignItems: 'center' },
  signOutButtonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContent: { backgroundColor: '#ffffff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85%' },
  modalHeader: { alignItems: 'center', marginBottom: 20 },
  avatarPlaceholder: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#ebf8ff', justifyContent: 'center', alignItems: 'center', marginBottom: 12, borderWidth: 2, borderColor: '#3182ce' },
  avatarText: { fontSize: 28, fontWeight: 'bold', color: '#3182ce' },
  modalName: { fontSize: 22, fontWeight: 'bold', color: '#2d3748', marginBottom: 4, textAlign: 'center' },
  modalZone: { fontSize: 14, color: '#718096', marginBottom: 12, textAlign: 'center' },
  modalStatsRow: { flexDirection: 'row', gap: 12, backgroundColor: '#edf2f7', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, flexWrap: 'wrap', justifyContent: 'center' },
  modalStatItem: { fontSize: 13, fontWeight: '600', color: '#4a5568' },
  modalSection: { marginBottom: 18 },
  modalSectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#2d3748', marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#edf2f7', paddingBottom: 4 },
  modalBioText: { fontSize: 15, color: '#4a5568', lineHeight: 22 },
  modalEmptySkills: { fontSize: 14, color: '#a0aec0', fontStyle: 'italic' },
  
  modalChipScroll: { gap: 8, paddingBottom: 4 },
  modalChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#edf2f7', borderWidth: 1, borderColor: '#cbd5e0' },
  modalChipSelected: { backgroundColor: '#ebf8ff', borderColor: '#3182ce' },
  modalChipText: { fontSize: 13, fontWeight: '600', color: '#4a5568' },
  modalChipTextSelected: { color: '#2b6cb0', fontWeight: 'bold' },

  skillsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillBadge: { backgroundColor: '#e6fffa', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#319795' },
  skillText: { color: '#285e61', fontSize: 13, fontWeight: '600' },
  modalPriceText: { fontSize: 20, fontWeight: 'bold', color: '#38a169' },
  modalActions: { borderTopWidth: 1, borderTopColor: '#edf2f7', paddingTop: 12, marginTop: 4 },
  closeModalButton: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  closeModalText: { color: '#718096', fontSize: 15, fontWeight: 'bold' },

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