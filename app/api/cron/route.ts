import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const airports = ['ARN', 'GOT', 'CPH'];
    const randomAirport = airports[Math.floor(Math.random() * airports.length)];
    const randomTravelers = Math.random() > 0.5 ? '1' : '2'; 
    const randomDuration = Math.random() > 0.5 ? '2' : '1'; 

    const departureId = searchParams.get('departure_id') || randomAirport;
    const travelers = searchParams.get('travelers') || randomTravelers;
    const duration = searchParams.get('duration') || randomDuration;
    const homeCurrency = searchParams.get('home_currency') || 'SEK';

    // 1. Fetch existing deals FIRST
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
          .filter((c): c is string => Boolean(c))
      )
    );

    // 2. Call your Python AI Agents
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
    
    // Fetch live exchange rates
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
      newDeal.exchange_rates = { USD: 1, SEK: 10.5, EUR: 0.93, GBP: 0.79 };
    }

    // 3. Bronze Save
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
      console.error("Bronze save failed:", bronzeError);
    }

    // 4. Guard
    if (!newDeal || !newDeal.destination) {
      console.warn("No valid deal found this run. Skipping save.");
      return NextResponse.json({
        success: false,
        message: "No flight deal found this run. Nothing saved."
      });
    }

    const { raw_flight_response, raw_hotel_response, ...curatedDeal } = newDeal;

    // 5. Overwrite deals.json
    existingDeals.unshift(curatedDeal);
    if (existingDeals.length > 60) {
      existingDeals = existingDeals.slice(0, 60);
    }

    await put('deals.json', JSON.stringify(existingDeals), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });

    // ------------------------------------------------------------------
    // 6. TRIGGER SOCIAL MEDIA PUBLISHING (CAROUSEL)
    // ------------------------------------------------------------------
    try {
      // ÄNDRING HÄR: Välj original_image i första hand för högre upplösning
      const flightImage = curatedDeal.flight?.thumbnail;
      const hotelImages = curatedDeal.hotel?.images?.map((img: any) => img.original_image || img.thumbnail) || [];
      
      const imageUrls = [flightImage, ...hotelImages]
        .filter((url): url is string => Boolean(url))
        .slice(0, 10);
      
      if (imageUrls.length > 0) {
        const socialCaption = `🔥 New Deal Alert: ${curatedDeal.destination}, ${curatedDeal.country}!\n\n✈️ Flights & Hotel found.\n\nHere is the vibe:\n${curatedDeal.activity_summary}\n\nLink in bio to see the full itinerary and book before prices change! 🌍✨`;
        
        const publishUrl = `${protocol}://${host}/api/publish`;
        console.log("Triggering Carousel Social Media Publish at:", publishUrl);
        
        const publishRes = await fetch(publishUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.API_SECRET_KEY}`
          },
          body: JSON.stringify({
            imageUrls: imageUrls,
            caption: socialCaption
          })
        });
        
        const publishData = await publishRes.json();
        console.log("Publish Route Response:", publishData);
      }
    } catch (publishErr) {
      console.error("Failed to trigger social media publish:", publishErr);
    }

    return NextResponse.json({
      success: true,
      message: "Deal saved to Blob and social media triggered successfully!",
      deal: curatedDeal
    });

  } catch (error: any) {
    console.error("Cron Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}