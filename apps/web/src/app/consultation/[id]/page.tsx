'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Paperclip,
  CheckCheck,
  ShieldCheck,
  Bot,
  AlertCircle,
  Download,
  Building,
  MessageSquare,
  Plus,
  Trash2,
  Clock,
} from 'lucide-react';
import { fetchApi, getAuthToken } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { registerSocket } from '@/lib/socket-registry';
import { ClientTime } from '@/components/client-time';
import { VitalsLabsPanel } from '@/components/clinical/vitals-labs-panel';
import { useToast } from '@/components/toast';

interface ChatMessage {
  id: string;
  senderId: string;
  senderRole: 'DOCTOR' | 'PATIENT' | 'ADMIN' | 'DRIVER';
  content: string;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  status: string;
  createdAt: string;
}

interface AppointmentDetail {
  id: string;
  bookingRef: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  qualifications?: string | null;
  licenseNumber?: string | null;
  patientId: string;
  patientName: string;
  slotTime: string;
  consultationMode?: 'VIDEO' | 'IN_CLINIC' | 'CHAT';
  status: string;
  consultation: {
    roomName: string;
    status: string;
    patientConsentGiven: boolean;
    consentTimestamp?: string | null;
  } | null;
}

export default function ConsultationRoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const appointmentId = params?.id as string;
  const initialTab = searchParams.get('tab') || 'video';

  const { user: currentUser } = useAuth();
  const toast = useToast();
  const isDoctor = currentUser?.role === 'DOCTOR';

  const [hasConsented, setHasConsented] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [livekitStatus, setLivekitStatus] = useState<string>('Disconnected');
  const [livekitError, setLivekitError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [secondsUntilOpen, setSecondsUntilOpen] = useState<number | null>(null);
  const [isSlotExpired, setIsSlotExpired] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const attachedAudiosRef = useRef<HTMLAudioElement[]>([]);
  const [activeTab, setActiveTab] = useState<'video' | 'vitals' | 'prescription' | 'copilot'>(
    initialTab === 'prescription' ? 'prescription' : initialTab === 'vitals' ? 'vitals' : 'video',
  );

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Prescription form for doctors (Multi-medicine with validation)
  const [rxDiagnosis, setRxDiagnosis] = useState('');
  const [rxAdvice, setRxAdvice] = useState('');
  const [rxMedicines, setRxMedicines] = useState<
    Array<{ id: string; name: string; dosage: string; frequency: string; durationDays: number }>
  >([
    { id: 'med-1', name: '', dosage: '500mg', frequency: '1-0-1 (After Food)', durationDays: 5 },
  ]);
  const [copilotNote, setCopilotNote] = useState<any>(null);

  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef<Room | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isMicOnRef = useRef(isMicOn);
  const isCameraOnRef = useRef(isCameraOn);
  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);
  useEffect(() => {
    isCameraOnRef.current = isCameraOn;
  }, [isCameraOn]);

  const apptQuery = useQuery<AppointmentDetail>({
    queryKey: ['appointment', appointmentId],
    queryFn: () => fetchApi<AppointmentDetail>(`/appointments/${appointmentId}`),
    enabled: !!appointmentId && !!currentUser?.token,
  });

  const messagesQuery = useQuery<ChatMessage[]>({
    queryKey: ['consultation-messages', appointmentId],
    queryFn: () => fetchApi<ChatMessage[]>(`/consultations/${appointmentId}/messages?limit=100`),
    enabled: !!appointmentId && !!currentUser?.token,
  });

  const rxQuery = useQuery<any>({
    queryKey: ['consultation-prescription', appointmentId],
    queryFn: async () => {
      try {
        return await fetchApi(`/consultations/${appointmentId}/prescriptions`);
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('not found') || msg.includes('404')) {
          return null;
        }
        throw err;
      }
    },
    enabled: !!appointmentId && !!currentUser?.token && activeTab === 'prescription',
    retry: false,
  });

  useEffect(() => {
    if (messagesQuery.data) {
      setMessages(messagesQuery.data);
    }
  }, [messagesQuery.data]);

  useEffect(() => {
    if (apptQuery.data?.consultation?.patientConsentGiven || isDoctor) {
      setHasConsented(true);
    }
  }, [apptQuery.data, isDoctor]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Slot Time 10-minute pre-open / +30-minute close window countdown (matches LiveKitService)
  useEffect(() => {
    const slotTimeStr = apptQuery.data?.slotTime;
    if (!slotTimeStr) return;

    const slotTime = new Date(slotTimeStr).getTime();
    const openTime = slotTime - 10 * 60 * 1000;
    const closeTime = slotTime + 30 * 60 * 1000;

    const checkTimes = () => {
      const now = Date.now();
      if (now < openTime) {
        setSecondsUntilOpen(Math.ceil((openTime - now) / 1000));
        setIsSlotExpired(false);
      } else if (now > closeTime) {
        setSecondsUntilOpen(0);
        setIsSlotExpired(true);
      } else {
        setSecondsUntilOpen(0);
        setIsSlotExpired(false);
      }
    };

    checkTimes();
    const interval = setInterval(checkTimes, 1000);
    return () => clearInterval(interval);
  }, [apptQuery.data?.slotTime]);

  // Connect Socket.IO /consultation namespace with dynamic token callback
  useEffect(() => {
    if (!appointmentId || !currentUser) return;

    const socketOrigin =
      typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SOCKET_URL
        ? process.env.NEXT_PUBLIC_SOCKET_URL
        : undefined;

    const sock = io(socketOrigin ? `${socketOrigin}/consultation` : '/consultation', {
      auth: (cb) => {
        cb({ token: getAuthToken() || '' });
      },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = sock;
    const unregisterSocket = registerSocket(sock);

    sock.on('connect', () => {
      sock.emit('join_room', { appointmentId }, (ack: any) => {
        if (ack?.error) {
          setChatError(ack.error);
        }
      });
    });

    sock.on('new_message', (msg: ChatMessage) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });

    sock.on('user_typing', (evt: { userId: string; isTyping: boolean }) => {
      if (evt.userId !== currentUser?.id) {
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
        if (evt.isTyping) {
          setIsTyping(true);
          typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
          }, 3000);
        } else {
          setIsTyping(false);
        }
      }
    });

    return () => {
      unregisterSocket();
      sock.disconnect();
      socketRef.current = null;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [appointmentId, currentUser]);

  const isRoomOpen = secondsUntilOpen === 0 && !isSlotExpired;
  const consultationMode = apptQuery.data?.consultationMode;

  // Connect LiveKit room once consented, mode is VIDEO, and within time window
  useEffect(() => {
    if (!hasConsented || !appointmentId || !currentUser || !consultationMode) return;
    if (consultationMode !== 'VIDEO') {
      setLivekitStatus(
        consultationMode === 'IN_CLINIC'
          ? 'In-Clinic Mode'
          : 'Live Chat Mode',
      );
      return;
    }

    if (secondsUntilOpen !== null && secondsUntilOpen > 0) {
      setLivekitStatus('Waiting for room to open...');
      return;
    }

    if (isSlotExpired) {
      setLivekitStatus('Consultation window ended');
      return;
    }

    if (!isRoomOpen) return;

    let cancelled = false;
    let retryTimeout: NodeJS.Timeout | null = null;
    let retryAttempt = 0;

    const cleanupAudio = () => {
      attachedAudiosRef.current.forEach((el) => {
        try {
          el.pause();
          el.remove();
        } catch {
          // ignore
        }
      });
      attachedAudiosRef.current = [];
    };

    const connectLiveKit = async () => {
      if (cancelled) return;
      try {
        setLivekitError(null);
        setPermissionError(null);
        setLivekitStatus('Requesting join token...');
        const tokenData = await fetchApi<{
          token: string;
          livekitUrl: string;
          roomName: string;
        }>(`/consultations/${appointmentId}/video-token`, {
          method: 'POST',
          body: JSON.stringify({}),
        });

        if (cancelled) return;
        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
            track.attach(remoteVideoRef.current);
          }
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            document.body.appendChild(el);
            attachedAudiosRef.current.push(el);
          }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) {
            const detached = track.detach();
            detached.forEach((el) => {
              el.pause();
              el.remove();
            });
            attachedAudiosRef.current = attachedAudiosRef.current.filter(
              (a) => !detached.includes(a),
            );
          }
        });

        room.on(RoomEvent.Disconnected, () => {
          cleanupAudio();
          setLivekitStatus('Disconnected');
        });

        await room.connect(tokenData.livekitUrl, tokenData.token);
        retryAttempt = 0;
        setLivekitStatus(`Connected (${tokenData.roomName})`);

        try {
          const tracks = await createLocalTracks({
            audio: isMicOnRef.current,
            video: isCameraOnRef.current,
          });
          for (const t of tracks) {
            await room.localParticipant.publishTrack(t);
            if (t.kind === Track.Kind.Video && localVideoRef.current) {
              t.attach(localVideoRef.current);
            }
          }
        } catch (mediaErr: any) {
          if (
            mediaErr?.name === 'NotAllowedError' ||
            mediaErr?.name === 'PermissionDeniedError' ||
            String(mediaErr).toLowerCase().includes('permission') ||
            String(mediaErr).toLowerCase().includes('not allowed')
          ) {
            setPermissionError(
              'Permission Denied — Camera or microphone access is blocked. Please enable camera and mic permissions in your browser settings to participate in video consultation.',
            );
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setLivekitError(err.message);
          const delay = Math.min(30000, 1000 * Math.pow(2, retryAttempt));
          retryAttempt++;
          setLivekitStatus(`Connection error. Retrying in ${Math.round(delay / 1000)}s...`);
          retryTimeout = setTimeout(connectLiveKit, delay);
        }
      }
    };

    connectLiveKit();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      cleanupAudio();
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [hasConsented, appointmentId, currentUser, consultationMode, isRoomOpen, isSlotExpired]);

  const consentMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/consultations/${appointmentId}/consent`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      setHasConsented(true);
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      toast.success('Telemedicine informed consent recorded.');
    },
    onError: (err: any) => {
      toast.error(`Unable to record consent: ${err.message || 'Action failed'}`);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: 'WAITING' | 'LIVE' | 'ENDED') =>
      fetchApi(`/consultations/${appointmentId}/session-status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      if (status === 'ENDED') {
        roomRef.current?.disconnect();
        setActiveTab('prescription');
        toast.success('Consultation concluded. You can now issue a digital prescription.');
      } else if (status === 'LIVE') {
        toast.success('Consultation session is now live.');
      }
    },
    onError: (err: any) => {
      toast.error(`Session update failed: ${err.message || 'Transition rejected'}`);
    },
  });

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = inputMsg.trim();
    if (!content) return;
    setInputMsg('');
    setChatError(null);

    if (socketRef.current?.connected) {
      socketRef.current.emit(
        'send_message',
        { appointmentId, content },
        (ack: any) => {
          if (ack?.error) setChatError(ack.error);
          if (ack?.message) {
            setMessages((prev) =>
              prev.some((m) => m.id === ack.message.id) ? prev : [...prev, ack.message],
            );
          }
        },
      );
    } else {
      try {
        const msg = await fetchApi<ChatMessage>(`/consultations/${appointmentId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content }),
        });
        setMessages((prev) => [...prev, msg]);
      } catch (err: any) {
        setChatError(err.message);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setChatError(null);
    try {
      const { uploadUrl, fileKey } = await fetchApi<{
        uploadUrl: string;
        fileKey: string;
      }>(`/consultations/${appointmentId}/attachments/upload-url`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          sizeBytes: file.size,
        }),
      });

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Upload to object storage failed (${putRes.status})`);
      }

      if (socketRef.current?.connected) {
        socketRef.current.emit('send_message', {
          appointmentId,
          content: `Attached file: ${file.name}`,
          attachmentUrl: fileKey,
          attachmentType: file.type,
        });
      } else {
        const msg = await fetchApi<ChatMessage>(`/consultations/${appointmentId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            content: `Attached file: ${file.name}`,
            attachmentUrl: fileKey,
            attachmentType: file.type,
          }),
        });
        setMessages((prev) => [...prev, msg]);
      }
    } catch (err: any) {
      setChatError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadAttachment = async (fileKey: string) => {
    try {
      const res = await fetchApi<{ downloadUrl: string }>(
        `/consultations/${appointmentId}/attachments/download-url?fileKey=${encodeURIComponent(fileKey)}`,
      );
      window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setChatError(err.message);
    }
  };

  const copilotMutation = useMutation({
    mutationFn: () =>
      fetchApi('/ai/copilot/draft-note', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId,
          patientName: apptQuery.data?.patientName || 'Patient',
          messages: messages.map((m) => ({ sender: m.senderRole, content: m.content })),
        }),
      }),
    onSuccess: (data) => setCopilotNote(data.soapNote ?? data.soap_note),
    onError: (err: any) => toast.error(`AI Copilot failed: ${err.message || 'Unavailable'}`),
  });

  const saveRxMutation = useMutation({
    mutationFn: () => {
      const method = rxQuery.data ? 'PUT' : 'POST';
      const validMeds = rxMedicines
        .filter((m) => m.name.trim().length > 0)
        .map((m) => ({
          name: m.name.trim(),
          dosage: m.dosage.trim() || 'Standard Dose',
          frequency: m.frequency.trim() || '1-0-1',
          durationDays: Math.max(1, Number(m.durationDays) || 1),
        }));

      return fetchApi(`/consultations/${appointmentId}/prescriptions`, {
        method,
        body: JSON.stringify({
          diagnosis: rxDiagnosis.trim(),
          advice: rxAdvice.trim(),
          medicines: validMeds,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultation-prescription', appointmentId] });
      toast.success('Prescription successfully saved and immutable version recorded.');
    },
    onError: (err: any) => {
      toast.error(`Prescription failed: ${err.message || 'Validation error'}`);
    },
  });

  if (!currentUser?.token) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-teal-600 mx-auto" />
        <h1 className="text-xl font-bold">Sign In Required for Consultation Room</h1>
        <Link
          href={`/auth/login?redirect=${encodeURIComponent(`/consultation/${appointmentId}`)}`}
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-600 text-white text-xs font-bold"
        >
          Sign In
        </Link>
      </div>
    );
  }

  const appt = apptQuery.data;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {!hasConsented && !isDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-teal-100 dark:bg-teal-950 text-teal-600 flex items-center justify-center">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                  Telemedicine Informed Consent
                </h3>
                <p className="text-xs text-slate-500">
                  India Telemedicine Practice Guidelines 2020 Compliance
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300 space-y-2">
              <p>
                By joining this remote consultation with {appt?.doctorName || 'your attending physician'}, you confirm you are in India and consent to encrypted video & chat consultation.
              </p>
              <p>If experiencing acute medical emergency, dial 112 immediately.</p>
            </div>

            <button
              type="button"
              disabled={consentMutation.isPending}
              onClick={() => consentMutation.mutate()}
              className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-md"
            >
              {consentMutation.isPending ? 'Recording Consent...' : 'I Consent & Join Consultation Room'}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              Consultation Room {appt ? `• ${appt.doctorName}` : ''}
            </h1>
            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded-full">
              {livekitStatus}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Ref: {appt?.bookingRef || appointmentId} • Consent: {hasConsented ? 'Verified' : 'Pending'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('video')}
            className={`px-3 py-1.5 rounded-lg ${activeTab === 'video' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-sm' : 'text-slate-500'}`}
          >
            Video &amp; Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('vitals')}
            className={`px-3 py-1.5 rounded-lg ${activeTab === 'vitals' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-sm' : 'text-slate-500'}`}
          >
            Vitals &amp; Labs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('prescription')}
            className={`px-3 py-1.5 rounded-lg ${activeTab === 'prescription' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-sm' : 'text-slate-500'}`}
          >
            Digital Prescription
          </button>
          {isDoctor && (
            <button
              type="button"
              onClick={() => setActiveTab('copilot')}
              className={`px-3 py-1.5 rounded-lg ${activeTab === 'copilot' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-sm' : 'text-slate-500'}`}
            >
              AI Clinical Note
            </button>
          )}
        </div>
      </div>

      {activeTab === 'video' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:h-[640px]">
          <div className="lg:col-span-2 min-h-[380px] lg:min-h-0 bg-slate-900 rounded-3xl overflow-hidden relative flex flex-col justify-between p-4 shadow-xl border border-slate-800">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="relative z-10 flex flex-col gap-2 w-full text-white text-xs">
              <div className="flex items-center justify-between">
                <span className="bg-black/50 px-3 py-1 rounded-full">{livekitStatus}</span>
                {livekitError && (
                  <span className="bg-amber-900/80 text-amber-200 px-3 py-1 rounded-full text-[11px]">
                    {livekitError}
                  </span>
                )}
              </div>
              {permissionError && (
                <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{permissionError}</span>
                </div>
              )}
              {secondsUntilOpen !== null && secondsUntilOpen > 0 && (
                <div className="p-3 rounded-xl bg-amber-950/80 border border-amber-500/50 text-amber-200 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
                    <span>Room opens 10 min prior to slot:</span>
                  </div>
                  <span className="font-mono font-bold bg-amber-900/60 px-2 py-0.5 rounded text-amber-100">
                    {Math.floor(secondsUntilOpen / 60)}m {secondsUntilOpen % 60}s
                  </span>
                </div>
              )}
              {isSlotExpired && (
                <div className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-xs text-center">
                  Consultation window has concluded.
                </div>
              )}
            </div>

            {appt?.consultationMode === 'IN_CLINIC' ? (
              <div className="relative z-10 flex flex-col items-center justify-center text-white text-center px-6">
                <div className="w-16 h-16 rounded-full bg-teal-900/60 border-2 border-teal-500/40 flex items-center justify-center text-teal-400 mb-3">
                  <Building className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold">In-Clinic Consultation Chamber</h2>
                <p className="text-xs text-slate-300 mt-1 max-w-md">
                  Physical clinic appointment with {appt?.doctorName || 'Doctor'}. Use the right panel for instant clinical chat, review digital prescriptions, vitals, and lab orders.
                </p>
                <span className="mt-3 px-3 py-1 rounded-full bg-teal-500/20 text-teal-300 text-xs font-semibold">
                  Mode: In-Clinic Chamber Visit
                </span>
              </div>
            ) : appt?.consultationMode === 'CHAT' ? (
              <div className="relative z-10 flex flex-col items-center justify-center text-white text-center px-6">
                <div className="w-16 h-16 rounded-full bg-purple-900/60 border-2 border-purple-500/40 flex items-center justify-center text-purple-400 mb-3">
                  <MessageSquare className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold">Live Telehealth Chat Consultation</h2>
                <p className="text-xs text-slate-300 mt-1 max-w-md">
                  Active text consultation channel with {appt?.doctorName || 'Doctor'}. Send messages and medical attachments via the chat pane on the right.
                </p>
                <span className="mt-3 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold">
                  Mode: Real-time Socket Chat
                </span>
              </div>
            ) : (
              <div className="relative z-10 flex flex-col items-center justify-center text-white pointer-events-none">
                <div className="w-24 h-24 rounded-full bg-slate-800/80 border-2 border-teal-500/40 flex items-center justify-center text-2xl font-bold">
                  {(appt?.doctorName || 'MD').replace(/^Dr\.\s*/i, '').slice(0, 2).toUpperCase()}
                </div>
                <p className="mt-2 font-bold text-sm">{appt?.doctorName || 'Attending Physician'}</p>
                <p className="text-xs text-teal-400">{appt?.specialty || 'Telehealth'}</p>
              </div>
            )}

            {appt?.consultationMode === 'VIDEO' && (
              <div className="absolute bottom-20 right-6 w-36 h-28 rounded-2xl bg-slate-800 border-2 border-slate-700 overflow-hidden shadow-lg flex items-center justify-center text-white text-xs z-10">
                <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                {!isCameraOn && (
                  <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-slate-400 text-[10px]">
                    <VideoOff className="w-5 h-5 mb-1" /> Camera Off
                  </div>
                )}
              </div>
            )}

            <div className="z-10 flex flex-wrap items-center justify-center gap-3 bg-slate-950/80 backdrop-blur-md max-w-lg mx-auto py-2.5 px-6 rounded-2xl border border-slate-800">
              {isDoctor && appt?.status === 'CONFIRMED' && (
                <button
                  type="button"
                  disabled={updateStatusMutation.isPending}
                  onClick={() => updateStatusMutation.mutate('LIVE')}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm disabled:opacity-50"
                >
                  Start Consultation
                </button>
              )}
              {isDoctor && (appt?.status === 'IN_PROGRESS' || appt?.consultation?.status === 'LIVE') && (
                <button
                  type="button"
                  disabled={updateStatusMutation.isPending}
                  onClick={() => setShowEndModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-sm disabled:opacity-50"
                >
                  End &amp; Complete
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const next = !isMicOn;
                  setIsMicOn(next);
                  roomRef.current?.localParticipant.setMicrophoneEnabled(next).catch(() => {});
                }}
                className={`p-3 rounded-full ${isMicOn ? 'bg-slate-800 text-white' : 'bg-rose-600 text-white'}`}
                title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
              >
                {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !isCameraOn;
                  setIsCameraOn(next);
                  roomRef.current?.localParticipant.setCameraEnabled(next).catch(() => {});
                }}
                className={`p-3 rounded-full ${isCameraOn ? 'bg-slate-800 text-white' : 'bg-rose-600 text-white'}`}
                title={isCameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
              >
                {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => setShowEndModal(true)}
                className="p-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white shadow-md transition-colors"
                title={isDoctor ? 'End & Complete Consultation' : 'Leave Consultation'}
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Real-Time Socket.IO Chat */}
          <div className="h-[460px] lg:h-full rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Encrypted Consultation Chat
                </h3>
                <p className="text-[11px] text-slate-400">Securely Saved to Health Record • 7d follow-up</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600"
                title="Upload medical PDF/image via MinIO presigned URL"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </div>

            {chatError && (
              <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-[11px]">
                {chatError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {messages.map((m) => {
                const isMine = m.senderId === currentUser?.id;
                return (
                  <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                        isMine
                          ? 'bg-teal-600 text-white rounded-br-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-bl-sm'
                      }`}
                    >
                      <p>{m.content}</p>
                      {m.attachmentUrl && (
                        <button
                          type="button"
                          onClick={() => handleDownloadAttachment(m.attachmentUrl!)}
                          className="mt-2 p-2 rounded-lg bg-black/20 text-[11px] flex items-center gap-1.5 underline"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download Attachment</span>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1">
                      <span><ClientTime datetime={m.createdAt} mode="time" /></span>
                      {isMine && <CheckCheck className="w-3 h-3 text-teal-600" />}
                    </div>
                  </div>
                );
              })}
              {isTyping && (
                <div className="text-[11px] italic text-teal-600 dark:text-teal-400 px-1">
                  Participant is typing...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
            >
              <input
                type="text"
                value={inputMsg}
                onChange={(e) => {
                  setInputMsg(e.target.value);
                  socketRef.current?.emit('typing', {
                    appointmentId,
                    isTyping: e.target.value.length > 0,
                  });
                }}
                placeholder="Type message..."
                className="flex-1 bg-slate-100 dark:bg-slate-800 border-none rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white"
              />
              <button
                type="submit"
                disabled={!inputMsg.trim()}
                className="p-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'prescription' && (
        <div className="max-w-3xl mx-auto p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6">
          <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-xl font-bold">Immutable Digital Prescription</h2>
              <p className="text-xs text-slate-500">
                {appt?.doctorName} ({appt?.licenseNumber || 'Verified'})
              </p>
            </div>
            {rxQuery.data && (
              <span className="text-xs font-mono font-bold bg-teal-100 text-teal-700 px-3 py-1 rounded-full">
                v{rxQuery.data.currentVersion}.0
              </span>
            )}
          </div>

          {rxQuery.data ? (
            <div className="space-y-4 text-xs">
              <div>
                <span className="text-slate-400 block">Diagnosis:</span>
                <p className="font-bold text-sm">{rxQuery.data.diagnosis}</p>
              </div>
              <div className="space-y-2">
                <span className="text-slate-400 block">Medicines:</span>
                {(rxQuery.data.medicines || []).map((med: any, idx: number) => (
                  <div key={idx} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 flex justify-between">
                    <span className="font-semibold">
                      {med.name} ({med.dosage})
                    </span>
                    <span>
                      {med.frequency} × {med.durationDays} days
                    </span>
                  </div>
                ))}
              </div>
              {rxQuery.data.advice && (
                <div>
                  <span className="text-slate-400 block">Advice:</span>
                  <p>{rxQuery.data.advice}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No prescription issued yet.</p>
          )}

          {isDoctor && (
            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    {rxQuery.data ? 'Append New Prescription Version' : 'Issue Official Digital Prescription'}
                  </h3>
                  <p className="text-slate-400">
                    Each version is cryptographically versioned and appended to the patient&apos;s longitudinal Health Passport.
                  </p>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Primary Clinical Diagnosis *
                </label>
                <input
                  type="text"
                  required
                  value={rxDiagnosis}
                  onChange={(e) => setRxDiagnosis(e.target.value)}
                  placeholder="e.g. Essential Hypertension Grade II / Acute Bronchitis"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              {/* Multi-Medicine List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Prescribed Medications ({rxMedicines.length}) *
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setRxMedicines((prev) => [
                        ...prev,
                        {
                          id: `med-${Date.now()}`,
                          name: '',
                          dosage: '1 Tab',
                          frequency: '1-0-1',
                          durationDays: 5,
                        },
                      ])
                    }
                    className="px-2.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 text-[11px] font-bold flex items-center gap-1 hover:bg-teal-100"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Medicine</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {rxMedicines.map((med, idx) => (
                    <div
                      key={med.id}
                      className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center gap-2"
                    >
                      <span className="text-[10px] font-bold text-slate-400 w-5">{idx + 1}.</span>
                      <input
                        type="text"
                        value={med.name}
                        onChange={(e) => {
                          const updated = [...rxMedicines];
                          updated[idx].name = e.target.value;
                          setRxMedicines(updated);
                        }}
                        placeholder="Drug / Brand Name (e.g. Telmisartan)"
                        className="flex-1 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                      />
                      <input
                        type="text"
                        value={med.dosage}
                        onChange={(e) => {
                          const updated = [...rxMedicines];
                          updated[idx].dosage = e.target.value;
                          setRxMedicines(updated);
                        }}
                        placeholder="Dosage (e.g. 40mg)"
                        className="w-24 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                      />
                      <input
                        type="text"
                        value={med.frequency}
                        onChange={(e) => {
                          const updated = [...rxMedicines];
                          updated[idx].frequency = e.target.value;
                          setRxMedicines(updated);
                        }}
                        placeholder="Freq (e.g. 1-0-0)"
                        className="w-28 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          value={med.durationDays}
                          onChange={(e) => {
                            const updated = [...rxMedicines];
                            updated[idx].durationDays = Number(e.target.value);
                            setRxMedicines(updated);
                          }}
                          placeholder="Days"
                          className="w-16 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                        />
                        <span className="text-[10px] text-slate-400">d</span>
                      </div>
                      {rxMedicines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setRxMedicines(rxMedicines.filter((_, i) => i !== idx))}
                          className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg transition-colors"
                          title="Remove medicine"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  General Directions &amp; Clinical Advice
                </label>
                <textarea
                  rows={2}
                  value={rxAdvice}
                  onChange={(e) => setRxAdvice(e.target.value)}
                  placeholder="e.g. Low sodium diet, hydrate well, follow up in 14 days with repeat BP record"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-slate-400">
                  {rxDiagnosis.trim().length < 3 ? '⚠️ Enter diagnosis (min 3 chars)' : '✓ Validated and ready to issue'}
                </span>
                <button
                  type="button"
                  disabled={saveRxMutation.isPending || rxDiagnosis.trim().length < 3 || rxMedicines.every((m) => !m.name.trim())}
                  onClick={() => saveRxMutation.mutate()}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-colors"
                >
                  {saveRxMutation.isPending ? 'Signing Rx...' : 'Sign & Issue Digital Rx'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'vitals' && (
        <VitalsLabsPanel appointmentId={appointmentId} isDoctor={isDoctor} />
      )}

      {activeTab === 'copilot' && isDoctor && (
        <div className="max-w-3xl mx-auto p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-6 h-6 text-teal-600" />
              <h2 className="text-lg font-bold">AI Clinical Note Copilot (Draft)</h2>
            </div>
            <button
              type="button"
              disabled={copilotMutation.isPending}
              onClick={() => copilotMutation.mutate()}
              className="px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold"
            >
              {copilotMutation.isPending ? 'Drafting...' : 'Generate SOAP Draft from Chat'}
            </button>
          </div>
          {copilotNote && (
            <div className="space-y-3 text-xs">
              {(['subjective', 'objective', 'assessment', 'plan'] as const).map((k) => (
                <div key={k} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <span className="font-bold uppercase text-teal-600 text-[10px]">{k}</span>
                  <p className="mt-1">{copilotNote[k]}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Red Confirmation Modal: End Consultation */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 p-6 border border-rose-200 dark:border-rose-900 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/80 text-rose-600 flex items-center justify-center mx-auto">
              <PhoneOff className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                End Consultation Session?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isDoctor
                  ? 'This will finalize the appointment, conclude active video & chat, and archive the medical consultation session.'
                  : 'Are you sure you want to leave the active consultation room?'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowEndModal(false)}
                className="py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updateStatusMutation.isPending}
                onClick={() => {
                  if (isDoctor) {
                    updateStatusMutation.mutate('ENDED');
                  } else {
                    roomRef.current?.disconnect();
                    setActiveTab('prescription');
                  }
                  setShowEndModal(false);
                }}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md disabled:opacity-50"
              >
                {updateStatusMutation.isPending ? 'Ending...' : 'End Consultation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
