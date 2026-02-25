import "./App.css";
import "@excalidraw/excalidraw/index.css";
import { lazy, Suspense, useEffect, useState } from "react";
import { Footer } from "@excalidraw/excalidraw";
import { invoke } from "@tauri-apps/api/core";
import { LibraryModal } from "./components/library-modal";
import { ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";

const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((module) => ({
    default: module.Excalidraw,
  })),
);

function App() {
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const libraryUrl = "https://libraries.excalidraw.com/";

  useEffect(() => {
    const loadStoredItems = async () => {
      try {
        const libraryItems = await invoke<LibraryItems>("load_library_items");

        if (Array.isArray(libraryItems) && excalidrawAPI) {

          if (libraryItems.length > 0) {
            excalidrawAPI.updateLibrary({
              libraryItems,
              openLibraryMenu: true,
            });
          }
        }

      } catch (error) {
        console.error("Failed to load stored library items", error);
      }
    };

    if (excalidrawAPI) {
      void loadStoredItems();
    }
  }, [excalidrawAPI]);

  const handleLibraryChange = async (items: LibraryItems) => {
    try {
      await invoke("save_library_items", { items: [...items] });
    } catch (error) {
      console.error("Failed to save library items", error);
    }
  };

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
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onLibraryChange={(items) => {
            handleLibraryChange(items);
          }}
        >
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
