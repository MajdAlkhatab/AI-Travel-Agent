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

    // 2. Guard: if no flight was found, don't save a broken card
    if (!newDeal || !newDeal.destination) {
      console.warn("No valid deal found this run. Skipping save.");
      return NextResponse.json({
        success: false,
        message: "No flight deal found this run. Nothing saved."
      });
    }

    // 3. Fetch existing deals from Vercel Blob
    let existingDeals: any[] = [];
    const { blobs } = await list({ prefix: 'deals.json' });

    if (blobs.length > 0) {
      const blobResponse = await fetch(blobs[0].url, { cache: 'no-store' });
      if (blobResponse.ok) {
        existingDeals = await blobResponse.json();
      }
    }

    // 4. Add the new deal to the front of the list, keep only the latest 9 deals (3 rows)
    existingDeals.unshift(newDeal);
    if (existingDeals.length > 9) {
      existingDeals = existingDeals.slice(0, 9);
    }

    // 5. Overwrite the deals.json file in Vercel Blob
    await put('deals.json', JSON.stringify(existingDeals), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });

    return NextResponse.json({
      success: true,
      message: "Deal saved to Blob successfully!",
      deal: newDeal
    });

  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}