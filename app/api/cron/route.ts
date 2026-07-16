/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';

// Optional: Increases max timeout if you are on a paid Vercel plan
export const maxDuration = 60; 

export async function GET(request: Request) {
  try {
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;

    // 1. RANDOMIZE PARAMETERS (Just like the manual form, but automated)
    const airports = ['ARN', 'GOT', 'CPH'];
    const randomAirport = airports[Math.floor(Math.random() * airports.length)];
    const randomTravelers = Math.random() > 0.5 ? 1 : 2; 
    const randomDuration = Math.random() > 0.5 ? '2' : '1'; 
    const preferences = ['beach', 'city'];
    const randomPreference = preferences[Math.floor(Math.random() * preferences.length)];

    // 2. EXCLUSION CHECK (Same logic as frontend)
    let existingDeals: any[] = [];
    const { blobs } = await list({ prefix: 'deals.json' });

    if (blobs.length > 0) {
      const blobResponse = await fetch(blobs[0].url, { cache: 'no-store' });
      if (blobResponse.ok) {
        existingDeals = await blobResponse.json();
      }
    }

    const recentCountries = Array.from(
      new Set(
        existingDeals
          .slice(0, 7)
          .map((d) => d?.country)
          .filter(Boolean)
      )
    ).join(',');

    // 3. TRIGGER AI AGENTS
    const pythonApiUrl = `${baseUrl}/api/generate-trip?${new URLSearchParams({
      departure_id: randomAirport,
      travelers: String(randomTravelers),
      duration: randomDuration,
      home_currency: 'SEK',
      user_preference: randomPreference,
      exclude_destinations: recentCountries,
    }).toString()}`;

    console.log("Cron triggering Python Agents at:", pythonApiUrl);
    const agentResponse = await fetch(pythonApiUrl, { cache: 'no-store' });

    if (!agentResponse.body) {
      throw new Error("No readable stream available from Python API");
    }

    // 4. EXACT SAME STREAM PARSING AS page.tsx
    const reader = agentResponse.body.getReader();
    const decoder = new TextDecoder();
    let partialData = '';
    let finalDeal = null;
    let emptyRun = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partialData += decoder.decode(value, { stream: true });
      const lines = partialData.split('\n\n');
      partialData = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.substring(6));
            
            if (payload.type === 'complete') {
              finalDeal = payload.data;
            } else if (payload.type === 'empty') {
              emptyRun = true;
            } else if (payload.type === 'error') {
              throw new Error(`Python Agent Error: ${payload.message}`);
            }
          } catch (e) {
            // Ignore incomplete chunks
          }
        }
      }
    }

    // Catch any remaining data in the buffer
    if (partialData.trim().startsWith('data: ')) {
      try {
        const payload = JSON.parse(partialData.trim().substring(6));
        if (payload.type === 'complete') finalDeal = payload.data;
        else if (payload.type === 'empty') emptyRun = true;
      } catch (e) {}
    }

    // 5. HANDLE NO DEALS GRACEFULLY
    if (emptyRun || !finalDeal) {
      console.log("Cron: No deals found this round. Exiting cleanly.");
      return NextResponse.json({
        success: true,
        message: "No flight deal found this run. Clean abort."
      });
    }

    // 6. MIMIC MANUAL CLICK: POST TO /api/save-and-publish
    console.log(`Cron: Deal found for ${finalDeal.destination}! Forwarding to save-and-publish endpoint...`);
    
    const saveResponse = await fetch(`${baseUrl}/api/save-and-publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalDeal)
    });

    const saveResult = await saveResponse.json();

    return NextResponse.json({
      success: true,
      message: "Cron successfully mimicked manual click!",
      saveResult
    });

  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}