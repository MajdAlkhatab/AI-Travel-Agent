import os
import asyncio
import json
import re
from datetime import date, timedelta, datetime, timezone
from typing import TypedDict, Annotated, List, Union

import serpapi
from dotenv import load_dotenv
from tavily import TavilyClient
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException

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
    # Countries to skip when picking a flight deal — used to avoid repeating
    # the same destination across recent runs (e.g. last 7 saved trips).
    exclude_destinations: List[str]

    flight: dict
    hotel: dict
    destination: str
    country: str
    start_date: str
    end_date: str
    hotel_area: str

    # Full, untouched SerpApi responses — kept alongside the curated fields
    # above so the raw payload (images, thumbnails, etc.) is preserved for
    # future frontend use without changing anything else downstream.
    raw_flight_response: dict
    raw_hotel_response: dict

    transport_summary: str
    activity_summary: str
    currency_summary: str
    
    final_itinerary: str

# --- 3. CORE LOGIC ---
def flexible_date_range(days_ahead=60):
    today = date.today()
    tomorrow = today + timedelta(days=1)
    end = today + timedelta(days=days_ahead)
    return f"{tomorrow.isoformat()},{end.isoformat()}"

def get_flight_deals(departure_id, outbound_date_range, travel_duration="1", currency="USD", gl="us", hl="en"):
    params = {
        "engine": "google_flights_deals",
        "departure_id": departure_id,
        "outbound_date": outbound_date_range,
        "travel_duration": travel_duration,
        "currency": currency,
        "gl": gl, "hl": hl,
    }
    result = serp_client.search(params)
    error = result.get("error")
    if error:
        # "Empty results" just means no deals matched this search window —
        # that's an expected day-to-day outcome, not a real failure. Let the
        # pipeline handle it gracefully downstream instead of 500ing.
        if "empty results" in str(error).lower():
            print(f"No flight deals found for departure_id={departure_id}: {error}")
            return result
        raise RuntimeError(f"google_flights_deals failed: {error}")
    # Return the full raw response instead of just the "deals" list, so the
    # caller can both extract deals AND keep the untouched payload.
    return result

def get_hotel_deals(destination, check_in_date, check_out_date, adults=2, currency="USD", gl="us", hl="en"):
    params = {
        "engine": "google_hotels",
        "q": f"{destination} hotels",
        "check_in_date": check_in_date,
        "check_out_date": check_out_date,
        "adults": adults,
        "currency": currency,
        "gl": gl, "hl": hl,
        "special_offers": "true",
    }
    result = serp_client.search(params)
    error = result.get("error")
    if error:
        if "empty results" in str(error).lower():
            print(f"No hotel deals found for {destination}: {error}")
            return result
        raise RuntimeError(f"google_hotels failed: {error}")
    # Return the full raw response instead of just "properties", same reason
    # as get_flight_deals above.
    return result

def get_best_hotel_area(city, country):
    prompt = f"What is the single most popular tourist destination/area for hotels in or near {city}, {country}? Reply with just the destination name."
    result = structured_llm.invoke(prompt)
    return result.destination

def hotel_discount_percent(hotel):
    match = re.search(r"(\d+)%", hotel.get("deal", ""))
    return int(match.group(1)) if match else 0

def pick_best_flight(flights, exclude):
    """Sort by discount and return the first deal with valid dates whose
    country isn't in the excluded set. None if nothing qualifies."""
    deals_by_discount = sorted(flights, key=lambda d: d.get("discount_percentage", 0), reverse=True)
    return next(
        (
            f for f in deals_by_discount
            if f.get("outbound_date")
            and f.get("return_date")
            and f.get("country", "").strip().lower() not in exclude
        ),
        None,
    )

@tool
def web_search(query: str) -> str:
    """Search the web for current data (transport, weather, activities)."""
    return str(tavily.search(query))

# EXECUTORS
taxi_executor = create_agent(model="gpt-4o-mini", tools=[web_search], system_prompt="You are a taxi expert. Search for the exact taxi fare price and duration from the airport to the hotel. Return ONLY the price and duration without fluff.")
bus_executor = create_agent(model="gpt-4o-mini", tools=[web_search], system_prompt="You are a public transport expert. Search for the bus/train ticket price and duration from the airport to the hotel. Return ONLY the price and duration without fluff.")
app_executor = create_agent(model="gpt-4o-mini", tools=[web_search], system_prompt="You are a ride-hailing expert. Search for Uber/Bolt fare prices and duration from the airport to the hotel. Return ONLY the price and duration without fluff.")
transport_main_agent = create_agent(model="gpt-4o-mini", tools=[], system_prompt="Compare the Taxi, Bus, and App choices. Output an ultra-short comparative list of prices and durations, followed by a final choice.")

weather_executor = create_agent(model="gpt-4o-mini", tools=[web_search], system_prompt="You are a weather expert. Get forecast. Return short answer.")
activities_executor = create_agent(model="gpt-4o-mini", tools=[web_search], system_prompt="You are an activities expert. Get free/cheap things to do. Return short answer.")
culture_executor = create_agent(model="gpt-4o-mini", tools=[], system_prompt="Give 2-3 short cultural tips for visiting.")
activity_main_agent = create_agent(model="gpt-4o-mini", tools=[], system_prompt="Summarize Weather, Activities, and Culture cleanly and concisely.")

tavily_currency_executor = create_agent(model="gpt-4o-mini", tools=[web_search], system_prompt="Search web for exchange rate. Return short answer.")

