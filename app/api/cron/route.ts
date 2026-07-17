import { NextResponse } from 'next/server';

// CRITICAL: AI takes time. Allow this function to run for up to 5 minutes.
// (Note: Vercel Hobby plan limits this to 10-60 seconds. You may need a Pro plan for LLM tasks).
export const maxDuration = 300; 

export async function GET(request: Request) {
  try {
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;

    // 1. Trigger your AI Agents (using default parameters)
    const aiResponse = await fetch(`${baseUrl}/api/generate-trip?departure_id=ARN&travelers=2&duration=2&home_currency=SEK&user_preference=beach`);
    if (!aiResponse.body) throw new Error("No readable stream");

    // 2. Read the stream until we get the final deal
    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let finalDeal = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = JSON.parse(line.substring(6));
          if (payload.type === 'complete') {
            finalDeal = payload.data;
          } else if (payload.type === 'error' || payload.type === 'empty') {
            return NextResponse.json({ status: payload.type, message: payload.message || "No deals found today." });
          }
        }
      }
    }

    if (!finalDeal) throw new Error("Stream finished without generating a deal.");

    // 3. Save to Blob and Push to Meta
    const publishRes = await fetch(`${baseUrl}/api/save-and-publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalDeal)
    });
    
    const publishResult = await publishRes.json();

    return NextResponse.json({ 
      success: true, 
      destination: finalDeal.destination, 
      published: publishResult 
    });

  } catch (error: any) {
    console.error("Cron execution failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}