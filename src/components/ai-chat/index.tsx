import { invoke } from "@tauri-apps/api/core";
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import "./style.css";

type ChatMessage = {
    role: "user" | "assistant";
    text: string;
};

export function AiChat() {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const messagesRef = useRef<HTMLDivElement | null>(null);

    const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsOpen(false);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isOpen]);

    useEffect(() => {
        if (!messagesRef.current) {
            return;
        }

        messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }, [messages, isSending, isOpen]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isSending) {
            return;
        }

        setMessages((prev) => [...prev, { role: "user", text }]);
        setInput("");
        setIsSending(true);

        try {
            const response = await invoke<string>("send_ai_message", { message: text });
            setMessages((prev) => [...prev, { role: "assistant", text: response }]);
        } catch (error) {
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    text: `Failed to get response: ${String(error)}`,
                },
            ]);
        } finally {
            setIsSending(false);
        }
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        await handleSend();
    };

    const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void handleSend();
        }
    };

    return (
        <div className="ai-chat-root">
            <button
                type="button"
                className="ai-chat-fab"
                onClick={() => setIsOpen(true)}
                aria-label="Open AI chat"
            >
                <video className="ai-chat-fab-video" autoPlay loop muted playsInline src="/bot.webm" />
            </button>

            {isOpen && (
                <div
                    className="ai-chat-overlay"
                    onClick={() => setIsOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="AI chat"
                >
                    <div className="ai-chat-modal" onClick={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            className="ai-chat-close"
                            onClick={() => setIsOpen(false)}
                            aria-label="Close AI chat"
                        >
                            ×
                        </button>

                        <div className="ai-chat-modal-avatar">
                            <video className="ai-chat-modal-avatar-video" autoPlay loop muted playsInline src="/bot.webm" />
                        </div>

                        <div className="ai-chat-messages" ref={messagesRef}>
                            {messages.length === 0 && (
                                <p className="ai-chat-empty-message">
                                    I&apos;m just a program, but I&apos;m here and ready to help. How can I assist you today?
                                </p>
                            )}

                            {messages.map((message, index) => (
                                <div
                                    key={`${message.role}-${index}`}
                                    className={`ai-chat-message ai-chat-message-${message.role}`}
                                >
                                    {message.text}
                                </div>
                            ))}

                            {isSending && <div className="ai-chat-message ai-chat-message-assistant">Assisting…</div>}
                        </div>

                        <form className="ai-chat-input-shell" onSubmit={handleSubmit}>
                            <textarea
                                className="ai-chat-input"
                                placeholder="Ask anything"
                                rows={3}
                                aria-label="AI chat message"
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                onKeyDown={handleInputKeyDown}
                            />

                            <div className="ai-chat-actions">
                                <button type="button" className="ai-chat-action-button" aria-label="Attach file">
                                    📎
                                </button>
                                <button
                                    type="submit"
                                    className="ai-chat-send-button"
                                    aria-label="Send message"
                                    disabled={!canSend}
                                >
                                    ↑
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}