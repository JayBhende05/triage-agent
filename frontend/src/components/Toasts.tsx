import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Toast = { id: number; message: string; tone: "info" | "error" };
type Push = (message: string, tone?: Toast["tone"]) => void;

const ToastContext = createContext<Push>(() => {});

export function useToast(): Push {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback<Push>((message, tone = "info") => {
    const id = nextId++;
    setToasts((all) => [...all.filter((t) => t.message !== message), { id, message, tone }]);
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 4500);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto rounded-md px-3 py-2 text-sm shadow-lg ring-1 ${
              t.tone === "error"
                ? "bg-white text-red-800 ring-red-200"
                : "bg-zinc-900 text-zinc-50 ring-zinc-900"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
