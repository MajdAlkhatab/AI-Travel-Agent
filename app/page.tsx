'use client';

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface Flight {
  airline?: string;
  price?: number;
  average_price?: number;
  discount_percentage?: number;
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
}

// --- Pricing helpers ---------------------------------------------------

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

// Extracts "26" from a hotel deal string like "26% less than usual".
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

// Simple before/after economics for a deal: flight price, hotel TOTAL price
// for the whole stay (not per-night), and a combined total — each with a
// current and an original figure where available.
//
// Flight original comes straight from SerpApi (average_price). Hotels only
// give us a discount percentage in text (e.g. "26% less than usual"), so
// the original total is back-calculated from that — an estimate, not a
// directly-reported figure.
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

// Small inline star rating — no icon library required.
function StarRating({ rating }: { rating?: number }) {
  if (!rating) return null;
  const filled = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} width="11" height="11" viewBox="0 0 20 20" fill={i < filled ? '#D97706' : '#E5E7EB'}>
          <path d="M10 1l2.6 5.6 6.2.6-4.6 4.2 1.3 6.1L10 14.8 4.5 17.5l1.3-6.1L1.2 7.2l6.2-.6L10 1z" />
        </svg>
      ))}
    </span>
  );
}

// A single before/after price line: label on the left, current price with
// an optional strikethrough original on the right.
function PriceLine({
  label,
  current,
  original,
  emphasize = false,
}: {
  label: string;
  current: number | null;
  original: number | null;
  emphasize?: boolean;
}) {
  const showOriginal = original != null && current != null && original > current;
  return (
    <div className="flex items-baseline justify-between">
      <span className={emphasize ? 'font-semibold text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className={emphasize ? 'font-semibold text-gray-900 text-base' : 'font-medium text-gray-900'}>
          {current != null ? formatUSD(current) : '—'}
        </span>
        {showOriginal && <span className="text-xs text-gray-400 line-through">{formatUSD(original!)}</span>}
      </span>
    </div>
  );
}

// Lightweight renderer for the LLM-written summaries: turns **bold** into
// <strong> and "- item" / "1. item" lines into real lists, without pulling
// in a markdown dependency.
function FormattedText({ text }: { text: string }) {
  if (!text) return null;

  const renderInline = (line: string): ReactNode => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="font-medium text-gray-900">{part.slice(2, -2)}</strong>
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
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1 my-2">
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
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1]);
    } else if (numberedMatch) {
      listBuffer.push(numberedMatch[1]);
    } else {
      flushList();
      blocks.push(
        <p key={`p-${idx}`} className="text-gray-600 my-1">{renderInline(line)}</p>
      );
    }
  });
  flushList();

  return <div>{blocks}</div>;
}

