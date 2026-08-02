import { CheckCircle2, Clock3, RefreshCcw, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  checkoutReservation,
  createReservation,
  fetchProducts,
  fetchUserReservations,
  Product,
  Reservation
} from "./api";
// import the demo user id, which is a constant string

const demoUserId = "demo-user";
// import the right style of money format, and convert cents to dollars
function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}
//calculate the rest seconds until the reservation expires, if it is pending
function secondsUntil(date: string) {
  return Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));
}
//define the main component of the app, which is a function component
export function App() {

  const [products, setProducts] = useState<Product[]>([]);
  const [accountReservations, setAccountReservations] = useState<Reservation[]>([]);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);

// calculate the remaining seconds until the reservation expires, if it is pending 
  const remainingSeconds = useMemo(
    () => (reservation?.status === "PENDING" ? secondsUntil(reservation.expiresAt) : 0),
    [reservation, tick]
  );
// refresh the data on the page, including products and user reservations
  async function refreshPageData() {
    const [nextProducts, nextReservations] = await Promise.all([
      fetchProducts(),
      fetchUserReservations(demoUserId)
    ]);

    setProducts(nextProducts);
    setAccountReservations(nextReservations);
  }

  useEffect(() => {
    void refreshPageData().catch((error: Error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function handleReserve(productId: string) {
    setLoadingProductId(productId);
    setMessage("");

    try {
      const nextReservation = await createReservation(productId, demoUserId);
      setReservation(nextReservation);
      await refreshPageData();
      setMessage("Reservation created. Complete checkout before it expires.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reservation failed");
    } finally {
      setLoadingProductId(null);
    }
  }
// checkout the current reservation, if it exists and is pending
  async function handleCheckout() {
    if (!reservation) {
      return;
    }

    setCheckingOut(true);
    setMessage("");

    try {
      const completed = await checkoutReservation(reservation.id);
      setReservation(completed);
      await refreshPageData();
      setMessage("Checkout complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout failed");
      await refreshPageData();
    } finally {
      setCheckingOut(false);
    }
  }
// page layout: a header with a refresh button, a product grid with reserve buttons, and a checkout panel with current reservation and account activity
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Limited drop</p>
          <h1>Reserve before checkout</h1>
        </div>
        <button className="iconButton" onClick={() => void refreshPageData()} aria-label="Refresh products">
          <RefreshCcw size={18} />
        </button>
      </header>

      {message && <p className="notice">{message}</p>}

      <section className="layout">
        <div className="productGrid">
          {products.map((product) => {
            const soldOut = product.availableStock <= 0;
            const loading = loadingProductId === product.id;

            return (
              <article className="productCard" key={product.id}>
                {product.imageUrl && <img src={product.imageUrl} alt={product.name} />}
                <div className="productBody">
                  <div className="productTitleRow">
                    <h2>{product.name}</h2>
                    <strong>{money(product.priceCents)}</strong>
                  </div>
                  <p>{product.description}</p>
                  <div className="stockLine">
                    <span>{product.availableStock} available</span>
                    <span>{product.reservedStock} reserved</span>
                    <span>{product.soldStock} sold</span>
                    <span>{product.totalStock} total</span>
                  </div>
                  <button
                    className="primaryButton"
                    disabled={soldOut || loading}
                    onClick={() => void handleReserve(product.id)}
                  >
                    <ShoppingBag size={18} />
                    {soldOut ? "Sold out" : loading ? "Reserving" : "Reserve"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="checkoutPanel">
          <h2>Current reservation</h2>
          {!reservation ? (
            <p className="emptyState">No active reservation yet.</p>
          ) : (
            <div className="reservationDetails">
              <div>
                <span className="label">Product</span>
                <strong>{reservation.product.name}</strong>
              </div>
              <div>
                <span className="label">Status</span>
                <strong>{reservation.status}</strong>
              </div>
              <div>
                <span className="label">Time left</span>
                <strong className={remainingSeconds === 0 ? "expired" : ""}>
                  <Clock3 size={16} />
                  {reservation.status === "PENDING" ? `${remainingSeconds}s` : "Closed"}
                </strong>
              </div>
              <button
                className="checkoutButton"
                disabled={reservation.status !== "PENDING" || remainingSeconds === 0 || checkingOut}
                onClick={() => void handleCheckout()}
              >
                <CheckCircle2 size={18} />
                {checkingOut ? "Checking out" : "Complete checkout"}
              </button>
            </div>
          )}

          <div className="accountSection">
            <h3>Account activity</h3>
            {accountReservations.length === 0 ? (
              <p className="emptyState">No reservations for demo-user.</p>
            ) : (
              <ul className="reservationList">
                {accountReservations.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.product.name}</strong>
                      <span>{item.quantity} item</span>
                    </div>
                    <span className={`statusBadge status-${item.status.toLowerCase()}`}>{item.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

//所以这判断一个react文件做什么，通常看这个顺序：入口怎么用它，import了什么，state存什么，函数处理什么，return渲染什么。

