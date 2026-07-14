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

    // 2. Extract multiple images for Carousel (50/50 split: 5 destination, 5 hotel)
    let destinationImages = curatedDeal.destination_images || [];
    
    // Fallback just in case the image search failed
    if (destinationImages.length === 0 && curatedDeal.flight?.thumbnail) {
      destinationImages.push(curatedDeal.flight.thumbnail);
    }

    const hotelImages = curatedDeal.hotel?.images?.map((img: any) => img.original_image || img.thumbnail) || [];
    
    // Take up to 5 from destination and up to 5 from hotel
    const topDestImages = destinationImages.slice(0, 5);
    const topHotelImages = hotelImages.slice(0, 5);
    
    const imageUrls = [...topDestImages, ...topHotelImages]
      .filter((url): url is string => Boolean(url))
      .slice(0, 10);

    // 3. Trigger your secure Instagram/Facebook cross-poster
    if (imageUrls.length > 0 && process.env.API_SECRET_KEY) {
      const socialCaption = `🔥 Nytt supererbjudande: ${curatedDeal.destination}, ${curatedDeal.country}!\n\n✈️ Flyg & hotell säkrat.\n\nSå här är stämningen:\n${curatedDeal.activity_summary}\n\nLänk i bion för att se hela resplanen och boka innan priserna ändras! 🌍✨`;
      const economics = getDealEconomics(curatedDeal);
      
      const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
      const host = request.headers.get('host');
      const publishUrl = `${protocol}://${host}/api/publish`;

      console.log("Triggering Carousel Social Media for manual hunt at:", publishUrl);

      await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.API_SECRET_KEY}`
        },
        body: JSON.stringify({
          imageUrls: imageUrls,
          caption: socialCaption,
          economics: economics
        })
      });
    }

    return NextResponse.json({ success: true, message: "Manually hunted trip saved and published successfully!" });

  } catch (error: any) {
    console.error("Save and publish endpoint failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}