export default function Home() {
  const [deals, setDeals] = useState<TravelDeal[]>([]);
  const [selectedDeal, setSelectedDeal] = useState<TravelDeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggeringAgent, setTriggeringAgent] = useState(false);
  const [now, setNow] = useState(new Date());
  const [showTriggerForm, setShowTriggerForm] = useState(false);
  const [triggerParams, setTriggerParams] = useState({
    departureId: 'CPH',
    travelers: 2,
    duration: '2',
    homeCurrency: 'SEK',
  });

  // Update current time every 10 seconds to keep timers fresh
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Fetch saved deals from Vercel Blob on page load
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

  const triggerManualRun = async (params?: typeof triggerParams) => {
    setTriggeringAgent(true);
    try {
      const query = params
        ? `?${new URLSearchParams({
            departure_id: params.departureId,
            travelers: String(params.travelers),
            duration: params.duration,
            home_currency: params.homeCurrency,
          }).toString()}`
        : '';
      const res = await fetch(`/api/cron${query}`);
      const data = await res.json();
      if (data.success) {
        window.location.reload();
      } else {
        alert(data.message || "Agent run did not produce a new deal.");
      }
    } catch (err) {
      alert("Failed to run agents manually.");
    } finally {
      setTriggeringAgent(false);
    }
  };

  // Helper to determine if a deal is expired (older than 1 hour)
  const isExpired = (createdAtString: string) => {
    if (!createdAtString) return false;
    const createdTime = new Date(createdAtString).getTime();
    const oneHourInMs = 60 * 60 * 1000;
    return now.getTime() - createdTime > oneHourInMs;
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-6 md:p-12">
      {/* Header Section */}
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">AI Travel Agent Dashboard</h1>
          <p className="text-gray-500 mt-1 text-sm">Automated pipeline updates at 09:00, 12:00, 15:00, and 18:00</p>
        </div>
        <button
          onClick={() => setShowTriggerForm(true)}
          disabled={triggeringAgent}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition-colors disabled:bg-blue-400"
        >
          {triggeringAgent ? 'Running Agents...' : 'Trigger Agents Manually'}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="max-w-6xl mx-auto">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading live travel deals...</div>
        ) : deals.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center border border-gray-200 shadow-sm">
            <p className="text-gray-500">No deals generated yet. Click the button above to run your agents for the first time!</p>
          </div>
        ) : (
          /* 3-Column Grid Layout */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {deals.map((deal, idx) => {
              const expired = isExpired(deal.created_at);
              const heroImage = deal.flight?.thumbnail;
              const hotelThumb = deal.hotel?.images?.[0]?.thumbnail;
              const econ = getDealEconomics(deal);
              return (
                <div
                  key={idx}
                  onClick={() => setSelectedDeal(deal)}
                  className="group bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-lg transition-shadow cursor-pointer relative flex flex-col h-full"
                >
                  {/* Hero photo */}
                  <div className="relative h-44 overflow-hidden bg-gradient-to-br from-slate-700 to-slate-900">
                    {heroImage && (
                      <img
                        src={heroImage}
                        alt={deal.destination}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

                    {/* Expiry badge */}
                    <span
                      className={`absolute top-4 right-4 z-10 text-xs font-medium px-2.5 py-1 rounded-full uppercase tracking-wide backdrop-blur-sm ${
                        expired ? 'bg-white/90 text-red-700' : 'bg-white/90 text-green-700'
                      }`}
                    >
                      {expired ? 'Sold out' : 'Live deal'}
                    </span>

                    {/* Savings badge — replaces the old "From $X" price tag */}
                    {econ.hasSavings ? (
                      <div className="absolute top-16 right-4 z-10 bg-green-600 rounded-lg px-3 py-1.5 shadow-md">
                        <div className="text-[10px] text-green-50 uppercase tracking-wide leading-none mb-0.5">You save</div>
                        <div className="text-lg font-semibold text-white leading-none">
                          {formatUSD(econ.totalSavings!)}
                          {econ.totalSavingsPercent != null && (
                            <span className="text-xs font-medium text-green-100 ml-1">({econ.totalSavingsPercent}%)</span>
                          )}
                        </div>
                      </div>
                    ) : econ.totalCurrent != null ? (
                      <div className="absolute top-16 right-4 z-10 bg-white rounded-lg px-3 py-1.5 shadow-md">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">Total</div>
                        <div className="text-lg font-semibold text-gray-900 leading-none">{formatUSD(econ.totalCurrent)}</div>
                      </div>
                    ) : null}

                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <h2 className="text-white text-xl font-semibold tracking-tight truncate">{deal.destination}</h2>
                      <p className="text-white/80 text-xs">{deal.country}</p>
                    </div>
                  </div>

                  {/* Card content */}
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
                        <PriceLine label={`Flight · ${deal.flight?.airline || 'Airline'}`} current={econ.flightCurrent} original={econ.flightOriginal} />
                        <PriceLine
                          label={`Hotel${econ.nights ? ` · ${econ.nights} night${econ.nights === 1 ? '' : 's'}` : ''}`}
                          current={econ.hotelTotalCurrent}
                          original={econ.hotelTotalOriginal}
                        />
                        <div className="pt-2 border-t border-gray-200">
                          <PriceLine label="Total" current={econ.totalCurrent} original={econ.hasSavings ? econ.totalOriginal : null} emphasize />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-100 pt-4 mt-4 flex justify-between items-center text-xs text-gray-400">
                      <span>Dates: {deal.start_date}</span>
                      <span>Generated: {new Date(deal.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Trigger Parameters Form */}
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900"
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
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Trip duration
                  </label>
                  <select
                    value={triggerParams.duration}
                    onChange={(e) => setTriggerParams({ ...triggerParams, duration: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900"
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900"
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
              disabled={triggeringAgent}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition-colors disabled:bg-blue-400"
            >
              {triggeringAgent ? 'Running...' : 'Run agents'}
            </button>
          </div>
        </div>
      )}

      {/* Expanded Detailed Itinerary Modal */}
      {selectedDeal && (() => {
        const econ = getDealEconomics(selectedDeal);
        return (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedDeal(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[88vh] overflow-y-auto shadow-2xl border border-gray-100 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Hero */}
            <div className="relative h-56 flex-shrink-0">
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
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/90 hover:bg-white flex items-center justify-center text-gray-600 font-semibold transition-colors"
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

            <div className="p-6 space-y-6 text-sm text-gray-700 leading-relaxed">
              {/* Price breakdown */}
              <div>
                <h3 className="font-semibold text-gray-900 text-base mb-3">Price breakdown</h3>
                <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-2">
                  <PriceLine label={`Flight · ${selectedDeal.flight?.airline || 'Airline'}`} current={econ.flightCurrent} original={econ.flightOriginal} />
                  <PriceLine
                    label={`Hotel${econ.nights ? ` · ${econ.nights} night${econ.nights === 1 ? '' : 's'}` : ''}`}
                    current={econ.hotelTotalCurrent}
                    original={econ.hotelTotalOriginal}
                  />
                  <div className="pt-2 border-t border-gray-200">
                    <PriceLine label="Total" current={econ.totalCurrent} original={econ.hasSavings ? econ.totalOriginal : null} emphasize />
                  </div>
                  {econ.hasSavings && (
                    <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2 mt-1">
                      <span className="text-xs font-medium text-green-800">You save</span>
                      <span className="text-sm font-semibold text-green-900">
                        {formatUSD(econ.totalSavings!)}
                        {econ.totalSavingsPercent != null && (
                          <span className="font-medium text-green-700 ml-1">({econ.totalSavingsPercent}%)</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Hotel + flight details */}
              <div>
                <div className="flex items-start justify-between gap-4">
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
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 text-xs">
                    {selectedDeal.flight?.flight_link && (
                      <a
                        href={selectedDeal.flight.flight_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 font-medium hover:underline"
                      >
                        View flight →
                      </a>
                    )}
                    {selectedDeal.hotel?.link && (
                      <a
                        href={selectedDeal.hotel.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 font-medium hover:underline"
                      >
                        View hotel →
                      </a>
                    )}
                  </div>
                </div>

                <p className="text-gray-500 mt-3">Travel window: {selectedDeal.start_date} to {selectedDeal.end_date}</p>

                {/* Hotel photo strip */}
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

                {/* Amenities */}
                {selectedDeal.hotel?.amenities && selectedDeal.hotel.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {selectedDeal.hotel.amenities.map((a, i) => (
                      <span key={i} className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-full">{a}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-gray-100 pt-5">
                <h3 className="font-semibold text-gray-900 text-base mb-2">Ground transportation</h3>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <FormattedText text={selectedDeal.transport_summary} />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <h3 className="font-semibold text-gray-900 text-base mb-2">Activities &amp; local culture</h3>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <FormattedText text={selectedDeal.activity_summary} />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <h3 className="font-semibold text-gray-900 text-base mb-2">Currency exchange</h3>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <FormattedText text={selectedDeal.currency_summary} />
                </div>
              </div>

              <div className="border-t border-indigo-100 bg-indigo-50/50 p-4 rounded-xl">
                <h3 className="font-semibold text-indigo-950 text-base mb-2">Full itinerary</h3>
                <FormattedText text={selectedDeal.final_itinerary} />
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}