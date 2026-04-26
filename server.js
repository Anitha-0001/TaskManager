const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ users: [], tasks: [], sessions: [] }, null, 2),
      "utf8",
    );
  }
}

function readDatabase() {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDatabase(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalKey] = storedHash.split(":");
  if (!salt || !originalKey) {
    return false;
  }

  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(derivedKey, "hex"), Buffer.from(originalKey, "hex"));
}

function createSession(userId) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  return {
    rawToken,
    session: {
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      createdAt: new Date().toISOString(),
    },
  };
}

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

function getCurrentUser(req, db) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return null;
  }

  db.sessions = db.sessions.filter((session) => session.expiresAt > Date.now());

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = db.sessions.find((entry) => entry.tokenHash === tokenHash);
  if (!session) {
    return null;
  }

  return db.users.find((user) => user.id === session.userId) || null;
}

function requireUser(req, res, db) {
  const user = getCurrentUser(req, db);
  if (!user) {
    sendJson(res, 401, { error: "Authentication required" });
    return null;
  }

  writeDatabase(db);
  return user;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 6;
}

function validateTaskInput(payload) {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const description = typeof payload.description === "string" ? payload.description.trim() : "";
  const status = payload.status === "done" ? "done" : "todo";

  if (!title) {
    return { error: "Title is required" };
  }

  return { title, description, status };
}

function serveStaticFile(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  filePath = path.normalize(filePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not Found");
    return;
  }

  const contentTypeMap = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  };

  const extension = path.extname(filePath).toLowerCase();
  const contentType = contentTypeMap[extension] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname) {
  const db = readDatabase();

  if (pathname === "/api/register" && req.method === "POST") {
    const body = await parseBody(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!name) {
      sendJson(res, 400, { error: "Name is required" });
      return;
    }

    if (!validateEmail(email)) {
      sendJson(res, 400, { error: "A valid email is required" });
      return;
    }

    if (!validatePassword(password)) {
      sendJson(res, 400, { error: "Password must be at least 6 characters" });
      return;
    }

    if (db.users.some((user) => user.email === email)) {
      sendJson(res, 409, { error: "Email is already registered" });
      return;
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: createPasswordHash(password),
      createdAt: new Date().toISOString(),
    };

    const { rawToken, session } = createSession(user.id);
    db.users.push(user);
    db.sessions.push(session);
    writeDatabase(db);

    sendJson(res, 201, {
      token: rawToken,
      user: sanitizeUser(user),
    });
    return;
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const body = await parseBody(req);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    const user = db.users.find((entry) => entry.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendJson(res, 401, { error: "Invalid email or password" });
      return;
    }

    const { rawToken, session } = createSession(user.id);
    db.sessions = db.sessions.filter((entry) => entry.userId !== user.id);
    db.sessions.push(session);
    writeDatabase(db);

    sendJson(res, 200, {
      token: rawToken,
      user: sanitizeUser(user),
    });
    return;
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    const token = getTokenFromRequest(req);
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
      writeDatabase(db);
    }

    sendJson(res, 200, { message: "Logged out" });
    return;
  }

  if (pathname === "/api/me" && req.method === "GET") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }

    sendJson(res, 200, { user: sanitizeUser(user) });
    return;
  }

  if (pathname === "/api/tasks" && req.method === "GET") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }

    const tasks = db.tasks
      .filter((task) => task.userId === user.id)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    sendJson(res, 200, { tasks });
    return;
  }

  if (pathname === "/api/tasks" && req.method === "POST") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }

    const body = await parseBody(req);
    const taskData = validateTaskInput(body);
    if (taskData.error) {
      sendJson(res, 400, { error: taskData.error });
      return;
    }

    const timestamp = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      userId: user.id,
      title: taskData.title,
      description: taskData.description,
      status: taskData.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    db.tasks.push(task);
    writeDatabase(db);

    sendJson(res, 201, { task });
    return;
  }

  const taskIdMatch = pathname.match(/^\/api\/tasks\/([a-f0-9-]+)$/i);
  if (taskIdMatch) {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }

    const taskId = taskIdMatch[1];
    const task = db.tasks.find((entry) => entry.id === taskId && entry.userId === user.id);

    if (!task) {
      sendJson(res, 404, { error: "Task not found" });
      return;
    }

    if (req.method === "PUT") {
      const body = await parseBody(req);
      const taskData = validateTaskInput(body);
      if (taskData.error) {
        sendJson(res, 400, { error: taskData.error });
        return;
      }

      task.title = taskData.title;
      task.description = taskData.description;
      task.status = taskData.status;
      task.updatedAt = new Date().toISOString();
      writeDatabase(db);

      sendJson(res, 200, { task });
      return;
    }

    if (req.method === "DELETE") {
      db.tasks = db.tasks.filter((entry) => !(entry.id === task.id && entry.userId === user.id));
      writeDatabase(db);
      sendJson(res, 200, { message: "Task deleted" });
      return;
    }
  }

  sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    if (req.method !== "GET") {
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    serveStaticFile(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

ensureDatabase();

server.listen(PORT, () => {
  console.log(`Task manager running at http://localhost:${PORT}`);
});