_frankfurter_executor = None
async def get_frankfurter_executor():
    global _frankfurter_executor
    if _frankfurter_executor is None:
        client = MultiServerMCPClient({"frankfurter": {"transport": "streamable_http", "url": "https://mcp.frankfurter.dev/"}})
        tools = await client.get_tools()
        _frankfurter_executor = create_agent(model="gpt-4o-mini", tools=tools, system_prompt="Use get_rates to find exchange rate. Return short answer.")
    return _frankfurter_executor

# --- 4. LANGGRAPH NODES ---
async def node_trip_deals(state: TravelPlanState):
    dates = flexible_date_range(60)
    exclude = {c.strip().lower() for c in state.get("exclude_destinations", []) if c and c.strip()}

    # Try the requested departure airport first, then fall back to nearby
    # Nordic hubs (skipping duplicates if the requested one is already a
    # fallback) if there's no usable deal this run.
    departure_ids_to_try = [state["departure_id"]] + [
        d for d in DEPARTURE_FALLBACKS if d != state["departure_id"]
    ]

    best_flight = None
    raw_flight_response = None

    for departure_id in departure_ids_to_try:
        raw_flight_response = get_flight_deals(departure_id, dates, travel_duration=state["duration"])
        flights = raw_flight_response.get("deals", [])
        best_flight = pick_best_flight(flights, exclude)
        if best_flight:
            break
        print(f"No usable flight deals from {departure_id}, trying next fallback airport...")

    if not best_flight:
        # Keep the last raw flight response even on a "no deal found" run —
        # useful for debugging why nothing matched across all fallbacks.
        return {"destination": None, "raw_flight_response": raw_flight_response}

    city, country = best_flight["name"], best_flight["country"]
    check_in, check_out = best_flight["outbound_date"], best_flight["return_date"]
    
    hotel_area = get_best_hotel_area(city, country)
    raw_hotel_response = get_hotel_deals(f"{hotel_area}, {country}", check_in, check_out, adults=state["travelers"])
    hotels = raw_hotel_response.get("properties", [])
    best_hotel = max(hotels, key=hotel_discount_percent) if hotels else None
    
    return {
        "flight": best_flight,
        "hotel": best_hotel,
        "destination": city,
        "country": country,
        "start_date": check_in,
        "end_date": check_out,
        "hotel_area": hotel_area,
        "raw_flight_response": raw_flight_response,
        "raw_hotel_response": raw_hotel_response,
    }

async def node_transport(state: TravelPlanState):
    hotel_name = state['hotel'].get('name', state['hotel_area']) if state.get('hotel') else state['hotel_area']
    loc = f"{hotel_name}, {state['destination']}"
    query = f"Airport: {state['flight']['arrival_airport_code']}\nDates: {state['start_date']}-{state['end_date']}\nHotel: {loc}"
    
    t_res, b_res, a_res = await asyncio.gather(
        taxi_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
        bus_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
        app_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
    )
    summary = f"Taxi: {t_res['messages'][-1].content}\nBus: {b_res['messages'][-1].content}\nApp: {a_res['messages'][-1].content}"
    final = await transport_main_agent.ainvoke({"messages": [HumanMessage(content=summary)]})
    return {"transport_summary": final["messages"][-1].content}

async def node_activities(state: TravelPlanState):
    query = f"Destination: {state['destination']}, {state['country']}\nDates: {state['start_date']} to {state['end_date']}"
    w_res, a_res, c_res = await asyncio.gather(
        weather_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
        activities_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
        culture_executor.ainvoke({"messages": [HumanMessage(content=query)]}),
    )
    summary = f"Weather: {w_res['messages'][-1].content}\nActs: {a_res['messages'][-1].content}\nCulture: {c_res['messages'][-1].content}"
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
    prompt = f"""
    You are a professional travel agent. Provide a punchy, highly summarized itinerary. Use bullet points.
    Destination: {state['destination']}, {state['country']} ({state['start_date']} to {state['end_date']})
    Flight: {state['flight'].get('airline')} - ${state['flight'].get('price')} ({state['flight'].get('discount_percentage')}% off)
    Hotel: {state.get('hotel', {}).get('name', 'N/A')} - {state.get('hotel', {}).get('deal', 'No deal found')}
    Transport Route: {state['transport_summary']}
    Activities/Weather: {state['activity_summary']}
    Currency: {state['currency_summary']}
    """
    response = await llm.ainvoke([HumanMessage(content=prompt)])
    return {"final_itinerary": response.content}

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
    departure_id: str = "CPH", 
    travelers: int = 2, 
    duration: str = "2", 
    home_currency: str = "SEK",
    exclude_destinations: str = "",
):
    """
    Endpoint to trigger the LangGraph pipeline. 
    Accepts query parameters for dynamic searches.

    exclude_destinations: comma-separated list of country names to skip when
    picking a flight deal (e.g. "United Kingdom,Spain"), used to avoid
    repeating the same country across recent runs.
    """
    inputs = {
        "departure_id": departure_id,
        "travelers": travelers,
        "duration": duration, 
        "home_currency": home_currency,
        "exclude_destinations": [c for c in exclude_destinations.split(",") if c.strip()],
    }
    
    try:
        final_state = await graph.ainvoke(inputs)
        
        # Add a creation timestamp so the React frontend can track the 1-hour expiry
        final_state["created_at"] = datetime.now(timezone.utc).isoformat()
        
        return final_state
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))