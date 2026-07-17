/* eslint-disable @typescript-eslint/no-explicit-any */
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

export async function POST(request: Request) {
  try {
    const curatedDeal = await request.json();

    // 1. Permanently save manual trip to your website database (Vercel Blob)
    let existingDeals: any[] = [];
    const { blobs } = await list({ prefix: 'deals.json' });

    if (blobs.length > 0) {
      const blobResponse = await fetch(blobs[0].url, { cache: 'no-store' });
      if (blobResponse.ok) {
        existingDeals = await blobResponse.json();
      }
    }

    existingDeals.unshift(curatedDeal);
    if (existingDeals.length > 60) {
      existingDeals = existingDeals.slice(0, 60);
    }

    await put('deals.json', JSON.stringify(existingDeals), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });

    // 2. Extract multiple images for Carousel (50/50 split)
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

    // 3. Trigger your secure Instagram/Facebook cross-poster
    if (imageUrls.length > 0 && process.env.API_SECRET_KEY) {
      
      // ANVÄNDER DEN NYA SOCIALA MEDIER-AGENTENS TEXT
      const socialCaption = curatedDeal.social_caption || `Sugen på en resa? 🌍✨\n\nVi har precis hittat ett supererbjudande till ${curatedDeal.destination}, ${curatedDeal.country}! Flyg & hotell säkrat.\n\nLänk i bion för att se hela resplanen och boka innan priserna ändras! ✈️👇`;
      
      const economics = getDealEconomics(curatedDeal);

      // Extract specific details for images 2 and 3
      const s = new Date(curatedDeal.start_date).getTime();
      const e = new Date(curatedDeal.end_date).getTime();
      const nights = Math.round((e - s) / (1000 * 60 * 60 * 24)) || 2;
      
      let tempStr = '22°C'; // Default fallback
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
      
      const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
      const host = request.headers.get('host');
      const publishUrl = `${protocol}://${host}/api/publish`;

      console.log("Triggering Carousel Social Media for manual hunt at:", publishUrl);

      await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.API_SECRET_KEY}`,
          'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET || ''
        },
        body: JSON.stringify({
          imageUrls: imageUrls,
          caption: socialCaption,
          economics: economics,
          tripDetails: tripDetails,
          locationText: `${curatedDeal.destination}, ${curatedDeal.country}`
        })
      });
    }

    return NextResponse.json({ success: true, message: "Manually hunted trip saved and published successfully!" });

  } catch (error: any) {
    console.error("Save and publish endpoint failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}