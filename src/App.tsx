import "./App.css";
import "@excalidraw/excalidraw/index.css";
import { lazy, Suspense, useState } from "react";
import { Footer } from "@excalidraw/excalidraw";
import { LibraryModal } from "./component/library-modal";
const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((module) => ({
    default: module.Excalidraw,
  })),
);

function App() {
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const libraryUrl = "https://libraries.excalidraw.com/";

  return (
    <main className="container">
      <LibraryModal
        isOpen={isLibraryModalOpen}
        onClose={() => setIsLibraryModalOpen(false)}
        url={libraryUrl}
      />

      <Suspense
        fallback={
          <div className="loading" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <span>Loading Excalidraw…</span>
          </div>
        }
      >
        <Excalidraw>
          <Footer>
            <button
              className="custom-footer"
              onClick={() => setIsLibraryModalOpen(true)}
              style={{
                marginLeft: "0.5rem",
                background: "#70b1ec",
                color: "white",
                padding: "0.5rem",
                borderRadius: "10px",
                border: "none",
              }}
            >
              Browse Library
            </button>
          </Footer>
        </Excalidraw>
      </Suspense>
    </main>
  );
}

export default App;
