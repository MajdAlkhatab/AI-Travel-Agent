import os
import asyncio
import json
import re
import time
import random
from datetime import date, timedelta, datetime, timezone
from typing import TypedDict, Annotated, List, Union

import serpapi
from dotenv import load_dotenv
from tavily import TavilyClient
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from langchain_openai import ChatOpenAI
from langchain.agents import create_agent
from langchain.tools import tool
from langchain.messages import HumanMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.graph import StateGraph, START, END

# --- 1. SETUP & INITIALIZATION ---
load_dotenv()

SERP_API_KEY = os.getenv("SERP_API_KEY")
serp_client = serpapi.Client(api_key=SERP_API_KEY)
tavily = TavilyClient()
llm = ChatOpenAI(model="gpt-5-nano") 

# Departure airports to try, in order, if the requested one has no usable
# deals this run. Stockholm Arlanda first (larger hub, more deal volume),
# then Göteborg Landvetter. Swap the order below to prefer GOT first.
DEPARTURE_FALLBACKS = ["ARN", "GOT"]  # Stockholm Arlanda, Göteborg Landvetter

# --- 2. AI PYDANTIC MODELS ---
class DestinationArea(BaseModel):
    destination: str

class FilteredCities(BaseModel):
    cities: list[str] = Field(description="List of filtered cities ordered from most to least popular. No duplicates.")

class HotelWinner(BaseModel):
    hotel_name: str = Field(description="The exact name of the winning hotel")
    verdict: str = Field(description="A concise summary of why this is the best balanced option.")

structured_llm = llm.with_structured_output(DestinationArea)

# --- 3. GRAPH STATE SCHEMA ---
class TravelPlanState(TypedDict):
    departure_id: str
    travelers: int
    duration: str
    home_currency: str
    exclude_destinations: List[str]
    user_preference: str  # NEW: beach or city

    flight: dict
    hotel: dict
    destination: str
    country: str
    start_date: str
    end_date: str
    hotel_area: str
    destination_images: List[str] 

    raw_flight_response: dict
    raw_hotel_response: dict

    transport_summary: str
    activity_summary: str
    currency_summary: str
    
    final_itinerary: str
    social_caption: str 

# --- 4. CORE LOGIC ---
def get_upcoming_weekends(weeks=3):
    """Calculates exact (Friday, Sunday) dates for upcoming weekends."""
    weekends = []
    today = date.today()
    days_ahead = 4 - today.weekday()
    if days_ahead <= 0: 
        days_ahead += 7
    next_friday = today + timedelta(days=days_ahead)
    
    for i in range(weeks):
        fri = next_friday + timedelta(days=i*7)
        sun = fri + timedelta(days=2)
        weekends.append((fri.isoformat(), sun.isoformat()))
    return weekends

def flexible_date_range(days_ahead=60):
    today = date.today()
    tomorrow = today + timedelta(days=1)
    end = today + timedelta(days=days_ahead)
    return f"{tomorrow.isoformat()},{end.isoformat()}"

def get_flight_deals(departure_id, outbound_date, return_date=None, travel_duration=None, currency="USD", gl="us", hl="en"):
    params = {
        "engine": "google_flights_deals",
        "departure_id": departure_id,
        "outbound_date": outbound_date,
        "currency": currency,
        "gl": gl, "hl": hl,
    }
    if return_date:
        params["return_date"] = return_date
    if travel_duration:
        params["travel_duration"] = travel_duration

    print(f"[flight-search] request departure_id={departure_id} outbound={outbound_date}")

    start = time.monotonic()
    raw_result = serp_client.search(params)
    result = raw_result.as_dict()
    elapsed_ms = round((time.monotonic() - start) * 1000, 1)

    metadata = result.get("search_metadata", {}) or {}
    print(
        f"[flight-search] response departure_id={departure_id} "
        f"status={metadata.get('status')} search_id={metadata.get('id')} "
        f"elapsed_ms={elapsed_ms}"
    )

    error = result.get("error")
    if error:
        deals_url = metadata.get("google_flights_deals_url")
        print(f"[flight-search] ERROR departure_id={departure_id} error={error!r} check_url={deals_url}")
        if "empty results" in str(error).lower():
            return result
        raise RuntimeError(f"google_flights_deals failed: {error}")

    deals = result.get("deals", [])
    print(f"[flight-search] departure_id={departure_id} returned {len(deals)} raw deals")
    return result

