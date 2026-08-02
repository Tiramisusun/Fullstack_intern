
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
// define the types for the product and reservation data
export type Product = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  priceCents: number;
  totalStock: number;
  availableStock: number;
  reservedStock: number;
  soldStock: number;
};

export type ReservationStatus = "PENDING" | "COMPLETED" | "EXPIRED" | "CANCELLED";

export type Reservation = {
  id: string;
  productId: string;
  userId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
  product: Product;
};

// a generic function to make API requests, with error handling

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // make the request to the API, with the given path and options
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    },
    ...options
  });
// if the response is not ok, throw an error with the message from the response body
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export function fetchProducts() {
  return request<Product[]>("/products");
}

export function fetchUserReservations(userId: string) {
  return request<Reservation[]>(`/reservations?userId=${encodeURIComponent(userId)}`);
}

export function createReservation(productId: string, userId: string) {
  return request<Reservation>("/reservations", {
    method: "POST",
    body: JSON.stringify({ productId, userId, quantity: 1 })
  });
}
//
export function checkoutReservation(reservationId: string) {
  return request<Reservation>(`/reservations/${reservationId}/checkout`, {
    method: "POST"
  });
}
