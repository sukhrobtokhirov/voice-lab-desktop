import { useCallback, useState } from "react";

export function useCollapsibleSidebar() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebarCollapsed") === "true"
  );

  const toggle = useCallback(() => {
    const next = !collapsed;
    localStorage.setItem("sidebarCollapsed", String(next));
    setCollapsed(next);
  }, [collapsed]);

  return { collapsed, toggle };
}
