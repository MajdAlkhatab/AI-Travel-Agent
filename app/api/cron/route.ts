import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

export async function GET(request: Request) {
  try {
    // 1. Call your Python AI Agents
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const host = request.headers.get('host');
    const pythonApiUrl = `${protocol}://${host}/api/generate-trip`;

    console.log("Triggering Python Agents at:", pythonApiUrl);
    const agentResponse = await fetch(pythonApiUrl, { cache: 'no-store' });

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text();
      throw new Error(`Python API failed: ${agentResponse.status} - ${errorText}`);
    }

    const newDeal = await agentResponse.json();

    // 2. Bronze: persist the untouched raw SerpApi responses for this run,
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

    // 3. Guard: if no flight was found, don't save a broken card
    if (!newDeal || !newDeal.destination) {
      console.warn("No valid deal found this run. Skipping save.");
      return NextResponse.json({
        success: false,
        message: "No flight deal found this run. Nothing saved."
      });
    }

    // 4. Fetch existing deals from Vercel Blob
    let existingDeals: any[] = [];
    const { blobs } = await list({ prefix: 'deals.json' });

    if (blobs.length > 0) {
      const blobResponse = await fetch(blobs[0].url, { cache: 'no-store' });
      if (blobResponse.ok) {
        existingDeals = await blobResponse.json();
      }
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