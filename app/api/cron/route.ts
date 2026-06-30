import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

export async function GET(request: Request) {
  try {
    // 1. Call your Python AI Agents
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const host = request.headers.get('host');
    const pythonApiUrl = `${protocol}://${host}/api/generate-trip`;
    
    console.log("Triggering Python Agents at:", pythonApiUrl);
    const agentResponse = await fetch(pythonApiUrl);
    
    if (!agentResponse.ok) {
      throw new Error("Python API failed to generate a trip.");
    }

    const newDeal = await agentResponse.json();

    // 2. Fetch existing deals from Vercel Blob
    let existingDeals: any[] = [];
    const { blobs } = await list({ prefix: 'deals.json' });
    
    if (blobs.length > 0) {
      // If the file exists, fetch its contents (bypass cache to ensure fresh data)
      const blobResponse = await fetch(blobs[0].url, { cache: 'no-store' });
      if (blobResponse.ok) {
        existingDeals = await blobResponse.json();
      }
    }

    // 3. Add the new deal to the front of the list, keep only the latest 9 deals (3 rows)
    existingDeals.unshift(newDeal);
    if (existingDeals.length > 9) {
      existingDeals = existingDeals.slice(0, 9);
    }

    // 4. Overwrite the deals.json file in Vercel Blob
    await put('deals.json', JSON.stringify(existingDeals), {
      access: 'public',
      addRandomSuffix: false, // Ensures we overwrite the exact same file
      contentType: 'application/json'
    });

    return NextResponse.json({ success: true, message: "Deal saved to Blob successfully!", deal: newDeal });

  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}