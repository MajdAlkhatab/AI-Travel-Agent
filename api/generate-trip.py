import os
import asyncio
import json
import re
import time
from datetime import date, timedelta, datetime, timezone
from typing import TypedDict, Annotated, List, Union

import serpapi
from dotenv import load_dotenv
from tavily import TavilyClient
from pydantic import BaseModel
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

class Destination(BaseModel):
    destination: str

structured_llm = llm.with_structured_output(Destination)

# Departure airports to try, in order, if the requested one has no usable
# deals this run. Stockholm Arlanda first (larger hub, more deal volume),
# then Göteborg Landvetter. Swap the order below to prefer GOT first.
DEPARTURE_FALLBACKS = ["ARN", "GOT"]  # Stockholm Arlanda, Göteborg Landvetter

# --- 2. GRAPH STATE SCHEMA ---
class TravelPlanState(TypedDict):
    departure_id: str
    travelers: int
    duration: str
    home_currency: str
    exclude_destinations: List[str]

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
    social_caption: str # NYTT FÄLT FÖR SOCIALA MEDIER

# --- 3. CORE LOGIC ---
def flexible_date_range(days_ahead=60):
    today = date.today()
    tomorrow = today + timedelta(days=1)
    end = today + timedelta(days=days_ahead)
    return f"{tomorrow.isoformat()},{end.isoformat()}"

def get_flight_deals(departure_id, outbound_date_range, travel_duration="2", currency="USD", gl="us", hl="en"):
    params = {
        "engine": "google_flights_deals",
        "departure_id": departure_id,
        "outbound_date": outbound_date_range,
        "travel_duration": travel_duration,
        "currency": currency,
        "gl": gl, "hl": hl,
    }

    print(f"[flight-search] request departure_id={departure_id} outbound_date={outbound_date_range} travel_duration={travel_duration} currency={currency}")

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

def get_best_hotel_area(city, country):
    prompt = f"What is the single most popular tourist destination/area for hotels in or near {city}, {country}? Reply with just the destination name."
    result = structured_llm.invoke(prompt)
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

def pick_best_flight(flights, exclude, departure_id=None):
    total = len(flights)
    missing_dates = [f for f in flights if not (f.get("outbound_date") and f.get("return_date"))]
    valid_dated = [f for f in flights if f.get("outbound_date") and f.get("return_date")]
    excluded = [f for f in valid_dated if f.get("country", "").strip().lower() in exclude]
    eligible = [f for f in valid_dated if f.get("country", "").strip().lower() not in exclude]

    print(
        f"[pick-flight] departure_id={departure_id} total={total} "
        f"missing_dates={len(missing_dates)} excluded_by_country={len(excluded)} "
        f"eligible={len(eligible)} exclude_set={sorted(exclude) if exclude else []}"
    )
    if excluded:
        excluded_countries = sorted({f.get('country') for f in excluded})
        print(f"[pick-flight] departure_id={departure_id} excluded countries this batch: {excluded_countries}")

    deals_by_discount = sorted(eligible, key=lambda d: d.get("discount_percentage", 0), reverse=True)
    best = deals_by_discount[0] if deals_by_discount else None
    if best:
        print(
            f"[pick-flight] departure_id={departure_id} SELECTED "
            f"{best.get('name')}, {best.get('country')} "
            f"(${best.get('price')}, {best.get('discount_percentage')}% off)"
        )
    return best

@tool
def web_search(query: str) -> str:
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

# --- 4. LANGGRAPH NODES ---
async def node_trip_deals(state: TravelPlanState):
    dates = flexible_date_range(60)
    exclude = {c.strip().lower() for c in state.get("exclude_destinations", []) if c and c.strip()}

    departure_ids_to_try = [state["departure_id"]] + [
        d for d in DEPARTURE_FALLBACKS if d != state["departure_id"]
    ]

    print(f"[trip-deals] starting run: fallback_chain={departure_ids_to_try} exclude_destinations={state.get('exclude_destinations')}")

    best_flight = None
    raw_flight_response = None

    for departure_id in departure_ids_to_try:
        raw_flight_response = get_flight_deals(departure_id, dates, travel_duration=state["duration"])
        flights = raw_flight_response.get("deals", [])
        best_flight = pick_best_flight(flights, exclude, departure_id=departure_id)
        if best_flight:
            break
        print(f"[trip-deals] no eligible flight from {departure_id}, trying next fallback airport...")

    if not best_flight:
        print(f"[trip-deals] FINAL: no deal found across {departure_ids_to_try}")
        return {"destination": None, "raw_flight_response": raw_flight_response}

    city, country = best_flight["name"], best_flight["country"]
    check_in, check_out = best_flight["outbound_date"], best_flight["return_date"]
    
    dest_query = f"{city} {country} tourism landmarks high quality"
    destination_images = get_destination_images(dest_query, max_images=5)
    
    hotel_area = get_best_hotel_area(city, country)
    raw_hotel_response = get_hotel_deals(f"{hotel_area}, {country}", check_in, check_out, adults=state["travelers"])
    hotels = raw_hotel_response.get("properties", [])
    
    if not hotels:
        print(f"[trip-deals] No special offers found for {city}. Trying without filter...")
        raw_hotel_response = get_hotel_deals(
            f"{hotel_area}, {country}", check_in, check_out, adults=state["travelers"], special_offers="false"
        )
        hotels = raw_hotel_response.get("properties", [])
    
    best_hotel = max(hotels, key=hotel_discount_percent) if hotels else None
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
    # Agent 1: Itinerary (For the Frontend Dashboard)
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
    
    # Agent 2: Social Media Caption (For Instagram/Facebook API)
    social_prompt = f"""
    Kontext om resan (Hämta inspiration härifrån men skriv om det snyggt):
    {state['activity_summary']}

    Du är en expert på sociala medier för en svensk resebyrå. 
    Skriv en extremt engagerande, säljande och emoji-rik bildtext för Instagram/Facebook om ett nytt resepaket till {state['destination']}, {state['country']}.

    CRITICAL INSTRUCTIONS 
    1. Allt ska vara på naturlig svenska
    2. Börja med en stark, levande inledning/hook baserad på stadens vibbar
    3. Ta INTE med några info om priser överhuvudtaget 
    4. Använd fina Emojis istället för fula Markdown-rubriker. ANVÄND ALDRIG "###".
    5. Strukturera inlägget med: 1. Inledning, 2. Kort om vädret 🌤, 3. "Missa inte:", 4. "💡 Bra att veta:". Men skriv inte "1. Inledning" och "2. Kort om vädret", skriv det på ett naturligt sätt.
    6. Avsluta ALLTID inlägget med något linknande till denna mening och radbrytning: 
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

# --- 5. GRAPH WIRING ---
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

# --- 6. FASTAPI APPLICATION SETUP ---
app = FastAPI()

@app.get("/")
@app.get("/api/generate-trip")
async def generate_trip(
    departure_id: str = "ARN", 
    travelers: int = 2, 
    duration: str = "2", 
    home_currency: str = "SEK", 
    exclude_destinations: str = "",
):
    inputs = {
        "departure_id": departure_id,
        "travelers": travelers,
        "duration": duration, 
        "home_currency": home_currency,
        "exclude_destinations": [c for c in exclude_destinations.split(",") if c.strip()],
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