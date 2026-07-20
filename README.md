I built an automated digital travel agency. It works by having several AI agents collaborate to create trips with flights and hotels, write an itinerary, and publish content to social media and a website, multiple times a day. It is a small example of how we can now automate an entire service.

You can instruct AI in different ways to build a trip. You might tell it to pick the lowest prices. But if you do, you may end up with a bad trip to an isolated destination. If you pick the highest price, you get an overpriced trip. The goal is balance. We want to extract value. These agents are instructed to find high quality at low prices. You control the shape of the trip just by changing the prompt in the backend code.

I build this project because I am seeing a global shift toward automating services. AI is replacing manual workflows. Tools like LangChain and LangGraph are becoming industry standards. But knowing the syntax is not enough. We have to know how to use them to create actual value. 

To make this work, I created a workflow to divide tasks among the agents. You can think of each AI agent as a junior employee who can only focus on one single task.

The process starts with an agent looking for flights. It looks for a good price, but it also considers how attractive the destination is for tourists. Then it passes the flight data, like destination and dates, to another agent. This second agent finds a hotel. It evaluates hotels based on price, discount, rating, and reviews. It does not just blindly pick the cheapest option.

Once the flight and hotel are locked in, the data moves to a research department to gather more facts. This department has eleven agents.

The transfer team finds transport between the airport and the hotel. It has a manager and three agents looking at taxis, buses, and ride-sharing apps. The manager reads their findings and writes a summary. The destination team focuses on the location. One agent finds activities. Another researches local culture and etiquette. A third checks the weather. They also have a manager who compiles their work. A separate currency expert handles exchange rates. Later, we could teach this agent to fetch local prices for everyday items so we understand the cost of living there.

Then we have two agents whose only job is to write text. One writes social media posts, and the other writes the website copy. The final step in the process is to publish everything to Instagram, Facebook, and the website.

You might look at this and think thirteen agents is a lot. You might assume it is expensive to run. But activating all these agents costs about 88 Swedish öre (approximately €0.08) per run.

If humans did this, it would be slow and costly. You would need a researcher, a copywriter, a graphic designer, and a social media manager. A process that used to take hours can now happen automatically, cheaply, and in under five minutes, without human intervention.




## Key Files

> **The Core Engine:** `api/generate-trip.py`
> This file contains all the agent logic, prompts, and the LangGraph state machine.

| Purpose | File Path |
|---|---|
| ⭐ **Agent Logic & Prompts** | **`api/generate-trip.py`** |
| **Frontend UI** | `app/page.tsx` |
| **Schedule & Timing** | `vercel.json` |
| **Cron Trigger & Save** | `app/api/cron/route.ts` |
| **Read & Serve Deals** | `app/api/get-deals/route.ts` |
| **Publish Content** | `app/api/publish/route.ts` |
| **Manual Save & Publish** | `app/api/save-and-publish/route.ts` |
| **Privacy Policy** | `app/privacy/page.tsx` |
| **Terms of Service** | `app/tos/page.tsx` |
