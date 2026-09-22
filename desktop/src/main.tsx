import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CallWindowApp from "./callWindow/CallWindowApp";
import { isCallWindow } from "./services/presence";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isCallWindow() ? <CallWindowApp /> : <App />}
  </React.StrictMode>,
);
