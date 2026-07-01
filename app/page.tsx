'use client';

import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Radar, Plane, BedDouble, Bus, Compass, Coins, Sparkles,
  CheckCircle2, Clock, X, AlertTriangle, RefreshCw,
} from 'lucide-react';
// npm install lucide-react

interface Flight {
  airline?: string;
  price?: number;
  average_price?: number;
  discount_percentage?: number;
  departure_airport_code?: string;
  arrival_airport_code?: string;
  thumbnail?: string;
  description?: string;
  highlights?: string;
  flight_link?: string;
}

interface HotelImage {
  thumbnail: string;
  original_image?: string;
}

interface RateInfo {
  lowest?: string;
  extracted_lowest?: number;
  before_taxes_fees?: string;
  extracted_before_taxes_fees?: number;
}

interface Hotel {
  name?: string;
  deal?: string;
  deal_description?: string;
  images?: HotelImage[];
  overall_rating?: number;
  reviews?: number;
  rate_per_night?: RateInfo;
  total_rate?: RateInfo;
  amenities?: string[];
  link?: string;
}

interface TravelDeal {
  destination: string;
  country: string;
  start_date: string;
  end_date: string;
  flight: Flight;
  hotel: Hotel;
  transport_summary: string;
  activity_summary: string;
  currency_summary: string;
  final_itinerary: string;
  created_at: string; // ISO timestamp
  travelers?: number;
  exchange_rates?: Record<string, number>;
}

// --- Pricing helpers ---------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', SEK: 'kr', EUR: '€', GBP: '£' };

function formatPrice(n: number, currency: string, rates: Record<string, number>): string {
  const rate = rates[currency] || 1;
  const converted = n * rate;
  const symbol = CURRENCY_SYMBOLS[currency] || '$';
  
  if (currency === 'SEK') {
    return `${Math.round(converted).toLocaleString()} ${symbol}`;
  }
  return `${symbol}${Math.round(converted).toLocaleString()}`;
}

function parseDealPercent(deal?: string): number | null {
  if (!deal) return null;
  const match = deal.match(/(\d+)\s*%/);
  return match ? parseInt(match[1], 10) : null;
}

function nightsBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) return null;
  return Math.round((e - s) / (1000 * 60 * 60 * 24));
}

function getDealEconomics(deal: TravelDeal) {
  const flightCurrent = deal.flight?.price ?? null;
  const flightOriginal = deal.flight?.average_price ?? null;

  const hotelTotalCurrent = deal.hotel?.total_rate?.extracted_lowest ?? null;
  const hotelPct = parseDealPercent(deal.hotel?.deal);
  const hotelTotalOriginal =
    hotelTotalCurrent != null && hotelPct != null && hotelPct > 0 && hotelPct < 100
      ? hotelTotalCurrent / (1 - hotelPct / 100)
      : null;

  const nights = nightsBetween(deal.start_date, deal.end_date);

  const haveAny = flightCurrent != null || hotelTotalCurrent != null;
  const totalCurrent = haveAny ? (flightCurrent ?? 0) + (hotelTotalCurrent ?? 0) : null;
  const totalOriginal = haveAny
    ? (flightOriginal ?? flightCurrent ?? 0) + (hotelTotalOriginal ?? hotelTotalCurrent ?? 0)
    : null;
  const totalSavings =
    totalCurrent != null && totalOriginal != null && totalOriginal > totalCurrent
      ? totalOriginal - totalCurrent
      : null;
  const totalSavingsPercent =
    totalSavings != null && totalOriginal ? Math.round((totalSavings / totalOriginal) * 100) : null;

  return {
    flightCurrent,
    flightOriginal,
    hotelTotalCurrent,
    hotelTotalOriginal,
    hotelPct,
    nights,
    totalCurrent,
    totalOriginal,
    totalSavings,
    totalSavingsPercent,
    hasSavings: totalSavings != null && totalSavings > 0,
  };
}

// --- UI components -------------------------------------------------------

function StarRating({ rating }: { rating?: number }) {
  if (!rating) return null;
  const filled = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} width="11" height="11" viewBox="0 0 20 20" fill={i < filled ? '#059669' : '#E5E7EB'}>
          <path d="M10 1l2.6 5.6 6.2.6-4.6 4.2 1.3 6.1L10 14.8 4.5 17.5l1.3-6.1L1.2 7.2l6.2-.6L10 1z" />
        </svg>
      ))}
    </span>
  );
}

