import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Polyfills for CoFHE SDK and encryption libraries
(window as any).global = window;
(window as any).process = { env: {} };

createRoot(document.getElementById("root")!).render(<App />);
