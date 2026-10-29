import { useCallback, useEffect, useState } from "react";

// The selected ticket lives in the URL (?ticket=8), so a refresh or a shared link keeps it.
function read(): number | null {
  const value = new URLSearchParams(window.location.search).get("ticket");
  const id = value === null ? NaN : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function useSelectedTicket(): [number | null, (id: number | null) => void] {
  const [selected, setSelected] = useState<number | null>(read);

  useEffect(() => {
    const onPop = () => setSelected(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = useCallback((id: number | null) => {
    const params = new URLSearchParams(window.location.search);
    if (id === null) params.delete("ticket");
    else params.set("ticket", String(id));
    const query = params.toString();
    window.history.pushState(null, "", query ? `?${query}` : window.location.pathname);
    setSelected(id);
  }, []);

  return [selected, select];
}