def get_hotel_deals(destination, check_in_date, check_out_date, adults=2, currency="USD", gl="us", hl="en", special_offers="true"):
    params = {
        "engine": "google_hotels",
        "q": f"{destination} hotels",
        "check_in_date": check_in_date,
        "check_out_date": check_out_date,
        "adults": adults,
        "currency": currency,
        "gl": gl, "hl": hl,
        "special_offers": special_offers,
    }

    print(f"[hotel-search] request q='{destination} hotels' check_in={check_in_date} check_out={check_out_date} adults={adults} special_offers={special_offers}")

    start = time.monotonic()
    raw_result = serp_client.search(params)
    result = raw_result.as_dict()
    elapsed_ms = round((time.monotonic() - start) * 1000, 1)

    metadata = result.get("search_metadata", {}) or {}
    print(
        f"[hotel-search] response destination='{destination}' "
        f"status={metadata.get('status')} search_id={metadata.get('id')} "
        f"elapsed_ms={elapsed_ms}"
    )

    error = result.get("error")
    if error:
        print(f"[hotel-search] ERROR destination='{destination}' error={error!r}")
        if "empty results" in str(error).lower():
            return result
        raise RuntimeError(f"google_hotels failed: {error}")

    properties = result.get("properties", [])
    print(f"[hotel-search] destination='{destination}' returned {len(properties)} properties")
    return result

async def get_best_hotel_area(city, country):
    prompt = f"What is the single most popular tourist destination/area for hotels in or near {city}, {country}? Reply with just the destination name."
    result = await structured_llm.ainvoke(prompt)
    print(f"[hotel-area] {city}, {country} -> {result.destination}")
    return result.destination

def get_destination_images(query: str, max_images: int = 5) -> List[str]:
    params = {
        "engine": "google_images",
        "q": query,
        "gl": "us",
        "hl": "en",
    }
    print(f"[image-search] requesting images for '{query}'")
    try:
        raw_result = serp_client.search(params)
        result = raw_result.as_dict()
        images_results = result.get("images_results", [])
        
        urls = []
        for img in images_results:
            original = img.get("original")
            if original and isinstance(original, str):
                urls.append(original)
            if len(urls) >= max_images:
                break
                
        print(f"[image-search] found {len(urls)} images")
        return urls
    except Exception as e:
        print(f"[image-search] ERROR fetching images: {e}")
        return []

def hotel_discount_percent(hotel):
    match = re.search(r"(\d+)%", hotel.get("deal", ""))
    return int(match.group(1)) if match else 0

@tool
def web_search(query: str) -> str:
    """Search the web for current data (transport, weather, activities)."""
    return str(tavily.search(query))

taxi_executor = create_agent(model="gpt-5-nano", tools=[web_search], system_prompt="You are a taxi expert. Search for the exact taxi fare price and duration from the airport to the hotel. Return ONLY the price and duration without fluff. Reply strictly in Swedish.")
bus_executor = create_agent(model="gpt-5-nano", tools=[web_search], system_prompt="You are a public transport expert. Search for the bus/train ticket price and duration from the airport to the hotel. Return ONLY the price and duration without fluff. Reply strictly in Swedish.")
app_executor = create_agent(model="gpt-5-nano", tools=[web_search], system_prompt="You are a ride-hailing expert. Search for Uber/Bolt fare prices and duration from the airport to the hotel. Return ONLY the price and duration without fluff. Reply strictly in Swedish.")

