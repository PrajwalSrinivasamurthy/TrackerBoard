import { useState, useEffect, useRef, useMemo } from "react";
import { storage } from "./storage";

// ---------- constants ----------
const COLUMNS = [
  { id: "todo", label: "To Do" },
  { id: "inprogress", label: "In Progress" },
  { id: "testing", label: "Testing" },
  { id: "review", label: "Review" },
  { id: "prodpush", label: "Prod Push" },
  { id: "closed", label: "Closed" },
];

const DEFAULT_TEAM = ["Prajwal", "Anna", "Hamza", "Madhav", "Luis"];

const PRIORITIES = {
  highest: { label: "Highest", color: "#B3001B", glyph: "▲▲" },
  high: { label: "High", color: "#D9482B", glyph: "▲" },
  medium: { label: "Medium", color: "#C98A00", glyph: "■" },
  low: { label: "Low", color: "#2E7D5B", glyph: "▼" },
};

const TYPES = {
  task: { label: "Task", color: "#3B6FB5", glyph: "✓" },
  bug: { label: "Bug", color: "#B3001B", glyph: "●" },
  story: { label: "Story", color: "#2E7D5B", glyph: "◆" },
};

const PROJECT_COLORS = ["#B3001B", "#3B6FB5", "#2E7D5B", "#C98A00", "#6A4FB3", "#1A1A1E"];

const STORAGE_KEY = "ttuo-board-v3";
const SCARLET = "#B3001B";

// ---------- helpers ----------
const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const fmtTs = (ts) =>
  new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const isOverdue = (iso, status) => {
  if (!iso || status === "closed") return false;
  return new Date(iso + "T23:59:59") < new Date();
};
const keyFromName = (name) =>
  name.split(/\s+/).map((w) => w[0]).join("").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 5) || "PROJ";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// render @mentions highlighted
