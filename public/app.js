const { useEffect, useMemo, useRef, useState } = React;

const TOKEN_KEY = "taskflow_token";
const USER_KEY = "taskflow_user";
const TASK_HISTORY_PREFIX = "taskflow_has_created_task_";
const COMPLETED_TASKS_PAGE_SIZE = 3;

function App() {
  const [mode, setMode] = useState("login");
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(() => {
    const rawUser = localStorage.getItem(USER_KEY);
    return rawUser ? JSON.parse(rawUser) : null;
  });
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [taskForm, setTaskForm] = useState({ title: "", description: "", status: "todo" });
  const [editingTask, setEditingTask] = useState(null);
  const [editTaskForm, setEditTaskForm] = useState({ title: "", description: "", status: "todo" });
  const [activeTab, setActiveTab] = useState("todo");
  const [completedPage, setCompletedPage] = useState(1);
  const [expandedTask, setExpandedTask] = useState(null);
  const [expandableTaskIds, setExpandableTaskIds] = useState([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const descriptionRefs = useRef({});
  const taskListRef = useRef(null);

  function showToast(message, type = "info") {
    setToast({ id: Date.now(), message, type });
  }

  async function apiRequest(path, options = {}) {
    const authToken = options.token ?? token;
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error || "Request failed");
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function handleAuthSuccess(data) {
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setAuthForm({ name: "", email: "", password: "" });
    setError("");
    showToast(`Welcome, ${data.user.name}!`);
  }

  function getTaskHistoryKey(userId) {
    return `${TASK_HISTORY_PREFIX}${userId}`;
  }

  function getCurrentUserForHistory(currentUser = user) {
    if (currentUser?.id) {
      return currentUser;
    }

    const rawUser = localStorage.getItem(USER_KEY);
    return rawUser ? JSON.parse(rawUser) : null;
  }

  function hasUserCreatedTask(currentUser = user) {
    const resolvedUser = getCurrentUserForHistory(currentUser);
    if (!resolvedUser?.id) {
      return false;
    }

    return localStorage.getItem(getTaskHistoryKey(resolvedUser.id)) === "true";
  }

  function markUserHasCreatedTask(currentUser = user) {
    const resolvedUser = getCurrentUserForHistory(currentUser);
    if (!resolvedUser?.id) {
      return;
    }

    localStorage.setItem(getTaskHistoryKey(resolvedUser.id), "true");
  }

  async function loadTasks(tokenOverride) {
    const authToken = typeof tokenOverride === "string" ? tokenOverride : token;
    if (!authToken) {
      return;
    }

    setLoadingTasks(true);
    try {
      const data = await apiRequest("/api/tasks", { token: authToken });
      setTasks(data.tasks);
      if (data.tasks.length > 0) {
        markUserHasCreatedTask(user);
      }
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.status === 401) {
        handleLogout(false);
      }
    } finally {
      setLoadingTasks(false);
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    apiRequest("/api/me")
      .then((data) => {
        setUser(data.user);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        loadTasks();
      })
      .catch((requestError) => {
        if (requestError.status === 401) {
          handleLogout(false);
          return;
        }

        setError("Couldn't restore your session right now.");
      });
  }, [token]);

  async function handleRegister(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await apiRequest("/api/register", {
        method: "POST",
        body: authForm,
      });
      handleAuthSuccess(data);
      await loadTasks(data.token);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await apiRequest("/api/login", {
        method: "POST",
        body: { email: authForm.email, password: authForm.password },
      });
      handleAuthSuccess(data);
      await loadTasks(data.token);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleTaskSubmit(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await apiRequest("/api/tasks", {
        method: "POST",
        body: taskForm,
      });
      markUserHasCreatedTask();
      setTasks((currentTasks) => [data.task, ...currentTasks]);
      showToast(`Task "${data.task.title}" created.`);

      resetTaskForm();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleEditTaskSubmit(event) {
    event.preventDefault();
    if (!editingTask) {
      return;
    }

    setError("");
    try {
      const data = await apiRequest(`/api/tasks/${editingTask.id}`, {
        method: "PUT",
        body: editTaskForm,
      });
      setTasks((currentTasks) =>
        currentTasks.map((task) => (task.id === editingTask.id ? data.task : task)),
      );
      setExpandedTask((currentTask) => (currentTask?.id === editingTask.id ? data.task : currentTask));
      setEditingTask(null);
      setEditTaskForm({ title: "", description: "", status: "todo" });
      showToast(`Task "${data.task.title}" updated.`);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function startEdit(task) {
    setEditingTask(task);
    setEditTaskForm({
      title: task.title,
      description: task.description,
      status: task.status,
    });
    setError("");
    setExpandedTask(null);
  }

  function resetTaskForm() {
    setTaskForm({ title: "", description: "", status: "todo" });
  }

  function goToTaskSection(tab) {
    if (tab) {
      setActiveTab(tab);
    }

    requestAnimationFrame(() => {
      taskListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function downloadCompletedTasks() {
    const completedTasks = tasks.filter((task) => task.status === "done");
    if (completedTasks.length === 0) {
      setError("There are no completed tasks to download.");
      return;
    }

    const lines = [
      "Completed Tasks",
      `Exported: ${new Date().toLocaleString()}`,
      "",
      ...completedTasks.map((task, index) => {
        return [
          `${index + 1}. ${task.title}`,
          `Description: ${task.description || "No description added."}`,
          `Updated: ${new Date(task.updatedAt).toLocaleString()}`,
          "",
        ].join("\n");
      }),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `completed-tasks-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setError("");
    showToast("Completed tasks downloaded.");
  }

  async function toggleTaskStatus(task) {
    const nextStatus = task.status === "todo" ? "done" : "todo";

    try {
      const data = await apiRequest(`/api/tasks/${task.id}`, {
        method: "PUT",
        body: {
          title: task.title,
          description: task.description,
          status: nextStatus,
        },
      });
      setTasks((currentTasks) =>
        currentTasks.map((entry) => (entry.id === task.id ? data.task : entry)),
      );
      setEditingTask((currentTask) => (currentTask?.id === task.id ? data.task : currentTask));
      setExpandedTask((currentTask) => {
        if (currentTask?.id !== task.id) {
          return currentTask;
        }

        if (task.status === "todo") {
          return null;
        }

        return data.task;
      });
      showToast(
        `Task "${data.task.title}" marked as ${nextStatus === "done" ? "complete" : "to-do"}.`,
      );
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteTask(taskId) {
    try {
      const taskToDelete = tasks.find((task) => task.id === taskId);
      await apiRequest(`/api/tasks/${taskId}`, { method: "DELETE" });
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId));
      setEditingTask((currentTask) => (currentTask?.id === taskId ? null : currentTask));
      setExpandedTask((currentTask) => (currentTask?.id === taskId ? null : currentTask));
      showToast(`Task "${taskToDelete?.title || "Untitled"}" deleted.`);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function handleLogout(shouldCallApi = true) {
    if (shouldCallApi && token) {
      try {
        await apiRequest("/api/logout", { method: "POST" });
      } catch (requestError) {
        console.error(requestError);
      }
    }

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken("");
    setUser(null);
    setTasks([]);
    setMode("login");
    resetTaskForm();
    showToast("Signed out.");
    setError("");
  }

  const taskSummary = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((task) => task.status === "done").length;
    return {
      total,
      completed,
      remaining: total - completed,
    };
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => task.status === activeTab);
  }, [activeTab, tasks]);

  const paginatedVisibleTasks = useMemo(() => {
    if (activeTab !== "done") {
      return visibleTasks;
    }

    const startIndex = (completedPage - 1) * COMPLETED_TASKS_PAGE_SIZE;
    return visibleTasks.slice(startIndex, startIndex + COMPLETED_TASKS_PAGE_SIZE);
  }, [activeTab, completedPage, visibleTasks]);

  const completedPageCount = useMemo(() => {
    return Math.max(1, Math.ceil(taskSummary.completed / COMPLETED_TASKS_PAGE_SIZE));
  }, [taskSummary.completed]);

  const todoEmptyMessage = useMemo(() => {
    if (hasUserCreatedTask()) {
      return "No to do tasks yet. Add your tasks here.";
    }

    return "No to do tasks yet. Add your first task to get started.";
  }, [tasks, user]);

  useEffect(() => {
    if (activeTab !== "done") {
      return;
    }

    if (completedPage > completedPageCount) {
      setCompletedPage(completedPageCount);
    }
  }, [activeTab, completedPage, completedPageCount]);

  useEffect(() => {
    setCompletedPage(1);
  }, [activeTab]);

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      const nextExpandableTaskIds = paginatedVisibleTasks
        .filter((task) => {
          const element = descriptionRefs.current[task.id];
          if (!element) {
            return false;
          }

          const hasOverflow = element.scrollHeight > element.clientHeight + 1;
          const hasManyLineBreaks = (task.description.match(/\n/g) || []).length >= 4;
          const hasLongText = task.description.trim().length > 180;

          return hasOverflow || hasManyLineBreaks || hasLongText;
        })
        .map((task) => task.id);

      setExpandableTaskIds(nextExpandableTaskIds);
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [paginatedVisibleTasks]);

  useEffect(() => {
    if (expandedTask && !tasks.some((task) => task.id === expandedTask.id)) {
      setExpandedTask(null);
    }

    if (editingTask && !tasks.some((task) => task.id === editingTask.id)) {
      setEditingTask(null);
    }
  }, [editingTask, expandedTask, tasks]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  if (!user) {
    return (
      <main className="shell auth-shell">
        <section className="brand-panel">
          <p className="eyebrow">TaskFlow</p>
          <h1>Plan the day. Finish the work.</h1>
          <p className="lead">
            A lightweight task manager with account login and full CRUD support.
          </p>
        </section>

        <section className="card auth-card">
          <div className="mode-toggle">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
              type="button"
            >
              Login
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => setMode("register")}
              type="button"
            >
              Register
            </button>
          </div>

          <form onSubmit={mode === "login" ? handleLogin : handleRegister}>
            {mode === "register" && (
              <label>
                <span>Name</span>
                <input
                  required
                  type="text"
                  value={authForm.name}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
            )}

            <label>
              <span>Email</span>
              <input
                required
                type="email"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>

            <label>
              <span>Password</span>
              <input
                required
                minLength="6"
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, password: event.target.value }))
                }
              />
            </label>

            <button className="primary-button" type="submit">
              {mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          {error && <p className="message error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <>
      {toast && (
        <div className={`toast toast-${toast.type}`} key={toast.id} role="status">
          {toast.message}
        </div>
      )}

      <main className="shell dashboard-shell">
        <section className="dashboard-header">
          <div>
            <p className="eyebrow">Welcome back</p>
            <h1>{user.name}'s Tasks</h1>
            <p className="lead">Track work, update status, and keep momentum visible.</p>
          </div>
          <button className="ghost-button" onClick={() => handleLogout(true)} type="button">
            Logout
          </button>
        </section>

        <section className="stats-grid">
          <article
            className="stat-card stat-card-clickable"
            onClick={() => goToTaskSection("todo")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                goToTaskSection("todo");
              }
            }}
            role="button"
            tabIndex="0"
          >
            <span>Total Tasks</span>
            <strong>{taskSummary.total}</strong>
          </article>
          <article
            className="stat-card stat-card-clickable"
            onClick={() => goToTaskSection("done")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                goToTaskSection("done");
              }
            }}
            role="button"
            tabIndex="0"
          >
            <span>Completed Tasks</span>
            <strong>{taskSummary.completed}</strong>
          </article>
          <article
            className="stat-card stat-card-clickable"
            onClick={() => goToTaskSection("todo")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                goToTaskSection("todo");
              }
            }}
            role="button"
            tabIndex="0"
          >
            <span>To-Do Tasks</span>
            <strong>{taskSummary.remaining}</strong>
          </article>
        </section>

        <section className="content-grid">
          <article className="card form-card">
            <div className="card-heading">
              <h2>Create Task</h2>
            </div>

            <form onSubmit={handleTaskSubmit}>
              <label>
                <span>Title</span>
                <input
                  required
                  type="text"
                  value={taskForm.title}
                  onChange={(event) =>
                    setTaskForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>

              <label>
                <span>Description</span>
                <textarea
                  rows="10"
                  value={taskForm.description}
                  onChange={(event) =>
                    setTaskForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </label>

              <label>
                <span>Status</span>
                <select
                  value={taskForm.status}
                  onChange={(event) =>
                    setTaskForm((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  <option value="todo">To-Do</option>
                  <option value="done">Completed Task</option>
                </select>
              </label>

              <button className="primary-button" type="submit">
                Add Task
              </button>
            </form>

            {error && <p className="message error">{error}</p>}
          </article>

          <article className="card list-card" ref={taskListRef}>
            <div className="card-heading">
              <h2>Your Task List</h2>
              <div className="header-actions">
                {activeTab === "done" && (
                  <button className="link-button" onClick={downloadCompletedTasks} type="button">
                    Download
                  </button>
                )}
                <button
                  className="link-button"
                  disabled={loadingTasks}
                  onClick={() => loadTasks()}
                  type="button"
                >
                  {loadingTasks ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>

            <div className="task-tabs">
              <button
                className={activeTab === "todo" ? "active" : ""}
                onClick={() => setActiveTab("todo")}
                type="button"
              >
                To-Do ({taskSummary.remaining})
              </button>
              <button
                className={activeTab === "done" ? "active" : ""}
                onClick={() => setActiveTab("done")}
                type="button"
              >
                Completed Tasks ({taskSummary.completed})
              </button>
            </div>

            {loadingTasks ? (
              <p className="empty-state">Loading tasks...</p>
            ) : visibleTasks.length === 0 ? (
              <p className="empty-state">
                {activeTab === "todo"
                  ? todoEmptyMessage
                  : "No completed tasks yet. Completed tasks will appear here."}
              </p>
            ) : (
              <div className="task-list">
                {paginatedVisibleTasks.map((task) => {
                  const isExpandable = expandableTaskIds.includes(task.id);

                  return (
                    <article
                      className={`task-item ${task.status === "done" ? "task-done" : ""}`}
                      key={task.id}
                    >
                      <div
                        className={`task-main ${isExpandable ? "task-main-clickable" : ""}`}
                        onClick={isExpandable ? () => setExpandedTask(task) : undefined}
                        onKeyDown={
                          isExpandable
                            ? (event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setExpandedTask(task);
                                }
                              }
                            : undefined
                        }
                        role={isExpandable ? "button" : undefined}
                        tabIndex={isExpandable ? 0 : undefined}
                        title={isExpandable ? "Click to view full task" : undefined}
                      >
                        <div className="task-row">
                          <h3>{task.title}</h3>
                        </div>
                        <p
                          className="task-description"
                          ref={(element) => {
                            if (element) {
                              descriptionRefs.current[task.id] = element;
                            } else {
                              delete descriptionRefs.current[task.id];
                            }
                          }}
                        >
                          {task.description || "No description added."}
                        </p>
                        {isExpandable && <span className="view-full-hint">View full</span>}
                        <small>
                          Updated {new Date(task.updatedAt).toLocaleString()}
                        </small>
                      </div>

                      <div className="task-side">
                        <span className={`status-pill status-${task.status}`}>
                          {task.status === "done" ? "Done" : "To-Do"}
                        </span>
                        <div className="task-actions">
                          <button
                            onClick={() => toggleTaskStatus(task)}
                            title={task.status === "todo" ? "Mark Completed" : "Mark To-Do"}
                            type="button"
                          >
                            <span aria-hidden="true">{task.status === "todo" ? "✓" : "↺"}</span>
                            <span className="sr-only">
                              {task.status === "todo" ? "Mark Completed" : "Mark To-Do"}
                            </span>
                          </button>
                          <button onClick={() => startEdit(task)} title="Edit" type="button">
                            <span aria-hidden="true">✎</span>
                            <span className="sr-only">Edit</span>
                          </button>
                          <button
                            className="danger-button"
                            onClick={() => deleteTask(task.id)}
                            title="Delete"
                            type="button"
                          >
                            <span aria-hidden="true">🗑</span>
                            <span className="sr-only">Delete</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {activeTab === "done" && completedPageCount > 1 && (
              <div className="pagination">
                <button
                  className="link-button"
                  disabled={completedPage === 1}
                  onClick={() => setCompletedPage((currentPage) => currentPage - 1)}
                  type="button"
                >
                  Previous
                </button>
                <span>
                  Page {completedPage} of {completedPageCount}
                </span>
                <button
                  className="link-button"
                  disabled={completedPage === completedPageCount}
                  onClick={() => setCompletedPage((currentPage) => currentPage + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            )}
          </article>
        </section>
      </main>

      {expandedTask && (
        <div className="task-modal-backdrop" onClick={() => setExpandedTask(null)} role="presentation">
          <article className="task-modal card" onClick={(event) => event.stopPropagation()}>
            <div className="card-heading">
              <h2>{expandedTask.title}</h2>
              <button className="link-button" onClick={() => setExpandedTask(null)} type="button">
                Close
              </button>
            </div>
            <div className="task-modal-topbar">
              <span className={`status-pill status-${expandedTask.status}`}>
                {expandedTask.status === "done" ? "Done" : "To-Do"}
              </span>
              <div className="task-actions task-modal-actions">
                <button
                  onClick={() => toggleTaskStatus(expandedTask)}
                  title={expandedTask.status === "todo" ? "Mark Completed" : "Mark To-Do"}
                  type="button"
                >
                  <span aria-hidden="true">{expandedTask.status === "todo" ? "✓" : "↺"}</span>
                  <span className="sr-only">
                    {expandedTask.status === "todo" ? "Mark Completed" : "Mark To-Do"}
                  </span>
                </button>
                <button onClick={() => startEdit(expandedTask)} title="Edit" type="button">
                  <span aria-hidden="true">✎</span>
                  <span className="sr-only">Edit</span>
                </button>
                <button
                  className="danger-button"
                  onClick={() => deleteTask(expandedTask.id)}
                  title="Delete"
                  type="button"
                >
                  <span aria-hidden="true">🗑</span>
                  <span className="sr-only">Delete</span>
                </button>
              </div>
            </div>
            <p className="task-modal-description">
              {expandedTask.description || "No description added."}
            </p>
            <small>Updated {new Date(expandedTask.updatedAt).toLocaleString()}</small>
          </article>
        </div>
      )}

      {editingTask && (
        <div className="task-modal-backdrop" onClick={() => setEditingTask(null)} role="presentation">
          <article className="task-modal card" onClick={(event) => event.stopPropagation()}>
            <div className="card-heading">
              <h2>Edit Task</h2>
              <button className="link-button" onClick={() => setEditingTask(null)} type="button">
                Close
              </button>
            </div>
            <form className="task-modal-form" onSubmit={handleEditTaskSubmit}>
              <label>
                <span>Title</span>
                <input
                  required
                  type="text"
                  value={editTaskForm.title}
                  onChange={(event) =>
                    setEditTaskForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>

              <label>
                <span>Description</span>
                <textarea
                  rows="6"
                  value={editTaskForm.description}
                  onChange={(event) =>
                    setEditTaskForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </label>

              <label>
                <span>Status</span>
                <select
                  value={editTaskForm.status}
                  onChange={(event) =>
                    setEditTaskForm((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  <option value="todo">To-Do</option>
                  <option value="done">Completed Task</option>
                </select>
              </label>

              <div className="task-modal-form-actions">
                <button className="primary-button" type="submit">
                  Save Changes
                </button>
                <button className="link-button" onClick={() => setEditingTask(null)} type="button">
                  Cancel
                </button>
              </div>
            </form>
          </article>
        </div>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
