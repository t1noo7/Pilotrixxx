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
          className="card"
          style={styles.toast}
          onClick={() => {
            dismissToast(t.id);
            navigate(`/trips/${t.tripId}`);
          }}
        >
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 13,
                color: "var(--risk-dangerous)",
              }}
            >
              {t.label}
            </span>
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
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              marginTop: 4,
            }}
          >
            {t.message}
          </div>
          <div
            style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}
          >
            Trip #{t.tripId} · bấm để xem chi tiết
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  stack: {
    position: "fixed",
    top: 20,
    right: 20,
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 280,
  },
  toast: {
    cursor: "pointer",
    borderColor: "var(--risk-dangerous)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    padding: 0,
  },
};
