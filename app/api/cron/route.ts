import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Falls back to the same defaults the scheduled cron run has always
    // used, so calls with no params (the cron schedule itself) behave
    // exactly as before. Manual triggers from the dashboard can override any
    // of these.
    const departureId = searchParams.get('departure_id') || 'CPH';
    const travelers = searchParams.get('travelers') || '2';
    const duration = searchParams.get('duration') || '2';
    const homeCurrency = searchParams.get('home_currency') || 'SEK';

    // 1. Fetch existing deals FIRST, so we know which countries to avoid
    // repeating before calling the Python agents.
    let existingDeals: any[] = [];
    const { blobs } = await list({ prefix: 'deals.json' });

    if (blobs.length > 0) {
      const blobResponse = await fetch(blobs[0].url, { cache: 'no-store' });
      if (blobResponse.ok) {
        existingDeals = await blobResponse.json();
      }
    }

    // Countries from the last 7 saved trips, deduped, comma-joined.
    const recentCountries = Array.from(
      new Set(
        existingDeals
          .slice(0, 7)
          .map((d) => d?.country)
          .filter((c): c is string => Boolean(c))
      )
    );

    // 2. Call your Python AI Agents, passing the params and exclusion list along
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const host = request.headers.get('host');
    const pythonApiUrl = `${protocol}://${host}/api/generate-trip?${new URLSearchParams({
      departure_id: departureId,
      travelers,
      duration,
      home_currency: homeCurrency,
      exclude_destinations: recentCountries.join(','),
    }).toString()}`;

    console.log("Triggering Python Agents at:", pythonApiUrl);
    const agentResponse = await fetch(pythonApiUrl, { cache: 'no-store' });

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text();
      throw new Error(`Python API failed: ${agentResponse.status} - ${errorText}`);
    }

    const newDeal = await agentResponse.json();
    // Fetch live exchange rates (Base USD) and attach to the deal
    try {
      const fxRes = await fetch('https://api.frankfurter.app/latest?from=USD&to=SEK,EUR,GBP');
      if (fxRes.ok) {
        const fxData = await fxRes.json();
        newDeal.exchange_rates = {
          USD: 1,
          SEK: fxData.rates.SEK,
          EUR: fxData.rates.EUR,
          GBP: fxData.rates.GBP
        };
      }
    } catch (e) {
      console.warn("Failed to fetch exchange rates, using fallbacks.");
      // Safe fallback if the API hiccups
      newDeal.exchange_rates = { USD: 1, SEK: 10.5, EUR: 0.93, GBP: 0.79 };
    }

    // 3. Bronze: persist the untouched raw SerpApi responses for this run,
    // one file per run, timestamped so nothing is ever overwritten. Saved
    // even if no flight deal was found, so failed runs are debuggable too.
    const bronzeTimestamp = newDeal?.created_at || new Date().toISOString();
    try {
      await put(`bronze/${bronzeTimestamp}.json`, JSON.stringify({
        created_at: bronzeTimestamp,
        raw_flight_response: newDeal?.raw_flight_response ?? null,
        raw_hotel_response: newDeal?.raw_hotel_response ?? null,
      }), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json'
      });
    } catch (bronzeError) {
      // Never let a bronze-save failure block the main deal-saving flow
      console.error("Bronze save failed:", bronzeError);
    }

    // 4. Guard: if no flight was found, don't save a broken card
    if (!newDeal || !newDeal.destination) {
      console.warn("No valid deal found this run. Skipping save.");
      return NextResponse.json({
        success: false,
        message: "No flight deal found this run. Nothing saved."
      });
    }

    // 5. Strip the bulky raw fields before storing the UI-facing deal —
    // deals.json keeps the exact same shape it always had.
    const { raw_flight_response, raw_hotel_response, ...curatedDeal } = newDeal;

    // 6. Add the new deal to the front of the list, keep only the latest 9 deals (3 rows)
    existingDeals.unshift(curatedDeal);
    if (existingDeals.length > 9) {
      existingDeals = existingDeals.slice(0, 9);
    }

    // 7. Overwrite the deals.json file in Vercel Blob
    await put('deals.json', JSON.stringify(existingDeals), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });

    return NextResponse.json({
      success: true,
      message: "Deal saved to Blob successfully!",
      deal: curatedDeal
    });

  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

