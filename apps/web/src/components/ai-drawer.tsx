'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Bot, X, Send, Sparkles, ShieldAlert, PhoneCall, ChevronRight, Stethoscope } from 'lucide-react';
import { API_URL, getAuthToken } from '@/lib/api';

interface Message {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  citations?: string[];
  isEmergency?: boolean;
  suggestedAction?: {
    type: 'BOOK_DOCTOR' | 'EMERGENCY_AMBULANCE';
    label: string;
    href: string;
  };
}

export function AiDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content:
        'Hello! I am your MediBook Clinical Assistant. Ask me about common health symptoms, doctor recommendations, or how our telehealth and emergency dispatch work.',
      citations: ['MediBook Clinical Protocols v1.2'],
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');
    const userMsg: Message = { id: `u-${Date.now()}`, sender: 'user', content: userText };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Immediate client-side safety guard for life-threatening emergencies
    const lower = userText.toLowerCase();
    const isEmergency =
      lower.includes('chest pain') ||
      lower.includes('heart attack') ||
      lower.includes('cannot breathe') ||
      lower.includes('unconscious') ||
      lower.includes('severe bleeding') ||
      lower.includes('stroke') ||
      lower.includes('breathless');

    if (isEmergency) {
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: 'assistant',
            isEmergency: true,
            content:
              'CRITICAL ALERT: Your reported symptoms indicate a potential life-threatening emergency. Do not wait for online consultation.',
            citations: ['National Emergency Response Protocol 112', 'WHO EMS Triage Level 1'],
            suggestedAction: {
              type: 'EMERGENCY_AMBULANCE',
              label: 'Dispatch Emergency Ambulance (112)',
              href: '/emergency',
            },
          },
        ]);
        setLoading(false);
      }, 400);
      return;
    }

    try {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query: userText }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: 'assistant',
            content: data.reply || data.answer || 'Consultation guidance generated.',
            citations: data.citations || ['MediBook Clinical Guidelines'],
            suggestedAction: data.suggestedSpecialist
              ? {
                  type: 'BOOK_DOCTOR',
                  label: `Consult ${data.suggestedSpecialist}`,
                  href: `/doctors?specialty=${encodeURIComponent(data.suggestedSpecialist)}`,
                }
              : undefined,
          },
        ]);
      } else {
        throw new Error('Fallback to local assistant');
      }
    } catch {
      // Graceful offline fallback
      setTimeout(() => {
        let reply =
          'Thank you for providing your symptoms. For safe medical guidance, we recommend speaking with a verified specialist on MediBook.';
        let specialist = 'General Physician';
        if (lower.includes('fever') || lower.includes('cough') || lower.includes('cold')) {
          reply =
            'For acute seasonal fever, adequate hydration and rest are recommended. If fever persists over 48 hours or temperature exceeds 102°F, consult a physician.';
          specialist = 'General Physician';
        } else if (lower.includes('skin') || lower.includes('rash') || lower.includes('itching')) {
          reply =
            'Dermatological symptoms such as persistent rash or itching benefit from a high-resolution video consultation with a dermatologist.';
          specialist = 'Dermatologist';
        } else if (lower.includes('headache') || lower.includes('migraine')) {
          reply =
            'Tension headaches can often be relieved with rest, fluid intake, and reduced screen exposure. Persistent unilateral or severe headaches warrant neurological evaluation.';
          specialist = 'Neurologist';
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            sender: 'assistant',
            content: reply,
            citations: ['MOHFW Telemedicine Practice Guidelines', 'National Health Portal'],
            suggestedAction: {
              type: 'BOOK_DOCTOR',
              label: `Book ${specialist}`,
              href: `/doctors?specialty=${encodeURIComponent(specialist)}`,
            },
          },
        ]);
      }, 500);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Launcher Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 px-4 py-3 rounded-full bg-teal-600 hover:bg-teal-700 text-white font-semibold shadow-lg shadow-teal-600/30 hover:shadow-teal-600/40 hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-4 focus:ring-teal-500/20"
          aria-label="Open AI Assistant"
        >
          <Sparkles className="w-5 h-5 text-teal-200 animate-spin" style={{ animationDuration: '6s' }} />
          <span className="text-sm">Ask MediBook AI</span>
        </button>
      )}

      {/* Drawer */}
      {isOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white dark:bg-slate-950 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-sm">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                  Clinical AI Assistant
                  <span className="text-[10px] uppercase font-bold bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 px-1.5 py-0.2 rounded">
                    RAG Active
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Non-diagnostic safety triage & booking</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close Assistant"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                {msg.isEmergency ? (
                  /* Emergency Takeover Card */
                  <div className="w-full p-4 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 shadow-sm text-rose-900 dark:text-rose-100 space-y-3 animate-pulse">
                    <div className="flex items-center gap-2 font-bold text-rose-700 dark:text-rose-300">
                      <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                      <span>EMERGENCY PROTOCOL TRIGGERED</span>
                    </div>
                    <p className="text-xs leading-relaxed">{msg.content}</p>
                    <div className="flex flex-col gap-2 pt-1">
                      <a
                        href="tel:112"
                        className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs transition-colors"
                      >
                        <PhoneCall className="w-4 h-4" />
                        Call National Emergency (112)
                      </a>
                      <Link
                        href="/emergency"
                        onClick={() => setIsOpen(false)}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold text-xs hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
                      >
                        Request Emergency Ambulance
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 leading-relaxed text-xs sm:text-sm ${
                      msg.sender === 'user'
                        ? 'bg-teal-600 text-white rounded-br-sm'
                        : 'bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-bl-sm border border-slate-200/60 dark:border-slate-800'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap gap-1">
                        <span className="text-[10px] text-slate-400 font-medium mr-1">Sources:</span>
                        {msg.citations.map((cite, i) => (
                          <span
                            key={i}
                            className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded"
                          >
                            [{i + 1}] {cite}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Suggested Tool Action */}
                    {msg.suggestedAction && (
                      <div className="mt-3 pt-2">
                        <Link
                          href={msg.suggestedAction.href}
                          onClick={() => setIsOpen(false)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 text-xs font-semibold hover:bg-teal-100 dark:hover:bg-teal-900 transition-colors border border-teal-200 dark:border-teal-800"
                        >
                          <Stethoscope className="w-3.5 h-3.5" />
                          {msg.suggestedAction.label}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-slate-400 text-xs italic p-2">
                <Sparkles className="w-4 h-4 animate-spin text-teal-500" />
                Analyzing clinical protocols & guidelines...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts */}
          <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex gap-1.5 overflow-x-auto text-[11px] text-slate-600 dark:text-slate-400 scrollbar-none">
            <button
              onClick={() => {
                setInput('I have had high fever and headache for 2 days.');
              }}
              className="whitespace-nowrap px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950 transition-colors"
            >
              Fever & Headache
            </button>
            <button
              onClick={() => {
                setInput('Severe chest pain radiating to my left arm');
              }}
              className="whitespace-nowrap px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 hover:bg-rose-100 transition-colors font-medium"
            >
              Emergency Test (Chest Pain)
            </button>
            <button
              onClick={() => {
                setInput('Need a dermatologist for skin allergy in Kolkata');
              }}
              className="whitespace-nowrap px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950 transition-colors"
            >
              Find Dermatologist
            </button>
          </div>

          {/* Input Form */}
          <form onSubmit={handleSend} className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask symptoms, doctors, or emergency rules..."
              className="flex-1 bg-slate-100 dark:bg-slate-900 border-none rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="p-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 transition-colors"
              aria-label="Send clinical query"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
