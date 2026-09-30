import { useNavigate } from "react-router-dom";
import { useNotifications } from "../context/NotificationContext.jsx";

export default function AlertToastStack() {
  const { toasts, dismissToast } = useNotifications();
  const navigate = useNavigate();

  if (toasts.length === 0) return null;

  return (
    <div style={styles.stack}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={styles.toast}
          onClick={() => {
            dismissToast(t.id);
            navigate(`/trips/${t.tripId}`);
          }}
        >
          <div style={styles.accentBar} />
          <div style={styles.body}>
            <div style={styles.row}>
              <span style={styles.label}>{t.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismissToast(t.id);
                }}
                style={styles.closeBtn}
              >
                ×
              </button>
            </div>
            <div style={styles.message}>{t.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  stack: {
    position: "fixed",
    top: 16,
    right: 16,
    zIndex: 200,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    width: 240,
    pointerEvents: "none",
  },
  toast: {
    display: "flex",
    cursor: "pointer",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
    overflow: "hidden",
    pointerEvents: "auto",
  },
  accentBar: {
    width: 3,
    flexShrink: 0,
    background: "var(--risk-dangerous)",
  },
  body: {
    padding: "6px 8px",
    minWidth: 0,
    flex: 1,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--risk-dangerous)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
  },
  message: {
    fontSize: 11,
    color: "var(--text-secondary)",
    marginTop: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};
