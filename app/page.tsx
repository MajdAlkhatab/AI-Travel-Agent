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

// Derives original price, savings, and a combined total for a deal.
// Flight uses the real average_price SerpApi returns. Hotels only give us
// a discount percentage in the `deal` text (e.g. "26% less than usual"),
// so the original nightly rate is back-calculated from that — an estimate,
// not a directly-reported figure.
function getDealEconomics(deal: TravelDeal) {
  const flightCurrent = deal.flight?.price;
  const flightOriginal = deal.flight?.average_price;
  const flightSavings =
    flightOriginal != null && flightCurrent != null && flightOriginal > flightCurrent
      ? flightOriginal - flightCurrent
      : null;

  const hotelCurrent = deal.hotel?.rate_per_night?.extracted_lowest;
  const hotelPct = parseDealPercent(deal.hotel?.deal);
  const hotelOriginal =
    hotelCurrent != null && hotelPct != null && hotelPct > 0 && hotelPct < 100
      ? hotelCurrent / (1 - hotelPct / 100)
      : null;
  const hotelNightlySavings =
    hotelOriginal != null && hotelCurrent != null ? hotelOriginal - hotelCurrent : null;

  const nights = nightsBetween(deal.start_date, deal.end_date);
  const hotelTotalSavings =
    hotelNightlySavings != null && nights != null ? hotelNightlySavings * nights : null;

  const totalSavings = (flightSavings ?? 0) + (hotelTotalSavings ?? 0);
  const hasSavings = flightSavings != null || hotelTotalSavings != null;

  return {
    flightCurrent,
    flightOriginal,
    flightSavings,
    hotelCurrent,
    hotelOriginal,
    hotelPct,
    hotelNightlySavings,
    nights,
    hotelTotalSavings,
    totalSavings,
    hasSavings,
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

  const triggerManualRun = async () => {
    setTriggeringAgent(true);
    try {
      const res = await fetch('/api/cron');
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
          onClick={triggerManualRun}
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

                    {/* Price tag */}
                    {deal.flight?.price != null && (
                      <div className="absolute top-16 right-4 z-10 bg-white rounded-lg px-3 py-1.5 shadow-md">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">From</div>
                        <div className="text-lg font-semibold text-gray-900 leading-none">${deal.flight.price}</div>
                      </div>
                    )}

                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <h2 className="text-white text-xl font-semibold tracking-tight truncate">{deal.destination}</h2>
                      <p className="text-white/80 text-xs">{deal.country}</p>
                    </div>
                  </div>

                  {/* Card content */}
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div className="space-y-4">
                      {/* Flight row */}
                      <div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                            Flight · {deal.flight?.airline || 'Airline'}
                          </p>
                          {deal.flight?.discount_percentage ? (
                            <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded-md">
                              {deal.flight.discount_percentage}% off
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-lg font-semibold text-gray-900">
                            {econ.flightCurrent != null ? formatUSD(econ.flightCurrent) : '—'}
                          </span>
                          {econ.flightOriginal != null && (
                            <span className="text-sm text-gray-400 line-through">{formatUSD(econ.flightOriginal)}</span>
                          )}
                        </div>
                        {econ.flightSavings != null && (
                          <p className="text-xs text-green-600 font-medium mt-0.5">Save {formatUSD(econ.flightSavings)}</p>
                        )}
                      </div>

                      {/* Hotel row */}
                      <div className="pt-3 border-t border-gray-100">
                        <div className="flex items-start gap-3">
                          {hotelThumb && (
                            <img
                              src={hotelThumb}
                              alt={deal.hotel?.name || 'Hotel'}
                              className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-gray-800 truncate">
                                {deal.hotel?.name || 'Hotel area location'}
                              </p>
                              {econ.hotelPct != null && (
                                <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded-md flex-shrink-0">
                                  {econ.hotelPct}% off
                                </span>
                              )}
                            </div>
                            {deal.hotel?.overall_rating ? (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <StarRating rating={deal.hotel.overall_rating} />
                                <span className="text-xs text-gray-400">({deal.hotel.reviews ?? 0})</span>
                              </div>
                            ) : null}
                            <div className="flex items-baseline gap-2 mt-1">
                              {econ.hotelCurrent != null && (
                                <span className="text-sm font-semibold text-gray-900">
                                  {formatUSD(econ.hotelCurrent)}/night
                                </span>
                              )}
                              {econ.hotelOriginal != null && (
                                <span className="text-xs text-gray-400 line-through">{formatUSD(econ.hotelOriginal)}</span>
                              )}
                            </div>
                            {econ.hotelNightlySavings != null && (
                              <p className="text-xs text-green-600 font-medium mt-0.5">
                                Save {formatUSD(econ.hotelNightlySavings)}/night
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Total savings */}
                    {econ.hasSavings && (
                      <div className="mt-4 bg-green-50 border border-green-100 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-green-800">
                          Est. total savings{econ.nights ? ` (${econ.nights}n trip)` : ''}
                        </span>
                        <span className="text-sm font-semibold text-green-900">{formatUSD(econ.totalSavings)}</span>
                      </div>
                    )}

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
              <div>
                <h3 className="font-semibold text-gray-900 text-base mb-3">Flight &amp; hotel</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Flight</p>
                    <p className="font-medium text-gray-900">{selectedDeal.flight?.airline}</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-base font-semibold text-gray-900">
                        {econ.flightCurrent != null ? formatUSD(econ.flightCurrent) : '—'}
                      </span>
                      {econ.flightOriginal != null && (
                        <span className="text-xs text-gray-400 line-through">{formatUSD(econ.flightOriginal)}</span>
                      )}
                    </div>
                    {econ.flightSavings != null ? (
                      <p className="text-xs text-green-600 font-medium mt-0.5">
                        Save {formatUSD(econ.flightSavings)} ({selectedDeal.flight?.discount_percentage}% off)
                      </p>
                    ) : (
                      <p className="text-gray-500 mt-0.5">{selectedDeal.flight?.discount_percentage}% off</p>
                    )}
                    {selectedDeal.flight?.flight_link && (
                      <a
                        href={selectedDeal.flight.flight_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 text-xs font-medium mt-1.5 inline-block hover:underline"
                      >
                        View flight →
                      </a>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Hotel</p>
                    <p className="font-medium text-gray-900 truncate">{selectedDeal.hotel?.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StarRating rating={selectedDeal.hotel?.overall_rating} />
                      {selectedDeal.hotel?.overall_rating && (
                        <span className="text-gray-400 text-xs">({selectedDeal.hotel?.reviews ?? 0})</span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      {econ.hotelCurrent != null && (
                        <span className="text-base font-semibold text-gray-900">{formatUSD(econ.hotelCurrent)}/night</span>
                      )}
                      {econ.hotelOriginal != null && (
                        <span className="text-xs text-gray-400 line-through">{formatUSD(econ.hotelOriginal)}</span>
                      )}
                    </div>
                    {econ.hotelNightlySavings != null && (
                      <p className="text-xs text-green-600 font-medium mt-0.5">
                        Save {formatUSD(econ.hotelNightlySavings)}/night ({econ.hotelPct}% off)
                      </p>
                    )}
                    {selectedDeal.hotel?.deal_description && (
                      <span className="inline-block text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full mt-1.5">
                        {selectedDeal.hotel.deal_description}
                      </span>
                    )}
                    {selectedDeal.hotel?.link && (
                      <a
                        href={selectedDeal.hotel.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 text-xs font-medium mt-1.5 block hover:underline"
                      >
                        View hotel →
                      </a>
                    )}
                  </div>
                </div>

                {econ.hasSavings && (
                  <div className="mt-3 bg-green-50 border border-green-100 rounded-lg px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-green-800">
                      Estimated total savings{econ.nights ? ` over ${econ.nights} nights` : ''}
                    </span>
                    <span className="text-sm font-semibold text-green-900">{formatUSD(econ.totalSavings)}</span>
                  </div>
                )}

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