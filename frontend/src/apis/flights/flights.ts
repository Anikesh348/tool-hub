import { getBearerAuthHeader } from "../auth/tokenStorage";

const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export type FlightWatchPayload = {
  origin: string;
  originLabel?: string;
  destination: string;
  destinationLabel?: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  children: number;
  infants: number;
  cabin: string;
  currency: string;
  thresholdPrice: string;
  maxStops?: string;
  note?: string;
};

const authHeaders = () => ({
  "Content-Type": "application/json",
  ...getBearerAuthHeader(),
});

export const FlightService = {
  providerStatus: () => ({
    url: `${BASE_URL}/v2/flights/provider-status`,
    options: {
      method: "GET",
      headers: authHeaders(),
    },
  }),

  getWatches: () => ({
    url: `${BASE_URL}/v2/flights/watches`,
    options: {
      method: "GET",
      headers: authHeaders(),
    },
  }),

  getWatch: (watchId: string) => ({
    url: `${BASE_URL}/v2/flights/watches/${watchId}`,
    options: {
      method: "GET",
      headers: authHeaders(),
    },
  }),

  searchPlaces: (query: string) => ({
    url: `${BASE_URL}/v2/flights/places?query=${encodeURIComponent(query)}&limit=8`,
    options: {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    },
  }),

  createWatch: (payload: FlightWatchPayload) => ({
    url: `${BASE_URL}/v2/flights/watches`,
    options: {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    },
  }),

  deleteWatch: (watchId: string) => ({
    url: `${BASE_URL}/v2/flights/watches/${watchId}`,
    options: {
      method: "DELETE",
      headers: authHeaders(),
    },
  }),

  checkWatch: (watchId: string) => ({
    url: `${BASE_URL}/v2/flights/watches/${watchId}/check`,
    options: {
      method: "POST",
      headers: authHeaders(),
    },
  }),

  getHistory: (watchId: string) => ({
    url: `${BASE_URL}/v2/flights/watches/${watchId}/history`,
    options: {
      method: "GET",
      headers: authHeaders(),
    },
  }),
};