function MentionText({ text, team }) {
  const parts = text.split(/(@[A-Za-z]+)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("@") && team.some((m) => m.toLowerCase() === p.slice(1).toLowerCase()) ? (
          <span key={i} style={{ color: SCARLET, fontWeight: 700, background: SCARLET + "12", borderRadius: 4, padding: "0 3px" }}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
}

// downscale + compress image to keep storage small
const compressImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const scale = MAX / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const SEED = {
  team: [],
  projects: [],
  tickets: [],
  nextProjectId: 1,
  nextTicketId: 1,
};

// ---------- main ----------
export default function TTUOTracker() {
  const [data, setData] = useState(null);
  const [view, setView] = useState({ page: "team", projectId: null }); // team | projects | board
  const [saveState, setSaveState] = useState("idle");
  const [ticketModal, setTicketModal] = useState(null); // {mode, ticket, defaultProjectId?}
  const [projectModal, setProjectModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("ttuo-theme") || "light");
  const saveTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem("ttuo-theme", theme);
  }, [theme]);

  // load (with v2 migration)
  useEffect(() => {
    (async () => {
      let d = null;
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res?.value) d = JSON.parse(res.value);
      } catch { /* not found */ }
      if (!d) {
        try {
          const old = await storage.get("ttuo-board-v2");
          if (old?.value) {
            const v2 = JSON.parse(old.value);
            const mapStatus = { backlog: "todo", todo: "todo", inprogress: "inprogress", review: "review", done: "closed" };
            d = {
              ...v2,
              tickets: (v2.tickets || []).map((t) => ({
                ...t,
                status: mapStatus[t.status] || "todo",
                blocked: false, blockReason: "", comments: [],
              })),
            };
          }
        } catch { /* none */ }
      }
      if (d && !d.team) d = { ...d, team: DEFAULT_TEAM };
      setData(d || SEED);
    })();
  }, []);

  // save
  useEffect(() => {
    if (!data) return;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await storage.set(STORAGE_KEY, JSON.stringify(data));
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1500);
      } catch {
        setSaveState("error");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [data]);

  if (!data)
    return <div style={S.loadWrap}><div style={S.loadText}>Loading workspace…</div></div>;

  // ----- mutations -----
  const saveProject = (form) => {
    setData((d) => {
      if (projectModal.mode === "new") {
        const p = { ...form, id: d.nextProjectId, nextTicket: 1, created: Date.now() };
        return { ...d, projects: [...d.projects, p], nextProjectId: d.nextProjectId + 1 };
      }
      return { ...d, projects: d.projects.map((p) => (p.id === form.id ? { ...p, ...form } : p)) };
    });
    setProjectModal(null);
  };

  const deleteProject = async (id) => {
    // clean up comment images belonging to this project's tickets
    const imgKeys = data.tickets
      .filter((t) => t.projectId === id)
      .flatMap((t) => (t.comments || []).flatMap((c) => c.imageKeys || []));
    for (const k of imgKeys) { try { await storage.delete(k); } catch { /* ok */ } }
    setData((d) => ({
      ...d,
      projects: d.projects.filter((p) => p.id !== id),
      tickets: d.tickets.filter((t) => t.projectId !== id),
    }));
    setConfirmDelete(null);
    setView({ page: "team", projectId: null });
  };

  const saveTicket = (form) => {
    setData((d) => {
      if (ticketModal.mode === "new") {
        const proj = d.projects.find((p) => p.id === form.projectId);
        const t = {
          ...form,
          id: d.nextTicketId,
          key: `${proj.key}-${proj.nextTicket}`,
          comments: [],
          created: Date.now(),
        };
        return {
          ...d,
          tickets: [...d.tickets, t],
          nextTicketId: d.nextTicketId + 1,
          projects: d.projects.map((p) => (p.id === form.projectId ? { ...p, nextTicket: p.nextTicket + 1 } : p)),
        };
      }
      return { ...d, tickets: d.tickets.map((t) => (t.id === form.id ? { ...t, ...form } : t)) };
    });
    setTicketModal(null);
  };

  const deleteTicket = async (id) => {
    const t = data.tickets.find((x) => x.id === id);
    const imgKeys = (t?.comments || []).flatMap((c) => c.imageKeys || []);
    for (const k of imgKeys) { try { await storage.delete(k); } catch { /* ok */ } }
    setData((d) => ({ ...d, tickets: d.tickets.filter((x) => x.id !== id) }));
    setTicketModal(null);
  };

  const updateTicket = (id, patch) =>
    setData((d) => ({ ...d, tickets: d.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  const addComment = (ticketId, comment) =>
    setData((d) => ({
      ...d,
      tickets: d.tickets.map((t) =>
        t.id === ticketId ? { ...t, comments: [...(t.comments || []), comment] } : t
      ),
    }));

  const deleteComment = async (ticketId, commentId) => {
    const t = data.tickets.find((x) => x.id === ticketId);
    const c = t?.comments?.find((x) => x.id === commentId);
    for (const k of c?.imageKeys || []) { try { await storage.delete(k); } catch { /* ok */ } }
    setData((d) => ({
      ...d,
      tickets: d.tickets.map((t) =>
        t.id === ticketId ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) } : t
      ),
    }));
  };

  const addTeamMember = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setData((d) => {
      if (d.team.some((m) => m.toLowerCase() === trimmed.toLowerCase())) return d;
      return { ...d, team: [...d.team, trimmed] };
    });
  };

  const removeTeamMember = (name) => {
    setData((d) => ({
      ...d,
      team: d.team.filter((m) => m !== name),
      tickets: d.tickets.map((t) => (t.assignee === name ? { ...t, assignee: "" } : t)),
    }));
  };

  const currentProject = data.projects.find((p) => p.id === view.projectId);
  const liveTicket = ticketModal?.ticket ? data.tickets.find((t) => t.id === ticketModal.ticket.id) : null;

  return (
    <div style={S.app} data-theme={theme}>
      <style>{CSS}</style>

      <header style={S.header}>
        <div style={S.brandRow}>
          <div style={S.brandMark}>TTUO</div>
          <div>
            <div style={S.brandTitle}>Online Team Workspace</div>
            <div style={S.brandSub}>Projects · Tickets · Tracking</div>
          </div>
        </div>
        <nav style={S.tabs}>
          <button
            className={view.page === "team" ? "tab tab-active" : "tab"}
            onClick={() => setView({ page: "team", projectId: null })}
          >Team Board</button>
          <button
            className={view.page === "projectboard" ? "tab tab-active" : "tab"}
            onClick={() => setView({ page: "projectboard", projectId: null })}
          >Project Board</button>
          <button
            className={view.page === "projects" || view.page === "board" ? "tab tab-active" : "tab"}
            onClick={() => setView({ page: "projects", projectId: null })}
          >Projects</button>
        </nav>
        <div style={S.headerRight}>
          <span style={S.saveBadge}>
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved ✓"}
            {saveState === "error" && "Save failed"}
          </span>
          <button
            className="btn-ghost"
            title="Toggle dark mode"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >{theme === "dark" ? "☀ Light" : "🌙 Dark"}</button>
          <button
            className="btn-primary"
            onClick={() => setTicketModal({ mode: "new", ticket: null, defaultProjectId: view.projectId })}
            disabled={data.projects.length === 0}
            title={data.projects.length === 0 ? "Create a project first" : ""}
          >+ New ticket</button>
        </div>
      </header>

      {view.page === "team" && (
        <TeamBoard
          data={data}
          onEditTicket={(t) => setTicketModal({ mode: "edit", ticket: t })}
          onMove={(id, status, assignee) => updateTicket(id, { status, assignee })}
          onAddMember={addTeamMember}
          onRemoveMember={removeTeamMember}
        />
      )}

      {view.page === "projectboard" && (
        <ProjectStatusBoard
          data={data}
          onEditTicket={(t) => setTicketModal({ mode: "edit", ticket: t })}
        />
      )}

      {view.page === "projects" && (
        <ProjectsHome
          data={data}
          onOpen={(id) => setView({ page: "board", projectId: id })}
          onNew={() => setProjectModal({ mode: "new", project: null })}
          onEdit={(p) => setProjectModal({ mode: "edit", project: p })}
          onDelete={(p) => setConfirmDelete(p)}
        />
      )}

      {view.page === "board" && currentProject && (
        <ProjectBoard
          project={currentProject}
          tickets={data.tickets.filter((t) => t.projectId === currentProject.id)}
          team={data.team}
          onBack={() => setView({ page: "projects", projectId: null })}
          onEditTicket={(t) => setTicketModal({ mode: "edit", ticket: t })}
          onMove={(id, status) => updateTicket(id, { status })}
        />
      )}

      {ticketModal && (
        <TicketModal
          mode={ticketModal.mode}
          ticket={liveTicket || ticketModal.ticket}
          projects={data.projects}
          team={data.team}
          defaultProjectId={ticketModal.defaultProjectId}
          onSave={saveTicket}
          onDelete={deleteTicket}
          onAddComment={addComment}
          onDeleteComment={deleteComment}
          onClose={() => setTicketModal(null)}
        />
      )}

      {projectModal && (
        <ProjectModal mode={projectModal.mode} project={projectModal.project} onSave={saveProject} onClose={() => setProjectModal(null)} />
      )}

      {confirmDelete && (
        <div style={S.overlay} onClick={() => setConfirmDelete(null)}>
          <div style={{ ...S.modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitlePlain}>Delete "{confirmDelete.name}"?</div>
            <p style={{ fontSize: 13.5, color: "var(--c-text-3)", lineHeight: 1.5 }}>
              This permanently removes the project and all{" "}
              {data.tickets.filter((t) => t.projectId === confirmDelete.id).length} of its tickets, including comments and images. This can't be undone.
            </p>
            <div style={S.modalFooter}>
              <div style={{ flex: 1 }} />
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => deleteProject(confirmDelete.id)}>Delete project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- TEAM BOARD (main page: swimlanes per member) ----------
function TeamBoard({ data, onEditTicket, onMove, onAddMember, onRemoveMember }) {
  const [dragId, setDragId] = useState(null);
  const [dragCell, setDragCell] = useState(null); // "member|status"
  const [newMember, setNewMember] = useState("");
  const open = data.tickets.filter((t) => t.status !== "closed");
  const blockedCount = open.filter((t) => t.blocked).length;

  const rows = [...data.team, "Unassigned"];
  const ticketsFor = (member, status) =>
    data.tickets.filter(
      (t) => t.status === status && (member === "Unassigned" ? !t.assignee : t.assignee === member)
    );

  const onDrop = (member, status) => {
    if (dragId != null) onMove(dragId, status, member === "Unassigned" ? "" : member);
    setDragId(null);
    setDragCell(null);
  };

  const submitNewMember = () => {
    if (!newMember.trim()) return;
    onAddMember(newMember);
    setNewMember("");
  };

  const removeMember = (member) => {
    if (window.confirm(`Remove ${member} from the team? Their tickets will become unassigned.`)) {
      onRemoveMember(member);
    }
  };

  return (
    <div>
      <div style={S.homeTopRow}>
        <h2 style={S.pageTitle}>Team Board</h2>
        <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--c-text-2)", alignItems: "center" }}>
          <span>{open.length} open tickets</span>
          {blockedCount > 0 && <span style={{ color: SCARLET, fontWeight: 700 }}>🚩 {blockedCount} blocked</span>}
          <span style={{ color: "var(--c-text-muted)" }}>Tip: drag a card into another row to reassign it</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          style={{ ...S.search, maxWidth: 220 }}
          placeholder="New team member name…"
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitNewMember()}
        />
        <button className="btn-ghost" onClick={submitNewMember}>+ Add member</button>
      </div>

      <div style={S.laneWrap}>
        {/* column header row */}
        <div style={S.laneGrid}>
          <div style={S.laneCorner} />
          {COLUMNS.map((c) => (
            <div key={c.id} style={S.laneColHeader}>{c.label}</div>
          ))}
        </div>

        {rows.map((member) => {
          const memberOpen = data.tickets.filter(
            (t) => t.status !== "closed" && (member === "Unassigned" ? !t.assignee : t.assignee === member)
          );
          return (
            <div key={member} style={S.laneGrid}>
              <div style={S.laneMemberCell}>
                <span style={{ ...S.avatar, width: 30, height: 30, fontSize: 11, background: member === "Unassigned" ? "var(--c-text-muted)" : "var(--c-avatar-bg)" }}>
                  {member.slice(0, 2).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{member}</div>
                  <div style={{ fontSize: 11, color: "var(--c-text-2)" }}>{memberOpen.length} open</div>
                </div>
                {member !== "Unassigned" && (
                  <button className="icon-btn" title={`Remove ${member}`} onClick={() => removeMember(member)}>🗑</button>
                )}
              </div>
              {COLUMNS.map((col) => {
                const cellId = member + "|" + col.id;
                const ts = ticketsFor(member, col.id);
                return (
                  <div
                    key={col.id}
                    style={{ ...S.laneCell, ...(dragCell === cellId ? S.cellDragOver : {}) }}
                    onDragOver={(e) => { e.preventDefault(); setDragCell(cellId); }}
                    onDragLeave={() => setDragCell(null)}
                    onDrop={() => onDrop(member, col.id)}
                  >
                    {ts.map((t) => (
                      <MiniCard
                        key={t.id}
                        t={t}
                        project={data.projects.find((p) => p.id === t.projectId)}
                        dragging={dragId === t.id}
                        onDragStart={() => setDragId(t.id)}
                        onDragEnd={() => { setDragId(null); setDragCell(null); }}
                        onClick={() => onEditTicket(t)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- PROJECT BOARD (main page: swimlanes per project) ----------
const PROJECT_STATUS_COLUMNS = [
  { id: "todo", label: "To Do" },
  { id: "inprogress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "inreview", label: "In Review" },
  { id: "completed", label: "Completed" },
];

const projectStatusBucket = (t) => {
  if (t.blocked && t.status !== "closed") return "blocked";
  if (t.status === "closed") return "completed";
  if (t.status === "review") return "inreview";
  if (t.status === "todo") return "todo";
  return "inprogress"; // inprogress, testing, prodpush
};

function ProjectStatusBoard({ data, onEditTicket }) {
  const open = data.tickets.filter((t) => t.status !== "closed");
  const blockedCount = open.filter((t) => t.blocked).length;

  return (
    <div>
      <div style={S.homeTopRow}>
        <h2 style={S.pageTitle}>Project Board</h2>
        <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--c-text-2)", alignItems: "center" }}>
          <span>{open.length} open tickets</span>
          {blockedCount > 0 && <span style={{ color: SCARLET, fontWeight: 700 }}>🚩 {blockedCount} blocked</span>}
        </div>
      </div>

      {data.projects.length === 0 && (
        <div style={S.emptyHome}>No projects yet. Create a project to see it on the board.</div>
      )}

      {data.projects.length > 0 && (
        <div style={S.laneWrap}>
          <div style={S.laneGrid}>
            <div style={S.laneCorner} />
            {PROJECT_STATUS_COLUMNS.map((c) => (
              <div key={c.id} style={S.laneColHeader}>{c.label}</div>
            ))}
          </div>

          {data.projects.map((p) => {
            const ts = data.tickets.filter((t) => t.projectId === p.id);
            const openCount = ts.filter((t) => t.status !== "closed").length;
            return (
              <div key={p.id} style={S.laneGrid}>
                <div style={S.laneMemberCell}>
                  <span style={{ ...S.avatar, width: 30, height: 30, fontSize: 11, background: p.color }}>
                    {p.key.slice(0, 2)}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--c-text-2)" }}>{openCount} open</div>
                  </div>
                </div>
                {PROJECT_STATUS_COLUMNS.map((col) => {
                  const colTickets = ts.filter((t) => projectStatusBucket(t) === col.id);
                  return (
                    <div key={col.id} style={S.laneCell}>
                      {colTickets.map((t) => (
                        <MiniCard
                          key={t.id}
                          t={t}
                          project={p}
                          onClick={() => onEditTicket(t)}
                          onDragStart={() => {}}
                          onDragEnd={() => {}}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniCard({ t, project, onClick, onDragStart, onDragEnd, dragging }) {
  const pr = PRIORITIES[t.priority] || PRIORITIES.medium;
  const overdue = isOverdue(t.due, t.status);
  const commentCount = (t.comments || []).length;
  return (
    <div
      className="card"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        opacity: dragging ? 0.4 : 1,
        padding: "8px 10px",
        borderLeft: t.blocked ? `3px solid ${SCARLET}` : `3px solid ${project?.color || "var(--c-border)"}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ ...S.cardKey, fontSize: 10.5 }}>{t.key}</span>
        <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {t.blocked && <span title={t.blockReason || "Blocked"} style={{ fontSize: 11 }}>🚩</span>}
          {t.points != null && t.points !== "" && <span style={S.pointsBadge} title="Story points">{t.points}</span>}
          <span style={{ color: pr.color, fontSize: 10.5, fontWeight: 700 }}>{pr.glyph}</span>
        </span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{t.title}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 5, fontSize: 10.5, color: "var(--c-text-2)", alignItems: "center" }}>
        {project && <span style={{ color: project.color, fontWeight: 700 }}>{project.key}</span>}
        {t.due && <span style={{ color: overdue ? SCARLET : "var(--c-text-2)", fontWeight: overdue ? 700 : 500 }}>{overdue ? "⚠ " : ""}{fmtDate(t.due)}</span>}
        {commentCount > 0 && <span>💬 {commentCount}</span>}
      </div>
    </div>
  );
}

// ---------- PROJECTS HOME ----------
function ProjectsHome({ data, onOpen, onNew, onEdit, onDelete }) {
  return (
    <div>
      <div style={S.homeTopRow}>
        <h2 style={S.pageTitle}>Projects</h2>
        <button className="btn-primary" onClick={onNew}>+ New project</button>
      </div>
      {data.projects.length === 0 && (
        <div style={S.emptyHome}>No projects yet. Create your first project to start tracking tickets.</div>
      )}
      <div style={S.projectGrid}>
        {data.projects.map((p) => {
          const ts = data.tickets.filter((t) => t.projectId === p.id);
          const done = ts.filter((t) => t.status === "closed").length;
          const blocked = ts.filter((t) => t.blocked && t.status !== "closed").length;
          const overdue = ts.filter((t) => isOverdue(t.due, t.status)).length;
          const pct = ts.length ? Math.round((done / ts.length) * 100) : 0;
          return (
            <div key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
              <div style={{ ...S.projStripe, background: p.color }} />
              <div style={S.projBody}>
                <div style={S.projTopRow}>
                  <span style={{ ...S.projKey, color: p.color, borderColor: p.color + "55" }}>{p.key}</span>
                  <span style={S.projActions}>
                    <button className="icon-btn" title="Edit project" onClick={(e) => { e.stopPropagation(); onEdit(p); }}>✎</button>
                    <button className="icon-btn" title="Delete project" onClick={(e) => { e.stopPropagation(); onDelete(p); }}>🗑</button>
                  </span>
                </div>
                <div style={S.projName}>{p.name}</div>
                {p.description && <div style={S.projDesc}>{p.description}</div>}
                <div style={S.progressTrack}>
                  <div style={{ ...S.progressFill, width: pct + "%", background: p.color }} />
                </div>
                <div style={S.projStatsRow}>
                  <span>{ts.length} tickets</span>
                  {blocked > 0 && <span style={{ color: SCARLET, fontWeight: 700 }}>🚩 {blocked}</span>}
                  {overdue > 0 && <span style={{ color: SCARLET, fontWeight: 700 }}>{overdue} overdue</span>}
                  <span style={{ marginLeft: "auto", fontWeight: 700 }}>{pct}% done</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- PROJECT BOARD ----------
function ProjectBoard({ project, tickets, team, onBack, onEditTicket, onMove }) {
  const [search, setSearch] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const filtered = tickets.filter((t) => {
    if (filterAssignee && t.assignee !== filterAssignee) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const done = tickets.filter((t) => t.status === "closed").length;
  const pct = tickets.length ? Math.round((done / tickets.length) * 100) : 0;

  const onDrop = (colId) => {
    if (dragId != null) onMove(dragId, colId);
    setDragId(null);
    setDragOver(null);
  };

  return (
    <div>
      <div style={S.boardHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button className="btn-ghost" onClick={onBack}>← Projects</button>
          <span style={{ ...S.projKey, color: project.color, borderColor: project.color + "55" }}>{project.key}</span>
          <h2 style={{ ...S.pageTitle, margin: 0 }}>{project.name}</h2>
        </div>
        <div style={S.boardSubRow}>
          <div style={{ ...S.progressTrack, width: 160 }}>
            <div style={{ ...S.progressFill, width: pct + "%", background: project.color }} />
          </div>
          <span style={S.subStat}>{done}/{tickets.length} closed</span>
        </div>
      </div>

      <div style={S.filterRow}>
        <input style={S.search} placeholder={`Search ${project.key} tickets…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={S.select} value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
          <option value="">All assignees</option>
          {team.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div style={S.board}>
        {COLUMNS.map((col) => {
          const colTickets = filtered.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              style={{ ...S.column, ...(dragOver === col.id ? S.cellDragOver : {}) }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => onDrop(col.id)}
            >
              <div style={S.colHeader}>
                <span style={S.colTitle}>{col.label}</span>
                <span style={S.colCount}>{colTickets.length}</span>
              </div>
              <div style={S.colBody}>
                {colTickets.length === 0 && <div style={S.emptyCol}>Drop here</div>}
                {colTickets.map((t) => (
                  <FullCard
                    key={t.id} t={t} dragging={dragId === t.id}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => { setDragId(null); setDragOver(null); }}
                    onClick={() => onEditTicket(t)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FullCard({ t, onClick, onDragStart, onDragEnd, dragging }) {
  const pr = PRIORITIES[t.priority] || PRIORITIES.medium;
  const ty = TYPES[t.type] || TYPES.task;
  const overdue = isOverdue(t.due, t.status);
  const commentCount = (t.comments || []).length;
  return (
    <div
      className="card" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick}
      style={{ opacity: dragging ? 0.4 : 1, borderLeft: t.blocked ? `3px solid ${SCARLET}` : undefined }}
    >
      <div style={S.cardTop}>
        <span style={S.cardKey}>{t.key}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {t.blocked && <span title={t.blockReason || "Blocked"}>🚩</span>}
          {t.points != null && t.points !== "" && <span style={S.pointsBadge} title="Story points">{t.points}</span>}
          <span style={{ ...S.typePill, color: ty.color, borderColor: ty.color + "55" }}>{ty.glyph} {ty.label}</span>
        </span>
      </div>
      <div style={S.cardTitle}>{t.title}</div>
      <div style={S.cardBottom}>
        <span style={{ color: pr.color, fontSize: 12, fontWeight: 600 }}>{pr.glyph} {pr.label}</span>
        <span style={S.cardMeta}>
          {commentCount > 0 && <span style={{ color: "var(--c-text-2)" }}>💬 {commentCount}</span>}
          {t.due && <span style={{ color: overdue ? SCARLET : "var(--c-text-2)", fontWeight: overdue ? 700 : 500 }}>{overdue ? "⚠ " : ""}{fmtDate(t.due)}</span>}
          {t.assignee && <span style={S.avatar}>{t.assignee.slice(0, 2).toUpperCase()}</span>}
        </span>
      </div>
    </div>
  );
}

// ---------- TICKET MODAL (details + blocker + comments) ----------
function TicketModal({ mode, ticket, projects, team, defaultProjectId, onSave, onDelete, onAddComment, onDeleteComment, onClose }) {
  const [f, setF] = useState(
    ticket || {
      title: "", description: "", type: "task", priority: "medium",
      assignee: "", status: "todo", due: "", points: "",
      projectId: defaultProjectId || projects[0]?.id,
      blocked: false, blockReason: "",
    }
  );
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // comments state
  const [commentText, setCommentText] = useState("");
  const [commentAuthor, setCommentAuthor] = useState(team[0]);
  const [pendingImages, setPendingImages] = useState([]); // dataURLs not yet saved
  const [imageCache, setImageCache] = useState({}); // storageKey -> dataURL
  const [posting, setPosting] = useState(false);
  const fileRef = useRef(null);
  const textRef = useRef(null);

  // load images for existing comments
  useEffect(() => {
    if (!ticket?.comments) return;
    const keys = ticket.comments.flatMap((c) => c.imageKeys || []);
    keys.forEach(async (k) => {
      if (imageCache[k]) return;
      try {
        const res = await storage.get(k);
        if (res?.value) setImageCache((p) => ({ ...p, [k]: res.value }));
      } catch { /* missing */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.comments?.length]);

  const submit = () => {
    if (!f.title.trim() || !f.projectId) return;
    onSave({ ...f, projectId: Number(f.projectId), points: f.points === "" ? null : Number(f.points) });
  };

  const pickImages = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const dataUrl = await compressImage(file);
        setPendingImages((p) => [...p, dataUrl]);
      } catch { /* skip bad file */ }
    }
    e.target.value = "";
  };

  const insertMention = (name) => {
    setCommentText((t) => (t.endsWith(" ") || t === "" ? t : t + " ") + "@" + name + " ");
    textRef.current?.focus();
  };

  const postComment = async () => {
    if ((!commentText.trim() && pendingImages.length === 0) || posting) return;
    setPosting(true);
    const imageKeys = [];
    try {
      for (const dataUrl of pendingImages) {
        const key = "ttuo-img-" + uid();
        await storage.set(key, dataUrl);
        imageKeys.push(key);
        setImageCache((p) => ({ ...p, [key]: dataUrl }));
      }
      onAddComment(ticket.id, {
        id: uid(), author: commentAuthor, text: commentText.trim(), imageKeys, ts: Date.now(),
      });
      setCommentText("");
      setPendingImages([]);
    } catch {
      alert("Couldn't save image — it may be too large. Try a smaller image.");
    }
    setPosting(false);
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <span style={S.modalTitle}>{mode === "new" ? "New ticket" : ticket.key}</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <label style={S.fieldLabel}>Title</label>
        <input style={S.input} autoFocus={mode === "new"} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs to be done?" />

        <label style={S.fieldLabel}>Description</label>
        <textarea style={{ ...S.input, minHeight: 64, resize: "vertical" }} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Context, links, acceptance criteria…" />

        <div style={S.fieldGrid}>
          <div>
            <label style={S.fieldLabel}>Project</label>
            <select
              style={S.input} value={f.projectId}
              onChange={(e) => set("projectId", Number(e.target.value))}
              disabled={mode === "edit"}
              title={mode === "edit" ? "Tickets keep their project (the key is derived from it)" : ""}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.key} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={S.fieldLabel}>Assignee</label>
            <select style={S.input} value={f.assignee} onChange={(e) => set("assignee", e.target.value)}>
              <option value="">Unassigned</option>
              {team.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={S.fieldLabel}>Status</label>
            <select style={S.input} value={f.status} onChange={(e) => set("status", e.target.value)}>
              {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.fieldLabel}>Type</label>
            <select style={S.input} value={f.type} onChange={(e) => set("type", e.target.value)}>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.fieldLabel}>Priority</label>
            <select style={S.input} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
              {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.fieldLabel}>Due date</label>
            <input type="date" style={S.input} value={f.due} onChange={(e) => set("due", e.target.value)} />
          </div>
          <div>
            <label style={S.fieldLabel}>Story points</label>
            <input
              type="number" min="0" step="1" style={S.input} value={f.points ?? ""}
              onChange={(e) => set("points", e.target.value)}
              placeholder="e.g. 3"
            />
          </div>
        </div>

        {/* blocker */}
        <div style={{ ...S.blockerBox, borderColor: f.blocked ? SCARLET + "66" : "var(--c-border)", background: f.blocked ? SCARLET + "08" : "var(--c-surface-2)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", fontSize: 13.5, fontWeight: 700 }}>
            <input type="checkbox" checked={f.blocked} onChange={(e) => set("blocked", e.target.checked)} style={{ width: 16, height: 16, accentColor: SCARLET }} />
            🚩 This ticket is blocked
          </label>
          {f.blocked && (
            <textarea
              style={{ ...S.input, marginTop: 9, minHeight: 48, resize: "vertical" }}
              value={f.blockReason}
              onChange={(e) => set("blockReason", e.target.value)}
              placeholder="What's blocking it? e.g. Waiting on IT firewall approval"
            />
          )}
        </div>

        <div style={S.modalFooter}>
          {mode === "edit" && <button className="btn-danger" onClick={() => onDelete(f.id)}>Delete</button>}
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit}>{mode === "new" ? "Create ticket" : "Save changes"}</button>
        </div>

        {/* comments — only on existing tickets */}
        {mode === "edit" && (
          <div style={S.commentsSection}>
            <div style={{ ...S.fieldLabel, margin: "0 0 10px" }}>Comments ({(ticket.comments || []).length})</div>

            {(ticket.comments || []).map((c) => (
              <div key={c.id} style={S.comment}>
                <span style={{ ...S.avatar, flexShrink: 0 }}>{c.author.slice(0, 2).toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{c.author}</span>
                    <span style={{ fontSize: 11, color: "var(--c-text-muted)" }}>{fmtTs(c.ts)}</span>
                    <button className="icon-btn" style={{ marginLeft: "auto", fontSize: 11 }} title="Delete comment" onClick={() => onDeleteComment(ticket.id, c.id)}>🗑</button>
                  </div>
                  {c.text && <div style={{ fontSize: 13.5, lineHeight: 1.45, marginTop: 2 }}><MentionText text={c.text} team={team} /></div>}
                  {(c.imageKeys || []).length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      {c.imageKeys.map((k) =>
                        imageCache[k] ? (
                          <img key={k} src={imageCache[k]} alt="attachment" style={S.commentImg}
                            onClick={() => window.open(imageCache[k], "_blank")} />
                        ) : (
                          <div key={k} style={{ ...S.commentImg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--c-text-muted)", background: "var(--c-hover)" }}>Loading…</div>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* composer */}
            <div style={S.composer}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
                <span style={{ fontSize: 11.5, color: "var(--c-text-2)" }}>Commenting as</span>
                <select style={{ ...S.select, padding: "4px 8px", fontSize: 12.5 }} value={commentAuthor} onChange={(e) => setCommentAuthor(e.target.value)}>
                  {team.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  {team.filter((m) => m !== commentAuthor).map((m) => (
                    <button key={m} className="mention-chip" onClick={() => insertMention(m)}>@{m}</button>
                  ))}
                </span>
              </div>
              <textarea
                ref={textRef}
                style={{ ...S.input, minHeight: 56, resize: "vertical" }}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment… use @Name to tag a teammate"
              />
              {pendingImages.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {pendingImages.map((src, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={src} alt="pending" style={S.commentImg} />
                      <button
                        className="icon-btn"
                        style={{ position: "absolute", top: 2, right: 2, background: "var(--c-surface)", borderRadius: "50%", fontSize: 10, lineHeight: 1, padding: "3px 5px" }}
                        onClick={() => setPendingImages((p) => p.filter((_, j) => j !== i))}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 9, alignItems: "center" }}>
                <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={pickImages} />
                <button className="btn-ghost" onClick={() => fileRef.current?.click()}>📎 Add image</button>
                <div style={{ flex: 1 }} />
                <button className="btn-primary" onClick={postComment} disabled={posting}>
                  {posting ? "Posting…" : "Post comment"}
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === "new" && (
          <div style={{ fontSize: 12, color: "var(--c-text-muted)", marginTop: 10 }}>
            The ticket number is assigned automatically from the project key (e.g. DATAX-3). Comments open up after the ticket is created.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- PROJECT MODAL ----------
function ProjectModal({ mode, project, onSave, onClose }) {
  const [f, setF] = useState(project || { name: "", key: "", description: "", color: PROJECT_COLORS[0] });
  const [keyTouched, setKeyTouched] = useState(mode === "edit");
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const onNameChange = (v) => {
    if (!keyTouched) setF((p) => ({ ...p, name: v, key: keyFromName(v) }));
    else set("name", v);
  };

  const submit = () => {
    if (!f.name.trim() || !f.key.trim()) return;
    onSave({ ...f, key: f.key.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) });
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <span style={S.modalTitlePlain}>{mode === "new" ? "New project" : "Edit project"}</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <label style={S.fieldLabel}>Project name</label>
        <input style={S.input} autoFocus value={f.name} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. ElevenLabs Call Analyzer" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "0 14px" }}>
          <div>
            <label style={S.fieldLabel}>Key (ticket prefix)</label>
            <input
              style={{ ...S.input, fontFamily: "'SF Mono', Consolas, monospace", textTransform: "uppercase" }}
              value={f.key} maxLength={6}
              onChange={(e) => { setKeyTouched(true); set("key", e.target.value.toUpperCase()); }}
              placeholder="AVA" disabled={mode === "edit"}
            />
          </div>
          <div>
            <label style={S.fieldLabel}>Color</label>
            <div style={{ display: "flex", gap: 8, paddingTop: 6 }}>
              {PROJECT_COLORS.map((c) => (
                <button key={c} onClick={() => set("color", c)}
                  style={{ width: 26, height: 26, borderRadius: "50%", background: c, cursor: "pointer", border: f.color === c ? "3px solid var(--c-text)" : "3px solid transparent" }} />
              ))}
            </div>
          </div>
        </div>
        <label style={S.fieldLabel}>Description</label>
        <textarea style={{ ...S.input, minHeight: 60, resize: "vertical" }} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What is this project about?" />
        <div style={S.modalFooter}>
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit}>{mode === "new" ? "Create project" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- styles ----------
const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; }

  [data-theme="light"] {
    --c-bg: #F6F4EF; --c-surface: #fff; --c-surface-2: #FAF9F6; --c-hover: #F1EFEA;
    --c-border: #E4E2DD; --c-border-2: #EDEAE3; --c-input-border: #D8D6D0;
    --c-text: #1A1A1E; --c-text-2: #6B6B72; --c-text-3: #515158; --c-text-muted: #9B978E;
    --c-track: #E8E5DE; --c-dashed: #CFCBC2; --c-disabled: #C9C6BF; --c-drag: #F3EFE6;
    --c-overlay: rgba(20,20,25,.45); --c-avatar-bg: #1A1A1E; --c-card-shadow: rgba(20,20,25,.10);
    --c-card-shadow-2: rgba(20,20,25,.12); --c-modal-shadow: rgba(20,20,25,.25);
  }
  [data-theme="dark"] {
    --c-bg: #18171B; --c-surface: #221F24; --c-surface-2: #28252A; --c-hover: #322F36;
    --c-border: #38353C; --c-border-2: #2E2B31; --c-input-border: #43404A;
    --c-text: #F1EEEA; --c-text-2: #A6A2A8; --c-text-3: #C7C3C9; --c-text-muted: #807C84;
    --c-track: #38353C; --c-dashed: #4A4750; --c-disabled: #4A4750; --c-drag: #332E2A;
    --c-overlay: rgba(0,0,0,.6); --c-avatar-bg: #4A4750; --c-card-shadow: rgba(0,0,0,.4);
    --c-card-shadow-2: rgba(0,0,0,.5); --c-modal-shadow: rgba(0,0,0,.6);
  }

  body { background: var(--c-bg); }
  .card {
    background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 8px;
    padding: 12px; cursor: grab; transition: box-shadow .15s, transform .15s, background .2s, border-color .2s;
  }
  .card:hover { box-shadow: 0 4px 14px var(--c-card-shadow); transform: translateY(-1px); }
  .card:active { cursor: grabbing; }
  .project-card {
    background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px;
    overflow: hidden; cursor: pointer; transition: box-shadow .15s, transform .15s, background .2s, border-color .2s;
    display: flex; flex-direction: column;
  }
  .project-card:hover { box-shadow: 0 6px 20px var(--c-card-shadow-2); transform: translateY(-2px); }
  .icon-btn { background: transparent; border: none; cursor: pointer; font-size: 14px; color: var(--c-text-2); padding: 3px 6px; border-radius: 5px; }
  .icon-btn:hover { background: var(--c-hover); color: var(--c-text); }
  .tab {
    background: transparent; border: none; font-family: inherit; font-size: 13.5px;
    font-weight: 600; color: var(--c-text-2); padding: 8px 14px; cursor: pointer;
    border-bottom: 2.5px solid transparent;
  }
  .tab:hover { color: var(--c-text); }
  .tab-active { color: ${SCARLET}; border-bottom-color: ${SCARLET}; }
  .mention-chip {
    background: var(--c-hover); border: 1px solid var(--c-border); border-radius: 999px;
    font-size: 11px; font-weight: 600; color: var(--c-text-3); padding: 2px 8px;
    cursor: pointer; font-family: inherit;
  }
  .mention-chip:hover { background: ${SCARLET}12; color: ${SCARLET}; border-color: ${SCARLET}44; }
  .btn-primary {
    background: ${SCARLET}; color: #fff; border: none; border-radius: 7px;
    padding: 9px 16px; font-size: 13.5px; font-weight: 600; cursor: pointer;
    font-family: inherit; transition: background .15s; white-space: nowrap;
  }
  .btn-primary:hover { background: #8F0016; }
  .btn-primary:disabled { background: var(--c-disabled); cursor: not-allowed; }
  .btn-ghost {
    background: transparent; color: var(--c-text-3); border: 1px solid var(--c-input-border);
    border-radius: 7px; padding: 8px 14px; font-size: 13px; cursor: pointer;
    font-family: inherit; white-space: nowrap;
  }
  .btn-ghost:hover { background: var(--c-hover); }
  .btn-danger { background: transparent; color: ${SCARLET}; border: 1px solid ${SCARLET}66; border-radius: 7px; padding: 8px 14px; font-size: 13px; cursor: pointer; font-family: inherit; }
  .btn-danger:hover { background: ${SCARLET}11; }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid ${SCARLET}; outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { .card, .project-card { transition: none; } }
`;

const S = {
  app: {
    fontFamily: "'Avenir Next', 'Segoe UI', system-ui, sans-serif",
    background: "var(--c-bg)", minHeight: "100vh", padding: "20px 22px 40px", color: "var(--c-text)",
    transition: "background .2s, color .2s",
  },
  loadWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-bg)" },
  loadText: { fontFamily: "system-ui", color: "var(--c-text-2)" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, marginBottom: 20 },
  brandRow: { display: "flex", alignItems: "center", gap: 12 },
  brandMark: { background: SCARLET, color: "#fff", fontWeight: 800, letterSpacing: "0.06em", padding: "9px 11px", borderRadius: 8, fontSize: 14 },
  brandTitle: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" },
  brandSub: { fontSize: 11.5, color: "var(--c-text-2)", letterSpacing: "0.08em", textTransform: "uppercase" },
  tabs: { display: "flex", gap: 4 },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  saveBadge: { fontSize: 12, color: "var(--c-text-2)", minWidth: 56, textAlign: "right" },

  homeTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 },
  pageTitle: { fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", margin: 0 },
  emptyHome: { border: "1.5px dashed var(--c-dashed)", borderRadius: 10, padding: "40px 20px", textAlign: "center", color: "var(--c-text-muted)", fontSize: 14 },

  // team swimlanes
  laneWrap: { overflowX: "auto", border: "1px solid var(--c-border)", borderRadius: 12, background: "var(--c-surface)" },
  laneGrid: { display: "grid", gridTemplateColumns: "170px repeat(6, minmax(170px, 1fr))", borderBottom: "1px solid var(--c-border-2)", minWidth: 1200 },
  laneCorner: { padding: "10px 14px" },
  laneColHeader: {
    padding: "10px 12px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.07em", color: "var(--c-text-3)", borderLeft: "1px solid var(--c-border-2)", background: "var(--c-surface-2)",
  },
  laneMemberCell: { padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, background: "var(--c-surface-2)" },
  laneCell: {
    borderLeft: "1px solid var(--c-border-2)", padding: 8, display: "flex", flexDirection: "column",
    gap: 7, minHeight: 64, transition: "background .15s",
  },
  cellDragOver: { background: "var(--c-drag)", outline: `2px dashed ${SCARLET}55`, outlineOffset: -2 },

  // projects
  projectGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 16 },
  projStripe: { height: 5 },
  projBody: { padding: "14px 16px 16px", display: "flex", flexDirection: "column", flex: 1 },
  projTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  projKey: {
    fontFamily: "'SF Mono', 'Cascadia Code', Consolas, monospace",
    fontSize: 11.5, fontWeight: 700, border: "1px solid", borderRadius: 5, padding: "2px 8px", letterSpacing: "0.04em",
  },
  projActions: { display: "flex", gap: 2 },
  projName: { fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 },
  projDesc: { fontSize: 12.5, color: "var(--c-text-2)", lineHeight: 1.45, marginBottom: 12 },
  progressTrack: { height: 6, background: "var(--c-track)", borderRadius: 999, overflow: "hidden", marginTop: "auto" },
  progressFill: { height: "100%", borderRadius: 999, transition: "width .3s" },
  projStatsRow: { display: "flex", gap: 12, fontSize: 12, color: "var(--c-text-2)", marginTop: 8, alignItems: "center" },

  // project board
  boardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  boardSubRow: { display: "flex", alignItems: "center", gap: 12 },
  subStat: { fontSize: 12.5, color: "var(--c-text-2)" },
  filterRow: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 },
  search: { flex: "1 1 220px", maxWidth: 340, padding: "9px 12px", borderRadius: 7, border: "1px solid var(--c-input-border)", fontSize: 13.5, fontFamily: "inherit", background: "var(--c-surface)", color: "var(--c-text)" },
  select: { padding: "9px 10px", borderRadius: 7, border: "1px solid var(--c-input-border)", fontSize: 13.5, fontFamily: "inherit", background: "var(--c-surface)", color: "var(--c-text)" },

  board: { display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto", paddingBottom: 8 },
  column: { flex: "1 0 210px", minWidth: 210, background: "var(--c-border-2)", borderRadius: 10, padding: 9, transition: "background .15s" },
  colHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 9px" },
  colTitle: { fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-text-3)" },
  colCount: { fontSize: 11.5, fontWeight: 700, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 999, padding: "1px 8px", color: "var(--c-text-3)" },
  colBody: { display: "flex", flexDirection: "column", gap: 7, minHeight: 56 },
  emptyCol: { border: "1.5px dashed var(--c-dashed)", borderRadius: 8, padding: "14px 8px", textAlign: "center", fontSize: 12, color: "var(--c-text-muted)" },

  // cards
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardKey: { fontFamily: "'SF Mono', 'Cascadia Code', Consolas, monospace", fontSize: 11.5, fontWeight: 600, color: SCARLET, letterSpacing: "0.02em" },
  typePill: { fontSize: 10.5, fontWeight: 700, border: "1px solid", borderRadius: 999, padding: "1px 8px", letterSpacing: "0.03em" },
  pointsBadge: {
    fontSize: 10.5, fontWeight: 700, color: "var(--c-text-3)", background: "var(--c-surface-2)",
    border: "1px solid var(--c-border)", borderRadius: 999, padding: "1px 6px", minWidth: 18, textAlign: "center",
  },
  cardTitle: { fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, marginBottom: 8 },
  cardBottom: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  cardMeta: { display: "flex", alignItems: "center", gap: 8, fontSize: 12 },
  avatar: {
    background: "var(--c-avatar-bg)", color: "#fff", borderRadius: "50%", width: 26, height: 26,
    display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700,
  },

  // blocker
  blockerBox: { border: "1px solid", borderRadius: 9, padding: "12px 14px", marginTop: 14 },

  // comments
  commentsSection: { borderTop: "1px solid var(--c-border-2)", marginTop: 20, paddingTop: 16 },
  comment: { display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--c-hover)" },
  commentImg: { width: 110, height: 80, objectFit: "cover", borderRadius: 7, border: "1px solid var(--c-border)", cursor: "pointer" },
  composer: { background: "var(--c-surface-2)", border: "1px solid var(--c-border-2)", borderRadius: 10, padding: 12, marginTop: 12 },

  // modals
  overlay: { position: "fixed", inset: 0, background: "var(--c-overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 },
  modal: { background: "var(--c-surface)", borderRadius: 12, padding: 22, width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px var(--c-modal-shadow)" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { fontSize: 16, fontWeight: 700, fontFamily: "'SF Mono', 'Cascadia Code', Consolas, monospace", color: SCARLET },
  modalTitlePlain: { fontSize: 16, fontWeight: 700 },
  fieldLabel: { display: "block", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-text-2)", margin: "10px 0 5px" },
  input: { width: "100%", padding: "9px 11px", borderRadius: 7, border: "1px solid var(--c-input-border)", fontSize: 13.5, fontFamily: "inherit", background: "var(--c-surface)", color: "var(--c-text)" },
  fieldGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: "0 14px" },
  modalFooter: { display: "flex", gap: 10, marginTop: 18, alignItems: "center" },
};
