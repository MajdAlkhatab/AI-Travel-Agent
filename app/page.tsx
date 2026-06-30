'use client';

import { useState, useEffect } from 'react';

interface Flight {
  airline?: string;
  price?: number;
  discount_percentage?: number;
  arrival_airport_code?: string;
}

interface Hotel {
  name?: string;
  deal?: string;
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
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors disabled:bg-blue-400"
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
              return (
                <div
                  key={idx}
                  onClick={() => setSelectedDeal(deal)}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow cursor-pointer relative flex flex-col h-full"
                >
                  {/* Visual Expiry Badge */}
                  <div className="absolute top-4 right-4 z-10">
                    {expired ? (
                      <span className="bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider">
                        Sold Out / Expired
                      </span>
                    ) : (
                      <span className="bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider">
                        Live Deal
                      </span>
                    )}
                  </div>

                  {/* Header */}
                  <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-32 flex items-end p-4">
                    <h2 className="text-white text-xl font-bold truncate">
                      {deal.destination}, {deal.country}
                    </h2>
                  </div>

                  {/* Card Content */}
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Flight Deal</p>
                      <p className="text-lg font-bold text-gray-800 mt-0.5">
                        {deal.flight?.airline || 'Airline'} — ${deal.flight?.price || '0'}
                        {deal.flight?.discount_percentage && (
                          <span className="text-green-600 text-sm font-semibold ml-2">
                            ({deal.flight.discount_percentage}% Off)
                          </span>
                        )}
                      </p>

                      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mt-4">Hotel Spotlight</p>
                      <p className="text-sm font-medium text-gray-700 mt-0.5 truncate">
                        {deal.hotel?.name || 'Hotel Area Location'}
                      </p>
                      <p className="text-xs text-green-600 font-medium">{deal.hotel?.deal || 'Special Offer Included'}</p>
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

      {/* Expanded Detailed Itinerary Modal */}
      {selectedDeal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-gray-100 flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedDeal.destination}, {selectedDeal.country}</h2>
                <p className="text-sm text-gray-500">Full Agent-Synthesized Travel Plan</p>
              </div>
              <button
                onClick={() => setSelectedDeal(null)}
                className="text-gray-400 hover:text-gray-600 font-semibold text-xl p-2"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 text-sm text-gray-700 leading-relaxed">
              <div>
                <h3 className="font-bold text-gray-900 text-base mb-2">Flight &amp; Hotel Summary</h3>
                <p><strong>Airline:</strong> {selectedDeal.flight?.airline} (${selectedDeal.flight?.price})</p>
                <p><strong>Hotel:</strong> {selectedDeal.hotel?.name} — {selectedDeal.hotel?.deal}</p>
                <p><strong>Travel Window:</strong> {selectedDeal.start_date} to {selectedDeal.end_date}</p>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h3 className="font-bold text-gray-900 text-base mb-2">Ground Transportation</h3>
                <p className="whitespace-pre-wrap text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">{selectedDeal.transport_summary}</p>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h3 className="font-bold text-gray-900 text-base mb-2">Activities &amp; Local Culture</h3>
                <p className="whitespace-pre-wrap text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">{selectedDeal.activity_summary}</p>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h3 className="font-bold text-gray-900 text-base mb-2">Currency Exchange Info</h3>
                <p className="whitespace-pre-wrap text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">{selectedDeal.currency_summary}</p>
              </div>

              <div className="border-t border-indigo-100 bg-indigo-50/50 p-4 rounded-xl">
                <h3 className="font-bold text-indigo-950 text-base mb-2">Final Tailored Itinerary</h3>
                <p className="whitespace-pre-wrap text-indigo-900 font-medium">{selectedDeal.final_itinerary}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}