function PriceLine({
  label,
  current,
  original,
  currency,
  rates,
  emphasize = false,
}: {
  label: string;
  current: number | null;
  original: number | null;
  currency: string;
  rates: Record<string, number>;
  emphasize?: boolean;
}) {
  const showOriginal = original != null && current != null && original > current;
  return (
    <div className="flex items-baseline justify-between">
      <span className={emphasize ? 'font-semibold text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className={emphasize ? 'font-semibold text-gray-900 text-base' : 'font-medium text-gray-900'}>
          {current != null ? formatPrice(current, currency, rates) : '—'}
        </span>
        {showOriginal && <span className="text-xs text-gray-400 line-through">{formatPrice(original!, currency, rates)}</span>}
      </span>
    </div>
  );
}

function FormattedText({ text }: { text: string }) {
  if (!text) return null;

  const renderInline = (line: string): ReactNode => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1.5 my-2">
        {listBuffer.map((item, i) => (
          <li key={i} className="text-gray-600">{renderInline(item)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, idx) => {
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    const numberedMatch = line.match(/^\d+\.\s+(.*)/);
    const headerMatch = line.match(/^(#{1,3})\s+(.*)/);

    if (headerMatch) {
      flushList();
      const content = headerMatch[2];
      blocks.push(
        <h3 key={`h-${idx}`} className="font-semibold text-emerald-950 text-sm mt-5 mb-2">
          {renderInline(content)}
        </h3>
      );
    } else if (bulletMatch) {
      listBuffer.push(bulletMatch[1]);
    } else if (numberedMatch) {
      listBuffer.push(numberedMatch[1]);
    } else {
      flushList();
      blocks.push(
        <p key={`p-${idx}`} className="text-gray-600 my-1.5">{renderInline(line)}</p>
      );
    }
  });
  flushList();

  return <div>{blocks}</div>;
}

// --- Brand & Pipeline -------------------------------------------------

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative w-9 h-9 flex items-center justify-center rounded-full bg-slate-950 flex-shrink-0">
        <span className="absolute inset-0 rounded-full border border-green-400 opacity-60" />
        <Radar size={17} className="text-green-400" strokeWidth={2.25} />
      </div>
      <span className="text-2xl font-bold tracking-tight">
        <span className="text-slate-900">Trip</span>
        <span className="text-green-600">Hunter</span>
      </span>
    </div>
  );
}

function useNextScan() {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const compute = () => {
      const hours = [9, 12, 15, 18];
      const now = new Date();
      const next = hours.find((h) => h > now.getHours());
      const target = new Date(now);
      if (next === undefined) {
        target.setDate(target.getDate() + 1);
        target.setHours(hours[0], 0, 0, 0);
      } else {
        target.setHours(next, 0, 0, 0);
      }
      setLabel(target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    compute();
    const t = setInterval(compute, 60000);
    return () => clearInterval(t);
  }, []);
  return label;
}

function NextScanPill() {
  const label = useNextScan();
  if (!label) return null;
  return (
    <div className="hidden md:flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-500 shadow-sm">
      <Clock size={12} className="text-green-600" />
      Next scan {label}
    </div>
  );
}

type Phase = 'idle' | 'received' | 'flight' | 'hotel' | 'parallel' | 'synthesize' | 'done' | 'empty' | 'error';
type NodeStatus = 'pending' | 'active' | 'done';

function statusOf(id: string, phase: Phase): NodeStatus {
  const order = ['received', 'flight', 'hotel', 'parallel', 'synthesize'];
  const idx = order.indexOf(id);
  const currentIdx = order.indexOf(phase);
  if (phase === 'idle') return 'pending';
  if (phase === 'done' || phase === 'empty' || phase === 'error') return 'done';
  if (idx < currentIdx) return 'done';
  if (idx === currentIdx) return 'active';
  return 'pending';
}

function Beacon({ icon: Icon, label, status }: { icon: any; label: string; status: NodeStatus }) {
  return (
    <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
      <div className="relative flex items-center justify-center">
        {status === 'active' && (
          <span className="absolute w-[68px] h-[68px] rounded-full border-2 border-dashed border-green-400 th-radar-ring" />
        )}
        {status === 'active' && (
          <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-30" />
        )}
        <div
          className={
            'relative w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors duration-500 ' +
            (status === 'done'
              ? 'bg-emerald-700 border-emerald-600'
              : status === 'active'
              ? 'bg-green-500 border-green-400'
              : 'bg-slate-900 border-slate-700')
          }
        >
          {status === 'done' ? (
            <CheckCircle2 size={19} className="text-emerald-300" strokeWidth={2.5} />
          ) : (
            <Icon size={19} className={status === 'active' ? 'text-slate-950' : 'text-slate-600'} strokeWidth={2} />
          )}
        </div>
      </div>
      <span
        className={
          'text-[11px] font-semibold tracking-wide whitespace-nowrap transition-colors duration-500 ' +
          (status === 'pending' ? 'text-slate-600' : status === 'active' ? 'text-green-400' : 'text-emerald-500')
        }
      >
        {label}
      </span>
    </div>
  );
}

function HConnector({ active }: { active: boolean }) {
  return (
    <div
      className={
        'flex-1 min-w-[20px] h-0.5 mx-1.5 mb-5 rounded-full transition-colors duration-500 ' +
        (active ? 'bg-emerald-600' : 'bg-slate-700')
      }
    />
  );
}

function MiniRow({ icon: Icon, label, status }: { icon: any; label: string; status: NodeStatus }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={
          'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-500 ' +
          (status === 'done' ? 'bg-emerald-700' : status === 'active' ? 'bg-green-500' : 'bg-slate-800')
        }
      >
        {status === 'done' ? (
          <CheckCircle2 size={11} className="text-emerald-300" />
        ) : (
          <Icon size={11} className={status === 'active' ? 'text-slate-950' : 'text-slate-500'} />
        )}
      </div>
      <span
        className={
          'text-[11px] font-medium whitespace-nowrap ' +
          (status === 'pending' ? 'text-slate-600' : status === 'active' ? 'text-green-400' : 'text-emerald-500')
        }
      >
        {label}
      </span>
      {status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />}
    </div>
  );
}

// Updated ParallelBox to simulate a branching horizontal pipeline
function BranchingParallelBox({ transport, activities, currency, activeOverall }: { transport: NodeStatus; activities: NodeStatus; currency: NodeStatus; activeOverall: boolean }) {
  return (
    <div className="flex items-stretch mx-1 py-1 mb-5 flex-shrink-0">
      {/* Left Fork Bracket */}
      <div className={`w-4 border-t-2 border-b-2 border-l-2 rounded-l-xl mt-3 mb-3 transition-colors duration-500 ${activeOverall ? 'border-emerald-600' : 'border-slate-700'}`}></div>
      
      {/* Central Items */}
      <div className="flex flex-col gap-2.5 px-3 py-1 bg-slate-900/40 rounded-md z-10">
        <MiniRow icon={Bus} label="Transport" status={transport} />
        <MiniRow icon={Compass} label="Activities" status={activities} />
        <MiniRow icon={Coins} label="Currency" status={currency} />
      </div>

      {/* Right Fork Bracket */}
      <div className={`w-4 border-t-2 border-b-2 border-r-2 rounded-r-xl mt-3 mb-3 transition-colors duration-500 ${activeOverall ? 'border-emerald-600' : 'border-slate-700'}`}></div>
    </div>
  );
}

function PipelineStrip({
  phase,
  elapsedSec,
  deal,
  currency,
  rates,
  errorMessage,
  subDone,
  onClose,
  onRetry,
}: {
  phase: Phase;
  elapsedSec: number;
  deal: TravelDeal | null;
  currency: string;
  rates: Record<string, number>;
  errorMessage: string | null;
  subDone: { transport: boolean; activities: boolean; currency: boolean };
  onClose: () => void;
  onRetry: () => void;
}) {
  const isSettled = phase === 'done' || phase === 'empty' || phase === 'error';
  const parallelOverall = statusOf('parallel', phase);

  const subStatus = (done: boolean): NodeStatus =>
    parallelOverall === 'pending' ? 'pending' : parallelOverall === 'done' ? 'done' : done ? 'done' : 'active';

  const consoleLine =
    phase === 'received' ? '> request received'
    : phase === 'flight' ? '> scanning global flight deals...'
    : phase === 'hotel' ? '> flight secured — evaluating hotel partners...'
    : phase === 'parallel' ? '> researching transport, activities, and currency data...'
    : phase === 'synthesize' ? '> compiling final itinerary...'
    : '';

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');
  const econ = deal ? getDealEconomics(deal) : null;

  return (
    <div className="max-w-6xl mx-auto mb-8">
      <style>{`
        .th-radar-ring { animation: th-spin 2.6s linear infinite; }
        @keyframes th-spin { to { transform: rotate(360deg); } }
        .th-blink { animation: th-blink-kf 1s step-end infinite; }
        @keyframes th-blink-kf { 50% { opacity: 0; } }
      `}</style>
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Radar size={15} className={isSettled ? 'text-slate-500' : 'text-green-400'} />
            <span className="text-slate-100 font-semibold text-sm">
              {phase === 'done' ? 'Deal found'
                : phase === 'empty' ? 'No deal this round'
                : phase === 'error' ? 'Something went wrong'
                : 'Hunting for your next trip'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-500 text-xs flex items-center gap-1 font-mono">
              <Clock size={11} /> {mm}:{ss}
            </span>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex items-start overflow-x-auto pb-1 hide-scrollbar">
          <Beacon icon={Radar} label="Received" status={statusOf('received', phase)} />
          <HConnector active={statusOf('flight', phase) !== 'pending'} />
          <Beacon icon={Plane} label="Flights" status={statusOf('flight', phase)} />
          <HConnector active={statusOf('hotel', phase) !== 'pending'} />
          <Beacon icon={BedDouble} label="Hotels" status={statusOf('hotel', phase)} />
          
          <HConnector active={parallelOverall !== 'pending'} />
          <BranchingParallelBox
            activeOverall={parallelOverall !== 'pending'}
            transport={subStatus(subDone.transport)}
            activities={subStatus(subDone.activities)}
            currency={subStatus(subDone.currency)}
          />
          <HConnector active={statusOf('synthesize', phase) !== 'pending'} />
          
          <Beacon icon={Sparkles} label="Itinerary" status={statusOf('synthesize', phase)} />
        </div>

        {!isSettled && (
          <div className="bg-black/40 border border-slate-800 rounded-lg px-4 py-2 mt-1">
            <p className="text-green-400 text-xs font-mono">
              {consoleLine}
              <span className="inline-block w-1.5 h-3 bg-green-400 ml-1 align-middle th-blink" />
            </p>
          </div>
        )}

        {phase === 'done' && deal && econ && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 mt-1">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-slate-100 font-semibold truncate">{deal.destination}, {deal.country}</span>
              {econ.totalSavingsPercent != null && (
                <span className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                  -{econ.totalSavingsPercent}%
                </span>
              )}
              {econ.totalCurrent != null && (
                <span className="text-slate-400 text-sm flex-shrink-0">{formatPrice(econ.totalCurrent, currency, rates)}</span>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 bg-green-500 hover:bg-green-400 text-slate-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              View trip
            </button>
          </div>
        )}

        {(phase === 'empty' || phase === 'error') && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 mt-1">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
              <span className="text-slate-300 text-sm truncate">
                {errorMessage || (phase === 'empty' ? 'No eligible flight deal turned up this round.' : 'Could not reach the agents.')}
              </span>
            </div>
            <button
              onClick={onRetry}
              className="flex-shrink-0 flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


export default function Home() {
  const [deals, setDeals] = useState<TravelDeal[]>([]);
  const [selectedDeal, setSelectedDeal] = useState<TravelDeal | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'daily_plan' | 'guide'>('overview');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [showTriggerForm, setShowTriggerForm] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [triggerParams, setTriggerParams] = useState({
    departureId: 'CPH',
    travelers: 2,
    duration: '2',
    homeCurrency: 'SEK',
  });

  // --- Pipeline state ---
  const [pipelinePhase, setPipelinePhase] = useState<Phase>('idle');
  const [pipelineDeal, setPipelineDeal] = useState<TravelDeal | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [subDone, setSubDone] = useState({ transport: false, activities: false, currency: false });
  const runIdRef = useRef(0);
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const isRunning = pipelinePhase !== 'idle' && !['done', 'empty', 'error'].includes(pipelinePhase);
    if (!isRunning) return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pipelinePhase]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch('/api/get-deals');
        if (res.ok) {
          const data = await res.json();
          setDeals(data);
        }
      } catch (err) {
        console.error("Failed to load deals:", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const clearAllTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const triggerManualRun = async (params: typeof triggerParams) => {
    const runId = ++runIdRef.current;
    
    // Reset state
    clearAllTimeouts();
    setPipelineDeal(null);
    setPipelineError(null);
    setElapsedSec(0);
    setSubDone({ transport: false, activities: false, currency: false });
    setPipelinePhase('received');

    // Setup visual timeline reflecting a ~2.5 to 3 min wait (150-180 seconds)
    timeoutsRef.current.push(
      setTimeout(() => { if (runIdRef.current === runId) setPipelinePhase('flight'); }, 10000), // 10s
      setTimeout(() => { if (runIdRef.current === runId) setPipelinePhase('hotel'); }, 45000), // 45s
      setTimeout(() => { if (runIdRef.current === runId) setPipelinePhase('parallel'); }, 85000), // 1m 25s
      setTimeout(() => { if (runIdRef.current === runId) setSubDone(s => ({ ...s, transport: true })); }, 105000), // 1m 45s
      setTimeout(() => { if (runIdRef.current === runId) setSubDone(s => ({ ...s, activities: true })); }, 125000), // 2m 05s
      setTimeout(() => { if (runIdRef.current === runId) setSubDone(s => ({ ...s, currency: true })); }, 145000), // 2m 25s
      setTimeout(() => { if (runIdRef.current === runId) setPipelinePhase('synthesize'); }, 155000) // 2m 35s
    );

    try {
      const query = `?${new URLSearchParams({
        departure_id: params.departureId,
        travelers: String(params.travelers),
        duration: params.duration,
        home_currency: params.homeCurrency,
      }).toString()}`;
      
      const res = await fetch(`/api/cron${query}`);
      const data = await res.json();
      
      if (runIdRef.current !== runId) return;

      // Finish immediately regardless of current timer progress
      clearAllTimeouts();
      
      if (data.success && data.deal) {
        setPipelinePhase('synthesize');
        setTimeout(() => {
          if (runIdRef.current !== runId) return;
          setPipelineDeal(data.deal);
          setPipelinePhase('done');
          setDeals((prev) => [data.deal, ...prev].slice(0, 9));
        }, 1500); // Small final synthetic delay to show "done" state transition
      } else {
        setPipelineError(data.message || null);
        setPipelinePhase('empty');
      }
    } catch (err) {
      if (runIdRef.current !== runId) return;
      clearAllTimeouts();
      setPipelineError('Could not reach the agents. Check your connection and try again.');
      setPipelinePhase('error');
    }
  };

  const closePipeline = () => {
    runIdRef.current++;
    clearAllTimeouts();
    setPipelinePhase('idle');
  };

  const isPipelineBusy = pipelinePhase !== 'idle' && !['done', 'empty', 'error'].includes(pipelinePhase);
  const isExpired = (createdAtString: string) => {
    if (!createdAtString) return false;
    const createdTime = new Date(createdAtString).getTime();
    const oneHourInMs = 60 * 60 * 1000;
    return now.getTime() - createdTime > oneHourInMs;
  };

  const latestRates = deals[0]?.exchange_rates || { USD: 1, SEK: 10.5, EUR: 0.93, GBP: 0.79 };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-6 md:p-12">
      {/* Header Section */}
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <Logo />
        <div className="flex items-center gap-3 w-full md:w-auto">
          <NextScanPill />
          <select
            value={displayCurrency}
            onChange={(e) => setDisplayCurrency(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 shadow-sm outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="GBP">GBP (£)</option>
            <option value="SEK">SEK (kr)</option>
          </select>
          <button
            onClick={() => setShowTriggerForm(true)}
            disabled={isPipelineBusy}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-slate-950 hover:bg-slate-800 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50"
          >
            <Radar size={15} className="text-green-400" />
            {isPipelineBusy ? 'Hunting...' : 'Hunt for deals'}
          </button>
        </div>
      </div>

      {/* Pipeline strip */}
      {pipelinePhase !== 'idle' && (
        <PipelineStrip
          phase={pipelinePhase}
          elapsedSec={elapsedSec}
          deal={pipelineDeal}
          currency={displayCurrency}
          rates={latestRates}
          errorMessage={pipelineError}
          subDone={subDone}
          onClose={closePipeline}
          onRetry={() => triggerManualRun(triggerParams)}
        />
      )}

      {/* Main Content Area */}
      <div className="max-w-6xl mx-auto">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading live travel deals...</div>
        ) : deals.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center border border-gray-200 shadow-sm">
            <p className="text-gray-500">No deals generated yet. Click the button above to run your agents for the first time!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {deals.map((deal, idx) => {
              const expired = isExpired(deal.created_at);
              const heroImage = deal.flight?.thumbnail;
              const hotelThumb = deal.hotel?.images?.[0]?.thumbnail;
              const econ = getDealEconomics(deal);
              return (
                <div
                  key={idx}
                  onClick={() => {
                    setSelectedDeal(deal);
                    setActiveTab('overview');
                  }}
                  className="group bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-lg transition-shadow cursor-pointer relative flex flex-col h-full"
                >
                  <div className="relative h-44 overflow-hidden bg-gradient-to-br from-slate-700 to-slate-900">
                    {heroImage && (
                      <img
                        src={heroImage}
                        alt={deal.destination}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

                    <span
                      className={`absolute top-4 right-4 z-10 text-xs font-medium px-2.5 py-1 rounded-full uppercase tracking-wide backdrop-blur-sm ${
                        expired ? 'bg-white/90 text-red-700' : 'bg-white/90 text-green-700'
                      }`}
                    >
                      {expired ? 'Archived' : 'Live deal'}
                    </span>

                    {econ.hasSavings ? (
                      <div className="absolute top-16 right-4 z-10 bg-green-600 rounded-lg px-3 py-1.5 shadow-md">
                        <div className="text-[10px] text-green-50 uppercase tracking-wide leading-none mb-0.5">You save</div>
                        <div className="text-lg font-semibold text-white leading-none">
                          {formatPrice(econ.totalSavings!, displayCurrency, latestRates)}
                          {econ.totalSavingsPercent != null && (
                            <span className="text-xs font-medium text-green-100 ml-1">({econ.totalSavingsPercent}%)</span>
                          )}
                        </div>
                      </div>
                    ) : econ.totalCurrent != null ? (
                      <div className="absolute top-16 right-4 z-10 bg-white rounded-lg px-3 py-1.5 shadow-md">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Total</div>
                        <div className="text-lg font-semibold text-gray-900 leading-none">{formatPrice(econ.totalCurrent, displayCurrency, latestRates)}</div>
                      </div>
                    ) : null}

                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <h2 className="text-white text-xl font-semibold tracking-tight truncate">{deal.destination}</h2>
                      <p className="text-white/80 text-xs">{deal.country}</p>
                    </div>
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        {hotelThumb && (
                          <img
                            src={hotelThumb}
                            alt={deal.hotel?.name || 'Hotel'}
                            className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {deal.hotel?.name || 'Hotel area location'}
                          </p>
                          {deal.hotel?.overall_rating ? (
                            <div className="flex items-center gap-1.5">
                              <StarRating rating={deal.hotel.overall_rating} />
                              <span className="text-xs text-gray-400">({deal.hotel.reviews ?? 0})</span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <PriceLine label={`Flight · ${deal.flight?.airline || 'Airline'}`} current={econ.flightCurrent} original={econ.flightOriginal} currency={displayCurrency} rates={latestRates} />
                        <PriceLine
                          label={`Hotel${econ.nights ? ` · ${econ.nights} night${econ.nights === 1 ? '' : 's'}` : ''}`}
                          current={econ.hotelTotalCurrent}
                          original={econ.hotelTotalOriginal}
                          currency={displayCurrency}
                          rates={latestRates}
                        />
                        <div className="pt-2 border-t border-gray-200">
                          <PriceLine label="Total" current={econ.totalCurrent} original={econ.hasSavings ? econ.totalOriginal : null} currency={displayCurrency} rates={latestRates} emphasize />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-100 pt-4 mt-4 flex flex-col gap-2 text-xs text-gray-400">
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-md">
                          ✈️ {deal.flight?.departure_airport_code || 'Origin'} → {deal.flight?.arrival_airport_code || deal.destination.substring(0,3).toUpperCase()}
                        </span>
                        <span className="font-medium text-gray-600">
                          👥 {deal.travelers || 2} Persons
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span>Dates: {deal.start_date} - {deal.end_date}</span>
                        <span>Gen: {new Date(deal.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showTriggerForm && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowTriggerForm(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Run agents</h2>
              <button
                onClick={() => setShowTriggerForm(false)}
                className="text-gray-400 hover:text-gray-600 font-semibold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Departure airport
                </label>
                <select
                  value={triggerParams.departureId}
                  onChange={(e) => setTriggerParams({ ...triggerParams, departureId: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="CPH">Copenhagen (CPH)</option>
                  <option value="ARN">Stockholm Arlanda (ARN)</option>
                  <option value="GOT">Göteborg Landvetter (GOT)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Travelers
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={triggerParams.travelers}
                    onChange={(e) =>
                      setTriggerParams({ ...triggerParams, travelers: Number(e.target.value) || 1 })
                    }
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Trip duration
                  </label>
                  <select
                    value={triggerParams.duration}
                    onChange={(e) => setTriggerParams({ ...triggerParams, duration: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="2">Weekend</option>
                    <option value="1">1 Week</option>
                    <option value="3">2 Weeks</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Home currency
                </label>
                <select
                  value={triggerParams.homeCurrency}
                  onChange={(e) => setTriggerParams({ ...triggerParams, homeCurrency: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="SEK">SEK</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => {
                setShowTriggerForm(false);
                triggerManualRun(triggerParams);
              }}
              disabled={isPipelineBusy}
              className="w-full mt-6 flex items-center justify-center gap-2 bg-slate-950 hover:bg-slate-800 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              <Radar size={15} className="text-green-400" />
              Hunt for deals
            </button>
          </div>
        </div>
      )}

      {selectedDeal && (() => {
        const econ = getDealEconomics(selectedDeal);
        return (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedDeal(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl border border-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Hero Header */}
            <div className="relative h-56 flex-shrink-0 rounded-t-2xl overflow-hidden">
              {selectedDeal.flight?.thumbnail ? (
                <img
                  src={selectedDeal.flight.thumbnail}
                  alt={selectedDeal.destination}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-900" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <button
                onClick={() => setSelectedDeal(null)}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/90 hover:bg-white flex items-center justify-center text-gray-600 font-semibold transition-colors z-10"
              >
                ✕
              </button>
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <h2 className="text-white text-2xl font-semibold tracking-tight">{selectedDeal.destination}, {selectedDeal.country}</h2>
                <p className="text-white/80 text-sm mt-1">
                  {selectedDeal.flight?.highlights || 'Full agent-synthesized travel plan'}
                </p>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-gray-100 px-6 pt-2 shrink-0 bg-white">
              <button 
                onClick={() => setActiveTab('overview')} 
                className={`pb-3 pt-2 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'overview' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                Overview
              </button>
              <button 
                onClick={() => setActiveTab('daily_plan')} 
                className={`pb-3 pt-2 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'daily_plan' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                Daily Plan
              </button>
              <button 
                onClick={() => setActiveTab('guide')} 
                className={`pb-3 pt-2 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'guide' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                Local Guide
              </button>
            </div>

            {/* Scrollable Content Area */}
            <div className="p-6 overflow-y-auto text-sm text-gray-700 leading-relaxed rounded-b-2xl bg-white">
              
              {/* Tab 1: Overview */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between items-end mb-3">
                      <h3 className="font-semibold text-gray-900 text-base">Price breakdown</h3>
                      {selectedDeal.currency_summary && (
                        <span 
                          className="text-xs font-medium text-gray-400 flex items-center gap-1 cursor-help hover:text-gray-600 transition-colors" 
                          title={selectedDeal.currency_summary}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"></path></svg>
                          Live Rates
                        </span>
                      )}
                    </div>
                    
                    <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-2">
                      <PriceLine label={`Flight · ${selectedDeal.flight?.airline || 'Airline'}`} current={econ.flightCurrent} original={econ.flightOriginal} currency={displayCurrency} rates={latestRates} />
                      <PriceLine
                        label={`Hotel${econ.nights ? ` · ${econ.nights} night${econ.nights === 1 ? '' : 's'}` : ''}`}
                        current={econ.hotelTotalCurrent}
                        original={econ.hotelTotalOriginal}
                        currency={displayCurrency}
                        rates={latestRates}
                      />
                      <div className="pt-2 border-t border-gray-200">
                        <PriceLine label="Total" current={econ.totalCurrent} original={econ.hasSavings ? econ.totalOriginal : null} currency={displayCurrency} rates={latestRates} emphasize />
                      </div>
                      {econ.hasSavings && (
                        <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2 mt-1">
                          <span className="text-xs font-medium text-green-800">You save</span>
                          <span className="text-sm font-semibold text-green-900">
                            {formatPrice(econ.totalSavings!, displayCurrency, latestRates)}
                            {econ.totalSavingsPercent != null && (
                              <span className="font-medium text-green-700 ml-1">({econ.totalSavingsPercent}%)</span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3 mt-4">
                      {selectedDeal.flight?.flight_link && (
                        <a
                          href={selectedDeal.flight.flight_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-center py-2.5 rounded-xl font-medium transition-colors"
                        >
                          Book Flight
                        </a>
                      )}
                      
                      {selectedDeal.hotel?.name && (
                        <a
                          href={selectedDeal.hotel?.link || `https://www.google.com/travel/search?q=${encodeURIComponent(`${selectedDeal.hotel.name} ${selectedDeal.destination} ${selectedDeal.country}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white text-center py-2.5 rounded-xl font-medium transition-colors"
                        >
                          Book Hotel
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-5">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{selectedDeal.hotel?.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <StarRating rating={selectedDeal.hotel?.overall_rating} />
                        {selectedDeal.hotel?.overall_rating && (
                          <span className="text-gray-400 text-xs">({selectedDeal.hotel?.reviews ?? 0})</span>
                        )}
                      </div>
                      {selectedDeal.hotel?.deal_description && (
                        <span className="inline-block text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full mt-1.5">
                          {selectedDeal.hotel.deal_description}
                        </span>
                      )}
                    </div>

                    <p className="text-gray-500 mt-3">
                      Travel window: {selectedDeal.start_date} to {selectedDeal.end_date} • 👥 {selectedDeal.travelers || 2} Persons • ✈️ {selectedDeal.flight?.departure_airport_code || 'Origin'} → {selectedDeal.flight?.arrival_airport_code || 'Dest'}
                    </p>

                    {selectedDeal.hotel?.images && selectedDeal.hotel.images.length > 0 && (
                      <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                        {selectedDeal.hotel.images.slice(0, 4).map((img, i) => (
                          <img
                            key={i}
                            src={img.thumbnail}
                            alt={`${selectedDeal.hotel?.name || 'Hotel'} photo ${i + 1}`}
                            className="w-24 h-20 object-cover rounded-lg flex-shrink-0"
                          />
                        ))}
                      </div>
                    )}

                    {selectedDeal.hotel?.amenities && selectedDeal.hotel.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {selectedDeal.hotel.amenities.map((a, i) => (
                          <span key={i} className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-full">{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 2: Daily Plan */}
              {activeTab === 'daily_plan' && (
                <div className="bg-emerald-50/50 p-5 rounded-xl border border-emerald-100">
                  <h3 className="font-semibold text-emerald-950 text-base mb-2">Suggested Daily Schedule</h3>
                  <FormattedText text={selectedDeal.final_itinerary} />
                </div>
              )}

              {/* Tab 3: Local Guide */}
              {activeTab === 'guide' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-base mb-2">Ground transportation</h3>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <FormattedText text={selectedDeal.transport_summary} />
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold text-gray-900 text-base mb-2">Activities &amp; local culture</h3>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <FormattedText text={selectedDeal.activity_summary} />
                    </div>
                  </div>
                </div>
              )}
              
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}