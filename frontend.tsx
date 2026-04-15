import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";

interface Message {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
}

interface UsageStats {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

interface Model {
  id: string;
  label: string;
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={() => setOpen((o) => !o)}>
        <span>{open ? "▾" : "▸"}</span>
        <span>Thinking</span>
      </div>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  return (
    <div className={`message ${msg.role}`}>
      <span className="role-label">{msg.role === "user" ? "You" : "Claude"}</span>
      <div className="bubble">
        {msg.role === "assistant" && msg.thinking && (
          <ThinkingBlock text={msg.thinking} />
        )}
        {msg.content}
      </div>
    </div>
  );
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [system, setSystem] = useState("You are a helpful assistant.");
  const [model, setModel] = useState("claude-opus-4-6");
  const [models, setModels] = useState<Model[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => setModels(d.models));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setStreaming(true);

    // Placeholder for the assistant turn
    setMessages([...history, { role: "assistant", content: "", thinking: "" }]);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          model,
          system,
        }),
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let thinkingText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "text") {
              assistantText += payload.text;
            } else if (payload.type === "thinking") {
              thinkingText += payload.text;
            } else if (payload.type === "usage") {
              setUsage(payload.usage);
            } else if (payload.type === "error") {
              assistantText = `Error: ${payload.message}`;
            }

            setMessages([
              ...history,
              {
                role: "assistant",
                content: assistantText,
                thinking: thinkingText || undefined,
              },
            ]);
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      setMessages([
        ...history,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setStreaming(false);
    }
  }, [input, messages, model, system, streaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const totalCached =
    (usage?.cache_creation_input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0);

  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <h1>AI <span>Playground</span></h1>

        <div>
          <div className="section-label">Model</div>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="section-label">System Prompt</div>
          <textarea
            className="system-area"
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder="Enter a system prompt…"
          />
        </div>

        {usage && (
          <div>
            <div className="section-label">Token Usage</div>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Input</span>
                <span className="stat-value">{usage.input_tokens.toLocaleString()}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Output</span>
                <span className="stat-value">{usage.output_tokens.toLocaleString()}</span>
              </div>
              {totalCached > 0 && (
                <div className="stat">
                  <span className="stat-label">Cache read</span>
                  <span className="stat-value cache">
                    {usage.cache_read_input_tokens.toLocaleString()}
                  </span>
                </div>
              )}
              {usage.cache_creation_input_tokens > 0 && (
                <div className="stat">
                  <span className="stat-label">Cache write</span>
                  <span className="stat-value">
                    {usage.cache_creation_input_tokens.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <button
          className="clear-btn"
          onClick={() => { setMessages([]); setUsage(null); }}
        >
          Clear conversation
        </button>
      </aside>

      {/* ── Chat ── */}
      <main className="chat-area">
        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="icon">✦</div>
              <h2>AI SDK Playground</h2>
              <p>Powered by Anthropic SDK + Bun.<br />Type a message to get started.</p>
            </div>
          ) : (
            messages.map((m, i) => <MessageBubble key={i} msg={m} />)
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-bar">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
            disabled={streaming}
          />
          <button className="send-btn" onClick={sendMessage} disabled={streaming || !input.trim()}>
            {streaming ? (
              <div className="dot-pulse">
                <span /><span /><span />
              </div>
            ) : (
              "↑"
            )}
          </button>
        </div>

        {streaming && (
          <div className="streaming-indicator">
            <div className="dot-pulse">
              <span /><span /><span />
            </div>
            Claude is thinking…
          </div>
        )}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
