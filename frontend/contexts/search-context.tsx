"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type SearchState = {
  query: string;
  setQuery: (q: string) => void;
  clear: () => void;
};

const SearchContext = createContext<SearchState | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");

  const value = useMemo(
    () => ({
      query,
      setQuery,
      clear: () => setQuery(""),
    }),
    [query]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchState {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}