transport_main_agent = create_agent(model="gpt-5-nano", tools=[], system_prompt="Compare the Taxi, Bus, and App choices. Output a clean, simple bulleted list in Swedish with NO introductory text. Format exactly like this:\n- **Taxi**: [Pris] ([Tidsåtgång])\n- **Buss**: [Pris] ([Tidsåtgång])\n- **Uber/Bolt**: [Pris] ([Tidsåtgång])\n\n**Slutgiltigt val**: [Din korta rekommendation på svenska].")
weather_executor = create_agent(model="gpt-5-nano", tools=[web_search], system_prompt="You are a weather expert. Get forecast. Return short answer strictly in Swedish.")
activities_executor = create_agent(model="gpt-5-nano", tools=[web_search], system_prompt="You are an activities expert. Get free/cheap things to do. Return short answer strictly in Swedish.")
culture_executor = create_agent(model="gpt-5-nano", tools=[], system_prompt="You are a cultural expert. Research the destination and provide exactly 6 things strictly in Swedish: one 'Gör' (Do), one 'Gör inte' (Don't), one local slang word (with meaning), one strict dining/tipping rule, a one-sentence 'vibe check' of the city's pace, and a list of the top 3 must-try local foods.")

activity_main_agent = create_agent(model="gpt-5-nano", tools=[], system_prompt="Summarize the destination in Swedish. Use exactly three Markdown headers: '### 🌤️ Väder', '### 🎯 Toppaktiviteter', and '### 🏛️ Kultur & Vett och etikett'. Under each header, provide Weather (3 short, punchy bullet points) Activities (6 short, punchy bullet points) Culture & Etiquette (Exactly 6 bullet points: Gör, Gör inte, Slang, Restaurang/Dricks, Vibe, and Topp 3 maträtter. CRITICAL: Each must be strictly one short sentence). CRITICAL: DO NOT include budget breakdowns, total trip estimates, or flight/hotel costs.")

tavily_currency_executor = create_agent(model="gpt-5-nano", tools=[web_search], system_prompt="Search web for exchange rate. Return short answer without mentioning any dates. Reply strictly in Swedish.")

_frankfurter_executor = None
async def get_frankfurter_executor():
    global _frankfurter_executor
    if _frankfurter_executor is None:
        client = MultiServerMCPClient({"frankfurter": {"transport": "streamable_http", "url": "https://mcp.frankfurter.dev/"}})
        tools = await client.get_tools()
        _frankfurter_executor = create_agent(model="gpt-5-nano", tools=tools, system_prompt="Use get_rates to find exchange rate. Return short answer without mentioning any dates. Reply strictly in Swedish.")
    return _frankfurter_executor

