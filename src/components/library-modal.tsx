import { openUrl } from "@tauri-apps/plugin-opener";

type LibraryModalProps = {
      isOpen: boolean;
      onClose: () => void;
      url: string;
};

export function LibraryModal({ isOpen, onClose, url }: LibraryModalProps) {
      if (!isOpen) {
            return null;
      }

      return (
            <div
                  className="library-modal-overlay"
                  role="dialog"
                  aria-modal="true"
                  onClick={onClose}
            >
                  <div className="library-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="library-modal-header">
                              <h2>Browse Libraries</h2>
                              <div className="library-modal-actions">
                                    <button
                                          type="button"
                                          className="library-modal-open-browser"
                                          onClick={() => void openUrl(url)}
                                    >
                                          Open in browser for download
                                    </button>
                                    <button
                                          type="button"
                                          className="library-modal-close"
                                          onClick={onClose}
                                          aria-label="Close library browser"
                                    >
                                          ✕
                                    </button>
                              </div>
                        </div>

                        <iframe
                              title="Excalidraw Libraries"
                              src={url}
                              className="library-modal-frame"
                              referrerPolicy="strict-origin-when-cross-origin"
                        />
                  </div>
            </div>
      );
}