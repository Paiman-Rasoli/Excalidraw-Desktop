import "./App.css";
import "@excalidraw/excalidraw/index.css";
import { lazy, Suspense } from "react";

const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((module) => ({
    default: module.Excalidraw,
  })),
);

function App() {
  return (
    <main className="container">
      <Suspense
        fallback={
          <div className="loading" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <span>Loading Excalidraw…</span>
          </div>
        }
      >
        <Excalidraw />
      </Suspense>
    </main>
  );
}

export default App;
