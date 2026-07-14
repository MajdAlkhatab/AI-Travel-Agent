/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

function getDealEconomics(deal: any) {
  const flightCurrent = deal.flight?.price || 0;
  const hotelTotalCurrent = deal.hotel?.total_rate?.extracted_lowest || 0;
  const totalCurrent = flightCurrent + hotelTotalCurrent;

  let hotelPct = 0;
  if (deal.hotel?.deal) {
    const match = deal.hotel.deal.match(/(\d+)\s*%/);
    if (match) hotelPct = parseInt(match[1], 10);
  }
  const hotelTotalOriginal = (hotelTotalCurrent && hotelPct > 0) ? hotelTotalCurrent / (1 - hotelPct / 100) : hotelTotalCurrent;
  const flightOriginal = deal.flight?.average_price || flightCurrent;
  const totalOriginal = flightOriginal + hotelTotalOriginal;

  const totalSavings = totalOriginal > totalCurrent ? totalOriginal - totalCurrent : 0;
  const totalSavingsPercent = totalSavings > 0 ? Math.round((totalSavings / totalOriginal) * 100) : 0;

  const rate = deal.exchange_rates?.SEK || 10.5;
  return {
    totalCurrent: Math.round(totalCurrent * rate),
    totalSavings: Math.round(totalSavings * rate),
    totalSavingsPercent
  };
}

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

    // Read the streaming response as plain text
    const rawText = await agentResponse.text();
    const lines = rawText.split('\n\n');
    
    let newDeal = null;

    // Loop through the stream chunks to find the "complete" payload
    for (const line of lines) {
      if (line.trim().startsWith('data: ')) {
        try {
          const payloadStr = line.replace('data: ', '').trim();
          if (!payloadStr) continue;
          
          const payload = JSON.parse(payloadStr);
          
          if (payload.type === 'complete') {
            newDeal = payload.data;
          } else if (payload.type === 'error') {
            throw new Error(`Python Agent Error: ${payload.message}`);
          }
        } catch (e) {
          // Ignore parse errors on incomplete chunks
        }
      }
    }

    if (!newDeal) {
      console.warn("No complete deal payload found in the stream.");
      return NextResponse.json({
        success: false,
        message: "Stream finished but no valid deal was found."
      });
    }
    
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
      const destinationImages = curatedDeal.destination_images || [];
      if (destinationImages.length === 0 && curatedDeal.flight?.thumbnail) {
        destinationImages.push(curatedDeal.flight.thumbnail);
      }
      
      const hotelImages = curatedDeal.hotel?.images?.map((img: any) => img.original_image || img.thumbnail) || [];
      const topDestImages = destinationImages.slice(0, 5);
      const topHotelImages = hotelImages.slice(0, 5);
      
      const imageUrls = [...topDestImages, ...topHotelImages]
        .filter((url): url is string => Boolean(url))
        .slice(0, 10);
      
      if (imageUrls.length > 0) {
        const socialCaption = `🔥 Nytt supererbjudande: ${curatedDeal.destination}, ${curatedDeal.country}!\n\n✈️ Flights & Hotel found.\n\nHere is the vibe:\n${curatedDeal.activity_summary}\n\nLink in bio to see the full itinerary and book before prices change! 🌍✨`;
        const economics = getDealEconomics(curatedDeal);
        
        // Extract specific details for images 2 and 3
        const s = new Date(curatedDeal.start_date).getTime();
        const e = new Date(curatedDeal.end_date).getTime();
        const nights = Math.round((e - s) / (1000 * 60 * 60 * 24)) || 2;
        
        let tempStr = '22°C'; 
        if (curatedDeal.activity_summary) {
          const m = curatedDeal.activity_summary.match(/(\d+\s*(?:°C|grader))/i);
          if (m) tempStr = m[1].replace(/grader/i, '°C').replace(' ', '');
        }

        const tripDetails = {
          travelers: curatedDeal.travelers || 2,
          nights: nights,
          depAirport: curatedDeal.flight?.departure_airport_code || 'ARN',
          arrAirport: curatedDeal.flight?.arrival_airport_code || 'DEST',
          temperature: tempStr
        };
        
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
            caption: socialCaption,
            economics: economics,
            tripDetails: tripDetails
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