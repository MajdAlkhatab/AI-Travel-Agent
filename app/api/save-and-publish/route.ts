import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

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

    // 2. Extract multiple images for Carousel (Max 10 for Instagram)
    // ÄNDRING HÄR: Välj original_image i första hand för högre upplösning
    const flightImage = curatedDeal.flight?.thumbnail;
    const hotelImages = curatedDeal.hotel?.images?.map((img: any) => img.original_image || img.thumbnail) || [];
    
    const imageUrls = [flightImage, ...hotelImages]
      .filter((url): url is string => Boolean(url))
      .slice(0, 10);

    // 3. Trigger your secure Instagram/Facebook cross-poster
    if (imageUrls.length > 0 && process.env.API_SECRET_KEY) {
      // --- SWEDISH TRANSLATION FOR SOCIAL MEDIA CAPTION ---
      const socialCaption = `🔥 Nytt supererbjudande: ${curatedDeal.destination}, ${curatedDeal.country}!\n\n✈️ Flyg & hotell säkrat.\n\nSå här är stämningen:\n${curatedDeal.activity_summary}\n\nLänk i bion för att se hela resplanen och boka innan priserna ändras! 🌍✨`;
      
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
          caption: socialCaption
        })
      });
    }

    return NextResponse.json({ success: true, message: "Manually hunted trip saved and published successfully!" });

  } catch (error: any) {
    console.error("Save and publish endpoint failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}