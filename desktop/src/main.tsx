import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CallWindowApp from "./callWindow/CallWindowApp";
import { isCallWindow } from "./services/presence";
import { isTauri } from "./services/platform";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isCallWindow() ? <CallWindowApp /> : <App />}
  </React.StrictMode>,
);

// Register the service worker only in the hosted web build — never inside the
// Tauri desktop app (its own window isn't a PWA) and only where SW is supported
// and the page is secure (https or localhost).
if (!isTauri() && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
