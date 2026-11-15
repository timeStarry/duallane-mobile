import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/mobile.css";
import { initializeMobileTheme } from "./shared/theme-store";
import { App } from "./App";

initializeMobileTheme();

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
