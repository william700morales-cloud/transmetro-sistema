import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans-condensed/400.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";
import App from "./App.jsx";
import { DbProvider } from "./db/useDb.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <DbProvider>
      <App />
    </DbProvider>
  </StrictMode>
);