# --- 5. LANGGRAPH NODES ---
async def node_trip_deals(state: TravelPlanState):
    user_preference = state.get("user_preference", "beach")
    duration_type = state["duration"]
    departure_id = state["departure_id"]
    exclude = {c.strip().lower() for c in state.get("exclude_destinations", []) if c and c.strip()}

    print(f"[trip-deals] starting run: pref={user_preference} exclude={exclude}")

    # 1. Smart Date Selection
    if duration_type == "2":
        # 🎲 RANDOMLY select just ONE weekend to save API credits and force exact dates
        weekends = get_upcoming_weekends(3)
        target_outbound, target_return = random.choice(weekends)
        duration_param = None
        print(f"[trip-deals] Selected Exact Weekend: {target_outbound} to {target_return}")
    else:
        # Flexible range for 1 or 2 weeks
        target_outbound = flexible_date_range(60)
        target_return = None
        duration_param = duration_type
        print(f"[trip-deals] Selected Flexible Dates: {target_outbound} (Duration: {duration_param})")

    departure_ids_to_try = [departure_id] + [d for d in DEPARTURE_FALLBACKS if d != departure_id]
    
    best_flight = None
    raw_flight_response = None
    raw_flights = []

    # 2. Flight Hunt
    for dep_id in departure_ids_to_try:
        raw_flight_response = get_flight_deals(dep_id, target_outbound, target_return, duration_param)
        deals = raw_flight_response.get("deals", [])
        if deals:
            raw_flights = deals
            break
        print(f"[trip-deals] no eligible flight from {dep_id}, trying next fallback airport...")

    if not raw_flights:
        print(f"[trip-deals] FINAL: no deals found across {departure_ids_to_try}")
        return {"destination": None, "raw_flight_response": raw_flight_response}

    eligible_flights = [
        f for f in raw_flights 
        if f.get("outbound_date") and f.get("return_date") 
        and f.get("country", "").strip().lower() not in exclude
    ]

    if not eligible_flights:
        print(f"[trip-deals] FINAL: no eligible deals after exclusions")
        return {"destination": None, "raw_flight_response": raw_flight_response}

    # 3. AI-Powered Filtering & Ranking
    raw_city_list = [f.get("name") for f in eligible_flights if f.get("name")]
    prompt_modifier = (
        "the most popular beach and summer destinations" if user_preference == "beach" 
        else "the world's most visited tourist destinations with no beach and summer"
    )
    
    prompt = f"""
    Here is a raw list of destination cities pulled from our flight data (duplicates included): 
    {raw_city_list}

    Which of these cities are {prompt_modifier}? 
    Return ONLY the cities from this list that match the criteria. 
    Order the final list strictly from MOST popular to LEAST popular. 
    Ensure there are NO DUPLICATES in your final returned list.
    """
    
    filter_llm = llm.with_structured_output(FilteredCities)
    res_cities = await filter_llm.ainvoke(prompt)
    ranked_cities = res_cities.cities

    if not ranked_cities:
        print(f"[trip-deals] FINAL: AI filtered out all cities")
        return {"destination": None, "raw_flight_response": raw_flight_response}

    # 4. Locking in the Destination
    target_city_lower = ranked_cities[0].lower()
    flights_to_winner = [f for f in eligible_flights if f.get("name", "").lower() == target_city_lower]
    flights_to_winner = sorted(flights_to_winner, key=lambda d: d.get("discount_percentage", 0), reverse=True)
    
    if not flights_to_winner:
        return {"destination": None, "raw_flight_response": raw_flight_response}

    best_flight = flights_to_winner[0]
    city, country = best_flight["name"], best_flight["country"]
    check_in, check_out = best_flight["outbound_date"], best_flight["return_date"]

    dest_query = f"{city} {country} tourism landmarks high quality"
    destination_images = get_destination_images(dest_query, max_images=5)

    # 5. The Ultimate Hotel Judge
    hotel_area = await get_best_hotel_area(city, country)
    raw_hotel_response = get_hotel_deals(f"{hotel_area}, {country}", check_in, check_out, adults=state["travelers"])
    hotels = raw_hotel_response.get("properties", [])
    
    if not hotels:
        print(f"[trip-deals] No special offers found for {city}. Trying without filter...")
        raw_hotel_response = get_hotel_deals(
            f"{hotel_area}, {country}", check_in, check_out, adults=state["travelers"], special_offers="false"
        )
        hotels = raw_hotel_response.get("properties", [])
    
    best_hotel = None
    if hotels:
        formatted_hotels = []
        for h in hotels[:10]:
            formatted_hotels.append(
                f"- Name: {h.get('name')}\n"
                f"  Price: {h.get('rate_per_night', {}).get('lowest', 'N/A')}/night\n"
                f"  Discount: {hotel_discount_percent(h)}%\n"
                f"  Rating: {h.get('overall_rating', 'N/A')}⭐\n"
                f"  Reviews: {h.get('reviews', 0)}\n"
            )
        
        judge_prompt = f"""
        Here is a list of available hotels in {city}, {country}:
        {"".join(formatted_hotels)}
        
        You are an expert travel analyst. Evaluate this list and select the single BEST overall choice 
        based on an equal balance of 4 factors: Price, Discount %, Number of Reviews, and Star Rating.
        Do only choose Hotel, not Hostel.
        """
        
        hotel_llm = llm.with_structured_output(HotelWinner)
        winning_hotel_eval = await hotel_llm.ainvoke(judge_prompt)
        
        # Match AI winner back to the hotel dict
        chosen_name_lower = winning_hotel_eval.hotel_name.lower()
        for h in hotels:
            if h.get('name', '').lower() == chosen_name_lower:
                best_hotel = h
                break
        
        if not best_hotel:
            best_hotel = hotels[0]
            
        # Store verdict to display on the frontend if needed
        best_hotel['deal_description'] = winning_hotel_eval.verdict 

    print(f"[trip-deals] FINAL: {city}, {country} | hotel={'yes' if best_hotel else 'none found'}")
    
    return {
        "flight": best_flight,
        "hotel": best_hotel,
        "destination": city,
        "country": country,
        "start_date": check_in,
        "end_date": check_out,
        "hotel_area": hotel_area,
        "destination_images": destination_images,
        "raw_flight_response": raw_flight_response,
        "raw_hotel_response": raw_hotel_response,
    }

