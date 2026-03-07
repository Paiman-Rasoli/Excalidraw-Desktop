import { invoke } from "@tauri-apps/api/core";
import { FormEvent, useEffect, useState } from "react";

type ProviderKeys = {
    openai: string;
    anthropic: string;
    google: string;
};

type AgentProvider = "openai" | "anthropic" | "google";

type AiChatConfig = ProviderKeys & {
    defaultAgent: AgentProvider;
};

type ConfigProps = {
    onSaved: () => void;
};

const DEFAULT_CONFIG: AiChatConfig = {
    openai: "",
    anthropic: "",
    google: "",
    defaultAgent: "openai",
};

export function Config({ onSaved }: ConfigProps) {
    const [config, setConfig] = useState<AiChatConfig>(DEFAULT_CONFIG);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const loaded = await invoke<Partial<AiChatConfig>>("load_ai_chat_config");
                setConfig({
                    openai: loaded.openai ?? "",
                    anthropic: loaded.anthropic ?? "",
                    google: loaded.google ?? "",
                    defaultAgent: loaded.defaultAgent ?? "openai",
                });
            } catch {
                setConfig(DEFAULT_CONFIG);
            }
        };

        void loadConfig();
    }, []);

    const handleChange = (field: keyof AiChatConfig, value: string) => {
        setConfig((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const payload: AiChatConfig = {
            openai: config.openai.trim(),
            anthropic: config.anthropic.trim(),
            google: config.google.trim(),
            defaultAgent: config.defaultAgent,
        };

        setIsSaving(true);
        try {
            await invoke("save_ai_chat_config", { config: payload });
            onSaved();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form className="ai-chat-config-panel" onSubmit={handleSubmit}>
            <h3 className="ai-chat-config-title">Provider API Keys</h3>

            <label className="ai-chat-config-row">
                <span className="ai-chat-config-label">Default</span>
                <select
                    className="ai-chat-config-select"
                    value={config.defaultAgent}
                    onChange={(event) => handleChange("defaultAgent", event.target.value)}
                >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                </select>
            </label>

            <label className="ai-chat-config-row">
                <span className="ai-chat-config-label">OpenAI</span>
                <input
                    className="ai-chat-config-input"
                    type="password"
                    value={config.openai}
                    onChange={(event) => handleChange("openai", event.target.value)}
                    placeholder="sk-..."
                />
            </label>

            <label className="ai-chat-config-row">
                <span className="ai-chat-config-label">Anthropic</span>
                <input
                    className="ai-chat-config-input"
                    type="password"
                    value={config.anthropic}
                    onChange={(event) => handleChange("anthropic", event.target.value)}
                    placeholder="sk-ant-..."
                />
            </label>

            <label className="ai-chat-config-row">
                <span className="ai-chat-config-label">Google</span>
                <input
                    className="ai-chat-config-input"
                    type="password"
                    value={config.google}
                    onChange={(event) => handleChange("google", event.target.value)}
                    placeholder="AIza..."
                />
            </label>

            <button type="submit" className="ai-chat-config-save" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Config"}
            </button>
        </form>
    );
}
