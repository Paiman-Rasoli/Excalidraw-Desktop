import "./App.css";
import "@excalidraw/excalidraw/index.css";
import { lazy, Suspense, useEffect, useState } from "react";
import { Footer } from "@excalidraw/excalidraw";
import { invoke } from "@tauri-apps/api/core";
import { LibraryModal } from "./components/library-modal";
import { ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";
import { AiChat } from "./components/ai-chat";
import { setExcalidrawAPI, setLibraryItems } from "./lib/excalidraw-handle";
import { installMcpBridge } from "./lib/mcp-bridge";

const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((module) => ({
    default: module.Excalidraw,
  })),
);

function App() {
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawApiState] = useState<ExcalidrawImperativeAPI | null>(null);
  const libraryUrl = "https://libraries.excalidraw.com/";

  useEffect(() => {
    const loadStoredItems = async () => {
      try {
        const libraryItems = await invoke<LibraryItems>("load_library_items");

        if (Array.isArray(libraryItems) && excalidrawAPI) {
          setLibraryItems(libraryItems);

          if (libraryItems.length > 0) {
            excalidrawAPI.updateLibrary({
              libraryItems,
              openLibraryMenu: false,
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

  // Registering the channel is also how Rust learns the canvas is live, so
  // this must wait until excalidrawAPI exists.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    installMcpBridge().catch((error) => {
      console.error("Failed to register the MCP bridge", error);
    });
  }, [excalidrawAPI]);

  const handleLibraryChange = async (items: LibraryItems) => {
    // Keep the MCP tools' view of the library current without waiting for the
    // write below to land.
    setLibraryItems(items);

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
          excalidrawAPI={(api) => {
            setExcalidrawApiState(api);
            setExcalidrawAPI(api);
          }}
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

        {excalidrawAPI && <AiChat excalidrawAPI={excalidrawAPI} />}
      </Suspense>
    </main>
  );
}

export default App;