async def node_transport(state: TravelPlanState):
    hotel_name = state['hotel'].get('name', state['hotel_area']) if state.get('hotel') else state['hotel_area']
    loc = f"{hotel_name}, {state['destination']}"
    query = f"Airport: {state['flight']['arrival_airport_code']}\nDates: {state['start_date']}-{state['end_date']}\nHotel: {loc}\nCRITICAL: Convert and state all prices in {state['home_currency']}."
    t_res, b_res, a_res = await asyncio.gather(
        taxi_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
        bus_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
        app_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
    )
    summary = f"Taxi: {t_res['messages'][-1].content}\nBus: {b_res['messages'][-1].content}\nApp: {a_res['messages'][-1].content}\nCRITICAL: Format all final output prices in {state['home_currency']}."
    final = await transport_main_agent.ainvoke({"messages": [HumanMessage(content=summary)]})
    return {"transport_summary": final["messages"][-1].content}

async def node_activities(state: TravelPlanState):
    query = f"Destination: {state['destination']}, {state['country']}\nDates: {state['start_date']} to {state['end_date']}\nCRITICAL: Convert and state all prices in {state['home_currency']}."
    w_res, a_res, c_res = await asyncio.gather(
        weather_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
        activities_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
        culture_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
    )
    summary = f"Weather: {w_res['messages'][-1].content}\nActs: {a_res['messages'][-1].content}\nCulture: {c_res['messages'][-1].content}\nCRITICAL: Format any prices mentioned in {state['home_currency']}."
    final = await activity_main_agent.ainvoke({"messages": [HumanMessage(content=summary)]})
    return {"activity_summary": final["messages"][-1].content}

async def node_currency(state: TravelPlanState):
    query = f"Exchange rate from {state['home_currency']} currency to {state['country']} currency?"
    try:
        frank_exec = await get_frankfurter_executor()
        res = await frank_exec.ainvoke({"messages": [HumanMessage(content=query)]})
        response = res["messages"][-1].content
        if len(response.strip()) < 20: raise ValueError("Too short.")
        ans = response
    except Exception:
        res = await tavily_currency_executor.ainvoke({"messages": [HumanMessage(content=query)]})
        ans = res["messages"][-1].content
    return {"currency_summary": ans}

