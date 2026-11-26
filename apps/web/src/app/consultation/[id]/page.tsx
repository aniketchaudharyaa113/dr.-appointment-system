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
} from 'lucide-react';
import { fetchApi, formatIstTime, getAuthToken, getCurrentUser } from '@/lib/api';
import { VitalsLabsPanel } from '@/components/clinical/vitals-labs-panel';

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

  const currentUser = typeof window !== 'undefined' ? getCurrentUser() : null;
  const isDoctor = currentUser?.role === 'DOCTOR';

  const [hasConsented, setHasConsented] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [livekitStatus, setLivekitStatus] = useState<string>('Disconnected');
  const [livekitError, setLivekitError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'video' | 'vitals' | 'prescription' | 'copilot'>(
    initialTab === 'prescription' ? 'prescription' : initialTab === 'vitals' ? 'vitals' : 'video',
  );

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Prescription form for doctors
  const [rxDiagnosis, setRxDiagnosis] = useState('');
  const [rxAdvice, setRxAdvice] = useState('');
  const [rxMedName, setRxMedName] = useState('');
  const [rxMedDosage, setRxMedDosage] = useState('40mg');
  const [rxMedFreq, setRxMedFreq] = useState('Once Daily');
  const [rxMedDays, setRxMedDays] = useState(14);
  const [copilotNote, setCopilotNote] = useState<any>(null);

  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef<Room | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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
    queryFn: () => fetchApi(`/consultations/${appointmentId}/prescriptions`),
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

  // Connect Socket.IO /consultation namespace with JWT
  useEffect(() => {
    const token = getAuthToken();
    if (!token || !appointmentId) return;

    const socketOrigin =
      typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SOCKET_URL
        ? process.env.NEXT_PUBLIC_SOCKET_URL
        : undefined;

    const sock = io(socketOrigin ? `${socketOrigin}/consultation` : '/consultation', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = sock;

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
        setIsTyping(evt.isTyping);
      }
    });

    return () => {
      sock.disconnect();
      socketRef.current = null;
    };
  }, [appointmentId, currentUser?.id]);

  // Connect LiveKit room once consented
  useEffect(() => {
    if (!hasConsented || !appointmentId || !currentUser?.token) return;
    let cancelled = false;

    const connectLiveKit = async () => {
      try {
        setLivekitError(null);
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
          }
        });

        room.on(RoomEvent.Disconnected, () => {
          setLivekitStatus('Disconnected');
        });

        await room.connect(tokenData.livekitUrl, tokenData.token);
        setLivekitStatus(`Connected (${tokenData.roomName})`);

        try {
          const tracks = await createLocalTracks({
            audio: isMicOn,
            video: isCameraOn,
          });
          for (const t of tracks) {
            await room.localParticipant.publishTrack(t);
            if (t.kind === Track.Kind.Video && localVideoRef.current) {
              t.attach(localVideoRef.current);
            }
          }
        } catch {
          // Graceful fallback when running in headless browser / without camera
        }
      } catch (err: any) {
        if (!cancelled) {
          setLivekitStatus('Waiting / Outside Join Window');
          setLivekitError(err.message);
        }
      }
    };

    connectLiveKit();

    return () => {
      cancelled = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [hasConsented, appointmentId, currentUser?.token]);

  const consentMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/consultations/${appointmentId}/consent`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      setHasConsented(true);
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
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
      }
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
    onSuccess: (data) => setCopilotNote(data.soap_note),
  });

  const saveRxMutation = useMutation({
    mutationFn: () => {
      const method = rxQuery.data ? 'PUT' : 'POST';
      return fetchApi(`/consultations/${appointmentId}/prescriptions`, {
        method,
        body: JSON.stringify({
          diagnosis: rxDiagnosis,
          advice: rxAdvice,
          medicines: rxMedName
            ? [
                {
                  name: rxMedName,
                  dosage: rxMedDosage,
                  frequency: rxMedFreq,
                  durationDays: Number(rxMedDays),
                },
              ]
            : [],
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultation-prescription', appointmentId] });
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
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

        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('video')}
            className={`px-3 py-1.5 rounded-lg ${activeTab === 'video' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-xs' : 'text-slate-500'}`}
          >
            Video &amp; Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('vitals')}
            className={`px-3 py-1.5 rounded-lg ${activeTab === 'vitals' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-xs' : 'text-slate-500'}`}
          >
            Vitals &amp; Labs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('prescription')}
            className={`px-3 py-1.5 rounded-lg ${activeTab === 'prescription' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-xs' : 'text-slate-500'}`}
          >
            Digital Prescription
          </button>
          {isDoctor && (
            <button
              type="button"
              onClick={() => setActiveTab('copilot')}
              className={`px-3 py-1.5 rounded-lg ${activeTab === 'copilot' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-xs' : 'text-slate-500'}`}
            >
              AI Clinical Note
            </button>
          )}
        </div>
      </div>

      {activeTab === 'video' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[640px]">
          <div className="lg:col-span-2 bg-slate-900 rounded-3xl overflow-hidden relative flex flex-col justify-between p-4 shadow-xl border border-slate-800">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="relative z-10 flex items-center justify-between text-white text-xs">
              <span className="bg-black/50 px-3 py-1 rounded-full">{livekitStatus}</span>
              {livekitError && (
                <span className="bg-amber-900/80 text-amber-200 px-3 py-1 rounded-full text-[11px]">
                  {livekitError}
                </span>
              )}
            </div>

            <div className="relative z-10 flex flex-col items-center justify-center text-white pointer-events-none">
              <div className="w-24 h-24 rounded-full bg-slate-800/80 border-2 border-teal-500/40 flex items-center justify-center text-2xl font-bold">
                {(appt?.doctorName || 'MD').replace(/^Dr\.\s*/i, '').slice(0, 2).toUpperCase()}
              </div>
              <p className="mt-2 font-bold text-sm">{appt?.doctorName || 'Attending Physician'}</p>
              <p className="text-xs text-teal-400">{appt?.specialty || 'Telehealth'}</p>
            </div>

            <div className="absolute bottom-20 right-6 w-36 h-28 rounded-2xl bg-slate-800 border-2 border-slate-700 overflow-hidden shadow-lg flex items-center justify-center text-white text-xs z-10">
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              {!isCameraOn && (
                <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-slate-400 text-[10px]">
                  <VideoOff className="w-5 h-5 mb-1" /> Camera Off
                </div>
              )}
            </div>

            <div className="z-10 flex flex-wrap items-center justify-center gap-3 bg-slate-950/80 backdrop-blur-md max-w-lg mx-auto py-2.5 px-6 rounded-2xl border border-slate-800">
              {isDoctor && appt?.status === 'CONFIRMED' && (
                <button
                  type="button"
                  disabled={updateStatusMutation.isPending}
                  onClick={() => updateStatusMutation.mutate('LIVE')}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
                >
                  Start Consultation
                </button>
              )}
              {isDoctor && (appt?.status === 'IN_PROGRESS' || appt?.consultation?.status === 'LIVE') && (
                <button
                  type="button"
                  disabled={updateStatusMutation.isPending}
                  onClick={() => {
                    if (window.confirm('Are you sure you want to end and complete this consultation?')) {
                      updateStatusMutation.mutate('ENDED');
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
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
                onClick={() => {
                  if (isDoctor) {
                    if (window.confirm('End and complete consultation session?')) {
                      updateStatusMutation.mutate('ENDED');
                    }
                  } else {
                    if (window.confirm('Leave consultation room?')) {
                      roomRef.current?.disconnect();
                      setActiveTab('prescription');
                    }
                  }
                }}
                className="p-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white"
                title={isDoctor ? 'End & Complete Consultation' : 'Leave Consultation'}
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Real-Time Socket.IO Chat */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Encrypted Consultation Chat
                </h3>
                <p className="text-[11px] text-slate-400">Persisted in PostgreSQL + 7d follow-up</p>
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
                          ? 'bg-teal-600 text-white rounded-br-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-bl-xs'
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
                      <span>{formatIstTime(m.createdAt)}</span>
                      {isMine && <CheckCheck className="w-3 h-3 text-teal-600" />}
                    </div>
                  </div>
                );
              })}
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
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <h3 className="font-bold">Issue / Append Version</h3>
              <input
                type="text"
                value={rxDiagnosis}
                onChange={(e) => setRxDiagnosis(e.target.value)}
                placeholder="Diagnosis"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="text"
                  value={rxMedName}
                  onChange={(e) => setRxMedName(e.target.value)}
                  placeholder="Medicine"
                  className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
                <input
                  type="text"
                  value={rxMedDosage}
                  onChange={(e) => setRxMedDosage(e.target.value)}
                  placeholder="Dosage"
                  className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
                <input
                  type="text"
                  value={rxMedFreq}
                  onChange={(e) => setRxMedFreq(e.target.value)}
                  placeholder="Frequency"
                  className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
                <input
                  type="number"
                  value={rxMedDays}
                  onChange={(e) => setRxMedDays(Number(e.target.value))}
                  placeholder="Days"
                  className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>
              <input
                type="text"
                value={rxAdvice}
                onChange={(e) => setRxAdvice(e.target.value)}
                placeholder="Clinical advice"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
              <button
                type="button"
                disabled={saveRxMutation.isPending || rxDiagnosis.length < 3}
                onClick={() => saveRxMutation.mutate()}
                className="px-4 py-2 rounded-xl bg-teal-600 text-white font-bold"
              >
                {saveRxMutation.isPending ? 'Saving...' : 'Save Immutable Rx Version'}
              </button>
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
    </div>
  );
}
