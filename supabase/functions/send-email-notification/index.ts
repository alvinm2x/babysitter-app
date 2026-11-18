import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Correo de respaldo seguro en caso de que no se encuentre el email en Auth
const FALLBACK_EMAIL = 'alvin_m2x@hotmail.com';

// Helper para envolver los 3 casos con el diseño oficial de MiBabysitter.cl
const buildEmailTemplate = (
  badgeText: string,
  title: string,
  intro: string,
  detailsHtml: string,
  ctaText: string,
  ctaUrl: string
) => `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background-color: #F7FAF6; border: 1px solid #E2E8F0; border-radius: 16px; overflow: hidden;">
    <div style="background-color: #3182CE; padding: 22px 24px; text-align: center;">
      <h2 style="color: #FFFFFF; margin: 0; font-size: 20px;">MiBabysitter.cl</h2>
      <p style="color: #EBF8FF; margin: 6px 0 0 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${badgeText}</p>
    </div>

    <div style="padding: 28px 24px;">
      <h3 style="color: #1A202C; margin-top: 0; font-size: 18px;">${title}</h3>
      <p style="color: #4A5568; font-size: 15px; line-height: 1.5; margin-bottom: 20px;">
        ${intro}
      </p>

      <div style="background-color: #FFFFFF; border-left: 4px solid #D69E2E; border-radius: 12px; padding: 18px; margin-bottom: 26px; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
        ${detailsHtml}
      </div>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${ctaUrl}" style="background-color: #D69E2E; color: #FFFFFF; padding: 14px 32px; text-decoration: none; border-radius: 9999px; font-weight: bold; font-size: 15px; display: inline-block;">
          ${ctaText}
        </a>
      </div>

      <p style="font-size: 12px; color: #718096; text-align: center; margin-top: 24px; border-top: 1px solid #E2E8F0; padding-top: 16px;">
        Este es un correo automático de <strong>MiBabysitter.cl</strong>. Por favor no respondas a este mensaje; presiona el botón dorado para gestionar tu turno en la aplicación.
      </p>
    </div>
  </div>
`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const payload = await req.json();
    const { record, old_record } = payload;

    if (!record) {
      return new Response(JSON.stringify({ message: 'No record found' }), { status: 200 });
    }

    // Inicializamos cliente Supabase con Service Role (inyectado automáticamente por Supabase)
    const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    // Función segura para obtener el email real de cualquier usuario (Padre o Niñera)
    const getUserEmail = async (userId: string | undefined): Promise<string> => {
      if (!supabase || !userId) return FALLBACK_EMAIL;
      try {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (!error && data?.user?.email) {
          return data.user.email;
        }
      } catch (_) {
        // Si falla la lectura, cae silenciosamente al correo de respaldo
      }
      return FALLBACK_EMAIL;
    };

    // Formateo seguro de los datos de job_requests
    const fecha = record.job_date || 'Por confirmar';
    const horario = record.job_time || 'Ver en la aplicación';
    const montoTotal = record.total_amount
      ? `$${Number(record.total_amount).toLocaleString('es-CL')}`
      : 'Ver en la app';
    const gananciaNanny = record.babysitter_payout
      ? `$${Number(record.babysitter_payout).toLocaleString('es-CL')}`
      : (record.total_amount ? `$${Math.round(Number(record.total_amount) * 0.7).toLocaleString('es-CL')}` : 'Ver en la app');

    let emailData = null;

    // =========================================================================
    // Caso 1: Nueva Solicitud (Padre -> Niñera)
    // =========================================================================
    if (record.status === 'pending' && !old_record) {
      const nannyEmail = await getUserEmail(record.babysitter_id);

      // Buscamos la dirección/comuna del padre de forma segura
      let sector = 'Ver detalle en la aplicación';
      if (supabase && record.parent_id) {
        try {
          const { data: parentData } = await supabase
            .from('parent_profiles')
            .select('address')
            .eq('id', record.parent_id)
            .maybeSingle();
          if (parentData?.address) sector = parentData.address;
        } catch (_) {}
      }

      const ctaUrl = `https://www.mibabysitter.cl/babysitter?requestId=${record.id}`;

      const detailsHtml = `
        <p style="margin: 0 0 10px 0; color: #2D3748; font-size: 14px;"><strong>📅 Fecha:</strong> ${fecha}</p>
        <p style="margin: 0 0 10px 0; color: #2D3748; font-size: 14px;"><strong>⏰ Horario:</strong> ${horario}</p>
        <p style="margin: 0 0 12px 0; color: #2D3748; font-size: 14px;"><strong>📍 Sector / Dirección:</strong> ${sector}</p>
        <p style="margin: 0; color: #1A202C; font-size: 16px; border-top: 1px solid #EDF2F7; padding-top: 10px;">
          <strong>💰 Tu ganancia líquida:</strong> <span style="color: #3182CE; font-weight: bold;">${gananciaNanny}</span>
        </p>
      `;

      emailData = {
        to: nannyEmail,
        subject: '🔔 Nueva Solicitud de Cuidado',
        html: buildEmailTemplate(
          'Nueva Solicitud',
          '¡Tienes una nueva solicitud de turno!',
          'Una familia ha solicitado tus servicios de cuidado. Revisa los detalles a continuación para confirmar tu disponibilidad:',
          detailsHtml,
          'Ver y Aceptar Solicitud',
          ctaUrl
        ),
      };
    }

    // =========================================================================
    // Caso 2: Solicitud Aceptada (Niñera -> Padre)
    // =========================================================================
    else if (record.status === 'accepted' && old_record?.status === 'pending' && record.payment_status === 'unpaid') {
      const parentEmail = await getUserEmail(record.parent_id);
      const ctaUrl = `https://www.mibabysitter.cl/parent?requestId=${record.id}`;

      const detailsHtml = `
        <p style="margin: 0 0 10px 0; color: #2D3748; font-size: 14px;"><strong>📅 Fecha confirmada:</strong> ${fecha}</p>
        <p style="margin: 0 0 12px 0; color: #2D3748; font-size: 14px;"><strong>⏰ Horario:</strong> ${horario}</p>
        <p style="margin: 0; color: #1A202C; font-size: 16px; border-top: 1px solid #EDF2F7; padding-top: 10px;">
          <strong>💳 Total a pagar para reservar:</strong> <span style="color: #3182CE; font-weight: bold;">${montoTotal}</span>
        </p>
      `;

      emailData = {
        to: parentEmail,
        subject: '💳 ¡Tu solicitud fue aceptada!',
        html: buildEmailTemplate(
          'Niñera Confirmada',
          '¡Tu solicitud fue aceptada!',
          'La niñera ha confirmado su disponibilidad para tu turno. Entra a la aplicación y realiza el pago en custodia para asegurar la reserva y desbloquear los datos de contacto:',
          detailsHtml,
          'Ir a Pagar y Confirmar Reserva',
          ctaUrl
        ),
      };
    }

    // =========================================================================
    // Caso 3: Servicio Pagado (Confirmación Final)
    // =========================================================================
    else if (record.payment_status === 'held' && old_record?.payment_status === 'unpaid') {
      const parentEmail = await getUserEmail(record.parent_id);
      const nannyEmail = await getUserEmail(record.babysitter_id);
      // Enviamos copia a ambos (o sin duplicar si están usando la misma cuenta de prueba)
      const recipients = Array.from(new Set([parentEmail, nannyEmail]));
      const ctaUrl = `https://www.mibabysitter.cl`;

      const detailsHtml = `
        <p style="margin: 0 0 10px 0; color: #2D3748; font-size: 14px;"><strong>📅 Fecha del servicio:</strong> ${fecha}</p>
        <p style="margin: 0 0 10px 0; color: #2D3748; font-size: 14px;"><strong>⏰ Horario:</strong> ${horario}</p>
        <p style="margin: 0; color: #2D3748; font-size: 14px;"><strong>🔒 Estado del pago:</strong> Pagado y protegido en custodia</p>
      `;

      emailData = {
        to: recipients,
        subject: '✅ Reserva Pagada y Confirmada',
        html: buildEmailTemplate(
          'Reserva Confirmada',
          '¡Todo listo para el turno!',
          'El pago se ha procesado con éxito. Los datos de contacto y WhatsApp directo ya están desbloqueados en la plataforma.',
          detailsHtml,
          'Ver Detalles del Turno',
          ctaUrl
        ),
      };
    }

    if (!emailData) {
      return new Response(JSON.stringify({ message: 'No action required' }), { status: 200 });
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'MiBabysitter.cl <notificaciones@mibabysitter.cl>',
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), { status: 200 });
  } catch (error) {
    const err = error as Error;
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }
});