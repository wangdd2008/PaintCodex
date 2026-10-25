import { useState } from 'react';
import './ai-chat.css';

export function AiChatPanel() {
  const [open, setOpen] = useState(true);

  return (
    <section className="ai-chat" aria-label="AI chat">
      <button
        type="button"
        className="ai-chat__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        AI Chat {open ? '▾' : '▸'}
      </button>

      {open ? (
        <div className="ai-chat__body">
          <p className="ai-chat__empty">AI assistant is not connected yet.</p>
          <form className="ai-chat__composer">
            <textarea
              className="ai-chat__input"
              placeholder="Describe what to draw…"
              rows={3}
              disabled
            />
            <button type="button" className="ai-chat__send" disabled>
              Send
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
