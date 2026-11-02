'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Paperclip,
  CheckCheck,
  FileText,
  ShieldCheck,
  Bot,
  Download,
  User,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'doctor' | 'patient';
  text: string;
  timestamp: string;
  attachmentUrl?: string;
  attachmentName?: string;
}

export default function ConsultationRoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const appointmentId = (params?.id as string) || 'apt-test-1';
  const initialTab = searchParams.get('tab') || 'video';

  const [hasConsented, setHasConsented] = useState(false);
  const [consentDate, setConsentDate] = useState<string | null>(null);

  // Audio/Video controls
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [, setCallActive] = useState(false);
  const [activeTab, setActiveTab] = useState<'video' | 'prescription' | 'copilot'>(
    initialTab === 'prescription' ? 'prescription' : 'video'
  );

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-1',
      sender: 'doctor',
      text: 'Good evening! I am reviewing your symptom history. How long have you felt this discomfort?',
      timestamp: '05:31 PM',
    },
    {
      id: 'm-2',
      sender: 'patient',
      text: 'Hi Doctor. It started two days ago after dinner, feeling a mild heaviness.',
      timestamp: '05:32 PM',
    },
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleConsent = () => {
    setHasConsented(true);
    setConsentDate(new Date().toISOString());
    setCallActive(true);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim()) return;

    const newMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      sender: 'patient',
      text: inputMsg.trim(),
      timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputMsg('');

    // Simulate doctor typing indicator
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `m-doc-${Date.now()}`,
          sender: 'doctor',
          text: 'Understood. Please keep breathing calmly. I will check your heart rate and record this in your clinical note.',
          timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }, 1800);
  };

  const handleSimulateAttachment = () => {
    const attachMsg: ChatMessage = {
      id: `m-att-${Date.now()}`,
      sender: 'patient',
      text: 'Uploaded recent blood lipid panel report for reference.',
      timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      attachmentUrl: '#',
      attachmentName: 'Lipid_Panel_Report_Oct2026.pdf',
    };
    setMessages((prev) => [...prev, attachMsg]);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Telehealth Legal Consent Modal */}
      {!hasConsented && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-6 animate-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">Telemedicine Informed Consent</h3>
                <p className="text-xs text-slate-500">India Telemedicine Practice Guidelines 2020 Compliance</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300 leading-relaxed space-y-2">
              <p>
                By joining this remote consultation, you confirm that you are physically located in India and give consent for teleconsultation with Dr. Arindam Mukherjee (NMC WBMC/64921).
              </p>
              <p>
                Remote consultations are not suitable for emergency trauma, acute stroke, or severe respiratory failure. If in distress, immediately dial 112.
              </p>
            </div>

            {/* Device preview */}
            <div className="flex items-center justify-center gap-4 py-2">
              <button
                type="button"
                onClick={() => setIsCameraOn(!isCameraOn)}
                className={`p-3 rounded-full ${isCameraOn ? 'bg-teal-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600'}`}
              >
                {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => setIsMicOn(!isMicOn)}
                className={`p-3 rounded-full ${isMicOn ? 'bg-teal-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600'}`}
              >
                {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>
            </div>

            <button
              onClick={handleConsent}
              className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-md transition-colors"
            >
              I Consent & Join Consultation Room
            </button>
          </div>
        </div>
      )}

      {/* Main Consultation Room View */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              Consultation Room with Dr. Arindam Mukherjee
            </h1>
            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              LiveKit Encrypted
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Appointment ID: {appointmentId} • Telemedicine Consent logged: {consentDate ? 'Verified' : 'Pending'}
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab('video')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${activeTab === 'video' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Video & Chat
          </button>
          <button
            onClick={() => setActiveTab('prescription')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${activeTab === 'prescription' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Digital Prescription
          </button>
          <button
            onClick={() => setActiveTab('copilot')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${activeTab === 'copilot' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            AI Clinical Note
          </button>
        </div>
      </div>

      {activeTab === 'video' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[640px]">
          {/* Video Container (Left 2 cols) */}
          <div className="lg:col-span-2 bg-slate-900 rounded-3xl overflow-hidden relative flex flex-col justify-between p-4 shadow-xl border border-slate-800">
            {/* Top Bar inside video */}
            <div className="flex items-center justify-between text-white text-xs z-10">
              <span className="bg-black/40 backdrop-blur-md px-3 py-1 rounded-full font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                Live: 14:22
              </span>
              <span className="bg-black/40 backdrop-blur-md px-3 py-1 rounded-full font-medium">
                HD 1080p • 60 FPS
              </span>
            </div>

            {/* Doctor Main Video Feed (Simulated) */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white space-y-3">
              <div className="w-28 h-28 rounded-full bg-slate-800 border-4 border-teal-500/40 flex items-center justify-center text-3xl font-bold">
                AM
              </div>
              <div className="text-center">
                <p className="font-bold text-base">Dr. Arindam Mukherjee</p>
                <p className="text-xs text-teal-400 font-medium">Senior Consultant Cardiologist</p>
              </div>
            </div>

            {/* Patient Self Video PiP */}
            <div className="absolute bottom-20 right-6 w-36 h-28 rounded-2xl bg-slate-800 border-2 border-slate-700 overflow-hidden shadow-lg flex items-center justify-center text-white text-xs z-10">
              {isCameraOn ? (
                <div className="w-full h-full bg-slate-700/60 flex flex-col items-center justify-center">
                  <User className="w-8 h-8 opacity-60" />
                  <span className="text-[10px] opacity-75 mt-1">You</span>
                </div>
              ) : (
                <div className="text-slate-400 text-[10px] flex flex-col items-center">
                  <VideoOff className="w-5 h-5 mb-1" /> Camera Off
                </div>
              )}
            </div>

            {/* Video Controls Bar */}
            <div className="z-10 flex items-center justify-center gap-3 bg-slate-950/80 backdrop-blur-md max-w-md mx-auto py-2.5 px-6 rounded-2xl border border-slate-800">
              <button
                onClick={() => setIsMicOn(!isMicOn)}
                className={`p-3 rounded-full transition-colors ${isMicOn ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-rose-600 text-white'}`}
                title={isMicOn ? 'Mute Mic' : 'Unmute Mic'}
              >
                {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              <button
                onClick={() => setIsCameraOn(!isCameraOn)}
                className={`p-3 rounded-full transition-colors ${isCameraOn ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-rose-600 text-white'}`}
                title={isCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
              >
                {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>

              <button
                onClick={() => {
                  setCallActive(false);
                  setActiveTab('prescription');
                }}
                className="p-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white transition-colors"
                title="End Call & Issue Prescription"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Real-Time Consultation Chat (Right col) */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Encrypted Consultation Chat</h3>
                <p className="text-[11px] text-slate-400">Available during call + 7 days follow-up</p>
              </div>
              <button
                onClick={handleSimulateAttachment}
                className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-slate-800 transition-colors"
                title="Attach medical report (MinIO signed URL)"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.sender === 'patient' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                      m.sender === 'patient'
                        ? 'bg-teal-600 text-white rounded-br-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-bl-xs'
                    }`}
                  >
                    <p>{m.text}</p>
                    {m.attachmentName && (
                      <div className="mt-2 p-2 rounded-lg bg-black/20 text-[11px] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        <span className="truncate">{m.attachmentName}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1">
                    <span>{m.timestamp}</span>
                    {m.sender === 'patient' && <CheckCheck className="w-3 h-3 text-teal-600" />}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="text-[11px] text-slate-400 italic flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-bounce" />
                  Dr. Mukherjee is typing...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <input
                type="text"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="Type query or report details..."
                className="flex-1 bg-slate-100 dark:bg-slate-800 border-none rounded-xl px-3.5 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                type="submit"
                disabled={!inputMsg.trim()}
                className="p-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Prescription Tab */}
      {activeTab === 'prescription' && (
        <div className="max-w-3xl mx-auto p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6">
          <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 pb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Official Telehealth Prescription</h2>
              <p className="text-xs text-slate-500 mt-1">
                Issued by Dr. Arindam Mukherjee, MBBS, MD, DM • Reg: WBMC/64921
              </p>
            </div>
            <span className="text-xs font-mono font-bold bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300 px-3 py-1 rounded-full">
              Version: 1.0 (Immutable)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs text-slate-600 dark:text-slate-400">
            <div>
              <span className="text-slate-400 block">Patient Name:</span>
              <span className="font-semibold text-slate-900 dark:text-white text-sm">Aniket Chaudhary (28/M)</span>
            </div>
            <div>
              <span className="text-slate-400 block">Date of Consultation:</span>
              <span className="font-semibold text-slate-900 dark:text-white text-sm">02 Nov 2026, 05:45 PM IST</span>
            </div>
            <div>
              <span className="text-slate-400 block">Clinical Diagnosis:</span>
              <span className="font-semibold text-slate-900 dark:text-white">Stage-1 Essential Hypertension / Stress Discomfort</span>
            </div>
            <div>
              <span className="text-slate-400 block">Consultation ID:</span>
              <span className="font-mono font-semibold">{appointmentId}</span>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <h4 className="font-bold text-sm text-slate-900 dark:text-white">Prescribed Medications (Rx)</h4>
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-2 text-xs">
              <div className="flex justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>1. Tab. Telmisartan 40mg</span>
                <span>1 Tab - Once Daily (Morning after food) x 30 Days</span>
              </div>
              <div className="flex justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>2. Tab. Rosuvastatin 10mg</span>
                <span>1 Tab - Once Daily (Night after food) x 30 Days</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-500">
            <h4 className="font-bold text-slate-700 dark:text-slate-300">Clinical Advice & Follow-Up</h4>
            <p>Maintain sodium intake &lt; 2g/day. Regular 30-min walking. Follow-up video consultation in 3 weeks.</p>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              Digitally signed and cryptographically hashed per IT Act 2000.
            </span>
            <button
              onClick={() => alert('Digital Rx PDF download triggered (generated via NestJS prescription service).')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-md transition-colors"
            >
              <Download className="w-4 h-4" /> Download PDF Prescription
            </button>
          </div>
        </div>
      )}

      {/* AI Clinical Note Copilot Tab */}
      {activeTab === 'copilot' && (
        <div className="max-w-3xl mx-auto p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="w-10 h-10 rounded-2xl bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                AI Clinical Note Copilot
                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 px-2 py-0.5 rounded">
                  Requires Doctor Review
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Summarized from live consultation transcript. AI never writes to medical records automatically.
              </p>
            </div>
          </div>

          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
              <span className="font-bold text-teal-600 uppercase text-[10px]">Subjective</span>
              <p className="text-slate-700 dark:text-slate-300">
                Patient reports 2-day history of mild chest heaviness post-prandial. No radiation to neck or left arm. No diaphoresis or syncope.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
              <span className="font-bold text-teal-600 uppercase text-[10px]">Objective</span>
              <p className="text-slate-700 dark:text-slate-300">
                Reported resting BP: 142/90 mmHg. Heart rate: 76 bpm. Recent lipid panel attached by patient indicates elevated LDL (148 mg/dL).
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
              <span className="font-bold text-teal-600 uppercase text-[10px]">Assessment</span>
              <p className="text-slate-700 dark:text-slate-300">
                Stage 1 Essential Hypertension with mild dyslipidemia. Low short-term cardiovascular risk score.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
              <span className="font-bold text-teal-600 uppercase text-[10px]">Plan</span>
              <p className="text-slate-700 dark:text-slate-300">
                Initiate Telmisartan 40mg + Rosuvastatin 10mg. Dietary salt reduction. Review in 3 weeks via video.
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <button
              onClick={() => alert('Clinical draft approved and committed to electronic health record with doctor signature.')}
              className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-md transition-colors"
            >
              Doctor Approve & Commit Note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