async def node_synthesize(state: TravelPlanState):
    itin_prompt = f"""
    You are a professional travel agent. Provide ONLY a punchy, day-by-day itinerary for the trip strictly in Swedish. 
    CRITICAL INSTRUCTIONS: 
    1. DO NOT summarize or mention the flight details, hotel names, prices, weather forecasts, or currency exchange rates in this output. 
    2. Format each day as a distinct Markdown header (e.g., ### Dag 1 - 20 Aug).
    3. Under each day header, use simple bullet points for Förmiddag (Morning), Eftermiddag (Afternoon), and Kväll (Evening) activities.
    
    Destination: {state['destination']}, {state['country']} ({state['start_date']} till {state['end_date']})
    Transport Context: {state['transport_summary']}
    Activities/Culture Context: {state['activity_summary']}
    """
    
    social_prompt = f"""
    Kontext om resan (Hämta inspiration härifrån men skriv om det snyggt):
    {state['activity_summary']}

    Du är en expert på sociala medier för en svensk resebyrå. 
    Skriv en extremt engagerande, säljande och emoji-rik bildtext för Instagram/Facebook om ett nytt resepaket till {state['destination']}, {state['country']}.

    CRITICAL INSTRUCTIONS 
    1. Allt ska vara på naturlig svenska
    2. Börja med en stark, levande inledning/hook baserad på stadens vibbar
    3. Ta INTE med några info om priser och kostnader, även om något är fri  
    4. Använd fina Emojis istället för fula Markdown-rubriker. ANVÄND ALDRIG "###".
    5. Strukturera inlägget med: 1. Inledning, 2. Kort om vädret 🌤, 3. "Missa inte:", 4. "💡 Bra att veta:".
    6. Skriv inte ut rubrikerna (t.ex. "1. Inledning" eller "2. Kort om vädret"), utan skriv endast innehållet.
    7. Skriv inte "–"
    8. Avsluta ALLTID inlägget med något linknande till denna mening och radbrytning: 
       "Länk i bion för att se exakta priser, hela resplanen och boka innan priset ändras! ✈️👇"
    """

    res_itin, res_social = await asyncio.gather(
        llm.ainvoke([HumanMessage(content=itin_prompt)]),
        llm.ainvoke([HumanMessage(content=social_prompt)])
    )
    
    return {
        "final_itinerary": res_itin.content,
        "social_caption": res_social.content
    }

# --- 6. GRAPH WIRING ---
def route_after_deals(state: TravelPlanState) -> Union[List[str], str]:
    if not state.get("destination"): return END 
    return ["transport", "activities", "currency"]

builder = StateGraph(TravelPlanState)
builder.add_node("trip_deals", node_trip_deals)
builder.add_node("transport", node_transport)
builder.add_node("activities", node_activities)
builder.add_node("currency", node_currency)
builder.add_node("synthesize", node_synthesize)

builder.add_edge(START, "trip_deals")
builder.add_conditional_edges("trip_deals", route_after_deals, ["transport", "activities", "currency", END])
builder.add_edge("transport", "synthesize")
builder.add_edge("activities", "synthesize")
builder.add_edge("currency", "synthesize")
builder.add_edge("synthesize", END)
graph = builder.compile()

# --- 7. FASTAPI APPLICATION SETUP ---
app = FastAPI()

@app.get("/")
@app.get("/api/generate-trip")
async def generate_trip(
    departure_id: str = "ARN", 
    travelers: int = 2, 
    duration: str = "2", 
    home_currency: str = "SEK", 
    exclude_destinations: str = "",
    user_preference: str = "beach", # NEW PARAMETER
):
    inputs = {
        "departure_id": departure_id,
        "travelers": travelers,
        "duration": duration, 
        "home_currency": home_currency,
        "exclude_destinations": [c for c in exclude_destinations.split(",") if c.strip()],
        "user_preference": user_preference, # PASS TO GRAPH
    }
    
    async def event_stream():
        current_state = inputs.copy()
        try:
            async for event in graph.astream(inputs):
                for node_name, node_output in event.items():
                    current_state.update(node_output)
                    
                    yield f"data: {json.dumps({'type': 'status', 'node': node_name})}\n\n"
                    
                    if node_name == "trip_deals" and not current_state.get("destination"):
                        yield f"data: {json.dumps({'type': 'empty'})}\n\n"
                        return
                    
                    if node_name == "synthesize":
                        current_state["created_at"] = datetime.now(timezone.utc).isoformat()
                        yield f"data: {json.dumps({'type': 'complete', 'data': current_state})}\n\n"
                        
        except Exception as e:
            print(f"[generate-trip] EXCEPTION: {e!r}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")